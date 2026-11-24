import { describe, expect, it } from "vitest";
import {
  entradaDeComprobante,
  entradaDeProveedor,
  entradaDePuntoDeVenta,
  entradaDeResolverPedido,
} from "./entradas-de-ficha-de-proveedor";

/** Compras PR 4: la frontera de la ficha del proveedor (lista de permitidos). Sin base ni servidor. */
const ID = "0b6c7c2e-5d8f-4f3a-9a53-2f6a1c3d4e5f";

describe("entradas de la ficha del proveedor de compras", () => {
  it("acepta lo declarado, con el número como entero o como texto de dígitos", () => {
    expect(entradaDeProveedor({ parteId: ID })).toEqual({ ok: true, valor: { parteId: ID } });
    expect(entradaDePuntoDeVenta({ parteId: ID, numero: 7 })).toMatchObject({ ok: true });
    expect(entradaDePuntoDeVenta({ parteId: ID, numero: "7" })).toEqual({
      ok: true,
      valor: { parteId: ID, numero: 7 },
    });
    expect(entradaDeComprobante({ parteId: ID, tipo: "NOTA_CREDITO_B" })).toMatchObject({
      ok: true,
    });
    expect(entradaDeResolverPedido({ pedidoId: ID, decision: "RECHAZAR" })).toMatchObject({
      ok: true,
    });
  });

  it.each([
    ["proveedor sin id válido", entradaDeProveedor({ parteId: "x" })],
    ["proveedor con empresaId de más", entradaDeProveedor({ parteId: ID, empresaId: ID })],
    ["número decimal", entradaDePuntoDeVenta({ parteId: ID, numero: "7.5" })],
    ["número negativo", entradaDePuntoDeVenta({ parteId: ID, numero: "-1" })],
    ["número que no es un número", entradaDePuntoDeVenta({ parteId: ID, numero: Number.NaN })],
    ["punto de venta con clave de más", entradaDePuntoDeVenta({ parteId: ID, numero: 7, x: 1 })],
    ["tipo inventado", entradaDeComprobante({ parteId: ID, tipo: "FACTURA_Z" })],
    ["tipo vacío", entradaDeComprobante({ parteId: ID, tipo: "" })],
    ["decisión inventada", entradaDeResolverPedido({ pedidoId: ID, decision: "BORRAR" })],
    ["pedido sin id", entradaDeResolverPedido({ decision: "APROBAR" })],
    ["nada", entradaDeComprobante(null)],
  ])("rechaza %s", (_nombre, resultado) => {
    expect(resultado.ok).toBe(false);
  });

  it("acepta los nueve tipos del dominio y ninguno más", () => {
    const tipos = [
      "FACTURA_A",
      "FACTURA_B",
      "FACTURA_C",
      "NOTA_DEBITO_A",
      "NOTA_DEBITO_B",
      "NOTA_DEBITO_C",
      "NOTA_CREDITO_A",
      "NOTA_CREDITO_B",
      "NOTA_CREDITO_C",
    ];
    for (const tipo of tipos) expect(entradaDeComprobante({ parteId: ID, tipo }).ok).toBe(true);
  });
});
