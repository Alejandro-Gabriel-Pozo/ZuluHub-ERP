/** Las rutas de Cuenta: una regla, un lugar (la página de Cuenta, la del contacto y sus pruebas las leen de acá). */
export const RUTAS_DE_CUENTA = {
  cuenta: "/cuenta",
  contactoDeLaSucursal: "/cuenta/contacto-de-la-sucursal",
  usuarios: "/cuenta/usuarios",
  invitarUsuario: "/cuenta/usuarios/invitar",
} as const;

/** La ficha de una persona de la empresa: `/cuenta/usuarios/<personaId>`. */
export const rutaDeLaFichaDeUsuario = (personaId: string): string =>
  `${RUTAS_DE_CUENTA.usuarios}/${personaId}`;

/** La ficha de una invitación pendiente: `/cuenta/usuarios/invitaciones/<invitacionId>`. */
export const rutaDeLaFichaDeInvitacion = (invitacionId: string): string =>
  `${RUTAS_DE_CUENTA.usuarios}/invitaciones/${invitacionId}`;
