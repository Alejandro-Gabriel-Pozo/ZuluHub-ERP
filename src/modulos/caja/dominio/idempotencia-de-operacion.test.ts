import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { huellaDeCampos } from "./huella";
import {
  exigirClave,
  huellaDeAjuste,
  huellaDeAnulacion,
  huellaDeApertura,
  huellaDeMovimientoManual,
} from "./idempotencia-de-operacion";

const importe = (texto: string) => importeDesdeTexto(ARS, texto);
const fecha = (texto: string): FechaCivil => {
  const f = fechaCivilDesdeTexto(texto);
  if (!f.ok) throw new Error("fecha de prueba inválida");
  return f.valor;
};
const SUCURSAL = "11111111-1111-4111-8111-111111111111";
const CAJA = "22222222-2222-4222-8222-222222222222";
const SESION = "33333333-3333-4333-8333-333333333333";
const MEDIO = "44444444-4444-4444-8444-444444444444";
const CUENTA = "55555555-5555-4555-8555-555555555555";

describe("la clave de idempotencia", () => {
  it("acepta de 16 a 128 letras, números, guion y guion bajo", () => {
    for (const clave of [
      "a".repeat(16),
      "A".repeat(128),
      "0123456789abcdef",
      "abc-DEF_123-456_xyz",
    ]) {
      expect(exigirClave(clave)).toEqual({ ok: true, valor: clave });
    }
  });

  it("rechaza lo corto, lo largo, los caracteres de más y lo que no es texto", () => {
    for (const clave of [
      "a".repeat(15),
      "a".repeat(129),
      "",
      "con espacio 1234567",
      "con.punto.12345678",
      "ñandú-ñandú-ñandú-ñandú",
      "abcdefghijklmnop\n",
      "\nabcdefghijklmnop",
      "abcdefghijklmnop!",
      "!abcdefghijklmnop",
      16,
      null,
      undefined,
      { toString: () => "a".repeat(16) },
    ]) {
      expect(exigirClave(clave), String(clave)).toEqual({
        ok: false,
        error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      });
    }
  });
});

describe("la huella de abrir la sesión", () => {
  const base = { sucursalId: SUCURSAL, cajaId: CAJA, fondo: importe("1500.50") };

  it("es el sha256 de la operación con el importe como texto canónico", () => {
    expect(huellaDeApertura(base)).toBe(
      huellaDeCampos(["caja.abrir_sesion", SUCURSAL, CAJA, "ARS", "1500.50"]),
    );
    expect(huellaDeApertura({ ...base, cajaId: null })).toBe(
      huellaDeCampos(["caja.abrir_sesion", SUCURSAL, null, "ARS", "1500.50"]),
    );
  });

  it("es la misma para el mismo pedido aunque el importe se escriba distinto, y cambia con cualquier campo", () => {
    expect(huellaDeApertura({ ...base, fondo: importe("1500.5") })).toBe(huellaDeApertura(base));
    const distintas = [
      huellaDeApertura({ ...base, sucursalId: CAJA }),
      huellaDeApertura({ ...base, cajaId: SUCURSAL }),
      huellaDeApertura({ ...base, cajaId: null }),
      huellaDeApertura({ ...base, fondo: importe("1500.51") }),
    ];
    expect(new Set([huellaDeApertura(base), ...distintas]).size).toBe(5);
  });
});

describe("la huella de un ingreso o un egreso", () => {
  const base = {
    sesionId: SESION,
    clase: "INGRESO_MANUAL" as const,
    importe: importe("200"),
    motivo: "Cambio",
  };

  it("es el sha256 de la operación", () => {
    expect(huellaDeMovimientoManual(base)).toBe(
      huellaDeCampos([
        "caja.movimiento_manual",
        SESION,
        "INGRESO_MANUAL",
        "ARS",
        "200.00",
        "Cambio",
      ]),
    );
  });

  it("cambia con la sesión, la clase, el importe y el motivo", () => {
    const todas = [
      huellaDeMovimientoManual(base),
      huellaDeMovimientoManual({ ...base, sesionId: CAJA }),
      huellaDeMovimientoManual({ ...base, clase: "EGRESO_MANUAL" }),
      huellaDeMovimientoManual({ ...base, importe: importe("-200") }),
      huellaDeMovimientoManual({ ...base, motivo: "Otro" }),
    ];
    expect(new Set(todas).size).toBe(5);
    expect(huellaDeMovimientoManual({ ...base, importe: importe("200.0") })).toBe(todas[0]);
  });
});

describe("la huella de un ajuste", () => {
  const base = {
    sesionId: SESION,
    medioDePagoId: MEDIO,
    cuentaDeCobroId: CUENTA as string | null,
    importe: importe("-35.25"),
    motivo: "Error de carga",
    corrigeJornada: fecha("2026-11-08") as FechaCivil | null,
  };

  it("es el sha256 de la operación", () => {
    expect(huellaDeAjuste(base)).toBe(
      huellaDeCampos([
        "caja.ajuste",
        SESION,
        MEDIO,
        CUENTA,
        "ARS",
        "-35.25",
        "Error de carga",
        "2026-11-08",
      ]),
    );
  });

  it("cambia con cada campo, también con la cuenta y la jornada en null", () => {
    const todas = [
      huellaDeAjuste(base),
      huellaDeAjuste({ ...base, sesionId: CAJA }),
      huellaDeAjuste({ ...base, medioDePagoId: CAJA }),
      huellaDeAjuste({ ...base, cuentaDeCobroId: null }),
      huellaDeAjuste({ ...base, cuentaDeCobroId: SESION }),
      huellaDeAjuste({ ...base, importe: importe("35.25") }),
      huellaDeAjuste({ ...base, motivo: "Otro motivo" }),
      huellaDeAjuste({ ...base, corrigeJornada: null }),
      huellaDeAjuste({ ...base, corrigeJornada: fecha("2026-11-07") }),
    ];
    expect(new Set(todas).size).toBe(todas.length);
  });
});

describe("la huella de una anulación", () => {
  it("es el sha256 de la operación y cambia con el movimiento y el motivo", () => {
    const base = { movimientoId: SESION, motivo: "Duplicado" };
    expect(huellaDeAnulacion(base)).toBe(huellaDeCampos(["caja.anulacion", SESION, "Duplicado"]));
    expect(huellaDeAnulacion({ ...base, movimientoId: CAJA })).not.toBe(huellaDeAnulacion(base));
    expect(huellaDeAnulacion({ ...base, motivo: "Otro" })).not.toBe(huellaDeAnulacion(base));
  });

  it("las huellas de operaciones distintas no se confunden aunque lleven los mismos datos", () => {
    const a = huellaDeAnulacion({ movimientoId: SESION, motivo: "x" });
    const b = huellaDeCampos(["caja.movimiento_manual", SESION, "x"]);
    expect(a).not.toBe(b);
  });
});
