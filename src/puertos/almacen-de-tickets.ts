import type { EmisorId, EmpresaId } from "../primitivas/identificadores/marca";
import type { AmbienteDeArca } from "./credenciales-de-emisor";

/**
 * Puerto del ticket de acceso de WSAA (spec H7 facturación §B.6.3, tramo F7). WSAA entrega un ticket
 * (`token` y `sign`) que vale 12 horas y NO emite otro mientras haya uno vigente
 * (`coe.alreadyAuthenticated`): por eso el ticket se guarda y se comparte entre los procesos, uno por
 * (emisor, ambiente) y por servicio. Es un caché, no historia: `guardar` reemplaza el anterior.
 *
 * Lo implementa F7 (cifrado en la base). El adaptador de ARCA es quien lo lee y lo guarda; el ticket
 * nunca sale de ahí hacia un error, un registro ni la auditoría.
 */
export type ServicioDeArca = "wsfe";

export type TicketDeAcceso = Readonly<{
  token: string;
  sign: string;
  /** Cuándo vence el ticket según WSAA (`expirationTime`). */
  venceEn: Date;
}>;

export interface AlmacenDeTickets {
  /** El ticket guardado, aunque esté por vencer (decide el que lo pide), o `null` si no hay ninguno. */
  leer(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: AmbienteDeArca,
    servicio: ServicioDeArca,
  ): Promise<TicketDeAcceso | null>;
  /** Guarda el ticket recién obtenido, en una transacción corta, reemplazando el anterior. */
  guardar(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: AmbienteDeArca,
    servicio: ServicioDeArca,
    ticket: TicketDeAcceso,
  ): Promise<void>;
}
