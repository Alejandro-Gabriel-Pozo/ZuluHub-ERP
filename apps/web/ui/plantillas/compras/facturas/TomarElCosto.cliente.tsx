"use client";

import { useEffect, useState } from "react";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../../componentes/Aviso";
import { Boton } from "../../../componentes/Boton.cliente";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import { Texto } from "../../../primitivas/Texto";
import { irAPorDefecto } from "../nueva/apoyo-de-nueva-compra";
import { useEnvioDeLaCompra } from "../nueva/useEnvioDeLaCompra.cliente";
import { rutaDeLaFactura } from "../rutas-de-compras";
import { comoRegistro } from "./apoyo-de-facturas";
import type { TextosDeFacturas } from "./textos-de-facturas";

export type PropsDeTomarElCosto = Readonly<{
  comprobanteId: string;
  recepcionId: string;
  linea: number;
  /** Lo que muestra la hoja: el producto, la sucursal con lo recibido y el precio neto de la factura, ya armados por el servidor (no se escribe nada). */
  hoja: Readonly<{ producto: string; sucursalYCantidad: string; precioNeto: string }>;
  /** `tomarElCostoAccion`: el pedido sale con la clave del intento, la recepción y la línea (el precio no viaja) y vuelve lo hecho (o el rechazo ya traducido). */
  tomar: (
    pedido: unknown,
  ) => Promise<Respuesta<Readonly<{ recepcionId: string; linea: number; yaExistia: boolean }>>>;
  textos: Pick<
    TextosDeFacturas,
    "tomarElCosto" | "cancelar" | "cerrar" | "enviando" | "reintentar"
  >;
  /** Adónde va al terminar. Por defecto, una navegación completa al detalle de la factura. */
  irA?: (ruta: string) => void;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * «Tomar el costo de la factura» (maqueta `compra-conciliar.html`, estados «Tomar el costo» y «Costo tomado»; decisión del dueño del 25/11/2026, «b chica»): el botón de cada línea recibida conciliada
 * entera con esta línea de la factura y todavía sin costo, para gerente y administrador. Abre una hoja con el producto, la sucursal, lo recibido y el «Precio neto» de la factura, ya cargado y SIN poder
 * editarse (no se escribe nada: el precio lo lee el servidor de la factura). El envío es el de un intento (`useEnvioDeLaCompra`): el botón se apaga al primer toque y un reintento manda la misma clave con
 * el mismo pedido, así que no hay dos tomas. Si el servidor rechaza muestra el genérico. Mostrar no es autorizar. Al terminar recarga el detalle.
 */
export function TomarElCosto({
  comprobanteId,
  recepcionId,
  linea,
  hoja,
  tomar,
  textos,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
}: PropsDeTomarElCosto) {
  const [abierta, setAbierta] = useState(false);
  const { envio, comprar, inesperado } = useEnvioDeLaCompra({
    accion: comoRegistro(tomar, (c) => c.recepcionId),
    diccionario: {},
    esperaEntreVerificacionesMs,
  });
  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";

  useEffect(() => {
    if (hecho) irA(rutaDeLaFactura(comprobanteId));
  }, [hecho, irA, comprobanteId]);

  return (
    <>
      <Boton
        variante="secundaria"
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {textos.tomarElCosto}
      </Boton>
      <Superposicion
        abierta={abierta}
        proposito="editar"
        titulo={textos.tomarElCosto}
        alCerrar={() => {
          setAbierta(false);
        }}
        cerrable={!envio.enCurso}
        etiquetaDeCerrar={textos.cerrar}
      >
        <Pila separacion={3}>
          <Texto>{hoja.producto}</Texto>
          <Texto>{hoja.sucursalYCantidad}</Texto>
          <Texto>{hoja.precioNeto}</Texto>
          {estado.tipo === "rechazado" ? <ErrorDelDetalle error={estado.rechazo} /> : null}
          {incierto ? (
            <Aviso
              tono="aviso"
              accion={
                envio.enCurso ? undefined : (
                  <Boton ancho="completo" variante="secundaria" alTocar={envio.enviar}>
                    {textos.reintentar}
                  </Boton>
                )
              }
            >
              <Texto>{envio.motivoQueNoPuede ?? ""}</Texto>
              {inesperado?.referencia === undefined ? null : <Texto>{inesperado.referencia}</Texto>}
            </Aviso>
          ) : null}
          <Boton
            variante="secundaria"
            alTocar={() => {
              setAbierta(false);
            }}
            deshabilitado={envio.enCurso || hecho}
          >
            {textos.cancelar}
          </Boton>
          <Boton
            ancho="completo"
            alTocar={() => {
              if (envio.enCurso || incierto || hecho) return;
              comprar({ recepcionId, linea });
            }}
            enviando={envio.enCurso || hecho}
            textoEnviando={textos.enviando}
            deshabilitado={!envio.enCurso && !hecho && envio.bloqueado}
            motivo={incierto ? undefined : envio.motivoQueNoPuede}
          >
            {textos.tomarElCosto}
          </Boton>
        </Pila>
      </Superposicion>
    </>
  );
}
