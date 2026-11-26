import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_CUENTA_CORRIENTE = {
  // CC-1 (brief PR-CC-1 §4; decisión del dueño: habilita «solo gerente o administrador», sin piso `SOLO_GERENTE`: el gerente puede delegarlo en un rol propio).
  // El cajero y el operador no habilitan ni ven la cuenta: lo reciben, si el dueño lo decide, en CC-2 y CC-5 (SUPUESTO (DEC-1220) CC-1 para `ver`).
  "cuenta_corriente.ver": ["GERENTE", "ADMINISTRADOR"],
  "cuenta_corriente.administrar": ["GERENTE", "ADMINISTRADOR"],
  // CC-2 (brief PR-CC-2 §1.6; SUPUESTO (DEC-CCL-001)): cerrar a nombre de un cliente lo hacen los roles que hoy cierran cuentas (el cajero incluido); aprobar un exceso del límite,
  // gerente y administrador, delegable en un rol propio (sin piso `SOLO_GERENTE`).
  "cuenta_corriente.cargar_a_cuenta": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cuenta_corriente.aprobar_exceso": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["cuenta_corriente"]["acciones"],
  readonly RolDeEmpresa[]
>;
