"use client";

import type { ReactNode } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Superposicion } from "../../patrones/Superposicion";
import { formatearImporte } from "../../patrones/formato-fiscal";
import estilos from "../cobrar/Cobrar.module.css";
import type { TextosDeCobrar } from "../cobrar/textos-de-cobrar";
import type { LineaACero } from "./modelo-de-la-cuenta";

export type PropsDeConfirmarVentaACero = Readonly<{
  /** El total que cotizó el servidor (texto decimal). */
  total: string;
  lineasACero: readonly LineaACero[];
  textos: Pick<TextosDeCobrar, "total" | "confirmar" | "cancelar" | "enviando" | "cerrar">;
  alConfirmar: () => void;
  alCancelar: () => void;
  /** El envío está en curso: «Confirmar» no vuelve a enviar. */
  ocupado: boolean;
  /** El envío está en curso o incierto: no se cierra ni se cancela (otra clave u otro pedido podría duplicar el ticket). Por defecto, igual a `ocupado`. */
  congelado?: boolean | undefined;
  /** «Confirmar» apagado, con su motivo (sin conexión), si corresponde. */
  bloqueado?: boolean | undefined;
  motivo?: string | undefined;
  /** Lo que devolvió el servidor (un rechazo o un error inesperado), ya dibujado. */
  avisos?: ReactNode;
}>;

/**
 * El diálogo de la venta a $ 0 (maqueta `venta-rapida-v4.html:915-918`, decisión 155): «Total» con el importe, una fila por cada línea a $ 0 y «Confirmar» / «Cancelar». Sin campos. Es un cuadro de diálogo
 * (`Superposicion`, propósito «confirmar»): el foco inicial va al título, Escape cancela y el foco vuelve a «Cobrar». Mientras `ocupado` no se vuelve a confirmar y mientras `congelado` no se cierra (un doble toque es un solo envío).
 */
export function ConfirmarVentaACero({
  total,
  lineasACero,
  textos,
  alConfirmar,
  alCancelar,
  ocupado,
  congelado = ocupado,
  bloqueado = false,
  motivo,
  avisos,
}: PropsDeConfirmarVentaACero) {
  return (
    <Superposicion
      abierta
      titulo={`${textos.total} ${formatearImporte(total)}`}
      proposito="confirmar"
      alCerrar={alCancelar}
      cerrable={!congelado}
      etiquetaDeCerrar={textos.cerrar}
    >
      <div className={estilos["cuerpo"]}>
        <ul className={estilos["resumen"]}>
          {lineasACero.map((linea) => (
            <li key={linea.lineaId}>
              <span>{linea.nombre}</span>
              <span>{formatearImporte("0.00")}</span>
            </li>
          ))}
        </ul>
        {avisos}
        <div className={estilos["acciones"]}>
          <Boton
            ancho="completo"
            deshabilitado={bloqueado}
            motivo={motivo}
            enviando={ocupado}
            textoEnviando={textos.enviando}
            alTocar={alConfirmar}
          >
            {textos.confirmar}
          </Boton>
          <Boton
            variante="secundaria"
            ancho="completo"
            deshabilitado={congelado}
            alTocar={alCancelar}
          >
            {textos.cancelar}
          </Boton>
        </div>
      </div>
    </Superposicion>
  );
}
