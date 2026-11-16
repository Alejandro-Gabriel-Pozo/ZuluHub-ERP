import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  MAXIMO_DE_PAGINAS_DE_LA_VENTA_RAPIDA,
  cargarVentaRapida,
  cotizarElCarrito,
  type DependenciasDeVentaRapidaWeb,
} from "./venta-rapida-web";

/**
 * La composición de la venta rápida con las consultas simuladas: qué pide, qué sale hacia la pantalla y cómo cierra cuando algo falla. Contra la base real,
 * `test/integracion/venta-rapida-web.test.ts`.
 */
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const SUCURSAL = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const respuesta = { registrar: () => undefined, azar: () => new Uint8Array([1, 2, 3, 4]) };

type Pagina = {
  secciones: { id: string; nombre: string; orden: number }[];
  productos: unknown[];
  siguiente: { nombreClave: string; id: string } | null;
};
const producto = (n: number) => ({
  id: `p${n}`,
  nombre: `Producto ${n}`,
  seccionId: null,
  unidadDeVentaId: "UNIDAD",
  pasoMinimo: "1",
  porcionesOfrecidas: [],
  precio: { tipo: "BASE", importe: "10.000000" },
  variante: null,
  grupos: [],
  // Un dato interno que la pantalla no debe ver: la lista blanca lo descarta.
  claveInterna: "secreto",
});

function montar(paginas: (n: number) => Promise<unknown>) {
  const pedidos: unknown[] = [];
  let n = 0;
  const d = {
    consultasDeCatalogo: () => ({
      productosParaVender: (_c: unknown, entrada: unknown) => {
        pedidos.push(entrada);
        n += 1;
        return paginas(n);
      },
    }),
    consultasDeVentas: () => ({
      cotizarVentaRapida: () =>
        Promise.resolve(ok({ total: { moneda: "ARS", monto: "0.00" }, lineas: [] })),
    }),
    respuesta,
  } as unknown as DependenciasDeVentaRapidaWeb;
  return { d, pedidos };
}

describe("cargarVentaRapida", () => {
  it("pide la sucursal que le pasa el servidor, trae todas las páginas y saca solo lo que la pantalla usa", async () => {
    const { d, pedidos } = montar((n) =>
      Promise.resolve(
        ok({
          secciones: [{ id: "s1", nombre: "Bebidas", orden: 1 }],
          productos: [producto(n)],
          siguiente: n < 3 ? { nombreClave: `p${n}`, id: ID } : null,
        } satisfies Pagina),
      ),
    );
    const r = await cargarVentaRapida(d, contexto, SUCURSAL);
    expect(pedidos).toEqual([
      { sucursalId: SUCURSAL },
      { sucursalId: SUCURSAL, despuesDe: { nombreClave: "p1", id: ID } },
      { sucursalId: SUCURSAL, despuesDe: { nombreClave: "p2", id: ID } },
    ]);
    if (!r.ok) throw new Error("se esperaba ok");
    expect(r.dato.incompleta).toBe(false);
    expect(r.dato.secciones).toEqual([{ id: "s1", nombre: "Bebidas" }]);
    expect(r.dato.productos.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(JSON.stringify(r)).not.toContain("secreto");
  });

  it("si quedan más páginas que el tope, lo dice (`incompleta`) en vez de mostrar una lista parcial como completa", async () => {
    const { d, pedidos } = montar((n) =>
      Promise.resolve(
        ok({ secciones: [], productos: [producto(n)], siguiente: { nombreClave: "x", id: ID } }),
      ),
    );
    const r = await cargarVentaRapida(d, contexto, SUCURSAL);
    expect(pedidos).toHaveLength(MAXIMO_DE_PAGINAS_DE_LA_VENTA_RAPIDA);
    expect(r).toMatchObject({ ok: true, dato: { incompleta: true } });
  });

  it("si una página falla, falla todo: nada a medias; un error de negocio es el genérico", async () => {
    const { d } = montar((n) =>
      Promise.resolve(
        n === 1
          ? ok({ secciones: [], productos: [producto(1)], siguiente: { nombreClave: "x", id: ID } })
          : err("SUCURSAL_INACTIVA"),
      ),
    );
    const r = await cargarVentaRapida(d, contexto, SUCURSAL);
    expect(r).toMatchObject({ ok: false, error: { codigo: "VENTAS_ACCION_NO_PERMITIDA" } });
    expect(JSON.stringify(r)).not.toContain("p1");
  });

  it("el motivo del guard pasa con su código (sin permiso no sale ningún dato)", async () => {
    const { d } = montar(() => Promise.resolve(err("SIN_PERMISO")));
    expect(await cargarVentaRapida(d, contexto, SUCURSAL)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar(() => Promise.reject(new Error("detalle secreto")));
    const r = await cargarVentaRapida(d, contexto, SUCURSAL);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalle secreto");
  });
});

describe("cotizarElCarrito", () => {
  const cotizar = (pedido: unknown, resultado: unknown) => {
    const llamadas: unknown[] = [];
    const d = {
      consultasDeCatalogo: () => ({}),
      consultasDeVentas: () => ({
        cotizarVentaRapida: (_c: unknown, entrada: unknown) => {
          llamadas.push(entrada);
          return Promise.resolve(resultado);
        },
      }),
      respuesta,
    } as unknown as DependenciasDeVentaRapidaWeb;
    return { llamadas, correr: () => cotizarElCarrito(d, contexto, SUCURSAL, pedido) };
  };
  const salida = ok({
    total: { moneda: "ARS", monto: "20.00", interno: "x" },
    lineas: [
      {
        precioUnitario: { moneda: "ARS", monto: "10.000000" },
        importe: { moneda: "ARS", monto: "20.00" },
      },
    ],
  });

  it("la sucursal es la del servidor aunque el pedido traiga otra; el total sale tal cual lo calculó el servidor, con su moneda", async () => {
    const { llamadas, correr } = cotizar(
      { sucursalId: "otra", lineas: [{ productoId: ID, opcionIds: [], cantidad: "2" }] },
      salida,
    );
    expect(await correr()).toEqual({
      ok: true,
      dato: {
        total: { moneda: "ARS", monto: "20.00" },
        lineas: [
          {
            precioUnitario: { moneda: "ARS", monto: "10.000000" },
            importe: { moneda: "ARS", monto: "20.00" },
          },
        ],
      },
    });
    expect(llamadas).toEqual([
      { sucursalId: SUCURSAL, lineas: [{ productoId: ID, opcionIds: [], cantidad: "2" }] },
    ]);
  });

  it("repetir el mismo pedido da lo mismo (es una lectura: no hay nada que duplicar)", async () => {
    const { correr } = cotizar(
      { lineas: [{ productoId: ID, opcionIds: [], cantidad: "2" }] },
      salida,
    );
    expect(await correr()).toEqual(await correr());
  });

  it("un pedido mal formado no llega al servidor", async () => {
    const { llamadas, correr } = cotizar({ lineas: [{ productoId: "x" }] }, salida);
    expect(await correr()).toMatchObject({
      ok: false,
      error: { codigo: "VENTAS_ACCION_NO_PERMITIDA" },
    });
    expect(llamadas).toEqual([]);
  });

  it("un rechazo del negocio (producto oculto, precio sin cargar…) es el genérico", async () => {
    const { correr } = cotizar(
      { lineas: [{ productoId: ID, opcionIds: [], cantidad: "1" }] },
      err("PRODUCTO_OCULTO"),
    );
    expect(await correr()).toMatchObject({
      ok: false,
      error: { codigo: "VENTAS_ACCION_NO_PERMITIDA" },
    });
  });
});
