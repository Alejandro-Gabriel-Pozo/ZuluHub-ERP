import { describe, expect, it } from "vitest";
import { CLASES_DE_USO } from "../modulos/catalogo/publico";
import {
  entradaDeEditarProducto,
  leerElPedidoDeLaFicha,
  type PedidoDeLaFicha,
  type ProductoParaEditar,
} from "./entradas-de-ficha-de-producto";

/**
 * La entrada de la ficha de datos de un producto (A1, T2a): lo que manda el formulario contra lo que acepta `editarProducto`. Cada regla con su prueba: el pedido solo lee las
 * claves declaradas, lo que no vino conserva lo guardado, lo que vino vacío lo borra y lo que la clase no admite no se manda.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

const pedido = (cambios: Record<string, unknown> = {}) => ({
  productoId: ID,
  versionEsperada: 3,
  nombre: "Milanesa",
  ...cambios,
});

const GUARDADO: ProductoParaEditar = {
  id: ID as ProductoParaEditar["id"],
  claseDeUso: "VENDIBLE",
  nombreDeCocina: "MILA",
  descripcionEnCarta: "Con papas",
  codigo: "MIL-1",
  codigoDeBarras: "12345678",
  alicuota: "21",
  seccionDeCartaId: SECCION as ProductoParaEditar["seccionDeCartaId"],
};
const con = (cambios: Partial<ProductoParaEditar>): ProductoParaEditar => ({
  ...GUARDADO,
  ...cambios,
});
const leido = (crudo: unknown): PedidoDeLaFicha => {
  const r = leerElPedidoDeLaFicha(crudo);
  if (!r.ok) throw new Error("se esperaba un pedido válido");
  return r.valor;
};

describe("leerElPedidoDeLaFicha", () => {
  it("lee las claves declaradas y descarta las demás (no se puede mandar la clase, la unidad ni la empresa)", () => {
    const r = leerElPedidoDeLaFicha(
      pedido({
        nombreDeCocina: "MILA",
        codigo: "A1",
        codigoDeBarras: "12345678",
        alicuota: "21",
        seccionDeCartaId: SECCION,
        claseDeUso: "INSUMO",
        unidadBaseId: "KILOGRAMO",
        empresaId: "otra",
      }),
    );
    expect(r).toEqual({
      ok: true,
      valor: {
        productoId: ID,
        versionEsperada: 3,
        nombre: "Milanesa",
        nombreDeCocina: "MILA",
        codigo: "A1",
        codigoDeBarras: "12345678",
        alicuota: "21",
        seccionDeCartaId: SECCION,
      },
    });
  });

  it("solo piden el id, la versión y el nombre; lo demás puede faltar", () => {
    expect(leerElPedidoDeLaFicha(pedido())).toEqual({
      ok: true,
      valor: { productoId: ID, versionEsperada: 3, nombre: "Milanesa" },
    });
  });

  it("la versión puede llegar como texto de dígitos, nunca como otra cosa", () => {
    expect(leido(pedido({ versionEsperada: "7" })).versionEsperada).toBe(7);
    for (const mala of ["3.5", "-1", "1e3", "", "abc", 1.5, -1, null]) {
      expect(leerElPedidoDeLaFicha(pedido({ versionEsperada: mala })).ok).toBe(false);
    }
  });

  it.each([
    ["sin id", pedido({ productoId: undefined })],
    ["un id que no es uuid", pedido({ productoId: "1; DROP TABLE producto" })],
    ["un id con mayúsculas", pedido({ productoId: ID.toUpperCase() })],
    ["sin nombre", pedido({ nombre: undefined })],
    ["un nombre que no es texto", pedido({ nombre: 7 })],
    ["un nombre gigante", pedido({ nombre: "a".repeat(1001) })],
    ["un código que no es texto", pedido({ codigo: 12 })],
    ["un campo gigante", pedido({ nombreDeCocina: "a".repeat(1001) })],
    ["nada", undefined],
    ["un texto", "nombre"],
    ["null", null],
  ])("%s es un pedido inválido, sin decir cuál campo", (_caso, crudo) => {
    expect(leerElPedidoDeLaFicha(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("un campo de 1000 caracteres todavía pasa (el largo real lo decide el dominio)", () => {
    expect(leerElPedidoDeLaFicha(pedido({ nombre: "a".repeat(1000) })).ok).toBe(true);
  });
});

describe("entradaDeEditarProducto", () => {
  it("una clase que se vende lleva todo lo del pedido", () => {
    expect(
      entradaDeEditarProducto(
        leido(
          pedido({
            nombreDeCocina: "MILA NAPO",
            codigo: "MIL-2",
            codigoDeBarras: "87654321",
            alicuota: "10.5",
            seccionDeCartaId: SECCION,
          }),
        ),
        GUARDADO,
      ),
    ).toEqual({
      productoId: ID,
      versionEsperada: 3,
      nombre: "Milanesa",
      nombreDeCocina: "MILA NAPO",
      descripcionEnCarta: "Con papas",
      codigo: "MIL-2",
      codigoDeBarras: "87654321",
      alicuota: "10.5",
      seccionDeCartaId: SECCION,
    });
  });

  it("lo que el pedido no trae conserva lo guardado (la alícuota y la sección apagadas, la descripción)", () => {
    expect(entradaDeEditarProducto(leido(pedido()), GUARDADO)).toEqual({
      productoId: ID,
      versionEsperada: 3,
      nombre: "Milanesa",
      nombreDeCocina: "MILA",
      descripcionEnCarta: "Con papas",
      codigo: "MIL-1",
      codigoDeBarras: "12345678",
      alicuota: "21",
      seccionDeCartaId: SECCION,
    });
  });

  it("lo que llega vacío lo borra a propósito (no se confunde con lo que no llega)", () => {
    const e = entradaDeEditarProducto(
      leido(
        pedido({
          nombreDeCocina: "",
          codigo: "",
          codigoDeBarras: "",
          alicuota: "",
          seccionDeCartaId: "",
        }),
      ),
      GUARDADO,
    );
    expect([e.nombreDeCocina, e.codigo, e.codigoDeBarras, e.alicuota, e.seccionDeCartaId]).toEqual([
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  it("la descripción nunca sale del pedido: es siempre la guardada", () => {
    const e = entradaDeEditarProducto(
      leido(pedido({ descripcionEnCarta: "otra descripción" })),
      GUARDADO,
    );
    expect(e.descripcionEnCarta).toBe("Con papas");
  });

  it("el nombre y la versión salen siempre del pedido, y el id del producto leído", () => {
    const e = entradaDeEditarProducto(
      leido(pedido({ versionEsperada: 9, nombre: "Otra" })),
      GUARDADO,
    );
    expect([e.productoId, e.versionEsperada, e.nombre]).toEqual([ID, 9, "Otra"]);
  });

  it.each(["MATERIA_PRIMA", "INSUMO", "ELABORADO"] as const)(
    "la clase %s (no se vende) no manda nombre de cocina, descripción, alícuota ni sección, aunque el pedido los traiga",
    (claseDeUso) => {
      const e = entradaDeEditarProducto(
        leido(
          pedido({
            nombreDeCocina: "X",
            alicuota: "21",
            seccionDeCartaId: SECCION,
            codigo: "H-1",
            codigoDeBarras: "12345678",
          }),
        ),
        con({
          claseDeUso,
          nombreDeCocina: null,
          descripcionEnCarta: null,
          alicuota: null,
          seccionDeCartaId: null,
        }),
      );
      expect(e).toEqual({
        productoId: ID,
        versionEsperada: 3,
        nombre: "Milanesa",
        nombreDeCocina: null,
        descripcionEnCarta: null,
        codigo: "H-1",
        codigoDeBarras: "12345678",
        alicuota: null,
        seccionDeCartaId: null,
      });
    },
  );

  it("una clase que no se vende tampoco lleva lo que tuviera guardado (la base no lo permite: se manda vacío, no se arrastra)", () => {
    const e = entradaDeEditarProducto(leido(pedido()), con({ claseDeUso: "INSUMO" }));
    expect([e.nombreDeCocina, e.descripcionEnCarta, e.alicuota, e.seccionDeCartaId]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("el código y el código de barras se conservan también en una clase que no se vende", () => {
    const e = entradaDeEditarProducto(leido(pedido()), con({ claseDeUso: "MATERIA_PRIMA" }));
    expect([e.codigo, e.codigoDeBarras]).toEqual(["MIL-1", "12345678"]);
  });
});

describe("según la clase (la pregunta es la del módulo: `vendeLaClase`)", () => {
  it("solo la reventa y el producto vendible mandan nombre de cocina, descripción, alícuota y sección; las otras tres, vacíos", () => {
    const mandan = CLASES_DE_USO.filter((claseDeUso) => {
      const e = entradaDeEditarProducto(leido(pedido()), con({ claseDeUso }));
      return [e.nombreDeCocina, e.descripcionEnCarta, e.alicuota, e.seccionDeCartaId].every(
        (v) => v !== null,
      );
    });
    expect(mandan).toEqual(["REVENTA", "VENDIBLE"]);
  });
});
