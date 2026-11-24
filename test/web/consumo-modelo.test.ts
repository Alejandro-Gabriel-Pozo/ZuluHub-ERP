import { describe, expect, it } from "vitest";
import {
  armarElConsumo,
  cantidadParaElCampo,
  rutaDelConsumo,
  type ConsumoDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-consumo";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CONSUMO: ConsumoDeLaPantalla = {
  id: ID,
  nombre: "Milanesa",
  versionDeOpciones: 4,
  grupo: { id: "g1", nombre: "Carne" },
  tieneMedida: true,
  opciones: [
    {
      id: "o1",
      nombre: "Pollo",
      lineas: [
        { insumoId: "i1", cantidad: "150.0000", escalaConTamano: true },
        { insumoId: "i9", cantidad: "2.5000", escalaConTamano: false },
      ],
    },
    {
      id: "o2",
      nombre: "Carne",
      lineas: [{ insumoId: "i2", cantidad: "0.0001", escalaConTamano: false }],
    },
  ],
  insumos: [
    { id: "i1", nombre: "Pollo crudo", unidad: "g" },
    { id: "i2", nombre: "Pan rallado", unidad: "kg" },
  ],
};

describe("cantidadParaElCampo", () => {
  it.each([
    ["150.0000", "150"],
    ["1.5000", "1.5"],
    ["0.0001", "0.0001"],
    ["0.0000", "0"],
    ["10", "10"],
    ["100", "100"],
    ["2.", "2"],
    ["", ""],
    ["abc", ""],
    ["-1", ""],
    ["1e3", ""],
    ["1.2.3", ""],
  ])("«%s» se muestra «%s»", (guardada, campo) => {
    expect(cantidadParaElCampo(guardada)).toBe(campo);
  });
});

describe("armarElConsumo", () => {
  it("la ruta cuelga del grupo", () => {
    expect(rutaDelConsumo(ID, "g1")).toBe(`/catalogo/productos/${ID}/opciones/g1/consumo`);
  });

  it("el título «Qué consume · grupo», una tarjeta por opción con sus líneas de claves únicas en todo el formulario y los textos de la maqueta", () => {
    expect(armarElConsumo(CONSUMO)).toEqual({
      id: ID,
      titulo: "Qué consume · Carne",
      tieneMedida: true,
      insumos: [
        { valor: "i1", etiqueta: "Pollo crudo" },
        { valor: "i2", etiqueta: "Pan rallado" },
        { valor: "i9", etiqueta: "i9" },
      ],
      unidades: { i1: "g", i2: "kg" },
      opciones: [
        {
          indice: 0,
          nombre: "Pollo",
          filas: [
            { clave: "l0", insumoId: "i1", cantidad: "150", escala: true },
            { clave: "l1", insumoId: "i9", cantidad: "2.5", escala: false },
          ],
        },
        {
          indice: 1,
          nombre: "Carne",
          filas: [{ clave: "l2", insumoId: "i2", cantidad: "0.0001", escala: false }],
        },
      ],
      siguienteLinea: 3,
      textos: {
        insumo: "Insumo",
        cantidad: "Cantidad",
        escala: "Escala con la medida",
        agregar: "Agregar insumo",
        quitar: "Quitar",
        guardar: "Guardar",
      },
    });
  });

  it("un insumo que consume una línea y no figura entre los que se ofrecen se ofrece una sola vez, con su identificador", () => {
    const c = armarElConsumo({
      ...CONSUMO,
      opciones: [
        {
          id: "o1",
          nombre: "A",
          lineas: [{ insumoId: "x", cantidad: "1", escalaConTamano: false }],
        },
        {
          id: "o2",
          nombre: "B",
          lineas: [{ insumoId: "x", cantidad: "2", escalaConTamano: false }],
        },
      ],
    });
    expect(c.insumos.filter((i) => i.valor === "x")).toEqual([{ valor: "x", etiqueta: "x" }]);
  });

  it("sin consumo cargado no hay líneas y la próxima es l0; sin medida no se ofrece la escala", () => {
    const c = armarElConsumo({
      ...CONSUMO,
      tieneMedida: false,
      opciones: [{ id: "o1", nombre: "Pollo", lineas: [] }],
    });
    expect(c.opciones).toEqual([{ indice: 0, nombre: "Pollo", filas: [] }]);
    expect(c.siguienteLinea).toBe(0);
    expect(c.tieneMedida).toBe(false);
  });
});
