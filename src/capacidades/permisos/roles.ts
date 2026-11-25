/**
 * Roles de una persona dentro de una empresa. Son datos, no lógica: la lista cierra el tipo
 * `RolDeEmpresa`, y qué puede hacer cada rol vive aparte (`empresa.ts`), que el guard recibe como
 * parámetro. En v1 son fijos para todas las empresas (decisión 18). Una prueba de integración
 * comprueba que esta lista es exactamente la de los CHECK `membresia_rol_ck` e
 * `invitacion_empresa_rol_ck` de la base.
 */
export const ROLES_DE_EMPRESA = ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const;

export type RolDeEmpresa = (typeof ROLES_DE_EMPRESA)[number];

/**
 * El rol de una MEMBRESÍA: los tres base o `PROPIO` (un rol de la empresa, T4 de H4b). Una invitación solo trae los tres base (`RolDeEmpresa`); `PROPIO` aparece cuando el gerente
 * asigna un rol propio. El guard decide por el conjunto de acciones, no por este nombre: un `PROPIO` no está en la matriz de roles y, sin conjunto, no pasa (falla cerrado).
 */
export type RolDeLaMembresia = RolDeEmpresa | "PROPIO";

/** Los valores de `RolDeLaMembresia` (lo que admite `membresia_rol_ck` de la base); una prueba de integración lo compara con el CHECK. */
export const ROLES_DE_LA_MEMBRESIA = [...ROLES_DE_EMPRESA, "PROPIO"] as const;

/**
 * El rol tal como lo muestran HOY las pantallas: solo los tres base. Un rol propio llega a las pantallas con las pantallas de roles (T6, con su inventario de textos aprobado);
 * hasta entonces falla en voz alta en vez de mostrarse como otro rol. Previene: que una persona con rol propio aparezca como «Empleado» o «Administrador» en una lista.
 * Chequeo: `roles.test.ts`.
 */
export function rolParaMostrar(rol: RolDeLaMembresia): RolDeEmpresa {
  if (rol === "PROPIO") {
    throw new RangeError("el rol propio todavía no se muestra en las pantallas");
  }
  return rol;
}
