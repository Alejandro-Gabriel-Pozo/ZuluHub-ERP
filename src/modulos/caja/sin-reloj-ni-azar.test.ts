import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de caja, sus casos de uso, sus consultas y su persistencia no usan reloj ni aleatoriedad: la hora (`ahora`) entra como dato en el contexto. Los casos de uso corren dentro de
 * la transacción, que el adaptador repite entera ante un conflicto de serialización (ADR-004, G4): lo que se recalcula (arqueo,
 * conciliación, huella del cobro) tiene que dar LO MISMO cada vez, o un reintento no sería el mismo pedido.
 */
const carpetas = ["./", "dominio/", "casos-de-uso/", "consultas/", "persistencia/"].map((c) =>
  fileURLToPath(new URL(c, import.meta.url)),
);
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el código de caja no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining([
        "estados.ts",
        "sesion.ts",
        "arqueo.ts",
        "conciliacion.ts",
        "huella.ts",
      ]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
