import "server-only";
import { cookies } from "next/headers";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion } from "../../../src/composicion/a-respuesta";
import { resolverEmpresa } from "../../../src/composicion/sesion-y-empresa";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { marcaComercialId } from "../../../src/primitivas/identificadores/marca";
import { pedidoDeLaAccion } from "./acciones";
import { COOKIE_DE_EMPRESA } from "./cookies";
import { dependenciasDeSesion, sesionDelPedido } from "./sesion";

/**
 * Corre `hacer` con el contexto operativo de la persona del pedido en su empresa, o devuelve por qué no se puede
 * (otro origen, sin sesión, sin empresa elegida, empresa que no es suya). Es del núcleo del servidor y la usan las acciones de
 * todos los módulos (caja, catálogo, facturación, configuración fiscal, cuenta): una regla, un lugar.
 * Previene: que cada módulo repita esta resolución (el origen, la sesión y la empresa elegida validada) y que una copia quede atrás; antes vivía en
 * `servidor/facturacion.ts` y hacía que caja y catálogo dependieran de facturación solo para llamarla. Chequeo: `test/web/con-la-empresa.test.ts`.
 */
export async function conLaEmpresa<D>(
  hacer: (contexto: ContextoOperativo) => Promise<Respuesta<D>>,
): Promise<Respuesta<D>> {
  // Fuera del `try`: en un host que no es de la aplicación la puerta responde «no existe» (404), no un fallo.
  const pedido = await pedidoDeLaAccion();
  if (!pedido.ok) return pedido;
  try {
    const { sesion, puerta } = await sesionDelPedido();
    if (sesion === null) return { ok: false, error: errorDeCodigo("SESION_VENCIDA") };
    const cookieDeEmpresa = (await cookies()).get(COOKIE_DE_EMPRESA)?.value ?? null;
    const entrada = await resolverEmpresa(dependenciasDeSesion, {
      sesion,
      marcaId: marcaComercialId(puerta.marcaId),
      cookieDeEmpresa,
    });
    if (!entrada.ok) return entrada;
    // Sin empresa elegida (o sin ninguna) no hay dónde actuar: el contexto solo existe con una empresa validada.
    if (entrada.dato.tipo !== "ENTRA") return { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    return await hacer(entrada.dato.contexto);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}
