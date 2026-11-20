import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { FICHA_DE_MESAS } from "../../src/capacidades/pantallas/ficha-de-mesas";

/**
 * La ficha de «Mesas» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo, sus acciones están declaradas en el módulo `salon` y la fila del menú coincide
 * (acceso y rótulo). Previene: un botón con una acción que no existe, un texto sin fuente o una ruta que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Mesas»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_MESAS.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto del catálogo que usa está declarado con usos y fuente, y cada clave existe", () => {
    const claves = [FICHA_DE_MESAS.titulo, ...FICHA_DE_MESAS.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_MESAS.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_MESAS.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("sus acciones existen en el módulo salon y el acceso es el de la fila del menú", () => {
    const acciones = Object.keys(CATALOGO_DE_MODULOS.salon.acciones);
    expect(acciones).toContain(FICHA_DE_MESAS.acceso);
    for (const b of FICHA_DE_MESAS.botones) {
      if ("envia" in b.hace) expect(acciones).toContain(b.hace.envia);
    }
    const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "mesas");
    expect(fila).toMatchObject({
      accion: FICHA_DE_MESAS.acceso,
      etiqueta: FICHA_DE_MESAS.titulo,
      href: FICHA_DE_MESAS.rutas[0],
      modulo: "salon",
    });
  });
});
