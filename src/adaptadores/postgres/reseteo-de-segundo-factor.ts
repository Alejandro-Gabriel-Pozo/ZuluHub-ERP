import {
  decidirReseteoDeSegundoFactor,
  type ErrorDeReseteoDeSegundoFactor,
} from "../../plataforma/dominio/admin";
import { emailDesdeTexto } from "../../modulos/identidad/publico";
import type { AdminPlataformaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { auditar, leerAdmin, revocarSesiones, usuariosDeLaLibreria } from "./admin-del-dueno";
import { enTransaccionDelDueno } from "./transaccion-del-dueno";

/**
 * El reseteo del segundo factor de un administrador que perdió su dispositivo (h5-p8 §2.4), con la cadena DIRECTA del
 * dueño, en UNA transacción: borra su TOTP y sus códigos de recuperación (la fila de `"twoFactor"`), pone
 * `"twoFactorEnabled" = false`, limpia sus intentos fallidos y los pasos de TOTP ya usados (si no, quedaría bloqueado y
 * un código del secreto nuevo podría chocar con uno gastado del viejo) y revoca TODAS sus sesiones. El siguiente ingreso
 * de esa persona vuelve a enrolar, dentro de la ventana de 10 minutos de la sesión.
 *
 * Idempotente: sin TOTP ni sesiones que borrar no cambia nada y no deja constancia. Una constancia
 * (`SEGUNDO_FACTOR_RESETEADO`, actor `sistema`, sin el email ni ningún secreto) por cada reseteo que cambió algo. Solo para
 * administradores ACTIVOS (uno dado de baja o inexistente se rechaza sin tocar nada).
 */

export type ResultadoDelReseteo = Readonly<{
  adminId: AdminPlataformaId;
  /** Si tenía un segundo factor enrolado que se borró. */
  segundoFactorBorrado: boolean;
  sesionesRevocadas: number;
  /** `true`: no había nada que cambiar (ya estaba reseteado). */
  yaEstaba: boolean;
}>;

export type ErrorDelReseteo = ErrorDeReseteoDeSegundoFactor | "EMAIL_INVALIDO";

const ORIGEN_DE_LA_CONSTANCIA = "script resetear-segundo-factor";

export async function resetearElSegundoFactor(
  urlDueno: string,
  email: string,
): Promise<Resultado<ResultadoDelReseteo, ErrorDelReseteo>> {
  const normalizado = emailDesdeTexto(email);
  if (!normalizado.ok) return err("EMAIL_INVALIDO");

  return enTransaccionDelDueno(urlDueno, async (cliente) => {
    const admin = await leerAdmin(cliente, normalizado.valor);
    const decision = decidirReseteoDeSegundoFactor(admin);
    if (!decision.ok) return decision;
    const { id } = admin as NonNullable<typeof admin>;

    const usuarios = await usuariosDeLaLibreria(cliente, normalizado.valor);
    let segundoFactorBorrado = false;
    let habilitadoEnLaLibreria = false;
    let intentosBorrados = false;
    if (usuarios.length > 0) {
      const borradas = await cliente.query(
        `DELETE FROM autenticacion."twoFactor" WHERE "userId" = ANY($1::uuid[])`,
        [usuarios],
      );
      segundoFactorBorrado = (borradas.rowCount ?? 0) > 0;
      const apagados = await cliente.query(
        `UPDATE autenticacion."user" SET "twoFactorEnabled" = false WHERE id = ANY($1::uuid[]) AND "twoFactorEnabled"`,
        [usuarios],
      );
      habilitadoEnLaLibreria = (apagados.rowCount ?? 0) > 0;
      const intentos = await cliente.query(
        `DELETE FROM autenticacion.intento_segundo_factor WHERE usuario_id = ANY($1::uuid[])`,
        [usuarios],
      );
      intentosBorrados = (intentos.rowCount ?? 0) > 0;
      await cliente.query(
        `DELETE FROM autenticacion.codigo_totp_usado WHERE usuario_id = ANY($1::uuid[])`,
        [usuarios],
      );
    }
    const sesionesRevocadas = await revocarSesiones(cliente, usuarios);
    const cambio =
      segundoFactorBorrado || habilitadoEnLaLibreria || intentosBorrados || sesionesRevocadas > 0;
    if (cambio) {
      await auditar(
        cliente,
        "SEGUNDO_FACTOR_RESETEADO",
        id,
        { segundoFactorEnrolado: segundoFactorBorrado || habilitadoEnLaLibreria },
        { segundoFactorEnrolado: false, sesionesRevocadas, origen: ORIGEN_DE_LA_CONSTANCIA },
      );
    }
    return ok({ adminId: id, segundoFactorBorrado, sesionesRevocadas, yaEstaba: !cambio });
  });
}
