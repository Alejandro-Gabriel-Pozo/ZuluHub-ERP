import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): La base común de las ofertas de botones: lee los permisos de la persona una vez por pedido (la única llamada a permisosDelActor de servidor/) y decide si una acción se ofrece y con qué motivo.
 */
import { cache } from "react";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import {
  CATALOGO_DE_MODULOS,
  type ClaveAccion,
  type ClaveModulo,
  type EstadoDeConstruccion,
} from "../../../src/capacidades/modulos/catalogo";
import type { ClaveDeTexto } from "../../../src/capacidades/vocabulario/catalogo";
import { web } from "./composicion";
import type { OfertaDeAccion } from "../ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta";

/**
 * Los permisos de la persona, o `null` si no se pudieron leer (un rechazo o una excepción): la barra y el botón de anular no abren
 * nada por las dudas. Una excepción no se traga en silencio: queda en el registro del servidor, con el mismo formato que los demás
 * (`[etiqueta] qué falló (Tipo)`), SOLO el tipo de la falla, nunca su texto (puede traer datos de la base). Previene: que una base
 * caída deje la barra vacía sin que nadie lo vea. Chequeo: `test/web/modulos-de-la-barra.test.ts`.
 *
 * Con `cache` de React se lee UNA vez por pedido: la barra y los botones de la página comparten el mismo `contexto` (la misma
 * referencia), así que la segunda llamada no vuelve a abrir una transacción. Previene: dos lecturas de los permisos por pantalla.
 * Se define UNA sola vez, acá: `test/arquitectura/ofertas-por-modulo.test.ts` falla si otro archivo de `servidor/` llama a `permisosDelActor`.
 */
export const permisosDeLaPersona = cache(async (contexto: ContextoOperativo) => {
  try {
    const permisos = await web.consultasDeEmpresas().permisosDelActor(contexto);
    return permisos.ok ? permisos.valor : null;
  } catch (error) {
    console.error(
      `[modulos] no se pudieron leer los permisos de la persona (${error instanceof Error ? error.name : "falla que no es un Error"})`,
    );
    return null;
  }
});

export type PermisosLeidos = NonNullable<Awaited<ReturnType<typeof permisosDeLaPersona>>>;

/** De una acción, su módulo, el estado de construcción de ese módulo y su efecto: el catálogo es el único dueño de esos datos. */
function dondeVive(accion: ClaveAccion): {
  modulo: ClaveModulo;
  enDesarrollo: boolean;
  creaAmplia: boolean;
} {
  for (const [modulo, definicion] of Object.entries(CATALOGO_DE_MODULOS) as [
    ClaveModulo,
    (typeof CATALOGO_DE_MODULOS)[ClaveModulo],
  ][]) {
    const acciones: Readonly<Record<string, { efecto: string }>> = definicion.acciones;
    const propia = Object.hasOwn(acciones, accion) ? acciones[accion] : undefined;
    if (propia !== undefined) {
      return {
        modulo,
        enDesarrollo: (definicion.estado as EstadoDeConstruccion) === "en_desarrollo",
        creaAmplia: propia.efecto === "CREA_AMPLIA",
      };
    }
  }
  throw new Error(`La acción ${accion} no está en el catálogo de módulos`);
}

/**
 * Si el servidor deja hacer `accion` hoy y, si no, el motivo con un texto que YA existe en el catálogo. Sigue el mismo orden que
 * el guard (`evaluarGuard`): en desarrollo, módulo no activo, módulo en solo lectura (solo para las acciones que crean o amplían) y,
 * por último, el rol. `permisosDelActor` no devuelve los módulos en desarrollo ni los no activos (ni sus acciones): por eso «en
 * desarrollo» se distingue mirando el catálogo.
 */
export function ofertaDe(accion: ClaveAccion, permisos: PermisosLeidos): OfertaDeAccion {
  if (permisos.acciones.includes(accion)) return { permitida: true, motivo: null };
  const { modulo, enDesarrollo, creaAmplia } = dondeVive(accion);
  const enSoloLectura = permisos.modulos.enSoloLectura.includes(modulo);
  let clave: ClaveDeTexto = "motivo.sin_permiso";
  if (enDesarrollo) clave = "motivo.modulo_en_desarrollo";
  else if (!enSoloLectura && !permisos.modulos.activos.includes(modulo))
    clave = "motivo.modulo_no_activo";
  else if (enSoloLectura && creaAmplia) clave = "motivo.modulo_en_solo_lectura";
  return { permitida: false, motivo: texto({}, clave) };
}

/**
 * ¿La persona puede `accion` hoy? Es la oferta de esa acción (`ofertaDe`): con el módulo en desarrollo, en solo lectura o sin el rol, no.
 * Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: la acción vuelve a pasar por el guard. Es solo
 * la ayuda que apaga el botón.
 */
export async function puedeLaAccion(
  contexto: ContextoOperativo,
  accion: ClaveAccion,
): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe(accion, permisos).permitida;
}
