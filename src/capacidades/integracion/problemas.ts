import type { TipoDeContexto, OperacionContextual } from "./tipos";
import { esRutaPropia } from "./sobre";

/**
 * Lo que está mal en los registros de integración (vacío = bien). Pura: recibe todo ya leído (el catálogo, el vocabulario, las
 * rutas de la app y una función que lee archivos), así que las pruebas la corren con registros de mentira y una violación
 * inyectada por regla. Previene: una operación que apunta a una acción de otro módulo, a un texto o una ruta que no existen, o un
 * contexto que ninguna pantalla entrega de verdad. Chequeo: `problemas.test.ts` y `test/arquitectura/operaciones-contextuales.test.ts`.
 */

export type EntradaDeProblemas = Readonly<{
  contextos: Readonly<Record<string, TipoDeContexto>>;
  operaciones: readonly OperacionContextual<string>[];
  catalogo: Readonly<
    Record<
      string,
      Readonly<{ requiere: readonly string[]; acciones: Readonly<Record<string, unknown>> }>
    >
  >;
  perillas: Readonly<Record<string, Readonly<{ modulo: string }>>>;
  textos: ReadonlySet<string>;
  /** Las rutas de `apps/web/app` como las ve la persona; un segmento `[x]` vale por cualquier segmento. */
  rutasDeLaApp: readonly string[];
  /** El texto de un archivo desde la raíz, o `null` si no existe. */
  leerArchivo: (ruta: string) => string | null;
}>;

const FORMA_DE_CLAVE = /^([a-z][a-z0-9_]*)\.[a-z][a-z0-9_]*$/;

function coincideLaRuta(ruta: string, patron: string): boolean {
  const a = ruta.split("/");
  const b = patron.split("/");
  return (
    a.length === b.length &&
    b.every((s, i) => s === a[i] || (s.startsWith("[") && s.endsWith("]") && a[i] !== ""))
  );
}

/** Los módulos que `modulo` requiere, directa o indirectamente (el catálogo no tiene ciclos: cruce X3). */
function requeridosDe(
  catalogo: EntradaDeProblemas["catalogo"],
  modulo: string,
): ReadonlySet<string> {
  const vistos = new Set<string>();
  const pendientes = [...(catalogo[modulo]?.requiere ?? [])];
  for (let actual = pendientes.pop(); actual !== undefined; actual = pendientes.pop()) {
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    pendientes.push(...(catalogo[actual]?.requiere ?? []));
  }
  return vistos;
}

export function problemasDeIntegracion(entrada: EntradaDeProblemas): readonly string[] {
  const { contextos, operaciones, catalogo, perillas, textos, rutasDeLaApp, leerArchivo } = entrada;
  const problemas: string[] = [];
  const existeElModulo = (m: string): boolean => Object.hasOwn(catalogo, m);

  for (const [clave, contexto] of Object.entries(contextos)) {
    const forma = FORMA_DE_CLAVE.exec(clave);
    if (forma === null) problemas.push(`Contexto ${clave}: la clave tiene que ser «modulo.cosa».`);
    else if (forma[1] !== contexto.modulo)
      problemas.push(
        `Contexto ${clave}: su primera parte no es el módulo declarado (${contexto.modulo}).`,
      );
    if (!existeElModulo(contexto.modulo))
      problemas.push(`Contexto ${clave}: el módulo ${contexto.modulo} no existe.`);
    for (const archivo of contexto.loEntregan) {
      const texto = leerArchivo(archivo);
      if (texto === null) problemas.push(`Contexto ${clave}: el archivo ${archivo} no existe.`);
      else if (!texto.includes(clave))
        problemas.push(
          `Contexto ${clave}: el archivo ${archivo} no nombra el contexto (nadie lo entrega de verdad).`,
        );
    }
  }

  const ids = new Set<string>();
  const ordenes = new Set<string>();
  for (const o of operaciones) {
    const dueno = (m: string): string => `Operación ${o.id}: ${m}`;
    if (!FORMA_DE_CLAVE.test(o.id)) problemas.push(dueno("el id tiene que ser «modulo.cosa»."));
    if (ids.has(o.id)) problemas.push(dueno("el id está repetido."));
    ids.add(o.id);
    const contexto = Object.hasOwn(contextos, o.contexto) ? contextos[o.contexto] : undefined;
    if (contexto === undefined) problemas.push(dueno(`el contexto ${o.contexto} no existe.`));
    if (!existeElModulo(o.modulo)) problemas.push(dueno(`el módulo ${o.modulo} no existe.`));
    else if (!Object.hasOwn(catalogo[o.modulo]?.acciones ?? {}, o.accion))
      problemas.push(dueno(`la acción ${o.accion} no es del módulo ${o.modulo}.`));
    if (o.perilla !== null && perillas[o.perilla]?.modulo !== o.modulo)
      problemas.push(dueno(`la perilla ${o.perilla} no es del módulo ${o.modulo}.`));
    if (!textos.has(o.etiqueta))
      problemas.push(dueno(`el texto ${o.etiqueta} no está en el vocabulario.`));
    const clave = `${o.contexto}#${o.orden}`;
    if (!Number.isInteger(o.orden)) problemas.push(dueno("el orden tiene que ser un entero."));
    else if (ordenes.has(clave))
      problemas.push(dueno(`el orden ${o.orden} está repetido dentro de ${o.contexto}.`));
    ordenes.add(clave);
    if (!esRutaPropia(o.seAbreEn) || o.seAbreEn.includes("?") || o.seAbreEn.includes("#"))
      problemas.push(
        dueno("seAbreEn tiene que ser una ruta propia que empiece con «/», sin consulta."),
      );
    else if (!rutasDeLaApp.some((patron) => coincideLaRuta(o.seAbreEn, patron)))
      problemas.push(dueno(`la ruta ${o.seAbreEn} no existe en apps/web/app.`));
    if (
      contexto !== undefined &&
      contexto.modulo !== o.modulo &&
      requeridosDe(catalogo, contexto.modulo).has(o.modulo)
    )
      problemas.push(
        dueno(
          `el módulo ${o.modulo} es de abajo de ${contexto.modulo}: no opera sobre lo de arriba.`,
        ),
      );
  }
  return problemas;
}
