import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import {
  CLAVE_DE_TEXTO_DE_LA_CLASE,
  CLAVE_DE_TEXTO_DEL_MOTIVO,
} from "../../apps/web/ui/plantillas/stock/movimientos/modelo-de-movimientos";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_EXISTENCIAS } from "../../src/capacidades/pantallas/ficha-de-existencias";
import { FICHA_DE_MOVIMIENTOS } from "../../src/capacidades/pantallas/ficha-de-movimientos";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { CLASES_DE_MOVIMIENTO } from "../../src/modulos/stock/publico";

/**
 * Las fichas de «Existencias» y «Movimientos» de stock no se desfasan de la realidad: sus archivos existen, sus textos están en el catálogo con sus usos y su fuente, el acceso es el de la fila del menú
 * y todo texto de stock que citan las páginas y los modelos está declarado en la ficha. Previene: un botón o un texto que nadie aprobó, y una ruta que se mueve sin que la ficha lo note.
 */
const FICHAS = [
  { nombre: "Existencias", ficha: FICHA_DE_EXISTENCIAS, pagina: "existencias" },
  { nombre: "Movimientos", ficha: FICHA_DE_MOVIMIENTOS, pagina: "movimientos" },
] as const;

describe.each(FICHAS)("ficha de la pantalla «$nombre» de stock", ({ ficha, pagina }) => {
  it("sus archivos existen", () => {
    for (const archivo of ficha.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("es solo lectura: no declara botones y su ruta es la de su página", () => {
    expect(ficha.botones).toEqual([]);
    expect(ficha.rutas).toEqual([`/stock/${pagina}`]);
  });

  it("todo texto está declarado con usos y fuente, y cada clave existe con su fuente en el catálogo cuando es nueva", () => {
    expect(Object.keys(ficha.textos)).toContain(ficha.titulo);
    for (const [clave, t] of Object.entries(ficha.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs|arquitectura\/decisiones/);
    }
  });

  it("todo texto de stock que citan la página y el modelo está en la ficha", () => {
    const codigo = ficha.archivos
      .filter((a) => /page\.tsx$|modelo-de-[a-z]+\.ts$|Pantalla/.test(a))
      .map((a) => readFileSync(a, "utf8"))
      .join("\n");
    const citadas = [
      ...new Set([...codigo.matchAll(/"(stock\.(?:[a-z_]+\.)+[a-z_]+)"/g)].map((m) => m[1] ?? "")),
    ];
    expect(citadas.length).toBeGreaterThan(2);
    for (const clave of citadas) expect(Object.keys(ficha.textos), clave).toContain(clave);
  });

  it("el acceso existe en el módulo stock y es el de la fila del menú", () => {
    expect(Object.keys(CATALOGO_DE_MODULOS.stock.acciones)).toContain(ficha.acceso);
    const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "stock");
    expect(fila).toMatchObject({ accion: ficha.acceso });
  });
});

describe("«Movimientos» rotula todas las clases y solo los motivos con texto aprobado", () => {
  it("cada clase del libro tiene su rótulo y cada rótulo es una clase del libro", () => {
    expect(Object.keys(CLAVE_DE_TEXTO_DE_LA_CLASE).sort()).toEqual(
      [...CLASES_DE_MOVIMIENTO].sort(),
    );
  });

  it("cada texto de clase y de motivo que usa el modelo está declarado en la ficha", () => {
    const declaradas = Object.keys(FICHA_DE_MOVIMIENTOS.textos);
    for (const clave of [
      ...Object.values(CLAVE_DE_TEXTO_DE_LA_CLASE),
      ...Object.values(CLAVE_DE_TEXTO_DEL_MOTIVO),
    ]) {
      expect(declaradas, clave).toContain(clave);
    }
  });
});
