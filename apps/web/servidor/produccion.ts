import "server-only";
import { redirect } from "next/navigation";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  anularLaOrden,
  cancelarLaOrden,
  listarLasOrdenes,
  verLaOrden,
  type DependenciasDeProduccionWeb,
  type OrdenesParaLaLista,
  type OrdenParaLaPantalla,
} from "../../../src/composicion/produccion-web";
import type { EntradaDeLaListaDeOrdenes } from "../../../src/composicion/entradas-de-produccion";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { rutaDeLaOrden } from "../ui/plantillas/produccion/filtros-de-ordenes";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Las órdenes de producción (maqueta `produccion.html`): la lista, la ficha, cancelar y anular. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa y llaman a
 * `src/composicion/produccion-web.ts`, donde se prueba el resto. La sucursal de la lista la fija el SERVIDOR: es la elegida en este dispositivo (cookie validada contra las que la persona
 * puede elegir, `sucursalDelPedido`), nunca la que diga el navegador; sin ninguna, el genérico (nunca se asume «todas»). El permiso (`transformaciones.*`), el módulo en desarrollo y el
 * alcance de sucursales los decide el servidor dentro de la transacción: la pantalla no replica ninguna regla. Cómo se repite sin duplicar: cancelar lo cancelado y anular lo anulado no
 * escriben ni auditan (`yaEstaba`). El id de la orden no viaja en el formulario: lo fija la página al armar la acción (`bind`).
 */

const dependencias: DependenciasDeProduccionWeb = {
  casosDeUso: web.casosDeUsoDeProduccion,
  consultas: web.consultasDeProduccion,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = {
  ok: false,
  error: errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA"),
} as const;

/** Las órdenes de la sucursal elegida, con el filtro de la dirección. */
export async function cargarLasOrdenes(
  contexto: ContextoOperativo,
  entrada: EntradaDeLaListaDeOrdenes,
): Promise<Respuesta<OrdenesParaLaLista>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
  return listarLasOrdenes(dependencias, contexto, sucursal.dato.efectiva, entrada);
}

/** La ficha de una orden de la empresa, con el contexto que ya resolvió la página. */
export function cargarLaOrden(
  contexto: ContextoOperativo,
  ordenId: string,
): Promise<Respuesta<OrdenParaLaPantalla>> {
  return verLaOrden(dependencias, contexto, { ordenId });
}

/** Termina la acción: el error ya traducido, o vuelve a la ficha de la orden (con su estado nuevo). `redirect` corta la ejecución. */
function aLaFicha(respuesta: Respuesta<unknown>, ordenId: string): ResultadoDeAccion {
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(rutaDeLaOrden(ordenId));
}

export async function cancelarLaOrdenDeLaFicha(
  ordenId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaFicha(
    await conLaEmpresa((contexto) =>
      cancelarLaOrden(dependencias, contexto, { ordenId, motivo: textoDe(datos, "motivo") }),
    ),
    ordenId,
  );
}

export async function anularLaOrdenDeLaFicha(
  ordenId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaFicha(
    await conLaEmpresa((contexto) =>
      anularLaOrden(dependencias, contexto, { ordenId, motivo: textoDe(datos, "motivo") }),
    ),
    ordenId,
  );
}
