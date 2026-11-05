import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARCA_NEUTRA } from "../../scripts/ejecutar-preparar-empresa-de-pruebas";

/**
 * El logo de la marca neutra de las pruebas viaja con el despliegue: el archivo al que apunta la ruta tiene que existir y
 * ser un PNG de verdad. Sin él, el ingreso de la empresa de pruebas mostraría una imagen rota.
 */
describe("el logo de la marca neutra", () => {
  it("existe en los archivos estáticos de la app y es un PNG", () => {
    const archivo = readFileSync(
      join(import.meta.dirname, "../../apps/web/public", MARCA_NEUTRA.logo),
    );
    expect([...archivo.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
