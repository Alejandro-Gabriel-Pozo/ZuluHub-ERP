import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_LA_MESA } from "../../src/capacidades/pantallas/ficha-de-la-mesa";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Mesa» (SAL-B) no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente del dueño, su acceso y las acciones de sus botones están declarados en algún módulo y todo
 * texto del catálogo que cita el modelo de la mesa figura en la ficha. Previene: un botón con una acción que no existe, un texto sin fuente o una ruta que se mueve sin que la ficha lo note.
 */
const ACCIONES = new Set(
  Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)),
);

describe("ficha de la pantalla «Mesa»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_LA_MESA.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto que usa está declarado con usos y fuente del dueño, y cada clave existe en el catálogo", () => {
    const claves = [FICHA_DE_LA_MESA.titulo, ...FICHA_DE_LA_MESA.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_LA_MESA.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_LA_MESA.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("su acceso y las acciones de sus botones existen en el catálogo de módulos", () => {
    expect(ACCIONES.has(FICHA_DE_LA_MESA.acceso)).toBe(true);
    expect(Object.keys(CATALOGO_DE_MODULOS.salon.acciones)).toContain(FICHA_DE_LA_MESA.acceso);
    for (const b of FICHA_DE_LA_MESA.botones) {
      if ("envia" in b.hace) expect(ACCIONES.has(b.hace.envia), b.id).toBe(true);
    }
  });

  it("todo texto del catálogo que cita el modelo de la mesa está en la ficha", () => {
    const codigo = readFileSync("apps/web/ui/plantillas/salon/modelo-de-la-mesa.ts", "utf8");
    const citados = [
      ...new Set(
        [...codigo.matchAll(/"((?:salon|comandas|ventas|vidriera)\.[a-z_.]+)"/g)].map((m) => m[1]),
      ),
    ];
    expect(citados.length).toBeGreaterThan(10);
    for (const clave of citados)
      expect(Object.keys(FICHA_DE_LA_MESA.textos), String(clave)).toContain(clave);
  });

  it("la ruta es la de las rutas del salón", () => {
    expect(FICHA_DE_LA_MESA.rutas).toEqual(["/salon/cuenta/[mesaId]"]);
  });
});
