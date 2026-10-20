import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Configuración de la autenticación (web-armazon §5.2). Acá solo viven los NOMBRES de las variables de
 * entorno: los valores los carga el dueño en Vercel. Falla cerrado: sin alguna de las tres, o con un
 * valor que no sirve, no se arma la autenticación. Los mensajes nombran la variable y el motivo, nunca
 * el valor recibido.
 */
export const ZULUHUB_AUTH_SECRETO_EMPRESA = "ZULUHUB_AUTH_SECRETO_EMPRESA";
/** El de la consola de plataforma: se declara en `composicion/entorno-de-plataforma.ts` (la web no lo recibe). */
export const ZULUHUB_AUTH_SECRETO_PLATAFORMA = "ZULUHUB_AUTH_SECRETO_PLATAFORMA";
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

/** La misma exigencia para el secreto de cualquier audiencia: largo, variedad y que no falte. El mensaje nombra la variable, nunca el valor. */
function leerSecreto(nombre: string, valor: string | undefined): string {
  const texto = valor?.trim() ?? "";
  if (texto === "") {
    throw new ErrorDeConfiguracion(`${nombre} inválido: falta`);
  }
  if (texto.length < LARGO_MINIMO_DEL_SECRETO) {
    throw new ErrorDeConfiguracion(
      `${nombre} inválido: necesita al menos ${LARGO_MINIMO_DEL_SECRETO} caracteres`,
    );
  }
  if (caracteresDistintos(texto) < CARACTERES_DISTINTOS_MINIMOS) {
    throw new ErrorDeConfiguracion(
      `${nombre} inválido: necesita al menos ${CARACTERES_DISTINTOS_MINIMOS} caracteres distintos`,
    );
  }
  return texto;
}

/** El secreto de Better Auth de la aplicación de empresa. */
export function leerSecretoDeAutenticacion(valor: string | undefined): string {
  return leerSecreto(ZULUHUB_AUTH_SECRETO_EMPRESA, valor);
}

/**
 * El secreto de Better Auth de la consola de plataforma: la misma exigencia que el de empresa y, además, NUNCA igual a
 * él. Firma las cookies y cifra el secreto TOTP: con el mismo valor, una cookie de una audiencia valdría en la otra (el
 * prefijo distinto no alcanza si la firma coincide). Falla cerrado. `secretoDeEmpresa` es el de la otra audiencia SI el
 * entorno lo tiene a la vista (la consola, en su proyecto de Vercel, normalmente no lo tiene: ahí no hay con qué
 * comparar); `undefined` lo saltea.
 */
export function leerSecretoDeAutenticacionDePlataforma(
  valor: string | undefined,
  secretoDeEmpresa?: string,
): string {
  const secreto = leerSecreto(ZULUHUB_AUTH_SECRETO_PLATAFORMA, valor);
  if (secretoDeEmpresa !== undefined && secretoDeEmpresa.trim() === secreto) {
    throw new ErrorDeConfiguracion(
      `${ZULUHUB_AUTH_SECRETO_PLATAFORMA} inválido: no puede ser igual a ${ZULUHUB_AUTH_SECRETO_EMPRESA}`,
    );
  }
  return secreto;
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
