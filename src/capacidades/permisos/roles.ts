/**
 * Roles de una persona dentro de una empresa. Son datos, no lógica: la lista cierra el tipo
 * `RolDeEmpresa`, y qué puede hacer cada rol vive aparte (`empresa.ts`), que el guard recibe como
 * parámetro. En v1 son fijos para todas las empresas (decisión 18). Una prueba de integración
 * comprueba que esta lista es exactamente la de los CHECK `membresia_rol_ck` e
 * `invitacion_empresa_rol_ck` de la base.
 */
export const ROLES_DE_EMPRESA = ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const;

export type RolDeEmpresa = (typeof ROLES_DE_EMPRESA)[number];
