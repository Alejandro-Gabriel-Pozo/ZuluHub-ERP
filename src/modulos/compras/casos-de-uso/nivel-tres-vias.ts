import { exigirPerilla } from "../../../capacidades/planes/derechos";
import type { ClavePerilla } from "../../../capacidades/planes/perillas";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { PERILLA_DEL_NIVEL } from "../dominio/niveles";
import type { TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

/**
 * Lo que exigen los comandos que CREAN algo nuevo de N4 (una orden de compra): la empresa está en N4 y el plan trae la perilla de tres vías. Bajar de plan o de nivel no
 * toca lo ya cargado (cerrar y anular lo iniciado no piden la perilla), pero no se crea más. `ORDEN_NO_CORRESPONDE_AL_NIVEL` si la empresa no está en N4;
 * `FUNCION_NO_INCLUIDA` con el nombre de la perilla si el plan no la trae.
 */
export async function exigirTresVias(
  tx: Pick<TxDeCompras, "configuracionDeCompras" | "derechos">,
  contexto: ContextoOperativo,
): Promise<Resultado<null, ErrorDeCompras>> {
  const { empresaId } = contexto;
  const configuracion = await tx.configuracionDeCompras.leer(empresaId);
  if (configuracion.nivel !== "TRES_VIAS") return err("ORDEN_NO_CORRESPONDE_AL_NIVEL");
  const perilla = PERILLA_DEL_NIVEL.TRES_VIAS;
  if (perilla === null) throw new Error("el nivel de tres vías siempre tiene perilla");
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  const incluida = exigirPerilla(derechos, perilla as ClavePerilla, { empresaId });
  if (!incluida.ok) return err({ error: "FUNCION_NO_INCLUIDA", perilla: incluida.error.perilla });
  return ok(null);
}
