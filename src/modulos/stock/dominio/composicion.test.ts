import { describe, expect, it } from "vitest";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import {
  esUnidadConocida,
  validarComposicion,
  type ComponenteAValidar,
  type ErrorDeComposicion,
  type PerillasDeComposicion,
} from "./composicion";

const SIN_PERILLAS: PerillasDeComposicion = {
  composiciones_con_perdida: false,
  subcomposiciones: false,
};
const CON_PERILLAS: PerillasDeComposicion = {
  composiciones_con_perdida: true,
  subcomposiciones: true,
};

const comp = (articuloId: string, over: Partial<ComponenteAValidar> = {}): ComponenteAValidar => ({
  articuloId,
  cantidad: cantidadDesdeTexto("1"),
  unidadId: "UNIDAD",
  unidadDeStockId: "UNIDAD",
  perdida: null,
  compuestoId: null,
  ...over,
});
const rinde = (t: string) => cantidadDesdeTexto(t);
const error = (r: ReturnType<typeof validarComposicion>): ErrorDeComposicion | null =>
  r.ok ? null : r.error;

describe("esUnidadConocida", () => {
  it("reconoce los códigos de la lista cerrada y nada más (tampoco lo heredado de Object)", () => {
    for (const ok of ["UNIDAD", "GRAMO", "KILOGRAMO", "LITRO", "HORA"]) {
      expect(esUnidadConocida(ok)).toBe(true);
    }
    for (const no of ["", "gramo", "CAJA", "toString", "constructor", "__proto__"]) {
      expect(esUnidadConocida(no)).toBe(false);
    }
  });
});

