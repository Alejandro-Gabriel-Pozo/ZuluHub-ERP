"use client";

import { useState } from "react";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { ComprobanteImpreso } from "./impresion/ComprobanteImpreso.cliente";
import type { ComprobanteParaLaHoja, FormatoDeImpresion } from "./impresion/modelo-de-la-hoja";
import estilos from "./PantallaDeImprimirComprobante.module.css";

export type PropsDePantallaDeImprimirComprobante = Readonly<{
  comprobante: ComprobanteParaLaHoja;
  /** El QR ya dibujado en el servidor (SVG como texto). */
  qrSvg: string;
  /** Adónde baja el PDF A4 de este comprobante (`direccionDelPdf`); lo arma la página, que conoce el id. */
  urlDelPdf: string;
  diccionario?: DiccionarioResuelto;
}>;

const FORMATOS = [
  { valor: "A4", clave: "fiscal.pantalla.imprimir_formato_a4" },
  { valor: "TICKET", clave: "fiscal.pantalla.imprimir_formato_ticket" },
] as const satisfies readonly { valor: FormatoDeImpresion; clave: string }[];

/**
 * La vista previa para imprimir un comprobante (D-97, D-100): elegir A4 o Ticket (A4 al abrir, SUPUESTO de la maqueta v8), ver la hoja
 * y abrir el diálogo de impresión del navegador, o descargar el PDF A4 (un enlace: la descarga la sirve el servidor, que vuelve a decidir
 * el permiso; el PDF es siempre A4, también con Ticket elegido: el ticket queda para una entrega posterior). Los controles quedan FUERA de la zona de impresión (`ComprobanteImpreso` la marca): al
 * imprimir solo sale la hoja. Sin textos propios: los de las claves `fiscal.pantalla.imprimir_*`.
 */
export function PantallaDeImprimirComprobante({
  comprobante,
  qrSvg,
  urlDelPdf,
  diccionario = {},
}: PropsDePantallaDeImprimirComprobante) {
  const [formato, setFormato] = useState<FormatoDeImpresion>("A4");
  return (
    <div className={estilos["raiz"]}>
      <div className={estilos["controles"]}>
        <fieldset className={estilos["formatos"]}>
          {FORMATOS.map((f) => (
            <label key={f.valor} className={estilos["formato"]}>
              <input
                type="radio"
                name="formato"
                className={estilos["radio"]}
                checked={formato === f.valor}
                onChange={() => {
                  setFormato(f.valor);
                }}
              />
              <span className={estilos["etiqueta"]}>{texto(diccionario, f.clave)}</span>
            </label>
          ))}
        </fieldset>
        <Boton
          alTocar={() => {
            window.print();
          }}
        >
          {texto(diccionario, "fiscal.pantalla.imprimir_boton")}
        </Boton>
        <EnlaceDeAccion href={urlDelPdf}>
          {texto(diccionario, "fiscal.pantalla.imprimir_descargar_pdf")}
        </EnlaceDeAccion>
      </div>
      <ComprobanteImpreso
        comprobante={comprobante}
        qrSvg={qrSvg}
        formato={formato}
        diccionario={diccionario}
      />
    </div>
  );
}
