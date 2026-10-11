import type { EmpresaId, PersonaId } from "../primitivas/identificadores/marca";
import type { Dato } from "./sin-secretos";

/**
 * Puerto de auditoría por empresa. El registro se escribe en la MISMA transacción del cambio que
 * describe (solo inserción: nada se corrige ni se borra). No lleva secretos: ni el token ni su hash.
 */
export type RegistroDeAuditoria = Readonly<{
  empresaId: EmpresaId;
  /** `null`: lo hizo el sistema. */
  actorPersonaId: PersonaId | null;
  accion: string;
  entidad: string;
  entidadId: string;
  antes?: Readonly<Record<string, Dato>> | null;
  despues?: Readonly<Record<string, Dato>> | null;
}>;

export interface Auditoria {
  registrar(registro: RegistroDeAuditoria): Promise<void>;
}
