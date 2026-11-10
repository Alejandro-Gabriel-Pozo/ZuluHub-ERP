import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoATexto } from "../../../primitivas/cantidad/con-signo";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import type { ClaseDeUso } from "../../catalogo/publico";
import {
  explotarConsumo,
  situacionDeConsumo,
  type ArticuloDeStock,
  type ComponenteVigente,
  type ConsumoDeOpcion,
  type EntradaDeExplosion,
  type LineaVendida,
  type ProductoParaExplotar,
} from "./explosion";

const q = (t: string) => cantidadDesdeTexto(t);

const art = (
  articuloId: string,
  unidadDeStockId: CodigoDeUnidad = "UNIDAD",
  activo = true,
): ArticuloDeStock => ({ articuloId, unidadDeStockId, activo });

const comp = (
  articuloId: string,
  cantidad: string,
  unidad: CodigoDeUnidad = "UNIDAD",
  unidadDeStockId: CodigoDeUnidad = unidad,
): ComponenteVigente => ({ articuloId, cantidad: q(cantidad), unidadId: unidad, unidadDeStockId });

const producto = (
  claseDeUso: ClaseDeUso,
  over: Partial<ProductoParaExplotar> = {},
): ProductoParaExplotar => ({
  claseDeUso,
  unidadBaseId: "UNIDAD",
  articulo: null,
  composicion: null,
  ...over,
});

const receta = (
  rinde: string,
  componentes: ComponenteVigente[],
  composicionId = "comp1",
): ProductoParaExplotar["composicion"] => ({ composicionId, rinde: q(rinde), componentes });

const linea = (
  posicion: number,
  productoId: string,
  cantidad: string,
  over: Partial<LineaVendida> = {},
): LineaVendida => ({
  posicion,
  productoId,
  cantidad: q(cantidad),
  unidadDeVentaId: "UNIDAD",
  variante: null,
  opciones: [],
  ...over,
});

const consumo = (insumoId: string, cantidad: string, escalaConTamano = false): ConsumoDeOpcion => ({
  insumoId,
  cantidad: q(cantidad),
  escalaConTamano,
});

const explotar = (
  lineas: LineaVendida[],
  productos: Record<string, ProductoParaExplotar>,
  insumos: Record<string, ArticuloDeStock> = {},
) => {
  const entrada: EntradaDeExplosion = {
    lineas,
    productos: new Map(Object.entries(productos)),
    articulosDeInsumos: new Map(Object.entries(insumos)),
  };
  return explotarConsumo(entrada);
};

/** Los renglones como `[artículo, composición, cantidad]` para comparar. */
const renglones = (r: ReturnType<typeof explotar>) => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.valor.renglones.map((x) => [
    x.articuloId,
    x.composicionId,
    cantidadConSignoATexto(x.cantidad),
  ]);
};
const falla = (r: ReturnType<typeof explotar>) => (r.ok ? null : r.error);

describe("situacionDeConsumo (pasos 2 a 4)", () => {
  it("el artículo activo manda sobre la composición", () => {
    expect(
      situacionDeConsumo(
        producto("REVENTA", { articulo: art("a"), composicion: receta("1", [comp("x", "1")]) }),
      ),
    ).toBe("ARTICULO");
  });

  it("un artículo inactivo es como no tenerlo", () => {
    expect(situacionDeConsumo(producto("REVENTA", { articulo: art("a", "UNIDAD", false) }))).toBe(
      "NO_CONTROLADO",
    );
    expect(
      situacionDeConsumo(
        producto("VENDIBLE", {
          articulo: art("a", "UNIDAD", false),
          composicion: receta("1", [comp("x", "1")]),
        }),
      ),
    ).toBe("COMPOSICION");
  });

  it("sin artículo, la composición con componentes", () => {
    expect(
      situacionDeConsumo(producto("VENDIBLE", { composicion: receta("1", [comp("x", "1")]) })),
    ).toBe("COMPOSICION");
  });

  it("sin ninguna: VENDIBLE es «falta receta»; las demás clases, no se controlan", () => {
    expect(situacionDeConsumo(producto("VENDIBLE"))).toBe("FALTA_RECETA");
    for (const clase of ["REVENTA", "MATERIA_PRIMA", "INSUMO", "ELABORADO"] as const) {
      expect(situacionDeConsumo(producto(clase))).toBe("NO_CONTROLADO");
    }
  });

  it("una composición sin componentes (la versión que retira la receta) no es composición", () => {
    expect(situacionDeConsumo(producto("VENDIBLE", { composicion: receta("1", []) }))).toBe(
      "FALTA_RECETA",
    );
    expect(situacionDeConsumo(producto("REVENTA", { composicion: receta("1", []) }))).toBe(
      "NO_CONTROLADO",
    );
  });
});

