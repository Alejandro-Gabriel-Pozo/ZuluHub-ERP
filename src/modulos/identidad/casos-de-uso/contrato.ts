import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Tokens } from "../../../puertos/tokens";
import type { Trabajos } from "../../../puertos/trabajos";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeEmpresas, RepositorioDeSucursales } from "../../empresas/publico";
import type { RepositorioDeTenants } from "../../tenants/publico";
import type {
  RepositorioDeAsignaciones,
  RepositorioDeInvitaciones,
  RepositorioDeMembresias,
  RepositorioDePersonas,
  RepositorioDeTraspasos,
} from "../persistencia/repositorios";

/**
 * Lo que recibe el trabajo de una transacción de identidad (ADR-004, G5): los repositorios del
 * módulo, los de empresas y tenants que hacen falta para leer sus estados y activar el alta, y los
 * puertos de trabajos, auditoría y autorización. La composición lo arma a partir de la conexión de
 * la transacción; los casos de uso solo ven estas interfaces.
 */
export type TxDeIdentidad = Readonly<{
  personas: RepositorioDePersonas;
  membresias: RepositorioDeMembresias;
  asignaciones: RepositorioDeAsignaciones;
  invitaciones: RepositorioDeInvitaciones;
  traspasos: RepositorioDeTraspasos;
  empresas: Pick<RepositorioDeEmpresas, "obtener" | "cambiarEstado">;
  /**
   * Para saber si una sucursal está activa (H6: no se invita ni se asigna a una desactivada) y cuáles
   * tiene la empresa (`asignarSucursales`).
   */
  sucursales: Pick<RepositorioDeSucursales, "obtener" | "listar">;
  tenants: Pick<RepositorioDeTenants, "obtener">;
  trabajos: Trabajos;
  auditoria: Auditoria;
  /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeIdentidad = Readonly<{
  transacciones: Transacciones<TxDeIdentidad>;
  tokens: Tokens;
  /**
   * El catálogo y la matriz rol → acciones con los que el guard autoriza. Los pasa la composición:
   * hoy son los fijos de `REGLAS_DE_EMPRESA`; si los roles pasan a ser datos de cada empresa, cambia
   * quien arma esto, no el guard ni los casos de uso.
   */
  reglas: ReglasDeEmpresa;
}>;

/** Tipo de trabajo que manda el mail de una invitación (datos: solo el id, nunca el token). */
export const TRABAJO_ENVIAR_INVITACION = "enviar_invitacion";

/** Clave de idempotencia del envío: una invitación, un envío. */
export const claveDeEnvioDeInvitacion = (invitacionId: string): string =>
  `invitacion:${invitacionId}:envio`;

/**
 * Tipos de trabajo que avisan por mail cada paso del traspaso de gerencia (datos: solo el id del
 * traspaso). Quien los envía es H5 infra: mientras tanto quedan encolados, sin perder nada. La
 * cancelación no avisa.
 */
export const TRABAJO_AVISAR_TRASPASO_PROPUESTO = "avisar_traspaso_propuesto";
export const TRABAJO_AVISAR_TRASPASO_ACEPTADO = "avisar_traspaso_aceptado";
export const TRABAJO_AVISAR_TRASPASO_RECHAZADO = "avisar_traspaso_rechazado";

/** Clave de idempotencia del aviso de un paso del traspaso: un traspaso, un aviso por paso. */
export const claveDeAvisoDeTraspaso = (
  traspasoId: string,
  evento: "propuesto" | "aceptado" | "rechazado",
): string => `traspaso:${traspasoId}:${evento}`;

/**
 * Tipo de trabajo que revoca las sesiones de un usuario de la librería de ingreso (h5-p8 §2.5; H5 §B.5.6). Ámbito
 * plataforma (`empresa_id` nulo). Datos: solo `usuarioAuthId` (un uuid, nunca un token ni una cookie). Lo encola la
 * suspensión de una persona en la MISMA transacción que la suspende; lo ejecuta el procesador con el rol de
 * autenticación, que es el único que puede borrar sesiones.
 */
export const TRABAJO_REVOCAR_SESIONES = "revocar_sesiones";

/**
 * Clave de idempotencia de la revocación: una suspensión (identificada por la clave de idempotencia del pedido del
 * administrador), una revocación. Encolar dos veces lo mismo deja una sola fila.
 */
export const claveDeRevocacionDeSesiones = (
  personaId: string,
  claveDeLaSuspension: string,
): string => `persona:${personaId}:suspension:${claveDeLaSuspension}`;
