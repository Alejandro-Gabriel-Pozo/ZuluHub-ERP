import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { esTextoDeIdentificador } from "../../../primitivas/identificadores/marca";
import {
  VALORES_DEL_FILTRO,
  type ClaveDeListado,
  type FiltroDeListado,
} from "../persistencia/lecturas-de-comprobantes";

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

/** Largo máximo del identificador de origen: el del CHECK `comprobante_origen_id_ck` de la base (en caracteres). */
export const LARGO_MAXIMO_DEL_ORIGEN_ID = 100;

export type PedidoDeListado = Readonly<{
  /** Sin estado: todos menos los `DESCARTADO`. Con `DESCARTADO`: solo esos. */
  estado?: NonNullable<FiltroDeListado["estado"]>;
  tipo?: NonNullable<FiltroDeListado["tipo"]>;
  ambiente?: NonNullable<FiltroDeListado["ambiente"]>;
  desde?: FechaCivil;
  hasta?: FechaCivil;
  /** Busca por nombre o documento del receptor. */
  texto?: string;
  /** La letra del tipo de comprobante: `A`, `B` o `C` (en mayúscula). Con `tipo`, deben coincidir. */
  letra?: NonNullable<FiltroDeListado["letra"]>;
  /**
   * El NÚMERO del punto de venta que imprime el comprobante (el de `PPPPP-NNNNNNNN`, entero de 1 a 99999), no su
   * id: es lo que la lista muestra. Es único por emisor: si la empresa tiene dos emisores con el mismo número,
   * salen los de los dos.
   */
  puntoDeVenta?: number;
  /** De dónde nace el comprobante (la lista cerrada `TIPOS_DE_ORIGEN`). */
  origenTipo?: NonNullable<FiltroDeListado["origenTipo"]>;
  /** El identificador exacto del origen. Solo tiene sentido dentro de un `origenTipo`: sin él, es un error. */
  origenId?: string;
  limite?: number;
  /** La clave que devolvió la página anterior (`siguiente`). */
  despuesDe?: string;
}>;

export type ErrorDeCriterios =
  | "LIMITE_INVALIDO"
  | "TEXTO_DEMASIADO_LARGO"
  | "FECHAS_INVERTIDAS"
  | "LETRA_INVALIDA"
  | "PUNTO_DE_VENTA_INVALIDO"
  | "ORIGEN_TIPO_INVALIDO"
  | "ORIGEN_ID_INVALIDO"
  | "ORIGEN_ID_SIN_TIPO"
  | "CLAVE_DE_PAGINA_INVALIDA";

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

/**
 * `undefined` es «sin criterio» (`null` en el filtro); cualquier otro valor tiene que ser uno de la lista: el
 * pedido llega de una pantalla y un valor ajeno no se calla como «no hay resultados».
 */
function deLaLista<T extends string>(
  valor: T | undefined,
  esDeLaLista: (texto: string) => boolean,
  error: ErrorDeCriterios,
): Resultado<T | null, ErrorDeCriterios> {
  if (valor === undefined) return ok(null);
  return esDeLaLista(valor) ? ok(valor) : err(error);
}

function puntoDeVentaDelPedido(
  numero: number | undefined,
): Resultado<number | null, "PUNTO_DE_VENTA_INVALIDO"> {
  if (numero === undefined) return ok(null);
  const { minimo, maximo } = VALORES_DEL_FILTRO.numeroDePuntoDeVenta;
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    return err("PUNTO_DE_VENTA_INVALIDO");
  }
  return ok(numero);
}

/** El identificador de origen: como lo guarda la base (sin blancos en los extremos, de 1 a 100 caracteres). */
function origenIdDelPedido(
  origenId: string | undefined,
  origenTipo: FiltroDeListado["origenTipo"],
): Resultado<string | null, "ORIGEN_ID_INVALIDO" | "ORIGEN_ID_SIN_TIPO"> {
  if (origenId === undefined) return ok(null);
  // Un id de origen se lee dentro de su tipo: el mismo id con otro tipo es otro origen.
  if (origenTipo === null) return err("ORIGEN_ID_SIN_TIPO");
  // `Array.from`: la base cuenta caracteres, no unidades UTF-16.
  if (
    typeof origenId !== "string" ||
    !esTextoDeIdentificador(origenId) ||
    Array.from(origenId).length > LARGO_MAXIMO_DEL_ORIGEN_ID
  ) {
    return err("ORIGEN_ID_INVALIDO");
  }
  return ok(origenId);
}

/** Lo que sale del pedido de la pantalla: el filtro sin la sucursal, que no la manda el navegador sino que la resuelve el servidor. */
export type CriteriosDeListado = Omit<FiltroDeListado, "sucursalId">;

export function criteriosDeListado(
  pedido: PedidoDeListado,
): Resultado<CriteriosDeListado, ErrorDeCriterios> {
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
  const letra = deLaLista(
    pedido.letra,
    (t) => (VALORES_DEL_FILTRO.letras as readonly string[]).includes(t),
    "LETRA_INVALIDA",
  );
  if (!letra.ok) return letra;
  const puntoDeVenta = puntoDeVentaDelPedido(pedido.puntoDeVenta);
  if (!puntoDeVenta.ok) return puntoDeVenta;
  const origenTipo = deLaLista(
    pedido.origenTipo,
    (t) => (VALORES_DEL_FILTRO.tiposDeOrigen as readonly string[]).includes(t),
    "ORIGEN_TIPO_INVALIDO",
  );
  if (!origenTipo.ok) return origenTipo;
  const origenId = origenIdDelPedido(pedido.origenId, origenTipo.valor);
  if (!origenId.ok) return origenId;
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
    letra: letra.valor,
    puntoDeVentaNumero: puntoDeVenta.valor,
    origenTipo: origenTipo.valor,
    origenId: origenId.valor,
    despuesDe,
    limite,
  });
}
