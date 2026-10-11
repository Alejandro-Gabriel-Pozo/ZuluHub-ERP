/**
 * Errores tipados de las primitivas numéricas y de dinero (caso 0b). Un valor inválido nunca se
 * corrige en silencio: se rechaza con un código que el llamador traduce a un error de negocio.
 */
export type CodigoDeErrorDeValor =
  | "MONEDA_NO_SOPORTADA"
  | "MONEDA_DISTINTA"
  | "DECIMALES_DE_MAS"
  | "FORMATO_INVALIDO"
  | "FUERA_DE_RANGO"
  | "PESOS_INVALIDOS";

export class ErrorDeValor extends Error {
  readonly codigo: CodigoDeErrorDeValor;

  constructor(codigo: CodigoDeErrorDeValor, detalle: string) {
    super(`${codigo}: ${detalle}`);
    this.name = "ErrorDeValor";
    this.codigo = codigo;
  }
}
