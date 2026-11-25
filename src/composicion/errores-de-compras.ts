import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { CodigoDeCompras } from "../capacidades/experiencia/respuesta-de-compras";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { ErrorDeClientes } from "../modulos/clientes/publico";
import type { ErrorDeCompras } from "../modulos/compras/publico";
import type { ErrorDeStock } from "../modulos/stock/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * De un error de compras (N1 a N4) al código público que sale a la pantalla (ADR-016). Seis respuestas con texto propio, las que las maquetas aprobadas del 09/11/2026 redactan
 * (`compra.html`, `orden.html`): el remito y la factura repetidos, los puntos de venta sin declarar, la cantidad, el precio y el proveedor. TODO lo demás que el dominio rechaza sale
 * como el genérico «Esta acción no está permitida» (dueño, 30/10/2026, interfaz sobria: genérico antes que uno por acción), también lo que vuelve de stock o del directorio y lo
 * que tiene forma de objeto con nombre de negocio (`COMPROBANTE_YA_PAGADO`, `FUNCION_NO_INCLUIDA`). El guard, la empresa que no opera y la base ya traen su propio código y pasan SIN
 * CAMBIOS. Los errores propios de compras van en una tabla exhaustiva por tipo: un error nuevo del módulo no compila hasta que se le dé su código (así N4 no puede sumar
 * `COMPROBANTE_CON_NOTA_DE_CREDITO` sin decidir qué ve la persona). Los de stock y del directorio no entran en la tabla: otro módulo puede sumar uno sin romper compras, y salen como el genérico.
 * Los errores de N3 y N4 nacen con el genérico; cada pantalla que tenga un texto aprobado para uno lo cambia acá, con su fuente.
 * Previene: que un error de compras salga como un fallo inesperado, o que se invente un texto por cada regla del dominio. Chequeo: `errores-de-compras.test.ts`.
 */

/** Los errores con forma de texto que son de compras: ni del guard ni de stock ni del directorio (los que se llaman igual en dos módulos caen en el genérico, salvo la cantidad). */
type ErrorPropio = Exclude<
  Extract<ErrorDeCompras, string>,
  MotivoDeRechazo | Extract<ErrorDeStock, string> | Extract<ErrorDeClientes, string>
>;

