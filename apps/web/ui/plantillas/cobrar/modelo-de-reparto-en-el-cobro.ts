import {
  medioInicial,
  pagoAdicional,
  pagoNuevo,
  type MedioParaCobrar,
  type PagoEnEdicion,
} from "./modelo-de-cobro";

/**
 * Las filas de cobro que carga «Usar en el cobro» (SAL-E3): una por parte y en orden, cada una con su importe. La primera lleva el medio inicial y cada una de las siguientes el primer medio que todavía no se usa (como «Agregar otro medio»);
 * la persona cambia el medio de cada fila. Vacío si el servidor no ofreció ningún medio. No decide nada del dinero: los importes los propone `reparto-por-porcentaje.ts` y el servidor exige que los cobros sumen el total.
 */
export function filasDelReparto(
  importes: readonly string[],
  medios: readonly MedioParaCobrar[],
  nuevoId: () => string,
): readonly PagoEnEdicion[] {
  const inicial = medioInicial(medios);
  if (inicial === null) return [];
  const filas: PagoEnEdicion[] = [];
  for (const importe of importes) {
    const fila =
      filas.length === 0
        ? pagoNuevo(nuevoId(), inicial.id, importe)
        : pagoAdicional(nuevoId(), medios, filas, importe);
    if (fila !== null) filas.push(fila);
  }
  return filas;
}
