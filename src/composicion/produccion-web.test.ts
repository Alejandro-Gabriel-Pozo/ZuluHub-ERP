import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import type { ContextoOperativo } from "../contexto/contexto";
import { empresaId, personaId } from "../primitivas/identificadores/marca";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  anularLaOrden,
  cancelarLaOrden,
  listarLasOrdenes,
  verLaOrden,
  type DependenciasDeProduccionWeb,
} from "./produccion-web";

/**
 * Lo que agrega la composición a las pantallas de órdenes de producción: la lista blanca de lo que sale por orden (sin ids de depósito, de movimiento ni de lote), que un filtro desconocido no
 * consulta, que el pedido sin la forma pedida no llega al caso de uso, que un error de la orden sale como el genérico y uno inesperado sin detalle. El permiso, el aislamiento y el alcance son
 * de la consulta y del caso de uso: se prueban con la base real en `test/integracion/produccion-web.test.ts`; acá son falsos.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-11-16T12:00:00.000Z"),
};
const ORDEN = "11111111-1111-4111-8111-111111111111";
const SUCURSAL = "22222222-2222-4222-8222-222222222222";
const GENERICO = "PRODUCCION_ACCION_NO_PERMITIDA";

const deLista = (extra: Record<string, unknown> = {}) => ({
  ordenId: ORDEN,
  numero: 14,
  estado: "ABIERTA",
  productoId: "producto-secreto",
  nombre: "Masa de medialuna",
  cantidadEsperada: "10.0000",
  cantidadObtenida: null,
  unidadId: "KILOGRAMO",
  depositoId: "deposito-secreto",
  depositoDestinoId: "deposito-destino-secreto",
  abiertaEn: new Date("2026-11-15T12:00:00.000Z"),
  ...extra,
});

const deFicha = (extra: Record<string, unknown> = {}) => ({
  ordenId: ORDEN,
  numero: 14,
  estado: "CERRADA",
  productoId: "producto-secreto",
  nombre: "Masa de medialuna",
  unidadId: "KILOGRAMO",
  version: 3,
  recetaCambiada: true,
  depositoId: "deposito-secreto",
  depositoDestinoId: "deposito-destino-secreto",
  cantidadEsperada: "10.0000",
  cantidadObtenida: "9.5000",
  mermaDeLote: "0.5000",
  vence: "2026-12-01",
  lote: { loteId: "lote-secreto", codigo: "OP-14" },
  renglones: [
    {
      productoId: "insumo-secreto",
      nombre: "Harina 000",
      esperado: "6.0000",
      real: "6.2000",
      unidadId: "KILOGRAMO",
    },
  ],
  movimientos: {
    consumoId: "mov-secreto",
    productoId: "mov-secreto-2",
    anulacionDeConsumoId: null,
    anulacionDeProductoId: null,
  },
  motivo: "motivo interno",
  abiertaEn: new Date("2026-11-15T12:00:00.000Z"),
  cerradaEn: new Date("2026-11-15T14:00:00.000Z"),
  fechaDeNegocio: "2026-11-15",
  ...extra,
});

function con(
  parcial: Readonly<{
    listar?: (...args: unknown[]) => unknown;
    ficha?: (...args: unknown[]) => unknown;
    cancelar?: (...args: unknown[]) => unknown;
    anular?: (...args: unknown[]) => unknown;
  }> = {},
) {
  const pedidos: unknown[][] = [];
  const registrados: string[] = [];
  const llamar = (f: ((...args: unknown[]) => unknown) | undefined, ...args: unknown[]) => {
    pedidos.push(args);
    return Promise.resolve(f === undefined ? ok({}) : f(...args));
  };
  const d: DependenciasDeProduccionWeb = {
    consultas: () => ({
      listarOrdenes: (...a: unknown[]) => llamar(parcial.listar, ...a),
      fichaDeOrden: (...a: unknown[]) => llamar(parcial.ficha, ...a),
    }),
    casosDeUso: () => ({
      cancelarOrden: (...a: unknown[]) => llamar(parcial.cancelar, ...a),
      anularOrden: (...a: unknown[]) => llamar(parcial.anular, ...a),
    }),
    respuesta: { registrar: (x: string) => registrados.push(x) },
  } as never;
  return { d, pedidos, registrados };
}

describe("lista de órdenes de la web: lo que sale por orden", () => {
  it("nada de más: id, número, estado, nombre, cantidad y unidad", async () => {
    const { d } = con({ listar: () => ok([deLista()]) });
    const r = await listarLasOrdenes(d, contexto, SUCURSAL, { estado: "" });
    expect(r).toEqual({
      ok: true,
      dato: {
        ordenes: [
          {
            id: ORDEN,
            numero: 14,
            estado: "ABIERTA",
            nombre: "Masa de medialuna",
            cantidad: "10.0000",
            unidadId: "KILOGRAMO",
          },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toContain("secreto");
  });

  it("la sucursal la pone el servidor y viaja a la consulta; sin filtro de estado, no hay `estado`", async () => {
    const { d, pedidos } = con({ listar: () => ok([]) });
    await listarLasOrdenes(d, contexto, SUCURSAL, { estado: "" });
    expect(pedidos).toEqual([[contexto, { sucursalId: SUCURSAL }]]);
  });

  it("«Abiertas» filtra por estado en la consulta", async () => {
    const { d, pedidos } = con({ listar: () => ok([]) });
    await listarLasOrdenes(d, contexto, SUCURSAL, { estado: "ABIERTA" });
    expect(pedidos).toEqual([[contexto, { estado: "ABIERTA", sucursalId: SUCURSAL }]]);
  });

  it("un filtro desconocido devuelve la lista vacía sin consultar", async () => {
    const { d, pedidos } = con({ listar: () => ok([deLista()]) });
    const r = await listarLasOrdenes(d, contexto, SUCURSAL, { estado: "CERRADA" });
    expect(r).toEqual({ ok: true, dato: { ordenes: [] } });
    expect(pedidos).toEqual([]);
  });

  it("el rechazo del guard (módulo en desarrollo) sale con su motivo y sin datos", async () => {
    const { d } = con({ listar: () => err("MODULO_EN_DESARROLLO") });
    const r = await listarLasOrdenes(d, contexto, SUCURSAL, { estado: "" });
    expect(r).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
  });

  it("un fallo inesperado sale sin detalle, con referencia, y queda en el registro", async () => {
    const { d, registrados } = con({
      listar: () => {
        throw new Error("detalle interno de la base");
      },
    });
    const r = await listarLasOrdenes(d, contexto, SUCURSAL, { estado: "" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalle interno");
    expect(registrados).toHaveLength(1);
    expect(registrados[0]).toContain("detalle interno de la base");
  });
});

describe("ficha de una orden de la web", () => {
  it("nada de más: sin ids de producto, depósito, movimiento ni lote, sin versión, merma, motivo ni fechas", async () => {
    const { d } = con({ ficha: () => ok(deFicha()) });
    const r = await verLaOrden(d, contexto, { ordenId: ORDEN });
    expect(r).toEqual({
      ok: true,
      dato: {
        id: ORDEN,
        numero: 14,
        estado: "CERRADA",
        nombre: "Masa de medialuna",
        unidadId: "KILOGRAMO",
        cantidadEsperada: "10.0000",
        cantidadObtenida: "9.5000",
        recetaCambiada: true,
        vence: "2026-12-01",
        lote: "OP-14",
        renglones: [
          { nombre: "Harina 000", esperado: "6.0000", real: "6.2000", unidadId: "KILOGRAMO" },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toContain("secreto");
  });

  it("sin lote, `null`", async () => {
    const { d } = con({ ficha: () => ok(deFicha({ lote: null })) });
    const r = await verLaOrden(d, contexto, { ordenId: ORDEN });
    expect(r).toMatchObject({ ok: true, dato: { lote: null } });
  });

  it("el costo sale solo si la consulta lo trajo (con `costos.ver`), tal cual", async () => {
    const costo = { costoUnitario: "123.456789", costoEstado: "DEFINITIVO" };
    const { d } = con({ ficha: () => ok(deFicha({ costo })) });
    const r = await verLaOrden(d, contexto, { ordenId: ORDEN });
    expect(r).toMatchObject({ ok: true, dato: { costo } });
    const sin = await verLaOrden(con({ ficha: () => ok(deFicha()) }).d, contexto, {
      ordenId: ORDEN,
    });
    if (!sin.ok) throw new Error("se esperaba la ficha");
    expect(Object.hasOwn(sin.dato, "costo")).toBe(false);
  });

  it("una orden que no existe, es ajena o está fuera del alcance (la consulta da `null`) sale como el genérico", async () => {
    const { d } = con({ ficha: () => ok(null) });
    const r = await verLaOrden(d, contexto, { ordenId: ORDEN });
    expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
  });

  it("un id sin forma de UUID no llega a la consulta: el genérico", async () => {
    const { d, pedidos } = con({ ficha: () => ok(deFicha()) });
    const r = await verLaOrden(d, contexto, { ordenId: "no-es-un-id" });
    expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(pedidos).toEqual([]);
  });

  it("el rechazo del guard pasa con su motivo", async () => {
    const { d } = con({ ficha: () => err("SIN_PERMISO") });
    const r = await verLaOrden(d, contexto, { ordenId: ORDEN });
    expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
  });
});

describe.each([
  ["cancelar", cancelarLaOrden, "cancelar"],
  ["anular", anularLaOrden, "anular"],
] as const)("%s una orden de la web", (_nombre, accion, caso) => {
  it("pasa el id y el motivo al caso de uso con el contexto del servidor, y devuelve solo `yaEstaba`", async () => {
    const { d, pedidos } = con({ [caso]: () => ok({ yaEstaba: false, interno: "x" }) });
    const r = await accion(d, contexto, { ordenId: ORDEN, motivo: "Se rompió el horno" });
    expect(r).toEqual({ ok: true, dato: { yaEstaba: false } });
    expect(pedidos).toEqual([[contexto, { ordenId: ORDEN, motivo: "Se rompió el horno" }]]);
  });

  it("repetir devuelve `yaEstaba: true`", async () => {
    const { d } = con({ [caso]: () => ok({ yaEstaba: true }) });
    const r = await accion(d, contexto, { ordenId: ORDEN, motivo: "otra vez" });
    expect(r).toEqual({ ok: true, dato: { yaEstaba: true } });
  });

  it("lo que el navegador mande de más (empresa, persona) no llega al caso de uso", async () => {
    const { d, pedidos } = con({ [caso]: () => ok({ yaEstaba: false }) });
    await accion(d, contexto, { ordenId: ORDEN, motivo: "x", empresaId: "otra", personaId: "o" });
    expect(pedidos).toEqual([[contexto, { ordenId: ORDEN, motivo: "x" }]]);
  });

  it("un pedido sin la forma pedida es el genérico y no llega al caso de uso", async () => {
    const { d, pedidos } = con({ [caso]: () => ok({ yaEstaba: false }) });
    for (const crudo of [{ ordenId: ORDEN }, { ordenId: "no", motivo: "x" }, null]) {
      const r = await accion(d, contexto, crudo);
      expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    }
    expect(pedidos).toEqual([]);
  });

  it.each(["ORDEN_YA_CERRADA", "ORDEN_CANCELADA", "PRODUCTO_YA_USADO", "MOTIVO_REQUERIDO"])(
    "el error de la orden %s sale como el genérico",
    async (error) => {
      const { d } = con({ [caso]: () => err(error) });
      const r = await accion(d, contexto, { ordenId: ORDEN, motivo: "x" });
      expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    },
  );

  it("el rechazo del guard pasa con su motivo", async () => {
    const { d } = con({ [caso]: () => err("SIN_PERMISO") });
    const r = await accion(d, contexto, { ordenId: ORDEN, motivo: "x" });
    expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
  });

  it("una excepción sale sin detalle, con referencia, y queda en el registro", async () => {
    const { d, registrados } = con({
      [caso]: () => {
        throw new Error("detalle interno de la base");
      },
    });
    const r = await accion(d, contexto, { ordenId: ORDEN, motivo: "x" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalle interno");
    expect(registrados).toHaveLength(1);
  });
});
