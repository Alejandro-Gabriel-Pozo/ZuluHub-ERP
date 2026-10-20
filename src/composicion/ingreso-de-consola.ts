import { crearAutenticacionDePlataformaDeBetterAuth } from "../adaptadores/autenticacion/autenticacion-de-better-auth";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_ID_PLATAFORMA,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CLIENT_SECRET_PLATAFORMA,
  PEDERNAL_AUTH_SECRETO_EMPRESA,
  PEDERNAL_AUTH_SECRETO_PLATAFORMA,
  PEDERNAL_HOST_DE_LA_CONSOLA,
  leerClienteDeGoogleDePlataforma,
  leerHostDeLaConsola,
  leerSecretoDeAutenticacionDePlataforma,
} from "../adaptadores/autenticacion/configuracion";
import { crearAdminsDePostgres, type AdminsDb } from "../adaptadores/postgres/admins";
import {
  crearAuditoriaDeIngresoDePlataformaDePostgres,
  type TxDeAuditoriaDeIngreso,
} from "../adaptadores/postgres/auditoria-de-ingreso-de-plataforma";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../adaptadores/postgres/auditoria-de-plataforma";
import { crearConexionDeAutenticacion } from "../adaptadores/postgres/conexion-de-autenticacion";
import {
  PEDERNAL_CLAVE_CONTEXTO,
  leerClaveDeContexto,
} from "../adaptadores/postgres/contexto-firmado";
import { crearPersonalHabilitadoDePostgres } from "../adaptadores/postgres/personal-habilitado";
import { crearTransacciones } from "../adaptadores/postgres/transacciones";
import type { AutenticacionDePlataforma, BarridoDeAutenticacion } from "../puertos/autenticacion";
import { entornoDelProceso, registrandoFallosDeEntorno, type FuenteDeEntorno } from "./entorno";
import {
  PEDERNAL_DB_AUTENTICACION,
  PEDERNAL_DB_PLATAFORMA,
  valoresDeLaPiezaDePlataforma,
  type PiezaDePlataforma,
  type ValoresDeLaPiezaDePlataforma,
} from "./entorno-de-plataforma";
import { conHostFijo } from "./autenticacion-de-host-fijo";
import { perezoso } from "./perezoso";
import { armarPuertaDeConsola, type PuertaDeConsola } from "./puerta-de-consola";

/**
 * El ingreso de la CONSOLA de plataforma, armado (h5-p8 §7, «Pendiente»): lo único que `apps/plataforma/servidor` necesita
 * para cablear la ruta `/api/auth/*`, la lectura de la sesión y la puerta de la consola. Es CABLEADO, no diseño: la
 * instancia de Better Auth es la de P8a (`crearAutenticacionDePlataformaDeBetterAuth`: audiencia PLATAFORMA, `twoFactor`,
 * límites de 8 horas / 30 minutos, cookies `__Host-pd_plat.*`) y la puerta es la de P8b (`armarPuertaDeConsola`); acá se
 * les ponen las piezas reales: el personal habilitado (`admin_plataforma`) y la auditoría del ingreso sobre la conexión
 * del rol de plataforma, el segundo factor sobre la del rol de autenticación, el secreto y el cliente de Google PROPIOS de
 * la consola.
 *
 * Un solo HOST fijo (`PEDERNAL_HOST_DE_LA_CONSOLA`) y de una sola fuente: el mismo valor arma el origen de la instancia de
 * ingreso (cookies, retorno de Google, comprobación de origen) y es el host contra el que la puerta compara el de cada
 * sesión. Falla que previene: que la autenticación y la puerta se armen con hosts distintos (una sesión de otro host
 * entrando, o la consola sin poder abrir nunca una). No hay lista de hosts ni resolución por pedido.
 *
 * Perezosa como el resto de la composición (`conexiones.ts`, `plataforma.ts`): armar esto NO lee ninguna variable. Cada
 * pieza valida SUS variables la primera vez que se la pide (`valoresDeLaPiezaDePlataforma`) y falla cerrado con un
 * `ErrorDeEntorno` de mensaje genérico; el detalle (los NOMBRES de las variables y el motivo, jamás un valor) va a
 * `registrar`. Un entorno corregido en Vercel se toma en el pedido siguiente: lo que falló no se memoriza.
 *
 * SOLO lo importa `apps/plataforma/servidor/` (y las pruebas): regla de arquitectura
 * `ingreso-de-consola-solo-desde-la-consola`. Falla que previene: que `apps/web` o cualquier parte de `src/` obtenga las
 * credenciales de la consola (R10). Variables que lee, por pieza (solo nombres):
 *  - `host-de-la-consola`: `PEDERNAL_HOST_DE_LA_CONSOLA`;
 *  - `autenticacion-de-plataforma`: `PEDERNAL_AUTH_SECRETO_PLATAFORMA`, `GOOGLE_CLIENT_ID_PLATAFORMA`,
 *    `GOOGLE_CLIENT_SECRET_PLATAFORMA`;
 *  - `conexion-de-autenticacion-de-plataforma`: `PEDERNAL_DB_AUTENTICACION`;
 *  - `transacciones-de-plataforma`: `PEDERNAL_DB_PLATAFORMA`, `PEDERNAL_CLAVE_CONTEXTO` (también las lee la puerta);
 *  - `tokens-de-plataforma`: `PEDERNAL_SECRETO_INVITACIONES` (solo la puerta, y solo el alta de empresas).
 * Si el entorno trae a la vista las de la web (`PEDERNAL_AUTH_SECRETO_EMPRESA`, `GOOGLE_CLIENT_ID`,
 * `GOOGLE_CLIENT_SECRET`), el de la consola no puede ser igual a ninguna.
 */

