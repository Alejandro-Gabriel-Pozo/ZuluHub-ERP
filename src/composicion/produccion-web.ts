import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type {
  CasosDeUsoDeProduccion,
  ConsultasDeProduccion,
  FichaDeOrden,
  OrdenDeLista,
} from "../modulos/produccion/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeMotivoDeOrden,
  entradaDeOrden,
  leerLaEntradaDeLaListaDeOrdenes,
  type EntradaDeLaListaDeOrdenes,
} from "./entradas-de-produccion";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";
import { traducirErrorDeProduccion } from "./errores-de-produccion";

/**
 * Las pantallas de órdenes de producción (E6; maqueta aprobada `produccion.html`, 09/11/2026): la lista, la ficha de una orden, cancelar y anular. Vive acá, y no en `apps/web`, para
 * probarse con la base real sin levantar Next (igual que `productos-web.ts` y `cajas-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `produccion-web.test.ts` y `test/integracion/produccion-web.test.ts`):
 *  - **El permiso es de la consulta y del caso de uso.** `transformaciones.ver`, `.cancelar` y `.anular` las exige el guard dentro de la transacción; acá no se decide ningún permiso. Con
 *    `produccion` en desarrollo (hoy) o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa, la persona y la sucursal las pone el servidor**: el pedido no las trae. Una empresa nunca ve órdenes de otra; el operador, solo las de su alcance (la consulta).
 *  - **Nada de más sale.** Lista blanca campo por campo: de la lista, id, número, estado, nombre, cantidad y unidad; de la ficha, lo que la pantalla dibuja (sin ids de depósito, de
 *    movimiento ni de lote). El costo sale solo si la consulta lo trae (solo con `costos.ver`), como texto decimal (ADR-006).
 *  - **Lo que nada puede coincidir no se pregunta**: un filtro de estado desconocido devuelve la lista vacía sin consultar.
 *  - **Cancelar y anular se repiten sin duplicar**: ya cancelada / ya anulada devuelve `yaEstaba` sin escribir ni auditar (el caso de uso decide por estado; no hay clave guardada).
 *    Dos a la vez sobre la misma orden: la fila se bloquea y una gana, la otra relee. Todo cambio es una transacción con su auditoría (el caso de uso).
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): un error de la orden sin texto aprobado sale como el genérico; un fallo inesperado, sin detalle y con referencia.
 */

export type DependenciasDeProduccionWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeProduccion, "cancelarOrden" | "anularOrden">;
  consultas: () => Pick<ConsultasDeProduccion, "listarOrdenes" | "fichaDeOrden">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una orden de la lista: la cantidad es la esperada, en la unidad del producto (texto decimal exacto). */
export type OrdenParaLaLista = Readonly<{
  id: string;
  numero: number;
  estado: OrdenDeLista["estado"];
  nombre: string;
  cantidad: string;
  unidadId: string;
}>;

export type OrdenesParaLaLista = Readonly<{ ordenes: readonly OrdenParaLaLista[] }>;

export type RenglonParaLaPantalla = Readonly<{
  nombre: string;
  /** Lo esperado (sellado al abrir) y lo real (`null` hasta cerrar), en la unidad del insumo. */
  esperado: string;
  real: string | null;
  unidadId: string;
}>;

/** La ficha de una orden para la pantalla; `costo` solo si la consulta lo trajo (con `costos.ver`). */
export type OrdenParaLaPantalla = Readonly<{
  id: string;
  numero: number;
  estado: FichaDeOrden["estado"];
  nombre: string;
  unidadId: string;
  cantidadEsperada: string;
  cantidadObtenida: string | null;
  /** `esperado − obtenido`; `null` hasta cerrar. */
  mermaDeLote: string | null;
  recetaCambiada: boolean;
  vence: string | null;
  lote: string | null;
  renglones: readonly RenglonParaLaPantalla[];
  costo?: NonNullable<FichaDeOrden["costo"]>;
}>;

