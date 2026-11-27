import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  fijarElControlDeStock,
  verElControlDeStock,
  verLaExistenciaPropia,
  type ExistenciaPropia,
  type DependenciasDeControlDeStockWeb,
  type ResultadoDeControlDeStock,
} from "../../../src/composicion/control-de-stock-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";

/**
 * El tilde «Se controla el stock» de la ficha del producto: la lectura y el cambio. Finos a propósito (ADR-015, punto 2): quien llama ya resolvió QUIÉN y DÓNDE actúa (`conLaEmpresa`) y la
 * composición `src/composicion/control-de-stock-web.ts` es donde se prueba el resto. El permiso y las condiciones (clase, producto activo, receta vigente) las decide el servidor dentro de
 * la transacción: la pantalla no replica ninguna regla.
 */

const dependencias: DependenciasDeControlDeStockWeb = {
  casosDeUso: web.casosDeUsoDeStock,
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Si el producto lleva control de stock. Si no se puede leer (módulo sin activar, sin permiso, falla), la casilla no se ofrece. */
export function cargarElControlDeStock(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<Readonly<{ controlado: boolean }>>> {
  return verElControlDeStock(dependencias, contexto, productoId);
}

/** Fija (no alterna) el control de stock del producto; repetirlo no duplica nada. Al encender un plato con cuentas abiertas pide confirmar (`confirmarCuentasAbiertas`, DEC-PRO-004). */
export function fijarElControl(
  contexto: ContextoOperativo,
  productoId: string,
  controlado: boolean,
  confirmarCuentasAbiertas = false,
): Promise<Respuesta<ResultadoDeControlDeStock>> {
  return fijarElControlDeStock(dependencias, contexto, {
    productoId,
    controlado,
    ...(confirmarCuentasAbiertas ? { confirmarCuentasAbiertas } : {}),
  });
}

/** La existencia propia de un producto con stock propio, o `null` si no se pudo saber (la franja no muestra número). Solo lectura. */
export function cargarLaExistenciaPropia(
  contexto: ContextoOperativo,
  entrada: Readonly<{ productoId: string; nombre: string; unidadId: string }>,
): Promise<Respuesta<ExistenciaPropia | null>> {
  return verLaExistenciaPropia(dependencias, contexto, entrada);
}
