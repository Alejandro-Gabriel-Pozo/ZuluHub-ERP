import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMINOS } from "../../src/capacidades/datos/caminos";
import { REGISTRO_DE_DATOS } from "../../src/capacidades/datos/registro";
import { problemasDeLosCaminos } from "./caminos-declarados-apoyo";

/**
 * Regla 5.b como verificador (D1): los caminos declarados de las pantallas con formulario cuadran con el registro de datos, el catálogo de acciones y el código.
 * Las violaciones inyectadas, una por cada chequeo, están en `caminos-declarados-evasiones.test.ts`.
 */
const RAIZ = join(import.meta.dirname, "../..");

describe("caminos declarados (regla 5.b)", () => {
  it("los caminos del repositorio no tienen problemas", () => {
    expect(
      problemasDeLosCaminos(CAMINOS, REGISTRO_DE_DATOS, (ruta) => existsSync(join(RAIZ, ruta))),
    ).toEqual([]);
  });

  it("hay al menos un camino declarado (un registro vacío no verifica nada)", () => {
    expect(Object.keys(CAMINOS).length).toBeGreaterThan(0);
  });
});
