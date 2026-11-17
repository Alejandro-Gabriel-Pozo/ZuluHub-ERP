import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { duplicadosPorArchivo, marcasInvalidas } from "./fuente-unica-apoyo";

/**
 * REGLA (CLAUDE.md «Una regla, un lugar»; regla 4 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`): el largo máximo de un dato
 * vive una vez, en su constante `LARGO_MAXIMO_…`; dominio, esquemas y pantallas la importan. Un tope escrito dos veces es deuda con
 * presupuesto por archivo, `arquitectura/deuda/validacion-de-datos.json` (clave `duplicados`), que coincide EXACTO con el código y solo
 * puede bajar (contra la base lo comprueba `arquitectura/deuda/campos-sin-dato.cjs` en el CI), y con su entrada en el registro de deuda
 * (`validacion-de-datos--*`). Qué se cuenta y qué no: ver `fuente-unica-apoyo.ts`.
 * Previene: la auditoría de columnas halló 37 reglas escritas en dos lugares y 6 que ya no coincidían (caso real).
 * Cada forma está inyectada en `fuente-unica-evasiones.test.ts` y en `reglas.test.ts`.
 */

const RAIZ = join(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const { PRESUPUESTOS } = require("../../arquitectura/deuda/campos-sin-dato.cjs") as {
  PRESUPUESTOS: { archivo: string }[];
};
const ARCHIVO_DEL_PRESUPUESTO =
  PRESUPUESTOS.find((p) => p.archivo.endsWith("validacion-de-datos.json"))?.archivo ?? "falta";

function codigo(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const carpeta of ["src", "apps"]) {
    for (const r of readdirSync(join(RAIZ, carpeta), { recursive: true, encoding: "utf8" })) {
      if (r.split("/").some((p) => p === "node_modules" || p === ".next")) continue;
      if (!/\.(tsx?|mts|cts)$/.test(r) || /\.test\.(tsx?|mts|cts)$/.test(r) || r.endsWith(".d.ts"))
        continue;
      mapa.set(`${carpeta}/${r}`, readFileSync(join(RAIZ, carpeta, r), "utf8"));
    }
  }
  return mapa;
}

describe("fuente única: el código real", () => {
  const presupuesto = JSON.parse(
    readFileSync(join(RAIZ, ARCHIVO_DEL_PRESUPUESTO), "utf8"),
  ) as Record<string, { prohibidos: number; duplicados: number }>;
  const archivos = codigo();
  const reales = duplicadosPorArchivo(archivos);

  it("mira src y apps (no pasa en vacío)", () => {
    expect([...archivos.keys()].some((r) => r.startsWith("src/"))).toBe(true);
    expect([...archivos.keys()].some((r) => r.startsWith("apps/"))).toBe(true);
    expect(reales.size).toBeGreaterThan(0);
  });

  it("los topes escritos dos veces coinciden EXACTO con el presupuesto (no hay uno nuevo sin registrar ni uno viejo sin sacar)", () => {
    const declarados = new Map(
      Object.entries(presupuesto)
        .filter(([, c]) => c.duplicados > 0)
        .map(([r, c]) => [r, c.duplicados]),
    );
    expect(Object.fromEntries(reales)).toEqual(Object.fromEntries(declarados));
  });

  it("cada archivo con tope duplicado está en el registro de deuda, con motivo, aprobación y vencimiento", () => {
    const libro = JSON.parse(
      readFileSync(join(RAIZ, "arquitectura/deuda/registro.json"), "utf8"),
    ) as ({ id: string; archivos: string[] } & Record<string, unknown>)[];
    const entradas = libro.filter((e) => e.id.startsWith("validacion-de-datos--"));
    for (const e of entradas) {
      expect(e["motivo"], e.id).toBeTruthy();
      expect(e["aprobadoPor"], e.id).toBeTruthy();
      expect(e["vence"], e.id).toBeTruthy();
    }
    const cubiertos = new Set(entradas.flatMap((e) => e.archivos));
    for (const ruta of reales.keys()) expect(cubiertos.has(ruta), ruta).toBe(true);
  });

  it("ninguna marca de «valor ajeno» del código real está sin motivo", () => {
    expect(marcasInvalidas(archivos)).toEqual([]);
  });

  it("la regla está escrita en CLAUDE.md (quitarla hace fallar la prueba)", () => {
    const claude = readFileSync(join(RAIZ, "CLAUDE.md"), "utf8");
    expect(claude).toContain("fuente-unica.test.ts");
    expect(claude).toContain("Un mismo límite o cálculo no se escribe en dos lugares");
  });
});
