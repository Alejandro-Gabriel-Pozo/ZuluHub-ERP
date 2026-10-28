import "server-only";
import { cookies } from "next/headers";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion } from "../../../src/composicion/a-respuesta";
import {
  cambiarAmbienteDePuntoDeVenta,
  clavesDeLaValidacionInicial,
  descartarComprobante,
  emitirFactura,
  emitirNotaDeCredito,
  emitirNotaDeDebito,
  listarComprobantes,
  reintentarComprobante,
  resincronizarSerie,
  verComprobante,
  type ComprobanteEmitidoParaLaPantalla,
  type DependenciasDeFacturacionWeb,
  type DetalleParaLaPantalla,
} from "../../../src/composicion/facturacion-web";
import { resolverEmpresa } from "../../../src/composicion/sesion-y-empresa";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { marcaComercialId } from "../../../src/primitivas/identificadores/marca";
import { pedidoDeLaAccion } from "./acciones";
import { web } from "./composicion";
import { COOKIE_DE_EMPRESA } from "./cookies";
import { despacharPorClavesDespuesDeConfirmar } from "./despacho-inmediato";
import { dependenciasDeSesion, sesionDelPedido } from "./sesion";

/**
 * Las acciones de servidor del facturador (H7 facturación): emitir una factura, una nota de crédito o de débito,
 * descartar, reintentar, resincronizar una serie, cambiar el ambiente de un punto de venta, y listar y ver
 * comprobantes. Finas a propósito (ADR-015, punto 2): solo resuelven DÓNDE y QUIÉN actúa y llaman a
 * `src/composicion/facturacion-web.ts`, donde se prueba todo lo demás. Ninguna decide reglas ni permisos (cada caso
 * de uso exige el suyo al guard dentro de su transacción) ni toca la base.
 *
 * Cada una:
 *  - vuelve a resolver la puerta (solo corre en un host de aplicación) y rechaza un pedido de OTRO origen (P-7), sin
 *    ejecutar nada: es `SIN_PERMISO`;
 *  - toma la persona, la empresa y la marca de la SESIÓN, el host y la cookie `pd_empresa` validada contra las
 *    empresas de la persona en esta marca; el pedido del navegador no puede traer otras (ni `empresaId`, ni
 *    `emisorId`, ni un ambiente de emisión: lo único que manda es el contenido del comprobante);
 *  - sin sesión: `SESION_VENCIDA`; sin una empresa elegida: `SIN_PERMISO`;
 *  - se repite sin duplicar: emitir con la misma clave da el mismo comprobante (`yaExistia`).
 *
 * Quien emite pide además el intento inmediato (ADR-007): después de confirmar, la misma solicitud intenta llevar el
 * comprobante a ARCA con `after()`, sin hacer esperar a la persona; si no llega, el cron lo levanta. Reintentar y
 * resincronizar no lo piden (no conocen el trabajo que encolan): los toma el cron.
 *
 * Los archivos `"use server"` de `app/` solo exponen estas funciones a Next (ver `app/s/app/acciones-de-facturacion.ts`).
 */

const dependencias: DependenciasDeFacturacionWeb = {
  casosDeUso: web.casosDeUsoDeFacturacion,
  consultas: web.consultasDeFacturacion,
  respuesta: dependenciasDeSesion.respuesta,
};

/**
 * Corre `hacer` con el contexto operativo de la persona del pedido en su empresa, o devuelve por qué no se puede
 * (otro origen, sin sesión, sin empresa elegida, empresa que no es suya).
 */
async function conLaEmpresa<D>(
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

/** Pide el intento inmediato de un comprobante recién emitido, sin esperar ni cambiar lo que ve la persona. */
function conIntentoInmediato(
  contexto: ContextoOperativo,
  respuesta: Respuesta<ComprobanteEmitidoParaLaPantalla>,
): Respuesta<ComprobanteEmitidoParaLaPantalla> {
  if (respuesta.ok) {
    despacharPorClavesDespuesDeConfirmar(
      contexto.empresaId,
      clavesDeLaValidacionInicial(respuesta.dato.comprobanteId),
    );
  }
  return respuesta;
}

export function emitirLaFactura(entrada: unknown) {
  return conLaEmpresa(async (contexto) =>
    conIntentoInmediato(contexto, await emitirFactura(dependencias, contexto, entrada)),
  );
}

export function emitirLaNotaDeCredito(entrada: unknown) {
  return conLaEmpresa(async (contexto) =>
    conIntentoInmediato(contexto, await emitirNotaDeCredito(dependencias, contexto, entrada)),
  );
}

export function emitirLaNotaDeDebito(entrada: unknown) {
  return conLaEmpresa(async (contexto) =>
    conIntentoInmediato(contexto, await emitirNotaDeDebito(dependencias, contexto, entrada)),
  );
}

export function descartarElComprobante(entrada: unknown) {
  return conLaEmpresa((contexto) => descartarComprobante(dependencias, contexto, entrada));
}

export function reintentarElComprobante(entrada: unknown) {
  return conLaEmpresa((contexto) => reintentarComprobante(dependencias, contexto, entrada));
}

export function resincronizarLaSerie(entrada: unknown) {
  return conLaEmpresa((contexto) => resincronizarSerie(dependencias, contexto, entrada));
}

export function cambiarElAmbiente(entrada: unknown) {
  return conLaEmpresa((contexto) => cambiarAmbienteDePuntoDeVenta(dependencias, contexto, entrada));
}

export function listarLosComprobantes(entrada?: unknown) {
  return conLaEmpresa((contexto) => listarComprobantes(dependencias, contexto, entrada));
}

export function verElComprobante(entrada: unknown): Promise<Respuesta<DetalleParaLaPantalla>> {
  return conLaEmpresa((contexto) => verComprobante(dependencias, contexto, entrada));
}
