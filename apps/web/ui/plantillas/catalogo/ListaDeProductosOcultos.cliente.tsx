"use client";

import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { Insignia } from "../../componentes/Insignia";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import estilos from "./PantallaDeListaDeProductos.module.css";
import type { ListaDeOcultosArmada } from "./modelo-de-ocultos";

export type PropsDeListaDeProductosOcultos = Readonly<{
  lista: ListaDeOcultosArmada;
  /** Una acción de servidor por producto (`volverAMostrarAccion` ya ligada a su id). */
  acciones: Readonly<Record<string, AccionDeFormulario>>;
}>;

/**
 * La lista de productos ocultos (C2; maqueta `productos.html`, `vListaOcultos`): una tarjeta por producto con su nombre, el aviso de cada alcance y «Volver a mostrar». No valida nada: el permiso
 * y dónde está oculto lo decide el servidor, y su motivo sale debajo del botón con el patrón común. Repetir el envío no duplica (la acción fija un estado); el botón ignora el segundo toque. Sin
 * permiso el botón sale apagado. La selección de varios a la vez no está: necesita un campo de casilla que hoy no existe (pregunta pendiente).
 */
export function ListaDeProductosOcultos({ lista, acciones }: PropsDeListaDeProductosOcultos) {
  if (lista.vacio !== null) return <Aviso tono="info">{lista.vacio}</Aviso>;
  return (
    <ul className={estilos["lista"]}>
      {lista.filas.map((fila) => {
        const accion = acciones[fila.productoId];
        return (
          <li key={fila.productoId} className={estilos["tarjeta"]}>
            <div className={estilos["renglon"]}>
              <strong className={estilos["nombre"]}>{fila.nombre}</strong>
            </div>
            {accion === undefined || !fila.puede ? (
              <>
                <div className={estilos["renglon"]}>
                  {fila.avisos.map((a) => (
                    <Insignia key={a} tono="aviso">
                      {a}
                    </Insignia>
                  ))}
                </div>
                <Boton variante="secundaria" deshabilitado>
                  {lista.boton}
                </Boton>
              </>
            ) : (
              <FormularioDeAccion accion={accion}>
                <div className={estilos["renglon"]}>
                  {fila.avisos.map((a) => (
                    <Insignia key={a} tono="aviso">
                      {a}
                    </Insignia>
                  ))}
                </div>
                <BotonDeEnvio variante="secundaria">{lista.boton}</BotonDeEnvio>
              </FormularioDeAccion>
            )}
          </li>
        );
      })}
    </ul>
  );
}