const CODIGO_DE_ERROR_PROPIO: Readonly<Record<ErrorPropio, CodigoDeCompras>> = {
  ALICUOTA_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  ALICUOTA_NO_DISCRIMINADA: "COMPRAS_ACCION_NO_PERMITIDA",
  ALICUOTA_REQUERIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  ASIGNACIONES_INVALIDAS: "COMPRAS_ACCION_NO_PERMITIDA",
  ASIGNACION_DE_OTRO_PRODUCTO: "COMPRAS_ACCION_NO_PERMITIDA",
  ASIGNACION_NO_CONCILIABLE: "COMPRAS_ACCION_NO_PERMITIDA",
  CAJA_DE_OTRA_SUCURSAL: "COMPRAS_ACCION_NO_PERMITIDA",
  CAJA_EN_CIERRE: "COMPRAS_ACCION_NO_PERMITIDA",
  CAJA_INACTIVA: "COMPRAS_ACCION_NO_PERMITIDA",
  CAJA_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  CANTIDAD_ASIGNADA_EXCEDE_LO_FACTURADO: "COMPRAS_ACCION_NO_PERMITIDA",
  CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  CANTIDAD_SEGUN_REMITO_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  COMPRA_CONSUMIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  COMPRA_SIMPLE_NO_LLEVA_FACTURA: "COMPRAS_ACCION_NO_PERMITIDA",
  COMPROBANTE_ANULADO: "COMPRAS_ACCION_NO_PERMITIDA",
  COMPROBANTE_CONCILIADO: "COMPRAS_ACCION_NO_PERMITIDA",
  COMPROBANTE_CON_NOTA_DE_CREDITO: "COMPRAS_ACCION_NO_PERMITIDA",
  COMPROBANTE_NO_ENCONTRADO: "COMPRAS_ACCION_NO_PERMITIDA",
  COMPROBANTE_NO_PAGABLE: "COMPRAS_ACCION_NO_PERMITIDA",
  CONCILIACION_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  CONCILIACION_YA_ANULADA: "COMPRAS_ACCION_NO_PERMITIDA",
  CONDICION_DE_IVA_NO_DISPONIBLE: "COMPRAS_ACCION_NO_PERMITIDA",
  CONDICION_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  CAUSA_DE_CORRECCION_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  CONTROL_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  CORRECCION_DE_CANTIDAD_NO_DISPONIBLE: "COMPRAS_ACCION_NO_PERMITIDA",
  CORRECCION_DESACTUALIZADA: "COMPRAS_ACCION_NO_PERMITIDA",
  CORRECCION_BAJO_LO_CONCILIADO: "COMPRAS_ACCION_NO_PERMITIDA",
  CORRECCION_NO_SOPORTADA_PARA_LA_LINEA: "COMPRAS_ACCION_NO_PERMITIDA",
  CORRECCION_SIN_CAMBIOS_PEDIDOS: "COMPRAS_ACCION_NO_PERMITIDA",
  CUIT_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  CUIT_REQUERIDO_EN_PRIMERA_FACTURA: "COMPRAS_ACCION_NO_PERMITIDA",
  DEPOSITO_A_ELEGIR: "COMPRAS_ACCION_NO_PERMITIDA",
  DEPOSITO_DE_CALIDAD_NO_CONFIGURADO: "COMPRAS_ACCION_NO_PERMITIDA",
  DEVOLUCION_DE_OTRO_PRODUCTO: "COMPRAS_ACCION_NO_PERMITIDA",
  DEVOLUCION_DE_OTRO_PROVEEDOR: "COMPRAS_ACCION_NO_PERMITIDA",
  DEVOLUCION_DE_RECEPCION_NO_CONFIRMADA: "COMPRAS_ACCION_NO_PERMITIDA",
  DEVOLUCION_EXCEDE_LO_RECIBIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  DEVOLUCION_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  DIFERENCIA_ANULADA: "COMPRAS_ACCION_NO_PERMITIDA",
  DIFERENCIA_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  DIFERENCIA_YA_RESUELTA: "COMPRAS_ACCION_NO_PERMITIDA",
  EGRESO_DE_CAJA_NO_ANULABLE: "COMPRAS_ACCION_NO_PERMITIDA",
  EGRESO_DE_CAJA_RECHAZADO: "COMPRAS_ACCION_NO_PERMITIDA",
  FACTURA_NO_CORRESPONDE_AL_NIVEL: "COMPRAS_ACCION_NO_PERMITIDA",
  FACTURA_REQUERIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  FECHA_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  FUERA_DE_RANGO: "COMPRAS_ACCION_NO_PERMITIDA",
  JORNADA_DE_CAJA_NO_ABIERTA: "COMPRAS_ACCION_NO_PERMITIDA",
  LINEAS_REQUERIDAS: "COMPRAS_ACCION_NO_PERMITIDA",
  LINEA_DE_ORDEN_DE_OTRO_PRODUCTO: "COMPRAS_ACCION_NO_PERMITIDA",
  LINEA_DE_ORDEN_RETIRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  LINEA_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  LINEA_REPETIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  LINEA_SIN_PRECIO: "COMPRAS_ACCION_NO_PERMITIDA",
  MEDIO_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  MONEDA_NO_SOPORTADA: "COMPRAS_ACCION_NO_PERMITIDA",
  MOTIVO_DE_DEVOLUCION_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  NIVEL_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  NOTA_DE_CORRECCION_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  NOTA_DE_CREDITO_DE_FACTURA_ANULADA: "COMPRAS_ACCION_NO_PERMITIDA",
  NOTA_DE_CREDITO_DE_OTRO_PROVEEDOR: "COMPRAS_ACCION_NO_PERMITIDA",
  NOTA_DE_CREDITO_EXCEDE_LA_FACTURA: "COMPRAS_ACCION_NO_PERMITIDA",
  NOTA_DE_CREDITO_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  NOTA_DE_CREDITO_SIN_FACTURA: "COMPRAS_ACCION_NO_PERMITIDA",
  NUMERO_DE_COMPROBANTE_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  OBSERVACION_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  OBSERVACION_REQUERIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_CON_RECEPCIONES: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_CON_RECEPCIONES_PENDIENTES: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_DE_OTRO_PROVEEDOR: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_NO_CORRESPONDE_AL_NIVEL: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_NO_ESTA_PEDIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_NO_ES_BORRADOR: "COMPRAS_ACCION_NO_PERMITIDA",
  ORDEN_YA_CERRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  PAGO_NO_ENCONTRADO: "COMPRAS_ACCION_NO_PERMITIDA",
  PAGO_YA_ANULADO: "COMPRAS_ACCION_NO_PERMITIDA",
  PEDIDO_NO_ENCONTRADO: "COMPRAS_ACCION_NO_PERMITIDA",
  PEDIDO_YA_PENDIENTE: "COMPRAS_ACCION_NO_PERMITIDA",
  PEDIDO_YA_RESUELTO: "COMPRAS_ACCION_NO_PERMITIDA",
  PESO_REAL_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  PESO_REAL_NO_CORRESPONDE: "COMPRAS_ACCION_NO_PERMITIDA",
  PESO_REAL_REQUERIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  PRECIO_INVALIDO: "COMPRAS_PRECIO_INVALIDO",
  PRECIO_POR_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  PRESENTACION_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  PRESENTACION_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  PRODUCTO_NO_COMPRABLE: "COMPRAS_ACCION_NO_PERMITIDA",
  PROVEEDOR_CON_OTRO_DOCUMENTO: "COMPRAS_ACCION_NO_PERMITIDA",
  PROVEEDOR_NO_ENCONTRADO: "COMPRAS_PROVEEDOR_NO_ENCONTRADO",
  PUNTO_DE_VENTA_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  PUNTO_DE_VENTA_NO_DECLARADO: "COMPRAS_PUNTO_DE_VENTA_NO_DECLARADO",
  RECEPCION_EXCEDE_LA_ORDEN: "COMPRAS_ACCION_NO_PERMITIDA",
  RECEPCION_EXCEDE_LA_ORDEN_SIN_CONFIRMAR: "COMPRAS_ACCION_NO_PERMITIDA",
  RECEPCION_NO_ENCONTRADA: "COMPRAS_ACCION_NO_PERMITIDA",
  RECEPCION_SEPARADA_NO_CORRESPONDE_AL_NIVEL: "COMPRAS_ACCION_NO_PERMITIDA",
  RECEPCION_YA_ANULADA: "COMPRAS_ACCION_NO_PERMITIDA",
  RECEPCION_NO_CONFIRMADA: "COMPRAS_ACCION_NO_PERMITIDA",
  RECEPCION_YA_CONFIRMADA: "COMPRAS_ACCION_NO_PERMITIDA",
  RESOLUCION_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  SALIDA_DE_CAJA_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  SALIDA_DE_CAJA_SOLO_EN_EFECTIVO: "COMPRAS_ACCION_NO_PERMITIDA",
  SIN_SESION_ABIERTA: "COMPRAS_ACCION_NO_PERMITIDA",
  TEMPERATURA_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  TIPO_DE_COMPROBANTE_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  TOLERANCIA_INVALIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  TOTAL_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  TRIBUTO_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
  UNIDAD_DE_PRECIO_REQUERIDA: "COMPRAS_ACCION_NO_PERMITIDA",
  VINCULO_INVALIDO: "COMPRAS_ACCION_NO_PERMITIDA",
};

