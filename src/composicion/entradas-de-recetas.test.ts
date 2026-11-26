import { describe, expect, it } from "vitest";
import { codificarLaPagina } from "./entradas-de-productos";
import {
  aEntradaDeGuardarReceta,
  leerElFormularioDeReceta,
  leerElPedidoDeReceta,
  leerLaEntradaDeLaListaDeRecetas,
  leerLaEntradaDeLosIngredientes,
  nombreDeCampoDeReceta,
} from "./entradas-de-recetas";

const ID = "0d9b7a40-5c1e-4a52-9b6f-3f8d2a1c7e90";
const VACIA = { texto: "", conReceta: "", activo: "", despues: "" };

describe("leerLaEntradaDeLaListaDeRecetas", () => {
  it("todo vacío es «sin filtrar» y primera página", () => {
    expect(leerLaEntradaDeLaListaDeRecetas(VACIA)).toStrictEqual({});
    expect(leerLaEntradaDeLaListaDeRecetas({ ...VACIA, texto: "   " })).toStrictEqual({});
  });

  it("pasa lo permitido: el texto, con receta o sin ella, el estado y la página que dio la consulta", () => {
    const despues = codificarLaPagina({ id: ID, nombreClave: "milanesa" });
    expect(
      leerLaEntradaDeLaListaDeRecetas({ texto: "Mila", conReceta: "con", activo: "si", despues }),
    ).toStrictEqual({
      texto: "Mila",
      conReceta: true,
      activo: true,
      despuesDe: { id: ID, nombreClave: "milanesa" },
    });
    expect(
      leerLaEntradaDeLaListaDeRecetas({ ...VACIA, conReceta: "sin", activo: "no" }),
    ).toStrictEqual({
      conReceta: false,
      activo: false,
    });
  });

  it.each([
    { conReceta: "todas" },
    { conReceta: "true" },
    { conReceta: "toString" },
    { conReceta: "__proto__" },
    { activo: "si " },
    { activo: "SI" },
    { activo: "constructor" },
    { texto: "uno\u0000dos" },
    { texto: "uno‮dos" },
    { despues: "sin-separador" },
    { despues: `${ID}:` },
    { despues: `no-es-un-id:milanesa` },
  ])("%j: nada puede coincidir (null), el filtro nunca se ensancha", (parte) => {
    expect(leerLaEntradaDeLaListaDeRecetas({ ...VACIA, ...parte })).toBeNull();
  });
});

describe("leerLaEntradaDeLosIngredientes", () => {
  it("vacío es «sin filtrar»; con texto y página pasa lo permitido", () => {
    expect(leerLaEntradaDeLosIngredientes({ texto: "", despues: "" })).toStrictEqual({});
    expect(
      leerLaEntradaDeLosIngredientes({
        texto: "ha",
        despues: codificarLaPagina({ id: ID, nombreClave: "harina" }),
      }),
    ).toStrictEqual({ texto: "ha", despuesDe: { id: ID, nombreClave: "harina" } });
  });

  it("pasa el producto que no se ofrece, si es un uuid; vacío o ausente es no excluir", () => {
    expect(
      leerLaEntradaDeLosIngredientes({ texto: "", despues: "", excluirProductoId: ID }),
    ).toStrictEqual({ excluirProductoId: ID });
    expect(
      leerLaEntradaDeLosIngredientes({ texto: "", despues: "", excluirProductoId: "" }),
    ).toStrictEqual({});
  });

  it.each([{ excluirProductoId: "no-es-un-uuid" }, { excluirProductoId: " " }])(
    "%j: null",
    (parte) => {
      expect(leerLaEntradaDeLosIngredientes({ texto: "", despues: "", ...parte })).toBeNull();
    },
  );

  it.each([{ texto: "uno\u0000" }, { despues: "mal" }, { despues: `${ID}:` }])(
    "%j: null",
    (parte) => {
      expect(leerLaEntradaDeLosIngredientes({ texto: "", despues: "", ...parte })).toBeNull();
    },
  );
});

