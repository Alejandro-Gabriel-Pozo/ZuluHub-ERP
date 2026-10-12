import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio del módulo de planes no usa reloj ni aleatoriedad: la hora (`ahora`) entra como dato y el
 * número de cada decisión lo da la base. Las decisiones corren dentro de la transacción, que el
 * adaptador repite entera ante un conflicto de serialización (ADR-004, G4): repetirlas tiene que
 * dar lo mismo.
 */
const carpeta = fileURLToPath(new URL("dominio/", import.meta.url));
const fuentes = readdirSync(carpeta)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => `${carpeta}${f}`);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el dominio de planes no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres.sort()).toEqual(["activacion.ts", "ajuste.ts", "asignacion.ts"]);
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
