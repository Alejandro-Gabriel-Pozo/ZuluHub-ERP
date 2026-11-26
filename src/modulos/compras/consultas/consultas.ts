import type { DependenciasDeConsultasDeCompras } from "../casos-de-uso/contrato";
import { crearLector } from "./comun";
import { armarConsultasDeCompras } from "./compras";
import { armarConsultasDeConciliacion } from "./conciliacion";
import { armarConsultasDeDevoluciones } from "./devoluciones";
import { armarConsultasDeNotasDeCredito } from "./notas-de-credito";
import { armarConsultasDeDiferencias } from "./diferencias";
import { armarConsultasDeFicha } from "./ficha";
import { armarConsultasParaComprar } from "./consultas-para-comprar";
import { armarConsultasDeNivel } from "./nivel";
import { armarConsultasDeOrdenes } from "./ordenes";
import { armarConsultasDeReemplazo } from "./reemplazo";

/**
 * Las consultas por pantalla de compras (ADR-005): solo lectura (`read committed`), cada una pide su acción al guard dentro de su transacción. Una fila de
 * otra empresa es indistinguible de una que no existe (la RLS).
 */
export function crearConsultasDeCompras(d: DependenciasDeConsultasDeCompras) {
  const leer = crearLector(d);
  return {
    ...armarConsultasDeFicha(leer),
    ...armarConsultasDeCompras(leer),
    ...armarConsultasParaComprar(leer),
    ...armarConsultasDeConciliacion(leer),
    ...armarConsultasDeNivel(leer),
    ...armarConsultasDeOrdenes(leer),
    ...armarConsultasDeDevoluciones(leer),
    ...armarConsultasDeNotasDeCredito(leer),
    ...armarConsultasDeReemplazo(leer),
    ...armarConsultasDeDiferencias(leer),
  };
}

export type ConsultasDeCompras = ReturnType<typeof crearConsultasDeCompras>;
