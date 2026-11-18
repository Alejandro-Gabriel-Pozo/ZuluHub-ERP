import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  COLUMNAS_DEL_SALON,
  FILAS_DEL_SALON,
  FORMAS_DE_MESA,
  TAMANOS_DE_MESA,
  huellaDeMesa,
  type CasosDeUsoDeSalon,
  type ConsultasDeSalon,
} from "../modulos/salon/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { traducirErrorDeSalon } from "./errores-de-salon";
import {
  leerElPedidoDeCrearMesa,
  leerElPedidoDeEditarMesa,
  leerElPedidoDeUnaMesa,
} from "./entradas-de-mesas";

/**
 * La pantalla «Mesas» del salón (S-1; maqueta aprobada `mesas.html`, 09/11/2026): la lista de las mesas de la sucursal, y crear, editar, desactivar y reactivar. Vive acá, y no en
 * `apps/web`, para probarse con la base real sin levantar Next (igual que `secciones-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/mesas-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `mesas.ver`; crear, editar, desactivar y reactivar, `mesas.*` (Gerente y Administrador, decisión del dueño). Acá no se
 *    decide ningún permiso. Con `salon` en desarrollo (hoy), sin la perilla del plan o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La sucursal la pone el servidor** (`sucursalId` llega ya resuelta por `apps/web/servidor/salon.ts`, nunca del pedido): vacía (sin sucursal elegida) cierra con el genérico, nunca se
 *    asume «todas». Una mesa que no es de esa sucursal es indistinguible de una que no existe: el genérico.
 *  - **Repetir no duplica.** Crear lleva la clave de creación que fijó la página (el `id` de la mesa): la misma otra vez devuelve la mesa ya creada, sin escribir ni auditar. Editar con
 *    lo ya aplicado no escribe; desactivar y reactivar devuelven `yaEstaba`.
 *  - **Dos cambios a la vez no se pisan.** Editar lleva la versión que la persona vio (con una vieja el caso de uso rechaza sin escribir) y dos mesas que se pisan en el plano las frena
 *    la única de la base (`mesa_celda`).
 *  - **Nada de más sale.** Lista blanca campo por campo: id, número, forma, tamaño, columna, fila, estado y versión.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeSalon`).
 */

export type DependenciasDeMesasWeb = Readonly<{
  casosDeUso: () => Pick<
    CasosDeUsoDeSalon,
    "crearMesa" | "editarMesa" | "desactivarMesa" | "reactivarMesa"
  >;
  consultas: () => Pick<ConsultasDeSalon, "listarMesas">;
  respuesta: DependenciasDeRespuesta;
}>;

export type MesaParaLaPantalla = Readonly<{
  id: string;
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
  activa: boolean;
  version: number;
}>;

export type MesasParaLaPantalla = Readonly<{ mesas: readonly MesaParaLaPantalla[] }>;

/** Las medidas del salón para dibujar el plano: la cuadrícula y las casillas que ocupa cada forma y tamaño (ancho × alto). */
export type MedidasDelSalonParaLaPantalla = Readonly<{
  columnas: number;
  filas: number;
  huellas: readonly Readonly<{ forma: string; tamano: string; ancho: number; alto: number }>[];
}>;

/**
 * Las medidas que el navegador necesita para DIBUJAR el plano de mesas (S-1b). Salen del dominio de salón (`huellaDeMesa`, 14 × 9): una regla, un lugar; la pantalla solo dibuja y la
 * validez de una mesa (que entre y que no se pise) la sigue decidiendo el servidor al guardar. Puro: sin base ni permisos, porque no lleva ningún dato de la empresa. Previene: la tabla
 * de casillas copiada a mano en la pantalla, que se desfasa del servidor cuando cambia una medida.
 */
export function medidasDelSalon(): MedidasDelSalonParaLaPantalla {
  return {
    columnas: COLUMNAS_DEL_SALON,
    filas: FILAS_DEL_SALON,
    huellas: FORMAS_DE_MESA.flatMap((forma) =>
      TAMANOS_DE_MESA.map((tamano) => ({ forma, tamano, ...huellaDeMesa(forma, tamano) })),
    ),
  };
}

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, d: DependenciasDeMesasWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeSalon(error), d.respuesta),
});

