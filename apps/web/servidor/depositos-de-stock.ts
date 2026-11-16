import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  listarLosDepositos,
  type DependenciasDeDepositosWeb,
  type DepositosParaLaPantalla,
} from "../../../src/composicion/depositos-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * «Depósitos» de stock: la lectura de la lista. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa y llaman a `src/composicion/depositos-web.ts`.
 * La sucursal la fija el SERVIDOR (`laSucursalDeStock`), nunca el navegador.
 */

const dependencias: DependenciasDeDepositosWeb = {
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Los depósitos de la sucursal elegida, también los desactivados. */
export async function cargarLosDepositos(
  contexto: ContextoOperativo,
): Promise<Respuesta<DepositosParaLaPantalla>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return listarLosDepositos(dependencias, contexto, sucursal.dato);
}
