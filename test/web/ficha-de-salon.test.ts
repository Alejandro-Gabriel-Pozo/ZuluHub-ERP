import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { FILTROS_DEL_MAPA } from "../../apps/web/ui/plantillas/salon/modelo-del-mapa";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { FICHA_DE_SALON } from "../../src/capacidades/pantallas/ficha-de-salon";

/**
 * La ficha de «Salón» (mapa de mesas, SAL-A) no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente, su acceso está declarado en el módulo `salon`, la fila del menú
 * coincide (acceso, rótulo, ruta, perilla) y sus botones son los filtros que el modelo ofrece. Previene: un botón o un texto sin fuente, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Salón»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_SALON.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto que usa está declarado con usos y fuente del dueño, y cada clave existe en el catálogo", () => {
    const claves = [FICHA_DE_SALON.titulo, ...FICHA_DE_SALON.botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_SALON.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_SALON.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("su acceso existe en el módulo salon y es el de la fila del menú (ruta, rótulo, módulo y perilla)", () => {
    expect(Object.keys(CATALOGO_DE_MODULOS.salon.acciones)).toContain(FICHA_DE_SALON.acceso);
    const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "salon");
    expect(fila).toMatchObject({
      accion: FICHA_DE_SALON.acceso,
      etiqueta: FICHA_DE_SALON.titulo,
      href: FICHA_DE_SALON.rutas[0],
      modulo: "salon",
      perilla: "salon",
    });
  });

  it("sus botones son los filtros del modelo, con el mismo texto y la misma dirección", () => {
    expect(
      FICHA_DE_SALON.botones.map((b) => [b.texto, "navega" in b.hace ? b.hace.navega : null]),
    ).toEqual(FILTROS_DEL_MAPA.map((f) => [f.clave, `/salon?filtro=${f.valor}`]));
  });
});
