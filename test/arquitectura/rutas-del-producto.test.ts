import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { caminoDeRutaPropia } from "../../src/capacidades/experiencia/ruta-propia";

/**
 * TODAS las rutas del producto: se recorren las carpetas de páginas de la app web (`apps`, `web`, `app`) y cada página o ruta tiene que pasar. Previene que una regla nueva de
 * caracteres deje sin ingreso, sin retorno o en la neutra a una pantalla real (caso que ninguna prueba de vectores ve).
 */
function rutasDelProducto(): string[] {
  const raiz = join(process.cwd(), "apps", "web", "app");
  const rutas: string[] = [];
  const recorrer = (carpeta: string): void => {
    for (const e of readdirSync(carpeta, { withFileTypes: true })) {
      const completa = join(carpeta, e.name);
      if (e.isDirectory()) recorrer(completa);
      else if (/^(page|route)\.(ts|tsx)$/.test(e.name)) rutas.push(relative(raiz, carpeta));
    }
  };
  recorrer(raiz);
  return rutas.map((r) => {
    const segmentos = r
      .split(sep)
      .filter((s) => s !== "" && !/^\(.*\)$/.test(s))
      // Una carpeta `[id]` es un identificador (UUID) y `[...ruta]` varios tramos; `[ambiente]` un nombre.
      .map((s) =>
        s.startsWith("[...")
          ? "uno/dos"
          : s.startsWith("[")
            ? "3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a90"
            : s,
      );
    // `/s/<superficie>` es el prefijo interno: la dirección pública es lo que sigue.
    const publicos = segmentos[0] === "s" ? segmentos.slice(2) : segmentos;
    return `/${publicos.join("/")}`;
  });
}

describe("caminoDeRutaPropia: todas las rutas reales del producto pasan", () => {
  const rutas = rutasDelProducto();
  it("hay rutas que recorrer (la prueba no puede quedar vacía)", () => {
    expect(rutas.length).toBeGreaterThan(15);
    expect(rutas).toContain("/ingreso");
    expect(rutas).toContain("/facturacion/comprobantes/emitir");
    expect(rutas).toContain("/api/salud");
  });
  it.each(rutas)("%s", (ruta) => {
    expect(caminoDeRutaPropia(ruta)).not.toBeNull();
  });
});
