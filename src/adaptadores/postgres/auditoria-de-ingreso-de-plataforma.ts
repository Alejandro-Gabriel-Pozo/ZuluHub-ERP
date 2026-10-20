import type { AdminsDePlataforma } from "../../puertos/admins-de-plataforma";
import type { AuditoriaDePlataforma } from "../../puertos/auditoria-de-plataforma";
import type { AuditoriaDeIngresoDePlataforma } from "../../puertos/segundo-factor-de-autenticacion";
import type { Transacciones } from "../../puertos/transacciones";
import { contextoDelIngresoDePlataforma } from "./personal-habilitado";

/**
 * La constancia del bloqueo del segundo factor (h5-p8 §2.4) en `auditoria_plataforma`, con la conexión del rol de
 * plataforma y el actor `sistema` (lo que se asienta es lo que el sistema le hizo al administrador, no algo que él
 * hizo). Entidad `admin_plataforma`, id del administrador; `despues` lleva SOLO hasta cuándo y cuántos fallos: ni
 * códigos, ni el email, ni nada del secreto (y el puerto de auditoría rechaza campos con pinta de secreto).
 * Si el email no es de un administrador no hay nada que auditar (no hay a quién bloquear).
 */
export type TxDeAuditoriaDeIngreso = Readonly<{
  admins: AdminsDePlataforma;
  auditoriaDePlataforma: AuditoriaDePlataforma;
}>;

export function crearAuditoriaDeIngresoDePlataformaDePostgres(
  transacciones: Transacciones<TxDeAuditoriaDeIngreso>,
  reloj: () => Date = () => new Date(),
): AuditoriaDeIngresoDePlataforma {
  return {
    async registrarBloqueoDeSegundoFactor({ email, hasta, fallos }) {
      const r = await transacciones.ejecutar<undefined, never>(
        { contexto: contextoDelIngresoDePlataforma(reloj()) },
        async (tx) => {
          const admin = await tx.admins.buscarPorEmail(email);
          if (admin !== null) {
            await tx.auditoriaDePlataforma.registrar({
              accion: "SEGUNDO_FACTOR_BLOQUEADO",
              entidad: "admin_plataforma",
              entidadId: admin.id,
              despues: { bloqueadoHasta: hasta.toISOString(), fallos },
            });
          }
          return { ok: true as const, valor: undefined };
        },
      );
      if (!r.ok)
        throw new Error(`no se pudo auditar el bloqueo del segundo factor: ${r.error.tipo}`);
    },
  };
}
