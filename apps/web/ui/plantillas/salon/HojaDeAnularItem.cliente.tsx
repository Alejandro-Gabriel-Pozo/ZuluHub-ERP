"use client";

import { useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoNumero } from "../../componentes/CampoNumero";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../patrones/Superposicion";
import { REGLA_DE_MEDIDA } from "../venta/ControlDeCantidad.cliente";
import estilos from "./PantallaDeLaMesa.module.css";

export type PropsDeHojaDeAnularItem = Readonly<{
  /** El plato que se anula: su nombre («2 × Milanesa») y su cantidad enviada, como texto decimal. */
  plato: Readonly<{ id: string; nombre: string; cantidad: string }>;
  textos: Readonly<{
    anular: string;
    motivo: string;
    cantidad: string;
    cancelar: string;
    cerrar: string;
  }>;
  /** Hay un pedido en vuelo: la hoja no se cierra ni se manda otra vez. */
  ocupado: boolean;
  /** El rechazo del servidor (el genérico, por ejemplo), dentro de la hoja: la pantalla de atrás queda inerte. */
  error: ErrorPublico | null;
  alAnular: (pedido: Readonly<{ lineaId: string; cantidad: string; motivo: string }>) => void;
  alCancelar: () => void;
}>;

/**
 * Anular un ítem ya enviado (SAL-C, S6; maqueta `salon.html`, decisión 155): la cantidad (la enviada por defecto; menos es una anulación parcial) y el motivo, que es OBLIGATORIO. «Anular» queda apagado mientras falte el motivo o la
 * cantidad (el propio control dice qué falta; no hay un aviso aparte). La cantidad viaja como texto decimal; que no supere lo enviado, que el motivo valga y el permiso los decide el servidor, que devuelve el genérico. Sin textos propios.
 */
export function HojaDeAnularItem({
  plato,
  textos,
  ocupado,
  error,
  alAnular,
  alCancelar,
}: PropsDeHojaDeAnularItem) {
  const [cantidad, setCantidad] = useState(plato.cantidad);
  const [motivo, setMotivo] = useState("");
  const falta = cantidad === "" || motivo.trim() === "";
  return (
    <Superposicion
      abierta
      titulo={`${textos.anular}: ${plato.nombre}`}
      proposito="confirmar"
      alCerrar={alCancelar}
      cerrable={!ocupado}
      etiquetaDeCerrar={textos.cerrar}
    >
      <div className={estilos["hoja"]}>
        <CampoNumero
          dato="cantidad-de-venta"
          etiqueta={textos.cantidad}
          valor={cantidad}
          alCambiar={setCantidad}
          regla={REGLA_DE_MEDIDA}
          deshabilitado={ocupado}
        />
        <Campo
          dato="motivo-de-anulacion"
          etiqueta={textos.motivo}
          autoComplete="off"
          valor={motivo}
          alCambiar={setMotivo}
          deshabilitado={ocupado}
        />
        {error === null ? null : <ErrorDeRespuesta error={error} />}
        <div className={estilos["acciones"]}>
          <Boton variante="secundaria" deshabilitado={ocupado} alTocar={alCancelar}>
            {textos.cancelar}
          </Boton>
          <Boton
            variante="peligro"
            deshabilitado={falta}
            enviando={ocupado}
            alTocar={() => {
              alAnular({ lineaId: plato.id, cantidad, motivo: motivo.trim() });
            }}
          >
            {textos.anular}
          </Boton>
        </div>
      </div>
    </Superposicion>
  );
}
