import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../../test/utilidades/reloj-y-azar";

/**
 * El dominio fiscal no usa reloj ni aleatoriedad: la hora (`ahora`), los ids y lo que informa el
 * servicio de emisión entran siempre como datos. Así cada decisión se repite igual (idempotencia),
 * se prueba sin simular el tiempo y el reintento serializable de la transacción da lo mismo. Lo
 * mismo vale para el puerto de emisión (el contrato).
 */
const carpetas = [
  fileURLToPath(new URL(".", import.meta.url)),
  fileURLToPath(new URL("../casos-de-uso/", import.meta.url)),
];
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el dominio fiscal no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos de dominio a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining([
        "alicuota.ts",
        "comprobante.ts",
        "comprobante-emitido.ts",
        "datos-fiscales.ts",
        "emisor.ts",
        "identificadores.ts",
        "numeracion.ts",
        "plan-de-comprobantes.ts",
        "punto-de-venta.ts",
        "resolucion-de-emisor.ts",
        "vigencia.ts",
        "emision-electronica.ts",
      ]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
