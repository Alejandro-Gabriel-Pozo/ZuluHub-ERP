/**
 * Un instante como texto ISO 8601 con su desfase de Argentina: `2026-11-25T21:14:05-03:00`. Argentina es UTC-3 todo el año (sin horario de verano, regla permanente del
 * proyecto, como `ZONA_DE_ARGENTINA`), así que alcanza con restar tres horas y rotular el desfase. Es para los archivos que salen del sistema (Excel), donde el instante
 * tiene que leerse igual en cualquier computadora. Sin reloj: el instante lo da quien llama.
 */
const TRES_HORAS_EN_MS = 3 * 60 * 60 * 1000;

export function instanteIsoEnArgentina(instante: Date): string {
  const t = instante.getTime();
  if (Number.isNaN(t)) throw new RangeError("instante: fecha inválida");
  return `${new Date(t - TRES_HORAS_EN_MS).toISOString().slice(0, 19)}-03:00`;
}
