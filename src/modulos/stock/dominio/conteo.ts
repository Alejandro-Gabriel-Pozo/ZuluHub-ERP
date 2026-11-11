import {
  cantidadConSignoDesdeCantidad,
  restarConSigno,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * El conteo físico (E5 §3.2 `aplicarConteo`, D125, S-11). Al aplicarlo, cada artículo contado deja un renglón por la DIFERENCIA
 * `contada − existencia_al_registrar`: lo que se vendió DESPUÉS de registrar queda intacto y lo no contado no cambia. El conteo no
 * «congela» el depósito: lo vendido entre contar y cargar se pierde en la diferencia (residual declarado, S-11). Puro.
 */
export type ErrorDeConteo = "FUERA_DE_RANGO" | "CONTEO_SIN_REGISTROS";

/** `contada − existencia_al_registrar`: positiva si contó de más, negativa si contó de menos. */
export function diferenciaDeConteo(
  contada: Cantidad,
  existenciaAlRegistrar: CantidadConSigno,
): Resultado<CantidadConSigno, "FUERA_DE_RANGO"> {
  const diferencia = restarConSigno(cantidadConSignoDesdeCantidad(contada), existenciaAlRegistrar);
  return diferencia.ok ? ok(diferencia.valor) : err("FUERA_DE_RANGO");
}

/**
 * Un registro del conteo (`conteo_registro`, solo inserción). `orden` es el identity de la base: de varios registros del mismo artículo
 * vale el de mayor `orden` (recontar = registro nuevo).
 */
export type RegistroDeConteo = Readonly<{
  articuloId: string;
  orden: number;
  cantidadContada: Cantidad;
  existenciaAlRegistrar: CantidadConSigno;
}>;

export type RenglonDeConteo = Readonly<{ articuloId: string; diferencia: CantidadConSigno }>;

/**
 * Los renglones del ajuste por conteo: el último registro de cada artículo, solo los que difieren (`≠ 0`), ordenados por artículo.
 * Sin registros no se aplica (`CONTEO_SIN_REGISTROS`, D132); con registros y sin diferencias devuelve la lista vacía (el caso de uso
 * resuelve el conteo sin escribir un ajuste: `movimientoId: null`).
 */
export function renglonesDeConteo(
  registros: readonly RegistroDeConteo[],
): Resultado<readonly RenglonDeConteo[], ErrorDeConteo> {
  if (registros.length === 0) return err("CONTEO_SIN_REGISTROS");
  const vigentes = new Map<string, RegistroDeConteo>();
  for (const registro of registros) {
    const actual = vigentes.get(registro.articuloId);
    if (actual === undefined || registro.orden > actual.orden) {
      vigentes.set(registro.articuloId, registro);
    }
  }
  const renglones: RenglonDeConteo[] = [];
  for (const articuloId of [...vigentes.keys()].sort()) {
    const registro = vigentes.get(articuloId) as RegistroDeConteo;
    const diferencia = diferenciaDeConteo(registro.cantidadContada, registro.existenciaAlRegistrar);
    if (!diferencia.ok) return err(diferencia.error);
    if (diferencia.valor.unidades !== 0n)
      renglones.push({ articuloId, diferencia: diferencia.valor });
  }
  return ok(renglones);
}
