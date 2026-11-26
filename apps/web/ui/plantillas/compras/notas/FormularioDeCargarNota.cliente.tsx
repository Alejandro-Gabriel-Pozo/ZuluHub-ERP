"use client";

import { useEffect, useState } from "react";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../../componentes/Aviso";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { CampoImporte } from "../../../componentes/CampoImporte";
import { Selector } from "../../../componentes/Selector";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { formatearImporte } from "../../../patrones/formato-fiscal";
import { Texto } from "../../../primitivas/Texto";
import { comoRegistro } from "../facturas/apoyo-de-facturas";
import { irAPorDefecto } from "../nueva/apoyo-de-nueva-compra";
import { useEnvioDeLaCompra } from "../nueva/useEnvioDeLaCompra.cliente";
import { rutaDeLasNotas, type ClaseDeNotaParaLaRuta } from "../rutas-de-compras";
import { TIPOS_DE_NOTA_POR_CLASE } from "./modelo-de-notas";
import {
  ALICUOTAS_DE_LA_NOTA,
  NOTA_VACIA,
  armarElPedidoDeNota,
  discriminaIvaLaNota,
  type NotaEscrita,
} from "./modelo-de-pedido-de-nota";
import type { TextosDeNotas } from "./textos-de-notas";
import estilos from "../nueva/NuevaCompra.module.css";

