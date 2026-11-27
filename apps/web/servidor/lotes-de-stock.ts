import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  lotesDelArticulo,
  vencimientosDeLaSucursal,
  type DependenciasDeLotesWeb,
  type LotesParaLaPantalla,
  type VencimientosParaLaPantalla,
} from "../../../src/composicion/lotes-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * La pestaña «Lotes» de stock: dos LECTURAS finas (ADR-015, punto 2). Los vencimientos se piden de la sucursal elegida en el dispositivo (`laSucursalDeStock`, validada contra el alcance: nunca «todas»,
 * nunca la del navegador); los lotes de un artículo, de lo que el guard `lotes.ver` deja ver a quien mira. La forma de lo que vino en la dirección la valida la composición. No escriben ni auditan.
 */

const dependencias: DependenciasDeLotesWeb = {
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

export function cargarLosLotes(
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<LotesParaLaPantalla>> {
  return lotesDelArticulo(dependencias, contexto, crudo);
}

export async function cargarLosVencimientos(
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<VencimientosParaLaPantalla>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return vencimientosDeLaSucursal(dependencias, contexto, sucursal.dato, crudo);
}
