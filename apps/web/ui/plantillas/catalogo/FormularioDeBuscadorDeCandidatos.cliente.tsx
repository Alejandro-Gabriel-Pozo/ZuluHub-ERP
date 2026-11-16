"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import estilos from "./FormularioDeFiltrosDeProductos.module.css";
import type { CandidatosArmados } from "./modelo-de-secciones";

export type PropsDeFormularioDeBuscadorDeCandidatos = Readonly<{
  buscador: CandidatosArmados["buscador"];
}>;

/**
 * El buscador de «Agregar producto» (maqueta `productos-secciones.html`, campo «Buscar»): un formulario GET que anda sin JavaScript (el campo lleva su `name` y el botón es de envío); el estado de
 * acá solo mantiene el campo controlado. El que arma la pantalla le pone `key` con el texto de la dirección para que una búsqueda nueva lo reinicie. Sin textos propios.
 */
export function FormularioDeBuscadorDeCandidatos({
  buscador,
}: PropsDeFormularioDeBuscadorDeCandidatos) {
  const [buscar, setBuscar] = useState(buscador.valorInicial);
  return (
    <form method="get" action={buscador.accion} role="search" className={estilos["formulario"]}>
      <div className={estilos["buscar"]}>
        <Campo
          dato="texto-de-busqueda-de-producto"
          etiqueta={buscador.etiqueta}
          nombre="texto"
          tipo="search"
          autoComplete="off"
          valor={buscar}
          alCambiar={setBuscar}
        />
      </div>
      <div className={estilos["acciones"]}>
        <Boton tipo="submit">{buscador.boton}</Boton>
      </div>
    </form>
  );
}
