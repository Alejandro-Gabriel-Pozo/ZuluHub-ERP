"use client";

import { Boton } from "../../componentes/Boton.cliente";
import { Insignia } from "../../componentes/Insignia";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import type { FilaDeVisibilidad } from "./modelo-de-visibilidad-de-producto";

export type PropsDeVisibilidadDeLaFichaDeProducto = Readonly<{
  filas: readonly FilaDeVisibilidad[];
  /** Una acción de servidor por alcance (`ocultarOMostrarAccion` ya ligada al producto, al alcance y al estado que se quiere). */
  acciones: Readonly<Record<FilaDeVisibilidad["alcance"], AccionDeFormulario>>;
}>;

/**
 * La tarjeta de visibilidad de la ficha de un producto (A15; maqueta `productos.html`, `vVisib`): por cada alcance, su aviso («Oculto», «Oculto en toda la empresa») si está oculto y el botón
 * que pide el estado contrario. No valida nada: las condiciones (existencia, conteo abierto) y el permiso los decide el servidor, y su motivo sale debajo del botón con el patrón común.
 * Repetir el envío no duplica ni deshace (la acción fija un estado, no alterna); el botón solo ignora el segundo toque. Sin permiso el botón sale apagado.
 */
export function VisibilidadDeLaFichaDeProducto({
  filas,
  acciones,
}: PropsDeVisibilidadDeLaFichaDeProducto) {
  return (
    <Pila separacion={3}>
      {filas.map((fila) => (
        <FormularioDeAccion
          // Con otro estado, otra acción: la clave renueva el formulario (y descarta el error de la acción anterior).
          key={`${fila.alcance}-${String(fila.oculto)}`}
          accion={acciones[fila.alcance]}
        >
          {fila.aviso === null ? null : <Insignia tono="aviso">{fila.aviso}</Insignia>}
          {fila.puede ? (
            <BotonDeEnvio variante="secundaria">{fila.boton}</BotonDeEnvio>
          ) : (
            <Boton variante="secundaria" deshabilitado>
              {fila.boton}
            </Boton>
          )}
        </FormularioDeAccion>
      ))}
    </Pila>
  );
}
