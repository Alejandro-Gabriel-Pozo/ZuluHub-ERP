import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion } from "../../../src/composicion/a-respuesta";
import {
  activarPuntoDeVenta,
  crearPuntoDeVenta,
  desactivarPuntoDeVenta,
  editarPuntoDeVenta,
  estadoDeLaConfiguracionFiscal,
  puntosDeVentaDelEmisor,
  type DependenciasDeConfiguracionFiscalWeb,
  type EstadoDeLaConfiguracionParaLaPantalla,
  type PuntosDeVentaParaConfigurar,
} from "../../../src/composicion/configuracion-fiscal-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./facturacion";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las acciones de servidor de Configuración fiscal (D-43), parte de Puntos de venta: crear, editar, activar y desactivar un punto de
 * venta, y las lecturas que arman sus pantallas. Finas a propósito (ADR-015, punto 2): resuelven DÓNDE y QUIÉN actúa con
 * `conLaEmpresa` (la misma resolución que el facturador) y llaman a `src/composicion/configuracion-fiscal-web.ts`, donde se prueba
 * todo lo demás. Ninguna decide permisos (cada caso de uso y cada consulta exige el suyo, solo el gerente, dentro de su transacción)
 * ni toca la base. El pedido del navegador trae el contenido del punto de venta y el emisor, que el servidor valida contra la empresa;
 * la empresa y la persona salen de la sesión. El cambio de ambiente es `cambiarElAmbiente` de `servidor/facturacion.ts`.
 */

const dependencias: DependenciasDeConfiguracionFiscalWeb = {
  casosDeUso: web.casosDeUsoDeConfiguracionFiscal,
  consultas: web.consultasDeFacturacion,
  respuesta: dependenciasDeSesion.respuesta,
};

export function crearElPuntoDeVenta(entrada: unknown) {
  return conLaEmpresa((contexto) => crearPuntoDeVenta(dependencias, contexto, entrada));
}

export function editarElPuntoDeVenta(entrada: unknown) {
  return conLaEmpresa((contexto) => editarPuntoDeVenta(dependencias, contexto, entrada));
}

export function activarElPuntoDeVenta(entrada: unknown) {
  return conLaEmpresa((contexto) => activarPuntoDeVenta(dependencias, contexto, entrada));
}

export function desactivarElPuntoDeVenta(entrada: unknown) {
  return conLaEmpresa((contexto) => desactivarPuntoDeVenta(dependencias, contexto, entrada));
}

/** La lista de lo que falta, con el contexto que ya resolvió la página. Solo el gerente. */
export async function cargarElEstadoDeLaConfiguracion(
  contexto: ContextoOperativo,
): Promise<Respuesta<EstadoDeLaConfiguracionParaLaPantalla>> {
  try {
    return await estadoDeLaConfiguracionFiscal(dependencias, contexto);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}

/**
 * Los puntos de venta del emisor principal (D-47), activos o no. El emisor sale del estado de la configuración, no del navegador;
 * si ese estado falla (sin permiso, por ejemplo), responde ese error.
 */
export async function cargarLosPuntosDeVenta(
  contexto: ContextoOperativo,
): Promise<Respuesta<PuntosDeVentaParaConfigurar>> {
  try {
    const estado = await estadoDeLaConfiguracionFiscal(dependencias, contexto);
    if (!estado.ok) return estado;
    return await puntosDeVentaDelEmisor(dependencias, contexto, { emisorId: estado.dato.emisorId });
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}
