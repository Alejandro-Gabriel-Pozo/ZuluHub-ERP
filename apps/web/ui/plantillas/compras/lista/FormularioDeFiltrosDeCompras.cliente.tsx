"use client";

import { useState } from "react";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { OpcionesExcluyentes } from "../../../componentes/OpcionesExcluyentes";
import type { FiltroAplicado } from "../rutas-de-compras";
import type { OpcionDeEstado } from "./modelo-de-lista-de-compras";
import estilos from "./FormularioDeFiltrosDeCompras.module.css";

export type PropsDeFormularioDeFiltrosDeCompras = Readonly<{
  /** Adónde envía el formulario (GET): la lista. */
  accion: string;
  filtro: FiltroAplicado;
  estados: readonly OpcionDeEstado[];
  textos: Readonly<{ desde: string; hasta: string; aplicar: string }>;
}>;

/**
 * Los filtros de la lista de compras: un formulario GET que anda sin JavaScript (cada campo lleva su `name` y el botón es de envío). Los chips son botones de opción nativos: viajan como `estado`.
 * El estado de acá solo mantiene los campos controlados; el que arma la pantalla le pone `key` con el filtro aplicado para que un filtro nuevo lo reinicie. No lleva ninguna regla: lo permitido
 * lo decide el servidor (`entradas-de-compras.ts`) y lo que vuelve a la dirección es lo que se aplicó.
 */
export function FormularioDeFiltrosDeCompras({
  accion,
  filtro,
  estados,
  textos,
}: PropsDeFormularioDeFiltrosDeCompras) {
  const [estado, setEstado] = useState<string>(filtro.estado);
  const [desde, setDesde] = useState(filtro.desde ?? "");
  const [hasta, setHasta] = useState(filtro.hasta ?? "");
  return (
    <form method="get" action={accion} className={estilos["formulario"]}>
      <OpcionesExcluyentes
        dato="estado-de-compra-de-busqueda"
        nombre="estado"
        valor={estado}
        alCambiar={setEstado}
        opciones={estados}
      />
      <div className={estilos["fechas"]}>
        <Campo
          dato="fecha-desde-de-compra"
          etiqueta={textos.desde}
          nombre="desde"
          tipo="date"
          valor={desde}
          alCambiar={setDesde}
        />
        <Campo
          dato="fecha-hasta-de-compra"
          etiqueta={textos.hasta}
          nombre="hasta"
          tipo="date"
          valor={hasta}
          alCambiar={setHasta}
        />
      </div>
      <div className={estilos["acciones"]}>
        <Boton tipo="submit">{textos.aplicar}</Boton>
      </div>
    </form>
  );
}
