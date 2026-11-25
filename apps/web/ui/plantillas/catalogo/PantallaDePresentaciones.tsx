import { Boton } from "../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import estilos from "./PantallasDePresentaciones.module.css";
import type { ListaDePresentacionesArmada } from "./modelo-de-presentaciones";

export type PropsDePantallaDePresentaciones = Readonly<{ lista: ListaDePresentacionesArmada }>;

/**
 * La solapa «Cómo se compra» de un producto (T0; maqueta `presentaciones.html`): una tarjeta por presentación (nombre, cantidad en la unidad base, «De peso variable» y «Desactivado»), «Editar» en cada
 * una y «Agregar presentación» al final. Sin permiso los botones salen APAGADOS (no se esconden); decide el servidor. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDePresentaciones({ lista }: PropsDePantallaDePresentaciones) {
  return (
    <div className={estilos["raiz"]}>
      {lista.vacia === null ? (
        <ul className={estilos["lista"]}>
          {lista.filas.map((fila) => (
            <li key={fila.id} className={estilos["fila"]}>
              <div className={estilos["encabezado"]}>
                <span className={estilos["nombre"]}>{fila.nombre}</span>
                <span>{fila.cantidad}</span>
              </div>
              {fila.marcaDePesoVariable === null && fila.marcaDeDesactivada === null ? null : (
                <div className={estilos["marcas"]}>
                  {fila.marcaDePesoVariable === null ? null : (
                    <Insignia tono="neutro">{fila.marcaDePesoVariable}</Insignia>
                  )}
                  {fila.marcaDeDesactivada === null ? null : (
                    <Insignia tono="aviso">{fila.marcaDeDesactivada}</Insignia>
                  )}
                </div>
              )}
              <div className={estilos["acciones"]}>
                {fila.editar.apagado ? (
                  <Boton variante="secundaria" deshabilitado>
                    {fila.editar.texto}
                  </Boton>
                ) : (
                  <EnlaceDeAccion href={fila.editar.href} variante="secundaria">
                    {fila.editar.texto}
                  </EnlaceDeAccion>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>{lista.vacia}</p>
      )}
      <div>
        {lista.agregar.apagado ? (
          <Boton deshabilitado>{lista.agregar.texto}</Boton>
        ) : (
          <EnlaceDeAccion href={lista.agregar.href}>{lista.agregar.texto}</EnlaceDeAccion>
        )}
      </div>
    </div>
  );
}
