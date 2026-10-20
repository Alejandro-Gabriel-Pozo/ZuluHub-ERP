import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  LISTAS_DE_ASPECTO,
  TOKENS_DE_ASPECTO,
  validarAspecto,
} from "../../src/modulos/marcas/publico";
import { campoConPosibleSecreto } from "../../src/puertos/sin-secretos";
import { comoPlataforma } from "./entorno";
import { conAppDe, conPlataformaDe } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  HASTA_0006,
  baseConMigraciones,
  carpetaCon,
  crearBorradorDeMarca,
  crearDominio,
  crearMarca,
  crearMundoDeMarca,
  crearVersionDeMarcaConfirmada,
  huellaDeCatalogo,
  marcaPrincipal,
} from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * El aspecto de la marca (M7a): la migración 0014 (`version_de_marca.aspecto`, su CHECK `aspecto_valido` y
 * sus privilegios por columna) sobre una base CON DATOS. Se prueba que es aditiva (ningún dato cambia: toda
 * versión que ya existe queda con `'{}'`, o sea con los defectos, y ninguna marca cambia de aspecto sin que el
 * dueño lo decida), que el CHECK acepta `{}` y cada valor de cada lista y rechaza todo lo demás, que los
 * privilegios son el espejo EXACTO de los de `tema`, lo que lee de verdad cada rol, sus guardas, que se puede
 * repetir, lo que promete el texto del archivo y su reversión (que borra solo la columna que agregó).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const SUFIJO = "aspecto_de_marca";
const archivos = async () => (await readdir(CARPETA_DE_MIGRACIONES)).sort();
const archivoDeLaMigracion = async (): Promise<string> => {
  const encontrados = (await archivos()).filter((n) =>
    new RegExp(`^\\d{4}_${SUFIJO}\\.sql$`).test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una migración, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const archivoDeLaReversion = async (): Promise<string> => {
  const encontrados = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
    new RegExp(`^\\d{4}_revertir_${SUFIJO}\\.sql$`).test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una reversión, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
/** Todas las migraciones anteriores a la de esta rama, en orden. */
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};
const textoDeLaMigracion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, await archivoDeLaMigracion()), "utf8");
const textoDeLaReversion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", await archivoDeLaReversion()), "utf8");

/**
 * Contenido de cada tabla de negocio SIN la columna `aspecto` (que la migración agrega): ni una fila ni un
 * valor de lo que ya existía puede cambiar.
 */