describe("explotarConsumo: reventa", () => {
  it("un renglón del artículo × la cantidad, con signo de salida y sin composición", () => {
    const r = explotar([linea(1, "cola", "2")], {
      cola: producto("REVENTA", { articulo: art("A-cola") }),
    });
    expect(renglones(r)).toEqual([["A-cola", null, "-2.0000"]]);
    if (r.ok) {
      expect(r.valor.renglones[0]?.unidadDeStockId).toBe("UNIDAD");
      expect(r.valor.excepciones).toEqual([]);
      expect(r.valor.avisos).toEqual([]);
    }
  });

  it("la cantidad vendida se lleva a la unidad base: 1,5 kg de un artículo en gramos son 1500", () => {
    const r = explotar([linea(1, "queso", "1.5", { unidadDeVentaId: "KILOGRAMO" })], {
      queso: producto("REVENTA", { unidadBaseId: "GRAMO", articulo: art("A-queso", "GRAMO") }),
    });
    expect(renglones(r)).toEqual([["A-queso", null, "-1500.0000"]]);
    if (r.ok) expect(r.valor.renglones[0]?.unidadDeStockId).toBe("GRAMO");
  });

  it("fracciones: media unidad con paso 0,5", () => {
    const r = explotar([linea(1, "p", "0.5")], { p: producto("REVENTA", { articulo: art("A") }) });
    expect(renglones(r)).toEqual([["A", null, "-0.5000"]]);
  });

  it("dos líneas del mismo artículo se suman en un solo renglón", () => {
    const r = explotar([linea(1, "p", "2"), linea(2, "p", "3")], {
      p: producto("REVENTA", { articulo: art("A") }),
    });
    expect(renglones(r)).toEqual([["A", null, "-5.0000"]]);
  });

  it("una REVENTA sin artículo no se controla: ni renglón ni «falta receta»", () => {
    const r = explotar([linea(1, "p", "2")], { p: producto("REVENTA") });
    expect(renglones(r)).toEqual([]);
    expect(r.ok && r.valor.excepciones).toEqual([]);
  });
});

describe("explotarConsumo: composición (P18)", () => {
  const pizza = producto("VENDIBLE", {
    composicion: receta("10", [comp("harina", "500", "GRAMO"), comp("queso", "200", "GRAMO")]),
  });

  it("cantidad × q ÷ rinde por componente, con la versión de composición en el renglón", () => {
    expect(renglones(explotar([linea(1, "pizza", "1")], { pizza }))).toEqual([
      ["harina", "comp1", "-50.0000"],
      ["queso", "comp1", "-20.0000"],
    ]);
    expect(renglones(explotar([linea(1, "pizza", "3")], { pizza }))).toEqual([
      ["harina", "comp1", "-150.0000"],
      ["queso", "comp1", "-60.0000"],
    ]);
  });

  it("media pizza (paso 0,5)", () => {
    expect(renglones(explotar([linea(1, "pizza", "0.5")], { pizza }))).toEqual([
      ["harina", "comp1", "-25.0000"],
      ["queso", "comp1", "-10.0000"],
    ]);
  });

  it("la cantidad del componente se lleva a la unidad de stock del artículo", () => {
    const p = producto("VENDIBLE", {
      composicion: receta("4", [comp("harina", "0.2", "KILOGRAMO", "GRAMO")]),
    });
    const r = explotar([linea(1, "p", "2")], { p });
    expect(renglones(r)).toEqual([["harina", "comp1", "-100.0000"]]);
    if (r.ok) expect(r.valor.renglones[0]?.unidadDeStockId).toBe("GRAMO");
  });

  it("un solo redondeo: 1 ÷ 3 dos veces suma 0,6667 y no 0,3333 + 0,3333", () => {
    const tercio = producto("VENDIBLE", { composicion: receta("3", [comp("x", "1")]) });
    expect(renglones(explotar([linea(1, "t", "1")], { t: tercio }))).toEqual([
      ["x", "comp1", "-0.3333"],
    ]);
    expect(renglones(explotar([linea(1, "t", "1"), linea(2, "t", "1")], { t: tercio }))).toEqual([
      ["x", "comp1", "-0.6667"],
    ]);
  });

  it("dos versiones de composición del mismo artículo son dos renglones", () => {
    const v1 = producto("VENDIBLE", { composicion: receta("1", [comp("x", "1")], "c1") });
    const v2 = producto("VENDIBLE", { composicion: receta("1", [comp("x", "2")], "c2") });
    expect(renglones(explotar([linea(1, "a", "1"), linea(2, "b", "1")], { a: v1, b: v2 }))).toEqual(
      [
        ["x", "c1", "-1.0000"],
        ["x", "c2", "-2.0000"],
      ],
    );
  });

  it("el artículo manda sobre la composición", () => {
    const los2 = producto("VENDIBLE", {
      articulo: art("A"),
      composicion: receta("1", [comp("x", "9")]),
    });
    expect(renglones(explotar([linea(1, "p", "2")], { p: los2 }))).toEqual([
      ["A", null, "-2.0000"],
    ]);
  });

  it("una conversión que no es exacta se rechaza con la posición de la línea", () => {
    const mal = producto("VENDIBLE", {
      composicion: receta("1", [comp("x", "1", "GRAMO", "TONELADA")]),
    });
    expect(
      falla(
        explotar([linea(1, "ok", "1"), linea(7, "mal", "1")], {
          ok: producto("REVENTA", { articulo: art("A") }),
          mal,
        }),
      ),
    ).toEqual({ codigo: "CONVERSION_NO_EXACTA", posicion: 7 });
  });
});

