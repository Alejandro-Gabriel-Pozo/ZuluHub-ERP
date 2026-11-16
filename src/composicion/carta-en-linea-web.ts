import { qrComoSvg } from "../adaptadores/qr/qr-svg";
import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeCatalogo, ConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import {
  leerElPedidoDeCambiarElEstadoDeLaCarta,
  leerElPedidoDeGuardarLaCarta,
} from "./entradas-de-carta-en-linea";

/**
 * La pantalla «Carta en línea» (C1; maqueta aprobada `carta-en-linea.html`, filas 60 y 70 de `decisiones-del-dueno-2026-11.md`): ver la carta de UNA sucursal (sus textos, su estado,
 * su dirección pública, el QR y cuántos productos salen), guardar sus textos, ponerla en línea y sacarla. Vive acá, y no en `apps/web`, para probarse con la base real sin
 * levantar Next (igual que `secciones-web.ts`). El servidor que decide ya existía: `guardarCartaPublica` y `verCartaPublica`; acá no hay ninguna regla de negocio nueva.
 *
 * Reglas que cumple (cada una con su prueba en `carta-en-linea-web.test.ts` y `test/integracion/carta-en-linea-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `vidrieras.ver`; guardar, `vidrieras.editar` (y `crear` al crearla); poner en línea, `vidrieras.publicar_en_linea`; sacarla,
 *    `vidrieras.retirar_de_linea`; todo dentro de la transacción. Con el módulo `vidriera` en desarrollo (hoy) sale `MODULO_EN_DESARROLLO` y ningún dato. Acá no se decide ningún permiso.
 *  - **La empresa, la persona y la sucursal las pone el servidor.** El pedido no trae la empresa ni la persona; la sucursal que trae solo se compara con la que el servidor fijó. Una carta
 *    de otra empresa es indistinguible de una que no existe: el genérico.
 *  - **Repetir no duplica.** Guardar lleva la clave de la carta (la fija la página): la misma otra vez devuelve la carta ya creada. Poner y sacar piden un ESTADO, no alternan: dos «Poner en
 *    línea» a la vez dejan UNA carta en línea y UNA auditoría; el segundo recibe «ya estaba».
 *  - **Dos cambios a la vez no se pisan.** Guardar y cambiar el estado llevan la versión que la persona vio; con una vieja el caso de uso rechaza sin escribir (el genérico) y la página recarga.
 *  - **Los textos que la pantalla no edita no se pierden.** El mensaje de portada (sin campo en esta pantalla: pregunta pendiente) y el estado se toman de lo vigente al guardar.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia; un nombre inválido sale con el genérico.
 */

export type DependenciasDeCartaEnLineaWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeCatalogo, "guardarCartaPublica">;
  consultas: () => Pick<ConsultasDeCatalogo, "verCartaPublica">;
  respuesta: DependenciasDeRespuesta;
}>;

/** La carta como la ve quien la administra (sin el mensaje de portada: esta pantalla no lo edita). */
export type CartaDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  rubro: string | null;
  lugar: string | null;
  estado: "EN_LINEA" | "FUERA_DE_LINEA";
  version: number;
}>;

export type CartaEnLineaParaLaPantalla = Readonly<{
  /** `null` si la sucursal todavía no tiene carta. */
  carta: CartaDeLaPantalla | null;
  /** La dirección pública para copiar; `null` mientras no hay carta. */
  direccion: string | null;
  /** El QR de la dirección como SVG (texto); `null` si no hay carta o la marca todavía no tiene host. */
  qrSvg: string | null;
  /** Cuántos productos salen hoy en la carta de la sucursal y cuántos se quedan afuera, por motivo (lo que entrega `verCartaPublica`). */
  salen: number;
  faltan: Readonly<{
    sinPrecio: number;
    sinSeccion: number;
    desactivados: number;
    ocultos: number;
  }>;
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

/**
 * El error de la carta tal como lo entiende `aRespuesta`. `traducirErrorDeCatalogo` deja pasar sin cambios un objeto con `codigo`, y el error de la perilla del QR
 * (`{ codigo: "FUNCION_NO_INCLUIDA" }`, extra de pago apagado) tiene esa forma: saldría como un fallo inesperado con referencia. Acá sale como el genérico. Previene: que quien no tiene
 * el extra vea «algo falló» en vez de «no permitido». (Hallazgo: la misma salida le pasa a `venta_por_fracciones_y_peso` en las otras pantallas; no se toca acá.)
 */
function traducirErrorDeLaCarta(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    ["FUNCION_NO_INCLUIDA", "LIMITE_DEL_PLAN"].includes(
      String((error as { codigo?: unknown }).codigo),
    )
  )
    return { codigo: "CATALOGO_ACCION_NO_PERMITIDA" };
  return traducirErrorDeCatalogo(error);
}

const conError = (error: unknown, d: DependenciasDeCartaEnLineaWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeLaCarta(error), d.respuesta),
});

/**
 * La dirección pública de la carta: el host de la marca y el camino de la carta (`/<código>` en el host compartido, el mismo de `rutaPublicaDe` de la vidriera).
 * SUPUESTO (DEC-0463): el host de la carta es el de la aplicación de la marca; sin host, solo el camino (y sin QR). UN solo lugar: si el host público es otro, se cambia acá.
 */
export function direccionPublicaDeLaCarta(hostDeApp: string | null, codigo: string): string {
  const camino = `/${encodeURIComponent(codigo)}`;
  return hostDeApp === null ? camino : `https://${hostDeApp}${camino}`;
}

