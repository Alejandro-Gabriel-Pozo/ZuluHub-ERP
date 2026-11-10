import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { DatosDelCobroValidos } from "./datos-del-cobro";
import {
  LARGO_MAXIMO_DEL_TIPO_DE_ORIGEN,
  ORDEN_MAXIMO_DE_COBRO,
  ORDEN_MINIMO_DE_COBRO,
  claveDelCobro,
  huellaDelCobro,
  validarOrigen,
  type EntradaDeCobro,
} from "./identidad-del-cobro";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const origen = { tipo: "ventas.cobranza_de_ticket", id: ID };

describe("el origen de un cobro", () => {
  it("el límite de orden es 1..50 y el del tipo 64", () => {
    expect([ORDEN_MINIMO_DE_COBRO, ORDEN_MAXIMO_DE_COBRO, LARGO_MAXIMO_DEL_TIPO_DE_ORIGEN]).toEqual(
      [1, 50, 64],
    );
  });

  it("acepta un origen bien formado en los bordes del orden", () => {
    for (const orden of [1, 2, 49, 50])
      expect(validarOrigen(origen, orden)).toEqual({ ok: true, valor: null });
  });

  it("rechaza un orden fuera de 1..50 o que no es entero", () => {
    for (const orden of [0, 51, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validarOrigen(origen, orden)).toEqual({ ok: false, error: "ORIGEN_INVALIDO" });
    }
  });

  it("el tipo tiene la forma modulo.cosa en minúsculas y guion bajo, hasta 64", () => {
    const tipo64 = `${"a".repeat(31)}.${"b".repeat(32)}`;
    expect(tipo64).toHaveLength(64);
    expect(validarOrigen({ tipo: tipo64, id: ID }, 1).ok).toBe(true);
    expect(validarOrigen({ tipo: `${tipo64}b`, id: ID }, 1).ok).toBe(false);
    for (const tipo of [
      "ventas",
      "ventas.",
      ".cobranza",
      "Ventas.cobranza",
      "ventas.cobranza.x",
      "ventas-cobranza",
      "ventas.cobranza1",
      " ventas.cobranza",
      "ventas.cobranza\n",
      "",
    ]) {
      expect(validarOrigen({ tipo, id: ID }, 1)).toEqual({ ok: false, error: "ORIGEN_INVALIDO" });
    }
    expect(validarOrigen({ tipo: "a_b.c_d", id: ID }, 1).ok).toBe(true);
  });

  it("el id es un uuid", () => {
    for (const id of ["", "abc", `${ID}0`, ID.slice(1)]) {
      expect(validarOrigen({ tipo: origen.tipo, id }, 1)).toEqual({
        ok: false,
        error: "ORIGEN_INVALIDO",
      });
    }
  });
});

describe("la clave del cobro", () => {
  it("es cobro_<origen.id>_<orden> y cumple la forma de la clave de la base", () => {
    expect(claveDelCobro(origen, 2)).toBe(`cobro_${ID}_2`);
    for (const orden of [1, 9, 10, 50]) {
      expect(claveDelCobro(origen, orden)).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    }
  });
});

describe("la huella del cobro", () => {
  const datos: DatosDelCobroValidos = {
    cupon: "AB1",
    ultimos4: "0042",
    marcaDeTarjetaId: ID,
    cuotas: 3,
    dni: "12345678",
  };
  const entrada: EntradaDeCobro = {
    origen,
    origenOrden: 1,
    cajaId: "caja-1",
    sucursalId: "suc-1",
    medioDePagoId: "medio-1",
    cuentaDeCobroId: "cuenta-1",
    importe: importeDesdeTexto(ARS, "150.50"),
    datos,
  };

  it("es el sha256 de la entrada canónica sin la clave (valor fijado)", () => {
    const canonica = JSON.stringify([
      "caja.cobro",
      origen.tipo,
      ID,
      1,
      "caja-1",
      "suc-1",
      "medio-1",
      "cuenta-1",
      "ARS",
      "150.50",
      "AB1",
      "0042",
      ID,
      3,
      "12345678",
    ]);
    expect(huellaDelCobro(entrada)).toBe(createHash("sha256").update(canonica).digest("hex"));
  });

  it("es estable: la misma entrada da la misma huella, y un campo ausente es null", () => {
    expect(huellaDelCobro({ ...entrada })).toBe(huellaDelCobro(entrada));
    const sinDatos = {
      ...entrada,
      cuentaDeCobroId: null,
      datos: { cupon: null, ultimos4: null, marcaDeTarjetaId: null, cuotas: null, dni: null },
    };
    expect(huellaDelCobro(sinDatos)).toBe(
      createHash("sha256")
        .update(
          JSON.stringify([
            "caja.cobro",
            origen.tipo,
            ID,
            1,
            "caja-1",
            "suc-1",
            "medio-1",
            null,
            "ARS",
            "150.50",
            null,
            null,
            null,
            null,
            null,
          ]),
        )
        .digest("hex"),
    );
  });

  it("cambiar CUALQUIER campo cambia la huella", () => {
    const otro = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e";
    const variantes: readonly EntradaDeCobro[] = [
      { ...entrada, origen: { ...origen, tipo: "ventas.otra_cosa" } },
      { ...entrada, origen: { ...origen, id: otro } },
      { ...entrada, origenOrden: 2 },
      { ...entrada, cajaId: "caja-2" },
      { ...entrada, sucursalId: "suc-2" },
      { ...entrada, medioDePagoId: "medio-2" },
      { ...entrada, cuentaDeCobroId: null },
      { ...entrada, importe: importeDesdeTexto(ARS, "150.51") },
      { ...entrada, datos: { ...datos, cupon: "AB2" } },
      { ...entrada, datos: { ...datos, ultimos4: "0043" } },
      { ...entrada, datos: { ...datos, marcaDeTarjetaId: otro } },
      { ...entrada, datos: { ...datos, cuotas: 4 } },
      { ...entrada, datos: { ...datos, dni: "12345679" } },
      { ...entrada, datos: { ...datos, cupon: null } },
    ];
    const huellas = new Set([huellaDelCobro(entrada), ...variantes.map(huellaDelCobro)]);
    expect(huellas.size).toBe(variantes.length + 1);
  });
});
