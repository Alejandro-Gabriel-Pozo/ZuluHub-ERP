"use client";

import { useState } from "react";
import type { CodigoDeStock } from "../../../../../src/capacidades/experiencia/respuesta-de-stock";
import { REGLA_DE_CANTIDAD } from "../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoNumero } from "../../componentes/CampoNumero";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { Texto } from "../../primitivas/Texto";
import estilos from "./FormularioDeNuevaOrden.module.css";
import type { CierreArmado } from "./modelo-de-cierre-de-orden";

/** El código con que el servidor avisa «va a quedar en negativo» (nivel AVISAR): el botón pasa a «Producir igual» y el próximo envío confirma con la misma clave. */
const CODIGO_DE_AVISO = "STOCK_CONTROL_AVISA" satisfies CodigoDeStock;

export type PropsDeFormularioDeCierreDeOrden = Readonly<{
  /** La acción de servidor con la orden y la clave de idempotencia ya ligadas con `bind`: repetir el envío no cierra dos veces. */
  accion: AccionDeFormulario;
  cierre: CierreArmado;
  /** Si el servidor deja cerrar hoy: si no, el botón sale apagado. Solo una ayuda: el guard decide. */
  puedeEnviar: boolean;
}>;

/**
 * El formulario de «Cerrar con lo real» (maqueta `produccion.html`, 09/11/2026): lo real de cada ingrediente (con lo esperado de valor inicial; en blanco es «no se usó»), la cantidad obtenida y, si el artículo lo
 * pide, el vencimiento. Cerrar mueve el stock en UNA transacción del servidor. Con faltante de insumo y el control en AVISAR, el servidor avisa (el aviso sale debajo) y el botón pasa a «Producir igual»: reenvía
 * confirmando con la MISMA clave, así que no se duplica. Cambiar cualquier dato descarta la confirmación: lo que se confirma es lo que se vio. Las cantidades viajan como texto decimal canónico (`CampoNumero`,
 * ADR-006); cada consumo va por posición (el servidor arma el producto y la unidad desde la orden). La validez (mayor que cero, cuatro decimales, vencimiento) la decide el servidor.
 */
export function FormularioDeCierreDeOrden({
  accion,
  cierre,
  puedeEnviar,
}: PropsDeFormularioDeCierreDeOrden) {
  const [obtenido, setObtenido] = useState(cierre.obtenidoInicial);
  const [consumos, setConsumos] = useState(cierre.renglones.map((r) => r.inicial));
  const [vence, setVence] = useState("");
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
  const completo = obtenido.trim() !== "";
  return (
    <FormularioDeAccion accion={conAviso}>
      <Texto variante="subtitulo">{cierre.producto}</Texto>
      <Texto como="h2" variante="subtitulo">
        {cierre.textos.consumio}
      </Texto>
      {cierre.renglones.map((renglon, indice) => (
        <CampoNumero
          // La posición es la identidad del renglón: el servidor arma cada consumo con el renglón de la orden que ocupa ese lugar.
          key={`${String(indice)}-${renglon.etiqueta}`}
          dato="consumo-real-de-ingrediente"
          etiqueta={renglon.etiqueta}
          nombre="consumos"
          valor={consumos[indice] ?? ""}
          alCambiar={(valor) => {
            setAvisado(false);
            setConsumos((previos) => previos.map((v, i) => (i === indice ? valor : v)));
          }}
          regla={REGLA_DE_CANTIDAD}
        />
      ))}
      <CampoNumero
        dato="cantidad-obtenida-de-orden"
        etiqueta={`${cierre.textos.obtenido} (${cierre.unidad})`}
        nombre="obtenido"
        valor={obtenido}
        alCambiar={(valor) => {
          setAvisado(false);
          setObtenido(valor);
        }}
        regla={REGLA_DE_CANTIDAD}
      />
      <Campo
        dato="vencimiento-del-lote-de-orden"
        etiqueta={cierre.textos.vence}
        nombre="vence"
        valor={vence}
        alCambiar={(valor) => {
          setAvisado(false);
          setVence(valor);
        }}
        tipo="date"
        autoComplete="off"
      />
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={cierre.hrefDeCancelar}>
          {cierre.textos.cancelar}
        </a>
        {puedeEnviar && completo ? (
          <BotonDeEnvio>
            {avisado ? cierre.textos.producirIgual : cierre.textos.cerrar}
          </BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{cierre.textos.cerrar}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
