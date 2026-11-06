import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contarProhibidosEnCodigo, contarProhibidosEnSql } from "./lista-de-permitidos-apoyo";

/**
 * REGLA (CLAUDE.md «Todo nace cerrado»; regla 4 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`): la validación de un dato declara
 * lo que se PERMITE (conjunto, largo, forma), nunca lo que se prohíbe. Una validación por lista de prohibidos es deuda con presupuesto por
 * archivo, `arquitectura/deuda/validacion-de-datos.json` (clave `prohibidos`), que coincide EXACTO con el código y solo puede bajar
 * (contra la base lo comprueba `arquitectura/deuda/campos-sin-dato.cjs` en el CI), y con su entrada en el registro de deuda
 * (`validacion-de-datos--*`, con motivo, aprobadoPor y vencimiento). Se mira todo el código de `src/`, `apps/` y `scripts/` (menos
 * pruebas, que usan esas expresiones como ejemplos) y las migraciones SQL.
 * Previene: `/\p{Cc}/u` en `datos-fiscales.ts` solo rechazaba controles y dejaba pasar invisibles y `<>` (caso real).
 * Cada forma está inyectada en `lista-de-permitidos-evasiones.test.ts` y en `reglas.test.ts`.
 */

const RAIZ = join(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const { PRESUPUESTOS, problemasDeForma } =
  require("../../arquitectura/deuda/campos-sin-dato.cjs") as {
    PRESUPUESTOS: { archivo: string }[];
    problemasDeForma: (valor: unknown, presupuesto: unknown) => string[];
  };
const PRESUPUESTO = PRESUPUESTOS.find((p) => p.archivo.endsWith("validacion-de-datos.json"));
const PREFIJO_DE_DEUDA = "validacion-de-datos--";
/**
 * Alcance (orquestador, 2026-11-06; el dueño puede revertirlo): la regla mira el código que VALIDA un dato que escribe una persona o que
 * se guarda en una columna. Estos archivos leen un formato de MÁQUINAS definido por un tercero, no un dato escrito por una persona: no
 * entran a la deuda. Hallazgo: validación de datos que vienen de terceros (cookies de la librería de ingreso y respuestas de ARCA);
 * revisar con lista de permitidos del formato en una sesión posterior. Cada exención tiene que seguir teniendo lo que exime.
 */
const FORMATOS_DE_TERCEROS: Readonly<Record<string, string>> = {
  "src/capacidades/experiencia/set-cookie.ts":
    "parsea el encabezado Set-Cookie que genera la librería de ingreso",
  "src/adaptadores/arca/saneamiento.ts": "limpia el texto con que responde ARCA",
};
const EXTENSIONES = ["ts", "tsx", "js", "mjs", "cjs"];

function archivos(carpeta: string, extensiones: string[]): string[] {
  return readdirSync(join(RAIZ, carpeta), { recursive: true, encoding: "utf8" })
    .filter((r) => !r.split("/").some((p) => p === "node_modules" || p === ".next"))
    .filter((r) => extensiones.includes(r.split(".").pop() ?? ""))
    .map((r) => `${carpeta}/${r}`);
}

function prohibidosReales(): Map<string, number> {
  const mapa = new Map<string, number>();
  const codigo = ["src", "apps", "scripts"]
    .flatMap((c) => archivos(c, EXTENSIONES))
    .filter((r) => !/\.test\.[a-z]+$/.test(r) && !r.includes("/test/"));
  for (const ruta of codigo) {
    const n = contarProhibidosEnCodigo(ruta, readFileSync(join(RAIZ, ruta), "utf8"));
    if (n > 0 && !(ruta in FORMATOS_DE_TERCEROS)) mapa.set(ruta, n);
  }
  for (const ruta of archivos("migraciones", ["sql"])) {
    const n = contarProhibidosEnSql(readFileSync(join(RAIZ, ruta), "utf8"));
    if (n > 0) mapa.set(ruta, n);
  }
  return mapa;
}

type Entrada = { id: string; archivos: string[] } & Record<string, unknown>;

describe("lista de permitidos: el código real", () => {
  const presupuesto = JSON.parse(
    readFileSync(join(RAIZ, PRESUPUESTO?.archivo ?? "falta"), "utf8"),
  ) as Record<string, { prohibidos: number; duplicados: number }>;
  const reales = prohibidosReales();

  it("mira código y migraciones (no pasa en vacío)", () => {
    expect(PRESUPUESTO).toBeDefined();
    expect([...reales.keys()].some((r) => r.startsWith("src/"))).toBe(true);
    expect([...reales.keys()].some((r) => r.startsWith("migraciones/"))).toBe(true);
  });

  it("cada exención por formato de terceros sigue eximiendo algo (si no, se saca)", () => {
    for (const ruta of Object.keys(FORMATOS_DE_TERCEROS)) {
      const n = contarProhibidosEnCodigo(ruta, readFileSync(join(RAIZ, ruta), "utf8"));
      expect(n, ruta).toBeGreaterThan(0);
      expect(presupuesto[ruta], ruta).toBeUndefined();
    }
  });

  it("el presupuesto tiene buena forma", () => {
    expect(problemasDeForma(presupuesto, PRESUPUESTO)).toEqual([]);
  });

  it("las validaciones por lista de prohibidos coinciden EXACTO con el presupuesto (no hay una nueva sin registrar ni una vieja sin sacar)", () => {
    const declarados = new Map(
      Object.entries(presupuesto)
        .filter(([, c]) => c.prohibidos > 0)
        .map(([r, c]) => [r, c.prohibidos]),
    );
    expect(Object.fromEntries(reales)).toEqual(Object.fromEntries(declarados));
  });

  it("cada archivo con deuda de prohibidos está en el registro de deuda, con motivo, aprobación y vencimiento", () => {
    const libro = JSON.parse(
      readFileSync(join(RAIZ, "arquitectura/deuda/registro.json"), "utf8"),
    ) as Entrada[];
    const entradas = libro.filter((e) => e.id.startsWith(PREFIJO_DE_DEUDA));
    for (const e of entradas) {
      expect(e["motivo"], e.id).toBeTruthy();
      expect(e["aprobadoPor"], e.id).toBeTruthy();
      expect(e["vence"], e.id).toBeTruthy();
    }
    const cubiertos = new Set(entradas.flatMap((e) => e.archivos));
    const conDeuda = Object.entries(presupuesto)
      .filter(([, c]) => c.prohibidos > 0)
      .map(([r]) => r);
    for (const ruta of conDeuda) expect(cubiertos.has(ruta), ruta).toBe(true);
  });

  it("la regla está escrita en CLAUDE.md (quitarla hace fallar la prueba)", () => {
    const claude = readFileSync(join(RAIZ, "CLAUDE.md"), "utf8");
    expect(claude).toContain("declara lo que se PERMITE");
    expect(claude).toContain("lista-de-permitidos.test.ts");
  });
});