describe("explotarConsumo: falta de receta (D140)", () => {
  it("un VENDIBLE sin composición no descuenta y devuelve FALTA_RECETA por su posición; el resto sigue", () => {
    const r = explotar([linea(1, "cola", "1"), linea(2, "plato", "1"), linea(3, "plato", "2")], {
      cola: producto("REVENTA", { articulo: art("A") }),
      plato: producto("VENDIBLE"),
    });
    expect(renglones(r)).toEqual([["A", null, "-1.0000"]]);
    expect(r.ok && r.valor.excepciones).toEqual([
      { posicion: 2, tipo: "FALTA_RECETA" },
      { posicion: 3, tipo: "FALTA_RECETA" },
    ]);
  });

  it("las opciones de un VENDIBLE sin receta igual descuentan", () => {
    const r = explotar(
      [
        linea(1, "plato", "1", {
          opciones: [{ versionDeOpcionId: "v1", consumos: [consumo("sal", "2")] }],
        }),
      ],
      { plato: producto("VENDIBLE") },
      { sal: art("A-sal") },
    );
    expect(renglones(r)).toEqual([["A-sal", null, "-2.0000"]]);
    expect(r.ok && r.valor.excepciones).toEqual([{ posicion: 1, tipo: "FALTA_RECETA" }]);
  });
});

