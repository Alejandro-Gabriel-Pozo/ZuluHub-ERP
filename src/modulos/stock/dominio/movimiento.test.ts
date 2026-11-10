import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto, cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import {
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import {
  CLASES_DE_MOVIMIENTO,
  cantidadDeUnidades,
  compararTexto,
  comprobarCoherencia,
  comprobarEspejo,
  DECIMALES_DE_CANTIDAD,
  esAnulable,
  esClaseDeMovimiento,
  exigeDetalle,
  ORIGEN_EJEMPLAR_DE_TICKET,
  ORIGEN_MANUAL,
  ORIGEN_RECEPCION,
  ordenarParaBloqueo,
  signoValido,
  UNIDADES_POR_ENTERO,
  type ClaseDeMovimiento,
  type RenglonDeLibro,
} from "./movimiento";

const cs = (texto: string): CantidadConSigno => {
  const r = cantidadConSignoDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};
const r = (
  depositoId: string,
  articuloId: string,
  cantidad: string,
  composicionId: string | null = null,
): RenglonDeLibro => ({ depositoId, articuloId, composicionId, cantidad: cs(cantidad) });
const error = (clase: ClaseDeMovimiento, renglones: RenglonDeLibro[]) => {
  const res = comprobarCoherencia(clase, renglones);
  return res.ok ? null : res.error;
};

describe("la escala de las cantidades del libro", () => {
  it("sale de la primitiva: 4 decimales", () => {
    expect(DECIMALES_DE_CANTIDAD).toBe(4);
    expect(UNIDADES_POR_ENTERO).toBe(10_000n);
    expect(cantidadATexto(cantidadDeUnidades(12_345n))).toBe("1.2345");
  });
});

describe("los orígenes", () => {
  it("son los que conoce E5", () => {
    expect([ORIGEN_MANUAL, ORIGEN_EJEMPLAR_DE_TICKET, ORIGEN_RECEPCION]).toEqual([
      "MANUAL",
      "EJEMPLAR_DE_TICKET",
      "RECEPCION",
    ]);
  });
});

describe("las clases", () => {
  it("son seis y esClaseDeMovimiento reconoce solo esas", () => {
    expect(CLASES_DE_MOVIMIENTO).toEqual([
      "ENTRADA",
      "SALIDA",
      "TRANSFERENCIA",
      "AJUSTE",
      "AJUSTE_POR_CONTEO",
      "ANULACION",
    ]);
    for (const clase of CLASES_DE_MOVIMIENTO) expect(esClaseDeMovimiento(clase)).toBe(true);
    for (const otra of ["entrada", "RESERVA", "", "LIBERACION"]) {
      expect(esClaseDeMovimiento(otra)).toBe(false);
    }
  });

  it("solo el ajuste y la anulación exigen detalle", () => {
    const con = CLASES_DE_MOVIMIENTO.filter((c) => exigeDetalle(c));
    expect(con).toEqual(["AJUSTE", "ANULACION"]);
  });

  it("solo se anula lo manual que no es anulación ni ajuste por conteo", () => {
    for (const clase of CLASES_DE_MOVIMIENTO) {
      const esperado = clase !== "ANULACION" && clase !== "AJUSTE_POR_CONTEO";
      expect(esAnulable(clase, "MANUAL")).toBe(esperado);
      expect(esAnulable(clase, "EJEMPLAR_DE_TICKET")).toBe(false);
      expect(esAnulable(clase, "RECEPCION")).toBe(false);
      expect(esAnulable(clase, "manual")).toBe(false);
    }
  });
});

describe("signoValido: el signo de cada renglón por clase", () => {
  const casos: [ClaseDeMovimiento, boolean, boolean][] = [
    // clase, ¿admite positivo?, ¿admite negativo?
    ["ENTRADA", true, false],
    ["SALIDA", false, true],
    ["TRANSFERENCIA", true, true],
    ["AJUSTE", true, true],
    ["AJUSTE_POR_CONTEO", true, true],
    ["ANULACION", true, true],
  ];
  it.each(casos)("%s", (clase, positivo, negativo) => {
    expect(signoValido(clase, cs("0.0001"))).toBe(positivo);
    expect(signoValido(clase, cs("12"))).toBe(positivo);
    expect(signoValido(clase, cs("-0.0001"))).toBe(negativo);
    expect(signoValido(clase, cs("-12"))).toBe(negativo);
  });

  it("un renglón en cero nunca vale, de ninguna clase", () => {
    for (const clase of CLASES_DE_MOVIMIENTO) expect(signoValido(clase, cs("0"))).toBe(false);
  });
});

describe("comprobarCoherencia", () => {
  it("sin renglones no hay movimiento", () => {
    for (const clase of CLASES_DE_MOVIMIENTO) expect(error(clase, [])).toBe("SIN_RENGLONES");
  });

  it("la entrada solo suma y la salida solo resta", () => {
    expect(error("ENTRADA", [r("d1", "a", "1")])).toBeNull();
    expect(error("ENTRADA", [r("d1", "a", "1"), r("d1", "b", "-1")])).toBe("SIGNO_INVALIDO");
    expect(error("ENTRADA", [r("d1", "a", "0")])).toBe("SIGNO_INVALIDO");
    expect(error("SALIDA", [r("d1", "a", "-1"), r("d1", "b", "-2")])).toBeNull();
    expect(error("SALIDA", [r("d1", "a", "-1"), r("d1", "b", "2")])).toBe("SIGNO_INVALIDO");
  });

  it("los ajustes y la anulación admiten los dos signos y no admiten cero", () => {
    for (const clase of ["AJUSTE", "AJUSTE_POR_CONTEO", "ANULACION"] as const) {
      expect(error(clase, [r("d1", "a", "1"), r("d1", "b", "-1")])).toBeNull();
      expect(error(clase, [r("d1", "a", "0")])).toBe("SIGNO_INVALIDO");
    }
  });

  it("un mismo (depósito, artículo, composición) no se repite; cambiar uno de los tres lo hace otro renglón", () => {
    expect(error("ENTRADA", [r("d1", "a", "1"), r("d1", "a", "2")])).toBe("RENGLON_REPETIDO");
    expect(error("ENTRADA", [r("d1", "a", "1", "c"), r("d1", "a", "2", "c")])).toBe(
      "RENGLON_REPETIDO",
    );
    expect(error("ENTRADA", [r("d1", "a", "1"), r("d1", "a", "2", "c")])).toBeNull();
    expect(error("ENTRADA", [r("d1", "a", "1"), r("d2", "a", "2")])).toBeNull();
    expect(error("ENTRADA", [r("d1", "a", "1"), r("d1", "b", "2")])).toBeNull();
  });

  describe("la transferencia", () => {
    it("resta en un depósito, suma en otro y suma cero por artículo", () => {
      expect(error("TRANSFERENCIA", [r("d1", "a", "-5"), r("d2", "a", "5")])).toBeNull();
      expect(
        error("TRANSFERENCIA", [
          r("d1", "a", "-5"),
          r("d2", "a", "5"),
          r("d1", "b", "-1.5"),
          r("d2", "b", "1.5"),
        ]),
      ).toBeNull();
    });

    it("no es entre dos depósitos si es el mismo, si falta una pata o si hay más de un origen o destino", () => {
      const e = "TRANSFERENCIA_NO_ENTRE_DOS_DEPOSITOS";
      expect(error("TRANSFERENCIA", [r("d1", "a", "-5"), r("d1", "b", "5")])).toBe(e);
      expect(error("TRANSFERENCIA", [r("d1", "a", "-5")])).toBe(e);
      expect(error("TRANSFERENCIA", [r("d1", "a", "5")])).toBe(e);
      expect(
        error("TRANSFERENCIA", [r("d1", "a", "-5"), r("d3", "b", "-5"), r("d2", "a", "10")]),
      ).toBe(e);
      expect(
        error("TRANSFERENCIA", [r("d1", "a", "-10"), r("d2", "a", "5"), r("d3", "a", "5")]),
      ).toBe(e);
    });

    it("un renglón en cero no es ni origen ni destino", () => {
      // Con cero en un tercer depósito, el origen y el destino siguen siendo uno cada uno: el rechazo es por el signo del cero.
      expect(
        error("TRANSFERENCIA", [r("d1", "a", "-5"), r("d2", "a", "5"), r("d3", "b", "0")]),
      ).toBe("SIGNO_INVALIDO");
    });

    it("un artículo que cierra en cero no tapa a otro que no", () => {
      expect(
        error("TRANSFERENCIA", [
          r("d1", "a", "-5"),
          r("d2", "a", "5"),
          r("d1", "b", "-1"),
          r("d2", "b", "2"),
        ]),
      ).toBe("TRANSFERENCIA_NO_SUMA_CERO");
      expect(
        error("TRANSFERENCIA", [
          r("d1", "a", "-5"),
          r("d2", "a", "4"),
          r("d1", "b", "-1"),
          r("d2", "b", "1"),
        ]),
      ).toBe("TRANSFERENCIA_NO_SUMA_CERO");
    });

    it("suma cero por artículo, no en total", () => {
      expect(error("TRANSFERENCIA", [r("d1", "a", "-5"), r("d2", "a", "4")])).toBe(
        "TRANSFERENCIA_NO_SUMA_CERO",
      );
      expect(
        error("TRANSFERENCIA", [
          r("d1", "a", "-5"),
          r("d2", "a", "4"),
          r("d1", "b", "-1"),
          r("d2", "b", "2"),
        ]),
      ).toBe("TRANSFERENCIA_NO_SUMA_CERO");
    });

    it("el orden de las comprobaciones: depósitos, signo, repetidos y, al final, la suma", () => {
      // el mismo depósito y además repetido: manda lo de los depósitos
      expect(error("TRANSFERENCIA", [r("d1", "a", "-1"), r("d1", "a", "1")])).toBe(
        "TRANSFERENCIA_NO_ENTRE_DOS_DEPOSITOS",
      );
      // repetido y, además, no suma cero: manda lo repetido
      expect(
        error("TRANSFERENCIA", [r("d1", "a", "-1"), r("d1", "a", "-1"), r("d2", "a", "1")]),
      ).toBe("RENGLON_REPETIDO");
    });
  });

  it("las clases que no son transferencia no piden sumar cero ni dos depósitos", () => {
    expect(error("AJUSTE", [r("d1", "a", "5")])).toBeNull();
    expect(error("SALIDA", [r("d1", "a", "-5"), r("d2", "b", "-5")])).toBeNull();
  });
});

describe("comprobarEspejo", () => {
  const original = [r("d1", "a", "-5", "c1"), r("d1", "b", "2")];

  it("es el espejo si cada renglón tiene el mismo depósito, artículo y composición y la cantidad opuesta, en cualquier orden", () => {
    expect(comprobarEspejo(original, [r("d1", "a", "5", "c1"), r("d1", "b", "-2")])).toBe(true);
    expect(comprobarEspejo(original, [r("d1", "b", "-2"), r("d1", "a", "5", "c1")])).toBe(true);
    expect(comprobarEspejo([], [])).toBe(true);
  });

  it("no lo es si cambia la cantidad, el signo, el depósito, el artículo, la composición o la cantidad de renglones", () => {
    expect(comprobarEspejo(original, [r("d1", "a", "4", "c1"), r("d1", "b", "-2")])).toBe(false);
    expect(comprobarEspejo(original, [r("d1", "a", "-5", "c1"), r("d1", "b", "-2")])).toBe(false);
    expect(comprobarEspejo(original, [r("d2", "a", "5", "c1"), r("d1", "b", "-2")])).toBe(false);
    expect(comprobarEspejo(original, [r("d1", "c", "5", "c1"), r("d1", "b", "-2")])).toBe(false);
    expect(comprobarEspejo(original, [r("d1", "a", "5", "c2"), r("d1", "b", "-2")])).toBe(false);
    expect(comprobarEspejo(original, [r("d1", "a", "5"), r("d1", "b", "-2")])).toBe(false);
    expect(comprobarEspejo(original, [r("d1", "a", "5", "c1")])).toBe(false);
    expect(
      comprobarEspejo(original, [r("d1", "a", "5", "c1"), r("d1", "b", "-2"), r("d1", "z", "1")]),
    ).toBe(false);
  });

  it("un original con un renglón repetido no tiene espejo", () => {
    const repetido = [r("d1", "a", "-5"), r("d1", "a", "-5")];
    expect(comprobarEspejo(repetido, [r("d1", "a", "5"), r("d1", "a", "5")])).toBe(false);
  });

  it("el espejo de una anulación de otra anulación se compara igual: cantidades opuestas", () => {
    expect(comprobarEspejo([r("d1", "a", "0.0001")], [r("d1", "a", "-0.0001")])).toBe(true);
  });
});

describe("ordenarParaBloqueo", () => {
  it("ordena por depósito, artículo y composición (null primero) y no toca la entrada", () => {
    const entrada = [
      r("d2", "a", "1"),
      r("d1", "b", "1"),
      r("d1", "a", "1", "z"),
      r("d1", "a", "1", "1"),
      r("d1", "a", "1"),
    ];
    const copia = [...entrada];
    const orden = ordenarParaBloqueo(entrada).map((x) => [
      x.depositoId,
      x.articuloId,
      x.composicionId,
    ]);
    expect(orden).toEqual([
      ["d1", "a", null],
      ["d1", "a", "1"],
      ["d1", "a", "z"],
      ["d1", "b", null],
      ["d2", "a", null],
    ]);
    expect(entrada).toEqual(copia);
  });

  it("el orden no depende de cómo vengan: las seis permutaciones de (sin composición, «1», «A») dan lo mismo", () => {
    const [x, y, z] = [r("d1", "a", "1"), r("d1", "a", "1", "1"), r("d1", "a", "1", "A")];
    const permutaciones = [
      [x, y, z],
      [x, z, y],
      [y, x, z],
      [y, z, x],
      [z, x, y],
      [z, y, x],
    ];
    for (const p of permutaciones) {
      expect(ordenarParaBloqueo(p).map((e) => e.composicionId)).toEqual([null, "1", "A"]);
    }
  });

  it("dos transferencias cruzadas toman los bloqueos en el mismo orden", () => {
    const ida = ordenarParaBloqueo([r("A", "x", "-1"), r("B", "x", "1")]).map((x) => x.depositoId);
    const vuelta = ordenarParaBloqueo([r("B", "x", "-1"), r("A", "x", "1")]).map(
      (x) => x.depositoId,
    );
    expect(ida).toEqual(["A", "B"]);
    expect(vuelta).toEqual(ida);
  });

  it("compararTexto compara por unidades de código", () => {
    expect(compararTexto("a", "b")).toBe(-1);
    expect(compararTexto("b", "a")).toBe(1);
    expect(compararTexto("a", "a")).toBe(0);
    expect(compararTexto("B", "a")).toBe(-1);
    expect(compararTexto("", "a")).toBe(-1);
  });
});

describe("cantidadDesdeTexto de la primitiva coincide con la escala", () => {
  it("1 en unidades mínimas es la escala", () => {
    expect(cantidadDesdeTexto("1").unidades).toBe(UNIDADES_POR_ENTERO);
  });
});
