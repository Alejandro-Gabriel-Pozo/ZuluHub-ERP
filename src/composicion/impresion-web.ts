import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeComandas, ConsultasDeComandas } from "../modulos/comandas/publico";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import {
  leerElPedidoDeDeclarar,
  leerElPedidoDeEditarImpresora,
  leerElPedidoDeImprimir,
  leerElPedidoDeLosTrabajos,
  leerElPedidoDeRegistrarImpresora,
  leerElPedidoDeUnaImpresora,
  leerElPedidoDelDocumento,
} from "./entradas-de-comandas";
import { accionDelSalon, respuestaGenericaDeSalon, traducirErrorDeSalon } from "./errores-de-salon";

/**
 * La impresión del salón (S-0r; E7 §3.5 y §3.10; la base de S-2 y S-5): las impresoras de la sucursal (lista, alta, edición, desactivar) y los trabajos de impresión (imprimir o reintentar, copia, declarar el
 * resultado, ver el papel). Vive acá, y no en `apps/web`, para probarse con la base real sin levantar Next.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/comandas-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta** (`impresoras.*`, `impresiones.*`): acá no se decide ninguno (el operador mira las impresoras pero no las administra).
 *  - **La sucursal la pone el servidor** (llega ya resuelta por `apps/web/servidor/comandas.ts`, nunca del pedido): vacía cierra con el genérico, nunca se asume «todas». La impresora que se nombra tiene que ser de esa
 *    sucursal (contra su lista); si no, es el genérico, igual que si no existiera.
 *  - **Repetir no duplica.** La impresora, el trabajo y la clave de cada intento los fija la pantalla: guardar dos veces el alta es una sola impresora, pedir dos veces la misma impresión es un solo trabajo, declarar dos
 *    veces lo mismo es lo mismo (y declarar otra cosa para el mismo intento es el genérico).
 *  - **Nada de más sale.** Lista blanca campo por campo: no salen la huella ni la clave de un trabajo, ni quién lo pidió.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeSalon`: el genérico para toda regla del negocio que no tiene texto propio).
 *
 * Límite que se asienta: un documento o un trabajo de impresión se resuelve por su propio id y el caso de uso valida la empresa y el alcance de sucursales de quien pide, no la sucursal elegida en este
 * dispositivo (el documento no dice su sucursal antes de pedirlo). La lista de trabajos de un documento sí se limita a la sucursal de trabajo.
 */

export type DependenciasDeImpresionWeb = Readonly<{
  casosDeUso: () => Pick<
    CasosDeUsoDeComandas,
    | "registrarImpresora"
    | "editarImpresora"
    | "desactivarImpresora"
    | "solicitarImpresion"
    | "solicitarCopia"
    | "declararResultadoDeImpresion"
  >;
  consultas: () => Pick<
    ConsultasDeComandas,
    "impresorasDeLaSucursal" | "trabajosDeImpresion" | "documentoParaImprimir"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

type Dependencias = DependenciasDeImpresionWeb;

export type ImpresoraParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  uso: string;
  papelMm: number;
  activa: boolean;
  version: number;
}>;
export type TrabajoParaLaPantalla = Readonly<{
  id: string;
  impresoraId: string | null;
  documentoTipo: string;
  documentoId: string;
  esCopia: boolean;
  estado: string;
  intentos: number;
}>;
export type PapelParaLaPantalla = Readonly<{
  ancho: number;
  lineas: readonly Readonly<{ texto: string; estilo: string }>[];
}>;

const impresoraParaLaPantalla = (i: ImpresoraParaLaPantalla): ImpresoraParaLaPantalla => ({
  id: i.id,
  nombre: i.nombre,
  uso: i.uso,
  papelMm: i.papelMm,
  activa: i.activa,
  version: i.version,
});

/** Todas las impresoras de la sucursal de trabajo (activas y desactivadas). Es una LECTURA: no escribe ni audita. Sin sucursal, el genérico. */
export async function verLasImpresoras(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<Readonly<{ impresoras: readonly ImpresoraParaLaPantalla[] }>>> {
  if (sucursalId === "") return respuestaGenericaDeSalon();
  try {
    const lista = await d
      .consultas()
      .impresorasDeLaSucursal(contexto, { sucursalId, incluirInactivas: true });
    if (!lista.ok)
      return { ok: false, error: errorAPublico(traducirErrorDeSalon(lista.error), d.respuesta) };
    return { ok: true, dato: { impresoras: lista.valor.map(impresoraParaLaPantalla) } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** ¿La impresora es de la sucursal de trabajo? Si no, `null`: el genérico, igual que si no existiera. */
async function conLaImpresora<S>(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  impresoraId: string,
  hacer: () => Promise<S>,
) {
  const lista = await d
    .consultas()
    .impresorasDeLaSucursal(contexto, { sucursalId, incluirInactivas: true });
  if (!lista.ok) return lista;
  return lista.valor.some((i) => i.id === impresoraId) ? hacer() : null;
}

/** Da de alta una impresora en la sucursal de trabajo. Guardar dos veces el mismo `impresoraId` es una sola impresora. */
export function registrarLaImpresora(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ impresoraId: string; version: number; yaExistia: boolean }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeRegistrarImpresora,
    (pedido) => d.casosDeUso().registrarImpresora(contexto, { ...pedido, sucursalId }),
    (s) => ({ impresoraId: s.impresoraId, version: s.version, yaExistia: s.yaExistia }),
  );
}

/** Cambia nombre, uso o papel de una impresora de la sucursal, con la versión que la persona vio. */
export function editarLaImpresora(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ impresoraId: string; version: number; yaExistia: boolean }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeEditarImpresora,
    (pedido) =>
      conLaImpresora(d, contexto, sucursalId, pedido.impresoraId, () =>
        d.casosDeUso().editarImpresora(contexto, pedido),
      ),
    (s) => ({ impresoraId: s.impresoraId, version: s.version, yaExistia: s.yaExistia }),
  );
}

