import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../test/utilidades/reloj-y-azar";

/**
 * P11: las capacidades (catálogo de módulos, guard y matriz de permisos) son funciones puras de sus
 * entradas: ni reloj ni aleatoriedad. El guard corre dentro de la transacción de cada caso de uso,
 * que el adaptador repite entera ante un conflicto de serialización, y tiene que dar siempre lo mismo.
 * El detector es el de `test/utilidades/reloj-y-azar.ts` (con su propia prueba en el dominio de identidad).
 */
const raiz = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(raiz, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

describe("las capacidades no usan reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual(
      expect.arrayContaining([
        "modulos/activos.ts",
        "modulos/catalogo.ts",
        "permisos/empresa.ts",
        "permisos/guard.ts",
        "permisos/plataforma.ts",
        "permisos/roles.ts",
        "planes/derechos.ts",
        "planes/diferencia.ts",
        "planes/niveles.ts",
        "planes/valores.ts",
        "planes/version-de-plan.ts",
        "planes/vigencia.ts",
      ]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (archivo) => {
    expect(usosProhibidos(readFileSync(`${raiz}${archivo}`, "utf8"))).toEqual([]);
  });
});
