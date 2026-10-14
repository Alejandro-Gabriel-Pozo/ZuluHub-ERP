import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Configuración de la autenticación (web-armazon §5.2). Acá solo viven los NOMBRES de las variables de
 * entorno: los valores los carga el dueño en Vercel. Falla cerrado: sin alguna de las tres, o con un
 * valor que no sirve, no se arma la autenticación. Los mensajes nombran la variable y el motivo, nunca
 * el valor recibido.
 */
export const ZULUHUB_AUTH_SECRETO_EMPRESA = "ZULUHUB_AUTH_SECRETO_EMPRESA";
export const GOOGLE_CLIENT_ID = "GOOGLE_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET = "GOOGLE_CLIENT_SECRET";

/** El secreto firma las cookies y cifra los tokens guardados: uno corto se adivina. */
export const LARGO_MINIMO_DEL_SECRETO = 32;

/**
 * Además del largo, la variedad (M3): un secreto de 32 caracteres que repite uno o dos (`aaaa…`, `abab…`)
 * mide 32 pero se adivina en minutos. El criterio es simple y puro: cuántos caracteres DISTINTOS tiene. Diez
 * dejan pasar cualquier secreto sorteado (un hexadecimal de 32 caracteres tiene casi siempre 13 o más) y
 * rechazan lo repetido a mano. No pretende medir la entropía real: es un piso contra el descuido.
 */
export const CARACTERES_DISTINTOS_MINIMOS = 10;

export const caracteresDistintos = (texto: string): number => new Set(texto).size;

/** El secreto de Better Auth de la aplicación de empresa (la consola, después, usará otro). */
export function leerSecretoDeAutenticacion(valor: string | undefined): string {
  const texto = valor?.trim() ?? "";
  if (texto === "") {
    throw new ErrorDeConfiguracion(`${ZULUHUB_AUTH_SECRETO_EMPRESA} inválido: falta`);
  }
  if (texto.length < LARGO_MINIMO_DEL_SECRETO) {
    throw new ErrorDeConfiguracion(
      `${ZULUHUB_AUTH_SECRETO_EMPRESA} inválido: necesita al menos ${LARGO_MINIMO_DEL_SECRETO} caracteres`,
    );
  }
  if (caracteresDistintos(texto) < CARACTERES_DISTINTOS_MINIMOS) {
    throw new ErrorDeConfiguracion(
      `${ZULUHUB_AUTH_SECRETO_EMPRESA} inválido: necesita al menos ${CARACTERES_DISTINTOS_MINIMOS} caracteres distintos`,
    );
  }
  return texto;
}

export type ClienteDeGoogle = Readonly<{ clientId: string; clientSecret: string }>;

/** El cliente OAuth de Google. Es un secreto: no se registra ni se guarda. */
export function leerClienteDeGoogle(
  clientId: string | undefined,
  clientSecret: string | undefined,
): ClienteDeGoogle {
  const id = clientId?.trim() ?? "";
  const secreto = clientSecret?.trim() ?? "";
  const faltan = [
    ...(id === "" ? [GOOGLE_CLIENT_ID] : []),
    ...(secreto === "" ? [GOOGLE_CLIENT_SECRET] : []),
  ];
  if (faltan.length > 0) {
    throw new ErrorDeConfiguracion(`${faltan.join(", ")} inválido: falta`);
  }
  return { clientId: id, clientSecret: secreto };
}
