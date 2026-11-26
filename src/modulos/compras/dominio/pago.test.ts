import { describe, expect, it } from "vitest";
import {
  camposDeHuellaDePago,
  esClasePagable,
  esMedioDePago,
  leerPago,
  leerPagoConMedios,
  leerSalidaDeCaja,
  medioDeLaCabecera,
  MEDIOS_DE_LA_CABECERA,
  MEDIOS_DE_PAGO,
  resolverLosMedios,
} from "./pago";

const AHORA = new Date("2026-10-11T12:00:00Z");

describe("leerPago", () => {
  it("lee una fecha pasada o de hoy y un medio de la lista", () => {
    expect(leerPago({ fechaDePago: "2026-10-11", medio: "EFECTIVO" }, AHORA)).toEqual({
      ok: true,
      valor: { fechaDePago: "2026-10-11", medio: "EFECTIVO" },
    });
    expect(leerPago({ fechaDePago: "2026-01-01", medio: "QR" }, AHORA).ok).toBe(true);
  });
  it("rechaza una fecha futura, imposible, de otro tipo o ausente", () => {
    const engano = { toString: () => "2026-10-10" };
    for (const fechaDePago of [
      "2026-10-12",
      "2026-02-30",
      "ayer",
      "",
      null,
      undefined,
      20261010,
      engano,
    ]) {
      expect(leerPago({ fechaDePago, medio: "EFECTIVO" }, AHORA)).toEqual({
        ok: false,
        error: "FECHA_INVALIDA",
      });
    }
  });
  it("el «hoy» es el de Argentina: a las 01:00 UTC del 12 todavía es 11", () => {
    const tarde = new Date("2026-10-12T01:00:00Z");
    expect(leerPago({ fechaDePago: "2026-10-11", medio: "OTRO" }, tarde).ok).toBe(true);
    expect(leerPago({ fechaDePago: "2026-10-12", medio: "OTRO" }, tarde)).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
  });
  it("rechaza un medio que no es de la lista", () => {
    for (const medio of ["CHEQUE", "efectivo", "", null, undefined, 3, { toString: () => "QR" }]) {
      expect(leerPago({ fechaDePago: "2026-10-11", medio }, AHORA)).toEqual({
        ok: false,
        error: "MEDIO_INVALIDO",
      });
    }
  });
  it("la fecha se mira antes que el medio; lo que no es un objeto no tiene fecha", () => {
    expect(leerPago({ fechaDePago: "x", medio: "x" }, AHORA)).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
    for (const v of [null, undefined, 3, "x", []]) {
      expect(leerPago(v, AHORA)).toEqual({ ok: false, error: "FECHA_INVALIDA" });
    }
  });
});

describe("medios, clases y huella", () => {
  it("los seis medios de caja", () => {
    expect([...MEDIOS_DE_PAGO]).toEqual([
      "EFECTIVO",
      "TARJETA_DEBITO",
      "TARJETA_CREDITO",
      "TRANSFERENCIA",
      "QR",
      "OTRO",
    ]);
    for (const m of MEDIOS_DE_PAGO) expect(esMedioDePago(m)).toBe(true);
    expect(esMedioDePago("CHEQUE")).toBe(false);
  });
  it("se paga una factura o una nota de débito; una nota de crédito o cualquier otra cosa, no", () => {
    expect(esClasePagable("FACTURA")).toBe(true);
    expect(esClasePagable("NOTA_DE_DEBITO")).toBe(true);
    for (const c of ["NOTA_DE_CREDITO", "SIN_COMPROBANTE", "", "factura"])
      expect(esClasePagable(c)).toBe(false);
  });
  it("los campos de la huella son la fecha y los medios; el total derivado no entra (H-N3)", () => {
    expect(
      camposDeHuellaDePago({ fechaDePago: "2026-10-11", medios: [{ medio: "QR", importe: null }] }),
    ).toEqual(["2026-10-11", "QR"]);
    expect(
      camposDeHuellaDePago({
        fechaDePago: "2026-10-11",
        medios: [
          { medio: "EFECTIVO", importe: "1000.00" },
          { medio: "QR", importe: "1420.00" },
        ],
      }),
    ).toEqual(["2026-10-11", "EFECTIVO:1000.00", "QR:1420.00"]);
  });
  it("con salida de caja la huella suma la caja y el motivo; sin ella, la lista de siempre", () => {
    const pago = {
      fechaDePago: "2026-10-11",
      medios: [{ medio: "EFECTIVO", importe: null }],
    } as const;
    const salida = { cajaId: CAJA, motivo: "Pago de la factura" };
    expect(camposDeHuellaDePago(pago, salida)).toEqual([
      "2026-10-11",
      "EFECTIVO",
      CAJA,
      "Pago de la factura",
    ]);
    expect(camposDeHuellaDePago(pago, null)).toEqual(["2026-10-11", "EFECTIVO"]);
  });
});

