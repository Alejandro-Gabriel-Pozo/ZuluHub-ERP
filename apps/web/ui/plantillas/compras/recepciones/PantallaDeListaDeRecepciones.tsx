import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { RUTA_DE_RECIBIR } from "../rutas-de-compras";
import {
  armarLaListaDeRecepciones,
  type ListaDeRecepcionesParaLaPantalla,
} from "./modelo-de-recepciones";
import type { TextosDeRecepciones } from "./textos-de-recepciones";
import estilos from "../Compras.module.css";

export type PropsDePantallaDeListaDeRecepciones = Readonly<{
  lista: ListaDeRecepcionesParaLaPantalla;
  textos: TextosDeRecepciones;
  /** La persona puede recibir (`recepciones.registrar`): sin permiso no hay enlace. Solo ayuda: la pantalla de destino y su acción vuelven a pedir el permiso. */
  puedeRecibir?: boolean;
}>;

/**
 * «Recepciones» (Compras 4; maqueta `compra-recibir.html`, estado `lista`): una recepción por fila (número, proveedor, estado en texto y fecha) y «Página siguiente». Sin filtros en la primera versión
 * (decisión del dueño, 25/11/2026, pregunta 8). SOLO LECTURA salvo el enlace «Recibir». Cada fila es un enlace al detalle con su nombre accesible completo. Sin estado ni hooks: es una página de servidor.
 * El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeRecepciones({
  lista,
  textos,
  puedeRecibir = false,
}: PropsDePantallaDeListaDeRecepciones) {
  const armada = armarLaListaDeRecepciones(lista, textos);
  return (
    <div className={estilos["cuerpo"]}>
      {puedeRecibir ? (
        <EnlaceDeAccion href={RUTA_DE_RECIBIR}>{textos.recibir}</EnlaceDeAccion>
      ) : null}
      {armada.vacio === null ? (
        <ul className={estilos["lista"]}>
          {armada.filas.map((fila) => (
            <li key={fila.id}>
              <a className={estilos["fila"]} href={fila.href} aria-label={fila.nombreAccesible}>
                <span className={estilos["titulo"]}>{fila.titulo}</span>{" "}
                <span className={estilos["segunda"]}>{fila.segunda}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className={estilos["suave"]}>{armada.vacio}</p>
      )}
      {armada.paginaSiguiente === null ? null : (
        <EnlaceDeAccion href={armada.paginaSiguiente.href} variante="secundaria">
          {armada.paginaSiguiente.texto}
        </EnlaceDeAccion>
      )}
    </div>
  );
}
