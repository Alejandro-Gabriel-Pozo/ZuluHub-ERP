"use client";

import { useActionState, useEffect, useState } from "react";
import { Boton } from "../../../componentes/Boton.cliente";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { Selector } from "../../../componentes/Selector";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import {
  FICHA_DE_PROVEEDOR_INICIAL,
  type ResultadoDeFichaDeProveedor,
} from "./resultado-de-proveedor";

type AccionDeHoja = (
  previo: ResultadoDeFichaDeProveedor,
  datos: FormData,
) => Promise<ResultadoDeFichaDeProveedor>;

export type PropsDeHojaDeCambioDeFicha = Readonly<{
  /** Qué se carga: el número de un punto de venta o el tipo de un comprobante. */
  campo:
    | Readonly<{
        tipo: "PUNTO_DE_VENTA";
        etiqueta: string;
        /** Cuántos dígitos tiene el mayor punto de venta (sale del dominio, no se escribe acá). */
        digitos: number;
      }>
    | Readonly<{
        tipo: "COMPROBANTE";
        etiqueta: string;
        opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
      }>;
  /** El texto del botón que abre la hoja y su título («Agregar punto de venta», «Pedir otro comprobante»). */
  titulo: string;
  /** Las líneas de explicación de la hoja, ya resueltas. */
  descripcion: readonly string[];
  /** El verbo del botón de enviar («Agregar», «Enviar pedido»). */
  textoDeEnviar: string;
  textoDeCancelar: string;
  textoDeCerrar: string;
  /** La acción con el proveedor ya ligado (`.bind`): el id del proveedor no viaja en el formulario. */
  accion: AccionDeHoja;
  /** A dónde se vuelve a cargar la ficha cuando salió bien. */
  rutaDeLaFicha: string;
}>;

/**
 * Una hoja para agregar (o pedir) un punto de venta o un comprobante de la ficha del proveedor (maqueta `compra.html`, modales `addpv` y `addtipo`). Un solo campo, «Cancelar» y el verbo. El botón queda
 * apagado sin número, y no se vuelve a tocar mientras envía (`BotonDeEnvio`); repetir el envío es seguro en el servidor (lo que ya está no se vuelve a agregar ni a pedir). Si salió bien, vuelve a cargar la
 * ficha (`window.location.assign`: la acción no redirige); si no, el error ya traducido queda en la hoja. Mostrar no es autorizar: el servidor decide.
 */
export function HojaDeCambioDeFicha({
  campo,
  titulo,
  descripcion,
  textoDeEnviar,
  textoDeCancelar,
  textoDeCerrar,
  accion,
  rutaDeLaFicha,
}: PropsDeHojaDeCambioDeFicha) {
  const [abierta, setAbierta] = useState(false);
  const [numero, setNumero] = useState("");
  const [tipo, setTipo] = useState(
    campo.tipo === "COMPROBANTE" ? (campo.opciones[0]?.valor ?? "") : "",
  );
  const [resultado, enviar, enviando] = useActionState(accion, FICHA_DE_PROVEEDOR_INICIAL);
  const hecho = resultado.estado === "HECHO";

  useEffect(() => {
    if (hecho) window.location.assign(rutaDeLaFicha);
  }, [hecho, rutaDeLaFicha]);

  const sinValor = campo.tipo === "PUNTO_DE_VENTA" ? numero === "" : tipo === "";
  return (
    <>
      <Boton
        variante="secundaria"
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {titulo}
      </Boton>
      <Superposicion
        abierta={abierta}
        proposito="editar"
        titulo={titulo}
        alCerrar={() => {
          setAbierta(false);
        }}
        cerrable={!enviando}
        etiquetaDeCerrar={textoDeCerrar}
      >
        <form action={enviar}>
          <ProveedorDeEnvioDeFormulario value={enviando}>
            <Pila separacion={3}>
              {descripcion.map((linea) => (
                <p key={linea}>{linea}</p>
              ))}
              {campo.tipo === "PUNTO_DE_VENTA" ? (
                <CampoNumero
                  dato="numero-de-punto-de-venta"
                  etiqueta={campo.etiqueta}
                  nombre="numero"
                  valor={numero}
                  alCambiar={setNumero}
                  regla={{ decimales: 0, enterosMaximos: campo.digitos }}
                />
              ) : (
                <Selector
                  dato="tipo-de-comprobante-de-ficha"
                  etiqueta={campo.etiqueta}
                  nombre="tipo"
                  valor={tipo}
                  alCambiar={setTipo}
                  opciones={campo.opciones}
                />
              )}
              {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
              <Boton
                variante="secundaria"
                ancho="completo"
                alTocar={() => {
                  setAbierta(false);
                }}
              >
                {textoDeCancelar}
              </Boton>
              <Boton tipo="submit" ancho="completo" enviando={enviando} deshabilitado={sinValor}>
                {textoDeEnviar}
              </Boton>
            </Pila>
          </ProveedorDeEnvioDeFormulario>
        </form>
      </Superposicion>
    </>
  );
}