export type PropsDeFormularioDeCargarNota = Readonly<{
  /** La clase que pide la dirección: la de la acción es otra función (`registrarNotaDeCredito` o `…Debito`), así que la clase no viaja en el pedido. */
  clase: ClaseDeNotaParaLaRuta;
  /** La factura que la nota corrige: viene de la ruta y el servidor la valida (empresa, proveedor y alcance). */
  facturaId: string;
  textos: TextosDeNotas;
  /** Solo en una nota de crédito: lo que la factura todavía puede acreditar, tal cual lo leyó el servidor al abrir (texto decimal). El servidor lo revalida al guardar, bajo el bloqueo de la factura. */
  todaviaSePuedeAcreditar: string | null;
  /** `registrarNotaDeCreditoAccion` o `registrarNotaDeDebitoAccion`: el pedido sale con la clave del intento y vuelve la nota hecha (o el rechazo ya traducido). */
  registrar: (
    pedido: unknown,
  ) => Promise<Respuesta<Readonly<{ comprobanteId: string; yaExistia: boolean }>>>;
  /** Adónde va al terminar. Por defecto, una navegación completa a «Notas de la factura». */
  irA?: (ruta: string) => void;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * «Cargar una nota del proveedor» (NOTAS-2c-1; maqueta `servicios-y-bienes-de-uso.html`, pantalla 10): la nota de crédito o de débito de la factura de la ruta, por los importes que dice el papel (neto y alícuota), con su tipo, punto
 * de venta, número, fecha y total según la nota. NO calcula nada: ni el IVA ni el total ni el tope (los valida el servidor). El envío es idempotente por intento (`useEnvioDeLaCompra`): el botón se apaga al primer toque y un
 * reintento manda la misma clave con el mismo pedido, así que no hay dos notas. Al terminar abre «Notas de la factura». Una sola alícuota por nota en esta versión.
 */
export function FormularioDeCargarNota({
  clase,
  facturaId,
  textos,
  todaviaSePuedeAcreditar,
  registrar,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
}: PropsDeFormularioDeCargarNota) {
  const [nota, setNota] = useState<NotaEscrita>(NOTA_VACIA);
  const { envio, comprar, inesperado } = useEnvioDeLaCompra({
    accion: comoRegistro(registrar, (n) => n.comprobanteId),
    diccionario: {},
    esperaEntreVerificacionesMs,
  });
  const pedido = armarElPedidoDeNota(facturaId, nota);
  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  const editable = !envio.enCurso && !incierto && !hecho;
  useEffect(() => {
    if (hecho) irA(rutaDeLasNotas(facturaId));
  }, [hecho, facturaId, irA]);

  /** Cualquier cambio de lo escrito descarta el resultado anterior (un rechazo): el próximo toque es otro intento. */
  const cambiar = (cambios: Partial<NotaEscrita>) => {
    setNota({ ...nota, ...cambios });
    envio.reiniciar();
  };
  const importe = nota.importes[0];
  const conImporte = (cambios: Partial<NonNullable<typeof importe>>) => {
    if (importe === undefined) return;
    cambiar({ importes: [{ ...importe, ...cambios }] });
  };
  const nombreDelTipo = (tipo: string): string =>
    `${tipo.startsWith("NOTA_CREDITO") ? textos.notaDeCredito : textos.notaDeDebito} ${tipo.slice(-1)}`;

  return (
    <div className={estilos["pantalla"]}>
      <fieldset className={estilos["remito"]} disabled={!editable}>
        <Selector
          dato="tipo-de-nota-del-proveedor"
          etiqueta={textos.tipo}
          valor={nota.tipo}
          alCambiar={(tipo) => {
            cambiar({ tipo });
          }}
          textoDeElegir={textos.sinElegir}
          opciones={TIPOS_DE_NOTA_POR_CLASE[clase].map((t) => ({
            valor: t,
            etiqueta: nombreDelTipo(t),
          }))}
        />
        <div className={estilos["fila"]}>
          <Campo
            dato="punto-de-venta-de-factura"
            etiqueta={textos.puntoDeVenta}
            inputMode="numeric"
            autoComplete="off"
            valor={nota.puntoDeVenta}
            alCambiar={(puntoDeVenta) => {
              cambiar({ puntoDeVenta });
            }}
          />
          <Campo
            dato="numero-de-factura"
            etiqueta={textos.numero}
            inputMode="numeric"
            autoComplete="off"
            valor={nota.numero}
            alCambiar={(numero) => {
              cambiar({ numero });
            }}
          />
        </div>
        <Campo
          dato="fecha-de-factura"
          etiqueta={textos.fecha}
          tipo="date"
          valor={nota.fecha}
          alCambiar={(fecha) => {
            cambiar({ fecha });
          }}
        />
        <CampoImporte
          dato="importe-neto-de-nota-por-alicuota"
          etiqueta={textos.neto}
          valor={importe?.neto ?? ""}
          alCambiar={(neto) => {
            conImporte({ neto });
          }}
        />
        {nota.tipo === "" ? null : discriminaIvaLaNota(nota.tipo) ? (
          <Selector
            dato="alicuota-de-linea"
            etiqueta={textos.iva}
            valor={importe?.alicuota ?? ""}
            alCambiar={(alicuota) => {
              conImporte({ alicuota });
            }}
            opciones={ALICUOTAS_DE_LA_NOTA.map((a) => ({
              valor: a,
              etiqueta: textos.alicuotas[a] ?? a,
            }))}
          />
        ) : (
          <Texto>{textos.sinIvaDiscriminado}</Texto>
        )}
        <CampoImporte
          dato="total-segun-la-factura"
          etiqueta={textos.totalDeLaNota}
          valor={nota.totalSegunNota}
          alCambiar={(totalSegunNota) => {
            cambiar({ totalSegunNota });
          }}
        />
      </fieldset>
      {clase === "credito" && todaviaSePuedeAcreditar !== null ? (
        <p className={estilos["total"]}>
          <span>{textos.todaviaSePuedeAcreditar}</span>{" "}
          <span className={estilos["importe"]}>{formatearImporte(todaviaSePuedeAcreditar)}</span>
        </p>
      ) : null}
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
        ancho="completo"
        alTocar={() => {
          if (editable && pedido !== null) comprar(pedido);
        }}
        enviando={envio.enCurso || hecho}
        textoEnviando={textos.enviando}
        deshabilitado={!envio.enCurso && !hecho && (pedido === null || envio.bloqueado)}
        motivo={incierto ? undefined : envio.motivoQueNoPuede}
      >
        {textos.guardar}
      </Boton>
    </div>
  );
}
