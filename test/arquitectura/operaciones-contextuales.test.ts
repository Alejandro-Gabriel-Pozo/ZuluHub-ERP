import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTEXTOS } from "../../src/capacidades/integracion/contextos";
import { documentoDeIntegracion } from "../../src/capacidades/integracion/documento";
import { OPERACIONES } from "../../src/capacidades/integracion/operaciones";
import { problemasDeIntegracion } from "../../src/capacidades/integracion/problemas";
import {
  CLAVES_DE_UNA_OPERACION,
  type OperacionContextual,
} from "../../src/capacidades/integracion/tipos";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { importacionesDe, resolverImportacion } from "./archivos-centrales.test";

/**
 * REGLA (escalabilidad X-1, 18/11/2026): el registro de operaciones contextuales (`src/capacidades/integracion/`) está bien armado y
 * nadie lo salta. Falla si: (1) `problemasDeIntegracion` encuentra algo en los registros reales; (2) el documento commiteado
 * `arquitectura/integracion/operaciones-contextuales.md` difiere del generado (se regenera con `npm run integracion:documento`);
 * (3) un archivo de `apps/web`, fuera de `servidor/integracion.ts`, importa `OPERACIONES` o `CONTEXTOS` (la decisión de qué se ofrece
 * es una sola); (4) falta la prueba de un par (módulo del contexto, módulo de la operación) distintos; (5) una operación declara una
 * clave que no es de la lista fija (un «campo», un «panel», un «destino»: se decide a propósito).
 * Previene: que un módulo se integre editando pantallas ajenas, o con una operación que apunta a algo que no existe. Cada forma está
 * inyectada abajo.
 *
 * Cómo se prueba cada par cuando exista (`test/recorrido/integracion-<módulo del contexto>-<módulo de la operación>.recorrido.ts`):
 * con `armarMundoDelRecorrido(base, { modulos: [los dos y sus requiere], perillas })`, tres pasadas: módulo de la operación ACTIVO
 * (se ofrece, abre su pantalla con el contexto y vuelve), INACTIVO (la pantalla de origen se ve igual que sin él) y EN SOLO LECTURA.
 * Si la operación escribe dinero o stock, además concurrencia (dos a la vez) e idempotencia (la misma dos veces) de su caso de uso,
 * contra Postgres real.
 *
 * Límite que NO ve: que la pantalla que dice entregar un contexto lo entregue de verdad (solo comprueba que su archivo nombre la clave).
 */
const RAIZ = join(import.meta.dirname, "../..");
const ARCHIVO_DE_LA_REGLA = "apps/web/servidor/integracion.ts";
const RUTA_DEL_DOCUMENTO = "arquitectura/integracion/operaciones-contextuales.md";
const REGISTROS = /^src\/capacidades\/integracion\/(contextos|operaciones)$/;

