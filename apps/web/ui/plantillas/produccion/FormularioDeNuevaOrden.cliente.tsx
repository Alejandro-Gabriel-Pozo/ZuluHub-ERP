"use client";

import { useState } from "react";
import type { CodigoDeStock } from "../../../../../src/capacidades/experiencia/respuesta-de-stock";
import { REGLA_DE_CANTIDAD } from "../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { Boton } from "../../componentes/Boton.cliente";
import { CampoNumero } from "../../componentes/CampoNumero";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import estilos from "./FormularioDeNuevaOrden.module.css";
import type { OpcionDeProducto, TextosDeNuevaOrden } from "./modelo-de-nueva-orden";

/** El código con que el servidor avisa «va a quedar en negativo» (nivel AVISAR): el botón pasa a «Producir igual» y el próximo envío confirma con la misma clave. */
const CODIGO_DE_AVISO = "STOCK_CONTROL_AVISA" satisfies CodigoDeStock;

export type PropsDeFormularioDeNuevaOrden = Readonly<{
  /** La acción de servidor con la clave de idempotencia ya ligada con `bind`: repetir el envío no duplica la orden. */
  accion: AccionDeFormulario;
  textos: TextosDeNuevaOrden;
  productos: readonly OpcionDeProducto[];
  hrefDeCancelar: string;
  /** Si el servidor deja abrir hoy: si no, el botón sale apagado. Solo una ayuda: el guard decide. */
  puedeEnviar: boolean;
}>;

/**
 * El formulario de «Nueva orden» (maqueta `produccion.html`, 09/11/2026): el producto, la cantidad a producir y «Abrir orden». Abrir no mueve stock; con faltante y el control en AVISAR, el servidor avisa
 * (el aviso sale debajo) y el botón pasa a «Producir igual»: reenvía confirmando con la MISMA clave, así que no se duplica. Cambiar el producto o la cantidad descarta la confirmación: lo que se confirma es lo
 * que se vio. La cantidad viaja como texto decimal canónico (`CampoNumero`, ADR-006); su validez (mayor que cero, cuatro decimales) la decide el servidor.
 */
export function FormularioDeNuevaOrden({
  accion,
  textos,
  productos,
  hrefDeCancelar,
  puedeEnviar,
}: PropsDeFormularioDeNuevaOrden) {
  const [producto, setProducto] = useState(productos[0]?.valor ?? "");
  const [cantidad, setCantidad] = useState("");
  const [avisado, setAvisado] = useState(false);
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
  const completo = producto !== "" && cantidad.trim() !== "";
  return (
    <FormularioDeAccion accion={conAviso}>
      <Selector
        dato="producto-a-producir"
        etiqueta={textos.producto}
        nombre="productoId"
        valor={producto}
        alCambiar={(valor) => {
          setAvisado(false);
          setProducto(valor);
        }}
        opciones={productos}
      />
      <CampoNumero
        dato="cantidad-a-producir"
        etiqueta={textos.cantidad}
        nombre="cantidad"
        valor={cantidad}
        alCambiar={(valor) => {
          setAvisado(false);
          setCantidad(valor);
        }}
        regla={REGLA_DE_CANTIDAD}
      />
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeCancelar}>
          {textos.cancelar}
        </a>
        {puedeEnviar && completo ? (
          <BotonDeEnvio>{avisado ? textos.producirIgual : textos.abrir}</BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{textos.abrir}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
