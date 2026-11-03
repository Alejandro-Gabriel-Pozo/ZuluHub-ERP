"use client";

import { useId } from "react";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton";
import { Pila } from "../../primitivas/Pila";
import estilos from "./AsistenteDeCertificado.module.css";
import { nombreDelArchivoDelPedido } from "./modelo-de-certificado";

export type PropsDePasoDelPedido = Readonly<{
  /** El pedido (CSR) en PEM: público, es lo que se sube a ARCA. Se muestra una sola vez, acá; no se vuelve a pedir al servidor. */
  pedidoPem: string;
  alias: string;
  alSiguiente: () => void;
  /** Para decir en qué título se enfoca al llegar a este paso. */
  idDelTitulo: string;
}>;

/** Baja el pedido como archivo `.csr` desde la memoria de la pantalla (no pasa por el servidor ni se registra). */
function descargar(pedidoPem: string, alias: string): void {
  const url = URL.createObjectURL(new Blob([pedidoPem], { type: "application/pkcs10" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreDelArchivoDelPedido(alias);
  enlace.click();
  URL.revokeObjectURL(url);
}

/**
 * Paso 2 del asistente: el pedido para subir a ARCA, con «Copiar» y «Descargar» (dueño, 2026-11-03, cuestionario «Certificado»: se
 * muestra UNA sola vez, al generarlo; si se pierde, se genera otro). «Siguiente» no verifica nada: Pedernal no sabe si ya se subió.
 * Copiar y descargar no cambian datos, así que repetirlos no duplica nada. Sin texto de confirmación: ninguno está aprobado.
 */
export function PasoDelPedido({
  pedidoPem,
  alias,
  alSiguiente,
  idDelTitulo,
}: PropsDePasoDelPedido) {
  const idDelArea = useId();
  return (
    <Pila separacion={4}>
      <textarea
        id={idDelArea}
        className={estilos["area"]}
        readOnly
        rows={10}
        aria-labelledby={idDelTitulo}
        value={pedidoPem}
        spellCheck={false}
      />
      <div className={estilos["botones"]}>
        <Boton
          variante="secundaria"
          alTocar={() => {
            // Sin permiso o sin contexto seguro el navegador rechaza: el pedido sigue a la vista para copiarlo a mano.
            navigator.clipboard.writeText(pedidoPem).catch(() => undefined);
          }}
        >
          {texto({}, "fiscal.pantalla.config_cert_copiar")}
        </Boton>
        <Boton
          variante="secundaria"
          alTocar={() => {
            descargar(pedidoPem, alias);
          }}
        >
          {texto({}, "fiscal.pantalla.config_cert_descargar")}
        </Boton>
      </div>
      <div className={estilos["botones"]}>
        <Boton alTocar={alSiguiente}>{texto({}, "fiscal.pantalla.config_cert_siguiente")}</Boton>
      </div>
    </Pila>
  );
}
