import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { anclaValida, type Ancla } from "../dominio/ancla";
import { cuentaId } from "../dominio/identificadores";
import { exigirAlcance, exigirUuid } from "./comun";
import type { TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeReanclarCuenta = Readonly<{ cuentaId: string; ancla: Ancla }>;
export type SalidaDeReanclarCuenta = Readonly<{ yaExistia: boolean }>;

/**
 * `reanclarCuentaEnTx` (E7 X4): mueve el ancla de una cuenta ABIERTA (cambiar de mesa), en la transacción del llamador; el permiso lo exige quien llama.
 * Si el ancla nueva ya tiene otra cuenta abierta, `ANCLA_OCUPADA`: lo mira de antemano y, si otro la ocupó a la vez, lo decide la única de la base (el
 * error de unicidad aborta la transacción y el llamador lo traduce). Repetir el mismo destino devuelve `yaExistia`. Audita `CUENTA_REANCLADA`.
 */
export async function reanclarCuentaEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeReanclarCuenta,
): Promise<R<SalidaDeReanclarCuenta>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId);
  if (!ids.ok) return ids;
  const ancla = anclaValida(entrada.ancla);
  if (!ancla.ok) return ancla;
  const cuenta = await tx.cuentas.obtener(empresaId, cuentaId(entrada.cuentaId));
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  if (cuenta.estado !== "ABIERTA") return err("CUENTA_NO_ABIERTA");
  if (
    cuenta.ancla !== null &&
    cuenta.ancla.tipo === ancla.valor.tipo &&
    cuenta.ancla.id === ancla.valor.id
  ) {
    return ok({ yaExistia: true });
  }
  const ocupada = await tx.cuentas.abiertaPorAncla(empresaId, ancla.valor);
  if (ocupada !== null) return err("ANCLA_OCUPADA");
  const movida = await tx.cuentas.reanclar(empresaId, cuenta.id, ancla.valor);
  if (!movida) return err("CUENTA_NO_ABIERTA");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "CUENTA_REANCLADA",
    entidad: "cuenta_consumo",
    entidadId: cuenta.id,
    antes: {
      anclaTipo: cuenta.ancla === null ? null : cuenta.ancla.tipo,
      anclaId: cuenta.ancla === null ? null : cuenta.ancla.id,
    },
    despues: { anclaTipo: ancla.valor.tipo, anclaId: ancla.valor.id },
  });
  return ok({ yaExistia: false });
}