const SIN_FORMA = errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA");

/**
 * Lo que tienen en común las acciones de la web de producción: leer el pedido, correr el caso de uso o la consulta con el contexto del servidor y traducir el resultado. Un pedido sin la
 * forma pedida es el genérico (no hay un texto por campo); una excepción sale sin detalle y con referencia. Un solo lugar: que cada pantalla de producción no lo escriba a su manera.
 */
async function accionDeProduccion<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return { ok: false, error: SIN_FORMA };
  try {
    const resultado = await correr(entrada.valor);
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDeProduccion(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}

/** Las órdenes de la sucursal con la que trabaja la persona (también las cerradas, canceladas y anuladas), con el filtro de la dirección. Es una LECTURA: no escribe ni audita. */
export async function listarLasOrdenes(
  d: DependenciasDeProduccionWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  entrada: EntradaDeLaListaDeOrdenes,
): Promise<Respuesta<OrdenesParaLaLista>> {
  try {
    const leida = leerLaEntradaDeLaListaDeOrdenes(entrada);
    if (leida === null) return { ok: true, dato: { ordenes: [] } };
    const lista = await d.consultas().listarOrdenes(contexto, { ...leida, sucursalId });
    return aRespuesta(
      lista.ok ? lista : err(traducirErrorDeProduccion(lista.error)),
      d.respuesta,
      (ordenes) => ({
        ordenes: ordenes.map((o) => ({
          id: o.ordenId,
          numero: o.numero,
          estado: o.estado,
          nombre: o.nombre,
          cantidad: o.cantidadEsperada,
          unidadId: o.unidadId,
        })),
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** La ficha de una orden. Una orden que no existe, es de otra empresa o está fuera del alcance sale como el genérico, sin decir cuál de los casos es. Es una LECTURA. */
export function verLaOrden(
  d: DependenciasDeProduccionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<OrdenParaLaPantalla>> {
  return accionDeProduccion(
    d.respuesta,
    crudo,
    entradaDeOrden,
    async (entrada) => {
      const ficha = await d.consultas().fichaDeOrden(contexto, entrada);
      if (!ficha.ok) return ficha;
      return ficha.valor === null ? err("ORDEN_NO_ENCONTRADA" as const) : ok(ficha.valor);
    },
    (f) => ({
      id: f.ordenId,
      numero: f.numero,
      estado: f.estado,
      nombre: f.nombre,
      unidadId: f.unidadId,
      cantidadEsperada: f.cantidadEsperada,
      cantidadObtenida: f.cantidadObtenida,
      mermaDeLote: f.mermaDeLote,
      recetaCambiada: f.recetaCambiada,
      vence: f.vence,
      lote: f.lote === null ? null : f.lote.codigo,
      renglones: f.renglones.map((r) => ({
        nombre: r.nombre,
        esperado: r.esperado,
        real: r.real,
        unidadId: r.unidadId,
      })),
      ...(f.costo === undefined ? {} : { costo: f.costo }),
    }),
  );
}

/** Cancela una orden abierta, con motivo. Repetir devuelve `yaEstaba` sin escribir. */
export function cancelarLaOrden(
  d: DependenciasDeProduccionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accionDeProduccion(
    d.respuesta,
    crudo,
    entradaDeMotivoDeOrden,
    (entrada) => d.casosDeUso().cancelarOrden(contexto, entrada),
    (salida) => ({ yaEstaba: salida.yaEstaba }),
  );
}

/** Anula una orden cerrada, con motivo. Repetir devuelve `yaEstaba` sin escribir. */
export function anularLaOrden(
  d: DependenciasDeProduccionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accionDeProduccion(
    d.respuesta,
    crudo,
    entradaDeMotivoDeOrden,
    (entrada) => d.casosDeUso().anularOrden(contexto, entrada),
    (salida) => ({ yaEstaba: salida.yaEstaba }),
  );
}