describe("explotarConsumo: opciones (la versión sellada)", () => {
  const conOpcion = (consumos: ConsumoDeOpcion[], over: Partial<LineaVendida> = {}) =>
    linea(1, "p", "1", { opciones: [{ versionDeOpcionId: "v1", consumos }], ...over });
  const base = { p: producto("VENDIBLE", { composicion: receta("1", [comp("masa", "1")]) }) };

  it("consumo × q de cada opción elegida, sin composición, en el artículo del insumo", () => {
    const r = explotar([conOpcion([consumo("queso", "30")], { cantidad: q("2") })], base, {
      queso: art("A-queso", "GRAMO"),
    });
    expect(renglones(r)).toEqual([
      ["A-queso", null, "-60.0000"],
      ["masa", "comp1", "-2.0000"],
    ]);
    if (r.ok) expect(r.valor.renglones[0]?.unidadDeStockId).toBe("GRAMO");
  });

  it("escala con el factor de tamaño de la variante elegida si la línea lo pide: 1,5", () => {
    const grande = { versionDeOpcionId: "vg", factorDeTamano: q("1.5") };
    const r = explotar(
      [conOpcion([consumo("queso", "30", true), consumo("sal", "2", false)], { variante: grande })],
      base,
      { queso: art("A-queso"), sal: art("A-sal") },
    );
    expect(renglones(r)).toEqual([
      ["A-queso", null, "-45.0000"],
      ["A-sal", null, "-2.0000"],
      ["masa", "comp1", "-1.0000"],
    ]);
  });

  it("sin variante elegida, el factor es 1 aunque la línea escale", () => {
    const r = explotar([conOpcion([consumo("queso", "30", true)])], base, {
      queso: art("A-queso"),
    });
    expect(renglones(r)).toEqual([
      ["A-queso", null, "-30.0000"],
      ["masa", "comp1", "-1.0000"],
    ]);
  });

  it("composición con rinde 10 y opción escalada por 1,5, con media pizza, en el mismo caso", () => {
    const p = producto("VENDIBLE", { composicion: receta("10", [comp("harina", "500", "GRAMO")]) });
    const r = explotar(
      [
        linea(1, "p", "0.5", {
          variante: { versionDeOpcionId: "vg", factorDeTamano: q("1.5") },
          opciones: [{ versionDeOpcionId: "v1", consumos: [consumo("queso", "0.0185", true)] }],
        }),
      ],
      { p },
      { queso: art("A-queso") },
    );
    // 0,0185 × 0,5 × 1,5 = 0,0138750 → 0,0139; 500 ÷ 10 × 0,5 = 25
    expect(renglones(r)).toEqual([
      ["A-queso", null, "-0.0139"],
      ["harina", "comp1", "-25.0000"],
    ]);
  });

  it("dos líneas de 0,5 suman ANTES de redondear: 0,0185 y no 0,0093 + 0,0093", () => {
    const p = producto("REVENTA");
    const op = [{ versionDeOpcionId: "v1", consumos: [consumo("aceite", "0.0185")] }];
    const r = explotar(
      [linea(1, "p", "0.5", { opciones: op }), linea(2, "p", "0.5", { opciones: op })],
      { p },
      { aceite: art("A-aceite") },
    );
    expect(renglones(r)).toEqual([["A-aceite", null, "-0.0185"]]);
  });

  it("la reventa vendida y su propio insumo en una opción caen en el mismo renglón (artículo, sin composición)", () => {
    const r = explotar(
      [
        linea(1, "p", "2", {
          opciones: [{ versionDeOpcionId: "v1", consumos: [consumo("p", "1")] }],
        }),
      ],
      { p: producto("REVENTA", { articulo: art("A-p") }) },
      { p: art("A-p") },
    );
    expect(renglones(r)).toEqual([["A-p", null, "-4.0000"]]);
  });

  it("el artículo de un componente y el mismo artículo por una opción son dos renglones: con composición y sin ella", () => {
    const r = explotar([conOpcion([consumo("m", "1")])], base, { m: art("masa") });
    expect(renglones(r)).toEqual([
      ["masa", null, "-1.0000"],
      ["masa", "comp1", "-1.0000"],
    ]);
  });

  it("varias opciones de una línea suman todas sus consumos", () => {
    const r = explotar(
      [
        linea(1, "p", "1", {
          opciones: [
            { versionDeOpcionId: "v1", consumos: [consumo("sal", "1")] },
            { versionDeOpcionId: "v2", consumos: [consumo("sal", "2"), consumo("pimienta", "3")] },
            { versionDeOpcionId: "v3", consumos: [] },
          ],
        }),
      ],
      { p: producto("REVENTA") },
      { sal: art("A-sal"), pimienta: art("A-pimienta") },
    );
    expect(renglones(r)).toEqual([
      ["A-pimienta", null, "-3.0000"],
      ["A-sal", null, "-3.0000"],
    ]);
  });

  it("un insumo sin artículo, o con el artículo inactivo, no descuenta y se avisa por posición", () => {
    const r = explotar(
      [
        linea(4, "p", "1", {
          opciones: [
            {
              versionDeOpcionId: "v1",
              consumos: [consumo("x", "1"), consumo("y", "1"), consumo("z", "1")],
            },
          ],
        }),
      ],
      { p: producto("REVENTA") },
      { y: art("A-y", "UNIDAD", false), z: art("A-z") },
    );
    expect(renglones(r)).toEqual([["A-z", null, "-1.0000"]]);
    expect(r.ok && r.valor.avisos).toEqual([
      { tipo: "INSUMO_SIN_ARTICULO", posicion: 4, insumoId: "x" },
      { tipo: "INSUMO_SIN_ARTICULO", posicion: 4, insumoId: "y" },
    ]);
  });

  describe("S-9: venta por peso con una opción que consume", () => {
    const porPeso = {
      p: producto("REVENTA", { unidadBaseId: "GRAMO", articulo: art("A", "GRAMO") }),
    };
    const op = [{ versionDeOpcionId: "v1", consumos: [consumo("sal", "1")] }];

    it("se rechaza con la posición de la línea", () => {
      expect(
        falla(
          explotar(
            [
              linea(1, "p", "1", { unidadDeVentaId: "GRAMO" }),
              linea(3, "p", "1", { unidadDeVentaId: "KILOGRAMO", opciones: op }),
            ],
            porPeso,
            { sal: art("S") },
          ),
        ),
      ).toEqual({ codigo: "OPCION_CON_CONSUMO_EN_VENTA_POR_PESO", posicion: 3 });
    });

    it("también si el insumo no tiene artículo (la opción consume igual)", () => {
      expect(
        falla(explotar([linea(1, "p", "1", { unidadDeVentaId: "GRAMO", opciones: op })], porPeso)),
      ).toEqual({
        codigo: "OPCION_CON_CONSUMO_EN_VENTA_POR_PESO",
        posicion: 1,
      });
    });

    it("una opción sin consumo no molesta, y por unidad o por volumen sí se admite", () => {
      const sinConsumo = [{ versionDeOpcionId: "v1", consumos: [] }];
      expect(
        explotar(
          [linea(1, "p", "1", { unidadDeVentaId: "KILOGRAMO", opciones: sinConsumo })],
          porPeso,
        ).ok,
      ).toBe(true);
      expect(
        explotar(
          [linea(1, "p", "1", { opciones: op })],
          { p: producto("REVENTA") },
          { sal: art("S") },
        ).ok,
      ).toBe(true);
      expect(
        explotar(
          [linea(1, "p", "1", { unidadDeVentaId: "LITRO", opciones: op })],
          { p: producto("REVENTA", { unidadBaseId: "MILILITRO" }) },
          { sal: art("S") },
        ).ok,
      ).toBe(true);
    });
  });
});

