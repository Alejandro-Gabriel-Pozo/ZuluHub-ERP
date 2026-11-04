"use client";

import { useEffect, useRef, useState } from "react";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton";
import { Texto } from "../../primitivas/Texto";
import estilos from "./PantallaDeEmitirFactura.module.css";
import { ErrorDelDetalle } from "./ErrorDelDetalle";
import {
  calcularLaEmision,
  clienteInicial,
  conRenglon,
  idSiguiente,
  renglonVacio,
  sinRenglon,
  type ClienteEscrito,
  type RenglonEscrito,
} from "./eleccion-de-emision";
import { direccionDelDetalle } from "./filtros-del-listado";
import {
  aPuntosParaEmitir,
  puntoDeVentaElegido,
  vistaDeLaRevision,
  vistaDeLosPasos,
  vistaDeLosRenglones,
  vistaDelCliente,
  type PuntoParaEmitir,
} from "./modelo-de-emision";
import { armarElPedido } from "./pedido-de-emision";
import { PasoDeLosRenglones, PasoDeRevisar, PasoDelCliente } from "./PasosDeEmision";
import { useEnvioDeLaEmision, type EmitirLaFactura } from "./useEnvioDeLaEmision.cliente";

export type PropsDePantallaDeEmitirFactura = Readonly<{
  /** Si la empresa discrimina IVA: se pide la alícuota de cada renglón. Lo lee el servidor (`discriminaIvaAlEmitir`); la letra no se muestra (D-26). */
  discriminaIva: boolean;
  /** Los puntos de venta ACTIVOS de la sucursal (D-86), de menor a mayor número. Vacío: no hay con cuál emitir. */
  puntosDeVenta: readonly PuntoParaEmitir[];
  /** La acción del servidor que emite la factura (la página pasa `emitirFacturaAccion`). */
  emitir: EmitirLaFactura;
  /** Adónde va al terminar. Por defecto, una navegación completa al detalle del comprobante. */
  irA?: (ruta: string) => void;
  /** Espera entre las verificaciones automáticas de un envío incierto (para las pruebas). */
  esperaEntreVerificacionesMs?: number;
  diccionario?: DiccionarioResuelto;
}>;

const irAPorDefecto = (ruta: string): void => {
  window.location.assign(ruta);
};

/**
 * Emitir una factura (8B, por pasos; aprobada por el dueño: «Si 7C y 8B»): paso 1 «Cliente», paso 2 «Renglones» y paso 3 «Revisar», que es
 * la confirmación. Los tres viven en una ruta, con el estado en el cliente («Siguiente» y «Volver» no guardan nada). La pantalla arma
 * el pedido de la factura y el servidor valida todo lo demás (permiso, módulo, punto de venta, receptor, renglones). El envío es
 * idempotente por intento y el botón se bloquea al primer toque (`useEnvioDeLaEmision`). Al terminar abre el detalle del comprobante,
 * donde ya se ve su estado. Los botones van al final del contenido (SUPUESTO heredado de Anular: ya hay una barra inferior fija).
 */
