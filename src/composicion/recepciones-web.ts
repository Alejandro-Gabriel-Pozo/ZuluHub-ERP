import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CausaDeCorreccion, EstadoDeRecepcionSeparada } from "../modulos/compras/publico";

/** Las causas de una corrección de lo recibido, para que la página (servidor) se las pase a la pantalla: un componente de cliente no importa el módulo de compras. */
export { CAUSAS_DE_CORRECCION } from "../modulos/compras/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAnularRecepcion,
  entradaDeConfirmarRecepcion,
  entradaDeCorregirLoRecibido,
  entradaDeFichaDeRecepcion,
  entradaDeListarRecepciones,
  entradaDeRegistrarRecepcion,
} from "./entradas-de-recepciones";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * Las pantallas de «Recepciones» (Compras 4, recepción separada): la lista, la ficha, «Recibir», «Confirmar recepción» y «Anular recepción». Cada una es una LECTURA (la lista y la ficha: no escriben ni auditan)
 * o un caso de uso del módulo, que ya trae su permiso, su alcance de sucursal, su idempotencia y su transacción (`registrarRecepcion`, `confirmarRecepcion`, `anularRecepcionPendiente`). Acá solo se arma el pedido:
 *  - **La empresa y la persona salen del contexto; la sucursal de «Recibir» y de la lista la pone el servidor** (la elegida en este dispositivo y validada contra el alcance de la persona), nunca la del navegador.
 *  - **La ficha de una recepción de otra sucursal es indistinguible de una que no existe** (como la ficha de una compra): se trabaja con una sucursal por vez.
 *  - Todo sale campo por campo (lista de permitidos). Los ids de persona NO salen. Sin precios ni costos: la recepción separada no los pide.
 *  - Los errores de negocio salen como el genérico (`errores-de-compras.ts`).
 * Previene: una recepción repetida por doble toque o reintento, una recepción en la sucursal o empresa que diga el navegador y una ficha ajena. Chequeo: `test/integracion/compras-recepciones-web.test.ts`.
 */

export type DependenciasDeRecepcionesWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeCompras"]>,
    "listarRecepcionesSeparadas" | "fichaDeRecepcionSeparada"
  >;
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCompras"]>,
    "registrarRecepcion" | "confirmarRecepcion" | "anularRecepcionPendiente" | "corregirLoRecibido"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

type RemitoParaLaPantalla = Readonly<{ puntoDeVenta: number; numero: number; fecha: string }>;

export type ListaDeRecepcionesParaLaPantalla = Readonly<{
  recepciones: readonly Readonly<{
    recepcionId: string;
    numero: number;
    /** El nombre del proveedor; `null` si no se puede mostrar (parte anonimizada). */
    proveedor: string | null;
    fechaNegocio: string;
    remito: RemitoParaLaPantalla | null;
    estado: EstadoDeRecepcionSeparada;
  }>[];
  /** El cursor de la página que sigue; `null` en la última. */
  siguiente: string | null;
}>;

/** Las recepciones de la sucursal que fija el servidor, de la más nueva a la más vieja. Sin filtros en la primera versión (decisión del dueño, 25/11/2026, pregunta 8). */
export function listarLasRecepciones(
  d: DependenciasDeRecepcionesWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<ListaDeRecepcionesParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeListarRecepciones,
    (entrada) =>
      d.consultas().listarRecepcionesSeparadas(contexto, {
        sucursalId,
        ...(entrada.despuesDe === null ? {} : { despuesDe: entrada.despuesDe }),
      }),
    (pagina) => ({
      recepciones: pagina.filas.map((f) => ({
        recepcionId: f.recepcionId,
        numero: f.numero,
        proveedor: f.proveedorNombre,
        fechaNegocio: f.fechaNegocio,
        remito:
          f.remito === null
            ? null
            : {
                puntoDeVenta: f.remito.puntoDeVenta,
                numero: f.remito.numero,
                fecha: f.remito.fecha,
              },
        estado: f.estado,
      })),
      siguiente: pagina.siguiente,
    }),
  );
}

export type FichaDeRecepcionParaLaPantalla = Readonly<{
  recepcionId: string;
  numero: number;
  proveedor: string | null;
  fechaNegocio: string;
  remito: RemitoParaLaPantalla | null;
  estado: EstadoDeRecepcionSeparada;
  /** Solo si está anulada: el motivo que se escribió. */
  motivoDeAnulacion: string | null;
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    cantidadDeCompra: string;
    unidadDeCompraId: string;
    /** Lo que entra al stock, en la unidad base del producto. */
    cantidadEnStock: string;
    unidadDeStockId: string | null;
    /** Lo recibido que rige hoy (ya con las correcciones), en la unidad base del producto. */
    cantidadRecibida: string;
    /** Cuántas correcciones de lo recibido tiene la línea: la versión que se devuelve al corregir. */
    correccionesVistas: number;
    correcciones: readonly Readonly<{
      numero: number;
      cantidadAnterior: string;
      cantidadNueva: string;
      causa: CausaDeCorreccion;
      nota: string | null;
    }>[];
  }>[];
}>;

