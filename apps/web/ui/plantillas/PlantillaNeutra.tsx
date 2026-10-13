import type { ReactNode } from "react";
import estilos from "./PlantillaNeutra.module.css";

export type PropsDePlantillaNeutra = Readonly<{
  /** Título de la pantalla (el `h1`), ya resuelto. */
  titulo: string;
  children: ReactNode;
}>;

/**
 * Armazón sin navegación: una tarjeta centrada con un título y su contenido. Es lo que ven la página
 * neutra, los errores y las pantallas de ingreso: sin nombre ni color de marca escritos acá.
 */
export function PlantillaNeutra({ titulo, children }: PropsDePlantillaNeutra) {
  return (
    <main className={estilos["raiz"]}>
      <section className={estilos["tarjeta"]}>
        <h1 className={estilos["titulo"]}>{titulo}</h1>
        {children}
      </section>
    </main>
  );
}
