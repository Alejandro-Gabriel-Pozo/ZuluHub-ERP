import { describe, expect, it } from "vitest";
import { entradaDeAnularCompra, entradaDeCorregirCompra } from "./entradas-de-correccion-de-compra";

/** Compras PR 10: la frontera de «Corregir» y «Anular» una compra (lista de permitidos). Sin base ni servidor. */
const UUID = "0b0b0b0b-1111-4222-8333-444444444444";
const CORREGIR = {
  clave: UUID,
  recepcionId: UUID,
  linea: 1,
  correccionesVistas: 0,
  precio: "1200.00",
  motivo: "Subió el precio",
};

describe("entradas de «Corregir» una compra", () => {
  it("acepta el pedido con los campos declarados; el precio sigue siendo texto", () => {
    expect(entradaDeCorregirCompra(CORREGIR)).toEqual({ ok: true, valor: CORREGIR });
    expect(entradaDeCorregirCompra({ ...CORREGIR, linea: "2", correccionesVistas: "3" })).toEqual({
      ok: true,
      valor: { ...CORREGIR, linea: 2, correccionesVistas: 3 },
    });
  });

  it.each([
    ["una cantidad", { cantidad: "5" }],
    ["un peso real", { pesoReal: "3" }],
    ["la empresa", { empresaId: UUID }],
    ["la sucursal", { sucursalId: UUID }],
    ["una clave que no es un id", { clave: "x" }],
    ["una compra que no es un id", { recepcionId: "x" }],
    ["un precio que es número", { precio: 1200 }],
    ["una línea negativa", { linea: -1 }],
    ["una línea decimal", { linea: "1.5" }],
    ["un motivo que no es texto", { motivo: 5 }],
  ])("rechaza %s", (_nombre, cambios) => {
    expect(entradaDeCorregirCompra({ ...CORREGIR, ...cambios }).ok).toBe(false);
  });

  it.each([
    ["falta el precio", { ...CORREGIR, precio: undefined }],
    ["nada", null],
    ["un texto", "x"],
  ])("rechaza si %s", (_nombre, crudo) => {
    expect(entradaDeCorregirCompra(crudo).ok).toBe(false);
  });
});

describe("entradas de «Anular» una compra", () => {
  it("acepta la compra y el motivo; nada más", () => {
    expect(entradaDeAnularCompra({ recepcionId: UUID, motivo: "Se cargó mal" })).toEqual({
      ok: true,
      valor: { recepcionId: UUID, motivo: "Se cargó mal" },
    });
    expect(entradaDeAnularCompra({ recepcionId: UUID, motivo: "x", empresaId: UUID }).ok).toBe(
      false,
    );
    expect(entradaDeAnularCompra({ recepcionId: "x", motivo: "x" }).ok).toBe(false);
    expect(entradaDeAnularCompra({ recepcionId: UUID }).ok).toBe(false);
  });
});
