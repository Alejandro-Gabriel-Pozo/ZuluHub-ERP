import type { PisosDeAcciones, TipoDePiso } from "./pisos";

/**
 * IMPACTO DE CAMBIAR UN PISO (H4b Q3, I5): cuando la plataforma endurece un piso, a los roles y plantillas que ya lo contradicen se les
 * ajusta el conjunto, con aviso y auditoría; antes de confirmar la plataforma ve a quiénes alcanza. Este archivo solo CALCULA: no
 * escribe nada. Puro.
 *
 *  - `SOLO_GERENTE`: se QUITA la acción a todo destino que la tiene.
 *  - `TODOS_LOS_ROLES`: se SUMA la acción a todo destino que no la tiene (SUPUESTO, DEC-0950: un piso «de todos» tiene que valer también para lo ya
 *    creado; sin esto la base rechazaría la próxima versión de cada rol. Se corrige en este archivo).
 *  - Sin piso (`null`): no se toca nada; quien tenía la acción la conserva.
 * Si baja el PLAN no se quita nada (el guard la deja sin efecto): eso no pasa por acá.
 *
 * Previene: endurecer un piso y dejar roles que la base ya no deja guardar, o que la plataforma cambie un piso sin saber a cuántas
 * empresas afecta. Chequeo: `impacto-de-piso.test.ts` y `impacto-de-piso.propiedades.test.ts`.
 */
export type DestinoDelPiso = Readonly<{
  /** `null` para una plantilla (es de la plataforma). */
  empresaId: string | null;
  /** El rol propio o la plantilla (su clave), para mostrarlo. */
  id: string;
  acciones: readonly string[];
}>;

export type CambioPorPiso = Readonly<{
  empresaId: string | null;
  id: string;
  cambio: "QUITA" | "SUMA";
  /** El conjunto que queda tras el cambio, ordenado. */
  accionesNuevas: readonly string[];
}>;

export type ImpactoDelPiso = Readonly<{
  cambios: readonly CambioPorPiso[];
  /** Cuántas empresas distintas alcanza (las plantillas, que no son de una empresa, no cuentan). */
  empresasAfectadas: number;
}>;

/** El conjunto de un destino una vez aplicado el piso nuevo de la acción (idéntico si no hay nada que ajustar). */
export function accionesTrasElPiso(
  acciones: readonly string[],
  accion: string,
  tipo: TipoDePiso | null,
): readonly string[] {
  if (tipo === "SOLO_GERENTE") return acciones.filter((a) => a !== accion).sort();
  if (tipo === "TODOS_LOS_ROLES" && !acciones.includes(accion)) return [...acciones, accion].sort();
  return acciones;
}

export function impactoDeCambiarPiso(
  accion: string,
  pisoNuevo: TipoDePiso | null,
  destinos: readonly DestinoDelPiso[],
): ImpactoDelPiso {
  const cambios: CambioPorPiso[] = [];
  for (const destino of destinos) {
    const nuevas = accionesTrasElPiso(destino.acciones, accion, pisoNuevo);
    if (nuevas.length === destino.acciones.length) continue;
    cambios.push({
      empresaId: destino.empresaId,
      id: destino.id,
      cambio: pisoNuevo === "SOLO_GERENTE" ? "QUITA" : "SUMA",
      accionesNuevas: nuevas,
    });
  }
  const empresas = new Set(cambios.map((c) => c.empresaId).filter((e): e is string => e !== null));
  return { cambios, empresasAfectadas: empresas.size };
}

/** Un piso nuevo sobre el conjunto de pisos vigente (para validar la versión siguiente con lo que va a valer). */
export function conPisoNuevo(
  pisos: PisosDeAcciones,
  accion: string,
  tipo: TipoDePiso | null,
): PisosDeAcciones {
  const resto = Object.fromEntries(Object.entries(pisos).filter(([a]) => a !== accion));
  return tipo === null ? resto : { ...resto, [accion]: tipo };
}
