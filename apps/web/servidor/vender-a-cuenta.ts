import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cerrarLaMesaACuenta,
  listarLosClientesParaVender,
  venderLaVentaACuenta,
  verElClienteParaVender,
  type ClienteElegidoParaLaPantalla,
  type ClientesParaVenderParaLaPantalla,
  type DependenciasDeCerrarLaMesaACuenta,
  type DependenciasDeVenderACuentaEnElMostrador,
  type DependenciasDeVenderACuentaWeb,
  type VentaACuentaParaLaPantalla,
} from "../../../src/composicion/vender-a-cuenta-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * «Vender a cuenta corriente» (CC-5, B1b): las lecturas de la hoja (los clientes y el saldo de uno) y las dos acciones que cargan la venta a la cuenta del cliente (mostrador y mesa). Finas, como `cobrar.ts`: resuelven
 * QUIÉN y DÓNDE actúa y llaman a `src/composicion/vender-a-cuenta-web.ts`, donde se prueba todo lo demás. Ninguna decide permisos ni toca la base: cada consulta y caso de uso exige los suyos adentro. La empresa y la
 * persona salen de la sesión y LA SUCURSAL la fija el SERVIDOR (la elegida en este dispositivo, validada contra el alcance): nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»).
 */
export type { ClienteElegidoParaLaPantalla, ClientesParaVenderParaLaPantalla, VentaACuentaParaLaPantalla };

const dependenciasDeLaHoja: DependenciasDeVenderACuentaWeb = {
  consultas: web.consultasDeCuentaCorriente,
  casosDeUso: web.casosDeUsoDeCuentaCorriente,
  respuesta: dependenciasDeSesion.respuesta,
};

const dependenciasDelMostrador: DependenciasDeVenderACuentaEnElMostrador = {
  casosDeUso: web.casosDeUsoDeVentas,
  respuesta: dependenciasDeSesion.respuesta,
};

const dependenciasDeLaMesa: DependenciasDeCerrarLaMesaACuenta = {
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

/** Los clientes que se pueden elegir, con el contexto que ya resolvió la página. Es una lectura: sin el permiso de cargar a cuenta (o con el módulo cerrado) sale el genérico y la página no ofrece la hoja. */
export function clientesParaVenderDeLaPagina(
  contexto: ContextoOperativo,
): Promise<Respuesta<ClientesParaVenderParaLaPantalla>> {
  return listarLosClientesParaVender(dependenciasDeLaHoja, contexto);
}

/** El saldo, el crédito y lo que pasaría con esta venta de UN cliente elegido; deja su constancia. La sucursal de trabajo la fija el servidor. */
export function elClienteParaVenderDelMostrador(
  pedido: unknown,
): Promise<Respuesta<ClienteElegidoParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return verElClienteParaVender(dependenciasDeLaHoja, contexto, sucursal.dato, pedido);
  });
}

/** Confirma la venta rápida a cuenta (idempotente por la cuenta y el ejemplar de la pantalla). */
export function venderLaVentaACuentaDelMostrador(
  pedido: unknown,
): Promise<Respuesta<VentaACuentaParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return venderLaVentaACuenta(dependenciasDelMostrador, contexto, sucursal.dato, pedido);
  });
}

/** Cierra la mesa a cuenta (idempotente por la cuenta y el ejemplar de la pantalla). Una cuenta de otra sucursal es el genérico. */
export function cerrarLaMesaACuentaDelSalon(
  pedido: unknown,
): Promise<Respuesta<VentaACuentaParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return cerrarLaMesaACuenta(dependenciasDeLaMesa, contexto, sucursal.dato, pedido);
  });
}
