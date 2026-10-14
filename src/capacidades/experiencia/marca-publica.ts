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
  const tema: Record<string, string> = {};
  for (const token of VARIABLES_DE_MARCA) {
    const valor = Object.hasOwn(configuracion.tema, token) ? configuracion.tema[token] : undefined;
    if (valor !== undefined && esColorDeMarca(valor)) tema[token] = valor;
  }
  return { nombre: configuracion.nombre, tema, hostDeApp: configuracion.hostCanonico };
}
