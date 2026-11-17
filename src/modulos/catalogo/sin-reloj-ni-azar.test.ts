import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio, los casos de uso y las consultas del catálogo no usan reloj ni aleatoriedad: la hora (`ahora`) entra como dato en el
 * contexto y los ids los manda la aplicación. Los casos de uso corren dentro de la transacción, que el adaptador repite entera ante un
 * conflicto de serialización (ADR-004): repetirlos tiene que dar lo mismo.
 */
const carpetas = ["dominio/", "casos-de-uso/", "consultas/"].map((c) =>
  fileURLToPath(new URL(c, import.meta.url)),
);
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);

describe("el catálogo no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes.length).toBeGreaterThan(5);
  });
  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
