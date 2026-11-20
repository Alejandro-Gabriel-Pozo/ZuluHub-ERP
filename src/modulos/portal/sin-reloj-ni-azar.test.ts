import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio del portal no usa reloj ni aleatoriedad: corre dentro de la transacción de la empresa, que el adaptador repite entera ante un conflicto de serialización
 * (ADR-004, G4); repetirlo tiene que dar lo mismo. El código del portal lo da un puerto de azar de la composición y el instante de cada cambio, la base.
 */
const carpeta = fileURLToPath(new URL("dominio/", import.meta.url));
const fuentes = readdirSync(carpeta)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => `${carpeta}${f}`);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el dominio del portal no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres.sort()).toEqual(["portal-publicado.ts", "portal.ts"]);
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
