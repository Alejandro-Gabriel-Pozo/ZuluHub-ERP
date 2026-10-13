import { crearCorreoResend } from "../adaptadores/correo/correo-resend";
import {
  leerConfiguracionDeCorreo,
  type ConfiguracionDeCorreo,
} from "../adaptadores/correo/configuracion";
import { crearAuditoriaDePostgres, type AuditoriaDb } from "../adaptadores/postgres/auditoria";
import {
  crearAutorizacionDePostgres,
  type AutorizacionDb,
} from "../adaptadores/postgres/autorizacion";
import { crearColaDePostgres, type ColaDb } from "../adaptadores/postgres/cola-de-trabajos";
import {
  ZULUHUB_CLAVE_CONTEXTO,
  leerClaveDeContexto,
} from "../adaptadores/postgres/contexto-firmado";
import { crearResolucionDeHost, type TxPublica } from "../adaptadores/postgres/resolucion-de-host";
import { crearTrabajosDePostgres, type TrabajosDb } from "../adaptadores/postgres/trabajos";
import {
  crearTransaccionesPublicas,
  type TransaccionesPublicasDePostgres,
} from "../adaptadores/postgres/transacciones-publicas";
import {
  crearTransacciones,
  type TransaccionesDePostgres,
} from "../adaptadores/postgres/transacciones";
import {
  ZULUHUB_SECRETO_INVITACIONES,
  crearTokensHmac,
  leerSecretoDeInvitaciones,
} from "../adaptadores/tokens/tokens-hmac";
import type { TxDeCola } from "../adaptadores/trabajos/procesador";
import {
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type EmpresasDb,
  type RepositorioDeEmpresas,
  type RepositorioDeSucursales,
} from "../modulos/empresas/publico";
import {
  crearRepositorioDeAsignaciones,
  crearRepositorioDeInvitaciones,
  crearRepositorioDeMembresias,
  crearRepositorioDePersonas,
  crearRepositorioDeTraspasos,
  type IdentidadDb,
  type RepositorioDeAsignaciones,
  type RepositorioDeInvitaciones,
  type RepositorioDeMembresias,
  type RepositorioDePersonas,
  type RepositorioDeTraspasos,
} from "../modulos/identidad/publico";
import { crearLecturaPublicaDeMarcas, type PublicoDb } from "../modulos/marcas/publico";
import {
  crearRepositorioDeTenants,
  type RepositorioDeTenants,
  type TenantsDb,
} from "../modulos/tenants/publico";
import type { Auditoria } from "../puertos/auditoria";
import type { CargaDeAutorizacion } from "../puertos/autorizacion";
import type { Correo } from "../puertos/correo";
import type { ResolucionDeHost } from "../puertos/marcas";
import type { Tokens } from "../puertos/tokens";
import type { Trabajos } from "../puertos/trabajos";
import {
  entornoDelProceso,
  registrandoFallosDeEntorno,
  valoresDeLaPieza,
  type FuenteDeEntorno,
  type Pieza,
  type ValoresDeLaPieza,
} from "./entorno";
import { perezoso } from "./perezoso";

/**
 * Las piezas que necesitan entorno: transacciones por puerta, tokens y correo. Cada una se arma la
 * PRIMERA vez que se pide (`perezoso`) y entonces valida sus variables; importar este archivo o
 * llamar a `armarConexiones` no lee nada (P-12). Una sola instancia por pieza: la web y los trabajos
 * comparten las mismas conexiones.
 */

/**
 * Lo que recibe el trabajo de una transacción de la puerta de la aplicación (operación e
 * invitación, rol `zuluhub_app`): todos los repositorios y puertos que piden los casos de uso y las
 * consultas de empresas e identidad. Cada caso de uso declara solo lo que usa (su `Tx`), y este tipo
 * los contiene a todos.
 */
export type TxDeApp = Readonly<{
  tenants: RepositorioDeTenants;
  empresas: RepositorioDeEmpresas;
  sucursales: RepositorioDeSucursales;
  personas: RepositorioDePersonas;
  membresias: RepositorioDeMembresias;
  asignaciones: RepositorioDeAsignaciones;
  invitaciones: RepositorioDeInvitaciones;
  traspasos: RepositorioDeTraspasos;
  trabajos: Trabajos;
  auditoria: Auditoria;
  autorizacion: CargaDeAutorizacion;
}>;

