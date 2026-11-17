import type { ContextoOperativo } from "../../../contexto/contexto";
import { exigirPerilla } from "../../../capacidades/planes/derechos";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";

/** Las perillas de empresa que verifican los casos de uso de lotes (E6 §3.7): se leen del plan en la misma transacción, sin caché. */
export type PerillaDeLotes = "lotes" | "calidad_de_lote";

/** `FUNCION_NO_INCLUIDA` con su perilla si el plan de la empresa no la trae (nace cerrado: sin dato, apagada). */
export async function exigirPerillaDeLotes(
  tx: Pick<TxDeStock, "derechos">,
  contexto: ContextoOperativo,
  perilla: PerillaDeLotes,
): Promise<Resultado<null, ErrorDeStock>> {
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  const permitida = exigirPerilla(derechos, perilla, { empresaId: contexto.empresaId });
  return permitida.ok ? ok(null) : err({ error: "FUNCION_NO_INCLUIDA", perilla });
}