/** Un pedido que no tiene la forma pedida: el número sin forma de número tiene su texto; el resto, el genérico. */
const pedidoInvalido = (motivo: string, d: DependenciasDeMesasWeb): Respuesta<never> =>
  motivo === "NUMERO_DE_MESA_INVALIDO" ? conError(motivo, d) : { ok: false, error: GENERICO };

const aPantalla = (m: {
  id: string;
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
  activa: boolean;
  version: number;
}): MesaParaLaPantalla => ({
  id: m.id,
  numero: m.numero,
  forma: m.forma,
  tamano: m.tamano,
  columna: m.columna,
  fila: m.fila,
  activa: m.activa,
  version: m.version,
});

/** Todas las mesas de la sucursal (activas y desactivadas), por número. Es una LECTURA: no escribe ni audita. Sin sucursal, el genérico. */
export async function verLasMesas(
  d: DependenciasDeMesasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<MesasParaLaPantalla>> {
  if (sucursalId === "") return { ok: false, error: GENERICO };
  try {
    const lista = await d.consultas().listarMesas(contexto, { sucursalId, incluirInactivas: true });
    if (!lista.ok) return conError(lista.error, d);
    return { ok: true, dato: { mesas: lista.valor.map(aPantalla) } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Una mesa de la sucursal por su `id` (para editarla). Un `id` sin forma de id o de otra sucursal es el genérico, el mismo para ambos. */
export async function verLaMesa(
  d: DependenciasDeMesasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  mesaId: string,
): Promise<Respuesta<MesaParaLaPantalla>> {
  const pedido = leerElPedidoDeUnaMesa({ mesaId });
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const lista = await verLasMesas(d, contexto, sucursalId);
  if (!lista.ok) return lista;
  const mesa = lista.dato.mesas.find((m) => m.id === pedido.valor.mesaId);
  return mesa === undefined ? { ok: false, error: GENERICO } : { ok: true, dato: mesa };
}

/** Crea una mesa en la sucursal; devuelve su id y si ya existía (la misma clave de creación otra vez). */
export async function crearLaMesa(
  d: DependenciasDeMesasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ mesaId: string; yaExistia: boolean }>>> {
  if (sucursalId === "") return { ok: false, error: GENERICO };
  const pedido = leerElPedidoDeCrearMesa(crudo);
  if (!pedido.ok) return pedidoInvalido(pedido.error, d);
  const { claveDeCreacion, ...datos } = pedido.valor;
  try {
    const creada = await d
      .casosDeUso()
      .crearMesa(contexto, { mesaId: claveDeCreacion, sucursalId, ...datos });
    return aRespuesta(
      creada.ok ? creada : err(traducirErrorDeSalon(creada.error)),
      d.respuesta,
      (salida) => ({ mesaId: salida.mesaId, yaExistia: salida.yaExistia }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Edita una mesa de la sucursal con la versión que la persona vio. */
export async function editarLaMesa(
  d: DependenciasDeMesasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ mesaId: string; version: number }>>> {
  const pedido = leerElPedidoDeEditarMesa(crudo);
  if (!pedido.ok) return pedidoInvalido(pedido.error, d);
  try {
    const de = await verLaMesa(d, contexto, sucursalId, pedido.valor.mesaId);
    if (!de.ok) return de;
    const editada = await d.casosDeUso().editarMesa(contexto, pedido.valor);
    return aRespuesta(
      editada.ok ? editada : err(traducirErrorDeSalon(editada.error)),
      d.respuesta,
      (salida) => ({ mesaId: salida.mesaId, version: salida.version }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Desactiva (`activa: false`) o reactiva (`activa: true`) una mesa de la sucursal; repetirlo es éxito sin escribir. */
export async function cambiarElEstadoDeLaMesa(
  d: DependenciasDeMesasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
  activa: boolean,
): Promise<Respuesta<Readonly<{ mesaId: string; yaEstaba: boolean }>>> {
  const pedido = leerElPedidoDeUnaMesa(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const { mesaId } = pedido.valor;
  try {
    const de = await verLaMesa(d, contexto, sucursalId, mesaId);
    if (!de.ok) return de;
    const entrada = { mesaId };
    const cambio = activa
      ? await d.casosDeUso().reactivarMesa(contexto, entrada)
      : await d.casosDeUso().desactivarMesa(contexto, entrada);
    return aRespuesta(
      cambio.ok ? cambio : err(traducirErrorDeSalon(cambio.error)),
      d.respuesta,
      (salida) => ({ mesaId, yaEstaba: salida.yaExistia }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
