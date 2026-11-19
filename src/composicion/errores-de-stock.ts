import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { CodigoDeStock } from "../capacidades/experiencia/respuesta-de-stock";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { ErrorDeStock } from "../modulos/stock/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * De un error de stock al código público que sale a la pantalla (ADR-016). Solo siete errores del dominio tienen un texto propio, los que la maqueta aprobada `stock.html` (fila
 * «Errores y avisos» de «Textos nuevos», 09/11/2026) redacta; todo lo demás que el dominio rechaza sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026,
 * interfaz sobria: genérico antes que uno por acción). El guard, la empresa que no opera y la base ya traen su propio código y pasan SIN CAMBIOS. Es exhaustiva por tipo: un error
 * nuevo de `ErrorDeStock` no compila hasta que se le dé su código. `CONTROL_REQUIERE_CONFIRMACION` sale como `STOCK_CONTROL_AVISA` (no es un fallo: la pantalla de movimientos
 * pide confirmar y reintenta con la misma clave). Previene: que un error de stock salga crudo a la pantalla o que se invente un texto por cada regla del dominio.
 * Chequeo: `errores-de-stock.test.ts`.
 */

/** Los errores del dominio que son un texto propio de stock (los motivos del guard y los códigos de otros módulos tienen el suyo). */
type ErrorPropio = Exclude<Extract<ErrorDeStock, string>, MotivoDeRechazo>;

const GENERICO = "STOCK_ACCION_NO_PERMITIDA" satisfies CodigoDeStock;

const CODIGO_DE_ERROR_PROPIO: Readonly<Record<ErrorPropio, CodigoDeStock>> = {
  NOMBRE_DUPLICADO: "STOCK_NOMBRE_DUPLICADO",
  TRANSFERENCIA_AL_MISMO_DEPOSITO: "STOCK_TRANSFERENCIA_AL_MISMO_DEPOSITO",
  DETALLE_REQUERIDO: "STOCK_DETALLE_REQUERIDO",
  CANTIDAD_INVALIDA: "STOCK_CANTIDAD_INVALIDA",
  CONTEO_EN_CURSO: "STOCK_CONTEO_EN_CURSO",
  SUCURSAL_FUERA_DE_ALCANCE: GENERICO,
  IDENTIFICADOR_INVALIDO: GENERICO,
  ID_REUTILIZADO: GENERICO,
  CLAVE_REUTILIZADA: GENERICO,
  NOMBRE_INVALIDO: GENERICO,
  USO_INVALIDO: GENERICO,
  USO_NO_VENDIBLE: GENERICO,
  SUCURSAL_NO_ENCONTRADA: GENERICO,
  SUCURSAL_INACTIVA: GENERICO,
  YA_HAY_DEPOSITO_DE_VENTA: GENERICO,
  ES_EL_DE_VENTA: GENERICO,
  DEPOSITO_NO_ENCONTRADO: GENERICO,
  DEPOSITO_DESACTUALIZADO: GENERICO,
  DEPOSITO_CON_EXISTENCIA: GENERICO,
  DEPOSITO_CON_CONTEO_ABIERTO: GENERICO,
  PRODUCTO_NO_ENCONTRADO: GENERICO,
  PRODUCTO_INACTIVO: GENERICO,
  CLASE_NO_CONTROLABLE: GENERICO,
  ARTICULO_EN_COMPOSICION_ACTIVA: GENERICO,
  PRODUCTO_OCULTO: GENERICO,
  DEPOSITO_INACTIVO: GENERICO,
  DEPOSITO_DE_DESTINO_NO_ENCONTRADO: GENERICO,
  ARTICULO_NO_CONTROLADO: GENERICO,
  CONVERSION_NO_EXACTA: GENERICO,
  DIMENSION_DISTINTA: GENERICO,
  MOTIVO_NO_PERMITIDO: GENERICO,
  COSTO_INVALIDO: GENERICO,
  FECHA_PASADA_NO_ADMITIDA: GENERICO,
  FECHA_FUTURA_NO_ADMITIDA: GENERICO,
  RENGLONES_INVALIDOS: GENERICO,
  RENGLON_REPETIDO: GENERICO,
  MOVIMIENTO_NO_ENCONTRADO: GENERICO,
  MOVIMIENTO_YA_ANULADO: GENERICO,
  MOVIMIENTO_NO_ANULABLE: GENERICO,
  CONTEO_NO_ENCONTRADO: GENERICO,
  CONTEO_CERRADO: GENERICO,
  CONTEO_CANCELADO: GENERICO,
  CONTEO_SIN_REGISTROS: GENERICO,
  MOTIVO_REQUERIDO: GENERICO,
  HORA_FUERA_DE_VENTANA: GENERICO,
  HORA_ANTERIOR_AL_ULTIMO_CONTEO: GENERICO,
  MOTIVO_NO_CORRESPONDE: GENERICO,
  MOVIMIENTO_NO_EXPLICA: GENERICO,
  EXPLICACION_SUPERA_LA_DIFERENCIA: GENERICO,
  REVISION_DESACTUALIZADA: GENERICO,
  OPCION_CON_CONSUMO_EN_VENTA_POR_PESO: GENERICO,
  VERSION_DE_OPCION_NO_ENCONTRADA: GENERICO,
  COMPOSICION_VACIA: GENERICO,
  COMPONENTE_REPETIDO: GENERICO,
  COMPONENTE_NO_CONTROLADO: GENERICO,
  COMPONENTE_ES_INSUMO: GENERICO,
  COMPOSICION_DESACTUALIZADA: GENERICO,
  RINDE_INVALIDO: GENERICO,
  SIN_COMPOSICION: GENERICO,
  RECETA_DEMASIADO_ANIDADA: GENERICO,
  CICLO_EN_LA_RECETA: GENERICO,
  COMPUESTO_NO_ES_ELABORADO: GENERICO,
  PRODUCTO_NO_LLEVA_RECETA: GENERICO,
  PERDIDA_INVALIDA: GENERICO,
  VENCIMIENTO_REQUERIDO: GENERICO,
  VENCIMIENTO_PASADO: GENERICO,
  LOTE_NO_ENCONTRADO: GENERICO,
  LOTE_SIN_CALIDAD: GENERICO,
  LOTE_DESACTUALIZADO: GENERICO,
  LOTE_SIN_ASIGNAR: GENERICO,
  SALDO_DE_LOTE_INSUFICIENTE: GENERICO,
  SIN_CAMBIOS: GENERICO,
};

