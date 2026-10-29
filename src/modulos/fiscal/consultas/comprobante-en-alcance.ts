import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { LecturasDeComprobantes } from "../persistencia/lecturas-de-comprobantes";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";

/** Lo único que lee el chequeo de alcance de un comprobante: su sucursal y el alcance de la persona. */
export type TxParaElAlcanceDeUnComprobante = Readonly<{
  lecturas: Pick<LecturasDeComprobantes, "sucursalDelComprobante">;
  autorizacion: Pick<CargaDeAutorizacion, "sucursalesDelActor">;
}>;

/**
 * D-39 (extendido a descartar, reintentar y al modelo de impresión): ¿el comprobante es de una sucursal que la persona puede ver?
 * Gerente y administrador, de cualquiera; el operador, de las que tiene asignadas, también cerradas (el historial). Si no, o si el
 * comprobante no existe, es de otra empresa o no tiene sucursal guardada (0016), la respuesta es LA MISMA: `COMPROBANTE_NO_ENCONTRADO`,
 * sin pistas de que existe. Se pregunta ANTES de leer el comprobante: ninguna otra respuesta (estado, versión, «ya estaba») puede
 * delatar a un comprobante ajeno, y los dos casos hacen el mismo trabajo (la lectura de su sucursal y la del alcance).
 * Es la ÚNICA implementación de esta regla: el Detalle, el modelo de impresión, descartar y reintentar la llaman.
 * Previene: que un operador sepa (por un error distinto) o toque un comprobante de una sucursal que no es suya.
 * Chequeo: `fiscal-sucursal-operaciones.test.ts` y `consultas.test.ts`.
 */
export async function exigirComprobanteEnAlcance(
  tx: TxParaElAlcanceDeUnComprobante,
  contexto: ContextoOperativo,
  comprobante: ComprobanteGuardado["id"],
): Promise<Resultado<null, "COMPROBANTE_NO_ENCONTRADO">> {
  const sucursal = await tx.lecturas.sucursalDelComprobante(contexto.empresaId, comprobante);
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto, {
    incluirDesactivadas: true,
  });
  return sucursal === null || !exigirSucursal(alcance, sucursal).ok
    ? err("COMPROBANTE_NO_ENCONTRADO")
    : ok(null);
}
