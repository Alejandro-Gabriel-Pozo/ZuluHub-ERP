import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { explicacionDesdeTexto } from "../../cierre/publico";

/**
 * FICHA DEL DATO: MOTIVO DE UNA ANULACIÓN (decisión 155: «con todo auditado, quién, cuándo y por qué»; E4 §3.4 y §3.8). Obligatorio, de 1
 * a 500 caracteres de la lista de permitidos de la explicación del cierre (una sola lista, la de `cierre/dominio/explicacion.ts`; la base
 * la repite en `cuenta_motivo_ck`, `linea_motivo_ck` y `correccion_motivo_ck`). En pantalla se limita a 200; el servidor admite 500.
 * Códigos: `MOTIVO_OBLIGATORIO` (vacío o ausente) y `MOTIVO_INVALIDO` (largo o caracteres fuera de la lista).
 */
export type ErrorDeMotivo = "MOTIVO_OBLIGATORIO" | "MOTIVO_INVALIDO";

export function motivoDeAnulacion(
  texto: string | null | undefined,
): Resultado<string, ErrorDeMotivo> {
  const explicacion = explicacionDesdeTexto(texto);
  if (!explicacion.ok) return err("MOTIVO_INVALIDO");
  return explicacion.valor === null ? err("MOTIVO_OBLIGATORIO") : ok(explicacion.valor);
}
