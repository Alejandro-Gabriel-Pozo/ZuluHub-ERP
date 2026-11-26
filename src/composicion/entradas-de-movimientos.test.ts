import { describe, expect, it } from "vitest";
import {
  entradaDeAjuste,
  entradaDeAnulacion,
  entradaDeMovimiento,
  entradaDeTransferencia,
} from "./entradas-de-movimientos";

/** La frontera de los movimientos a mano: solo la forma; lo que no está declarado no pasa y lo en blanco es «ausente». */
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const base = { clave: U1, depositoId: U2, articuloId: U3, cantidad: "2.5", motivo: "COMPRA" };

describe("entradaDeMovimiento", () => {
  it("toma solo lo declarado; el costo y el detalle en blanco son ausentes", () => {
    expect(
      entradaDeMovimiento({
        ...base,
        costoUnitario: "  ",
        detalle: "",
        sucursalId: "x",
        personaId: "y",
      }),
    ).toStrictEqual({
      ok: true,
      valor: { ...base, costoUnitario: undefined, detalle: undefined, confirmar: false },
    });
    expect(
      entradaDeMovimiento({ ...base, costoUnitario: "10.5", detalle: "Factura 1" }),
    ).toMatchObject({
      ok: true,
      valor: { costoUnitario: "10.5", detalle: "Factura 1" },
    });
  });

  it.each([
    ["sin clave", { ...base, clave: undefined }],
    ["clave que no es un id", { ...base, clave: "x" }],
    ["depósito que no es un id", { ...base, depositoId: "x" }],
    ["artículo que no es un id", { ...base, articuloId: "x" }],
    ["cantidad que no es texto", { ...base, cantidad: 2 }],
    ["cantidad enorme", { ...base, cantidad: "1".repeat(41) }],
    ["sin motivo", { ...base, motivo: undefined }],
    ["no es un objeto", null],
  ])("%s es una entrada inválida", (_caso, crudo) => {
    expect(entradaDeMovimiento(crudo).ok).toBe(false);
  });
});

describe("la confirmación del aviso de negativo", () => {
  it("«1» confirma; ausente no; cualquier otro valor es inválido (lista de permitidos)", () => {
    expect(entradaDeMovimiento({ ...base, confirmar: "1" })).toMatchObject({
      ok: true,
      valor: { confirmar: true },
    });
    expect(entradaDeMovimiento(base)).toMatchObject({ ok: true, valor: { confirmar: false } });
    // El servidor web manda «» cuando el campo no viene en el formulario.
    expect(entradaDeMovimiento({ ...base, confirmar: "" })).toMatchObject({
      ok: true,
      valor: { confirmar: false },
    });
    for (const malo of ["0", "true", "on", 1, true]) {
      expect(entradaDeMovimiento({ ...base, confirmar: malo }).ok).toBe(false);
    }
  });

  it("la transferencia igual", () => {
    const t = { clave: U1, origenId: U2, destinoId: U3, articuloId: U1, cantidad: "1" };
    expect(entradaDeTransferencia({ ...t, confirmar: "1" })).toMatchObject({
      ok: true,
      valor: { confirmar: true },
    });
    expect(entradaDeTransferencia(t)).toMatchObject({ ok: true, valor: { confirmar: false } });
    expect(entradaDeTransferencia({ ...t, confirmar: "" })).toMatchObject({
      ok: true,
      valor: { confirmar: false },
    });
    expect(entradaDeTransferencia({ ...t, confirmar: "si" }).ok).toBe(false);
  });
});

describe("entradaDeTransferencia", () => {
  const t = { clave: U1, origenId: U2, destinoId: U3, articuloId: U1, cantidad: "1" };
  it("lee origen, destino, artículo y cantidad", () => {
    expect(entradaDeTransferencia(t)).toStrictEqual({
      ok: true,
      valor: { ...t, confirmar: false },
    });
  });
  it.each(["clave", "origenId", "destinoId", "articuloId", "cantidad"])(
    "sin %s es inválida",
    (campo) => {
      expect(entradaDeTransferencia({ ...t, [campo]: undefined }).ok).toBe(false);
    },
  );
});

describe("entradaDeAjuste", () => {
  const a = {
    clave: U1,
    depositoId: U2,
    articuloId: U3,
    sentido: "RESTA",
    cantidad: "1",
    detalle: "Se rompió",
  };
  it("lee el sentido de la lista cerrada y deja el detalle en blanco como ausente", () => {
    expect(entradaDeAjuste(a)).toStrictEqual({ ok: true, valor: a });
    expect(entradaDeAjuste({ ...a, sentido: "SUMA", detalle: " " })).toMatchObject({
      ok: true,
      valor: { sentido: "SUMA", detalle: undefined },
    });
  });
  it.each(["OTRO", "suma", "", undefined])("el sentido %s es inválido", (sentido) => {
    expect(entradaDeAjuste({ ...a, sentido }).ok).toBe(false);
  });
  it.each(["clave", "depositoId", "articuloId", "cantidad"])("sin %s es inválido", (campo) => {
    expect(entradaDeAjuste({ ...a, [campo]: undefined }).ok).toBe(false);
  });
});

describe("entradaDeAnulacion", () => {
  it("lee el movimiento y el detalle; el detalle en blanco es ausente", () => {
    expect(entradaDeAnulacion({ clave: U1, movimientoId: U2, detalle: "Error" })).toStrictEqual({
      ok: true,
      valor: { clave: U1, movimientoId: U2, detalle: "Error" },
    });
    expect(entradaDeAnulacion({ clave: U1, movimientoId: U2 })).toMatchObject({
      ok: true,
      valor: { detalle: undefined },
    });
    expect(entradaDeAnulacion({ clave: U1, movimientoId: "x" }).ok).toBe(false);
    expect(entradaDeAnulacion({ movimientoId: U2 }).ok).toBe(false);
  });
});
