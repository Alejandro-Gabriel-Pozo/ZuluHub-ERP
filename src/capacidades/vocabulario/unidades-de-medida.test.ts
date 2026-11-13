import { describe, expect, it } from "vitest";
import { UNIDADES } from "../../primitivas/unidades/unidades";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "./unidades-de-medida";
import { texto } from "./vocabulario";

// Los nombres de la maqueta `productos.html` (constante UNID), en el orden de `UNIDADES`.
const NOMBRES_DE_LA_MAQUETA = [
  "Unidad",
  "Gramo",
  "Kilogramo",
  "Tonelada",
  "Mililitro",
  "Litro",
  "Metro cúbico",
  "Milímetro",
  "Centímetro",
  "Metro",
  "Centímetro cuadrado",
  "Metro cuadrado",
  "Minuto",
  "Hora",
];

describe("nombres de las unidades de medida", () => {
  it("hay uno por cada unidad de la lista cerrada, en el mismo orden, y es el de la maqueta aprobada", () => {
    const codigos = Object.keys(UNIDADES);
    expect(Object.keys(CLAVE_DE_TEXTO_DE_UNIDAD)).toEqual(codigos);
    const nombres = codigos.map((c) =>
      texto({}, CLAVE_DE_TEXTO_DE_UNIDAD[c as keyof typeof CLAVE_DE_TEXTO_DE_UNIDAD]),
    );
    expect(nombres).toEqual(NOMBRES_DE_LA_MAQUETA);
  });

  it("la clave de cada unidad es `catalogo.unidad.` más su código en minúscula", () => {
    for (const [codigo, clave] of Object.entries(CLAVE_DE_TEXTO_DE_UNIDAD)) {
      expect(clave).toBe(`catalogo.unidad.${codigo.toLowerCase()}`);
    }
  });
});