describe("explotarConsumo: redondeo", () => {
  const unidad = producto("REVENTA");
  const opcion = (c: string) => [{ versionDeOpcionId: "v", consumos: [consumo("i", c)] }];
  const una = (cantidad: string, c: string) =>
    explotar([linea(1, "p", cantidad, { opciones: opcion(c) })], { p: unidad }, { i: art("A-i") });

  it("la mitad se aleja del cero: 0,00005 → 0,0001 y 0,00925 → 0,0093", () => {
    expect(renglones(una("0.5", "0.0001"))).toEqual([["A-i", null, "-0.0001"]]);
    expect(renglones(una("0.5", "0.0185"))).toEqual([["A-i", null, "-0.0093"]]);
    expect(renglones(una("0.5", "0.0003"))).toEqual([["A-i", null, "-0.0002"]]);
  });

  it("lo que redondea a cero no se escribe: se avisa, no es un renglón en cero", () => {
    const r = una("0.4", "0.0001");
    expect(renglones(r)).toEqual([]);
    expect(r.ok && r.valor.avisos).toEqual([
      { tipo: "CANTIDAD_EN_CERO", articuloId: "A-i", composicionId: null },
    ]);
  });

  it("el aviso de cero lleva la composición cuando es de una receta", () => {
    const p = producto("VENDIBLE", { composicion: receta("10", [comp("x", "0.0001")]) });
    const r = explotar([linea(1, "p", "0.5")], { p });
    expect(r.ok && r.valor.avisos).toEqual([
      { tipo: "CANTIDAD_EN_CERO", articuloId: "x", composicionId: "comp1" },
    ]);
  });

  it("el redondeo sale de la suma exacta: tres líneas de 0,0001 × 0,4 suman 0,0001 (1,2 → 1) y no cero", () => {
    const r = explotar(
      [1, 2, 3].map((i) => linea(i, "p", "0.4", { opciones: opcion("0.0001") })),
      { p: unidad },
      { i: art("A-i") },
    );
    expect(renglones(r)).toEqual([["A-i", null, "-0.0001"]]);
  });
});

