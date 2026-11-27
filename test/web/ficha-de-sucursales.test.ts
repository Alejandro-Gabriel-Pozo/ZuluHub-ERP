import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { RUTAS_DE_CUENTA } from "../../apps/web/ui/plantillas/sesion/rutas-de-cuenta";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_SUCURSALES } from "../../src/capacidades/pantallas/ficha-de-sucursales";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { TEXTOS_DE_SUCURSALES } from "../../src/capacidades/vocabulario/textos-de-sucursales";

/**
 * La ficha de «Sucursales» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente de dueño, sus acciones son las de `sucursales.*` del módulo `administracion` y la fila del
 * menú coincide (acceso, rótulo, ruta y módulo). Previene: un botón o un texto que nadie aprobó y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Sucursales»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_SUCURSALES.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto que usa está declarado con usos y fuente de dueño, y cada clave existe en el catálogo", () => {
    const claves = [FICHA_DE_SUCURSALES.titulo, ...FICHA_DE_SUCURSALES.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_SUCURSALES.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_SUCURSALES.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador|SIN_APROBAR/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs|DDD/);
    }
  });

  it("el único texto propio de la pantalla está en la ficha y en el catálogo con su uso y su decisión de la familia IDE", () => {
    expect(Object.keys(TEXTOS_DE_SUCURSALES)).toEqual(["sucursales.lista.nueva"]);
    for (const [clave, def] of Object.entries(TEXTOS_DE_SUCURSALES)) {
      expect(Object.keys(FICHA_DE_SUCURSALES.textos), clave).toContain(clave);
      expect(def.usos.length).toBeGreaterThan(0);
      expect(def.fuente).toMatchObject({
        decision: expect.stringMatching(/^DEC-IDE-\d{3}$/) as string,
      });
    }
  });

  it("sus botones son nueva y guardar, cada uno con su permiso, y sin permiso ninguno se dibuja; los dos estados son el genérico", () => {
    expect(FICHA_DE_SUCURSALES.botones.map((b) => [b.id, b.hace, b.sinPermiso])).toEqual([
      ["nueva", { navega: "/cuenta/sucursales/nueva" }, "AUSENTE"],
      ["guardar", { envia: "sucursales.crear" }, "AUSENTE"],
    ]);
    expect(FICHA_DE_SUCURSALES.estados).toEqual({ ERROR: "GENERICO", SIN_PERMISO: "GENERICO" });
  });

  it("sus acciones existen en el catálogo, del módulo administración", () => {
    const acciones = [
      FICHA_DE_SUCURSALES.acceso,
      ...FICHA_DE_SUCURSALES.botones.flatMap((b) => ("envia" in b.hace ? [b.hace.envia] : [])),
    ];
    for (const accion of acciones) {
      expect(Object.keys(CATALOGO_DE_MODULOS.administracion.acciones)).toContain(accion);
    }
    expect(FICHA_DE_SUCURSALES.acceso).toBe("sucursales.ver");
  });

  it("la fila del menú de Cuenta coincide con la ficha y las rutas son las de Cuenta", () => {
    const fila = FILAS_DEL_MENU.find((f) => f.clave === "sucursales");
    expect(fila).toMatchObject({
      area: "cuenta",
      grupo: "empresa",
      modulo: "administracion",
      accion: FICHA_DE_SUCURSALES.acceso,
      etiqueta: FICHA_DE_SUCURSALES.titulo,
      href: RUTAS_DE_CUENTA.sucursales,
    });
    expect(FICHA_DE_SUCURSALES.rutas).toEqual(["/cuenta/sucursales", "/cuenta/sucursales/nueva"]);
    expect(RUTAS_DE_CUENTA.nuevaSucursal).toBe("/cuenta/sucursales/nueva");
  });
});
