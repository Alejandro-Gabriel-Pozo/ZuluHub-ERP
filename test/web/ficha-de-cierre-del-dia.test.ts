import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_CIERRE_DEL_DIA } from "../../src/capacidades/pantallas/ficha-de-cierre-del-dia";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Cierre del día» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente y las acciones de sus botones existen en un módulo.
 * Previene: un botón con una acción que no existe, un texto sin fuente o un archivo que se mueve sin que la ficha lo note.
 */
describe("ficha de las pantallas «Cierre del día»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_CIERRE_DEL_DIA.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto de un botón o de un estado está declarado con usos y fuente, y cada clave existe", () => {
    const claves = [
      ...FICHA_DE_CIERRE_DEL_DIA.botones.map((b) => b.texto),
      ...Object.values(FICHA_DE_CIERRE_DEL_DIA.estados),
    ];
    for (const clave of claves)
      expect(Object.keys(FICHA_DE_CIERRE_DEL_DIA.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_CIERRE_DEL_DIA.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("cada texto declarado se usa de verdad en el catálogo o en una pantalla (ninguno de más)", () => {
    const usados = new Set<string>([
      ...FICHA_DE_CIERRE_DEL_DIA.botones.map((b) => b.texto),
      ...Object.values(FICHA_DE_CIERRE_DEL_DIA.estados),
    ]);
    const sueltos = Object.keys(FICHA_DE_CIERRE_DEL_DIA.textos).filter((c) => !usados.has(c));
    // Los textos que no son de un botón ni de un estado (títulos, campos, líneas) los dibuja una pantalla: tienen que citarse en un archivo de la ficha.
    const codigo = FICHA_DE_CIERRE_DEL_DIA.archivos.map((a) => readFileSync(a, "utf8")).join("\n");
    for (const clave of sueltos) {
      const citada = codigo.includes(`"${clave}"`);
      expect(citada, clave).toBe(true);
    }
  });

  it("las acciones de sus botones existen en el módulo que las declara", () => {
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const b of FICHA_DE_CIERRE_DEL_DIA.botones) {
      if (typeof b.hace === "object" && "envia" in b.hace) expect(todas).toContain(b.hace.envia);
    }
  });
});