/** La carta de la sucursal con su dirección, su QR y cuántos productos salen. Es una LECTURA: no escribe ni audita. */
export async function verLaCartaEnLinea(
  d: DependenciasDeCartaEnLineaWeb,
  contexto: ContextoOperativo,
  entrada: Readonly<{ sucursalId: string; hostDeApp: string | null }>,
): Promise<Respuesta<CartaEnLineaParaLaPantalla>> {
  try {
    const vista = await d.consultas().verCartaPublica(contexto, { sucursalId: entrada.sucursalId });
    if (!vista.ok) return conError(vista.error, d);
    const { carta, visibilidad } = vista.valor;
    const direccion =
      carta === null ? null : direccionPublicaDeLaCarta(entrada.hostDeApp, carta.codigo);
    return {
      ok: true,
      dato: {
        carta:
          carta === null
            ? null
            : {
                id: carta.id,
                nombre: carta.nombre,
                rubro: carta.rubro,
                lugar: carta.lugar,
                estado: carta.estado,
                version: carta.version,
              },
        direccion,
        // El QR de la dirección completa; nivel «H» (el de la maqueta: deja sumar el logo después sin cambiar la dirección). Sin host, no hay dirección completa que codificar.
        qrSvg: direccion === null || entrada.hostDeApp === null ? null : qrComoSvg(direccion, "H"),
        salen: visibilidad.salen,
        faltan: {
          sinPrecio: visibilidad.faltan.sinPrecio,
          sinSeccion: visibilidad.faltan.sinSeccion,
          desactivados: visibilidad.faltan.desactivados,
          ocultos: visibilidad.faltan.ocultos,
        },
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

type Guardada = Readonly<{
  cartaId: string;
  estado: "EN_LINEA" | "FUERA_DE_LINEA";
  version: number;
  yaExistia: boolean;
}>;

/**
 * Guarda los textos de la carta de la sucursal (la crea FUERA DE LÍNEA si no existe). El estado y el mensaje de portada se toman de lo vigente: guardar los textos no pone ni saca
 * la carta de línea ni borra el mensaje. El nombre vacío tiene su texto aprobado («Falta el nombre»); cualquier otro dato inválido es el genérico.
 */
export async function guardarLaCartaEnLinea(
  d: DependenciasDeCartaEnLineaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
  sucursalDelServidor: string,
): Promise<Respuesta<Guardada>> {
  const pedido = leerElPedidoDeGuardarLaCarta(crudo);
  if (!pedido.ok || pedido.valor.sucursalId !== sucursalDelServidor)
    return { ok: false, error: GENERICO };
  const p = pedido.valor;
  if (p.nombre.trim() === "")
    return {
      ok: false,
      error: errorAPublico({ codigo: "CATALOGO_FALTA_EL_NOMBRE", campo: "nombre" }, d.respuesta),
    };
  try {
    const vista = await d.consultas().verCartaPublica(contexto, { sucursalId: p.sucursalId });
    if (!vista.ok) return conError(vista.error, d);
    const vigente = vista.valor.carta;
    const entrada = {
      id: p.cartaId,
      sucursalId: p.sucursalId,
      nombre: p.nombre,
      rubro: p.rubro,
      lugar: p.lugar,
      mensajeDePortada: vigente?.mensajeDePortada ?? null,
      estado: vigente?.estado ?? ("FUERA_DE_LINEA" as const),
      ...(p.versionEsperada === null ? {} : { versionEsperada: p.versionEsperada }),
    };
    const guardada = await d.casosDeUso().guardarCartaPublica(contexto, entrada);
    return aRespuesta(
      guardada.ok ? guardada : err(traducirErrorDeLaCarta(guardada.error)),
      d.respuesta,
      (salida) => ({
        cartaId: salida.cartaId,
        estado: salida.estado,
        version: salida.version,
        yaExistia: salida.yaExistia,
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Pone la carta EN LÍNEA o la saca (`FUERA_DE_LINEA`), con la versión que la persona vio. Pide un estado, no alterna: repetirlo es éxito sin escribir. Los datos son los vigentes (solo cambia
 * el estado). Una carta que no es de la sucursal, o que no existe, es el genérico. Poner exige, dentro de la transacción del caso de uso: sucursal abierta, la perilla `vidriera_por_qr` y al menos un
 * producto que salga; sacar no exige nada de eso.
 */
export async function cambiarElEstadoDeLaCartaEnLinea(
  d: DependenciasDeCartaEnLineaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
  sucursalDelServidor: string,
): Promise<Respuesta<Guardada>> {
  const pedido = leerElPedidoDeCambiarElEstadoDeLaCarta(crudo);
  if (!pedido.ok || pedido.valor.sucursalId !== sucursalDelServidor)
    return { ok: false, error: GENERICO };
  const p = pedido.valor;
  try {
    const vista = await d.consultas().verCartaPublica(contexto, { sucursalId: p.sucursalId });
    if (!vista.ok) return conError(vista.error, d);
    const vigente = vista.valor.carta;
    if (vigente === null || vigente.id !== p.cartaId) return { ok: false, error: GENERICO };
    const cambiada = await d.casosDeUso().guardarCartaPublica(contexto, {
      id: vigente.id,
      sucursalId: p.sucursalId,
      nombre: vigente.nombre,
      rubro: vigente.rubro,
      lugar: vigente.lugar,
      mensajeDePortada: vigente.mensajeDePortada,
      estado: p.estado,
      versionEsperada: p.versionEsperada,
    });
    return aRespuesta(
      cambiada.ok ? cambiada : err(traducirErrorDeLaCarta(cambiada.error)),
      d.respuesta,
      (salida) => ({
        cartaId: salida.cartaId,
        estado: salida.estado,
        version: salida.version,
        yaExistia: salida.yaExistia,
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
