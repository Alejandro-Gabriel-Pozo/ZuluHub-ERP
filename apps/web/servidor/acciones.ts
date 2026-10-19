import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { origenEsPropio } from "../../../src/capacidades/experiencia/origen";
import { rutaDeRetorno } from "../../../src/capacidades/experiencia/ruta-de-retorno";
import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../../../src/capacidades/experiencia/respuesta";
import { hostDelPedido, type PuertaResuelta } from "../../../src/capacidades/experiencia/puerta";
import { aRespuestaDeExcepcion } from "../../../src/composicion/a-respuesta";
import {
  aceptarInvitacionDeLaSesion,
  cerrarSesion,
  elegirEmpresa,
  iniciarIngresoConGoogle,
} from "../../../src/composicion/sesion-y-empresa";
import { marcaComercialId } from "../../../src/primitivas/identificadores/marca";
import {
  COOKIE_DE_EMPRESA,
  COOKIE_DE_INVITACION,
  OPCIONES_DE_COOKIE_DE_EMPRESA,
  OPCIONES_DE_COOKIE_DE_INVITACION,
  aplicarCookies,
} from "./cookies";
import { exigirPuerta } from "./pedido";
import { dependenciasDeSesion, sesionDelPedido } from "./sesion";

/**
 * Lo que hacen las acciones del servidor de sesión y empresa (ADR-015, punto 2): finas, solo componen un
 * caso de uso por la composición y devuelven una respuesta ya traducida (ADR-016). Nunca deciden reglas,
 * autorización ni tocan la base. Los archivos `"use server"` de `app/` solo las exponen a Next (la directiva
 * tiene que ir primera en su archivo y acá la primera línea es `server-only`).
 *
 * Cada una:
 *  - vuelve a resolver la puerta (solo corre en un host de aplicación);
 *  - rechaza un pedido de OTRO origen (P-7): Next lo hace por su cuenta, y se repite a propósito;
 *  - declara cómo se repite sin duplicar (ADR-015, punto 4): «ingresar» y «cerrar sesión» no cambian datos
 *    de negocio; «entrar a la empresa» fija una cookie (repetirla es igual); «aceptar» lo resuelve el estado
 *    de la invitación (la segunda vez devuelve `yaEstabaAceptada`, nunca duplica).
 */

/** Lo que devuelven las acciones de formulario: nada si salió bien (redirigen), o el error ya traducido. */
export type ResultadoDeAccion = Readonly<{ error: ErrorPublico | null }>;

const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

type PedidoDeAccion = Readonly<{ puerta: PuertaResuelta; encabezados: Headers }>;

/** Puerta de la aplicación y origen propio. Un pedido de otro origen es «sin permiso». */
async function pedidoDeLaAccion(): Promise<Respuesta<PedidoDeAccion>> {
  const puerta = await exigirPuerta("APP");
  const encabezados = await headers();
  if (!origenEsPropio(encabezados.get("origin"), hostDelPedido(encabezados))) {
    return { ok: false, error: errorDeCodigo("SIN_PERMISO") };
  }
  return { ok: true, dato: { puerta, encabezados } };
}

const LARGO_MAXIMO_DEL_TOKEN = 512;

