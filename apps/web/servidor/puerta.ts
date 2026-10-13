import "server-only";

import { type EstadoDeLaResolucion } from "../../../src/capacidades/experiencia/puerta";
import { crearResolutorDePuerta } from "../../../src/capacidades/experiencia/resolutor";
import { entornoDelProceso, esProduccion } from "../../../src/composicion/entorno";
import { normalizarHost } from "../../../src/modulos/marcas/publico";
import { fuenteDePuertas, type FuenteDePuertas } from "./fuente-de-puertas";

/**
 * La puerta del servidor (armazón web §3.2, pasos 3 y 6): de un host a su marca y su superficie. La
 * llaman `proxy.ts` y, otra vez, cada página, acción y ruta: lo que dejó el proxy no se da por bueno.
 * Misma función y misma caché (≤ 60 s, acotada, por instancia, solo configuración PÚBLICA de marca), así
 * que repetirla no repite la consulta. El host se normaliza con la ÚNICA definición de `modulos/marcas`;
 * uno inválido es desconocido sin tocar la base.
 */
export function armarResolverDePuerta(
  fuente: FuenteDePuertas,
  ahora: () => number,
): (hostCrudo: string) => Promise<EstadoDeLaResolucion> {
  return crearResolutorDePuerta({
    consultarHost: fuente.consultarHost,
    leerMarca: fuente.leerMarca,
    normalizarHost: (crudo) => {
      const normalizado = normalizarHost(crudo);
      return normalizado.ok ? normalizado.valor : null;
    },
    ahora,
  });
}

export const resolverPuerta = armarResolverDePuerta(fuenteDePuertas, () => Date.now());

/** ¿Es el despliegue de producción? (`VERCEL_ENV`, leído solo por `src/composicion/entorno.ts`). */
export const despliegueEsProduccion = (): boolean => esProduccion(entornoDelProceso());
