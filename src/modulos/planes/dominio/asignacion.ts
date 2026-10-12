import {
  decidirCambio,
  motivoValido,
  vigenteEn,
  type Decision,
  type ErrorDeCambio,
} from "../../../capacidades/planes/vigencia";
import type { PlanId, VersionDePlanId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Asignación de plan (marcas y planes, §B.5.5 a §B.5.7 y G.3): qué versión de plan rige para un tenant
 * desde una fecha. Es de solo inserción: cambiar de plan es insertar otra, y «la última decisión
 * manda». Dominio puro: el número lo da la base al insertar (consecutivo por tenant), la hora entra
 * como dato, y el guard, la idempotencia y la auditoría son del caso de uso.
 *
 * Una baja de plan que quita módulos o baja un límite NO se rechaza (decisiones F3 y D-M3): los módulos
 * quedan en solo lectura y todo se conserva. Esta decisión no mira el uso ni los módulos activados.
 */

/** Una asignación ya hecha (el historial del tenant). */
export type AsignacionDePlan = Decision &
  Readonly<{ planId: PlanId; versionDePlanId: VersionDePlanId }>;

/** La versión a la que se asigna, con lo que hace falta saber de ella y de su plan. */
export type VersionDeDestino = Readonly<{
  planId: PlanId;
  versionDePlanId: VersionDePlanId;
  /** `PUBLICADA` (no un borrador). */
  publicada: boolean;
  /** El plan está `RETIRADO`: no se le asignan tenants nuevos. */
  planRetirado: boolean;
}>;

/** Por qué nace la asignación (se guarda con ella). */
export type OrigenDeAsignacion = "ALTA" | "CAMBIO" | "MIGRACION_DE_VERSION";

export type PedidoDeAsignacion = Readonly<{
  ahora: Date;
  destino: VersionDeDestino;
  vigenteDesde: Date;
  motivo: string;
  /** El número de la última asignación que vio quien decide; `null` si el tenant no tenía ninguna. */
  numeroEsperado: number | null;
  reemplazaProgramada: boolean;
  origen: OrigenDeAsignacion;
}>;

export type ErrorDeAsignacion =
  | ErrorDeCambio
  | Readonly<{
      codigo: "MOTIVO_OBLIGATORIO" | "VERSION_DE_PLAN_NO_PUBLICADA" | "PLAN_RETIRADO";
    }>;

export type AsignacionDecidida =
  /** Se inserta una asignación nueva. `reemplazadas`: las programadas que queda sin efecto. */
  | Readonly<{
      resultado: "ASIGNA";
      numero: number;
      versionDePlanId: VersionDePlanId;
      origen: OrigenDeAsignacion;
      motivo: string;
      reemplazadas: readonly number[];
    }>
  /** La versión pedida ya rige y no hay nada programado: no se escribe ni se audita. */
  | Readonly<{ resultado: "YA_ESTABA"; numero: number }>;

/**
 * Decide una asignación de plan. Orden de los errores: motivo obligatorio, versión no publicada,
 * plan retirado (solo si el plan destino es DISTINTO del que rige ahora: moverse entre versiones del
 * mismo plan retirado se permite), y después la vigencia (`decidirCambio`: retroactiva, desactualizada,
 * cambio programado pendiente).
 *
 * `YA_ESTABA`: la versión pedida es la que rige ahora y no hay ninguna programada. Vale para todo
 * origen (también para el lote de la migración N2); repetir el mismo pedido no duplica filas.
 */
export function decidirAsignacion(
  historial: readonly AsignacionDePlan[],
  pedido: PedidoDeAsignacion,
): Resultado<AsignacionDecidida, ErrorDeAsignacion> {
  const motivo = motivoValido(pedido.motivo);
  if (motivo === null) return err({ codigo: "MOTIVO_OBLIGATORIO" });
  if (!pedido.destino.publicada) return err({ codigo: "VERSION_DE_PLAN_NO_PUBLICADA" });
  const vigente = vigenteEn(historial, pedido.ahora);
  if (pedido.destino.planRetirado && vigente?.planId !== pedido.destino.planId) {
    return err({ codigo: "PLAN_RETIRADO" });
  }
  const cambio = decidirCambio(historial, pedido);
  if (!cambio.ok) return cambio;
  if (
    vigente?.versionDePlanId === pedido.destino.versionDePlanId &&
    cambio.valor.programadasPendientes.length === 0
  ) {
    return ok({ resultado: "YA_ESTABA", numero: vigente.numero });
  }
  return ok({
    resultado: "ASIGNA",
    numero: cambio.valor.numero,
    versionDePlanId: pedido.destino.versionDePlanId,
    origen: pedido.origen,
    motivo,
    reemplazadas: cambio.valor.reemplazadas,
  });
}