export function PantallaDeEmitirFactura({
  discriminaIva,
  puntosDeVenta,
  emitir,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
  diccionario = {},
}: PropsDePantallaDeEmitirFactura) {
  const puntos = aPuntosParaEmitir(puntosDeVenta);
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [cliente, setCliente] = useState<ClienteEscrito>(clienteInicial);
  const [renglones, setRenglones] = useState<readonly RenglonEscrito[]>([renglonVacio(1)]);
  const [puntoElegido, setPuntoElegido] = useState("");
  const {
    envio,
    emitir: emitirFactura,
    inesperado,
  } = useEnvioDeLaEmision({
    accion: emitir,
    diccionario,
    esperaEntreVerificacionesMs,
  });

  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  // Mientras se envía, hay un resultado incierto o ya se hizo, nada se edita: lo que se ve es lo que salió.
  const editable = !envio.enCurso && !incierto && !hecho;
  const calculo = calcularLaEmision(renglones);
  const elegido = puntoDeVentaElegido(puntos, puntoElegido);
  const pasos = vistaDeLosPasos(diccionario);

  // Al terminar, abre el detalle del comprobante. El botón sigue bloqueado hasta que la navegación cambie la página.
  const comprobanteId = estado.tipo === "hecho" ? estado.valor.comprobanteId : null;
  useEffect(() => {
    if (comprobanteId !== null) irA(direccionDelDetalle(comprobanteId));
  }, [comprobanteId, irA]);

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

  /** Cualquier cambio de lo escrito descarta el resultado anterior (un rechazo): el próximo toque es otro intento. */
  function editado(): void {
    envio.reiniciar();
  }

  function irAlPaso(nuevo: 1 | 2 | 3): void {
    editado();
    setPaso(nuevo);
  }

  function tocarEmitir(): void {
    if (!editable || elegido === null) return;
    emitirFactura(armarElPedido(cliente, renglones, elegido.id, discriminaIva));
  }

  const nombreDelPaso = pasos.pasos[paso - 1]?.nombre;

  return (
    <div className={estilos["raiz"]}>
      <ol className={estilos["pasos"]}>
        {pasos.pasos.map((p, i) => (
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

      <section
        ref={seccion}
        tabIndex={-1}
        aria-label={nombreDelPaso}
        className={estilos["seccion"]}
      >
        {paso === 1 ? (
          <PasoDelCliente
            vista={vistaDelCliente(diccionario, cliente)}
            cliente={cliente}
            alCambiar={(nuevo) => {
              setCliente(nuevo);
              editado();
            }}
          />
        ) : null}
        {paso === 2 ? (
          <PasoDeLosRenglones
            vista={vistaDeLosRenglones(diccionario, discriminaIva)}
            renglones={renglones}
            alCambiar={(id, cambios) => {
              setRenglones(conRenglon(renglones, id, cambios));
              editado();
            }}
            alAgregar={() => {
              setRenglones([...renglones, renglonVacio(idSiguiente(renglones))]);
              editado();
            }}
            alQuitar={(id) => {
              setRenglones(sinRenglon(renglones, id));
              editado();
            }}
          />
        ) : null}
        {paso === 3 ? (
          <>
            <PasoDeRevisar
              vista={vistaDeLaRevision(diccionario, {
                cliente,
                renglones,
                calculo,
                discriminaIva,
                puntos,
                puntoElegido,
              })}
              puntoElegido={puntoElegido}
              alElegirPunto={(id) => {
                setPuntoElegido(id);
                editado();
              }}
              deshabilitado={!editable}
            />
            {/* Dueño, 2026-11-03, cuestionario “Emitir”, «Errores»: el error del servidor se ve en el paso final, se vuelve con «Volver» y no se marcan campos. */}
            {estado.tipo === "rechazado" ? (
              <ErrorDelDetalle error={estado.rechazo} diccionario={diccionario} />
            ) : null}
            {incierto ? (
              <Aviso
                tono="aviso"
                accion={
                  envio.enCurso ? undefined : (
                    <Boton ancho="completo" variante="secundaria" alTocar={envio.enviar}>
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
          </>
        ) : null}

        <div className={estilos["acciones"]}>
          {paso === 1 ? null : (
            <div className={estilos["accion"]}>
              <Boton
                ancho="completo"
                variante="secundaria"
                deshabilitado={!editable}
                alTocar={() => {
                  irAlPaso(paso === 3 ? 2 : 1);
                }}
              >
                {pasos.botones.volver}
              </Boton>
            </div>
          )}
          <div className={estilos["accion"]}>
            {paso === 3 ? (
              <Boton
                ancho="completo"
                alTocar={tocarEmitir}
                enviando={envio.enCurso || hecho}
                textoEnviando={pasos.botones.enviando}
                deshabilitado={!envio.enCurso && !hecho && (elegido === null || envio.bloqueado)}
                // Con el resultado incierto el aviso de arriba ya dice «Verificando…»: no se repite junto al botón (dueño, 2026-11-03, cuestionario “Emitir”, «Verificando»: sin salida de «Verificando si se registró…», texto ya aprobado: D-93).
                motivo={incierto ? undefined : envio.motivoQueNoPuede}
              >
                {pasos.botones.emitir}
              </Boton>
            ) : (
              <Boton
                ancho="completo"
                // En «Renglones» no se sigue sin un total que mostrar: lo que se revisa en el paso 3 tiene que poder calcularse.
                deshabilitado={paso === 2 && calculo === null}
                alTocar={() => {
                  irAlPaso(paso === 1 ? 2 : 3);
                }}
              >
                {pasos.botones.siguiente}
              </Boton>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
