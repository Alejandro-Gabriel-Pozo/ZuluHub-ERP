"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import estilos from "./FormularioDeFiltros.module.css";
import type { FiltrosArmados } from "./filtros-del-listado";

export type PropsDeFormularioDeFiltros = Readonly<{ filtros: FiltrosArmados }>;

/**
 * Los filtros del listado: un formulario GET que anda sin JavaScript (cada campo lleva su `name` y el botón es de envío). El estado
 * de acá solo mantiene los campos controlados. En el celular el panel es un `<details>` con «Filtros (n)»; en escritorio los campos
 * se ven siempre. Las dos fechas del período «Personalizado» están en el formulario y solo se ven con ese período elegido
 * (`:has` en el CSS, sin JavaScript). El estado inicial sale de la dirección: el que arma la pantalla le pone `key` con los filtros
 * para que «Limpiar» o un filtro nuevo lo reinicie.
 */
export function FormularioDeFiltros({ filtros }: PropsDeFormularioDeFiltros) {
  const { valores, textos } = filtros;
  const [periodo, setPeriodo] = useState<string>(valores.periodo);
  const [desde, setDesde] = useState(valores.desde);
  const [hasta, setHasta] = useState(valores.hasta);
  const [estado, setEstado] = useState<string>(valores.estado);
  const [letra, setLetra] = useState<string>(valores.letra);
  const [puntoDeVenta, setPuntoDeVenta] = useState(valores.puntoDeVenta);
  const [buscar, setBuscar] = useState(valores.texto);
  return (
    <form method="get" action={filtros.accion} role="search" className={estilos["formulario"]}>
      <div className={estilos["buscar"]}>
        <Campo
          etiqueta={textos.buscar}
          nombre="texto"
          tipo="search"
          autoComplete="off"
          valor={buscar}
          alCambiar={setBuscar}
        />
      </div>
      <details className={estilos["panel"]}>
        <summary className={estilos["resumen"]}>{textos.filtros}</summary>
        <div className={estilos["campos"]}>
          <Selector
            etiqueta={textos.periodo}
            nombre="periodo"
            valor={periodo}
            alCambiar={setPeriodo}
            opciones={filtros.periodos}
          />
          <div className={estilos["fechas"]}>
            <Campo
              etiqueta={textos.desde}
              nombre="desde"
              tipo="date"
              valor={desde}
              alCambiar={setDesde}
            />
            <Campo
              etiqueta={textos.hasta}
              nombre="hasta"
              tipo="date"
              valor={hasta}
              alCambiar={setHasta}
            />
          </div>
          <Selector
            etiqueta={textos.estado}
            nombre="estado"
            valor={estado}
            alCambiar={setEstado}
            textoDeElegir={textos.todos}
            opciones={filtros.estados}
          />
          <Selector
            etiqueta={textos.letra}
            nombre="letra"
            valor={letra}
            alCambiar={setLetra}
            textoDeElegir={textos.todas}
            opciones={filtros.letras}
          />
          {filtros.puntosDeVenta.length === 0 ? null : (
            <Selector
              etiqueta={textos.puntoDeVenta}
              nombre="puntoDeVenta"
              valor={puntoDeVenta}
              alCambiar={setPuntoDeVenta}
              textoDeElegir={textos.todos}
              opciones={filtros.puntosDeVenta}
            />
          )}
        </div>
      </details>
      <div className={estilos["acciones"]}>
        <Boton tipo="submit">{textos.aplicar}</Boton>
        <a className={estilos["limpiar"]} href={filtros.direccionDeLimpiar}>
          {textos.limpiar}
        </a>
      </div>
    </form>
  );
}
