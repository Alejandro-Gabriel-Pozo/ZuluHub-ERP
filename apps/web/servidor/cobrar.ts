import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  anularElTicket,
  cobrarLaVenta,
  cobroParaLaPantalla,
  papelDelTicket,
  type CobroPreparadoParaLaPantalla,
  type DependenciasDeCobrarWeb,
  type PapelDelTicketParaLaPantalla,
  type TicketAnuladoParaLaPantalla,
  type VentaCobradaParaLaPantalla,
} from "../../../src/composicion/cobrar-web";
import {
  cobrarLaMesa,
  type DependenciasDeCobrarMesaWeb,
} from "../../../src/composicion/cobrar-mesa-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { sucursalDeTrabajo } from "./salon";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Las acciones de servidor para COBRAR en el mostrador y anular desde el resultado (K3 y K5). Finas, como las de facturar tickets (`facturar-tickets.ts`): resuelven
 * QUIÉN y DÓNDE actúa y llaman a `src/composicion/cobrar-web.ts`, donde se prueba todo lo demás. Ninguna decide permisos ni toca la base: cada caso de uso y
 * consulta exige los suyos adentro. La empresa y la persona salen de la sesión y LA SUCURSAL la fija el SERVIDOR (la elegida en este dispositivo, validada contra las
 * que la persona puede elegir): nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»). Del pedido solo viene lo que declara
 * `entradas-de-cobrar.ts`: la clave de idempotencia y los ids de la venta los genera la pantalla una vez por intento y los repite en cada reintento.
 */

export type {
  PapelDelTicketParaLaPantalla,
  TicketAnuladoParaLaPantalla,
  VentaCobradaParaLaPantalla,
};

const dependencias: DependenciasDeCobrarWeb = {
  casosDeUso: web.casosDeUsoDeVentas,
  consultas: web.consultasDeVentas,
  respuesta: dependenciasDeSesion.respuesta,
};

const dependenciasDeLaMesa: DependenciasDeCobrarMesaWeb = {
  casosDeUso: web.casosDeUsoDeSalon,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") } as const;

/** La sucursal con la que trabaja la persona, o el genérico si no hay ninguna. */
async function laSucursal(contexto: ContextoOperativo): Promise<Respuesta<string>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  return sucursal.dato.efectiva === "" ? SIN_SUCURSAL : { ok: true, dato: sucursal.dato.efectiva };
}

/**
 * Lo que la pantalla de venta necesita para abrir la hoja de cobro: la caja que se usa y sus opciones, o por qué no se puede cobrar (sin caja abierta, día en cierre…). Con el contexto que ya resolvió
 * la página. Es una lectura. Si una lectura falla, la hoja sale cerrada (el genérico): la venta se puede armar igual y el error inesperado ya quedó registrado con su referencia.
 */
export async function cobroDeLaPagina(
  contexto: ContextoOperativo,
): Promise<Respuesta<CobroPreparadoParaLaPantalla>> {
  const sucursal = await laSucursal(contexto);
  if (!sucursal.ok) return sucursal;
  return cobroParaLaPantalla(dependencias, contexto, sucursal.dato);
}

/** Cobra la venta del mostrador en un acto (idempotente por la clave de la pantalla). */
export function cobrarLaVentaDelMostrador(
  pedido: unknown,
): Promise<Respuesta<VentaCobradaParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return cobrarLaVenta(dependencias, contexto, sucursal.dato, pedido);
  });
}

/**
 * Cobra LA MESA (SAL-D): la cuenta que ya existe, en un acto y con la mesa libre al final (idempotente por la clave de la pantalla). La sucursal la fija el servidor (la de trabajo, validada contra el alcance); sin ninguna, el
 * genérico. El permiso lo exige el caso de uso adentro (`cuentas.cerrar`, `tickets.cobrar` y `cuentas.anular`).
 */
export function cobrarLaMesaDelSalon(
  pedido: unknown,
): Promise<Respuesta<VentaCobradaParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDeTrabajo(contexto);
    if (!sucursal.ok) return sucursal;
    return cobrarLaMesa(dependenciasDeLaMesa, contexto, sucursal.dato, pedido);
  });
}

/** Anula el ticket recién cobrado con el ejemplar del resultado, un motivo y la clave de la pantalla. La sucursal la fija el servidor (la de trabajo): un ticket de otra es el genérico. */
export function anularElTicketDelMostrador(
  pedido: unknown,
): Promise<Respuesta<TicketAnuladoParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return anularElTicket(dependencias, contexto, sucursal.dato, pedido);
  });
}

/** El papel del ticket recién cobrado para imprimirlo (lectura). No pide sucursal: la consulta valida la del ticket contra el alcance de la persona. */
export function papelDelTicketDelMostrador(
  pedido: unknown,
): Promise<Respuesta<PapelDelTicketParaLaPantalla>> {
  return conLaEmpresa((contexto) => papelDelTicket(dependencias, contexto, pedido));
}
