import { createHash } from "node:crypto";

/**
 * El detalle de un control del cierre del día (E4 §3.15): lo que ventas encontró y cuenta, con la huella que `cierre` compara. Puro y
 * determinista (la misma jornada da la misma huella): el detalle se ordena por número de ticket y luego por id, y la huella es el sha256 de
 * ese orden. Hasta `MAXIMO_DE_REFERENCIAS` referencias van para que la pantalla navegue al detalle. Sin reloj ni azar.
 */
export type FilaDelDetalle = Readonly<{
  /** El número del ticket, o `null` si la fila no es de un ticket (una cuenta abierta o una línea anulada). */
  numero: number | null;
  id: string;
  /** Un valor más que cambie el detalle (un importe, un estado): entra en la huella. */
  datos?: string;
}>;

/**
 * Los números nulos van después de los de ticket; ante un mismo número, por id. Se ordena la llave `grupo + número con ceros + NUL + id`
 * con el orden por defecto de los textos (unidades de código, sin depender del idioma del servidor): sin comparador propio.
 */
export function ordenarDetalle(filas: readonly FilaDelDetalle[]): FilaDelDetalle[] {
  const llave = (f: FilaDelDetalle): string =>
    `${f.numero === null ? "1" : "0"}${String(f.numero ?? 0).padStart(10, "0")}\u0000${f.id}`;
  const porLlave = new Map<string, FilaDelDetalle[]>();
  for (const fila of filas) porLlave.set(llave(fila), [...(porLlave.get(llave(fila)) ?? []), fila]);
  return [...porLlave.keys()].sort().flatMap((k) => porLlave.get(k) as FilaDelDetalle[]);
}

export function huellaDelDetalle(filas: readonly FilaDelDetalle[]): string {
  const orden = ordenarDetalle(filas).map((f) => [f.numero, f.id, f.datos ?? ""]);
  return createHash("sha256").update(JSON.stringify(orden)).digest("hex");
}

export function referenciasDelDetalle<T extends string>(
  tipo: T,
  filas: readonly FilaDelDetalle[],
  maximo: number,
): string[] {
  return ordenarDetalle(filas)
    .slice(0, maximo)
    .map((f) => `${tipo}:${f.id}`);
}
