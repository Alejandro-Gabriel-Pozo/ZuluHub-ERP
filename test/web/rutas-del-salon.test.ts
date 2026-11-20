import { describe, expect, it } from "vitest";
import {
  RUTA_DE_LA_CUENTA_DE_MESA,
  RUTA_DEL_SALON,
  rutaDeLaCuentaDeMesa,
} from "../../apps/web/ui/plantillas/salon/rutas-del-salon";
import { RUTA_DE_MESAS } from "../../apps/web/ui/plantillas/salon/modelo-de-mesas";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";

/**
 * Las rutas de operación del salón: `/salon` (mapa) y `/salon/cuenta/[mesaId]` (ficha), distintas de la administración de mesas (`/salon/mesas`). Previene: confundir la ficha con la edición de una mesa y, mientras
 * no existan las pantallas, una entrada de menú hacia una página que no existe.
 */
describe("rutas del salón", () => {
  it("el mapa es /salon y la ficha /salon/cuenta/<id>", () => {
    expect(RUTA_DEL_SALON).toBe("/salon");
    expect(RUTA_DE_LA_CUENTA_DE_MESA).toBe("/salon/cuenta");
    expect(rutaDeLaCuentaDeMesa("11111111-1111-4111-8111-111111111111")).toBe(
      "/salon/cuenta/11111111-1111-4111-8111-111111111111",
    );
  });
  it("el id se codifica: un texto con barras no arma otra ruta", () => {
    expect(rutaDeLaCuentaDeMesa("../mesas/1")).toBe("/salon/cuenta/..%2Fmesas%2F1");
  });
  it("no pisa la administración de mesas", () => {
    expect(RUTA_DE_MESAS.startsWith(`${RUTA_DE_LA_CUENTA_DE_MESA}/`)).toBe(false);
    expect(rutaDeLaCuentaDeMesa("x").startsWith(`${RUTA_DE_MESAS}/`)).toBe(false);
  });
  it("ninguna fila del menú apunta a una pantalla que todavía no existe", () => {
    const destinos = FILAS_DEL_MENU.flatMap((f) => ("href" in f ? [f.href] : []));
    expect(destinos).not.toContain(RUTA_DEL_SALON);
    expect(destinos.some((h) => h.startsWith(RUTA_DE_LA_CUENTA_DE_MESA))).toBe(false);
  });
});
