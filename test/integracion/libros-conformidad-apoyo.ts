import type pg from "pg";
import { type CodigoDeExcepcion, type LibroRegistrado } from "../../src/primitivas/libro/publico";
import { FORMA_DE_CLAVE } from "../../src/primitivas/libro/publico";

/**
 * Apoyo de `libros-conformidad.test.ts`: lee del catálogo de la base (`pg_catalog`) lo que una tabla de libro declara y evalúa las
 * invariantes C1 a C6 y la forma de la medida de `primitiva-de-libro-diseno.md` §2.1. Solo lee: no escribe datos.
 */

/** El rol de la aplicación: el que no puede reescribir ni borrar un asiento. */
export const ROL_DE_LA_APLICACION = "pedernal_app";
const COLUMNA_DE_HUELLA = "huella";
const COLUMNA_DE_ANULACION = "anula_a";
const COLUMNA_DE_EMPRESA = "empresa_id";
const COLUMNA_DE_AUTOR = "registrado_por";

export type CodigoDeInvariante =
  | "C1_SOLO_INSERCION_DE_FILA"
  | "C1_SOLO_INSERCION_DE_TRUNCATE"
  | "C1_SIN_PRIVILEGIOS_DE_ESCRITURA"
  | "C2_UNICO_ID_Y_EMPRESA"
  | "C2_FK_CON_EMPRESA"
  | "C2_RLS_ACTIVA"
  | "C2_RLS_FORZADA"
  | "C2_POLITICA_POR_EMPRESA"
  | "C3_UNICO_DE_CLAVE"
  | "C3_CLAVE_NO_NULA"
  | "C3_FORMA_DE_CLAVE"
  | "C3_FORMA_DE_HUELLA"
  | "C3_IDENTIDAD_POR_ORIGEN"
  | "C4_AUTOR"
  | "C4_MOMENTO"
  | "C4_FECHA_DE_NEGOCIO"
  | "C5_UNICO_DE_ANULACION"
  | "C5_CHECK_DEL_ESPEJO"
  | "C6_MAGNITUD_DISTINTA_DE_CERO"
  | "MEDIDA_UNA_SOLA_FORMA";

/** Qué invariante exime cada excepción declarada. */
export const INVARIANTE_QUE_EXIME: Readonly<Record<CodigoDeExcepcion, CodigoDeInvariante>> = {
  CLAVE_DE_FORMA_DISTINTA: "C3_FORMA_DE_CLAVE",
  CLAVE_NULA_EN_FONDO_INICIAL: "C3_CLAVE_NO_NULA",
  SIN_FECHA_DE_NEGOCIO: "C4_FECHA_DE_NEGOCIO",
  MAGNITUD_CERO_PERMITIDA: "C6_MAGNITUD_DISTINTA_DE_CERO",
};

export type Violacion = Readonly<{ invariante: CodigoDeInvariante; detalle: string }>;

type Restriccion = Readonly<{
  nombre: string;
  tipo: string;
  definicion: string;
  columnas: readonly string[];
  /** Solo en una clave foránea: si la tabla referenciada tiene `empresa_id` (y entonces la clave tiene que llevarlo). */
  referenciaConEmpresa: boolean;
}>;
type Indice = Readonly<{ columnas: readonly string[]; parcial: boolean }>;
type Disparador = Readonly<{ tipo: number; habilitado: string; funcion: string }>;
type Politica = Readonly<{ comando: string; roles: readonly string[]; expresion: string }>;
type Columna = Readonly<{ tipo: string; noNula: boolean }>;

export type CatalogoDeTabla = Readonly<{
  columnas: ReadonlyMap<string, Columna>;
  restricciones: readonly Restriccion[];
  indices: readonly Indice[];
  disparadores: readonly Disparador[];
  rlsActiva: boolean;
  rlsForzada: boolean;
  politicas: readonly Politica[];
  rolPuedeActualizar: boolean;
  rolPuedeBorrar: boolean;
  rolPuedeTruncar: boolean;
}>;

