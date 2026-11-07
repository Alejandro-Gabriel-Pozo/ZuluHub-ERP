import { describe, expect, it } from "vitest";
import { entradaDeFactura } from "../../src/composicion/entradas-de-facturacion";
import {
  clienteInicial,
  conDocumento,
  renglonVacio,
  type ClienteEscrito,
  type RenglonEscrito,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-emision";
import { armarElPedido } from "../../apps/web/ui/plantillas/facturacion/pedido-de-emision";

/**
 * El pedido de la factura (D-24, D-84, D-85): el receptor como se escribió o el consumidor final sin identificar, un renglón por cada
 * uno con su precio con IVA incluido y sin descuento, siempre «productos». Lo que arma la pantalla lo lee el servidor tal cual
 * (`entradaDeFactura`): la prueba pasa el pedido (con una clave) por esa misma lectura.
 */

const PUNTO = "6a1f0c2e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

const renglon = (cambios: Partial<RenglonEscrito> = {}): RenglonEscrito => ({
  ...renglonVacio(1),
  descripcion: "  Medialunas (docena)  ",
  cantidad: "2",
  precio: "4500.00",
  alicuota: "21",
  ...cambios,
});
const cliente = (cambios: Partial<ClienteEscrito> = {}): ClienteEscrito => ({
  ...conDocumento(clienteInicial, "DNI"),
  numero: "27.345.678",
  nombre: "  Juan Pérez ",
  domicilio: "  Av. Siempreviva 742 ",
  condicionIva: "CONSUMIDOR_FINAL",
  ...cambios,
});

describe("el pedido de la factura", () => {
  it("el consumidor final va sin documento ni nombre y con su condición; sin descuento, IVA incluido y productos", () => {
    expect(armarElPedido(clienteInicial, [renglon()], PUNTO, true)).toEqual({
      puntoDeVentaId: PUNTO,
      concepto: "PRODUCTOS",
      servicio: null,
      modoDePrecio: "IVA_INCLUIDO",
      receptor: {
        nombre: null,
        documento: { tipo: "SIN_IDENTIFICAR" },
        condicionIva: "CONSUMIDOR_FINAL",
        domicilio: null,
      },
      renglones: [
        {
          descripcion: "Medialunas (docena)",
          cantidad: "2",
          precioUnitario: "4500.00",
          descuento: null,
          alicuota: "21",
        },
      ],
    });
  });

  it("un receptor escrito a mano: el número como se escribió (el servidor lo vuelve canónico), el nombre y el domicilio sin los blancos de los bordes y la condición elegida", () => {
    const { receptor } = armarElPedido(cliente(), [renglon()], PUNTO, true);
    expect(receptor).toEqual({
      nombre: "Juan Pérez",
      documento: { tipo: "DNI", numero: "27.345.678" },
      condicionIva: "CONSUMIDOR_FINAL",
      domicilio: "Av. Siempreviva 742",
    });
    // Un domicilio en blanco viaja como «sin domicilio»: el servidor decide si hace falta.
    expect(
      armarElPedido(cliente({ domicilio: "   " }), [renglon()], PUNTO, true).receptor.domicilio,
    ).toBeNull();
    expect(
      armarElPedido(
        cliente({
          documento: "CUIT",
          numero: "30-71234567-8",
          condicionIva: "RESPONSABLE_INSCRIPTO",
        }),
        [renglon()],
        PUNTO,
        true,
      ).receptor.documento,
    ).toEqual({ tipo: "CUIT", numero: "30-71234567-8" });
  });

  it("un cliente identificado que pasó a «Consumidor final» no arrastra lo escrito", () => {
    const vuelto = conDocumento(cliente(), "SIN_IDENTIFICAR");
    expect(armarElPedido(vuelto, [renglon()], PUNTO, true).receptor).toEqual({
      nombre: null,
      documento: { tipo: "SIN_IDENTIFICAR" },
      condicionIva: "CONSUMIDOR_FINAL",
      domicilio: null,
    });
  });

  it("la alícuota solo viaja si la empresa discrimina IVA (la letra C no la admite)", () => {
    expect(
      armarElPedido(clienteInicial, [renglon()], PUNTO, false).renglones[0]?.alicuota,
    ).toBeNull();
    expect(
      armarElPedido(clienteInicial, [renglon({ alicuota: "" })], PUNTO, true).renglones[0]
        ?.alicuota,
    ).toBeNull();
    expect(
      armarElPedido(clienteInicial, [renglon({ alicuota: "NO_GRAVADO" })], PUNTO, true).renglones[0]
        ?.alicuota,
    ).toBe("NO_GRAVADO");
  });

  it("la cantidad viaja con punto decimal y el precio como texto canónico: nada es un number", () => {
    const pedido = armarElPedido(
      clienteInicial,
      [renglon({ cantidad: "1,5", precio: "1234.50" })],
      PUNTO,
      true,
    );
    expect(pedido.renglones[0]).toMatchObject({ cantidad: "1.5", precioUnitario: "1234.50" });
    const numeros = JSON.stringify(pedido).match(/:\s*-?\d/g);
    expect(numeros).toBeNull();
  });

  it("no lleva clave, empresa, emisor ni ambiente: la clave la pone el intento y lo demás, el servidor", () => {
    const pedido = armarElPedido(clienteInicial, [renglon()], PUNTO, true) as Record<
      string,
      unknown
    >;
    for (const campo of ["clave", "empresaId", "emisorId", "ambiente", "origen", "letra", "tipo"]) {
      expect(campo in pedido, campo).toBe(false);
    }
  });

  it("un renglón por cada uno escrito, en orden", () => {
    const pedido = armarElPedido(
      clienteInicial,
      [renglon({ id: 1, descripcion: "A" }), renglon({ id: 2, descripcion: "B" })],
      PUNTO,
      true,
    );
    expect(pedido.renglones.map((r) => r.descripcion)).toEqual(["A", "B"]);
  });

  it("el servidor lo lee tal cual, con la clave del intento (consumidor final, a mano y sin IVA)", () => {
    for (const [c, discrimina] of [
      [clienteInicial, true],
      [cliente(), true],
      [
        cliente({ documento: "PASAPORTE", numero: "123456", condicionIva: "CLIENTE_DEL_EXTERIOR" }),
        false,
      ],
    ] as const) {
      const pedido = armarElPedido(
        c,
        [renglon(), renglon({ id: 2, cantidad: "0,5" })],
        PUNTO,
        discrimina,
      );
      const leido = entradaDeFactura({ ...pedido, clave: CLAVE });
      expect(leido.ok).toBe(true);
    }
  });
});
