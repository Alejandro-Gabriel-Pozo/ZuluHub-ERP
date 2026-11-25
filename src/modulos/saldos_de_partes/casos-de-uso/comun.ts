import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDelLibro } from "../dominio/errores";
import type { TxDeSaldos } from "./contrato";

/** Quién lo registra: la persona del contexto. El libro guarda siempre el actor (la base lo exige); el sistema sin persona no escribe. */
export function exigirActor(contexto: ContextoOperativo): Resultado<PersonaId, ErrorDelLibro> {
  return contexto.personaId === null ? err("ACTOR_REQUERIDO") : ok(contexto.personaId);
}

/**
 * La constancia del cambio, en la misma transacción (`auditoria_empresa`: solo inserción). Nunca lleva la clave de idempotencia ni la huella: el
 * puerto rechaza los campos con nombre de secreto, y la clave del pedido no es un dato de negocio.
 */
export async function dejarConstancia(
  tx: TxDeSaldos,
  contexto: ContextoOperativo,
  persona: PersonaId,
  constancia: Readonly<{
    accion: string;
    entidad: "asiento_de_saldo" | "imputacion_de_saldo";
    entidadId: string;
    despues: Readonly<Record<string, Dato>>;
  }>,
): Promise<void> {
  await tx.auditoria.registrar({
    empresaId: contexto.empresaId,
    actorPersonaId: persona,
    ...constancia,
  });
}
