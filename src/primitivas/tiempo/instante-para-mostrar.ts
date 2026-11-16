import { fechaCivilDesdeTexto } from "./fecha-civil";
import { ZONA_DE_ARGENTINA } from "./fecha-civil-hasta-hoy";
import { fechaParaMostrar } from "./fecha-para-mostrar";

/**
 * EL INSTANTE QUE VE EL CLIENTE: «09/11/2026 22:09» (fecha DD/MM/AAAA de `fechaParaMostrar`, decisión del dueño, `decisiones-del-dueno-2026-11.md` fila 178, y hora de
 * 24 h con minutos, como en la maqueta aceptada `cierre-del-dia.html`: «quién y cuándo»). El instante se lleva a la hora de pared de la zona pedida (por defecto la de
 * Argentina, UTC-3), nunca a la del proceso ni a la del navegador: el mismo instante sale igual en cualquier máquina. Falla CERRADA: un instante inválido o una zona que
 * `Intl` no conoce lanzan (`RangeError` del propio `Intl`), no muestran una hora supuesta. Puro: sin reloj, sin azar, sin I/O.
 * Previene: «quién cerró y cuándo» con la hora UTC del servidor (tres horas corrida) o con la zona de quien corre la prueba. Chequeo: `instante-para-mostrar.test.ts`.
 */
export function instanteParaMostrar(instante: Date, zona: string = ZONA_DE_ARGENTINA): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante);
  const de = (tipo: Intl.DateTimeFormatPartTypes): string => {
    const parte = partes.find((p) => p.type === tipo);
    // Stryker disable next-line ConditionalExpression,StringLiteral,CallExpression: `Intl` entrega siempre las seis partes pedidas; la guarda solo estrecha el tipo y falla cerrada si algún motor dejara de hacerlo.
    if (parte === undefined) throw new RangeError(`instanteParaMostrar: falta ${tipo}`);
    return parte.value;
  };
  const fecha = fechaCivilDesdeTexto(`${de("year")}-${de("month")}-${de("day")}`);
  // Stryker disable next-line ConditionalExpression,StringLiteral,CallExpression: año, mes y día salen de `Intl` y son siempre una fecha de calendario; la guarda solo estrecha el tipo.
  if (!fecha.ok) throw new RangeError("instanteParaMostrar: la fecha no es válida");
  return `${fechaParaMostrar(fecha.valor)} ${de("hour")}:${de("minute")}`;
}
