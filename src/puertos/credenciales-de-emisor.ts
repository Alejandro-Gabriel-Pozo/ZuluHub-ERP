import type { EmisorId, EmpresaId } from "../primitivas/identificadores/marca";
import type { Resultado } from "../primitivas/resultado/resultado";
import type { Secreto } from "../primitivas/secreto/secreto";
import type { ErrorDePersistencia } from "./transacciones";

/** Cada ambiente de ARCA es otro ARCA, con su propia cadena de certificación y su propio certificado. */
export type AmbienteDeArca = "HOMOLOGACION" | "PRODUCCION";

/**
 * El certificado vigente de un emisor y su clave, descifrada SOLO en memoria, para quien firma el pedido de
 * ticket de acceso (el adaptador de ARCA, F8). La clave va envuelta (`Secreto`): quien la necesita la pide con
 * `revelar()` y no la guarda ni la registra.
 */
export type CredencialesDescifradas = Readonly<{
  certificadoId: string;
  /** El certificado en PEM (público). */
  certificadoPem: string;
  clavePrivada: Secreto;
  venceEn: Date;
}>;

export type ErrorDeCredenciales =
  /** El emisor no tiene certificado `VIGENTE` en ese ambiente. */
  | "SIN_CERTIFICADO_VIGENTE"
  /** Lo tiene, pero ya venció (el vencimiento se calcula con la hora, no se guarda). */
  | "CERTIFICADO_VENCIDO"
  /** La clave guardada no se puede descifrar (clave maestra equivocada o fila alterada). */
  | "CLAVE_ILEGIBLE"
  | ErrorDePersistencia;

export interface CredencialesDeEmisor {
  obtener(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: AmbienteDeArca,
  ): Promise<Resultado<CredencialesDescifradas, ErrorDeCredenciales>>;
}
