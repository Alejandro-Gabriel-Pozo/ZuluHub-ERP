import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * El facturador funciona solo (spec H7 facturación §B.0 y §B.9): `fiscal` no conoce ventas. Ningún
 * archivo de `fiscal` nombra «ticket» ni «propina» fuera del catálogo de orígenes
 * (`comprobante-emitido.ts`), que son nombres opacos que fiscal no interpreta. Previene que el
 * facturador dependa de un módulo que todavía no existe y que la lógica de un origen se cuele en el
 * dominio fiscal. (La importación de módulos de negocio la impide la regla de arquitectura
 * `fiscal-sin-negocio-ajeno`.)
 *
 * Alcance: se revisa el texto, porque ni «venta» (punto de venta) ni «caja» sirven de señal; los
 * tipos de origen sí son específicos.
 */
const PROHIBIDAS = /ticket|propina/i;
const EXCEPCION = "comprobante-emitido.ts";

export function nombraAVentas(fuente: string): boolean {
  return PROHIBIDAS.test(fuente);
}

const carpetas = ["../dominio/", "../casos-de-uso/", "../persistencia/"].map((c) =>
  fileURLToPath(new URL(c, import.meta.url)),
);
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== EXCEPCION)
    .map((f) => `${carpeta}${f}`),
);

describe("fiscal no nombra ventas", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes.length).toBeGreaterThan(10);
    expect(fuentes.some((f) => f.endsWith("comprobante.ts"))).toBe(true);
  });

  it.each(fuentes)("%s no nombra tickets ni propinas", (ruta) => {
    expect(nombraAVentas(readFileSync(ruta, "utf8"))).toBe(false);
  });

  it("el detector sí ve la violación inyectada (en cualquier capitalización)", () => {
    expect(nombraAVentas("export const x = 'EJEMPLAR_DE_TICKET';")).toBe(true);
    expect(nombraAVentas("// cobra la propina")).toBe(true);
    expect(nombraAVentas("if (origen.tipo === 'PROPINA_DE_TICKET') {}")).toBe(true);
    expect(nombraAVentas("// punto de venta y caja")).toBe(false);
  });

  it("la única excepción es el catálogo de orígenes, y ahí sí figuran", () => {
    const catalogo = readFileSync(`${carpetas[0] ?? ""}${EXCEPCION}`, "utf8");
    expect(nombraAVentas(catalogo)).toBe(true);
  });
});
