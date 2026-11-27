/**
 * PISOS DE LA PLATAFORMA (H4b §3.2, I5): lo que ninguna empresa puede aflojar. Son DATOS que llegan por parámetro (la tabla
 * `piso_de_plataforma`); este archivo solo fija su forma y las dos preguntas que se les hacen. Puro: sin base, sin reloj ni azar.
 *
 *  - `SOLO_GERENTE`: solo el rol gerente puede tener la acción; ninguna plantilla ni rol propio la lleva.
 *  - `TODOS_LOS_ROLES`: todo rol la lleva sí o sí.
 *  - Una acción sin piso es libre de asignar dentro del plan.
 *
 * Previene: que la regla «la empresa no baja un piso» se escriba en dos lugares (el validador de un rol y el de una plantilla):
 * viven acá, una vez. Chequeo: `pisos.test.ts`.
 */
export const TIPOS_DE_PISO = ["SOLO_GERENTE", "TODOS_LOS_ROLES"] as const;

export type TipoDePiso = (typeof TIPOS_DE_PISO)[number];

/** Un piso por acción; la acción que no figura no tiene piso. */
export type PisosDeAcciones = Readonly<Record<string, TipoDePiso>>;

/** Las acciones con el piso `tipo`, ordenadas (el orden hace comparables dos corridas). */
export function accionesConPiso(pisos: PisosDeAcciones, tipo: TipoDePiso): readonly string[] {
  return Object.keys(pisos)
    .filter((accion) => pisos[accion] === tipo)
    .sort();
}

/** Las acciones que todo rol lleva (el punto de partida de un rol que nace cerrado, I6). */
export function accionesObligatorias(pisos: PisosDeAcciones): readonly string[] {
  return accionesConPiso(pisos, "TODOS_LOS_ROLES");
}

/** Las acciones que solo tiene el gerente (nadie más puede llevarlas). */
export function accionesReservadasAlGerente(pisos: PisosDeAcciones): readonly string[] {
  return accionesConPiso(pisos, "SOLO_GERENTE");
}
