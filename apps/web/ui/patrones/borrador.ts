import { campoConPosibleSecreto } from "../../../../src/puertos/sin-secretos";

/**
 * Lo tipeado que se conserva si la sesión vence ([01] §6.4: «Perder el carrito en silencio» está
 * prohibido). Vive en `sessionStorage`: es de ESTA pestaña, no sobrevive al cerrarla y no viaja a ningún
 * lado. Nunca se guardan claves ni tokens: los campos cuyo nombre parece de un secreto se descartan acá,
 * con la misma regla que ya usa la cola de trabajos y la auditoría (`sin-secretos`).
 * `sessionStorage` puede faltar o fallar (ventana privada, sitio bloqueado): entonces no se guarda y listo.
 */

const PREFIJO = "pd:borrador:";

export type Borrador = Readonly<Record<string, string>>;

/** Los campos que se pueden guardar: los que no parecen un secreto por su nombre. */
export function camposGuardables(campos: Borrador): Borrador {
  return Object.fromEntries(
    Object.entries(campos).filter(([nombre]) => campoConPosibleSecreto({ [nombre]: "" }) === null),
  );
}

export function guardarBorrador(nombre: string, campos: Borrador): void {
  try {
    sessionStorage.setItem(PREFIJO + nombre, JSON.stringify(camposGuardables(campos)));
  } catch {
    // Sin almacenamiento disponible: se pierde el borrador, no la sesión.
  }
}

export function leerBorrador(nombre: string): Borrador | null {
  try {
    const crudo = sessionStorage.getItem(PREFIJO + nombre);
    if (crudo === null) return null;
    const dato: unknown = JSON.parse(crudo);
    if (typeof dato !== "object" || dato === null || Array.isArray(dato)) return null;
    const entradas = Object.entries(dato);
    return entradas.every(([, valor]) => typeof valor === "string")
      ? camposGuardables(Object.fromEntries(entradas))
      : null;
  } catch {
    return null;
  }
}

export function descartarBorrador(nombre: string): void {
  try {
    sessionStorage.removeItem(PREFIJO + nombre);
  } catch {
    // Ídem.
  }
}
