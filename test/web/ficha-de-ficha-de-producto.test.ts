import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_FICHA_DE_PRODUCTO } from "../../src/capacidades/pantallas/ficha-de-ficha-de-producto";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de la pantalla «Ficha del producto» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente, la casilla del tilde tiene su rótulo y la
 * acción de su botón existe en un módulo. Previene: un botón con una acción que no existe, un texto sin fuente o un archivo que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Ficha del producto»", () => {
  const ficha = FICHA_DE_FICHA_DE_PRODUCTO;

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

  it("la casilla del tilde tiene el texto aprobado «Se controla el stock» y la acción del botón existe en un módulo", () => {
    expect(CATALOGO_DE_TEXTOS["catalogo.dato.se_controla_el_stock"].porDefecto).toBe(
      "Se controla el stock",
    );
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const b of ficha.botones) expect(todas).toContain(b.hace.envia);
  });
});
