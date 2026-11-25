import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_ADMINISTRACION = {
  "usuarios.invitar": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.reenviar_invitacion": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.apagar": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.ver": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.asignar_sucursales": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.revocar_invitacion": ["GERENTE", "ADMINISTRADOR"],
  // H4b T4: los roles propios y su asignación son solo del gerente (decisión del dueño, 14/11 y 25/11/2026; pisos SOLO_GERENTE en 0097).
  "roles.ver": ["GERENTE"],
  "roles.crear": ["GERENTE"],
  "roles.editar": ["GERENTE"],
  "roles.archivar": ["GERENTE"],
  "usuarios.asignar_rol": ["GERENTE"],
  "sucursales.ver": ["GERENTE", "ADMINISTRADOR"],
  "sucursales.crear": ["GERENTE", "ADMINISTRADOR"],
  "sucursales.editar": ["GERENTE", "ADMINISTRADOR"],
  "sucursales.desactivar": ["GERENTE"],
  "sucursales.reactivar": ["GERENTE"],
  "gerencia.proponer_traspaso": ["GERENTE"],
  "gerencia.cancelar_traspaso": ["GERENTE"],
  "gerencia.ver_traspaso": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "gerencia.aceptar_traspaso": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "gerencia.rechazar_traspaso": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "modulos.ver": ["GERENTE", "ADMINISTRADOR"],
  "permisos.ver_propios": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // H7 fiscal §C (T5), DECIDIDO (C11): la configuración fiscal es solo del gerente, igual que certificados. El
  // administrador y el operador ni confirman datos fiscales ni activan puntos de venta.
  "datos_fiscales.editar": ["GERENTE"],
  "datos_fiscales.confirmar": ["GERENTE"],
  "puntos_de_venta.crear": ["GERENTE"],
  "puntos_de_venta.editar": ["GERENTE"],
  "puntos_de_venta.activar": ["GERENTE"],
  "puntos_de_venta.desactivar": ["GERENTE"],
  "emisores.confirmar_regla": ["GERENTE"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["administracion"]["acciones"],
  readonly RolDeEmpresa[]
>;
