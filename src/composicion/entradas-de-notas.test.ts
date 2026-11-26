import { describe, expect, it } from "vitest";
import { ALICUOTAS_DE_COMPRA } from "../modulos/compras/publico";
import {
  entradaDeAnularNota,
  entradaDeNotasDeLaFactura,
  entradaDeRegistrarNota,
} from "./entradas-de-notas";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const nota = (extra: Record<string, unknown> = {}) => ({
  tipo: "NOTA_CREDITO_A",
  puntoDeVenta: "5",
  numero: "77",
  fecha: "2026-11-20",
  importes: [{ alicuota: "21", neto: "1000.00" }],
  totalSegunNota: "1210.00",
  ...extra,
});
const registrar = (extra: Record<string, unknown> = {}, n: Record<string, unknown> = {}) => ({
  clave: OTRO,
  facturaId: ID,
  nota: nota(n),
  ...extra,
});

describe("entradaDeRegistrarNota", () => {
  it("lee la clave, la factura y la nota campo por campo, con los importes como texto y los enteros como número", () => {
    expect(entradaDeRegistrarNota(registrar())).toEqual({
      ok: true,
      valor: {
        clave: OTRO,
        facturaId: ID,
        nota: {
          tipo: "NOTA_CREDITO_A",
          puntoDeVenta: 5,
          numero: 77,
          fecha: "2026-11-20",
          importes: [{ alicuota: "21", neto: "1000.00" }],
          totalSegunNota: "1210.00",
        },
      },
    });
  });

  it("acepta los seis tipos de nota y rechaza una factura, un tipo inventado y un tipo que no es texto", () => {
    for (const tipo of [
      "NOTA_CREDITO_A",
      "NOTA_CREDITO_B",
      "NOTA_CREDITO_C",
      "NOTA_DEBITO_A",
      "NOTA_DEBITO_B",
      "NOTA_DEBITO_C",
    ]) {
      expect(entradaDeRegistrarNota(registrar({}, { tipo })).ok).toBe(true);
    }
    for (const tipo of ["FACTURA_A", "NOTA_CREDITO_D", "", null, 5]) {
      expect(entradaDeRegistrarNota(registrar({}, { tipo })).ok).toBe(false);
    }
  });

  it("solo toma lo declarado: el proveedor, la empresa, la persona o cualquier campo de más (también dentro de la nota y de un importe) rechaza el pedido", () => {
    expect(entradaDeRegistrarNota(registrar({ proveedorId: ID })).ok).toBe(false);
    expect(entradaDeRegistrarNota(registrar({ empresaId: ID })).ok).toBe(false);
    expect(entradaDeRegistrarNota(registrar({ personaId: ID })).ok).toBe(false);
    expect(entradaDeRegistrarNota(registrar({}, { clase: "CREDITO" })).ok).toBe(false);
    expect(
      entradaDeRegistrarNota(registrar({}, { importes: [{ alicuota: "21", neto: "1", iva: "1" }] }))
        .ok,
    ).toBe(false);
  });

  it("la clave y la factura son un UUID", () => {
    for (const malo of ["", "abc", `${ID}x`, 5, null]) {
      expect(entradaDeRegistrarNota(registrar({ clave: malo })).ok).toBe(false);
      expect(entradaDeRegistrarNota(registrar({ facturaId: malo })).ok).toBe(false);
    }
    expect(entradaDeRegistrarNota({ facturaId: ID, nota: nota() }).ok).toBe(false);
    expect(entradaDeRegistrarNota({ clave: OTRO, nota: nota() }).ok).toBe(false);
    expect(entradaDeRegistrarNota({ clave: OTRO, facturaId: ID }).ok).toBe(false);
    expect(entradaDeRegistrarNota(null).ok).toBe(false);
    expect(entradaDeRegistrarNota("nota").ok).toBe(false);
  });

  it("el punto de venta y el número son enteros (número o texto de dígitos), nunca decimales, con exponente ni negativos", () => {
    for (const v of [5, "5", "0004"]) {
      expect(entradaDeRegistrarNota(registrar({}, { puntoDeVenta: v, numero: v })).ok).toBe(true);
    }
    for (const v of ["5.5", "1e3", "-1", "", "x", null]) {
      expect(entradaDeRegistrarNota(registrar({}, { puntoDeVenta: v })).ok).toBe(false);
      expect(entradaDeRegistrarNota(registrar({}, { numero: v })).ok).toBe(false);
    }
  });

  it("los importes: al menos uno y hasta veinte, alícuota de la lista del dominio y neto como texto de hasta 40 caracteres (nunca un número)", () => {
    const un = { alicuota: "21", neto: "10.00" };
    expect(entradaDeRegistrarNota(registrar({}, { importes: [] })).ok).toBe(false);
    expect(entradaDeRegistrarNota(registrar({}, { importes: Array(20).fill(un) })).ok).toBe(true);
    expect(entradaDeRegistrarNota(registrar({}, { importes: Array(21).fill(un) })).ok).toBe(false);
    for (const alicuota of ALICUOTAS_DE_COMPRA) {
      expect(
        entradaDeRegistrarNota(registrar({}, { importes: [{ alicuota, neto: "1.00" }] })).ok,
      ).toBe(true);
    }
    // Una nota B o C no discrimina IVA: va sin alícuota (null); el servidor decide si corresponde por el tipo.
    expect(
      entradaDeRegistrarNota(registrar({}, { importes: [{ alicuota: null, neto: "1.00" }] })),
    ).toMatchObject({
      ok: true,
      valor: { nota: { importes: [{ alicuota: null, neto: "1.00" }] } },
    });
    expect(entradaDeRegistrarNota(registrar({}, { importes: [{ neto: "1.00" }] })).ok).toBe(false);
    for (const alicuota of ["22", "", "21.0", 21]) {
      expect(
        entradaDeRegistrarNota(registrar({}, { importes: [{ alicuota, neto: "1.00" }] })).ok,
      ).toBe(false);
    }
    expect(
      entradaDeRegistrarNota(
        registrar({}, { importes: [{ alicuota: "21", neto: "1".repeat(40) }] }),
      ).ok,
    ).toBe(true);
    expect(
      entradaDeRegistrarNota(
        registrar({}, { importes: [{ alicuota: "21", neto: "1".repeat(41) }] }),
      ).ok,
    ).toBe(false);
    expect(
      entradaDeRegistrarNota(registrar({}, { importes: [{ alicuota: "21", neto: 1000 }] })).ok,
    ).toBe(false);
    expect(entradaDeRegistrarNota(registrar({}, { importes: "21" })).ok).toBe(false);
  });

  it("el total según la nota es texto de hasta 40 caracteres y la fecha, texto de hasta 1000 (la validez la decide el servidor)", () => {
    expect(entradaDeRegistrarNota(registrar({}, { totalSegunNota: "1".repeat(40) })).ok).toBe(true);
    expect(entradaDeRegistrarNota(registrar({}, { totalSegunNota: "1".repeat(41) })).ok).toBe(
      false,
    );
    expect(entradaDeRegistrarNota(registrar({}, { totalSegunNota: 1210 })).ok).toBe(false);
    expect(entradaDeRegistrarNota(registrar({}, { fecha: "x".repeat(1000) })).ok).toBe(true);
    expect(entradaDeRegistrarNota(registrar({}, { fecha: "x".repeat(1001) })).ok).toBe(false);
    expect(entradaDeRegistrarNota(registrar({}, { fecha: 20261120 })).ok).toBe(false);
  });
});

