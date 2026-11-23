import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  fichaDeLaCompra,
  listarLasCompras,
  type DependenciasDeComprasListaWeb,
  type FichaDeCompraParaLaPantalla,
  type ListaDeComprasParaLaPantalla,
} from "../../../src/composicion/compras-lista-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Las lecturas de «Compras» (lista) y «Compra» (ficha) para las páginas (Compras PR 3). Finas, como `tickets-del-dia.ts`: resuelven DÓNDE se mira (la sucursal elegida en este dispositivo,
 * validada contra las que la persona puede elegir; nunca la que diga el navegador; sin ninguna, el genérico, nunca «todas») y llaman a `src/composicion/compras-lista-web.ts`, donde se prueba todo
 * lo demás. El contexto (persona y empresa) lo resuelve la página. Ninguna decide permisos ni redirige: cada consulta exige `recepciones.ver` y `comprobantes_de_proveedor.ver` adentro.
 */

export type { FichaDeCompraParaLaPantalla, ListaDeComprasParaLaPantalla };

const dependencias: DependenciasDeComprasListaWeb = {
  consultas: web.consultasDeCompras,
  consultasDeIdentidad: web.consultasDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") } as const;

/** Las compras de la sucursal con la que trabaja la persona; `parametros` es lo que trae la dirección (la consulta toma solo lo que declara). */
export async function cargarLasCompras(
  contexto: ContextoOperativo,
  parametros: unknown,
): Promise<Respuesta<ListaDeComprasParaLaPantalla>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
  return listarLasCompras(dependencias, contexto, sucursal.dato.efectiva, parametros);
}

/** La ficha de una compra; el alcance (la sucursal de la compra) lo valida la consulta. */
export function cargarLaFichaDeCompra(
  contexto: ContextoOperativo,
  recepcionId: string,
): Promise<Respuesta<FichaDeCompraParaLaPantalla>> {
  return fichaDeLaCompra(dependencias, contexto, recepcionId);
}
