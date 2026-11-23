"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { fechaYHoraParaMostrar } from "../../../../../src/primitivas/tiempo/instante-para-mostrar";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonIcono } from "../../componentes/BotonIcono";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { AnularElTicket } from "../cobrar/AnularElTicket.cliente";
import estilosDeCobrar from "../cobrar/Cobrar.module.css";
import type { PapelDeTicket } from "../cobrar/PapelDelTicket.cliente";
import { TicketDelCliente } from "../cobrar/TicketDelCliente.cliente";
import { nombreDelTipo } from "../caja/modelo-de-medios-de-pago";
import type { TicketAnulado } from "../cobrar/modelo-de-cobro";
import { rotuloDelTicket, type TextosDeCobrar } from "../cobrar/textos-de-cobrar";
import { RUTA_DE_TICKETS_DEL_DIA } from "../venta/rutas-de-venta";
import {
  estadoEscrito,
  lineaDeLaFicha,
  textoDelEstado,
  type FichaDelTicketParaLaPantalla,
} from "./modelo-de-tickets-del-dia";
import { jornadaParaMostrar, type TextosDeTicketsDelDia } from "./textos-de-tickets-del-dia";
import estilos from "./TicketsDelDia.module.css";

export type PropsDeFichaDelTicket = Readonly<{
  ficha: FichaDelTicketParaLaPantalla;
  textos: TextosDeTicketsDelDia;
  /** Los textos de la hoja de anular y del «Ticket del cliente» (los mismos de la venta rápida: una sola hoja, un solo papel). */
  textosDeCobrar: TextosDeCobrar;
  anular: (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;
  /** El papel del ticket (lectura: repetirla no cambia nada ni deja registro). */
  imprimir: (pedido: unknown) => Promise<Respuesta<PapelDeTicket>>;
  /** Genera el id del ejemplar de anulación (una vez por intento). Sin decirlo, un UUID del navegador: la página de servidor no puede pasar funciones. */
  nuevoId?: (() => string) | undefined;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * La ficha de un ticket de la jornada (maqueta `tickets-del-dia.html`, `vFicha`): la franja de estado, la jornada, cuándo y quién (el correo; si falta, no se dibuja la línea), los renglones tal como los entrega el servidor
 * (el anulado, los del original), el «Total» (el original), los «Cobros» con su medio, su cuenta y el nombre de la caja, y el pie: «Imprimir ticket» solo si el servidor dice que se puede y «Anular» en todo lo que no está anulado.
 * La pantalla NO esconde «Anular» por permiso, factura ni día cerrado (Interfaz sobria): el servidor responde y la respuesta se muestra dentro de la hoja.
 *  - «Imprimir ticket»: pide el papel y muestra «Ticket del cliente» (la vista de la venta rápida) con su «Volver» a la ficha. Guarda síncrona: un doble toque pide el papel una sola vez.
 *  - «Anular»: abre la hoja compartida con el ejemplar VIGENTE como base (idempotente por intento, como en el resultado del cobro). Anulado, la hoja se cierra y la ficha se vuelve a leer del servidor.
 *  - Ante CUALQUIER rechazo se vuelve a leer la ficha (no se adivina el motivo): si volvió anulada (otra persona ya lo anuló), la hoja se cierra y arriba queda el aviso genérico; si no, la hoja sigue abierta con su error.
 */
export function FichaDelTicket({
  ficha,
  textos,
  textosDeCobrar,
  anular,
  imprimir,
  nuevoId = () => crypto.randomUUID(),
  esperaEntreVerificacionesMs,
}: PropsDeFichaDelTicket) {
  const router = useRouter();
  const [anulando, setAnulando] = useState(false);
  const [huboRechazo, setHuboRechazo] = useState(false);
  const [papel, setPapel] = useState<PapelDeTicket | null>(null);
  const [pidiendoElPapel, setPidiendoElPapel] = useState(false);
  const [errorDelPapel, setErrorDelPapel] = useState<ErrorPublico | null>(null);
  const yaPidiendo = useRef(false);

  const estaAnulado = ficha.estado === "ANULADO";
  // Releída la ficha y anulada (por esta persona o por otra): la hoja ya no tiene nada que hacer, aunque el estado local siga en «anulando».
  const hojaAbierta = anulando && !estaAnulado;

  const alImprimirTicket = async () => {
    if (yaPidiendo.current) return;
    yaPidiendo.current = true;
    setPidiendoElPapel(true);
    setErrorDelPapel(null);
    try {
      const respuesta = await imprimir({ ticketId: ficha.ticketId });
      if (respuesta.ok) setPapel(respuesta.dato);
      else setErrorDelPapel(respuesta.error);
    } finally {
      yaPidiendo.current = false;
      setPidiendoElPapel(false);
    }
  };

  if (papel !== null) {
    return (
      <TicketDelCliente
        papel={papel}
        textos={textosDeCobrar}
        alVolver={() => {
          setPapel(null);
        }}
      />
    );
  }

  const estado = estadoEscrito(ficha);
  const textoDelEstadoEscrito = textoDelEstado(estado, textos);
  return (
    <section className={estilosDeCobrar["vista"]} aria-labelledby="titulo-de-la-ficha">
      <header className={estilosDeCobrar["encabezado"]}>
        <BotonIcono
          etiqueta={textos.volver}
          icono="atras"
          alTocar={() => {
            router.push(RUTA_DE_TICKETS_DEL_DIA);
          }}
        />
        <h2 id="titulo-de-la-ficha" className={estilosDeCobrar["titulo"]}>
          {rotuloDelTicket(ficha.numero)}
        </h2>
      </header>
      <div className={estilos["cuerpo"]}>
        {huboRechazo && estaAnulado ? <Aviso tono="peligro">{textos.noPermitido}</Aviso> : null}
        {estaAnulado && ficha.anulacion !== null ? (
          <Aviso tono="info" titulo={textoDelEstadoEscrito}>
            <span data-motivo-anulado>{ficha.anulacion.motivo}</span>
            {ficha.anulacion.hechaPor === null ? null : (
              <span className={estilos["suave"]}> {ficha.anulacion.hechaPor}</span>
            )}
            <span className={estilos["suave"]}>
              {" "}
              {fechaYHoraParaMostrar(ficha.anulacion.hechaEn)}
            </span>
          </Aviso>
        ) : (
          <Aviso
            tono={estado === "COBRADO" || estado === "COBRADO_Y_FACTURADO" ? "exito" : "info"}
            titulo={textoDelEstadoEscrito}
          >
            {null}
          </Aviso>
        )}
        <div>
          <p className={estilos["jornada"]}>{jornadaParaMostrar(ficha.fechaNegocio)}</p>
          <p className={estilos["suave"]}>{fechaYHoraParaMostrar(ficha.emitidoEn)}</p>
          {ficha.emitidoPor === null ? null : (
            <p className={estilos["suave"]}>{ficha.emitidoPor}</p>
          )}
        </div>
        <div className={estilos["lista"]}>
          {ficha.renglones.map((r) => {
            const linea = lineaDeLaFicha(r);
            return (
              <div key={linea.clave} className={estilos["renglon"]}>
                <span>{linea.titulo}</span>
                <span>{linea.importe}</span>
                {linea.detalle === "" ? null : (
                  <span className={estilos["detalle"]}>{linea.detalle}</span>
                )}
              </div>
            );
          })}
          <p className={estilosDeCobrar["total"]}>
            <strong>{textos.total}</strong>
            <strong>{formatearImporte(ficha.totalOriginal.monto)}</strong>
          </p>
        </div>
        {ficha.cobros.length === 0 ? null : (
          <div className={estilos["lista"]}>
            <h3 className={estilos["seccion"]}>{textos.cobros}</h3>
            {ficha.cobros.map((c) => (
              <div key={c.orden} className={estilos["renglon"]}>
                <span>{nombreDelTipo(c.medioTipo)}</span>
                <span>{formatearImporte(c.importe.monto)}</span>
                {c.cuentaDeCobro === null ? null : (
                  <span className={estilos["detalle"]}>{c.cuentaDeCobro.nombre}</span>
                )}
              </div>
            ))}
            {ficha.caja === null ? null : <p className={estilos["suave"]}>{ficha.caja.nombre}</p>}
          </div>
        )}
        {errorDelPapel === null ? null : <ErrorDeRespuesta error={errorDelPapel} />}
      </div>
      {estaAnulado ? null : (
        <div className={estilosDeCobrar["pie"]}>
          <div className={estilosDeCobrar["acciones"]}>
            {ficha.imprimible ? (
              <Boton
                variante="secundaria"
                ancho="completo"
                enviando={pidiendoElPapel}
                alTocar={() => {
                  void alImprimirTicket();
                }}
              >
                {textos.imprimirTicket}
              </Boton>
            ) : null}
            <Boton
              variante="secundaria"
              ancho="completo"
              alTocar={() => {
                setAnulando(true);
              }}
            >
              {textos.anular}
            </Boton>
          </div>
        </div>
      )}
      {hojaAbierta ? (
        <AnularElTicket
          venta={{
            ticketId: ficha.ticketId,
            ejemplarId: ficha.ejemplarVigenteId,
            numero: ficha.numero,
          }}
          textos={textosDeCobrar}
          anular={anular}
          alCancelar={() => {
            setAnulando(false);
          }}
          alAnulado={() => {
            setHuboRechazo(false);
            setAnulando(false);
            router.refresh();
          }}
          alRechazado={() => {
            setHuboRechazo(true);
            router.refresh();
          }}
          nuevoId={nuevoId}
          esperaEntreVerificacionesMs={esperaEntreVerificacionesMs}
        />
      ) : null}
    </section>
  );
}