describe("leerPagoConMedios", () => {
  const fecha = "2026-10-11";
  it("un solo `medio` es una línea sin importe: lleva el total que lee el servidor", () => {
    expect(leerPagoConMedios({ fechaDePago: fecha, medio: "QR" }, AHORA)).toEqual({
      ok: true,
      valor: { fechaDePago: fecha, medios: [{ medio: "QR", importe: null }] },
    });
  });
  it("varios `medios` salen en el orden de la lista y con el importe canónico, sin importar cómo llegaron", () => {
    const r = leerPagoConMedios(
      {
        fechaDePago: fecha,
        medios: [
          { medio: "QR", importe: "1420" },
          { medio: "EFECTIVO", importe: "1000.50" },
        ],
      },
      AHORA,
    );
    expect(r).toEqual({
      ok: true,
      valor: {
        fechaDePago: fecha,
        medios: [
          { medio: "EFECTIVO", importe: "1000.50" },
          { medio: "QR", importe: "1420.00" },
        ],
      },
    });
  });
  it("`medio` y `medios` juntos, o ninguno, no se admiten", () => {
    expect(
      leerPagoConMedios(
        { fechaDePago: fecha, medio: "QR", medios: [{ medio: "QR", importe: "1.00" }] },
        AHORA,
      ),
    ).toEqual({ ok: false, error: "MEDIO_INVALIDO" });
    expect(leerPagoConMedios({ fechaDePago: fecha }, AHORA)).toEqual({
      ok: false,
      error: "MEDIO_INVALIDO",
    });
  });
  it("sin fecha, con fecha futura o con una fecha que no es texto: FECHA_INVALIDA", () => {
    expect(leerPagoConMedios({ medio: "QR" }, AHORA)).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
    expect(
      leerPagoConMedios(
        { fechaDePago: "2026-10-12", medios: [{ medio: "QR", importe: "1.00" }] },
        AHORA,
      ),
    ).toEqual({ ok: false, error: "FECHA_INVALIDA" });
    expect(leerPagoConMedios({ fechaDePago: 5, medio: "QR" }, AHORA)).toEqual({
      ok: false,
      error: "FECHA_INVALIDA",
    });
  });
  it("lista vacía, más de seis, no lista, medio repetido o desconocido: MEDIO_INVALIDO", () => {
    const invalido = { ok: false, error: "MEDIO_INVALIDO" };
    const uno = { medio: "QR", importe: "1.00" };
    for (const medios of [
      [],
      "QR",
      null,
      [uno, uno],
      [{ medio: "CHEQUE", importe: "1.00" }],
      [...MEDIOS_DE_PAGO, "OTRO2"].map((medio) => ({ medio, importe: "1.00" })),
    ]) {
      expect(leerPagoConMedios({ fechaDePago: fecha, medios }, AHORA)).toEqual(invalido);
    }
  });
  it("un importe que no es un decimal positivo de hasta 2 decimales: MEDIO_INVALIDO", () => {
    for (const importe of ["0", "0.00", "-5.00", "1.005", "1,5", "", "abc", 10, null, undefined]) {
      expect(
        leerPagoConMedios({ fechaDePago: fecha, medios: [{ medio: "QR", importe }] }, AHORA),
      ).toEqual({ ok: false, error: "MEDIO_INVALIDO" });
    }
  });
  it("un elemento que no es un objeto: MEDIO_INVALIDO", () => {
    expect(leerPagoConMedios({ fechaDePago: fecha, medios: ["QR"] }, AHORA)).toEqual({
      ok: false,
      error: "MEDIO_INVALIDO",
    });
  });
});

