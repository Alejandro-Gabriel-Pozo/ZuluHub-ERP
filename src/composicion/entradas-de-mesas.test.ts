import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeCrearMesa,
  leerElPedidoDeEditarMesa,
  leerElPedidoDeUnaMesa,
} from "./entradas-de-mesas";

const ID = "11111111-1111-4111-8111-111111111111";
const datos = { numero: "7", forma: "REDONDA", tamano: "CHICA", columna: "1", fila: "1" };

describe("entradas de la pantalla «Mesas»", () => {
  it("crear: convierte el número, la columna y la fila y descarta todo lo no declarado (empresa, sucursal, estado)", () => {
    const r = leerElPedidoDeCrearMesa({
      claveDeCreacion: ID,
      ...datos,
      empresaId: "x",
      sucursalId: "y",
      activa: false,
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        claveDeCreacion: ID,
        numero: 7,
        forma: "REDONDA",
        tamano: "CHICA",
        columna: 1,
        fila: 1,
      },
    });
  });

  it("el número sin forma de número es el error con texto propio; lo demás mal formado, el pedido inválido", () => {
    for (const numero of ["", "abc", "123", "-1", "1.5", " 7"]) {
      expect(leerElPedidoDeCrearMesa({ claveDeCreacion: ID, ...datos, numero })).toEqual({
        ok: false,
        error: "NUMERO_DE_MESA_INVALIDO",
      });
    }
    expect(leerElPedidoDeCrearMesa({ claveDeCreacion: "no-id", ...datos })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
    expect(leerElPedidoDeCrearMesa({ claveDeCreacion: ID, ...datos, forma: "ovalada" })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
    expect(leerElPedidoDeCrearMesa({ claveDeCreacion: ID, ...datos, columna: "x" })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
    expect(leerElPedidoDeCrearMesa(null)).toMatchObject({ ok: false });
  });

  it("el 0 y el 100 tienen forma de número: los rechaza el dominio, no esta capa", () => {
    expect(leerElPedidoDeCrearMesa({ claveDeCreacion: ID, ...datos, numero: "0" })).toMatchObject({
      ok: true,
      valor: { numero: 0 },
    });
  });

  it("editar lleva la mesa y la versión; una versión sin forma de entero es inválida", () => {
    expect(leerElPedidoDeEditarMesa({ mesaId: ID, versionEsperada: 3, ...datos })).toMatchObject({
      ok: true,
      valor: { mesaId: ID, versionEsperada: 3, numero: 7 },
    });
    expect(leerElPedidoDeEditarMesa({ mesaId: ID, versionEsperada: "x", ...datos })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
  });

  it("una mesa: solo el id", () => {
    expect(leerElPedidoDeUnaMesa({ mesaId: ID, otra: 1 })).toEqual({
      ok: true,
      valor: { mesaId: ID },
    });
    expect(leerElPedidoDeUnaMesa({ mesaId: "x" })).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});
