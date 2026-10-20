import { configuracionDeHost } from "../../capacidades/autenticacion/host-de-autenticacion";
import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Configuración de la autenticación (web-armazon §5.2). Acá solo viven los NOMBRES de las variables de
 * entorno: los valores los carga el dueño en Vercel. Falla cerrado: sin alguna de las tres, o con un
 * valor que no sirve, no se arma la autenticación. Los mensajes nombran la variable y el motivo, nunca
 * el valor recibido.
 */
export const PEDERNAL_AUTH_SECRETO_EMPRESA = "PEDERNAL_AUTH_SECRETO_EMPRESA";
/** El de la consola de plataforma: se declara en `composicion/entorno-de-plataforma.ts` (la web no lo recibe). */
export const PEDERNAL_AUTH_SECRETO_PLATAFORMA = "PEDERNAL_AUTH_SECRETO_PLATAFORMA";
export const GOOGLE_CLIENT_ID = "GOOGLE_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET = "GOOGLE_CLIENT_SECRET";
/** El cliente de Google de la consola: APARTE del de la web (revocar uno no corta al otro). Se declaran en `composicion/entorno-de-plataforma.ts`. */
export const GOOGLE_CLIENT_ID_PLATAFORMA = "GOOGLE_CLIENT_ID_PLATAFORMA";
export const GOOGLE_CLIENT_SECRET_PLATAFORMA = "GOOGLE_CLIENT_SECRET_PLATAFORMA";
/** El host (sin esquema) donde atiende la consola; la instancia de ingreso de plataforma es de ESE host y de ningún otro. */
export const PEDERNAL_HOST_DE_LA_CONSOLA = "PEDERNAL_HOST_DE_LA_CONSOLA";

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
  return leerSecreto(PEDERNAL_AUTH_SECRETO_EMPRESA, valor);
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
  const secreto = leerSecreto(PEDERNAL_AUTH_SECRETO_PLATAFORMA, valor);
  if (secretoDeEmpresa !== undefined && secretoDeEmpresa.trim() === secreto) {
    throw new ErrorDeConfiguracion(
      `${PEDERNAL_AUTH_SECRETO_PLATAFORMA} inválido: no puede ser igual a ${PEDERNAL_AUTH_SECRETO_EMPRESA}`,
    );
  }
  return secreto;
}

export type ClienteDeGoogle = Readonly<{ clientId: string; clientSecret: string }>;

/** La misma exigencia para el cliente de cualquier audiencia: que no falte ninguno de los dos. El mensaje nombra la variable, nunca el valor. */
function leerCliente(
  nombreDelId: string,
  nombreDelSecreto: string,
  clientId: string | undefined,
  clientSecret: string | undefined,
): ClienteDeGoogle {
  const id = clientId?.trim() ?? "";
  const secreto = clientSecret?.trim() ?? "";
  const faltan = [
    ...(id === "" ? [nombreDelId] : []),
    ...(secreto === "" ? [nombreDelSecreto] : []),
  ];
  if (faltan.length > 0) {
    throw new ErrorDeConfiguracion(`${faltan.join(", ")} inválido: falta`);
  }
  return { clientId: id, clientSecret: secreto };
}

/** El cliente OAuth de Google. Es un secreto: no se registra ni se guarda. */
export function leerClienteDeGoogle(
  clientId: string | undefined,
  clientSecret: string | undefined,
): ClienteDeGoogle {
  return leerCliente(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, clientId, clientSecret);
}

/**
 * El cliente OAuth de Google de la consola: la misma exigencia que el de la web y, además, NUNCA el mismo que el de la
 * web (ni el id ni el secreto). Falla que previene: con un solo cliente para las dos audiencias, revocar o rotar uno
 * corta a la otra y una pantalla de consentimiento y una lista de URIs de retorno sirven a las dos. `clienteDeLaWeb` es el
 * de la otra audiencia SI el entorno lo tiene a la vista (la consola, en su proyecto de Vercel, normalmente no lo tiene:
 * ahí no hay con qué comparar); sin él no se compara. Falla cerrado; el mensaje nombra las variables, nunca los valores.
 */
export function leerClienteDeGoogleDePlataforma(
  clientId: string | undefined,
  clientSecret: string | undefined,
  clienteDeLaWeb?: Readonly<{ clientId: string | undefined; clientSecret: string | undefined }>,
): ClienteDeGoogle {
  const cliente = leerCliente(
    GOOGLE_CLIENT_ID_PLATAFORMA,
    GOOGLE_CLIENT_SECRET_PLATAFORMA,
    clientId,
    clientSecret,
  );
  const iguales = [
    ...(clienteDeLaWeb?.clientId?.trim() === cliente.clientId
      ? [`${GOOGLE_CLIENT_ID_PLATAFORMA} inválido: no puede ser igual a ${GOOGLE_CLIENT_ID}`]
      : []),
    ...(clienteDeLaWeb?.clientSecret?.trim() === cliente.clientSecret
      ? [
          `${GOOGLE_CLIENT_SECRET_PLATAFORMA} inválido: no puede ser igual a ${GOOGLE_CLIENT_SECRET}`,
        ]
      : []),
  ];
  if (iguales.length > 0) throw new ErrorDeConfiguracion(iguales.join("; "));
  return cliente;
}

/**
 * El host de la consola: un nombre de host (etiquetas DNS en minúsculas, puerto opcional), sin esquema, ruta ni
 * credenciales (`configuracionDeHost`). Falla que previene: un valor con `https://`, mayúsculas o una barra armaría una
 * instancia de ingreso con un origen que nunca coincide con el de las cookies y la dejaría inservible (o peor, ambigua).
 * Una sola instancia por host fijo: no hay lista de hosts. Falla cerrado; el mensaje nombra la variable, nunca el valor.
 */
export function leerHostDeLaConsola(valor: string | undefined): string {
  const host = valor?.trim() ?? "";
  if (host === "") throw new ErrorDeConfiguracion(`${PEDERNAL_HOST_DE_LA_CONSOLA} inválido: falta`);
  if (!configuracionDeHost(host).ok) {
    throw new ErrorDeConfiguracion(
      `${PEDERNAL_HOST_DE_LA_CONSOLA} inválido: tiene que ser un nombre de host en minúsculas, sin esquema ni ruta`,
    );
  }
  return host;
}
