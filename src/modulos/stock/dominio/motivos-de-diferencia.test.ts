import { describe, expect, it } from "vitest";
import {
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import {
  MOTIVO_QUE_EXIGE_AJUSTAR,
  MOTIVOS_DE_DIFERENCIA,
  sentidoDeLaDiferencia,
  validarMotivoDeDiferencia,
} from "./motivos-de-diferencia";

const cs = (texto: string): CantidadConSigno => {
  const r = cantidadConSignoDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};

describe("la lista cerrada de motivos de una diferencia (decisión del dueño, 11 y 12/11/2026)", () => {
  it("faltante: venta no registrada, consumo interno, merma, rotura, vencimiento y otra salida; sobrante: devolución de cliente y otra entrada", () => {
    expect(MOTIVOS_DE_DIFERENCIA).toEqual([
      { codigo: "VENTA_NO_REGISTRADA", sentido: "FALTANTE", pideDetalle: false, orden: 1 },
      { codigo: "CONSUMO_INTERNO", sentido: "FALTANTE", pideDetalle: false, orden: 2 },
      { codigo: "MERMA", sentido: "FALTANTE", pideDetalle: false, orden: 3 },
      { codigo: "ROTURA", sentido: "FALTANTE", pideDetalle: false, orden: 4 },
      { codigo: "VENCIMIENTO", sentido: "FALTANTE", pideDetalle: false, orden: 5 },
      { codigo: "OTRA_SALIDA", sentido: "FALTANTE", pideDetalle: true, orden: 6 },
      { codigo: "DEVOLUCION_DE_CLIENTE", sentido: "SOBRANTE", pideDetalle: false, orden: 1 },
      { codigo: "OTRA_ENTRADA", sentido: "SOBRANTE", pideDetalle: true, orden: 2 },
    ]);
  });

  it("solo «otra salida» y «otra entrada» piden detalle, y los códigos no se repiten", () => {
    expect(MOTIVOS_DE_DIFERENCIA.filter((m) => m.pideDetalle).map((m) => m.codigo)).toEqual([
      "OTRA_SALIDA",
      "OTRA_ENTRADA",
    ]);
    expect(new Set(MOTIVOS_DE_DIFERENCIA.map((m) => m.codigo)).size).toBe(
      MOTIVOS_DE_DIFERENCIA.length,
    );
  });

  it("el motivo que exige además poder ajustar stock es el vencimiento (S-7)", () => {
    expect(MOTIVO_QUE_EXIGE_AJUSTAR).toBe("VENCIMIENTO");
  });
});

describe("sentidoDeLaDiferencia", () => {
  it("negativa es faltante, positiva es sobrante, cero no es ninguno", () => {
    expect(sentidoDeLaDiferencia(cs("-0.0001"))).toBe("FALTANTE");
    expect(sentidoDeLaDiferencia(cs("0.0001"))).toBe("SOBRANTE");
    expect(sentidoDeLaDiferencia(cs("0"))).toBeNull();
  });
});

describe("validarMotivoDeDiferencia: el motivo que corresponde a lo que QUEDA de diferencia", () => {
  const probar = (diferencia: string, motivo: string | null, detalle: string | null = null) => {
    const r = validarMotivoDeDiferencia(cs(diferencia), motivo, detalle);
    return r.ok ? (r.valor === null ? null : r.valor.codigo) : r.error;
  };

  it("sin diferencia no se pregunta nada: ni motivo ni detalle (la respuesta sobra)", () => {
    expect(probar("0", null)).toBeNull();
    expect(probar("0", "MERMA")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("0", null, "algo")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("0", "OTRA_ENTRADA", "algo")).toBe("MOTIVO_NO_CORRESPONDE");
  });

  it("con diferencia el motivo es obligatorio (MOTIVO_REQUERIDO)", () => {
    expect(probar("-2", null)).toBe("MOTIVO_REQUERIDO");
    expect(probar("3", null)).toBe("MOTIVO_REQUERIDO");
  });

  it("CF10: un faltante solo admite motivos de salida; un sobrante, de entrada (MOTIVO_NO_CORRESPONDE)", () => {
    expect(probar("-2", "DEVOLUCION_DE_CLIENTE")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("-2", "OTRA_ENTRADA", "x")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("3", "MERMA")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("3", "OTRA_SALIDA", "x")).toBe("MOTIVO_NO_CORRESPONDE");
    for (const m of MOTIVOS_DE_DIFERENCIA.filter((x) => x.sentido === "FALTANTE")) {
      expect(probar("-2", m.codigo, "x")).toBe(m.codigo);
    }
    for (const m of MOTIVOS_DE_DIFERENCIA.filter((x) => x.sentido === "SOBRANTE")) {
      expect(probar("3", m.codigo, "x")).toBe(m.codigo);
    }
  });

  it("un motivo que no está en la lista no pasa (lista cerrada: nada más se admite)", () => {
    expect(probar("-2", "COMPRA")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("-2", "VENTA")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("-2", "merma")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("-2", "")).toBe("MOTIVO_NO_CORRESPONDE");
    expect(probar("3", "CONTEO")).toBe("MOTIVO_NO_CORRESPONDE");
  });

  it("«otra salida» y «otra entrada» exigen detalle (DETALLE_REQUERIDO); los demás motivos lo admiten opcional", () => {
    expect(probar("-2", "OTRA_SALIDA")).toBe("DETALLE_REQUERIDO");
    expect(probar("-2", "OTRA_SALIDA", "error de conteo")).toBe("OTRA_SALIDA");
    expect(probar("3", "OTRA_ENTRADA")).toBe("DETALLE_REQUERIDO");
    expect(probar("3", "OTRA_ENTRADA", "apareció en otra góndola")).toBe("OTRA_ENTRADA");
    expect(probar("-2", "VENTA_NO_REGISTRADA")).toBe("VENTA_NO_REGISTRADA");
    expect(probar("-2", "VENTA_NO_REGISTRADA", "faltó el ticket")).toBe("VENTA_NO_REGISTRADA");
  });
});
