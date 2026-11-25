import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  anularLaRecepcion,
  confirmarLaRecepcion,
  fichaDeLaRecepcion,
  listarLasRecepciones,
  registrarLaRecepcion,
  type DependenciasDeRecepcionesWeb,
} from "../../src/composicion/recepciones-web";
import { nuevoId } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * Compras 4, «Recepciones» por la composición web, con una base real. Los casos de uso (`registrarRecepcion`, `confirmarRecepcion`, `anularRecepcionPendiente`) ya tienen sus pruebas de servidor
 * (`compras-n3-recepcion.test.ts`); ésta prueba lo que agrega la pantalla: la frontera (el pedido tal como lo manda el navegador: SIN precio), la sucursal que pone el servidor, la ficha y la lista
 * con su cursor, y de punta a punta lo que pidió el dueño: IDEMPOTENCIA (el mismo envío dos veces, también a la vez: una recepción; confirmar dos veces, una sola entrada de stock) y CONCURRENCIA
 * (dos confirmaciones a la vez; confirmar y anular a la vez), AISLAMIENTO entre empresas y sucursales y AUTORIZACIÓN en el servidor.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const RONDAS = 3;
const sinPermiso = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: Recepciones", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeRecepcionesWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    d = {
      consultas: () => c.consultas,
      casosDeUso: () => c.casos,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const mundo = async () => {
    const x = await c.escenario();
    const deposito = await c.deposito(x);
    const { producto, articulo } = await c.articulo(x, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(x.operador);
    return { x, m: { deposito, producto, articulo, proveedor } };
  };
  type Montaje = Awaited<ReturnType<typeof mundo>>["m"];

  /** Lo que manda el navegador: 2 kg, sin precio (entran 2000 g al confirmar). */
  const pedido = (m: Montaje, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    proveedorId: m.proveedor,
    renglones: [{ productoId: m.producto, unidadDeCompraId: "KILOGRAMO", cantidad: "2" }],
    ...extra,
  });
  const recibir = (x: EscenarioDeCompras, crudo: unknown, sucursal: string = x.sucursal) =>
    registrarLaRecepcion(d, x.operador, sucursal, crudo);
  const recepciones = (m: Montaje) =>
    c.contar("select count(*) as n from recepcion where proveedor_id = $1", [m.proveedor]);
  const movimientos = (m: Montaje) =>
    c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [m.deposito]);
  const idDe = (r: Awaited<ReturnType<typeof recibir>>): string => {
    if (!r.ok) throw new Error("no se pudo recibir");
    return r.dato.recepcionId;
  };

  it("recibir: queda PENDIENTE y SIN stock, sin precio ni costo, la respuesta no trae nada interno de más y audita", async () => {
    const { x, m } = await mundo();
    const r = await recibir(x, pedido(m));
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    if (!r.ok) return;
    expect(Object.keys(r.dato).sort()).toEqual(["recepcionId", "yaExistia"]);
    expect(await recepciones(m)).toBe(1);
    expect(await movimientos(m)).toBe(0);
    expect(Number(await c.existencia(m.deposito, m.articulo))).toBe(0);
    const linea = (
      await c.filas<{ precio: string | null; costo: string | null }>(
        "select precio::text as precio, costo_por_unidad_de_stock::text as costo from linea_de_recepcion where recepcion_id = $1",
        [r.dato.recepcionId],
      )
    )[0];
    expect(linea).toEqual({ precio: null, costo: null });
    expect((await c.auditoria(x.empresa, "RECEPCION_REGISTRADA")).at(-1)).toMatchObject({
      actor_persona_id: x.personaDelOperador,
      entidad_id: r.dato.recepcionId,
    });
  });

  it("recibir NO acepta precio ni nada que el navegador invente: un renglón con precio, la empresa o la sucursal en el pedido es el genérico y no queda nada", async () => {
    const { x, m } = await mundo();
    const conPrecio = pedido(m, {
      renglones: [
        {
          productoId: m.producto,
          unidadDeCompraId: "KILOGRAMO",
          cantidad: "2",
          precioPor: "UNIDAD",
          unidadDePrecioId: "KILOGRAMO",
          precio: "1000.00",
        },
      ],
    });
    esGenerico(await recibir(x, conPrecio));
    esGenerico(await recibir(x, pedido(m, { empresaId: x.empresa })));
    esGenerico(await recibir(x, pedido(m, { sucursalId: x.otraSucursal })));
    esGenerico(await recibir(x, pedido(m, { renglones: [] })));
    expect(await recepciones(m)).toBe(0);
  });

  it("recibir pone la sucursal del servidor (no la del navegador) y respeta el alcance: sin la sucursal en el alcance, el genérico", async () => {
    const { x, m } = await mundo();
    const r = await recibir(x, pedido(m), x.sucursal);
    const fila = (
      await c.filas<{ sucursal_id: string }>("select sucursal_id from recepcion where id = $1", [
        idDe(r),
      ])
    )[0];
    expect(fila?.sucursal_id).toBe(x.sucursal);
    esGenerico(await recibir(x, pedido(m), x.otraSucursal));
    expect(await recepciones(m)).toBe(1);
  });

  it("I1: el mismo envío dos veces (doble toque, reintento) es UNA recepción y UNA auditoría; la segunda dice yaExistia; el mismo remito con otra clave se rechaza", async () => {
    const { x, m } = await mundo();
    const mismo = pedido(m, {
      remito: { puntoDeVenta: "3", numero: "18842", fecha: "2026-11-24" },
    });
    const primera = await recibir(x, mismo);
    const antes = (await c.auditoria(x.empresa, "RECEPCION_REGISTRADA")).length;
    const segunda = await recibir(x, mismo);
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(idDe(segunda)).toBe(idDe(primera));
    expect(await recepciones(m)).toBe(1);
    expect((await c.auditoria(x.empresa, "RECEPCION_REGISTRADA")).length).toBe(antes);
    expect(await recibir(x, { ...mismo, clave: nuevoId() })).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_REMITO_REPETIDO" },
    });
    expect(await recepciones(m)).toBe(1);
  });

  it("C1: el mismo envío A LA VEZ (dos pestañas): una sola recepción", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const mismo = pedido(m);
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([recibir(x, mismo), recibir(x, mismo)]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of rs) expect(r.ok || JSON.stringify(r).includes("INESPERADO")).toBe(true);
      expect(await recepciones(m)).toBe(1);
    }
  });

  it("confirmar: solo gerente o administrador; entra el stock una vez; el operador recibe «sin permiso» y no cambia nada", async () => {
    const { x, m } = await mundo();
    const id = idDe(await recibir(x, pedido(m)));
    sinPermiso(await confirmarLaRecepcion(d, x.operador, { recepcionId: id }));
    expect(Number(await c.existencia(m.deposito, m.articulo))).toBe(0);
    const r = await confirmarLaRecepcion(d, x.gerente, { recepcionId: id });
    expect(r).toMatchObject({ ok: true, dato: { recepcionId: id, yaExistia: false } });
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
  });

  it("I2: confirmar dos veces deja UNA entrada de stock y la segunda dice yaExistia sin escribir ni auditar", async () => {
    const { x, m } = await mundo();
    const id = idDe(await recibir(x, pedido(m)));
    const primera = await confirmarLaRecepcion(d, x.gerente, { recepcionId: id });
    const antes = (await c.auditoria(x.empresa, "RECEPCION_CONFIRMADA")).length;
    const segunda = await confirmarLaRecepcion(d, x.administrador, { recepcionId: id });
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(await movimientos(m)).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    expect((await c.auditoria(x.empresa, "RECEPCION_CONFIRMADA")).length).toBe(antes);
  });

  it("C2: dos personas confirman la misma recepción a la vez: una sola entrada de stock", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const id = idDe(await recibir(x, pedido(m)));
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          confirmarLaRecepcion(d, x.gerente, { recepcionId: id }),
          confirmarLaRecepcion(d, x.administrador, { recepcionId: id }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
      expect(await movimientos(m)).toBe(1);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    }
  });

  it("C3: confirmar y anular la misma recepción a la vez: gana una sola y el stock queda de acuerdo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const id = idDe(await recibir(x, pedido(m)));
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          confirmarLaRecepcion(d, x.gerente, { recepcionId: id }),
          anularLaRecepcion(d, x.administrador, { recepcionId: id, motivo: "Se cargó dos veces" }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const estado = (
        await c.filas<{ estado: string }>("select estado from recepcion where id = $1", [id])
      )[0]?.estado;
      const existencia = await c.existencia(m.deposito, m.articulo);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(
        (estado === "CONFIRMADA" && existencia === "2000.0000") ||
          (estado === "ANULADA" && Number(existencia) === 0),
      ).toBe(true);
    }
  });

  it("anular: solo una «Por confirmar», con motivo; sin motivo es el genérico y por el operador, «sin permiso»; repetir no escribe", async () => {
    const { x, m } = await mundo();
    const id = idDe(await recibir(x, pedido(m)));
    esGenerico(await anularLaRecepcion(d, x.gerente, { recepcionId: id, motivo: "   " }));
    sinPermiso(
      await anularLaRecepcion(d, x.operador, { recepcionId: id, motivo: "Error de carga" }),
    );
    expect(
      await anularLaRecepcion(d, x.gerente, { recepcionId: id, motivo: "Error de carga" }),
    ).toMatchObject({ ok: true, dato: { anulada: true } });
    esGenerico(await anularLaRecepcion(d, x.gerente, { recepcionId: id, motivo: "Otra vez" }));
    const ficha = await fichaDeLaRecepcion(d, x.operador, x.sucursal, id);
    expect(ficha).toMatchObject({
      ok: true,
      dato: { estado: "ANULADA", motivoDeAnulacion: "Error de carga" },
    });
    esGenerico(await confirmarLaRecepcion(d, x.gerente, { recepcionId: id }));
    expect(await movimientos(m)).toBe(0);
  });

  it("la ficha: el estado derivado, el remito, el proveedor y las líneas con el producto y lo que entra al stock; sin precios ni costos ni personas", async () => {
    const { x, m } = await mundo();
    const id = idDe(
      await recibir(
        x,
        pedido(m, { remito: { puntoDeVenta: "3", numero: "18842", fecha: "2026-11-24" } }),
      ),
    );
    const pendiente = await fichaDeLaRecepcion(d, x.operador, x.sucursal, id);
    expect(pendiente).toMatchObject({
      ok: true,
      dato: {
        recepcionId: id,
        estado: "PENDIENTE_DE_CONFIRMAR",
        remito: { puntoDeVenta: 3, numero: 18842, fecha: "2026-11-24" },
        motivoDeAnulacion: null,
        lineas: [
          {
            numero: 1,
            cantidadDeCompra: "2.0000",
            unidadDeCompraId: "KILOGRAMO",
            cantidadEnStock: "2000.0000",
          },
        ],
      },
    });
    if (!pendiente.ok) return;
    expect(pendiente.dato.proveedor).not.toBeNull();
    expect(Object.keys(pendiente.dato.lineas[0] ?? {}).sort()).toEqual([
      "cantidadDeCompra",
      "cantidadEnStock",
      "numero",
      "producto",
      "unidadDeCompraId",
      "unidadDeStockId",
    ]);
    await confirmarLaRecepcion(d, x.gerente, { recepcionId: id });
    expect(await fichaDeLaRecepcion(d, x.operador, x.sucursal, id)).toMatchObject({
      ok: true,
      dato: { estado: "RECIBIDA_SIN_FACTURAR" },
    });
  });

  it("aislamiento: la ficha de otra empresa, de otra sucursal, de una compra de N1/N2 o con un id inválido es el genérico (indistinguible de que no existe)", async () => {
    const { x, m } = await mundo();
    const otra = await mundo();
    const id = idDe(await recibir(x, pedido(m)));
    esGenerico(await fichaDeLaRecepcion(d, otra.x.gerente, otra.x.sucursal, id));
    esGenerico(await fichaDeLaRecepcion(d, x.gerente, x.otraSucursal, id));
    esGenerico(await fichaDeLaRecepcion(d, x.gerente, x.sucursal, "no-es-un-id"));
    esGenerico(await confirmarLaRecepcion(d, otra.x.gerente, { recepcionId: id }));
    esGenerico(await anularLaRecepcion(d, otra.x.gerente, { recepcionId: id, motivo: "Ajena" }));
    const compra = await c.casos.registrarCompra(x.operador, {
      clave: nuevoId(),
      sucursalId: x.sucursal,
      proveedorId: m.proveedor,
      depositoId: m.deposito,
      renglones: [
        {
          productoId: m.producto,
          unidadDeCompraId: "KILOGRAMO",
          cantidad: "1",
          precioPor: "UNIDAD",
          unidadDePrecioId: "KILOGRAMO",
          precio: "10",
        },
      ],
    });
    if (!compra.ok) throw new Error("la compra de N1/N2 debía registrarse");
    esGenerico(await fichaDeLaRecepcion(d, x.gerente, x.sucursal, compra.valor.recepcionId));
  });

  it("la lista: solo las de la sucursal del servidor (no las de otra sucursal ni de otra empresa), con el nombre del proveedor y su estado; y el cursor abre la segunda página", async () => {
    const { x, m } = await mundo();
    const otra = await mundo();
    await recibir(otra.x, pedido(otra.m));
    await recibir(x, pedido(m), x.sucursal);
    const lista = await listarLasRecepciones(d, x.operador, x.sucursal, {});
    expect(lista).toMatchObject({
      ok: true,
      dato: { recepciones: [{ estado: "PENDIENTE_DE_CONFIRMAR" }], siguiente: null },
    });
    if (!lista.ok) return;
    expect(lista.dato.recepciones).toHaveLength(1);
    expect(lista.dato.recepciones[0]?.proveedor).not.toBeNull();
    esGenerico(await listarLasRecepciones(d, x.operador, x.otraSucursal, {}));
    // 50 por página: con 51 la primera trae el cursor y la segunda la que falta (el cursor de la lista es `AAAA-MM-DD|<uuid>`).
    for (let i = 0; i < 50; i++) await recibir(x, pedido(m));
    const primera = await listarLasRecepciones(d, x.operador, x.sucursal, {});
    if (!primera.ok) throw new Error("la primera página debía leerse");
    expect(primera.dato.recepciones).toHaveLength(50);
    expect(primera.dato.siguiente).not.toBeNull();
    const segunda = await listarLasRecepciones(d, x.operador, x.sucursal, {
      despues: primera.dato.siguiente,
    });
    if (!segunda.ok) throw new Error("la segunda página debía leerse");
    expect(segunda.dato.recepciones).toHaveLength(1);
    expect(segunda.dato.siguiente).toBeNull();
    esGenerico(await listarLasRecepciones(d, x.operador, x.sucursal, { despues: "basura" }));
  });

  it("sin permiso o con la perilla apagada: recibir es el genérico y no deja nada", async () => {
    const { x, m } = await mundo();
    c.apagarPerillas();
    try {
      esGenerico(await recibir(x, pedido(m)));
      expect(await recepciones(m)).toBe(0);
    } finally {
      c.encenderPerilla("recepcion_separada");
    }
  });
});