describe("validarComposicion", () => {
  it("una composición válida devuelve el rinde y los componentes en su orden, con la unidad conocida", () => {
    const r = validarComposicion(
      rinde("10"),
      [
        comp("harina", {
          cantidad: cantidadDesdeTexto("500"),
          unidadId: "GRAMO",
          unidadDeStockId: "GRAMO",
        }),
        comp("queso", {
          cantidad: cantidadDesdeTexto("0.2"),
          unidadId: "KILOGRAMO",
          unidadDeStockId: "GRAMO",
        }),
      ],
      SIN_PERILLAS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(cantidadATexto(r.valor.rinde)).toBe("10.0000");
    expect(
      r.valor.componentes.map((c) => [c.articuloId, cantidadATexto(c.cantidad), c.unidadId]),
    ).toEqual([
      ["harina", "500.0000", "GRAMO"],
      ["queso", "0.2000", "KILOGRAMO"],
    ]);
  });

  it("sin componentes es COMPOSICION_VACIA (también con rinde inválido: manda lo vacío)", () => {
    expect(error(validarComposicion(rinde("1"), [], SIN_PERILLAS))).toEqual({
      codigo: "COMPOSICION_VACIA",
    });
    expect(error(validarComposicion(rinde("0"), [], SIN_PERILLAS))).toEqual({
      codigo: "COMPOSICION_VACIA",
    });
  });

  it("el rinde tiene que ser mayor que cero; el mínimo válido es 0,0001", () => {
    expect(error(validarComposicion(rinde("0"), [comp("a")], SIN_PERILLAS))).toEqual({
      codigo: "RINDE_INVALIDO",
    });
    expect(validarComposicion(rinde("0.0001"), [comp("a")], SIN_PERILLAS).ok).toBe(true);
  });

  it("un artículo no se repite como componente", () => {
    expect(
      error(validarComposicion(rinde("1"), [comp("a"), comp("b"), comp("a")], SIN_PERILLAS)),
    ).toEqual({
      codigo: "COMPONENTE_REPETIDO",
    });
    // aunque el repetido tenga otra unidad
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [comp("a", { unidadId: "GRAMO", unidadDeStockId: "GRAMO" }), comp("a")],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "COMPONENTE_REPETIDO" });
  });

  it("la cantidad de cada componente tiene que ser mayor que cero", () => {
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [comp("a", { cantidad: cantidadDesdeTexto("0") })],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "CANTIDAD_INVALIDA" });
    expect(
      validarComposicion(
        rinde("1"),
        [comp("a", { cantidad: cantidadDesdeTexto("0.0001") })],
        SIN_PERILLAS,
      ).ok,
    ).toBe(true);
  });

  it("la unidad del componente y la de stock tienen que ser conocidas", () => {
    expect(
      error(validarComposicion(rinde("1"), [comp("a", { unidadId: "CAJA" })], SIN_PERILLAS)),
    ).toEqual({
      codigo: "UNIDAD_INVALIDA",
    });
    expect(
      error(validarComposicion(rinde("1"), [comp("a", { unidadDeStockId: "CAJA" })], SIN_PERILLAS)),
    ).toEqual({ codigo: "UNIDAD_INVALIDA" });
    expect(
      error(validarComposicion(rinde("1"), [comp("a", { unidadId: "toString" })], SIN_PERILLAS)),
    ).toEqual({
      codigo: "UNIDAD_INVALIDA",
    });
  });

  it("la unidad tiene que ser de la misma dimensión que la de stock", () => {
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [comp("a", { unidadId: "LITRO", unidadDeStockId: "GRAMO" })],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "DIMENSION_DISTINTA" });
  });

  it("y llevarse a ella de forma exacta: si no, la venta frenaría en la explosión", () => {
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [
            comp("a", {
              cantidad: cantidadDesdeTexto("1"),
              unidadId: "GRAMO",
              unidadDeStockId: "TONELADA",
            }),
          ],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "CONVERSION_NO_EXACTA" });
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [
            comp("a", {
              cantidad: cantidadDesdeTexto("99999999999999.9999"),
              unidadId: "KILOGRAMO",
              unidadDeStockId: "GRAMO",
            }),
          ],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "FUERA_DE_RANGO" });
    expect(
      validarComposicion(
        rinde("1"),
        [
          comp("a", {
            cantidad: cantidadDesdeTexto("1000"),
            unidadId: "GRAMO",
            unidadDeStockId: "KILOGRAMO",
          }),
        ],
        SIN_PERILLAS,
      ).ok,
    ).toBe(true);
  });

  describe("pérdida y compuesto solo con su perilla", () => {
    it("la pérdida distinta de cero exige composiciones_con_perdida", () => {
      const conPerdida = [comp("a", { perdida: porcentajeDesdeTexto("5") })];
      expect(error(validarComposicion(rinde("1"), conPerdida, SIN_PERILLAS))).toEqual({
        codigo: "FUNCION_NO_INCLUIDA",
        perilla: "composiciones_con_perdida",
      });
      expect(
        error(
          validarComposicion(rinde("1"), conPerdida, {
            composiciones_con_perdida: false,
            subcomposiciones: true,
          }),
        ),
      ).toEqual({ codigo: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" });
      expect(
        validarComposicion(rinde("1"), conPerdida, {
          composiciones_con_perdida: true,
          subcomposiciones: false,
        }).ok,
      ).toBe(true);
    });

    it("una pérdida en cero o ausente no cuenta", () => {
      expect(
        validarComposicion(
          rinde("1"),
          [comp("a", { perdida: porcentajeDesdeTexto("0") })],
          SIN_PERILLAS,
        ).ok,
      ).toBe(true);
      expect(validarComposicion(rinde("1"), [comp("a", { perdida: null })], SIN_PERILLAS).ok).toBe(
        true,
      );
    });

    it("un compuesto exige subcomposiciones", () => {
      const compuesto = [comp("a", { compuestoId: "c1" })];
      expect(error(validarComposicion(rinde("1"), compuesto, SIN_PERILLAS))).toEqual({
        codigo: "FUNCION_NO_INCLUIDA",
        perilla: "subcomposiciones",
      });
      expect(
        error(
          validarComposicion(rinde("1"), compuesto, {
            composiciones_con_perdida: true,
            subcomposiciones: false,
          }),
        ),
      ).toEqual({ codigo: "FUNCION_NO_INCLUIDA", perilla: "subcomposiciones" });
      expect(validarComposicion(rinde("1"), compuesto, CON_PERILLAS).ok).toBe(true);
    });

    it("con las dos cosas y sin perillas, manda la pérdida (el orden de las comprobaciones es fijo)", () => {
      expect(
        error(
          validarComposicion(
            rinde("1"),
            [comp("a", { perdida: porcentajeDesdeTexto("1"), compuestoId: "c1" })],
            SIN_PERILLAS,
          ),
        ),
      ).toEqual({ codigo: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" });
    });
  });

  it("el primer componente con error manda, en el orden dado", () => {
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [
            comp("a"),
            comp("b", { cantidad: cantidadDesdeTexto("0") }),
            comp("c", { unidadId: "CAJA" }),
          ],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "CANTIDAD_INVALIDA" });
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [
            comp("a"),
            comp("b", { unidadId: "CAJA" }),
            comp("c", { cantidad: cantidadDesdeTexto("0") }),
          ],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "UNIDAD_INVALIDA" });
  });

  it("la unidad desconocida se rechaza antes que una cantidad en cero del mismo componente", () => {
    expect(
      error(
        validarComposicion(
          rinde("1"),
          [comp("a", { unidadId: "CAJA", cantidad: cantidadDesdeTexto("0") })],
          SIN_PERILLAS,
        ),
      ),
    ).toEqual({ codigo: "UNIDAD_INVALIDA" });
  });
});
