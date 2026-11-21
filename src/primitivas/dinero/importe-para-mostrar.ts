import { err, ok, type Resultado } from "../resultado/resultado";
import { FORMA_DEL_IMPORTE } from "./forma-del-importe";

/**
 * UN IMPORTE COMO LO LEE UNA PERSONA EN ARGENTINA, SIN SÍMBOLO (el papel del ticket; maqueta de venta rápida: «3.000,00»). Entra el texto decimal canónico
 * («3000.00», «1500.5», «5») y sale con miles con punto y SIEMPRE dos decimales con coma («3.000,00», «1.500,50», «5,00»). Solo texto a texto: sin `Number`, `Intl`
 * ni `toLocaleString` (un importe nunca pasa por coma flotante). Declara lo permitido (`FORMA_DEL_IMPORTE`: dígitos, hasta 9 enteros y hasta 2 decimales, sin signo);
 * cualquier otra cosa es `IMPORTE_NO_MOSTRABLE` y quien llama no saca papel a medias.
 * Previene: un importe del papel escrito como lo guarda la base («3000.00») cuando la maqueta aprobada lo muestra «3.000,00».
 */
export type ErrorDeImporteParaMostrar = "IMPORTE_NO_MOSTRABLE";

export function importeParaMostrar(texto: string): Resultado<string, ErrorDeImporteParaMostrar> {
  if (!FORMA_DEL_IMPORTE.test(texto)) return err("IMPORTE_NO_MOSTRABLE");
  const punto = texto.indexOf(".");
  const enteros = punto === -1 ? texto : texto.slice(0, punto);
  const decimales = punto === -1 ? "" : texto.slice(punto + 1);
  const conMiles = enteros.replace(/\B(?=(\d{3})+$)/g, ".");
  return ok(`${conMiles},${decimales.padEnd(2, "0")}`);
}
