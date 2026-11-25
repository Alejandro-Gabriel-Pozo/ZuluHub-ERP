import type { EstadoDeParte } from "./estados";

/**
 * Anonimizar una parte (derecho de supresión de datos personales): se vacían sus datos personales y la ficha queda `ANONIMIZADA` para siempre; la fila, su
 * id y todo lo que la referencia (libro de saldos, compras, comprobantes) se conservan. Este archivo es la decisión pura; no lee ni escribe nada.
 */

/** Por qué se anonimiza: el pedido del titular o la baja de la empresa. Lista cerrada: lo que no figura no se admite. */
export const MOTIVOS_DE_ANONIMIZACION = ["PEDIDO_DEL_TITULAR", "BAJA_DE_EMPRESA"] as const;
export type MotivoDeAnonimizacion = (typeof MOTIVOS_DE_ANONIMIZACION)[number];

export function esMotivoDeAnonimizacion(valor: unknown): valor is MotivoDeAnonimizacion {
  return MOTIVOS_DE_ANONIMIZACION.some((motivo) => motivo === valor);
}

/** Qué módulos pueden impedir una anonimización. Hoy solo el libro de saldos; los demás se suman cuando se decida. */
export const MODULOS_QUE_IMPIDEN_ANONIMIZAR = ["saldos_de_partes"] as const;
export type ModuloQueImpide = (typeof MODULOS_QUE_IMPIDEN_ANONIMIZAR)[number];

/** Por qué un módulo impide anonimizar. Es un código, nunca un texto con datos de la parte. */
export const MOTIVOS_DE_IMPEDIMENTO = ["SALDO_DISTINTO_DE_CERO"] as const;
export type MotivoDeImpedimento = (typeof MOTIVOS_DE_IMPEDIMENTO)[number];

export type ImpedimentoDeAnonimizacion = Readonly<{
  modulo: ModuloQueImpide;
  motivo: MotivoDeImpedimento;
}>;

export type DecisionDeAnonimizacion =
  /** Hay que anonimizar. */
  | Readonly<{ tipo: "ANONIMIZAR" }>
  /** Ya estaba anonimizada: repetir el pedido no escribe, no audita y no encola nada. */
  | Readonly<{ tipo: "YA_ESTABA" }>
  /** Algún módulo lo impide (por ejemplo, la parte tiene saldo): no se anonimiza hasta que se resuelva. */
  | Readonly<{ tipo: "IMPEDIDA"; impedimentos: readonly ImpedimentoDeAnonimizacion[] }>;

/**
 * Lo que corresponde hacer con una parte en ese estado y con esos impedimentos. Una parte ya anonimizada gana sobre todo (la repetición es una respuesta ok); si
 * no, un solo impedimento alcanza para no anonimizar. Activa o desactivada, las dos se pueden anonimizar.
 */
export function decidirAnonimizacion(
  estado: EstadoDeParte,
  impedimentos: readonly ImpedimentoDeAnonimizacion[],
): DecisionDeAnonimizacion {
  if (estado === "ANONIMIZADA") return { tipo: "YA_ESTABA" };
  if (impedimentos.length > 0) return { tipo: "IMPEDIDA", impedimentos };
  return { tipo: "ANONIMIZAR" };
}
