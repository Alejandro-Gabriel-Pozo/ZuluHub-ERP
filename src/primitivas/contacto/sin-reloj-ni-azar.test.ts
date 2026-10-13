import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/** Los datos de contacto son valores puros: la misma entrada da siempre la misma salida. */
const carpeta = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(carpeta).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("la primitiva de contacto no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual(expect.arrayContaining(["email.ts"]));
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (nombre) => {
    expect(usosProhibidos(readFileSync(`${carpeta}${nombre}`, "utf8"))).toEqual([]);
  });
});
