import { describe, expect, it } from "vitest";
import {
  calcularDiferencias,
  leerResolucion,
  leerTolerancias,
  RESOLUCIONES_MANUALES,
  SIN_TOLERANCIAS,
  type AsignacionConciliada,
  type LineaConciliada,
  type Tolerancias,
} from "./diferencias";

const R1 = "00000000-0000-4000-8000-0000000000a1";
const R2 = "00000000-0000-4000-8000-0000000000a2";

describe("leerTolerancias", () => {
  it("todo ausente o null es «no definida» (no cero)", () => {
    expect(leerTolerancias({})).toEqual({ ok: true, valor: SIN_TOLERANCIAS });
    expect(leerTolerancias(undefined)).toEqual({ ok: true, valor: SIN_TOLERANCIAS });
    expect(leerTolerancias("x")).toEqual({ ok: true, valor: SIN_TOLERANCIAS });
    expect(
      leerTolerancias({ cantidad: null, precio: null, importe: null, recepcion: null }),
    ).toEqual({ ok: true, valor: SIN_TOLERANCIAS });
  });

  it("lee porcentajes de 0 a 100 y el importe en pesos, en forma canónica; el cero es una tolerancia definida", () => {
    expect(
      leerTolerancias({ cantidad: "2.5", precio: "0", importe: "10", recepcion: "100" }),
    ).toEqual({
      ok: true,
      valor: { cantidad: "2.5000", precio: "0.0000", importe: "10.00", recepcion: "100.0000" },
    });
  });

  it("un tope de importe en cero es una tolerancia definida", () => {
    expect(leerTolerancias({ importe: "0" })).toEqual({
      ok: true,
      valor: { ...SIN_TOLERANCIAS, importe: "0.00" },
    });
  });

  it("rechaza lo que no es un decimal en su rango, campo por campo", () => {
    for (const campo of ["cantidad", "precio", "recepcion"]) {
      for (const malo of ["100.0001", "-1", "1.00001", "x", 5, "", "1,5"]) {
        expect(leerTolerancias({ [campo]: malo })).toEqual({
          ok: false,
          error: "TOLERANCIA_INVALIDA",
        });
      }
    }
    for (const malo of ["-0.01", "1.001", "x", 5, ""]) {
      expect(leerTolerancias({ importe: malo })).toEqual({
        ok: false,
        error: "TOLERANCIA_INVALIDA",
      });
    }
  });
});

const linea = (
  numero: number,
  facturada: string,
  asignada: string,
  precioNeto: string,
  recibidoSinAsignar = false,
): LineaConciliada => ({ numero, facturada, asignada, precioNeto, recibidoSinAsignar });
const asignacion = (
  lineaDeFactura: number,
  cantidad: string,
  referencia: AsignacionConciliada["referencia"],
  recepcionId = R1,
  lineaDeRecepcion = 1,
): AsignacionConciliada => ({
  lineaDeFactura,
  recepcionId,
  lineaDeRecepcion,
  cantidad,
  referencia,
});
const ref = (precio: string, origen: "ORDEN" | "RECEPCION" = "ORDEN") => ({ precio, origen });
const tol = (extra: Partial<Tolerancias>): Tolerancias => ({ ...SIN_TOLERANCIAS, ...extra });

