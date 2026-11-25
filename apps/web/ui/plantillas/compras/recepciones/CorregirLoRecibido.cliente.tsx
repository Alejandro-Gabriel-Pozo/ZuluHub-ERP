"use client";

import { useEffect, useState } from "react";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { REGLA_DE_CANTIDAD } from "../../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { Aviso } from "../../../componentes/Aviso";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { Selector } from "../../../componentes/Selector";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import { Texto } from "../../../primitivas/Texto";
import { comoRegistro } from "../facturas/apoyo-de-facturas";
import { irAPorDefecto } from "../nueva/apoyo-de-nueva-compra";
import { useEnvioDeLaCompra } from "../nueva/useEnvioDeLaCompra.cliente";
import { rutaDeLaRecepcion } from "../rutas-de-compras";
import type { CausaDeCorreccion } from "./modelo-de-recepciones";
import type { TextosDeRecepciones } from "./textos-de-recepciones";

export type PropsDeCorregirLoRecibido = Readonly<{
  recepcionId: string;
  linea: number;
  /** El producto de la línea y lo que rige hoy («Harina 000», «2.000 g»). */
  nombre: string;
  hoy: string;
  /** Las causas que se ofrecen, de la lista cerrada del módulo (la página se las pasa: un componente de cliente no importa el módulo). */
  causas: readonly CausaDeCorreccion[];
  /** Cuántas correcciones tenía la línea cuando se abrió la pantalla: si otra persona corrigió antes, el servidor lo rechaza. */
  correccionesVistas: number;
  /** `corregirLoRecibidoAccion`: el pedido sale con la clave del intento y vuelve la corrección hecha (o el rechazo ya traducido). */
  corregir: (
    pedido: unknown,
  ) => Promise<
    Respuesta<Readonly<{ recepcionId: string; linea: number; numero: number; yaExistia: boolean }>>
  >;
  textos: Pick<
    TextosDeRecepciones,
    | "corregirLoRecibido"
    | "corregir"
    | "cantidadRecibida"
    | "motivoDeLaCorreccion"
    | "causaErrorDeCarga"
    | "causaRepartoInterno"
    | "causaFaltanteDelProveedor"
    | "avisoRepartoInterno"
    | "nota"
    | "sinElegir"
    | "cancelar"
    | "cerrar"
    | "enviando"
    | "reintentar"
  >;
  /** Adónde va al terminar. Por defecto, una navegación completa al detalle de la recepción. */
  irA?: (ruta: string) => void;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * «Corregir lo recibido» (maqueta «Tomar el costo», estado «Corregir»; decisión del dueño del 25/11/2026): el botón de una línea de una recepción confirmada, para gerente y administrador. Abre una hoja con lo que
 * rige hoy, la cantidad que de verdad llegó, el motivo (lista cerrada, obligatorio) y una nota opcional. Con «Reparto interno» avisa que la otra sucursal tiene que corregirse también. El envío es idempotente por
 * intento (`useEnvioDeLaCompra`): el botón se apaga al primer toque y un reintento manda la misma clave con el mismo pedido, así que no hay dos correcciones. El tope (no por debajo de lo conciliado), el stock y el alcance
 * los hace cumplir el servidor, que rechaza con el genérico. Mostrar no es autorizar. Al terminar recarga el detalle.
 */
export function CorregirLoRecibido({
  recepcionId,
  linea,
  nombre,
  hoy,
  causas,
  correccionesVistas,
  corregir,
  textos,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
}: PropsDeCorregirLoRecibido) {
  const [abierta, setAbierta] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [causa, setCausa] = useState("");
  const [nota, setNota] = useState("");
  const { envio, comprar, inesperado } = useEnvioDeLaCompra({
    accion: comoRegistro(corregir, (c) => c.recepcionId),
    diccionario: {},
    esperaEntreVerificacionesMs,
  });
  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  const editable = !envio.enCurso && !incierto && !hecho;
  const completo = cantidad !== "" && causa !== "";

  useEffect(() => {
    if (hecho) irA(rutaDeLaRecepcion(recepcionId));
  }, [hecho, irA, recepcionId]);

  const textoDeLaCausa: Readonly<Record<CausaDeCorreccion, string>> = {
    ERROR_DE_CARGA: textos.causaErrorDeCarga,
    REPARTO_INTERNO: textos.causaRepartoInterno,
    FALTANTE_DEL_PROVEEDOR: textos.causaFaltanteDelProveedor,
  };

  const tocar = () => {
    if (!editable || !completo) return;
    comprar({
      recepcionId,
      linea,
      correccionesVistas,
      cantidad,
      causa,
      ...(nota.trim() === "" ? {} : { nota }),
    });
  };

  return (
    <>
      <Boton
        variante="secundaria"
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {textos.corregirLoRecibido}
      </Boton>
      <Superposicion
        abierta={abierta}
        proposito="editar"
        titulo={textos.corregirLoRecibido}
        alCerrar={() => {
          setAbierta(false);
        }}
        cerrable={!envio.enCurso}
        etiquetaDeCerrar={textos.cerrar}
      >
        <Pila separacion={3}>
          <Texto>{`${nombre} · ${hoy}`}</Texto>
          <CampoNumero
            dato="cantidad-recibida-corregida"
            etiqueta={textos.cantidadRecibida}
            valor={cantidad}
            alCambiar={(valor) => {
              setCantidad(valor);
              envio.reiniciar();
            }}
            regla={REGLA_DE_CANTIDAD}
            deshabilitado={!editable}
          />
          <Selector
            dato="causa-de-correccion-de-lo-recibido"
            etiqueta={textos.motivoDeLaCorreccion}
            valor={causa}
            alCambiar={(valor) => {
              setCausa(valor);
              envio.reiniciar();
            }}
            opciones={causas.map((c) => ({ valor: c, etiqueta: textoDeLaCausa[c] }))}
            textoDeElegir={textos.sinElegir}
            deshabilitado={!editable}
          />
          {causa === "REPARTO_INTERNO" ? (
            <Aviso tono="aviso">
              <Texto>{textos.avisoRepartoInterno}</Texto>
            </Aviso>
          ) : null}
          <Campo
            dato="nota-de-correccion-de-lo-recibido"
            etiqueta={textos.nota}
            valor={nota}
            alCambiar={(valor) => {
              setNota(valor);
              envio.reiniciar();
            }}
            deshabilitado={!editable}
          />
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
            deshabilitado={!envio.enCurso && !hecho && (!completo || envio.bloqueado)}
            motivo={incierto ? undefined : envio.motivoQueNoPuede}
          >
            {textos.corregir}
          </Boton>
        </Pila>
      </Superposicion>
    </>
  );
}
