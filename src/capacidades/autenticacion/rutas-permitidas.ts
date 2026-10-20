import { RUTA_BASE_DE_INGRESO } from "./host-de-autenticacion";

/**
 * Las únicas rutas de la librería de ingreso que la aplicación deja pasar (web-armazon §4.1,
 * `disabledPaths`). LISTA CERRADA: lo que no está acá no llega a la librería (404), aunque una versión
 * nueva sume rutas. Previene una ruta que nadie revisó (cambiar el nombre, borrar la cuenta, vincular
 * otra cuenta, abrir sesión con contraseña) ofrecida en un host de la aplicación.
 *
 *  - empezar el ingreso con Google (`POST /sign-in/social`);
 *  - el retorno de Google (`GET /callback/google`);
 *  - leer y renovar la sesión (`GET /get-session`): lo usa el «Seguir» del aviso de inactividad;
 *  - cerrar sesión (`POST /sign-out`): borra la fila.
 */
export const RUTAS_PERMITIDAS: readonly Readonly<{ metodo: string; ruta: string }>[] =
  Object.freeze([
    { metodo: "POST", ruta: `${RUTA_BASE_DE_INGRESO}/sign-in/social` },
    { metodo: "GET", ruta: `${RUTA_BASE_DE_INGRESO}/callback/google` },
    { metodo: "GET", ruta: `${RUTA_BASE_DE_INGRESO}/get-session` },
    { metodo: "POST", ruta: `${RUTA_BASE_DE_INGRESO}/sign-out` },
  ]);

/**
 * El estado de la sesión de la consola (P8a): lo sirve el adaptador mismo (no es una ruta de la librería) y NO
 * renueva la sesión: la pantalla puede mirarlo sin que mirar cuente como uso. `get-session` sí renueva («Seguir»).
 */
export const RUTA_DE_ESTADO_DE_SESION = `${RUTA_BASE_DE_INGRESO}/estado-de-sesion`;

/**
 * Las únicas rutas que deja pasar la consola de PLATAFORMA (h5-p8 §3). Lista CERRADA como la de empresa y con las
 * mismas cuatro del ingreso, más el estado de sesión y las del segundo factor: enrolar, verificar el código de la
 * aplicación, verificar un código de recuperación y regenerar los códigos. NO están «ver el secreto» ni «dar de baja
 * el TOTP»: la pérdida del dispositivo la resuelve el dueño por script, no una pantalla (la guarda de «segundo factor
 * reciente» (G3) las cubre igual si alguna vez se las abre).
 */
export const RUTAS_PERMITIDAS_DE_PLATAFORMA: readonly Readonly<{ metodo: string; ruta: string }>[] =
  Object.freeze([
    ...RUTAS_PERMITIDAS,
    { metodo: "GET", ruta: RUTA_DE_ESTADO_DE_SESION },
    { metodo: "POST", ruta: `${RUTA_BASE_DE_INGRESO}/two-factor/enable` },
    { metodo: "POST", ruta: `${RUTA_BASE_DE_INGRESO}/two-factor/verify-totp` },
    { metodo: "POST", ruta: `${RUTA_BASE_DE_INGRESO}/two-factor/verify-backup-code` },
    { metodo: "POST", ruta: `${RUTA_BASE_DE_INGRESO}/two-factor/generate-backup-codes` },
  ]);

type ListaDeRutas = readonly Readonly<{ metodo: string; ruta: string }>[];

const estaEn = (lista: ListaDeRutas, metodo: string, ruta: string): boolean =>
  lista.some((p) => p.metodo === metodo && p.ruta === ruta);

/** Comparación exacta (método y ruta, sin barra final ni cambio de mayúsculas): la misma que verá la librería. */
export function rutaPermitida(metodo: string, ruta: string): boolean {
  return estaEn(RUTAS_PERMITIDAS, metodo, ruta);
}

/** Lo mismo para la consola de plataforma. */
export function rutaPermitidaDePlataforma(metodo: string, ruta: string): boolean {
  return estaEn(RUTAS_PERMITIDAS_DE_PLATAFORMA, metodo, ruta);
}
