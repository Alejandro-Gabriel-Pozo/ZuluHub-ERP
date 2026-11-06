import type { ErrorAlEmitir } from "../modulos/fiscal/publico";

/**
 * El campo del formulario al que se asocia cada error del receptor de un comprobante (dueño, 2026-11-06, Q21: la pantalla marca el campo que
 * el servidor rechazó). Los errores con `campo` propio lo traen; los otros tres (la A sin CUIT, el receptor igual al emisor y el sujeto no
 * categorizado en B) caen en el campo que hay que corregir. Previene que la pantalla vuelva a mostrar un aviso sin decir qué corregir y que un
 * error nuevo del receptor quede sin campo: la tabla es exhaustiva sobre los errores del receptor, así que uno nuevo NO COMPILA hasta que se la completa.
 * Chequeo: `errores-fiscales.test.ts` y el recorrido de Emitir.
 */
type CodigoDelReceptor = Extract<
  ErrorAlEmitir,
  Readonly<{ codigo: `RECEPTOR_${string}` }>
>["codigo"];

const CAMPO_DEL_ERROR: Readonly<
  Record<CodigoDelReceptor, (error: Readonly<Record<string, unknown>>) => string>
> = {
  RECEPTOR_INVALIDO: (error) =>
    typeof error["campo"] === "string" ? `receptor.${error["campo"]}` : "receptor",
  RECEPTOR_INVALIDO_PARA_A: () => "receptor.documento",
  RECEPTOR_IGUAL_AL_EMISOR: () => "receptor.documento",
  RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO: () => "receptor.condicionIva",
};

const esDelReceptor = (codigo: unknown): codigo is CodigoDelReceptor =>
  typeof codigo === "string" && Object.hasOwn(CAMPO_DEL_ERROR, codigo);

export function campoDelReceptor(error: Readonly<Record<string, unknown>>): string | undefined {
  const codigo = error["codigo"];
  return esDelReceptor(codigo) ? CAMPO_DEL_ERROR[codigo](error) : undefined;
}
