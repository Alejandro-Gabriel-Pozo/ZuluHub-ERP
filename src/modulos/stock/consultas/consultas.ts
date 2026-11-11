import type { DependenciasDeConsultasDeStock } from "../casos-de-uso/contrato";
import { crearLector } from "./comun";
import { armarConsultasDeComposiciones } from "./composiciones";
import { armarConsultasDeConteos } from "./conteos";
import { armarConsultasDeCostos } from "./costos";
import { armarConsultasDeDepositos } from "./depositos";
import { armarConsultasDeExistencias } from "./existencias";
import { armarConsultasDeLibro } from "./libro";
import { armarConsultasDeRecetas } from "./recetas";

/**
 * Las consultas por pantalla de stock (ADR-005): solo lectura (`read committed`), cada una pide su acción al guard dentro de su transacción.
 * Un depósito, artículo o movimiento de otra empresa es indistinguible de uno que no existe (la RLS). Cada tramo suma las suyas acá.
 */
export function crearConsultasDeStock(d: DependenciasDeConsultasDeStock) {
  const leer = crearLector(d);
  return {
    // depósitos (E5-T4)
    ...armarConsultasDeDepositos(leer),
    // existencias, libro y verificación de saldos (E5-T5)
    ...armarConsultasDeExistencias(leer),
    ...armarConsultasDeLibro(leer),
    // conteo físico (E5-T6)
    ...armarConsultasDeConteos(leer, d.reglas),
    // composiciones (E5-T7)
    ...armarConsultasDeComposiciones(leer),
    // ficha de receta con costo, comparar versiones, ficha de cocina (E6-T6)
    ...armarConsultasDeRecetas(leer, d.reglas),
    // costos (E5-T10)
    ...armarConsultasDeCostos(leer),
  };
}

export type ConsultasDeStock = ReturnType<typeof crearConsultasDeStock>;