export type OpcionesDelIngresoDeConsola = Readonly<{
  /** De dónde se leen las variables; por defecto, el entorno del proceso. Se evalúa en cada armado. */
  fuente?: () => FuenteDeEntorno;
  /** Registro del servidor: recibe el detalle (con NOMBRES, nunca valores) de un fallo de entorno. */
  registrar?: (detalle: string) => void;
  /** Registro del servidor para lo que cuenta la librería de ingreso (con detalle: nunca sale en una respuesta). */
  registrarDeIngreso?: (detalle: string) => void;
}>;

export type IngresoDeConsola = Readonly<{
  /**
   * El host de la consola, ya validado. Es el que se pasa a `autenticacion().manejar(pedido, host)` y
   * `autenticacion().sesionDe(pedido, host)` (nunca el encabezado `Host` del pedido) y con el que se armó la puerta.
   * Lanza `ErrorDeEntorno` si `PEDERNAL_HOST_DE_LA_CONSOLA` falta o no es un host válido.
   */
  hostDeLaConsola: () => string;
  /**
   * El ingreso de la consola: `manejar` atiende `/api/auth/*` (lista cerrada de rutas, el resto 404 neutro), `sesionDe`
   * lee y renueva la sesión del pedido, `estadoDeSesion` la mira sin renovarla. Atada al host de la consola: con otro
   * `host` responde «acá no hay nada» (404 neutro, sin sesión). Lanza `ErrorDeEntorno` si falta o no sirve alguna
   * variable de las piezas `host-de-la-consola`, `autenticacion-de-plataforma`, `conexion-de-autenticacion-de-plataforma`
   * o `transacciones-de-plataforma`.
   */
  autenticacion: () => AutenticacionDePlataforma;
  /**
   * La puerta de la consola de P8b, armada para el host de arriba: `conSesion(sesion)` da el acceso (o el código público
   * por el que no). Lanza `ErrorDeEntorno` solo si el host no sirve; las demás variables las valida la puerta al usar
   * cada caso o consulta.
   */
  puerta: () => PuertaDeConsola;
  /**
   * Barrido de sesiones, verificaciones y contadores vencidos (idempotente). Las sesiones de las dos audiencias viven en la
   * misma tabla y el cron de la web ya las barre; esto deja a la consola barrer las suyas sin depender de ese proyecto.
   * Lanza `ErrorDeEntorno` si falta `PEDERNAL_DB_AUTENTICACION`.
   */
  barridoDeSesiones: () => BarridoDeAutenticacion;
  /** Cierra las conexiones que se hayan abierto (las que nunca se pidieron no se tocan). */
  cerrar(): Promise<void>;
}>;

/** Conexiones que abre el pool del personal habilitado y la auditoría del ingreso (una consulta corta por pedido). */
const CONEXIONES_DEL_PERSONAL = 2;