export type Conexiones = Readonly<{
  /** Puerta `OPERATIVO` e `INVITACION` (`ZULUHUB_DB_APP`). */
  transaccionesDeApp: () => TransaccionesDePostgres<TxDeApp>;
  /** Puerta `TRABAJOS` (`ZULUHUB_DB_TRABAJOS`): solo la cola. */
  transaccionesDeTrabajos: () => TransaccionesDePostgres<TxDeCola>;
  /** Puerta pública (`ZULUHUB_DB_PUBLICO`, rol `zuluhub_publico`): solo lectura, sin sesión ni contexto. */
  transaccionesPublicas: () => TransaccionesPublicasDePostgres<TxPublica>;
  /** Resolución de un host a su dueño y su marca, sobre la puerta pública. */
  resolucionDeHost: () => ResolucionDeHost;
  tokens: () => Tokens;
  /** Origen y marca del mail (el respaldo hasta que exista M7) y la clave del proveedor. */
  configuracionDeCorreo: () => ConfiguracionDeCorreo;
  correo: () => Correo;
}>;

export type OpcionesDeConexiones = Readonly<{
  /** De dónde se leen las variables; por defecto, el entorno del proceso. Se evalúa en cada armado. */
  fuente?: () => FuenteDeEntorno;
  /** Registro del servidor: recibe el detalle (con NOMBRES, nunca valores) de un fallo de entorno. */
  registrar?: (detalle: string) => void;
}>;

export function armarConexiones(opciones: OpcionesDeConexiones = {}): Conexiones {
  const fuente = opciones.fuente ?? entornoDelProceso;
  const registrar = opciones.registrar ?? (() => undefined);

  /** Valida las variables de la pieza y arma; cualquier fallo de entorno se registra y falla cerrado. */
  const armarPieza = <P extends Pieza, T>(
    pieza: P,
    armar: (valores: ValoresDeLaPieza<P>) => T,
  ): (() => T) =>
    perezoso(() =>
      registrandoFallosDeEntorno(registrar, () => armar(valoresDeLaPieza(fuente(), pieza))),
    );

  const configuracionDeCorreo = armarPieza("correo", (valores) =>
    leerConfiguracionDeCorreo(valores),
  );
  const transaccionesPublicas = armarPieza("transacciones-publicas", (valores) =>
    crearTransaccionesPublicas<TxPublica>({
      url: valores.ZULUHUB_DB_PUBLICO,
      armar: (db) => ({ marcas: crearLecturaPublicaDeMarcas(db.withTables<PublicoDb>()) }),
    }),
  );

  return {
    transaccionesDeApp: armarPieza("transacciones-app", (valores) =>
      crearTransacciones<TxDeApp>({
        urls: { OPERATIVO: valores.ZULUHUB_DB_APP },
        clave: leerClaveDeContexto(valores[ZULUHUB_CLAVE_CONTEXTO]),
        armar: (db) => ({
          tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
          empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
          sucursales: crearRepositorioDeSucursales(db.withTables<EmpresasDb>()),
          personas: crearRepositorioDePersonas(db.withTables<IdentidadDb>()),
          membresias: crearRepositorioDeMembresias(db.withTables<IdentidadDb>()),
          asignaciones: crearRepositorioDeAsignaciones(db.withTables<IdentidadDb>()),
          invitaciones: crearRepositorioDeInvitaciones(db.withTables<IdentidadDb>()),
          traspasos: crearRepositorioDeTraspasos(db.withTables<IdentidadDb>()),
          trabajos: crearTrabajosDePostgres(db.withTables<TrabajosDb>()),
          auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
          autorizacion: crearAutorizacionDePostgres(db.withTables<AutorizacionDb>()),
        }),
      }),
    ),
    transaccionesDeTrabajos: armarPieza("transacciones-trabajos", (valores) =>
      crearTransacciones<TxDeCola>({
        urls: { TRABAJOS: valores.ZULUHUB_DB_TRABAJOS },
        clave: leerClaveDeContexto(valores[ZULUHUB_CLAVE_CONTEXTO]),
        armar: (db) => ({ cola: crearColaDePostgres(db.withTables<ColaDb>()) }),
      }),
    ),
    transaccionesPublicas,
    resolucionDeHost: perezoso(() => crearResolucionDeHost(transaccionesPublicas())),
    tokens: armarPieza("tokens", (valores) =>
      crearTokensHmac(leerSecretoDeInvitaciones(valores[ZULUHUB_SECRETO_INVITACIONES])),
    ),
    configuracionDeCorreo,
    correo: perezoso(() => crearCorreoResend({ configuracion: configuracionDeCorreo() })),
  };
}
