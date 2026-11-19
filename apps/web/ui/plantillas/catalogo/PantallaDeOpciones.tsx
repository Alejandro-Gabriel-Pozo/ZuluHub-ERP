import { Boton } from "../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import estilos from "./PantallaDeOpciones.module.css";
import type { BotonDeNavegacion, OpcionesArmadas } from "./modelo-de-opciones";

export type PropsDePantallaDeOpciones = Readonly<{ opciones: OpcionesArmadas }>;

/** Un botón que lleva a otra pantalla; sin permiso se dibuja igual pero apagado (maqueta: `dis()`), no se esconde. */
function BotonDeNavegacionDeOpciones({ boton }: Readonly<{ boton: BotonDeNavegacion }>) {
  return boton.apagado ? (
    <Boton variante="secundaria" deshabilitado>
      {boton.texto}
    </Boton>
  ) : (
    <EnlaceDeAccion href={boton.href} variante="secundaria">
      {boton.texto}
    </EnlaceDeAccion>
  );
}

/**
 * Las opciones de un producto (A13, tramo Opciones; maqueta `productos.html`, solapa «Opciones», función `vOpciones`): «Copiar de otro producto» arriba, el título «Grupos de opciones»,
 * una tarjeta por grupo (nombre, «Incluida» o «Adicional», «(obligatorio)» u «(opcional)» con « · no figura en la carta» si corresponde, las opciones con su recargo y «Editar») y
 * «Agregar grupo» al final. Los botones siempre se dibujan: sin permiso van apagados, no ausentes. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeOpciones({ opciones }: PropsDePantallaDeOpciones) {
  return (
    <div className={estilos["raiz"]}>
      <div>
        <BotonDeNavegacionDeOpciones boton={opciones.copiar} />
      </div>
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
              <div>
                <BotonDeNavegacionDeOpciones boton={tarjeta.editar} />
              </div>
            </li>
          ))}
        </ul>
        <div>
          <BotonDeNavegacionDeOpciones boton={opciones.agregar} />
        </div>
      </section>
    </div>
  );
}
