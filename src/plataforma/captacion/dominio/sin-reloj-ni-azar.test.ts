import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de captación no usa reloj ni aleatoriedad (alta por solicitud §3.1): la hora (`ahora`, el
 * `emitido` firmado) entra como dato y las claves de los contadores se calculan afuera. Así cada
 * decisión se repite igual cuando el adaptador reintenta la transacción serializable, y se prueba sin
 * simular el tiempo.
 */
const raiz = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(raiz, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

describe("el dominio de captación no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual([
      "atribucion.ts",
      "auditoria.ts",
      "bot.ts",
      "catalogos.ts",
      "envio.ts",
      "estados.ts",
      "formulario.ts",
      "limites.ts",
      "retencion.ts",
    ]);
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (archivo) => {
    expect(usosProhibidos(readFileSync(`${raiz}${archivo}`, "utf8"))).toEqual([]);
  });
});
