import { describe, expect, it } from "vitest";
import { PREFIJO_PROHIBIDO, VARIABLES_PROHIBIDAS } from "../../src/composicion/entorno";
import {
  NOMBRE_DE_LA_CADENA_DE_DUENO,
  PREFIJO_PROHIBIDO_EN_VERCEL,
  VARIABLES_PROHIBIDAS_EN_VERCEL,
  sobraEnVercel,
} from "../../src/adaptadores/vercel/plan-de-variables";

/**
 * `migrar-base --vercel` borra de Vercel lo que la aplicación PROHÍBE. La lista vive dos veces (la
 * aplicación no se puede importar desde un script que Node carga sin compilar), y esta prueba falla si
 * se separan: una variable nueva prohibida en `entorno.ts` que el comando no borrara dejaría a la
 * aplicación sin arrancar en el destino.
 */
describe("lo prohibido en Vercel coincide con lo que la aplicación prohíbe", () => {
  it("la misma lista y el mismo prefijo", () => {
    expect([...VARIABLES_PROHIBIDAS_EN_VERCEL].sort()).toEqual([...VARIABLES_PROHIBIDAS].sort());
    expect(PREFIJO_PROHIBIDO_EN_VERCEL).toBe(PREFIJO_PROHIBIDO);
  });

  it("todo lo que la aplicación prohíbe, el comando lo borra; y además borra la cadena de dueño", () => {
    for (const nombre of VARIABLES_PROHIBIDAS) expect(sobraEnVercel(nombre)).toBe(true);
    expect(sobraEnVercel(`${PREFIJO_PROHIBIDO}URL`)).toBe(true);
    expect(sobraEnVercel(NOMBRE_DE_LA_CADENA_DE_DUENO)).toBe(true);
  });
});
