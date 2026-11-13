"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import estilos from "./FormularioDeFiltrosDeProductos.module.css";
import type { FiltrosArmados } from "./filtros-de-productos";

export type PropsDeFormularioDeFiltrosDeProductos = Readonly<{ filtros: FiltrosArmados }>;

/**
 * Los filtros de la lista de productos (maqueta `productos.html`): buscar, «¿Qué es?» y estado. Un formulario GET que anda sin JavaScript (cada campo lleva su `name` y el botón es
 * de envío); el estado de acá solo mantiene los campos controlados. El que arma la pantalla le pone `key` con los filtros de la dirección para que un filtro nuevo lo reinicie.
 * Sin textos propios: todos llegan resueltos.
 */
export function FormularioDeFiltrosDeProductos({ filtros }: PropsDeFormularioDeFiltrosDeProductos) {
  const { valores, textos } = filtros;
  const [buscar, setBuscar] = useState(valores.texto);
  const [clase, setClase] = useState<string>(valores.clase);
  const [estado, setEstado] = useState<string>(valores.estado);
  return (
    <form method="get" action={filtros.accion} role="search" className={estilos["formulario"]}>
      <div className={estilos["buscar"]}>
        <Campo
          dato="texto-de-busqueda-de-producto"
          etiqueta={textos.buscar}
          nombre="texto"
          tipo="search"
          autoComplete="off"
          valor={buscar}
          alCambiar={setBuscar}
        />
      </div>
      <Selector
        dato="clase-de-uso-de-producto"
        etiqueta={textos.clase}
        nombre="clase"
        valor={clase}
        alCambiar={setClase}
        textoDeElegir={textos.todos}
        opciones={filtros.clases}
      />
      <Selector
        dato="estado-de-producto"
        etiqueta={textos.estado}
        nombre="estado"
        valor={estado}
        alCambiar={setEstado}
        textoDeElegir={textos.todos}
        opciones={filtros.estados}
      />
      <div className={estilos["acciones"]}>
        <Boton tipo="submit">{textos.aplicar}</Boton>
      </div>
    </form>
  );
}
