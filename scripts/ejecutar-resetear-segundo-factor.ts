import { resetearElSegundoFactor } from "../src/adaptadores/postgres/reseteo-de-segundo-factor";
import { prepararScriptDelDueno, type EntradaDeScriptDelDueno } from "./entrada-del-dueno";

/**
 * Lo que hace `scripts/resetear-segundo-factor.ts`, separado de su arranque para poder probarlo y capturar lo que
 * escribe. Para un administrador que perdió su dispositivo (h5-p8 §2.4): borra su segundo factor (TOTP y códigos de
 * recuperación), limpia sus intentos fallidos y cierra TODAS sus sesiones, en una sola operación y con la cadena DIRECTA
 * del dueño (`PEDERNAL_DB_MIGRACIONES`). El siguiente ingreso vuelve a enrolar, dentro de los 10 minutos de la sesión.
 * Idempotente y auditado, sin el email.
 *
 * Uso: `npm run plataforma:resetear-segundo-factor -- <email>`. Detalle de lo que imprime y los códigos de salida:
 * `entrada-del-dueno.ts`.
 */

export const USO = "Uso: npm run plataforma:resetear-segundo-factor -- <email del administrador>";

export type EntradaDeReseteoDelSegundoFactor = EntradaDeScriptDelDueno &
  Readonly<{
    /** Por defecto, la real. Se inyecta en las pruebas. */ resetear?: typeof resetearElSegundoFactor;
  }>;

const MENSAJES = {
  EMAIL_INVALIDO: "El email no tiene forma de email (algo@dominio).",
  ADMIN_NO_ENCONTRADO: "No existe ningún administrador de plataforma con ese email.",
  ADMIN_DADO_DE_BAJA: "Ese administrador está dado de baja: no hay segundo factor que resetear.",
} as const;

export async function ejecutarReseteoDelSegundoFactor(
  entrada: EntradaDeReseteoDelSegundoFactor,
): Promise<number> {
  const previa = prepararScriptDelDueno(entrada, USO);
  if (previa.tipo === "CORTA") return previa.codigo;
  const { cadena, email, info, error, contarFalla } = previa;
  try {
    const resultado = await (entrada.resetear ?? resetearElSegundoFactor)(cadena, email);
    if (!resultado.ok) {
      error(`ERROR: ${MENSAJES[resultado.error]}`);
      error("RESULTADO: RECHAZADO (no se cambió nada).");
      return resultado.error === "EMAIL_INVALIDO" ? 2 : 1;
    }
    const { adminId, yaEstaba, sesionesRevocadas } = resultado.valor;
    info(
      yaEstaba
        ? `RESULTADO: OK, ya estaba sin segundo factor ni sesiones abiertas (identificador ${adminId}). No se cambió nada.`
        : `RESULTADO: OK, se reseteó el segundo factor del administrador (identificador ${adminId}). Sesiones cerradas: ${sesionesRevocadas}. En su próximo ingreso lo vuelve a enrolar (tiene 10 minutos desde que entra).`,
    );
    return 0;
  } catch (falla) {
    error(`ERROR: ${contarFalla(falla)}`);
    error(
      "RESULTADO: FALLA (no se sabe si quedó reseteado: volvé a correrlo, es seguro repetirlo).",
    );
    return 1;
  }
}
