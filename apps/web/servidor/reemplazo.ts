import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import {
  cambiarElComprobanteDeLaCompra,
  loQueHayQueDeshacerAntesDeCambiar,
  loQueHayQueDeshacerAntesDeReemplazar,
  reemplazarLaFactura,
  type ComprobanteReemplazadoParaLaPantalla,
  type DependenciasDeReemplazoWeb,
  type QueHayQueDeshacerParaLaPantalla,
} from "../../../src/composicion/reemplazo-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  SIN_ACCIONES_DEL_REEMPLAZO,
  type AccionesDelReemplazo,
} from "../ui/plantillas/compras/reemplazo/modelo-de-reemplazo";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { permisosDeLaPersona, puedeLaAccion } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";

/**
 * «Reemplazar el comprobante» (NOTAS-2c-2): las lecturas para las páginas y las acciones para los formularios. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN actúa (la empresa y la persona salen de la SESIÓN, nunca
 * del formulario ni de la dirección) y llaman a `src/composicion/reemplazo-web.ts`, donde se prueba todo lo demás. Sin permiso para reemplazar la pantalla no se abre (el genérico): nace cerrada; el guard del caso de uso
 * vuelve a decidir, y el servidor revalida los frenos, el alcance y la versión de la factura dentro de la transacción. Ninguna acción redirige (un `redirect` dentro de una acción pierde el host): devuelven el
 * resultado y la pantalla navega.
 */

export type { ComprobanteReemplazadoParaLaPantalla, QueHayQueDeshacerParaLaPantalla };

const dependencias: DependenciasDeReemplazoWeb = {
  consultas: web.consultasDeCompras,
  casosDeUso: web.casosDeUsoDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

const NO_PERMITIDO = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") } as const;

/** Lo que la persona puede hacer en los pasos previos: solo ayuda para ofrecer o esconder enlaces (cada acción vuelve a pasar por el guard). Sin permisos leídos, todo cerrado. */
export async function accionesDelReemplazo(
  contexto: ContextoOperativo,
): Promise<AccionesDelReemplazo> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return SIN_ACCIONES_DEL_REEMPLAZO;
  const puede = (accion: ClaveAccion): boolean => permisos.acciones.includes(accion);
  return {
    anularPago: puede("comprobantes_de_proveedor.anular_pago"),
    anularConciliacion: puede("conciliaciones.anular"),
    verNotas:
      puede("notas_de_credito_de_proveedor.ver") && puede("notas_de_debito_de_proveedor.ver"),
  };
}

/** Si la persona puede reemplazar una factura (N3/N4): `comprobantes_de_proveedor.reemplazar`. Sirve para ofrecer o esconder el botón; ocultar no es autorizar. */
export function puedeReemplazarUnaFactura(contexto: ContextoOperativo): Promise<boolean> {
  return puedeLaAccion(contexto, "comprobantes_de_proveedor.reemplazar");
}

/** Si la persona puede cambiar el comprobante de una compra (N1/N2): las tres acciones que pide el caso de uso (reemplazar, anular y registrar). */
export async function puedeCambiarElComprobante(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return false;
  return (
    [
      "comprobantes_de_proveedor.reemplazar",
      "comprobantes_de_proveedor.anular",
      "comprobantes_de_proveedor.registrar",
    ] as const
  ).every((accion) => permisos.acciones.includes(accion));
}

/** Lo que hay que deshacer antes de reemplazar una factura (N3/N4). Sin permiso la pantalla no se abre (el genérico). */
export async function cargarLoQueHayQueDeshacerAntesDeReemplazar(
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Respuesta<QueHayQueDeshacerParaLaPantalla>> {
  if (!(await puedeReemplazarUnaFactura(contexto))) return NO_PERMITIDO;
  return loQueHayQueDeshacerAntesDeReemplazar(dependencias, contexto, comprobanteId);
}

/** Lo que hay que deshacer antes de cambiar el comprobante de una compra (N1/N2), con la factura vigente que se está mirando. Sin los tres permisos la pantalla no se abre (el genérico). */
export async function cargarLoQueHayQueDeshacerAntesDeCambiar(
  contexto: ContextoOperativo,
  recepcionId: string,
): Promise<Respuesta<QueHayQueDeshacerParaLaPantalla>> {
  if (!(await puedeCambiarElComprobante(contexto))) return NO_PERMITIDO;
  return loQueHayQueDeshacerAntesDeCambiar(dependencias, contexto, recepcionId);
}

/** «Reemplazar» una factura de la empresa: la clave de idempotencia, la factura, el motivo y la factura nueva viajan en el pedido; el proveedor, la empresa y la persona los decide el servidor. */
export function reemplazarLaFacturaDelFormulario(
  pedido: unknown,
): Promise<Respuesta<ComprobanteReemplazadoParaLaPantalla>> {
  return conLaEmpresa((contexto) => reemplazarLaFactura(dependencias, contexto, pedido));
}

/** «Cambiar el comprobante de la compra»: la clave, la compra, la factura que se miraba, el motivo y la factura nueva viajan en el pedido; el servidor revalida la versión bajo bloqueo. */
export function cambiarElComprobanteDelFormulario(
  pedido: unknown,
): Promise<Respuesta<ComprobanteReemplazadoParaLaPantalla>> {
  return conLaEmpresa((contexto) => cambiarElComprobanteDeLaCompra(dependencias, contexto, pedido));
}
