import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Email } from "./email";
import type { ErrorDeMembresia } from "./errores";

/** Rol de una persona en una empresa. Vive acá para que invitación y membresía no se importen entre sí. */
export type RolDeEmpresa = "GERENTE" | "ADMINISTRADOR" | "OPERADOR";

/** La pertenencia de una persona a una empresa, con su rol. */
export type Membresia = Readonly<{
  empresaId: EmpresaId;
  personaId: PersonaId;
  rol: RolDeEmpresa;
  activo: boolean;
  version: number;
}>;

/** Persona: se identifica por su email; `activoGlobal` en falso es una suspensión de plataforma. */
export type Persona = Readonly<{
  id: PersonaId;
  email: Email;
  activoGlobal: boolean;
}>;

/** "Admin" de una empresa es el gerente o un administrador. */
function esAdmin(rol: RolDeEmpresa): boolean {
  return rol === "GERENTE" || rol === "ADMINISTRADOR";
}

/**
 * Control de piso transitorio (se reemplaza por el catálogo de acciones en H4): administra
 * accesos quien es miembro ACTIVO de la empresa con rol de gerente o de administrador.
 */
export function puedeAdministrarAccesos(actor: Membresia | null): boolean {
  return actor !== null && actor.activo && esAdmin(actor.rol);
}

/**
 * Decide el apagado de una membresía. `activas` son las membresías activas de la empresa. Orden:
 * no existe (`MEMBRESIA_NO_ENCONTRADA`); ya apagada (ok `YA_APAGADA`, idempotente); es el gerente
 * activo (`ES_EL_GERENTE`: se traspasa, no se apaga); es admin y no queda otro admin activo en la
 * misma empresa (`ULTIMO_ADMIN`); si no, `APAGAR`. Solo cuentan las membresías activas de la misma
 * empresa y el objetivo no se cuenta a sí mismo, venga o no dentro de `activas`.
 */
export function decidirApagado(
  objetivo: Membresia | null,
  activas: readonly Membresia[],
): Resultado<"APAGAR" | "YA_APAGADA", ErrorDeMembresia> {
  if (objetivo === null) return err("MEMBRESIA_NO_ENCONTRADA");
  if (!objetivo.activo) return ok("YA_APAGADA");
  if (objetivo.rol === "GERENTE") return err("ES_EL_GERENTE");
  if (!esAdmin(objetivo.rol)) return ok("APAGAR");
  const quedan = activas.some(
    (m) =>
      m.activo &&
      m.empresaId === objetivo.empresaId &&
      m.personaId !== objetivo.personaId &&
      esAdmin(m.rol),
  );
  return quedan ? ok("APAGAR") : err("ULTIMO_ADMIN");
}
