import { describe, expect, it } from "vitest";
import { empresaId, marcaComercialId, personaId } from "../primitivas/identificadores/marca";
import { contextoDeInvitacion, contextoOperativo } from "./contextos";

const AHORA = new Date("2026-10-13T12:00:00.000Z");
const EMPRESA = empresaId("11111111-1111-4111-8111-111111111111");
const PERSONA = personaId("22222222-2222-4222-8222-222222222222");
const MARCA = marcaComercialId("33333333-3333-4333-8333-333333333333");
const HASH = "a".repeat(64);

describe("contextoOperativo", () => {
  it("arma el contexto con la empresa, la persona, la marca de entrada y la hora que recibe", () => {
    expect(
      contextoOperativo({
        empresaId: EMPRESA,
        personaId: PERSONA,
        marcaDeEntrada: MARCA,
        ahora: AHORA,
      }),
    ).toEqual({
      tipo: "OPERATIVO",
      empresaId: EMPRESA,
      personaId: PERSONA,
      marcaDeEntrada: MARCA,
      ahora: AHORA,
    });
  });

  it("solo copia los campos del contexto: un dato de más no se cuela", () => {
    const datos = {
      empresaId: EMPRESA,
      personaId: PERSONA,
      marcaDeEntrada: MARCA,
      ahora: AHORA,
      rol: "ADMIN",
    };
    expect(Object.keys(contextoOperativo(datos)).sort()).toEqual([
      "ahora",
      "empresaId",
      "marcaDeEntrada",
      "personaId",
      "tipo",
    ]);
  });

  it("rechaza una hora inválida", () => {
    expect(() =>
      contextoOperativo({
        empresaId: EMPRESA,
        personaId: PERSONA,
        marcaDeEntrada: MARCA,
        ahora: new Date("no es una fecha"),
      }),
    ).toThrow("ahora debe ser una fecha válida");
  });
});

describe("contextoDeInvitacion", () => {
  it("arma el contexto con el hash del token y la hora que recibe", () => {
    expect(contextoDeInvitacion({ tokenHash: HASH, ahora: AHORA })).toEqual({
      tipo: "INVITACION",
      tokenHash: HASH,
      ahora: AHORA,
    });
  });

  it("rechaza una hora inválida", () => {
    expect(() => contextoDeInvitacion({ tokenHash: HASH, ahora: new Date(Number.NaN) })).toThrow(
      RangeError,
    );
  });
});
