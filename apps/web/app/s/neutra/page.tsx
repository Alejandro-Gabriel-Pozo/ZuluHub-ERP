import type { Metadata } from "next";

// Sin título ni marca: la neutra no revela nada de a quién pertenece el host. Nunca se indexa.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// La neutra: sin marca, sin cookies y sin estilos propios. Mismo texto para todo host. El estado 404
// lo pone `proxy.ts` al reescribir (una página no puede fijar su propio estado sin `notFound()`).
export default function PaginaNeutra() {
  return (
    <main>
      <h1>No encontrado</h1>
      <p>La página que buscás no existe.</p>
    </main>
  );
}
