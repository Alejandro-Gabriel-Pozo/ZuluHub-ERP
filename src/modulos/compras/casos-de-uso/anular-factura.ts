import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import { esNivelDeRecepcionSeparada } from "../dominio/recepcion-separada";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
import { anularElCargoDeLaFactura } from "./cargo-de-la-factura";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeAnularFactura = Readonly<{ comprobanteId: string; motivo: string }>;

/**
 * Anular la factura de N3 o N4 cargada sola (una factura mal cargada tiene que poder anularse). Guard `comprobantes_de_proveedor.anular` (gerente y administrador). El
 * motivo es obligatorio y queda con quién y cuándo; el número de la factura queda libre (la única de duplicados mira solo las no anuladas) y nada se borra. FALLA CERRADO si la
 * factura tiene conciliaciones vivas (`COMPROBANTE_CONCILIADO`: primero se anulan, así lo recibido recupera su saldo) o un pago vigente (`COMPROBANTE_YA_PAGADO`, con el id del pago:
 * primero se anula el pago). Una ya anulada es `COMPROBANTE_ANULADO` y no escribe. La del atajo de N1 y N2 no se anula por acá (se anula con la compra). La factura se bloquea: anularla
 * y conciliarla a la vez se serializan (gana la primera y la otra ve el estado nuevo). BRECHA R7: la anulación cambia el estado del comprobante (UPDATE de `estado` y de los datos de
 * la anulación, que la base deja inmutables salvo eso), como el comprobante de N2; no es una fila nueva visible: se anota para la lista de compatibilidad contable.
 */
export function armarAnularFactura(dependencias: DependenciasDeCompras) {
  return async function anularFactura(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularFactura,
  ): Promise<R<Readonly<{ anulada: true }>>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.comprobanteId)) return err("COMPROBANTE_NO_ENCONTRADO");
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<Readonly<{ anulada: true }>>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "comprobantes_de_proveedor.anular",
          ]);
          if (!permiso.ok) return permiso;
          const comprobante = await tx.comprobantesDeProveedor.bloquear(
            empresaId,
            entrada.comprobanteId,
          );
          if (
            comprobante === null ||
            comprobante.clase !== "FACTURA" ||
            !esNivelDeRecepcionSeparada(comprobante.nivel) ||
            comprobante.esAtajo
          ) {
            return err("COMPROBANTE_NO_ENCONTRADO");
          }
          if (comprobante.estado === "ANULADO") return err("COMPROBANTE_ANULADO");
          const saldos = await tx.conciliacionesDeCompra.saldosDeFactura(empresaId, comprobante.id);
          if (saldos.some((s) => s.asignada !== "0.0000")) return err("COMPROBANTE_CONCILIADO");
          const pago = await tx.pagosDeProveedor.vigenteDe(empresaId, comprobante.id);
          if (pago !== null) return err({ error: "COMPROBANTE_YA_PAGADO", pagoId: pago.id });
          const hecho = await tx.comprobantesDeProveedor.anular(empresaId, comprobante.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!hecho) throw new Error("el comprobante ya no estaba registrado bajo bloqueo");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "FACTURA_ANULADA",
            entidad: "comprobante_de_proveedor",
            entidadId: comprobante.id,
            antes: { estado: "REGISTRADO" },
            despues: { estado: "ANULADO", motivo: motivo.valor },
          });
          const cargo = await anularElCargoDeLaFactura(tx, contexto, dependencias, comprobante.id);
          if (!cargo.ok) return cargo;
          return ok({ anulada: true });
        },
      ),
    );
  };
}
