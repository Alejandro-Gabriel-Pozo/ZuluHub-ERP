import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { RUTAS_DE_CUENTA } from "../../apps/web/ui/plantillas/sesion/rutas-de-cuenta";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_ROLES } from "../../src/capacidades/pantallas/ficha-de-roles";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { TEXTOS_DE_ROLES } from "../../src/capacidades/vocabulario/textos-de-roles";

/**
 * La ficha de «Roles» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente de dueño, sus acciones son las de `roles.*` del módulo `administracion` y la fila del menú
 * coincide (acceso, rótulo, ruta y módulo). Previene: un botón o un texto que nadie aprobó y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Roles»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_ROLES.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto que usa está declarado con usos y fuente de dueño, y cada clave existe en el catálogo", () => {
    const claves = [FICHA_DE_ROLES.titulo, ...FICHA_DE_ROLES.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_ROLES.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_ROLES.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador|SIN_APROBAR/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs|DDD/);
    }
  });

  it("todo texto propio de la pantalla está en la ficha y en el catálogo con su uso y su decisión de la familia IDE", () => {
    for (const [clave, def] of Object.entries(TEXTOS_DE_ROLES)) {
      expect(Object.keys(FICHA_DE_ROLES.textos), clave).toContain(clave);
      expect(def.usos).not.toBe("pendiente");
      expect(def.fuente).toMatchObject({
        decision: expect.stringMatching(/^DEC-IDE-\d{3}$/) as string,
      });
    }
  });

  it("sus botones son nuevo, guardar (alta y ficha), archivar y reactivar, cada uno con su permiso, y sin permiso ninguno se dibuja; los dos estados son el genérico", () => {
    expect(FICHA_DE_ROLES.botones.map((b) => [b.id, b.hace, b.sinPermiso])).toEqual([
      ["nuevo", { navega: "/cuenta/roles/nuevo" }, "AUSENTE"],
      ["guardar-alta", { envia: "roles.crear" }, "AUSENTE"],
      ["guardar", { envia: "roles.editar" }, "AUSENTE"],
      ["archivar", { envia: "roles.archivar" }, "AUSENTE"],
      ["reactivar", { envia: "roles.editar" }, "AUSENTE"],
    ]);
    expect(FICHA_DE_ROLES.estados).toEqual({ ERROR: "GENERICO", SIN_PERMISO: "GENERICO" });
  });

  it("sus acciones existen en el catálogo, del módulo administración y solo del gerente (sin piso aflojado)", () => {
    const acciones = [
      FICHA_DE_ROLES.acceso,
      ...FICHA_DE_ROLES.botones.flatMap((b) => ("envia" in b.hace ? [b.hace.envia] : [])),
    ];
    for (const accion of acciones) {
      expect(Object.keys(CATALOGO_DE_MODULOS.administracion.acciones)).toContain(accion);
    }
    expect(FICHA_DE_ROLES.acceso).toBe("roles.ver");
  });

  it("la fila del menú de Cuenta coincide con la ficha y las rutas son las de Cuenta", () => {
    const fila = FILAS_DEL_MENU.find((f) => f.clave === "roles");
    expect(fila).toMatchObject({
      area: "cuenta",
      modulo: "administracion",
      accion: FICHA_DE_ROLES.acceso,
      etiqueta: FICHA_DE_ROLES.titulo,
      href: RUTAS_DE_CUENTA.roles,
    });
    expect(FICHA_DE_ROLES.rutas).toEqual([
      "/cuenta/roles",
      "/cuenta/roles/nuevo",
      "/cuenta/roles/[rolId]",
    ]);
    expect(RUTAS_DE_CUENTA.nuevoRol).toBe("/cuenta/roles/nuevo");
  });
});
