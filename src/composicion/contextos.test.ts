import { describe, expect, it } from "vitest";
import {
  adminPlataformaId,
  empresaId,
  marcaComercialId,
  personaId,
  usuarioAuthId,
} from "../primitivas/identificadores/marca";
import {
  contextoDeInvitacion,
  contextoDePlataforma,
  contextoDeSesion,
  contextoOperativo,
} from "./contextos";

const AHORA = new Date("2026-10-13T12:00:00.000Z");
const EMPRESA = empresaId("11111111-1111-4111-8111-111111111111");
const PERSONA = personaId("22222222-2222-4222-8222-222222222222");
const MARCA = marcaComercialId("33333333-3333-4333-8333-333333333333");
const HASH = "a".repeat(64);
const USUARIO = usuarioAuthId("44444444-4444-4444-8444-444444444444");

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
    expect(contextoDeInvitacion({ tokenHash: HASH, usuarioAuth: null, ahora: AHORA })).toEqual({
      tipo: "INVITACION",
      tokenHash: HASH,
      usuarioAuth: null,
      ahora: AHORA,
    });
  });

  it("rechaza una hora inválida", () => {
    expect(() =>
      contextoDeInvitacion({ tokenHash: HASH, usuarioAuth: null, ahora: new Date(Number.NaN) }),
    ).toThrow(RangeError);
  });
});

describe("contextoDeInvitacion con el usuario que ya ingresó", () => {
  it("lleva el usuario autenticado al contexto", () => {
    expect(contextoDeInvitacion({ tokenHash: HASH, usuarioAuth: USUARIO, ahora: AHORA })).toEqual({
      tipo: "INVITACION",
      tokenHash: HASH,
      usuarioAuth: USUARIO,
      ahora: AHORA,
    });
  });

  it("solo copia los campos del contexto: un dato de más no se cuela", () => {
    const datos = { tokenHash: HASH, usuarioAuth: USUARIO, ahora: AHORA, empresaId: EMPRESA };
    expect(Object.keys(contextoDeInvitacion(datos)).sort()).toEqual([
      "ahora",
      "tipo",
      "tokenHash",
      "usuarioAuth",
    ]);
  });
});

describe("contextoDeSesion", () => {
  it("arma el contexto con el usuario de la sesión y la hora que recibe", () => {
    expect(contextoDeSesion({ usuarioAuth: USUARIO, ahora: AHORA })).toEqual({
      tipo: "SESION",
      usuarioAuth: USUARIO,
      ahora: AHORA,
    });
  });

  it("solo copia los campos del contexto: ni empresa ni persona ni marca se cuelan", () => {
    const datos = {
      usuarioAuth: USUARIO,
      ahora: AHORA,
      empresaId: EMPRESA,
      personaId: PERSONA,
      marcaDeEntrada: MARCA,
    };
    expect(Object.keys(contextoDeSesion(datos)).sort()).toEqual(["ahora", "tipo", "usuarioAuth"]);
  });

  it("rechaza una hora inválida", () => {
    expect(() => contextoDeSesion({ usuarioAuth: USUARIO, ahora: new Date(Number.NaN) })).toThrow(
      "ahora debe ser una fecha válida",
    );
  });
});

describe("contextoDePlataforma", () => {
  const ADMIN = adminPlataformaId("55555555-5555-4555-8555-555555555555");

  it("arma el contexto con el administrador y la hora que recibe", () => {
    expect(contextoDePlataforma({ actor: { tipo: "ADMIN", id: ADMIN }, ahora: AHORA })).toEqual({
      tipo: "PLATAFORMA",
      actor: { tipo: "ADMIN", id: ADMIN },
      ahora: AHORA,
    });
  });

  it("también arma el del sistema", () => {
    const actor = { tipo: "SISTEMA", proceso: "barrido-de-altas" } as const;
    expect(contextoDePlataforma({ actor, ahora: AHORA })).toEqual({
      tipo: "PLATAFORMA",
      actor,
      ahora: AHORA,
    });
  });

  it("solo copia los campos del contexto: un dato de más no se cuela", () => {
    const datos = { actor: { tipo: "ADMIN", id: ADMIN }, ahora: AHORA, rol: "ADMIN" } as const;
    expect(Object.keys(contextoDePlataforma(datos)).sort()).toEqual(["actor", "ahora", "tipo"]);
  });

  it("rechaza una hora inválida", () => {
    expect(() =>
      contextoDePlataforma({
        actor: { tipo: "ADMIN", id: ADMIN },
        ahora: new Date("no es una fecha"),
      }),
    ).toThrow("ahora debe ser una fecha válida");
  });
});
