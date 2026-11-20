"use client";

import { useLayoutEffect, useRef } from "react";
import { aplicarEstilos } from "../../primitivas/aplicar-estilos";
import { variablesDelTicket } from "../facturacion/impresion/geometria";
import { useAltoDelTicket } from "../facturacion/impresion/useAltoDelTicket.cliente";
import estilosDelPapel from "../facturacion/impresion/PapelDelCliente.module.css";
import type { TextosDeCobrar } from "./textos-de-cobrar";

/** El papel del ticket del cliente tal como lo armó el servidor (`papelDelTicket`): líneas ya alineadas en columnas, cada una con su estilo. */
export type PapelDeTicket = Readonly<{
  ancho: 58 | 80;
  lineas: readonly Readonly<{
    texto: string;
    estilo: "NORMAL" | "GRANDE" | "NEGRITA" | "SEPARADOR";
  }>[];
}>;

export type PropsDelPapelDelTicket = Readonly<{
  papel: PapelDeTicket;
  textos: Pick<TextosDeCobrar, "ticketDelCliente">;
  /** El largo del papel en mm (con holgura), cada vez que cambia: la vista lo usa para fijar `@page`. */
  alMedirElAlto: (altoEnMm: number) => void;
}>;

/**
 * El ticket del cliente en pantalla y en papel: una línea por renglón del servidor, con letra de ancho fijo y `white-space: pre` (las columnas ya vienen armadas: acá no se vuelven a armar). Una sola forma de armar el
 * papel, la del servidor: lo que se ve es lo que se imprime. Sin `style=` (lo bloquea la política de seguridad): el ancho va por `aplicarEstilos`, como el ticket fiscal. Mide su alto con `useAltoDelTicket`.
 */
export function PapelDelTicket({ papel: datos, textos, alMedirElAlto }: PropsDelPapelDelTicket) {
  const raiz = useRef<HTMLDivElement>(null);
  // El ancho va ANTES de medir el alto (el efecto de `useAltoDelTicket` corre después: los de layout corren primero).
  useLayoutEffect(() => {
    aplicarEstilos(raiz.current, variablesDelTicket());
  }, []);
  useAltoDelTicket(raiz, alMedirElAlto, datos);
  return (
    <div
      ref={raiz}
      role="group"
      aria-label={textos.ticketDelCliente}
      className={estilosDelPapel["papel"]}
    >
      {datos.lineas.map((linea, indice) =>
        linea.estilo === "SEPARADOR" ? (
          // Las líneas se imprimen en su orden y no se reordenan: la posición es la clave.
          <hr key={indice} className={estilosDelPapel["separador"]} />
        ) : (
          <div
            key={indice}
            className={estilosDelPapel["linea"]}
            data-estilo={linea.estilo}
            data-linea-del-papel=""
          >
            {linea.texto}
          </div>
        ),
      )}
    </div>
  );
}
