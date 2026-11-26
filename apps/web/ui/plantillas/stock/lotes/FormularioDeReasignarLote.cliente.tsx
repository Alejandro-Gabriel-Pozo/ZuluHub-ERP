"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { REGLA_DE_CANTIDAD } from "../../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { Selector } from "../../../componentes/Selector";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../../patrones/FormularioDeAccion.cliente";
import estilos from "./FormularioDeLote.module.css";

export type PropsDeFormularioDeReasignarLote = Readonly<{
  /** La acción de servidor con la clave de este gesto, el artículo y el lote de origen ya ligados (`bind`): el mismo clic repetido es una sola reasignación. */
  accion: AccionDeFormulario;
  /** El lote de origen (su código ya resuelto) y la unidad del artículo. */
  origen: string;
  unidad: string;
  /** Los depósitos donde el lote de origen tiene existencia, y los lotes EXISTENTES que pueden recibirla (nunca se crea uno desde acá). */
  depositos: readonly Readonly<{ valor: string; etiqueta: string }>[];
  destinos: readonly Readonly<{ valor: string; etiqueta: string }>[];
  /** Adónde lleva «Cancelar» (volver a los lotes del artículo). */
  hrefDeCancelar: string;
  /** Si la persona puede reasignar (el servidor igual decide). */
  puedeEnviar: boolean;
}>;

/**
 * «Reasignar» (maqueta `stock-lotes.html`, FP-STK-16): mueve existencia del lote de origen (normalmente «Sin asignar») a otro lote que ya existe, en un depósito. No toca el libro ni el saldo del artículo, solo cómo se reparte
 * entre lotes. La cantidad es texto decimal exacto (`CampoNumero`), nunca `number`; el motivo es obligatorio. «Registrar» sale apagado hasta tener depósito, destino, cantidad y motivo (ayuda: el servidor valida todo, también
 * que no pase del saldo del lote). Si el servidor rechaza, se vuelve a pedir la pantalla por si cambió lo que se veía.
 */
export function FormularioDeReasignarLote({
  accion,
  origen,
  unidad,
  depositos,
  destinos,
  hrefDeCancelar,
  puedeEnviar,
}: PropsDeFormularioDeReasignarLote) {
  const router = useRouter();
  const [deposito, setDeposito] = useState(depositos[0]?.valor ?? "");
  const [destino, setDestino] = useState(destinos[0]?.valor ?? "");
  const [cantidad, setCantidad] = useState("");
  const [detalle, setDetalle] = useState("");
  const conRecarga: AccionDeFormulario = async (previo, datos) => {
    const resultado = await accion(previo, datos);
    if (resultado?.error !== null && resultado !== undefined) router.refresh();
    return resultado;
  };
  const completo = deposito !== "" && destino !== "" && cantidad !== "" && detalle.trim() !== "";
  return (
    <FormularioDeAccion accion={conRecarga}>
      <div className={estilos["campos"]}>
        <strong className={estilos["nombre"]}>{origen}</strong>
        <Selector
          dato="deposito-de-stock"
          etiqueta={texto({}, "stock.pantalla.depositos")}
          nombre="depositoId"
          valor={deposito}
          alCambiar={setDeposito}
          opciones={depositos}
        />
        <Selector
          dato="lote-de-destino-de-reasignacion"
          etiqueta={texto({}, "lotes.lote.lote")}
          nombre="loteDestinoId"
          valor={destino}
          alCambiar={setDestino}
          opciones={destinos}
        />
        <CampoNumero
          dato="cantidad-de-movimiento-de-stock"
          etiqueta={texto({}, "stock.accion.cantidad")}
          nombre="cantidad"
          valor={cantidad}
          alCambiar={setCantidad}
          regla={REGLA_DE_CANTIDAD}
        />
        <span>{unidad}</span>
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
          {puedeEnviar && completo ? (
            <BotonDeEnvio>{texto({}, "stock.accion.registrar")}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{texto({}, "stock.accion.registrar")}</Boton>
          )}
        </div>
      </div>
    </FormularioDeAccion>
  );
}
