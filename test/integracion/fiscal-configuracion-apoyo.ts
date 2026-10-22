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
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearRepositorioDeEmpresas, type EmpresasDb } from "../../src/modulos/empresas/publico";
import {
  crearCasosDeUsoDeConfiguracionFiscal,
  crearRepositorioDeDatosFiscales,
  crearRepositorioDeDomicilios,
  crearRepositorioDeEmisores,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeReglasDeEmisor,
  crearRepositorioDeSeries,
  domicilioId,
  type CasosDeUsoDeConfiguracionFiscal,
  type FiscalDb,
  type TxDeConfiguracionFiscal,
} from "../../src/modulos/fiscal/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa } from "./entorno";
import { crearMundo, type Mundo } from "./fiscal-apoyo";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la configuración fiscal del gerente (H7 T5) contra una base real. Lo que recibe cada caso
 * de uso es lo que armaría la composición (repositorios fiscales, empresas y tenants, auditoría y la autorización
 * real sobre la conexión de la transacción) más el `db` crudo para mirar. Las reglas son las REALES de empresa: las
 * siete acciones son de `administracion` y no dependen de que la facturación exista.
 */
export type TxDeConfiguracionDePrueba = TxDeConfiguracionFiscal &
  Readonly<{ db: Kysely<SinTablas> }>;

export function crearEntornoDeConfiguracion(
  base: BaseDePruebas,
  maximoDeConexiones = 8,
  /** Envuelve lo que recibe el caso de uso (para inyectar una barrera o una falla). */
  ajustar: (tx: TxDeConfiguracionDePrueba) => TxDeConfiguracionDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeConfiguracionDePrueba> {
  return crearTransacciones<TxDeConfiguracionDePrueba>({
    urls: { OPERATIVO: base.app },
    armar: (db) => {
      const fiscal = db.withTables<FiscalDb>();
      return ajustar({
        db,
        empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
        tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
        emisores: crearRepositorioDeEmisores(fiscal),
        domicilios: crearRepositorioDeDomicilios(fiscal),
        datosFiscales: crearRepositorioDeDatosFiscales(fiscal),
        reglasDeEmisor: crearRepositorioDeReglasDeEmisor(fiscal),
        puntosDeVenta: crearRepositorioDePuntosDeVenta(fiscal),
        series: crearRepositorioDeSeries(fiscal),
        auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
        autorizacion: crearAutorizacionDePostgres(db.withTables<AutorizacionDb>()),
      });
    },
    maximoDeConexiones,
    clave: base.clave,
  });
}

export function casosDeConfiguracion(
  transacciones: TransaccionesDePostgres<TxDeConfiguracionDePrueba>,
): CasosDeUsoDeConfiguracionFiscal {
  return crearCasosDeUsoDeConfiguracionFiscal({ transacciones, reglas: REGLAS_DE_EMPRESA });
}

/** Una empresa con su emisor principal y una sucursal, y una persona con el rol dado. */
export type EscenarioDeConfiguracion = Readonly<{
  mundo: Mundo;
  persona: string;
  /** El contexto de esa persona en `ahora`. */
  como: (ahora?: Date) => ContextoOperativo;
}>;

export async function crearEscenarioDeConfiguracion(
  dueno: pg.Client,
  opciones: Parameters<typeof crearMundo>[1] & { rol?: RolDePrueba } = {},
): Promise<EscenarioDeConfiguracion> {
  const mundo = await crearMundo(dueno, opciones);
  const persona = (await crearPersonaDeBase(dueno)).id;
  await crearMembresiaDeBase(dueno, mundo.empresa, persona, opciones.rol ?? "GERENTE");
  return {
    mundo,
    persona,
    como: (ahora) => ({
      ...comoEmpresa(empresaId(mundo.empresa), personaId(persona)),
      ...(ahora === undefined ? {} : { ahora }),
    }),
  };
}

/** Otra persona con membresía en la misma empresa (otro gerente, para las carreras). */
export async function otraPersona(
  dueno: pg.Client,
  e: EscenarioDeConfiguracion,
  rol: RolDePrueba = "GERENTE",
): Promise<EscenarioDeConfiguracion> {
  const persona = (await crearPersonaDeBase(dueno)).id;
  await crearMembresiaDeBase(dueno, e.mundo.empresa, persona, rol);
  return {
    mundo: e.mundo,
    persona,
    como: (ahora) => ({
      ...comoEmpresa(empresaId(e.mundo.empresa), personaId(persona)),
      ...(ahora === undefined ? {} : { ahora }),
    }),
  };
}

export const nuevoUuid = (): string => randomUUID();

/** Los datos de un domicilio nuevo, como llegan de la pantalla. */
export const datosDeDomicilio = (cambios: Record<string, string | null> = {}) => ({
  calle: "Av. Corrientes",
  numero: "1234",
  piso: null,
  departamento: null,
  localidad: "Rosario",
  provincia: "AR-S",
  codigoPostal: "S2000",
  ...cambios,
});

/** Un domicilio nuevo con su `id`. */
export const domicilioNuevo = (cambios: Record<string, string | null> = {}, id = nuevoUuid()) =>
  ({ tipo: "NUEVO", id: domicilioId(id), datos: datosDeDomicilio(cambios) }) as const;
