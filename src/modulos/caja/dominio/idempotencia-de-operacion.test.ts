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
  huellaDeConforme,
  huellaDeCorreccion,
  huellaDeDeclaracion,
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

describe("la huella de las operaciones del cierre del día", () => {
  const COBRO = "66666666-6666-4666-8666-666666666666";
  const correccion = {
    cobroId: COBRO,
    medioDestinoId: MEDIO,
    cuentaDestinoId: CUENTA,
    motivo: "Era débito",
  };
  const declaracion = {
    sucursalId: SUCURSAL,
    fechaDeNegocio: fecha("2026-11-09"),
    medioDePagoId: MEDIO,
    cuentaDeCobroId: CUENTA,
    importe: importe("18400.00"),
  };

  it("la de la corrección es una función pura del cobro, el destino y el motivo", () => {
    const base = huellaDeCorreccion(correccion);
    expect(huellaDeCorreccion({ ...correccion })).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).toBe(
      huellaDeCampos(["caja.correccion_de_medio", COBRO, MEDIO, CUENTA, "Era débito"]),
    );
    const otras = [
      { ...correccion, cobroId: SESION },
      { ...correccion, medioDestinoId: CAJA },
      { ...correccion, cuentaDestinoId: null },
      { ...correccion, motivo: "Era crédito" },
    ];
    for (const otra of otras) expect(huellaDeCorreccion(otra)).not.toBe(base);
  });

  it("la de la declaración cambia con la jornada, el par o el importe; 18400 y 18400.00 son lo mismo", () => {
    const base = huellaDeDeclaracion(declaracion);
    expect(base).toBe(
      huellaDeCampos([
        "caja.declaracion_de_total",
        SUCURSAL,
        "2026-11-09",
        MEDIO,
        CUENTA,
        "ARS",
        "18400.00",
      ]),
    );
    expect(huellaDeDeclaracion({ ...declaracion, importe: importe("18400") })).toBe(base);
    const otras = [
      { ...declaracion, sucursalId: CAJA },
      { ...declaracion, fechaDeNegocio: fecha("2026-11-10") },
      { ...declaracion, medioDePagoId: CAJA },
      { ...declaracion, cuentaDeCobroId: null },
      { ...declaracion, importe: importe("18400.01") },
    ];
    for (const otra of otras) expect(huellaDeDeclaracion(otra)).not.toBe(base);
  });

  it("la del conforme general es solo de la jornada", () => {
    const base = huellaDeConforme({ sucursalId: SUCURSAL, fechaDeNegocio: fecha("2026-11-09") });
    expect(base).toBe(huellaDeCampos(["caja.conforme_general", SUCURSAL, "2026-11-09"]));
    expect(huellaDeConforme({ sucursalId: CAJA, fechaDeNegocio: fecha("2026-11-09") })).not.toBe(
      base,
    );
    expect(
      huellaDeConforme({ sucursalId: SUCURSAL, fechaDeNegocio: fecha("2026-11-10") }),
    ).not.toBe(base);
  });

  it("las tres operaciones no se confunden entre sí aunque compartan campos", () => {
    const huellas = new Set([
      huellaDeCorreccion(correccion),
      huellaDeDeclaracion(declaracion),
      huellaDeConforme({ sucursalId: SUCURSAL, fechaDeNegocio: fecha("2026-11-09") }),
    ]);
    expect(huellas.size).toBe(3);
  });
});
