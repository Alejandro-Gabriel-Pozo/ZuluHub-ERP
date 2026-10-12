import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/** El tiempo es un valor puro: el instante entra como parámetro, jamás se lee el reloj. */
const carpeta = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(carpeta).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("la primitiva de tiempo no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual(
      expect.arrayContaining(["fecha-civil.ts", "hora-del-dia.ts", "fecha-de-negocio.ts"]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (nombre) => {
    expect(usosProhibidos(readFileSync(`${carpeta}${nombre}`, "utf8"))).toEqual([]);
  });
});
