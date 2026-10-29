import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type pg from "pg";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import {
  crearAutorizacionDePostgres,
  type AutorizacionDb,
} from "../../src/adaptadores/postgres/autorizacion";
import { crearTrabajosDePostgres, type TrabajosDb } from "../../src/adaptadores/postgres/trabajos";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import type { ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type EmpresasDb,
} from "../../src/modulos/empresas/publico";
import {
  comprobanteId,
  crearCasosDeUsoDeFacturacion,
  crearRepositorioDeCertificados,
  crearLecturasDeComprobantes,
  crearRepositorioDeComprobantes,
  crearRepositorioDeDatosFiscales,
  crearRepositorioDeDomicilios,
  crearRepositorioDeEmisores,
  crearRepositorioDeIntentos,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeSeries,
  puntoDeVentaId,
  type Ambiente,
  type CasosDeUsoDeFacturacion,
  type ComprobanteId,
  type ContextoDeSistema,
  type EmisionElectronica,
  type EntradaDeComprobanteManual,
  type EntradaDeNotaManual,
  type FiscalDb,
  type OpcionesDeFacturacion,
  type TxDeFacturacion,
} from "../../src/modulos/fiscal/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { consumidorFinal, renglon } from "../utilidades/facturacion";
import { comoEmpresa } from "./entorno";
import { crearEscenario as crearEscenarioDeFacturacion, type Escenario } from "./facturacion-apoyo";
import { cargaDe, crearEntornoFacturacion, pedidoDe } from "./facturacion-persistencia-apoyo";
import { REGLAS_CON_FACTURACION, conFacturacion } from "./fiscal-numeracion-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de los casos de uso de facturación (F5) contra una base real: la transacción que recibe
 * cada caso es la que armaría la composición (todos los repositorios fiscales, empresas y tenants, auditoría,
 * trabajos y la autorización con `facturacion` activada) más el `db` crudo para mirar. ARCA es SIEMPRE el
 * adaptador falso (`EmisionFalsa`), uno por ambiente.
 */
export type TxDeFacturacionDePrueba = TxDeFacturacion & Readonly<{ db: Kysely<SinTablas> }>;