describe("calcularDiferencias: el ejemplo del dueño", () => {
  it("factura de 10 a 1250, asignados 9,6 contra una orden a 1200: cantidad de más 0,4 ($ 500) y precio +50 sobre 9,6 ($ 480), ambas abiertas sin tolerancias", () => {
    const r = calcularDiferencias(
      [linea(1, "10.0000", "9.6000", "1250.000000")],
      [asignacion(1, "9.6000", ref("1200.000000"))],
      SIN_TOLERANCIAS,
    );
    expect(r).toEqual([
      {
        tipo: "FACTURADO_DISTINTO_DE_LO_RECIBIDO",
        lineaDeComprobante: 1,
        recepcionId: null,
        lineaDeRecepcion: null,
        cantidadDeDiferencia: "0.4000",
        importeDeDiferencia: "500.00",
        precioFacturado: null,
        precioDeReferencia: null,
        origenDelPrecioDeReferencia: null,
        dentroDeTolerancia: false,
      },
      {
        tipo: "PRECIO_DISTINTO",
        lineaDeComprobante: 1,
        recepcionId: R1,
        lineaDeRecepcion: 1,
        cantidadDeDiferencia: "9.6000",
        importeDeDiferencia: "480.00",
        precioFacturado: "1250.000000",
        precioDeReferencia: "1200.000000",
        origenDelPrecioDeReferencia: "ORDEN",
        dentroDeTolerancia: false,
      },
    ]);
  });

  it("lo que coincide no genera nada; sin referencia no se compara el precio; una línea no conciliada no se mira", () => {
    expect(
      calcularDiferencias(
        [linea(1, "5.0000", "5.0000", "10.000000"), linea(2, "9.0000", "1.0000", "10.000000")],
        [asignacion(1, "5.0000", ref("10.000000"))],
        SIN_TOLERANCIAS,
      ),
    ).toEqual([]);
    const sinReferencia = calcularDiferencias(
      [linea(1, "5.0000", "5.0000", "99.000000")],
      [asignacion(1, "5.0000", null)],
      SIN_TOLERANCIAS,
    );
    expect(sinReferencia).toEqual([]);
  });

  it("el precio de menos es una diferencia con signo negativo; el origen de la referencia se guarda", () => {
    const [d] = calcularDiferencias(
      [linea(1, "2.0000", "2.0000", "9.500000")],
      [asignacion(1, "2.0000", ref("10.000000", "RECEPCION"))],
      SIN_TOLERANCIAS,
    );
    expect(d).toMatchObject({
      tipo: "PRECIO_DISTINTO",
      importeDeDiferencia: "-1.00",
      origenDelPrecioDeReferencia: "RECEPCION",
    });
  });

  it("el orden es fijo: las de cantidad por línea y después las de precio por asignación; con varias asignaciones, una de precio por cada una", () => {
    const r = calcularDiferencias(
      [linea(2, "10.0000", "6.0000", "10.000000"), linea(1, "4.0000", "3.0000", "10.000000")],
      [
        asignacion(2, "4.0000", ref("9.000000"), R1, 1),
        asignacion(2, "2.0000", ref("8.000000"), R2, 3),
        asignacion(1, "3.0000", ref("10.000000"), R1, 2),
      ],
      SIN_TOLERANCIAS,
    );
    expect(r.map((d) => [d.tipo, d.lineaDeComprobante, d.recepcionId, d.lineaDeRecepcion])).toEqual(
      [
        ["FACTURADO_DISTINTO_DE_LO_RECIBIDO", 1, null, null],
        ["FACTURADO_DISTINTO_DE_LO_RECIBIDO", 2, null, null],
        ["PRECIO_DISTINTO", 2, R1, 1],
        ["PRECIO_DISTINTO", 2, R2, 3],
      ],
    );
  });

  it("el importe se redondea una sola vez a centavos, con la mitad hacia afuera", () => {
    // 0,005 × 1 = 0,005 → 0,01 ; −0,005 → −0,01
    const [mas] = calcularDiferencias(
      [linea(1, "1.0000", "1.0000", "1.005000")],
      [asignacion(1, "1.0000", ref("1.000000"))],
      SIN_TOLERANCIAS,
    );
    expect(mas?.importeDeDiferencia).toBe("0.01");
    const [menos] = calcularDiferencias(
      [linea(1, "1.0000", "1.0000", "0.995000")],
      [asignacion(1, "1.0000", ref("1.000000"))],
      SIN_TOLERANCIAS,
    );
    expect(menos?.importeDeDiferencia).toBe("-0.01");
  });
});

describe("calcularDiferencias: conciliación por partes", () => {
  it("mientras quede mercadería recibida sin asignar no se mide lo facturado de más; cuando no queda, sí; el precio se mide siempre", () => {
    const asignaciones = [asignacion(1, "1000.0000", ref("1.000000"))];
    const parcial = calcularDiferencias(
      [linea(1, "3000.0000", "1000.0000", "1.100000", true)],
      asignaciones,
      SIN_TOLERANCIAS,
    );
    expect(parcial.map((d) => d.tipo)).toEqual(["PRECIO_DISTINTO"]);
    const ultima = calcularDiferencias(
      [linea(1, "3000.0000", "2500.0000", "1.100000", false)],
      asignaciones,
      SIN_TOLERANCIAS,
    );
    expect(ultima.map((d) => d.tipo)).toEqual([
      "FACTURADO_DISTINTO_DE_LO_RECIBIDO",
      "PRECIO_DISTINTO",
    ]);
    expect(ultima[0]).toMatchObject({ cantidadDeDiferencia: "500.0000" });
  });
});

