import { describe, expect, it } from "vitest";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { frenosDeLaFactura } from "./frenos-del-reemplazo";

const EMPRESA = "00000000-0000-4000-8000-0000000000e1" as EmpresaId;
const FACTURA = "00000000-0000-4000-8000-0000000000f1";
const PAGO = "00000000-0000-4000-8000-0000000000a1";

/** Una transacción mínima con lo que lee `frenosDeLaFactura`: el pago vigente, lo asignado de cada línea y lo que suman las notas. */
const tx = (
  datos: Readonly<{
    pago?: boolean;
    asignada?: string;
    acreditado?: string;
    debitado?: string;
  }>,
) =>
  ({
    pagosDeProveedor: {
      vigenteDe: () => Promise.resolve(datos.pago === true ? { id: PAGO } : null),
    },
    conciliacionesDeCompra: {
      saldosDeFactura: () => Promise.resolve([{ asignada: datos.asignada ?? "0.0000" }]),
    },
    notasDeCredito: {
      acreditadoDe: () => Promise.resolve(datos.acreditado ?? "0.00"),
      debitadoDe: () => Promise.resolve(datos.debitado ?? "0.00"),
    },
  }) as never;

describe("frenosDeLaFactura", () => {
  it("sin nada que deshacer no hay frenos", async () => {
    expect(await frenosDeLaFactura(tx({}), EMPRESA, FACTURA)).toEqual([]);
  });

  it("los frenos salen en su orden: el pago vigente (con su id), las conciliaciones vivas y las notas vigentes", async () => {
    const frenos = await frenosDeLaFactura(
      tx({ pago: true, asignada: "3.0000", acreditado: "10.00" }),
      EMPRESA,
      FACTURA,
    );
    expect(frenos).toEqual([
      { freno: "PAGO_VIGENTE", error: { error: "COMPROBANTE_YA_PAGADO", pagoId: PAGO } },
      { freno: "CONCILIACIONES_VIVAS", error: "COMPROBANTE_CONCILIADO" },
      { freno: "NOTAS_VIGENTES", error: "COMPROBANTE_CON_NOTA_DE_CREDITO" },
    ]);
  });

  it("cada uno frena solo: una conciliación sin pago, una nota de débito vinculada sin nota de crédito", async () => {
    expect(
      (await frenosDeLaFactura(tx({ asignada: "0.0001" }), EMPRESA, FACTURA)).map((f) => f.freno),
    ).toEqual(["CONCILIACIONES_VIVAS"]);
    expect(
      (await frenosDeLaFactura(tx({ debitado: "5.00" }), EMPRESA, FACTURA)).map((f) => f.freno),
    ).toEqual(["NOTAS_VIGENTES"]);
    expect(
      (await frenosDeLaFactura(tx({ pago: true }), EMPRESA, FACTURA)).map((f) => f.freno),
    ).toEqual(["PAGO_VIGENTE"]);
  });
});
