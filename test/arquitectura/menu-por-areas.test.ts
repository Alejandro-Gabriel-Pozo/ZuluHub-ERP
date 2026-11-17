import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MAXIMO_DE_DESTINOS_DE_MODULOS } from "../../src/capacidades/experiencia/destinos";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import {
  AREAS_DEL_MENU,
  FILAS_DEL_MENU,
  GRUPOS_DEL_MENU,
  problemasDelMenu,
} from "../../apps/web/ui/navegacion/menu";

/**
 * REGLA (dueño, 12/11/2026, `decisiones-del-dueno-2026-11.md`, fila «Menú por áreas, versión 4», requisito d): el menú sale de UNA tabla
 * declarativa (`apps/web/ui/navegacion/menu.ts`) y ningún componente fija áreas, grupos o pantallas a mano. Esta prueba vigila:
 *  1. la tabla real cumple `problemasDelMenu` (áreas y grupos declarados, claves y rutas únicas, acciones del módulo declarado, solo
 *     Ventas con departamento) y el tope de áreas en la barra es `MAXIMO_DE_DESTINOS_DE_MODULOS`;
 *  2. cada fila apunta a un texto que existe en el vocabulario y a una ruta que existe en `apps/web/app` (una fila sin ruta daría un 404
 *     a quien tenga el permiso);
 *  3. fuera de la tabla y de `servidor/modulos.ts` (que la lee), ningún archivo de `apps/web` nombra la tabla, sus áreas o sus grupos, ni
 *     las claves de texto de las áreas (`navegacion.area.*`); y la lista vieja `ENTRADAS_DE_MODULOS` ya no existe.
 * Previene: dos listas de destinos que se desalinean (una pantalla en la barra sin su fila de permiso) y un componente que decide por su
 * cuenta qué área lleva cada pantalla, que es lo que el dueño pidió que no pase. Cada forma de violación está inyectada abajo.
 */

const RAIZ = join(import.meta.dirname, "../..");
const APP_WEB = join(RAIZ, "apps/web");
/** Los únicos archivos que pueden nombrar la tabla: ella misma y quien la lee en el servidor. */
const PERMITIDOS = new Set(["apps/web/ui/navegacion/menu.ts", "apps/web/servidor/modulos.ts"]);
const NOMBRES_DE_LA_TABLA = new Set([
  "FILAS_DEL_MENU",
  "AREAS_DEL_MENU",
  "GRUPOS_DEL_MENU",
  "ENTRADAS_DE_MODULOS",
  "EntradaDeModulo",
]);
const PREFIJO_DE_AREA = "navegacion.area.";

