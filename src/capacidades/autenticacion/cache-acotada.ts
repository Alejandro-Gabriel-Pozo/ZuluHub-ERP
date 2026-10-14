/**
 * Caché acotada por cantidad, con el más antiguo sin uso como primero en salir. La usa la autenticación
 * para guardar una instancia de la librería por host sin que la memoria crezca con los hosts que pasan
 * (web-armazon §4.1). Sin vencimiento por tiempo: lo que se guarda es configuración que no cambia
 * durante la vida del proceso. Pura: no lee reloj ni entorno.
 */
export type CacheAcotada<V> = {
  /** Devuelve lo guardado para `clave` (y la marca como usada hace poco) o lo crea y lo guarda. */
  obtenerOCrear(clave: string, crear: () => V): V;
  /** Cuántas entradas hay guardadas ahora (nunca más que la capacidad). */
  tamano(): number;
};

export function crearCacheAcotada<V>(capacidad: number): CacheAcotada<V> {
  if (!Number.isInteger(capacidad) || capacidad < 1) {
    throw new RangeError("la capacidad de la caché es un entero de 1 o más");
  }
  const guardado = new Map<string, V>();
  return {
    obtenerOCrear(clave, crear) {
      if (guardado.has(clave)) {
        const existente = guardado.get(clave) as V;
        // Se reinserta para que quede como el más reciente.
        guardado.delete(clave);
        guardado.set(clave, existente);
        return existente;
      }
      // Si `crear` lanza, no queda nada guardado y el próximo pedido lo intenta de nuevo.
      const nuevo = crear();
      guardado.set(clave, nuevo);
      if (guardado.size > capacidad) {
        const masAntiguo = guardado.keys().next().value as string;
        guardado.delete(masAntiguo);
      }
      return nuevo;
    },
    tamano: () => guardado.size,
  };
}
