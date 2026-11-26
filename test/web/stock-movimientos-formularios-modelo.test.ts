import { describe, expect, it } from "vitest";
import {
  CAMPOS_DEL_TIPO,
  MOTIVO_CON_COSTO,
  loteCompleto,
  loteQueSePide,
  opcionesDeArticulo,
  opcionesDeDeposito,
  opcionesDeMotivo,
  opcionesDeSentido,
  RUTAS_DE_MOVIMIENTOS,
  type TipoDeMovimiento,
} from "../../apps/web/ui/plantillas/stock/movimientos/modelo-de-formularios";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import { motivosManualesDe } from "../../src/modulos/stock/publico";

/** El modelo de los formularios de movimiento de stock: direcciones, qué campos lleva cada tipo y las opciones con su texto aprobado. Puro. */
const textoDe = (clave: Parameters<typeof texto>[1]) => texto({}, clave);
const DEPOSITOS = [
  { id: "d1", nombre: "Salón", uso: "NORMAL" },
  { id: "d2", nombre: "Cuarentena", uso: "CUARENTENA" },
  { id: "d3", nombre: "Rechazo", uso: "RECHAZO" },
];

describe("las direcciones", () => {
  it("cuelgan de Movimientos y la de anular lleva el movimiento", () => {
    expect(RUTAS_DE_MOVIMIENTOS).toMatchObject({
      lista: "/stock/movimientos",
      entrada: "/stock/movimientos/entrada",
      salida: "/stock/movimientos/salida",
      transferir: "/stock/movimientos/transferir",
      ajustar: "/stock/movimientos/ajustar",
    });
    expect(RUTAS_DE_MOVIMIENTOS.anular("m1")).toBe("/stock/movimientos/m1/anular");
  });
});

describe("los campos de cada tipo", () => {
  const con = (tipo: TipoDeMovimiento) =>
    Object.entries(CAMPOS_DEL_TIPO[tipo])
      .filter(([, v]) => v)
      .map(([k]) => k);
  it("entrada, salida, transferir, ajustar y anular llevan lo que dice la ficha", () => {
    expect(con("ENTRADA")).toEqual(["deposito", "articulo", "cantidad", "motivo", "costo"]);
    expect(con("SALIDA")).toEqual(["deposito", "articulo", "cantidad", "motivo"]);
    expect(con("TRANSFERIR")).toEqual(["origenYDestino", "articulo", "cantidad"]);
    expect(con("AJUSTAR")).toEqual([
      "deposito",
      "articulo",
      "sentido",
      "cantidad",
      "detalleObligatorio",
    ]);
    expect(con("ANULAR")).toEqual(["detalleObligatorio"]);
    expect(MOTIVO_CON_COSTO).toBe("COMPRA");
  });
});

describe("las opciones", () => {
  it("en una entrada solo se ofrecen los depósitos de uso Normal; en el resto, todos", () => {
    expect(opcionesDeDeposito(DEPOSITOS, "ENTRADA")).toEqual([{ valor: "d1", etiqueta: "Salón" }]);
    for (const tipo of ["SALIDA", "TRANSFERIR", "AJUSTAR"] as const) {
      expect(opcionesDeDeposito(DEPOSITOS, tipo).map((o) => o.valor)).toEqual(["d1", "d2", "d3"]);
    }
  });

  it("los artículos salen por su id con su nombre", () => {
    expect(opcionesDeArticulo([{ id: "a1", nombre: "Harina", controlDeLote: null }])).toEqual([
      { valor: "a1", etiqueta: "Harina", controlDeLote: null },
    ]);
  });

  it("los motivos salen con su texto aprobado y en el orden del servidor; uno sin texto no se ofrece", () => {
    expect(opcionesDeMotivo(["COMPRA", "VENTA", "OTRA_ENTRADA"], textoDe)).toEqual([
      { valor: "COMPRA", etiqueta: "Compra" },
      { valor: "OTRA_ENTRADA", etiqueta: "Otra entrada" },
    ]);
    // Todos los motivos manuales del servidor tienen texto: ninguno se pierde en el formulario.
    for (const clase of ["ENTRADA", "SALIDA"] as const) {
      const del = motivosManualesDe(clase);
      expect(opcionesDeMotivo(del, textoDe).map((o) => o.valor)).toEqual(del);
    }
  });

  it("el sentido es «Sobra» (suma) y «Falta» (resta)", () => {
    expect(opcionesDeSentido(textoDe)).toEqual([
      { valor: "SUMA", etiqueta: "Sobra" },
      { valor: "RESTA", etiqueta: "Falta" },
    ]);
  });
});

describe("el lote de una entrada (STK-E2b)", () => {
  it("sin control no se pide nada; con control se pide el código y, solo con vencimiento, la fecha", () => {
    expect(loteQueSePide(null)).toBeNull();
    expect(loteQueSePide("LOTE")).toEqual({ vence: false });
    expect(loteQueSePide("LOTE_Y_VENCIMIENTO")).toEqual({ vence: true });
  });

  it("está completo según lo que se pide: sin control, siempre; con control, el código no vacío; con vencimiento, también la fecha", () => {
    expect(loteCompleto(null, "", "")).toBe(true);
    expect(loteCompleto("LOTE", "", "")).toBe(false);
    expect(loteCompleto("LOTE", "  ", "")).toBe(false);
    expect(loteCompleto("LOTE", "L-1", "")).toBe(true);
    expect(loteCompleto("LOTE_Y_VENCIMIENTO", "L-1", "")).toBe(false);
    expect(loteCompleto("LOTE_Y_VENCIMIENTO", "", "2099-06-01")).toBe(false);
    expect(loteCompleto("LOTE_Y_VENCIMIENTO", "L-1", "2099-06-01")).toBe(true);
  });
});
