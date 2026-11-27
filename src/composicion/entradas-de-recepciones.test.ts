import { describe, expect, it } from "vitest";
import {
  entradaDeAnularRecepcion,
  entradaDeConfirmarRecepcion,
  entradaDeCorregirLoRecibido,
  entradaDeFichaDeRecepcion,
  entradaDeListarRecepciones,
  entradaDeRegistrarRecepcion,
} from "./entradas-de-recepciones";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const renglon = { productoId: ID, unidadDeCompraId: "KILOGRAMO", cantidad: "2" };
const registrar = (extra: Record<string, unknown> = {}) => ({
  clave: OTRO,
  proveedorId: ID,
  renglones: [renglon],
  ...extra,
});

describe("entradaDeRegistrarRecepcion: lista de permitidos y SIN precio", () => {
  it("toma lo declarado y arma el renglón sin precio, «por unidad», sin unidad de precio ni presentación", () => {
    expect(entradaDeRegistrarRecepcion(registrar())).toEqual({
      ok: true,
      valor: {
        clave: OTRO,
        proveedorId: ID,
        remito: null,
        renglones: [
          {
            productoId: ID,
            presentacionId: null,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            pesoReal: null,
            precioPor: "UNIDAD",
            unidadDePrecioId: null,
            precio: null,
          },
        ],
      },
    });
  });

  it("un precio, un «precio por», una unidad de precio o un campo inventado NO se ignoran: el pedido es inválido", () => {
    const con = (campo: Record<string, unknown>) =>
      entradaDeRegistrarRecepcion(registrar({ renglones: [{ ...renglon, ...campo }] }));
    for (const campo of [
      { precio: "1000.00" },
      { precio: null },
      { precioPor: "UNIDAD" },
      { unidadDePrecioId: "KILOGRAMO" },
      { presentacionId: ID },
      { costo: "1" },
    ]) {
      expect(con(campo).ok).toBe(false);
    }
  });

  it("la empresa, la persona, la sucursal, el depósito, la factura o una clave de más no entran", () => {
    for (const extra of [
      { empresaId: ID },
      { personaId: ID },
      { sucursalId: ID },
      { depositoId: ID },
      { factura: {} },
    ]) {
      expect(entradaDeRegistrarRecepcion(registrar(extra)).ok).toBe(false);
    }
  });

  it("la clave y el proveedor son UUID; sin renglones, cantidad como número o unidad desconocida no pasa", () => {
    expect(entradaDeRegistrarRecepcion(registrar({ clave: "abc" })).ok).toBe(false);
    expect(entradaDeRegistrarRecepcion(registrar({ proveedorId: "abc" })).ok).toBe(false);
    expect(entradaDeRegistrarRecepcion(registrar({ renglones: [] })).ok).toBe(false);
    expect(
      entradaDeRegistrarRecepcion(registrar({ renglones: [{ ...renglon, cantidad: 2 }] })).ok,
    ).toBe(false);
    expect(
      entradaDeRegistrarRecepcion(
        registrar({ renglones: [{ ...renglon, unidadDeCompraId: "PARSEC" }] }),
      ).ok,
    ).toBe(false);
  });

  it("el remito: todo en blanco es «sin remito», completo se lee, a medio llenar se rechaza", () => {
    const remito = (r: unknown) => entradaDeRegistrarRecepcion(registrar({ remito: r }));
    expect(remito({ puntoDeVenta: "", numero: " ", fecha: "" })).toMatchObject({
      ok: true,
      valor: { remito: null },
    });
    expect(remito({ puntoDeVenta: "3", numero: "18842", fecha: "2026-11-24" })).toMatchObject({
      ok: true,
      valor: { remito: { puntoDeVenta: 3, numero: 18842, fecha: "2026-11-24" } },
    });
    expect(remito({ puntoDeVenta: "3", numero: "", fecha: "" }).ok).toBe(false);
  });
});

