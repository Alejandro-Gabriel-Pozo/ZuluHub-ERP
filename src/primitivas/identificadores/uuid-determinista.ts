import { createHash } from "node:crypto";

/**
 * Un uuid DETERMINÍSTICO (versión 5 de RFC 4122: SHA-1 de un espacio de nombres y un nombre). Lo usa quien tiene que poder volver a calcular el
 * identificador de algo sin haberlo guardado (por ejemplo, el origen de cada intento de una factura: mismo documento e intento = mismo origen,
 * distinto intento = otro). Previene que un identificador al azar se pierda con un corte y obligue a emitir otra vez lo que ya estaba emitido.
 * Chequeo: `uuid-determinista.test.ts` (vectores de RFC 4122 y propiedades de unicidad).
 */

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `espacio` es un uuid en minúscula; `nombre`, cualquier texto. */
export function uuidV5(espacio: string, nombre: string): string {
  if (!FORMA_DE_UUID.test(espacio)) {
    throw new RangeError("el espacio de nombres tiene que ser un uuid en minúscula");
  }
  const hash = createHash("sha1")
    .update(Buffer.from(espacio.replaceAll("-", ""), "hex"))
    .update(nombre, "utf8")
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6); // versión 5
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8); // variante RFC 4122
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * El uuid de una LISTA de partes (`["ticket-1", "2"]`): las partes se codifican sin ambigüedad (`["a", "bc"]` y `["ab", "c"]` dan distinto), así
 * que dos listas distintas nunca comparten el nombre que se hashea.
 */
export function uuidV5DeLista(espacio: string, partes: readonly string[]): string {
  return uuidV5(espacio, JSON.stringify(partes));
}
