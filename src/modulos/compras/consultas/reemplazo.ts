import { err } from "../../../primitivas/resultado/resultado";
import {
  esFacturaReemplazable,
  frenosDeLaFactura,
  type FrenoDelReemplazo,
} from "../casos-de-uso/frenos-del-reemplazo";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";

/** Lo que hay que deshacer antes de reemplazar una factura, en su orden (vacío: se puede reemplazar ya). */
export type QueHayQueDeshacerAntes = Readonly<{
  comprobanteId: string;
  /** `true` si la factura ya está anulada: no se reemplaza (si ya la reemplazó otra, la acción lo dice al intentar). */
  anulada: boolean;
  frenos: readonly Readonly<{ freno: FrenoDelReemplazo["freno"]; pagoId?: string }>[];
}>;

export function armarConsultasDeReemplazo(leer: Lector) {
  return {
    /**
     * «Qué hay que deshacer antes» de reemplazar una factura (guard `comprobantes_de_proveedor.reemplazar`): un pago vigente, las conciliaciones vivas y las notas vigentes, en ese orden. `null` si la factura no existe, es de otra
     * empresa, no es una factura que llega sola o quien pide no tiene alcance sobre todas las sucursales (indistinguibles). Solo datos: lo que se hace con cada paso lo decide el permiso de ese paso.
     */
    queHayQueDeshacerAntes(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ comprobanteId: string }>,
    ): Promise<RDeConsulta<QueHayQueDeshacerAntes | null>> {
      if (!esUuid(entrada.comprobanteId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, ["comprobantes_de_proveedor.reemplazar"], async (tx) => {
        if ((await tx.autorizacion.sucursalesDelActor(contexto)) !== "TODAS") return null;
        const original = await tx.comprobantesDeProveedor.obtener(
          contexto.empresaId,
          entrada.comprobanteId,
        );
        if (!esFacturaReemplazable(original)) return null;
        const frenos = await frenosDeLaFactura(tx, contexto.empresaId, original.id);
        return {
          comprobanteId: original.id,
          anulada: original.estado === "ANULADO",
          frenos: frenos.map((f) => ({
            freno: f.freno,
            ...(typeof f.error === "object" && "pagoId" in f.error && f.error.pagoId !== null
              ? { pagoId: f.error.pagoId }
              : {}),
          })),
        };
      });
    },
  };
}
