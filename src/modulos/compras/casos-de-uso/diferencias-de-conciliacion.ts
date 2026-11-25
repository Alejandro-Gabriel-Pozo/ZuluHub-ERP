import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  calcularDiferencias,
  SIN_TOLERANCIAS,
  type AsignacionConciliada,
  type LineaConciliada,
} from "../dominio/diferencias";
import { pendienteDeLinea, type AsignacionPedida } from "../dominio/conciliacion-separada";
import type { TxDeCompras } from "./contrato";

export type ResumenDeDiferencias = Readonly<{ total: number; abiertas: number }>;

/**
 * Lo que hace una conciliación de la empresa en N4, en la MISMA transacción que la conciliación: copia a ella las tolerancias vigentes, calcula las diferencias (cantidad facturada de
 * más y precio contra la referencia: la de la línea de la orden si la recepción es contra una y, si no, la de la recepción) y las registra ABIERTAS con los umbrales aplicados. Las que
 * quedan dentro de la tolerancia se resuelven en el acto como `DENTRO_DE_TOLERANCIA` (nunca se descarta una en silencio). Sin tolerancia definida, todas quedan abiertas.
 * Se llama DESPUÉS de insertar las asignaciones: lo asignado de cada línea es el saldo vigente de la factura.
 */
export async function registrarDiferenciasDeLaConciliacion(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  conciliacion: Readonly<{ id: string; comprobanteId: string; proveedorId: string }>,
  asignaciones: readonly AsignacionPedida[],
): Promise<ResumenDeDiferencias> {
  const { empresaId } = contexto;
  const persona = contexto.personaId;
  if (persona === null) throw new Error("registrar diferencias exige una persona");
  const tolerancias =
    (await tx.toleranciasDeCompra.leer(empresaId))?.tolerancias ?? SIN_TOLERANCIAS;
  await tx.diferenciasDeCompra.insertarToleranciaAplicada(empresaId, conciliacion.id, tolerancias);

  const detalle = await tx.detalleDeComprobantes.lineasDe(empresaId, conciliacion.comprobanteId);
  const saldos = await tx.conciliacionesDeCompra.saldosDeFactura(
    empresaId,
    conciliacion.comprobanteId,
  );
  // Lo recibido (confirmado, no rechazado) que todavía no está asignado a ninguna factura, por producto: mientras quede, lo facturado de más no se mide (conciliación por partes).
  const recibidas = await tx.recepcionesSeparadas.lineasConciliables(
    empresaId,
    conciliacion.proveedorId,
    // Todas: las diferencias se miden sobre lo recibido de la empresa, no sobre el alcance de quien concilia.
    "TODAS",
  );
  const lineas: LineaConciliada[] = detalle.map((l) => ({
    numero: l.numero,
    facturada: l.cantidadFacturada,
    precioNeto: l.precioNeto,
    asignada: saldos.find((s) => s.linea === l.numero)?.asignada ?? "0.0000",
    recibidoSinAsignar: recibidas.some(
      (r) => r.productoId === l.productoId && pendienteDeLinea(r.recibida, r.asignada) !== null,
    ),
  }));
  const referencias = await tx.diferenciasDeCompra.referenciasDePrecio(
    empresaId,
    asignaciones.map((a) => ({ recepcionId: a.recepcionId, linea: a.lineaDeRecepcion })),
  );
  const conciliadas: AsignacionConciliada[] = asignaciones.map((a) => ({
    lineaDeFactura: a.lineaDeFactura,
    recepcionId: a.recepcionId,
    lineaDeRecepcion: a.lineaDeRecepcion,
    cantidad: a.cantidad,
    referencia:
      referencias.find((r) => r.recepcionId === a.recepcionId && r.linea === a.lineaDeRecepcion)
        ?.referencia ?? null,
  }));

  const diferencias = calcularDiferencias(lineas, conciliadas, tolerancias);
  const ids = await tx.diferenciasDeCompra.insertar(empresaId, {
    conciliacionId: conciliacion.id,
    comprobanteId: conciliacion.comprobanteId,
    tolerancias,
    diferencias,
  });
  let abiertas = 0;
  for (const [i, d] of diferencias.entries()) {
    if (!d.dentroDeTolerancia) {
      abiertas += 1;
      continue;
    }
    await tx.diferenciasDeCompra.resolver(empresaId, ids[i] as string, {
      por: persona,
      resolucion: "DENTRO_DE_TOLERANCIA",
      motivo: null,
    });
  }
  return { total: diferencias.length, abiertas };
}
