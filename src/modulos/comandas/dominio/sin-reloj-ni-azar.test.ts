import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../../test/utilidades/reloj-y-azar";

/**
 * El dominio no usa reloj ni aleatoriedad: la hora entra como dato y los ids los manda la aplicación. Los casos de uso corren dentro de una
 * transacción que se repite entera ante un conflicto de serialización: lo que se recalcula (reparto, papel, huellas) tiene que dar LO MISMO cada vez.
 */
const carpeta = fileURLToPath(new URL("./", import.meta.url));
const fuentes = readdirSync(carpeta).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("el dominio no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes.length).toBeGreaterThan(0);
  });
  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (f) => {
    expect(usosProhibidos(readFileSync(`${carpeta}${f}`, "utf8"))).toEqual([]);
  });
});
