import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * REGLA (escalabilidad, E-1, 18/11/2026): los permisos de la persona se leen en UN solo lugar. El identificador `permisosDelActor` (como
 * código, no en comentarios ni cadenas) aparece en `apps/web/servidor/**` solo en `permisos-de-la-persona.ts`, que define el `cache` una
 * vez. Previene: que una pantalla lea los permisos dos veces por pedido (dos transacciones) por llamar a `permisosDelActor` por su
 * cuenta en vez de usar `permisosDeLaPersona`. La forma del archivo `modulos.ts` y de sus partes dedicadas la vigila la regla general
 * `archivos-centrales.test.ts`. Violación inyectada abajo.
 */

const RAIZ = join(import.meta.dirname, "../..");
const RUTA_DE_PERMISOS = "apps/web/servidor/permisos-de-la-persona.ts";

/** Cada uso del identificador `permisosDelActor` como código (los comentarios y las cadenas no cuentan). */
export function lecturasDePermisos(nombre: string, texto: string): string[] {
  const usos: string[] = [];
  const mirar = (nodo: ts.Node): void => {
    if (ts.isIdentifier(nodo) && nodo.text === "permisosDelActor") usos.push(nodo.text);
    ts.forEachChild(nodo, mirar);
  };
  mirar(ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return usos;
}

function archivosDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) salida.push(...archivosDe(ruta));
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

describe("una sola lectura de permisos", () => {
  it("permisosDelActor solo se llama en permisos-de-la-persona.ts", () => {
    const lecturas = archivosDe(join(RAIZ, "apps/web/servidor"))
      .map((ruta) => relative(RAIZ, ruta))
      .filter((ruta) => ruta !== RUTA_DE_PERMISOS)
      .flatMap((ruta) =>
        lecturasDePermisos(ruta, readFileSync(join(RAIZ, ruta), "utf8")).map(
          (u) => `${ruta}: ${u}`,
        ),
      );
    expect(lecturas).toEqual([]);
    expect(
      lecturasDePermisos(RUTA_DE_PERMISOS, readFileSync(join(RAIZ, RUTA_DE_PERMISOS), "utf8")),
    ).toHaveLength(1);
  });

  it("una segunda lectura en otro archivo falla; un comentario o una cadena no cuentan", () => {
    expect(
      lecturasDePermisos(
        "ofertas-de-x.ts",
        "const p = await web.consultasDeEmpresas().permisosDelActor(contexto);",
      ),
    ).toEqual(["permisosDelActor"]);
    expect(
      lecturasDePermisos("x.ts", "// permisosDelActor\nconst a = 'permisosDelActor';"),
    ).toEqual([]);
  });
});
