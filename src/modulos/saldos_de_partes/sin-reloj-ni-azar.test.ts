import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de saldos, sus casos de uso y su persistencia no usan reloj ni aleatoriedad: la hora (`ahora`, `hechoEn`) entra como dato. Los casos
 * de uso corren dentro de la transacción, que el adaptador repite entera ante un conflicto de serialización o un interbloqueo (ADR-004, G4): lo
 * que se recalcula (la huella, el reparto, el orden de las imputaciones) tiene que dar LO MISMO cada vez, o un reintento no sería el mismo pedido.
 */
const carpetas = ["./", "dominio/", "casos-de-uso/", "persistencia/"].map((c) =>
  fileURLToPath(new URL(c, import.meta.url)),
);
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el código de saldos_de_partes no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining([
        "publico.ts",
        "asiento.ts",
        "distribucion.ts",
        "imputacion.ts",
        "registrar-asiento.ts",
        "imputar.ts",
        "anular-asiento.ts",
        "repositorio-de-asientos.ts",
      ]),
    );
  });

  it.each(fuentes.map((ruta, i) => [nombres[i] as string, ruta] as const))(
    "%s",
    (_nombre, ruta) => {
      expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
    },
  );
});
