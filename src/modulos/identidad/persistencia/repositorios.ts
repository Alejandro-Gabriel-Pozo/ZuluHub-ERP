/**
 * Repositorios de identidad (ADR-005, ADR-009). Cada método tiene una intención y devuelve tipos del
 * dominio. Reglas de este archivo:
 *
 *  - Los cambios de estado son `UPDATE ... WHERE estado = ... AND version = ...` y devuelven si
 *    tocaron la fila: nada de `FOR UPDATE` ni de upserts.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones
 *    las traduce a `ErrorDePersistencia` (la traducción a errores de negocio está en
 *    `casos-de-uso/traducir.ts`).
 *  - El alta de una invitación NO lleva `RETURNING`: por RLS no se puede leer hasta que existe su
 *    fila en `invitacion_empresa` (0002, D7). El id lo genera la aplicación.
 *  - Lo que se lee depende del contexto firmado de la transacción (RLS): por ejemplo, un contexto
 *    operativo ve de una invitación solo la parte de su empresa.
 */

export {
  crearRepositorioDePersonas,
  crearRepositorioDeMembresias,
  type MiembroConEmail,
  type RepositorioDeMembresias,
  type RepositorioDePersonas,
} from "./repositorio-de-personas-y-membresias";
export {
  crearRepositorioDeAsignaciones,
  type Asignacion,
  type RepositorioDeAsignaciones,
} from "./repositorio-de-asignaciones";
export {
  crearRepositorioDeInvitaciones,
  type InvitacionPendienteDeLista,
  type RepositorioDeInvitaciones,
} from "./repositorio-de-invitaciones";
export {
  crearRepositorioDeTraspasos,
  type RepositorioDeTraspasos,
  type TraspasoGuardado,
} from "./repositorio-de-traspasos";
