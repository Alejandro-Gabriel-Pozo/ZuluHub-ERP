/**
 * Los roles de una parte (E9 §3.1): qué es para el negocio. Una parte puede ser cliente y proveedor a la vez; un contacto puede no tener ninguno.
 * Los códigos son los de la tabla sembrada `rol_de_parte` (0034); EMPLEADO queda fuera de la primera versión (decisión F6 de
 * `clientes-y-proveedores.md`). Los roles no se borran: se apagan y se reactivan.
 */
export const ROLES_DE_PARTE = ["CUSTOMER", "PROVEEDOR"] as const;
export type RolDeParte = (typeof ROLES_DE_PARTE)[number];

export type RolGuardado = Readonly<{ rol: RolDeParte; activo: boolean }>;

export type CambioDeRoles = Readonly<{
  /** Roles que la parte no tenía: se crean. */
  agregados: readonly RolDeParte[];
  /** Roles que tenía apagados: se vuelven a encender. */
  reactivados: readonly RolDeParte[];
  /** Roles que tenía activos y ya no se piden: se apagan. */
  quitados: readonly RolDeParte[];
}>;

export function esRolDeParte(texto: string): texto is RolDeParte {
  return (ROLES_DE_PARTE as readonly string[]).includes(texto);
}

/**
 * Los roles pedidos como conjunto: sin repetidos, en el orden de `ROLES_DE_PARTE`. Un código que no es un rol da `null` (el caso de uso lo
 * informa como `ROL_DE_PARTE_INVALIDO`): ninguno se descarta en silencio.
 */
export function rolesPedidos(pedidos: readonly string[]): readonly RolDeParte[] | null {
  if (!pedidos.every(esRolDeParte)) return null;
  const conjunto = new Set<string>(pedidos);
  return ROLES_DE_PARTE.filter((rol) => conjunto.has(rol));
}

/**
 * Qué hay que hacer para que los roles activos de una parte sean EXACTAMENTE los pedidos (conjunto final). Pura y repetible: pedir lo que ya
 * está da todo vacío (el caso de uso lo informa sin escribir). Un rol apagado que se pide se reactiva, no se vuelve a crear.
 */
export function decidirRoles(
  guardados: readonly RolGuardado[],
  pedidos: readonly RolDeParte[],
): CambioDeRoles {
  const pedido = new Set<RolDeParte>(pedidos);
  const activos = new Set(guardados.filter((g) => g.activo).map((g) => g.rol));
  const conFila = new Set(guardados.map((g) => g.rol));
  return {
    agregados: ROLES_DE_PARTE.filter((r) => pedido.has(r) && !conFila.has(r)),
    reactivados: ROLES_DE_PARTE.filter((r) => pedido.has(r) && conFila.has(r) && !activos.has(r)),
    quitados: ROLES_DE_PARTE.filter((r) => activos.has(r) && !pedido.has(r)),
  };
}
