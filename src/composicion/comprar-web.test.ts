import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import { buscarLosProductosParaComprar, type DependenciasDeComprarWeb } from "./comprar-web";

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
