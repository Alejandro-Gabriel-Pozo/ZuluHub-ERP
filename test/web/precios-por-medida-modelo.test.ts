import { describe, expect, it } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";
import {
  armarLosPreciosPorMedida,
  rutaDeLosPreciosPorMedida,
  textoDelErrorDePrecios,
  type PreciosPorMedidaDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-precios-por-medida";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const PANTALLA: PreciosPorMedidaDeLaPantalla = {
  id: ID,
  nombre: "Latte",
  claveDelCambio: "c",
  medidas: [
    { opcionId: "a", nombre: "Chico", vigente: { precioId: "p", importe: "3200.000000" } },
    { opcionId: "b", nombre: "Grande", vigente: null },
    { opcionId: "c", nombre: "Gigante", vigente: { precioId: "q", importe: "28333.333333" } },
  ],
};

describe("el modelo de los precios por medida", () => {
  it("la ruta cuelga de los precios del producto", () => {
    expect(rutaDeLosPreciosPorMedida(ID)).toBe(`/catalogo/productos/${ID}/precios/medidas`);
  });

  it("un campo por medida con su nombre como rótulo, el nombre del campo por posición y el vigente puesto (vacío si no hay o si tiene más decimales que el campo)", () => {
    expect(armarLosPreciosPorMedida(PANTALLA)).toEqual({
      id: ID,
      titulo: "Latte",
      campos: [
        { nombreDelCampo: "precio_0", etiqueta: "Chico", valorInicial: "3200.00" },
        { nombreDelCampo: "precio_1", etiqueta: "Grande", valorInicial: "" },
        { nombreDelCampo: "precio_2", etiqueta: "Gigante", valorInicial: "" },
      ],
      guardar: "Guardar",
    });
  });

  it("sin medidas, sin campos", () => {
    expect(armarLosPreciosPorMedida({ ...PANTALLA, medidas: [] }).campos).toEqual([]);
  });

  it("el texto de un error es el del catálogo de su clave", () => {
    expect(textoDelErrorDePrecios(errorDeCodigo("CATALOGO_PRECIO_INVALIDO"))).toBe(
      "Escribí un precio válido",
    );
  });
});
