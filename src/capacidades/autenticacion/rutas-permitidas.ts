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

/** Comparación exacta (método y ruta, sin barra final ni cambio de mayúsculas): la misma que verá la librería. */
export function rutaPermitida(metodo: string, ruta: string): boolean {
  return RUTAS_PERMITIDAS.some((p) => p.metodo === metodo && p.ruta === ruta);
}
