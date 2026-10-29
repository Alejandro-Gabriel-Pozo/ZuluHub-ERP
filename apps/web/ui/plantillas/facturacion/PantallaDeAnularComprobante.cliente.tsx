"use client";

import { useEffect, useRef, useState } from "react";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton";
import { CajaDeCampo } from "../../componentes/CajaDeCampo";
import { CampoImporte } from "../../componentes/CampoImporte";
import { Insignia } from "../../componentes/Insignia";
import { Texto } from "../../primitivas/Texto";
import estilos from "./PantallaDeAnularComprobante.module.css";
import { ErrorDelDetalle } from "./ErrorDelDetalle";
import {
  anulacionTotal,
  escribirImporte,
  pasarAUnaParte,
  problemaDelMotivo,
  volverAlTotal,
  type EleccionDeAnulacion,
  type FacturaParaAnular,
} from "./eleccion-de-anulacion";
import { direccionDelDetalle } from "./filtros-del-listado";
import { armarLaVista, contadorDelMotivo, type VistaDeLaAnulacion } from "./modelo-de-anulacion";
import { armarElPedido } from "./pedido-de-anulacion";
import { useEnvioDeLaAnulacion, type EmitirLaNota } from "./useEnvioDeLaAnulacion.cliente";

export type PropsDePantallaDeAnularComprobante = Readonly<{
  factura: FacturaParaAnular;
  /** El largo máximo del motivo: lo dicta el servidor (`LIMITES_DE_COMPROBANTE.motivo`) y lo trae la página. */
  limiteDelMotivo: number;
  /** La acción del servidor que emite la nota (la página pasa `emitirNotaDeCreditoAccion`). */
  emitir: EmitirLaNota;
  /** Adónde va al terminar. Por defecto, una navegación completa al detalle de la factura. */
  irA?: (ruta: string) => void;
  /** Espera entre las verificaciones automáticas de un envío incierto (para las pruebas). */
  esperaEntreVerificacionesMs?: number;
  diccionario?: DiccionarioResuelto;
}>;

const irAPorDefecto = (ruta: string): void => {
  window.location.assign(ruta);
};

/**
 * Anular un comprobante por importe (12A): paso 1 «Qué anular» (el total, o «Anular solo una parte» con un importe por alícuota) y
 * paso 2 «Motivo y revisar». Los dos pasos viven en una ruta, con el estado en el cliente («Siguiente» no guarda nada). La pantalla
 * arma los renglones de la nota y el servidor valida todo lo demás (permiso, estado, alícuotas). El envío es idempotente por intento
 * y el botón se bloquea al primer toque (`useEnvioDeLaAnulacion`). Al terminar vuelve al detalle, donde ya se ve la etiqueta de
 * anulación. Los botones van al final del contenido (SUPUESTO: ya hay una barra inferior fija; revertirlo es CSS).
 */
