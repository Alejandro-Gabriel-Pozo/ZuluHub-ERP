import { fechaCivilDesdeTexto, type FechaCivil } from "./fecha-civil";

/**
 * LA FECHA QUE VE EL CLIENTE: «15/11/2026» (DD/MM/AAAA, decisión del dueño, `decisiones-del-dueno-2026-11.md` fila 178). UN solo formateador de fecha civil:
 * AAAA-MM-DD queda para datos internos y entre sistemas, nunca en pantalla ni en papel.
 * Solo recibe una `FechaCivil` ya validada, no texto suelto: una pantalla que tiene un `string` crudo pasa antes por `fechaCivilDesdeTexto` y maneja el error,
 * así no puede mostrar «2026-11-15» por error (el formateador viejo de la web devolvía el texto tal cual si no era una fecha: falla abierta). Si igual llega una
 * que no lo es (un tipo forzado), FALLA CERRADA: lanza, no muestra nada a medias. Sin `Date`: parte el texto ya validado en año, mes y día, así no hay zona
 * horaria ni del proceso ni del navegador que la corra un día. Día y mes con 2 dígitos y año con 4 (`05/03/2026`). Puro: sin reloj, sin azar, sin I/O.
 * Previene: el papel del ticket que salió con la fecha cruda de la base. Chequeo: `fecha-para-mostrar.test.ts` (ejemplos, propiedad 1900–2100, la misma salida
 * con la zona del proceso en UTC, Buenos Aires, Los Ángeles y +14, y los bordes de la medianoche argentina).
 */
export function fechaParaMostrar(fecha: FechaCivil): string {
  if (!fechaCivilDesdeTexto(fecha).ok) {
    throw new RangeError("fechaParaMostrar: no es una fecha civil válida");
  }
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio}`;
}
