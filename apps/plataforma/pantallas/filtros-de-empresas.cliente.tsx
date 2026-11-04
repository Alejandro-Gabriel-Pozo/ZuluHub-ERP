"use client";

import { useState } from "react";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { Selector } from "../../web/ui/componentes/Selector";
import { ESTADOS_EFECTIVOS, ROTULO_DE_ESTADO } from "../logica/filtros-de-empresas";
import estilos from "./empresas.module.css";

type Opcion = Readonly<{ id: string; nombre: string }>;

export type PropsDeFiltrosDeEmpresas = Readonly<{
  submarcas: readonly Opcion[];
  planes: readonly Opcion[];
  /** Lo que ya está filtrado en la dirección (valores iniciales). */
  inicial: Readonly<{ estado: string; submarca: string; plan: string; buscar: string }>;
  hayFiltros: boolean;
}>;

const OPCIONES_DE_ESTADO = ESTADOS_EFECTIVOS.map((estado) => ({
  valor: estado,
  etiqueta: ROTULO_DE_ESTADO[estado].texto,
}));

/**
 * Los filtros son un formulario GET: funciona sin JavaScript (los campos llevan `name` y el botón es de envío).
 * El estado de acá solo mantiene los campos controlados.
 */
export function FiltrosDeEmpresas({
  submarcas,
  planes,
  inicial,
  hayFiltros,
}: PropsDeFiltrosDeEmpresas) {
  const [estado, setEstado] = useState(inicial.estado);
  const [submarca, setSubmarca] = useState(inicial.submarca);
  const [plan, setPlan] = useState(inicial.plan);
  const [buscar, setBuscar] = useState(inicial.buscar);
  return (
    <form method="get" action="/empresas" className={estilos["filtros"]} role="search">
      <Selector
        etiqueta="Estado"
        nombre="estado"
        valor={estado}
        alCambiar={setEstado}
        textoDeElegir="Todos"
        opciones={OPCIONES_DE_ESTADO}
      />
      <Selector
        etiqueta="Submarca"
        nombre="submarca"
        valor={submarca}
        alCambiar={setSubmarca}
        textoDeElegir="Todas"
        opciones={submarcas.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
      />
      <Selector
        etiqueta="Plan"
        nombre="plan"
        valor={plan}
        alCambiar={setPlan}
        textoDeElegir="Todos"
        opciones={planes.map((p) => ({ valor: p.id, etiqueta: p.nombre }))}
      />
      <Campo
        etiqueta="Buscar por nombre o CUIT"
        nombre="buscar"
        tipo="search"
        autoComplete="off"
        valor={buscar}
        alCambiar={setBuscar}
      />
      <div className={estilos["acciones"]}>
        <Boton tipo="submit">Filtrar</Boton>
        {hayFiltros ? (
          <a className={estilos["enlaceSimple"]} href="/empresas">
            Quitar filtros
          </a>
        ) : null}
      </div>
    </form>
  );
}
