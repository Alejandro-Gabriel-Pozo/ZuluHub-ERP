"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Casilla } from "../../componentes/Casilla";
import { Selector } from "../../componentes/Selector";
import estilos from "./PantallasDelDirectorio.module.css";
import type { FiltrosArmados } from "./modelo-de-directorio";

export type PropsDeFormularioDeFiltrosDelDirectorio = Readonly<{ filtros: FiltrosArmados }>;

/**
 * Los filtros de la lista de clientes y proveedores (maqueta `directorio.html`; el selector de rol y el botón «Aplicar filtros» en vez de filtrar al escribir son decisión del dueño, 18/11/2026,
 * `decisiones-del-dueno-2026-11.md` fila 294): buscar, rol y «Mostrar desactivados». Un formulario GET que anda sin JavaScript (cada campo lleva su `name`; la casilla marcada manda
 * `desactivados=on`); el estado de acá solo mantiene los campos controlados. El que arma la pantalla le pone `key` con los filtros de la dirección para que un filtro nuevo lo reinicie.
 * Sin textos propios: todos llegan resueltos.
 */
export function FormularioDeFiltrosDelDirectorio({
  filtros,
}: PropsDeFormularioDeFiltrosDelDirectorio) {
  const { valores, textos } = filtros;
  const [buscar, setBuscar] = useState(valores.texto);
  const [rol, setRol] = useState<string>(valores.rol);
  const [desactivados, setDesactivados] = useState(valores.desactivados);
  return (
    <form method="get" action={filtros.accion} role="search" className={estilos["filtros"]}>
      <div className={estilos["buscar"]}>
        <Campo
          dato="texto-de-busqueda-de-parte"
          etiqueta={textos.buscar}
          nombre="texto"
          tipo="search"
          autoComplete="off"
          valor={buscar}
          alCambiar={setBuscar}
        />
      </div>
      <Selector
        dato="rol-de-busqueda-de-parte"
        etiqueta={textos.rol}
        nombre="rol"
        valor={rol}
        alCambiar={setRol}
        textoDeElegir={textos.todos}
        opciones={filtros.roles}
      />
      <Casilla
        dato="incluir-desactivadas-de-parte"
        etiqueta={textos.desactivados}
        nombre="desactivados"
        marcada={desactivados}
        alCambiar={setDesactivados}
      />
      <div className={estilos["acciones"]}>
        <Boton tipo="submit">{textos.aplicar}</Boton>
      </div>
    </form>
  );
}
