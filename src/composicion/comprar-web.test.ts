import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  buscarLosProductosParaComprar,
  cotizarLaCompra,
  registrarLaCompra,
  type DependenciasDeComprarWeb,
  type DependenciasDeRegistrarCompraWeb,
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
    total: "2000.00",
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

  it("el total sale tal cual lo calculó el servidor, como texto; sin precio en algún renglón es null (nunca un parcial ni cero)", async () => {
    const { d } = montarCotizar(() => ok(COTIZADA));
    expect(await cotizarLaCompra(d, contexto, { renglones: [renglon] })).toMatchObject({
      ok: true,
      dato: { total: "2000.00" },
    });
    const sin = montarCotizar(() => ok({ ...COTIZADA, total: null }));
    expect(await cotizarLaCompra(sin.d, contexto, { renglones: [renglon] })).toMatchObject({
      ok: true,
      dato: { total: null },
    });
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

describe("registrarLaCompra", () => {
  const ID = "0b0b0b0b-1111-4222-8333-444444444444";
  const CLAVE = "5a5a5a5a-1111-4222-8333-444444444444";
  const SUCURSAL_DEL_SERVIDOR = "1d1d1d1d-1111-4222-8333-444444444444";
  const renglon = {
    productoId: ID,
    unidadDeCompraId: "KILOGRAMO",
    cantidad: "2",
    precioPor: "UNIDAD",
    unidadDePrecioId: "KILOGRAMO",
    precio: "1000.00",
  };
  const pedido = { clave: CLAVE, proveedorId: ID, renglones: [renglon] };

  const montarRegistro = (resultado: () => unknown) => {
    const llamadas: { contexto: unknown; entrada: Record<string, unknown> }[] = [];
    const llamadasConFactura: { contexto: unknown; entrada: Record<string, unknown> }[] = [];
    const registrados: string[] = [];
    const d = {
      casosDeUso: () => ({
        registrarCompra: (c: unknown, entrada: Record<string, unknown>) => {
          llamadas.push({ contexto: c, entrada });
          return Promise.resolve(resultado());
        },
        registrarCompraConFactura: (c: unknown, entrada: Record<string, unknown>) => {
          llamadasConFactura.push({ contexto: c, entrada });
          return Promise.resolve(resultado());
        },
      }),
      respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
    } as unknown as DependenciasDeRegistrarCompraWeb;
    return { d, llamadas, llamadasConFactura, registrados };
  };
  const hecha = {
    recepcionId: "r1",
    comprobanteId: null,
    pagoId: null,
    movimientos: ["m1"],
    yaExistia: false,
    avisos: [],
  };

  it("manda al caso de uso la clave, el proveedor y los renglones con la sucursal del SERVIDOR; devuelve solo la compra", async () => {
    const { d, llamadas } = montarRegistro(() => ok(hecha));
    expect(await registrarLaCompra(d, contexto, SUCURSAL_DEL_SERVIDOR, pedido)).toEqual({
      ok: true,
      dato: { recepcionId: "r1", yaExistia: false, avisos: [] },
    });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.contexto).toBe(contexto);
    expect(llamadas[0]?.entrada).toEqual({
      clave: CLAVE,
      sucursalId: SUCURSAL_DEL_SERVIDOR,
      proveedorId: ID,
      depositoId: null,
      remito: null,
      renglones: [{ ...renglon, presentacionId: null, pesoReal: null }],
    });
  });

  it("la sucursal, la empresa y la persona que mande el navegador no llegan al caso de uso", async () => {
    const { d, llamadas } = montarRegistro(() => ok(hecha));
    await registrarLaCompra(d, contexto, SUCURSAL_DEL_SERVIDOR, {
      ...pedido,
      sucursalId: ID,
      empresaId: ID,
      personaId: ID,
    });
    expect(llamadas[0]?.entrada["sucursalId"]).toBe(SUCURSAL_DEL_SERVIDOR);
    expect(Object.keys(llamadas[0]?.entrada ?? {}).sort()).toEqual([
      "clave",
      "depositoId",
      "proveedorId",
      "remito",
      "renglones",
      "sucursalId",
    ]);
  });

  it("repetir devuelve la misma compra con yaExistia", async () => {
    const { d } = montarRegistro(() => ok({ ...hecha, yaExistia: true }));
    expect(await registrarLaCompra(d, contexto, SUCURSAL_DEL_SERVIDOR, pedido)).toEqual({
      ok: true,
      dato: { recepcionId: "r1", yaExistia: true, avisos: [] },
    });
  });

  const factura = {
    tipo: "FACTURA_A",
    puntoDeVenta: "5",
    numero: "1187",
    fecha: "2026-10-31",
    lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1.5", alicuota: "21" }],
    totalSegunFactura: "3630.00",
  };

  it("con factura llama al caso de uso «Con factura» (y no al de siempre), con la factura armada campo por campo y la sucursal del SERVIDOR", async () => {
    const { d, llamadas, llamadasConFactura } = montarRegistro(() =>
      ok({ ...hecha, comprobanteId: "c1", avisos: [{ tipo: "TOTAL_NO_COINCIDE" }] }),
    );
    expect(
      await registrarLaCompra(d, contexto, SUCURSAL_DEL_SERVIDOR, {
        ...pedido,
        sucursalId: ID,
        factura,
      }),
    ).toEqual({
      ok: true,
      dato: { recepcionId: "r1", yaExistia: false, avisos: [{ tipo: "TOTAL_NO_COINCIDE" }] },
    });
    expect(llamadas).toHaveLength(0);
    expect(llamadasConFactura).toHaveLength(1);
    expect(llamadasConFactura[0]?.entrada["sucursalId"]).toBe(SUCURSAL_DEL_SERVIDOR);
    expect(llamadasConFactura[0]?.entrada["factura"]).toMatchObject({
      tipo: "FACTURA_A",
      puntoDeVenta: 5,
      numero: 1187,
      percepciones: null,
      cuitDelProveedor: null,
    });
    expect(Object.keys(llamadasConFactura[0]?.entrada ?? {})).not.toContain("pago");
  });

  it("una factura con la forma mal (campo de más, tipo fuera de la lista) es el genérico y no llama a ningún caso de uso", async () => {
    const { d, llamadas, llamadasConFactura } = montarRegistro(() => ok(hecha));
    for (const mala of [
      { ...factura, pago: { medio: "QR" } },
      { ...factura, tipo: "OTRA" },
      { total: "1" },
    ]) {
      const r = await registrarLaCompra(d, contexto, SUCURSAL_DEL_SERVIDOR, {
        ...pedido,
        factura: mala,
      });
      expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });
    }
    expect(llamadas).toHaveLength(0);
    expect(llamadasConFactura).toHaveLength(0);
  });

  it("un pedido sin la forma pedida es el genérico y no llama al caso de uso", async () => {
    const { d, llamadas } = montarRegistro(() => ok(hecha));
    for (const crudo of [{}, { ...pedido, clave: "x" }, { ...pedido, renglones: [] }, "texto"]) {
      expect(await registrarLaCompra(d, contexto, SUCURSAL_DEL_SERVIDOR, crudo)).toMatchObject({
        ok: false,
        error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" },
      });
    }
    expect(llamadas).toEqual([]);
  });

  it.each([
    [
      "REMITO_YA_REGISTRADO objeto",
      { error: "REMITO_YA_REGISTRADO", recepcionId: "r9" },
      "COMPRAS_REMITO_REPETIDO",
    ],
    ["PRECIO_INVALIDO", "PRECIO_INVALIDO", "COMPRAS_PRECIO_INVALIDO"],
    ["CANTIDAD_INVALIDA", "CANTIDAD_INVALIDA", "COMPRAS_CANTIDAD_INVALIDA"],
    ["PROVEEDOR_NO_ENCONTRADO", "PROVEEDOR_NO_ENCONTRADO", "COMPRAS_PROVEEDOR_NO_ENCONTRADO"],
    ["CLAVE_REUTILIZADA", "CLAVE_REUTILIZADA", "COMPRAS_ACCION_NO_PERMITIDA"],
    ["DEPOSITO_A_ELEGIR", "DEPOSITO_A_ELEGIR", "COMPRAS_ACCION_NO_PERMITIDA"],
  ])(
    "el rechazo %s sale con su código público, sin el id de la otra compra",
    async (_n, error, codigo) => {
      const { d } = montarRegistro(() => err(error));
      const r = await registrarLaCompra(d, contexto, SUCURSAL_DEL_SERVIDOR, pedido);
      expect(r).toMatchObject({ ok: false, error: { codigo } });
      expect(JSON.stringify(r)).not.toContain("r9");
    },
  );

  it("el rechazo del guard sale con su código y una excepción sale sin detalle y registrada", async () => {
    const guard = montarRegistro(() => err("SIN_PERMISO"));
    expect(await registrarLaCompra(guard.d, contexto, SUCURSAL_DEL_SERVIDOR, pedido)).toMatchObject(
      { ok: false },
    );
    const rota = montarRegistro(() => {
      throw new Error("detalle interno: password=1234");
    });
    const r = await registrarLaCompra(rota.d, contexto, SUCURSAL_DEL_SERVIDOR, pedido);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("password");
  });
});
