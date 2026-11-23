import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/** El libro es puro: el instante y la fecha de negocio entran como texto; jamás se lee el reloj ni se genera azar. */
const carpeta = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(carpeta).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("la primitiva de libro no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual(
      expect.arrayContaining(["huella.ts", "clave.ts", "espejo.ts", "asiento.ts", "publico.ts"]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (nombre) => {
    expect(usosProhibidos(readFileSync(`${carpeta}${nombre}`, "utf8"))).toEqual([]);
  });

  it("la prueba detecta la violación inyectada", () => {
    expect(usosProhibidos("const a = Math.random();").length).toBeGreaterThan(0);
    expect(usosProhibidos("const b = new Date();").length).toBeGreaterThan(0);
  });
});
