import { describe, expect, it } from "vitest";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { TIPOS_DE_COMPROBANTE, claseDeComprobante } from "./comprobante-emitido";
import {
  CUENTA_COMO_ACREDITADA,
  CUENTA_COMO_ACREDITADA_FIRME,
  MOTIVOS_DE_NO_VIGENCIA,
  acreditacionDe,
  acreditadoPor,
  etiquetaDeAcreditacion,
  motivoDeNoVigencia,
  type NotaParaAcreditar,
} from "./acreditacion";
import {
  ESTADOS_DE_COMPROBANTE_ARCA,
  type EstadoDeComprobanteArca,
} from "./estados-de-comprobante";

const importe = (texto: string) => importeDesdeTexto(ARS, texto);

const nota = (
  total: string,
  estado: EstadoDeComprobanteArca = "AUTORIZADO",
  tipo: NotaParaAcreditar["tipo"] = "NOTA_CREDITO_B",
): NotaParaAcreditar => ({ tipo, estado, total: importe(total) });

const etiqueta = (total: string, ...notas: NotaParaAcreditar[]) =>
  acreditacionDe("FACTURA_B", importe(total), notas, CUENTA_COMO_ACREDITADA)?.etiqueta;
const cifra = (total: string, ...notas: NotaParaAcreditar[]) => {
  const a = acreditacionDe("FACTURA_B", importe(total), notas, CUENTA_COMO_ACREDITADA);
  return a === null ? null : importeATexto(a.acreditado);
};

