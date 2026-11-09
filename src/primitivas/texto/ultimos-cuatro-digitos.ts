/**
 * FICHA DEL DATO: ÚLTIMOS 4 DÍGITOS DE LA TARJETA (decisión 129: «solo la marca y los últimos 4 dígitos»).
 *
 * - Qué es: los últimos cuatro dígitos de la tarjeta, para reconocer el pago. Opcional.
 * - Cómo se escribe: exactamente 4 dígitos. Es TEXTO, nunca número: `0042` se guarda `0042` (un entero perdería los ceros).
 * - Código de error: `ULTIMOS_CUATRO_DIGITOS_INVALIDOS`.
 */
import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

export type UltimosCuatroDigitos = Marca<string, "UltimosCuatroDigitos">;

const CUATRO_DIGITOS = /^[0-9]{4}$/;

export function ultimosCuatroDigitosDesdeTexto(
  texto: string,
): Resultado<UltimosCuatroDigitos, "ULTIMOS_CUATRO_DIGITOS_INVALIDOS"> {
  if (!CUATRO_DIGITOS.test(texto)) return err("ULTIMOS_CUATRO_DIGITOS_INVALIDOS");
  return ok(texto as UltimosCuatroDigitos);
}
