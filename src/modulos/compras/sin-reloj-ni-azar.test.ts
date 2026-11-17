import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El código de compras no usa reloj ni aleatoriedad: la hora (`ahora`) entra como dato en el contexto y los ids los manda la aplicación. Los
 * casos de uso corren dentro de la transacción, que el adaptador repite entera ante un conflicto de serialización o un deadlock (ADR-004,
 * E9 §3.5): lo que se recalcula (las cuentas de la línea y del comprobante, la huella) tiene que dar LO MISMO cada vez, o el reintento no sería el
 * mismo pedido. Revisa las carpetas que existan: el módulo crece por tramos (T5 solo trae `dominio/`).
 */
const carpetas = ["./", "dominio/", "casos-de-uso/", "consultas/", "persistencia/"]
  .map((c) => fileURLToPath(new URL(c, import.meta.url)))
  .filter((carpeta) => existsSync(carpeta));
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el código de compras no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining([
        "calcular-linea.ts",
        "comprobante.ts",
        "huella.ts",
        "saldos.ts",
        "niveles.ts",
        "decimal.ts",
      ]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