describe("calcularDiferencias: tolerancias", () => {
  const cantidad = (t: Tolerancias) =>
    calcularDiferencias(
      [linea(1, "10.0000", "9.0000", "10.000000")],
      [asignacion(1, "9.0000", null)],
      t,
    )[0]?.dentroDeTolerancia;
  const precio = (t: Tolerancias, facturado = "10.500000") =>
    calcularDiferencias(
      [linea(1, "10.0000", "10.0000", facturado)],
      [asignacion(1, "10.0000", ref("10.000000"))],
      t,
    )[0]?.dentroDeTolerancia;

  it("sin ninguna definida, nunca está dentro; el cero definido tampoco deja pasar una diferencia", () => {
    expect(cantidad(SIN_TOLERANCIAS)).toBe(false);
    expect(precio(SIN_TOLERANCIAS)).toBe(false);
    expect(cantidad(tol({ cantidad: "0.0000" }))).toBe(false);
    expect(precio(tol({ precio: "0.0000" }))).toBe(false);
  });

  it("cantidad: el porcentaje se mide sobre lo asignado (1 de 9 = 11,11 %) y el límite es inclusivo", () => {
    expect(cantidad(tol({ cantidad: "11.1111" }))).toBe(false);
    expect(cantidad(tol({ cantidad: "11.1112" }))).toBe(true);
    expect(cantidad(tol({ cantidad: "50.0000" }))).toBe(true);
    // 1 de 4 = 25 % exacto
    const exacto = calcularDiferencias(
      [linea(1, "5.0000", "4.0000", "1.000000")],
      [asignacion(1, "4.0000", null)],
      tol({ cantidad: "25.0000" }),
    );
    expect(exacto[0]?.dentroDeTolerancia).toBe(true);
    const justo = calcularDiferencias(
      [linea(1, "5.0000", "4.0000", "1.000000")],
      [asignacion(1, "4.0000", null)],
      tol({ cantidad: "24.9999" }),
    );
    expect(justo[0]?.dentroDeTolerancia).toBe(false);
  });

  it("precio: el porcentaje se mide sobre la referencia (0,50 sobre 10 = 5 %), con el límite inclusivo y en los dos sentidos", () => {
    expect(precio(tol({ precio: "5.0000" }))).toBe(true);
    expect(precio(tol({ precio: "4.9999" }))).toBe(false);
    expect(precio(tol({ precio: "5.0000" }), "9.500000")).toBe(true);
    expect(precio(tol({ precio: "4.9999" }), "9.500000")).toBe(false);
  });

  it("el importe: tope en pesos sobre el importe de la diferencia, inclusivo; con porcentaje y importe definidos tienen que cumplirse los dos", () => {
    // diferencia de cantidad: 1 × 10 = 10,00
    expect(cantidad(tol({ importe: "10.00" }))).toBe(true);
    expect(cantidad(tol({ importe: "9.99" }))).toBe(false);
    expect(cantidad(tol({ cantidad: "50.0000", importe: "9.99" }))).toBe(false);
    expect(cantidad(tol({ cantidad: "10.0000", importe: "10.00" }))).toBe(false);
    expect(cantidad(tol({ cantidad: "50.0000", importe: "10.00" }))).toBe(true);
    // diferencia de precio: 0,50 × 10 = 5,00
    expect(precio(tol({ importe: "5.00" }))).toBe(true);
    expect(precio(tol({ importe: "4.99" }))).toBe(false);
    expect(precio(tol({ precio: "5.0000", importe: "4.99" }))).toBe(false);
    expect(precio(tol({ precio: "1.0000", importe: "5.00" }))).toBe(false);
  });

  it("la tolerancia de cantidad no se aplica a precio ni la de precio a cantidad; la de recepción no cuenta acá", () => {
    expect(precio(tol({ cantidad: "100.0000" }))).toBe(false);
    expect(cantidad(tol({ precio: "100.0000" }))).toBe(false);
    expect(cantidad(tol({ recepcion: "100.0000" }))).toBe(false);
  });

  it("un precio de referencia en cero no cumple una tolerancia de porcentaje", () => {
    const r = calcularDiferencias(
      [linea(1, "1.0000", "1.0000", "1.000000")],
      [asignacion(1, "1.0000", ref("0.000000"))],
      tol({ precio: "100.0000" }),
    );
    expect(r[0]?.dentroDeTolerancia).toBe(false);
  });
});

describe("leerResolucion", () => {
  it("lee las seis resoluciones manuales con su motivo; DENTRO_DE_TOLERANCIA no se elige a mano", () => {
    expect(RESOLUCIONES_MANUALES).toHaveLength(6);
    for (const resolucion of RESOLUCIONES_MANUALES) {
      expect(leerResolucion(resolucion, "Lo habló el gerente")).toEqual({
        ok: true,
        valor: { resolucion, motivo: "Lo habló el gerente" },
      });
    }
    for (const mala of ["DENTRO_DE_TOLERANCIA", "OTRA", "", 7, undefined, null]) {
      expect(leerResolucion(mala, "x")).toEqual({ ok: false, error: "RESOLUCION_INVALIDA" });
    }
  });

  it("el motivo es obligatorio y se lee como en las anulaciones", () => {
    for (const malo of [undefined, "", "   ", 5, "x".repeat(501)]) {
      expect(leerResolucion("ACEPTADA", malo)).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
    }
    expect(leerResolucion("ACEPTADA", "  con espacios  ")).toEqual({
      ok: true,
      valor: { resolucion: "ACEPTADA", motivo: "con espacios" },
    });
  });
});
