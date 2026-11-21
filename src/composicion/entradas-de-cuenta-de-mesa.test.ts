import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeCambiarDeMesa,
  leerElPedidoDeTomarPedido,
  leerElPedidoDeUnaCuenta,
  leerElPedidoDelMapa,
} from "./entradas-de-cuenta-de-mesa";

const CUENTA = "11111111-1111-4111-8111-111111111111";
const MESA = "22222222-2222-4222-8222-222222222222";

describe("entradas de la cuenta de mesa", () => {
  it("el mapa sin pedido o sin filtro es «Todas»; un filtro del conjunto pasa y cualquier otro es inválido", () => {
    for (const crudo of [undefined, null, {}, { filtro: undefined }]) {
      expect(leerElPedidoDelMapa(crudo)).toEqual({ ok: true, valor: { filtro: "TODAS" } });
    }
    for (const filtro of ["TODAS", "LIBRES", "EN_PEDIDO", "OCUPADAS"]) {
      expect(leerElPedidoDelMapa({ filtro })).toEqual({ ok: true, valor: { filtro } });
    }
    for (const filtro of ["libres", "UNIDA", "", 1, null, "TODAS "]) {
      expect(leerElPedidoDelMapa({ filtro }).ok).toBe(false);
    }
  });

  it("tomar pedido: lee solo el id de la cuenta y el de la mesa; descarta empresa, sucursal, persona y estado", () => {
    expect(
      leerElPedidoDeTomarPedido({
        cuentaId: CUENTA,
        mesaId: MESA,
        empresaId: "x",
        sucursalId: "y",
        personaId: "z",
        estado: "ABIERTA",
      }),
    ).toEqual({ ok: true, valor: { cuentaId: CUENTA, mesaId: MESA } });
  });

  it("los ids sin forma de id, ausentes o de otro tipo son inválidos en todos los pedidos", () => {
    const malos = ["", "no-es-un-id", 7, null, undefined, `${CUENTA} `];
    for (const malo of malos) {
      expect(leerElPedidoDeTomarPedido({ cuentaId: malo, mesaId: MESA }).ok).toBe(false);
      expect(leerElPedidoDeTomarPedido({ cuentaId: CUENTA, mesaId: malo }).ok).toBe(false);
      expect(leerElPedidoDeUnaCuenta({ cuentaId: malo }).ok).toBe(false);
      expect(leerElPedidoDeCambiarDeMesa({ cuentaId: CUENTA, mesaDestinoId: malo }).ok).toBe(false);
    }
    for (const crudo of [undefined, null, "texto", 3, []]) {
      expect(leerElPedidoDeTomarPedido(crudo).ok).toBe(false);
      expect(leerElPedidoDeUnaCuenta(crudo).ok).toBe(false);
      expect(leerElPedidoDeCambiarDeMesa(crudo).ok).toBe(false);
    }
  });

  it("liberar y cambiar de mesa: solo las claves declaradas", () => {
    expect(leerElPedidoDeUnaCuenta({ cuentaId: CUENTA, extra: 1 })).toEqual({
      ok: true,
      valor: { cuentaId: CUENTA },
    });
    expect(
      leerElPedidoDeCambiarDeMesa({ cuentaId: CUENTA, mesaDestinoId: MESA, sucursalId: "otra" }),
    ).toEqual({ ok: true, valor: { cuentaId: CUENTA, mesaDestinoId: MESA } });
  });
});
