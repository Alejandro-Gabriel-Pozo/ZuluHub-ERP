import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { fechaDeNegocio, type ErrorDeJornada } from "../../../primitivas/tiempo/fecha-de-negocio";

/**
 * La jornada vencida (e3 §3.4): una sesión que sigue abierta al día siguiente SIGUE cobrando en su jornada (decisión de diseño F1);
 * para que la pantalla pueda avisar, el puerto devuelve `jornadaVencida`: la fecha de negocio de AHORA, con el sello de la sesión
 * (zona y hora de corte con que se abrió), es posterior a la fecha de la sesión. La fórmula de la fecha es `fechaDeNegocio` de
 * `primitivas/tiempo` (una sola, la misma que la base). `ahora` entra como dato.
 */
export function jornadaVencida(
  ahora: Date,
  sello: Readonly<{ zonaHoraria: string; horaDeCorte: string }>,
  fechaDeLaSesion: FechaCivil,
): Resultado<boolean, ErrorDeJornada> {
  const hoy = fechaDeNegocio(ahora, sello.zonaHoraria, sello.horaDeCorte);
  if (!hoy.ok) return err(hoy.error);
  // `YYYY-MM-DD` ordena como texto igual que como fecha.
  return ok(hoy.valor > fechaDeLaSesion);
}
