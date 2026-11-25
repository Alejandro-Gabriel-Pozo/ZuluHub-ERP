import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_PRESENTACIONES } from "../../src/capacidades/pantallas/ficha-de-presentaciones";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de la pantalla «Cómo se compra» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente, y la acción de cada botón existe en un módulo. Previene:
 * un botón con una acción que no existe, un texto sin fuente o un archivo que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Cómo se compra»", () => {
  const ficha = FICHA_DE_PRESENTACIONES;

  it("sus archivos existen", () => {
    for (const archivo of ficha.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("todo texto de un botón, rótulo o estado está declarado con usos y fuente, y cada clave existe", () => {
    const claves = [
      ...ficha.botones.map((b) => b.texto),
      ...Object.values(ficha.rotulos),
      ...Object.values(ficha.estados),
    ];
    const declaradas: string[] = Object.keys(ficha.textos);
    for (const clave of claves) expect(declaradas).toContain(clave);
    for (const [clave, t] of Object.entries(ficha.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("los textos nuevos dicen lo aprobado y la acción de cada botón existe en un módulo", () => {
    expect(CATALOGO_DE_TEXTOS["catalogo.presentacion.nombre"].porDefecto).toBe("Presentación");
    expect(CATALOGO_DE_TEXTOS["catalogo.presentacion.cantidad"].porDefecto).toBe(
      "Cantidad en la unidad base",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.presentacion.peso_variable"].porDefecto).toBe(
      "De peso variable",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.presentacion.peso_aproximado"].porDefecto).toBe(
      "Peso aproximado",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.presentacion.agregar"].porDefecto).toBe(
      "Agregar presentación",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.presentacion.vacia"].porDefecto).toBe("Sin presentaciones");
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const b of ficha.botones) expect(todas).toContain(b.hace.envia);
  });

  it("la lista de rutas es la de las tres páginas", () => {
    expect(ficha.rutas).toEqual([
      "/catalogo/productos/[id]/compra",
      "/catalogo/productos/[id]/compra/nueva",
      "/catalogo/productos/[id]/compra/[presentacionId]",
    ]);
  });
});
