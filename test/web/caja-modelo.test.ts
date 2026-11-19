import { describe, expect, it } from "vitest";
import { armarElPedidoDeApertura } from "../../apps/web/ui/plantillas/caja/pedidos-de-caja";
import {
  botonesDeLaCaja,
  cabeceraDeJornada,
  efectivoEsperado,
  estadoDeLaCaja,
  puedeAbrir,
  textoDelEfectivo,
} from "../../apps/web/ui/plantillas/caja/modelo-de-la-caja";

/** El modelo de vista de la pantalla «Caja» (apertura): estado, cabecera de la jornada, efectivo esperado y botón de abrir. Puro: sin React ni servidor. */
const ARS = (monto: string) => ({ moneda: "ARS", monto });

describe("estadoDeLaCaja", () => {
  it("sin sesión es «Cerrada»; con sesión (también en cierre) es «Abierta»", () => {
    expect(estadoDeLaCaja("SIN_SESION")).toEqual({ texto: "Cerrada", tono: "aviso" });
    expect(estadoDeLaCaja("ABIERTA")).toEqual({ texto: "Abierta", tono: "exito" });
    expect(estadoDeLaCaja("EN_CIERRE")).toEqual({ texto: "Abierta", tono: "exito" });
  });
});

describe("cabeceraDeJornada", () => {
  it("dice la jornada con día/mes/año y la hora de corte", () => {
    expect(cabeceraDeJornada("2026-11-09", "06:00")).toBe("Jornada 09/11/2026 · Corte 06:00");
  });
});

describe("efectivoEsperado", () => {
  it("suma exacta solo de las líneas de efectivo (sin flotantes)", () => {
    const lineas = [
      { medioTipo: "EFECTIVO", esperado: ARS("0.10") },
      { medioTipo: "TARJETA_DEBITO", esperado: ARS("999.00") },
      { medioTipo: "EFECTIVO", esperado: ARS("0.20") },
    ];
    expect(efectivoEsperado(lineas)).toBe("0.30");
    expect(textoDelEfectivo(lineas)).toBe("Efectivo: $ 0,30");
  });

  it("sin líneas de efectivo es cero", () => {
    expect(efectivoEsperado([])).toBe("0.00");
  });
});

describe("botonesDeLaCaja", () => {
  it("abrir solo con la caja sin sesión y con el permiso que el servidor ofrece", () => {
    expect(botonesDeLaCaja("SIN_SESION", { abrir: true })).toEqual({ abrir: true });
    expect(botonesDeLaCaja("SIN_SESION", { abrir: false })).toEqual({ abrir: false });
    expect(botonesDeLaCaja("ABIERTA", { abrir: true })).toEqual({ abrir: false });
    expect(botonesDeLaCaja("EN_CIERRE", { abrir: true })).toEqual({ abrir: false });
  });
});

describe("apertura", () => {
  it("se puede abrir con el fondo declarado (cero incluido) y no con el campo vacío", () => {
    expect(puedeAbrir("")).toBe(false);
    expect(puedeAbrir("0")).toBe(true);
    expect(puedeAbrir("15000.00")).toBe(true);
  });

  it("el pedido lleva la clave del intento, la caja y el fondo como texto; nada más", () => {
    expect(armarElPedidoDeApertura("clave-1", "caja-1", "15000.00")).toEqual({
      claveDeIdempotencia: "clave-1",
      cajaId: "caja-1",
      fondoInicial: "15000.00",
    });
  });
});
