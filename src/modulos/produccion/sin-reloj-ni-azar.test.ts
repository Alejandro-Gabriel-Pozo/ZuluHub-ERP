import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/** El código de producción no usa reloj ni aleatoriedad: la transacción se repite entera ante un conflicto y tiene que dar lo mismo (como stock). */
const carpetas = ["./", "dominio/", "casos-de-uso/", "consultas/", "persistencia/"]
  .map((c) => fileURLToPath(new URL(c, import.meta.url)))
  .filter((carpeta) => existsSync(carpeta));
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);

describe("el código de producción no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes.length).toBeGreaterThanOrEqual(4);
  });
  for (const ruta of fuentes) {
    it(ruta.slice(ruta.lastIndexOf("/") + 1), () => {
      expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
    });
  }
});
