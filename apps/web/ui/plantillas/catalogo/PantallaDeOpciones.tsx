import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import estilos from "./PantallaDeOpciones.module.css";
import type { OpcionesArmadas } from "./modelo-de-opciones";

export type PropsDePantallaDeOpciones = Readonly<{ opciones: OpcionesArmadas }>;

/**
 * Las opciones de un producto (A13, tramo Opciones; maqueta `productos.html`, solapa «Opciones»), solo lectura más los enlaces de escribir: «Copiar de otro producto» arriba, los grupos
 * (una tarjeta por grupo: nombre, «Incluida» o «Adicional», «(obligatorio)» u «(opcional)» y sus opciones con el recargo) y «Agregar grupo» al final. Los enlaces solo llegan armados si la
 * persona puede editar. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeOpciones({ opciones }: PropsDePantallaDeOpciones) {
  return (
    <div className={estilos["raiz"]}>
      {opciones.copiar === null ? null : (
        <div>
          <EnlaceDeAccion href={opciones.copiar.href}>{opciones.copiar.texto}</EnlaceDeAccion>
        </div>
      )}
      <section className={estilos["seccion"]} aria-labelledby="variantes-del-producto">
        <h2 id="variantes-del-producto" className={estilos["titulo"]}>
          {opciones.variantes.titulo}
        </h2>
        {opciones.variantes.tarjeta === null ? null : (
          <div className={estilos["tarjeta"]}>
            <div className={estilos["renglon"]}>
              <strong className={estilos["nombre"]}>{opciones.variantes.tarjeta.nombre}</strong>
              {opciones.variantes.tarjeta.esLaMedida === null ? null : (
                <Insignia tono="exito">{opciones.variantes.tarjeta.esLaMedida}</Insignia>
              )}
            </div>
            <span className={estilos["suave"]}>
              {opciones.variantes.tarjeta.opciones.join(" · ")}
            </span>
            {opciones.variantes.editar === null ? null : (
              <div>
                <EnlaceDeAccion href={opciones.variantes.editar.href}>
                  {opciones.variantes.editar.texto}
                </EnlaceDeAccion>
              </div>
            )}
          </div>
        )}
        {opciones.variantes.agregar === null ? null : (
          <div>
            <EnlaceDeAccion href={opciones.variantes.agregar.href}>
              {opciones.variantes.agregar.texto}
            </EnlaceDeAccion>
          </div>
        )}
      </section>
      <section className={estilos["seccion"]} aria-labelledby="grupos-de-opciones">
        <h2 id="grupos-de-opciones" className={estilos["titulo"]}>
          {opciones.grupos.titulo}
        </h2>
        <ul className={estilos["lista"]}>
          {opciones.grupos.tarjetas.map((tarjeta) => (
            <li key={tarjeta.id} className={estilos["tarjeta"]}>
              <div className={estilos["renglon"]}>
                <strong className={estilos["nombre"]}>{tarjeta.nombre}</strong>
                <Insignia tono="neutro">{tarjeta.clase}</Insignia>
              </div>
              <span className={estilos["suave"]}>{tarjeta.reglas}</span>
              <span className={estilos["suave"]}>{tarjeta.opciones.join(" · ")}</span>
              {tarjeta.editar === null ? null : (
                <div>
                  <EnlaceDeAccion href={tarjeta.editar.href}>{tarjeta.editar.texto}</EnlaceDeAccion>
                </div>
              )}
            </li>
          ))}
        </ul>
        {opciones.agregar === null ? null : (
          <div>
            <EnlaceDeAccion href={opciones.agregar.href}>{opciones.agregar.texto}</EnlaceDeAccion>
          </div>
        )}
      </section>
    </div>
  );
}
