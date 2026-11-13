import { err, ok, type Resultado } from "../resultado/resultado";
import { fechaCivilDesdeTexto, type ErrorDeFechaCivil } from "./fecha-civil";
import { hoyEnArgentina } from "./fecha-civil-hasta-hoy";

/**
 * FICHA DEL DATO: «VIGENTE DESDE» DE UN CAMBIO CON FECHA (clasificación comercial del producto; decisión 60 y maqueta aprobada `clasificacion.html`, supuestos S8 y S9: rige
 * desde hoy o desde una fecha futura, nunca desde una pasada; por defecto, hoy). Una fecha pasada tocaría la historia del producto y lo ya vendido: se rechaza (es una pregunta al
 * dueño si algún día se quiere permitir). Sin fecha o con la de hoy en Argentina, rige DESDE AHORA (el instante del pedido: el cambio vale enseguida, y dos cambios del mismo día
 * se ordenan por su instante); con una fecha futura, desde la medianoche de Argentina de ese día. «Hoy» es el de Argentina (regla permanente del proyecto; sin horario de verano,
 * UTC-3). Techo: `FECHA_CIVIL_MAXIMA` (31/12/2100: SUPUESTO (DEC-0354) del ingeniero, no tiene fuente; sin tope, cualquier año de cuatro cifras entraría y una fecha mal tipeada dejaría un
 * cambio que nunca rige; se cambia con una constante). Puro: el reloj entra como parámetro.
 */
export const FECHA_CIVIL_MAXIMA = "2100-12-31";

/** Argentina no tiene horario de verano: la medianoche local es siempre las 03:00 UTC. */
const HORAS_DE_ARGENTINA_DETRAS_DE_UTC = 3;

export type ErrorDeVigenteDesde =
  ErrorDeFechaCivil | "FECHA_PASADA" | "FECHA_FUERA_DE_RANGO" | "RELOJ_INVALIDO";

export function vigenteDesdeDesdeTexto(
  texto: string | null,
  ahora: Date,
): Resultado<Date, ErrorDeVigenteDesde> {
  const hoy = hoyEnArgentina(ahora);
  if (!hoy.ok) return err("RELOJ_INVALIDO");
  if (texto === null) return ok(ahora);
  const fecha = fechaCivilDesdeTexto(texto);
  if (!fecha.ok) return fecha;
  // Las fechas son `YYYY-MM-DD` de ancho fijo: el orden del texto es el orden del calendario.
  if (fecha.valor < hoy.valor) return err("FECHA_PASADA");
  if (fecha.valor > FECHA_CIVIL_MAXIMA) return err("FECHA_FUERA_DE_RANGO");
  if (fecha.valor === hoy.valor) return ok(ahora);
  const [anio, mes, dia] = fecha.valor.split("-").map(Number) as [number, number, number];
  return ok(new Date(Date.UTC(anio, mes - 1, dia, HORAS_DE_ARGENTINA_DETRAS_DE_UTC)));
}