describe("entradaDeAnularNota", () => {
  it("lee la nota (un UUID) y el motivo (texto de hasta 1000 caracteres)", () => {
    expect(entradaDeAnularNota({ notaId: ID, motivo: "Se cargó dos veces" })).toEqual({
      ok: true,
      valor: { notaId: ID, motivo: "Se cargó dos veces" },
    });
    expect(entradaDeAnularNota({ notaId: ID, motivo: "x".repeat(1000) }).ok).toBe(true);
    expect(entradaDeAnularNota({ notaId: ID, motivo: "x".repeat(1001) }).ok).toBe(false);
  });

  it("rechaza lo que falta, lo que no es texto, un id que no es UUID y cualquier campo de más (la clase y la empresa no viajan)", () => {
    expect(entradaDeAnularNota({ notaId: ID }).ok).toBe(false);
    expect(entradaDeAnularNota({ motivo: "x" }).ok).toBe(false);
    expect(entradaDeAnularNota({ notaId: ID, motivo: 5 }).ok).toBe(false);
    expect(entradaDeAnularNota({ notaId: "1", motivo: "x" }).ok).toBe(false);
    expect(entradaDeAnularNota({ notaId: ID, motivo: "x", clase: "CREDITO" }).ok).toBe(false);
    expect(entradaDeAnularNota({ notaId: ID, motivo: "x", empresaId: ID }).ok).toBe(false);
    expect(entradaDeAnularNota(undefined).ok).toBe(false);
  });
});

describe("entradaDeNotasDeLaFactura", () => {
  it("lee solo el id de la factura (un UUID)", () => {
    expect(entradaDeNotasDeLaFactura({ facturaId: ID })).toEqual({
      ok: true,
      valor: { facturaId: ID },
    });
    expect(entradaDeNotasDeLaFactura({ facturaId: "no" }).ok).toBe(false);
    expect(entradaDeNotasDeLaFactura({}).ok).toBe(false);
    expect(entradaDeNotasDeLaFactura({ facturaId: ID, otro: 1 }).ok).toBe(false);
    expect(entradaDeNotasDeLaFactura(null).ok).toBe(false);
  });
});
