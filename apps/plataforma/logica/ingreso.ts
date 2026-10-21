import {
  CODIGOS_DE_PLATAFORMA,
  type CodigoDePlataforma,
} from "../../../src/capacidades/autenticacion/codigos-de-plataforma";

/**
 * Qué ve y a dónde va la persona según el código público del ingreso de la consola (h5-p8 §3 y §6). Puro: sin
 * Next ni React, se prueba en `test/plataforma/`.
 */

/**
 * El mismo texto para «cuenta no habilitada» y «código inválido» (y para cualquier fallo genérico): si cambiara
 * entre uno y otro, la pantalla diría quién es personal de la plataforma (un oráculo).
 */
export const TEXTO_NEUTRO_DE_INGRESO =
  "No pudimos iniciar sesión. Revisá el código o volvé a ingresar.";

const TEXTO_DE_BLOQUEO = "Hubo demasiados intentos. Esperá unos minutos y probá de nuevo.";
const TEXTO_DE_SESION_VENCIDA = "La sesión venció. Ingresá de nuevo para seguir.";

const esCodigo = (valor: string | null): valor is CodigoDePlataforma =>
  (CODIGOS_DE_PLATAFORMA as readonly (string | null)[]).includes(valor);

/**
 * El aviso rojo de `/ingreso?error=…`. Un código que no es de la lista (o ninguno) no muestra nada si no hay error,
 * y el texto neutro si hay uno que no se reconoce: nunca el código a la vista. Los que llevan a otra pantalla
 * (`segundo_factor_*`) no se muestran como error.
 */
export function textoDelErrorDeIngreso(codigo: string | null): string | null {
  if (codigo === null || codigo === "") return null;
  if (!esCodigo(codigo)) return TEXTO_NEUTRO_DE_INGRESO;
  switch (codigo) {
    case "sesion_vencida":
      return TEXTO_DE_SESION_VENCIDA;
    case "demasiados_intentos":
      return TEXTO_DE_BLOQUEO;
    case "segundo_factor_requerido":
    case "segundo_factor_a_enrolar":
    case "segundo_factor_reciente_requerido":
      return null;
    case "no_habilitado":
    case "codigo_invalido":
      return TEXTO_NEUTRO_DE_INGRESO;
  }
}

/**
 * A dónde se manda a quien la puerta no deja pasar. `no_habilitado` y `sesion_vencida` vuelven al ingreso con el
 * motivo; el segundo factor lleva a verificar o a enrolar. `codigo_invalido` y los demás no son motivos de la
 * puerta: vuelven al ingreso.
 */
export function destinoSinAcceso(codigo: CodigoDePlataforma): string {
  switch (codigo) {
    case "segundo_factor_requerido":
      return "/ingreso/codigo";
    case "segundo_factor_a_enrolar":
      return "/ingreso/alta";
    case "sesion_vencida":
    case "no_habilitado":
    case "codigo_invalido":
    case "demasiados_intentos":
    case "segundo_factor_reciente_requerido":
      return `/ingreso?error=${codigo}`;
  }
}

/** Seis dígitos (la aplicación de autenticación) o diez caracteres con guion (código de recuperación). */
const CODIGO_DE_APLICACION = /^\d{6}$/;
const CODIGO_DE_RECUPERACION = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

/**
 * Saca todos los espacios (lo que alguien pega desde el celular suele traer uno en el medio) y NO toca
 * mayúsculas ni minúsculas: los códigos de recuperación mezclan ambas y el servidor los compara tal cual.
 */
export function normalizarCodigo(crudo: string): string {
  return crudo.replace(/\s+/g, "");
}

export const esCodigoDeAplicacion = (codigo: string): boolean => CODIGO_DE_APLICACION.test(codigo);
export const esCodigoDeRecuperacion = (codigo: string): boolean =>
  CODIGO_DE_RECUPERACION.test(codigo);

/** Lo que hace la pantalla con la respuesta de verificar un código (`two-factor/verify-*`). */
export type ResultadoDeVerificacion =
  | Readonly<{ tipo: "ok" }>
  | Readonly<{ tipo: "ir"; destino: string }>
  | Readonly<{ tipo: "error"; texto: string }>;

/**
 * Traduce la respuesta del servidor: el estado HTTP y el `codigo` del cuerpo (`{codigo}` y nada más). Un código que no
 * es de la lista, o un cuerpo ilegible, es el texto neutro: nunca se muestra lo que mandó el servidor. Los códigos
 * inválidos y los no habilitados dicen exactamente lo mismo (sin oráculo).
 */
export function resultadoDeVerificacion(estado: number, cuerpo: unknown): ResultadoDeVerificacion {
  if (estado >= 200 && estado < 300) return { tipo: "ok" };
  const codigo =
    typeof cuerpo === "object" && cuerpo !== null && "codigo" in cuerpo ? cuerpo.codigo : null;
  if (codigo === "segundo_factor_a_enrolar") return { tipo: "ir", destino: "/ingreso/alta" };
  if (codigo === "sesion_vencida" || codigo === "no_habilitado") {
    return { tipo: "ir", destino: `/ingreso?error=${codigo}` };
  }
  if (codigo === "demasiados_intentos") return { tipo: "error", texto: TEXTO_DE_BLOQUEO };
  return { tipo: "error", texto: TEXTO_NEUTRO_DE_INGRESO };
}
