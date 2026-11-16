import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { CodigoDeClientes } from "../capacidades/experiencia/respuesta-de-clientes";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { ErrorDeClientes } from "../modulos/clientes/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * De un error del directorio de clientes y proveedores al código público que sale a la pantalla (ADR-016). Ocho respuestas con texto propio, las que la maqueta aprobada del
 * 09/11/2026 redacta (`directorio.html`, fila «Errores»): el nombre que falta, el CUIT, el DNI y el documento de una empresa que no valen, el documento repetido (también el
 * de alguien desactivado), el email y el teléfono. TODO lo demás que el dominio rechaza sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026, interfaz sobria).
 * El guard, la empresa que no opera y la base ya traen su propio código y pasan SIN CAMBIOS. Los errores propios del módulo van en una tabla exhaustiva por tipo: un error nuevo
 * del directorio no compila hasta que se le dé su código.
 *
 * Los datos inválidos traen un error por campo; el pedido de la pantalla es de a uno: sale el PRIMERO que tiene texto propio (con su campo, para marcarlo) o, si ninguno lo tiene, el
 * genérico. Al corregirlo, el siguiente aparece. El id de la parte que ya tiene el documento no sale.
 * Previene: que un error del directorio salga como un fallo inesperado, o que se invente un texto por cada regla del dominio. Chequeo: `errores-de-clientes.test.ts`.
 */

type ErrorPropio = Exclude<Extract<ErrorDeClientes, string>, MotivoDeRechazo>;

// Stryker disable next-line ObjectLiteral: la tabla existe para la exhaustividad por TIPO (compila o no); en ejecución todo lo que no está acá también es el genérico, así que vaciarla no cambia el resultado.
const CODIGO_DE_ERROR_PROPIO: Readonly<Record<ErrorPropio, CodigoDeClientes>> = {
  SUCURSAL_FUERA_DE_ALCANCE: "CLIENTES_ACCION_NO_PERMITIDA",
  IDENTIFICADOR_INVALIDO: "CLIENTES_ACCION_NO_PERMITIDA",
  CLAVE_REUTILIZADA: "CLIENTES_ACCION_NO_PERMITIDA",
  PARTE_NO_ENCONTRADA: "CLIENTES_ACCION_NO_PERMITIDA",
  VERSION_DESACTUALIZADA: "CLIENTES_ACCION_NO_PERMITIDA",
  ROL_DE_PARTE_INVALIDO: "CLIENTES_ACCION_NO_PERMITIDA",
  TIPO_DE_VINCULO_INVALIDO: "CLIENTES_ACCION_NO_PERMITIDA",
  VINCULO_CONSIGO_MISMA: "CLIENTES_ACCION_NO_PERMITIDA",
  CONTACTO_DEBE_SER_HUMANA: "CLIENTES_ACCION_NO_PERMITIDA",
  VINCULO_DEBE_SER_CON_EMPRESA: "CLIENTES_ACCION_NO_PERMITIDA",
  CARGO_INVALIDO: "CLIENTES_ACCION_NO_PERMITIDA",
  PARTE_CON_VINCULOS: "CLIENTES_ACCION_NO_PERMITIDA",
  CURSOR_INVALIDO: "CLIENTES_ACCION_NO_PERMITIDA",
};

/** El campo del formulario al que se asocia el error de un documento (el número); el nombre, el email y el teléfono se llaman como su campo. */
const CAMPO_DEL_DOCUMENTO = "documentoNumero";

type ConTexto = Readonly<{ codigo: CodigoDeClientes; campo: string }>;

