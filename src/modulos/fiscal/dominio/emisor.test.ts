import { describe, expect, it } from "vitest";
import type { EstadoDeEmpresa } from "../../../contexto/estados";
import {
  CUIT_A,
  CUIT_B,
  CUIT_C,
  CUIT_D,
  EMISOR_1,
  EMPRESA,
  emisor,
} from "../../../../test/utilidades/fiscal";
import {
  CONDICIONES_DE_IVA,
  corregirCuit,
  desactivarEmisor,
  esCondicionDeIva,
  nuevoEmisorSecundario,
} from "./emisor";

describe("condición frente al IVA", () => {
  it("la lista es la del diseño (códigos de ARCA no verificados)", () => {
    expect(CONDICIONES_DE_IVA).toEqual(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO"]);
  });

  it("se reconoce solo el texto exacto", () => {
    for (const c of CONDICIONES_DE_IVA) expect(esCondicionDeIva(c)).toBe(true);
    expect(esCondicionDeIva("monotributo")).toBe(false);
    expect(esCondicionDeIva("")).toBe(false);
    expect(esCondicionDeIva("CONSUMIDOR_FINAL")).toBe(false);
  });
});

describe("nuevoEmisorSecundario", () => {
  const datos = { id: EMISOR_1, empresaId: EMPRESA, cuit: CUIT_B };
  const sinUso = { cuitsEnUso: new Set([CUIT_A]) };

  it("nace secundario, activo y con su CUIT, en una empresa activa o suspendida", () => {
    for (const estado of ["ACTIVE", "SUSPENDED"] as const) {
      expect(nuevoEmisorSecundario(datos, estado, sinUso)).toEqual({
        ok: true,
        valor: {
          id: EMISOR_1,
          empresaId: EMPRESA,
          esPrincipal: false,
          cuit: CUIT_B,
          activo: true,
          version: 1,
        },
      });
    }
  });

  it.each<EstadoDeEmpresa>(["PROVISIONING", "CANCELLED", "DELETING"])(
    "no nace en una empresa %s",
    (estado) => {
      expect(nuevoEmisorSecundario(datos, estado, sinUso)).toEqual({
        ok: false,
        error: "EMPRESA_NO_OPERABLE",
      });
    },
  );

  it("el CUIT no puede estar tomado por otra empresa ni por otro emisor", () => {
    expect(nuevoEmisorSecundario(datos, "ACTIVE", { cuitsEnUso: new Set([CUIT_B]) })).toEqual({
      ok: false,
      error: "CUIT_EN_USO",
    });
    expect(
      nuevoEmisorSecundario(datos, "ACTIVE", { cuitsEnUso: new Set([CUIT_A, CUIT_C, CUIT_B]) }),
    ).toEqual({ ok: false, error: "CUIT_EN_USO" });
  });

  it("la empresa que no opera se informa antes que el CUIT tomado", () => {
    expect(nuevoEmisorSecundario(datos, "CANCELLED", { cuitsEnUso: new Set([CUIT_B]) })).toEqual({
      ok: false,
      error: "EMPRESA_NO_OPERABLE",
    });
  });
});

describe("desactivarEmisor", () => {
  it("el principal nunca se desactiva, ni activo ni con cero puntos de venta", () => {
    const principal = emisor({ esPrincipal: true });
    expect(desactivarEmisor(principal, 0)).toEqual({
      ok: false,
      error: "EMISOR_PRINCIPAL_NO_SE_DESACTIVA",
    });
    expect(desactivarEmisor(principal, 3)).toEqual({
      ok: false,
      error: "EMISOR_PRINCIPAL_NO_SE_DESACTIVA",
    });
  });

  it("un secundario sin puntos de venta activos se desactiva", () => {
    const e = emisor();
    expect(desactivarEmisor(e, 0)).toEqual({
      ok: true,
      valor: { emisor: { ...e, activo: false }, cambio: true },
    });
  });

  it("con puntos de venta activos no se desactiva", () => {
    expect(desactivarEmisor(emisor(), 1)).toEqual({
      ok: false,
      error: "EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS",
    });
  });

  it("desactivar uno ya inactivo no cambia nada (idempotente)", () => {
    const inactivo = emisor({ activo: false });
    const r = desactivarEmisor(inactivo, 0);
    expect(r).toEqual({ ok: true, valor: { emisor: inactivo, cambio: false } });
  });
});

describe("corregirCuit", () => {
  const libre = { tieneNumerosUsados: false, cuitsEnUso: new Set([CUIT_A, CUIT_B]) };

  it("hasta el primer número usado el CUIT se puede corregir", () => {
    const e = emisor();
    expect(corregirCuit(e, CUIT_D, libre)).toEqual({
      ok: true,
      valor: { emisor: { ...e, cuit: CUIT_D }, cambio: true },
    });
  });

  it("con números usados el CUIT es inmutable, también el del principal", () => {
    const usado = { ...libre, tieneNumerosUsados: true };
    expect(corregirCuit(emisor(), CUIT_D, usado)).toEqual({ ok: false, error: "CUIT_INMUTABLE" });
    expect(corregirCuit(emisor({ esPrincipal: true }), CUIT_D, usado)).toEqual({
      ok: false,
      error: "CUIT_INMUTABLE",
    });
  });

  it("corregir al mismo CUIT no cambia nada, haya o no números usados", () => {
    const e = emisor();
    expect(corregirCuit(e, e.cuit, libre)).toEqual({
      ok: true,
      valor: { emisor: e, cambio: false },
    });
    expect(corregirCuit(e, e.cuit, { ...libre, tieneNumerosUsados: true })).toEqual({
      ok: true,
      valor: { emisor: e, cambio: false },
    });
  });

  it("el CUIT nuevo no puede estar tomado", () => {
    expect(corregirCuit(emisor(), CUIT_A, libre)).toEqual({ ok: false, error: "CUIT_EN_USO" });
  });

  it("la inmutabilidad se informa antes que el CUIT tomado", () => {
    expect(corregirCuit(emisor(), CUIT_A, { ...libre, tieneNumerosUsados: true })).toEqual({
      ok: false,
      error: "CUIT_INMUTABLE",
    });
  });
});
