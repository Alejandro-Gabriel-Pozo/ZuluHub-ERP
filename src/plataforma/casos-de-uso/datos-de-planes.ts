import type { ValorDePerilla } from "../../capacidades/planes/valores";
import type { ContenidoDeVersionDePlanGuardable } from "../../modulos/planes/publico";
import type { Dato } from "../../puertos/sin-secretos";

/**
 * Cómo se ven los planes en la auditoría y en la huella de la clave de idempotencia (M5). Las perillas
 * van como LISTA de `{ perilla, tipo, encendida, limite }` y nunca como un objeto cuyos campos sean los
 * nombres de las perillas: el nombre de un campo de auditoría no puede parecer un secreto
 * (`exigirSinSecretos`) y el de una perilla lo decide cada módulo.
 */

/** Un valor de perilla como dato plano: el interruptor trae `encendida`; el límite, `limite`. */
export function datosDelValorDePerilla(valor: ValorDePerilla): Record<string, Dato> {
  return valor.tipo === "INTERRUPTOR"
    ? { tipo: valor.tipo, encendida: valor.encendida, limite: null }
    : { tipo: valor.tipo, encendida: null, limite: valor.limite };
}

/** Las perillas de una versión, ordenadas por nombre, como lista de pares. */
export function listaDePerillas(
  perillas: Readonly<Record<string, ValorDePerilla>>,
): readonly Record<string, Dato>[] {
  return Object.keys(perillas)
    .sort()
    .map((perilla) => ({
      perilla,
      ...datosDelValorDePerilla(perillas[perilla] as ValorDePerilla),
    }));
}

/** El contenido de una versión de plan: nombre comercial, módulos incluidos y perillas. */
export function datosDelContenidoDeLaVersion(
  contenido: ContenidoDeVersionDePlanGuardable,
): Record<string, Dato> {
  return {
    nombreComercial: contenido.nombreComercial,
    modulos: [...contenido.modulos],
    perillas: listaDePerillas(contenido.perillas),
  };
}
