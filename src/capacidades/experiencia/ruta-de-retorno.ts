/**
 * A dónde vuelve la persona después de ingresar (`/ingreso?volver=<ruta>`). Solo una ruta DE LA PROPIA
 * aplicación: cualquier otra cosa vuelve al inicio. Previene la redirección abierta (`//sitio-ajeno`,
 * `/\sitio-ajeno`, `https://…`), que convertiría el ingreso en un trampolín de phishing, y el bucle
 * (volver a `/ingreso`). Chequeo: `ruta-de-retorno.test.ts` y su propiedad.
 */
const RUTA_DE_INICIO = "/";
const LARGO_MAXIMO = 512;
// Caracteres de control y espacios: no hay ruta propia que los lleve.
// eslint-disable-next-line no-control-regex -- justamente se buscan los caracteres de control
const CONTROL_O_ESPACIO = /[\u0000- \u007f]/;

/** Rutas que no se usan de destino: las internas de Next, la API y el propio ingreso. */
const NO_ES_DESTINO = /^\/(s|api|ingreso)(\/|\?|#|$)/i;

export function rutaDeRetorno(candidata: string | null | undefined): string {
  if (typeof candidata !== "string" || candidata === "" || candidata.length > LARGO_MAXIMO) {
    return RUTA_DE_INICIO;
  }
  if (!candidata.startsWith("/") || candidata.startsWith("//")) return RUTA_DE_INICIO;
  if (candidata.includes("\\") || CONTROL_O_ESPACIO.test(candidata)) return RUTA_DE_INICIO;
  const ruta = candidata.split(/[?#]/, 1)[0] ?? "";
  let decodificada: string;
  try {
    decodificada = decodeURIComponent(ruta);
  } catch {
    return RUTA_DE_INICIO;
  }
  if (decodificada.includes("\\") || decodificada.startsWith("//")) return RUTA_DE_INICIO;
  if (decodificada.split("/").some((segmento) => segmento === "." || segmento === "..")) {
    return RUTA_DE_INICIO;
  }
  if (NO_ES_DESTINO.test(candidata) || NO_ES_DESTINO.test(decodificada)) return RUTA_DE_INICIO;
  return candidata;
}
