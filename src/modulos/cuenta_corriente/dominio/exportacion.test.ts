import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  antiguedadEnDias,
  armarFilasDeLaExportacion,
  COLUMNAS_DE_LA_EXPORTACION,
  origenDeLaExportacion,
  tramoDeAntiguedad,
  type MovimientoParaExportar,
} from "./exportacion";
import { armarHojaDeLaExportacion, type RotulosDeLaExportacion } from "./hoja-de-la-exportacion";

const fecha = (texto: string): FechaCivil => {
  const f = fechaCivilDesdeTexto(texto);
  if (!f.ok) throw new Error(texto);
  return f.valor;
};
const pesos = (t: string) => importeDesdeTexto(ARS, t);
const HOY = fecha("2026-11-26");

const movimiento = (cambios: Partial<MovimientoParaExportar> = {}): MovimientoParaExportar => ({
  asientoId: "a1",
  parteId: "p1",
  clase: "CARGO_DE_VENTA_A_CUENTA",
  importe: pesos("1000.00"),
  pendiente: pesos("1000.00"),
  anulado: false,
  vencida: false,
  fechaNegocio: fecha("2026-11-01"),
  venceEl: fecha("2026-12-01"),
  origenTipo: "ventas.ticket",
  origenId: "t1",
  sucursales: ["s1"],
  ...cambios,
});
const CLIENTES = new Map([["p1", { nombre: "Cliente Uno", cuit: "30711111112" }]]);
const SUCURSALES = new Map([["s1", "Norte"]]);
const SIN_MEDIOS = new Map();

describe("la antigüedad y sus tramos", () => {
  it("los tramos cortan en 30/31, 60/61 y 90/91 días (el límite superior de cada tramo está incluido)", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map((d) => tramoDeAntiguedad(d))).toEqual([
      "DE_0_A_30",
      "DE_0_A_30",
      "DE_31_A_60",
      "DE_31_A_60",
      "DE_61_A_90",
      "DE_61_A_90",
      "MAS_DE_90",
      "MAS_DE_90",
    ]);
  });

  it("la antigüedad cuenta días civiles hasta la fecha de la exportación y nunca es negativa", () => {
    expect(antiguedadEnDias(fecha("2026-11-26"), HOY)).toBe(0);
    expect(antiguedadEnDias(fecha("2026-10-27"), HOY)).toBe(30);
    expect(antiguedadEnDias(fecha("2026-10-26"), HOY)).toBe(31);
    expect(antiguedadEnDias(fecha("2026-11-27"), HOY)).toBe(0);
  });
});

