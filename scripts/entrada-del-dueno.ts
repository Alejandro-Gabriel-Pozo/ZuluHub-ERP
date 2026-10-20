import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { hostConPooler } from "../src/adaptadores/postgres/migraciones";
import { NOMBRE_DE_LA_CADENA_DE_DUENO } from "../src/adaptadores/vercel/plan-de-variables";

/**
 * Lo que comparten los scripts del dueño que reciben UN email y operan con su conexión DIRECTA (`PEDERNAL_DB_MIGRACIONES`):
 * la baja de un administrador y el reseteo de su segundo factor (h5-p8 §2.4 y §2.5). Mismas reglas que
 * `ejecutar-crear-primer-admin.ts`: el email viene por argumento y NUNCA se imprime (ni entero ni en pedazos), tampoco
 * la cadena ni ninguna variable (todo pasa por `ocultarSecretos`), y las fallas de la base se cuentan con
 * `describirFallaDeBase`. Códigos de salida: 0 todo bien (también «ya estaba»), 1 rechazo o falla, 2 uso incorrecto.
 */

export const VARIABLE_DE_LA_CADENA = NOMBRE_DE_LA_CADENA_DE_DUENO;

export type EntradaDeScriptDelDueno = Readonly<{
  argumentos: readonly string[];
  entorno: Readonly<Record<string, string | undefined>>;
  info: (linea: string) => void;
  error: (linea: string) => void;
}>;

export type ScriptDelDuenoListo = Readonly<{
  tipo: "LISTO";
  cadena: string;
  email: string;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** La falla inesperada de la base, contada sin repetir la cadena ni el email. */
  contarFalla: (falla: unknown) => string;
}>;

/** Valida la línea de comandos y la cadena ANTES de tocar nada. `CORTA`: ya se explicó y este es el código de salida. */
export function prepararScriptDelDueno(
  entrada: EntradaDeScriptDelDueno,
  uso: string,
): ScriptDelDuenoListo | Readonly<{ tipo: "CORTA"; codigo: number }> {
  const { entorno, argumentos } = entrada;
  const cadena = entorno[VARIABLE_DE_LA_CADENA]?.trim();
  const email = argumentos[0];
  // Se tapan la cadena y el email en todo lo que sale: una falla de la base podría repetir cualquiera de los dos.
  const tapar = (linea: string) => ocultarSecretos(ocultarSecretos(linea, cadena), email?.trim());
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));

  if (argumentos.length !== 1 || email === undefined || email.trim() === "") {
    error(uso);
    return { tipo: "CORTA", codigo: 2 };
  }
  if (cadena === undefined || cadena === "") {
    error(
      `ERROR: falta la variable ${VARIABLE_DE_LA_CADENA}: es la cadena de conexión DIRECTA del dueño de la base.`,
    );
    return { tipo: "CORTA", codigo: 1 };
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
    return { tipo: "CORTA", codigo: 1 };
  }
  if (hostConPooler(cadena)) {
    error(
      `ERROR: ${VARIABLE_DE_LA_CADENA} apunta al pooler (el host lleva «-pooler»): se usa la cadena DIRECTA.`,
    );
    return { tipo: "CORTA", codigo: 1 };
  }
  return {
    tipo: "LISTO",
    cadena,
    email,
    info,
    error,
    contarFalla: (falla) => describirFallaDeBase(falla, cadena),
  };
}

/** El arranque de un script del dueño: una falla que se escape no vuelca la pila (ni el texto crudo de la red) a la terminal. */
export function instalarRedDeSeguridad(): void {
  function fallaInesperada(falla: unknown): void {
    const cadena = process.env[VARIABLE_DE_LA_CADENA];
    const descripcion = ocultarSecretos(
      describirFallaDeBase(falla, cadena),
      process.argv[2]?.trim(),
    );
    console.error(`ERROR inesperado: ${descripcion}`);
    process.exit(1);
  }
  process.on("uncaughtException", fallaInesperada);
  process.on("unhandledRejection", fallaInesperada);
}
