import { describe, expect, it } from "vitest";
import { exigirClave } from "./idempotencia-de-operacion";
import {
  claveDeAnulacionDeOrigen,
  claveDeEgresoDe,
  claveDeIngresoDe,
  esClaveReservada,
  ORIGENES_DE_EGRESO,
  ORIGENES_DE_INGRESO,
  origenDeEgresoValido,
  origenDeIngresoValido,
  PREFIJO_DE_CLAVE_DE_ANULACION,
  PREFIJO_DE_CLAVE_DE_EGRESO,
  PREFIJO_DE_CLAVE_DE_INGRESO,
} from "./origen-de-movimiento";

const ID = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";

describe("las listas cerradas de orígenes", () => {
  it("el egreso admite el pago a un proveedor y la entrega a rendir, y nada más", () => {
    expect([...ORIGENES_DE_EGRESO]).toEqual(["PAGO_A_PROVEEDOR", "ENTREGA_A_RENDIR"]);
  });

  it("el ingreso admite el reintegro de un proveedor y la devolución del sobrante, y nada más", () => {
    expect([...ORIGENES_DE_INGRESO]).toEqual(["REINTEGRO_DE_PROVEEDOR", "DEVOLUCION_DE_SOBRANTE"]);
  });

  it("un origen de ingreso no vale como egreso ni al revés (cada lista es la suya)", () => {
    for (const tipo of ORIGENES_DE_EGRESO) {
      expect(origenDeEgresoValido({ tipo, id: ID })).toBe(true);
      expect(origenDeIngresoValido({ tipo, id: ID })).toBe(false);
    }
    for (const tipo of ORIGENES_DE_INGRESO) {
      expect(origenDeIngresoValido({ tipo, id: ID })).toBe(true);
      expect(origenDeEgresoValido({ tipo, id: ID })).toBe(false);
    }
  });

  it("rechaza lo que no es un origen: otro tipo, minúsculas, id que no es uuid, faltantes y lo que no es objeto", () => {
    const malos: unknown[] = [
      { tipo: "OTRO", id: ID },
      { tipo: "pago_a_proveedor", id: ID },
      { tipo: "PAGO_A_PROVEEDOR", id: "no-es-uuid" },
      { tipo: "PAGO_A_PROVEEDOR", id: `${ID}\n` },
      { tipo: "PAGO_A_PROVEEDOR", id: 7 },
      { tipo: "PAGO_A_PROVEEDOR" },
      { id: ID },
      { tipo: 5, id: ID },
      { tipo: ["PAGO_A_PROVEEDOR"], id: ID },
      "PAGO_A_PROVEEDOR",
      null,
      undefined,
      7,
    ];
    for (const malo of malos) {
      expect(origenDeEgresoValido(malo), JSON.stringify(malo)).toBe(false);
      expect(origenDeIngresoValido(malo), JSON.stringify(malo)).toBe(false);
    }
  });

  it("un tipo heredado del prototipo no pasa por estar en la lista (se compara por valor)", () => {
    expect(origenDeEgresoValido({ tipo: "length", id: ID })).toBe(false);
    expect(origenDeIngresoValido({ tipo: "0", id: ID })).toBe(false);
  });
});

