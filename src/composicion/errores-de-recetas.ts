import type { CodigoDeReceta } from "../capacidades/experiencia/respuesta-de-recetas";
import type { ErrorDeStock } from "../modulos/stock/publico";

/**
 * De un error de guardar una receta (`guardarComposicion`) al código público que sale a la pantalla (ADR-016; B9 de `recetas-pantalla.md` §6 y §8). Una sola respuesta: el genérico
 * «Esta acción no está permitida» para TODO lo que el dominio de la receta rechaza (versión vieja, merma inválida, insumo, producto inactivo, ciclo, rinde, repetidos, perilla apagada…):
 * ninguna regla de la receta tiene texto propio (interfaz sobria, dueño, 30/10/2026) y la pantalla recarga la ficha. Es una lista de PERMITIDOS y exhaustiva por tipo: cada error con
 * nombre de la tabla tiene que existir en `ErrorDeStock` (un nombre que se borra del módulo no compila). Lo que no está en la tabla pasa SIN CAMBIOS: los motivos del guard
 * (`SIN_PERMISO`, `MODULO_NO_ACTIVO`, `MODULO_EN_SOLO_LECTURA`…), la empresa que no opera y la base, que `aRespuesta` clasifica (un defecto sale sin detalle y con referencia).
 * Previene: que un error de la receta salga como un fallo inesperado, o que un defecto de la base se disfrace de «no permitido». Chequeo: `errores-de-recetas.test.ts`.
 */

type ErrorDelGuardado = Extract<
  ErrorDeStock,
  | "COMPOSICION_DESACTUALIZADA"
  | "PERDIDA_INVALIDA"
  | "COMPONENTE_ES_INSUMO"
  | "PRODUCTO_INACTIVO"
  | "COMPONENTE_NO_CONTROLADO"
  | "PRODUCTO_NO_LLEVA_RECETA"
  | "PRODUCTO_NO_ENCONTRADO"
  | "CICLO_EN_LA_RECETA"
  | "RECETA_DEMASIADO_ANIDADA"
  | "CANTIDAD_INVALIDA"
  | "RINDE_INVALIDO"
  | "COMPOSICION_VACIA"
  | "COMPONENTE_REPETIDO"
  | "DIMENSION_DISTINTA"
  | "CONVERSION_NO_EXACTA"
  | "IDENTIFICADOR_INVALIDO"
  | "SUCURSAL_FUERA_DE_ALCANCE"
>;

const GENERICO = "RECETA_ACCION_NO_PERMITIDA" satisfies CodigoDeReceta;

const CODIGO_DE_ERROR_DEL_GUARDADO: Readonly<Record<ErrorDelGuardado, CodigoDeReceta>> = {
  COMPOSICION_DESACTUALIZADA: GENERICO,
  PERDIDA_INVALIDA: GENERICO,
  COMPONENTE_ES_INSUMO: GENERICO,
  PRODUCTO_INACTIVO: GENERICO,
  COMPONENTE_NO_CONTROLADO: GENERICO,
  PRODUCTO_NO_LLEVA_RECETA: GENERICO,
  PRODUCTO_NO_ENCONTRADO: GENERICO,
  CICLO_EN_LA_RECETA: GENERICO,
  RECETA_DEMASIADO_ANIDADA: GENERICO,
  CANTIDAD_INVALIDA: GENERICO,
  RINDE_INVALIDO: GENERICO,
  COMPOSICION_VACIA: GENERICO,
  COMPONENTE_REPETIDO: GENERICO,
  DIMENSION_DISTINTA: GENERICO,
  CONVERSION_NO_EXACTA: GENERICO,
  IDENTIFICADOR_INVALIDO: GENERICO,
  SUCURSAL_FUERA_DE_ALCANCE: GENERICO,
};

/** Los errores con forma de objeto que son de la receta y no tienen texto propio: la perilla del plan apagada (`{ error: "FUNCION_NO_INCLUIDA", perilla }`). */
const ERRORES_DE_OBJETO_DEL_GUARDADO: ReadonlySet<string> = new Set(["FUNCION_NO_INCLUIDA"]);

/** El error de `guardarComposicion` tal como lo entiende `aRespuesta`: el código público de la receta o, si no es de la receta, el mismo error. */
export function traducirErrorDeReceta(error: unknown): unknown {
  if (typeof error === "string" && Object.hasOwn(CODIGO_DE_ERROR_DEL_GUARDADO, error)) {
    return { codigo: CODIGO_DE_ERROR_DEL_GUARDADO[error as ErrorDelGuardado] };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    ERRORES_DE_OBJETO_DEL_GUARDADO.has(String((error as { error?: unknown }).error))
  ) {
    return { codigo: GENERICO };
  }
  return error;
}
