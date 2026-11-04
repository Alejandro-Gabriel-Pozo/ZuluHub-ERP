import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import type { VistaDeProducto } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { Compartir } from "./Compartir.cliente";
import { DetalleDeProducto } from "./DetalleDeProducto";
import estilos from "./PaginaDeProducto.module.css";

export type PropsDePaginaDeProducto = Readonly<{
  producto: VistaDeProducto;
  /** El nombre de la carta, sobre el nombre del producto. */
  vidriera: string;
  /** La dirección de la carta (con el ancla de la sección del producto) para «Ver toda la carta». */
  hrefDeLaVidriera: string;
  textos: TextosDeVidriera;
}>;

/**
 * La página de un producto (§3.2, «entrada directa»): la misma tarjeta, a pantalla completa y sin el resto de
 * la carta, para el enlace que se comparte por WhatsApp. Sirve sin JavaScript; «Ver toda la carta» lleva a la
 * sección del producto.
 */
export function PaginaDeProducto({
  producto,
  vidriera,
  hrefDeLaVidriera,
  textos,
}: PropsDePaginaDeProducto) {
  return (
    <main className={estilos["pagina"]}>
      <p className={estilos["vidriera"]}>{vidriera}</p>
      <h1 className={estilos["nombre"]}>{producto.nombre}</h1>
      <DetalleDeProducto producto={producto} textos={textos} nivelDeTitulos={2} />
      <div className={estilos["acciones"]}>
        <Compartir enlace={producto.href} titulo={producto.nombre} textos={textos} />
        <a href={hrefDeLaVidriera} className={estilos["verVidriera"]}>
          {textos.verTodaLaVidriera}
        </a>
      </div>
    </main>
  );
}

/** La página cuando el producto ya no está en la carta (§3.2): lo dice y deja volver a ella. */
export function PaginaDeProductoQueYaNoEsta({
  hrefDeLaVidriera,
  textos,
}: Readonly<{ hrefDeLaVidriera: string; textos: TextosDeVidriera }>) {
  return (
    <main className={estilos["pagina"]}>
      <div className={estilos["vacio"]}>
        <h1 className={estilos["nombre"]}>{textos.productoNoEsta}</h1>
        <a href={hrefDeLaVidriera} className={estilos["verVidriera"]}>
          {textos.verTodaLaVidriera}
        </a>
      </div>
    </main>
  );
}