/** Desactiva una impresora de la sucursal (no se borra); repetirlo es éxito sin escribir. */
export function desactivarLaImpresora(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaDesactivada: boolean }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeUnaImpresora,
    (pedido) =>
      conLaImpresora(d, contexto, sucursalId, pedido.impresoraId, () =>
        d.casosDeUso().desactivarImpresora(contexto, pedido),
      ),
    (s) => ({ yaEstabaDesactivada: s.yaEstabaDesactivada }),
  );
}

const imprimirParaLaPantalla = (s: {
  trabajoId: string;
  estado: string;
  intentos: number;
  impresoraId: string | null;
  sinImpresora: boolean;
  yaExistia: boolean;
  reintento: boolean;
}) => ({
  trabajoId: s.trabajoId,
  estado: s.estado,
  intentos: s.intentos,
  impresoraId: s.impresoraId,
  sinImpresora: s.sinImpresora,
  yaExistia: s.yaExistia,
  reintento: s.reintento,
});

/** «Imprimir» (o «Reintentar» si el trabajo falló): el trabajo original de un documento. Repetir con el mismo `trabajoId` devuelve el mismo trabajo. */
export function pedirLaImpresion(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
) {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeImprimir,
    (pedido) =>
      d.casosDeUso().solicitarImpresion(contexto, { ...pedido, sucursalDeTrabajo: sucursalId }),
    imprimirParaLaPantalla,
  );
}

/** «Reimprimir»: una copia nueva del documento (dice «Copia» y lleva la hora del envío original). No cambia nada de la cuenta ni del stock. */
export function pedirUnaCopia(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
) {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeImprimir,
    (pedido) =>
      d.casosDeUso().solicitarCopia(contexto, { ...pedido, sucursalDeTrabajo: sucursalId }),
    imprimirParaLaPantalla,
  );
}

/** El dispositivo declara si imprimió (`IMPRESA` o `FALLIDA`) un intento: es lo que declaró, no una verificación del papel. Repetir lo mismo es lo mismo. */
export function declararElResultadoDeImpresion(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<
  Respuesta<Readonly<{ trabajoId: string; estado: string; intentos: number; yaExistia: boolean }>>
> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeDeclarar,
    (pedido) =>
      d
        .casosDeUso()
        .declararResultadoDeImpresion(contexto, { ...pedido, sucursalDeTrabajo: sucursalId }),
    (s) => ({
      trabajoId: s.trabajoId,
      estado: s.estado,
      intentos: s.intentos,
      yaExistia: s.yaExistia,
    }),
  );
}

/** Los trabajos de impresión de un documento en la sucursal de trabajo (para «Reintentar» y el estado de cada impresión). */
export function verLosTrabajosDeImpresion(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ trabajos: readonly TrabajoParaLaPantalla[] }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeLosTrabajos,
    async (pedido) => {
      const r = await d.consultas().trabajosDeImpresion(contexto, pedido);
      return r.ok
        ? { ok: true as const, valor: r.valor.filter((t) => t.sucursalId === sucursalId) }
        : r;
    },
    (trabajos) => ({
      trabajos: trabajos.map((t) => ({
        id: t.id,
        impresoraId: t.impresoraId,
        documentoTipo: t.documentoTipo,
        documentoId: t.documentoId,
        esCopia: t.esCopia,
        estado: t.estado,
        intentos: t.intentos,
      })),
    }),
  );
}

/** El papel de un documento (comanda, aviso de anulación o ticket), armado por el servidor desde lo guardado: el navegador solo lo imprime con el diálogo del sistema. Es una LECTURA. */
export function verElPapelDelDocumento(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<PapelParaLaPantalla>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDelDocumento,
    (pedido) =>
      d.consultas().documentoParaImprimir(contexto, {
        sucursalDeTrabajo: sucursalId,
        documentoTipo: pedido.documentoTipo,
        documentoId: pedido.documentoId,
        ...(pedido.copia === undefined ? {} : { copia: pedido.copia }),
        ...(pedido.impresoraId === undefined ? {} : { impresoraId: pedido.impresoraId }),
      }),
    (papel) => ({
      ancho: papel.ancho,
      lineas: papel.lineas.map((l) => ({ texto: l.texto, estilo: l.estilo })),
    }),
  );
}
