import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { segundoFactorReciente } from "../autenticacion/ventanas-de-segundo-factor";
import { CATALOGO_DE_PLATAFORMA, type ClaveAccionDePlataforma } from "./plataforma";

/**
 * Qué acciones de plataforma exigen el segundo factor RECIENTE y cuándo se lo da por cumplido (h5-p8 §2.4 bis; DECIDIDO
 * por el dueño). Funciones puras: el reloj entra como dato.
 *
 * Previene: que una sesión que pasó el segundo factor hace horas (el tope es de 8) o que nunca lo pasó cambie algo con
 * efecto sobre clientes porque quien llama desde la consola olvidó pedir el código otra vez. La lista vive en el
 * catálogo (`segundoFactorReciente` por acción) y la decide el servidor; la pantalla solo reacciona al código.
 */

export const CODIGO_DE_SEGUNDO_FACTOR_RECIENTE_REQUERIDO = "segundo_factor_reciente_requerido";

export type ErrorDeSegundoFactorReciente = typeof CODIGO_DE_SEGUNDO_FACTOR_RECIENTE_REQUERIDO;

/** ¿Esa acción exige el segundo factor reciente? Lo dice su declaración en el catálogo. */
export function exigeSegundoFactorReciente(accion: ClaveAccionDePlataforma): boolean {
  const acciones: Readonly<Record<string, { segundoFactorReciente: boolean }>> =
    CATALOGO_DE_PLATAFORMA.plataforma.acciones;
  const definicion = acciones[accion];
  // Una acción que el catálogo no declara es un defecto (por tipos no puede pasar): se exige, nunca se omite.
  return definicion === undefined ? true : definicion.segundoFactorReciente;
}

/** Todas las acciones que lo exigen, ordenadas: sirve para verlas y compararlas con la lista del dueño. */
export function accionesConSegundoFactorReciente(): readonly ClaveAccionDePlataforma[] {
  return (Object.keys(CATALOGO_DE_PLATAFORMA.plataforma.acciones) as ClaveAccionDePlataforma[])
    .filter(exigeSegundoFactorReciente)
    .sort();
}

/**
 * La decisión de la puerta antes de correr el caso: si la acción no lo exige, pasa; si lo exige, el segundo factor de
 * ESA sesión tiene que haberse verificado hace 5 minutos o menos (`segundoFactorReciente`, la misma ventana que usa el
 * resto de la autenticación). `null`, una fecha inválida o una vieja dan `segundo_factor_reciente_requerido`.
 */
export function decidirSegundoFactorRecienteDeLaAccion(
  accion: ClaveAccionDePlataforma,
  segundoFactorEn: Date | null,
  ahora: Date,
): Resultado<null, ErrorDeSegundoFactorReciente> {
  if (!exigeSegundoFactorReciente(accion)) return ok(null);
  return segundoFactorReciente(segundoFactorEn, ahora)
    ? ok(null)
    : err(CODIGO_DE_SEGUNDO_FACTOR_RECIENTE_REQUERIDO);
}
