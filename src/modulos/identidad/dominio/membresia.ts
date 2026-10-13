import type { RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Email } from "../../../primitivas/contacto/email";
import type { ErrorDeMembresia } from "./errores";

/**
 * Rol de una persona en una empresa. La lista de roles es de `capacidades/permisos/roles.ts`; se
 * reexporta acá para que invitación y membresía no se importen entre sí.
 */
export type { RolDeEmpresa };

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

/**
 * "Admin" de una empresa es el gerente o un administrador: los roles que gestionan usuarios según la
 * matriz de permisos (una prueba comprueba que ambas listas dicen lo mismo). Cuando los roles sean
 * datos de cada empresa, esta lista tendrá que venir de ellos.
 */
function esAdmin(rol: RolDeEmpresa): boolean {
  return rol === "GERENTE" || rol === "ADMINISTRADOR";
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
