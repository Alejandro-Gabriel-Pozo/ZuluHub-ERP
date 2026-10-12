import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../../test/utilidades/reloj-y-azar";

/**
 * El dominio de empresas, sus casos de uso y sus consultas no usan reloj ni aleatoriedad. La hora
 * (`ahora`) entra como dato en el contexto, y el id de la sucursal lo genera la base. Los casos de
 * uso corren dentro de la transacción, que el adaptador repite entera ante un conflicto de
 * serialización (ADR-004, G4): repetirlos tiene que dar lo mismo.
 */
const carpetas = ["dominio/", "casos-de-uso/", "consultas/"].map((c) =>
  fileURLToPath(new URL(c, import.meta.url)),
);
const fuentes = carpetas.flatMap((carpeta) =>
  readdirSync(carpeta)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${carpeta}${f}`),
);
const nombres = fuentes.map((ruta) => ruta.slice(ruta.lastIndexOf("/") + 1));

describe("el dominio de empresas no usa reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(nombres).toEqual(
      expect.arrayContaining([
        "sucursal.ts",
        "empresa.ts",
        "crear-sucursal.ts",
        "editar-sucursal.ts",
        "desactivar-sucursal.ts",
        "reactivar-sucursal.ts",
        "listar-sucursales.ts",
        "ficha-de-sucursal.ts",
      ]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (ruta) => {
    expect(usosProhibidos(readFileSync(ruta, "utf8"))).toEqual([]);
  });
});
