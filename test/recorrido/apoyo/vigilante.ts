import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";

/**
 * Lo que se vigila durante TODO el recorrido, en cada pantalla, sin que cada paso tenga que acordarse: errores de consola, errores de la
 * página, respuestas 5xx, violaciones de la política de contenido (CSP), pedidos que salen del host de la app y pedidos que fallan.
 * Fallos reales de 2026-11-05 que esto atrapa: «Event handlers cannot be passed to Client Component props» (un 5xx o un error de
 * consola) y el QR bloqueado por `img-src` (una violación de CSP). Las pruebas de componentes no ven nada de esto: no aplican las
 * cabeceras de la app real.
 */
export type Vigilante = Readonly<{
  /** Entrega lo anotado desde la última vez y lo vacía: cada paso responde por lo suyo. */
  tomar(): readonly string[];
}>;

// Se instala antes de que corra cualquier script de la página: convierte el evento de seguridad en un error de consola.
const ESCUCHA_DE_CSP = `document.addEventListener("securitypolicyviolation", (e) => {
  console.error("CSP violada: " + e.violatedDirective + " bloqueó " + e.blockedURI);
});`;

export async function vigilar(pagina: Page, hostPropio: string): Promise<Vigilante> {
  const hallazgos: string[] = [];
  await pagina.addInitScript(ESCUCHA_DE_CSP);
  pagina.on("console", (m) => {
    // CONOCIDO (a informar, no se arregla acá): la app no sirve `/favicon.ico` y Chromium lo pide en cada pantalla; el 404 llega a la consola.
    // Se exime SOLO esa dirección: cualquier otro recurso que falte sí es un hallazgo.
    if (m.type() === "error" && !m.location().url.endsWith("/favicon.ico")) {
      hallazgos.push(`consola: ${m.text()} [${m.location().url}] (página ${pagina.url()})`);
    }
  });
  pagina.on("pageerror", (e) => hallazgos.push(`pageerror: ${e.message} (${pagina.url()})`));
  pagina.on("response", (r) => {
    if (r.status() >= 500) hallazgos.push(`respuesta ${r.status()}: ${r.url()}`);
  });
  pagina.on("requestfailed", (r) => {
    const motivo = r.failure()?.errorText ?? "sin motivo";
    // Un pedido que el propio navegador cancela (p. ej. una precarga que la navegación reemplaza) no es una falla de la app.
    if (motivo !== "net::ERR_ABORTED") hallazgos.push(`pedido fallido: ${r.url()} (${motivo})`);
  });
  pagina.on("request", (r) => {
    const url = new URL(r.url());
    if (url.protocol !== "data:" && url.protocol !== "blob:" && url.hostname !== hostPropio) {
      hallazgos.push(`pedido a otro host: ${r.url()}`);
    }
  });
  return {
    tomar() {
      return hallazgos.splice(0, hallazgos.length);
    },
  };
}

/** axe sobre la pantalla actual: devuelve las violaciones graves o críticas (las leves no frenan el recorrido). */
export async function violacionesGravesDeAxe(pagina: Page): Promise<string[]> {
  const resultado = await new AxeBuilder({ page: pagina }).analyze();
  return resultado.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} elemento(s), p. ej. ${v.nodes[0]?.target.join(" ")}`,
    );
}