async function empezarIngreso(datos: FormData): Promise<Respuesta<Readonly<{ destino: string }>>> {
  // Fuera del `try`: en un host que no es de la aplicación la puerta responde «no existe» (404), no un fallo.
  const pedido = await pedidoDeLaAccion();
  if (!pedido.ok) return pedido;
  try {
    const { puerta, encabezados } = pedido.dato;
    const invitacion = textoDe(datos, "invitacion");
    const conInvitacion = invitacion !== "" && invitacion.length <= LARGO_MAXIMO_DEL_TOKEN;
    const volver = conInvitacion ? "/invitacion" : rutaDeRetorno(textoDe(datos, "volver"));
    const inicio = await iniciarIngresoConGoogle(dependenciasDeSesion, {
      host: puerta.host,
      encabezados,
      volver,
    });
    if (!inicio.ok) return inicio;
    const almacen = await cookies();
    aplicarCookies(almacen, inicio.dato.cookies);
    if (conInvitacion) {
      almacen.set(COOKIE_DE_INVITACION, invitacion, OPCIONES_DE_COOKIE_DE_INVITACION);
    }
    return { ok: true, dato: { destino: inicio.dato.url } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}

/** «Ingresar con Google»: fija las cookies del estado del ingreso y manda a Google. */
export async function ingresarConGoogle(datos: FormData): Promise<ResultadoDeAccion> {
  const resultado = await empezarIngreso(datos);
  if (!resultado.ok) return { error: resultado.error };
  redirect(resultado.dato.destino);
}

async function fijarEmpresa(datos: FormData): Promise<Respuesta<null>> {
  const pedido = await pedidoDeLaAccion();
  if (!pedido.ok) return pedido;
  try {
    const { sesion, puerta } = await sesionDelPedido();
    if (sesion === null) return { ok: false, error: errorDeCodigo("SESION_VENCIDA") };
    const elegida = await elegirEmpresa(dependenciasDeSesion, {
      sesion,
      marcaId: marcaComercialId(puerta.marcaId),
      empresaId: textoDe(datos, "empresaId"),
    });
    if (!elegida.ok) return elegida;
    (await cookies()).set(COOKIE_DE_EMPRESA, elegida.dato.empresaId, OPCIONES_DE_COOKIE_DE_EMPRESA);
    return { ok: true, dato: null };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}

/**
 * «Entrar a la empresa»: valida contra las empresas de la persona EN ESTA MARCA y fija `zh_empresa`.
 * Un `empresaId` que no es de la persona en esta marca es `SIN_PERMISO`.
 */
export async function entrarALaEmpresa(datos: FormData): Promise<ResultadoDeAccion> {
  const resultado = await fijarEmpresa(datos);
  if (!resultado.ok) return { error: resultado.error };
  redirect("/");
}

async function terminarSesion(): Promise<Respuesta<null>> {
  const pedido = await pedidoDeLaAccion();
  if (!pedido.ok) return pedido;
  try {
    const { puerta, encabezados } = pedido.dato;
    const cierre = await cerrarSesion(dependenciasDeSesion, { host: puerta.host, encabezados });
    if (!cierre.ok) return cierre;
    const almacen = await cookies();
    aplicarCookies(almacen, cierre.dato.cookies);
    // La próxima persona que use este celular no hereda la empresa ni la invitación de esta.
    almacen.delete(COOKIE_DE_EMPRESA);
    almacen.delete(COOKIE_DE_INVITACION);
    return { ok: true, dato: null };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}

/** Cerrar sesión: borra la fila de la sesión (revocación inmediata), las cookies, y vuelve a `/ingreso`. */
export async function cerrarLaSesion(): Promise<ResultadoDeAccion> {
  const resultado = await terminarSesion();
  if (!resultado.ok) return { error: resultado.error };
  redirect("/ingreso");
}

export type EntradaDeAceptar = Readonly<{
  token: string;
  /** La clave del intento (`useEnvioConClave`): se reusa en cada reintento. La regla natural de repetición no la necesita; llega para que la pantalla sea uniforme. */
  clave: string;
}>;

/**
 * Aceptar la invitación con la cuenta que ingresó. Idempotente por la regla natural del estado de la
 * invitación (ADR-015, punto 4): repetirla con la misma clave, o con otra, devuelve el mismo resultado
 * exitoso y deja una sola membresía. Devuelve la respuesta (no redirige): la pantalla muestra el resultado.
 */
export async function aceptarLaInvitacion(
  entrada: EntradaDeAceptar,
): Promise<Respuesta<Readonly<{ yaEstabaAceptada: boolean }>>> {
  const pedido = await pedidoDeLaAccion();
  if (!pedido.ok) return pedido;
  try {
    const { sesion, puerta } = await sesionDelPedido();
    if (sesion === null) return { ok: false, error: errorDeCodigo("SESION_VENCIDA") };
    const resultado = await aceptarInvitacionDeLaSesion(dependenciasDeSesion, {
      token: typeof entrada.token === "string" ? entrada.token : "",
      sesion,
      marcaId: marcaComercialId(puerta.marcaId),
    });
    if (!resultado.ok) return resultado;
    (await cookies()).delete(COOKIE_DE_INVITACION);
    // A la pantalla solo le llega lo que muestra: ni la persona ni las empresas de la invitación.
    return { ok: true, dato: { yaEstabaAceptada: resultado.dato.yaEstabaAceptada } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, dependenciasDeSesion.respuesta);
  }
}