/** Los errores con forma de objeto que son del negocio de stock: el control de existencia negativa (avisa) y la función que el plan no incluye (el genérico). */
const CODIGO_DE_ERROR_DE_OBJETO: Readonly<Record<string, CodigoDeStock>> = {
  CONTROL_REQUIERE_CONFIRMACION: "STOCK_CONTROL_AVISA",
  FUNCION_NO_INCLUIDA: GENERICO,
};

/** El error del caso de uso tal como lo entiende `aRespuesta`: un código público de stock o, si no es de stock, el mismo error. Del error con forma de objeto NO sale ningún dato (ni el detalle de los saldos). */
export function traducirErrorDeStock(error: unknown): unknown {
  if (typeof error === "string" && Object.hasOwn(CODIGO_DE_ERROR_PROPIO, error)) {
    return { codigo: CODIGO_DE_ERROR_PROPIO[error as ErrorPropio] };
  }
  if (typeof error === "object" && error !== null) {
    const nombre = (error as { error?: unknown }).error;
    if (typeof nombre === "string" && Object.hasOwn(CODIGO_DE_ERROR_DE_OBJETO, nombre)) {
      return { codigo: CODIGO_DE_ERROR_DE_OBJETO[nombre] };
    }
  }
  return error;
}

/**
 * Lo que tienen en común las acciones de la web de stock: leer el pedido, correr el caso de uso o la consulta con el contexto del servidor y traducir el resultado. Un pedido sin
 * la forma pedida es el genérico (no hay un texto por campo en la maqueta); una excepción sale sin detalle y con referencia. Un solo lugar: que cada pantalla de stock no lo escriba a su manera.
 */
export async function accionDeStock<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return { ok: false, error: errorDeCodigo(GENERICO) };
  try {
    const resultado = await correr(entrada.valor);
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDeStock(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
