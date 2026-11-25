import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { RUTA_DEL_NIVEL_DE_COMPRAS } from "../../apps/web/ui/plantillas/compras/rutas-de-compras";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_COMPRAS } from "../../src/capacidades/permisos/permisos-de-compras";
import {
  FICHA_DE_NIVEL_DE_COMPRAS,
  type FichaDeNivelDeCompras,
} from "../../src/capacidades/pantallas/ficha-de-nivel-de-compras";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Nivel de compras» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente de dueño, la acción de su botón existe en el módulo y
 * la fila del menú coincide (acceso, rótulo, ruta y módulo). Previene: un botón o un texto que nadie aprobó y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */
const FICHA: FichaDeNivelDeCompras = FICHA_DE_NIVEL_DE_COMPRAS;

describe("ficha de la pantalla «Nivel de compras»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("todo texto está declarado con usos y fuente de dueño, y cada clave existe en el catálogo", () => {
    const claves = [FICHA.titulo, ...FICHA.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("los tres textos nuevos son los aprobados tal cual, y los de la fase 5 no tienen clave", () => {
    expect(CATALOGO_DE_TEXTOS["compras.nivel.titulo"].porDefecto).toBe("Nivel de compras");
    expect(CATALOGO_DE_TEXTOS["compras.nivel.compra_simple"].porDefecto).toBe("Sin factura");
    expect(CATALOGO_DE_TEXTOS["compras.nivel.con_comprobante"].porDefecto).toBe("Con factura");
    const claves = Object.keys(CATALOGO_DE_TEXTOS);
    expect(claves).not.toContain("compras.nivel.recepcion_separada");
    expect(claves).not.toContain("compras.nivel.tres_vias");
  });

  it("su único botón envía `compras.configurar` (solo gerente), que existe en el módulo, y sin permiso no se dibuja", () => {
    expect(FICHA.botones.map((b) => [b.id, b.hace, b.sinPermiso])).toEqual([
      ["guardar-nivel", { envia: "compras.configurar" }, "AUSENTE"],
    ]);
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    expect(todas).toContain("compras.configurar");
    expect(PERMISOS_DE_COMPRAS["compras.configurar"]).toEqual(["GERENTE"]);
  });

  it("los dos estados de error son el mensaje genérico", () => {
    expect(FICHA.estados).toEqual({ ERROR: "GENERICO", SIN_PERMISO: "GENERICO" });
  });

  it("la fila del menú coincide con la ficha", () => {
    const fila = FILAS_DEL_MENU.find((f) => f.clave === "nivel-de-compras");
    expect(fila).toBeDefined();
    expect(fila).toMatchObject({
      area: "compras",
      modulo: "compras",
      accion: FICHA.acceso,
      etiqueta: FICHA.titulo,
      href: RUTA_DEL_NIVEL_DE_COMPRAS,
    });
    expect(FICHA.rutas).toEqual([RUTA_DEL_NIVEL_DE_COMPRAS]);
  });
});
