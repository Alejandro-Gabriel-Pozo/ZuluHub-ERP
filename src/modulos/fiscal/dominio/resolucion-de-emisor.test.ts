import { describe, expect, it } from "vitest";
import {
  EMISOR_1,
  EMISOR_2,
  EMISOR_3,
  EMPRESA,
  GERENTE,
  VERSION_1,
} from "../../../../test/utilidades/fiscal";
import { puntoDeVentaId } from "./identificadores";
import {
  REGLA_DE_EMISOR_POR_DEFECTO,
  confirmarReglaDeEmisor,
  reglaDeEmisorVigente,
  resolverEmisor,
  resolverEmisoresDeLineas,
  type DatosDeLinea,
  type DatosDeVenta,
  type ReglaDeEmisor,
} from "./resolucion-de-emisor";

const permisiva: ReglaDeEmisor = { permitirEleccionManual: true };
const estricta: ReglaDeEmisor = { permitirEleccionManual: false };
const activos = new Set([EMISOR_1, EMISOR_2]);

const venta = (cambios: Partial<DatosDeVenta> = {}): DatosDeVenta => ({
  puntoDeVentaElegido: null,
  eleccionManual: null,
  emisoresActivos: activos,
  ...cambios,
});
const linea = (cambios: Partial<DatosDeLinea> = {}): DatosDeLinea => ({
  emisorDelProducto: null,
  emisorDelDeposito: null,
  ...cambios,
});
const pv = { id: puntoDeVentaId("pv-1"), emisorId: EMISOR_2 };

describe("resolverEmisor: la cascada", () => {
  it("1. el producto exclusivo gana", () => {
    expect(resolverEmisor(permisiva, venta(), linea({ emisorDelProducto: EMISOR_1 }))).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_1, motivo: "EXCLUSIVO" },
    });
  });

  it("1. el depósito exclusivo gana", () => {
    expect(resolverEmisor(permisiva, venta(), linea({ emisorDelDeposito: EMISOR_2 }))).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_2, motivo: "EXCLUSIVO" },
    });
  });

  it("1. producto y depósito del mismo emisor: ese emisor", () => {
    const l = linea({ emisorDelProducto: EMISOR_1, emisorDelDeposito: EMISOR_1 });
    expect(resolverEmisor(permisiva, venta(), l)).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_1, motivo: "EXCLUSIVO" },
    });
  });

  it("1. producto y depósito de emisores distintos: conflicto", () => {
    const l = linea({ emisorDelProducto: EMISOR_1, emisorDelDeposito: EMISOR_2 });
    expect(resolverEmisor(permisiva, venta(), l)).toEqual({
      ok: false,
      error: "EMISOR_EN_CONFLICTO",
    });
  });

  it("lo exclusivo no se pisa con el punto de venta elegido ni con la elección manual", () => {
    const l = linea({ emisorDelProducto: EMISOR_1 });
    const v = venta({ puntoDeVentaElegido: pv, eleccionManual: EMISOR_2 });
    expect(resolverEmisor(permisiva, v, l)).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_1, motivo: "EXCLUSIVO" },
    });
    expect(resolverEmisor(estricta, v, l)).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_1, motivo: "EXCLUSIVO" },
    });
  });

  it("2. sin exclusivo gana el emisor del punto de venta elegido", () => {
    expect(resolverEmisor(permisiva, venta({ puntoDeVentaElegido: pv }), linea())).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_2, motivo: "PUNTO_DE_VENTA" },
    });
  });

  it("2. el punto de venta elegido gana sobre la elección manual y no necesita que esté permitida", () => {
    const v = venta({ puntoDeVentaElegido: pv, eleccionManual: EMISOR_1 });
    expect(resolverEmisor(estricta, v, linea())).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_2, motivo: "PUNTO_DE_VENTA" },
    });
  });

  it("3. sin exclusivo ni punto de venta rige la elección manual, si la regla la permite", () => {
    expect(resolverEmisor(permisiva, venta({ eleccionManual: EMISOR_1 }), linea())).toEqual({
      ok: true,
      valor: { emisorId: EMISOR_1, motivo: "MANUAL" },
    });
  });

  it("3. la elección manual no permitida se rechaza", () => {
    expect(resolverEmisor(estricta, venta({ eleccionManual: EMISOR_1 }), linea())).toEqual({
      ok: false,
      error: "ELECCION_MANUAL_NO_PERMITIDA",
    });
  });

  it("sin nada que lo resuelva: emisor no resuelto, con cualquier regla", () => {
    expect(resolverEmisor(permisiva, venta(), linea())).toEqual({
      ok: false,
      error: "EMISOR_NO_RESUELTO",
    });
    expect(resolverEmisor(estricta, venta(), linea())).toEqual({
      ok: false,
      error: "EMISOR_NO_RESUELTO",
    });
  });
});