describe("resolverLosMedios", () => {
  it("un medio sin importe lleva el total", () => {
    expect(resolverLosMedios([{ medio: "QR", importe: null }], "2420.00")).toEqual({
      ok: true,
      valor: [{ medio: "QR", importe: "2420.00" }],
    });
  });
  it("con importes, la suma en centavos tiene que ser exactamente el total", () => {
    const medios = [
      { medio: "EFECTIVO", importe: "0.10" },
      { medio: "QR", importe: "0.20" },
    ] as const;
    expect(resolverLosMedios(medios, "0.30").ok).toBe(true);
    for (const total of ["0.29", "0.31", "0.00", "30.00"]) {
      expect(resolverLosMedios(medios, total)).toEqual({
        ok: false,
        error: "LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL",
      });
    }
  });
  it("un total ilegible falla cerrado", () => {
    expect(resolverLosMedios([{ medio: "QR", importe: null }], "abc")).toEqual({
      ok: false,
      error: "LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL",
    });
  });
});

describe("medioDeLaCabecera", () => {
  it("el medio único, o COMPUESTO si hay más de uno; ambos están en la lista de la cabecera", () => {
    expect(medioDeLaCabecera([{ medio: "QR" }])).toBe("QR");
    expect(medioDeLaCabecera([{ medio: "QR" }, { medio: "OTRO" }])).toBe("COMPUESTO");
    expect(MEDIOS_DE_LA_CABECERA).toContain("COMPUESTO");
  });
});

const CAJA = "6f1c2a3e-8b4d-4c5e-9a7f-0d1e2f3a4b5c";

describe("leerSalidaDeCaja", () => {
  it("ausente (undefined o null) no mueve la caja, con cualquier medio", () => {
    for (const medio of MEDIOS_DE_PAGO) {
      expect(leerSalidaDeCaja(undefined, medio)).toEqual({ ok: true, valor: null });
      expect(leerSalidaDeCaja(null, medio)).toEqual({ ok: true, valor: null });
    }
  });
  it("una caja y un motivo bien escritos valen solo con el medio efectivo", () => {
    expect(leerSalidaDeCaja({ cajaId: CAJA, motivo: "  Pago de la factura " }, "EFECTIVO")).toEqual(
      { ok: true, valor: { cajaId: CAJA, motivo: "Pago de la factura" } },
    );
    for (const medio of MEDIOS_DE_PAGO.filter((m) => m !== "EFECTIVO")) {
      expect(leerSalidaDeCaja({ cajaId: CAJA, motivo: "Pago" }, medio)).toEqual({
        ok: false,
        error: "SALIDA_DE_CAJA_SOLO_EN_EFECTIVO",
      });
    }
  });
  it("una caja que no es un UUID, un motivo vacío o ausente, o algo que no es un objeto es inválido", () => {
    const invalido = { ok: false, error: "SALIDA_DE_CAJA_INVALIDA" };
    for (const malo of [
      { cajaId: "caja-1", motivo: "Pago" },
      { cajaId: CAJA, motivo: "" },
      { cajaId: CAJA, motivo: "   " },
      { cajaId: CAJA, motivo: 7 },
      { cajaId: CAJA },
      { motivo: "Pago" },
      { cajaId: 7, motivo: "Pago" },
      { cajaId: { toString: () => CAJA }, motivo: "Pago" },
      "texto",
      7,
      true,
      [],
      [CAJA, "Pago"],
      // Un arreglo o una función con las propiedades puestas a mano no es un objeto del pedido.
      Object.assign([], { cajaId: CAJA, motivo: "Pago" }),
      Object.assign(() => 0, { cajaId: CAJA, motivo: "Pago" }),
    ]) {
      expect(leerSalidaDeCaja(malo, "EFECTIVO")).toEqual(invalido);
    }
  });
  it("lo inválido gana sobre el medio: un medio que no es efectivo con datos malos es inválido, no «solo efectivo»", () => {
    expect(leerSalidaDeCaja({ cajaId: "x", motivo: "Pago" }, "QR")).toEqual({
      ok: false,
      error: "SALIDA_DE_CAJA_INVALIDA",
    });
  });
});
