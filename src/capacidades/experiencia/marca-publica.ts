import type { ConfiguracionPublicaDeMarca } from "../../puertos/marcas";
import type { MarcaPublica } from "./puerta";
import { VARIABLES_DE_MARCA, esColorDeMarca } from "./tema-css";

/**
 * De la configuración pública que lee la puerta (`ConfiguracionPublicaDeHost`) a lo que la web pinta
 * (`MarcaPublica`). Es el cinturón de la frontera: aunque `modulos/marcas` ya validó el tema al guardarlo,
 * acá pasan SOLO los cuatro tokens de la lista cerrada con un valor `#rrggbb`; cualquier otra clave o valor
 * se descarta (rigen los neutros de `tokens.css`) y el tema que llega a `<style nonce>` nunca trae texto
 * libre. Un nombre vacío no es una marca que se pueda nombrar: `null` (la puerta responde la neutra).
 */
export function marcaPublicaDe(configuracion: ConfiguracionPublicaDeMarca): MarcaPublica | null {
  if (configuracion.nombre.trim() === "") return null;
  const permitidos: readonly string[] = VARIABLES_DE_MARCA;
  const tema: Record<string, string> = {};
  // `Object.entries` solo recorre las claves PROPIAS: nada heredado del prototipo llega al tema.
  for (const [token, valor] of Object.entries(configuracion.tema)) {
    if (permitidos.includes(token) && esColorDeMarca(valor)) tema[token] = valor;
  }
  return { nombre: configuracion.nombre, tema, hostDeApp: configuracion.hostCanonico };
}
