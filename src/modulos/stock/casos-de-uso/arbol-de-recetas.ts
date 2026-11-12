import { analizarArbolDeRecetas } from "../dominio/subcomposicion";
import type { TxDeLecturaDeStock } from "./tipos-de-puertos";

/**
 * Lo que mira `guardarComposicion` antes de escribir una receta con elaborados (E6 §3.2, D96): que no forme un ciclo y que ninguna receta
 * que la use, directa o indirectamente, pase de cinco niveles. Arma el grafo «producto → elaborados de su receta vigente» con lo que se
 * guarda en lugar de la versión vigente de `raiz`, hacia abajo (lo que lleva) y hacia arriba (quién la usa), y mide cada raíz con
 * `analizarArbolDeRecetas` (puro). La base repite la regla con el disparador diferido `composicion_sin_ciclos`, que solo mide hacia abajo
 * desde el producto que se guarda: medir hacia arriba es de acá. Previene una venta que explota con `RECETA_DEMASIADO_ANIDADA` por una
 * receta que se guardó sin error.
 */
export type ErrorDeArbol = "CICLO_EN_LA_RECETA" | "RECETA_DEMASIADO_ANIDADA";

type Lectura = Pick<TxDeLecturaDeStock, "composicionesDeStock">;

const hijosDe = (
  componentes: readonly Readonly<{ compuestoId: string | null }>[],
): readonly string[] => componentes.flatMap((c) => (c.compuestoId === null ? [] : [c.compuestoId]));

export async function comprobarArbolDeRecetas(
  tx: Lectura,
  empresa: Parameters<Lectura["composicionesDeStock"]["ultimasVersiones"]>[0],
  raiz: string,
  elaboradosQueLleva: readonly string[],
): Promise<ErrorDeArbol | null> {
  const recetas = new Map<string, readonly string[]>([[raiz, elaboradosQueLleva]]);

  /** Carga la receta vigente de estos productos y sigue por lo que lleva cada una; devuelve los que se leyeron por primera vez. */
  const cargar = async (ids: readonly string[]): Promise<readonly string[]> => {
    const nuevos = ids.filter((id) => !recetas.has(id));
    if (nuevos.length === 0) return [];
    const versiones = await tx.composicionesDeStock.ultimasVersiones(empresa, nuevos);
    for (const id of nuevos) recetas.set(id, hijosDe(versiones.get(id)?.componentes ?? []));
    return nuevos;
  };

  // Hacia abajo: todo lo que lleva la receta, hasta que no aparezcan elaborados nuevos (los ciclos no hacen crecer el conjunto).
  let pendientes: readonly string[] = elaboradosQueLleva;
  while (pendientes.length > 0) {
    const leidos = await cargar(pendientes);
    pendientes = [...new Set(leidos.flatMap((id) => recetas.get(id) ?? []))];
  }

  // Hacia arriba: los que usan a `raiz`, y a su vez los que los usan, con lo que llevan hacia abajo.
  const raices: string[] = [raiz];
  let nivel: readonly string[] = [raiz];
  while (nivel.length > 0) {
    const padres = (await tx.composicionesDeStock.productosQueUsan(empresa, nivel)).filter(
      (id) => !raices.includes(id),
    );
    raices.push(...padres);
    let bajar: readonly string[] = padres;
    while (bajar.length > 0) {
      const leidos = await cargar(bajar);
      bajar = [...new Set(leidos.flatMap((id) => recetas.get(id) ?? []))];
    }
    nivel = padres;
  }

  for (const r of raices) {
    const analisis = analizarArbolDeRecetas(r, recetas);
    if (!analisis.ok) return analisis.error.codigo;
  }
  return null;
}
