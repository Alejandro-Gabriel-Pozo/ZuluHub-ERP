"use client";

import { useState } from "react";
import type { CodigoDeStock } from "../../../../../../src/capacidades/experiencia/respuesta-de-stock";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { Selector } from "../../../componentes/Selector";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../../patrones/FormularioDeAccion.cliente";
import estilos from "./FormularioDeMovimiento.module.css";
import {
  CAMPOS_DEL_TIPO,
  MOTIVO_CON_COSTO,
  type Opcion,
  type TipoDeMovimiento,
} from "./modelo-de-formularios";

/** El código con que el servidor avisa «va a quedar en negativo» (nivel AVISAR): la pantalla muestra su texto y el próximo envío lo confirma con la misma clave. */
const CODIGO_DE_AVISO = "STOCK_CONTROL_AVISA" satisfies CodigoDeStock;

export type PropsDeFormularioDeMovimiento = Readonly<{
  tipo: TipoDeMovimiento;
  /** La acción de servidor con la clave de idempotencia (y, al anular, el movimiento) ya ligadas con `bind`: repetir el envío no duplica. */
  accion: AccionDeFormulario;
  textos: Readonly<{
    deposito: string;
    origen: string;
    destino: string;
    articulo: string;
    sentido: string;
    cantidad: string;
    motivo: string;
    costo: string;
    opcional: string;
    detalle: string;
    enviar: string;
    cancelar: string;
  }>;
  depositos: readonly Opcion[];
  articulos: readonly Opcion[];
  motivos: readonly Opcion[];
  sentidos: readonly Opcion[];
  hrefDeCancelar: string;
  /** Si el servidor deja hacerlo hoy: si no, el botón sale apagado. Solo una ayuda: el guard decide. */
  puedeEnviar: boolean;
}>;

/**
 * El formulario de los movimientos de stock a mano (maqueta `stock.html`): Entrada, Salida, Transferir, Ajustar y Anular comparten campos y envío. La cantidad, el costo y las reglas de cada motivo
 * las valida el servidor (con el nivel AVISAR el servidor avisa «va a quedar en negativo»: «Registrar» reenvía confirmando con la misma clave; con PERMITIR no aparece nunca); la pantalla solo ofrece lo que el tipo lleva (`CAMPOS_DEL_TIPO`) y apaga «enviar» mientras falte lo mínimo. La unidad es la del artículo: no se elige.
 */
export function FormularioDeMovimiento({
  tipo,
  accion,
  textos,
  depositos,
  articulos,
  motivos,
  sentidos,
  hrefDeCancelar,
  puedeEnviar,
}: PropsDeFormularioDeMovimiento) {
  const campos = CAMPOS_DEL_TIPO[tipo];
  const [deposito, setDeposito] = useState(depositos[0]?.valor ?? "");
  const [origen, setOrigen] = useState(depositos[0]?.valor ?? "");
  const [destino, setDestino] = useState(depositos[1]?.valor ?? "");
  const [articulo, setArticulo] = useState(articulos[0]?.valor ?? "");
  const [sentido, setSentido] = useState(sentidos[0]?.valor ?? "");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState(motivos[0]?.valor ?? "");
  const [costo, setCosto] = useState("");
  const [detalle, setDetalle] = useState("");
  const [avisado, setAvisado] = useState(false);
  /** Cambiar cualquier dato descarta la confirmación: lo que se confirma es lo que se vio. */
  const cambia = (poner: (valor: string) => void) => (valor: string) => {
    setAvisado(false);
    poner(valor);
  };
  const conAviso: AccionDeFormulario = async (previo, datos) => {
    if (avisado) datos.set("confirmar", "1");
    // Cuando la acción sale bien, Next redirige y el pedido no devuelve valor: por eso `| undefined`.
    const resultado: Awaited<ReturnType<AccionDeFormulario>> | undefined = await accion(
      previo,
      datos,
    );
    setAvisado(resultado?.error?.codigo === CODIGO_DE_AVISO);
    return resultado;
  };
  const completo =
    (!campos.deposito || deposito !== "") &&
    (!campos.origenYDestino || (origen !== "" && destino !== "")) &&
    (!campos.articulo || articulo !== "") &&
    (!campos.cantidad || cantidad.trim() !== "") &&
    (!campos.detalleObligatorio || detalle.trim() !== "");
  return (
    <FormularioDeAccion accion={conAviso}>
      {campos.deposito ? (
        <Selector
          dato="deposito-de-stock"
          etiqueta={textos.deposito}
          nombre="depositoId"
          valor={deposito}
          alCambiar={cambia(setDeposito)}
          opciones={depositos}
        />
      ) : null}
      {campos.origenYDestino ? (
        <>
          <Selector
            dato="deposito-de-stock"
            etiqueta={textos.origen}
            nombre="origenId"
            valor={origen}
            alCambiar={cambia(setOrigen)}
            opciones={depositos}
          />
          <Selector
            dato="deposito-de-stock"
            etiqueta={textos.destino}
            nombre="destinoId"
            valor={destino}
            alCambiar={cambia(setDestino)}
            opciones={depositos}
          />
        </>
      ) : null}
      {campos.articulo ? (
        <Selector
          dato="articulo-de-stock"
          etiqueta={textos.articulo}
          nombre="articuloId"
          valor={articulo}
          alCambiar={cambia(setArticulo)}
          opciones={articulos}
        />
      ) : null}
      {campos.sentido ? (
        <Selector
          dato="sentido-de-ajuste"
          etiqueta={textos.sentido}
          nombre="sentido"
          valor={sentido}
          alCambiar={cambia(setSentido)}
          opciones={sentidos}
        />
      ) : null}
      {campos.cantidad ? (
        <Campo
          dato="cantidad-de-movimiento-de-stock"
          etiqueta={textos.cantidad}
          nombre="cantidad"
          valor={cantidad}
          alCambiar={cambia(setCantidad)}
          inputMode="decimal"
          autoComplete="off"
        />
      ) : null}
      {campos.motivo ? (
        <Selector
          dato="motivo-de-movimiento-de-stock"
          etiqueta={textos.motivo}
          nombre="motivo"
          valor={motivo}
          alCambiar={cambia(setMotivo)}
          opciones={motivos}
        />
      ) : null}
      {campos.costo && motivo === MOTIVO_CON_COSTO ? (
        <Campo
          dato="costo-por-unidad-de-entrada"
          etiqueta={textos.costo}

          ayuda={textos.opcional}
          nombre="costoUnitario"
          valor={costo}
          alCambiar={cambia(setCosto)}
          inputMode="decimal"
          autoComplete="off"
        />
      ) : null}
      {tipo === "ENTRADA" || tipo === "SALIDA" || tipo === "AJUSTAR" || tipo === "ANULAR" ? (
        <AreaDeTexto
          dato="detalle-de-movimiento-de-stock"
          etiqueta={textos.detalle}
          nombre="detalle"
          valor={detalle}
          alCambiar={cambia(setDetalle)}
        />
      ) : null}
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeCancelar}>
          {textos.cancelar}
        </a>
        {puedeEnviar && completo ? (
          <BotonDeEnvio>{textos.enviar}</BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{textos.enviar}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
