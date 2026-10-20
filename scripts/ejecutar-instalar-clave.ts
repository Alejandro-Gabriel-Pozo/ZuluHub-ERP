import {
  PEDERNAL_CLAVE_CONTEXTO,
  instalarClaveDeContexto,
  leerClaveDeContexto,
} from "../src/adaptadores/postgres/contexto-firmado.ts";
import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base.ts";
import { ErrorDeConfiguracion } from "../src/adaptadores/postgres/errores.ts";
import { hostConPooler } from "../src/adaptadores/postgres/migraciones.ts";
import { NOMBRE_DE_LA_CADENA_DE_DUENO } from "../src/adaptadores/vercel/plan-de-variables.ts";

/**
 * Lo que hace `scripts/instalar-clave-de-contexto.ts`, separado de su arranque para poder probarlo y capturar lo
 * que escribe. Instala en la tabla `contexto_clave` de la base la clave de firma del contexto
 * (`PEDERNAL_CLAVE_CONTEXTO`, formato `<kid>:<hex>`): la MISMA que la aplicación tiene cargada en Vercel para esa
 * rama de Neon, porque la base verifica con ella lo que la aplicación firma. Lo corre el workflow `migrar.yml`
 * (después de aplicar las migraciones, solo si el entorno de GitHub tiene la clave) y el dueño en su terminal.
 *
 * Idempotente: repetirlo con la misma clave no cambia nada. Con el mismo `kid` y OTRO secreto falla (la rotación
 * se hace con otro `kid`), y con una clave revocada también (`instalarClaveDeContexto`).
 *
 * Usa la cadena DIRECTA del dueño de la base (`PEDERNAL_DB_MIGRACIONES`; ningún rol limitado puede escribir esa
 * tabla). No escribe jamás la cadena ni la clave, ni entera ni en pedazos: todo lo que imprime pasa por
 * `ocultarSecretos`, y las fallas de la base se cuentan con `describirFallaDeBase`. Devuelve el código de
 * salida: 0 todo bien, 1 falla o problema de configuración.
 */

export const VARIABLE_DE_LA_CADENA = NOMBRE_DE_LA_CADENA_DE_DUENO;

export type EntradaDeInstalacionDeClave = Readonly<{
  entorno: Readonly<Record<string, string | undefined>>;
  info: (linea: string) => void;
  error: (linea: string) => void;
}>;

export async function ejecutarInstalacionDeClave(
  entrada: EntradaDeInstalacionDeClave,
): Promise<number> {
  const { entorno } = entrada;
  const cadena = entorno[VARIABLE_DE_LA_CADENA]?.trim();
  const clave = entorno[PEDERNAL_CLAVE_CONTEXTO]?.trim();
  // Se tapan la cadena y el secreto de la clave (la parte hexadecimal) en todo lo que sale.
  const secretoDeLaClave = clave?.split(":")[1];
  const tapar = (linea: string) =>
    ocultarSecretos(ocultarSecretos(linea, cadena), secretoDeLaClave);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));

  if (cadena === undefined || cadena === "") {
    error(
      `ERROR: falta la variable ${VARIABLE_DE_LA_CADENA}: es la cadena de conexión DIRECTA del dueño de la base.`,
    );
    return 1;
  }
  let protocolo: string;
  try {
    protocolo = new URL(cadena).protocol;
  } catch {
    protocolo = "";
  }
  if (protocolo !== "postgres:" && protocolo !== "postgresql:") {
    error(
      `ERROR: ${VARIABLE_DE_LA_CADENA} no tiene forma de cadena de conexión (postgresql://usuario:clave@host/base).`,
    );
    return 1;
  }
  if (hostConPooler(cadena)) {
    error(
      `ERROR: ${VARIABLE_DE_LA_CADENA} apunta al pooler (el host lleva «-pooler»): se usa la cadena DIRECTA.`,
    );
    return 1;
  }

  let parseada: ReturnType<typeof leerClaveDeContexto>;
  try {
    parseada = leerClaveDeContexto(clave);
  } catch (falla) {
    // Su mensaje nombra la variable y el motivo; nunca el valor.
    error(`ERROR: ${falla instanceof ErrorDeConfiguracion ? falla.message : "clave inválida"}.`);
    return 1;
  }

  try {
    await instalarClaveDeContexto(cadena, parseada);
  } catch (falla) {
    error(`ERROR: ${describirFallaDeBase(falla, cadena)}`);
    error("RESULTADO: FALLA (la clave de contexto no quedó instalada).");
    return 1;
  }
  info(`RESULTADO: OK, la clave de contexto kid ${parseada.kid} está instalada en la base.`);
  return 0;
}
