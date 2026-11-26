"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../../patrones/FormularioDeAccion.cliente";
import estilos from "./FormularioDeLote.module.css";

export type PropsDeFormularioDeCorregirLote = Readonly<{
  /** La acción de servidor con el artículo, el lote y la VERSIÓN que se vio ya ligados (`bind`): si otra persona lo corrigió antes, no se pisa. */
  accion: AccionDeFormulario;
  /** El lote que se corrige (su código ya resuelto) y su fecha actual `AAAA-MM-DD`. */
  codigo: string;
  venceActual: string;
  /** Adónde lleva «Cancelar» (volver a los lotes del artículo). */
  hrefDeCancelar: string;
  /** Si la persona puede corregir (el servidor igual decide). */
  puedeEnviar: boolean;
}>;

/**
 * «Corregir» un lote (maqueta `stock-lotes.html`, FP-STK-16): la fecha de vencimiento, con el motivo (obligatorio, queda en la auditoría con el antes y el después). «Guardar» sale apagado sin fecha, sin motivo o sin el
 * permiso (`lotes.corregir`). Si el servidor rechaza (por ejemplo porque otra persona corrigió el lote mientras tanto) la pantalla se recarga con lo vigente y su versión. La fecha viaja como texto `AAAA-MM-DD`.
 */
export function FormularioDeCorregirLote({
  accion,
  codigo,
  venceActual,
  hrefDeCancelar,
  puedeEnviar,
}: PropsDeFormularioDeCorregirLote) {
  const router = useRouter();
  const [vence, setVence] = useState(venceActual);
  const [detalle, setDetalle] = useState("");
  const conRecarga: AccionDeFormulario = async (previo, datos) => {
    const resultado = await accion(previo, datos);
    // Cuando sale bien, Next redirige y el pedido no devuelve valor; si no, se vuelve a pedir el lote (puede haber cambiado de versión).
    if (resultado?.error !== null && resultado !== undefined) router.refresh();
    return resultado;
  };
  return (
    <FormularioDeAccion accion={conRecarga}>
      <div className={estilos["campos"]}>
        <strong className={estilos["nombre"]}>{codigo}</strong>
        <Campo
          dato="vencimiento-de-lote"
          etiqueta={texto({}, "stock.lotes.fecha_de_vencimiento")}
          nombre="vence"
          tipo="date"
          valor={vence}
          alCambiar={setVence}
        />
        <AreaDeTexto
          dato="detalle-de-movimiento-de-stock"
          etiqueta={texto({}, "stock.accion.detalle")}
          nombre="detalle"
          valor={detalle}
          alCambiar={setDetalle}
        />
        <div className={estilos["acciones"]}>
          <a className={estilos["secundario"]} href={hrefDeCancelar}>
            {texto({}, "catalogo.accion.cancelar")}
          </a>
          {puedeEnviar && vence !== "" && detalle.trim() !== "" ? (
            <BotonDeEnvio>{texto({}, "catalogo.accion.guardar")}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{texto({}, "catalogo.accion.guardar")}</Boton>
          )}
        </div>
      </div>
    </FormularioDeAccion>
  );
}