describe("las filas de la exportación", () => {
  it("un cargo sale como una fila con su importe, lo pendiente, el origen, la sucursal y la antigüedad", () => {
    const [fila, ...resto] = armarFilasDeLaExportacion(
      [movimiento()],
      CLIENTES,
      SIN_MEDIOS,
      SUCURSALES,
      HOY,
    );
    expect(resto).toEqual([]);
    expect(fila).toMatchObject({
      cliente: "Cliente Uno",
      cuit: "30711111112",
      fechaDeNegocio: "2026-11-01",
      venceEl: "2026-12-01",
      clase: "CARGO_DE_VENTA_A_CUENTA",
      importeConSigno: "1000.00",
      pendiente: "1000.00",
      moneda: "ARS",
      antiguedadEnDias: 25,
      tramoDeAntiguedad: "DE_0_A_30",
      vencida: false,
      origen: "TICKET",
      sucursalId: "s1",
      sucursal: "Norte",
      tipoDeMedio: null,
      estado: "VIGENTE",
    });
  });

  it("una cobranza pagada con dos medios sale en dos filas del mismo asiento que suman EXACTAMENTE su importe (con signo negativo)", () => {
    const cobranza = movimiento({
      asientoId: "a2",
      clase: "COBRANZA",
      importe: pesos("-1000.00"),
      pendiente: pesos("0.00"),
      origenTipo: "ventas.cobranza_de_ticket",
      origenId: "c1",
    });
    const medios = new Map([
      [
        "c1",
        [
          { orden: 2, tipoDeMedio: "TARJETA_DEBITO", importe: pesos("333.34") },
          { orden: 1, tipoDeMedio: "EFECTIVO", importe: pesos("666.66") },
        ],
      ],
    ]);
    const filas = armarFilasDeLaExportacion([cobranza], CLIENTES, medios, SUCURSALES, HOY);
    expect(filas.map((f) => [f.asientoId, f.tipoDeMedio, f.importeConSigno, f.origen])).toEqual([
      ["a2", "EFECTIVO", "-666.66", "COBRANZA"],
      ["a2", "TARJETA_DEBITO", "-333.34", "COBRANZA"],
    ]);
  });

  it("si los medios no suman el importe de la cobranza, sale UNA fila con el importe completo y sin medio: no se pierde ni se inventa un centavo", () => {
    const cobranza = movimiento({
      clase: "COBRANZA",
      importe: pesos("-1000.00"),
      pendiente: pesos("0.00"),
      origenTipo: "ventas.cobranza_de_ticket",
      origenId: "c1",
    });
    const medios = new Map([
      [
        "c1",
        [
          { orden: 1, tipoDeMedio: "EFECTIVO", importe: pesos("600.00") },
          { orden: 2, tipoDeMedio: "QR", importe: pesos("300.00") },
        ],
      ],
    ]);
    const filas = armarFilasDeLaExportacion([cobranza], CLIENTES, medios, SUCURSALES, HOY);
    expect(filas.map((f) => [f.importeConSigno, f.tipoDeMedio])).toEqual([["-1000.00", null]]);
  });

  it("una cobranza con un solo medio lo lleva; sin cobros de caja, el medio queda vacío", () => {
    const cobranza = movimiento({
      clase: "COBRANZA",
      importe: pesos("-1000.00"),
      pendiente: pesos("0.00"),
      origenTipo: "ventas.cobranza_de_ticket",
      origenId: "c1",
    });
    const con = new Map([["c1", [{ orden: 1, tipoDeMedio: "QR", importe: pesos("1000.00") }]]]);
    expect(
      armarFilasDeLaExportacion([cobranza], CLIENTES, con, SUCURSALES, HOY)[0]?.tipoDeMedio,
    ).toBe("QR");
    expect(
      armarFilasDeLaExportacion([cobranza], CLIENTES, SIN_MEDIOS, SUCURSALES, HOY)[0]?.tipoDeMedio,
    ).toBeNull();
  });

  it("el espejo de una anulación reparte igual y el original anulado y su espejo suman cero", () => {
    const original = movimiento({ anulado: true, pendiente: pesos("0.00") });
    const espejo = movimiento({
      asientoId: "a1-espejo",
      importe: pesos("-1000.00"),
      pendiente: pesos("0.00"),
      anulado: true,
    });
    const filas = armarFilasDeLaExportacion(
      [original, espejo],
      CLIENTES,
      SIN_MEDIOS,
      SUCURSALES,
      HOY,
    );
    expect(filas.map((f) => f.estado)).toEqual(["ANULADO", "ANULADO"]);
    expect(filas.map((f) => f.importeConSigno)).toEqual(["1000.00", "-1000.00"]);
  });

  it("una sucursal sin nombre, varias sucursales o ninguna dejan la sucursal vacía; un cliente sin datos sale sin nombre ni CUIT", () => {
    const sinNombre = armarFilasDeLaExportacion(
      [movimiento()],
      new Map(),
      SIN_MEDIOS,
      new Map(),
      HOY,
    )[0];
    expect(sinNombre).toMatchObject({
      cliente: null,
      cuit: null,
      sucursalId: "s1",
      sucursal: null,
    });
    const varias = armarFilasDeLaExportacion(
      [movimiento({ sucursales: ["s1", "s2"] })],
      CLIENTES,
      SIN_MEDIOS,
      SUCURSALES,
      HOY,
    )[0];
    expect(varias).toMatchObject({ sucursalId: null, sucursal: null });
    const ninguna = armarFilasDeLaExportacion(
      [movimiento({ sucursales: [] })],
      CLIENTES,
      SIN_MEDIOS,
      SUCURSALES,
      HOY,
    )[0];
    expect(ninguna).toMatchObject({ sucursalId: null, sucursal: null });
  });

  it("el origen se clasifica por el tipo de origen del asiento; lo desconocido es OTRO", () => {
    expect(origenDeLaExportacion("ventas.ticket")).toBe("TICKET");
    expect(origenDeLaExportacion("ventas.cobranza_de_ticket")).toBe("COBRANZA");
    expect(origenDeLaExportacion("ajustes.manual")).toBe("OTRO");
  });
});

