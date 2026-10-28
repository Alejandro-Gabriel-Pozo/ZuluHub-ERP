/**
 * El texto en castellano del motivo con que una empresa quedó en su estado. El motivo viene de la base (un código
 * del sistema, como `ALTA_VENCIDA`, o lo que escribió quien operó): un código desconocido NO se muestra crudo
 * (se dice de forma genérica); el texto escrito por una persona se muestra tal cual. Puro: sin Next ni React.
 */
const MOTIVOS_CONOCIDOS: Readonly<Record<string, string>> = {
  ALTA_VENCIDA: "El alta venció: pasaron 72 horas sin completarse.",
  ALTA_CANCELADA: "El alta fue cancelada.",
  REVOCADA_POR_PLATAFORMA: "La plataforma revocó el acceso.",
  mora: "Suspendida por mora.",
};

export const TEXTO_DE_MOTIVO_GENERICO = "Hay un motivo registrado para este estado.";

/** Un código del sistema se escribe EN_MAYUSCULAS_Y_GUION_BAJO; lo demás lo escribió una persona. */
const FORMA_DE_CODIGO = /^[A-Z][A-Z0-9_]*$/;

export function textoDelMotivoDeEstado(motivo: string): string {
  if (Object.hasOwn(MOTIVOS_CONOCIDOS, motivo)) {
    return MOTIVOS_CONOCIDOS[motivo] ?? TEXTO_DE_MOTIVO_GENERICO;
  }
  if (FORMA_DE_CODIGO.test(motivo) || motivo.trim() === "") return TEXTO_DE_MOTIVO_GENERICO;
  return motivo;
}
