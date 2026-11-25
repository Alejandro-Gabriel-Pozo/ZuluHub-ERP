import { exigirPerilla } from "../../../capacidades/planes/derechos";
import type { ClavePerilla } from "../../../capacidades/planes/perillas";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { PERILLA_DEL_NIVEL, type NivelDeCompra } from "../dominio/niveles";
import { esNivelDeRecepcionSeparada } from "../dominio/recepcion-separada";
import type { TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

/**
 * Lo que exigen los comandos que CARGAN algo nuevo de recepción separada (recibir, cargar una factura sola): el plan de la empresa trae la perilla de recepción separada. Devuelve el nivel con el
 * que nace el documento. **El nivel de la empresa ya no decide si se puede** (decisión del dueño, 25/11/2026, pregunta 1 de Compras 4, opción B): una empresa en «Sin factura» o «Con factura» recibe por
 * separado, y cada compra elige su camino al cargarla («Nueva compra» o «Recibir»), porque no se sabe de antemano qué proveedor manda una factura para toda la empresa y cuál una por sucursal. No hay
 * ninguna regla ni dato por proveedor. El documento sella `RECEPCION_SEPARADA` (o `TRES_VIAS` si la empresa está en N4, que sigue como estaba y exige además la perilla de tres vías). Bajar de plan no
 * toca lo ya cargado (cada documento sella su nivel y los comandos que completan lo iniciado no piden la perilla), pero no se carga más. `FUNCION_NO_INCLUIDA` con el nombre de la perilla si el plan no la trae.
 * Previene: que recibir por separado obligue a cambiar el nivel de toda la empresa y cierre «Nueva compra». Chequeo: `test/integracion/compras-n3-recepcion.test.ts` y `compras-n3-conciliacion.test.ts`.
 */
export async function exigirNivelSeparado(
  tx: Pick<TxDeCompras, "configuracionDeCompras" | "derechos">,
  contexto: ContextoOperativo,
): Promise<Resultado<NivelDeCompra, ErrorDeCompras>> {
  const { empresaId } = contexto;
  const configuracion = await tx.configuracionDeCompras.leer(empresaId);
  const nivel: NivelDeCompra = esNivelDeRecepcionSeparada(configuracion.nivel)
    ? configuracion.nivel
    : "RECEPCION_SEPARADA";
  const perilla = PERILLA_DEL_NIVEL[nivel];
  if (perilla === null) throw new Error("el nivel de recepción separada siempre tiene perilla");
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  const incluida = exigirPerilla(derechos, perilla as ClavePerilla, { empresaId });
  if (!incluida.ok) return err({ error: "FUNCION_NO_INCLUIDA", perilla: incluida.error.perilla });
  return ok(nivel);
}
