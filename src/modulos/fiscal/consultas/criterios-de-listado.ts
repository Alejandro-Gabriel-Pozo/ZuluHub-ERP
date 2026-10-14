import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ClaveDeListado, FiltroDeListado } from "../persistencia/lecturas-de-comprobantes";

/**
 * Los criterios del listado de comprobantes (spec H7 facturación §B.4.9) llevados de lo que manda la pantalla a
 * lo que lee la base: valida, pone los valores por defecto y arma la clave de la página siguiente. Función
 * pura (sin reloj, sin azar ni base), para que ningún mutante sobreviva a sus pruebas.
 *
 * Previene: un listado sin tope (el límite es lo que protege a la base de una pantalla que pide todo), una
 * clave de página manipulada que llegue a la base y la haga fallar con un error ajeno al negocio, y un
 * rango de fechas dado vuelta que devuelva una lista vacía sin decir por qué.
 */

export const LIMITE_POR_DEFECTO = 20;
/** El tope del spec: 50 comprobantes por página. */
export const LIMITE_MAXIMO = 50;
/** Largo máximo del texto de búsqueda (ASUMIDO): el nombre de un receptor y un CUIT con guiones entran de sobra. */
export const LARGO_MAXIMO_DEL_TEXTO = 80;

export type PedidoDeListado = Readonly<{
  /** Sin estado: todos menos los `DESCARTADO`. Con `DESCARTADO`: solo esos. */
  estado?: NonNullable<FiltroDeListado["estado"]>;
  tipo?: NonNullable<FiltroDeListado["tipo"]>;
  ambiente?: NonNullable<FiltroDeListado["ambiente"]>;
  desde?: FechaCivil;
  hasta?: FechaCivil;
  /** Busca por nombre o documento del receptor. */
  texto?: string;
  limite?: number;
  /** La clave que devolvió la página anterior (`siguiente`). */
  despuesDe?: string;
}>;

export type ErrorDeCriterios =
  "LIMITE_INVALIDO" | "TEXTO_DEMASIADO_LARGO" | "FECHAS_INVERTIDAS" | "CLAVE_DE_PAGINA_INVALIDA";

/**
 * `creado_en` en UTC con seis decimales y el `id` (un uuid en minúsculas), separados por `|`. La clave es opaca
 * para quien la recibe: solo se manda de vuelta tal cual.
 */
const CLAVE =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function claveDePagina(fila: ClaveDeListado): string {
  return `${fila.creadoEn}|${fila.id}`;
}

/** La clave de una página, o `null` si no es una que haya dado `claveDePagina` (nunca llega a la base). */
export function leerClaveDePagina(texto: string): ClaveDeListado | null {
  if (!CLAVE.test(texto)) return null;
  // El día tiene que existir en el calendario: la base rechaza un `2026-02-30` con un error propio.
  if (!fechaCivilDesdeTexto(texto.slice(0, 10)).ok) return null;
  const separador = texto.indexOf("|");
  return {
    creadoEn: texto.slice(0, separador),
    id: texto.slice(separador + 1) as ClaveDeListado["id"],
  };
}

/** El texto de búsqueda: su nombre y, si puede ser un número de documento, el prefijo de solo dígitos. */
function textoDeBusqueda(
  texto: string | undefined,
): Resultado<FiltroDeListado["texto"], "TEXTO_DEMASIADO_LARGO"> {
  const limpio = (texto ?? "").trim();
  if (limpio === "") return ok(null);
  if (limpio.length > LARGO_MAXIMO_DEL_TEXTO) return err("TEXTO_DEMASIADO_LARGO");
  // Un CUIT se escribe `30-70853393-5` y un DNI `12.345.678`: sin los separadores, solo dígitos.
  const digitos = limpio.replace(/[\s.-]/g, "");
  return ok({ nombre: limpio, documento: /^[0-9]+$/.test(digitos) ? digitos : null });
}

export function criteriosDeListado(
  pedido: PedidoDeListado,
): Resultado<FiltroDeListado, ErrorDeCriterios> {
  const limite = pedido.limite ?? LIMITE_POR_DEFECTO;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
    return err("LIMITE_INVALIDO");
  }
  const desde = pedido.desde ?? null;
  const hasta = pedido.hasta ?? null;
  // Las fechas son `YYYY-MM-DD`: el orden del texto es el del calendario.
  // Stryker disable next-line ConditionalExpression,LogicalOperator: comparar con `null` usando `>` da siempre `false`, así que las dos guardas de `null` solo satisfacen el tipo y quitarlas no cambia ningún resultado
  if (desde !== null && hasta !== null && desde > hasta) return err("FECHAS_INVERTIDAS");
  const texto = textoDeBusqueda(pedido.texto);
  if (!texto.ok) return texto;
  let despuesDe: ClaveDeListado | null = null;
  if (pedido.despuesDe !== undefined) {
    despuesDe = leerClaveDePagina(pedido.despuesDe);
    if (despuesDe === null) return err("CLAVE_DE_PAGINA_INVALIDA");
  }
  return ok({
    estado: pedido.estado ?? null,
    tipo: pedido.tipo ?? null,
    ambiente: pedido.ambiente ?? null,
    desde,
    hasta,
    texto: texto.valor,
    despuesDe,
    limite,
  });
}
