import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  listarPuntosDeVentaDeLaSucursal,
  reintentarComprobante,
  resincronizarSerie,
  verComprobante,
  type ComprobanteEmitidoParaLaPantalla,
  type DependenciasDeFacturacionWeb,
  type DetalleParaLaPantalla,
} from "../../../src/composicion/facturacion-web";
import { resolverEmpresa } from "../../../src/composicion/sesion-y-empresa";
import type { PaginaDeComprobantes } from "../../../src/modulos/fiscal/publico";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { marcaComercialId } from "../../../src/primitivas/identificadores/marca";
import {
  RUTA_DEL_LISTADO,
  type PuntoDeVentaParaMostrar,
} from "../ui/plantillas/facturacion/filtros-del-listado";
import { pedidoDeLaAccion, type ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { COOKIE_DE_EMPRESA, COOKIE_DE_SUCURSAL, OPCIONES_DE_COOKIE_DE_SUCURSAL } from "./cookies";
import { despacharPorClavesDespuesDeConfirmar } from "./despacho-inmediato";
import { dependenciasDeSesion, sesionDelPedido } from "./sesion";
import {
  elegidaEntre,
  sucursalDelPedido,
  sucursalesParaElegir,
  type SucursalParaElegir,
} from "./sucursal-elegida";

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

/**
 * El listado de la sucursal que la persona eligió (D-34). La elección la guarda y valida el servidor (`sucursal-elegida.ts`); la
 * consulta la verifica de nuevo. Sin elegir y con varias sucursales para elegir responde `FISCAL_SUCURSAL_NO_ELEGIDA`; con una sola
 * abierta, el servidor la toma sola. Nunca lista todas.
 */
export function listarLosComprobantes(entrada?: unknown) {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDelPedido(contexto);
    if (!sucursal.ok) return sucursal;
    return listarComprobantes(dependencias, contexto, sucursal.dato.elegida, entrada);
  });
}

/** Lo que la pantalla del listado necesita de una sola vez: las sucursales, cuál se usa, los puntos de venta y la página. */
export type ListadoCargado = Readonly<{
  sucursales: readonly SucursalParaElegir[];
  /** La sucursal con la que trabaja el listado; `""` si todavía no hay una. */
  efectiva: string;
  /** Todos los de la sucursal (activos, dados de baja y nuevos sin uso: D-58, D-60), de menor a mayor número; `[]` si no se pudieron pedir. */
  puntosDeVenta: readonly PuntoDeVentaParaMostrar[];
  pagina: Respuesta<PaginaDeComprobantes>;
}>;

/**
 * Carga el listado de la pantalla con el contexto que ya resolvió la página (sin volver a resolver la empresa). Pide en orden:
 * las sucursales y la elegida; los puntos de venta de esa sucursal (con la MISMA `elegida` que el listado: la consulta aplica la
 * misma regla y verifica el alcance); y, con los puntos de venta ya conocidos, la página (`armarEntrada` recibe los números para descartar un filtro de punto de venta ajeno a la sucursal).
 * Si la sucursal no se puede resolver, la página trae el error del servidor (`FISCAL_SUCURSAL_NO_ELEGIDA` o fuera de alcance) y la
 * pantalla muestra igual el selector. Si los puntos de venta no se pueden pedir (el mismo error u otro), la lista va vacía: sin
 * selector «Punto de venta», como sin sucursal; la página, que se pide aparte, dice su propio error.
 */
export async function cargarElListado(
  contexto: ContextoOperativo,
  armarEntrada: (puntosDeVenta: readonly number[]) => unknown,
): Promise<ListadoCargado> {
  try {
    const sucursal = await sucursalDelPedido(contexto);
    if (!sucursal.ok) return { sucursales: [], efectiva: "", puntosDeVenta: [], pagina: sucursal };
    const { elegibles, elegida, efectiva } = sucursal.dato;
    const delServidor = await listarPuntosDeVentaDeLaSucursal(dependencias, contexto, elegida);
    const puntosDeVenta: readonly PuntoDeVentaParaMostrar[] = delServidor.ok
      ? delServidor.dato.items
      : [];
    return {
      sucursales: elegibles,
      efectiva,
      puntosDeVenta,
      pagina: await listarComprobantes(
        dependencias,
        contexto,
        elegida,
        armarEntrada(puntosDeVenta.map((p) => p.numero)),
      ),
    };
  } catch (excepcion) {
    return {
      sucursales: [],
      efectiva: "",
      puntosDeVenta: [],
      pagina: aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta),
    };
  }
}

/** Guarda la sucursal elegida, pero solo si es una de las que la persona puede elegir. */
function fijarLaSucursal(datos: FormData): Promise<Respuesta<null>> {
  return conLaEmpresa(async (contexto) => {
    const lista = await sucursalesParaElegir(contexto);
    if (!lista.ok) return lista;
    const valor = datos.get("sucursalId");
    // No eligió (el campo falta o viene en blanco): se lo dice como tal, no como un problema de permisos.
    if (typeof valor !== "string" || valor === "") {
      return { ok: false, error: errorDeCodigo("FISCAL_SUCURSAL_NO_ELEGIDA") } as const;
    }
    const elegida = elegidaEntre(valor, lista.dato);
    if (elegida === null) {
      return { ok: false, error: errorDeCodigo("FISCAL_SUCURSAL_FUERA_DE_ALCANCE") } as const;
    }
    (await cookies()).set(COOKIE_DE_SUCURSAL, elegida, OPCIONES_DE_COOKIE_DE_SUCURSAL);
    return { ok: true, dato: null } as const;
  });
}

/**
 * «Ver comprobantes» de la sucursal elegida (D-34): guarda la elección en la cookie (abiertas o cerradas, D-37) y vuelve al listado
 * sin filtros (los puntos de venta son de la sucursal anterior). Enviar sin elegir ninguna es `FISCAL_SUCURSAL_NO_ELEGIDA`; una sucursal
 * que no es de las que la persona puede elegir, o un valor que no es una sucursal, es `FISCAL_SUCURSAL_FUERA_DE_ALCANCE`. Ninguna escribe nada. Se repite sin duplicar: elegir la misma
 * otra vez deja la misma cookie.
 */
export async function elegirLaSucursal(datos: FormData): Promise<ResultadoDeAccion> {
  const resultado = await fijarLaSucursal(datos);
  if (!resultado.ok) return { error: resultado.error };
  redirect(RUTA_DEL_LISTADO);
}

export function verElComprobante(entrada: unknown): Promise<Respuesta<DetalleParaLaPantalla>> {
  return conLaEmpresa((contexto) => verComprobante(dependencias, contexto, entrada));
}
