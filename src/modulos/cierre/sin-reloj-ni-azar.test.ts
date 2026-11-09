import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de cierre, el punto de enganche, sus casos de uso y sus consultas no usan reloj ni aleatoriedad: la hora (`ahora`) entra
 * como dato en el contexto. Los casos de uso corren dentro de la transacción, que el adaptador repite entera ante un conflicto de
 * serialización (ADR-004, G4), y los aportes de los módulos tienen que recalcular LO MISMO para que la huella del día sea estable.
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

describe("el cierre del día no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining(["aporte-al-cierre.ts", "jornada.ts", "cierre.ts", "explicacion.ts"]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
