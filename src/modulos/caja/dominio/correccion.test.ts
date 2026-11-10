import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  decidirCorreccionDeMedio,
  decidirDeclaracion,
  filaVigente,
  parVigenteDelCobro,
  secuenciaSiguiente,
} from "./correccion";

const valor = (texto: string) => importeDesdeTexto(ARS, texto);
const ars = (monto: string) => ({ moneda: "ARS", monto });
const par = (medioDePagoId: string, cuentaDeCobroId: string | null = null) => ({
  medioDePagoId,
  cuentaDeCobroId,
});

describe("secuencias y fila vigente", () => {
  it("la siguiente es la mayor más uno; sin filas es 1", () => {
    expect(secuenciaSiguiente([])).toBe(1);
    expect(secuenciaSiguiente([1])).toBe(2);
    expect(secuenciaSiguiente([3, 1, 2])).toBe(4);
    expect(secuenciaSiguiente([2, 2])).toBe(3);
  });
  it("la vigente es la de mayor secuencia, en cualquier orden; sin filas, null", () => {
    expect(filaVigente([])).toBeNull();
    expect(
      filaVigente([
        { secuencia: 2, x: "b" },
        { secuencia: 3, x: "c" },
        { secuencia: 1, x: "a" },
      ]),
    ).toEqual({ secuencia: 3, x: "c" });
    expect(
      filaVigente([
        { secuencia: 1, x: "a" },
        { secuencia: 2, x: "b" },
      ]),
    ).toEqual({ secuencia: 2, x: "b" });
    expect(filaVigente([{ secuencia: 1, x: "a" }])).toEqual({ secuencia: 1, x: "a" });
    // Con secuencias repetidas (la base no lo permite) rige la primera que llegó.
    expect(
      filaVigente([
        { secuencia: 2, x: "primera" },
        { secuencia: 2, x: "segunda" },
      ]),
    ).toEqual({ secuencia: 2, x: "primera" });
  });
});

describe("corrección de medio de un cobro (e3b §4.3)", () => {
  it("el par vigente es el original o el destino de la última corrección", () => {
    expect(parVigenteDelCobro(par("credito"), [])).toEqual(par("credito"));
    expect(
      parVigenteDelCobro(par("credito"), [{ secuencia: 1, despues: par("debito", "t1") }]),
    ).toEqual(par("debito", "t1"));
    expect(
      parVigenteDelCobro(par("credito"), [
        { secuencia: 2, despues: par("efectivo") },
        { secuencia: 1, despues: par("debito", "t1") },
      ]),
    ).toEqual(par("efectivo"));
  });

  it("de crédito a débito: antes es el original, secuencia 1", () => {
    expect(
      decidirCorreccionDeMedio({
        original: par("credito", "t1"),
        correcciones: [],
        destino: par("debito", "t1"),
      }),
    ).toEqual({
      ok: true,
      valor: { antes: par("credito", "t1"), despues: par("debito", "t1"), secuencia: 1 },
    });
  });

  it("corregir de nuevo parte del vigente y suma una secuencia", () => {
    expect(
      decidirCorreccionDeMedio({
        original: par("credito"),
        correcciones: [{ secuencia: 1, despues: par("debito") }],
        destino: par("efectivo"),
      }),
    ).toEqual({
      ok: true,
      valor: { antes: par("debito"), despues: par("efectivo"), secuencia: 2 },
    });
  });

  it("volver al medio original es un cambio válido si el vigente es otro", () => {
    expect(
      decidirCorreccionDeMedio({
        original: par("credito"),
        correcciones: [{ secuencia: 1, despues: par("debito") }],
        destino: par("credito"),
      }).ok,
    ).toBe(true);
  });

  it("corregir al par que ya es el vigente no cambia nada, cambiando solo la cuenta sí", () => {
    expect(
      decidirCorreccionDeMedio({
        original: par("debito", "t1"),
        correcciones: [],
        destino: par("debito", "t1"),
      }),
    ).toEqual({
      ok: false,
      error: "MEDIO_DEL_COBRO_SIN_CAMBIOS",
    });
    expect(
      decidirCorreccionDeMedio({
        original: par("debito"),
        correcciones: [],
        destino: par("debito"),
      }),
    ).toEqual({
      ok: false,
      error: "MEDIO_DEL_COBRO_SIN_CAMBIOS",
    });
    expect(
      decidirCorreccionDeMedio({
        original: par("debito", "t1"),
        correcciones: [],
        destino: par("debito", "t2"),
      }).ok,
    ).toBe(true);
    expect(
      decidirCorreccionDeMedio({
        original: par("debito", "t1"),
        correcciones: [],
        destino: par("debito"),
      }).ok,
    ).toBe(true);
    expect(
      decidirCorreccionDeMedio({
        original: par("debito"),
        correcciones: [],
        destino: par("credito"),
      }).ok,
    ).toBe(true);
    // El original ya no es el vigente: volver a él es un cambio, quedarse en el vigente no.
    expect(
      decidirCorreccionDeMedio({
        original: par("credito"),
        correcciones: [{ secuencia: 1, despues: par("debito") }],
        destino: par("debito"),
      }),
    ).toEqual({ ok: false, error: "MEDIO_DEL_COBRO_SIN_CAMBIOS" });
  });
});

describe("declaración de totales (e3b §4.4)", () => {
  it("de un medio que no es efectivo: importe >= 0 y la secuencia siguiente", () => {
    expect(
      decidirDeclaracion({
        tipoDeMedio: "TARJETA_DEBITO",
        importe: ars("18400"),
        secuenciasDelPar: [],
      }),
    ).toEqual({
      ok: true,
      valor: { importe: valor("18400"), secuencia: 1 },
    });
    expect(
      decidirDeclaracion({ tipoDeMedio: "QR", importe: ars("0"), secuenciasDelPar: [1, 2] }),
    ).toEqual({
      ok: true,
      valor: { importe: valor("0"), secuencia: 3 },
    });
  });
  it("el efectivo no se declara: se cuenta por billetes al cerrar cada caja", () => {
    expect(
      decidirDeclaracion({ tipoDeMedio: "EFECTIVO", importe: ars("5"), secuenciasDelPar: [] }),
    ).toEqual({ ok: false, error: "MEDIO_NO_DECLARABLE" });
    expect(
      decidirDeclaracion({ tipoDeMedio: "EFECTIVO", importe: ars("x"), secuenciasDelPar: [] }),
    ).toEqual({ ok: false, error: "MEDIO_NO_DECLARABLE" });
  });
  it("el importe mal escrito, negativo, excedido o en otra moneda se rechaza", () => {
    expect(
      decidirDeclaracion({ tipoDeMedio: "OTRO", importe: ars("-1"), secuenciasDelPar: [] }),
    ).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(
      decidirDeclaracion({ tipoDeMedio: "OTRO", importe: ars("1000000000"), secuenciasDelPar: [] }),
    ).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(
      decidirDeclaracion({
        tipoDeMedio: "OTRO",
        importe: ars("999999999.99"),
        secuenciasDelPar: [],
      }).ok,
    ).toBe(true);
    expect(
      decidirDeclaracion({
        tipoDeMedio: "OTRO",
        importe: { moneda: "USD", monto: "1" },
        secuenciasDelPar: [],
      }),
    ).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
  });
});
