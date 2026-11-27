import { accionesObligatorias, type PisosDeAcciones } from "./pisos";

/**
 * LAS ACCIONES CON LAS QUE NACE UN ROL PROPIO (H4b I6): un rol nuevo arranca con solo los pisos `TODOS_LOS_ROLES` (vacío) o con una
 * COPIA de lo que se eligió como punto de partida (una plantilla u otro rol), y desde ahí es independiente (S9). Una acción nueva del
 * catálogo no llega sola a ningún rol. De la copia se descarta lo que el rol no puede llevar hoy (módulo fuera del plan o piso
 * `SOLO_GERENTE`) y se suman los obligatorios, así el resultado ya cumple lo que pide `validarConjuntoDeAcciones`.
 *
 * Previene: que un rol propio nazca con permisos de más (copiar una plantilla sin respetar el plan de la empresa) o sin los pisos
 * obligatorios (no se podría guardar). Chequeo: `acciones-iniciales.test.ts`.
 */
export type ContextoDeAccionesIniciales = Readonly<{
  moduloDeLaAccion: (accion: string) => string | null;
  modulosDelPlan: ReadonlySet<string>;
  pisos: PisosDeAcciones;
}>;

/** `origen`: lo que se copia (una plantilla u otro rol); `[]` = de cero. */
export function accionesIniciales(
  origen: readonly string[],
  contexto: ContextoDeAccionesIniciales,
): readonly string[] {
  const elegidas = origen.filter((accion) => {
    const modulo = contexto.moduloDeLaAccion(accion);
    return (
      modulo !== null &&
      contexto.modulosDelPlan.has(modulo) &&
      contexto.pisos[accion] !== "SOLO_GERENTE"
    );
  });
  return [...new Set([...elegidas, ...accionesObligatorias(contexto.pisos)])].sort();
}
