import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoATexto } from "../../../primitivas/cantidad/con-signo";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import type { ClaseDeUso } from "../../catalogo/publico";
import {
  explotarConsumo,
  situacionDeConsumo,
  type ComponenteCompuesto,
  type ComponenteVigente,
  type ProductoParaExplotar,
} from "./explosion";

const q = cantidadDesdeTexto;
const kg: CodigoDeUnidad = "KILOGRAMO";

const prod = (
  clase: ClaseDeUso,
  unidad: CodigoDeUnidad,
  over: Partial<ProductoParaExplotar> = {},
): ProductoParaExplotar => ({
  claseDeUso: clase,
  unidadBaseId: unidad,
  articulo: null,
  composicion: null,
  ...over,
});
const ing = (articuloId: string, cantidad: string, perdida?: string): ComponenteVigente => ({
  articuloId,
  cantidad: q(cantidad),
  unidadId: kg,
  unidadDeStockId: kg,
  ...(perdida === undefined ? {} : { perdida: porcentajeDesdeTexto(perdida) }),
});
const sub = (compuestoId: string, cantidad: string, perdida?: string): ComponenteCompuesto => ({
  compuestoId,
  cantidad: q(cantidad),
  unidadId: kg,
  ...(perdida === undefined ? {} : { perdida: porcentajeDesdeTexto(perdida) }),
});

/** La masa de la especificación (D2): rinde 10 kg con harina 6, manteca 2, agua 1,2, azúcar 0,5, levadura 0,2 y sal 0,1. */
const masa = (conStock = false): ProductoParaExplotar =>
  prod("ELABORADO", kg, {
    articulo: conStock ? { articuloId: "stock-masa", unidadDeStockId: kg, activo: true } : null,
    composicion: {
      composicionId: "r-masa",
      rinde: q("10"),
      componentes: [
        ing("harina", "6"),
        ing("manteca", "2"),
        ing("agua", "1.2"),
        ing("azucar", "0.5"),
        ing("levadura", "0.2"),
        ing("sal", "0.1"),
      ],
    },
  });
/** 100 medialunas llevan 6 kg de masa. */
const medialuna = (): ProductoParaExplotar =>
  prod("VENDIBLE", "UNIDAD", {
    composicion: {
      composicionId: "r-medialuna",
      rinde: q("100"),
      componentes: [],
      compuestos: [sub("masa", "6")],
    },
  });

const linea = (productoId: string, cantidad: string) => ({
  posicion: 1,
  productoId,
  cantidad: q(cantidad),
  unidadDeVentaId: "UNIDAD" as const,
  variante: null,
  opciones: [],
});
const explotar = (
  productos: Record<string, ProductoParaExplotar>,
  cantidad = "100",
  id = "medialuna",
) =>
  explotarConsumo({
    lineas: [linea(id, cantidad)],
    productos: new Map(Object.entries(productos)),
    articulosDeInsumos: new Map(),
  });
const texto = (r: ReturnType<typeof explotar>) => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.valor.renglones.map((x) => [
    x.articuloId,
    x.composicionId,
    cantidadConSignoATexto(x.cantidad),
  ]);
};