function archivosDe(carpeta: string): string[] {
  return readdirSync(join(RAIZ, carpeta), { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name === ".next"
      ? []
      : e.isDirectory()
        ? archivosDe(`${carpeta}/${e.name}`)
        : [`${carpeta}/${e.name}`],
  );
}

/** Las rutas de `apps/web/app` como las ve la persona: sin `s/<superficie>` ni grupos `(x)`; `[id]` queda como patrón. */
export function rutasDeLaApp(archivos: readonly string[]): string[] {
  return archivos
    .filter((a) => a.endsWith("/page.tsx"))
    .map((a) => a.slice("apps/web/app/".length, -"/page.tsx".length).split("/"))
    .map((s) => (s[0] === "s" ? s.slice(2) : s).filter((x) => !/^\(.*\)$/.test(x)))
    .map((s) => `/${s.join("/")}`);
}

/** Los archivos de `apps/web` (fuera del permitido) que importan los registros. */
export function saltanElRegistro(archivos: readonly { ruta: string; texto: string }[]): string[] {
  return archivos
    .filter((a) => a.ruta !== ARCHIVO_DE_LA_REGLA)
    .filter((a) =>
      importacionesDe(a.ruta, a.texto).some((i) => REGISTROS.test(resolverImportacion(a.ruta, i))),
    )
    .map((a) => a.ruta);
}

/** Las pruebas de par que faltan (una por cada par con módulos distintos). */
export function paresSinPrueba(
  contextos: Readonly<Record<string, { modulo: string }>>,
  operaciones: readonly OperacionContextual<string>[],
  existe: (ruta: string) => boolean,
): string[] {
  const pares = new Set(
    operaciones.flatMap((o) => {
      const dueno = contextos[o.contexto]?.modulo;
      return dueno !== undefined && dueno !== o.modulo ? [`${dueno}-${o.modulo}`] : [];
    }),
  );
  return [...pares]
    .map((p) => `test/recorrido/integracion-${p}.recorrido.ts`)
    .filter((r) => !existe(r));
}

export const CLAVES_FIJAS = [
  "id",
  "modulo",
  "contexto",
  "accion",
  "perilla",
  "etiqueta",
  "orden",
  "seAbreEn",
  "alTerminar",
];
export const clavesDeMas = (claves: readonly string[]): string[] =>
  claves.filter((c) => !CLAVES_FIJAS.includes(c));

describe("operaciones contextuales: registros reales", () => {
  const archivos = archivosDe("apps/web/app");
  it("1. sin problemas", () => {
    expect(
      problemasDeIntegracion({
        contextos: CONTEXTOS,
        operaciones: OPERACIONES,
        catalogo: CATALOGO_DE_MODULOS,
        perillas: CATALOGO_DE_PERILLAS,
        textos: new Set(Object.keys(CATALOGO_DE_TEXTOS)),
        rutasDeLaApp: rutasDeLaApp(archivos),
        leerArchivo: (r) =>
          existsSync(join(RAIZ, r)) ? readFileSync(join(RAIZ, r), "utf8") : null,
      }),
    ).toEqual([]);
  });
  it("2. el documento commiteado es el generado", () => {
    expect(readFileSync(join(RAIZ, RUTA_DEL_DOCUMENTO), "utf8")).toBe(
      documentoDeIntegracion(CONTEXTOS, OPERACIONES),
    );
  });
  // Tope propio (estabilidad bajo carga, 23/11/2026): lee y analiza todo `apps/web`; 0,6 a 1 s medido solo y 5,09 s en el CI (push a main 36713cf8, job «Pruebas (con Postgres real) (3)»), que vencía los 5 s por defecto.
  it("3. nadie fuera de servidor/integracion.ts importa los registros", { timeout: 30_000 }, () => {
    const web = archivosDe("apps/web").filter((a) => /\.(ts|tsx)$/.test(a));
    expect(
      saltanElRegistro(
        web.map((ruta) => ({ ruta, texto: readFileSync(join(RAIZ, ruta), "utf8") })),
      ),
    ).toEqual([]);
  });
  it("4. cada par tiene su prueba de recorrido", () => {
    expect(paresSinPrueba(CONTEXTOS, OPERACIONES, (r) => existsSync(join(RAIZ, r)))).toEqual([]);
  });
  it("5. las claves de una operación son las fijas", () => {
    expect([...CLAVES_DE_UNA_OPERACION].toSorted()).toEqual([...CLAVES_FIJAS].toSorted());
  });
});

describe("operaciones contextuales: violaciones inyectadas", () => {
  const op = (modulo: string, contexto: string) =>
    ({ modulo, contexto }) as unknown as OperacionContextual<string>;
  it("3. un archivo que importa los registros", () => {
    const mal = {
      ruta: "apps/web/app/x/page.tsx",
      texto: 'import { OPERACIONES } from "../../../../src/capacidades/integracion/operaciones";',
    };
    const bien = { ruta: ARCHIVO_DE_LA_REGLA, texto: mal.texto };
    expect(saltanElRegistro([mal, bien])).toEqual([mal.ruta]);
    expect(
      saltanElRegistro([
        {
          ruta: "apps/web/a.ts",
          texto: 'import { CONTEXTOS } from "../../src/capacidades/integracion/contextos";',
        },
      ]),
    ).toEqual(["apps/web/a.ts"]);
  });
  it("4. un par con módulos distintos sin prueba; mismo módulo no exige nada", () => {
    const contextos = { "ventas.cuenta": { modulo: "ventas" } };
    expect(paresSinPrueba(contextos, [op("caja", "ventas.cuenta")], () => false)).toEqual([
      "test/recorrido/integracion-ventas-caja.recorrido.ts",
    ]);
    expect(paresSinPrueba(contextos, [op("caja", "ventas.cuenta")], () => true)).toEqual([]);
    expect(paresSinPrueba(contextos, [op("ventas", "ventas.cuenta")], () => false)).toEqual([]);
  });
  it("5. una clave de más (campo, panel o destino)", () => {
    expect(clavesDeMas([...CLAVES_FIJAS, "campo"])).toEqual(["campo"]);
  });
  it("2. un documento distinto del generado", () => {
    expect(
      documentoDeIntegracion(
        { "a.b": { modulo: "ventas", proposito: "p", loEntregan: [] } as never },
        [],
      ),
    ).not.toBe(documentoDeIntegracion({}, []));
  });
  it("rutas: sin superficie ni grupos", () => {
    expect(
      rutasDeLaApp([
        "apps/web/app/s/app/(operacion)/caja/[id]/page.tsx",
        "apps/web/app/layout.tsx",
      ]),
    ).toEqual(["/caja/[id]"]);
  });
});
