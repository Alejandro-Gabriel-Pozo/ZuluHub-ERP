import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  buscarLosProductosParaComprar,
  cotizarLaCompra,
  type DependenciasDeComprarWeb,
} from "./comprar-web";

const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

const PRODUCTO = {
  productoId: "0b0b0b0b-1111-4222-8333-444444444444",
  nombre: "Harina",
  unidadBase: "GRAMO",
  clase: "MATERIA_PRIMA",
  presentaciones: [{ id: "p1", nombre: "Bolsa", cantidad: "25000.0000", dePesoVariable: false }],
};

const montar = (resultado: () => unknown) => {
  const llamadas: unknown[] = [];
  const registrados: string[] = [];
  const d = {
    consultas: () => ({
      productosParaComprar: (_c: unknown, entrada: unknown) => {
        llamadas.push(entrada);
        return Promise.resolve(resultado());
      },
    }),
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeComprarWeb;
  return { d, llamadas, registrados };
};

describe("buscarLosProductosParaComprar", () => {
  it("pasa el texto a la consulta y devuelve los productos tal cual, sin dinero", async () => {
    const { d, llamadas } = montar(() => ok([PRODUCTO]));
    expect(await buscarLosProductosParaComprar(d, contexto, { texto: "Har" })).toEqual({
      ok: true,
      dato: { productos: [PRODUCTO] },
    });
    expect(llamadas).toEqual([{ texto: "Har" }]);
  });

  it("sin texto pide todo (la consulta pone el tope)", async () => {
    const { d, llamadas } = montar(() => ok([]));
    await buscarLosProductosParaComprar(d, contexto, {});
    expect(llamadas).toEqual([{}]);
  });

  it("un texto inválido da lista vacía y ni siquiera consulta", async () => {
    const { d, llamadas } = montar(() => ok([PRODUCTO]));
    expect(await buscarLosProductosParaComprar(d, contexto, { texto: "<b>" })).toEqual({
      ok: true,
      dato: { productos: [] },
    });
    expect(llamadas).toEqual([]);
  });

  it("un pedido sin la forma pedida es el genérico y no consulta", async () => {
    const { d, llamadas } = montar(() => ok([]));
    expect(await buscarLosProductosParaComprar(d, contexto, { texto: 5 })).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" },
    });
    expect(llamadas).toEqual([]);
  });

  it("el rechazo del guard sale con su código y una excepción sale sin detalle", async () => {
    const rechazo = montar(() => err("SIN_PERMISO"));
    expect(await buscarLosProductosParaComprar(rechazo.d, contexto, {})).toMatchObject({
      ok: false,
    });
    const falla = montar(() => {
      throw new Error("se cayó la base: secreto");
    });
    const r = await buscarLosProductosParaComprar(falla.d, contexto, {});
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(falla.registrados).toHaveLength(1);
  });
});

describe("cotizarLaCompra", () => {
  const ID = "0b0b0b0b-1111-4222-8333-444444444444";
  const renglon = {
    productoId: ID,
    unidadDeCompraId: "KILOGRAMO",
    cantidad: "2",
    precioPor: "UNIDAD",
    unidadDePrecioId: "KILOGRAMO",
    precio: "1000",
  };
  const COTIZADA = {
    renglones: [
      {
        productoId: ID,
        cantidadEnStock: "2000.0000",
        importe: "2000.00",
        costoPorUnidadDeStock: "1.000000",
        dePesoVariable: false,
      },
    ],
  };
  const montarCotizar = (resultado: () => unknown) => {
    const llamadas: unknown[] = [];
    const d = {
      consultas: () => ({
        cotizarCompra: (_c: unknown, entrada: unknown) => {
          llamadas.push(entrada);
          return Promise.resolve(resultado());
        },
      }),
      respuesta: { registrar: () => undefined },
    } as unknown as DependenciasDeComprarWeb;
    return { d, llamadas };
  };

  it("devuelve lo cotizado como texto y le pasa a la consulta solo los renglones declarados", async () => {
    const { d, llamadas } = montarCotizar(() => ok(COTIZADA));
    expect(
      await cotizarLaCompra(d, contexto, { renglones: [{ ...renglon, empresaId: "otra" }] }),
    ).toEqual({ ok: true, dato: COTIZADA });
    expect(llamadas).toEqual([
      {
        renglones: [{ ...renglon, presentacionId: null, pesoReal: null }],
      },
    ]);
  });

  it("un pedido sin la forma pedida es el genérico y no consulta", async () => {
    const { d, llamadas } = montarCotizar(() => ok(COTIZADA));
    expect(
      await cotizarLaCompra(d, contexto, { renglones: [{ ...renglon, cantidad: 2 }] }),
    ).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" },
    });
    expect(llamadas).toEqual([]);
  });

  it("la cantidad y el precio inválidos salen con su texto propio; lo demás, el genérico", async () => {
    const cantidad = montarCotizar(() => err("CANTIDAD_INVALIDA"));
    expect(await cotizarLaCompra(cantidad.d, contexto, { renglones: [renglon] })).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_CANTIDAD_INVALIDA" },
    });
    const precio = montarCotizar(() => err("PRECIO_INVALIDO"));
    expect(await cotizarLaCompra(precio.d, contexto, { renglones: [renglon] })).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_PRECIO_INVALIDO" },
    });
    const otro = montarCotizar(() => err("PRODUCTO_NO_COMPRABLE"));
    expect(await cotizarLaCompra(otro.d, contexto, { renglones: [renglon] })).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" },
    });
  });
});
