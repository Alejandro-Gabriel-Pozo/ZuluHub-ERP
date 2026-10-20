import type { TextosDeCarta } from "../../../../../src/capacidades/experiencia/carta/textos";
import type {
  VistaDeGrupo,
  VistaDeProducto,
} from "../../../../../src/capacidades/experiencia/carta/vista";
import estilos from "./DetalleDeProducto.module.css";
import { FotoDeProducto } from "./FotoDeProducto.cliente";

/** El id de lo que describe la hoja o la página: el precio y el estado (`aria-describedby`, §3.2). */
export function idDelPrecioDe(producto: VistaDeProducto): string {
  return `pd-precio-${producto.segmento}`;
}

export type PropsDeDetalleDeProducto = Readonly<{
  producto: VistaDeProducto;
  textos: TextosDeCarta;
  /** Nivel de los títulos de grupo: 2 en la página del producto (bajo el `h1`), 3 en la hoja (bajo su `h2`). */
  nivelDeTitulos: 2 | 3;
}>;

function Grupo({ grupo, Titulo }: Readonly<{ grupo: VistaDeGrupo; Titulo: "h2" | "h3" }>) {
  return (
    <section>
      <Titulo className={estilos["titulo"]}>{grupo.titulo}</Titulo>
      <ul className={estilos["lista"]}>
        {grupo.opciones.map((opcion) => (
          <li key={opcion.nombre} className={estilos["renglon"]}>
            <span className={estilos["nombreDelRenglon"]}>{opcion.nombre}</span>
            {opcion.recargo === null ? null : (
              <span className={estilos["importe"]}>{opcion.recargo}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Lo que muestra la tarjeta de un producto, en este orden (§3.1): foto, estado «Agotado», precio (o la lista
 * de precios por tamaño), descripción propia, grupos obligatorios (guarnición) y adicionales. Cada bloque que
 * falta NO se dibuja: ni marco vacío, ni «Sin descripción», ni una foto de relleno. El nombre es el título de
 * quien lo contiene (la hoja o la página).
 */
export function DetalleDeProducto({ producto, textos, nivelDeTitulos }: PropsDeDetalleDeProducto) {
  const Titulo = nivelDeTitulos === 2 ? "h2" : "h3";
  return (
    <div className={estilos["raiz"]}>
      {producto.foto === null ? null : (
        <FotoDeProducto foto={producto.foto} tamano="grande" decorativa={false} prioridad />
      )}
      <div id={idDelPrecioDe(producto)}>
        {producto.agotado ? <p className={estilos["agotado"]}>{textos.agotado}</p> : null}
        {producto.tamanos.length === 0 ? (
          <p className={estilos["precioUnico"]}>{producto.precioEnLista}</p>
        ) : (
          <section>
            <Titulo className={estilos["titulo"]}>{textos.precios}</Titulo>
            <ul className={estilos["lista"]}>
              {producto.tamanos.map((tamano) => (
                <li key={tamano.nombre} className={estilos["renglon"]}>
                  <span className={estilos["nombreDelRenglon"]}>{tamano.nombre}</span>
                  <span className={estilos["importe"]}>{tamano.precio}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {producto.descripcion === null ? null : (
        <p className={estilos["descripcion"]}>{producto.descripcion}</p>
      )}
      {producto.obligatorios.map((grupo) => (
        <Grupo key={grupo.titulo} grupo={grupo} Titulo={Titulo} />
      ))}
      {producto.adicionales.map((grupo) => (
        <Grupo key={grupo.titulo} grupo={grupo} Titulo={Titulo} />
      ))}
    </div>
  );
}
