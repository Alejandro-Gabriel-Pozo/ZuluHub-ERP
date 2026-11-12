import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Las recetas dentro de recetas (E6 §3.1 y §3.3, D96): sin ciclos y hasta cinco niveles, contando la receta del propio producto como el
 * nivel 1 (S-6). `recetas` dice, por producto, qué productos elaborados lleva su receta vigente; la del producto que se guarda va con
 * lo que se está guardando. Puro. La base repite la regla con el disparador diferido `composicion_sin_ciclos` (la prueba de integración
 * las compara). Previene un ciclo (la receta de A usa B y la de B usa A) que haría explotar el consumo para siempre.
 */
export const MAXIMO_DE_NIVELES_DE_RECETA = 5;

export type ErrorDeArbolDeRecetas =
  | Readonly<{ codigo: "CICLO_EN_LA_RECETA"; camino: readonly string[] }>
  | Readonly<{ codigo: "RECETA_DEMASIADO_ANIDADA" }>;

export function analizarArbolDeRecetas(
  raiz: string,
  recetas: ReadonlyMap<string, readonly string[]>,
): Resultado<number, ErrorDeArbolDeRecetas> {
  const memo = new Map<string, number>();
  // Stryker disable next-line ArrayDeclaration: un elemento de más al principio del camino no coincide con ningún producto
  const enCamino: string[] = [];
  let ciclo: readonly string[] | null = null;

  const niveles = (producto: string): number => {
    const sabido = memo.get(producto);
    if (sabido !== undefined) return sabido;
    enCamino.push(producto);
    let hijos = 0;
    for (const hijo of recetas.get(producto) ?? []) {
      if (ciclo !== null) break;
      const posicion = enCamino.indexOf(hijo);
      if (posicion >= 0) {
        ciclo = [...enCamino.slice(posicion), hijo];
        break;
      }
      hijos = Math.max(hijos, niveles(hijo));
    }
    enCamino.pop();
    const total = 1 + hijos;
    memo.set(producto, total);
    return total;
  };

  const total = niveles(raiz);
  if (ciclo !== null) return err({ codigo: "CICLO_EN_LA_RECETA", camino: ciclo });
  if (total > MAXIMO_DE_NIVELES_DE_RECETA) return err({ codigo: "RECETA_DEMASIADO_ANIDADA" });
  return ok(total);
}
