import type { EstadoDeEmpresa } from "../../../contexto/estados";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { EmisorId } from "./identificadores";

/**
 * Emisor (spec H7 §B.2, nivel 4): cada CUIT con el que una empresa factura. Toda empresa nace con un
 * emisor PRINCIPAL cuyo CUIT es `empresa.cuit` (una sola fuente: el repositorio lo une); los
 * SECUNDARIOS los crea solo la plataforma. Acá viven las reglas puras; el aislamiento y la
 * unicidad definitiva las impone la base.
 */

/**
 * Condición frente al IVA del emisor. NO VERIFICADO: los códigos de ARCA de cada una no están acá;
 * la lista es el supuesto del diseño y se amplía editando este arreglo.
 */
export const CONDICIONES_DE_IVA = ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO"] as const;

export type CondicionIva = (typeof CONDICIONES_DE_IVA)[number];

export function esCondicionDeIva(texto: string): texto is CondicionIva {
  return (CONDICIONES_DE_IVA as readonly string[]).includes(texto);
}

export type Emisor = Readonly<{
  id: EmisorId;
  empresaId: EmpresaId;
  esPrincipal: boolean;
  cuit: Cuit;
  activo: boolean;
  version: number;
}>;

export type ErrorDeEmisor =
  | "EMPRESA_NO_OPERABLE"
  | "CUIT_EN_USO"
  | "CUIT_INMUTABLE"
  | "EMISOR_PRINCIPAL_NO_SE_DESACTIVA"
  | "EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS";

/** `cambio` es `false` cuando la operación repetida no cambia nada (idempotencia: sin escritura ni auditoría). */
export type CambioDeEmisor = Readonly<{ emisor: Emisor; cambio: boolean }>;

/** Un emisor secundario solo nace en una empresa que ya operó: `ACTIVE` o `SUSPENDED` (no en alta ni en baja). */
const ESTADOS_QUE_ADMITEN_EMISOR_SECUNDARIO: readonly EstadoDeEmpresa[] = ["ACTIVE", "SUSPENDED"];

export type DatosDeEmisorSecundario = Readonly<{ id: EmisorId; empresaId: EmpresaId; cuit: Cuit }>;

export type ContextoDeCuit = Readonly<{
  /**
   * Todos los CUIT ya tomados en la instalación: el de toda empresa NO cancelada y el de todo
   * emisor secundario. Los lee quien llama bajo serializable; la base repite la regla.
   */
  cuitsEnUso: ReadonlySet<Cuit>;
}>;

/**
 * Arma un emisor secundario, activo, con su CUIT propio. Orden de los errores: la empresa tiene que
 * admitirlo (`EMPRESA_NO_OPERABLE`) y después que el CUIT no esté tomado (`CUIT_EN_USO`).
 */
export function nuevoEmisorSecundario(
  datos: DatosDeEmisorSecundario,
  estadoDeEmpresa: EstadoDeEmpresa,
  contexto: ContextoDeCuit,
): Resultado<Emisor, ErrorDeEmisor> {
  if (!ESTADOS_QUE_ADMITEN_EMISOR_SECUNDARIO.includes(estadoDeEmpresa)) {
    return err("EMPRESA_NO_OPERABLE");
  }
  if (contexto.cuitsEnUso.has(datos.cuit)) return err("CUIT_EN_USO");
  return ok({
    id: datos.id,
    empresaId: datos.empresaId,
    esPrincipal: false,
    cuit: datos.cuit,
    activo: true,
    version: 1,
  });
}

/**
 * Desactiva un emisor. El principal nunca se desactiva; un secundario solo si no tiene puntos de
 * venta `ACTIVO`. Repetirlo sobre uno ya inactivo no cambia nada.
 */
export function desactivarEmisor(
  emisor: Emisor,
  puntosDeVentaActivos: number,
): Resultado<CambioDeEmisor, ErrorDeEmisor> {
  if (emisor.esPrincipal) return err("EMISOR_PRINCIPAL_NO_SE_DESACTIVA");
  if (!emisor.activo) return ok({ emisor, cambio: false });
  if (puntosDeVentaActivos > 0) return err("EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS");
  return ok({ emisor: { ...emisor, activo: false }, cambio: true });
}

export type ContextoDeCorreccionDeCuit = ContextoDeCuit &
  Readonly<{
    /** Alguna serie del emisor tiene `ultimo_numero > 0` o no está `LIBRE` (`hayNumerosUsados`). */
    tieneNumerosUsados: boolean;
  }>;

/**
 * Corrige el CUIT de un emisor (solo la plataforma). Es posible hasta el primer número de
 * comprobante usado; después es inmutable. En el principal el CUIT es `empresa.cuit`: el repositorio
 * escribe donde corresponda. Corregir al mismo CUIT no cambia nada (aunque ya haya números usados).
 * Orden de los errores: `CUIT_INMUTABLE` y después `CUIT_EN_USO`.
 */
export function corregirCuit(
  emisor: Emisor,
  nuevo: Cuit,
  contexto: ContextoDeCorreccionDeCuit,
): Resultado<CambioDeEmisor, ErrorDeEmisor> {
  if (nuevo === emisor.cuit) return ok({ emisor, cambio: false });
  if (contexto.tieneNumerosUsados) return err("CUIT_INMUTABLE");
  if (contexto.cuitsEnUso.has(nuevo)) return err("CUIT_EN_USO");
  return ok({ emisor: { ...emisor, cuit: nuevo }, cambio: true });
}
