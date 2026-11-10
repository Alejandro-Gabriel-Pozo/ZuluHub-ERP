import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { fechaCivilDesdeTexto } from "../../src/primitivas/tiempo/fecha-civil";
import { ok } from "../../src/primitivas/resultado/resultado";
import { traducirMovimiento, type EntradaDeSalidaPorVenta } from "../../src/modulos/stock/publico";
import { productoDeBase } from "./catalogo-apoyo";
import { crearMundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  baseConMigraciones,
  carpetaCon,
  CARPETA_DE_MIGRACIONES,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import { articuloDeBase, depositoDeBase, escribirMovimiento } from "./stock-apoyo";
import {
  aLaVez,
  firme,
  montarStock,
  nuevoId,
  RONDAS,
  soloOk,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T10, costos (migración 0031): el promedio móvil ponderado por (depósito, artículo) y el costo congelado de cada renglón del libro, con los
 * casos de uso reales sobre una base propia. P23 (entrada sin precio y después con precio; transferir no cambia el valor; dos salidas a la vez
 * congelan el mismo promedio; la anulación devuelve el costo original), la concurrencia del promedio, la repetición de una entrada con costo, el
 * aislamiento entre empresas, la autorización de las consultas (`costos.ver`) y lo que la base impone sola (solo inserción, mismas
 * transacciones, RLS, privilegios por columna).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ARCHIVO = "0031_stock_costos.sql";
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

type EstadoLeido = Readonly<{ costo_unitario: string; cantidad_valorizada: string }>;
type CostoLeido = Readonly<{ numero: number; estado: string; costo_unitario: string | null }>;

describe.skipIf(base === null)("stock: costos", () => {
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

  // ---- el escenario ---------------------------------------------------------------------------------------------------------------

  const nuevo = async (escenario: EscenarioDeStock = e) => ({
    dep: await c.deposito(escenario),
    ...(await c.articulo(escenario)),
  });
  const renglon = (producto: string, cantidad: string, costoUnitario?: string) => ({
    productoId: producto,
    cantidad,
    unidadId: "UNIDAD",
    ...(costoUnitario === undefined ? {} : { costoUnitario }),
  });
  const entrada = (
    dep: string,
    producto: string,
    cantidad: string,
    costo?: string,
    motivo = "COMPRA",
    quien = e.gerente,
  ) =>
    c.casos.registrarEntrada(quien, {
      clave: nuevoId(),
      depositoId: dep,
      motivo,
      renglones: [renglon(producto, cantidad, costo)],
    });
  const salida = (dep: string, producto: string, cantidad: string, motivo = "MERMA") =>
    c.casos.registrarSalida(e.gerente, {
      clave: nuevoId(),
      depositoId: dep,
      motivo,
      renglones: [renglon(producto, cantidad)],
    });
  const estadoDe = async (dep: string, articulo: string): Promise<EstadoLeido | null> =>
    (
      await c.filas<EstadoLeido>(
        `select costo_unitario::text as costo_unitario, cantidad_valorizada::text as cantidad_valorizada
           from costo_de_articulo where deposito_id = $1 and articulo_id = $2`,
        [dep, articulo],
      )
    )[0] ?? null;
  const costosDe = (movimientoId: string) =>
    c.filas<CostoLeido>(
      `select numero, estado, costo_unitario::text as costo_unitario from costo_de_renglon
        where movimiento_id = $1 order by numero`,
      [movimientoId],
    );
  const unicoCostoDe = async (movimientoId: string) => (await costosDe(movimientoId))[0];

  // ---- P23: el promedio ----------------------------------------------------------------------------------------------------------

  describe("el promedio móvil ponderado", () => {
    it("P23: una entrada sin precio y después una con precio: el promedio no se diluye con lo que no tiene costo (y nunca es cero)", async () => {
      const n = await nuevo();
      const sinPrecio = valorDe(await entrada(n.dep, n.producto, "10"));
      // Sin costo: la existencia sube, no hay promedio y el renglón queda `SIN_COSTO` con el costo nulo (nunca cero).
      expect(await estadoDe(n.dep, n.articulo)).toBeNull();
      expect(await unicoCostoDe(sinPrecio.movimientoId)).toEqual({
        numero: 1,
        estado: "SIN_COSTO",
        costo_unitario: null,
      });
      const conPrecio = valorDe(await entrada(n.dep, n.producto, "10", "5"));
      expect(await c.existencia(n.dep, n.articulo)).toBe("20.0000");
      // El promedio es el de lo que tiene costo: 5, no 2,5 (10 de 20 unidades sin costo no lo diluyen).
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "10.0000",
      });
      expect(await unicoCostoDe(conPrecio.movimientoId)).toEqual({
        numero: 1,
        estado: "DEFINITIVO",
        costo_unitario: "5.000000",
      });
      // Otra entrada sin precio no lo mueve.
      valorDe(await entrada(n.dep, n.producto, "5"));
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "10.0000",
      });
      // Y una con precio promedia con lo valorizado: (10 × 5 + 10 × 8) ÷ 20 = 6,5.
      valorDe(await entrada(n.dep, n.producto, "10", "8"));
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "6.500000",
        cantidad_valorizada: "20.0000",
      });
    });

    it("el costo unitario se redondea UNA vez a 6 decimales (mitad hacia afuera) y el exacto no se toca", async () => {
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "3", "1"));
      // (3 × 1 + 4 × 2) ÷ 7 = 1,571428571…: 6 decimales, 1,571429.
      valorDe(await entrada(n.dep, n.producto, "4", "2"));
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "1.571429",
        cantidad_valorizada: "7.0000",
      });
      const m = await nuevo();
      valorDe(await entrada(m.dep, m.producto, "1", "0.000001"));
      // (0,000001 + 0,000002) ÷ 2 = 0,0000015: la mitad sube.
      valorDe(await entrada(m.dep, m.producto, "1", "0.000002"));
      expect(await estadoDe(m.dep, m.articulo)).toEqual({
        costo_unitario: "0.000002",
        cantidad_valorizada: "2.0000",
      });
    });

    it("una salida congela el promedio vigente en su renglón y no lo mueve; sin promedio queda `SIN_COSTO`", async () => {
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "10"));
      const sinPromedio = valorDe(await salida(n.dep, n.producto, "2"));
      expect(await unicoCostoDe(sinPromedio.movimientoId)).toEqual({
        numero: 1,
        estado: "SIN_COSTO",
        costo_unitario: null,
      });
      expect(await estadoDe(n.dep, n.articulo)).toBeNull();
      valorDe(await entrada(n.dep, n.producto, "10", "6.5"));
      const conPromedio = valorDe(await salida(n.dep, n.producto, "4", "CONSUMO_INTERNO"));
      expect(await unicoCostoDe(conPromedio.movimientoId)).toEqual({
        numero: 1,
        estado: "DEFINITIVO",
        costo_unitario: "6.500000",
      });
      // Lo valorizado baja y el promedio no cambia.
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "6.500000",
        cantidad_valorizada: "6.0000",
      });
      // Un cambio posterior del precio de compra no reescribe lo ya costeado.
      valorDe(await entrada(n.dep, n.producto, "6", "20"));
      expect((await unicoCostoDe(conPromedio.movimientoId))?.costo_unitario).toBe("6.500000");
      // La salida de más de lo valorizado deja lo valorizado en cero (piso) y el promedio.
      valorDe(await salida(n.dep, n.producto, "30"));
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "13.250000",
        cantidad_valorizada: "0.0000",
      });
    });

    it("un ajuste que suma entra al promedio vigente (sin moverlo) y uno que resta sale como una salida", async () => {
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "10", "4"));
      const suma = valorDe(
        await c.casos.ajustar(e.gerente, {
          clave: nuevoId(),
          depositoId: n.dep,
          detalle: "Apareció mercadería",
          renglones: [{ ...renglon(n.producto, "5"), sentido: "SUMA" }],
        }),
      );
      expect(await unicoCostoDe(suma.movimientoId)).toMatchObject({
        estado: "DEFINITIVO",
        costo_unitario: "4.000000",
      });
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "4.000000",
        cantidad_valorizada: "15.0000",
      });
      const resta = valorDe(
        await c.casos.ajustar(e.gerente, {
          clave: nuevoId(),
          depositoId: n.dep,
          detalle: "Se rompió",
          renglones: [{ ...renglon(n.producto, "3"), sentido: "RESTA" }],
        }),
      );
      expect(await unicoCostoDe(resta.movimientoId)).toMatchObject({
        estado: "DEFINITIVO",
        costo_unitario: "4.000000",
      });
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "4.000000",
        cantidad_valorizada: "12.0000",
      });
    });
  });

  describe("conteo físico", () => {
    it("el ajuste de un conteo costea lo que falta como una salida (el promedio vigente) y lo que sobra con el promedio vigente", async () => {
      const n = await nuevo();
      const otro = await c.articulo(e);
      valorDe(await entrada(n.dep, n.producto, "10", "4"));
      valorDe(await entrada(n.dep, otro.producto, "10", "7"));
      const conteoId = nuevoId();
      valorDe(await c.casos.abrirConteo(e.gerente, { id: conteoId, depositoId: n.dep }));
      for (const [producto, contado] of [
        [n.producto, "6"],
        [otro.producto, "12"],
      ] as const) {
        valorDe(
          await c.casos.registrarConteo(e.gerente, {
            id: nuevoId(),
            conteoId,
            productoId: producto,
            cantidadContada: contado,
            unidadId: "UNIDAD",
          }),
        );
      }
      const aplicado = valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId }));
      const costos = await costosDe(aplicado.movimientoId as string);
      expect(costos.map((r) => [r.estado, r.costo_unitario].join(" ")).sort()).toEqual([
        "DEFINITIVO 4.000000",
        "DEFINITIVO 7.000000",
      ]);
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "4.000000",
        cantidad_valorizada: "6.0000",
      });
      expect(await estadoDe(n.dep, otro.articulo)).toEqual({
        costo_unitario: "7.000000",
        cantidad_valorizada: "12.0000",
      });
    });
  });

  // ---- P23: transferir -----------------------------------------------------------------------------------------------------------

  describe("transferencia", () => {
    it("P23: transferir lleva el costo de origen, el destino lo incorpora a su promedio y el valor total de la empresa no cambia", async () => {
      const a = await nuevo();
      const destino = await c.deposito(e);
      valorDe(await entrada(a.dep, a.producto, "10", "4"));
      valorDe(await entrada(destino, a.producto, "10", "8"));
      const antes = valorDe(await c.consultas.existenciaValorizada(e.gerente));
      const t = valorDe(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: a.dep,
          destinoId: destino,
          renglones: [renglon(a.producto, "5")],
        }),
      );
      // Las dos patas llevan el costo de ORIGEN (4), no el del destino.
      expect(await costosDe(t.movimientoId)).toEqual([
        { numero: 1, estado: "DEFINITIVO", costo_unitario: "4.000000" },
        { numero: 2, estado: "DEFINITIVO", costo_unitario: "4.000000" },
      ]);
      expect(await estadoDe(a.dep, a.articulo)).toEqual({
        costo_unitario: "4.000000",
        cantidad_valorizada: "5.0000",
      });
      // Destino: (10 × 8 + 5 × 4) ÷ 15 = 6,666667.
      expect(await estadoDe(destino, a.articulo)).toEqual({
        costo_unitario: "6.666667",
        cantidad_valorizada: "15.0000",
      });
      // 10 × 4 + 10 × 8 = 120 antes; 5 × 4 + 15 × 6,666667 = 120,000005 después: el mismo importe al centavo.
      const despues = valorDe(await c.consultas.existenciaValorizada(e.gerente));
      expect(despues.valor).toBe(antes.valor);
    });

    it("transferir lo que no tiene costo deja el destino sin costo y no lo diluye", async () => {
      const a = await nuevo();
      const destino = await c.deposito(e);
      valorDe(await entrada(a.dep, a.producto, "10"));
      valorDe(await entrada(destino, a.producto, "10", "8"));
      const t = valorDe(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: a.dep,
          destinoId: destino,
          renglones: [renglon(a.producto, "5")],
        }),
      );
      expect(await costosDe(t.movimientoId)).toEqual([
        { numero: 1, estado: "SIN_COSTO", costo_unitario: null },
        { numero: 2, estado: "SIN_COSTO", costo_unitario: null },
      ]);
      expect(await estadoDe(destino, a.articulo)).toEqual({
        costo_unitario: "8.000000",
        cantidad_valorizada: "10.0000",
      });
    });

    it("una transferencia que se rechaza no deja costos a medias (destino inactivo: ni renglones de costo ni promedios movidos)", async () => {
      const a = await nuevo();
      const inactivo = await c.deposito(e, { activo: false });
      valorDe(await entrada(a.dep, a.producto, "10", "4"));
      const antes = await c.contar(
        "select count(*) as n from costo_de_renglon where empresa_id = $1",
        [e.empresa],
      );
      const rechazo = await c.casos.transferir(e.gerente, {
        clave: nuevoId(),
        origenId: a.dep,
        destinoId: inactivo,
        renglones: [renglon(a.producto, "5")],
      });
      expect(rechazo).toEqual({ ok: false, error: "DEPOSITO_INACTIVO" });
      expect(
        await c.contar("select count(*) as n from costo_de_renglon where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(antes);
      expect(await estadoDe(a.dep, a.articulo)).toEqual({
        costo_unitario: "4.000000",
        cantidad_valorizada: "10.0000",
      });
    });
  });

  // ---- P23: la anulación ---------------------------------------------------------------------------------------------------------

  describe("anulación", () => {
    it("P23: anular una salida devuelve el costo ORIGINAL (el congelado), no el promedio vigente de hoy", async () => {
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "10", "4"));
      const venta = valorDe(await salida(n.dep, n.producto, "5", "OTRA_SALIDA"));
      // Después de la salida entra mercadería más cara: el promedio vigente pasa a 8 (5 × 4 + 10 × 10) ÷ 15.
      valorDe(await entrada(n.dep, n.producto, "10", "10"));
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "8.000000",
        cantidad_valorizada: "15.0000",
      });
      const anulacion = valorDe(
        await c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId: venta.movimientoId,
          detalle: "Se cargó de más",
        }),
      );
      // El espejo lleva el costo congelado (4), no el vigente (8).
      expect(await unicoCostoDe(anulacion.anulacionId)).toEqual({
        numero: 1,
        estado: "DEFINITIVO",
        costo_unitario: "4.000000",
      });
      // Vuelve a entrar al promedio al costo original: (15 × 8 + 5 × 4) ÷ 20 = 7.
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "7.000000",
        cantidad_valorizada: "20.0000",
      });
    });

    it("anular una entrada con costo la saca al mismo costo; anular una sin costo no toca el promedio; anular una transferencia devuelve las dos patas", async () => {
      const n = await nuevo();
      const base_ = valorDe(await entrada(n.dep, n.producto, "10", "4"));
      const sinCosto = valorDe(await entrada(n.dep, n.producto, "6"));
      const conCosto = valorDe(await entrada(n.dep, n.producto, "10", "6"));
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "20.0000",
      });
      const anular = (movimientoId: string) =>
        c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId,
          detalle: "Error de carga",
        });
      const quitaSinCosto = valorDe(await anular(sinCosto.movimientoId));
      expect(await unicoCostoDe(quitaSinCosto.anulacionId)).toMatchObject({ estado: "SIN_COSTO" });
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "20.0000",
      });
      const quitaConCosto = valorDe(await anular(conCosto.movimientoId));
      expect(await unicoCostoDe(quitaConCosto.anulacionId)).toMatchObject({
        estado: "DEFINITIVO",
        costo_unitario: "6.000000",
      });
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "10.0000",
      });
      expect(base_.movimientoId).toBeDefined();

      const destino = await c.deposito(e);
      const t = valorDe(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: n.dep,
          destinoId: destino,
          renglones: [renglon(n.producto, "4")],
        }),
      );
      const deshecha = valorDe(await anular(t.movimientoId));
      expect(await costosDe(deshecha.anulacionId)).toEqual([
        { numero: 1, estado: "DEFINITIVO", costo_unitario: "5.000000" },
        { numero: 2, estado: "DEFINITIVO", costo_unitario: "5.000000" },
      ]);
      // Origen otra vez con sus 10 (a 5) y el destino vuelve a lo que tenía antes de recibir: nada valorizado.
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "10.0000",
      });
      expect((await estadoDe(destino, n.articulo))?.cantidad_valorizada).toBe("0.0000");
    });
  });

  // ---- la salida por venta y su reversión ------------------------------------------------------------------------------------------

  describe("salida por venta", () => {
    it("la venta congela el promedio de cada insumo (con su receta) y su reversión lo devuelve al mismo costo", async () => {
      const dep = await c.deposito(e, { deVenta: true });
      const harina = await c.articulo(e, { clase: "INSUMO" });
      valorDe(await entrada(dep, harina.producto, "100", "3"));
      const pan = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      valorDe(
        await c.casos.guardarComposicion(e.gerente, {
          productoId: pan,
          versionEsperada: 0,
          rinde: "1",
          componentes: [{ productoId: harina.producto, cantidad: "2", unidadId: "UNIDAD" }],
        }),
      );
      const ejemplar = nuevoId();
      const vendida: EntradaDeSalidaPorVenta = {
        origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
        accion: "cuentas.cerrar",
        depositoId: dep,
        hechoEn: e.gerente.ahora,
        fechaDeNegocio: valorDe(fechaCivilDesdeTexto("2026-10-09")),
        renglones: [
          { posicion: 1, productoId: pan, cantidad: "5", unidadDeVentaId: "UNIDAD", opciones: [] },
        ],
      };
      const venta = valorDe(
        traducirMovimiento(
          await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
            c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, e.gerente, vendida),
          ),
        ),
      );
      expect(venta.movimientoId).not.toBeNull();
      expect(await costosDe(venta.movimientoId as string)).toEqual([
        { numero: 1, estado: "DEFINITIVO", costo_unitario: "3.000000" },
      ]);
      expect(await estadoDe(dep, harina.articulo)).toEqual({
        costo_unitario: "3.000000",
        cantidad_valorizada: "90.0000",
      });
      // Entra mercadería más cara y se revierte la venta: vuelve al costo con que salió (3), no al de hoy.
      valorDe(await entrada(dep, harina.producto, "10", "13"));
      const reversion = valorDe(
        traducirMovimiento(
          await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
            c.puertos.reversionDeStock.revertirPorOrigen(tx, e.gerente, {
              origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
              accion: "tickets.corregir",
              detalle: "Ticket anulado",
            }),
          ),
        ),
      );
      expect(await costosDe(reversion.anulacionId as string)).toEqual([
        { numero: 1, estado: "DEFINITIVO", costo_unitario: "3.000000" },
      ]);
      // (90 × 4 + 10 × 3)… el promedio vigente antes era (90 × 3 + 10 × 13) ÷ 100 = 4; devuelve 10 a 3: (100 × 4 + 10 × 3) ÷ 110 = 3,909091.
      expect(await estadoDe(dep, harina.articulo)).toEqual({
        costo_unitario: "3.909091",
        cantidad_valorizada: "110.0000",
      });
    });

    it("la entrada por origen (recepción de compra) declara costo por renglón y entra al promedio", async () => {
      const dep = await c.deposito(e);
      const a = await c.articulo(e);
      const recibida = valorDe(
        traducirMovimiento(
          await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
            c.puertos.entradaPorOrigen.registrarEntrada(tx, e.gerente, {
              clave: nuevoId(),
              origen: { tipo: "RECEPCION", id: nuevoId() },
              accion: "stock.registrar_entrada",
              depositoId: dep,
              motivo: "COMPRA",
              renglones: [renglon(a.producto, "10", "12.5")],
            }),
          ),
        ),
      );
      expect(await unicoCostoDe(recibida.movimientoId)).toMatchObject({
        estado: "DEFINITIVO",
        costo_unitario: "12.500000",
      });
      expect(await estadoDe(dep, a.articulo)).toEqual({
        costo_unitario: "12.500000",
        cantidad_valorizada: "10.0000",
      });
      const invalida = await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
        c.puertos.entradaPorOrigen.registrarEntrada(tx, e.gerente, {
          clave: nuevoId(),
          origen: { tipo: "RECEPCION", id: nuevoId() },
          accion: "stock.registrar_entrada",
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [renglon(a.producto, "1", "gratis")],
        }),
      );
      expect(invalida).toEqual({ ok: false, error: "COSTO_INVALIDO" });
    });
  });

  // ---- COSTO_INVALIDO -------------------------------------------------------------------------------------------------------------

  describe("el costo que declara una entrada", () => {
    it("lo que no es un costo se rechaza con COSTO_INVALIDO y no escribe nada: texto mal formado, negativo, cero, de más de 6 decimales, fuera de rango y lo que no es texto", async () => {
      const n = await nuevo();
      const antes = await c.contar(
        "select count(*) as n from movimiento_de_stock where empresa_id = $1",
        [e.empresa],
      );
      for (const costo of [
        "gratis",
        "",
        " 5",
        "5,5",
        "+5",
        "-1",
        "0",
        "0.000000",
        "1.1234567",
        "1e3",
        "1000000000000",
        "9".repeat(41),
        5 as unknown as string,
        null as unknown as string,
        {} as unknown as string,
      ]) {
        expect(await entrada(n.dep, n.producto, "1", costo), String(costo)).toEqual({
          ok: false,
          error: "COSTO_INVALIDO",
        });
      }
      expect(
        await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(antes);
      // Los extremos válidos entran: el mínimo y el máximo de `numeric(18,6)`.
      valorDe(await entrada(n.dep, n.producto, "1", "0.000001"));
      valorDe(await entrada(n.dep, n.producto, "1", "999999999999.999999"));
    });

    it("solo `COMPRA` y `CARGA_INICIAL` declaran costo: en otro motivo de entrada, en una salida, una transferencia o un ajuste, un costo es COSTO_INVALIDO", async () => {
      const n = await nuevo();
      const destino = await c.deposito(e);
      valorDe(await entrada(n.dep, n.producto, "10", "4", "CARGA_INICIAL"));
      for (const motivo of ["DEVOLUCION_DE_CLIENTE", "OTRA_ENTRADA"]) {
        expect(await entrada(n.dep, n.producto, "1", "4", motivo), motivo).toEqual({
          ok: false,
          error: "COSTO_INVALIDO",
        });
        // Sin costo esos motivos entran: quedan sin costo.
        const sin = valorDe(await entrada(n.dep, n.producto, "1", undefined, motivo));
        expect(await unicoCostoDe(sin.movimientoId)).toMatchObject({ estado: "SIN_COSTO" });
      }
      expect(
        await c.casos.registrarSalida(e.gerente, {
          clave: nuevoId(),
          depositoId: n.dep,
          motivo: "MERMA",
          renglones: [renglon(n.producto, "1", "4")],
        }),
      ).toEqual({ ok: false, error: "COSTO_INVALIDO" });
      expect(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: n.dep,
          destinoId: destino,
          renglones: [renglon(n.producto, "1", "4")],
        }),
      ).toEqual({ ok: false, error: "COSTO_INVALIDO" });
      expect(
        await c.casos.ajustar(e.gerente, {
          clave: nuevoId(),
          depositoId: n.dep,
          detalle: "Ajuste",
          renglones: [{ ...renglon(n.producto, "1", "4"), sentido: "SUMA" }],
        }),
      ).toEqual({ ok: false, error: "COSTO_INVALIDO" });
    });

    it("el costo es por unidad de stock: con otra unidad en el renglón es COSTO_INVALIDO; sin costo, la conversión sigue siendo exacta", async () => {
      const dep = await c.deposito(e);
      const kilos = await c.articulo(e, { unidadBase: "KILOGRAMO", dimension: "MASA" });
      expect(
        await c.casos.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [
            { productoId: kilos.producto, cantidad: "500", unidadId: "GRAMO", costoUnitario: "2" },
          ],
        }),
      ).toEqual({ ok: false, error: "COSTO_INVALIDO" });
      valorDe(
        await c.casos.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [
            {
              productoId: kilos.producto,
              cantidad: "2",
              unidadId: "KILOGRAMO",
              costoUnitario: "1500.5",
            },
          ],
        }),
      );
      expect(await estadoDe(dep, kilos.articulo)).toEqual({
        costo_unitario: "1500.500000",
        cantidad_valorizada: "2.0000",
      });
    });
  });

  // ---- concurrencia ---------------------------------------------------------------------------------------------------------------

  describe("concurrencia", () => {
    it("dos entradas a la vez con costo distinto promedian las dos, sin perder ninguna (cantidad valorizada y promedio exactos)", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await nuevo();
        valorDe(await entrada(n.dep, n.producto, "10", "4"));
        const a = () => firme(() => entrada(n.dep, n.producto, "10", "6"));
        const b = () => firme(() => entrada(n.dep, n.producto, "10", "9"));
        const resultados = await aLaVez(c, [a, b], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(await c.existencia(n.dep, n.articulo)).toBe("30.0000");
        // (10 × 4 + 10 × 6 + 10 × 9) ÷ 30 = 6,333333 en cualquier orden; si una pisara a la otra quedarían 20 valorizadas.
        expect(await estadoDe(n.dep, n.articulo)).toEqual({
          costo_unitario: "6.333333",
          cantidad_valorizada: "30.0000",
        });
        expect(
          await c.contar(
            `select count(*) as n from costo_de_renglon r
               join renglon_de_movimiento g on g.empresa_id = r.empresa_id and g.movimiento_id = r.movimiento_id and g.numero = r.numero
              where g.deposito_id = $1 and g.articulo_id = $2`,
            [n.dep, n.articulo],
          ),
        ).toBe(3);
      }
    });

    it("P23: dos salidas a la vez congelan el mismo promedio y bajan lo valorizado las dos veces", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await nuevo();
        valorDe(await entrada(n.dep, n.producto, "10", "5"));
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => salida(n.dep, n.producto, "2")),
            () => firme(() => salida(n.dep, n.producto, "3")),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        for (const resultado of resultados) {
          const movimiento = valorDe(resultado);
          expect(await unicoCostoDe(movimiento.movimientoId)).toMatchObject({
            estado: "DEFINITIVO",
            costo_unitario: "5.000000",
          });
        }
        expect(await estadoDe(n.dep, n.articulo)).toEqual({
          costo_unitario: "5.000000",
          cantidad_valorizada: "5.0000",
        });
      }
    });

    it("una entrada con costo y una salida a la vez: la salida congela el promedio de antes o de después, nunca uno a medias, y lo valorizado cuadra", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await nuevo();
        valorDe(await entrada(n.dep, n.producto, "10", "4"));
        const salidas: string[] = [];
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => entrada(n.dep, n.producto, "10", "6")),
            async () => {
              const r = await firme(() => salida(n.dep, n.producto, "5"));
              if (r.ok) salidas.push(r.valor.movimientoId);
              return r;
            },
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        const congelado = (await unicoCostoDe(salidas[0] as string))?.costo_unitario;
        // Antes de la entrada: 4; después: 5 (el promedio de 10 × 4 y 10 × 6).
        expect(["4.000000", "5.000000"]).toContain(congelado);
        expect(await c.existencia(n.dep, n.articulo)).toBe("15.0000");
        expect((await estadoDe(n.dep, n.articulo))?.cantidad_valorizada).toBe("15.0000");
      }
    });
  });

  // ---- idempotencia ---------------------------------------------------------------------------------------------------------------

  describe("idempotencia", () => {
    it("I13: repetir una entrada con costo con la misma clave deja un solo efecto (un promedio, un costo congelado); con otro costo, CLAVE_REUTILIZADA", async () => {
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "10", "4"));
      const pedido = {
        clave: nuevoId(),
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [renglon(n.producto, "10", "6")],
      };
      const primera = valorDe(await c.casos.registrarEntrada(e.gerente, pedido));
      const segunda = valorDe(await c.casos.registrarEntrada(e.gerente, pedido));
      expect(primera.yaExistia).toBe(false);
      expect(segunda).toEqual({ movimientoId: primera.movimientoId, yaExistia: true });
      expect(await costosDe(primera.movimientoId)).toHaveLength(1);
      expect(await c.existencia(n.dep, n.articulo)).toBe("20.0000");
      // El promedio se calculó una sola vez: (10 × 4 + 10 × 6) ÷ 20 = 5 y 20 valorizadas.
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "20.0000",
      });
      // Otro costo con la misma clave no es una repetición.
      expect(
        await c.casos.registrarEntrada(e.gerente, {
          ...pedido,
          renglones: [renglon(n.producto, "10", "7")],
        }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      // Sin costo con la misma clave tampoco.
      expect(
        await c.casos.registrarEntrada(e.gerente, {
          ...pedido,
          renglones: [renglon(n.producto, "10")],
        }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "20.0000",
      });
    });

    it("I13: la misma entrada con costo a la vez (clic doble) deja un solo efecto", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await nuevo();
        const pedido = {
          clave: nuevoId(),
          depositoId: n.dep,
          motivo: "COMPRA",
          renglones: [renglon(n.producto, "10", "4")],
        };
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => c.casos.registrarEntrada(e.gerente, pedido)),
            () => firme(() => c.casos.registrarEntrada(e.gerente, pedido)),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(resultados.map((r) => valorDe(r).yaExistia).sort()).toEqual([false, true]);
        expect(await c.existencia(n.dep, n.articulo)).toBe("10.0000");
        expect(await estadoDe(n.dep, n.articulo)).toEqual({
          costo_unitario: "4.000000",
          cantidad_valorizada: "10.0000",
        });
      }
    });

    it("anular dos veces la misma entrada con costo saca su costo una sola vez", async () => {
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "10", "4"));
      const entra = valorDe(await entrada(n.dep, n.producto, "10", "6"));
      const pedido = { clave: nuevoId(), movimientoId: entra.movimientoId, detalle: "Error" };
      const primera = valorDe(await c.casos.anularMovimiento(e.gerente, pedido));
      const segunda = valorDe(await c.casos.anularMovimiento(e.gerente, pedido));
      expect(segunda).toEqual({ anulacionId: primera.anulacionId, yaExistia: true });
      expect(await costosDe(primera.anulacionId)).toHaveLength(1);
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "5.000000",
        cantidad_valorizada: "10.0000",
      });
    });
  });

  // ---- las consultas --------------------------------------------------------------------------------------------------------------

  describe("consultas (`costos.ver`)", () => {
    it("solo el gerente y el administrador ven costos; el operador no, y lo que no tiene permiso no devuelve nada", async () => {
      const m = await c.escenario();
      const n = await nuevo(m);
      const entra = valorDe(await entrada(n.dep, n.producto, "10", "4", "COMPRA", m.gerente));
      for (const quien of [m.operador]) {
        expect(await c.consultas.existenciaValorizada(quien)).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(
          await c.consultas.costoDeRenglon(quien, { movimientoId: entra.movimientoId, numero: 1 }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(await c.consultas.ultimoCostoDeCompra(quien, { articuloId: n.articulo })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      }
      for (const quien of [m.gerente, m.administrador]) {
        expect(valorDe(await c.consultas.existenciaValorizada(quien)).valor).toBe("40.00");
        expect(
          valorDe(
            await c.consultas.costoDeRenglon(quien, {
              movimientoId: entra.movimientoId,
              numero: 1,
            }),
          ),
        ).toEqual({ estado: "DEFINITIVO", moneda: "ARS", costoUnitario: "4.000000" });
      }
    });

    it("la existencia valorizada da el valor de lo que tiene costo y cuántos pares tienen unidades sin costo (dos números), redondeado una vez al centavo", async () => {
      const m = await c.escenario();
      const dep = await c.deposito(m);
      const otro = await c.deposito(m);
      const a = await c.articulo(m);
      const b = await c.articulo(m);
      const sinCosto = await c.articulo(m);
      // 3 × 0,333333 + 7 × 1,111111 = 0,999999 + 7,777777 = 8,777776 → 8,78.
      valorDe(await entrada(dep, a.producto, "3", "0.333333", "COMPRA", m.gerente));
      valorDe(await entrada(dep, b.producto, "7", "1.111111", "COMPRA", m.gerente));
      // Una mitad con costo y otra sin: 10 sin costo + 10 a 2 = 20 en existencia y 20 de valor sobre las 10 valorizadas.
      valorDe(await entrada(otro, b.producto, "10", undefined, "COMPRA", m.gerente));
      valorDe(await entrada(otro, b.producto, "10", "2", "COMPRA", m.gerente));
      valorDe(await entrada(otro, sinCosto.producto, "4", undefined, "COMPRA", m.gerente));
      expect(valorDe(await c.consultas.existenciaValorizada(m.gerente))).toEqual({
        moneda: "ARS",
        valor: "28.78",
        paresConUnidadesSinCosto: 2,
      });
      // Un solo depósito.
      expect(
        valorDe(await c.consultas.existenciaValorizada(m.gerente, { depositoId: dep })),
      ).toEqual({
        moneda: "ARS",
        valor: "8.78",
        paresConUnidadesSinCosto: 0,
      });
      // Un id mal formado no da todo: da vacío.
      expect(
        valorDe(await c.consultas.existenciaValorizada(m.gerente, { depositoId: "no-es-uuid" })),
      ).toEqual({ moneda: "ARS", valor: "0.00", paresConUnidadesSinCosto: 0 });
    });

    it("la existencia valorizada respeta el alcance de sucursales de quien pide (un administrador de una sola sucursal no ve la otra)", async () => {
      const m = await c.escenario();
      const propio = await c.deposito(m);
      const ajeno = await c.deposito(m, { sucursal: m.otraSucursal });
      const a = await c.articulo(m);
      valorDe(await entrada(propio, a.producto, "2", "10", "COMPRA", m.gerente));
      valorDe(await entrada(ajeno, a.producto, "5", "10", "COMPRA", m.gerente));
      expect(valorDe(await c.consultas.existenciaValorizada(m.gerente)).valor).toBe("70.00");
      expect(
        valorDe(await c.consultas.existenciaValorizada(m.administradorDeUnaSucursal)).valor,
      ).toBe("20.00");
    });

    it("el costo de un renglón: `SIN_COSTO` no es cero; un renglón que no existe, uno de otro depósito fuera del alcance o con datos mal formados da null", async () => {
      const m = await c.escenario();
      const propio = await c.deposito(m);
      const ajeno = await c.deposito(m, { sucursal: m.otraSucursal });
      const a = await c.articulo(m);
      const sin = valorDe(await entrada(propio, a.producto, "2", undefined, "COMPRA", m.gerente));
      const del_ajeno = valorDe(await entrada(ajeno, a.producto, "2", "9", "COMPRA", m.gerente));
      expect(
        valorDe(
          await c.consultas.costoDeRenglon(m.gerente, {
            movimientoId: sin.movimientoId,
            numero: 1,
          }),
        ),
      ).toEqual({ estado: "SIN_COSTO" });
      for (const entrada_ of [
        { movimientoId: sin.movimientoId, numero: 2 },
        { movimientoId: nuevoId(), numero: 1 },
        { movimientoId: "no-es-uuid", numero: 1 },
        { movimientoId: sin.movimientoId, numero: 1.5 },
      ]) {
        expect(
          valorDe(await c.consultas.costoDeRenglon(m.gerente, entrada_)),
          JSON.stringify(entrada_),
        ).toBeNull();
      }
      expect(
        valorDe(
          await c.consultas.costoDeRenglon(m.administradorDeUnaSucursal, {
            movimientoId: del_ajeno.movimientoId,
            numero: 1,
          }),
        ),
      ).toBeNull();
    });

    it("el último costo de compra es el de la compra con costo más reciente: no cuenta la carga inicial, las entradas sin costo ni la compra anulada", async () => {
      const m = await c.escenario();
      const dep = await c.deposito(m);
      const a = await c.articulo(m);
      const ultimo = (articuloId: string) =>
        c.consultas.ultimoCostoDeCompra(m.gerente, { articuloId }).then(valorDe);
      expect(await ultimo(a.articulo)).toBeNull();
      valorDe(await entrada(dep, a.producto, "1", "7", "CARGA_INICIAL", m.gerente));
      expect(await ultimo(a.articulo)).toBeNull();
      const primera = valorDe(await entrada(dep, a.producto, "1", "10", "COMPRA", m.gerente));
      expect(await ultimo(a.articulo)).toMatchObject({
        articuloId: a.articulo,
        moneda: "ARS",
        costoUnitario: "10.000000",
        movimientoId: primera.movimientoId,
      });
      const segunda = valorDe(await entrada(dep, a.producto, "1", "12.5", "COMPRA", m.gerente));
      valorDe(await entrada(dep, a.producto, "1", undefined, "COMPRA", m.gerente));
      expect(await ultimo(a.articulo)).toMatchObject({
        costoUnitario: "12.500000",
        movimientoId: segunda.movimientoId,
      });
      valorDe(
        await c.casos.anularMovimiento(m.gerente, {
          clave: nuevoId(),
          movimientoId: segunda.movimientoId,
          detalle: "Factura mal cargada",
        }),
      );
      expect(await ultimo(a.articulo)).toMatchObject({
        costoUnitario: "10.000000",
        movimientoId: primera.movimientoId,
      });
      expect(
        valorDe(await c.consultas.ultimoCostoDeCompra(m.gerente, { articuloId: "no-es-uuid" })),
      ).toBeNull();
    });
  });

  // ---- aislamiento ----------------------------------------------------------------------------------------------------------------

  describe("aislamiento entre empresas", () => {
    it("la empresa B no ve ni toca los costos de la A (consultas y SQL con el rol de la aplicación), y un costo no puede apuntar al saldo de otra empresa", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const n = await nuevo(a);
      const entra = valorDe(await entrada(n.dep, n.producto, "10", "4", "COMPRA", a.gerente));
      expect(valorDe(await c.consultas.existenciaValorizada(b.gerente)).valor).toBe("0.00");
      expect(
        valorDe(
          await c.consultas.costoDeRenglon(b.gerente, {
            movimientoId: entra.movimientoId,
            numero: 1,
          }),
        ),
      ).toBeNull();
      expect(
        valorDe(await c.consultas.ultimoCostoDeCompra(b.gerente, { articuloId: n.articulo })),
      ).toBeNull();
      for (const tabla of ["costo_de_articulo", "costo_de_renglon"]) {
        const visto = await c.entorno.ejecutar({ contexto: b.gerente }, async (tx) => {
          const { rows } = await sql<{
            n: string;
          }>`select count(*)::text as n from ${sql.table(tabla)} where empresa_id = ${a.empresa}`.execute(
            tx.db,
          );
          return ok(Number(rows[0]?.n));
        });
        expect(visto, tabla).toEqual({ ok: true, valor: 0 });
      }
      const intrusion = await c.entorno.ejecutar({ contexto: b.gerente }, async (tx) => {
        await sql`insert into costo_de_articulo (empresa_id, deposito_id, articulo_id, costo_unitario, cantidad_valorizada)
                  values (${a.empresa}, ${n.dep}, ${n.articulo}, 1, 1)`.execute(tx.db);
        return ok(null);
      });
      expect(intrusion.ok).toBe(false);
      // Con SQL del dueño (que evade la RLS) la clave foránea al saldo igual lo frena: el par no existe en la empresa B.
      await expect(
        c.dueno.query(
          `insert into costo_de_articulo (empresa_id, deposito_id, articulo_id, costo_unitario, cantidad_valorizada)
           values ($1, $2, $3, 1, 1)`,
          [b.empresa, n.dep, n.articulo],
        ),
      ).rejects.toMatchObject({ constraint: "costo_de_articulo_saldo_fkey" });
      expect(await estadoDe(n.dep, n.articulo)).toEqual({
        costo_unitario: "4.000000",
        cantidad_valorizada: "10.0000",
      });
    });

    it("el promedio de un depósito no es el de otro: el mismo artículo en dos depósitos y dos empresas lleva promedios separados", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const enA = await nuevo(a);
      const otroDeA = await c.deposito(a);
      const enB = await nuevo(b);
      valorDe(await entrada(enA.dep, enA.producto, "1", "10", "COMPRA", a.gerente));
      valorDe(await entrada(otroDeA, enA.producto, "1", "20", "COMPRA", a.gerente));
      valorDe(await entrada(enB.dep, enB.producto, "1", "30", "COMPRA", b.gerente));
      expect((await estadoDe(enA.dep, enA.articulo))?.costo_unitario).toBe("10.000000");
      expect((await estadoDe(otroDeA, enA.articulo))?.costo_unitario).toBe("20.000000");
      expect((await estadoDe(enB.dep, enB.articulo))?.costo_unitario).toBe("30.000000");
    });
  });

  // ---- la base --------------------------------------------------------------------------------------------------------------------

  describe("lo que la base impone sola (0031)", () => {
    it("el costo congelado es de solo inserción: ni el dueño lo modifica, lo borra ni lo vacía; el promedio no se borra ni se vacía", async () => {
      const n = await nuevo();
      const entra = valorDe(await entrada(n.dep, n.producto, "10", "4"));
      for (const texto of [
        `update costo_de_renglon set estado = 'SIN_COSTO', costo_unitario = null where movimiento_id = '${entra.movimientoId}'`,
        `delete from costo_de_renglon where movimiento_id = '${entra.movimientoId}'`,
        "truncate costo_de_renglon",
        `delete from costo_de_articulo where deposito_id = '${n.dep}'`,
        "truncate costo_de_articulo",
      ]) {
        await expect(c.dueno.query(texto), texto).rejects.toBeInstanceOf(Error);
      }
      expect(await unicoCostoDe(entra.movimientoId)).toMatchObject({ costo_unitario: "4.000000" });
      expect(await estadoDe(n.dep, n.articulo)).not.toBeNull();
    });

    it("el costo de un renglón solo entra en la misma transacción que su movimiento", async () => {
      const n = await nuevo();
      // Un movimiento ya confirmado (escrito sin pasar por el caso de uso: sin costo cargado).
      const movimiento = valorDe(
        await c.entrar(e.gerente, { depositoId: n.dep, articuloId: n.articulo, cantidad: "3" }),
      );
      await expect(
        c.dueno.query(
          `insert into costo_de_renglon (empresa_id, movimiento_id, numero, estado, costo_unitario)
           values ($1, $2, 1, 'DEFINITIVO', 1)`,
          [e.empresa, movimiento.id],
        ),
      ).rejects.toMatchObject({ constraint: "costo_de_renglon_movimiento_confirmado" });
    });

    it("las restricciones de forma: estado y costo coherentes, costo no negativo ni NaN ni fuera de rango, moneda ARS, cantidad valorizada acotada", async () => {
      const n = await nuevo();
      const entra = valorDe(await entrada(n.dep, n.producto, "10", "4"));
      const intentos: ReadonlyArray<readonly [string, string, unknown[]]> = [
        [
          "costo_de_articulo_costo_ck",
          "update costo_de_articulo set costo_unitario = -1 where deposito_id = $1 and articulo_id = $2",
          [n.dep, n.articulo],
        ],
        [
          "costo_de_articulo_costo_ck",
          "update costo_de_articulo set costo_unitario = 'NaN' where deposito_id = $1 and articulo_id = $2",
          [n.dep, n.articulo],
        ],
        [
          "costo_de_articulo_cantidad_ck",
          "update costo_de_articulo set cantidad_valorizada = -0.0001 where deposito_id = $1 and articulo_id = $2",
          [n.dep, n.articulo],
        ],
        [
          "costo_de_articulo_cantidad_ck",
          "update costo_de_articulo set cantidad_valorizada = 'NaN' where deposito_id = $1 and articulo_id = $2",
          [n.dep, n.articulo],
        ],
        [
          "costo_de_articulo_moneda_ck",
          "update costo_de_articulo set moneda = 'USD' where deposito_id = $1 and articulo_id = $2",
          [n.dep, n.articulo],
        ],
      ];
      for (const [restriccion, texto, parametros] of intentos) {
        await expect(
          c.dueno.query(texto, parametros),
          `${restriccion}: ${texto}`,
        ).rejects.toMatchObject({
          constraint: restriccion,
        });
      }
      // Las del costo congelado, en la misma transacción de un movimiento nuevo (con SQL del dueño): si no, el disparador de «misma transacción»
      // rechazaría antes que las restricciones de forma.
      void entra;
      const mundo = await c.dueno.query<{ persona: string }>(
        "select registrado_por as persona from movimiento_de_stock where empresa_id = $1 limit 1",
        [e.empresa],
      );
      await c.dueno.query("begin");
      try {
        const nuevoMovimiento = await escribirMovimiento(
          async (texto, parametros) => {
            const r = await c.dueno.query(texto, parametros);
            return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
          },
          e.empresa,
          {
            clase: "ENTRADA",
            motivo: "COMPRA",
            deposito: n.dep,
            persona: mundo.rows[0]?.persona as string,
            renglones: [{ articulo: n.articulo, cantidad: "1" }],
          },
        );
        const renglonDe = (estado: string, costo: string) =>
          `insert into costo_de_renglon (empresa_id, movimiento_id, numero, estado, costo_unitario) values ($1, $2, 1, '${estado}', ${costo})`;
        for (const [restriccion, texto] of [
          ["costo_de_renglon_estado_ck", renglonDe("OTRO", "1")],
          ["costo_de_renglon_estado_y_costo_ck", renglonDe("SIN_COSTO", "1")],
          ["costo_de_renglon_estado_y_costo_ck", renglonDe("DEFINITIVO", "null")],
          ["costo_de_renglon_costo_ck", renglonDe("DEFINITIVO", "-1")],
          ["costo_de_renglon_costo_ck", renglonDe("DEFINITIVO", "'NaN'")],
        ] as const) {
          await c.dueno.query("savepoint intento");
          await expect(
            c.dueno.query(texto, [e.empresa, nuevoMovimiento.id]),
            texto,
          ).rejects.toMatchObject({ constraint: restriccion });
          await c.dueno.query("rollback to savepoint intento");
        }
        // Y el válido, en la misma transacción, entra (el disparador de «misma transacción» no lo frena).
        await c.dueno.query(renglonDe("DEFINITIVO", "1.5"), [e.empresa, nuevoMovimiento.id]);
        await c.dueno.query(
          "select 1 from costo_de_renglon where movimiento_id = $1 and costo_unitario = 1.5",
          [nuevoMovimiento.id],
        );
      } finally {
        await c.dueno.query("rollback");
      }
    });

    it("con el rol de la aplicación: no borra ni cambia un costo congelado, no toca la moneda ni inventa un promedio sin saldo, y la RLS está forzada", async () => {
      const n = await nuevo();
      const entra = valorDe(await entrada(n.dep, n.producto, "10", "4"));
      const comoApp = (texto: ReturnType<typeof sql>) =>
        c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
          await texto.execute(tx.db);
          return ok(null);
        });
      const prohibidas = [
        sql`delete from costo_de_renglon where movimiento_id = ${entra.movimientoId}`,
        sql`update costo_de_renglon set costo_unitario = 1 where movimiento_id = ${entra.movimientoId}`,
        sql`delete from costo_de_articulo where deposito_id = ${n.dep}`,
        sql`update costo_de_articulo set moneda = 'ARS' where deposito_id = ${n.dep}`,
        sql`update costo_de_articulo set empresa_id = ${e.empresa} where deposito_id = ${n.dep}`,
        sql`insert into costo_de_articulo (empresa_id, deposito_id, articulo_id, costo_unitario, cantidad_valorizada, moneda)
            values (${e.empresa}, ${n.dep}, ${n.articulo}, 1, 1, 'ARS')`,
      ];
      for (const intento of prohibidas) {
        expect((await comoApp(intento)).ok).toBe(false);
      }
      // Un promedio para un par que nunca tuvo saldo lo frena la clave foránea al saldo.
      const sinSaldo = await nuevo();
      expect(
        (
          await comoApp(
            sql`insert into costo_de_articulo (empresa_id, deposito_id, articulo_id, costo_unitario, cantidad_valorizada)
                values (${e.empresa}, ${sinSaldo.dep}, ${sinSaldo.articulo}, 1, 1)`,
          )
        ).ok,
      ).toBe(false);
      const { rows } = await c.dueno.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relname in ('costo_de_articulo', 'costo_de_renglon') order by relname`,
      );
      expect(rows).toEqual([
        { relname: "costo_de_articulo", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "costo_de_renglon", relrowsecurity: true, relforcerowsecurity: true },
      ]);
      const { rows: politicas } = await c.dueno.query<{ tablename: string; cmd: string }>(
        `select tablename, cmd from pg_policies where tablename in ('costo_de_articulo', 'costo_de_renglon') order by tablename, cmd`,
      );
      expect(politicas).toEqual([
        { tablename: "costo_de_articulo", cmd: "INSERT" },
        { tablename: "costo_de_articulo", cmd: "SELECT" },
        { tablename: "costo_de_articulo", cmd: "UPDATE" },
        { tablename: "costo_de_renglon", cmd: "INSERT" },
        { tablename: "costo_de_renglon", cmd: "SELECT" },
      ]);
    });

    it("sobre una base con 0030 sube, baja (deja el esquema como antes), sube de nuevo; con costos la reversión pide confirmar; frena si una tabla ya existe; y declara que es destructiva", async () => {
      const previa = await baseConMigraciones(
        b(),
        (await readdir(CARPETA_DE_MIGRACIONES))
          .filter((nombre) => /^\d{4}_.*\.sql$/.test(nombre) && nombre < ARCHIVO)
          .sort(),
      );
      const conMia = await carpetaCon([
        ...(await readdir(CARPETA_DE_MIGRACIONES))
          .filter((nombre) => /^\d{4}_.*\.sql$/.test(nombre) && nombre < ARCHIVO)
          .sort(),
        ARCHIVO,
      ]);
      try {
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const cliente = previa.cliente;
        const antes = await huellaDeCatalogo(cliente);
        const reversion = await readFile(
          join(CARPETA_DE_MIGRACIONES, "reversiones", "0031_revertir_stock_costos.sql"),
          "utf8",
        );
        const fila = async () =>
          (await cliente.query("select 1 from migracion where nombre = $1", [ARCHIVO])).rows.length;

        // Defensa: si alguien creó una de las tablas a mano, frena sin cambiar nada.
        await cliente.query("create table costo_de_renglon (x int)");
        await expect(aplicarMigraciones(previa.aparte.base.dueno, conMia)).rejects.toThrow(
          /la tabla costo_de_renglon ya existe/,
        );
        await cliente.query("drop table costo_de_renglon");
        expect(await fila()).toBe(0);
        expect(await huellaDeCatalogo(cliente)).toEqual(antes);

        // Sube, baja sin datos (no pide nada) y vuelve a subir.
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await fila()).toBe(1);
        const conCostos = await huellaDeCatalogo(cliente);
        expect(conCostos).not.toEqual(antes);
        await cliente.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(cliente)).toEqual(antes);
        expect(await fila()).toBe(0);
        const otraVez = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otraVez.aplicadas).toEqual([ARCHIVO]);
        expect(await huellaDeCatalogo(cliente)).toEqual(conCostos);

        // Con un promedio cargado: sin confirmar no borra nada.
        const mundo = await crearMundo(cliente);
        const dep = await depositoDeBase(cliente, mundo);
        const art = await articuloDeBase(cliente, mundo);
        await cliente.query("begin");
        const escrito = await escribirMovimiento(
          async (texto, parametros) => {
            const r = await cliente.query(texto, parametros);
            return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
          },
          mundo.empresa,
          {
            clase: "ENTRADA",
            motivo: "COMPRA",
            deposito: dep,
            persona: mundo.persona,
            renglones: [{ articulo: art.articulo, cantidad: "3" }],
          },
        );
        await cliente.query(
          `insert into costo_de_renglon (empresa_id, movimiento_id, numero, estado, costo_unitario) values ($1, $2, 1, 'DEFINITIVO', 2)`,
          [mundo.empresa, escrito.id],
        );
        await cliente.query(
          `insert into costo_de_articulo (empresa_id, deposito_id, articulo_id, costo_unitario, cantidad_valorizada) values ($1, $2, $3, 2, 3)`,
          [mundo.empresa, dep, art.articulo],
        );
        await cliente.query("commit");
        await cliente.query("begin");
        await expect(cliente.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/avisar al dueño/) as string,
        });
        await cliente.query("rollback");
        expect(
          (await cliente.query("select count(*)::int as n from costo_de_articulo")).rows[0],
        ).toEqual({ n: 1 });
        expect(await fila()).toBe(1);
        // Confirmada: borra las dos tablas, deja 0030 intacta y se puede repetir.
        await cliente.query(
          `begin; set local pedernal.confirmar_reversion = 'SI'; ${reversion}; commit;`,
        );
        expect(await huellaDeCatalogo(cliente)).toEqual(antes);
        expect(
          (await cliente.query("select count(*)::int as n from renglon_de_movimiento")).rows[0],
        ).toEqual({ n: 1 });
        await cliente.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(cliente)).toEqual(antes);

        // La reversión se declara destructiva, no se recupera, no usa CASCADE ni TRUNCATE y su único DELETE es el de su fila del registro.
        const plano = reversion.replace(/\n--\s*/g, " ");
        expect(plano).toMatch(/DESTRUCTIVA/);
        expect(plano).toMatch(/NO\s+SE RECUPERA/);
        expect(plano).toMatch(/NO lo aplica el ejecutor de migraciones/);
        const codigo = reversion.replace(/--.*$/gm, "");
        const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
        expect(borrados).toHaveLength(1);
        expect(borrados[0]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
        expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    });
  });
});
