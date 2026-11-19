"use client";

import { useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoImporte } from "../../componentes/CampoImporte";
import { CampoNumero } from "../../componentes/CampoNumero";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { limitarElTexto } from "./modelo-de-la-caja";
import {
  CONTEO_EN_BLANCO,
  conBilletes,
  conConformeAlternado,
  conConformeGeneral,
  conContado,
  conMonedas,
  diferenciaDeUnMedio,
  diferenciaDelEfectivo,
  subtotalDeBilletes,
  totalContadoDelEfectivo,
  vistaDelConteo,
  type ConteoDeLaCaja,
  type EstadoDelConteo,
} from "./modelo-de-conteo-de-caja";
import { armarElPedidoDeCierre, armarElPedidoDeSesion } from "./pedidos-de-caja";
import { CuerpoDeFormularioDeCaja } from "./CuerpoDeFormularioDeCaja";
import estilos from "./PantallaDeCaja.module.css";
import { useEnvioDeCaja } from "./useEnvioDeCaja";

export type PropsDeFormularioDeCierre = Readonly<{
  conteo: ConteoDeLaCaja;
  /** Las acciones del servidor `cerrarCajaAccion` y `cancelarCierreDeCajaAccion`. */
  cerrar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  cancelarCierre: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** Lo que el servidor deja hacer hoy (solo una ayuda: el guard decide al enviar). */
  puedeCerrar: boolean;
  puedeCancelarCierre: boolean;
  /** El largo máximo de la observación: lo dice la primitiva del dato, la pantalla lo recibe. */
  largoMaximoDeLaObservacion: number;
  alCerrar: () => void;
  alCancelarElCierre: () => void;
  /** «Volver» solo vuelve a la vista anterior: no cancela el cierre (SUPUESTO, DEC-0455). */
  alVolver: () => void;
}>;

/**
 * «Contar» y «Cerrar caja» (maqueta `caja.html`, `vCierre`): el efectivo se cuenta por billetes (denominación por cantidad) y monedas, y el sistema suma; los demás medios se cuentan contra
 * lo esperado: se escribe el total contado o se toca «Conforme» (por línea) o «Conforme general». La pantalla PREVISUALIZA el total contado y la diferencia; el esperado lo trae el servidor y
 * la cuenta definitiva la hace el servidor al cerrar. Lo que el servidor rechaza (falta contar el efectivo, una línea sin declarar) sale como su error traducido. Lo escrito se conserva
 * mientras la persona vuelve a la vista anterior y regresa.
 */
