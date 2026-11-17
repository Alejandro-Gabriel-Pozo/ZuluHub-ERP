import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "./catalogo";

/** Los textos de E6 son exactamente los de los prototipos que el dueño aprobó el 09/11/2026 y ninguno más (el generador de la pantalla no inventa). */
const propios = (prefijos: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(CATALOGO_DE_TEXTOS)
      .filter(([clave]) => prefijos.some((p) => clave.startsWith(p)))
      .map(([clave, d]) => [clave, d.porDefecto]),
  );

describe("los textos de producción, receta y lotes", () => {
  it("producción: los de produccion.html «Textos aprobados»", () => {
    expect(Object.values(propios(["produccion."]))).toEqual([
      "Producción",
      "Nueva orden",
      "Orden",
      "Tanda",
      "Abierta",
      "Cerrada",
      "Cancelada",
      "Anulada",
      "Cantidad a producir",
      "Consume",
      "Obtiene",
      "En stock",
      // Aprobados por el dueño el 14/11/2026 (decisiones-del-dueno-2026-11.md).
      "Rinde",
      "La receta cambió desde que abriste la orden",
      "Costo estimado",
      "Abrir orden",
      "Cerrar con lo real",
      "Cerrar la orden",
      "Cancelar la orden",
      "Anular la orden",
      "Cantidad obtenida",
      "Vence",
      "Lote",
      "Costo por unidad",
      "Stock insuficiente",
      "Producir igual",
      "Se produce en tanda",
      "Se arma al usarlo",
    ]);
  });
  it("receta: los de receta.html «Textos aprobados», sin la receta por sucursal", () => {
    expect(Object.values(propios(["receta."]))).toEqual([
      "Recetas",
      "Sin receta",
      "Con receta",
      "Este producto no tiene receta",
      "Versión",
      "vigente",
      "Ingredientes",
      "Merma",
      "Bruto",
      "Costo",
      "Food cost",
      "Margen",
      "Según lo que elija el cliente",
      "No entran en el costo",
      "Editar",
      "Guardar como versión {numero}",
      "Versiones",
      "Comparar",
      "Ficha de cocina",
    ]);
  });
  it("lotes: los de control.html «Textos nuevos»", () => {
    expect(Object.values(propios(["lotes."]))).toEqual([
      "Cuarentena",
      "En cuarentena",
      "En revisión",
      "Liberar",
      "Rechazar",
      "Dejar en revisión",
      "No se puede vender ni usar",
      "Por vencer",
      "Vencido",
      "Vence hoy",
      "Vence en {dias} días",
      "Dar de baja por vencimiento",
      "Se pierde",
      "Lote",
      "Vence",
      "Falta la fecha de vencimiento",
      "Ya está vencido",
      "Esta acción no está permitida",
    ]);
  });
});
