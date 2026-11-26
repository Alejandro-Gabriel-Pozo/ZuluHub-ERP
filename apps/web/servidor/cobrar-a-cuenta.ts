import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cobrarUnTicketACuenta,
  ticketACobrarDelCliente,
  type DependenciasDeCobrarACuentaWeb,
  type TicketACobrarParaLaPantalla,
  type TicketCobradoACuentaParaLaPantalla,
} from "../../../src/composicion/cobrar-a-cuenta-web";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * «Cobrar un ticket a cuenta» (CC-5 B2a): resuelve QUIÉN y DÓNDE (sesión y empresa elegida, nunca lo que diga el navegador) y llama a `src/composicion/cobrar-a-cuenta-web.ts`, donde se prueba todo lo demás. La
 * sucursal es la del ticket y la validan la lectura y el cobro contra el alcance de quien cobra; no viaja. Permisos: `ventas.ver` y `tickets.cobrar`; el saldo de después pide además `cuenta_corriente.ver`.
 * Escribe dinero: la clave de idempotencia y el ejemplar los genera la pantalla al abrir la hoja y los repite en cada reintento. Chequeo: `test/integracion/cobrar-a-cuenta-web.test.ts`.
 */

const dependencias: DependenciasDeCobrarACuentaWeb = {
  cobro: () => web.cobroACuenta(),
  casosDeUso: () => web.casosDeUsoDeVentas(),
  consultas: () => web.consultasDeVentas(),
  respuesta: dependenciasDeSesion.respuesta,
};

/** La hoja de cobro del cargo pendiente más antiguo del cliente (o del ticket pedido): una lectura. */
export function leerElTicketACobrar(
  pedido: unknown,
): Promise<Respuesta<TicketACobrarParaLaPantalla | null>> {
  return conLaEmpresa((contexto) => ticketACobrarDelCliente(dependencias, contexto, pedido));
}

/** Cobra el ticket a cuenta. Repetir con la misma clave devuelve lo hecho. */
export function cobrarElTicketACuenta(
  pedido: unknown,
): Promise<Respuesta<TicketCobradoACuentaParaLaPantalla>> {
  return conLaEmpresa((contexto) => cobrarUnTicketACuenta(dependencias, contexto, pedido));
}
