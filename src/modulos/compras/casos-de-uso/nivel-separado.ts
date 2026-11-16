import { exigirPerilla } from "../../../capacidades/planes/derechos";
import type { ClavePerilla } from "../../../capacidades/planes/perillas";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { PERILLA_DEL_NIVEL, type NivelDeCompra } from "../dominio/niveles";
import { esNivelDeRecepcionSeparada } from "../dominio/recepcion-separada";
import type { TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

/**
 * Lo que exigen los comandos que CARGAN algo nuevo en N3 o N4 (recibir, cargar una factura sola): la empresa está en N3 o N4 y el plan trae la perilla de ese nivel.
 * Bajar de plan no toca lo ya cargado (cada documento sella su nivel y los comandos que completan lo iniciado no piden la perilla), pero no se carga más.
 * `RECEPCION_SEPARADA_NO_CORRESPONDE_AL_NIVEL` si la empresa está en N1 o N2; `FUNCION_NO_INCLUIDA` con el nombre de la perilla si el plan no la trae.
 */
export async function exigirNivelSeparado(
  tx: Pick<TxDeCompras, "configuracionDeCompras" | "derechos">,
  contexto: ContextoOperativo,
): Promise<Resultado<NivelDeCompra, ErrorDeCompras>> {
  const { empresaId } = contexto;
  const configuracion = await tx.configuracionDeCompras.leer(empresaId);
  if (!esNivelDeRecepcionSeparada(configuracion.nivel)) {
    return err("RECEPCION_SEPARADA_NO_CORRESPONDE_AL_NIVEL");
  }
  const perilla = PERILLA_DEL_NIVEL[configuracion.nivel];
  if (perilla === null) throw new Error("el nivel de recepción separada siempre tiene perilla");
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  const incluida = exigirPerilla(derechos, perilla as ClavePerilla, { empresaId });
  if (!incluida.ok) return err({ error: "FUNCION_NO_INCLUIDA", perilla: incluida.error.perilla });
  return ok(configuracion.nivel);
}
