import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  fecha,
  receptorInscripto,
  renglon,
} from "../../../../test/utilidades/facturacion";
import { CUIT_B, EMISOR_2, EMPRESA, OTRA_EMPRESA } from "../../../../test/utilidades/fiscal";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { TIPOS_DE_COMPROBANTE } from "./comprobante-emitido";
import { LIMITES_DE_COMPROBANTE } from "./comprobante-nuevo";
import { ESTADOS_DE_COMPROBANTE_ARCA } from "./estados-de-comprobante";
import { armarNotaAsociada, type ComprobanteAAsociar, type EntradaDeNota } from "./nota-asociada";
import type { Receptor } from "./receptor";

const facturaB: ComprobanteAAsociar = {
  empresaId: EMPRESA,
  emisorId: contextoDeEmision().emisorId,
  ambiente: "HOMOLOGACION",
  tipo: "FACTURA_B",
  estado: "AUTORIZADO",
  numero: 94n,
  fechaEmision: fecha("2026-10-13"),
  emisor: emisorInstantaneo({ puntoDeVentaNumero: 7 }),
  receptor: consumidorFinal,
};

/** El mismo comprobante, pero sin número ni fecha: así es uno que no está autorizado. */
const sinAutorizar = (
  estado: Exclude<ComprobanteAAsociar["estado"], "AUTORIZADO">,
  cambios: Partial<Omit<ComprobanteAAsociar, "estado">> = {},
): ComprobanteAAsociar => ({
  empresaId: EMPRESA,
  emisorId: contextoDeEmision().emisorId,
  ambiente: "HOMOLOGACION",
  tipo: "FACTURA_B",
  emisor: facturaB.emisor,
  receptor: facturaB.receptor,
  ...cambios,
  estado,
});

const entrada = (cambios: Partial<EntradaDeNota> = {}): EntradaDeNota => ({
  clase: "NOTA_CREDITO",
  motivo: null,
  modoDePrecio: "IVA_INCLUIDO",
  concepto: "PRODUCTOS",
  servicio: null,
  renglones: [renglon("121.00", "1", "21", null, "Devolución")],
  ...cambios,
});

const arma = (
  asociado: ComprobanteAAsociar = facturaB,
  e: EntradaDeNota = entrada(),
  contexto = contextoDeEmision(),
) => armarNotaAsociada(asociado, e, contexto);

const error = (...args: Parameters<typeof arma>) => {
  const r = arma(...args);
  return r.ok ? null : r.error;
};

describe("armarNotaAsociada: la nota que nace", () => {
  it("una nota de crédito B sobre una factura B lleva su letra, su receptor y el asociado", () => {
    const r = arma();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.valor;
    expect(n.tipo).toBe("NOTA_CREDITO_B");
    expect(n.receptor).toBe(facturaB.receptor);
    expect(n.asociado).toEqual({
      tipo: "FACTURA_B",
      puntoDeVenta: 7,
      numero: 94n,
      cuit: CUIT_B,
      fecha: fecha("2026-10-13"),
    });
    expect(importeATexto(n.total)).toBe("121.00");
    expect(importeATexto(n.neto)).toBe("100.00");
    expect(importeATexto(n.iva)).toBe("21.00");
    expect(n.motivo).toBeNull();
    expect(n.renglones[0]?.descripcion).toBe("Devolución");
    expect(n.empresaId).toBe(EMPRESA);
    expect(n.origen).toEqual(contextoDeEmision().origen);
  });

  it("la nota de débito se arma igual con su propia clase", () => {
    const r = arma(facturaB, entrada({ clase: "NOTA_DEBITO" }));
    expect(r.ok && r.valor.tipo).toBe("NOTA_DEBITO_B");
  });

  it("la letra es la del asociado, no se recalcula con el emisor de hoy", () => {
    // el emisor pasó a monotributo, pero la factura era A: la nota sigue siendo A
    const contexto = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    const facturaA: ComprobanteAAsociar = {
      ...facturaB,
      tipo: "FACTURA_A",
      receptor: receptorInscripto,
    };
    const r = arma(facturaA, entrada({ modoDePrecio: "IVA_DISCRIMINADO" }), contexto);
    expect(r.ok && r.valor.tipo).toBe("NOTA_CREDITO_A");
  });

  it("para cada tipo asociable la nota conserva la letra", () => {
    for (const tipo of [
      "FACTURA_A",
      "FACTURA_B",
      "FACTURA_C",
      "NOTA_DEBITO_A",
      "NOTA_DEBITO_B",
      "NOTA_DEBITO_C",
    ] as const) {
      const letra = tipo.slice(-1);
      const receptor: Receptor = letra === "A" ? receptorInscripto : consumidorFinal;
      const renglones =
        letra === "C" ? [renglon("10.00", "1", null)] : [renglon("10.00", "1", "21")];
      const r = arma({ ...facturaB, tipo, receptor }, entrada({ renglones }));
      expect(r.ok && r.valor.tipo.endsWith(`_${letra}`), tipo).toBe(true);
    }
  });

  it("sobre una factura C, los renglones no llevan alícuota y sin desglose", () => {
    const facturaC: ComprobanteAAsociar = { ...facturaB, tipo: "FACTURA_C" };
    const r = arma(facturaC, entrada({ renglones: [renglon("10.00", "1", null)] }));
    expect(r.ok && r.valor.tipo).toBe("NOTA_CREDITO_C");
    expect(r.ok && r.valor.desglose).toEqual([]);
    expect(error(facturaC, entrada())).toEqual({ codigo: "ALICUOTA_EN_LETRA_C", posicion: 0 });
  });

  it("el importe es positivo y puede superar al del asociado (ARCA lo aprueba con la observación 10237)", () => {
    const r = arma(facturaB, entrada({ renglones: [renglon("1000000.00", "1", "21")] }));
    expect(r.ok && importeATexto(r.valor.total)).toBe("1000000.00");
  });

  it("el motivo se recorta; vacío es sin motivo", () => {
    const r1 = arma(facturaB, entrada({ motivo: "  Devolución de mercadería  " }));
    expect(r1.ok && r1.valor.motivo).toBe("Devolución de mercadería");
    const r2 = arma(facturaB, entrada({ motivo: "   " }));
    expect(r2.ok && r2.valor.motivo).toBeNull();
    const largo = "m".repeat(LIMITES_DE_COMPROBANTE.motivo);
    const r3 = arma(facturaB, entrada({ motivo: largo }));
    expect(r3.ok && r3.valor.motivo).toBe(largo);
  });
});