/** Los errores de un campo con texto propio, por el código que da el dominio (`validarDatosDeParte`); cualquier otro es el genérico. */
const DATO_CON_TEXTO_PROPIO: Readonly<Record<string, ConTexto>> = {
  NOMBRE_REQUERIDO: { codigo: "CLIENTES_FALTA_EL_NOMBRE", campo: "nombre" },
  CUIT_INVALIDO: { codigo: "CLIENTES_CUIT_INVALIDO", campo: CAMPO_DEL_DOCUMENTO },
  DNI_INVALIDO: { codigo: "CLIENTES_DNI_INVALIDO", campo: CAMPO_DEL_DOCUMENTO },
  DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA: {
    codigo: "CLIENTES_EMPRESA_SOLO_CUIT",
    campo: CAMPO_DEL_DOCUMENTO,
  },
  EMAIL_INVALIDO: { codigo: "CLIENTES_EMAIL_INVALIDO", campo: "email" },
  TELEFONO_INVALIDO: { codigo: "CLIENTES_TELEFONO_INVALIDO", campo: "telefono" },
};

const GENERICO = { codigo: "CLIENTES_ACCION_NO_PERMITIDA" satisfies CodigoDeClientes } as const;

/** De la lista de errores por campo, el primero con texto propio; si ninguno lo tiene, el genérico. Una forma que no es la esperada también es el genérico. */
function deLosDatosInvalidos(campos: unknown): unknown {
  if (!Array.isArray(campos)) return GENERICO;
  for (const c of campos as readonly unknown[]) {
    // Stryker disable next-line ConditionalExpression: equivalente, un valor que no es objeto no tiene `codigo` y cae igual en el genérico.
    const codigo = typeof c === "object" && c !== null ? (c as { codigo?: unknown }).codigo : null;
    // Stryker disable next-line ConditionalExpression: equivalente, `hasOwn` de algo que no es texto es falso.
    if (typeof codigo === "string" && Object.hasOwn(DATO_CON_TEXTO_PROPIO, codigo)) {
      return DATO_CON_TEXTO_PROPIO[codigo];
    }
  }
  return GENERICO;
}

/** El error del caso de uso o de la consulta tal como lo entiende `aRespuesta`: un código público del directorio o, si no es suyo, el mismo error. */
export function traducirErrorDeClientes(error: unknown): unknown {
  if (typeof error === "string") {
    // Stryker disable next-line ConditionalExpression,BlockStatement: equivalente, ver la tabla: lo que no está en ella sale igual como el genérico.
    if (Object.hasOwn(CODIGO_DE_ERROR_PROPIO, error)) {
      return { codigo: CODIGO_DE_ERROR_PROPIO[error as ErrorPropio] };
    }
    // Un código público ya conocido (los motivos del guard, la sesión) pasa; cualquier otro texto de negocio es el genérico.
    return Object.hasOwn(CODIGOS_PUBLICOS, error) ? error : GENERICO;
  }
  if (typeof error === "object" && error !== null) {
    const { error: nombre, campos } = error as { error?: unknown; campos?: unknown };
    if (nombre === "DOCUMENTO_YA_REGISTRADO") {
      return { codigo: "CLIENTES_DOCUMENTO_REPETIDO", campo: CAMPO_DEL_DOCUMENTO };
    }
    if (nombre === "PARTE_INACTIVA_CON_ESE_DOCUMENTO") {
      return { codigo: "CLIENTES_DOCUMENTO_DE_DESACTIVADA", campo: CAMPO_DEL_DOCUMENTO };
    }
    if (nombre === "DATOS_INVALIDOS") return deLosDatosInvalidos(campos);
    if (typeof nombre === "string") return GENERICO;
  }
  return error;
}

/**
 * Lo que tienen en común las acciones de la web del directorio: leer el pedido, correr el caso de uso o la consulta con el contexto del servidor y traducir el resultado. Un pedido sin la
 * forma pedida es el genérico; una excepción sale sin detalle y con referencia. Un solo lugar: que cada acción del directorio no lo escriba a su manera.
 */
export async function accionDeClientes<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return { ok: false, error: errorDeCodigo("CLIENTES_ACCION_NO_PERMITIDA") };
  try {
    const resultado = await correr(entrada.valor);
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDeClientes(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
