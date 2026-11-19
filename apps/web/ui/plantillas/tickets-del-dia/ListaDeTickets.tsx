import { horaParaMostrar } from "../../../../../src/primitivas/tiempo/instante-para-mostrar";
import { rotuloDelTicket } from "../cobrar/textos-de-cobrar";
import { rutaDeLaFichaDelTicket } from "../venta/rutas-de-venta";
import {
  estadoEscrito,
  importeDeLaFila,
  nombreAccesibleDeLaFila,
  textoDelEstado,
  type TicketsDelDiaParaLaPantalla,
} from "./modelo-de-tickets-del-dia";
import { jornadaParaMostrar, type TextosDeTicketsDelDia } from "./textos-de-tickets-del-dia";
import estilos from "./TicketsDelDia.module.css";

export type PropsDeListaDeTickets = Readonly<{
  lista: TicketsDelDiaParaLaPantalla;
  textos: TextosDeTicketsDelDia;
}>;

/**
 * «Tickets del día» (maqueta `tickets-del-dia.html`, `vLista`): la jornada y, debajo, un ticket por fila con su número, su estado, la hora (de Argentina) y el total; lo último arriba, tal como lo entrega el servidor.
 * Sin buscador, filtros ni páginas. Cada fila es un enlace a la ficha del ticket (el dueño, 18/11/2026) con su nombre accesible completo; el total del anulado va tachado y es el original. Vacía: el texto y nada más.
 * Sin estado ni hooks: es una página de servidor.
 */
export function ListaDeTickets({ lista, textos }: PropsDeListaDeTickets) {
  return (
    <div className={estilos["cuerpo"]}>
      <p className={estilos["jornada"]}>{jornadaParaMostrar(lista.fechaNegocio)}</p>
      {lista.tickets.length === 0 ? (
        <p className={estilos["vacio"]}>{textos.vacio}</p>
      ) : (
        <ul className={estilos["lista"]}>
          {lista.tickets.map((t) => {
            const importe = importeDeLaFila(t);
            return (
              <li key={t.ticketId}>
                <a
                  className={estilos["fila"]}
                  href={rutaDeLaFichaDelTicket(t.ticketId)}
                  aria-label={nombreAccesibleDeLaFila(t, textos)}
                >
                  <span className={estilos["numero"]}>{rotuloDelTicket(t.numero)}</span>{" "}
                  <span className={estilos["estado"]}>
                    {textoDelEstado(estadoEscrito(t), textos)}
                  </span>{" "}
                  <span className={estilos["hora"]}>{horaParaMostrar(t.emitidoEn)}</span>{" "}
                  <span className={estilos["importe"]}>
                    {importe.tachado ? <s>{importe.monto}</s> : importe.monto}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
