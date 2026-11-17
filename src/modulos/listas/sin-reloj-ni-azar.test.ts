import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de las listas del sistema no usa reloj ni aleatoriedad: corre dentro de la transacción de plataforma, que el adaptador
 * repite entera ante un conflicto de serialización (ADR-004, G4); repetirlo tiene que dar lo mismo. El instante de cada cambio lo
 * pone la base (`fijar_version_y_fecha`) y quién lo hizo, la auditoría de plataforma.
 */
const carpeta = fileURLToPath(new URL("dominio/", import.meta.url));
const fuentes = readdirSync(carpeta)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => `${carpeta}${f}`);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el dominio de las listas del sistema no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres.sort()).toEqual(["valor-de-lista.ts"]);
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
