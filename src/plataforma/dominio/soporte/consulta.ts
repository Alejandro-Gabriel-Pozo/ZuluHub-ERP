import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
  type EstadoEfectivo,
} from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Lo puro de las consultas de soporte (H5 §B.5.9 y §B.5.7): la página de una lista, la forma de los
 * identificadores que llegan de afuera y la de la clave de idempotencia. Dominio puro: sin reloj, sin
 * azar, sin base de datos. Todo se valida DESPUÉS del guard (el caso de uso decide cuándo), y nada se
 * corrige en silencio: un valor mal formado es un error con nombre, no una consulta que la base rechaza
 * con un error inesperado.
 */

/** Cuántos renglones devuelve una lista si el pedido no dice (§B.5.7). */
export const LIMITE_POR_DEFECTO_DE_PAGINA = 50;

/** Tope de renglones por página (§B.5.7: `limite ≤ 100`). */
export const LIMITE_MAXIMO_DE_PAGINA = 100;

/** Cómo se ordena una lista: por un uuid (tenants, empresas…) o por un entero de la base (auditoría). */
export type TipoDeCursor = "UUID" | "ENTERO";

/** El pedido de una página tal como llega: ambos campos son opcionales. */
export type EntradaDePagina = Readonly<{
  limite?: number | undefined;
  /** El id del último renglón de la página anterior; vacío = desde el principio. */
  despuesDeId?: string | undefined;
}>;

/** La página ya validada: el cursor sale normalizado (uuid en minúsculas) o `null`. */
export type Pagina = Readonly<{ limite: number; despuesDeId: string | null }>;

export type ErrorDePagina = "LIMITE_INVALIDO" | "CURSOR_INVALIDO";

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Hasta 18 dígitos: cabe en un `bigint` de Postgres sin rozar el tope (9 223 372 036 854 775 807). */
const FORMA_DE_ENTERO = /^[0-9]{1,18}$/;

/** Un uuid canónico (con guiones). Devuelve el mismo identificador en minúsculas, que es como lo guarda la base. */
export function uuidDesdeTexto(texto: string): Resultado<string, "ID_INVALIDO"> {
  const normalizado = texto.toLowerCase();
  return FORMA_DE_UUID.test(normalizado) ? ok(normalizado) : err("ID_INVALIDO");
}

/**
 * Valida el pedido de una página. El límite, si viene, es un entero de 1 a `LIMITE_MAXIMO_DE_PAGINA`;
 * si no viene, `LIMITE_POR_DEFECTO_DE_PAGINA`. El cursor, si viene, tiene la forma del orden de la
 * lista. El límite se mira primero.
 */
export function paginaValida(
  entrada: EntradaDePagina,
  cursor: TipoDeCursor,
): Resultado<Pagina, ErrorDePagina> {
  const limite = entrada.limite ?? LIMITE_POR_DEFECTO_DE_PAGINA;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO_DE_PAGINA) {
    return err("LIMITE_INVALIDO");
  }
  const despues = entrada.despuesDeId;
  if (despues === undefined) return ok({ limite, despuesDeId: null });
  if (cursor === "ENTERO") {
    return FORMA_DE_ENTERO.test(despues)
      ? ok({ limite, despuesDeId: despues })
      : err("CURSOR_INVALIDO");
  }
  const id = uuidDesdeTexto(despues);
  return id.ok ? ok({ limite, despuesDeId: id.valor }) : err("CURSOR_INVALIDO");
}

/** La misma regla que `idempotencia_plataforma_clave_ck`: un test la compara con la base. */
const FORMA_DE_CLAVE = /^[A-Za-z0-9_-]{16,128}$/;

/** ¿Tiene la clave de idempotencia la forma que la tabla de plataforma acepta? */
export function claveDeIdempotenciaValida(clave: string): boolean {
  return FORMA_DE_CLAVE.test(clave);
}

/** Una página de resultados y desde dónde sigue la próxima (`null`: no hay más). */
export type ResultadoDePagina<T> = Readonly<{
  filas: readonly T[];
  siguienteDespuesDeId: string | null;
}>;

/**
 * Arma el resultado de una página. Si la lista llegó llena (`limite` renglones) puede haber más y el
 * cursor siguiente es el id del último; si llegó corta, no hay más.
 */
export function resultadoDePagina<T>(
  filas: readonly T[],
  pagina: Pagina,
  idDe: (fila: T) => string,
): ResultadoDePagina<T> {
  const ultima = filas.at(-1);
  return {
    filas,
    siguienteDespuesDeId:
      filas.length >= pagina.limite && ultima !== undefined ? idDe(ultima) : null,
  };
}

/** El tope del largo de un filtro de texto: una entidad o un id de la auditoría nunca es más largo. */
export const LARGO_MAXIMO_DE_FILTRO = 200;

/**
 * Un filtro de texto opcional: sin valor no filtra (`null`); con valor se recortan los espacios y no
 * puede quedar vacío ni pasar de `LARGO_MAXIMO_DE_FILTRO`.
 */
export function filtroDeTexto(
  texto: string | undefined,
): Resultado<string | null, "FILTRO_INVALIDO"> {
  if (texto === undefined) return ok(null);
  const recortado = texto.trim();
  return recortado === "" || recortado.length > LARGO_MAXIMO_DE_FILTRO
    ? err("FILTRO_INVALIDO")
    : ok(recortado);
}

