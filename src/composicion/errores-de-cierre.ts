import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { CodigoDeCierre } from "../capacidades/experiencia/respuesta-de-cierre";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type {
  ErrorAlCancelarAuditoria,
  ErrorAlCerrarJornada,
  ErrorAlIniciarAuditoria,
  ErrorAlPedirLaJornadaDeHoy,
} from "../modulos/cierre/publico";
import type { ErrorAlPedirPersonasParaMostrar } from "../modulos/identidad/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntradaDeCierre } from "./entradas-de-cierre";
import type { Web } from "./web";

/**
 * De un error del cierre del día al código público que sale a la pantalla (ADR-016). Dos respuestas, solo las que la maqueta aceptada tiene con texto (DDD:123, 14/11/2026):
 * «Cambió algo mientras mirabas. Revisá y volvé a cerrar» para `CONTROLES_CAMBIARON` (la pantalla vuelve a leer los controles) y el genérico «Esta acción no está permitida» para
 * TODO lo demás que el negocio rechaza (un control que impide cerrar, uno sin reconocer, la jornada ya cerrada o sin empezar, un medio o un cobro inválido, un aporte que
 * no respondió, la clave repetida con otro contenido, la entrada con otra forma). El guard (`MODULO_*`, `SIN_PERMISO`), la empresa que no opera y la base ya traen su propio
 * código y pasan SIN CAMBIOS. Es EXHAUSTIVA por tipo: un error nuevo de cualquier caso de uso o consulta de la pantalla no compila hasta que se le dé su código.
 * Previene: que un error del cierre, de caja, de ventas o de identidad salga crudo a la pantalla, o que se invente un texto por cada regla del dominio.
 * Chequeo: `errores-de-cierre.test.ts` (cada error conocido, y que el desconocido no se traga).
 */

type ResultadoDe<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;
type ErrorDe<F> =
  ResultadoDe<F> extends infer R ? (R extends { ok: false; error: infer E } ? E : never) : never;

type CasosDeCaja = ReturnType<Web["casosDeUsoDeCaja"]>;
type ConsultasDeCaja = ReturnType<Web["consultasDeCaja"]>;
type ConsultasDeCierre = ReturnType<Web["consultasDeCierre"]>;
type ConsultasDeVentas = ReturnType<Web["consultasDeVentas"]>;

/** Todo lo que puede devolver un caso de uso o una consulta de la pantalla del cierre. */
type ErrorDelCierre =
  | ErrorAlIniciarAuditoria
  | ErrorAlCancelarAuditoria
  | ErrorAlCerrarJornada
  | ErrorAlPedirLaJornadaDeHoy
  | ErrorDe<ConsultasDeCierre["listarJornadas"]>
  | ErrorDe<ConsultasDeCierre["estadoDeJornada"]>
  | ErrorDe<ConsultasDeCierre["controlesDeLaJornada"]>
  | ErrorDe<CasosDeCaja["corregirMedioDeCobro"]>
  | ErrorDe<CasosDeCaja["declararTotal"]>
  | ErrorDe<CasosDeCaja["darConformeGeneral"]>
  | ErrorDe<ConsultasDeCaja["cobrosDeLaJornada"]>
  | ErrorDe<ConsultasDeCaja["conciliacionDeLaJornada"]>
  | ErrorDe<ConsultasDeCaja["listarMediosDePago"]>
  | ErrorDe<ConsultasDeCaja["listarCuentasDeCobro"]>
  | ErrorDe<ConsultasDeVentas["listarTickets"]>
  | ErrorAlPedirPersonasParaMostrar
  | ErrorDeEntradaDeCierre;

const GENERICO: CodigoDeCierre = "CIERRE_ACCION_NO_PERMITIDA";

/** Los errores con nombre (texto) que son del negocio: todos, el genérico (los motivos del guard tienen su propio texto y pasan). */
type ErrorPropio = Exclude<Extract<ErrorDelCierre, string>, MotivoDeRechazo>;

/**
 * Cada error con nombre que puede salir de la pantalla del cierre (incluidos los que la consulta de tickets de ventas declara por su tipo aunque este uso no los dé). Todos
 * valen lo mismo (el genérico): el `Record` es solo para que el compilador falle si el tipo suma un error que no está acá.
 */
