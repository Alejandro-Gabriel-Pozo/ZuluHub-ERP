import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import type { DefinicionDeCamino } from "../../src/capacidades/datos/caminos";
import type { Registro } from "./campos-con-dato-apoyo";

/**
 * Lo que `caminos-declarados.test.ts` comprueba (regla 5.b, verificador D1): los caminos declarados contra el registro de datos, el catálogo de acciones y los archivos
 * reales. Pura: el registro, los caminos y la existencia de archivos entran como datos para poder inyectarle cada violación.
 */

export type Caminos = Readonly<Record<string, DefinicionDeCamino>>;

const accionesDelCatalogo = (): Set<string> =>
  new Set(Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)));

export function problemasDeLosCaminos(
  caminos: Caminos,
  registro: Registro,
  existe: (ruta: string) => boolean,
): string[] {
  const problemas: string[] = [];
  const acciones = accionesDelCatalogo();
  const datos = registro as Readonly<Record<string, { consumidores: readonly string[] }>>;
  for (const [id, camino] of Object.entries(caminos)) {
    const completados = new Set(camino.pasos.flatMap((p) => Object.values(p.campos)));
    const cubiertos = new Set<string>([...completados, ...camino.deriva]);
    const consumidos = new Set<string>([...camino.accion.requiere, ...camino.accion.admite]);
    const nombresDeCampo = new Set(camino.pasos.flatMap((p) => Object.keys(p.campos)));

    // Forma: lo declarado existe.
    if (!acciones.has(camino.accion.clave)) {
      problemas.push(`${id}: la acción «${camino.accion.clave}» no existe en el catálogo`);
    }
    for (const pantalla of camino.pantallas) {
      if (!existe(pantalla)) problemas.push(`${id}: la pantalla ${pantalla} no existe`);
    }
    for (const dato of new Set([...completados, ...camino.deriva, ...consumidos])) {
      if (!Object.hasOwn(datos, dato))
        problemas.push(`${id}: el dato «${dato}» no está en el registro`);
    }
    for (const dato of completados) {
      const consumidores = datos[dato]?.consumidores ?? [];
      if (!camino.pantallas.some((p) => consumidores.includes(p))) {
        problemas.push(
          `${id}: ninguna pantalla del camino figura como consumidora del dato «${dato}» en el registro`,
        );
      }
    }
    // (a) la acción exige un dato que ningún paso completa ni se deriva.
    for (const dato of camino.accion.requiere) {
      if (!cubiertos.has(dato)) {
        problemas.push(
          `${id}: la acción «${camino.accion.clave}» exige el dato «${dato}» y ningún paso lo completa ni se deriva`,
        );
      }
    }
    // (b) un paso pide un dato que la acción no consume.
    for (const paso of camino.pasos) {
      for (const dato of Object.values(paso.campos)) {
        if (!consumidos.has(dato)) {
          problemas.push(
            `${id}: el paso «${paso.id}» pide el dato «${dato}» y la acción «${camino.accion.clave}» no lo exige ni lo admite`,
          );
        }
      }
    }
    // (c) un campo de error que el servidor puede devolver y ningún paso tiene.
    for (const campo of camino.camposDeError) {
      if (!nombresDeCampo.has(campo)) {
        problemas.push(
          `${id}: el servidor puede devolver un error en el campo «${campo}» y ningún paso lo tiene`,
        );
      }
    }
  }
  return problemas;
}
