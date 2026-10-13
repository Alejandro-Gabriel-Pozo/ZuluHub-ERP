/**
 * Memoriza el resultado de `crear` la primera vez que se pide. Si `crear` lanza, no se memoriza nada
 * y el próximo pedido lo intenta de nuevo: una variable de entorno que se corrige en Vercel no deja
 * la instancia rota hasta reiniciar. `crear` es síncrono a propósito: dos pedidos simultáneos no
 * pueden entrelazarse y comparten una sola instancia (los pools de conexión se abren recién con la
 * primera consulta).
 */
export function perezoso<T>(crear: () => T): () => T {
  let creado: { valor: T } | null = null;
  return () => {
    creado ??= { valor: crear() };
    return creado.valor;
  };
}