/** La cantidad la rechazan compras y stock con el mismo nombre y el mismo sentido: un solo texto, el aprobado. */
const NOMBRE_DE_LA_CANTIDAD = "CANTIDAD_INVALIDA";

/** Los errores con forma de objeto que tienen texto propio (`{ error: "<nombre>", ... }`): el remito y la factura que ya están cargados. El id de la compra que los tiene no sale. */
const OBJETO_CON_TEXTO_PROPIO: Readonly<Record<string, CodigoDeCompras>> = {
  REMITO_YA_REGISTRADO: "COMPRAS_REMITO_REPETIDO",
  COMPROBANTE_YA_REGISTRADO: "COMPRAS_FACTURA_REPETIDA",
};

const GENERICO = { codigo: "COMPRAS_ACCION_NO_PERMITIDA" satisfies CodigoDeCompras } as const;

/** El error del caso de uso o de la consulta tal como lo entiende `aRespuesta`: un código público de compras o, si no es de compras, el mismo error. */
export function traducirErrorDeCompras(error: unknown): unknown {
  if (typeof error === "string") {
    if (Object.hasOwn(CODIGO_DE_ERROR_PROPIO, error)) {
      return { codigo: CODIGO_DE_ERROR_PROPIO[error as ErrorPropio] };
    }
    if (error === NOMBRE_DE_LA_CANTIDAD) {
      return { codigo: "COMPRAS_CANTIDAD_INVALIDA" satisfies CodigoDeCompras };
    }
    // Un código público ya conocido (los motivos del guard, la sesión) pasa; cualquier otro texto de negocio (stock, directorio) es el genérico.
    return Object.hasOwn(CODIGOS_PUBLICOS, error) ? error : GENERICO;
  }
  if (typeof error === "object" && error !== null) {
    const nombre = (error as { error?: unknown }).error;
    if (typeof nombre === "string") {
      return Object.hasOwn(OBJETO_CON_TEXTO_PROPIO, nombre)
        ? { codigo: OBJETO_CON_TEXTO_PROPIO[nombre] }
        : GENERICO;
    }
  }
  return error;
}

/**
 * Lo que tienen en común las acciones de la web de compras: leer el pedido, correr el caso de uso o la consulta con el contexto del servidor y traducir el resultado. Un pedido sin la
 * forma pedida es el genérico (no hay un texto por campo en la maqueta); una excepción sale sin detalle y con referencia. Un solo lugar: que cada pantalla de compras no lo escriba a su manera.
 */
export async function accionDeCompras<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") };
  try {
    const resultado = await correr(entrada.valor);
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDeCompras(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