/**
 * Un rango de fechas opcional, ambos extremos inclusivos. Una fecha inválida, o un `desde` posterior
 * al `hasta`, es `RANGO_INVALIDO`.
 */
export function rangoDeFechas(
  desde: Date | undefined,
  hasta: Date | undefined,
): Resultado<Readonly<{ desde: Date | null; hasta: Date | null }>, "RANGO_INVALIDO"> {
  const invalida = (fecha: Date | undefined) =>
    fecha !== undefined && Number.isNaN(fecha.getTime());
  if (invalida(desde) || invalida(hasta)) return err("RANGO_INVALIDO");
  if (desde !== undefined && hasta !== undefined && desde.getTime() > hasta.getTime()) {
    return err("RANGO_INVALIDO");
  }
  return ok({ desde: desde ?? null, hasta: hasta ?? null });
}

// --- Estado efectivo de una empresa como filtro ------------------------------------------------------------

/** Cada estado efectivo, en el orden en que lo informa `estadoEfectivo`. `Record` hace que sumar un estado sin listarlo no compile; el valor (`null`) no importa, solo las claves. */
const ESTADOS_EFECTIVOS_POR_CLAVE: Readonly<Record<EstadoEfectivo, null>> = {
  OPERA: null,
  EMPRESA_EN_ALTA: null,
  EMPRESA_SUSPENDIDA: null,
  EMPRESA_CANCELADA: null,
  EMPRESA_EN_BAJA: null,
  TENANT_SUSPENDIDO: null,
};

export const ESTADOS_EFECTIVOS = Object.keys(
  ESTADOS_EFECTIVOS_POR_CLAVE,
) as readonly EstadoEfectivo[];

/** ¿Es `texto` uno de los estados efectivos? (`constructor` y compañía no lo son). */
export const esEstadoEfectivo = (texto: string): texto is EstadoEfectivo =>
  Object.hasOwn(ESTADOS_EFECTIVOS_POR_CLAVE, texto);

const ESTADOS_DE_TENANT: Readonly<Record<EstadoDeTenant, null>> = { ACTIVE: null, SUSPENDED: null };
const ESTADOS_DE_EMPRESA: Readonly<Record<EstadoDeEmpresa, null>> = {
  PROVISIONING: null,
  ACTIVE: null,
  SUSPENDED: null,
  CANCELLED: null,
  DELETING: null,
};

/** Un par (estado del tenant, estado de la empresa) tal como los guarda la base. */
export type CombinacionDeEstados = Readonly<{ tenant: EstadoDeTenant; empresa: EstadoDeEmpresa }>;

/**
 * Los pares (estado del tenant, estado de la empresa) cuyo estado efectivo es `estado`. La base no guarda el
 * estado efectivo: para filtrar por él la lectura pide estos pares. Salen de ENUMERAR todos los pares con
 * `estadoEfectivo`, la misma función que calcula el estado de cada fila: el filtro y la columna no pueden
 * discrepar, y sumar un estado nuevo no obliga a tocar una segunda tabla de equivalencias.
 */
export function combinacionesDeEstadoEfectivo(
  estado: EstadoEfectivo,
): readonly CombinacionDeEstados[] {
  const pares: CombinacionDeEstados[] = [];
  for (const tenant of Object.keys(ESTADOS_DE_TENANT) as EstadoDeTenant[]) {
    for (const empresa of Object.keys(ESTADOS_DE_EMPRESA) as EstadoDeEmpresa[]) {
      if (estadoEfectivo(tenant, empresa) === estado) pares.push({ tenant, empresa });
    }
  }
  return pares;
}

// --- Búsqueda de texto -------------------------------------------------------------------------------------

/** Lo que se busca en una lista, ya validado: el texto tal cual y, aparte, su versión para comparar con un CUIT. */
export type CriterioDeBusqueda = Readonly<{
  /** El texto recortado, para razón social y nombre del tenant. */
  texto: string;
  /** El texto sin guiones, para el CUIT (que se guarda sin ellos); `null` si sin guiones no queda nada. */
  cuit: string | null;
}>;

/**
 * El texto de una búsqueda: recortado, de 1 a `LARGO_MAXIMO_DE_FILTRO` caracteres (`FILTRO_INVALIDO` si no).
 * Un CUIT se escribe con o sin guiones (`20-12345678-3`) y la base lo guarda sin ellos, así que se busca
 * también el texto sin guiones; si el texto eran solo guiones, no se busca por CUIT (un patrón vacío
 * coincidiría con todo).
 */
export function criterioDeBusqueda(
  texto: string | undefined,
): Resultado<CriterioDeBusqueda | null, "FILTRO_INVALIDO"> {
  const filtro = filtroDeTexto(texto);
  if (!filtro.ok) return filtro;
  if (filtro.valor === null) return ok(null);
  const sinGuiones = filtro.valor.replaceAll("-", "");
  return ok({ texto: filtro.valor, cuit: sinGuiones === "" ? null : sinGuiones });
}

/**
 * El patrón de `LIKE` que busca `texto` TAL CUAL en cualquier parte: `%`, `_` y la barra invertida (el
 * escape por defecto de Postgres) se escapan para que valgan por sí mismos. Sin esto, buscar «100%» o
 * «a_b» traería filas que no lo contienen, y un `%` solo traería todo.
 */
export function patronDeContiene(texto: string): string {
  return `%${texto.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
