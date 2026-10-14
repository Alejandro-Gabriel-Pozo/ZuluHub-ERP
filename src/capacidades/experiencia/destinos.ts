/**
 * Los destinos de la barra inferior del mostrador: SIEMPRE de 3 a 5 ([01] §7). `Inicio` y `Cuenta` están
 * siempre; los módulos habilitados suman los suyos (hasta 3) entre los dos; mientras no haya ninguno, el
 * tercer lugar es `Empresa` (cambiar de empresa), que igual vive en la barra superior. Previene: una barra con
 * 1 o 2 destinos (la plantilla no la admite) o con 6 (no entra en el celular). Genérica en el destino: la
 * interfaz pone el ícono y el texto. Chequeo: `destinos.test.ts`.
 */
export const MAXIMO_DE_DESTINOS_DE_MODULOS = 3;

export function destinosDeOperacion<D>(partes: {
  inicio: D;
  empresa: D;
  cuenta: D;
  modulos: readonly D[];
}): readonly D[] {
  const deModulos = partes.modulos.slice(0, MAXIMO_DE_DESTINOS_DE_MODULOS);
  return deModulos.length === 0
    ? [partes.inicio, partes.empresa, partes.cuenta]
    : [partes.inicio, ...deModulos, partes.cuenta];
}