const OTRO = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";
const PEDIDO = {
  productoId: ID,
  versionEsperada: 2,
  rinde: "10",
  pasos: "Hornear.",
  lineas: [{ ingredienteId: OTRO, bruto: "2.5", merma: "10" }],
  unidades: { [OTRO]: "KILOGRAMO" },
};

describe("leerElFormularioDeReceta", () => {
  it("los campos únicos y las líneas, en el orden en que aparecen", () => {
    const campos: [string, unknown][] = [
      ["producto", ID],
      ["rinde", "10"],
      ["pasos", "Hornear."],
      [nombreDeCampoDeReceta("l1", "ingrediente"), OTRO],
      [nombreDeCampoDeReceta("l1", "bruto"), "2,5"],
      [nombreDeCampoDeReceta("l1", "merma"), "10"],
      [nombreDeCampoDeReceta("l2", "ingrediente"), ID],
      [nombreDeCampoDeReceta("l2", "bruto"), "1"],
    ];
    expect(leerElFormularioDeReceta(campos)).toStrictEqual({
      producto: ID,
      rinde: "10",
      pasos: "Hornear.",
      lineas: [
        { ingredienteId: OTRO, bruto: "2,5", merma: "10" },
        { ingredienteId: ID, bruto: "1", merma: "" },
      ],
    });
  });

  it("las líneas pueden ser de una, dos o tres cifras (l7, l12, l123) y nada más; un campo que falta es vacío", () => {
    const lineas = leerElFormularioDeReceta(
      ["l7", "l12", "l123", "l1234"].map(
        (l) => [nombreDeCampoDeReceta(l, "ingrediente"), l] as const,
      ),
    ).lineas;
    expect(lineas).toStrictEqual([
      { ingredienteId: "l7", bruto: "", merma: "" },
      { ingredienteId: "l12", bruto: "", merma: "" },
      { ingredienteId: "l123", bruto: "", merma: "" },
    ]);
  });

  it("sin nada es todo vacío; una línea sin ingrediente no existe", () => {
    expect(leerElFormularioDeReceta([])).toStrictEqual({
      producto: "",
      rinde: "",
      pasos: "",
      lineas: [],
    });
    expect(
      leerElFormularioDeReceta([
        [nombreDeCampoDeReceta("l1", "ingrediente"), ""],
        [nombreDeCampoDeReceta("l1", "bruto"), "3"],
        [nombreDeCampoDeReceta("l2", "bruto"), "3"],
      ]).lineas,
    ).toStrictEqual([]);
  });

  it("lo que no se declara no existe: campos con otra forma, valores que no son texto, líneas mal nombradas", () => {
    expect(
      leerElFormularioDeReceta([
        ["rinde", 5],
        ["pasos", new Blob(["x"])],
        ["productoId", ID],
        ["receta_l1_precio", "9"],
        ["receta_l1234_ingrediente", OTRO],
        ["receta_x1_ingrediente", OTRO],
        ["xreceta_l1_ingrediente", OTRO],
        ["receta_l1_ingredientex", OTRO],
        [nombreDeCampoDeReceta("l1", "ingrediente"), 7],
      ]),
    ).toStrictEqual({ producto: "", rinde: "", pasos: "", lineas: [] });
  });

  it("un campo repetido conserva el primer valor", () => {
    const r = leerElFormularioDeReceta([
      ["rinde", "1"],
      ["rinde", "99"],
      ["producto", ID],
      ["producto", OTRO],
      ["pasos", "a"],
      ["pasos", "b"],
      [nombreDeCampoDeReceta("l1", "ingrediente"), OTRO],
      [nombreDeCampoDeReceta("l1", "ingrediente"), ID],
      [nombreDeCampoDeReceta("l1", "bruto"), "1"],
      [nombreDeCampoDeReceta("l1", "bruto"), "2"],
      [nombreDeCampoDeReceta("l1", "merma"), "3"],
      [nombreDeCampoDeReceta("l1", "merma"), "4"],
    ]);
    expect(r).toStrictEqual({
      producto: ID,
      rinde: "1",
      pasos: "a",
      lineas: [{ ingredienteId: OTRO, bruto: "1", merma: "3" }],
    });
  });

  it("no hay prototipos ni claves heredadas: `__proto__` y `constructor` no son campos", () => {
    const r = leerElFormularioDeReceta([
      ["__proto__", "x"],
      ["constructor", "x"],
      ["toString", "x"],
    ]);
    expect(r).toStrictEqual({ producto: "", rinde: "", pasos: "", lineas: [] });
  });
});

