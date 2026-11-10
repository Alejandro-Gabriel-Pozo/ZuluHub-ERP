import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion } from "../../../src/composicion/a-respuesta";
import {
  emitirDesdeTicket,
  listarPendientesDeFacturar,
  ticketParaEmitir,
  type DependenciasDeFacturarTicketsWeb,
  type FacturaDeTicketParaLaPantalla,
  type PendientesDeFacturarParaLaPantalla,
  type TicketParaEmitirParaLaPantalla,
} from "../../../src/composicion/facturar-tickets-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conIntentoInmediato, conLaEmpresa } from "./facturacion";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Las acciones de servidor para facturar un ticket cobrado (E1 §3.6). Finas, como las del facturador (`facturacion.ts`): resuelven DÓNDE y
 * QUIÉN actúa y llaman a `src/composicion/facturar-tickets-web.ts`, donde se prueba todo lo demás. Ninguna decide permisos ni toca la base:
 * cada caso de uso y consulta exige los suyos adentro. La empresa y la persona salen de la sesión; del pedido solo viene el ticket, el punto
 * de venta, la clave de la pantalla y el receptor.
 */

const dependencias: DependenciasDeFacturarTicketsWeb = {
  casosDeUso: web.casosDeUsoDeVentas,
  consultas: web.consultasDeVentas,
  respuesta: dependenciasDeSesion.respuesta,
};

/**
 * Los tickets cobrados pendientes de facturar de la sucursal con la que trabaja la persona (la elegida o la única abierta). Sin una
 * sucursal con la que listar NUNCA se asume «todas»: responde que falta elegirla. La sucursal sale del servidor (cookie validada), no del
 * pedido; el resto del pedido (límite, motivo, página) lo lee `entradas-de-facturar-tickets.ts`.
 */
export async function pendientesDeFacturar(
  contexto: ContextoOperativo,
  pedido?: unknown,
): Promise<Respuesta<PendientesDeFacturarParaLaPantalla>> {
  try {
    const sucursal = await sucursalDelPedido(contexto);
    if (!sucursal.ok) return sucursal;
    if (sucursal.dato.efectiva === "") {
      return { ok: false, error: errorDeCodigo("FISCAL_SUCURSAL_NO_ELEGIDA") };
    }
    const resto = typeof pedido === "object" && pedido !== null ? pedido : {};
    return await listarPendientesDeFacturar(dependencias, contexto, {
      ...resto,
      sucursalId: sucursal.dato.efectiva,
    });
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}

/** El ticket que se va a facturar, con lo congelado de su ejemplar vigente. Con el contexto que ya resolvió la página. */
export function ticketParaEmitirDeLaPagina(
  contexto: ContextoOperativo,
  pedido: unknown,
): Promise<Respuesta<TicketParaEmitirParaLaPantalla>> {
  return ticketParaEmitir(dependencias, contexto, pedido).catch((excepcion: unknown) =>
    aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta),
  );
}

/** Factura el ticket (idempotente por la clave de la pantalla) y pide el intento inmediato de ARCA, como emitir a mano. */
export function emitirElTicket(pedido: unknown): Promise<Respuesta<FacturaDeTicketParaLaPantalla>> {
  return conLaEmpresa(async (contexto) =>
    conIntentoInmediato(contexto, await emitirDesdeTicket(dependencias, contexto, pedido)),
  );
}
