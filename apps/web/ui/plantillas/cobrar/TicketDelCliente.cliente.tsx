"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonIcono } from "../../componentes/BotonIcono";
import { EstiloDePagina } from "../facturacion/impresion/EstiloDePagina";
import { MARCA_DE_LA_ZONA } from "../facturacion/impresion/regla-de-pagina";
import estilosDelPapel from "../facturacion/impresion/PapelDelCliente.module.css";
import estilos from "./Cobrar.module.css";
import { PapelDelTicket, type PapelDeTicket } from "./PapelDelTicket.cliente";
import type { TextosDeCobrar } from "./textos-de-cobrar";

export type PropsDelTicketDelCliente = Readonly<{
  papel: PapelDeTicket;
  textos: TextosDeCobrar;
  alVolver: () => void;
}>;

/**
 * La vista «Ticket del cliente» (maqueta `venta-rapida-v4.html` `vTicket`): «‹» (Volver), el papel y «Imprimir», que abre el diálogo de impresión del navegador (`window.print()`; sin librería ni impresora directa). Solo el
 * papel está en la zona de impresión (`MARCA_DE_LA_ZONA`): la barra y el botón no salen en el rollo. Al abrir, el foco va al título. No escribe nada: imprimir una y otra vez no cambia el ticket ni la caja.
 */
export function TicketDelCliente({ papel: datos, textos, alVolver }: PropsDelTicketDelCliente) {
  const idDelTitulo = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const [alto, setAlto] = useState<number | null>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);
  return (
    <section className={estilos["vista"]} aria-labelledby={idDelTitulo}>
      <header className={estilos["encabezado"]}>
        <BotonIcono etiqueta={textos.volver} icono="atras" alTocar={alVolver} />
        <h2 id={idDelTitulo} ref={tituloRef} tabIndex={-1} className={estilos["titulo"]}>
          {textos.ticketDelCliente}
        </h2>
      </header>
      <div {...{ [MARCA_DE_LA_ZONA]: "" }} className={estilosDelPapel["zona"]}>
        <EstiloDePagina formato="TICKET" altoDelTicketEnMm={alto} />
        <PapelDelTicket papel={datos} textos={textos} alMedirElAlto={setAlto} />
      </div>
      <div className={estilos["pie"]}>
        <Boton
          ancho="completo"
          alTocar={() => {
            window.print();
          }}
        >
          {textos.imprimir}
        </Boton>
      </div>
    </section>
  );
}