/** La ficha de una recepción de la sucursal de quien pide; una de otra sucursal u otra empresa es indistinguible de una que no existe. */
export function fichaDeLaRecepcion(
  d: DependenciasDeRecepcionesWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  recepcionId: string,
): Promise<Respuesta<FichaDeRecepcionParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { recepcionId },
    entradaDeFichaDeRecepcion,
    async (entrada) => {
      const ficha = await d.consultas().fichaDeRecepcionSeparada(contexto, entrada);
      if (!ficha.ok) return ficha;
      if (ficha.valor === null || ficha.valor.sucursalId !== sucursalId) {
        return err("RECEPCION_NO_ENCONTRADA");
      }
      return ok(ficha.valor);
    },
    (f) => ({
      recepcionId: f.recepcionId,
      numero: f.numero,
      proveedor: f.proveedorNombre,
      fechaNegocio: f.fechaNegocio,
      remito:
        f.remito === null
          ? null
          : { puntoDeVenta: f.remito.puntoDeVenta, numero: f.remito.numero, fecha: f.remito.fecha },
      estado: f.estado,
      motivoDeAnulacion: f.motivoDeAnulacion,
      lineas: f.lineas.map((l) => ({
        numero: l.numero,
        producto: l.productoNombre,
        cantidadDeCompra: l.cantidadDeCompra,
        unidadDeCompraId: l.unidadDeCompraId,
        cantidadEnStock: l.cantidadEnStock,
        unidadDeStockId: l.unidadDeStockId,
        cantidadRecibida: l.cantidadRecibida,
        correccionesVistas: l.correccionesVistas,
        correcciones: l.correcciones.map((c) => ({
          numero: c.numero,
          cantidadAnterior: c.cantidadAnterior,
          cantidadNueva: c.cantidadNueva,
          causa: c.causa,
          nota: c.nota,
        })),
      })),
    }),
  );
}

export type RecepcionRegistradaParaLaPantalla = Readonly<{
  recepcionId: string;
  /** `true`: era la misma recepción de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/**
 * «Recibir»: registra la recepción PENDIENTE (todavía no hay stock: entra al confirmarla) con `registrarRecepcion`, una transacción que ya trae la idempotencia (la misma clave con el mismo contenido devuelve la
 * recepción hecha; el mismo remito del mismo proveedor con otra clave se rechaza). **Sin precio**: lo que se recibe queda «sin costo» hasta tomar el costo de la factura. El permiso (`recepciones.registrar`), el alcance de la
 * sucursal, la perilla del plan y toda cuenta los decide el caso de uso adentro.
 */
export function registrarLaRecepcion(
  d: DependenciasDeRecepcionesWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<RecepcionRegistradaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeRegistrarRecepcion,
    (entrada) =>
      d.casosDeUso().registrarRecepcion(contexto, {
        clave: entrada.clave,
        sucursalId,
        proveedorId: entrada.proveedorId,
        remito: entrada.remito,
        renglones: entrada.renglones,
      }),
    (salida) => ({ recepcionId: salida.recepcionId, yaExistia: salida.yaExistia }),
  );
}

export type RecepcionConfirmadaParaLaPantalla = Readonly<{
  recepcionId: string;
  /** `true`: ya estaba confirmada: no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/** «Confirmar recepción»: el momento en que la mercadería pasa a ser stock. Solo gerente o administrador (`recepciones.confirmar`, lo decide el caso de uso). Confirmar dos veces deja una sola entrada de stock. */
export function confirmarLaRecepcion(
  d: DependenciasDeRecepcionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RecepcionConfirmadaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeConfirmarRecepcion,
    (entrada) =>
      d.casosDeUso().confirmarRecepcion(contexto, {
        recepcionId: entrada.recepcionId,
        ...(entrada.depositoId === null ? {} : { depositoId: entrada.depositoId }),
      }),
    (salida) => ({ recepcionId: salida.recepcionId, yaExistia: salida.yaExistia }),
  );
}

/** «Anular recepción» (solo una que todavía está «Por confirmar»), con su motivo. Solo gerente o administrador (`recepciones.anular`). */
export function anularLaRecepcion(
  d: DependenciasDeRecepcionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ anulada: true }>>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeAnularRecepcion,
    (entrada) => d.casosDeUso().anularRecepcionPendiente(contexto, entrada),
    () => ({ anulada: true as const }),
  );
}

export type LoRecibidoCorregidoParaLaPantalla = Readonly<{
  recepcionId: string;
  linea: number;
  numero: number;
  /** `true`: era la misma corrección de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/**
 * «Corregir lo recibido» de una línea de una recepción confirmada: la cantidad que de verdad llegó, su causa (lista cerrada) y una nota opcional. Un solo caso de uso, una transacción: suma la corrección,
 * mueve el stock por la diferencia y deja la auditoría. Solo gerente o administrador (`compras.corregir`); la sucursal de la recepción tiene que estar en el alcance de quien corrige; no se baja de lo ya
 * conciliado. La clave del envío es la idempotencia: el mismo pedido dos veces deja una sola corrección. Todo rechazo sale como el genérico.
 */
export function corregirLoRecibidoDeLaRecepcion(
  d: DependenciasDeRecepcionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<LoRecibidoCorregidoParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeCorregirLoRecibido,
    (entrada) => d.casosDeUso().corregirLoRecibido(contexto, entrada),
    (salida) => ({
      recepcionId: salida.recepcionId,
      linea: salida.linea,
      numero: salida.numero,
      yaExistia: salida.yaExistia,
    }),
  );
}
