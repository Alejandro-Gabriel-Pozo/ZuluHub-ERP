import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { FICHA_DE_DIRECTORIO } from "../../src/capacidades/pantallas/ficha-de-directorio";

/**
 * La ficha de «Clientes y proveedores» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente, sus acciones están declaradas en el módulo
 * `clientes` y las dos filas del menú coinciden (acceso, módulo y rótulo). Previene: un botón con una acción que no existe, un texto sin fuente o una ruta que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Clientes y proveedores»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_DIRECTORIO.archivos) expect(existsSync(archivo)).toBe(true);
  });

  it("todo texto que usa está declarado con usos y fuente, y cada clave existe en el catálogo", () => {
    const claves = [FICHA_DE_DIRECTORIO.titulo, ...FICHA_DE_DIRECTORIO.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_DIRECTORIO.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_DIRECTORIO.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("sus acciones existen en el módulo clientes", () => {
    const acciones = Object.keys(CATALOGO_DE_MODULOS.clientes.acciones);
    expect(acciones).toContain(FICHA_DE_DIRECTORIO.acceso);
    for (const b of FICHA_DE_DIRECTORIO.botones) {
      if ("envia" in b.hace) expect(acciones).toContain(b.hace.envia);
    }
  });

  it("las dos filas del menú usan `partes.ver` y el módulo clientes, y abren la misma pantalla con el filtro por rol", () => {
    const fila = (clave: string) =>
      FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === clave);
    expect(fila("clientes")).toMatchObject({
      area: "ventas",
      modulo: "clientes",
      accion: FICHA_DE_DIRECTORIO.acceso,
      href: "/clientes?rol=cliente",
      etiqueta: "clientes.lista.clientes",
    });
    expect(fila("proveedores")).toMatchObject({
      area: "compras",
      modulo: "clientes",
      accion: FICHA_DE_DIRECTORIO.acceso,
      href: "/clientes?rol=proveedor",
      etiqueta: "clientes.lista.proveedores",
    });
    expect(FICHA_DE_DIRECTORIO.rutas[0]).toBe("/clientes");
  });
});