describe("lo acreditado de una factura", () => {
  it("sin notas: cero y NINGUNA", () => {
    expect(cifra("121.00")).toBe("0.00");
    expect(etiqueta("121.00")).toBe("NINGUNA");
  });

  it("una nota por menos del total: PARCIAL", () => {
    expect(cifra("121.00", nota("60.50"))).toBe("60.50");
    expect(etiqueta("121.00", nota("60.50"))).toBe("PARCIAL");
  });

  it("un centavo menos que el total sigue PARCIAL; el total exacto es TOTAL; un centavo más, TOTAL", () => {
    expect(etiqueta("121.00", nota("120.99"))).toBe("PARCIAL");
    expect(etiqueta("121.00", nota("121.00"))).toBe("TOTAL");
    expect(etiqueta("121.00", nota("121.01"))).toBe("TOTAL");
    expect(cifra("121.00", nota("121.01"))).toBe("121.01");
  });

  it("un centavo acreditado ya no es NINGUNA", () => {
    expect(etiqueta("121.00", nota("0.01"))).toBe("PARCIAL");
  });

  it("sin tope: pasarse del total es TOTAL y la cifra es la suma, sin recortar", () => {
    expect(etiqueta("100.00", nota("100.00"), nota("50.00"))).toBe("TOTAL");
    expect(cifra("100.00", nota("100.00"), nota("50.00"))).toBe("150.00");
  });

  it("varias notas suman exacto, con decimales: 33.33 + 33.33 + 33.33 no llega a 100.00", () => {
    const tres = [nota("33.33"), nota("33.33"), nota("33.33")];
    expect(cifra("100.00", ...tres)).toBe("99.99");
    expect(etiqueta("100.00", ...tres)).toBe("PARCIAL");
    expect(etiqueta("100.00", ...tres, nota("0.01"))).toBe("TOTAL");
  });

  it("la suma de 0.10 diez veces es exactamente 1.00 (no hay coma flotante)", () => {
    const diez = Array.from({ length: 10 }, () => nota("0.10"));
    expect(cifra("1.00", ...diez)).toBe("1.00");
    expect(etiqueta("1.00", ...diez)).toBe("TOTAL");
  });

  it("las notas parciales de a pedazos llegan al total cuando suman el total", () => {
    expect(etiqueta("121.00", nota("60.50"), nota("60.49"))).toBe("PARCIAL");
    expect(etiqueta("121.00", nota("60.50"), nota("60.50"))).toBe("TOTAL");
  });

  it("las pendientes cuentan (D-15): validando, esperando y confirmando suman como las autorizadas", () => {
    for (const estado of ["PENDIENTE", "EN_VALIDACION", "INCIERTO"] as const) {
      expect(cifra("100.00", nota("40.00", estado)), estado).toBe("40.00");
      expect(etiqueta("100.00", nota("40.00", estado)), estado).toBe("PARCIAL");
      expect(etiqueta("100.00", nota("100.00", estado)), estado).toBe("TOTAL");
    }
    expect(cifra("100.00", nota("40.00", "AUTORIZADO"), nota("30.00", "EN_VALIDACION"))).toBe(
      "70.00",
    );
  });

  it("las rechazadas y las descartadas no cuentan: si ARCA rechaza una, deja de contar", () => {
    for (const estado of ["RECHAZADO", "DESCARTADO"] as const) {
      expect(cifra("100.00", nota("100.00", estado)), estado).toBe("0.00");
      expect(etiqueta("100.00", nota("100.00", estado)), estado).toBe("NINGUNA");
    }
    expect(
      cifra("100.00", nota("40.00"), nota("60.00", "RECHAZADO"), nota("9.00", "DESCARTADO")),
    ).toBe("40.00");
  });

  it("una nota en CONFLICTO cuenta como pendiente (pregunta abierta al dueño)", () => {
    expect(cifra("100.00", nota("25.00", "CONFLICTO"))).toBe("25.00");
  });

  it("toda nota cuenta o no según la tabla, para cada estado que existe", () => {
    for (const estado of ESTADOS_DE_COMPROBANTE_ARCA) {
      expect(cifra("100.00", nota("10.00", estado)), estado).toBe(
        CUENTA_COMO_ACREDITADA[estado] ? "10.00" : "0.00",
      );
    }
    expect(Object.keys(CUENTA_COMO_ACREDITADA).sort()).toEqual(
      [...ESTADOS_DE_COMPROBANTE_ARCA].sort(),
    );
  });

  it("una nota de débito que cita a la factura no acredita nada", () => {
    expect(cifra("100.00", nota("100.00", "AUTORIZADO", "NOTA_DEBITO_B"))).toBe("0.00");
    expect(cifra("100.00", nota("30.00"), nota("500.00", "AUTORIZADO", "NOTA_DEBITO_B"))).toBe(
      "30.00",
    );
  });

  it("solo cuentan las notas de crédito, de cualquier letra; una factura citada no cuenta", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const cuenta = claseDeComprobante(tipo) === "NOTA_CREDITO";
      expect(cifra("100.00", nota("10.00", "AUTORIZADO", tipo)), tipo).toBe(
        cuenta ? "10.00" : "0.00",
      );
    }
  });

  it("una nota de débito recibe etiqueta como una factura; una nota de crédito en sí, ninguna", () => {
    const notas = [nota("100.00")];
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const r = acreditacionDe(tipo, importe("100.00"), notas, CUENTA_COMO_ACREDITADA);
      if (claseDeComprobante(tipo) === "NOTA_CREDITO") expect(r, tipo).toBeNull();
      else expect(r?.etiqueta, tipo).toBe("TOTAL");
    }
  });

  it("una sola función para el cálculo y la etiqueta: la etiqueta sale de la cifra y el total", () => {
    expect(etiquetaDeAcreditacion(importe("10.00"), importe("0.00"))).toBe("NINGUNA");
    expect(etiquetaDeAcreditacion(importe("10.00"), importe("9.99"))).toBe("PARCIAL");
    expect(etiquetaDeAcreditacion(importe("10.00"), importe("10.00"))).toBe("TOTAL");
    expect(importeATexto(acreditadoPor([], importe("10.00"), CUENTA_COMO_ACREDITADA))).toBe("0.00");
  });
});

