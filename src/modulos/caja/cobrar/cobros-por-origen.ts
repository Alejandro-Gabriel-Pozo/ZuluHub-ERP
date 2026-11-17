import type { ContextoOperativo } from "../../../contexto/contexto";
import { medioVigenteTipo } from "../dominio/cobrar";
import type { ReferenciaOpaca } from "../dominio/identidad-del-cobro";
import { sumarImportes } from "../dominio/importes";
import type { CobrosDeUnOrigen, TxDeLecturaDeCaja } from "./contrato";

/**
 * Cuánto se cobró de un origen (e3 §3.5): la suma exacta de sus cobros y cada cobro con el medio con que se cobró y el medio VIGENTE tras las
 * correcciones de medio (e3b §4.3). `cobrado` NO cambia con una corrección de medio: el ticket sigue cobrado por el mismo total. Un origen
 * sin cobros (o con una forma que no puede tenerlos) devuelve cero. La cuenta que se devuelve es la del cobro original. SOLO LEE.
 */
export async function cobrosPorOrigen(
  tx: TxDeLecturaDeCaja,
  contexto: ContextoOperativo,
  origen: ReferenciaOpaca,
): Promise<CobrosDeUnOrigen> {
  const cobros = await tx.cobros.deOrigen(contexto.empresaId, origen);
  return {
    cobrado: sumarImportes(cobros.map((c) => c.importe)),
    cobros: cobros.map((c) => ({
      cobroId: c.cobroId,
      origenOrden: c.origenOrden,
      importe: c.importe,
      medioTipo: c.medioTipo,
      medioVigenteTipo: medioVigenteTipo(c.medioTipo, c.correcciones),
      cuentaDeCobroId: c.cuentaDeCobroId,
      fechaDeNegocio: c.fechaDeNegocio,
    })),
  };
}