export function crearEntornoDeFacturacion(
  base: BaseDePruebas,
  maximoDeConexiones = 8,
  ajustar: (tx: TxDeFacturacionDePrueba) => TxDeFacturacionDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeFacturacionDePrueba> {
  return crearTransacciones<TxDeFacturacionDePrueba>({
    urls: { OPERATIVO: base.app },
    armar: (db) => {
      const fiscal = db.withTables<FiscalDb>();
      return ajustar({
        db,
        empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
        sucursales: crearRepositorioDeSucursales(db.withTables<EmpresasDb>()),
        lecturas: crearLecturasDeComprobantes(fiscal),
        tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
        puntosDeVenta: crearRepositorioDePuntosDeVenta(fiscal),
        emisores: crearRepositorioDeEmisores(fiscal),
        series: crearRepositorioDeSeries(fiscal),
        comprobantes: crearRepositorioDeComprobantes(fiscal),
        intentos: crearRepositorioDeIntentos(fiscal),
        certificados: crearRepositorioDeCertificados(fiscal),
        datosFiscales: crearRepositorioDeDatosFiscales(fiscal),
        domicilios: crearRepositorioDeDomicilios(fiscal),
        trabajos: crearTrabajosDePostgres(db.withTables<TrabajosDb>()),
        auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
        autorizacion: conFacturacion(crearAutorizacionDePostgres(db.withTables<AutorizacionDb>())),
      });
    },
    maximoDeConexiones,
    clave: base.clave,
  });
}

/** Un reloj que la prueba mueve a mano. */
export class RelojDePrueba {
  constructor(public actual: Date) {}
  ahora = (): Date => this.actual;
  avanzar(minutos: number): Date {
    this.actual = new Date(this.actual.getTime() + minutos * 60_000);
    return this.actual;
  }
}

/** El falso de ARCA de cada ambiente (cada ambiente es otro ARCA). */
export type ArcaFalsa = Readonly<Record<Ambiente, EmisionElectronica>>;

export function casosDeFacturacion(
  transacciones: TransaccionesDePostgres<TxDeFacturacionDePrueba>,
  arca: ArcaFalsa,
  reloj: RelojDePrueba,
  opciones: Partial<OpcionesDeFacturacion> = {},
  reglas: ReglasDeEmpresa = REGLAS_CON_FACTURACION,
): CasosDeUsoDeFacturacion {
  return crearCasosDeUsoDeFacturacion({
    transacciones,
    reglas,
    emision: { para: (_empresa, _emisor, ambiente) => arca[ambiente] },
    reloj,
    opciones,
  });
}

/** Una empresa con emisor RI, datos fiscales confirmados, un PV activo, un certificado vigente y un miembro. */
export type EscenarioDeCasos = Escenario &
  Readonly<{
    como: (ahora: Date) => ContextoOperativo;
    sistema: (ahora: Date) => ContextoDeSistema;
  }>;

export async function crearEscenarioDeCasos(
  dueno: pg.Client,
  base: BaseDePruebas,
  opciones: Parameters<typeof crearEscenarioDeFacturacion>[1] & {
    rol?: RolDePrueba;
    sinCertificado?: boolean;
    ambienteDelCertificado?: Ambiente;
  } = {},
): Promise<EscenarioDeCasos> {
  const e = await crearEscenarioDeFacturacion(dueno, opciones);
  const rol = opciones.rol ?? "OPERADOR";
  await crearMembresiaDeBase(dueno, e.empresa, e.persona, rol);
  // Un operador trabaja en las sucursales que tiene asignadas (el listado se acota a una): en la de la empresa de prueba.
  if (rol === "OPERADOR") await crearAsignacionDeBase(dueno, e.empresa, e.persona, e.sucursal);
  if (opciones.sinCertificado !== true) {
    await cargarCertificado(base, e, opciones.ambienteDelCertificado ?? "HOMOLOGACION");
  }
  return {
    ...e,
    como: (ahora) => ({ ...comoEmpresa(empresaId(e.empresa), personaId(e.persona)), ahora }),
    sistema: (ahora) => ({
      ...comoEmpresa(empresaId(e.empresa), null),
      personaId: null,
      marcaDeEntrada: null,
      ahora,
    }),
  };
}

/** Un certificado `VIGENTE` (que vence en un año) del emisor del escenario en ese ambiente. */
export async function cargarCertificado(
  base: BaseDePruebas,
  e: Escenario,
  ambiente: Ambiente,
): Promise<void> {
  const entorno = crearEntornoFacturacion(base, 1);
  try {
    const r = await entorno.ejecutar(
      { contexto: comoEmpresa(empresaId(e.empresa), personaId(e.persona)) },
      async (tx) => {
        const pedido = await tx.certificados.crearPedido(pedidoDe(e, { ambiente }));
        if (!pedido.ok) throw new Error("no se pudo crear el pedido de certificado");
        const activado = await tx.certificados.activar(
          empresaId(e.empresa),
          pedido.valor.valor.id,
          pedido.valor.valor.version,
          cargaDe({ venceEn: new Date(Date.now() + 365 * 86_400_000) }),
        );
        if (activado === null) throw new Error("no se pudo activar el certificado");
        return { ok: true as const, valor: null };
      },
    );
    if (!r.ok) throw new Error(`certificado de prueba: ${JSON.stringify(r.error)}`);
  } finally {
    await entorno.cerrar();
  }
}

/** Un pedido de factura B a consumidor final por $121,00 (o lo que se cambie), con una clave nueva. */
export function facturaManual(
  e: Pick<Escenario, "pv">,
  cambios: Partial<EntradaDeComprobanteManual> = {},
): EntradaDeComprobanteManual {
  return {
    clave: randomUUID(),
    puntoDeVentaId: puntoDeVentaId(e.pv),
    concepto: "PRODUCTOS",
    servicio: null,
    modoDePrecio: "IVA_INCLUIDO",
    receptor: consumidorFinal,
    renglones: [renglon("121.00", "1", "21")],
    ...cambios,
  };
}

/** Un pedido de nota sobre un comprobante, con una clave nueva. */
export function notaManual(
  asociado: ComprobanteId,
  cambios: Partial<EntradaDeNotaManual> = {},
): EntradaDeNotaManual {
  return {
    clave: randomUUID(),
    comprobanteAsociadoId: asociado,
    puntoDeVentaId: null,
    concepto: "PRODUCTOS",
    servicio: null,
    modoDePrecio: "IVA_INCLUIDO",
    renglones: [renglon("121.00", "1", "21")],
    motivo: "Devolución",
    ...cambios,
  };
}

export const idDe = (texto: string): ComprobanteId => comprobanteId(texto);
