import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeProduccion,
  crearConsultasDeProduccion,
  crearRepositoriosDeProduccion,
} from "../../src/modulos/produccion/publico";
import { randomUUID } from "node:crypto";
import { registrarMovimientoEnTx } from "../../src/modulos/stock/casos-de-uso/movimiento-en-tx";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { llaveDeSaldo } from "../../src/modulos/stock/persistencia/repositorio-de-movimientos";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import { productoDeBase } from "./catalogo-apoyo";
import type { BaseDePruebas } from "./global";
import { montarStock, nuevoId, valorDe, type EscenarioDeStock } from "./stock-casos-apoyo";

/**
 * Apoyo de las pruebas de integración de producción (E6-T8): el montaje de stock con el módulo `produccion` ACTIVO y su perilla encendida, los casos de
 * uso y las consultas REALES de producción sobre la misma transacción (la orden y los movimientos del libro son una sola), y un escenario de panadería:
 * harina y manteca (en kilos), una masa elaborada con stock propio y su receta, un depósito de origen y uno de destino. Todo con la base real.
 */
const REGLAS_DE_PRODUCCION: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
    stock: { ...CATALOGO_DE_MODULOS.stock, estado: "disponible" },
    produccion: { ...CATALOGO_DE_MODULOS.produccion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

export async function montarProduccion(base: BaseDePruebas) {
  const c = await montarStock(base, {
    reglas: REGLAS_DE_PRODUCCION,
    repositoriosExtra: (db) => crearRepositoriosDeProduccion(db),
    modulosExtra: ["produccion"],
  });
  c.encenderPerilla("produccion");
  const transacciones = c.entorno as never;
  const produccion = crearCasosDeUsoDeProduccion({ transacciones, reglas: REGLAS_DE_PRODUCCION });
  const consultasDeProduccion = crearConsultasDeProduccion({
    transacciones,
    reglas: REGLAS_DE_PRODUCCION,
  });

  const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;

  /** Una empresa de panadería: ingredientes, masa con stock propio y receta, y los dos depósitos de la orden. */
  const panaderia = async (
    e: EscenarioDeStock,
    datos: Readonly<{ rinde?: string; deVenta?: boolean }> = {},
  ) => {
    const harina = await c.articulo(e, { clase: "MATERIA_PRIMA", ...kilos });
    const manteca = await c.articulo(e, { clase: "MATERIA_PRIMA", ...kilos });
    const masa = await c.articulo(e, { clase: "ELABORADO", ...kilos });
    valorDe(
      await c.casos.guardarComposicion(e.gerente, {
        productoId: masa.producto,
        versionEsperada: 0,
        rinde: datos.rinde ?? "8",
        componentes: [
          { productoId: harina.producto, cantidad: "6", unidadId: "KILOGRAMO" },
          { productoId: manteca.producto, cantidad: "2", unidadId: "KILOGRAMO" },
        ],
      }),
    );
    const origen = await c.deposito(e, { deVenta: datos.deVenta ?? false });
    const destino = await c.deposito(e);
    return { harina, manteca, masa, origen, destino };
  };

  /** Compra con costo por el caso de uso real (fija el último costo de compra y el promedio). */
  const comprar = async (
    e: EscenarioDeStock,
    deposito: string,
    producto: string,
    cantidad: string,
    costoUnitario?: string,
  ) =>
    valorDe(
      await c.casos.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: deposito,
        motivo: "COMPRA",
        renglones: [
          {
            productoId: producto,
            cantidad,
            unidadId: "KILOGRAMO",
            ...(costoUnitario === undefined ? {} : { costoUnitario }),
          },
        ],
      }),
    );

  /** Una entrada de un artículo con control de lote, con su lote y vencimiento, por el núcleo del libro (lo que hará la recepción de compras). */
  const entrarConLote = async (
    e: EscenarioDeStock,
    deposito: string,
    articulo: string,
    lote: Readonly<{ codigo: string; vence: string }>,
    cantidad: string,
  ) => {
    const q = cantidadConSignoDesdeTexto(cantidad);
    if (!q.ok) throw new Error(cantidad);
    const r = await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
      registrarMovimientoEnTx(tx, e.gerente, {
        clase: "ENTRADA",
        motivo: "COMPRA",
        detalle: null,
        origen: null,
        depositoId: deposito,
        accion: "stock.registrar_entrada",
        anulaA: null,
        conteoId: null,
        clave: randomUUID(),
        huella: huellaDeComando(
          "entrada",
          [deposito, cantidad, lote.codigo],
          [[articulo, cantidad]],
        ),
        hechoEn: e.gerente.ahora,
        fechaDeNegocio: null,
        renglones: [
          { depositoId: deposito, articuloId: articulo, composicionId: null, cantidad: q.valor },
        ],
        confirmaciones: [],
        lotes: {
          entradas: new Map([
            [
              llaveDeSaldo(deposito, articulo),
              [{ codigo: lote.codigo, fechaDeVencimiento: lote.vence, cantidad }],
            ],
          ]),
        },
      }),
    );
    if (!JSON.stringify(r).includes('"ok":true')) throw new Error(JSON.stringify(r));
  };

  /** Casos de uso de producción con una falla inyectada en la transacción (para probar que no queda nada a medias). */
  const casosConFalla = (parchar: (tx: never) => object) =>
    crearCasosDeUsoDeProduccion({
      transacciones: {
        ejecutar: (opciones: never, trabajo: (tx: never) => Promise<never>) =>
          (
            c.entorno as never as {
              ejecutar: (o: never, t: (tx: never) => Promise<never>) => Promise<never>;
            }
          ).ejecutar(opciones, (tx) => trabajo({ ...(tx as object), ...parchar(tx) } as never)),
      } as never,
      reglas: REGLAS_DE_PRODUCCION,
    });

  /** Un producto vendible con receta (para las pruebas de «no se produce»). */
  const vendible = (e: EscenarioDeStock) =>
    productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });

  return {
    ...c,
    produccion,
    consultasDeProduccion,
    panaderia,
    comprar,
    entrarConLote,
    casosConFalla,
    vendible,
    kilos,
  };
}

export type MontajeDeProduccion = Awaited<ReturnType<typeof montarProduccion>>;
