import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  existenciasDelDeposito,
  movimientosDelDeposito,
  type DependenciasDeExistenciasYLibroWeb,
  type ExistenciasParaLaPantalla,
  type MovimientosParaLaPantalla,
} from "../../../src/composicion/existencias-y-libro-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * «Existencias» y «Movimientos» de stock: dos LECTURAS finas (ADR-015, punto 2). Resuelven DÓNDE se mira (`laSucursalDeStock`, la sucursal elegida en el dispositivo y validada contra el alcance: nunca «todas»,
 * nunca la del navegador) y llaman a `src/composicion/existencias-y-libro-web.ts`, que elige el depósito entre los de esa sucursal y arma la página. No escriben ni auditan.
 */

const dependencias: DependenciasDeExistenciasYLibroWeb = {
  consultas: web.consultasDeStock,
  consultasDeIdentidad: web.consultasDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Las existencias del depósito pedido (o el primero) de la sucursal elegida. `crudo` es lo que vino en la dirección: la composición valida su forma. */
export async function cargarLasExistencias(
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ExistenciasParaLaPantalla>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return existenciasDelDeposito(dependencias, contexto, sucursal.dato, crudo);
}

/** El libro del depósito pedido (o el primero) de la sucursal elegida. */
export async function cargarLosMovimientos(
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<MovimientosParaLaPantalla>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return movimientosDelDeposito(dependencias, contexto, sucursal.dato, crudo);
}