describe("la hoja de la exportación", () => {
  const ROTULOS: RotulosDeLaExportacion = {
    hoja: "Cuenta corriente",
    columnas: Object.fromEntries(
      COLUMNAS_DE_LA_EXPORTACION.map((c) => [c, `col:${c}`]),
    ) as RotulosDeLaExportacion["columnas"],
    tramos: { DE_0_A_30: "0-30", DE_31_A_60: "31-60", DE_61_A_90: "61-90", MAS_DE_90: "+90" },
    origenes: { TICKET: "ticket", COBRANZA: "cobranza", OTRO: "otro" },
    estados: { VIGENTE: "vigente", ANULADO: "anulado" },
    si: "sí",
    no: "no",
    clases: {},
    tiposDeMedio: {},
  };

  it("las columnas son exactamente estas, en este orden, y cada fila tiene una celda por columna (sin totales ni celdas combinadas)", () => {
    expect(COLUMNAS_DE_LA_EXPORTACION).toEqual([
      "cliente",
      "cuit",
      "fecha_de_negocio",
      "vence_el",
      "clase",
      "importe_con_signo",
      "pendiente",
      "moneda",
      "antiguedad_en_dias",
      "tramo_de_antiguedad",
      "vencida",
      "origen",
      "sucursal",
      "medio_de_pago",
      "estado",
    ]);
    const filas = armarFilasDeLaExportacion(
      [movimiento(), movimiento({ asientoId: "a9" })],
      CLIENTES,
      SIN_MEDIOS,
      SUCURSALES,
      HOY,
    );
    const hoja = armarHojaDeLaExportacion(filas, ROTULOS);
    expect(hoja.encabezados).toEqual(COLUMNAS_DE_LA_EXPORTACION.map((c) => `col:${c}`));
    expect(hoja.filas).toHaveLength(2);
    for (const fila of hoja.filas) expect(fila).toHaveLength(COLUMNAS_DE_LA_EXPORTACION.length);
  });

  it("las fechas salen como fecha civil ISO, el dinero como decimal exacto con su signo (nunca number), la moneda en su columna y los textos como texto", () => {
    const cobranza = movimiento({
      clase: "COBRANZA",
      importe: pesos("-1000.50"),
      pendiente: pesos("0.00"),
      origenTipo: "ventas.cobranza_de_ticket",
      origenId: "c1",
    });
    const filas = armarFilasDeLaExportacion([cobranza], CLIENTES, SIN_MEDIOS, SUCURSALES, HOY);
    const [celdas] = armarHojaDeLaExportacion(filas, ROTULOS).filas;
    const por = Object.fromEntries(COLUMNAS_DE_LA_EXPORTACION.map((c, i) => [c, celdas?.[i]]));
    expect(por["fecha_de_negocio"]).toEqual({ tipo: "fecha", valor: "2026-11-01" });
    expect(por["importe_con_signo"]).toEqual({ tipo: "decimal", valor: "-1000.50", decimales: 2 });
    expect(por["pendiente"]).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(por["moneda"]).toEqual({ tipo: "texto", valor: "ARS" });
    expect(por["antiguedad_en_dias"]).toEqual({ tipo: "entero", valor: 25 });
    expect(por["vencida"]).toEqual({ tipo: "texto", valor: "no" });
  });

  it("un nombre de cliente que parece una fórmula sale como celda de TEXTO con su contenido intacto: el escritor del archivo no lo interpreta", () => {
    const peligroso = new Map([
      ["p1", { nombre: '=HYPERLINK("http://x","clic")', cuit: "30711111112" }],
    ]);
    const filas = armarFilasDeLaExportacion([movimiento()], peligroso, SIN_MEDIOS, SUCURSALES, HOY);
    const [celdas] = armarHojaDeLaExportacion(filas, ROTULOS).filas;
    expect(celdas?.[0]).toEqual({ tipo: "texto", valor: '=HYPERLINK("http://x","clic")' });
  });
});
