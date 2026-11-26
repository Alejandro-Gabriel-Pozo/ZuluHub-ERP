import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  negarConSigno,
} from "../../../primitivas/cantidad/con-signo";
import type { NivelDeCompra } from "../dominio/niveles";
import { claveDeLaAnulacionDeLaConciliacion } from "../dominio/registrar-compra";
import type { TxDeCompras } from "./contrato";

/**
 * El espejo de las conciliaciones de una factura de N1/N2 (la del atajo, que nace con la compra): una anulación por cada conciliación vigente, con las cantidades opuestas, una sola vez (`anula_a` es único). Lo usan «anular la compra»
 * y «cambiar el comprobante de la compra»: una regla, un lugar. Se llama con el comprobante ya bloqueado.
 */
export async function espejarLasConciliacionesDelAtajo(
  tx: Pick<TxDeCompras, "conciliacionesDeCompra">,
  empresaId: EmpresaId,
  persona: PersonaId,
  comprobante: Readonly<{ id: string; nivel: NivelDeCompra }>,
): Promise<void> {
  const conciliaciones = await tx.conciliacionesDeCompra.conciliacionesDe(
    empresaId,
    comprobante.id,
  );
  const yaEspejadas = new Set(conciliaciones.map((c) => c.anulaA));
  for (const conciliacion of conciliaciones) {
    if (conciliacion.acto !== "CONCILIACION" || yaEspejadas.has(conciliacion.id)) continue;
    const espejo = await tx.conciliacionesDeCompra.insertarConciliacion(empresaId, {
      acto: "ANULACION",
      anulaA: conciliacion.id,
      comprobanteId: comprobante.id,
      esAtajo: true,
      nivel: comprobante.nivel,
      clave: claveDeLaAnulacionDeLaConciliacion(conciliacion.id),
      registradoPor: persona,
    });
    if (espejo === undefined) {
      throw new Error("el espejo de la conciliación chocó con una restricción única");
    }
    const asignaciones = await tx.conciliacionesDeCompra.asignacionesDe(empresaId, conciliacion.id);
    await tx.conciliacionesDeCompra.insertarAsignaciones(
      empresaId,
      { id: espejo, acto: "ANULACION", comprobanteId: comprobante.id },
      asignaciones.map((a) => {
        const cantidad = cantidadConSignoDesdeTexto(a.cantidad);
        if (!cantidad.ok)
          throw new RangeError("compras: la asignación guardada no es una cantidad");
        return { ...a, cantidad: cantidadConSignoATexto(negarConSigno(cantidad.valor)) };
      }),
    );
  }
}
