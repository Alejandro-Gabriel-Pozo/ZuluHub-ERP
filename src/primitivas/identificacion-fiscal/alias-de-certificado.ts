/**
 * FICHA DEL DATO: ALIAS DE CERTIFICADO. Vive acá (una regla, un lugar): el dominio fiscal y la pantalla del pedido la importan; la base la repite con su CHECK.
 *
 * - Qué es: el nombre corto con el que se identifica un certificado de ARCA (el `CN` del pedido).
 * - Cómo se escribe: letras y dígitos ASCII, de 1 a `LARGO_MAXIMO_DEL_ALIAS_DE_CERTIFICADO` (30). Es la regla de la base (`certificado_alias_ck`);
 *   estaba escrita en `modulos/fiscal/dominio/certificado-pedido.ts` y se movió sin cambiar el valor.
 */
export const LARGO_MAXIMO_DEL_ALIAS_DE_CERTIFICADO = 30;

const FORMATO = new RegExp(`^[A-Za-z0-9]{1,${String(LARGO_MAXIMO_DEL_ALIAS_DE_CERTIFICADO)}}$`);

export function esAliasDeCertificado(texto: string): boolean {
  return FORMATO.test(texto);
}