describe("las demás entradas de «Recepciones»", () => {
  it("confirmar: el id y el depósito opcional; nada más", () => {
    expect(entradaDeConfirmarRecepcion({ recepcionId: ID })).toEqual({
      ok: true,
      valor: { recepcionId: ID, depositoId: null },
    });
    expect(entradaDeConfirmarRecepcion({ recepcionId: ID, depositoId: OTRO })).toMatchObject({
      ok: true,
      valor: { depositoId: OTRO },
    });
    expect(entradaDeConfirmarRecepcion({ recepcionId: ID, sucursalId: OTRO }).ok).toBe(false);
    expect(entradaDeConfirmarRecepcion({ recepcionId: "x" }).ok).toBe(false);
  });

  it("anular: el id y el motivo escrito; nada más", () => {
    expect(entradaDeAnularRecepcion({ recepcionId: ID, motivo: "Error" })).toEqual({
      ok: true,
      valor: { recepcionId: ID, motivo: "Error" },
    });
    expect(entradaDeAnularRecepcion({ recepcionId: ID, motivo: "Error", extra: 1 }).ok).toBe(false);
    expect(entradaDeAnularRecepcion({ recepcionId: ID }).ok).toBe(false);
  });

  it("la ficha: solo el id", () => {
    expect(entradaDeFichaDeRecepcion({ recepcionId: ID }).ok).toBe(true);
    expect(entradaDeFichaDeRecepcion({ recepcionId: ID, sucursalId: ID }).ok).toBe(false);
    expect(entradaDeFichaDeRecepcion({ recepcionId: "x" }).ok).toBe(false);
  });

  it("la lista: solo el cursor de la dirección, con la forma `AAAA-MM-DD|<uuid>`; otra cosa, un pedido inválido", () => {
    expect(entradaDeListarRecepciones({})).toEqual({ ok: true, valor: { despuesDe: null } });
    expect(entradaDeListarRecepciones({ despues: "" })).toEqual({
      ok: true,
      valor: { despuesDe: null },
    });
    expect(entradaDeListarRecepciones({ despues: `2026-11-24|${ID}`, sucursalId: OTRO })).toEqual({
      ok: true,
      valor: { despuesDe: `2026-11-24|${ID}` },
    });
    // Sin objeto no hay cursor (y no revienta): primera página.
    for (const crudo of [null, undefined, "x", 5]) {
      expect(entradaDeListarRecepciones(crudo)).toEqual({ ok: true, valor: { despuesDe: null } });
    }
    expect(entradaDeListarRecepciones({ despues: "basura" })).toEqual({
      ok: false,
      error: { codigo: "FISCAL_DATOS_INVALIDOS", campo: "despues" },
    });
    expect(entradaDeListarRecepciones({ despues: "2026-11-24|12" }).ok).toBe(false);
    expect(entradaDeListarRecepciones({ despues: ["x"] })).toEqual({
      ok: true,
      valor: { despuesDe: null },
    });
  });
});

describe("entradaDeCorregirLoRecibido: lista de permitidos", () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({
    clave: OTRO,
    recepcionId: ID,
    linea: 1,
    correccionesVistas: 0,
    cantidad: "1500",
    causa: "ERROR_DE_CARGA",
    ...extra,
  });
  it("toma lo declarado; la nota es opcional y sin ella queda en null", () => {
    expect(entradaDeCorregirLoRecibido(pedido())).toEqual({
      ok: true,
      valor: {
        clave: OTRO,
        recepcionId: ID,
        linea: 1,
        correccionesVistas: 0,
        cantidad: "1500",
        causa: "ERROR_DE_CARGA",
        nota: null,
      },
    });
    expect(entradaDeCorregirLoRecibido(pedido({ nota: "Faltaron 2 bolsas" }))).toMatchObject({
      ok: true,
      valor: { nota: "Faltaron 2 bolsas" },
    });
  });

  it("la causa solo es una de la lista cerrada", () => {
    for (const causa of ["ERROR_DE_CARGA", "REPARTO_INTERNO", "FALTANTE_DEL_PROVEEDOR"]) {
      expect(entradaDeCorregirLoRecibido(pedido({ causa })).ok).toBe(true);
    }
    for (const causa of ["OTRA", "", null, 1, "error_de_carga"]) {
      expect(entradaDeCorregirLoRecibido(pedido({ causa })).ok).toBe(false);
    }
  });

  it("un campo inventado (la empresa, la persona, la sucursal, el depósito, un precio) no se ignora: el pedido es inválido", () => {
    for (const campo of [
      { empresaId: ID },
      { personaId: ID },
      { sucursalId: ID },
      { depositoId: ID },
      { precio: "1" },
      { confirmoExistenciaNegativa: true },
    ]) {
      expect(entradaDeCorregirLoRecibido(pedido(campo)).ok).toBe(false);
    }
  });

  it("una clave o una recepción que no son UUID, una línea o una versión que no son enteros y una cantidad que no es texto no pasan", () => {
    for (const malo of [
      { clave: "x" },
      { recepcionId: "x" },
      { linea: "1" },
      { linea: 1.5 },
      { correccionesVistas: "0" },
      { correccionesVistas: 0.5 },
      { cantidad: 1500 },
      { cantidad: "1".repeat(41) },
      { nota: 5 },
    ]) {
      expect(entradaDeCorregirLoRecibido(pedido(malo)).ok).toBe(false);
    }
  });
});
