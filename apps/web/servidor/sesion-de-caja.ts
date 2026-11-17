import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  cargarElConteo,
  cargarLaCaja,
  type ConteoParaLaPantalla,
  type LaCajaParaLaPantalla,
} from "../../../src/composicion/lecturas-de-sesion-de-caja-web";
import {
  abrirLaCaja,
  anularElMovimiento,
  cancelarElCierreDeCaja,
  cerrarLaCaja,
  iniciarElCierreDeCaja,
  registrarElAjuste,
  registrarElMovimiento,
  type DependenciasDeSesionDeCajaWeb,
} from "../../../src/composicion/sesion-de-caja-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { laSucursal } from "./cajas";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * La pantalla «Caja» del mostrador: las lecturas y las acciones de abrir, contar y cerrar, mover efectivo, ajustar y anular un movimiento. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y
 * DÓNDE actúa y llaman a `src/composicion/sesion-de-caja-web.ts`, donde se prueba todo lo demás. La sucursal la fija el SERVIDOR (la elegida en este dispositivo, validada contra las que la persona
 * puede elegir, `laSucursal`), nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»). La empresa y la persona salen de la sesión. Del pedido solo viene lo que cada
 * acción declara (la clave que generó la pantalla, la sesión o el movimiento, los importes y los motivos): el permiso, el estado de la caja y la jornada los decide el servidor dentro de su
 * transacción; la pantalla no replica ninguna regla. Cada acción que escribe lleva la clave de la pantalla o se resuelve por el estado de la sesión: repetirla no duplica nada.
 */

const dependencias: DependenciasDeSesionDeCajaWeb = {
  casosDeUso: web.casosDeUsoDeCaja,
  consultas: web.consultasDeCaja,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Lo que muestra la pantalla «Caja» de la sucursal elegida. Con el contexto que ya resolvió la página. */
export async function cargarLaCajaDeLaSucursal(
  contexto: ContextoOperativo,
): Promise<Respuesta<LaCajaParaLaPantalla>> {
  const sucursal = await laSucursal(contexto);
  if (!sucursal.ok) return sucursal;
  return cargarLaCaja(dependencias, contexto, sucursal.dato);
}

/** Lo que hay que contar para cerrar la sesión (pantalla «Contar»). Con el contexto que ya resolvió la página. */
export function cargarElConteoDeLaCaja(
  contexto: ContextoOperativo,
  pedido: unknown,
): Promise<Respuesta<ConteoParaLaPantalla>> {
  return cargarElConteo(dependencias, contexto, pedido);
}

export function abrirLaCajaDeLaSucursal(pedido: unknown) {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await laSucursal(contexto);
    if (!sucursal.ok) return sucursal;
    return abrirLaCaja(dependencias, contexto, sucursal.dato, pedido);
  });
}

export function iniciarElCierreDeLaCaja(pedido: unknown) {
  return conLaEmpresa((contexto) => iniciarElCierreDeCaja(dependencias, contexto, pedido));
}

export function cancelarElCierreDeLaCaja(pedido: unknown) {
  return conLaEmpresa((contexto) => cancelarElCierreDeCaja(dependencias, contexto, pedido));
}

export function cerrarLaCajaConElArqueo(pedido: unknown) {
  return conLaEmpresa((contexto) => cerrarLaCaja(dependencias, contexto, pedido));
}

export function registrarElMovimientoDeCaja(pedido: unknown) {
  return conLaEmpresa((contexto) => registrarElMovimiento(dependencias, contexto, pedido));
}

export function registrarElAjusteDeCaja(pedido: unknown) {
  return conLaEmpresa((contexto) => registrarElAjuste(dependencias, contexto, pedido));
}

export function anularElMovimientoDeCaja(pedido: unknown) {
  return conLaEmpresa((contexto) => anularElMovimiento(dependencias, contexto, pedido));
}