describe("resolverEmisor: el emisor tiene que estar activo", () => {
  it("un exclusivo inactivo se rechaza", () => {
    expect(resolverEmisor(permisiva, venta(), linea({ emisorDelProducto: EMISOR_3 }))).toEqual({
      ok: false,
      error: "EMISOR_INACTIVO",
    });
    expect(resolverEmisor(permisiva, venta(), linea({ emisorDelDeposito: EMISOR_3 }))).toEqual({
      ok: false,
      error: "EMISOR_INACTIVO",
    });
  });

  it("el emisor de un punto de venta elegido inactivo se rechaza", () => {
    const v = venta({ puntoDeVentaElegido: { id: pv.id, emisorId: EMISOR_3 } });
    expect(resolverEmisor(permisiva, v, linea())).toEqual({ ok: false, error: "EMISOR_INACTIVO" });
  });

  it("una elección manual inactiva se rechaza", () => {
    expect(resolverEmisor(permisiva, venta({ eleccionManual: EMISOR_3 }), linea())).toEqual({
      ok: false,
      error: "EMISOR_INACTIVO",
    });
  });

  it("el conflicto se informa antes que la inactividad", () => {
    const l = linea({ emisorDelProducto: EMISOR_3, emisorDelDeposito: EMISOR_1 });
    expect(resolverEmisor(permisiva, venta(), l)).toEqual({
      ok: false,
      error: "EMISOR_EN_CONFLICTO",
    });
  });

  it("la elección manual no permitida se informa antes que la inactividad", () => {
    expect(resolverEmisor(estricta, venta({ eleccionManual: EMISOR_3 }), linea())).toEqual({
      ok: false,
      error: "ELECCION_MANUAL_NO_PERMITIDA",
    });
  });
});

describe("regla por defecto y regla vigente", () => {
  const v = (numero: number, desde: number, permitir: boolean) => ({
    numero,
    vigenteDesde: new Date(desde),
    permitirEleccionManual: permitir,
  });

  it("sin versiones rige la elección manual permitida", () => {
    expect(REGLA_DE_EMISOR_POR_DEFECTO).toEqual({ permitirEleccionManual: true });
    expect(reglaDeEmisorVigente([], new Date(100))).toEqual({ permitirEleccionManual: true });
  });

  it("con versiones todas futuras rige la de por defecto", () => {
    expect(reglaDeEmisorVigente([v(1, 200, false)], new Date(100))).toEqual({
      permitirEleccionManual: true,
    });
  });

  it("rige la versión vigente en ese instante", () => {
    const versiones = [v(1, 100, false), v(2, 200, true), v(3, 300, false)];
    expect(reglaDeEmisorVigente(versiones, new Date(150))).toEqual({
      permitirEleccionManual: false,
    });
    expect(reglaDeEmisorVigente(versiones, new Date(250))).toEqual({
      permitirEleccionManual: true,
    });
    expect(reglaDeEmisorVigente(versiones, new Date(300))).toEqual({
      permitirEleccionManual: false,
    });
  });
});

describe("confirmarReglaDeEmisor", () => {
  const datos = {
    id: VERSION_1,
    empresaId: EMPRESA,
    ahora: new Date(1000),
    vigenteDesde: new Date(2000),
    motivo: " solo el gerente elige ",
    confirmadaPor: GERENTE,
  };

  it("confirma la versión con su número, vigencia y quién la confirmó", () => {
    const existentes = [{ numero: 1, vigenteDesde: new Date(0), permitirEleccionManual: true }];
    expect(confirmarReglaDeEmisor(estricta, existentes, datos)).toEqual({
      ok: true,
      valor: {
        id: VERSION_1,
        empresaId: EMPRESA,
        permitirEleccionManual: false,
        numero: 2,
        vigenteDesde: new Date(2000),
        confirmadaEn: new Date(1000),
        confirmadaPor: GERENTE,
        motivo: "solo el gerente elige",
      },
    });
  });

  it("la primera versión es la 1 y la regla permisiva se guarda como tal", () => {
    const r = confirmarReglaDeEmisor(permisiva, [], datos);
    expect(r.ok && r.valor.numero).toBe(1);
    expect(r.ok && r.valor.permitirEleccionManual).toBe(true);
  });

  it("el motivo es obligatorio y no hay vigencia retroactiva", () => {
    expect(confirmarReglaDeEmisor(permisiva, [], { ...datos, motivo: "" })).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
    expect(
      confirmarReglaDeEmisor(permisiva, [], { ...datos, vigenteDesde: new Date(999) }),
    ).toEqual({ ok: false, error: "VIGENCIA_RETROACTIVA" });
  });
});

describe("resolverEmisoresDeLineas", () => {
  it("resuelve cada línea conservando su posición", () => {
    const lineas = [
      { posicion: 1, ...linea({ emisorDelProducto: EMISOR_1 }) },
      { posicion: 2, ...linea() },
      { posicion: 3, ...linea({ emisorDelDeposito: EMISOR_2 }) },
    ];
    expect(resolverEmisoresDeLineas(permisiva, venta({ puntoDeVentaElegido: pv }), lineas)).toEqual(
      {
        ok: true,
        valor: [
          { posicion: 1, emisorId: EMISOR_1, motivo: "EXCLUSIVO" },
          { posicion: 2, emisorId: EMISOR_2, motivo: "PUNTO_DE_VENTA" },
          { posicion: 3, emisorId: EMISOR_2, motivo: "EXCLUSIVO" },
        ],
      },
    );
  });

  it("una venta sin líneas no tiene nada que resolver", () => {
    expect(resolverEmisoresDeLineas(permisiva, venta(), [])).toEqual({ ok: true, valor: [] });
  });

  it("el primer error corta e indica la posición de la línea", () => {
    const lineas = [
      { posicion: 4, ...linea({ emisorDelProducto: EMISOR_1 }) },
      { posicion: 5, ...linea() },
      { posicion: 6, ...linea({ emisorDelProducto: EMISOR_3 }) },
    ];
    expect(resolverEmisoresDeLineas(permisiva, venta(), lineas)).toEqual({
      ok: false,
      error: { posicion: 5, error: "EMISOR_NO_RESUELTO" },
    });
  });
});
