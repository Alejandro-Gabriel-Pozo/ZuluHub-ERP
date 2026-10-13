import type { EmisorId } from "../primitivas/identificadores/marca";

/**
 * Qué es un emisor fiscal para quien solo guarda una referencia a él (catálogo, stock y caja; registro
 * de contratos K8, conciliación §2.5, X20):
 *  - `ACTIVO`: existe en la empresa del contexto y se puede usar.
 *  - `INACTIVO`: existe en la empresa del contexto pero está dado de baja.
 *  - `NO_EXISTE`: no hay tal emisor en la empresa del contexto. Incluye el de OTRA empresa: bajo la RLS
 *    de la empresa no se ve, y no se distingue de uno que nunca existió (no hay oráculo entre empresas).
 */
export type EstadoDeEmisor = "ACTIVO" | "INACTIVO" | "NO_EXISTE";

/**
 * Puerto ÚNICO para preguntar por un emisor sin importar `modulos/fiscal` (ADR-014: catálogo, stock y
 * caja guardan un `EmisorId` opaco y no saben qué es un emisor). Lo implementa fiscal y lo arma la
 * composición atado a la transacción en curso, así que lee con la RLS de la empresa del contexto y en
 * la misma transacción que la escritura que va a guardar la referencia (un emisor dado de baja un
 * instante antes ya cuenta como `INACTIVO`). No guarda nada entre llamadas.
 *
 * Quien guarda la referencia rechaza `INACTIVO` y `NO_EXISTE` con `EMISOR_NO_DISPONIBLE` (código
 * compartido, dueño fiscal). La clave foránea compuesta de la base es la segunda barrera: si este
 * puerto fallara, igual no se guardaría un emisor ajeno.
 */
export interface ConsultaDeEmisores {
  estado(emisorId: EmisorId): Promise<EstadoDeEmisor>;
}
