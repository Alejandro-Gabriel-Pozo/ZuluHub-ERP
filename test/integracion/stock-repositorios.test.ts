import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { MOTIVOS_DE_MOVIMIENTO } from "../../src/modulos/stock/dominio/motivos";
import {
  llaveDeSaldo,
  type ParDeSaldo,
  type RepositoriosDeStock,
} from "../../src/modulos/stock/publico";
import { sucursalId, type SucursalId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { grupoDeBase, opcionDeBase, productoDeBase } from "./catalogo-apoyo";
import {
  montarStock,
  nombreDeDeposito,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";
import { articuloDeBase, depositoDeBase } from "./stock-apoyo";

/**
 * E5-T3: los repositorios de stock contra la base real y con el rol de la aplicación (RLS forzada): depósitos, artículos, libro con renglones y
 * saldos, conteos, composiciones y el lector del catálogo. Cada método que usan los casos de uso de los tramos siguientes (movimientos,
 * conteos, composiciones y puertos de venta) tiene su prueba acá, y las restricciones de la base salen como errores tipados que traduce
 * `ERRORES_DE_STOCK_POR_RESTRICCION`. Cada prueba usa depósitos y artículos propios.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Repos = Pick<
  RepositoriosDeStock,
  | "depositos"
  | "articulosDeStock"
  | "movimientosDeStock"
  | "conteosDeStock"
  | "composicionesDeStock"
  | "productosParaStock"
>;

describe.skipIf(base === null)("stock: repositorios de la persistencia", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const empresa = () => e.empresaId;
  /** Corre `trabajo` en una transacción del rol real de la aplicación (RLS) con el contexto dado; un error de la base vuelve como dato. */
  const enTx = async <T>(
    trabajo: (tx: Repos) => Promise<T>,
    contexto: ContextoOperativo = e.gerente,
  ) => c.entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));
  const leer = async <T>(trabajo: (tx: Repos) => Promise<T>, contexto = e.gerente) =>
    valorDe(await enTx(trabajo, contexto));
  const m = () => ({ empresa: e.empresa, sucursal: e.sucursal });
  const nuevoDeposito = (extra: Parameters<typeof depositoDeBase>[2] = {}) =>
    depositoDeBase(c.dueno, m(), extra);
  const nuevoArticulo = (extra: Parameters<typeof articuloDeBase>[2] = {}) =>
    articuloDeBase(c.dueno, m(), extra);
  const entradaDe = (
    depositoId: string,
    articuloId: string,
    cantidad: string,
    extra: { hechoEn?: Date; clave?: string } = {},
  ) =>
    leer((tx) =>
      tx.movimientosDeStock.registrar(
        empresa(),
        {
          clase: "ENTRADA",
          motivo: "COMPRA",
          detalle: null,
          origenTipo: "MANUAL",
          origenId: null,
          depositoId,
          accion: "stock.registrar_entrada",
          anulaA: null,
          conteoId: null,
          clave: extra.clave ?? `clave-${randomUUID()}`,
          huella: "a".repeat(64),
          hechoEn: extra.hechoEn ?? e.gerente.ahora,
          fechaDeNegocio: null,
          registradoPor: e.personaDelGerente,
        },
        [{ depositoId, articuloId, cantidad, composicionId: null, confirmoNegativo: false }],
      ),
    );
  const salidaDe = (
    depositoId: string,
    articuloId: string,
    cantidad: string,
    extra: { hechoEn?: Date; origen?: { tipo: string; id: string }; fecha?: string } = {},
  ) =>
    enTx((tx) =>
      tx.movimientosDeStock.registrar(
        empresa(),
        {
          clase: "SALIDA",
          motivo: extra.origen === undefined ? "MERMA" : "VENTA",
          detalle: null,
          origenTipo: extra.origen?.tipo ?? "MANUAL",
          origenId: extra.origen?.id ?? null,
          depositoId,
          accion: "stock.registrar_salida",
          anulaA: null,
          conteoId: null,
          clave: `clave-${randomUUID()}`,
          huella: "b".repeat(64),
          hechoEn: extra.hechoEn ?? e.gerente.ahora,
          fechaDeNegocio: extra.fecha ?? null,
          registradoPor: e.personaDelGerente,
        },
        [
          {
            depositoId,
            articuloId,
            cantidad: `-${cantidad}`,
            composicionId: null,
            confirmoNegativo: false,
          },
        ],
      ),
    );

  // =============================================================================================
  describe("depósitos", () => {
    it("insertar es idempotente por id (true/false), obtener y bloquear leen la fila, y un id que no es uuid o de otra empresa no existe", async () => {
      const id = nuevoId();
      const alta = {
        id,
        sucursalId: e.sucursal,
        nombre: "Cocina fría",
        nombreClave: "cocina fría",
        uso: "NORMAL" as const,
        deVenta: false,
      };
      expect(await leer((tx) => tx.depositos.insertar(empresa(), alta))).toBe(true);
      expect(await leer((tx) => tx.depositos.insertar(empresa(), alta))).toBe(false);
      const guardado = await leer((tx) => tx.depositos.obtener(empresa(), id));
      expect(guardado).toEqual({
        id,
        empresaId: e.empresa,
        sucursalId: e.sucursal,
        nombre: "Cocina fría",
        nombreClave: "cocina fría",
        uso: "NORMAL",
        deVenta: false,
        activo: true,
        version: 1,
      });
      expect(await leer((tx) => tx.depositos.bloquear(empresa(), id))).toEqual(guardado);
      expect(await leer((tx) => tx.depositos.obtener(empresa(), "no-es-un-uuid"))).toBeNull();
      expect(await leer((tx) => tx.depositos.bloquear(empresa(), "no-es-un-uuid"))).toBeNull();
      expect(await leer((tx) => tx.depositos.obtener(empresa(), nuevoId()))).toBeNull();
      const otra = await c.escenario();
      expect(await leer((tx) => tx.depositos.obtener(otra.empresaId, id), otra.gerente)).toBeNull();
      expect(await leer((tx) => tx.depositos.obtener(empresa(), id), otra.gerente)).toBeNull();
    });

    it("un nombre repetido y un segundo «de venta» salen como errores de unicidad de la base, no como «ya existía»", async () => {
      const sucursal = sucursalId(
        (
          await c.dueno.query<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
            [e.empresa, nombreDeDeposito("Sucursal")],
          )
        ).rows[0]?.id as string,
      );
      const alta = (extra: Record<string, unknown> = {}) => ({
        id: nuevoId(),
        sucursalId: sucursal,
        nombre: "Uno",
        nombreClave: "uno",
        uso: "NORMAL" as const,
        deVenta: true,
        ...extra,
      });
      expect(await leer((tx) => tx.depositos.insertar(empresa(), alta()))).toBe(true);
      expect(
        await enTx((tx) =>
          tx.depositos.insertar(empresa(), alta({ nombre: "Dos", nombreClave: "dos" })),
        ),
      ).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "deposito_de_venta_uk" },
      });
      expect(
        await enTx((tx) => tx.depositos.insertar(empresa(), alta({ deVenta: false }))),
      ).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "deposito_nombre_uk" },
      });
    });

    it("actualizar cambia nombre y de venta con control de versión (null si ya no es esa); cambiarActivo; deVentaDe solo da el activo", async () => {
      const sucursal = sucursalId(
        (
          await c.dueno.query<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
            [e.empresa, nombreDeDeposito("Sucursal")],
          )
        ).rows[0]?.id as string,
      );
      const id = await nuevoDeposito({ sucursal });
      expect(await leer((tx) => tx.depositos.deVentaDe(empresa(), sucursal))).toBeNull();
      const cambiado = await leer((tx) =>
        tx.depositos.actualizar(empresa(), id, 1, {
          nombre: "Nuevo nombre",
          nombreClave: "nuevo nombre",
          deVenta: true,
        }),
      );
      expect(cambiado).toMatchObject({ nombre: "Nuevo nombre", deVenta: true, version: 2 });
      expect(
        await leer((tx) =>
          tx.depositos.actualizar(empresa(), id, 1, {
            nombre: "X",
            nombreClave: "x",
            deVenta: false,
          }),
        ),
      ).toBeNull();
      expect((await leer((tx) => tx.depositos.deVentaDe(empresa(), sucursal)))?.id).toBe(id);
      // De venta y activo van juntos (CHECK de la base): para desactivarlo primero deja de serlo.
      await leer((tx) =>
        tx.depositos.actualizar(empresa(), id, 2, {
          nombre: "Nuevo nombre",
          nombreClave: "nuevo nombre",
          deVenta: false,
        }),
      );
      expect((await leer((tx) => tx.depositos.cambiarActivo(empresa(), id, false)))?.activo).toBe(
        false,
      );
      expect(
        await leer((tx) => tx.depositos.cambiarActivo(empresa(), nuevoId(), false)),
      ).toBeNull();
      expect((await leer((tx) => tx.depositos.obtener(empresa(), id)))?.activo).toBe(false);
    });

    it("listar respeta el alcance (todas, una lista, ninguna), filtra por sucursal y por activos, y ordena por sucursal y nombre", async () => {
      const otra = await c.escenario();
      const propio = { empresa: otra.empresa, sucursal: otra.sucursal };
      const dos = { empresa: otra.empresa, sucursal: otra.otraSucursal };
      const b = await depositoDeBase(c.dueno, propio, { nombre: "Barra" });
      const a = await depositoDeBase(c.dueno, propio, { nombre: "Alacena" });
      const i = await depositoDeBase(c.dueno, propio, { nombre: "Inactivo", activo: false });
      const f = await depositoDeBase(c.dueno, dos, { nombre: "Fría", uso: "RECHAZO" });
      const ids = async (filtro: Parameters<Repos["depositos"]["listar"]>[1]) =>
        (await leer((tx) => tx.depositos.listar(otra.empresaId, filtro), otra.gerente)).map(
          (d) => d.id,
        );
      const todos = await ids({ alcance: "TODAS" });
      expect([...todos].sort()).toEqual([a, b, i, f].sort());
      // Por sucursal, ordenados por nombre; la otra sucursal ordena aparte.
      expect(await ids({ alcance: "TODAS", sucursalId: otra.sucursal })).toEqual([a, b, i]);
      expect(await ids({ alcance: "TODAS", sucursalId: otra.sucursal, soloActivos: true })).toEqual(
        [a, b],
      );
      expect(await ids({ alcance: [otra.otraSucursal] })).toEqual([f]);
      expect(await ids({ alcance: [otra.otraSucursal], sucursalId: otra.sucursal })).toEqual([]);
      expect(await ids({ alcance: [] })).toEqual([]);
      expect(await ids({ alcance: [] as readonly SucursalId[], soloActivos: true })).toEqual([]);
    });
  });

  // =============================================================================================
  describe("artículos", () => {
    it("insertar guarda la unidad y la dimensión (el id lo genera la base); porProducto, porIds y porProductos los leen; cambiarActivo", async () => {
      const producto = await productoDeBase(c.dueno, e.empresa, {
        clase: "MATERIA_PRIMA",
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
      });
      const creado = await leer((tx) =>
        tx.articulosDeStock.insertar(empresa(), {
          productoId: producto,
          unidadDeStockId: "KILOGRAMO",
          dimension: "MASA",
        }),
      );
      expect(creado).toMatchObject({
        productoId: producto,
        unidadDeStockId: "KILOGRAMO",
        dimension: "MASA",
        activo: true,
        version: 1,
      });
      const lee = <T>(f: (tx: Repos["articulosDeStock"]) => Promise<T>) =>
        leer((tx) => f(tx.articulosDeStock));
      expect(await lee((r) => r.obtener(empresa(), creado.id))).toEqual(creado);
      expect(await lee((r) => r.porProducto(empresa(), producto))).toEqual(creado);
      expect(await lee((r) => r.bloquearPorProducto(empresa(), producto))).toEqual(creado);
      expect(await lee((r) => r.obtener(empresa(), "no-es-un-uuid"))).toBeNull();
      expect(await lee((r) => r.porProducto(empresa(), "no-es-un-uuid"))).toBeNull();
      expect(await lee((r) => r.bloquearPorProducto(empresa(), nuevoId()))).toBeNull();
      const otro = await nuevoArticulo();
      expect(
        await lee((r) => r.porIds(empresa(), [creado.id, otro.articulo, nuevoId(), "x"])),
      ).toEqual(expect.arrayContaining([creado]));
      expect(
        (await lee((r) => r.porIds(empresa(), [creado.id, otro.articulo, nuevoId(), "x"])))
          .map((a) => a.id)
          .sort(),
      ).toEqual([creado.id, otro.articulo].sort());
      expect(
        (await lee((r) => r.porProductos(empresa(), [producto, otro.producto, nuevoId(), "x"])))
          .map((a) => a.productoId)
          .sort(),
      ).toEqual([producto, otro.producto].sort());
      expect(await lee((r) => r.porIds(empresa(), []))).toEqual([]);
      expect(await lee((r) => r.porIds(empresa(), ["x"]))).toEqual([]);
      expect(await lee((r) => r.porProductos(empresa(), []))).toEqual([]);
      expect((await lee((r) => r.cambiarActivo(empresa(), creado.id, false)))?.activo).toBe(false);
      expect(await lee((r) => r.cambiarActivo(empresa(), nuevoId(), false))).toBeNull();
      const otra = await c.escenario();
      expect(
        await leer((tx) => tx.articulosDeStock.obtener(otra.empresaId, creado.id), otra.gerente),
      ).toBeNull();
    });

    it("un segundo artículo del mismo producto choca con la única, y la unidad que no es la base la frena la base (la clase no controlable la frena el caso de uso desde E6)", async () => {
      const { producto } = await nuevoArticulo();
      expect(
        await enTx((tx) =>
          tx.articulosDeStock.insertar(empresa(), {
            productoId: producto,
            unidadDeStockId: "UNIDAD",
            dimension: "CONTEO",
          }),
        ),
      ).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "articulo_de_stock_producto_uk" },
      });
      const vendible = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      expect(
        await enTx((tx) =>
          tx.articulosDeStock.insertar(empresa(), {
            productoId: vendible,
            unidadDeStockId: "UNIDAD",
            dimension: "CONTEO",
          }),
        ),
      ).toMatchObject({ ok: true }); // E6 (0032): la base admite el vendible; lo cierra el caso de uso (`CLASE_NO_CONTROLABLE`)
      const kilos = await productoDeBase(c.dueno, e.empresa, {
        clase: "INSUMO",
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
      });
      expect(
        await enTx((tx) =>
          tx.articulosDeStock.insertar(empresa(), {
            productoId: kilos,
            unidadDeStockId: "GRAMO",
            dimension: "MASA",
          }),
        ),
      ).toEqual({
        ok: false,
        error: { tipo: "Referencia", restriccion: "articulo_de_stock_producto_unidad_fkey" },
      });
    });
  });

  // =============================================================================================
  describe("movimientos y saldos", () => {
    it("registrar escribe cabecera y renglones y devuelve la cabecera con su fecha de negocio (texto) y el instante de la base; la lectura por id, clave, renglones y motivos", async () => {
      const deposito = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      const clave = `clave-${randomUUID()}`;
      const movimiento = await entradaDe(deposito, articulo, "7.5", { clave });
      expect(movimiento).toMatchObject({
        clase: "ENTRADA",
        motivo: "COMPRA",
        detalle: null,
        origenTipo: "MANUAL",
        origenId: null,
        depositoId: deposito,
        accion: "stock.registrar_entrada",
        anulaA: null,
        conteoId: null,
        clave,
        huella: "a".repeat(64),
        fechaDeNegocio: "2026-10-11",
        registradoPor: e.personaDelGerente,
      });
      expect(movimiento.hechoEn).toEqual(e.gerente.ahora);
      expect(movimiento.registradoEn).toBeInstanceOf(Date);
      expect(await leer((tx) => tx.movimientosDeStock.obtener(empresa(), movimiento.id))).toEqual(
        movimiento,
      );
      expect(await leer((tx) => tx.movimientosDeStock.porClave(empresa(), clave))).toEqual(
        movimiento,
      );
      expect(
        await leer((tx) => tx.movimientosDeStock.porClave(empresa(), "clave-inexistente")),
      ).toBeNull();
      expect(
        await leer((tx) => tx.movimientosDeStock.obtener(empresa(), "no-es-un-uuid")),
      ).toBeNull();
      expect(
        await leer((tx) => tx.movimientosDeStock.renglonesDe(empresa(), movimiento.id)),
      ).toEqual([
        {
          numero: 1,
          depositoId: deposito,
          articuloId: articulo,
          cantidad: "7.5000",
          composicionId: null,
          confirmoNegativo: false,
        },
      ]);
      expect(await leer((tx) => tx.movimientosDeStock.renglonesDe(empresa(), "x"))).toEqual([]);
      // La misma clave en otra empresa no se ve; la de esta empresa tampoco desde la otra.
      const otra = await c.escenario();
      expect(
        await leer((tx) => tx.movimientosDeStock.porClave(otra.empresaId, clave), otra.gerente),
      ).toBeNull();
      expect(
        await leer(
          (tx) => tx.movimientosDeStock.obtener(otra.empresaId, movimiento.id),
          otra.gerente,
        ),
      ).toBeNull();
      // Los motivos sembrados son los del dominio.
      expect(
        (await leer((tx) => tx.movimientosDeStock.motivos())).map(
          ({ clase, codigo, entraConCosto, entregaMercaderia }) => ({
            clase,
            codigo,
            entraConCosto,
            entregaMercaderia,
          }),
        ),
      ).toEqual(
        [...MOTIVOS_DE_MOVIMIENTO].sort((a, b) =>
          a.clase === b.clase ? (a.codigo < b.codigo ? -1 : 1) : a.clase < b.clase ? -1 : 1,
        ),
      );
    });

    it("una clave repetida, un anulado dos veces y una salida sin depósito salen como errores de la base que traduce el esquema", async () => {
      const deposito = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      const clave = `clave-${randomUUID()}`;
      const original = await entradaDe(deposito, articulo, "3", { clave });
      expect(
        await enTx((tx) =>
          tx.movimientosDeStock.registrar(
            empresa(),
            {
              clase: "ENTRADA",
              motivo: "COMPRA",
              detalle: null,
              origenTipo: "MANUAL",
              origenId: null,
              depositoId: deposito,
              accion: "stock.registrar_entrada",
              anulaA: null,
              conteoId: null,
              clave,
              huella: "c".repeat(64),
              hechoEn: e.gerente.ahora,
              fechaDeNegocio: null,
              registradoPor: e.personaDelGerente,
            },
            [
              {
                depositoId: deposito,
                articuloId: articulo,
                cantidad: "1",
                composicionId: null,
                confirmoNegativo: false,
              },
            ],
          ),
        ),
      ).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "movimiento_de_stock_clave_uk" },
      });
      const anular = () =>
        enTx((tx) =>
          tx.movimientosDeStock.registrar(
            empresa(),
            {
              clase: "ANULACION",
              motivo: "ANULACION",
              detalle: "Se cargó por error",
              origenTipo: "MANUAL",
              origenId: null,
              depositoId: deposito,
              accion: "stock.anular",
              anulaA: original.id,
              conteoId: null,
              clave: `clave-${randomUUID()}`,
              huella: "d".repeat(64),
              hechoEn: e.gerente.ahora,
              fechaDeNegocio: null,
              registradoPor: e.personaDelGerente,
            },
            [
              {
                depositoId: deposito,
                articuloId: articulo,
                cantidad: "-3",
                composicionId: null,
                confirmoNegativo: false,
              },
            ],
          ),
        );
      const espejo = valorDe(await anular());
      expect(espejo).toMatchObject({ clase: "ANULACION", anulaA: original.id });
      expect(await anular()).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "movimiento_de_stock_anula_a_uk" },
      });
      expect(await leer((tx) => tx.movimientosDeStock.anulacionDe(empresa(), original.id))).toEqual(
        espejo,
      );
      expect(
        await leer((tx) => tx.movimientosDeStock.anulacionDe(empresa(), espejo.id)),
      ).toBeNull();
      expect(await leer((tx) => tx.movimientosDeStock.anulacionDe(empresa(), "x"))).toBeNull();
      // El espejo dejó el saldo en cero.
      const saldos = await leer((tx) =>
        tx.movimientosDeStock.leerSaldos(
          empresa(),
          [{ depositoId: deposito, articuloId: articulo }],
          false,
        ),
      );
      expect(saldos.get(llaveDeSaldo(deposito, articulo))).toBe("0.0000");
    });

    it("la salida por venta trae la fecha de negocio del ticket y su origen; porOrigen y delOrigen la encuentran (una por ejemplar) junto con su anulación", async () => {
      const deposito = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      await entradaDe(deposito, articulo, "10");
      const ejemplar = nuevoId();
      const venta = valorDe(
        await salidaDe(deposito, articulo, "2", {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
          fecha: "2026-10-05",
        }),
      );
      expect(venta).toMatchObject({
        clase: "SALIDA",
        motivo: "VENTA",
        origenTipo: "EJEMPLAR_DE_TICKET",
        origenId: ejemplar,
        fechaDeNegocio: "2026-10-05",
      });
      expect(
        await leer((tx) =>
          tx.movimientosDeStock.porOrigen(empresa(), "SALIDA", "EJEMPLAR_DE_TICKET", ejemplar),
        ),
      ).toEqual(venta);
      expect(
        await leer((tx) =>
          tx.movimientosDeStock.porOrigen(empresa(), "ENTRADA", "EJEMPLAR_DE_TICKET", ejemplar),
        ),
      ).toBeNull();
      expect(
        await leer((tx) =>
          tx.movimientosDeStock.porOrigen(empresa(), "SALIDA", "EJEMPLAR_DE_TICKET", "x"),
        ),
      ).toBeNull();
      // Una segunda salida del mismo ejemplar, aunque cambie la clave, choca con el único de origen.
      expect(
        await salidaDe(deposito, articulo, "1", {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
          fecha: "2026-10-05",
        }),
      ).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "movimiento_de_stock_origen_uk" },
      });
      const espejo = valorDe(
        await enTx((tx) =>
          tx.movimientosDeStock.registrar(
            empresa(),
            {
              clase: "ANULACION",
              motivo: "ANULACION",
              detalle: "Cuenta anulada",
              origenTipo: "EJEMPLAR_DE_TICKET",
              origenId: ejemplar,
              depositoId: deposito,
              accion: "ventas.anular",
              anulaA: venta.id,
              conteoId: null,
              clave: `anulacion_venta_${ejemplar}`,
              huella: "e".repeat(64),
              hechoEn: new Date("2026-10-12T15:00:00Z"),
              fechaDeNegocio: null,
              registradoPor: e.personaDelGerente,
            },
            [
              {
                depositoId: deposito,
                articuloId: articulo,
                cantidad: "2",
                composicionId: null,
                confirmoNegativo: false,
              },
            ],
          ),
        ),
      );
      const delOrigen = await leer((tx) =>
        tx.movimientosDeStock.delOrigen(empresa(), "EJEMPLAR_DE_TICKET", ejemplar),
      );
      expect(delOrigen.map((x) => x.id)).toEqual([venta.id, espejo.id]);
      expect(
        await leer((tx) => tx.movimientosDeStock.delOrigen(empresa(), "EJEMPLAR_DE_TICKET", "x")),
      ).toEqual([]);
      expect(
        await leer((tx) =>
          tx.movimientosDeStock.delOrigen(empresa(), "EJEMPLAR_DE_TICKET", nuevoId()),
        ),
      ).toEqual([]);
    });

    it("leerSaldos devuelve la existencia de lo que ya se movió (lo demás no figura) y con bloquear toma el bloqueo en orden; una transferencia mueve entre dos depósitos", async () => {
      const origen = await nuevoDeposito();
      const destino = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      const sinMovimientos = await nuevoArticulo();
      await entradaDe(origen, articulo, "10");
      const transferencia = valorDe(
        await enTx((tx) =>
          tx.movimientosDeStock.registrar(
            empresa(),
            {
              clase: "TRANSFERENCIA",
              motivo: "TRANSFERENCIA",
              detalle: null,
              origenTipo: "MANUAL",
              origenId: null,
              depositoId: origen,
              accion: "stock.transferir",
              anulaA: null,
              conteoId: null,
              clave: `clave-${randomUUID()}`,
              huella: "f".repeat(64),
              hechoEn: e.gerente.ahora,
              fechaDeNegocio: null,
              registradoPor: e.personaDelGerente,
            },
            [
              {
                depositoId: origen,
                articuloId: articulo,
                cantidad: "-4",
                composicionId: null,
                confirmoNegativo: false,
              },
              {
                depositoId: destino,
                articuloId: articulo,
                cantidad: "4",
                composicionId: null,
                confirmoNegativo: false,
              },
            ],
          ),
        ),
      );
      expect(transferencia.clase).toBe("TRANSFERENCIA");
      expect(
        (await leer((tx) => tx.movimientosDeStock.renglonesDe(empresa(), transferencia.id))).map(
          (r) => [r.numero, r.depositoId, r.cantidad],
        ),
      ).toEqual([
        [1, origen, "-4.0000"],
        [2, destino, "4.0000"],
      ]);
      const pares: ParDeSaldo[] = [
        { depositoId: destino, articuloId: articulo },
        { depositoId: origen, articuloId: articulo },
        { depositoId: origen, articuloId: sinMovimientos.articulo },
        { depositoId: origen, articuloId: articulo },
        { depositoId: "x", articuloId: articulo },
      ];
      for (const bloquear of [false, true]) {
        const saldos = await leer((tx) =>
          tx.movimientosDeStock.leerSaldos(empresa(), pares, bloquear),
        );
        expect([...saldos.entries()].sort()).toEqual(
          [
            [llaveDeSaldo(origen, articulo), "6.0000"],
            [llaveDeSaldo(destino, articulo), "4.0000"],
          ].sort(),
        );
      }
      expect((await leer((tx) => tx.movimientosDeStock.leerSaldos(empresa(), [], true))).size).toBe(
        0,
      );
    });

    it("el libro de un artículo en un depósito va por fecha de negocio con el saldo corrido desde el principio, entre fechas y paginado por cursor", async () => {
      const deposito = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      // A las 02:00Z del 12 es todavía el 11 en Argentina (UTC-3): la jornada es la del 11.
      const primero = await entradaDe(deposito, articulo, "10", {
        hechoEn: new Date("2026-10-12T02:00:00Z"),
      });
      const segundo = valorDe(
        await salidaDe(deposito, articulo, "3", { hechoEn: new Date("2026-10-12T15:00:00Z") }),
      );
      const tercero = await entradaDe(deposito, articulo, "1.5", {
        hechoEn: new Date("2026-10-14T15:00:00Z"),
      });
      expect([primero.fechaDeNegocio, segundo.fechaDeNegocio, tercero.fechaDeNegocio]).toEqual([
        "2026-10-11",
        "2026-10-12",
        "2026-10-14",
      ]);
      const libro = (
        filtro: Partial<Parameters<Repos["movimientosDeStock"]["libroDeArticulo"]>[1]> = {},
      ) =>
        leer((tx) =>
          tx.movimientosDeStock.libroDeArticulo(empresa(), {
            articuloId: articulo,
            depositoId: deposito,
            desde: "2026-10-01",
            hasta: "2026-10-31",
            limite: 50,
            ...filtro,
          }),
        );
      const todo = await libro();
      expect(todo.map((f) => [f.movimientoId, f.fechaDeNegocio, f.cantidad, f.saldo])).toEqual([
        [primero.id, "2026-10-11", "10.0000", "10.0000"],
        [segundo.id, "2026-10-12", "-3.0000", "7.0000"],
        [tercero.id, "2026-10-14", "1.5000", "8.5000"],
      ]);
      expect(todo[0]).toMatchObject({
        numero: 1,
        clase: "ENTRADA",
        motivo: "COMPRA",
        origenTipo: "MANUAL",
        origenId: null,
        detalle: null,
        registradoPor: e.personaDelGerente,
        composicionId: null,
        composicionNumero: null,
        anuladoPor: null,
      });
      expect(todo[0]?.hechoEn).toEqual(new Date("2026-10-12T02:00:00Z"));
      expect(todo[0]?.registradoEn).toBeInstanceOf(Date);
      // Entre fechas: el saldo sigue contando lo anterior; los extremos entran.
      expect(
        (await libro({ desde: "2026-10-12", hasta: "2026-10-12" })).map((f) => [
          f.movimientoId,
          f.saldo,
        ]),
      ).toEqual([[segundo.id, "7.0000"]]);
      expect(
        (await libro({ desde: "2026-10-12", hasta: "2026-10-14" })).map((f) => f.saldo),
      ).toEqual(["7.0000", "8.5000"]);
      expect(await libro({ desde: "2026-11-01", hasta: "2026-11-30" })).toEqual([]);
      // Por cursor, de a uno.
      const pagina1 = await libro({ limite: 1 });
      expect(pagina1.map((f) => f.movimientoId)).toEqual([primero.id]);
      const cursor = (f: (typeof todo)[number]) => ({
        fechaDeNegocio: f.fechaDeNegocio,
        hechoEn: f.hechoEn,
        movimientoId: f.movimientoId,
        numero: f.numero,
      });
      const pagina2 = await libro({
        limite: 1,
        despuesDe: cursor(pagina1[0] as (typeof todo)[number]),
      });
      expect(pagina2.map((f) => f.movimientoId)).toEqual([segundo.id]);
      const pagina3 = await libro({
        limite: 5,
        despuesDe: cursor(pagina2[0] as (typeof todo)[number]),
      });
      expect(pagina3.map((f) => f.movimientoId)).toEqual([tercero.id]);
      // Otro depósito, un id que no es uuid o el libro de otra empresa: vacío.
      expect(await libro({ depositoId: await nuevoDeposito() })).toEqual([]);
      expect(await libro({ articuloId: "x" })).toEqual([]);
      const otra = await c.escenario();
      expect(
        await leer(
          (tx) =>
            tx.movimientosDeStock.libroDeArticulo(otra.empresaId, {
              articuloId: articulo,
              depositoId: deposito,
              desde: "2026-10-01",
              hasta: "2026-10-31",
              limite: 50,
            }),
          otra.gerente,
        ),
      ).toEqual([]);
    });

    it("el libro marca el movimiento anulado y la versión de composición de la que salió un renglón", async () => {
      const deposito = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      const entrada = await entradaDe(deposito, articulo, "4");
      const vendible = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      const version = await leer((tx) =>
        tx.composicionesDeStock.insertarVersion(empresa(), {
          productoId: vendible,
          numero: 1,
          rinde: "1",
          creadaPor: e.personaDelGerente,
          creadaEn: e.gerente.ahora,
          componentes: [
            { articuloId: articulo, cantidad: "1", unidadId: "UNIDAD", dimension: "CONTEO" },
          ],
        }),
      );
      const venta = valorDe(
        await enTx((tx) =>
          tx.movimientosDeStock.registrar(
            empresa(),
            {
              clase: "SALIDA",
              motivo: "VENTA",
              detalle: null,
              origenTipo: "EJEMPLAR_DE_TICKET",
              origenId: nuevoId(),
              depositoId: deposito,
              accion: "ventas.cerrar_cuenta",
              anulaA: null,
              conteoId: null,
              clave: `clave-${randomUUID()}`,
              huella: "9".repeat(64),
              hechoEn: e.gerente.ahora,
              fechaDeNegocio: "2026-10-11",
              registradoPor: e.personaDelGerente,
            },
            [
              {
                depositoId: deposito,
                articuloId: articulo,
                cantidad: "-1",
                composicionId: version.id,
                confirmoNegativo: false,
              },
            ],
          ),
        ),
      );
      const anulacion = await leer((tx) =>
        tx.movimientosDeStock.registrar(
          empresa(),
          {
            clase: "ANULACION",
            motivo: "ANULACION",
            detalle: "Cuenta anulada",
            origenTipo: "MANUAL",
            origenId: null,
            depositoId: deposito,
            accion: "stock.anular",
            anulaA: venta.id,
            conteoId: null,
            clave: `clave-${randomUUID()}`,
            huella: "8".repeat(64),
            hechoEn: e.gerente.ahora,
            fechaDeNegocio: null,
            registradoPor: e.personaDelGerente,
          },
          [
            {
              depositoId: deposito,
              articuloId: articulo,
              cantidad: "1",
              composicionId: version.id,
              confirmoNegativo: false,
            },
          ],
        ),
      );
      const libro = await leer((tx) =>
        tx.movimientosDeStock.libroDeArticulo(empresa(), {
          articuloId: articulo,
          depositoId: deposito,
          desde: "2026-10-01",
          hasta: "2026-10-31",
          limite: 50,
        }),
      );
      const porId = new Map(libro.map((f) => [f.movimientoId, f]));
      expect(porId.get(entrada.id)?.anuladoPor).toBeNull();
      expect(porId.get(venta.id)).toMatchObject({
        anuladoPor: anulacion.id,
        composicionId: version.id,
        composicionNumero: 1,
        motivo: "VENTA",
      });
      expect(porId.get(anulacion.id)).toMatchObject({ composicionNumero: 1, anuladoPor: null });
      expect(libro.at(-1)?.saldo).toBe("4.0000");
    });

    it("existencias une saldo, artículo, producto y depósito; filtra por depósito, sucursal, texto y negativas, respeta el alcance y se pagina por cursor", async () => {
      const otra = await c.escenario();
      const propio = { empresa: otra.empresa, sucursal: otra.sucursal };
      const dos = { empresa: otra.empresa, sucursal: otra.otraSucursal };
      const fria = await depositoDeBase(c.dueno, propio, { nombre: "Fría" });
      const lejana = await depositoDeBase(c.dueno, dos, { nombre: "Lejana", uso: "CUARENTENA" });
      const harina = await articuloDeBase(c.dueno, propio, {
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
      });
      const leche = await articuloDeBase(c.dueno, propio, {
        unidadBase: "LITRO",
        dimension: "VOLUMEN",
      });
      await c.dueno.query(
        "update producto set nombre = 'Harina 000', nombre_clave = 'harina 000' where id = $1",
        [harina.producto],
      );
      await c.dueno.query(
        "update producto set nombre = 'Leche entera', nombre_clave = 'leche entera' where id = $1",
        [leche.producto],
      );
      const registrar = (
        deposito: string,
        articulo: string,
        cantidad: string,
        clase: "ENTRADA" | "SALIDA" | "AJUSTE",
      ) =>
        c.entorno.ejecutar({ contexto: otra.gerente }, async (tx) =>
          ok(
            await tx.movimientosDeStock.registrar(
              otra.empresaId,
              {
                clase,
                motivo: { ENTRADA: "COMPRA", SALIDA: "MERMA", AJUSTE: "CORRECCION" }[clase],
                detalle: clase === "AJUSTE" ? "Existencia inicial" : null,
                origenTipo: "MANUAL",
                origenId: null,
                depositoId: deposito,
                accion: "stock.registrar_entrada",
                anulaA: null,
                conteoId: null,
                clave: `clave-${randomUUID()}`,
                huella: "7".repeat(64),
                hechoEn: otra.gerente.ahora,
                fechaDeNegocio: null,
                registradoPor: otra.personaDelGerente,
              },
              [
                {
                  depositoId: deposito,
                  articuloId: articulo,
                  cantidad: clase === "SALIDA" ? `-${cantidad}` : cantidad,
                  composicionId: null,
                  confirmoNegativo: false,
                },
              ],
            ),
          ),
        );
      valorDe(await registrar(fria, harina.articulo, "12.5", "ENTRADA"));
      valorDe(await registrar(fria, leche.articulo, "3", "SALIDA")); // sin existencia: queda en -3 (PERMITIR por defecto)
      // La cuarentena no recibe entradas (solo transferencia, ajuste o anulación): se carga con un ajuste.
      valorDe(await registrar(lejana, harina.articulo, "1", "AJUSTE"));
      const existencias = (
        filtro: Partial<Parameters<Repos["movimientosDeStock"]["existencias"]>[1]> = {},
      ) =>
        leer(
          (tx) =>
            tx.movimientosDeStock.existencias(otra.empresaId, {
              alcance: "TODAS",
              limite: 50,
              ...filtro,
            }),
          otra.gerente,
        );
      const todas = await existencias();
      expect(todas.map((f) => [f.nombre, f.depositoId, f.existencia, f.uso, f.unidadId])).toEqual(
        [
          ["Harina 000", fria, "12.5000", "NORMAL", "KILOGRAMO"],
          ["Harina 000", lejana, "1.0000", "CUARENTENA", "KILOGRAMO"],
          ["Leche entera", fria, "-3.0000", "NORMAL", "LITRO"],
        ].sort((a, b) =>
          a[0] === b[0]
            ? (a[1] as string) < (b[1] as string)
              ? -1
              : 1
            : (a[0] as string) < (b[0] as string)
              ? -1
              : 1,
        ),
      );
      expect(
        todas.find((f) => f.depositoId === fria && f.articuloId === harina.articulo),
      ).toMatchObject({
        productoId: harina.producto,
        nombreClave: "harina 000",
        sucursalId: otra.sucursal,
      });
      expect((await existencias({ depositoId: lejana })).map((f) => f.depositoId)).toEqual([
        lejana,
      ]);
      expect(
        (await existencias({ sucursalId: otra.otraSucursal })).map((f) => f.depositoId),
      ).toEqual([lejana]);
      expect((await existencias({ texto: "HAR" })).map((f) => f.nombre)).toEqual([
        "Harina 000",
        "Harina 000",
      ]);
      expect(await existencias({ texto: "x%" })).toEqual([]);
      expect((await existencias({ texto: "leche " })).map((f) => f.nombre)).toEqual([
        "Leche entera",
      ]);
      // `_` y `%` del texto buscado son literales (no comodines): «leche_» no encuentra «leche entera».
      expect(await existencias({ texto: "leche_" })).toEqual([]);
      expect(await existencias({ texto: "%" })).toEqual([]);
      expect((await existencias({ soloNegativas: true })).map((f) => f.existencia)).toEqual([
        "-3.0000",
      ]);
      expect(
        (await existencias({ alcance: [otra.otraSucursal] })).map((f) => f.depositoId),
      ).toEqual([lejana]);
      expect(await existencias({ alcance: [] })).toEqual([]);
      expect(await existencias({ depositoId: "x" })).toEqual([]);
      const cursor = (f: (typeof todas)[number]) => ({
        nombreClave: f.nombreClave,
        articuloId: f.articuloId,
        depositoId: f.depositoId,
      });
      const orden: string[] = [];
      let despuesDe: ReturnType<typeof cursor> | undefined;
      for (let paginas = 0; paginas < 5; paginas += 1) {
        const pagina = await existencias({ limite: 1, despuesDe });
        const ultima = pagina[0];
        if (ultima === undefined) break;
        orden.push(`${ultima.nombre}|${ultima.depositoId}`);
        despuesDe = cursor(ultima);
      }
      expect(orden).toEqual(todas.map((f) => `${f.nombre}|${f.depositoId}`));
      // La otra empresa no ve nada de esta.
      expect(
        await leer(
          (tx) =>
            tx.movimientosDeStock.existencias(e.empresaId, {
              alcance: "TODAS",
              limite: 50,
              texto: "harina",
            }),
          otra.gerente,
        ),
      ).toEqual([]);
      // Negativas por sucursal (aporte al cierre) y verificación de saldos.
      expect(
        await leer(
          (tx) => tx.movimientosDeStock.contarNegativasDe(otra.empresaId, otra.sucursal),
          otra.gerente,
        ),
      ).toBe(1);
      expect(
        await leer(
          (tx) => tx.movimientosDeStock.contarNegativasDe(otra.empresaId, otra.otraSucursal),
          otra.gerente,
        ),
      ).toBe(0);
      expect(
        await leer((tx) => tx.movimientosDeStock.verificarSaldos(otra.empresaId), otra.gerente),
      ).toEqual([]);
    });

    it("verificarSaldos devuelve los pares donde el saldo difiere de la suma de sus renglones (un saldo adulterado y un saldo que falta)", async () => {
      const otra = await c.escenario();
      const mundo = { empresa: otra.empresa, sucursal: otra.sucursal };
      const deposito = await depositoDeBase(c.dueno, mundo);
      const { articulo } = await articuloDeBase(c.dueno, mundo);
      const { articulo: otroArticulo } = await articuloDeBase(c.dueno, mundo);
      const entrada = (articuloId: string) =>
        c.entorno.ejecutar({ contexto: otra.gerente }, async (tx) =>
          ok(
            await tx.movimientosDeStock.registrar(
              otra.empresaId,
              {
                clase: "ENTRADA",
                motivo: "COMPRA",
                detalle: null,
                origenTipo: "MANUAL",
                origenId: null,
                depositoId: deposito,
                accion: "stock.registrar_entrada",
                anulaA: null,
                conteoId: null,
                clave: `clave-${randomUUID()}`,
                huella: "6".repeat(64),
                hechoEn: otra.gerente.ahora,
                fechaDeNegocio: null,
                registradoPor: otra.personaDelGerente,
              },
              [
                {
                  depositoId: deposito,
                  articuloId,
                  cantidad: "5",
                  composicionId: null,
                  confirmoNegativo: false,
                },
              ],
            ),
          ),
        );
      valorDe(await entrada(articulo));
      valorDe(await entrada(otroArticulo));
      const verificar = () =>
        leer((tx) => tx.movimientosDeStock.verificarSaldos(otra.empresaId), otra.gerente);
      expect(await verificar()).toEqual([]);
      // El saldo solo lo escribe el libro: para fabricar una diferencia se apaga el disparador un instante (solo el dueño puede).
      await c.dueno.query(
        "alter table saldo_de_stock disable trigger saldo_de_stock_solo_por_movimientos",
      );
      try {
        await c.dueno.query(
          "update saldo_de_stock set existencia = 9 where deposito_id = $1 and articulo_id = $2",
          [deposito, articulo],
        );
        await c.dueno
          .query("delete from saldo_de_stock where deposito_id = $1 and articulo_id = $2", [
            deposito,
            otroArticulo,
          ])
          .catch(() => undefined);
        await c.dueno.query(
          "update saldo_de_stock set existencia = 0 where deposito_id = $1 and articulo_id = $2",
          [deposito, otroArticulo],
        );
      } finally {
        await c.dueno.query(
          "alter table saldo_de_stock enable trigger saldo_de_stock_solo_por_movimientos",
        );
      }
      expect(await verificar()).toEqual(
        [
          { depositoId: deposito, articuloId: articulo, saldo: "9.0000", suma: "5.0000" },
          { depositoId: deposito, articuloId: otroArticulo, saldo: "0.0000", suma: "5.0000" },
        ].sort((a, b) => (a.articuloId < b.articuloId ? -1 : 1)),
      );
    });
  });

  // =============================================================================================
  describe("conteos", () => {
    it("insertar es idempotente por id; un segundo conteo abierto del depósito choca con la única; abiertoDe, obtener y bloquear", async () => {
      const deposito = await nuevoDeposito();
      const id = nuevoId();
      const alta = {
        id,
        depositoId: deposito,
        abiertoPor: e.personaDelGerente,
        abiertoEn: e.gerente.ahora,
      };
      expect(await leer((tx) => tx.conteosDeStock.insertar(empresa(), alta))).toBe(true);
      expect(await leer((tx) => tx.conteosDeStock.insertar(empresa(), alta))).toBe(false);
      expect(
        await enTx((tx) => tx.conteosDeStock.insertar(empresa(), { ...alta, id: nuevoId() })),
      ).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "conteo_fisico_abierto_uk" },
      });
      const guardado = await leer((tx) => tx.conteosDeStock.obtener(empresa(), id));
      expect(guardado).toEqual({
        id,
        depositoId: deposito,
        estado: "ABIERTO",
        abiertoPor: e.personaDelGerente,
        abiertoEn: e.gerente.ahora,
        resueltoPor: null,
        resueltoEn: null,
        motivo: null,
        version: 1,
      });
      expect(await leer((tx) => tx.conteosDeStock.bloquear(empresa(), id))).toEqual(guardado);
      expect(await leer((tx) => tx.conteosDeStock.abiertoDe(empresa(), deposito))).toEqual(
        guardado,
      );
      const sinConteo = await nuevoDeposito();
      expect(await leer((tx) => tx.conteosDeStock.abiertoDe(empresa(), sinConteo))).toBeNull();
      expect(await leer((tx) => tx.conteosDeStock.abiertoDe(empresa(), "x"))).toBeNull();
      expect(await leer((tx) => tx.conteosDeStock.obtener(empresa(), "x"))).toBeNull();
      expect(await leer((tx) => tx.conteosDeStock.bloquear(empresa(), "x"))).toBeNull();
      const otra = await c.escenario();
      expect(
        await leer((tx) => tx.conteosDeStock.obtener(otra.empresaId, id), otra.gerente),
      ).toBeNull();
    });

    it("los registros: insertar idempotente por id, la existencia al registrar la fija la base, recontar es un registro nuevo y registrosDe los da en orden", async () => {
      const deposito = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      await entradaDe(deposito, articulo, "8");
      const conteo = nuevoId();
      await leer((tx) =>
        tx.conteosDeStock.insertar(empresa(), {
          id: conteo,
          depositoId: deposito,
          abiertoPor: e.personaDelGerente,
          abiertoEn: e.gerente.ahora,
        }),
      );
      const registro = (id: string, cantidad: string) => ({
        id,
        conteoId: conteo,
        articuloId: articulo,
        cantidadContada: cantidad,
        registradoPor: e.personaDelGerente,
        registradoEn: e.gerente.ahora,
        contadoEn: null,
      });
      const primero = nuevoId();
      const segundo = nuevoId();
      expect(
        await leer((tx) => tx.conteosDeStock.insertarRegistro(empresa(), registro(primero, "7"))),
      ).toBe(true);
      expect(
        await leer((tx) => tx.conteosDeStock.insertarRegistro(empresa(), registro(primero, "7"))),
      ).toBe(false);
      expect(
        await leer((tx) => tx.conteosDeStock.insertarRegistro(empresa(), registro(segundo, "6.5"))),
      ).toBe(true);
      const registros = await leer((tx) => tx.conteosDeStock.registrosDe(empresa(), conteo));
      expect(registros.map((r) => [r.id, r.cantidadContada, r.existenciaAlRegistrar])).toEqual([
        [primero, "7.0000", "8.0000"],
        [segundo, "6.5000", "8.0000"],
      ]);
      expect(registros[0]).toMatchObject({
        conteoId: conteo,
        articuloId: articulo,
        registradoPor: e.personaDelGerente,
      });
      expect((registros[1]?.orden ?? 0) > (registros[0]?.orden ?? 0)).toBe(true);
      expect(await leer((tx) => tx.conteosDeStock.obtenerRegistro(empresa(), segundo))).toEqual(
        registros[1],
      );
      expect(await leer((tx) => tx.conteosDeStock.obtenerRegistro(empresa(), "x"))).toBeNull();
      expect(await leer((tx) => tx.conteosDeStock.registrosDe(empresa(), "x"))).toEqual([]);
      // Un conteo que no existe o un artículo que no es de la empresa salen como error de la base.
      expect(
        await enTx((tx) =>
          tx.conteosDeStock.insertarRegistro(empresa(), {
            ...registro(nuevoId(), "1"),
            conteoId: nuevoId(),
          }),
        ),
      ).toMatchObject({
        ok: false,
        error: { tipo: "Referencia", restriccion: "conteo_registro_conteo_fkey" },
      });
    });

    it("resolver pasa de ABIERTO a APLICADO (con registros) o CANCELADO (con motivo) una sola vez; sin registros no se aplica", async () => {
      const deposito = await nuevoDeposito();
      const { articulo } = await nuevoArticulo();
      const abrir = async (en = deposito) => {
        const id = nuevoId();
        await leer((tx) =>
          tx.conteosDeStock.insertar(empresa(), {
            id,
            depositoId: en,
            abiertoPor: e.personaDelGerente,
            abiertoEn: e.gerente.ahora,
          }),
        );
        return id;
      };
      const resolucion = (estado: "APLICADO" | "CANCELADO", motivo: string | null) => ({
        estado,
        resueltoPor: e.personaDelGerente,
        resueltoEn: new Date("2026-10-12T10:00:00Z"),
        motivo,
      });
      const vacio = await abrir();
      expect(
        await enTx((tx) =>
          tx.conteosDeStock.resolver(empresa(), vacio, resolucion("APLICADO", null)),
        ),
      ).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "conteo_fisico_sin_registros" },
      });
      const cancelado = valorDe(
        await enTx((tx) =>
          tx.conteosDeStock.resolver(
            empresa(),
            vacio,
            resolucion("CANCELADO", "Se contó otro día"),
          ),
        ),
      );
      expect(cancelado).toMatchObject({
        estado: "CANCELADO",
        motivo: "Se contó otro día",
        resueltoPor: e.personaDelGerente,
        resueltoEn: new Date("2026-10-12T10:00:00Z"),
        version: 2,
      });
      expect(
        await leer((tx) =>
          tx.conteosDeStock.resolver(empresa(), vacio, resolucion("CANCELADO", "Otra vez")),
        ),
      ).toBeNull();
      expect(
        await leer((tx) =>
          tx.conteosDeStock.resolver(empresa(), "x", resolucion("CANCELADO", "x")),
        ),
      ).toBeNull();
      const sinMotivo = await abrir();
      expect(
        await enTx((tx) =>
          tx.conteosDeStock.resolver(empresa(), sinMotivo, resolucion("CANCELADO", null)),
        ),
      ).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "conteo_fisico_cancelacion_ck" },
      });
      const depositoDelAplicado = await nuevoDeposito();
      const aplicado = await abrir(depositoDelAplicado);
      await leer((tx) =>
        tx.conteosDeStock.insertarRegistro(empresa(), {
          id: nuevoId(),
          conteoId: aplicado,
          articuloId: articulo,
          cantidadContada: "2",
          registradoPor: e.personaDelGerente,
          registradoEn: e.gerente.ahora,
          contadoEn: null,
        }),
      );
      expect(
        valorDe(
          await enTx((tx) =>
            tx.conteosDeStock.resolver(empresa(), aplicado, resolucion("APLICADO", null)),
          ),
        ),
      ).toMatchObject({
        estado: "APLICADO",
        motivo: null,
      });
      expect(
        await leer((tx) =>
          tx.conteosDeStock.resolver(empresa(), aplicado, resolucion("CANCELADO", "tarde")),
        ),
      ).toBeNull();
      // Un conteo ya resuelto deja de ser el abierto del depósito.
      expect(
        await leer((tx) => tx.conteosDeStock.abiertoDe(empresa(), depositoDelAplicado)),
      ).toBeNull();
    });

    it("listar respeta el alcance, filtra por depósito y estado y da el más nuevo primero; contarAbiertosDe cuenta por sucursal", async () => {
      const otra = await c.escenario();
      const propio = { empresa: otra.empresa, sucursal: otra.sucursal };
      const dos = { empresa: otra.empresa, sucursal: otra.otraSucursal };
      const d1 = await depositoDeBase(c.dueno, propio);
      const d2 = await depositoDeBase(c.dueno, propio);
      const d3 = await depositoDeBase(c.dueno, dos);
      const abrir = async (deposito: string, abiertoEn: string) => {
        const id = nuevoId();
        await leer(
          (tx) =>
            tx.conteosDeStock.insertar(otra.empresaId, {
              id,
              depositoId: deposito,
              abiertoPor: otra.personaDelGerente,
              abiertoEn: new Date(abiertoEn),
            }),
          otra.gerente,
        );
        return id;
      };
      const vieja = await abrir(d1, "2026-10-01T10:00:00Z");
      await leer(
        (tx) =>
          tx.conteosDeStock.resolver(otra.empresaId, vieja, {
            estado: "CANCELADO",
            resueltoPor: otra.personaDelGerente,
            resueltoEn: new Date("2026-10-02T10:00:00Z"),
            motivo: "Cancelado",
          }),
        otra.gerente,
      );
      const nueva = await abrir(d1, "2026-10-03T10:00:00Z");
      const enOtra = await abrir(d2, "2026-10-04T10:00:00Z");
      const lejana = await abrir(d3, "2026-10-05T10:00:00Z");
      const ids = async (filtro: Partial<Parameters<Repos["conteosDeStock"]["listar"]>[1]> = {}) =>
        (
          await leer(
            (tx) =>
              tx.conteosDeStock.listar(otra.empresaId, { alcance: "TODAS", limite: 50, ...filtro }),
            otra.gerente,
          )
        ).map((c_) => c_.id);
      expect(await ids()).toEqual([lejana, enOtra, nueva, vieja]);
      expect(await ids({ estado: "ABIERTO" })).toEqual([lejana, enOtra, nueva]);
      expect(await ids({ estado: "CANCELADO" })).toEqual([vieja]);
      expect(await ids({ depositoId: d1 })).toEqual([nueva, vieja]);
      expect(await ids({ alcance: [otra.otraSucursal] })).toEqual([lejana]);
      expect(await ids({ alcance: [] })).toEqual([]);
      expect(await ids({ depositoId: "x" })).toEqual([]);
      expect(await ids({ limite: 2 })).toEqual([lejana, enOtra]);
      expect(
        await leer(
          (tx) => tx.conteosDeStock.contarAbiertosDe(otra.empresaId, otra.sucursal),
          otra.gerente,
        ),
      ).toBe(2);
      expect(
        await leer(
          (tx) => tx.conteosDeStock.contarAbiertosDe(otra.empresaId, otra.otraSucursal),
          otra.gerente,
        ),
      ).toBe(1);
      expect(
        await leer(
          (tx) => tx.conteosDeStock.contarAbiertosDe(e.empresaId, otra.sucursal),
          otra.gerente,
        ),
      ).toBe(0);
    });
  });

  // =============================================================================================
  describe("composiciones", () => {
    const version = (
      productoId: string,
      numero: number,
      componentes: ReadonlyArray<{
        articuloId: string;
        cantidad: string;
        unidadId?: string;
        dimension?: string;
      }>,
      rinde = "1",
    ) =>
      enTx((tx) =>
        tx.composicionesDeStock.insertarVersion(empresa(), {
          productoId,
          numero,
          rinde,
          creadaPor: e.personaDelGerente,
          creadaEn: e.gerente.ahora,
          componentes: componentes.map((k) => ({ unidadId: "UNIDAD", dimension: "CONTEO", ...k })),
        }),
      );

    it("insertarVersion guarda la versión con sus componentes numerados; ultimaVersion da la de mayor número y una versión vacía retira la receta", async () => {
      const vendible = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      const harina = await nuevoArticulo({ unidadBase: "KILOGRAMO", dimension: "MASA" });
      const huevo = await nuevoArticulo();
      expect(
        await leer((tx) => tx.composicionesDeStock.ultimaVersion(empresa(), vendible)),
      ).toBeNull();
      const v1 = valorDe(
        await version(
          vendible,
          1,
          [
            { articuloId: harina.articulo, cantidad: "250", unidadId: "GRAMO", dimension: "MASA" },
            { articuloId: huevo.articulo, cantidad: "2" },
          ],
          "4",
        ),
      );
      expect(v1).toMatchObject({
        empresaId: e.empresa,
        productoId: vendible,
        numero: 1,
        rinde: "4.0000",
        creadaPor: e.personaDelGerente,
      });
      expect(v1.componentes).toEqual([
        {
          numero: 1,
          articuloId: harina.articulo,
          compuestoId: null,
          cantidad: "250.0000",
          unidadId: "GRAMO",
          dimension: "MASA",
          perdida: "0.0000",
        },
        {
          numero: 2,
          articuloId: huevo.articulo,
          compuestoId: null,
          cantidad: "2.0000",
          unidadId: "UNIDAD",
          dimension: "CONTEO",
          perdida: "0.0000",
        },
      ]);
      expect(
        await leer((tx) => tx.composicionesDeStock.ultimaVersion(empresa(), vendible)),
      ).toEqual(v1);
      expect(await leer((tx) => tx.composicionesDeStock.obtener(empresa(), v1.id))).toEqual(v1);
      const v2 = valorDe(
        await version(vendible, 2, [{ articuloId: huevo.articulo, cantidad: "3" }]),
      );
      expect(v2.componentes).toHaveLength(1);
      expect(
        (await leer((tx) => tx.composicionesDeStock.ultimaVersion(empresa(), vendible)))?.numero,
      ).toBe(2);
      // La versión anterior sigue ahí, inmutable (la de la que salió lo ya vendido).
      expect(await leer((tx) => tx.composicionesDeStock.obtener(empresa(), v1.id))).toEqual(v1);
      const vacia = valorDe(await version(vendible, 3, []));
      expect(vacia.componentes).toEqual([]);
      expect(
        await leer((tx) => tx.composicionesDeStock.ultimaVersion(empresa(), vendible)),
      ).toEqual(vacia);
      expect(await leer((tx) => tx.composicionesDeStock.ultimaVersion(empresa(), "x"))).toBeNull();
      expect(await leer((tx) => tx.composicionesDeStock.obtener(empresa(), "x"))).toBeNull();
      expect(await leer((tx) => tx.composicionesDeStock.obtener(empresa(), nuevoId()))).toBeNull();
      const otra = await c.escenario();
      expect(
        await leer((tx) => tx.composicionesDeStock.obtener(otra.empresaId, v1.id), otra.gerente),
      ).toBeNull();
    });

    it("ultimasVersiones da la última de cada producto (los que nunca tuvieron no figuran)", async () => {
      const a = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      const b = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      const sin = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      const { articulo } = await nuevoArticulo();
      const a1 = valorDe(await version(a, 1, [{ articuloId: articulo, cantidad: "1" }]));
      const a2 = valorDe(await version(a, 2, [{ articuloId: articulo, cantidad: "5" }]));
      const b1 = valorDe(await version(b, 1, [{ articuloId: articulo, cantidad: "2" }]));
      const ultimas = await leer((tx) =>
        tx.composicionesDeStock.ultimasVersiones(empresa(), [a, b, sin, "x", nuevoId()]),
      );
      expect([...ultimas.keys()].sort()).toEqual([a, b].sort());
      expect(ultimas.get(a)).toEqual(a2);
      expect(ultimas.get(a)).not.toEqual(a1);
      expect(ultimas.get(b)).toEqual(b1);
      expect(
        (await leer((tx) => tx.composicionesDeStock.ultimasVersiones(empresa(), []))).size,
      ).toBe(0);
      expect(
        (await leer((tx) => tx.composicionesDeStock.ultimasVersiones(empresa(), ["x"]))).size,
      ).toBe(0);
    });

    it("la base frena una versión salteada o repetida, un componente repetido, un producto que no es vendible y una unidad de otra dimensión", async () => {
      const vendible = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      const { articulo } = await nuevoArticulo();
      expect(await version(vendible, 2, [{ articuloId: articulo, cantidad: "1" }])).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "composicion_numero_salteado" },
      });
      valorDe(await version(vendible, 1, [{ articuloId: articulo, cantidad: "1" }]));
      // Repetir el número 1 también es una versión salteada (la siguiente es la 2): el disparador lo dice antes que la única.
      expect(await version(vendible, 1, [{ articuloId: articulo, cantidad: "1" }])).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "composicion_numero_salteado" },
      });
      expect(
        await version(vendible, 2, [
          { articuloId: articulo, cantidad: "1" },
          { articuloId: articulo, cantidad: "2" },
        ]),
      ).toEqual({ ok: false, error: { tipo: "Unicidad", restriccion: "componente_articulo_uk" } });
      const insumo = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      expect(await version(insumo, 1, [{ articuloId: articulo, cantidad: "1" }])).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "composicion_producto_no_vendible" },
      });
      expect(
        await version(vendible, 2, [
          { articuloId: articulo, cantidad: "1", unidadId: "GRAMO", dimension: "MASA" },
        ]),
      ).toMatchObject({
        ok: false,
        error: { tipo: "Referencia" },
      });
    });
  });

  // =============================================================================================
  describe("el lector del catálogo (ProductosParaStock)", () => {
    it("obtener y porIds dan clase, activo, unidad base y dimensión; lo que no existe, no es uuid o es de otra empresa no vuelve", async () => {
      const harina = await productoDeBase(c.dueno, e.empresa, {
        clase: "MATERIA_PRIMA",
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
        nombre: "Harina fina",
      });
      const inactivo = await productoDeBase(c.dueno, e.empresa, {
        clase: "VENDIBLE",
        activo: false,
      });
      expect(await leer((tx) => tx.productosParaStock.obtener(empresa(), harina))).toEqual({
        id: harina,
        nombre: "Harina fina",
        nombreClave: "harina fina",
        claseDeUso: "MATERIA_PRIMA",
        activo: true,
        unidadBaseId: "KILOGRAMO",
        dimension: "MASA",
      });
      expect(await leer((tx) => tx.productosParaStock.obtener(empresa(), inactivo))).toMatchObject({
        claseDeUso: "VENDIBLE",
        activo: false,
      });
      expect(await leer((tx) => tx.productosParaStock.obtener(empresa(), "x"))).toBeNull();
      expect(await leer((tx) => tx.productosParaStock.obtener(empresa(), nuevoId()))).toBeNull();
      const porIds = await leer((tx) =>
        tx.productosParaStock.porIds(empresa(), [harina, inactivo, nuevoId(), "x"]),
      );
      expect(porIds.map((p) => p.id).sort()).toEqual([harina, inactivo].sort());
      expect(await leer((tx) => tx.productosParaStock.porIds(empresa(), []))).toEqual([]);
      expect(await leer((tx) => tx.productosParaStock.porIds(empresa(), ["x"]))).toEqual([]);
      const otra = await c.escenario();
      expect(
        await leer((tx) => tx.productosParaStock.obtener(otra.empresaId, harina), otra.gerente),
      ).toBeNull();
      expect(
        await leer((tx) => tx.productosParaStock.porIds(otra.empresaId, [harina]), otra.gerente),
      ).toEqual([]);
    });

    it("bloquearCompartido lee el producto con FOR SHARE (en una transacción que escribe) y lo da igual que obtener", async () => {
      const insumo = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      const compartido = await leer((tx) =>
        tx.productosParaStock.bloquearCompartido(empresa(), insumo),
      );
      expect(compartido).toEqual(
        await leer((tx) => tx.productosParaStock.obtener(empresa(), insumo)),
      );
      expect(
        await leer((tx) => tx.productosParaStock.bloquearCompartido(empresa(), "x")),
      ).toBeNull();
      expect(
        await leer((tx) => tx.productosParaStock.bloquearCompartido(empresa(), nuevoId())),
      ).toBeNull();
    });

    it("consumoDeVersiones y factoresDeTamano leen lo que consume cada versión de opción y el factor de la variante, con el texto decimal exacto y en orden", async () => {
      const insumo = await productoDeBase(c.dueno, e.empresa, {
        clase: "INSUMO",
        unidadBase: "GRAMO",
        dimension: "MASA",
      });
      const reventa = await productoDeBase(c.dueno, e.empresa, { clase: "REVENTA" });
      const vendible = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      await c.dueno.query("begin");
      let adicional: string;
      let sinConsumo: string;
      let grande: string;
      let chico: string;
      try {
        const extras = await grupoDeBase(c.dueno, e.empresa, vendible, { clase: "ADICIONAL" });
        adicional = (await opcionDeBase(c.dueno, e.empresa, vendible, extras)).version;
        sinConsumo = (await opcionDeBase(c.dueno, e.empresa, vendible, extras)).version;
        await c.dueno.query(
          "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad, escala_con_tamano) values ($1, $2, 1, $3, '0.2500', false), ($1, $2, 2, $4, '1', true)",
          [e.empresa, adicional, insumo, reventa],
        );
        const tamanos = await grupoDeBase(c.dueno, e.empresa, vendible, {
          clase: "VARIANTE",
          esTamano: true,
        });
        grande = (await opcionDeBase(c.dueno, e.empresa, vendible, tamanos, { factor: "1.5" }))
          .version;
        chico = (await opcionDeBase(c.dueno, e.empresa, vendible, tamanos)).version;
        await c.dueno.query("commit");
      } catch (error) {
        await c.dueno.query("rollback");
        throw error;
      }
      const todas = [adicional, sinConsumo, grande, chico, nuevoId(), "x"];
      const consumo = await leer((tx) =>
        tx.productosParaStock.consumoDeVersiones(empresa(), todas),
      );
      expect([...consumo.keys()]).toEqual([adicional]);
      expect(consumo.get(adicional)).toEqual([
        { insumoId: insumo, cantidad: "0.2500", escalaConTamano: false },
        { insumoId: reventa, cantidad: "1.0000", escalaConTamano: true },
      ]);
      const factores = await leer((tx) => tx.productosParaStock.factoresDeTamano(empresa(), todas));
      expect(Object.fromEntries(factores)).toEqual({
        [adicional]: "1.0000",
        [sinConsumo]: "1.0000",
        [grande]: "1.5000",
        [chico]: "1.0000",
      });
      for (const vacio of [[], ["x"]]) {
        expect(
          (await leer((tx) => tx.productosParaStock.consumoDeVersiones(empresa(), vacio))).size,
        ).toBe(0);
        expect(
          (await leer((tx) => tx.productosParaStock.factoresDeTamano(empresa(), vacio))).size,
        ).toBe(0);
      }
      const otra = await c.escenario();
      expect(
        (
          await leer(
            (tx) => tx.productosParaStock.consumoDeVersiones(otra.empresaId, [adicional]),
            otra.gerente,
          )
        ).size,
      ).toBe(0);
      expect(
        (
          await leer(
            (tx) => tx.productosParaStock.factoresDeTamano(otra.empresaId, [grande]),
            otra.gerente,
          )
        ).size,
      ).toBe(0);
    });
  });
});
