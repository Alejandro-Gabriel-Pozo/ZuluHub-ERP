import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  anularElTicket,
  cajasParaCobrar,
  cobrarLaVenta,
  opcionesDeCobroDeLaCaja,
  type CajasParaCobrarParaLaPantalla,
  type DependenciasDeCobrarWeb,
  type OpcionesDeCobroParaLaPantalla,
  type TicketAnuladoParaLaPantalla,
  type VentaCobradaParaLaPantalla,
} from "../../../src/composicion/cobrar-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Las acciones de servidor para COBRAR en el mostrador y anular desde el resultado (K3 y K5). Finas, como las de facturar tickets (`facturar-tickets.ts`): resuelven
 * QUIÉN y DÓNDE actúa y llaman a `src/composicion/cobrar-web.ts`, donde se prueba todo lo demás. Ninguna decide permisos ni toca la base: cada caso de uso y
 * consulta exige los suyos adentro. La empresa y la persona salen de la sesión y LA SUCURSAL la fija el SERVIDOR (la elegida en este dispositivo, validada contra las
 * que la persona puede elegir): nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»). Del pedido solo viene lo que declara
 * `entradas-de-cobrar.ts`: la clave de idempotencia y los ids de la venta los genera la pantalla una vez por intento y los repite en cada reintento.
 */

const dependencias: DependenciasDeCobrarWeb = {
  casosDeUso: web.casosDeUsoDeVentas,
  consultas: web.consultasDeVentas,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") } as const;

/** La sucursal con la que trabaja la persona, o el genérico si no hay ninguna. */
async function laSucursal(contexto: ContextoOperativo): Promise<Respuesta<string>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  return sucursal.dato.efectiva === "" ? SIN_SUCURSAL : { ok: true, dato: sucursal.dato.efectiva };
}

/** Las cajas de la sucursal elegida con su estado (sin sesión, abierta o en cierre) y la jornada de hoy. Con el contexto que ya resolvió la página. */
export async function cajasParaCobrarDeLaPagina(
  contexto: ContextoOperativo,
): Promise<Respuesta<CajasParaCobrarParaLaPantalla>> {
  const sucursal = await laSucursal(contexto);
  if (!sucursal.ok) return sucursal;
  return cajasParaCobrar(dependencias, contexto, sucursal.dato);
}

/** Medios, cuentas, datos que pide cada medio y marcas de una caja. Con el contexto que ya resolvió la página. */
export function opcionesDeCobroDeLaPagina(
  contexto: ContextoOperativo,
  pedido: unknown,
): Promise<Respuesta<OpcionesDeCobroParaLaPantalla>> {
  return opcionesDeCobroDeLaCaja(dependencias, contexto, pedido);
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

/** Anula el ticket recién cobrado con el ejemplar del resultado, un motivo y la clave de la pantalla. */
export function anularElTicketDelMostrador(
  pedido: unknown,
): Promise<Respuesta<TicketAnuladoParaLaPantalla>> {
  return conLaEmpresa((contexto) => anularElTicket(dependencias, contexto, pedido));
}