export function armarIngresoDeConsola(
  opciones: OpcionesDelIngresoDeConsola = {},
): IngresoDeConsola {
  const fuente = opciones.fuente ?? entornoDelProceso;
  const registrar = opciones.registrar ?? (() => undefined);
  const registrarDeIngreso = opciones.registrarDeIngreso ?? registrar;

  /** Valida las variables de la pieza y arma; cualquier fallo de entorno se registra y falla cerrado. */
  const armarPieza = <P extends PiezaDePlataforma, T>(
    pieza: P,
    armar: (valores: ValoresDeLaPiezaDePlataforma<P>) => T,
  ): (() => T) =>
    perezoso(() =>
      registrandoFallosDeEntorno(registrar, () =>
        armar(valoresDeLaPiezaDePlataforma(fuente(), pieza)),
      ),
    );

  /** Lo que se llegó a abrir: `cerrar` solo toca esto (cerrar no puede exigir un entorno que nunca se usó). */
  const abiertas: Array<{ cerrar(): Promise<void> }> = [];

  const hostDeLaConsola = armarPieza("host-de-la-consola", (valores) =>
    leerHostDeLaConsola(valores[PEDERNAL_HOST_DE_LA_CONSOLA]),
  );

  /** El secreto y el cliente de Google de la consola, con la misma exigencia que los de la web y distintos de ellos. */
  const credencialesDeIngreso = armarPieza("autenticacion-de-plataforma", (valores) => {
    const deLaWeb = fuente();
    return {
      secreto: leerSecretoDeAutenticacionDePlataforma(
        valores[PEDERNAL_AUTH_SECRETO_PLATAFORMA],
        deLaWeb[PEDERNAL_AUTH_SECRETO_EMPRESA],
      ),
      google: leerClienteDeGoogleDePlataforma(
        valores[GOOGLE_CLIENT_ID_PLATAFORMA],
        valores[GOOGLE_CLIENT_SECRET_PLATAFORMA],
        { clientId: deLaWeb[GOOGLE_CLIENT_ID], clientSecret: deLaWeb[GOOGLE_CLIENT_SECRET] },
      ),
    };
  });

  const conexionDeAutenticacion = armarPieza(
    "conexion-de-autenticacion-de-plataforma",
    (valores) => {
      const conexion = crearConexionDeAutenticacion({
        url: valores[PEDERNAL_DB_AUTENTICACION],
        alCortarseUnaConexionOciosa: (error) =>
          registrarDeIngreso(
            `conexión ociosa de autenticación de la consola cortada: ${error.message}`,
          ),
      });
      abiertas.push(conexion);
      return conexion;
    },
  );

  /**
   * La conexión del rol de plataforma con la que el ingreso consulta `admin_plataforma` y asienta el bloqueo del segundo
   * factor: la librería corre con un rol que no ve esas tablas (S5), así que se le inyectan estos dos puertos.
   */
  const transaccionesDelIngreso = armarPieza("transacciones-de-plataforma", (valores) => {
    const transacciones = crearTransacciones<TxDeAuditoriaDeIngreso>({
      urls: { PLATAFORMA: valores[PEDERNAL_DB_PLATAFORMA] },
      clave: leerClaveDeContexto(valores[PEDERNAL_CLAVE_CONTEXTO]),
      maximoDeConexiones: CONEXIONES_DEL_PERSONAL,
      armar: (db, contexto) => ({
        admins: crearAdminsDePostgres(db.withTables<AdminsDb>()),
        auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
          db.withTables<AuditoriaDePlataformaDb>(),
          contexto,
        ),
      }),
    });
    abiertas.push(transacciones);
    return transacciones;
  });

  const autenticacion = perezoso((): AutenticacionDePlataforma => {
    // Primero lo que se valida sin abrir nada; las conexiones recién después (un entorno roto no deja pools armados de más).
    const host = hostDeLaConsola();
    const { secreto, google } = credencialesDeIngreso();
    const conexion = conexionDeAutenticacion();
    const transacciones = transaccionesDelIngreso();
    return conHostFijo(
      crearAutenticacionDePlataformaDeBetterAuth({
        db: conexion.db,
        secreto,
        google,
        registrar: registrarDeIngreso,
        consola: {
          personal: crearPersonalHabilitadoDePostgres(transacciones),
          segundoFactor: conexion.segundoFactor,
          auditoria: crearAuditoriaDeIngresoDePlataformaDePostgres(transacciones),
        },
      }),
      host,
    );
  });

  const puerta = perezoso((): PuertaDeConsola => {
    const armada = armarPuertaDeConsola({ fuente, registrar, hostDeLaConsola: hostDeLaConsola() });
    abiertas.push(armada);
    return armada;
  });

  return {
    hostDeLaConsola,
    autenticacion,
    puerta,
    barridoDeSesiones: () => conexionDeAutenticacion().barrido,
    cerrar: async () => {
      await Promise.all(abiertas.splice(0).map((abierta) => abierta.cerrar()));
    },
  };
}
