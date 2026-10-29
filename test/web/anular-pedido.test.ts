import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { entradaDeNotaDeCredito } from "../../src/composicion/entradas-de-facturacion";
import { calcularRenglones } from "../../src/modulos/fiscal/dominio/calculo-de-renglones";
import { cantidadDesdeTexto } from "../../src/primitivas/cantidad/cantidad";
import { importeATexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../src/primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE } from "../../src/primitivas/dinero/redondeo";
import { CODIGOS_DE_ALICUOTA } from "../../src/modulos/fiscal/dominio/alicuota";
import {
  anulacionTotal,
  escribirImporte,
  pasarAUnaParte,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-anulacion";
import { armarElPedido } from "../../apps/web/ui/plantillas/facturacion/pedido-de-anulacion";
import { calcularLaAnulacion } from "../../apps/web/ui/plantillas/facturacion/eleccion-de-anulacion";
import { conFactura, factura, facturaC, ID_FACTURA } from "../utilidades/anulacion";

/**
 * El pedido de la nota de crédito (D-69, D-71, D-74): un renglón por alícuota, de cantidad 1, con el total con IVA a anular como
 * precio y en modo «IVA incluido»; letra C, un solo renglón sin alícuota. La descripción es la de D-74, aprobada por el dueño el 2026-10-29.
 */

const unaParte = (...escritos: [string, string][]) =>
  escritos.reduce(
    (e, [clave, valor]) => escribirImporte(e, clave, valor),
    pasarAUnaParte(anulacionTotal),
  );

describe("el pedido", () => {
  it("anular el total: un renglón por alícuota con lo facturado en ella; «Anulación total de la factura …, IVA 21 %»", () => {
    expect(armarElPedido({}, factura, anulacionTotal, "  Se facturó de más  ")).toEqual({
      comprobanteAsociadoId: ID_FACTURA,
      puntoDeVentaId: null,
      concepto: "PRODUCTOS",
      servicio: null,
      modoDePrecio: "IVA_INCLUIDO",
      renglones: [
        {
          descripcion: "Anulación total de la factura 00001-00000123, IVA 21 %",
          cantidad: "1",
          precioUnitario: "60500.00",
          descuento: null,
          alicuota: "21",
        },
        {
          descripcion: "Anulación total de la factura 00001-00000123, IVA 10,5 %",
          cantidad: "1",
          precioUnitario: "30250.00",
          descuento: null,
          alicuota: "10.5",
        },
      ],
      motivo: "Se facturó de más",
    });
  });

  it("una parte con una sola alícuota: un solo renglón «Anulación parcial de la factura …»; el importe escrito es el precio", () => {
    const pedido = armarElPedido({}, factura, unaParte(["10.5", "1500.5"]), "x");
    expect(pedido.renglones).toEqual([
      {
        descripcion: "Anulación parcial de la factura 00001-00000123, IVA 10,5 %",
        cantidad: "1",
        precioUnitario: "1500.50",
        descuento: null,
        alicuota: "10.5",
      },
    ]);
  });

  it("una parte con varias alícuotas: solo las de importe mayor que cero, en el orden de la factura", () => {
    const pedido = armarElPedido(
      {},
      factura,
      unaParte(["10.5", "40000.00"], ["21", "20000.00"], ["27", "5.00"]),
      "x",
    );
    expect(pedido.renglones.map((r) => [r.alicuota, r.precioUnitario])).toEqual([
      ["21", "20000.00"],
      ["10.5", "40000.00"],
    ]);
  });

  it("letra C: un solo renglón SIN alícuota (el servidor rechaza ALICUOTA_EN_LETRA_C) y sin «IVA» en la descripción", () => {
    const total = armarElPedido({}, facturaC, anulacionTotal, "x");
    expect(total.renglones).toEqual([
      {
        descripcion: "Anulación total de la factura 00002-00000045",
        cantidad: "1",
        precioUnitario: "45000.00",
        descuento: null,
        alicuota: null,
      },
    ]);
    const parcial = armarElPedido({}, facturaC, unaParte(["C", "1000"]), "x");
    expect(parcial.renglones[0]).toMatchObject({
      descripcion: "Anulación parcial de la factura 00002-00000045",
      precioUnitario: "1000.00",
      alicuota: null,
    });
  });

  it("una nota de débito se nombra «nota de débito» (D-70, D-74)", () => {
    const nd = conFactura({ tipo: "NOTA_DEBITO_B", numero: "00001-00000200" });
    expect(armarElPedido({}, nd, anulacionTotal, "x").renglones[0]?.descripcion).toBe(
      "Anulación total de la nota de débito 00001-00000200, IVA 21 %",
    );
  });

  it("exento y no gravado: sin «IVA» en la descripción y con su código para el servidor", () => {
    const f = conFactura({ alicuotas: [{ alicuota: "EXENTO", total: "100.00" }] });
    expect(armarElPedido({}, f, anulacionTotal, "x").renglones).toMatchObject([
      { descripcion: "Anulación total de la factura 00001-00000123", alicuota: "EXENTO" },
    ]);
  });

  it("toda descripción tiene entre 1 y 200 caracteres", () => {
    for (const r of armarElPedido({}, factura, anulacionTotal, "x").renglones) {
      expect(r.descripcion.length).toBeGreaterThan(0);
      expect(r.descripcion.length).toBeLessThanOrEqual(200);
    }
  });

  it("un servicio hereda su período; el pedido no lleva clave, empresa, emisor ni importes calculados", () => {
    const servicio = { desde: "2026-10-01", hasta: "2026-10-31", vencimientoDePago: "2026-11-10" };
    const pedido = armarElPedido(
      {},
      conFactura({ concepto: "SERVICIOS", servicio }),
      anulacionTotal,
      "x",
    );
    expect(pedido).toMatchObject({ concepto: "SERVICIOS", servicio });
    expect(Object.keys(pedido).sort()).toEqual(
      [
        "comprobanteAsociadoId",
        "concepto",
        "modoDePrecio",
        "motivo",
        "puntoDeVentaId",
        "renglones",
        "servicio",
      ].sort(),
    );
  });

  it("nunca lleva un número: los importes son texto decimal", () => {
    const pedido = armarElPedido({}, factura, unaParte(["21", "20000.5"]), "x");
    for (const r of pedido.renglones) {
      expect(typeof r.precioUnitario).toBe("string");
      expect(typeof r.cantidad).toBe("string");
    }
  });
});

/**
 * Contra el servidor real: el pedido que arma la pantalla (con una clave) pasa la lectura de la acción de emitir una nota de crédito,
 * y el dominio, calculando esos renglones en «IVA incluido», devuelve exactamente lo que la pantalla mostró en «A anular ahora»
 * y, por alícuota, el importe que la persona escribió.
 */
describe("el pedido contra el servidor real", () => {
  const CLAVE = "5d1f3c2e-7a4b-4c8d-9e0f-1a2b3c4d5e6f";

  it.each([
    ["el total de una factura B", factura, anulacionTotal],
    ["una parte de una factura B", factura, unaParte(["21", "20000.00"], ["10.5", "40000.00"])],
    ["el total de una factura C", facturaC, anulacionTotal],
    ["una parte de una factura C", facturaC, unaParte(["C", "1234.56"])],
  ])("%s pasa la lectura de la acción", (_nombre, f, e) => {
    const lectura = entradaDeNotaDeCredito({ ...armarElPedido({}, f, e, "Motivo"), clave: CLAVE });
    expect(lectura.ok).toBe(true);
  });

  const calcular = (pedido: ReturnType<typeof armarElPedido>) => {
    const r = calcularRenglones(
      ARS,
      pedido.renglones.map((x) => ({
        cantidad: cantidadDesdeTexto(x.cantidad),
        precioUnitario: precioUnitarioDesdeTexto(x.precioUnitario),
        descuento: null,
        alicuota: CODIGOS_DE_ALICUOTA.find((c) => c === x.alicuota) ?? null,
      })),
      pedido.modoDePrecio,
      POLITICA_VIGENTE,
    );
    if (!r.ok) throw new Error("el dominio rechazó el cálculo");
    return r.valor;
  };

  it("el total del dominio es el «A anular» de la pantalla y cada alícuota suma lo escrito, al centavo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999_999 }),
        fc.integer({ min: 1, max: 99_999_999 }),
        (a, b) => {
          const texto = (centavos: number) =>
            `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
          const e = unaParte(["21", texto(a)], ["10.5", texto(b)]);
          const pedido = armarElPedido({}, factura, e, "x");
          const calculo = calcular(pedido);
          const pantalla = calcularLaAnulacion(factura, e);
          expect(importeATexto(calculo.total)).toBe(pantalla.aAnular);
          expect(calculo.desglose.map((d) => [d.alicuota, importeATexto(d.total)])).toEqual([
            ["10.5", texto(b)],
            ["21", texto(a)],
          ]);
        },
      ),
    );
  });

  it("letra C: el dominio acepta el renglón sin alícuota y no informa IVA", () => {
    const calculo = calcular(armarElPedido({}, facturaC, unaParte(["C", "1234.56"]), "x"));
    expect(importeATexto(calculo.total)).toBe("1234.56");
    expect(calculo.desglose).toEqual([]);
  });
});
