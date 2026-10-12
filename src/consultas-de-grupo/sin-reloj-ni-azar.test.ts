import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usosProhibidos } from "../../test/utilidades/reloj-y-azar";

/**
 * Las consultas de grupo no usan reloj ni aleatoriedad. La hora (`ahora`) entra como dato en el
 * contexto y el instante del registro de acceso lo fija la base. La consulta corre dentro de la
 * transacción, que el adaptador repite entera ante un conflicto (ADR-004, G4): repetirla tiene que dar
 * lo mismo.
 */
const raiz = fileURLToPath(new URL(".", import.meta.url));
const fuentes = readdirSync(raiz)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

describe("las consultas de grupo no usan reloj ni aleatoriedad", () => {
  it("encuentra los archivos a revisar", () => {
    expect(fuentes).toEqual(
      expect.arrayContaining(["listar-empresas-del-grupo.ts", "vista-de-grupo.ts"]),
    );
  });

  it.each(fuentes)("%s no usa reloj ni aleatoriedad", (archivo) => {
    expect(usosProhibidos(readFileSync(`${raiz}${archivo}`, "utf8"))).toEqual([]);
  });
});
