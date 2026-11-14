import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  fecha,
  renglon,
} from "../../../../test/utilidades/facturacion";
import { EMPRESA, OTRA_EMPRESA } from "../../../../test/utilidades/fiscal";
import {
  defectosDeForma,
  etiquetaDePendiente,
  celdasPendientes,
  huellaDeLasCeldas,
} from "../../../primitivas/oraculo/celdas";
import { ESTADOS_DE_COMPROBANTE_ARCA, TRANSICIONES_DE_COMPROBANTE } from "./estados-de-comprobante";
import { armarNotaAsociada, type ComprobanteAAsociar, type EntradaDeNota } from "./nota-asociada";
import {
  celdaDeComprobante,
  ORACULO_DE_COMPROBANTE,
  seAcreditaSegunElOraculo,
} from "./oraculo-de-comprobante";

/**
 * El oráculo de factura y nota de crédito contra el dominio: forma de la tabla, la única celda pendiente (C-07, tramo T6) y las celdas C-03,
 * C-04, C-05 y C-09 ejecutadas contra `armarNotaAsociada` y `TRANSICIONES_DE_COMPROBANTE` (los casos de uso reales de C-01, C-02, C-06 y C-08
 * corren en `test/integracion/oraculo-de-ticket-casos.test.ts`; C-09 y C-10 contra la base, en `facturacion-estados.test.ts`).
 */
const asociada = (cambios: Partial<ComprobanteAAsociar> = {}): ComprobanteAAsociar => ({
  empresaId: EMPRESA,
  emisorId: contextoDeEmision().emisorId,
  ambiente: "HOMOLOGACION",
  tipo: "FACTURA_B",
  estado: "AUTORIZADO",
  numero: 94n,
  fechaEmision: fecha("2026-10-13"),
  emisor: emisorInstantaneo({ puntoDeVentaNumero: 7 }),
  receptor: consumidorFinal,
  ...cambios,
});

const nota: EntradaDeNota = {
  clase: "NOTA_CREDITO",
  motivo: "Devolución",
  modoDePrecio: "IVA_INCLUIDO",
  concepto: "PRODUCTOS",
  servicio: null,
  renglones: [renglon("121.00", "1", "21", null, "Devolución")],
};
const codigo = (a: ComprobanteAAsociar, contexto = contextoDeEmision()) => {
  const r = armarNotaAsociada(a, nota, contexto);
  return r.ok ? null : "codigo" in r.error ? r.error.codigo : null;
};

describe("oraculo de comprobante: la tabla", () => {
  it("tiene las 10 celdas del bloque C, sin defectos de forma, y solo C-07 espera su tramo", () => {
    expect(ORACULO_DE_COMPROBANTE).toHaveLength(10);
    expect(defectosDeForma(ORACULO_DE_COMPROBANTE)).toEqual([]);
    expect(
      celdasPendientes(ORACULO_DE_COMPROBANTE).map((c) => [c.id, etiquetaDePendiente(c)]),
    ).toEqual([["C-07", "PENDIENTE (tramo T6)"]]);
  });

  it("C-02 confirma D-11 y D-83: acreditar de más se permite sin tope", () => {
    expect(celdaDeComprobante("C-02")).toMatchObject({ permitido: true, regla: "D-11, D-83" });
  });
});

/** La huella de la tabla: cambiar una celda exige actualizarla acá, en el mismo cambio (DEC-0393). */
const HUELLA_DE_LA_TABLA = "17f7b06c1b157d30edfbc41b7858ab9471bc7107595102ecf8b1962285e196a4";

describe("oraculo de comprobante: la tabla está congelada", () => {
  it("la huella coincide (si cambiaste una celda a propósito, actualizá HUELLA_DE_LA_TABLA)", () => {
    expect(huellaDeLasCeldas(ORACULO_DE_COMPROBANTE)).toBe(HUELLA_DE_LA_TABLA);
  });
});

describe("oraculo de comprobante: acreditar", () => {
  it("C-03: solo una factura AUTORIZADA se acredita; cualquier otro estado da ASOCIADO_NO_AUTORIZADO", () => {
    const celda = celdaDeComprobante("C-03");
    for (const estado of ESTADOS_DE_COMPROBANTE_ARCA) {
      const a =
        estado === "AUTORIZADO"
          ? asociada()
          : ({
              ...asociada(),
              estado,
              numero: undefined,
              fechaEmision: undefined,
            } as unknown as ComprobanteAAsociar);
      const rechazo = codigo(a);
      expect(seAcreditaSegunElOraculo(estado), estado).toBe(estado === "AUTORIZADO");
      if (estado === "AUTORIZADO") expect(rechazo).toBeNull();
      else expect(rechazo, estado).toBe(celda.errores[0]);
    }
  });

  it("C-04: otra empresa, otro emisor u otro ambiente se rechazan con los códigos de la celda", () => {
    const celda = celdaDeComprobante("C-04");
    expect(codigo(asociada({ empresaId: OTRA_EMPRESA }))).toBe(celda.errores[0]);
    expect(codigo(asociada({ emisorId: "otro" as never }))).toBe(celda.errores[1]);
    expect(codigo(asociada({ ambiente: "PRODUCCION" }))).toBe(celda.errores[2]);
    expect(celda.errores).toHaveLength(3);
  });

  it("C-05: una nota de crédito no se acredita", () => {
    expect(codigo(asociada({ tipo: "NOTA_CREDITO_B" }))).toBe(
      celdaDeComprobante("C-05").errores[0],
    );
  });

  it("C-09: AUTORIZADO no sale de su estado en la tabla del dominio", () => {
    expect(TRANSICIONES_DE_COMPROBANTE.AUTORIZADO).toEqual([]);
    expect(celdaDeComprobante("C-09").permitido).toBe(false);
  });
});
