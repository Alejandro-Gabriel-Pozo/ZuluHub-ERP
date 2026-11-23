/**
 * ARCHIVO CENTRAL
 * QUÉ ES: el registro de los tipos de cosa sobre la que se puede operar (contextos), uno por clave `modulo.cosa`; de acá sale `IdDeContexto`.
 * QUÉ NO ES: el lugar donde se declaran los contextos de un módulo: cada módulo suma los suyos desde su parte dedicada y acá solo se juntan.
 * EXPORTA: CONTEXTOS, IdDeContexto.
 * IMPORTA: src/capacidades/integracion/tipos, src/capacidades/integracion/contextos-de-*.
 * PARTE DEDICADA: src/capacidades/integracion/contextos-de-<módulo>.ts (los contextos de cada módulo).
 */
import type { TipoDeContexto } from "./tipos";

export const CONTEXTOS = {} as const satisfies Readonly<Record<string, TipoDeContexto>>;

export type IdDeContexto = keyof typeof CONTEXTOS;
