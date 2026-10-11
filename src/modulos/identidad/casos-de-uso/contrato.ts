import type { Auditoria } from "../../../puertos/auditoria";
import type { Tokens } from "../../../puertos/tokens";
import type { Trabajos } from "../../../puertos/trabajos";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeEmpresas } from "../../empresas/publico";
import type { RepositorioDeTenants } from "../../tenants/publico";
import type {
  RepositorioDeAsignaciones,
  RepositorioDeInvitaciones,
  RepositorioDeMembresias,
  RepositorioDePersonas,
} from "../persistencia/repositorios";

/**
 * Lo que recibe el trabajo de una transacción de identidad (ADR-004, G5): los repositorios del
 * módulo, los de empresas y tenants que hacen falta para leer sus estados y activar el alta, y los
 * puertos de trabajos y auditoría. La composición lo arma a partir de la conexión de la transacción;
 * los casos de uso solo ven estas interfaces.
 */
export type TxDeIdentidad = Readonly<{
  personas: RepositorioDePersonas;
  membresias: RepositorioDeMembresias;
  asignaciones: RepositorioDeAsignaciones;
  invitaciones: RepositorioDeInvitaciones;
  empresas: Pick<RepositorioDeEmpresas, "obtener" | "cambiarEstado">;
  tenants: Pick<RepositorioDeTenants, "obtener">;
  trabajos: Trabajos;
  auditoria: Auditoria;
}>;

export type DependenciasDeIdentidad = Readonly<{
  transacciones: Transacciones<TxDeIdentidad>;
  tokens: Tokens;
}>;

/** Tipo de trabajo que manda el mail de una invitación (datos: solo el id, nunca el token). */
export const TRABAJO_ENVIAR_INVITACION = "enviar_invitacion";

/** Clave de idempotencia del envío: una invitación, un envío. */
export const claveDeEnvioDeInvitacion = (invitacionId: string): string =>
  `invitacion:${invitacionId}:envio`;
