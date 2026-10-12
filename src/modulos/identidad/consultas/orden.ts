/**
 * Orden estable de las listas (ADR-005): por código de carácter, que no depende del `locale` del
 * servidor ni de la versión de la base.
 */
export const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