describe("leerElPedidoDeReceta", () => {
  it("acepta lo que tiene la forma pedida (la versión puede llegar como texto de dígitos)", () => {
    expect(leerElPedidoDeReceta(PEDIDO)).toStrictEqual({ ok: true, valor: PEDIDO });
    expect(leerElPedidoDeReceta({ ...PEDIDO, versionEsperada: "2" })).toStrictEqual({
      ok: true,
      valor: PEDIDO,
    });
  });

  it("rechaza sin decir cuál campo: ids que no son uuid, versión rara, cotas de forma, claves de más", () => {
    for (const mal of [
      null,
      "x",
      { ...PEDIDO, productoId: "no-es-uuid" },
      { ...PEDIDO, versionEsperada: "-1" },
      { ...PEDIDO, versionEsperada: "1.5" },
      { ...PEDIDO, rinde: "9".repeat(41) },
      { ...PEDIDO, pasos: "p".repeat(2101) },
      { ...PEDIDO, lineas: [{ ingredienteId: "x", bruto: "1", merma: "" }] },
      { ...PEDIDO, lineas: Array.from({ length: 201 }, () => PEDIDO.lineas[0]) },
      { ...PEDIDO, unidades: { "no-uuid": "KILOGRAMO" } },
      { ...PEDIDO, unidades: { [OTRO]: "K".repeat(1001) } },
      { ...PEDIDO, productoId: undefined },
    ]) {
      expect(leerElPedidoDeReceta(mal)).toStrictEqual({ ok: false, error: "PEDIDO_INVALIDO" });
    }
  });

  it("tolera el tope de forma exacto", () => {
    expect(leerElPedidoDeReceta({ ...PEDIDO, pasos: "p".repeat(2100) }).ok).toBe(true);
    expect(
      leerElPedidoDeReceta({
        ...PEDIDO,
        lineas: Array.from({ length: 200 }, () => PEDIDO.lineas[0]),
      }).ok,
    ).toBe(true);
  });
});

describe("aEntradaDeGuardarReceta", () => {
  it("arma lo que acepta guardarComposicion: unidad fijada por el servidor, merma y pasos solo si hay", () => {
    expect(aEntradaDeGuardarReceta(PEDIDO)).toStrictEqual({
      productoId: ID,
      versionEsperada: 2,
      rinde: "10",
      pasos: "Hornear.",
      componentes: [{ productoId: OTRO, cantidad: "2.5", unidadId: "KILOGRAMO", perdida: "10" }],
    });
    expect(
      aEntradaDeGuardarReceta({
        ...PEDIDO,
        pasos: "  ",
        lineas: [{ ingredienteId: OTRO, bruto: "1", merma: "  " }],
      }),
    ).toStrictEqual({
      productoId: ID,
      versionEsperada: 2,
      rinde: "10",
      componentes: [{ productoId: OTRO, cantidad: "1", unidadId: "KILOGRAMO" }],
    });
  });

  it("los pasos se recortan: el mismo contenido da siempre la misma versión", () => {
    expect(aEntradaDeGuardarReceta({ ...PEDIDO, pasos: "  Hornear.  " })?.pasos).toBe("Hornear.");
  });

  it("un ingrediente sin unidad fijada por el servidor no se adivina: null", () => {
    expect(aEntradaDeGuardarReceta({ ...PEDIDO, unidades: {} })).toBeNull();
    expect(aEntradaDeGuardarReceta({ ...PEDIDO, unidades: { [ID]: "KILOGRAMO" } })).toBeNull();
  });

  it("una receta sin líneas se arma igual (el dominio la rechaza, no la pantalla)", () => {
    expect(aEntradaDeGuardarReceta({ ...PEDIDO, lineas: [] })?.componentes).toStrictEqual([]);
  });
});
