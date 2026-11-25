import { cantidadConUnidad } from "../../produccion/modelo-de-ordenes";
import { hrefDeLectura } from "../lectura/modelo-de-lectura";

/**
 * El modelo de vista de «Existencias» (maqueta aprobada `stock.html`, 09/11/2026): de lo que entrega la composición, el selector de depósitos y una fila por artículo con su existencia y su unidad.
 * «Negativa» se marca solo cuando el saldo lo es. Sin costos ni «Disponible» (no están en la maqueta de esta pantalla). La cantidad es texto decimal: nunca pasa por `Number` (ADR-006). Puro.
 */

export type ExistenciasDeLaComposicion = Readonly<{
  depositos: readonly Readonly<{ id: string; nombre: string }>[];
  depositoId: string | null;
  existencias: readonly Readonly<{
    articuloId: string;
    nombre: string;
    unidadId: string;
    existencia: string;
    negativa: boolean;
  }>[];
  siguiente: string | null;
}>;

export type FilaDeExistencia = Readonly<{
  id: string;
  titulo: string;
  cantidad: string;
  negativa: boolean;
}>;

export type VistaDeExistencias = Readonly<{
  opciones: readonly Readonly<{ id: string; nombre: string; href: string; actual: boolean }>[];
  filas: readonly FilaDeExistencia[];
  /** Adónde lleva «Siguiente», o `null` si no hay más. */
  hrefDeSiguiente: string | null;
}>;

export function armarLasExistencias(dato: ExistenciasDeLaComposicion): VistaDeExistencias {
  return {
    opciones: dato.depositos.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      href: hrefDeLectura("existencias", d.id),
      actual: d.id === dato.depositoId,
    })),
    filas: dato.existencias.map((e) => ({
      id: e.articuloId,
      titulo: e.nombre,
      cantidad: cantidadConUnidad(e.existencia, e.unidadId),
      negativa: e.negativa,
    })),
    hrefDeSiguiente:
      dato.siguiente === null
        ? null
        : hrefDeLectura("existencias", dato.depositoId, dato.siguiente),
  };
}
