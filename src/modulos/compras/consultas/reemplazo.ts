import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import { sucursalId } from "../../../primitivas/identificadores/marca";
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
    /**
     * Lo mismo para «Cambiar el comprobante de la compra» (N1/N2, NOTAS-2c-2): la factura vigente de la compra (la que mira la persona: es el `facturaVigenteVistaId` del cambio) y lo que hay que deshacer antes. La propia
     * conciliación atajo de la compra no frena (se espeja al cambiar). `null` si la compra no existe, no es de comprobante en el atajo, no tiene factura o está fuera del alcance de quien pide (indistinguibles).
     */
    queHayQueDeshacerAntesDeCambiarElComprobante(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ recepcionId: string }>,
    ): Promise<RDeConsulta<QueHayQueDeshacerAntes | null>> {
      if (!esUuid(entrada.recepcionId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, ["comprobantes_de_proveedor.reemplazar"], async (tx) => {
        const recepcion = await tx.recepciones.obtener(contexto.empresaId, entrada.recepcionId);
        if (recepcion === null || !recepcion.esAtajo || recepcion.nivel !== "CON_COMPROBANTE") {
          return null;
        }
        const alcance = exigirSucursal(
          await tx.autorizacion.sucursalesDelActor(contexto),
          sucursalId(recepcion.sucursalId),
        );
        if (!alcance.ok) return null;
        const vigente = await tx.comprobantesDeProveedor.delaRecepcion(
          contexto.empresaId,
          recepcion.id,
        );
        if (vigente === null || vigente.clase !== "FACTURA") return null;
        const frenos = await frenosDeLaFactura(tx, contexto.empresaId, vigente.id, true);
        return {
          comprobanteId: vigente.id,
          anulada: vigente.estado === "ANULADO",
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