describe("explotarConsumo: errores y bordes", () => {
  it("sin líneas no hay nada", () => {
    expect(explotar([], {})).toEqual({
      ok: true,
      valor: { renglones: [], excepciones: [], avisos: [] },
    });
  });

  it("un producto que no vino en el mapa es un error, con la posición (se cierra, no se asume)", () => {
    expect(falla(explotar([linea(2, "fantasma", "1")], {}))).toEqual({
      codigo: "PRODUCTO_DESCONOCIDO",
      posicion: 2,
    });
  });

  it("una cantidad en cero es inválida", () => {
    expect(
      falla(explotar([linea(5, "p", "0")], { p: producto("REVENTA", { articulo: art("A") }) })),
    ).toEqual({
      codigo: "CANTIDAD_INVALIDA",
      posicion: 5,
    });
    expect(
      explotar([linea(5, "p", "0.0001")], { p: producto("REVENTA", { articulo: art("A") }) }).ok,
    ).toBe(true);
  });

  it("la unidad de venta de otra dimensión y la conversión no exacta se rechazan con su posición", () => {
    const p = {
      p: producto("REVENTA", { unidadBaseId: "TONELADA", articulo: art("A", "TONELADA") }),
    };
    expect(falla(explotar([linea(1, "p", "1", { unidadDeVentaId: "LITRO" })], p))).toEqual({
      codigo: "DIMENSION_DISTINTA",
      posicion: 1,
    });
    expect(falla(explotar([linea(1, "p", "1", { unidadDeVentaId: "GRAMO" })], p))).toEqual({
      codigo: "CONVERSION_NO_EXACTA",
      posicion: 1,
    });
    expect(
      renglones(explotar([linea(1, "p", "1000000", { unidadDeVentaId: "GRAMO" })], p)),
    ).toEqual([["A", null, "-1.0000"]]);
  });

  it("la conversión fuera de rango se rechaza", () => {
    const p = { p: producto("REVENTA", { unidadBaseId: "GRAMO", articulo: art("A", "GRAMO") }) };
    expect(
      falla(explotar([linea(1, "p", "99999999999999.9999", { unidadDeVentaId: "KILOGRAMO" })], p)),
    ).toEqual({
      codigo: "FUERA_DE_RANGO",
      posicion: 1,
    });
  });

  it("la suma que se sale de numeric(18,4) es FUERA_DE_RANGO sin posición; justo en el máximo pasa", () => {
    const p = { p: producto("REVENTA", { articulo: art("A") }) };
    expect(renglones(explotar([linea(1, "p", "99999999999999.9999")], p))).toEqual([
      ["A", null, "-99999999999999.9999"],
    ]);
    const r = falla(explotar([linea(1, "p", "99999999999999.9999"), linea(2, "p", "0.0001")], p));
    expect(r).toEqual({ codigo: "FUERA_DE_RANGO" });
    expect(r !== null && "posicion" in r).toBe(false);
  });

  it("los renglones salen ordenados por artículo y, dentro, sin composición primero; las excepciones en el orden de las líneas", () => {
    const r = explotar([linea(9, "plato", "1"), linea(8, "b", "1"), linea(7, "a", "1")], {
      plato: producto("VENDIBLE"),
      a: producto("VENDIBLE", { composicion: receta("1", [comp("z", "1"), comp("m", "1")], "c9") }),
      b: producto("REVENTA", { articulo: art("m") }),
    });
    expect(renglones(r)).toEqual([
      ["m", null, "-1.0000"],
      ["m", "c9", "-1.0000"],
      ["z", "c9", "-1.0000"],
    ]);
    expect(r.ok && r.valor.excepciones).toEqual([{ posicion: 9, tipo: "FALTA_RECETA" }]);
  });

  it("sin composición va primero y el orden no depende de cómo vengan las líneas (tres renglones del mismo artículo)", () => {
    const con = (id: string) =>
      producto("VENDIBLE", { composicion: receta("1", [comp("x", "1")], id) });
    const sin = producto("REVENTA", { articulo: art("x") });
    const lineas = [linea(1, "sin", "1"), linea(2, "c1", "1"), linea(3, "cA", "1")];
    const productos = { sin, c1: con("1"), cA: con("A") };
    const permutaciones = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const orden of permutaciones) {
      const r = explotar(
        orden.map((i) => lineas[i] as LineaVendida),
        productos,
      );
      expect(renglones(r).map((x) => x[1])).toEqual([null, "1", "A"]);
    }
  });

  it("no modifica lo que recibe", () => {
    const lineas = [linea(1, "p", "1")];
    const copia = structuredClone(lineas);
    explotar(lineas, { p: producto("REVENTA", { articulo: art("A") }) });
    expect(lineas).toEqual(copia);
  });
});
