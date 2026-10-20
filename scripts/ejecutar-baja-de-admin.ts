import { darDeBajaAlAdmin } from "../src/adaptadores/postgres/baja-de-admin";
import { prepararScriptDelDueno, type EntradaDeScriptDelDueno } from "./entrada-del-dueno";

/**
 * Lo que hace `scripts/baja-de-admin.ts`, separado de su arranque para poder probarlo y capturar lo que escribe. Da de
 * baja a un administrador de plataforma (`activo = false`) y cierra TODAS sus sesiones en la misma operación (h5-p8 §2.5),
 * con la cadena DIRECTA del dueño de la base (`ZULUHUB_DB_MIGRACIONES`). Es idempotente y deja la constancia en la
 * auditoría de plataforma, sin el email.
 *
 * Uso: `npm run plataforma:baja-admin -- <email>`. Detalle de lo que imprime y los códigos de salida:
 * `entrada-del-dueno.ts`.
 */

export const USO = "Uso: npm run plataforma:baja-admin -- <email del administrador>";

export type EntradaDeBajaDeAdmin = EntradaDeScriptDelDueno &
  Readonly<{
    /** Por defecto, la real. Se inyecta en las pruebas. */ dar?: typeof darDeBajaAlAdmin;
  }>;

const MENSAJES = {
  EMAIL_INVALIDO: "El email no tiene forma de email (algo@dominio).",
  ADMIN_NO_ENCONTRADO: "No existe ningún administrador de plataforma con ese email.",
} as const;

export async function ejecutarBajaDeAdmin(entrada: EntradaDeBajaDeAdmin): Promise<number> {
  const previa = prepararScriptDelDueno(entrada, USO);
  if (previa.tipo === "CORTA") return previa.codigo;
  const { cadena, email, info, error, contarFalla } = previa;
  try {
    const resultado = await (entrada.dar ?? darDeBajaAlAdmin)(cadena, email);
    if (!resultado.ok) {
      error(`ERROR: ${MENSAJES[resultado.error]}`);
      error("RESULTADO: RECHAZADO (no se cambió nada).");
      return resultado.error === "EMAIL_INVALIDO" ? 2 : 1;
    }
    const { adminId, yaEstabaDeBaja, sesionesRevocadas } = resultado.valor;
    info(
      yaEstabaDeBaja
        ? `RESULTADO: OK, ya estaba dado de baja (identificador ${adminId}). Sesiones cerradas ahora: ${sesionesRevocadas}.`
        : `RESULTADO: OK, quedó dado de baja el administrador de plataforma (identificador ${adminId}). Sesiones cerradas: ${sesionesRevocadas}.`,
    );
    return 0;
  } catch (falla) {
    error(`ERROR: ${contarFalla(falla)}`);
    error(
      "RESULTADO: FALLA (no se sabe si quedó dado de baja: volvé a correrlo, es seguro repetirlo).",
    );
    return 1;
  }
}
