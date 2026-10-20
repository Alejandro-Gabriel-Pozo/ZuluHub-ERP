import { decidirBajaDeAdmin, type ErrorDeBajaDeAdmin } from "../../plataforma/dominio/admin";
import { emailDesdeTexto } from "../../modulos/identidad/publico";
import type { AdminPlataformaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { auditar, leerAdmin, revocarSesiones, usuariosDeLaLibreria } from "./admin-del-dueno";
import { enTransaccionDelDueno } from "./transaccion-del-dueno";

/**
 * La baja de un administrador de plataforma (h5-p8 §2.5), con la cadena DIRECTA del dueño: pone `activo = false` en
 * `admin_plataforma` y borra TODAS sus sesiones (la consola y la web comparten la cuenta de Google) en la MISMA
 * transacción. Un corte parcial no existe: o queda de baja y sin sesiones, o no cambia nada. Sin sesión no hay ingreso
 * a la consola, y aunque alguna sobreviviera (un ingreso que ya estaba en curso), la puerta de la consola vuelve a leer
 * al administrador en cada pedido y cada caso lee su `activo` dentro de su transacción: la baja corta en la operación
 * siguiente.
 *
 * Idempotente: repetirla con un administrador que ya está de baja no cambia su estado; si le quedaba alguna sesión
 * (un ingreso concurrente), la cierra. Deja UNA constancia por cambio real (`ADMIN_PLATAFORMA_BAJA`, con actor `sistema`,
 * sin el email); si no hubo nada que cambiar, no deja ninguna. Dos bajas simultáneas del mismo administrador dejan una
 * constancia: la segunda choca (40001), se repite y ve lo que dejó la primera.
 */

export type ResultadoDeLaBaja = Readonly<{
  adminId: AdminPlataformaId;
  /** `true`: ya estaba de baja antes de esta corrida (el estado no cambió). */
  yaEstabaDeBaja: boolean;
  sesionesRevocadas: number;
}>;

export type ErrorDeLaBaja = ErrorDeBajaDeAdmin | "EMAIL_INVALIDO";

const ORIGEN_DE_LA_CONSTANCIA = "script baja-de-admin";

export async function darDeBajaAlAdmin(
  urlDueno: string,
  email: string,
): Promise<Resultado<ResultadoDeLaBaja, ErrorDeLaBaja>> {
  // El email se valida ANTES de abrir una conexión: uno mal formado no toca la red.
  const normalizado = emailDesdeTexto(email);
  if (!normalizado.ok) return err("EMAIL_INVALIDO");

  return enTransaccionDelDueno(urlDueno, async (cliente) => {
    const admin = await leerAdmin(cliente, normalizado.valor);
    const decision = decidirBajaDeAdmin(admin);
    if (!decision.ok) return decision;
    const { id } = admin as NonNullable<typeof admin>;

    const usuarios = await usuariosDeLaLibreria(cliente, normalizado.valor);
    if (decision.valor.darDeBaja) {
      await cliente.query("UPDATE admin_plataforma SET activo = false WHERE id = $1 AND activo", [
        id,
      ]);
    }
    const sesionesRevocadas = await revocarSesiones(cliente, usuarios);
    if (decision.valor.darDeBaja || sesionesRevocadas > 0) {
      await auditar(
        cliente,
        "ADMIN_PLATAFORMA_BAJA",
        id,
        { activo: decision.valor.darDeBaja },
        { activo: false, sesionesRevocadas, origen: ORIGEN_DE_LA_CONSTANCIA },
      );
    }
    return ok({ adminId: id, yaEstabaDeBaja: !decision.valor.darDeBaja, sesionesRevocadas });
  });
}