/** Cada lugar de un archivo que nombra la tabla o un texto de área: identificadores y cadenas (los comentarios no cuentan). */
export function usosDeLaTabla(nombre: string, texto: string): string[] {
  const fuente = ts.createSourceFile(
    nombre,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const usos: string[] = [];
  const mirar = (nodo: ts.Node): void => {
    if (ts.isIdentifier(nodo) && NOMBRES_DE_LA_TABLA.has(nodo.text)) usos.push(nodo.text);
    if ((ts.isStringLiteralLike(nodo) || ts.isJsxText(nodo)) && nodo.text.includes(PREFIJO_DE_AREA))
      usos.push(nodo.text);
    if (ts.isTemplateExpression(nodo) && nodo.head.text.includes(PREFIJO_DE_AREA))
      usos.push(nodo.head.text);
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return usos;
}

const esDePrueba = (ruta: string): boolean => /\.test\.tsx?$/.test(ruta);

function archivosDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(carpeta, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) salida.push(...archivosDe(ruta));
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

describe("menú por áreas: la tabla real", () => {
  it("cumple las reglas y el tope de áreas es el de la barra", () => {
    expect(
      problemasDelMenu(
        FILAS_DEL_MENU,
        AREAS_DEL_MENU,
        GRUPOS_DEL_MENU,
        MAXIMO_DE_DESTINOS_DE_MODULOS,
      ),
    ).toEqual([]);
  });

  it("cada fila usa un texto que existe en el vocabulario, y cada área y grupo también", () => {
    const claves = new Set(Object.keys(CATALOGO_DE_TEXTOS));
    for (const f of FILAS_DEL_MENU) expect(claves.has(f.etiqueta), f.clave).toBe(true);
    for (const a of AREAS_DEL_MENU) expect(claves.has(a.etiqueta), a.clave).toBe(true);
    for (const g of GRUPOS_DEL_MENU)
      if (g.etiqueta !== null) expect(claves.has(g.etiqueta), g.clave).toBe(true);
  });

  it("cada pantalla apunta a una ruta que existe", () => {
    for (const f of FILAS_DEL_MENU) {
      if (f.tipo !== "pantalla") continue;
      const pagina = join(APP_WEB, "app/s/app/(operacion)", f.href, "page.tsx");
      expect(existsSync(pagina), `${f.clave}: ${f.href}`).toBe(true);
    }
  });

  it("hay exactamente una acción, «Cerrar sesión», en el área fija", () => {
    const acciones = FILAS_DEL_MENU.filter((f) => f.tipo === "accion");
    expect(acciones.map((f) => [f.clave, f.area])).toEqual([["cerrar-sesion", "cuenta"]]);
    expect(AREAS_DEL_MENU.find((a) => a.clave === "cuenta")?.fija).toBe(true);
  });
});

describe("menú por áreas: nadie fija áreas o grupos a mano", () => {
  it("fuera de la tabla y de quien la lee, ningún archivo de apps/web la nombra", () => {
    const sospechosos = archivosDe(APP_WEB)
      .map((ruta) => relative(RAIZ, ruta))
      .filter((ruta) => !esDePrueba(ruta) && !PERMITIDOS.has(ruta))
      .flatMap((ruta) =>
        usosDeLaTabla(ruta, readFileSync(join(RAIZ, ruta), "utf8")).map((uso) => `${ruta}: ${uso}`),
      );
    expect(sospechosos).toEqual([]);
  });

  describe("el analizador ve cada forma (violaciones inyectadas)", () => {
    const casos: readonly (readonly [string, string, readonly string[]])[] = [
      [
        "importar la tabla",
        'import { FILAS_DEL_MENU } from "x"; export const a = FILAS_DEL_MENU;',
        ["FILAS_DEL_MENU", "FILAS_DEL_MENU"],
      ],
      ["las áreas", "const a = AREAS_DEL_MENU.map(f);", ["AREAS_DEL_MENU"]],
      ["los grupos", "const g = GRUPOS_DEL_MENU[0];", ["GRUPOS_DEL_MENU"]],
      ["la lista vieja", "export const ENTRADAS_DE_MODULOS = [];", ["ENTRADAS_DE_MODULOS"]],
      ["el tipo viejo", "type E = EntradaDeModulo;", ["EntradaDeModulo"]],
      [
        "una clave de área en una cadena",
        'const k = "navegacion.area.ventas";',
        ["navegacion.area.ventas"],
      ],
      [
        "una clave de área en una plantilla con parte fija",
        "const k = `navegacion.area.${x}`;",
        ["navegacion.area."],
      ],
      [
        "una clave de área en una plantilla sin variables",
        "const k = `navegacion.area.ventas`;",
        ["navegacion.area.ventas"],
      ],
      [
        "una clave de área en JSX",
        'const j = <a title="navegacion.area.ventas">navegacion.area.catalogo</a>;',
        ["navegacion.area.ventas", "navegacion.area.catalogo"],
      ],
    ];
    it.each(casos)("%s", (_nombre, texto, esperado) => {
      expect(usosDeLaTabla("x.tsx", texto)).toEqual(esperado);
    });

    it("un comentario o un texto que no es una clave de área no cuenta", () => {
      expect(
        usosDeLaTabla(
          "x.ts",
          '// FILAS_DEL_MENU y navegacion.area.ventas\nconst a = "navegacion.cuenta";',
        ),
      ).toEqual([]);
    });
  });
});
