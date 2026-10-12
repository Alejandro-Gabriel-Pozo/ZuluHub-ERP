import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de plataforma no usa reloj ni aleatoriedad (H5 §B): la hora (`ahora`) y los bytes de azar
 * (la referencia de error) entran como datos, así cada decisión se repite igual cuando el adaptador
 * reintenta la transacción serializable y se prueba sin simular el tiempo.
 */
const raiz = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(raiz, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

describe("el dominio de plataforma no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual(
      expect.arrayContaining(["admin.ts", "alta.ts", "referencia.ts", "soporte/explicar.ts"]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (archivo) => {
    expect(usosProhibidos(readFileSync(`${raiz}${archivo}`, "utf8"))).toEqual([]);
  });
});
