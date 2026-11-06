/**
 * El campo del formulario al que se asocia cada error del receptor de un comprobante (dueño, 2026-11-06, Q21: la pantalla marca el campo que
 * el servidor rechazó). Los errores con `campo` propio lo traen; los otros tres (la A sin CUIT, el receptor igual al emisor y el sujeto no
 * categorizado en B) caen en el campo que hay que corregir. Previene que la pantalla vuelva a mostrar un aviso sin decir qué corregir.
 * Chequeo: `errores-fiscales.test.ts` y el recorrido de Emitir.
 */
export function campoDelReceptor(error: Readonly<Record<string, unknown>>): string | undefined {
  switch (error["codigo"]) {
    case "RECEPTOR_INVALIDO":
      return typeof error["campo"] === "string" ? `receptor.${error["campo"]}` : "receptor";
    case "RECEPTOR_INVALIDO_PARA_A":
    case "RECEPTOR_IGUAL_AL_EMISOR":
      return "receptor.documento";
    case "RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO":
      return "receptor.condicionIva";
    default:
      return undefined;
  }
}
