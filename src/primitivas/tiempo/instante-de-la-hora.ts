import { err, ok, type Resultado } from "../resultado/resultado";
import {
  formateadorDeZona,
  INSTANTE_MAXIMO,
  INSTANTE_MINIMO,
  numerosPorTipo,
} from "./fecha-de-negocio";
import { horaDelDiaDesdeTexto, minutosDelDia } from "./hora-del-dia";

/**
 * El instante de una HORA DE PARED: de «14:30» (lo que escribe quien cuenta en el depósito) al instante real, el MÁS RECIENTE que ya pasó en la zona de la sucursal. Si la hora de hoy todavía no llegó, es la
 * de ayer (el conteo se hizo antes de la medianoche y se carga después). Siempre es `<= ahora` y a menos de 24 horas de él, o sea cae en la jornada vigente o en la anterior; la ventana exacta y que no
 * sea anterior al último conteo la vuelve a decidir el servidor. La zona de Argentina es UTC-3 todo el año (sin horario de verano), pero la cuenta es general: cada instante se lleva a la hora de pared de SU
 * zona y el desfase se mide en el instante resultante. Valor puro: `ahora` entra por parámetro (nunca se lee el reloj), sin azar ni I/O, y los segundos de `ahora` cuentan (las 14:30:20 ya pasaron las 14:30).
 * Previene: la hora de pared leída en UTC (un conteo cargado de noche que quedaba en el futuro) y el corte de día mal cruzado.
 */
export type ErrorDeInstanteDeLaHora =
  "HORA_DEL_DIA_INVALIDA" | "ZONA_HORARIA_INVALIDA" | "INSTANTE_INVALIDO";

const MINUTO_EN_MS = 60_000;
const DIA_EN_MS = 24 * 60 * MINUTO_EN_MS;

/** El desfase de la zona en ese instante: hora de pared − instante, en ms (los segundos y milisegundos del instante se descartan de los dos lados). */
function desfaseDe(formateador: Intl.DateTimeFormat, instante: number): number {
  const p = numerosPorTipo(formateador, new Date(instante));
  const pared = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return pared - Math.floor(instante / MINUTO_EN_MS) * MINUTO_EN_MS;
}

export function instanteDeLaHora(
  hora: string,
  zonaHoraria: string,
  ahora: Date,
): Resultado<Date, ErrorDeInstanteDeLaHora> {
  const horaDelDia = horaDelDiaDesdeTexto(hora);
  if (!horaDelDia.ok) return err("HORA_DEL_DIA_INVALIDA");
  const formateador = formateadorDeZona(zonaHoraria);
  if (formateador === null) return err("ZONA_HORARIA_INVALIDA");
  const ms = ahora.getTime();
  if (!(ms >= INSTANTE_MINIMO + DIA_EN_MS && ms <= INSTANTE_MAXIMO))
    return err("INSTANTE_INVALIDO");

  // El día civil de la zona en `ahora` con la hora pedida, como hora de pared sin zona.
  const hoy = numerosPorTipo(formateador, ahora);
  const minutos = minutosDelDia(horaDelDia.valor);
  const paredDeHoy = Date.UTC(hoy.year, hoy.month - 1, hoy.day) + minutos * MINUTO_EN_MS;
  // Del hora de pared al instante: se resta el desfase medido en el instante candidato (dos pasadas: el de `ahora` y el del candidato).
  const aproximado = paredDeHoy - desfaseDe(formateador, ms);
  const candidato = paredDeHoy - desfaseDe(formateador, aproximado);
  // Si todavía no llegó esa hora hoy, es la de ayer (un día civil menos, medido otra vez por si cambió el desfase).
  if (candidato <= ms) return ok(new Date(candidato));
  const paredDeAyer = paredDeHoy - DIA_EN_MS;
  const aproximadoDeAyer = paredDeAyer - desfaseDe(formateador, candidato - DIA_EN_MS);
  return ok(new Date(paredDeAyer - desfaseDe(formateador, aproximadoDeAyer)));
}
