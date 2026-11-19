/**
 * ARCHIVO CENTRAL
 * QUÉ ES: el registro de las operaciones contextuales: qué se puede hacer sobre cada contexto, qué módulo lo hace y dónde se abre.
 * QUÉ NO ES: el lugar donde se declaran las operaciones de un módulo: cada módulo suma las suyas desde su parte dedicada y acá solo se juntan.
 * EXPORTA: OPERACIONES.
 * IMPORTA: src/capacidades/integracion/tipos, src/capacidades/integracion/contextos, src/capacidades/integracion/operaciones-de-*.
 * PARTE DEDICADA: src/capacidades/integracion/operaciones-de-<módulo>.ts (las operaciones de cada módulo).
 */
import type { IdDeContexto } from "./contextos";
import type { OperacionContextual } from "./tipos";

export const OPERACIONES: readonly OperacionContextual<IdDeContexto>[] = [];