describe("qué estado de una nota cuenta como acreditado FIRME (DD-2 de E1)", () => {
  it("solo AUTORIZADO cuenta; la otra tabla (D-15) sigue contando las pendientes", () => {
    for (const estado of ESTADOS_DE_COMPROBANTE_ARCA) {
      expect(CUENTA_COMO_ACREDITADA_FIRME[estado], estado).toBe(estado === "AUTORIZADO");
    }
    expect(CUENTA_COMO_ACREDITADA.EN_VALIDACION).toBe(true);
    expect(CUENTA_COMO_ACREDITADA.PENDIENTE).toBe(true);
  });

  it("cada tabla cubre exactamente los estados del comprobante", () => {
    for (const tabla of [CUENTA_COMO_ACREDITADA, CUENTA_COMO_ACREDITADA_FIRME]) {
      expect(Object.keys(tabla).sort()).toEqual([...ESTADOS_DE_COMPROBANTE_ARCA].sort());
    }
  });

  it("la misma nota total pendiente acredita con una tabla y no con la otra", () => {
    const notas = [nota("100.00", "EN_VALIDACION")];
    const con = (cuenta: typeof CUENTA_COMO_ACREDITADA) => cuentaDe(cuenta, notas);
    expect(con(CUENTA_COMO_ACREDITADA)).toBe("TOTAL");
    expect(con(CUENTA_COMO_ACREDITADA_FIRME)).toBe("NINGUNA");
  });
});

const cuentaDe = (cuenta: typeof CUENTA_COMO_ACREDITADA, notas: readonly NotaParaAcreditar[]) =>
  acreditacionDe("FACTURA_B", importe("100.00"), notas, cuenta)?.etiqueta;

describe("si un comprobante sigue valiendo (D-F-1)", () => {
  const vigencia = (
    estado: EstadoDeComprobanteArca,
    notas: readonly NotaParaAcreditar[] = [],
    tipo: NotaParaAcreditar["tipo"] = "FACTURA_B",
  ) => motivoDeNoVigencia({ tipo, estado, total: importe("100.00") }, notas);

  it("DESCARTADO y RECHAZADO salen del estado, con notas o sin ellas", () => {
    expect(vigencia("DESCARTADO")).toBe("DESCARTADO");
    expect(vigencia("RECHAZADO")).toBe("RECHAZADO");
    expect(vigencia("DESCARTADO", [nota("100.00")])).toBe("DESCARTADO");
  });

  it("los que están en camino a ARCA y los autorizados sin notas son vigentes", () => {
    for (const estado of [
      "PENDIENTE",
      "EN_VALIDACION",
      "INCIERTO",
      "CONFLICTO",
      "AUTORIZADO",
    ] as const) {
      expect(vigencia(estado), estado).toBeNull();
    }
  });

  it("una nota de crédito AUTORIZADA por el total la deja no vigente; por un centavo menos, no", () => {
    expect(vigencia("AUTORIZADO", [nota("100.00")])).toBe("ACREDITADO_TOTAL");
    expect(vigencia("AUTORIZADO", [nota("100.01")])).toBe("ACREDITADO_TOTAL");
    expect(vigencia("AUTORIZADO", [nota("99.99")])).toBeNull();
  });

  it("varias notas autorizadas que suman el total también", () => {
    expect(vigencia("AUTORIZADO", [nota("60.00"), nota("40.00")])).toBe("ACREDITADO_TOTAL");
  });

  it("una nota total SIN autorizar no la deja no vigente (si ARCA la rechaza, valdría y se habría emitido otra)", () => {
    for (const estado of [
      "PENDIENTE",
      "EN_VALIDACION",
      "INCIERTO",
      "CONFLICTO",
      "RECHAZADO",
      "DESCARTADO",
    ] as const) {
      expect(vigencia("AUTORIZADO", [nota("100.00", estado)]), estado).toBeNull();
    }
  });

  it("una nota de débito citada no acredita; una nota de crédito en sí es vigente", () => {
    expect(vigencia("AUTORIZADO", [nota("100.00", "AUTORIZADO", "NOTA_DEBITO_B")])).toBeNull();
    expect(vigencia("AUTORIZADO", [nota("100.00")], "NOTA_CREDITO_B")).toBeNull();
  });

  it("los motivos son los tres del contrato", () => {
    expect(MOTIVOS_DE_NO_VIGENCIA).toEqual(["DESCARTADO", "RECHAZADO", "ACREDITADO_TOTAL"]);
  });
});
