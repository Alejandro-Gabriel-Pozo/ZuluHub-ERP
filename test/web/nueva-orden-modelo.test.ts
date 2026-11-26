import { describe, expect, it } from "vitest";
import {
  opcionesDeProducto,
  textosDeNuevaOrden,
} from "../../apps/web/ui/plantillas/produccion/modelo-de-nueva-orden";
import { RUTA_DE_NUEVA_ORDEN } from "../../apps/web/ui/plantillas/produccion/filtros-de-ordenes";

/**
 * El modelo de vista de «Nueva orden»: las opciones de producto (nombre y unidad con su texto aprobado; una unidad que la pantalla no conoce se dice con el propio valor) y los textos del catálogo
 * (ninguno nuevo). Puro: sin React ni servidor.
 */
describe("opcionesDeProducto", () => {
  it("una opción por producto, con su unidad entre paréntesis, en el orden del servidor", () => {
    expect(
      opcionesDeProducto([
        { id: "p1", nombre: "Masa de medialuna", unidadId: "KILOGRAMO" },
        { id: "p2", nombre: "Pan", unidadId: "UNIDAD" },
      ]),
    ).toEqual([
      { valor: "p1", etiqueta: "Masa de medialuna (Kilogramo)" },
      { valor: "p2", etiqueta: "Pan (Unidad)" },
    ]);
  });

  it("una unidad que la pantalla no conoce se dice con el propio valor; sin productos, sin opciones", () => {
    expect(opcionesDeProducto([{ id: "p1", nombre: "Salsa", unidadId: "BARRIL" }])).toEqual([
      { valor: "p1", etiqueta: "Salsa (BARRIL)" },
    ]);
    expect(opcionesDeProducto([])).toEqual([]);
  });
});

describe("textosDeNuevaOrden", () => {
  it("usa solo los textos ya aprobados del catálogo", () => {
    expect(textosDeNuevaOrden()).toEqual({
      producto: "Producto",
      cantidad: "Cantidad a producir",
      abrir: "Abrir orden",
      producirIgual: "Producir igual",
      cancelar: "Cancelar",
    });
  });
});

describe("la dirección de «Nueva orden»", () => {
  it("cuelga de la lista de producción", () => {
    expect(RUTA_DE_NUEVA_ORDEN).toBe("/catalogo/produccion/nueva");
  });
});
