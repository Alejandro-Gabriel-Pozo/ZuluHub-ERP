import type { Contexto } from "../../contexto/contexto";
import type { AdminsDePlataforma } from "../../puertos/admins-de-plataforma";
import type { PersonalHabilitado } from "../../puertos/autenticacion";
import type { Transacciones } from "../../puertos/transacciones";

/**
 * El puerto `PersonalHabilitado` de la consola (h5-p8 §2.2) sobre `admin_plataforma`, con la conexión del rol de
 * plataforma: la librería de ingreso corre con un rol que no ve esa tabla (S5), así que la consola le inyecta esto.
 * Lee con el actor `sistema` (todavía no se sabe quién entra: es justo lo que se está decidiendo) y en solo lectura.
 * El email se normaliza en la base con la misma expresión con que se guardó (`AdminsDePlataforma.buscarPorEmail`).
 *
 * Falla cerrado: quien llama (los ganchos del ingreso) trata un error como «no habilitado». Solo `activo = true`
 * habilita: un administrador dado de baja no entra aunque siga en la tabla.
 */
export type TxDePersonalHabilitado = Readonly<{ admins: AdminsDePlataforma }>;

export const PROCESO_DEL_INGRESO_DE_PLATAFORMA = "ingreso-de-plataforma";

export function contextoDelIngresoDePlataforma(ahora: Date): Contexto {
  return {
    tipo: "PLATAFORMA",
    actor: { tipo: "SISTEMA", proceso: PROCESO_DEL_INGRESO_DE_PLATAFORMA },
    ahora,
  };
}

export function crearPersonalHabilitadoDePostgres(
  transacciones: Transacciones<TxDePersonalHabilitado>,
  reloj: () => Date = () => new Date(),
): PersonalHabilitado {
  return {
    async esHabilitado(email) {
      const r = await transacciones.ejecutar<boolean, never>(
        {
          contexto: contextoDelIngresoDePlataforma(reloj()),
          soloLectura: true,
          aislamiento: "read committed",
        },
        async (tx) => {
          const admin = await tx.admins.buscarPorEmail(email);
          return { ok: true as const, valor: admin !== null && admin.activo };
        },
      );
      if (!r.ok) throw new Error(`no se pudo consultar al personal habilitado: ${r.error.tipo}`);
      return r.valor;
    },
  };
}
