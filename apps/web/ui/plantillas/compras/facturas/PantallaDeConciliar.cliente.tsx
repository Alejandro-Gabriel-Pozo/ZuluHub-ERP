"use client";

import { useEffect, useMemo, useState } from "react";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { REGLA_DE_CANTIDAD } from "../../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { Aviso } from "../../../componentes/Aviso";
import { Boton } from "../../../componentes/Boton.cliente";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { Texto } from "../../../primitivas/Texto";
import { irAPorDefecto } from "../nueva/apoyo-de-nueva-compra";
import { useEnvioDeLaCompra } from "../nueva/useEnvioDeLaCompra.cliente";
import { comoRegistro } from "./apoyo-de-facturas";
import { rutaDeLaFactura } from "../rutas-de-compras";
import {
  armarElPedidoDeConciliar,
  armarLasLineasDeConciliar,
  repartoInicial,
  type DatosParaConciliarParaLaPantalla,
} from "./modelo-de-conciliar";
import type { SucursalConNombre } from "./modelo-de-facturas";
import estilos from "../Compras.module.css";

export type PropsDePantallaDeConciliar = Readonly<{
  comprobanteId: string;
  datos: DatosParaConciliarParaLaPantalla;
  sucursales: readonly SucursalConNombre[];
  /** `conciliarFacturaAccion`: el pedido sale con la clave del intento y vuelve la conciliación hecha (o el rechazo ya traducido). */
  conciliar: (
    pedido: unknown,
  ) => Promise<Respuesta<Readonly<{ conciliacionId: string; yaExistia: boolean }>>>;
  textos: Readonly<{
    recepcion: string;
    recibido: string;
    facturado: string;
    aConciliar: string;
    validarConciliacion: string;
    enviando: string;
    reintentar: string;
  }>;
  /** Adónde va al terminar. Por defecto, una navegación completa al detalle de la factura. */
  irA?: (ruta: string) => void;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * «Conciliar» (Compras 4; maqueta `compra-conciliar.html`, estados «Falta conciliar» y «Conciliada en parte»): cada línea de la factura con lo que le falta conciliar y, debajo, una línea recibida por cada sucursal del
 * alcance de quien concilia (del mismo producto), con la cantidad a conciliar precargada con la propuesta del servidor; la persona la deja o la corrige (un producto entero a una sucursal, o partido). «Confirmar
 * conciliación» guarda todo o nada. El envío es idempotente por intento (`useEnvioDeLaCompra`): el botón se apaga al primer toque y un reintento manda la misma clave con el mismo pedido, así que no hay dos
 * conciliaciones. Los topes (no más de lo recibido ni de lo facturado) los hace cumplir el servidor: dos personas conciliando lo mismo a la vez, gana una y la otra ve el genérico y vuelve a leer los saldos.
 * Mostrar no es autorizar: el servidor decide si se puede. Al terminar abre el detalle de la factura.
 */
export function PantallaDeConciliar({
  comprobanteId,
  datos,
  sucursales,
  conciliar,
  textos,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
}: PropsDePantallaDeConciliar) {
  const [reparto, setReparto] = useState(() => repartoInicial(datos));
  const { envio, comprar, inesperado } = useEnvioDeLaCompra({
    accion: comoRegistro(conciliar, (c) => c.conciliacionId),
    diccionario: {},
    esperaEntreVerificacionesMs,
  });
  const lineas = useMemo(
    () => armarLasLineasDeConciliar(datos, sucursales, textos),
    [datos, sucursales, textos],
  );
  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  const editable = !envio.enCurso && !incierto && !hecho;
  const hayAlgo = Object.values(reparto).some((cantidad) => cantidad !== "");

  const conciliacionHecha = hecho;
  useEffect(() => {
    if (conciliacionHecha) irA(rutaDeLaFactura(comprobanteId));
  }, [conciliacionHecha, irA, comprobanteId]);

  const tocar = () => {
    if (!editable || !hayAlgo) return;
    comprar(armarElPedidoDeConciliar(comprobanteId, datos, reparto));
  };

  return (
    <div className={estilos["cuerpo"]}>
      {lineas.map((linea) => (
        <section
          key={linea.numero}
          className={estilos["tarjeta"]}
          aria-label={`${textos.facturado}: ${linea.nombre}`}
        >
          <h3 className={estilos["titulo"]}>{linea.nombre}</h3>
          <p className={estilos["suave"]}>{linea.facturado}</p>
          {linea.candidatas.map((c) => (
            <div key={c.clave}>
              <p className={estilos["suave"]}>
                {c.rotulo} · {c.recibido}
              </p>
              <CampoNumero
                dato="cantidad-a-conciliar-de-linea"
                etiqueta={`${textos.aConciliar} · ${c.rotulo}`}
                valor={reparto[c.clave] ?? ""}
                alCambiar={(cantidad) => {
                  setReparto({ ...reparto, [c.clave]: cantidad });
                  envio.reiniciar();
                }}
                regla={REGLA_DE_CANTIDAD}
                deshabilitado={!editable}
              />
            </div>
          ))}
        </section>
      ))}

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
        alTocar={tocar}
        enviando={envio.enCurso || hecho}
        textoEnviando={textos.enviando}
        deshabilitado={!envio.enCurso && !hecho && (!hayAlgo || envio.bloqueado)}
        motivo={incierto ? undefined : envio.motivoQueNoPuede}
      >
        {textos.validarConciliacion}
      </Boton>
    </div>
  );
}
