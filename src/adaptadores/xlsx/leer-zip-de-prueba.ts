import { inflateRawSync } from "node:zlib";

/**
 * Un lector mínimo de zip para LEER en las pruebas el archivo que escribe el escritor (un .xlsx es un zip): recorre el directorio central y devuelve cada entrada como texto. Solo para
 * pruebas: evita declarar una dependencia nueva (`fflate` es transitiva de la biblioteca). Soporta entradas guardadas (0) y deflate (8), que son las que escribe la biblioteca.
 */
export function leerZipComoTextos(bytes: Uint8Array): ReadonlyMap<string, string> {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fin = b.length - 22;
  while (fin >= 0 && b.readUInt32LE(fin) !== 0x06054b50) fin -= 1;
  if (fin < 0) throw new Error("zip: no tiene directorio central");
  const entradas = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const salida = new Map<string, string>();
  for (let i = 0; i < entradas; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50)
      throw new Error("zip: entrada del directorio central dañada");
    const metodo = b.readUInt16LE(p + 10);
    const comprimido = b.readUInt32LE(p + 20);
    const largoDelNombre = b.readUInt16LE(p + 28);
    const largoDelExtra = b.readUInt16LE(p + 30);
    const largoDelComentario = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const nombre = b.toString("utf8", p + 46, p + 46 + largoDelNombre);
    const inicio = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const datos = b.subarray(inicio, inicio + comprimido);
    if (metodo !== 0 && metodo !== 8) throw new Error(`zip: método ${metodo} no soportado`);
    salida.set(nombre, (metodo === 0 ? datos : inflateRawSync(datos)).toString("utf8"));
    p += 46 + largoDelNombre + largoDelExtra + largoDelComentario;
  }
  return salida;
}
