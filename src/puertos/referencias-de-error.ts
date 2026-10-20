import type { EmpresaId, PersonaId } from "../primitivas/identificadores/marca";

/**
 * Una referencia de error (H5 plataforma, §B.5.9 y decisión F4): el código `PD-XXXX-XXXX` que ve quien
 * recibe un rechazo y que soporte busca después. Solo el MOTIVO tipado, ningún dato de negocio: la base
 * lo impone con CHECK estrictos sobre la forma de cada campo. Sin unicidad (32 bits pueden colisionar).
 */
export type NuevaReferenciaDeError = Readonly<{
  referencia: string;
  /** La acción rechazada, por ejemplo `usuarios.invitar`. */
  accion: string;
  /** El motivo tipado del rechazo, por ejemplo `SIN_PERMISO`. */
  motivo: string;
  empresaId: EmpresaId | null;
  personaId: PersonaId | null;
}>;

/**
 * Puerto de escritura de referencias de error. Cada puerta escribe solo lo suyo: la base compara la
 * empresa y la persona con las del contexto firmado (la aplicación y el grupo) o exige un actor vigente
 * (la plataforma). Se usa en su PROPIA transacción, después de que la del caso de uso se revirtió: el
 * rechazo no deja nada más. No devuelve la fila (los roles que escriben no la pueden leer).
 */
export interface ReferenciasDeError {
  registrar(referencia: NuevaReferenciaDeError): Promise<void>;
}
