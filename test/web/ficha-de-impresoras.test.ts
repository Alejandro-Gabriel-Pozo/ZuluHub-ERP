import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { FICHA_DE_IMPRESORAS } from "../../src/capacidades/pantallas/ficha-de-impresoras";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Impresoras» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con sus usos y su fuente (la decisión que los aceptó), sus acciones están declaradas en el módulo
 * `comandas`, la fila del menú coincide (acceso y rótulo) y todo texto del catálogo que cita el modelo está declarado en la ficha. Previene: un botón con una acción que no existe, un texto sin fuente o una ruta que se mueve
 * sin que la ficha lo note.
 */
describe("ficha de la pantalla «Impresoras»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_IMPRESORAS.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto que usa está declarado con usos y fuente, y cada clave existe", () => {
    const claves = [FICHA_DE_IMPRESORAS.titulo, ...FICHA_DE_IMPRESORAS.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_IMPRESORAS.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_IMPRESORAS.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/^el orquestador/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("los textos de la pantalla declaran sus usos y la decisión que los aceptó en el catálogo", () => {
    for (const clave of Object.keys(FICHA_DE_IMPRESORAS.textos)) {
      const definicion = CATALOGO_DE_TEXTOS[clave as keyof typeof CATALOGO_DE_TEXTOS] as {
        usos?: unknown;
        fuente?: unknown;
      };
      expect(definicion.usos, clave).toBeDefined();
      if (clave.startsWith("comandas."))
        expect(definicion.fuente, clave).toEqual({ decision: "DEC-0715" });
    }
  });

  it("todo texto del catálogo que citan el modelo y los textos del botón está en la ficha", () => {
    const codigo = [
      "apps/web/ui/plantillas/salon/modelo-de-impresoras.ts",
      "apps/web/ui/patrones/papel/textos-de-imprimir.ts",
    ]
      .map((a) => readFileSync(a, "utf8"))
      .join("\n");
    const citadas = [
      ...new Set(
        [...codigo.matchAll(/"((?:comandas|salon)\.texto\.[a-z_]+)"/g)].map((m) => m[1] ?? ""),
      ),
    ];
    expect(citadas.length).toBeGreaterThan(10);
    for (const clave of citadas)
      expect(Object.keys(FICHA_DE_IMPRESORAS.textos), clave).toContain(clave);
  });

  it("sus acciones existen en el módulo comandas y el acceso es el de la fila del menú", () => {
    const acciones = Object.keys(CATALOGO_DE_MODULOS.comandas.acciones);
    expect(acciones).toContain(FICHA_DE_IMPRESORAS.acceso);
    for (const b of FICHA_DE_IMPRESORAS.botones) {
      if ("envia" in b.hace) expect(acciones).toContain(b.hace.envia);
    }
    const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "impresoras");
    expect(fila).toMatchObject({
      accion: FICHA_DE_IMPRESORAS.acceso,
      etiqueta: FICHA_DE_IMPRESORAS.titulo,
      href: FICHA_DE_IMPRESORAS.rutas[0],
      modulo: "comandas",
    });
  });
});
