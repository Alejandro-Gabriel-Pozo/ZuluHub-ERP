import { crearPrimerAdmin } from "../src/adaptadores/postgres/primer-admin";
import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import { hostConPooler } from "../src/adaptadores/postgres/migraciones";
import { NOMBRE_DE_LA_CADENA_DE_DUENO } from "../src/adaptadores/vercel/plan-de-variables";

/**
 * Lo que hace `scripts/crear-primer-admin.ts`, separado de su arranque para poder probarlo y capturar lo
 * que escribe. Siembra al primer administrador de plataforma (rol ADMIN) con la cadena DIRECTA del dueño de
 * la base (`ZULUHUB_DB_MIGRACIONES`): sin un administrador sembrado nadie puede actuar como plataforma.
 *
 * Uso: `npm run plataforma:primer-admin -- <email>`. El email viene por argumento y NUNCA se imprime (ni
 * entero ni en pedazos): lo que sale es el identificador del administrador. Tampoco se imprimen la cadena ni
 * ninguna variable: todo pasa por `ocultarSecretos`, y las fallas de la base se cuentan con
 * `describirFallaDeBase`. Devuelve el código de salida: 0 todo bien (sembrado o ya estaba), 1 rechazo o
 * falla, 2 uso incorrecto.
 */

export const VARIABLE_DE_LA_CADENA = NOMBRE_DE_LA_CADENA_DE_DUENO;

export type EntradaDeCreacionDelPrimerAdmin = Readonly<{
  argumentos: readonly string[];
  entorno: Readonly<Record<string, string | undefined>>;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Por defecto, la real. Se inyecta en las pruebas. */
  sembrar?: typeof crearPrimerAdmin;
}>;

const MENSAJES = {
  EMAIL_INVALIDO: "El email no tiene forma de email (algo@dominio).",
  ADMIN_CON_MEMBRESIA:
    "Ese email ya es miembro de alguna empresa o grupo: un administrador de plataforma no puede tener ninguna membresía (decisión F5). Usá otro email.",
  ADMIN_CON_INVITACION_PENDIENTE:
    "Ese email tiene una invitación pendiente en alguna empresa: al aceptarla sería miembro. Revocala antes o usá otro email.",
  ADMIN_EXISTENTE_NO_ES_ADMIN_ACTIVO:
    "Ya hay un administrador con ese email, pero no es ADMIN activo (es SOPORTE o está dado de baja). Este script no cambia roles ni reactiva a nadie.",
} as const;

export async function ejecutarCreacionDelPrimerAdmin(
  entrada: EntradaDeCreacionDelPrimerAdmin,
): Promise<number> {
  const { entorno, argumentos } = entrada;
  const sembrar = entrada.sembrar ?? crearPrimerAdmin;
  const cadena = entorno[VARIABLE_DE_LA_CADENA]?.trim();
  // Se tapan la cadena y el email en todo lo que sale: una falla de la base podría repetir cualquiera de los dos.
  const email = argumentos[0];
  const tapar = (linea: string) => ocultarSecretos(ocultarSecretos(linea, cadena), email?.trim());
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));

  if (argumentos.length !== 1 || email === undefined || email.trim() === "") {
    error("Uso: npm run plataforma:primer-admin -- <email del administrador>");
    return 2;
  }
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

  try {
    const resultado = await sembrar(cadena, email);
    if (!resultado.ok) {
      error(`ERROR: ${MENSAJES[resultado.error]}`);
      error("RESULTADO: RECHAZADO (no se cambió nada).");
      return resultado.error === "EMAIL_INVALIDO" ? 2 : 1;
    }
    info(
      resultado.valor.yaEstaba
        ? `RESULTADO: OK, ya estaba (identificador ${resultado.valor.adminId}). No se cambió nada.`
        : `RESULTADO: OK, quedó sembrado el administrador de plataforma (ADMIN), identificador ${resultado.valor.adminId}.`,
    );
    return 0;
  } catch (falla) {
    error(`ERROR: ${describirFallaDeBase(falla, cadena)}`);
    error(
      "RESULTADO: FALLA (no se sabe si quedó sembrado: volvé a correrlo, es seguro repetirlo).",
    );
    return 1;
  }
}
