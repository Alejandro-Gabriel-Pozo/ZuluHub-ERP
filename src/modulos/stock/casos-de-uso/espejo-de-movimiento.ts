import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadConSignoDesdeTexto, negarConSigno } from "../../../primitivas/cantidad/con-signo";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { RenglonDeLibro } from "../dominio/movimiento";
import type { Movimiento } from "../persistencia/modelo";
import type { TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { registrarMovimientoEnTx, type MovimientoRegistrado } from "./movimiento-en-tx";

/**
 * La anulación ESPEJO de un movimiento (E6 §3.2, `anularOrden`): mismo depósito, mismos artículos y versiones, cantidades opuestas y, porque
 * el libro repite el costo y los lotes del original, el mismo costo congelado y los mismos lotes (aunque ya estén vencidos: anular no se bloquea).
 * Corre en la transacción del llamador y no autoriza; deja en `accion` el permiso con que lo hizo. Una sola anulación por movimiento (la base lo
 * impone con `anula_a` único): repetir con la misma clave y huella devuelve la anterior con `yaExistia`. Es lo mismo que hace
 * `revertirPorOrigen` con la salida de un ticket, para cualquier movimiento (no se toca esa función).
 */
export async function anularPorEspejoEnTx(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  datos: Readonly<{
    movimiento: Movimiento;
    accion: ClaveAccion;
    detalle: string;
    clave: string;
    huella: string;
    /** El origen que lleva la anulación (el de la orden que revierte). */
    origen: Readonly<{ tipo: string; id: string }> | null;
  }>,
): Promise<Resultado<MovimientoRegistrado, ErrorDeStock>> {
  const guardados = await tx.movimientosDeStock.renglonesDe(
    contexto.empresaId,
    datos.movimiento.id,
  );
  const espejo: RenglonDeLibro[] = guardados.map((r) => {
    const cantidad = cantidadConSignoDesdeTexto(r.cantidad);
    if (!cantidad.ok) throw new RangeError("stock: el renglón guardado no es una cantidad");
    return {
      depositoId: r.depositoId,
      articuloId: r.articuloId,
      composicionId: r.composicionId,
      cantidad: negarConSigno(cantidad.valor),
    };
  });
  return registrarMovimientoEnTx(tx, contexto, {
    clase: "ANULACION",
    motivo: "ANULACION",
    detalle: datos.detalle,
    origen: datos.origen,
    depositoId: datos.movimiento.depositoId,
    accion: datos.accion,
    anulaA: datos.movimiento.id,
    conteoId: null,
    clave: datos.clave,
    huella: datos.huella,
    hechoEn: contexto.ahora,
    fechaDeNegocio: null,
    renglones: espejo,
    confirmaciones: [],
  });
}
