import { describe, expect, it } from "vitest";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  armarAsiento,
  detalleDesdeTexto,
  huellaDeAnulacion,
  huellaDeAsiento,
  huellaDeImputacion,
  type EntradaDeAsiento,
} from "./asiento";

const imp = (t: string): Importe => importeDesdeTexto(ARS, t);
const U = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const vence = (t: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(t);
  if (!r.ok) throw new Error(t);
  return r.valor;
};

const base = (cambios: Partial<EntradaDeAsiento> = {}): EntradaDeAsiento => ({
  parteId: U(1),
  sentido: "A_PAGAR",
  clase: "CARGO_DE_FACTURA_DE_COMPRA",
  importe: imp("100.00"),
  origen: { tipo: "compras.factura", id: U(2) },
  clave: "clave-de-prueba-0001",
  hechoEn: new Date("2026-11-21T12:00:00Z"),
  distribucion: [{ centroDeCosto: U(3), importe: imp("100.00") }],
  ...cambios,
});
const error = (cambios: Partial<EntradaDeAsiento>) => {
  const r = armarAsiento(base(cambios));
  return r.ok ? null : r.error;
};

describe("armarAsiento", () => {
  it("arma el pedido con orden 1 por defecto, sin vencimiento ni detalle, y una huella de 64 hex", () => {
    const r = armarAsiento(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({
      naturaleza: "ORIGINAL",
      origenOrden: 1,
      venceEl: null,
      detalle: null,
      anulaA: null,
    });
    expect(r.valor.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it("la huella no depende de `hechoEn` ni del orden de los renglones de la distribución; sí de cualquier otro dato", () => {
    const dist = [
      { centroDeCosto: U(3), importe: imp("60.00") },
      { centroDeCosto: null, importe: imp("40.00") },
    ];
    const h = (c: Partial<EntradaDeAsiento>) => {
      const r = armarAsiento(base(c));
      return r.ok ? r.valor.huella : "ERROR";
    };
    const referencia = h({ distribucion: dist });
    expect(h({ distribucion: [...dist].reverse() })).toBe(referencia);
    expect(h({ distribucion: dist, hechoEn: new Date("2030-01-01T00:00:00Z") })).toBe(referencia);
    expect(h({ distribucion: dist, importe: imp("100.01") })).not.toBe(referencia);
    expect(
      h({ distribucion: dist, origen: { tipo: "compras.factura", id: U(2), orden: 2 } }),
    ).not.toBe(referencia);
    expect(h({ distribucion: dist, venceEl: vence("2026-12-01") })).not.toBe(referencia);
    expect(h({ distribucion: dist, parteId: U(9) })).not.toBe(referencia);
    expect(
      h({
        distribucion: [
          dist[0] as (typeof dist)[number],
          { centroDeCosto: U(4), importe: imp("40.00") },
        ],
      }),
    ).not.toBe(referencia);
  });

  it("clase: no existe, o es de otro sentido", () => {
    expect(error({ clase: "INVENTADA" })).toBe("CLASE_NO_ADMITIDA");
    expect(error({ sentido: "A_COBRAR" })).toBe("CLASE_NO_ADMITIDA");
  });

  it("signo: una clase + no admite importe negativo y una clase − no admite positivo; ± admite los dos (con detalle)", () => {
    const neg = {
      importe: imp("-100.00"),
      distribucion: [{ centroDeCosto: U(3), importe: imp("-100.00") }],
    };
    expect(error(neg)).toBe("SIGNO_DEL_IMPORTE_INVALIDO");
    expect(error({ clase: "PAGO_A_PROVEEDOR" })).toBe("SIGNO_DEL_IMPORTE_INVALIDO");
    expect(error({ clase: "PAGO_A_PROVEEDOR", ...neg })).toBeNull();
    expect(error({ clase: "AJUSTE_DE_SALDO", detalle: "Ajuste por diferencia" })).toBeNull();
    expect(
      error({ clase: "AJUSTE_DE_SALDO", detalle: "Ajuste por diferencia", ...neg }),
    ).toBeNull();
  });

  it("importe: cero y sobre el tope", () => {
    expect(error({ importe: imp("0.00") })).toBe("IMPORTE_INVALIDO");
    expect(error({ importe: imp("1000000000.00") })).toBe("IMPORTE_INVALIDO");
    expect(
      error({
        importe: imp("999999999.99"),
        distribucion: [{ centroDeCosto: null, importe: imp("999999999.99") }],
      }),
    ).toBeNull();
  });

  it("clave, parte y origen mal formados", () => {
    expect(error({ clave: "corta" })).toBe("CLAVE_INVALIDA");
    expect(error({ clave: "con espacios y caracteres raros!!" })).toBe("CLAVE_INVALIDA");
    expect(error({ parteId: "no-es-uuid" })).toBe("PARTE_NO_ENCONTRADA");
    expect(error({ origen: { tipo: "Mal Formado", id: U(2) } })).toBe("ORIGEN_INVALIDO");
    expect(error({ origen: { tipo: "compras", id: U(2) } })).toBe("ORIGEN_INVALIDO");
    expect(error({ origen: { tipo: "compras.factura", id: "x" } })).toBe("ORIGEN_INVALIDO");
    expect(error({ origen: { tipo: "compras.factura", id: U(2), orden: 0 } })).toBe(
      "ORIGEN_INVALIDO",
    );
    expect(error({ origen: { tipo: "compras.factura", id: U(2), orden: 1001 } })).toBe(
      "ORIGEN_INVALIDO",
    );
    expect(error({ origen: { tipo: "compras.factura", id: U(2), orden: 1.5 } })).toBe(
      "ORIGEN_INVALIDO",
    );
    expect(error({ origen: { tipo: "compras.factura", id: U(2), orden: 1000 } })).toBeNull();
    expect(error({ referencia: { tipo: "compras.pago", id: "x" } })).toBe("REFERENCIA_INVALIDA");
    expect(error({ referencia: { tipo: "compras.pago", id: U(5) } })).toBeNull();
  });

  it("vencimiento: solo en las clases que lo admiten", () => {
    expect(error({ venceEl: vence("2026-12-01") })).toBeNull();
    expect(
      error({
        clase: "PAGO_A_PROVEEDOR",
        importe: imp("-100.00"),
        distribucion: [{ centroDeCosto: U(3), importe: imp("-100.00") }],
        venceEl: vence("2026-12-01"),
      }),
    ).toBe("VENCIMIENTO_NO_ADMITIDO");
  });

  it("detalle: obligatorio donde la clase lo exige, no admitido donde no, y solo la lista de permitidos", () => {
    expect(error({ clase: "AJUSTE_DE_SALDO" })).toBe("DETALLE_OBLIGATORIO");
    expect(error({ clase: "AJUSTE_DE_SALDO", detalle: "   " })).toBe("DETALLE_OBLIGATORIO");
    expect(error({ clase: "AJUSTE_DE_SALDO", detalle: "con <etiqueta>" })).toBe("DETALLE_INVALIDO");
    expect(error({ detalle: "no corresponde" })).toBe("DETALLE_NO_ADMITIDO");
    expect(detalleDesdeTexto("  Ajuste   por diferencia  ")).toEqual({
      ok: true,
      valor: "Ajuste por diferencia",
    });
    expect(detalleDesdeTexto(null)).toEqual({ ok: true, valor: null });
    expect(detalleDesdeTexto("a".repeat(501)).ok).toBe(false);
  });

  it("distribución: tiene que sumar exacto, del signo del asiento, con al menos un renglón", () => {
    expect(error({ distribucion: [] })).toBe("DISTRIBUCION_INVALIDA");
    expect(error({ distribucion: [{ centroDeCosto: U(3), importe: imp("99.99") }] })).toBe(
      "DISTRIBUCION_INVALIDA",
    );
    expect(
      error({
        distribucion: [
          { centroDeCosto: U(3), importe: imp("120.00") },
          { centroDeCosto: U(4), importe: imp("-20.00") },
        ],
      }),
    ).toBe("DISTRIBUCION_INVALIDA");
  });
});

describe("las huellas de la imputación y de la anulación", () => {
  const renglones = [
    { saldanteId: U(1), saldadoId: U(2), importe: imp("10.00") },
    { saldanteId: U(1), saldadoId: U(3), importe: imp("20.00") },
  ];
  it("la de la imputación no depende del orden de los renglones; sí de la parte, el sentido y los importes", () => {
    const h = huellaDeImputacion(U(9), "A_PAGAR", renglones);
    expect(huellaDeImputacion(U(9), "A_PAGAR", [...renglones].reverse())).toBe(h);
    expect(huellaDeImputacion(U(8), "A_PAGAR", renglones)).not.toBe(h);
    expect(huellaDeImputacion(U(9), "A_COBRAR", renglones)).not.toBe(h);
    expect(
      huellaDeImputacion(U(9), "A_PAGAR", [
        { ...(renglones[0] as (typeof renglones)[number]), importe: imp("10.01") },
        renglones[1] as (typeof renglones)[number],
      ]),
    ).not.toBe(h);
  });
  it("la de la anulación depende del asiento y del detalle", () => {
    expect(huellaDeAnulacion(U(1), "Anulo")).toBe(huellaDeAnulacion(U(1), "Anulo"));
    expect(huellaDeAnulacion(U(1), "Anulo")).not.toBe(huellaDeAnulacion(U(2), "Anulo"));
    expect(huellaDeAnulacion(U(1), "Anulo")).not.toBe(huellaDeAnulacion(U(1), "Otro"));
  });
  it("huellaDeAsiento es la del pedido sin la huella", () => {
    const r = armarAsiento(base());
    if (!r.ok) throw new Error("no armó");
    const { huella, ...sin } = r.valor;
    expect(huellaDeAsiento(sin)).toBe(huella);
  });
});
