export type PropsDeEstiloDeMarca = Readonly<{
  /** El CSS del tema (`cssDeTema`): solo `:root{--brand-*:#rrggbb}`. Vacío: no se pinta nada. */
  css: string;
  /** El nonce del pedido; sin él la CSP bloquearía el estilo, así que tampoco se pinta. */
  nonce: string | null;
}>;

/**
 * El tema de la marca como un `<style nonce>` del servidor ([01] §4 «tema seguro»). El texto sale de
 * `cssDeTema`, que solo escribe colores validados: acá no se arma ni se interpola nada.
 */
export function EstiloDeMarca({ css, nonce }: PropsDeEstiloDeMarca) {
  if (css === "" || nonce === null) return null;
  return <style nonce={nonce}>{css}</style>;
}
