import { useId, type MouseEvent } from "react";
import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import type { VistaDeProducto } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { FotoDeProducto } from "./FotoDeProducto.cliente";
import estilos from "./ItemDeVidriera.module.css";

export type PropsDeItemDeVidriera = Readonly<{
  producto: VistaDeProducto;
  textos: TextosDeVidriera;
  /** Foto del primer pantallazo: carga ya, sin esperar a acercarse (D6). */
  prioridad: boolean;
  /** Tocar el ítem con un toque común abre la tarjeta; sin esto es un enlace a la página del producto. */
  alAbrir?: (producto: VistaDeProducto) => void;
}>;

/**
 * Un ítem de la lista: nombre, precio, «Agotado» (como texto), descripción, guarnición y la miniatura opcional
 * a la derecha. Es un enlace a la página del producto; con JavaScript el toque común abre la tarjeta sin
 * perder el lugar, y Ctrl, Mayús, el botón del medio o «abrir en otra pestaña» siguen yendo a la página.
 */
export function ItemDeVidriera({ producto, textos, prioridad, alAbrir }: PropsDeItemDeVidriera) {
  const id = useId();
  const idDeLaDescripcion = `${id}-d`;
  const hayDetalle = producto.descripcion !== null || producto.guarnicion !== null;
  const describe = [
    ...(producto.descripcion === null ? [] : [idDeLaDescripcion]),
    ...(producto.guarnicion === null ? [] : [`${id}-g`]),
  ].join(" ");

  function alTocar(evento: MouseEvent<HTMLAnchorElement>) {
    const comun =
      evento.button === 0 &&
      !evento.metaKey &&
      !evento.ctrlKey &&
      !evento.shiftKey &&
      !evento.altKey;
    if (alAbrir === undefined || evento.defaultPrevented || !comun) return;
    evento.preventDefault();
    // Safari no enfoca un enlace al tocarlo: se enfoca acá para que el foco vuelva a este ítem al cerrar.
    evento.currentTarget.focus();
    alAbrir(producto);
  }

  return (
    <li className={estilos["item"]}>
      <div className={estilos["texto"]}>
        {/* El enlace es nombre, precio y «Agotado»: su nombre accesible sale de ese texto visible
            («Capuchino desde $ 3.300 Agotado», D9: lo que se decide al mirar). Su `::after` cubre todo el ítem,
            así que tocar la descripción también abre (D5). */}
        <a
          href={producto.href}
          className={estilos["enlace"]}
          aria-describedby={hayDetalle ? describe : undefined}
          data-segmento={producto.segmento}
          onClick={alTocar}
        >
          <span className={estilos["nombre"]}>{producto.nombre}</span>
          <span className={estilos["precio"]}>{producto.precioEnLista}</span>
          {producto.agotado ? <span className={estilos["agotado"]}>{textos.agotado}</span> : null}
        </a>
        {producto.descripcion === null ? null : (
          <span id={idDeLaDescripcion} className={estilos["linea"]}>
            {producto.descripcion}
          </span>
        )}
        {producto.guarnicion === null ? null : (
          <span id={`${id}-g`} className={estilos["linea"]}>
            {producto.guarnicion}
          </span>
        )}
      </div>
      {producto.foto === null ? null : (
        <FotoDeProducto foto={producto.foto} tamano="miniatura" decorativa prioridad={prioridad} />
      )}
    </li>
  );
}
