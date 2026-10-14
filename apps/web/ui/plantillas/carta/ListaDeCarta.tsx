import type { TextosDeCarta } from "../../../../../src/capacidades/experiencia/carta/textos";
import type {
  VistaDeProducto,
  VistaDeSeccion,
} from "../../../../../src/capacidades/experiencia/carta/vista";
import { ItemDeCarta } from "./ItemDeCarta";
import estilos from "./ListaDeCarta.module.css";

/** Las fotos de los primeros ítems cargan ya (entran en el primer pantallazo); las demás, en diferido (D6). */
const ITEMS_CON_FOTO_INMEDIATA = 4;

export type PropsDeListaDeCarta = Readonly<{
  secciones: readonly VistaDeSeccion[];
  textos: TextosDeCarta;
  alAbrir?: (producto: VistaDeProducto) => void;
}>;

/**
 * El modelo Lista (§4.1): una sección con su título (un `h2`, y a la vez su ancla `#<slug>`) y una `ul` de ítems
 * por sección. Es HTML común: sin JavaScript se lee igual, con precios y todo.
 */
export function ListaDeCarta({ secciones, textos, alAbrir }: PropsDeListaDeCarta) {
  // Cuántos productos hay antes de cada sección: de ahí sale cuáles entran en el primer pantallazo.
  const antes = secciones.map((_, i) =>
    secciones.slice(0, i).reduce((n, s) => n + s.productos.length, 0),
  );
  return (
    <>
      {secciones.map((seccion, i) => (
        <section key={seccion.id} className={estilos["seccion"]} aria-labelledby={seccion.id}>
          {/* Enfocable por programa (tabindex -1): ir a `#<slug>` deja el foco en el título. */}
          <h2 id={seccion.id} tabIndex={-1} className={estilos["titulo"]}>
            {seccion.nombre}
          </h2>
          <ul className={estilos["items"]}>
            {seccion.productos.map((producto, j) => (
              <ItemDeCarta
                key={producto.segmento}
                producto={producto}
                textos={textos}
                prioridad={(antes[i] ?? 0) + j < ITEMS_CON_FOTO_INMEDIATA}
                {...(alAbrir === undefined ? {} : { alAbrir })}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