export function FormularioDeCierre({
  conteo,
  cerrar,
  cancelarCierre,
  puedeCerrar,
  puedeCancelarCierre,
  largoMaximoDeLaObservacion,
  alCerrar,
  alCancelarElCierre,
  alVolver,
}: PropsDeFormularioDeCierre) {
  const vista = vistaDelConteo(conteo);
  const [estado, setEstado] = useState<EstadoDelConteo>(CONTEO_EN_BLANCO);
  const [observacion, setObservacion] = useState("");
  const cierre = useEnvioDeCaja<ReturnType<typeof armarElPedidoDeCierre>>(
    (pedido) => cerrar(pedido),
    alCerrar,
  );
  const cancelacion = useEnvioDeCaja<object>(
    () => cancelarCierre(armarElPedidoDeSesion(conteo.sesionId)),
    alCancelarElCierre,
  );
  const ocupado = cierre.ocupado || cancelacion.ocupado;
  const total = totalContadoDelEfectivo(conteo.denominaciones, estado.billetes, estado.monedas);
  const difDelEfectivo = diferenciaDelEfectivo(total, vista.efectivo.esperado);
  return (
    <CuerpoDeFormularioDeCaja
      alEnviar={() => {
        cierre.enviarCon(
          armarElPedidoDeCierre(
            conteo.sesionId,
            conteo.denominaciones,
            vista.otros,
            estado,
            observacion,
          ),
        );
      }}
      textoDeEnviar={texto({}, "caja.sesion.cerrar")}
      puedeEnviar={puedeCerrar && !cierre.envio.bloqueado && !cancelacion.ocupado}
      textoDeCancelar={texto({}, "caja.sesion.cancelar_cierre")}
      alCancelar={() => {
        cancelacion.enviarCon({});
      }}
      cancelarApagado={!puedeCancelarCierre}
      ocupado={ocupado}
      enCurso={cierre.envio.enCurso || cancelacion.envio.enCurso}
      incierto={
        cierre.envio.estado.tipo === "incierto" || cancelacion.envio.estado.tipo === "incierto"
      }
      referenciaIncierta={cierre.referenciaIncierta ?? cancelacion.referenciaIncierta}
      rechazo={cierre.rechazo ?? cancelacion.rechazo}
      motivoQueNoPuede={cierre.envio.motivoQueNoPuede}
    >
      <div>
        <Boton variante="secundaria" alTocar={alVolver} enviando={ocupado}>
          {texto({}, "fiscal.pantalla.anular_volver")}
        </Boton>
      </div>
      <fieldset className={estilos["tarjeta"]} disabled={ocupado}>
        <legend className={estilos["leyenda"]}>{texto({}, "caja.medios.tipo.efectivo")}</legend>
        <p className={estilos["fila"]}>
          <span className={estilos["suave"]}>{texto({}, "caja.arqueo.esperado")}</span>
          <span>{vista.efectivo.esperadoParaMostrar}</span>
        </p>
        <fieldset className={estilos["billetes"]}>
          <legend className={estilos["etiqueta"]}>
            {texto({}, "caja.arqueo.billetes")} · {texto({}, "caja.arqueo.cantidad")}
          </legend>
          {vista.billetes.map((b) => {
            const subtotal = subtotalDeBilletes(
              b.denominacion,
              estado.billetes[String(b.denominacion)] ?? "",
            );
            return (
              <div key={b.denominacion} className={estilos["billete"]}>
                <CampoNumero
                  dato="cantidad-de-billetes"
                  etiqueta={b.etiqueta}
                  valor={estado.billetes[String(b.denominacion)] ?? ""}
                  alCambiar={(cantidad) => {
                    setEstado(conBilletes(estado, b.denominacion, cantidad));
                  }}
                  regla={vista.reglaDeBilletes}
                />
                <span className={estilos["subtotal"]}>
                  {subtotal === null ? "" : formatearImporte(subtotal)}
                </span>
              </div>
            );
          })}
        </fieldset>
        <CampoImporte
          dato="importe-de-monedas-contadas"
          etiqueta={texto({}, "caja.arqueo.monedas")}
          valor={estado.monedas}
          alCambiar={(monedas) => {
            setEstado(conMonedas(estado, monedas));
          }}
        />
        <p className={estilos["fila"]}>
          <span className={estilos["suave"]}>{texto({}, "caja.arqueo.total_contado")}</span>
          <strong>{total === null ? "" : formatearImporte(total)}</strong>
        </p>
        <p className={estilos["fila"]}>
          <span className={estilos["suave"]}>{texto({}, "caja.arqueo.diferencia")}</span>
          <strong className={estilos["tono"]} data-tono={difDelEfectivo.tono ?? undefined}>
            {difDelEfectivo.texto}
          </strong>
        </p>
      </fieldset>
      <div>
        <Boton
          variante="secundaria"
          alTocar={() => {
            setEstado(conConformeGeneral(estado, vista.otros));
          }}
          enviando={ocupado}
        >
          {texto({}, "caja.conforme_general")}
        </Boton>
      </div>
      {vista.otros.map((fila) => {
        const contado = estado.contados[fila.clave] ?? "";
        const conforme = estado.conformes[fila.clave] === true;
        const dif = diferenciaDeUnMedio(fila, contado, conforme);
        return (
          <fieldset key={fila.clave} className={estilos["tarjeta"]} disabled={ocupado}>
            <legend className={estilos["leyenda"]}>
              {fila.cuenta === null ? fila.titulo : `${fila.titulo} · ${fila.cuenta}`}
            </legend>
            <p className={estilos["fila"]}>
              <span className={estilos["suave"]}>{texto({}, "caja.arqueo.esperado")}</span>
              <span>{fila.esperadoParaMostrar}</span>
            </p>
            <CampoImporte
              dato="importe-contado-de-medio"
              etiqueta={texto({}, "caja.arqueo.contado")}
              valor={contado}
              alCambiar={(v) => {
                setEstado(conContado(estado, fila.clave, v));
              }}
            />
            <div>
              <Boton
                variante="secundaria"
                presionado={conforme}
                alTocar={() => {
                  setEstado(conConformeAlternado(estado, fila.clave));
                }}
                enviando={ocupado}
              >
                {texto({}, "caja.conforme")}
              </Boton>
            </div>
            <p className={estilos["fila"]}>
              <span className={estilos["suave"]}>{texto({}, "caja.arqueo.diferencia")}</span>
              <strong className={estilos["tono"]} data-tono={dif.tono ?? undefined}>
                {dif.texto}
              </strong>
            </p>
          </fieldset>
        );
      })}
      <Campo
        dato="observacion-de-cierre-de-caja"
        etiqueta={texto({}, "caja.arqueo.observacion_opcional")}
        valor={observacion}
        alCambiar={(v) => {
          setObservacion(limitarElTexto(v, largoMaximoDeLaObservacion));
        }}
        autoComplete="off"
        deshabilitado={ocupado}
      />
    </CuerpoDeFormularioDeCaja>
  );
}
