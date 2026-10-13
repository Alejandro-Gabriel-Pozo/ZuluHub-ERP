/**
 * El tema de una marca como CSS (marcas y planes §B.3; experiencia §4 «tema seguro»). Lo que entra ya
 * pasó por `validarTema` de `modulos/marcas` al guardar la versión; acá es el cinturón y los tirantes:
 * solo se escriben las cuatro variables `--brand-*` de la lista cerrada y solo con un valor `#rrggbb`
 * en minúsculas. Nada de lo que venga de afuera se interpola como texto libre: una clave ajena o un
 * valor raro no se escriben (rige el neutro de `tokens.css`) y no hay forma de cerrar la regla ni de
 * abrir otra. La prueba de `test/web` compara esta lista con `TOKENS_DE_TEMA` del dominio.
 */
export const VARIABLES_DE_MARCA = ["primary", "on-primary", "secondary", "accent"] as const;

const COLOR = /^#[0-9a-f]{6}$/;

/** `:root{--brand-primary:#…;…}` con los tokens válidos presentes, o vacío si no hay ninguno. */
export function cssDeTema(tema: Readonly<Record<string, string>>): string {
  const declaraciones = VARIABLES_DE_MARCA.flatMap((token) => {
    const valor = Object.hasOwn(tema, token) ? tema[token] : undefined;
    return valor !== undefined && COLOR.test(valor) ? [`--brand-${token}:${valor}`] : [];
  });
  return declaraciones.length === 0 ? "" : `:root{${declaraciones.join(";")}}`;
}