describe("explosión anidada (D96, D94)", () => {
  it("sin stock propio de la masa se descuentan los ingredientes en proporción", () => {
    expect(texto(explotar({ medialuna: medialuna(), masa: masa() }))).toEqual([
      ["agua", "r-masa", "-0.7200"],
      ["azucar", "r-masa", "-0.3000"],
      ["harina", "r-masa", "-3.6000"],
      ["levadura", "r-masa", "-0.1200"],
      ["manteca", "r-masa", "-1.2000"],
      ["sal", "r-masa", "-0.0600"],
    ]);
  });
  it("con stock propio de la masa se descuenta la masa y no se explota", () => {
    expect(texto(explotar({ medialuna: medialuna(), masa: masa(true) }))).toEqual([
      ["stock-masa", "r-medialuna", "-6.0000"],
    ]);
  });
  it("un artículo inactivo no cuenta como stock propio: se explota", () => {
    const inactiva = {
      ...masa(),
      articulo: { articuloId: "x", unidadDeStockId: kg, activo: false },
    };
    expect(texto(explotar({ medialuna: medialuna(), masa: inactiva })).length).toBe(6);
  });
  it("la merma del compuesto y la de sus ingredientes se acumulan sobre el neto", () => {
    const conMerma = prod("VENDIBLE", "UNIDAD", {
      composicion: {
        composicionId: "rm",
        rinde: q("100"),
        componentes: [],
        compuestos: [sub("masa", "6", "50")],
      },
    });
    const m = masa();
    const ingredientesConMerma = {
      ...m,
      composicion: { ...m.composicion!, componentes: [ing("harina", "6", "20")] },
    };
    // 100 u → 6 kg × 1,5 = 9 kg de masa; la masa rinde 10 kg: harina 6 × 1,2 × 9 ÷ 10 = 6,48
    expect(texto(explotar({ medialuna: conMerma, masa: ingredientesConMerma }))).toEqual([
      ["harina", "r-masa", "-6.4800"],
    ]);
  });
  it("junta los renglones que coinciden antes de redondear (un redondeo por renglón)", () => {
    // 3 medialunas: harina 6 × 3/100 × 6/10 ... se suma exacto y se redondea una vez
    expect(texto(explotar({ medialuna: medialuna(), masa: masa() }, "3"))).toContainEqual([
      "harina",
      "r-masa",
      "-0.1080",
    ]);
    expect(texto(explotar({ medialuna: medialuna(), masa: masa() }, "1"))).toContainEqual([
      "sal",
      "r-masa",
      "-0.0006",
    ]);
  });
  it("un artículo propio y el mismo ingrediente por la masa son renglones de versiones distintas", () => {
    const plato = prod("VENDIBLE", "UNIDAD", {
      composicion: {
        composicionId: "rp",
        rinde: q("1"),
        componentes: [ing("harina", "0.1")],
        compuestos: [sub("masa", "1")],
      },
    });
    const r = texto(explotar({ plato, masa: masa() }, "1", "plato"));
    expect(r).toContainEqual(["harina", "rp", "-0.1000"]);
    expect(r).toContainEqual(["harina", "r-masa", "-0.6000"]);
  });
  it("cinco niveles pasan y seis son RECETA_DEMASIADO_ANIDADA", () => {
    const cadena = (n: number): Record<string, ProductoParaExplotar> => {
      const productos: Record<string, ProductoParaExplotar> = {};
      for (let i = 0; i < n; i++) {
        productos[`p${i}`] = prod(i === 0 ? "VENDIBLE" : "ELABORADO", kg, {
          composicion: {
            composicionId: `r${i}`,
            rinde: q("1"),
            componentes: i === n - 1 ? [ing("hoja", "1")] : [],
            compuestos: i === n - 1 ? [] : [sub(`p${i + 1}`, "1")],
          },
        });
      }
      return productos;
    };
    const cinco = explotarConsumo({
      lineas: [{ ...linea("p0", "1"), unidadDeVentaId: kg }],
      productos: new Map(Object.entries(cadena(5))),
      articulosDeInsumos: new Map(),
    });
    expect(cinco.ok).toBe(true);
    const seis = explotarConsumo({
      lineas: [{ ...linea("p0", "1"), unidadDeVentaId: kg }],
      productos: new Map(Object.entries(cadena(6))),
      articulosDeInsumos: new Map(),
    });
    expect(seis).toEqual({ ok: false, error: { codigo: "RECETA_DEMASIADO_ANIDADA", posicion: 1 } });
  });
  it("un ciclo en datos corruptos se corta como receta demasiado anidada y no se cuelga", () => {
    const a = prod("VENDIBLE", kg, {
      composicion: {
        composicionId: "ra",
        rinde: q("1"),
        componentes: [],
        compuestos: [sub("b", "1")],
      },
    });
    const b = prod("ELABORADO", kg, {
      composicion: {
        composicionId: "rb",
        rinde: q("1"),
        componentes: [],
        compuestos: [sub("a", "1")],
      },
    });
    const r = explotarConsumo({
      lineas: [{ ...linea("a", "1"), unidadDeVentaId: kg }],
      productos: new Map([
        ["a", a],
        ["b", b],
      ]),
      articulosDeInsumos: new Map(),
    });
    expect(r.ok).toBe(false);
  });
  it("un compuesto desconocido es PRODUCTO_DESCONOCIDO; sin receta ni stock se avisa", () => {
    expect(explotar({ medialuna: medialuna() })).toEqual({
      ok: false,
      error: { codigo: "PRODUCTO_DESCONOCIDO", posicion: 1 },
    });
    const vacia = prod("ELABORADO", kg);
    const r = explotar({ medialuna: medialuna(), masa: vacia });
    expect(r).toEqual({
      ok: true,
      valor: {
        renglones: [],
        excepciones: [],
        avisos: [{ tipo: "COMPUESTO_SIN_RECETA", compuestoId: "masa" }],
      },
    });
  });
  it("una receta vacía del elaborado se avisa, y los demás componentes se siguen descontando", () => {
    const vacia = prod("ELABORADO", kg, {
      composicion: { composicionId: "rv", rinde: q("1"), componentes: [], compuestos: [] },
    });
    const plato = prod("VENDIBLE", "UNIDAD", {
      composicion: {
        composicionId: "rp",
        rinde: q("1"),
        componentes: [],
        compuestos: [sub("vacia", "1"), sub("masa", "1")],
      },
    });
    const r = explotar({ plato, vacia, masa: masa(true) }, "1", "plato");
    expect(r).toMatchObject({
      ok: true,
      valor: { avisos: [{ tipo: "COMPUESTO_SIN_RECETA", compuestoId: "vacia" }] },
    });
    expect(texto(r)).toEqual([["stock-masa", "rp", "-1.0000"]]);
  });
  it("dos elaborados que se explotan a la vez suman todos sus ingredientes", () => {
    const otraMasa = {
      ...masa(),
      composicion: { ...masa().composicion!, composicionId: "r-masa-2" },
    };
    const doble = prod("VENDIBLE", "UNIDAD", {
      composicion: {
        composicionId: "rd",
        rinde: q("1"),
        componentes: [],
        compuestos: [sub("masa", "1"), sub("otra", "1")],
      },
    });
    const r = texto(explotar({ doble, masa: masa(), otra: otraMasa }, "1", "doble"));
    expect(r).toContainEqual(["harina", "r-masa", "-0.6000"]);
    expect(r).toContainEqual(["harina", "r-masa-2", "-0.6000"]);
  });
  it("una conversión inexacta del compuesto se rechaza", () => {
    const mala = prod("VENDIBLE", "UNIDAD", {
      composicion: {
        composicionId: "x",
        rinde: q("1"),
        componentes: [],
        compuestos: [{ compuestoId: "masa", cantidad: q("1"), unidadId: "LITRO" }],
      },
    });
    expect(explotar({ medialuna: mala, masa: masa() }, "1")).toMatchObject({ ok: false });
  });
  it("situacionDeConsumo: una receta solo de compuestos es composición", () => {
    expect(situacionDeConsumo(medialuna())).toBe("COMPOSICION");
    expect(
      situacionDeConsumo(
        prod("VENDIBLE", "UNIDAD", {
          composicion: { composicionId: "x", rinde: q("1"), componentes: [], compuestos: [] },
        }),
      ),
    ).toBe("FALTA_RECETA");
    expect(
      situacionDeConsumo(
        prod("ELABORADO", kg, {
          composicion: { composicionId: "x", rinde: q("1"), componentes: [], compuestos: [] },
        }),
      ),
    ).toBe("NO_CONTROLADO");
  });
  it("propiedad (D2): lo que baja la masa es proporcional a lo vendido, con un redondeo por renglón", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (unidades) => {
        const r = explotar({ medialuna: medialuna(), masa: masa() }, String(unidades));
        if (!r.ok) throw new Error("falla");
        const harina = r.valor.renglones.find((x) => x.articuloId === "harina")!;
        // harina exacta = 6 × 6 ÷ 10 ÷ 100 × u kg = 0,036 u kg → 360 u unidades mínimas
        expect(-harina.cantidad.unidades).toBe(BigInt(unidades) * 360n);
      }),
    );
  });
});
