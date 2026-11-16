/**
 * Caras de la carta (identidad de la carta, C6): el aspecto general de una carta, elegido por el gerente. Lista CERRADA de la plataforma, escrita acá una sola vez:
 * `DIA` es «Pastelería de día» (la que rige si la carta no eligió ninguna), `BOLICHE` es «Cartel de boliche» y `NOCHE` es «Noche». La base copia las tres claves en
 * `carta_publica_cara_ck` (0077) y una prueba falla si difieren. Los nombres que ve la persona no viven acá (son de la pantalla).
 */
export const CARAS_DE_VIDRIERA = ["DIA", "BOLICHE", "NOCHE"] as const;

export type CaraDeVidriera = (typeof CARAS_DE_VIDRIERA)[number];

/** La cara de una carta que no eligió ninguna. */
export const CARA_POR_DEFECTO: CaraDeVidriera = "DIA";

/** Estrecha un texto (de la base o de un pedido) a una cara del catálogo. */
export function esCaraDeVidriera(valor: unknown): valor is CaraDeVidriera {
  return typeof valor === "string" && (CARAS_DE_VIDRIERA as readonly string[]).includes(valor);
}