export function PantallaDeAnularComprobante({
  factura,
  limiteDelMotivo,
  emitir,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
  diccionario = {},
}: PropsDePantallaDeAnularComprobante) {
  const [eleccion, setEleccion] = useState<EleccionDeAnulacion>(anulacionTotal);
  const [paso, setPaso] = useState<1 | 2>(1);
  const [motivo, setMotivo] = useState("");
  const { envio, anular, inesperado } = useEnvioDeLaAnulacion({
    emitir,
    diccionario,
    esperaEntreVerificacionesMs,
  });
  const vista = armarLaVista(diccionario, factura, eleccion);

  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  // Mientras se envía, hay un resultado incierto o ya se hizo, nada se edita: lo que se ve es lo que salió.
  const editable = !envio.enCurso && !incierto && !hecho;

  // Al terminar, vuelve al detalle. El botón sigue bloqueado hasta que la navegación cambie la página.
  useEffect(() => {
    if (estado.tipo === "hecho") irA(direccionDelDetalle(factura.id));
  }, [estado.tipo, factura.id, irA]);

  // Al cambiar de paso el foco pasa al comienzo del paso nuevo (si no, queda en un botón que ya no existe).
  const seccion = useRef<HTMLElement>(null);
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    seccion.current?.focus();
  }, [paso]);

  function editarEleccion(nueva: EleccionDeAnulacion) {
    setEleccion(nueva);
    envio.reiniciar();
  }

  function tocarAnular() {
    if (!editable || problemaDelMotivo(motivo, limiteDelMotivo) !== null) return;
    anular(armarElPedido(diccionario, factura, eleccion, motivo));
  }

  const cambiarDeModo = (
    <Boton
      ancho="completo"
      variante="secundaria"
      alTocar={() => {
        editarEleccion(
          vista.queAnular.parcial ? volverAlTotal(eleccion) : pasarAUnaParte(eleccion),
        );
      }}
    >
      {vista.queAnular.cambiarDeModo}
    </Boton>
  );

  return (
    <div className={estilos["raiz"]}>
      <p className={estilos["subtitulo"]}>{vista.subtitulo}</p>
      <ol className={estilos["pasos"]}>
        {vista.pasos.map((p, i) => (
          <li
            key={p.nombre}
            className={estilos["etapa"]}
            data-actual={paso === i + 1}
            aria-current={paso === i + 1 ? "step" : undefined}
          >
            <span className={estilos["numero"]}>{i + 1}</span> {p.nombre}
          </li>
        ))}
      </ol>

      {paso === 1 ? (
        <section
          ref={seccion}
          tabIndex={-1}
          aria-labelledby="anular-que"
          className={estilos["seccion"]}
        >
          <h2 id="anular-que" className={estilos["titulo"]}>
            {vista.queAnular.titulo}
          </h2>
          {vista.queAnular.parcial ? (
            <>
              {vista.queAnular.filas.map((fila) => (
                <fieldset key={fila.clave} className={estilos["alicuota"]}>
                  {fila.nombre === null ? null : (
                    <legend className={estilos["nombre"]}>{fila.nombre}</legend>
                  )}
                  <p className={estilos["fila"]}>
                    <span className={estilos["suave"]}>{fila.facturado.rotulo}</span>
                    <span className={estilos["importe"]}>{fila.facturado.importe}</span>
                  </p>
                  <CampoImporte
                    etiqueta={fila.etiquetaDelCampo}
                    valor={fila.valor}
                    alCambiar={(canonico) => {
                      editarEleccion(escribirImporte(eleccion, fila.clave, canonico));
                    }}
                  />
                  {fila.aviso === null ? null : <Aviso tono="aviso">{fila.aviso}</Aviso>}
                </fieldset>
              ))}
              <p className={estilos["fila"]} data-fuerte="true">
                <span>{vista.queAnular.fila.rotulo}</span>
                <span className={estilos["importe"]}>{vista.queAnular.fila.importe}</span>
              </p>
            </>
          ) : (
            <>
              <p className={estilos["fila"]} data-fuerte="true">
                <span>{vista.queAnular.fila.rotulo}</span>
                <span className={estilos["importe"]}>{vista.queAnular.fila.importe}</span>
              </p>
              {cambiarDeModo}
            </>
          )}
          <div className={estilos["acciones"]}>
            {vista.queAnular.parcial ? (
              <div className={estilos["accion"]}>{cambiarDeModo}</div>
            ) : (
              <a className={estilos["cancelar"]} href={vista.hrefDeCancelar}>
                {vista.botones.cancelar}
              </a>
            )}
            <div className={estilos["accion"]}>
              <Boton
                ancho="completo"
                deshabilitado={!vista.queAnular.sePuedeSeguir}
                alTocar={() => {
                  setPaso(2);
                }}
              >
                {vista.botones.siguiente}
              </Boton>
            </div>
          </div>
        </section>
      ) : (
        <section
          ref={seccion}
          tabIndex={-1}
          aria-label={vista.pasos[1]?.nombre}
          className={estilos["seccion"]}
        >
          <Motivo
            vista={vista}
            diccionario={diccionario}
            valor={motivo}
            limite={limiteDelMotivo}
            deshabilitado={!editable}
            alCambiar={(valor) => {
              setMotivo(valor);
              envio.reiniciar();
            }}
          />
          <Revision vista={vista} />
          {estado.tipo === "rechazado" ? (
            <ErrorDelDetalle error={estado.rechazo} diccionario={diccionario} />
          ) : null}
          {incierto ? (
            <Aviso
              tono="aviso"
              accion={
                envio.enCurso ? undefined : (
                  <Boton variante="secundaria" alTocar={envio.enviar}>
                    {texto(diccionario, "estado.reintentar")}
                  </Boton>
                )
              }
            >
              <Texto>{texto(diccionario, "conexion.verificando")}</Texto>
              {inesperado === null ? null : <Texto>{texto(diccionario, inesperado.clave)}</Texto>}
              {inesperado?.referencia === undefined ? null : (
                <Texto>
                  {texto(diccionario, "error.referencia", { referencia: inesperado.referencia })}
                </Texto>
              )}
            </Aviso>
          ) : null}
          <div className={estilos["acciones"]}>
            <div className={estilos["accion"]}>
              <Boton
                ancho="completo"
                variante="secundaria"
                deshabilitado={!editable}
                alTocar={() => {
                  setPaso(1);
                }}
              >
                {vista.botones.volver}
              </Boton>
            </div>
            <div className={estilos["accion"]}>
              <Boton
                ancho="completo"
                alTocar={tocarAnular}
                enviando={envio.enCurso || hecho}
                textoEnviando={vista.botones.enviando}
                deshabilitado={
                  !envio.enCurso &&
                  !hecho &&
                  (problemaDelMotivo(motivo, limiteDelMotivo) !== null || envio.bloqueado)
                }
                // Con el resultado incierto el aviso de arriba ya dice «Verificando…»: no se repite junto al botón.
                motivo={incierto ? undefined : envio.motivoQueNoPuede}
              >
                {vista.botones.confirmar}
              </Boton>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Motivo({
  vista,
  diccionario,
  valor,
  limite,
  deshabilitado,
  alCambiar,
}: Readonly<{
  vista: VistaDeLaAnulacion;
  diccionario: DiccionarioResuelto;
  valor: string;
  limite: number;
  deshabilitado: boolean;
  alCambiar: (valor: string) => void;
}>) {
  const { motivo } = vista.revision;
  return (
    <div className={estilos["motivo"]}>
      <CajaDeCampo
        etiqueta={motivo.etiqueta}
        ayuda={motivo.ayuda}
        control={(datos) => (
          <textarea
            {...datos}
            aria-required="true"
            className={estilos["area"]}
            rows={3}
            maxLength={limite}
            value={valor}
            disabled={deshabilitado}
            onChange={(evento) => {
              alCambiar(evento.target.value);
            }}
          />
        )}
      />
      <p className={estilos["contador"]}>{contadorDelMotivo(diccionario, valor, limite)}</p>
    </div>
  );
}

function Revision({ vista }: Readonly<{ vista: VistaDeLaAnulacion }>) {
  const { revision } = vista;
  const anulado = revision.anulado;
  return (
    <section aria-labelledby="anular-revision" className={estilos["revision"]}>
      <h2 id="anular-revision" className={estilos["titulo"]}>
        {revision.titulo}
      </h2>
      <dl className={estilos["filas"]}>
        <div className={estilos["fila"]} data-fuerte="true">
          <dt>{revision.aAnularAhora.rotulo}</dt>
          <dd className={estilos["importe"]}>{revision.aAnularAhora.importe}</dd>
        </div>
        <div className={estilos["fila"]}>
          <dt>{revision.totalDeLaFactura.rotulo}</dt>
          <dd className={estilos["importe"]}>{revision.totalDeLaFactura.importe}</dd>
        </div>
        {anulado === null ? null : (
          <div className={estilos["fila"]}>
            <dt>{anulado.titulo}</dt>
            <dd className={estilos["importe"]}>
              {anulado.cifra}
              {anulado.sinNotas === null ? null : ` · ${anulado.sinNotas}`}
            </dd>
          </div>
        )}
      </dl>
      {anulado === null || anulado.sinNotas !== null ? null : (
        <ul className={estilos["notas"]}>
          {anulado.notas.map((n) => (
            <li key={n.id} className={estilos["nota"]}>
              <span className={estilos["descripcion"]}>{n.nombre}</span>
              <span className={estilos["importe"]}>{n.total}</span>
              <Insignia tono={n.estado.tono}>{n.estado.texto}</Insignia>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
