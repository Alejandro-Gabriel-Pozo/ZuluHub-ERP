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
import type { ErrorAlPedirPersonasParaMostrar } from "../modulos/identidad/consultas/personas-para-mostrar";
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
const ERRORES_PROPIOS: Readonly<Record<ErrorPropio, true>> = {
  JORNADA_NO_ENCONTRADA: true,
  FECHA_INVALIDA: true,
  JORNADA_CERRADA: true,
  SUCURSAL_FUERA_DE_ALCANCE: true,
  JORNADA_NO_EN_AUDITORIA: true,
  OBSERVACION_INVALIDA: true,
  RECONOCIMIENTO_INVALIDO: true,
  HORA_DE_CORTE_INVALIDA: true,
  ZONA_HORARIA_INVALIDA: true,
  INSTANTE_INVALIDO: true,
  APORTE_NO_DISPONIBLE: true,
  SUCURSAL_NO_ENCONTRADA: true,
  CONVERSION_NO_EXACTA: true,
  IDENTIFICADOR_INVALIDO: true,
  PRODUCTO_NO_ENCONTRADO: true,
  PRODUCTO_INACTIVO: true,
  PRODUCTO_NO_VENDIBLE: true,
  PRODUCTO_OCULTO: true,
  PRODUCTO_SIN_ALICUOTA: true,
  CLASIFICACION_INCONSISTENTE: true,
  SUCURSAL_INACTIVA: true,
  CANTIDAD_INVALIDA: true,
  CANTIDAD_NO_ES_MULTIPLO_DEL_PASO: true,
  OPCION_REPETIDA: true,
  VARIANTE_SIN_PRECIO: true,
  PRECIO_EN_OTRA_FORMA_DE_VENTA: true,
  PRECIO_FUERA_DE_RANGO: true,
  MEDIO_NO_ENCONTRADO: true,
  CUENTA_DE_COBRO_NO_ENCONTRADA: true,
  CLAVE_DE_IDEMPOTENCIA_INVALIDA: true,
  IMPORTE_INVALIDO: true,
  MONEDA_NO_SOPORTADA: true,
  CLAVE_REUTILIZADA: true,
  MOTIVO_INVALIDO: true,
  MEDIO_INACTIVO: true,
  CUENTA_DE_COBRO_NO_ADMITIDA: true,
  CUENTA_DE_COBRO_DE_OTRA_SUCURSAL: true,
  CUENTA_DE_COBRO_INACTIVA: true,
  CUENTA_DE_COBRO_INCOMPATIBLE: true,
  COBRO_NO_ENCONTRADO: true,
  MEDIO_DEL_COBRO_SIN_CAMBIOS: true,
  MEDIO_NO_DECLARABLE: true,
  CURSOR_INVALIDO: true,
  LIMITE_INVALIDO: true,
  ENTRADA_INVALIDA: true,
  FACTURACION_NO_DISPONIBLE: true,
  TICKET_NO_FACTURABLE: true,
  CUENTA_NO_ENCONTRADA: true,
  PRODUCTO_SIN_PRECIO: true,
  PRECIO_ABIERTO_NO_PERMITIDO: true,
  TICKET_NO_ENCONTRADO: true,
};

/** Los errores con forma de objeto y `codigo` que son del negocio (el de la empresa que no opera tiene su propio texto y pasa). */
type ErrorDeObjeto = Exclude<
  Extract<ErrorDelCierre, { codigo: string }>,
  { codigo: "EMPRESA_NO_OPERA" }
>["codigo"];

/** Los que valen el genérico; `CONTROLES_CAMBIARON` tiene el aviso propio. */
const ERRORES_DE_OBJETO_GENERICOS: Readonly<
  Record<Exclude<ErrorDeObjeto, "CONTROLES_CAMBIARON">, true>
> = {
  JORNADA_CON_IMPEDIMENTOS: true,
  APORTE_NO_DISPONIBLE: true,
  CONTROLES_QUE_BLOQUEAN: true,
  CONTROLES_SIN_RECONOCER: true,
  MEDIO_DEL_COBRO_CAMBIO: true,
};

const PROPIOS: ReadonlySet<string> = new Set(Object.keys(ERRORES_PROPIOS));
const DE_OBJETO_GENERICOS: ReadonlySet<string> = new Set(Object.keys(ERRORES_DE_OBJETO_GENERICOS));

/** El error del caso de uso tal como lo entiende `aRespuesta`: un código público del cierre o, si no es del cierre, el mismo error. */
export function traducirErrorDelCierre(error: unknown): unknown {
  if (typeof error === "string" && PROPIOS.has(error)) return { codigo: GENERICO };
  const codigo =
    typeof error === "object" && error !== null
      ? (error as { codigo?: unknown }).codigo
      : undefined;
  if (codigo === "CONTROLES_CAMBIARON") {
    return { codigo: "CIERRE_CONTROLES_CAMBIARON" satisfies CodigoDeCierre };
  }
  if (typeof codigo === "string" && DE_OBJETO_GENERICOS.has(codigo)) return { codigo: GENERICO };
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
