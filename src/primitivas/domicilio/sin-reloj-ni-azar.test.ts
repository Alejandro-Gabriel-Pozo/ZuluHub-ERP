import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/** El domicilio es un valor puro: sin reloj ni aleatoriedad. */
const carpeta = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(carpeta).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("el domicilio no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual(expect.arrayContaining(["domicilio.ts", "provincias.ts"]));
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (nombre) => {
    expect(usosProhibidos(readFileSync(`${carpeta}${nombre}`, "utf8"))).toEqual([]);
  });
});
