import { describe, expect, it } from "vitest";
import { CLASES_DE_USO } from "../../src/modulos/catalogo/publico";
import { ALICUOTAS_DEL_PRODUCTO } from "../../src/modulos/fiscal/publico";
import { UNIDADES } from "../../src/primitivas/unidades/unidades";
import {
  CLASE_POR_DEFECTO,
  UNIDAD_POR_DEFECTO,
  armarElAlta,
  type OpcionesDelAltaDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-alta-de-producto";

/**
 * El modelo de vista del alta de un producto (A1, T6; maqueta `productos.html`, «Nuevo producto»), con los textos reales del catálogo: qué campos salen, con qué rótulo, qué opciones
 * y con qué valores de partida. Previene: una clase, una alícuota o una unidad que el servidor ofrece sin su texto o sin estar entre las opciones, y un valor de partida que no se pueda elegir.
 */
const OPCIONES: OpcionesDelAltaDeLaPantalla = {
  clases: CLASES_DE_USO.map((valor) => ({
    valor,
    seVende: valor === "REVENTA" || valor === "VENDIBLE",
  })),
  unidades: Object.keys(UNIDADES),
  alicuotas: [...ALICUOTAS_DEL_PRODUCTO],
  secciones: [
    { id: "s-1", nombre: "Minutas" },
    { id: "s-2", nombre: "Bebidas" },
  ],
};

describe("armarElAlta", () => {
  const a = armarElAlta(OPCIONES);

  it("los rótulos son los aprobados de la maqueta, y «Guardar» y «Sin elegir» también", () => {
    expect([
      a.clase.etiqueta,
      a.nombre.etiqueta,
      a.nombreDeCocina.etiqueta,
      a.codigo.etiqueta,
      a.codigoDeBarras.etiqueta,
      a.unidad.etiqueta,
      a.alicuota.etiqueta,
      a.seccion.etiqueta,
      a.textoDeElegir,
      a.guardar,
    ]).toEqual([
      "¿Qué es?",
      "Nombre",
      "Nombre de cocina",
      "Código interno",
      "Código de barras",
      "Unidad",
      "Alícuota de IVA",
      "Sección de la carta",
      "Sin elegir",
      "Guardar",
    ]);
  });

  it("las cinco clases tienen su texto, en el orden del módulo", () => {
    expect(a.clase.opciones).toEqual([
      { valor: "MATERIA_PRIMA", etiqueta: "Materia prima" },
      { valor: "INSUMO", etiqueta: "Insumo" },
      { valor: "REVENTA", etiqueta: "Reventa" },
      { valor: "ELABORADO", etiqueta: "Elaborado" },
      { valor: "VENDIBLE", etiqueta: "Producto vendible" },
    ]);
    expect(a.clase.queSeVenden).toEqual(["REVENTA", "VENDIBLE"]);
  });

  it("las seis alícuotas con su texto; las 14 unidades con su código (sus nombres son de A2i); las secciones con su nombre", () => {
    expect(a.alicuota.opciones.map((o) => o.etiqueta)).toEqual([
      "21 %",
      "10,5 %",
      "27 %",
      "5 %",
      "2,5 %",
      "0 %",
    ]);
    expect(a.unidad.opciones).toHaveLength(14);
    expect(a.unidad.opciones.every((o) => o.valor === o.etiqueta)).toBe(true);
    expect(a.seccion.opciones).toEqual([
      { valor: "s-1", etiqueta: "Minutas" },
      { valor: "s-2", etiqueta: "Bebidas" },
    ]);
  });

  it("los valores de partida son los del borrador de la maqueta y se pueden elegir", () => {
    expect(a.clase.valorInicial).toBe("VENDIBLE");
    expect(a.unidad.valorInicial).toBe("UNIDAD");
    expect(CLASES_DE_USO).toContain(CLASE_POR_DEFECTO);
    expect(Object.keys(UNIDADES)).toContain(UNIDAD_POR_DEFECTO);
  });

  it("una alícuota que la pantalla no sabe nombrar se dice con el propio valor (no se esconde)", () => {
    const r = armarElAlta({ ...OPCIONES, alicuotas: ["21", "EXENTO"] });
    expect(r.alicuota.opciones.map((o) => o.etiqueta)).toEqual(["21 %", "EXENTO"]);
  });
});
