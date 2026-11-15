"use client";

import { useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Campo } from "../../componentes/Campo";
import { CampoImporte } from "../../componentes/CampoImporte";
import { Selector } from "../../componentes/Selector";
import { limitarElTexto, puedeRegistrar } from "./modelo-de-la-caja";
import {
  armarElPedidoDeAjuste,
  armarElPedidoDeMovimiento,
  type SentidoDeAjuste,
  type SentidoDeMovimiento,
} from "./pedidos-de-caja";
import { CuerpoDeFormularioDeCaja } from "./CuerpoDeFormularioDeCaja";
import { useEnvioDeCaja } from "./useEnvioDeCaja";

/** Lo que se registra: un ingreso o un egreso (los fija el botón con que se abrió) o un ajuste (pide además «Sobra» o «Falta» y el medio, el efectivo de la sesión). */
export type ClaseDeMovimientoNuevo =
  | Readonly<{ tipo: "ingreso" | "egreso" }>
  | Readonly<{
      tipo: "ajuste";
      medio: Readonly<{ medioDePagoId: string; cuentaDeCobroId: string | null }>;
    }>;

export type PropsDeFormularioDeMovimiento = Readonly<{
  sesionId: string;
  clase: ClaseDeMovimientoNuevo;
  /** Las acciones del servidor `registrarMovimientoDeCajaAccion` y `registrarAjusteDeCajaAccion`: reciben el pedido con la clave del intento. */
  registrarMovimiento: (pedido: unknown) => Promise<Respuesta<unknown>>;
  registrarAjuste: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** Si el servidor deja registrar hoy (solo una ayuda: el guard decide al enviar). */
  puedeRegistrar: boolean;
  /** El largo máximo del motivo: lo dice la primitiva del dato, la pantalla lo recibe. */
  largoMaximoDelMotivo: number;
  alTerminar: () => void;
  alCancelar: () => void;
}>;

type Pedido = Readonly<{ importe: string; motivo: string; sentido: SentidoDeAjuste }>;

/**
 * «Ingreso», «Egreso» y «Ajuste» (maqueta `caja.html`, `vMov`): importe sin signo, motivo y, en el ajuste, «Sobra» o «Falta» (por defecto «Falta», como la maqueta). El motivo de la maqueta es de
 * varias líneas; acá es un campo de una línea (no hay componente multilínea registrado). El envío es idempotente por intento (ver `useEnvioDeCaja`).
 */
export function FormularioDeMovimiento({
  sesionId,
  clase,
  registrarMovimiento,
  registrarAjuste,
  puedeRegistrar: ofrecida,
  largoMaximoDelMotivo,
  alTerminar,
  alCancelar,
}: PropsDeFormularioDeMovimiento) {
  const [sentido, setSentido] = useState<SentidoDeAjuste>("FALTA");
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState("");
  const { envio, enviarCon, rechazo, referenciaIncierta, ocupado } = useEnvioDeCaja<Pedido>(
    (p, clave) =>
      clase.tipo === "ajuste"
        ? registrarAjuste(
            armarElPedidoDeAjuste(clave, sesionId, clase.medio, p.sentido, p.importe, p.motivo),
          )
        : registrarMovimiento(
            armarElPedidoDeMovimiento(
              clave,
              sesionId,
              (clase.tipo === "ingreso" ? "INGRESO" : "EGRESO") satisfies SentidoDeMovimiento,
              p.importe,
              p.motivo,
            ),
          ),
    alTerminar,
  );
  const listo = ofrecida && puedeRegistrar(importe, motivo) && !envio.bloqueado;
  return (
    <CuerpoDeFormularioDeCaja
      alEnviar={() => {
        enviarCon({ importe, motivo, sentido });
      }}
      textoDeEnviar={texto({}, "caja.movimiento.registrar")}
      puedeEnviar={listo}
      textoDeCancelar={texto({}, "caja.accion.cancelar")}
      alCancelar={alCancelar}
      ocupado={ocupado}
      enCurso={envio.enCurso}
      incierto={envio.estado.tipo === "incierto"}
      referenciaIncierta={referenciaIncierta}
      rechazo={rechazo}
      motivoQueNoPuede={envio.motivoQueNoPuede}
    >
      {clase.tipo === "ajuste" ? (
        <Selector
          dato="sentido-de-ajuste-de-caja"
          etiqueta={texto({}, "caja.movimiento.ajuste")}
          valor={sentido}
          alCambiar={(v) => {
            setSentido(v === "SOBRA" ? "SOBRA" : "FALTA");
          }}
          opciones={[
            { valor: "SOBRA", etiqueta: texto({}, "caja.ajuste.sobra") },
            { valor: "FALTA", etiqueta: texto({}, "caja.ajuste.falta") },
          ]}
          deshabilitado={ocupado}
        />
      ) : null}
      <CampoImporte
        dato="importe-de-movimiento-de-caja"
        etiqueta={texto({}, "caja.campo.importe")}
        valor={importe}
        alCambiar={setImporte}
        deshabilitado={ocupado}
      />
      <Campo
        dato="motivo-de-movimiento-de-caja"
        etiqueta={texto({}, "caja.campo.motivo")}
        valor={motivo}
        alCambiar={(v) => {
          setMotivo(limitarElTexto(v, largoMaximoDelMotivo));
        }}
        autoComplete="off"
        deshabilitado={ocupado}
      />
    </CuerpoDeFormularioDeCaja>
  );
}
