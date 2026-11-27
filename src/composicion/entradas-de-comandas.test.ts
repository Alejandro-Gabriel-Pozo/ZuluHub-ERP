import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeAnular,
  leerElPedidoDeCambiarNota,
  leerElPedidoDeCambiarSalida,
  leerElPedidoDeDeclarar,
  leerElPedidoDeEditarImpresora,
  leerElPedidoDeEnviar,
  leerElPedidoDeImprimir,
  leerElPedidoDeLosTrabajos,
  leerElPedidoDePedirQueSalga,
  leerElPedidoDeQuitarSinEnviar,
  leerElPedidoDeRegistrarImpresora,
  leerElPedidoDeUnaImpresora,
  leerElPedidoDelDocumento,
} from "./entradas-de-comandas";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const CLAVE = "clave-abcdefghijklmnop";

describe("entradas de las comandas y de la impresión", () => {
  it("enviar: lee el id, la cuenta y la clave; descarta el rótulo, la sucursal y la persona (los arma o los pone el servidor)", () => {
    expect(
      leerElPedidoDeEnviar({
        envioId: ID,
        cuentaId: OTRO,
        claveIdempotencia: CLAVE,
        rotulo: "Mesa 99",
        sucursalId: "x",
        personaId: "y",
      }),
    ).toEqual({ ok: true, valor: { envioId: ID, cuentaId: OTRO, claveIdempotencia: CLAVE } });
  });

  it("la clave de idempotencia solo pasa con la forma que define comandas (`exigirClave`)", () => {
    for (const clave of [
      "",
      "corta",
      "con espacios que no valen todos",
      "ñ".repeat(20),
      "a".repeat(129),
      5,
      null,
    ]) {
      expect(
        leerElPedidoDeEnviar({ envioId: ID, cuentaId: OTRO, claveIdempotencia: clave }).ok,
      ).toBe(false);
    }
    expect(
      leerElPedidoDeEnviar({ envioId: ID, cuentaId: OTRO, claveIdempotencia: "a".repeat(16) }).ok,
    ).toBe(true);
    expect(
      leerElPedidoDeEnviar({ envioId: ID, cuentaId: OTRO, claveIdempotencia: "a".repeat(128) }).ok,
    ).toBe(true);
    expect(leerElPedidoDeEnviar({ envioId: ID, cuentaId: OTRO, claveIdempotencia: ID }).ok).toBe(
      true,
    );
  });

  it("pedir que salga: «TODAS» o una lista de ids (no vacía, con forma de id, con tope)", () => {
    const base = { envioId: ID, cuentaId: OTRO, claveIdempotencia: CLAVE };
    expect(leerElPedidoDePedirQueSalga({ ...base, lineaIds: "TODAS" }).ok).toBe(true);
    expect(leerElPedidoDePedirQueSalga({ ...base, lineaIds: [ID, OTRO] })).toMatchObject({
      ok: true,
      valor: { lineaIds: [ID, OTRO] },
    });
    for (const lineaIds of [
      [],
      ["x"],
      "todas",
      "TODAS ",
      null,
      undefined,
      [ID, 3],
      Array(201).fill(ID),
    ]) {
      expect(leerElPedidoDePedirQueSalga({ ...base, lineaIds }).ok, JSON.stringify(lineaIds)).toBe(
        false,
      );
    }
  });

  it("anular: la cantidad llega como texto, nunca como número; el motivo es texto", () => {
    const base = {
      cuentaId: ID,
      lineaId: OTRO,
      cantidad: "1.5",
      motivo: "Error del mozo",
      avisoId: ID,
    };
    expect(leerElPedidoDeAnular(base)).toEqual({ ok: true, valor: base });
    for (const malo of [
      { cantidad: 1 },
      { cantidad: null },
      { motivo: 3 },
      { avisoId: "x" },
      { lineaId: "" },
    ]) {
      expect(leerElPedidoDeAnular({ ...base, ...malo }).ok).toBe(false);
    }
    expect(leerElPedidoDeAnular({ ...base, cantidad: "9".repeat(41) }).ok).toBe(false);
  });

  it("orden de salida: solo AHORA o DESPUES", () => {
    const base = { cuentaId: ID, lineaId: OTRO };
    for (const salida of ["AHORA", "DESPUES"]) {
      expect(leerElPedidoDeCambiarSalida({ ...base, salida }).ok).toBe(true);
    }
    for (const salida of ["ESPERA", "ahora", "", undefined, 1]) {
      expect(leerElPedidoDeCambiarSalida({ ...base, salida }).ok).toBe(false);
    }
  });

  it("nota para la cocina: la cuenta, la línea y la nota como texto (vacío la quita); la sucursal y lo demás se descartan", () => {
    const base = { cuentaId: ID, lineaId: OTRO };
    expect(leerElPedidoDeCambiarNota({ ...base, nota: "sin cebolla", sucursalId: "x" })).toEqual({
      ok: true,
      valor: { ...base, nota: "sin cebolla" },
    });
    expect(leerElPedidoDeCambiarNota({ ...base, nota: "" }).ok).toBe(true);
    for (const nota of [undefined, null, 1, {}, "x".repeat(1001)]) {
      expect(leerElPedidoDeCambiarNota({ ...base, nota }).ok).toBe(false);
    }
    expect(leerElPedidoDeCambiarNota({ cuentaId: "x", lineaId: OTRO, nota: "a" }).ok).toBe(false);
  });

  it("quitar sin enviar: solo la cuenta y la línea; el motivo y lo demás se descartan", () => {
    expect(
      leerElPedidoDeQuitarSinEnviar({
        cuentaId: ID,
        lineaId: OTRO,
        motivo: "otro",
        sucursalId: "x",
      }),
    ).toEqual({ ok: true, valor: { cuentaId: ID, lineaId: OTRO } });
    for (const malo of [{ cuentaId: ID }, { cuentaId: ID, lineaId: "x" }, undefined, null]) {
      expect(leerElPedidoDeQuitarSinEnviar(malo).ok).toBe(false);
    }
  });

  it("impresoras: alta, edición con versión y desactivar; el papel es entero (el dominio decide si es 58 u 80)", () => {
    const alta = { impresoraId: ID, nombre: "Cocina", uso: "COMANDA", papelMm: 80 };
    expect(leerElPedidoDeRegistrarImpresora({ ...alta, sucursalId: "x" })).toEqual({
      ok: true,
      valor: alta,
    });
    expect(leerElPedidoDeRegistrarImpresora({ ...alta, papelMm: "58" })).toMatchObject({
      ok: true,
      valor: { papelMm: 58 },
    });
    for (const malo of [
      { papelMm: "80.5" },
      { papelMm: -1 },
      { uso: "comanda" },
      { uso: "" },
      { nombre: 5 },
      { impresoraId: "x" },
    ]) {
      expect(leerElPedidoDeRegistrarImpresora({ ...alta, ...malo }).ok, JSON.stringify(malo)).toBe(
        false,
      );
    }
    expect(leerElPedidoDeEditarImpresora({ impresoraId: ID, versionEsperada: 2 })).toEqual({
      ok: true,
      valor: { impresoraId: ID, versionEsperada: 2 },
    });
    expect(leerElPedidoDeEditarImpresora({ impresoraId: ID, nombre: "Barra" }).ok).toBe(false);
    expect(leerElPedidoDeUnaImpresora({ impresoraId: ID, activa: true })).toEqual({
      ok: true,
      valor: { impresoraId: ID },
    });
    expect(leerElPedidoDeUnaImpresora({ impresoraId: "x" }).ok).toBe(false);
  });

  it("imprimir y copia: el trabajo, el tipo de documento (palabra en mayúscula), el documento, la impresora opcional y la clave", () => {
    const base = {
      trabajoId: ID,
      documentoTipo: "COMANDA",
      documentoId: OTRO,
      claveIdempotencia: CLAVE,
    };
    expect(leerElPedidoDeImprimir({ ...base, sucursalId: "x" })).toEqual({ ok: true, valor: base });
    expect(leerElPedidoDeImprimir({ ...base, impresoraId: ID })).toMatchObject({
      ok: true,
      valor: { impresoraId: ID },
    });
    for (const malo of [
      { documentoTipo: "comanda" },
      { documentoTipo: "" },
      { impresoraId: "x" },
      { claveIdempotencia: "x" },
      { trabajoId: 1 },
    ]) {
      expect(leerElPedidoDeImprimir({ ...base, ...malo }).ok, JSON.stringify(malo)).toBe(false);
    }
  });

  it("declarar el resultado, los trabajos de un documento y el papel", () => {
    expect(leerElPedidoDeDeclarar({ trabajoId: ID, numero: "2", resultado: "IMPRESA" })).toEqual({
      ok: true,
      valor: { trabajoId: ID, numero: 2, resultado: "IMPRESA" },
    });
    expect(leerElPedidoDeDeclarar({ trabajoId: ID, numero: "x", resultado: "IMPRESA" }).ok).toBe(
      false,
    );
    expect(leerElPedidoDeDeclarar({ trabajoId: ID, numero: 1, resultado: "impresa" }).ok).toBe(
      false,
    );
    expect(leerElPedidoDeLosTrabajos({ documentoId: ID, otro: 1 })).toEqual({
      ok: true,
      valor: { documentoId: ID },
    });
    expect(leerElPedidoDeLosTrabajos({ documentoId: "x" }).ok).toBe(false);
    expect(
      leerElPedidoDelDocumento({ documentoTipo: "TICKET", documentoId: ID, copia: true }),
    ).toEqual({
      ok: true,
      valor: { documentoTipo: "TICKET", documentoId: ID, copia: true },
    });
    expect(
      leerElPedidoDelDocumento({ documentoTipo: "TICKET", documentoId: ID, copia: "si" }).ok,
    ).toBe(false);
  });
});
