"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { aplicarEstilos } from "../../../primitivas/aplicar-estilos";
import { HOLGURA_DEL_TICKET_MM, pxAMm, variablesDelTicket } from "./geometria";
import type { FilaArmada, HojaArmada } from "./modelo-de-la-hoja";
import { Qr } from "./PiezasDeLaHoja";
import estilos from "./Ticket.module.css";

export type PropsDelTicket = Readonly<{
  a: HojaArmada;
  qrSvg: string;
  /** El largo del ticket en mm (con holgura), cada vez que cambia: la página lo usa para fijar `@page`. */
  alMedirElAlto: (altoEnMm: number) => void;
}>;

function Fila({ fila }: Readonly<{ fila: FilaArmada }>) {
  return (
    <div>
      {fila.rotulo === null ? null : <span className={estilos["negrita"]}>{fila.rotulo} </span>}
      {fila.valor}
    </div>
  );
}

/**
 * El ticket de 80 mm. Mide su propio alto (`offsetHeight`: el alto de diseño, que no cambia con el `transform` de la vista previa) una
 * vez cargadas las fuentes, y lo vuelve a medir si cambia. Chromium NO respeta `@page { size: 80mm auto }`: sin el largo en mm el
 * ticket sale en una hoja de otro tamaño. El alto se redondea hacia arriba y se le suma una holgura: nunca queda corto.
 */
export function TicketDe80mm({ a, qrSvg, alMedirElAlto }: PropsDelTicket) {
  const raiz = useRef<HTMLDivElement>(null);
  // El ancho va ANTES de medir el alto (el efecto de abajo corre después: los de layout corren primero).
  useLayoutEffect(() => {
    aplicarEstilos(raiz.current, variablesDelTicket());
  }, []);
  useEffect(() => {
    const elemento = raiz.current;
    if (elemento === null) return;
    let vigente = true;
    const medir = async () => {
      await document.fonts.ready;
      if (!vigente) return;
      alMedirElAlto(Math.ceil(pxAMm(elemento.offsetHeight)) + HOLGURA_DEL_TICKET_MM);
    };
    void medir();
    const observador = new ResizeObserver(() => void medir());
    observador.observe(elemento);
    const alCargarUnaFuente = () => void medir();
    document.fonts.addEventListener("loadingdone", alCargarUnaFuente);
    return () => {
      vigente = false;
      observador.disconnect();
      document.fonts.removeEventListener("loadingdone", alCargarUnaFuente);
    };
  }, [a, alMedirElAlto]);
  return (
    <div ref={raiz} className={estilos["ticket"]} data-ticket="">
      {a.leyendas.map((leyenda, i) => (
        <div key={i} className={estilos["homologacion"]}>
          {leyenda}
        </div>
      ))}
      {a.leyendasLegales.map((leyenda, i) => (
        <div key={i} className={estilos["leyendaLegal"]} data-leyenda-legal="">
          {leyenda}
        </div>
      ))}
      <div className={estilos["centrado"]}>
        {a.nombreDeFantasia === null ? null : (
          <div className={estilos["nombre"]}>{a.nombreDeFantasia}</div>
        )}
        {a.contacto === null ? null : <div>{a.contacto}</div>}
        {a.emisor.map((fila) => (
          <Fila key={fila.rotulo ?? fila.valor} fila={fila} />
        ))}
      </div>
      <hr className={estilos["separador"]} />
      <div className={estilos["centrado"]}>
        <div className={estilos["rotulo"]}>{a.rotulo}</div>
        <div className={estilos["rotulo"]}>{a.letra}</div>
        <div>{a.codigo}</div>
        <div className={estilos["negrita"]}>{a.numero}</div>
        {a.datos.map((fila) => (
          <Fila key={fila.rotulo ?? fila.valor} fila={fila} />
        ))}
      </div>
      <hr className={estilos["separador"]} />
      {a.corresponde === null ? null : <div className={estilos["negrita"]}>{a.corresponde}</div>}
      {a.receptor.map((fila) => (
        <Fila key={fila.rotulo ?? fila.valor} fila={fila} />
      ))}
      <hr className={estilos["separador"]} />
      {a.renglones.map((r, i) => (
        // El índice es la clave: los renglones se imprimen en su orden y no se reordenan.
        <div key={i}>
          <div>{r.descripcion}</div>
          <div className={estilos["fila"]}>
            <span className={estilos["cuenta"]}>{r.cuenta}</span>
            <span>{r.importe}</span>
          </div>
        </div>
      ))}
      <hr className={estilos["separador"]} />
      {a.totales.map((t) => (
        <div
          key={t.rotulo + t.valor}
          className={`${estilos["fila"]} ${t.fuerte ? estilos["filaFuerte"] : ""}`}
        >
          <span>{t.rotulo}</span>
          <span>{t.valor}</span>
        </div>
      ))}
      {a.transparencia === null ? null : (
        <div data-transparencia="">
          <hr className={estilos["separador"]} />
          <div className={`${estilos["centrado"]} ${estilos["negrita"]}`}>
            {a.transparencia.titulo}
          </div>
          {a.transparencia.filas.map((f) => (
            <div key={f.rotulo ?? f.valor} className={estilos["fila"]}>
              <span>{f.rotulo}</span>
              <span>{f.valor}</span>
            </div>
          ))}
        </div>
      )}
      <hr className={estilos["separador"]} />
      <div className={estilos["centrado"]}>
        <Qr qrSvg={qrSvg} clase={estilos["qr"] ?? ""} />
        <div>
          <span className={estilos["negrita"]}>{a.cae.rotulo} </span>
          {a.cae.valor}
        </div>
      </div>
    </div>
  );
}