describe("armarNotaAsociada: errores", () => {
  it("el asociado tiene que estar AUTORIZADO", () => {
    for (const estado of ESTADOS_DE_COMPROBANTE_ARCA) {
      if (estado === "AUTORIZADO") continue;
      expect(error(sinAutorizar(estado)), estado).toEqual({ codigo: "ASOCIADO_NO_AUTORIZADO" });
    }
  });

  it("misma empresa, mismo emisor y mismo ambiente", () => {
    expect(error({ ...facturaB, empresaId: OTRA_EMPRESA })).toEqual({
      codigo: "ASOCIADO_DE_OTRA_EMPRESA",
    });
    expect(error({ ...facturaB, emisorId: EMISOR_2 })).toEqual({
      codigo: "ASOCIADO_DE_OTRO_EMISOR",
    });
    expect(error({ ...facturaB, ambiente: "PRODUCCION" })).toEqual({
      codigo: "ASOCIADO_DE_OTRO_AMBIENTE",
    });
    expect(error(facturaB, entrada(), contextoDeEmision({ ambiente: "PRODUCCION" }))).toEqual({
      codigo: "ASOCIADO_DE_OTRO_AMBIENTE",
    });
  });

  it("una nota de crédito no se asocia a otra; la factura y la nota de débito sí", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const asociable = !tipo.startsWith("NOTA_CREDITO");
      const letra = tipo.slice(-1);
      const receptor: Receptor = letra === "A" ? receptorInscripto : consumidorFinal;
      const renglones =
        letra === "C" ? [renglon("10.00", "1", null)] : [renglon("10.00", "1", "21")];
      const e = error({ ...facturaB, tipo: tipo, receptor }, entrada({ renglones }));
      expect(e === null, tipo).toBe(asociable);
      if (!asociable) expect(e).toEqual({ codigo: "ASOCIADO_NO_ASOCIABLE" });
    }
  });

  it("el motivo no pasa de su largo", () => {
    expect(
      error(facturaB, entrada({ motivo: "m".repeat(LIMITES_DE_COMPROBANTE.motivo + 1) })),
    ).toEqual({ codigo: "MOTIVO_INVALIDO" });
  });

  it("devuelve el primer error: empresa, estado, emisor, ambiente, clase, motivo y después el contenido", () => {
    const e = entrada({ motivo: "m".repeat(999), renglones: [] });
    const todoMal = sinAutorizar("PENDIENTE", {
      empresaId: OTRA_EMPRESA,
      emisorId: EMISOR_2,
      ambiente: "PRODUCCION",
      tipo: "NOTA_CREDITO_B",
    });
    expect(error(todoMal, e)).toEqual({ codigo: "ASOCIADO_DE_OTRA_EMPRESA" });
    const c1 = sinAutorizar("PENDIENTE", { ...todoMal, empresaId: EMPRESA });
    expect(error(c1, e)).toEqual({ codigo: "ASOCIADO_NO_AUTORIZADO" });
    const autorizado: ComprobanteAAsociar = {
      ...facturaB,
      emisorId: EMISOR_2,
      ambiente: "PRODUCCION",
      tipo: "NOTA_CREDITO_B",
    };
    expect(error(autorizado, e)).toEqual({ codigo: "ASOCIADO_DE_OTRO_EMISOR" });
    const c2: ComprobanteAAsociar = { ...autorizado, emisorId: contextoDeEmision().emisorId };
    expect(error(c2, e)).toEqual({ codigo: "ASOCIADO_DE_OTRO_AMBIENTE" });
    const c3: ComprobanteAAsociar = { ...c2, ambiente: "HOMOLOGACION" };
    expect(error(c3, e)).toEqual({ codigo: "ASOCIADO_NO_ASOCIABLE" });
    const c4: ComprobanteAAsociar = { ...c3, tipo: "FACTURA_B" };
    expect(error(c4, e)).toEqual({ codigo: "MOTIVO_INVALIDO" });
    expect(error(c4, { ...e, motivo: null })).toEqual({ codigo: "SIN_RENGLONES" });
  });

  it("los errores del contenido llegan tal cual", () => {
    expect(error(facturaB, entrada({ renglones: [renglon("0", "1", "21")] }))).toEqual({
      codigo: "TOTAL_FUERA_DE_RANGO",
    });
    expect(
      error(
        { ...facturaB, tipo: "FACTURA_C" },
        entrada({ modoDePrecio: "IVA_DISCRIMINADO", renglones: [renglon("1", "1", null)] }),
      ),
    ).toEqual({ codigo: "MODO_DE_PRECIO_INVALIDO_PARA_C" });
  });
});
