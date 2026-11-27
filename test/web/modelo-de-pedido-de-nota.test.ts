import { describe, expect, it } from "vitest";
import { ALICUOTAS_PARA_ELEGIR } from "../../apps/web/ui/plantillas/compras/nueva/modelo-de-factura";
import {
  ALICUOTAS_DE_LA_NOTA,
  IMPORTE_INICIAL,
  discriminaIvaLaNota,
  NOTA_VACIA,
  armarElPedidoDeNota,
  type NotaEscrita,
} from "../../apps/web/ui/plantillas/compras/notas/modelo-de-pedido-de-nota";

const FACTURA = "0b0b0b0b-1111-4222-8333-444444444444";
const completa = (cambios: Partial<NotaEscrita> = {}): NotaEscrita => ({
  tipo: "NOTA_CREDITO_A",
  puntoDeVenta: "3",
  numero: "77",
  fecha: "2026-11-27",
  importes: [{ id: 1, alicuota: "21", neto: "100000.00" }],
  totalSegunNota: "121000.00",
  ...cambios,
});

describe("el pedido de «Cargar una nota del proveedor»", () => {
  it("la nota vacía arranca con un solo importe a la alícuota de siempre y no se puede enviar", () => {
    expect(NOTA_VACIA).toEqual({
      tipo: "",
      puntoDeVenta: "",
      numero: "",
      fecha: "",
      importes: [{ id: 1, alicuota: "21", neto: "" }],
      totalSegunNota: "",
    });
    expect(IMPORTE_INICIAL).toEqual({ id: 1, alicuota: "21", neto: "" });
    expect(armarElPedidoDeNota(FACTURA, NOTA_VACIA)).toBeNull();
  });

  it("la lista de alícuotas es la de la factura (una regla, un lugar)", () => {
    expect(ALICUOTAS_DE_LA_NOTA).toBe(ALICUOTAS_PARA_ELEGIR);
  });

  it("completo, sale la factura de la ruta y la nota tal cual se escribió, con los importes como texto y sin ninguna cuenta", () => {
    expect(armarElPedidoDeNota(FACTURA, completa())).toEqual({
      facturaId: FACTURA,
      nota: {
        tipo: "NOTA_CREDITO_A",
        puntoDeVenta: "3",
        numero: "77",
        fecha: "2026-11-27",
        importes: [{ alicuota: "21", neto: "100000.00" }],
        totalSegunNota: "121000.00",
      },
    });
  });

  it("solo una nota A discrimina IVA: una B o C sale SIN alícuota (null) aunque la fila tenga una, y no la exige", () => {
    expect(discriminaIvaLaNota("NOTA_CREDITO_A")).toBe(true);
    expect(discriminaIvaLaNota("NOTA_DEBITO_A")).toBe(true);
    for (const tipo of ["NOTA_CREDITO_B", "NOTA_CREDITO_C", "NOTA_DEBITO_B", "NOTA_DEBITO_C", ""]) {
      expect(discriminaIvaLaNota(tipo)).toBe(false);
    }
    const sinAlicuota = armarElPedidoDeNota(
      FACTURA,
      completa({ tipo: "NOTA_CREDITO_C", importes: [{ id: 1, alicuota: "", neto: "50.00" }] }),
    );
    expect(sinAlicuota?.nota.importes).toEqual([{ alicuota: null, neto: "50.00" }]);
    const conAlicuotaDeSobra = armarElPedidoDeNota(
      FACTURA,
      completa({ tipo: "NOTA_DEBITO_B", importes: [{ id: 1, alicuota: "21", neto: "50.00" }] }),
    );
    expect(conAlicuotaDeSobra?.nota.importes).toEqual([{ alicuota: null, neto: "50.00" }]);
    // En una A la alícuota sí se exige.
    expect(
      armarElPedidoDeNota(
        FACTURA,
        completa({ tipo: "NOTA_CREDITO_A", importes: [{ id: 1, alicuota: "", neto: "50.00" }] }),
      ),
    ).toBeNull();
  });

  it("el id interno de la fila del importe no sale", () => {
    const p = armarElPedidoDeNota(FACTURA, completa());
    expect(Object.keys(p?.nota.importes[0] ?? {}).sort()).toEqual(["alicuota", "neto"]);
  });

  it("falta cualquiera de los campos y el botón queda apagado (null), uno por uno", () => {
    for (const campo of ["tipo", "puntoDeVenta", "numero", "fecha", "totalSegunNota"] as const) {
      expect(armarElPedidoDeNota(FACTURA, completa({ [campo]: "" }))).toBeNull();
    }
    expect(armarElPedidoDeNota(FACTURA, completa({ importes: [] }))).toBeNull();
    expect(
      armarElPedidoDeNota(FACTURA, completa({ importes: [{ id: 1, alicuota: "21", neto: "" }] })),
    ).toBeNull();
    expect(
      armarElPedidoDeNota(FACTURA, completa({ importes: [{ id: 1, alicuota: "", neto: "5" }] })),
    ).toBeNull();
  });

  it("con varios importes sale cada uno, en su orden; basta que uno esté incompleto para no enviar", () => {
    const dos = completa({
      importes: [
        { id: 1, alicuota: "21", neto: "100.00" },
        { id: 2, alicuota: "10.5", neto: "50.00" },
      ],
    });
    expect(armarElPedidoDeNota(FACTURA, dos)?.nota.importes).toEqual([
      { alicuota: "21", neto: "100.00" },
      { alicuota: "10.5", neto: "50.00" },
    ]);
    expect(
      armarElPedidoDeNota(
        FACTURA,
        completa({
          importes: [
            { id: 1, alicuota: "21", neto: "100.00" },
            { id: 2, alicuota: "10.5", neto: "" },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("no valida ni calcula nada: lo escrito sale como se escribió (lo valida el servidor)", () => {
    const raro = armarElPedidoDeNota(
      FACTURA,
      completa({ totalSegunNota: "abc", importes: [{ id: 1, alicuota: "21", neto: "-5" }] }),
    );
    expect(raro?.nota.totalSegunNota).toBe("abc");
    expect(raro?.nota.importes).toEqual([{ alicuota: "21", neto: "-5" }]);
  });
});
