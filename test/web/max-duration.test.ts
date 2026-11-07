import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIEMPO_LIMITE_DE_LOGIN_EN_MS } from "../../src/adaptadores/arca/constantes";
import { OPCIONES_DE_FACTURACION } from "../../src/modulos/fiscal/publico";

/**
 * El tope de duración (`maxDuration`, en segundos) de las rutas que hablan con ARCA o generan el PDF. Next lo lee como un LITERAL
 * exportado de la página o de la ruta (para las Server Actions, de la página que las aloja), así que se comprueba sobre el código fuente.
 *
 * Previene: la función de Vercel cortada a mitad de una autorización de ARCA, con la serie reservada y el comprobante en vuelo
 * (`despacho-inmediato.ts`). Sin `maxDuration` el tope lo pone el plan, que no se pudo verificar (`PRIMER-DESPLIEGUE.md`, punto 11).
 */

const RAIZ = join(
  import.meta.dirname,
  "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes",
);
const maxDuration = (ruta: string): number | null => {
  const m = /^export const maxDuration = (\d+);$/m.exec(readFileSync(join(RAIZ, ruta), "utf8"));
  return m === null ? null : Number(m[1]);
};

const t = OPCIONES_DE_FACTURACION.tiempos;
/** El peor caso de UN despacho: login de WSAA, último autorizado, autorizar y la consulta de validación posterior. */
const PEOR_CASO_EN_MS =
  TIEMPO_LIMITE_DE_LOGIN_EN_MS + t.ultimoAutorizadoEnMs + t.autorizarEnMs + t.consultarEnMs;
const MARGEN_EN_MS = 15_000;

describe("maxDuration de las rutas de facturación", () => {
  it("emitir y anular (alojan las acciones que esperan a ARCA) cubren el peor caso de un despacho más un margen", () => {
    expect(PEOR_CASO_EN_MS).toBe(75_000);
    for (const ruta of ["emitir/page.tsx", "[id]/anular/page.tsx"]) {
      const segundos = maxDuration(ruta);
      expect(segundos, ruta).not.toBeNull();
      expect((segundos as number) * 1000, ruta).toBeGreaterThanOrEqual(
        PEOR_CASO_EN_MS + MARGEN_EN_MS,
      );
    }
  });

  it("emitir y anular declaran el mismo tope (un solo cálculo)", () => {
    expect(maxDuration("emitir/page.tsx")).toBe(maxDuration("[id]/anular/page.tsx"));
  });

  it("el PDF no llama a ARCA: tope corto (10 s), muy por encima de lo medido (p99 106 ms, frío ~270 ms)", () => {
    expect(maxDuration("[id]/pdf/route.ts")).toBe(10);
  });
});
