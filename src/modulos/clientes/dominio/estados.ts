/**
 * Los estados y las naturalezas de una parte del directorio (E9 §3.1; DDL de `clientes.md` Anexo C). Una parte es una persona (`HUMANA`) o una
 * empresa (`JURIDICA`); está `ACTIVA`, `INACTIVA` (se desactivó: se conserva y se puede reactivar) o `ANONIMIZADA` (estado que existe para que
 * agregarlo después no obligue a migrar; E9 no construye el caso de uso, S-3). La tabla de transiciones es la MISMA que impone el disparador
 * `parte_validar_cambio` de la base: una prueba de integración las compara.
 */
export const NATURALEZAS_DE_PARTE = ["HUMANA", "JURIDICA"] as const;
export type NaturalezaDeParte = (typeof NATURALEZAS_DE_PARTE)[number];

export const ESTADOS_DE_PARTE = ["ACTIVA", "INACTIVA", "ANONIMIZADA"] as const;
export type EstadoDeParte = (typeof ESTADOS_DE_PARTE)[number];

/** Lo único permitido: de cada estado, a cuáles puede pasar. Lo que no figura no se puede (una anonimizada no cambia nunca más). */
export const TRANSICIONES_DE_PARTE: Readonly<Record<EstadoDeParte, readonly EstadoDeParte[]>> = {
  ACTIVA: ["INACTIVA", "ANONIMIZADA"],
  INACTIVA: ["ACTIVA", "ANONIMIZADA"],
  ANONIMIZADA: [],
};

export function transicionDePartePermitida(desde: EstadoDeParte, hacia: EstadoDeParte): boolean {
  return TRANSICIONES_DE_PARTE[desde].includes(hacia);
}

export function esNaturalezaDeParte(texto: string): texto is NaturalezaDeParte {
  return (NATURALEZAS_DE_PARTE as readonly string[]).includes(texto);
}
