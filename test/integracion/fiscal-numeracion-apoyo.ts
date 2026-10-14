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
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearRepositorioDeEmpresas, type EmpresasDb } from "../../src/modulos/empresas/publico";
import {
  crearCasosDeUsoDeNumeracion,
  crearRepositorioDeEmisores,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeSeries,
  puntoDeVentaId,
  solicitudId,
  type Ambiente,
  type CasosDeUsoDeNumeracion,
  type FiscalDb,
  type OpcionesDeNumeracion,
  type SolicitudId,
  type TxDeNumeracion,
} from "../../src/modulos/fiscal/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { CargaDeAutorizacion } from "../../src/puertos/autorizacion";
import type { EmisionElectronica } from "../../src/modulos/fiscal/publico";
import { comoEmpresa } from "./entorno";
import { crearMundo, crearPuntoDeVenta, crearSerie, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";
import { nuevoId } from "./fiscal-persistencia-apoyo";
import { armarNumerarParaPruebas } from "../utilidades/numerar-para-pruebas";

/**
 * Apoyo de las pruebas de numeración (H7 T6). Lo que recibe el caso de uso es lo que armaría la
 * composición real (repositorios fiscales, estados de empresa y tenant, auditoría y autorización
 * sobre la conexión de la transacción) más el `db` crudo para mirar.
 *
 * El módulo `facturacion` está en desarrollo en el catálogo real: las pruebas que ejercitan los casos
 * de uso lo hacen con `REGLAS_CON_FACTURACION` (el módulo `disponible`) y una carga de autorización
 * que lo trae activado y habilitado por el plan. Una prueba aparte verifica que con el catálogo REAL
 * emitir da `MODULO_EN_DESARROLLO`.
 */
export type TxDeNumeracionDePrueba = TxDeNumeracion & Readonly<{ db: Kysely<SinTablas> }>;

/** El catálogo real con `facturacion` ya construida: así los casos de uso pasan el guard. */
export const REGLAS_CON_FACTURACION: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

/** La autorización real, más la activación y el plan de `facturacion` (hoy no hay tablas para eso). */
function conFacturacion(real: CargaDeAutorizacion): CargaDeAutorizacion {
  return {
    sucursalesDelActor: (contexto) => real.sucursalesDelActor(contexto),
    async delActor(contexto) {
      const datos = await real.delActor(contexto);
      return {
        ...datos,
        modulosActivados: [...datos.modulosActivados, "facturacion"],
        modulosHabilitados: [...datos.modulosHabilitados, "facturacion"],
      };
    },
  };
}

export function crearEntornoDeNumeracion(
  base: BaseDePruebas,
  maximoDeConexiones = 8,
  /** Envuelve lo que recibe el caso de uso (para inyectar una barrera o una falla). */
  ajustar: (tx: TxDeNumeracionDePrueba) => TxDeNumeracionDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeNumeracionDePrueba> {
  return crearTransacciones<TxDeNumeracionDePrueba>({
    urls: { OPERATIVO: base.app },
    armar: (db) => {
      const fiscal = db.withTables<FiscalDb>();
      return ajustar({
        db,
        empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
        tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
        puntosDeVenta: crearRepositorioDePuntosDeVenta(fiscal),
        emisores: crearRepositorioDeEmisores(fiscal),
        series: crearRepositorioDeSeries(fiscal),
        auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
        autorizacion: conFacturacion(crearAutorizacionDePostgres(db.withTables<AutorizacionDb>())),
      });
    },
    maximoDeConexiones,
    clave: base.clave,
  });
}

/**
 * Los casos de uso de numeración más `numerarComprobante`, que ya no es un caso de uso (se retiró con
 * la facturación) sino el recorrido de reservar, pedir a ARCA y cerrar que las pruebas ejercitan
 * (`test/utilidades/numerar-para-pruebas.ts`).
 */
export type CasosDeNumeracionDePrueba = CasosDeUsoDeNumeracion &
  Readonly<{ numerarComprobante: ReturnType<typeof armarNumerarParaPruebas> }>;

export function casosDeNumeracion(
  transacciones: TransaccionesDePostgres<TxDeNumeracionDePrueba>,
  emision: EmisionElectronica,
  opciones?: OpcionesDeNumeracion,
  reglas: ReglasDeEmpresa = REGLAS_CON_FACTURACION,
): CasosDeNumeracionDePrueba {
  const casos = crearCasosDeUsoDeNumeracion({
    transacciones,
    reglas,
    emision,
    ...(opciones === undefined ? {} : { opciones }),
  });
  return { ...casos, numerarComprobante: armarNumerarParaPruebas(casos, emision) };
}

/** Una empresa con su emisor principal, un punto de venta ACTIVO y un miembro con el rol dado. */
export type Escenario = Readonly<{
  mundo: Mundo;
  puntoDeVenta: string;
  persona: string;
  /** El contexto de la persona en `ahora`. */
  como: (ahora: Date) => ContextoOperativo;
  /** El contexto de sistema (sin persona) en `ahora`. */
  sistema: (ahora: Date) => ContextoOperativo & { personaId: null };
}>;

export async function crearEscenario(
  dueno: pg.Client,
  opciones: { rol?: RolDePrueba; conSerie?: boolean; ultimo?: number; tipo?: string } = {},
): Promise<Escenario> {
  const mundo = await crearMundo(dueno);
  const puntoDeVenta = await crearPuntoDeVenta(dueno, mundo, { activo: true });
  const persona = (await crearPersonaDeBase(dueno)).id;
  await crearMembresiaDeBase(dueno, mundo.empresa, persona, opciones.rol ?? "OPERADOR");
  if (opciones.conSerie === true) {
    await crearSerie(
      dueno,
      mundo.empresa,
      puntoDeVenta,
      mundo.emisor,
      opciones.tipo ?? "FACTURA_B",
      opciones.ultimo ?? 0,
    );
  }
  return {
    mundo,
    puntoDeVenta,
    persona,
    como: (ahora) => ({
      ...comoEmpresa(empresaId(mundo.empresa), personaId(persona)),
      ahora,
    }),
    sistema: (ahora) => ({
      ...comoEmpresa(empresaId(mundo.empresa), null),
      personaId: null,
      ahora,
    }),
  };
}

/** La entrada de una solicitud nueva (o la que se pase) de FACTURA_B en el punto de venta (en homologación). */
export const entradaDe = (
  e: Pick<Escenario, "puntoDeVenta">,
  solicitud: SolicitudId = solicitudId(nuevoId()),
  tipo: "FACTURA_A" | "FACTURA_B" | "FACTURA_C" = "FACTURA_B",
  ambiente: Ambiente = "HOMOLOGACION",
) => ({ puntoDeVentaId: puntoDeVentaId(e.puntoDeVenta), tipo, ambiente, solicitud });