/** Lee del catálogo lo que declara la tabla `esquema.tabla` (con el rol de la aplicación como sujeto de los privilegios). */
export async function leerCatalogo(
  c: pg.Client,
  esquema: string,
  tabla: string,
): Promise<CatalogoDeTabla> {
  const destino = `"${esquema}"."${tabla}"`;
  const una = async <T extends pg.QueryResultRow>(texto: string): Promise<T[]> =>
    (await c.query<T>(texto, [destino])).rows;
  const columnas = await una<{ nombre: string; tipo: string; no_nula: boolean }>(
    `SELECT attname AS nombre, format_type(atttypid, atttypmod) AS tipo, attnotnull AS no_nula
       FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
  );
  const restricciones = await una<{
    nombre: string;
    tipo: string;
    definicion: string;
    columnas: string[];
    con_empresa: boolean;
  }>(
    `SELECT k.conname AS nombre, k.contype AS tipo, pg_get_constraintdef(k.oid) AS definicion,
            coalesce(array(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(n, o)
                             JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY u.o), '{}') AS columnas,
            k.contype = 'f' AND EXISTS (SELECT 1 FROM pg_attribute r WHERE r.attrelid = k.confrelid
                                          AND r.attname = '${COLUMNA_DE_EMPRESA}' AND NOT r.attisdropped) AS con_empresa
       FROM pg_constraint k WHERE k.conrelid = $1::regclass`,
  );
  const indices = await una<{ columnas: string[]; parcial: boolean }>(
    `SELECT array(SELECT a.attname::text FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(n, o)
                    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = u.n ORDER BY u.o) AS columnas,
            i.indpred IS NOT NULL AS parcial
       FROM pg_index i WHERE i.indrelid = $1::regclass AND i.indisunique AND i.indisvalid AND i.indexprs IS NULL`,
  );
  const disparadores = await una<{ tipo: number; habilitado: string; funcion: string }>(
    `SELECT t.tgtype::int AS tipo, t.tgenabled AS habilitado, n.nspname || '.' || p.proname AS funcion
       FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal`,
  );
  const [rls] = await una<{ activa: boolean; forzada: boolean }>(
    `SELECT relrowsecurity AS activa, relforcerowsecurity AS forzada FROM pg_class WHERE oid = $1::regclass`,
  );
  const politicas = await una<{ comando: string; roles: string[]; expresion: string }>(
    `SELECT pol.polcmd AS comando,
            coalesce(array(SELECT CASE WHEN r = 0 THEN 'public' ELSE r::regrole::text END FROM unnest(pol.polroles) r), '{}') AS roles,
            coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS expresion
       FROM pg_policy pol WHERE pol.polrelid = $1::regclass`,
  );
  const tiene = async (consulta: string): Promise<boolean> =>
    (await c.query<{ ok: boolean }>(`SELECT ${consulta} AS ok`, [destino, ROL_DE_LA_APLICACION]))
      .rows[0]?.ok === true;
  // Un UPDATE por columna también reescribe un asiento; DELETE y TRUNCATE solo existen a nivel de tabla.
  const puedeActualizar = await tiene(
    `has_table_privilege($2, $1::regclass, 'UPDATE') OR has_any_column_privilege($2, $1::regclass, 'UPDATE')`,
  );
  const puedeBorrar = await tiene(`has_table_privilege($2, $1::regclass, 'DELETE')`);
  const puedeTruncar = await tiene(`has_table_privilege($2, $1::regclass, 'TRUNCATE')`);
  return {
    columnas: new Map(columnas.map((x) => [x.nombre, { tipo: x.tipo, noNula: x.no_nula }])),
    restricciones: restricciones.map((x) => ({
      nombre: x.nombre,
      tipo: x.tipo,
      definicion: x.definicion,
      columnas: x.columnas,
      referenciaConEmpresa: x.con_empresa,
    })),
    indices,
    disparadores,
    rlsActiva: rls?.activa === true,
    rlsForzada: rls?.forzada === true,
    politicas,
    rolPuedeActualizar: puedeActualizar,
    rolPuedeBorrar: puedeBorrar,
    rolPuedeTruncar: puedeTruncar,
  };
}

const BIT_FILA = 1;
const BIT_ANTES = 2;
const BIT_BORRAR = 8;
const BIT_ACTUALIZAR = 16;
const BIT_TRUNCAR = 32;
const FUNCION_SOLO_INSERCION = "public.solo_insercion";

const escapar = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mismoConjunto = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && b.every((x) => a.includes(x));

/** ¿Hay una clave única (restricción o índice) completa, no parcial, exactamente sobre estas columnas (en cualquier orden)? */
const hayUnico = (cat: CatalogoDeTabla, columnas: readonly string[]): boolean =>
  cat.indices.some((i) => !i.parcial && mismoConjunto(i.columnas, columnas));

const hayCheck = (cat: CatalogoDeTabla, patron: RegExp): boolean =>
  cat.restricciones.some((r) => r.tipo === "c" && patron.test(r.definicion));

function disparadorDeSoloInsercion(cat: CatalogoDeTabla, bits: number, aFila: boolean): boolean {
  return cat.disparadores.some(
    (d) =>
      d.funcion === FUNCION_SOLO_INSERCION &&
      (d.habilitado === "O" || d.habilitado === "A") &&
      (d.tipo & BIT_ANTES) !== 0 &&
      ((d.tipo & BIT_FILA) !== 0) === aFila &&
      (d.tipo & bits) === bits,
  );
}

function evaluarC1y2(cat: CatalogoDeTabla): Violacion[] {
  const v: Violacion[] = [];
  const falla = (invariante: CodigoDeInvariante, detalle: string): number =>
    v.push({ invariante, detalle });
  if (!disparadorDeSoloInsercion(cat, BIT_BORRAR | BIT_ACTUALIZAR, true))
    falla(
      "C1_SOLO_INSERCION_DE_FILA",
      "falta el disparador de fila solo_insercion() de UPDATE y DELETE",
    );
  if (!disparadorDeSoloInsercion(cat, BIT_TRUNCAR, false))
    falla(
      "C1_SOLO_INSERCION_DE_TRUNCATE",
      "falta el disparador de sentencia solo_insercion() de TRUNCATE",
    );
  if (cat.rolPuedeActualizar || cat.rolPuedeBorrar || cat.rolPuedeTruncar)
    falla(
      "C1_SIN_PRIVILEGIOS_DE_ESCRITURA",
      `el rol ${ROL_DE_LA_APLICACION} puede reescribir: UPDATE=${String(cat.rolPuedeActualizar)} DELETE=${String(cat.rolPuedeBorrar)} TRUNCATE=${String(cat.rolPuedeTruncar)}`,
    );
  if (!hayUnico(cat, ["id", COLUMNA_DE_EMPRESA]))
    falla(
      "C2_UNICO_ID_Y_EMPRESA",
      "falta UNIQUE (id, empresa_id) o la clave primaria compuesta equivalente",
    );
  for (const r of cat.restricciones) {
    if (r.tipo === "f" && r.referenciaConEmpresa && !r.columnas.includes(COLUMNA_DE_EMPRESA))
      falla(
        "C2_FK_CON_EMPRESA",
        `${r.nombre} apunta a una tabla con empresa_id sin llevar empresa_id`,
      );
  }
  if (!cat.rlsActiva) falla("C2_RLS_ACTIVA", "la seguridad por filas no está habilitada");
  if (!cat.rlsForzada)
    falla("C2_RLS_FORZADA", "la seguridad por filas no está forzada (el dueño la saltearía)");
  const deLaApp = cat.politicas.filter(
    (p) => p.roles.includes(ROL_DE_LA_APLICACION) || p.roles.includes("public"),
  );
  const lee = deLaApp.some((p) => p.comando === "r" || p.comando === "*");
  if (!lee || deLaApp.some((p) => !p.expresion.includes("app_empresa_id()")))
    falla(
      "C2_POLITICA_POR_EMPRESA",
      `el rol ${ROL_DE_LA_APLICACION} necesita una política de lectura y que toda política suya compare con app_empresa_id()`,
    );
  return v;
}

function evaluarC3aC6(
  libro: LibroRegistrado,
  cat: CatalogoDeTabla,
  medida: CatalogoDeTabla,
): Violacion[] {
  const v: Violacion[] = [];
  const falla = (invariante: CodigoDeInvariante, detalle: string): number =>
    v.push({ invariante, detalle });
  const clave = libro.columnaDeClave;
  if (!hayUnico(cat, [COLUMNA_DE_EMPRESA, clave]))
    falla("C3_UNICO_DE_CLAVE", `falta UNIQUE (empresa_id, ${clave})`);
  if (cat.columnas.get(clave)?.noNula !== true)
    falla("C3_CLAVE_NO_NULA", `${clave} admite NULL (o no existe)`);
  const copiaDeLaForma = hayCheck(
    cat,
    new RegExp(`${escapar(clave)} ~ '${escapar(libro.formaDeClave)}'`),
  );
  if (!copiaDeLaForma || libro.formaDeClave !== FORMA_DE_CLAVE.source)
    falla(
      "C3_FORMA_DE_CLAVE",
      copiaDeLaForma
        ? `la forma de la clave (${libro.formaDeClave}) no es la de los libros nuevos (${FORMA_DE_CLAVE.source})`
        : `ningún CHECK copia la forma de la clave ${libro.formaDeClave}`,
    );
  if (!hayCheck(cat, new RegExp(`${COLUMNA_DE_HUELLA} ~ '\\^\\[0-9a-f\\]\\{64\\}\\$'`)))
    falla("C3_FORMA_DE_HUELLA", "ningún CHECK copia la forma de la huella ^[0-9a-f]{64}$");
  if (libro.identidadPorOrigen !== null) {
    const columnas = libro.identidadPorOrigen;
    if (!cat.indices.some((i) => mismoConjunto(i.columnas, columnas)))
      falla("C3_IDENTIDAD_POR_ORIGEN", `falta el índice único sobre (${columnas.join(", ")})`);
  }
  for (const [invariante, columna] of [
    ["C4_AUTOR", COLUMNA_DE_AUTOR],
    ["C4_MOMENTO", libro.columnaDeMomento],
    ["C4_FECHA_DE_NEGOCIO", libro.columnaDeFecha],
  ] as const) {
    if (cat.columnas.get(columna)?.noNula !== true)
      falla(invariante, `${columna} no existe o admite NULL`);
  }
  if (!hayUnico(cat, [COLUMNA_DE_EMPRESA, COLUMNA_DE_ANULACION]))
    falla("C5_UNICO_DE_ANULACION", `falta UNIQUE (empresa_id, ${COLUMNA_DE_ANULACION})`);
  if (!hayCheck(cat, new RegExp(`'ANULACION'.*${COLUMNA_DE_ANULACION} IS NOT NULL`)))
    falla("C5_CHECK_DEL_ESPEJO", "ningún CHECK liga la clase ANULACION con anula_a");
  const m = libro.columnaDeMedida;
  if (!hayCheck(medida, new RegExp(`^CHECK \\(+${m} <> (?:\\(0\\)::numeric|0)\\)`)))
    falla(
      "C6_MAGNITUD_DISTINTA_DE_CERO",
      `ningún CHECK de ${libro.tablaDeMedida} excluye ${m} = 0`,
    );
  v.push(...evaluarMedida(libro, cat, medida));
  return v;
}

/** Importe (con su moneda) o cantidad; nunca ambas: ni en la tabla del libro ni en la que lleva la medida. */
function evaluarMedida(
  libro: LibroRegistrado,
  cat: CatalogoDeTabla,
  medida: CatalogoDeTabla,
): Violacion[] {
  const problemas: string[] = [];
  const esImporte = libro.medida === "IMPORTE";
  const columna = medida.columnas.get(libro.columnaDeMedida);
  const tipoEsperado = esImporte ? "numeric(18,2)" : "numeric(18,4)";
  if (columna?.tipo !== tipoEsperado || !columna.noNula)
    problemas.push(`${libro.columnaDeMedida} tiene que ser ${tipoEsperado} NOT NULL`);
  const prohibidas = esImporte ? ["cantidad"] : ["importe", "moneda"];
  for (const t of new Set([cat, medida])) {
    for (const p of prohibidas)
      if (t.columnas.has(p)) problemas.push(`no puede tener la columna ${p}`);
  }
  if (esImporte) {
    const moneda = medida.columnas.get("moneda");
    if (moneda?.tipo !== "character(3)" || !moneda.noNula)
      problemas.push("moneda tiene que ser char(3) NOT NULL");
    if (!hayCheck(medida, /moneda = '[A-Z]{3}'/)) problemas.push("ningún CHECK fija la moneda");
  }
  return problemas.map((detalle) => ({ invariante: "MEDIDA_UNA_SOLA_FORMA", detalle }));
}

/** Todas las divergencias del libro frente a las invariantes, SIN descontar sus excepciones. */
export function evaluarLibro(
  libro: LibroRegistrado,
  cat: CatalogoDeTabla,
  medida: CatalogoDeTabla,
): Violacion[] {
  return [...evaluarC1y2(cat), ...evaluarC3aC6(libro, cat, medida)];
}

/** Las divergencias que el libro NO declaró como excepción. */
export function violacionesSinDeclarar(
  libro: LibroRegistrado,
  todas: readonly Violacion[],
): Violacion[] {
  const eximidas = new Set(libro.excepciones.map((e) => INVARIANTE_QUE_EXIME[e.codigo]));
  return todas.filter((x) => !eximidas.has(x.invariante));
}

/** Las excepciones declaradas que el libro ya no necesita (su invariante hoy se cumple): hay que borrarlas. */
export function excepcionesQueSobran(
  libro: LibroRegistrado,
  todas: readonly Violacion[],
): string[] {
  return libro.excepciones
    .filter((e) => !todas.some((x) => x.invariante === INVARIANTE_QUE_EXIME[e.codigo]))
    .map((e) => e.codigo);
}
