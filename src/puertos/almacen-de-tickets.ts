import type { EmisorId, EmpresaId } from "../primitivas/identificadores/marca";
import type { Resultado } from "../primitivas/resultado/resultado";
import type { Secreto } from "../primitivas/secreto/secreto";
import type { AmbienteDeArca } from "./credenciales-de-emisor";
import type { ErrorDePersistencia } from "./transacciones";

/**
 * El ticket de acceso (TA) de WSAA: dura 12 horas y ARCA rechaza pedir otro mientras hay uno vigente, así que se
 * guarda cifrado en la base y se reutiliza (spec H7 facturación §B.5.3 y §B.6.3). Es un caché, no historia: hay
 * uno por (emisor, ambiente, servicio) y se pisa al renovarlo.
 */
export type ServicioDeArca = "wsfe";

export type TicketDeAcceso = Readonly<{
  /** El certificado con el que se pidió: el ticket pertenece a él. */
  certificadoId: string;
  token: Secreto;
  firma: Secreto;
  generadoEn: Date;
  venceEn: Date;
}>;

export type ErrorDeAlmacenDeTickets =
  /** El certificado del ticket no existe, o no es de ese emisor y ambiente. */
  | "CERTIFICADO_NO_ENCONTRADO"
  /** Lo guardado no se puede leer (clave maestra equivocada o fila alterada). */
  | "TICKET_ILEGIBLE"
  | ErrorDePersistencia;

export interface AlmacenDeTickets {
  /**
   * El ticket del certificado VIGENTE del emisor en ese ambiente, si todavía sirve (no vencido, con 5 minutos de
   * margen); `null` si no hay o ya no sirve.
   */
  leer(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: AmbienteDeArca,
    servicio: ServicioDeArca,
  ): Promise<Resultado<TicketDeAcceso | null, ErrorDeAlmacenDeTickets>>;
  /**
   * Guarda el ticket cifrado (pisa el anterior). Va en una transacción corta, apenas se recibe: si el proceso muere
   * antes de guardarlo, ARCA no deja pedir otro por horas. El ticket se guarda con el certificado que lo pidió
   * (`ticket.certificadoId`), aunque entretanto se haya cargado otro.
   */
  guardar(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: AmbienteDeArca,
    servicio: ServicioDeArca,
    ticket: TicketDeAcceso,
  ): Promise<Resultado<null, ErrorDeAlmacenDeTickets>>;
}
