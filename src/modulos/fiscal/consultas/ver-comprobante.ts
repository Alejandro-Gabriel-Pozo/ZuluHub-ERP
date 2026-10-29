import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { detalleDe, type DetalleDeComprobante } from "./vistas";

export type EntradaDeVerComprobante = Readonly<{ comprobanteId: ComprobanteGuardado["id"] }>;

/** El comprobante de otra empresa es indistinguible de uno que no existe. */
export type ErrorAlVerComprobante =
  MotivoDeRechazo | "COMPROBANTE_NO_ENCONTRADO" | ErrorDePersistencia;

/**
 * Todo un comprobante de la empresa del contexto y de una sucursal que la persona puede ver (H7 facturación §B.4.9; D-39: gerente y
 * administrador, cualquiera, también de una sucursal cerrada; el operador, solo las que tiene asignadas, también cerradas; si no
 * corresponde responde lo mismo que si no existiera): el contenido, los renglones y el
 * desglose, el comprobante asociado, las notas que lo citan, el último intento contra ARCA (solo códigos) y el
 * estado de su serie. Pide `comprobantes.ver` al guard dentro de su transacción (`read committed`, solo lectura).
 * Las lecturas son varias: el estado del comprobante, el de su serie y el último intento pueden diferir por un
 * instante si algo cambia en el medio, y la pantalla vuelve a consultar mientras está en validación.
 */
export function armarVerComprobante({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function verComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeVerComprobante,
  ): Promise<Resultado<DetalleDeComprobante, ErrorAlVerComprobante>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<DetalleDeComprobante, MotivoDeRechazo | "COMPROBANTE_NO_ENCONTRADO">
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.verComprobante.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        // D-39, ANTES de leer el comprobante: el de una sucursal que la persona no puede ver hace el mismo trabajo mínimo que uno que
        // no existe (una lectura de su sucursal y el alcance), y responde lo mismo. Sin sucursal legible (no existe, es de otra
        // empresa, o la columna está vacía) tampoco corresponde.
        const sucursal = await tx.lecturas.sucursalDelComprobante(empresaId, entrada.comprobanteId);
        const alcance = await tx.autorizacion.sucursalesDelActor(contexto, {
          incluirDesactivadas: true,
        });
        if (sucursal === null || !exigirSucursal(alcance, sucursal).ok) {
          return err("COMPROBANTE_NO_ENCONTRADO");
        }
        const comprobante = await tx.comprobantes.obtener(empresaId, entrada.comprobanteId);
        if (comprobante === null) return err("COMPROBANTE_NO_ENCONTRADO");
        const notasQueLoCitan = await tx.lecturas.notasQueCitan(empresaId, comprobante.id);
        const intentos = await tx.intentos.delComprobante(empresaId, comprobante.id);
        const serie = await tx.series.obtener(
          empresaId,
          comprobante.puntoDeVentaId,
          comprobante.tipo,
          comprobante.ambiente,
        );
        return ok(
          detalleDe(comprobante, {
            notasQueLoCitan,
            // Los intentos vienen por orden de inicio: el último es el más reciente.
            ultimoIntento: intentos.at(-1) ?? null,
            serie,
          }),
        );
      },
    );
  };
}
