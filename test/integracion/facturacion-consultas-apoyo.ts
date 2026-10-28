import type pg from "pg";
import type { Kysely } from "kysely";
import { sql, type KyselyPlugin } from "kysely";
import {
  crearAutorizacionDePostgres,
  type AutorizacionDb,
} from "../../src/adaptadores/postgres/autorizacion";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import {
  crearConsultasDeFacturacion,
  crearLecturasDeComprobantes,
  crearRepositorioDeComprobantes,
  crearRepositorioDeIntentos,
  crearRepositorioDeSeries,
  type ConsultasDeFacturacion,
  type FiscalDb,
  type MarcaParaImprimir,
  type TxDeConsultasDeFacturacion,
} from "../../src/modulos/fiscal/publico";
import type { ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import {
  confirmarDueno,
  datosDeComprobante,
  insertarComprobante,
  viaDueno,
  type Escenario,
} from "./facturacion-apoyo";
import { crearPuntoDeVenta } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { REGLAS_CON_FACTURACION, conFacturacion } from "./fiscal-numeracion-apoyo";

/**
 * Apoyo de las pruebas de las consultas del facturador (F6). Lo que recibe una consulta es lo que armaría la
 * composición real (repositorios y lecturas sobre la conexión de la transacción, la autorización real con el
 * módulo activado y habilitado) más el `db` crudo, que solo sirve para que la prueba mire cómo se abrió la
 * transacción. La marca es un falso: fiscal no lee `marcas`, lo hace la composición.
 */
type TxDeConsultasDePrueba = TxDeConsultasDeFacturacion & Readonly<{ db: Kysely<SinTablas> }>;

/** Cómo estaba abierta la transacción en la que una consulta pidió la marca (la última vez que lo hizo). */
type EstadoDeLaTransaccion = Readonly<{ soloLectura: string; aislamiento: string }>;

export type EntornoDeConsultas = Readonly<{
  transacciones: TransaccionesDePostgres<TxDeConsultasDePrueba>;
  /** La marca que devolverá la próxima consulta de impresión. */
  usarMarca(marca: MarcaParaImprimir): void;
  /** La transacción de la última consulta que pidió la marca. */
  ultimoEstadoVisto(): EstadoDeLaTransaccion | null;
  /** Cuántas consultas SQL de los repositorios y lecturas fiscales se ejecutaron hasta ahora (para medir un N+1). */
  consultasFiscalesHechas(): number;
  consultas(reglas?: ReglasDeEmpresa): ConsultasDeFacturacion;
}>;

export const MARCA_UNO: MarcaParaImprimir = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: "/marcas/zulu/logo.png",
  colorPrincipal: "#8b4513",
};
export const MARCA_DOS: MarcaParaImprimir = {
  nombreDeFantasia: "Café Central",
  logoUrl: null,
  colorPrincipal: null,
};

export function crearEntornoDeConsultas(base: BaseDePruebas): EntornoDeConsultas {
  let marca = MARCA_UNO;
  let visto: EstadoDeLaTransaccion | null = null;
  let hechas = 0;
  // Cuenta cada consulta que vuelve de la base: un listado que pide algo por fila se nota en la cifra.
  const contador: KyselyPlugin = {
    transformQuery: (args) => args.node,
    transformResult: (args) => {
      hechas += 1;
      return Promise.resolve(args.result);
    },
  };
  const transacciones = crearTransacciones<TxDeConsultasDePrueba>({
    urls: { OPERATIVO: base.app },
    armar: (db) => {
      const fiscal = db.withTables<FiscalDb>().withPlugin(contador);
      return {
        db,
        comprobantes: crearRepositorioDeComprobantes(fiscal),
        lecturas: crearLecturasDeComprobantes(fiscal),
        intentos: crearRepositorioDeIntentos(fiscal),
        series: crearRepositorioDeSeries(fiscal),
        marca: {
          async deLaEmpresa() {
            const r = await sql<{ ro: string; nivel: string }>`
              select current_setting('transaction_read_only') as ro,
                     current_setting('transaction_isolation') as nivel`.execute(db);
            const fila = r.rows[0];
            visto = fila === undefined ? null : { soloLectura: fila.ro, aislamiento: fila.nivel };
            return marca;
          },
        },
        autorizacion: conFacturacion(crearAutorizacionDePostgres(db.withTables<AutorizacionDb>())),
      };
    },
    maximoDeConexiones: 5,
    clave: base.clave,
  });
  return {
    transacciones,
    usarMarca: (m) => {
      marca = m;
    },
    ultimoEstadoVisto: () => visto,
    consultasFiscalesHechas: () => hechas,
    consultas: (reglas = REGLAS_CON_FACTURACION) =>
      crearConsultasDeFacturacion({ transacciones, reglas }),
  };
}

/**
 * Un comprobante PENDIENTE completo con el `creado_en` que se pida (con microsegundos), armado por el dueño. La
 * base obliga a que los renglones nazcan en la transacción del comprobante (`creado_en = now()`), así que se crea
 * normal y, con el disparador de cambios apagado SOLO dentro de esta transacción (otras conexiones no lo ven
 * apagado), se le pone el instante: el único modo de probar el orden por `creado_en` con instantes elegidos.
 */
export async function crearComprobanteCreadoEn(
  c: pg.Client,
  e: Escenario,
  creadoEn: string,
): Promise<string> {
  const datos = datosDeComprobante(e);
  await c.query("begin");
  // El disparador se apaga antes de escribir nada: con eventos diferidos pendientes la base no deja alterar la tabla.
  await c.query("alter table comprobante disable trigger comprobante_cambio");
  const r = await insertarComprobante(viaDueno(c), datos);
  if (!r.ok) {
    await c.query("rollback");
    throw new Error(`no se pudo crear el comprobante de prueba: ${r.codigo} ${r.mensaje}`);
  }
  await c.query("update comprobante set creado_en = $2 where id = $1", [datos["id"], creadoEn]);
  // Las restricciones diferidas se comprueban ahora: sin eso, `enable trigger` falla por eventos pendientes.
  await c.query("set constraints all immediate");
  await c.query("alter table comprobante enable trigger comprobante_cambio");
  const confirmado = await confirmarDueno(c);
  if (!confirmado.ok) {
    throw new Error(`no se pudo confirmar el comprobante: ${confirmado.mensaje}`);
  }
  return datos["id"] as string;
}

/** Un punto de venta activo en PRODUCCION (un comprobante de producción necesita el suyo). */
export async function crearPuntoDeVentaEnProduccion(
  c: pg.Client,
  e: Escenario,
): Promise<Escenario> {
  const pv = await crearPuntoDeVenta(c, e, { numero: e.pvNumero + 1, activo: true });
  await c.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [pv]);
  return { ...e, pv, pvNumero: e.pvNumero + 1 };
}
