import { crearAutenticacionDeBetterAuth } from "../adaptadores/autenticacion/autenticacion-de-better-auth";
import {
  leerClienteDeGoogle,
  leerSecretoDeAutenticacion,
} from "../adaptadores/autenticacion/configuracion";
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
import { crearConexionDeAutenticacion } from "../adaptadores/postgres/conexion-de-autenticacion";
import {
  crearNivelesDeControlDePostgres,
  type NivelesDeControlDb,
} from "../adaptadores/postgres/niveles-de-control";
import {
  ZULUHUB_CLAVE_CONTEXTO,
  leerClaveDeContexto,
} from "../adaptadores/postgres/contexto-firmado";
import { crearConfiguracionPublicaDeHost } from "../adaptadores/postgres/configuracion-publica-de-marca";
import { crearResolucionDeHost, type TxPublica } from "../adaptadores/postgres/resolucion-de-host";
import { crearLecturasDeSesionDePostgres, type SesionDb } from "../adaptadores/postgres/sesion";
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
import type { NivelesDeControl } from "../capacidades/controles/niveles";
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
import type { Autenticacion, BarridoDeAutenticacion } from "../puertos/autenticacion";
import type { CargaDeAutorizacion } from "../puertos/autorizacion";
import type { Correo } from "../puertos/correo";
import type { ConfiguracionPublicaDeHost, ResolucionDeHost } from "../puertos/marcas";
import type { LecturasDeSesion } from "../puertos/sesion";
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
 * Lo que recibe el trabajo de una transacción de la puerta de la aplicación (operación, invitación
 * y sesión, rol `zuluhub_app`): todos los repositorios y puertos que piden los casos de uso y las
 * consultas de empresas e identidad. Cada caso de uso declara solo lo que usa (su `Tx` angosta), y este
 * tipo los contiene a todos.
 *
 * Es la `Tx` COMPUESTA (conciliación §3.3): los repositorios de varios módulos se arman sobre la MISMA
 * transacción de la base, así una operación que cruza módulos (cobrar: ventas, caja, stock, fiscal) es
 * atómica con un solo `ejecutar`. Un puerto `*EnTx` de otro módulo recibe esta misma `Tx` (que contiene
 * la suya, angosta) y nunca abre una propia. Cada módulo nuevo suma sus repositorios acá; que este tipo
 * contenga cada `Tx` angosta lo comprueba el compilador (`test/arquitectura/tipos-tx.test.ts`).
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
  /** El nivel vigente de cada control (permitir, avisar, bloquear), leído en la misma transacción. */
  niveles: NivelesDeControl;
  /** Lo que lee la puerta `SESION` (la persona del usuario y sus empresas). */
  sesion: LecturasDeSesion;
}>;

export type Conexiones = Readonly<{
  /** Puertas `OPERATIVO`, `INVITACION` y `SESION` (`ZULUHUB_DB_APP`). */
  transaccionesDeApp: () => TransaccionesDePostgres<TxDeApp>;
  /** Puerta `TRABAJOS` (`ZULUHUB_DB_TRABAJOS`): solo la cola. */
  transaccionesDeTrabajos: () => TransaccionesDePostgres<TxDeCola>;
  /** Puerta pública (`ZULUHUB_DB_PUBLICO`, rol `zuluhub_publico`): solo lectura, sin sesión ni contexto. */
  transaccionesPublicas: () => TransaccionesPublicasDePostgres<TxPublica>;
  /** Resolución de un host a su dueño y su marca, sobre la puerta pública. */
  resolucionDeHost: () => ResolucionDeHost;
  /** Cómo se pinta la marca de un host (nombre, tema y host canónico), sobre la misma puerta pública. */
  configuracionPublicaDeHost: () => ConfiguracionPublicaDeHost;
  /** Ingreso con Google y sesión por host (Better Auth, rol `zuluhub_autenticacion`): `ZULUHUB_DB_AUTENTICACION`, el secreto de la app y el cliente de Google. */
  autenticacion: () => Autenticacion;
  /** Barrido de sesiones y verificaciones vencidas (lo llama el cron de trabajos): solo `ZULUHUB_DB_AUTENTICACION`. */
  barridoDeAutenticacion: () => BarridoDeAutenticacion;
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
  /** Registro del servidor para lo que cuenta la librería de ingreso (con detalle: nunca sale en una respuesta). */
  registrarDeIngreso?: (detalle: string) => void;
}>;

export function armarConexiones(opciones: OpcionesDeConexiones = {}): Conexiones {
  const fuente = opciones.fuente ?? entornoDelProceso;
  const registrar = opciones.registrar ?? (() => undefined);
  const registrarDeIngreso = opciones.registrarDeIngreso ?? registrar;

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

  const conexionDeAutenticacion = armarPieza("conexion-de-autenticacion", (valores) =>
    crearConexionDeAutenticacion({
      url: valores.ZULUHUB_DB_AUTENTICACION,
      alCortarseUnaConexionOciosa: (error) =>
        registrarDeIngreso(`conexión ociosa de autenticación cortada: ${error.message}`),
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
          niveles: crearNivelesDeControlDePostgres(db.withTables<NivelesDeControlDb>()),
          sesion: crearLecturasDeSesionDePostgres(db.withTables<SesionDb>()),
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
    configuracionPublicaDeHost: perezoso(() =>
      crearConfiguracionPublicaDeHost(transaccionesPublicas()),
    ),
    autenticacion: armarPieza("autenticacion", (valores) =>
      crearAutenticacionDeBetterAuth({
        db: conexionDeAutenticacion().db,
        secreto: leerSecretoDeAutenticacion(valores.ZULUHUB_AUTH_SECRETO_EMPRESA),
        google: leerClienteDeGoogle(valores.GOOGLE_CLIENT_ID, valores.GOOGLE_CLIENT_SECRET),
        registrar: registrarDeIngreso,
      }),
    ),
    barridoDeAutenticacion: () => conexionDeAutenticacion().barrido,
    tokens: armarPieza("tokens", (valores) =>
      crearTokensHmac(leerSecretoDeInvitaciones(valores[ZULUHUB_SECRETO_INVITACIONES])),
    ),
    configuracionDeCorreo,
    correo: perezoso(() => crearCorreoResend({ configuracion: configuracionDeCorreo() })),
  };
}
