import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeCantidad,
} from "../../../primitivas/cantidad/con-signo";
import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { codigoDeLoteDesdeTexto } from "../../../primitivas/texto/codigo-de-lote";
import { fechaValida } from "../dominio/disponibilidad";
import { leerCantidad } from "../dominio/movimiento";

/** Los errores de leer los lotes de un renglón: un subconjunto de los de stock (no importa el módulo de errores: este archivo es puro). */
type ErrorDeLotes =
  | "RENGLONES_INVALIDOS"
  | "IDENTIFICADOR_INVALIDO"
  | "CANTIDAD_INVALIDA"
  | "VENCIMIENTO_REQUERIDO"
  | "RENGLON_REPETIDO";
type R<S> = Resultado<S, ErrorDeLotes>;

/**
 * Los lotes que trae un renglón de una ENTRADA manual (STK-E2a, DEC-STK-006/P-10): código, fechas y cantidad de cada lote. Lista de permitidos: solo estos cuatro campos; cualquier otro, o un tipo que no es el esperado, es un
 * pedido mal formado. Sin costo por lote: el costo es del artículo (el promedio), no del lote.
 */
export type LoteDePedido = Readonly<{
  codigo: string;
  fechaDeVencimiento?: string | null | undefined;
  fechaDeElaboracion?: string | null | undefined;
  /** Texto decimal exacto mayor que cero, en la unidad del renglón. */
  cantidad: string;
}>;

/** Un lote que ya pasó la lista de permitidos: el código es válido, las fechas existen y la cantidad es una `Cantidad` mayor que cero (en la unidad del renglón). */
export type LoteLeido = Readonly<{
  codigo: string;
  fechaDeVencimiento: string | null;
  fechaDeElaboracion: string | null;
  cantidad: Cantidad;
}>;

/** Cuántos lotes puede traer un renglón (el tope evita pedidos desmedidos; la base no lo exige). */
export const MAXIMO_DE_LOTES_POR_RENGLON = 100;

const CAMPOS = new Set(["codigo", "fechaDeVencimiento", "fechaDeElaboracion", "cantidad"]);

const fechaOpcional = (valor: unknown): R<string | null> => {
  if (valor === undefined || valor === null) return ok(null);
  return fechaValida(valor) ? ok(valor) : err("VENCIMIENTO_REQUERIDO");
};

/**
 * Los lotes de un renglón, tal como los manda la pantalla: de 1 a `MAXIMO_DE_LOTES_POR_RENGLON`, sin repetir el código, con fechas válidas (la de elaboración no pasa de la de vencimiento) y que SUMAN EXACTO la cantidad del
 * renglón (en la unidad en que la escribió la persona). Todo o nada: el primer lote que no sirve frena el pedido.
 */
export function leerLotesDelRenglon(
  valor: unknown,
  cantidadDelRenglon: Cantidad,
): R<readonly LoteLeido[]> {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAXIMO_DE_LOTES_POR_RENGLON) {
    return err("RENGLONES_INVALIDOS");
  }
  const leidos: LoteLeido[] = [];
  const vistos = new Set<string>();
  let suma = 0n;
  for (const crudo of valor as unknown[]) {
    if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) {
      return err("RENGLONES_INVALIDOS");
    }
    const lote = crudo as Record<string, unknown>;
    if (Object.keys(lote).some((campo) => !CAMPOS.has(campo))) return err("RENGLONES_INVALIDOS");
    const codigo =
      typeof lote["codigo"] === "string" ? codigoDeLoteDesdeTexto(lote["codigo"]) : null;
    if (codigo === null || !codigo.ok) return err("IDENTIFICADOR_INVALIDO");
    const cantidad = leerCantidad(lote["cantidad"]);
    if (!cantidad.ok) return cantidad;
    const vence = fechaOpcional(lote["fechaDeVencimiento"]);
    if (!vence.ok) return vence;
    const elabora = fechaOpcional(lote["fechaDeElaboracion"]);
    if (!elabora.ok) return elabora;
    if (vence.valor !== null && elabora.valor !== null && elabora.valor > vence.valor) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    if (vistos.has(codigo.valor)) return err("RENGLON_REPETIDO");
    vistos.add(codigo.valor);
    suma += cantidad.valor.unidades;
    leidos.push({
      codigo: codigo.valor,
      fechaDeVencimiento: vence.valor,
      fechaDeElaboracion: elabora.valor,
      cantidad: cantidad.valor,
    });
  }
  return suma === cantidadDelRenglon.unidades ? ok(leidos) : err("RENGLONES_INVALIDOS");
}

/**
 * Los lotes de un renglón como los entra a la huella: UN texto (JSON) con cada lote `[código, vencimiento, elaboración, cantidad]`, ordenados por ese mismo orden, así el mismo conjunto en otro orden es el mismo pedido y cualquier
 * código, fecha o cantidad distinto es otro. El código va tal cual (la identidad del lote distingue mayúsculas); la cantidad, como texto decimal fijo. Lo usa `renglonesDeHuella` SOLO si el renglón trae lotes.
 */
export function lotesParaLaHuella(lotes: readonly LoteLeido[]): string {
  const filas = lotes.map((l) => [
    l.codigo,
    l.fechaDeVencimiento,
    l.fechaDeElaboracion,
    cantidadConSignoATexto(cantidadConSignoDesdeCantidad(l.cantidad)),
  ]);
  const clave = (fila: readonly (string | null)[]): string =>
    JSON.stringify(fila.map((campo) => campo ?? ""));
  return JSON.stringify(
    filas.sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0)),
  );
}

/** Un lote de una entrada manual en la unidad de stock del artículo: lo que `asignarLotesDelLibro` busca o crea (cantidad en texto decimal fijo). */
export type LoteResuelto = Readonly<{
  codigo: string;
  fechaDeVencimiento: string | null;
  fechaDeElaboracion: string | null;
  cantidad: string;
}>;