const ERRORES_PROPIOS: Readonly<Record<ErrorPropio, CodigoDeCierre>> = {
  JORNADA_NO_ENCONTRADA: GENERICO,
  FECHA_INVALIDA: GENERICO,
  JORNADA_CERRADA: GENERICO,
  SUCURSAL_FUERA_DE_ALCANCE: GENERICO,
  JORNADA_NO_EN_AUDITORIA: GENERICO,
  OBSERVACION_INVALIDA: GENERICO,
  RECONOCIMIENTO_INVALIDO: GENERICO,
  HORA_DE_CORTE_INVALIDA: GENERICO,
  ZONA_HORARIA_INVALIDA: GENERICO,
  INSTANTE_INVALIDO: GENERICO,
  APORTE_NO_DISPONIBLE: GENERICO,
  SUCURSAL_NO_ENCONTRADA: GENERICO,
  CONVERSION_NO_EXACTA: GENERICO,
  IDENTIFICADOR_INVALIDO: GENERICO,
  PRODUCTO_NO_ENCONTRADO: GENERICO,
  PRODUCTO_INACTIVO: GENERICO,
  PRODUCTO_NO_VENDIBLE: GENERICO,
  PRODUCTO_OCULTO: GENERICO,
  PRODUCTO_SIN_ALICUOTA: GENERICO,
  CLASIFICACION_INCONSISTENTE: GENERICO,
  SUCURSAL_INACTIVA: GENERICO,
  CANTIDAD_INVALIDA: GENERICO,
  CANTIDAD_NO_ES_MULTIPLO_DEL_PASO: GENERICO,
  OPCION_REPETIDA: GENERICO,
  VARIANTE_SIN_PRECIO: GENERICO,
  PRECIO_EN_OTRA_FORMA_DE_VENTA: GENERICO,
  PRECIO_FUERA_DE_RANGO: GENERICO,
  MEDIO_NO_ENCONTRADO: GENERICO,
  CUENTA_DE_COBRO_NO_ENCONTRADA: GENERICO,
  CLAVE_DE_IDEMPOTENCIA_INVALIDA: GENERICO,
  IMPORTE_INVALIDO: GENERICO,
  MONEDA_NO_SOPORTADA: GENERICO,
  CLAVE_REUTILIZADA: GENERICO,
  MOTIVO_INVALIDO: GENERICO,
  MEDIO_INACTIVO: GENERICO,
  CUENTA_DE_COBRO_NO_ADMITIDA: GENERICO,
  CUENTA_DE_COBRO_DE_OTRA_SUCURSAL: GENERICO,
  CUENTA_DE_COBRO_INACTIVA: GENERICO,
  CUENTA_DE_COBRO_INCOMPATIBLE: GENERICO,
  COBRO_NO_ENCONTRADO: GENERICO,
  MEDIO_DEL_COBRO_SIN_CAMBIOS: GENERICO,
  MEDIO_NO_DECLARABLE: GENERICO,
  CURSOR_INVALIDO: GENERICO,
  LIMITE_INVALIDO: GENERICO,
  ENTRADA_INVALIDA: GENERICO,
  FACTURACION_NO_DISPONIBLE: GENERICO,
  TICKET_NO_FACTURABLE: GENERICO,
  CUENTA_NO_ENCONTRADA: GENERICO,
  PRODUCTO_SIN_PRECIO: GENERICO,
  PRECIO_ABIERTO_NO_PERMITIDO: GENERICO,
  TICKET_NO_ENCONTRADO: GENERICO,
  CAJA_NO_ENCONTRADA: GENERICO,
  CAJA_INACTIVA: GENERICO,
  CANTIDAD_NO_MOSTRABLE: GENERICO,
  IMPORTE_NO_MOSTRABLE: GENERICO,
  ANCHO_INVALIDO: GENERICO,
  TICKET_NO_IMPRIMIBLE: GENERICO,
  DEMASIADOS_TICKETS: GENERICO,
};

/** Los errores con forma de objeto y `codigo` que son del negocio (el de la empresa que no opera tiene su propio texto y pasa). */
type ErrorDeObjeto = Exclude<
  Extract<ErrorDelCierre, { codigo: string }>,
  { codigo: "EMPRESA_NO_OPERA" }
>["codigo"];

/** Los que valen el genérico; `CONTROLES_CAMBIARON` tiene el aviso propio. */
const ERRORES_DE_OBJETO_GENERICOS: Readonly<
  Record<Exclude<ErrorDeObjeto, "CONTROLES_CAMBIARON">, CodigoDeCierre>
> = {
  JORNADA_CON_IMPEDIMENTOS: GENERICO,
  APORTE_NO_DISPONIBLE: GENERICO,
  CONTROLES_QUE_BLOQUEAN: GENERICO,
  CONTROLES_SIN_RECONOCER: GENERICO,
  MEDIO_DEL_COBRO_CAMBIO: GENERICO,
};

/** El error del caso de uso tal como lo entiende `aRespuesta`: un código público del cierre o, si no es del cierre, el mismo error. */
export function traducirErrorDelCierre(error: unknown): unknown {
  if (typeof error === "string" && Object.hasOwn(ERRORES_PROPIOS, error)) {
    return { codigo: ERRORES_PROPIOS[error as ErrorPropio] };
  }
  const codigo =
    typeof error === "object" && error !== null
      ? (error as { codigo?: unknown }).codigo
      : undefined;
  if (codigo === "CONTROLES_CAMBIARON") {
    return { codigo: "CIERRE_CONTROLES_CAMBIARON" satisfies CodigoDeCierre };
  }
  if (typeof codigo === "string" && Object.hasOwn(ERRORES_DE_OBJETO_GENERICOS, codigo)) {
    return {
      codigo: ERRORES_DE_OBJETO_GENERICOS[codigo as keyof typeof ERRORES_DE_OBJETO_GENERICOS],
    };
  }
  return error;
}

/**
 * Lo que tienen en común las acciones y lecturas de la web del cierre: leer el pedido, correr el caso de uso o la consulta con el contexto del servidor y traducir el
 * resultado. Un pedido sin la forma pedida es el genérico (no hay un texto por campo en la maqueta); una excepción sale sin detalle y con referencia. Un solo lugar:
 * que cada acción del cierre no lo escriba a su manera.
 */
export async function accionDeCierre<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntradaDeCierre>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return { ok: false, error: errorDeCodigo(GENERICO) };
  return correrYTraducir(respuesta, () => correr(entrada.valor), presentar);
}

/** Lo mismo sin pedido que leer (las lecturas de la pantalla): el resultado se traduce y una excepción sale con referencia. */
export async function correrYTraducir<S, D>(
  respuesta: DependenciasDeRespuesta,
  correr: () => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  try {
    const resultado = await correr();
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDelCierre(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
