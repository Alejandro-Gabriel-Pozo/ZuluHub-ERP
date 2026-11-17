import { describe, expect, it } from "vitest";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import {
  decidirExistenciaNegativa,
  nivelDeExistenciaNegativa,
  NIVELES_DE_EXISTENCIA_NEGATIVA,
  type NivelDeExistenciaNegativa,
  type RenglonAControlar,
} from "./control";
import { CLASES_DE_MOVIMIENTO } from "./movimiento";

const cs = (texto: string): CantidadConSigno => {
  const r = cantidadConSignoDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};
const reng = (
  cantidad: string,
  existenciaActual: string,
  confirmoNegativo = false,
  depositoId = "d1",
  articuloId = "a",
): RenglonAControlar => ({
  depositoId,
  articuloId,
  cantidad: cs(cantidad),
  existenciaActual: cs(existenciaActual),
  confirmoNegativo,
});

describe("nivelDeExistenciaNegativa", () => {
  it("sin fila vale PERMITIR (D125)", () => {
    expect(nivelDeExistenciaNegativa(null)).toBe("PERMITIR");
  });

  it("los tres niveles se reconocen", () => {
    expect(NIVELES_DE_EXISTENCIA_NEGATIVA).toEqual(["PERMITIR", "AVISAR", "BLOQUEAR"]);
    for (const nivel of NIVELES_DE_EXISTENCIA_NEGATIVA) {
      expect(nivelDeExistenciaNegativa(nivel)).toBe(nivel);
    }
  });

  it("un valor desconocido cierra: BLOQUEAR", () => {
    for (const raro of ["", "permitir", "PERMITIR ", "NINGUNO", "avisar"]) {
      expect(nivelDeExistenciaNegativa(raro)).toBe("BLOQUEAR");
    }
  });
});

describe("decidirExistenciaNegativa", () => {
  const niveles: NivelDeExistenciaNegativa[] = [...NIVELES_DE_EXISTENCIA_NEGATIVA];

  it("si ningún saldo queda negativo pasa, con cualquier nivel (también en cero justo)", () => {
    for (const nivel of niveles) {
      expect(decidirExistenciaNegativa(nivel, "SALIDA", [reng("-1", "1")])).toEqual({
        resultado: "PASA",
        negativos: [],
      });
      expect(decidirExistenciaNegativa(nivel, "SALIDA", [reng("-1", "5")]).resultado).toBe("PASA");
    }
  });

  it("sin renglones pasa", () => {
    expect(decidirExistenciaNegativa("BLOQUEAR", "SALIDA", [])).toEqual({
      resultado: "PASA",
      negativos: [],
    });
  });

  it("PERMITIR: queda negativo y pasa con excepción, con el detalle del saldo", () => {
    const r = decidirExistenciaNegativa("PERMITIR", "SALIDA", [reng("-1", "0", false, "d9", "z")]);
    expect(r.resultado).toBe("PASA_CON_EXCEPCION");
    expect(r.negativos).toHaveLength(1);
    expect(r.negativos[0]).toMatchObject({ depositoId: "d9", articuloId: "z", confirmado: false });
    expect(
      cantidadConSignoATexto(
        (r.negativos[0] as { existenciaResultante: CantidadConSigno }).existenciaResultante,
      ),
    ).toBe("-1.0000");
  });

  it("BLOQUEAR: rechaza aunque venga confirmado, con todos los saldos negativos", () => {
    const r = decidirExistenciaNegativa("BLOQUEAR", "SALIDA", [
      reng("-3", "1", true, "d1", "a"),
      reng("-1", "9", true, "d1", "b"),
      reng("-2.5", "-1", true, "d1", "c"),
    ]);
    expect(r.resultado).toBe("BLOQUEA");
    expect(
      r.negativos.map((n) => [n.articuloId, cantidadConSignoATexto(n.existenciaResultante)]),
    ).toEqual([
      ["a", "-2.0000"],
      ["c", "-3.5000"],
    ]);
  });

  it("AVISAR: sin confirmar pide confirmación; con todos confirmados pasa con excepción", () => {
    expect(decidirExistenciaNegativa("AVISAR", "SALIDA", [reng("-2", "1")]).resultado).toBe(
      "REQUIERE_CONFIRMACION",
    );
    expect(decidirExistenciaNegativa("AVISAR", "SALIDA", [reng("-2", "1", true)]).resultado).toBe(
      "PASA_CON_EXCEPCION",
    );
  });

  it("AVISAR: basta un renglón negativo sin confirmar; el que no queda negativo no necesita confirmar", () => {
    const sinConfirmar = decidirExistenciaNegativa("AVISAR", "SALIDA", [
      reng("-2", "1", true, "d1", "a"),
      reng("-2", "1", false, "d1", "b"),
    ]);
    expect(sinConfirmar.resultado).toBe("REQUIERE_CONFIRMACION");
    expect(sinConfirmar.negativos.map((n) => n.confirmado)).toEqual([true, false]);
    expect(
      decidirExistenciaNegativa("AVISAR", "SALIDA", [
        reng("-2", "1", true, "d1", "a"),
        reng("-1", "5", false, "d1", "b"),
      ]).resultado,
    ).toBe("PASA_CON_EXCEPCION");
  });

  it("una existencia que ya era negativa y baja más sigue contando; una que sube hacia cero sin llegar no es salida", () => {
    expect(decidirExistenciaNegativa("BLOQUEAR", "SALIDA", [reng("-0.0001", "-1")]).resultado).toBe(
      "BLOQUEA",
    );
  });

  describe("solo se controlan las salidas y la pata de origen de una transferencia", () => {
    it("la transferencia: el origen se controla; el destino no, aunque su saldo ya esté negativo", () => {
      const origen = reng("-5", "1", false, "d1");
      const destino = reng("5", "-10", false, "d2");
      const r = decidirExistenciaNegativa("BLOQUEAR", "TRANSFERENCIA", [origen, destino]);
      expect(r.resultado).toBe("BLOQUEA");
      expect(r.negativos.map((n) => n.depositoId)).toEqual(["d1"]);
      expect(decidirExistenciaNegativa("BLOQUEAR", "TRANSFERENCIA", [destino]).resultado).toBe(
        "PASA",
      );
    });

    it("un renglón en cero no se controla", () => {
      expect(decidirExistenciaNegativa("BLOQUEAR", "SALIDA", [reng("0", "-1")]).resultado).toBe(
        "PASA",
      );
    });

    it("ajustes, conteos, anulaciones y entradas nunca se bloquean ni se avisan, resten lo que resten", () => {
      const otras = CLASES_DE_MOVIMIENTO.filter((c) => c !== "SALIDA" && c !== "TRANSFERENCIA");
      expect(otras).toEqual(["ENTRADA", "AJUSTE", "AJUSTE_POR_CONTEO", "ANULACION"]);
      for (const clase of otras) {
        for (const nivel of niveles) {
          expect(decidirExistenciaNegativa(nivel, clase, [reng("-9", "1")])).toEqual({
            resultado: "PASA",
            negativos: [],
          });
        }
      }
    });
  });

  it("una suma fuera del rango es un defecto: se lanza", () => {
    expect(() =>
      decidirExistenciaNegativa("PERMITIR", "SALIDA", [reng("-1", "-99999999999999.9999")]),
    ).toThrow(/existencia resultante se sale del rango/);
  });
});
