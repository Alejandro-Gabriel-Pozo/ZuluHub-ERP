import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de marcas no usa reloj ni aleatoriedad (marcas y planes, §E.1 M1): la hora (`ahora`) entra
 * como dato. Así cada decisión se repite igual cuando el adaptador reintenta la transacción entera ante
 * un conflicto de serialización, y se prueba sin simular el tiempo. El detector es el de
 * `test/utilidades/reloj-y-azar.ts`.
 */
const carpeta = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(carpeta)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

describe("el dominio de marcas no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos de dominio a revisar", () => {
    expect(fuentes).toEqual([
      "ciclo-de-dominio.ts",
      "definicion.ts",
      "host.ts",
      "jerarquia.ts",
      "tema.ts",
      "version.ts",
      "vigencia.ts",
    ]);
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (archivo) => {
    expect(usosProhibidos(readFileSync(`${carpeta}${archivo}`, "utf8"))).toEqual([]);
  });
});
