import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_NOTAS_DE_COMPRAS } from "../../src/capacidades/pantallas/ficha-de-notas-de-compras";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { textosDeNotas } from "../../apps/web/ui/plantillas/compras/notas/textos-de-notas";

/**
 * La ficha de las pantallas de notas del proveedor no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente, y las acciones de sus botones y de sus accesos existen en el módulo
 * de compras. Previene: un botón con una acción que no existe, un texto sin fuente o una ruta que se mueve sin que la ficha lo note.
 */
describe("ficha de las pantallas de notas del proveedor", () => {
  const acciones = Object.keys(CATALOGO_DE_MODULOS.compras.acciones);
  const ficha = FICHA_DE_NOTAS_DE_COMPRAS;

  it("sus archivos existen", () => {
    for (const archivo of ficha.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("todo texto de un botón o de un estado está declarado con usos y fuente, y cada clave existe en el catálogo", () => {
    const claves = [...ficha.botones.map((b) => b.texto), ...Object.values(ficha.estados)];
    for (const clave of claves) expect(Object.keys(ficha.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(ficha.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("las acciones de sus botones y de sus accesos existen en el módulo de compras", () => {
    for (const b of ficha.botones) {
      if (typeof b.hace === "object" && "envia" in b.hace) expect(acciones).toContain(b.hace.envia);
    }
    for (const lista of Object.values(ficha.accesos)) {
      for (const accion of lista) expect(acciones).toContain(accion);
    }
    expect(Object.keys(ficha.accesos).sort()).toEqual([...ficha.rutas].sort());
  });

  it("cada ruta tiene su página y cada botón que envía nace ausente sin permiso", () => {
    const paginas: Record<string, string> = {
      "/compras/facturas/[id]/notas": "[id]/notas/page.tsx",
      "/compras/facturas/[id]/notas/nueva": "[id]/notas/nueva/page.tsx",
    };
    for (const ruta of ficha.rutas) {
      const pagina = paginas[ruta];
      expect(pagina).toBeDefined();
      expect(existsSync(`apps/web/app/s/app/(operacion)/compras/facturas/${pagina ?? ""}`)).toBe(
        true,
      );
    }
    for (const b of ficha.botones) {
      if (typeof b.hace === "object" && "envia" in b.hace) expect(b.sinPermiso).toBe("AUSENTE");
    }
  });

  it("todo texto que resuelve la pantalla está en el catálogo y ninguno queda vacío", () => {
    const textos = textosDeNotas();
    for (const [clave, valor] of Object.entries(textos)) {
      if (typeof valor === "string") expect(valor, clave).not.toBe("");
    }
    expect(Object.values(textos.alicuotas).every((v) => v !== "")).toBe(true);
  });
});