describe("las claves derivadas de un origen", () => {
  it("el egreso es egreso_<tipo en minúsculas>_<id>", () => {
    expect(claveDeEgresoDe({ tipo: "PAGO_A_PROVEEDOR", id: ID })).toBe(
      `egreso_pago_a_proveedor_${ID}`,
    );
    expect(claveDeEgresoDe({ tipo: "ENTREGA_A_RENDIR", id: ID })).toBe(
      `egreso_entrega_a_rendir_${ID}`,
    );
  });

  it("el ingreso es ingreso_<tipo en minúsculas>_<id>", () => {
    expect(claveDeIngresoDe({ tipo: "REINTEGRO_DE_PROVEEDOR", id: ID })).toBe(
      `ingreso_reintegro_de_proveedor_${ID}`,
    );
    expect(claveDeIngresoDe({ tipo: "DEVOLUCION_DE_SOBRANTE", id: ID })).toBe(
      `ingreso_devolucion_de_sobrante_${ID}`,
    );
  });

  it("el mismo uuid escrito en mayúsculas es la MISMA clave (no dos movimientos)", () => {
    expect(claveDeIngresoDe({ tipo: "REINTEGRO_DE_PROVEEDOR", id: ID.toUpperCase() })).toBe(
      claveDeIngresoDe({ tipo: "REINTEGRO_DE_PROVEEDOR", id: ID }),
    );
    expect(claveDeEgresoDe({ tipo: "ENTREGA_A_RENDIR", id: ID.toUpperCase() })).toBe(
      claveDeEgresoDe({ tipo: "ENTREGA_A_RENDIR", id: ID }),
    );
  });

  it("la clave lleva el id en minúsculas, venga como venga", () => {
    expect(claveDeIngresoDe({ tipo: "DEVOLUCION_DE_SOBRANTE", id: ID.toUpperCase() })).toBe(
      `ingreso_devolucion_de_sobrante_${ID}`,
    );
    expect(claveDeEgresoDe({ tipo: "PAGO_A_PROVEEDOR", id: ID.toUpperCase() })).toBe(
      `egreso_pago_a_proveedor_${ID}`,
    );
  });

  it("origen distinto, clave distinta; y el egreso y el ingreso nunca coinciden", () => {
    const claves = new Set([
      ...ORIGENES_DE_EGRESO.map((tipo) => claveDeEgresoDe({ tipo, id: ID })),
      ...ORIGENES_DE_INGRESO.map((tipo) => claveDeIngresoDe({ tipo, id: ID })),
    ]);
    expect(claves.size).toBe(4);
  });

  it("la anulación antepone su prefijo a la clave del movimiento", () => {
    expect(claveDeAnulacionDeOrigen("egreso_x")).toBe("anulacion_egreso_x");
  });

  it("toda clave derivada, la de la anulación incluida, tiene la forma que exige la base (16 a 128, letras, números, guion y guion bajo)", () => {
    const forma = /^[A-Za-z0-9_-]{16,128}$/;
    for (const tipo of ORIGENES_DE_EGRESO) {
      const clave = claveDeEgresoDe({ tipo, id: ID });
      expect(clave).toMatch(forma);
      expect(claveDeAnulacionDeOrigen(clave)).toMatch(forma);
    }
    for (const tipo of ORIGENES_DE_INGRESO) {
      const clave = claveDeIngresoDe({ tipo, id: ID });
      expect(clave).toMatch(forma);
      expect(claveDeAnulacionDeOrigen(clave)).toMatch(forma);
    }
  });
});

describe("las claves reservadas", () => {
  it("los prefijos son egreso_, ingreso_ y anulacion_", () => {
    expect(PREFIJO_DE_CLAVE_DE_EGRESO).toBe("egreso_");
    expect(PREFIJO_DE_CLAVE_DE_INGRESO).toBe("ingreso_");
    expect(PREFIJO_DE_CLAVE_DE_ANULACION).toBe("anulacion_");
  });

  it("toda clave derivada de un origen es reservada", () => {
    for (const tipo of ORIGENES_DE_EGRESO) {
      const clave = claveDeEgresoDe({ tipo, id: ID });
      expect(esClaveReservada(clave)).toBe(true);
      expect(esClaveReservada(claveDeAnulacionDeOrigen(clave))).toBe(true);
    }
    for (const tipo of ORIGENES_DE_INGRESO) {
      expect(esClaveReservada(claveDeIngresoDe({ tipo, id: ID }))).toBe(true);
    }
  });

  it("una clave de pantalla (uuid, o un prefijo parecido que no es el reservado) no es reservada", () => {
    for (const clave of [
      ID,
      "egreso-0123456789abcdef",
      "egresos_0123456789abcdef",
      "xegreso_0123456789abcdef",
      "Egreso_0123456789abcdef",
      "ingreso0123456789abcdef",
      "anulacion0123456789abcdef",
      "",
    ]) {
      expect(esClaveReservada(clave), clave).toBe(false);
    }
  });

  it("las operaciones de caja que mandan clave desde la pantalla la rechazan: nadie ocupa la clave de una entrega o un reintegro", () => {
    for (const clave of [
      claveDeEgresoDe({ tipo: "ENTREGA_A_RENDIR", id: ID }),
      claveDeIngresoDe({ tipo: "REINTEGRO_DE_PROVEEDOR", id: ID }),
      claveDeAnulacionDeOrigen(claveDeEgresoDe({ tipo: "PAGO_A_PROVEEDOR", id: ID })),
      "egreso_0123456789abcdef",
      "ingreso_0123456789abcdef",
      "anulacion_0123456789abcdef",
    ]) {
      expect(exigirClave(clave), clave).toEqual({
        ok: false,
        error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      });
    }
    expect(exigirClave(ID)).toEqual({ ok: true, valor: ID });
  });
});