async function huellaDeDatos(c: pg.Client): Promise<Record<string, string>> {
  const { rows: tablas } = await c.query<{ t: string }>(
    `select c.relname as t from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'migracion' order by 1`,
  );
  const r: Record<string, string> = {};
  for (const { t } of tablas) {
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg(((to_jsonb(x)) - 'aspecto')::text, '|' order by ((to_jsonb(x)) - 'aspecto')::text)), '-') as h from ${t} x`,
    );
    r[t] = rows[0]?.h as string;
  }
  return r;
}

type Sembrado = Readonly<{ principal: string; hija: string; borrador: string; programada: string }>;

/** Versiones de todos los estados en dos marcas, para que «no cambia nada» no se cumpla por vacío. */
async function sembrar(c: pg.Client): Promise<Sembrado> {
  const principal = await marcaPrincipal(c);
  await crearVersionDeMarcaConfirmada(c, principal, { nombreVisible: "Principal" });
  await crearDominio(c, principal, { canonico: true });
  const hija = await crearMarca(c, { padre: principal });
  await crearVersionDeMarcaConfirmada(c, hija, { nombreVisible: "Hija" });
  const programada = await crearMarca(c, { padre: principal });
  await crearVersionDeMarcaConfirmada(c, programada, {
    nombreVisible: "Programada",
    desdeSegundos: 3600,
  });
  const borrador = await crearMarca(c, { padre: principal });
  await crearBorradorDeMarca(c, borrador, { nombreVisible: "Borrador" });
  await crearMundoDeMarca(c, { marca: principal });
  return { principal, hija, borrador, programada };
}

function diferencias(antes: Record<string, string[]>, despues: Record<string, string[]>) {
  const nuevas: Record<string, string[]> = {};
  const perdidas: Record<string, string[]> = {};
  for (const categoria of Object.keys(antes)) {
    const a = new Set(antes[categoria]);
    const d = new Set(despues[categoria]);
    nuevas[categoria] = [...d].filter((x) => !a.has(x));
    perdidas[categoria] = [...a].filter((x) => !d.has(x));
  }
  return { nuevas, perdidas };
}

/** Un `aclitem[]` como `{a=r/x,b=aw/x}` ordenado, para comparar sin depender del orden de las concesiones. */
const aclOrdenada = (linea: string): string => {
  const abre = linea.indexOf("{");
  const items = linea
    .slice(abre + 1, linea.lastIndexOf("}"))
    .split(",")
    .sort();
  return `${linea.slice(0, abre)}{${items.join(",")}}`;
};

/** Exactamente lo que el rol público lee de `version_de_marca` después de 0007 y 0014. */
const COLUMNAS_PUBLICAS_DE_VERSION = [
  "aspecto",
  "logo",
  "marca_id",
  "nombre_visible",
  "numero",
  "tema",
  "vigente_desde",
  "vocabulario",
];
/** Las 24 columnas del rol público de antes (0007 y 0011) más `version_de_marca.aspecto`. */
const COLUMNAS_DEL_ROL_PUBLICO = [
  "dominio.duenio_empresa_id",
  "dominio.duenio_marca_id",
  "dominio.es_canonico",
  "dominio.estado",
  "dominio.host",
  "dominio.marca_id",
  "dominio.superficie",
  "marca.codigo",
  "marca.es_principal",
  "marca.id",
  "marca.marca_padre_id",
  "marca.nivel",
  "resolucion_de_host.duenio_empresa_id",
  "resolucion_de_host.duenio_marca_id",
  "resolucion_de_host.host",
  "resolucion_de_host.marca_id",
  "resolucion_de_host.superficie",
  ...COLUMNAS_PUBLICAS_DE_VERSION.map((c) => `version_de_marca.${c}`),
].sort();

const ROLES_SIN_VERSION_DE_MARCA = [
  "pedernal_trabajos",
  "pedernal_grupo",
  "pedernal_autenticacion",
  "pedernal_captacion",
] as const;

const codigoDe = (consulta: Promise<unknown>): Promise<string | null> =>
  consulta.then(
    () => null,
    (e: { code?: string }) => e.code ?? "?",
  );

async function comoRol<T>(url: string, trabajo: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
}

describe.skipIf(base === null)(
  "aspecto de la marca: la migración 0014 sobre datos reales, su CHECK, sus privilegios y su reversión",
  () => {
    const b = () => base as BaseDePruebas;

    /** Una base con todo menos 0014, y la carpeta con 0014 lista para aplicar. */
    async function conPrevias<T>(
      trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, con: string) => Promise<T>,
    ): Promise<T> {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      const conMia = await carpetaCon([
        ...(await migracionesPrevias()),
        await archivoDeLaMigracion(),
      ]);
      try {
        return await trabajo(previa, conMia);
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    }

    /** Una base con 0014 aplicada y los datos sembrados ANTES de aplicarla (como en producción). */
    async function conTodas<T>(
      trabajo: (
        x: Awaited<ReturnType<typeof baseConMigraciones>>,
        sembrado: Sembrado,
      ) => Promise<T>,
    ): Promise<T> {
      return conPrevias(async (previa, conMia) => {
        const sembrado = await sembrar(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        return trabajo(previa, sembrado);
      });
    }

    // ===========================================================================================================
    // Aditiva
    // ===========================================================================================================
    it("sobre una base con datos no cambia NI UN dato: toda versión queda con `{}` (los defectos) y el catálogo solo gana la columna, su CHECK, la función y sus privilegios", async () => {
      await conPrevias(async (previa, conMia) => {
        await sembrar(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const catalogoAntes = await huellaDeCatalogo(previa.cliente);
        const { rows: antes } = await previa.cliente.query<{ n: string }>(
          "select count(*) as n from version_de_marca",
        );
        expect(Number(antes[0]?.n)).toBeGreaterThanOrEqual(4);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);

        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
        // Ninguna marca cambia de aspecto: TODAS las versiones que existían quedan con `{}` y válidas.
        const { rows } = await previa.cliente.query<{
          total: string;
          vacias: string;
          validas: string;
        }>(
          `select count(*) as total, count(*) filter (where aspecto = '{}'::jsonb) as vacias,
                  count(*) filter (where aspecto_valido(aspecto)) as validas
             from version_de_marca`,
        );
        expect(rows[0]).toEqual({ total: antes[0]?.n, vacias: antes[0]?.n, validas: antes[0]?.n });

        const { nuevas, perdidas } = diferencias(
          catalogoAntes,
          await huellaDeCatalogo(previa.cliente),
        );
        // Nada se pierde ni se modifica: todo lo que había sigue idéntico.
        for (const categoria of Object.keys(perdidas)) {
          expect(perdidas[categoria], `${categoria}: líneas perdidas`).toEqual([]);
        }
        // Y lo nuevo es exactamente esto: la columna, su CHECK, la función y los privilegios de esa columna.
        expect(nuevas["columnas"]).toHaveLength(1);
        expect(nuevas["columnas"]?.[0]).toMatch(
          /^version_de_marca\.aspecto:\d+:jsonb:NO:'\{\}'::jsonb$/,
        );
        expect(nuevas["restricciones"]).toEqual([
          "version_de_marca.version_de_marca_aspecto_ck:c:CHECK (aspecto_valido(aspecto))",
        ]);
        expect(nuevas["funciones"]).toHaveLength(1);
        expect(nuevas["funciones"]?.[0]).toMatch(
          /^aspecto_valido\(a jsonb\):f:i:search_path=pg_catalog, public, pg_temp:[0-9a-f]{32}:\{.*pedernal_plataforma=X\//,
        );
        expect(nuevas["privilegiosPorColumna"]).toHaveLength(1);
        for (const categoria of ["indices", "disparadores", "politicas", "esquema", "tablas"]) {
          expect(nuevas[categoria], `${categoria}: líneas nuevas`).toEqual([]);
        }
      });
    });

    it("sus privilegios por columna son el ESPEJO EXACTO de los de `tema` (la misma ACL, con el nombre cambiado)", async () => {
      await conTodas(async (previa) => {
        const { privilegiosPorColumna } = await huellaDeCatalogo(previa.cliente);
        const de = (columna: string) =>
          privilegiosPorColumna?.find((l) => l.startsWith(`version_de_marca.${columna}:`));
        const tema = de("tema");
        const aspecto = de("aspecto");
        expect(tema).toBeDefined();
        expect(aspecto).toBeDefined();
        expect(aclOrdenada((aspecto as string).replace("aspecto", "tema"))).toBe(
          aclOrdenada(tema as string),
        );
        // Y es lo que se quiere: público y aplicación leen; la plataforma inserta y actualiza; nadie más.
        const items = ((aspecto as string).match(/\{(.*)\}/)?.[1] ?? "").split(",").sort();
        expect(items.map((i) => i.replace(/\/.*$/, ""))).toEqual([
          "pedernal_app=r",
          "pedernal_plataforma=aw",
          "pedernal_publico=r",
        ]);
      });
    });

    it("para CADA rol, SELECT, INSERT, UPDATE y REFERENCES sobre `aspecto` valen lo mismo que sobre `tema` (quien no edita el tema no escribe el aspecto)", async () => {
      await conTodas(async (previa) => {
        const { rows: roles } = await previa.cliente.query<{ rolname: string }>(
          "select rolname from pg_roles where rolname like 'pedernal\\_%' order by 1",
        );
        expect(roles.map((r) => r.rolname)).toEqual(
          expect.arrayContaining([
            "pedernal_app",
            "pedernal_autenticacion",
            "pedernal_captacion",
            "pedernal_grupo",
            "pedernal_plataforma",
            "pedernal_publico",
            "pedernal_trabajos",
          ]),
        );
        const quienes = [...roles.map((r) => r.rolname), "public"];
        for (const rol of quienes) {
          for (const privilegio of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
            const { rows } = await previa.cliente.query<{ tema: boolean; aspecto: boolean }>(
              `select has_column_privilege($1, 'public.version_de_marca', 'tema', $2) as tema,
                      has_column_privilege($1, 'public.version_de_marca', 'aspecto', $2) as aspecto`,
              [rol, privilegio],
            );
            expect(rows[0]?.aspecto, `${rol} ${privilegio}`).toBe(rows[0]?.tema);
          }
        }
        // Ancla: no es un «igual» vacío. Escribe solo la plataforma; leen la plataforma, la aplicación y el público.
        const puede = async (rol: string, privilegio: string) =>
          (
            await previa.cliente.query<{ p: boolean }>(
              "select has_column_privilege($1, 'public.version_de_marca', 'aspecto', $2) as p",
              [rol, privilegio],
            )
          ).rows[0]?.p;
        expect(await puede("pedernal_plataforma", "INSERT")).toBe(true);
        expect(await puede("pedernal_plataforma", "UPDATE")).toBe(true);
        for (const rol of ["pedernal_app", "pedernal_publico", ...ROLES_SIN_VERSION_DE_MARCA]) {
          expect(await puede(rol, "INSERT"), `${rol} INSERT`).toBe(false);
          expect(await puede(rol, "UPDATE"), `${rol} UPDATE`).toBe(false);
        }
        expect(await puede("pedernal_publico", "SELECT")).toBe(true);
        expect(await puede("pedernal_app", "SELECT")).toBe(true);
        for (const rol of ROLES_SIN_VERSION_DE_MARCA) {
          expect(await puede(rol, "SELECT"), `${rol} SELECT`).toBe(false);
        }
      });
    });

    it("`aspecto_valido` nace cerrada para PUBLIC, la ejecuta solo la plataforma y es IMMUTABLE, sin SECURITY DEFINER y con su search_path", async () => {
      await conTodas(async (previa) => {
        const { rows } = await previa.cliente.query<{
          volatilidad: string;
          segura: boolean;
          proconfig: string[];
          publica: boolean;
        }>(
          `select p.provolatile as volatilidad, p.prosecdef as segura, p.proconfig,
                  (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a
                                                where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as publica
             from pg_proc p where p.oid = 'public.aspecto_valido(jsonb)'::regprocedure`,
        );
        expect(rows[0]).toEqual({
          volatilidad: "i",
          segura: false,
          proconfig: ["search_path=pg_catalog, public, pg_temp"],
          publica: false,
        });
        for (const rol of [
          "pedernal_app",
          "pedernal_publico",
          "pedernal_plataforma",
          "pedernal_grupo",
          "pedernal_trabajos",
          "pedernal_autenticacion",
          "pedernal_captacion",
        ]) {
          const { rows: puede } = await previa.cliente.query<{ p: boolean }>(
            "select has_function_privilege($1, 'public.aspecto_valido(jsonb)', 'EXECUTE') as p",
            [rol],
          );
          expect(puede[0]?.p, rol).toBe(rol === "pedernal_plataforma");
        }
      });
    });

    // ===========================================================================================================
    // Repetible
    // ===========================================================================================================
    it("correr las migraciones de nuevo no cambia nada, y repetir el SQL de la migración a mano tampoco: ni el catálogo ni los aspectos ya cargados", async () => {
      await conTodas(async (previa, sembrado) => {
        const borrador = await previa.cliente.query<{ id: string }>(
          "select id from version_de_marca where marca_id = $1 and estado = 'BORRADOR'",
          [sembrado.borrador],
        );
        await previa.cliente.query(
          `update version_de_marca set aspecto = '{"estilo":"MODERNO","ingreso":"DIVIDIDO"}'::jsonb where id = $1`,
          [borrador.rows[0]?.id],
        );
        const catalogo = await huellaDeCatalogo(previa.cliente);
        const datos = await huellaDeDatos(previa.cliente);

        const carpeta = await carpetaCon([
          ...(await migracionesPrevias()),
          await archivoDeLaMigracion(),
        ]);
        try {
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, carpeta);
          expect(otra).toEqual({
            aplicadas: [],
            yaAplicadas: [...(await migracionesPrevias()), await archivoDeLaMigracion()],
          });
        } finally {
          await rm(carpeta, { recursive: true, force: true });
        }
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);

        // El SQL entero, una y otra vez, sobre la base ya migrada y con datos: no falla, no cambia el catálogo
        // ni borra lo cargado.
        const texto = await textoDeLaMigracion();
        await previa.cliente.query("begin");
        await previa.cliente.query(texto);
        await previa.cliente.query(texto);
        await previa.cliente.query("commit");
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);
        expect(await huellaDeDatos(previa.cliente)).toEqual(datos);
        const { rows } = await previa.cliente.query<{ aspecto: unknown }>(
          "select aspecto from version_de_marca where id = $1",
          [borrador.rows[0]?.id],
        );
        expect(rows[0]?.aspecto).toEqual({ estilo: "MODERNO", ingreso: "DIVIDIDO" });
      });
    });

    // ===========================================================================================================
    // Guardas
    // ===========================================================================================================
    it("exige 0007: sin las marcas se frena con un mensaje claro y no deja nada registrado", async () => {
      const aparte = await baseConMigraciones(b(), HASTA_0006);
      const carpeta = await carpetaCon([...HASTA_0006, await archivoDeLaMigracion()]);
      try {
        await expect(aplicarMigraciones(aparte.aparte.base.dueno, carpeta)).rejects.toThrow(
          /0014 requiere 0007_marcas_y_planes aplicada antes/,
        );
        const { rows } = await aparte.cliente.query<{ nombre: string }>(
          `select nombre from migracion where nombre like '%${SUFIJO}%'`,
        );
        expect(rows).toEqual([]);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await aparte.cerrar();
      }
    });

    // ===========================================================================================================
    // El CHECK
    // ===========================================================================================================
    describe("el CHECK `version_de_marca_aspecto_ck`", () => {
      it("acepta `{}` y cada valor de cada lista, solo o junto a los demás; el defecto de la columna es `{}`", async () => {
        await conTodas(async (previa, sembrado) => {
          const c = previa.cliente;
          // Una versión nueva sin decir nada del aspecto nace con `{}`.
          const nueva = await c.query<{ id: string; aspecto: unknown }>(
            "insert into version_de_marca (marca_id, nombre_visible) values ($1, 'Sin aspecto') returning id, aspecto",
            [sembrado.hija],
          );
          expect(nueva.rows[0]?.aspecto).toEqual({});
          const id = nueva.rows[0]?.id;
          const poner = (valor: unknown) =>
            c.query("update version_de_marca set aspecto = $2::jsonb where id = $1", [
              id,
              JSON.stringify(valor),
            ]);
          await poner({});
          let probados = 0;
          for (const token of TOKENS_DE_ASPECTO) {
            for (const valor of LISTAS_DE_ASPECTO[token]) {
              await poner({ [token]: valor });
              probados += 1;
            }
          }
          expect(probados).toBe(4 + 3 + 3 + 2 + 3);
          const completo = {
            estilo: "LUDICO",
            superficie: "FRIA",
            esquinas: "RECTA",
            titulos: "SERIF",
            ingreso: "CON_IMAGEN",
          };
          await poner(completo);
          const { rows } = await c.query<{ aspecto: unknown }>(
            "select aspecto from version_de_marca where id = $1",
            [id],
          );
          expect(rows[0]?.aspecto).toEqual(completo);
        });
      });

      it("rechaza toda clave o valor fuera de la lista, con la restricción por nombre", async () => {
        await conTodas(async (previa, sembrado) => {
          const c = previa.cliente;
          const { rows } = await c.query<{ id: string }>(
            "select id from version_de_marca where marca_id = $1 and estado = 'BORRADOR'",
            [sembrado.borrador],
          );
          const id = rows[0]?.id;
          const rechazados: [string, string][] = [
            ["un valor en minúsculas", '{"estilo":"moderno"}'],
            ["un valor con mayúscula inicial", '{"estilo":"Moderno"}'],
            ["un valor con guion medio", '{"estilo":"CLARO-CON-BORDES"}'],
            ["un valor con espacio", '{"estilo":"MODERNO "}'],
            ["un valor vacío", '{"estilo":""}'],
            ["un valor de otra lista", '{"estilo":"NEUTRA"}'],
            ["un valor de otra lista (superficie)", '{"superficie":"RECTA"}'],
            ["un valor de otra lista (esquinas)", '{"esquinas":"SANS"}'],
            ["un valor de otra lista (títulos)", '{"titulos":"CENTRADO"}'],
            ["un valor de otra lista (ingreso)", '{"ingreso":"MODERNO"}'],
            ["una clave ajena", '{"fondo":"NEUTRA"}'],
            ["una clave en mayúsculas", '{"ESTILO":"MODERNO"}'],
            ["una clave del tema", '{"primary":"#112233"}'],
            ["CSS libre", '{"estilo":"red; background: url(x)"}'],
            ["un número", '{"estilo":1}'],
            ["un nulo", '{"estilo":null}'],
            ["un booleano", '{"esquinas":true}'],
            ["una lista", '{"titulos":["SANS"]}'],
            ["un objeto", '{"ingreso":{"a":"CENTRADO"}}'],
            ["una raíz que es lista", '["MODERNO"]'],
            ["una raíz que es texto", '"MODERNO"'],
            ["una raíz que es número", "7"],
            ["una raíz nula (json null)", "null"],
            ["un token bueno y uno malo", '{"estilo":"MODERNO","titulos":"GRANDE"}'],
            ["un token bueno y una clave ajena", '{"estilo":"MODERNO","x":"SANS"}'],
          ];
          for (const [motivo, valor] of rechazados) {
            await expect(
              c.query("update version_de_marca set aspecto = $2::jsonb where id = $1", [id, valor]),
              motivo,
            ).rejects.toMatchObject({
              code: "23514",
              constraint: "version_de_marca_aspecto_ck",
            });
            await expect(
              c.query("insert into version_de_marca (marca_id, aspecto) values ($1, $2::jsonb)", [
                sembrado.hija,
                valor,
              ]),
              `insert: ${motivo}`,
            ).rejects.toMatchObject({
              code: "23514",
              constraint: "version_de_marca_aspecto_ck",
            });
          }
          // SQL NULL no es un aspecto: la columna es NOT NULL.
          await expect(
            codigoDe(c.query("update version_de_marca set aspecto = null where id = $1", [id])),
          ).resolves.toBe("23502");
          // Y lo que se rechazó no dejó nada: el borrador sigue con `{}`.
          const { rows: despues } = await c.query<{ aspecto: unknown }>(
            "select aspecto from version_de_marca where id = $1",
            [id],
          );
          expect(despues[0]?.aspecto).toEqual({});
        });
      });

      it("`aspecto_valido` es `validarAspecto` del dominio: dicen lo mismo de cada caso (la base y el código no se desvían)", async () => {
        await conTodas(async (previa) => {
          const casos: unknown[] = [
            {},
            { estilo: "CLARO_CON_BORDES" },
            { estilo: "MODERNO", superficie: "FRIA", esquinas: "REDONDEADA" },
            { titulos: "SERIF", ingreso: "CON_IMAGEN" },
            { estilo: "moderno" },
            { estilo: "NEUTRA" },
            { superficie: "CALIDA", esquinas: "OVAL" },
            { fondo: "NEUTRA" },
            { estilo: 1 },
            { estilo: null },
            { estilo: ["MODERNO"] },
            { estilo: { a: 1 } },
            { esquinas: true },
            { titulos: "" },
            { ingreso: "CENTRADO ", estilo: "MODERNO" },
            { "": "SANS" },
            { constructor: "SANS" },
            ...TOKENS_DE_ASPECTO.flatMap((t) => [
              ...LISTAS_DE_ASPECTO[t].map((v) => ({ [t]: v })),
              ...LISTAS_DE_ASPECTO[t].map((v) => ({ [t]: v.toLowerCase() })),
            ]),
            ...TOKENS_DE_ASPECTO.flatMap((t) =>
              TOKENS_DE_ASPECTO.filter((o) => o !== t).map((o) => ({
                [t]: LISTAS_DE_ASPECTO[o][0],
              })),
            ),
          ];
          const { rows } = await previa.cliente.query<{ i: number; v: boolean }>(
            `select i - 1 as i, aspecto_valido(t) as v from unnest($1::jsonb[]) with ordinality as x(t, i) order by i`,
            [casos.map((c) => JSON.stringify(c))],
          );
          expect(rows).toHaveLength(casos.length);
          for (const { i, v } of rows) {
            const del = validarAspecto(casos[i] as Record<string, unknown>).ok;
            expect(v, JSON.stringify(casos[i])).toBe(del);
          }
          // Lo que no es un objeto (o es NULL) no es un aspecto, aunque `validarAspecto` ni lo reciba.
          const noObjetos = await previa.cliente.query<{ v: boolean }>(
            `select aspecto_valido(t) as v from unnest(array['[]', '"x"', '1', 'true', 'null']::jsonb[]) as t
             union all select aspecto_valido(null)`,
          );
          expect(noObjetos.rows.every((r) => r.v === false)).toBe(true);
          expect(noObjetos.rows).toHaveLength(6);
        });
      });

      it("una versión confirmada no cambia su aspecto, ni siquiera el dueño de la base (los disparadores de 0007 valen para la columna nueva)", async () => {
        await conTodas(async (previa, sembrado) => {
          await expect(
            previa.cliente.query(
              `update version_de_marca set aspecto = '{"estilo":"MODERNO"}'::jsonb where marca_id = $1 and estado = 'CONFIRMADA'`,
              [sembrado.hija],
            ),
          ).rejects.toMatchObject({
            code: "23514",
            constraint: "version_de_marca_confirmada_inmutable",
          });
        });
      });
    });

    // ===========================================================================================================
    // Lo que lee cada rol de verdad
    // ===========================================================================================================
    describe("lo que lee y escribe cada rol REAL", () => {
      /**
       * Marcas con aspecto: una confirmada y vigente (visible), una programada y un borrador (invisibles para el
       * público y la aplicación), todas con un valor que no se confunde con el de otra.
       */
      async function conAspectos(
        previa: Awaited<ReturnType<typeof baseConMigraciones>>,
        sembrado: Sembrado,
      ) {
        const c = previa.cliente;
        const poner = (marca: string, estado: string, aspecto: Record<string, string>) =>
          c.query(
            `update version_de_marca set aspecto = $3::jsonb where marca_id = $1 and estado = $2`,
            [marca, estado, JSON.stringify(aspecto)],
          );
        // Las confirmadas no se tocan (inmutables): se crean nuevas con el aspecto ya puesto.
        const visible = await crearMarca(c, { padre: sembrado.principal });
        await crearVersionDeMarcaConfirmada(c, visible, {
          nombreVisible: "Visible",
          aspecto: { estilo: "MODERNO", superficie: "FRIA" },
        });
        const futura = await crearMarca(c, { padre: sembrado.principal });
        await crearVersionDeMarcaConfirmada(c, futura, {
          nombreVisible: "Futura",
          desdeSegundos: 3600,
          aspecto: { estilo: "LUDICO", esquinas: "REDONDEADA" },
        });
        const conBorrador = await crearMarca(c, { padre: sembrado.principal });
        await crearBorradorDeMarca(c, conBorrador, {
          nombreVisible: "Borrador",
          aspecto: { titulos: "SERIF", ingreso: "CON_IMAGEN" },
        });
        await poner(sembrado.borrador, "BORRADOR", { superficie: "CALIDA" });
        return { visible, futura, conBorrador };
      }

      it("el rol PÚBLICO lee `aspecto` de las versiones visibles (confirmadas y ya empezadas) y de NINGUNA otra; `select *` y la escritura siguen vedadas", async () => {
        await conTodas(async (previa, sembrado) => {
          await conAspectos(previa, sembrado);
          const esperado = await previa.cliente.query<{ marca_id: string; aspecto: unknown }>(
            `select marca_id, aspecto from version_de_marca
              where estado = 'CONFIRMADA' and vigente_desde <= now() order by marca_id, numero`,
          );
          await comoRol(previa.aparte.base.publico, async (publico) => {
            const r = await publico.query<{ marca_id: string; aspecto: unknown }>(
              "select marca_id, aspecto from version_de_marca order by marca_id, numero",
            );
            expect(r.rows).toEqual(esperado.rows);
            expect(r.rows.length).toBeGreaterThanOrEqual(3);
            // Los valores de la programada y de los borradores no salen por ningún lado.
            const texto = JSON.stringify(r.rows);
            expect(texto).toContain("MODERNO");
            for (const oculto of ["LUDICO", "REDONDEADA", "SERIF", "CON_IMAGEN", "CALIDA"]) {
              expect(texto, oculto).not.toContain(oculto);
            }
            // Siguen vedadas las columnas no públicas y la lectura de todas.
            for (const columna of ["motivo", "estado", "modulos_iniciales", "confirmada_por"]) {
              await expect(
                codigoDe(publico.query(`select ${columna} from version_de_marca`)),
              ).resolves.toBe("42501");
            }
            await expect(codigoDe(publico.query("select * from version_de_marca"))).resolves.toBe(
              "42501",
            );
            // Y no escribe.
            await expect(
              codigoDe(publico.query(`update version_de_marca set aspecto = '{}'::jsonb`)),
            ).resolves.toBe("42501");
            await expect(
              codigoDe(
                publico.query(
                  `insert into version_de_marca (marca_id, aspecto) values ($1, '{}'::jsonb)`,
                  [sembrado.hija],
                ),
              ),
            ).resolves.toBe("42501");
          });
        });
      });

      it("el rol público lee exactamente estas 25 columnas (las 24 de antes más `version_de_marca.aspecto`), solo con SELECT, y ninguna tiene nombre de secreto", async () => {
        await conTodas(async (previa) => {
          const { rows } = await previa.cliente.query<{ t: string; c: string; p: string }>(
            `select table_name as t, column_name as c, privilege_type as p
               from information_schema.column_privileges
              where grantee = 'pedernal_publico' and table_schema = 'public' order by 1, 2, 3`,
          );
          expect([...new Set(rows.map((f) => f.p))]).toEqual(["SELECT"]);
          expect(rows.map((f) => `${f.t}.${f.c}`)).toEqual(COLUMNAS_DEL_ROL_PUBLICO);
          expect(COLUMNAS_DEL_ROL_PUBLICO).toHaveLength(25);
          for (const f of rows) {
            expect(campoConPosibleSecreto({ [f.c]: "" }), `${f.t}.${f.c}`).toBeNull();
          }
          const { rows: otros } = await previa.cliente.query(
            `select 1 from information_schema.table_privileges
              where grantee = 'pedernal_publico' and table_schema = 'public' and privilege_type <> 'SELECT'`,
          );
          expect(otros).toEqual([]);
        });
      });

      it("la APLICACIÓN lee `aspecto` de las versiones vigentes con su contexto, sin él no ve filas, y no escribe", async () => {
        await conTodas(async (previa, sembrado) => {
          const { visible, futura, conBorrador } = await conAspectos(previa, sembrado);
          const mundo = await crearMundoDeMarca(previa.cliente, { marca: sembrado.principal });
          await conAppDe(previa.aparte.base, mundo, async (s) => {
            const r = await s.intentar(
              "select marca_id, aspecto from version_de_marca where aspecto <> '{}'::jsonb",
            );
            expect(r.ok && r.rows).toEqual([
              { marca_id: visible, aspecto: { estilo: "MODERNO", superficie: "FRIA" } },
            ]);
            const ocultas = await s.intentar(
              "select 1 from version_de_marca where marca_id = any($1)",
              [[futura, conBorrador]],
            );
            expect(ocultas.ok && ocultas.rows).toEqual([]);
            for (const texto of [
              `update version_de_marca set aspecto = '{}'::jsonb`,
              `update version_de_marca set tema = '{}'::jsonb`,
            ]) {
              const e = await s.intentar(texto);
              expect(e.ok, texto).toBe(false);
              expect(!e.ok && e.codigo).toBe("42501");
            }
            const i = await s.intentar(
              `insert into version_de_marca (marca_id, aspecto) values ($1, '{}'::jsonb)`,
              [sembrado.hija],
            );
            expect(!i.ok && i.codigo).toBe("42501");
          });
          // Sin contexto firmado la aplicación no ve ninguna fila (falla cerrado), pero no recibe un error.
          const sinContexto = await SesionDePrueba.abrir(previa.aparte.base, "pedernal_app", null);
          try {
            const r = await sinContexto.intentar("select aspecto from version_de_marca");
            expect(r.ok && r.rows).toEqual([]);
          } finally {
            await sinContexto.cerrar();
          }
        });
      });

      it("los demás roles (trabajos, grupo, autenticación, captación) no leen ni escriben `aspecto`", async () => {
        await conTodas(async (previa) => {
          for (const rol of ROLES_SIN_VERSION_DE_MARCA) {
            const s = await SesionDePrueba.abrir(previa.aparte.base, rol, null);
            try {
              for (const texto of [
                "select aspecto from version_de_marca",
                "select * from version_de_marca",
                `update version_de_marca set aspecto = '{}'::jsonb`,
              ]) {
                const r = await s.intentar(texto);
                expect(r.ok, `${rol}: ${texto}`).toBe(false);
                expect(!r.ok && r.codigo, `${rol}: ${texto}`).toBe("42501");
              }
            } finally {
              await s.cerrar();
            }
          }
        });
      });

      it("la PLATAFORMA (un ADMIN firmado) escribe `aspecto` en un borrador y lo lee; el CHECK le rechaza lo inválido; una confirmada no se toca; el soporte no escribe", async () => {
        await conTodas(async (previa, sembrado) => {
          const nueva = await crearMarca(previa.cliente, { padre: sembrado.principal });
          // El ADMIN confirma su transacción: lo escrito queda en la base y se ve desde afuera.
          const admin = await SesionDePrueba.abrir(
            previa.aparte.base,
            "pedernal_plataforma",
            comoPlataforma(),
          );
          try {
            const alta = await admin.intentar(
              `insert into version_de_marca (marca_id, nombre_visible, aspecto)
               values ($1, 'Con aspecto', '{"estilo":"CLASICO","titulos":"SERIF"}'::jsonb) returning id`,
              [nueva],
            );
            expect(alta.ok).toBe(true);
            const id = alta.ok ? (alta.rows[0]?.["id"] as string) : "";
            const cambio = await admin.intentar(
              `update version_de_marca set aspecto = '{"ingreso":"DIVIDIDO"}'::jsonb where id = $1`,
              [id],
            );
            expect(cambio.ok && cambio.filas).toBe(1);
            const leido = await admin.intentar(
              "select aspecto from version_de_marca where id = $1",
              [id],
            );
            expect(leido.ok && leido.rows).toEqual([{ aspecto: { ingreso: "DIVIDIDO" } }]);
            const mala = await admin.intentar(
              `update version_de_marca set aspecto = '{"estilo":"moderno"}'::jsonb where id = $1`,
              [id],
            );
            expect(!mala.ok && mala.codigo).toBe("23514");
            expect(!mala.ok && mala.restriccion).toBe("version_de_marca_aspecto_ck");
            // Una confirmada queda fuera de su alcance (la política solo deja actualizar borradores): 0 filas.
            const confirmada = await admin.intentar(
              `update version_de_marca set aspecto = '{"estilo":"LUDICO"}'::jsonb
                where marca_id = $1 and estado = 'CONFIRMADA'`,
              [sembrado.hija],
            );
            expect(confirmada.ok && confirmada.filas).toBe(0);
            expect((await admin.confirmar()).ok).toBe(true);
          } finally {
            await admin.cerrar();
          }
          const { rows } = await previa.cliente.query<{ aspecto: unknown }>(
            `select aspecto from version_de_marca where marca_id = $1 and estado = 'BORRADOR'`,
            [nueva],
          );
          expect(rows.map((f) => f.aspecto)).toEqual([{ ingreso: "DIVIDIDO" }]);
          const { rows: hija } = await previa.cliente.query<{ aspecto: unknown }>(
            `select aspecto from version_de_marca where marca_id = $1 and estado = 'CONFIRMADA'`,
            [sembrado.hija],
          );
          expect(hija.map((f) => f.aspecto)).toEqual([{}]);

          // El soporte ve la tabla pero no la escribe: ni el alta ni el cambio de un borrador que existe.
          await conPlataformaDe(previa.aparte.base, "SOPORTE", async (s) => {
            const lee = await s.intentar("select aspecto from version_de_marca");
            expect(lee.ok).toBe(true);
            const cambia = await s.intentar(
              `update version_de_marca set aspecto = '{"estilo":"LUDICO"}'::jsonb where marca_id = $1 and estado = 'BORRADOR'`,
              [sembrado.borrador],
            );
            expect(!cambia.ok || cambia.filas === 0).toBe(true);
            const alta = await s.intentar(
              `insert into version_de_marca (marca_id, aspecto) values ($1, '{}'::jsonb)`,
              [sembrado.hija],
            );
            expect(alta.ok).toBe(false);
          });
          const { rows: intacto } = await previa.cliente.query<{ aspecto: unknown }>(
            `select aspecto from version_de_marca where marca_id = $1 and estado = 'BORRADOR'`,
            [sembrado.borrador],
          );
          expect(intacto.map((f) => f.aspecto)).toEqual([{}]);
        });
      });
    });

    // ===========================================================================================================
    // Lo que promete el texto
    // ===========================================================================================================
    describe("el texto de la migración promete lo que hace", () => {
      const leer = async () => {
        const completo = await textoDeLaMigracion();
        // El código sin comentarios de línea: lo que promete la cabecera se comprueba sobre lo que se ejecuta.
        return { completo, codigo: completo.replace(/--.*$/gm, "") };
      };

      it("la cabecera declara lo que es: aditiva, repetible, sin SECURITY DEFINER nuevo, número provisorio, reversión que borra solo la columna", async () => {
        const { completo } = await leer();
        const plano = completo.replace(/\n--\s*/g, " ");
        expect(completo).toMatch(/ADITIVA/);
        expect(completo).toMatch(/REPETIBLE/);
        expect(completo).toMatch(/PROVISORIO/);
        expect(plano).toMatch(/NINGUNA marca cambia de aspecto sin que el dueño lo decida/);
        expect(plano).toMatch(/BORRA la columna/);
        expect(completo).toContain(`reversiones/${await archivoDeLaReversion()}`);
        expect(completo).toMatch(/No agrega NINGUNA función SECURITY DEFINER/);
      });

      it("ejecuta lo declarado y nada más: una función, una columna, y concesiones solo por columna; nada se borra, no hay LOGIN ni contraseñas ni SECURITY DEFINER", async () => {
        const { codigo } = await leer();
        expect(codigo.match(/\bCREATE\b/gi)).toHaveLength(1);
        expect(codigo).toMatch(/CREATE OR REPLACE FUNCTION aspecto_valido\(a jsonb\)/);
        expect(codigo.match(/\bALTER\s+TABLE\b/gi)).toHaveLength(1);
        expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS aspecto jsonb NOT NULL DEFAULT '\{\}'/);
        expect(codigo).toMatch(/CHECK \(aspecto_valido\(aspecto\)\)/);
        expect(codigo.match(/\bGRANT\b/gi)).toHaveLength(3);
        expect(codigo).toMatch(
          /GRANT EXECUTE ON FUNCTION aspecto_valido\(jsonb\) TO pedernal_plataforma;/,
        );
        expect(codigo).toMatch(
          /GRANT SELECT \(aspecto\) ON version_de_marca TO pedernal_publico, pedernal_app;/,
        );
        expect(codigo).toMatch(
          /GRANT INSERT \(aspecto\), UPDATE \(aspecto\) ON version_de_marca TO pedernal_plataforma;/,
        );
        // El único REVOKE cierra la función nueva a PUBLIC.
        expect(codigo.match(/\bREVOKE\b/gi)).toHaveLength(1);
        expect(codigo).toMatch(/REVOKE ALL ON FUNCTION aspecto_valido\(jsonb\) FROM PUBLIC;/);
        expect(codigo).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
        expect(codigo).not.toMatch(/\bINSERT\s+INTO\b/i);
        expect(codigo).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
        expect(codigo).not.toMatch(/\bCREATE\s+(POLICY|ROLE|TRIGGER)\b/i);
        expect(codigo).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
        expect(codigo).not.toMatch(/\bLOGIN\b/i);
        expect(codigo).not.toMatch(/\bPASSWORD\s+'/i);
        expect(codigo).not.toMatch(/postgres(ql)?:\/\//i);
        // La función fija su search_path y no lee ninguna tabla.
        expect(codigo).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
        const cuerpo =
          codigo.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? "";
        expect(cuerpo).not.toBe("");
        // Lo único de lo que lee es del propio valor (`jsonb_each(a)`): ninguna tabla.
        expect([...cuerpo.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/gi)].map((m) => m[1])).toEqual([
          "jsonb_each",
        ]);
      });
    });

    // ===========================================================================================================
    // Reversión
    // ===========================================================================================================
    describe("la reversión (script aparte, borra solo la columna que agregó)", () => {
      const conConfirmacion = (texto: string) =>
        `begin; set local pedernal.confirmar_reversion = 'SI'; ${texto}; commit;`;

      it("sin aspectos cargados deja el catálogo EXACTAMENTE como estaba, no toca los datos, borra la fila del ejecutor, se puede repetir y la migración se vuelve a aplicar", async () => {
        await conPrevias(async (previa, conMia) => {
          await sembrar(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          const datosAntes = await huellaDeDatos(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(catalogoAntes);

          const reversion = await textoDeLaReversion();
          await previa.cliente.query(`begin; ${reversion}; commit;`);

          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
          const { rows: ya } = await previa.cliente.query(
            `select 1 from migracion where nombre like '%${SUFIJO}%'`,
          );
          expect(ya).toEqual([]);

          // Repetirla no falla ni cambia nada.
          await previa.cliente.query(`begin; ${reversion}; commit;`);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);

          // Revertida, la columna no existe, y la migración se puede aplicar otra vez.
          await expect(
            codigoDe(previa.cliente.query("select aspecto from version_de_marca")),
          ).resolves.toBe("42703");
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
        });
      });

      it("con un aspecto cargado se NIEGA a borrarlo sin la confirmación explícita (no cambia nada); con ella, borra solo la columna y lo demás queda igual", async () => {
        await conTodas(async (previa, sembrado) => {
          await crearVersionDeMarcaConfirmada(previa.cliente, sembrado.hija, {
            nombreVisible: "Con aspecto",
            aspecto: { estilo: "MODERNO" },
          });
          const conLaMigracion = await huellaDeCatalogo(previa.cliente);
          const datos = await huellaDeDatos(previa.cliente);
          const reversion = await textoDeLaReversion();

          // Sin confirmar: error de precondición, la transacción se deshace y todo sigue como estaba.
          await previa.cliente.query("begin");
          await expect(previa.cliente.query(reversion)).rejects.toMatchObject({
            code: "55000",
            message: expect.stringMatching(
              /1 versiones de marca con un aspecto cargado/,
            ) as unknown,
          });
          await previa.cliente.query("rollback");
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(conLaMigracion);
          const { rows: quedan } = await previa.cliente.query(
            "select 1 from version_de_marca where aspecto <> '{}'::jsonb",
          );
          expect(quedan).toHaveLength(1);

          // Confirmando: la columna se va, y con ella solo los aspectos.
          await previa.cliente.query(conConfirmacion(reversion));
          expect(await huellaDeDatos(previa.cliente)).toEqual(datos);
          await expect(
            codigoDe(previa.cliente.query("select aspecto from version_de_marca")),
          ).resolves.toBe("42703");
          const { rows: funcion } = await previa.cliente.query(
            "select 1 from pg_proc where proname = 'aspecto_valido'",
          );
          expect(funcion).toEqual([]);
        });
      });

      it("la cabecera dice que es destructiva solo de la columna, que no la aplica el ejecutor, cómo se corre y que avisa al dueño", async () => {
        const texto = await textoDeLaReversion();
        const plano = texto.replace(/\n--\s*/g, " ");
        expect(texto).toMatch(/DESTRUCTIVA en lo único que agregó 0014/);
        expect(plano).toMatch(/AVISAR AL DUEÑO/);
        expect(texto).toMatch(/NO lo aplica el ejecutor de migraciones/);
        expect(texto).toMatch(/BEGIN;/);
        expect(texto).toMatch(/pedernal\.confirmar_reversion/);
        const codigo = texto.replace(/--.*$/gm, "");
        expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
        expect(codigo).not.toMatch(/DELETE FROM public\.(?!migracion)/i);
        expect(codigo).not.toMatch(/\bDROP\s+(TABLE|SCHEMA|ROLE|POLICY|TRIGGER)\b/i);
      });
    });
  },
);
