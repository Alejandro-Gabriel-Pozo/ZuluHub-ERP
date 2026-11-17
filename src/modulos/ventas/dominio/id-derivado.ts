import { createHash } from "node:crypto";

/**
 * Un uuid DETERMINÍSTICO derivado de unas partes de texto (sha256, con los bits de versión y variante de un uuid): lo que identifica algo que nace
 * dentro de un caso de uso, que no puede usar azar (el caso se repite entero ante un conflicto de serialización). Ejemplo: la cobranza de una
 * clave de idempotencia. Las partes no se confunden entre sí (se codifican como lista). Puro: sin reloj ni azar.
 */
export function idDerivado(proposito: string, ...partes: readonly string[]): string {
  const h = createHash("sha256")
    .update(JSON.stringify([proposito, ...partes]))
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b.writeUInt8((b.readUInt8(6) & 0x0f) | 0x50, 6);
  b.writeUInt8((b.readUInt8(8) & 0x3f) | 0x80, 8);
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
