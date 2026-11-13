import { describe, expect, it } from "vitest";
import {
  entradaDeCrearProducto,
  leerElPedidoDeAlta,
  type PedidoDeAlta,
} from "./entradas-de-alta-de-producto";

/**
 * La entrada del alta de un producto (A1, T6): lo que manda el formulario contra lo que acepta `crearProducto`. Cada regla con su prueba: el pedido solo lee las claves declaradas,
 * la clave de creación es el id del producto, lo que la clase no admite no se manda y la forma de venta y la descripción no viajan.
 */
const CLAVE = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

const COMPLETO = {
  claveDeCreacion: CLAVE,
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  nombre: "Milanesa",
  nombreDeCocina: "MILA",
  codigo: "MIL-1",
  codigoDeBarras: "12345678",
  alicuota: "21",
  seccionDeCartaId: SECCION,
};
const leido = (crudo: unknown): PedidoDeAlta => {
  const r = leerElPedidoDeAlta(crudo);
  if (!r.ok) throw new Error("se esperaba un pedido válido");
  return r.valor;
};

describe("leerElPedidoDeAlta", () => {
  it("lee las claves declaradas y descarta las demás (no se puede mandar la empresa, la descripción, la unidad de venta ni el paso)", () => {
    expect(
      leerElPedidoDeAlta({
        ...COMPLETO,
        empresaId: "otra",
        descripcionEnCarta: "otra",
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "0.5",
        faltaCompletar: true,
        id: "otro",
      }),
    ).toEqual({ ok: true, valor: COMPLETO });
  });

  it.each(Object.keys(COMPLETO))("sin %s no tiene la forma pedida", (campo) => {
    const { [campo]: _quitado, ...resto } = COMPLETO as Record<string, string>;
    void _quitado;
    expect(leerElPedidoDeAlta(resto)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("la clave de creación tiene que tener forma de uuid", () => {
    for (const mala of ["", "abc", "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4", `${CLAVE}x`]) {
      expect(leerElPedidoDeAlta({ ...COMPLETO, claveDeCreacion: mala }).ok).toBe(false);
    }
  });

  it("un campo que no es texto, o es demasiado largo, no tiene la forma pedida (sin decir cuál)", () => {
    for (const campo of ["nombre", "codigo", "claseDeUso"]) {
      expect(leerElPedidoDeAlta({ ...COMPLETO, [campo]: 5 })).toEqual({
        ok: false,
        error: "PEDIDO_INVALIDO",
      });
      expect(leerElPedidoDeAlta({ ...COMPLETO, [campo]: "x".repeat(1001) }).ok).toBe(false);
    }
    expect(leerElPedidoDeAlta(null)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});

describe("entradaDeCrearProducto", () => {
  it("una clase que se vende pasa todo; la clave de creación es el id; no manda unidad de venta, paso ni descripción", () => {
    for (const claseDeUso of ["VENDIBLE", "REVENTA"]) {
      expect(entradaDeCrearProducto(leido({ ...COMPLETO, claseDeUso }))).toEqual({
        id: CLAVE,
        claseDeUso,
        unidadBaseId: "UNIDAD",
        nombre: "Milanesa",
        nombreDeCocina: "MILA",
        codigo: "MIL-1",
        codigoDeBarras: "12345678",
        alicuota: "21",
        seccionDeCartaId: SECCION,
      });
    }
  });

  it.each(["MATERIA_PRIMA", "INSUMO", "ELABORADO"])(
    "%s no se vende: nombre de cocina, alícuota y sección van vacíos aunque el pedido los traiga",
    (claseDeUso) => {
      const e = entradaDeCrearProducto(leido({ ...COMPLETO, claseDeUso }));
      expect([e.nombreDeCocina, e.alicuota, e.seccionDeCartaId]).toEqual([null, null, null]);
      expect([e.codigo, e.codigoDeBarras, e.nombre]).toEqual(["MIL-1", "12345678", "Milanesa"]);
    },
  );

  it("una clase desconocida pasa tal cual (la rechaza el dominio) y no se la trata como vendible", () => {
    const e = entradaDeCrearProducto(leido({ ...COMPLETO, claseDeUso: "OTRA" }));
    expect([e.claseDeUso, e.alicuota, e.nombreDeCocina, e.seccionDeCartaId]).toEqual([
      "OTRA",
      null,
      null,
      null,
    ]);
  });
});
