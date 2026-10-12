import type { ContextoOperativo } from "../../../contexto/contexto";
import type { TraspasoGuardado } from "../persistencia/repositorios";
import type { TxDeIdentidad } from "./contrato";

/**
 * Cancela un traspaso guardado como `PROPUESTO` y lo audita (`TRASPASO_CANCELADO`), todo en la
 * transacción en curso. Lo comparten los tres caminos que cancelan: el gerente (`cancelarTraspaso`),
 * una propuesta nueva sobre una vencida (`proponerTraspaso`, motivo `VENCIDO`) y el apagado del
 * entrante (`apagarMembresia`, motivo `ENTRANTE_DADO_DE_BAJA`). Devuelve `false` si la base no
 * encontró el traspaso en el estado y la versión leídos (alguien lo resolvió en el medio).
 */
export async function cancelarYAuditar(
  tx: Pick<TxDeIdentidad, "traspasos" | "auditoria">,
  contexto: ContextoOperativo,
  traspaso: TraspasoGuardado,
  motivo: string | null,
): Promise<boolean> {
  const cancelado = await tx.traspasos.cancelar(
    contexto.empresaId,
    traspaso.id,
    traspaso.version,
    contexto.ahora,
    motivo,
  );
  if (!cancelado) return false;
  await tx.auditoria.registrar({
    empresaId: contexto.empresaId,
    actorPersonaId: contexto.personaId,
    accion: "TRASPASO_CANCELADO",
    entidad: "traspaso_gerencia",
    entidadId: traspaso.id,
    antes: { estado: "PROPUESTO", entrante: traspaso.entrantePersonaId },
    despues: { estado: "CANCELADO", motivo },
  });
  return true;
}
