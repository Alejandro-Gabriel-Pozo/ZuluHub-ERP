"use client";

import { Boton } from "../../componentes/Boton.cliente";
import { Superposicion } from "../../patrones/Superposicion";
import type { MesaLibre } from "./modelo-de-la-mesa";
import estilos from "./PantallaDeLaMesa.module.css";

export type PropsDeHojaDeCambiarDeMesa = Readonly<{
  abierta: boolean;
  /** Las mesas libres a las que se puede pasar la cuenta; `null` o vacía: «No hay mesas libres». */
  mesasLibres: readonly MesaLibre[] | null;
  textos: Readonly<{ pasarALaMesa: string; noHayMesasLibres: string; cerrar: string }>;
  /** Hay un pedido en vuelo: la hoja no se cierra ni se manda otra vez. */
  ocupado: boolean;
  alElegir: (destino: MesaLibre) => void;
  alCerrar: () => void;
}>;

/** «Cambiar de mesa» (SAL-B, S4): la hoja con las mesas libres. La elección la resuelve la pantalla (corre el pedido y navega). Sin textos propios: todos llegan resueltos. */
export function HojaDeCambiarDeMesa({
  abierta,
  mesasLibres,
  textos,
  ocupado,
  alElegir,
  alCerrar,
}: PropsDeHojaDeCambiarDeMesa) {
  return (
    <Superposicion
      abierta={abierta}
      titulo={textos.pasarALaMesa}
      proposito="elegir"
      alCerrar={alCerrar}
      cerrable={!ocupado}
      etiquetaDeCerrar={textos.cerrar}
    >
      {mesasLibres === null || mesasLibres.length === 0 ? (
        <p>{textos.noHayMesasLibres}</p>
      ) : (
        <ul className={estilos["destinos"]}>
          {mesasLibres.map((destino) => (
            <li key={destino.id}>
              <Boton
                variante="secundaria"
                deshabilitado={ocupado}
                alTocar={() => {
                  alElegir(destino);
                }}
              >
                {destino.titulo}
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </Superposicion>
  );
}
