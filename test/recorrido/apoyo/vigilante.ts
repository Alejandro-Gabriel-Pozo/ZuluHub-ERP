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

/**
 * Espera el ESTADO FINAL de la pantalla antes de auditarla: la red quieta (la recarga que sigue a una acción ya volvió), el DOM sin cambios durante una ventana más larga que cualquier transición, y ninguna
 * TRANSICIÓN corriendo. Un botón que cambia de «apagado» a «activo» después de una acción (p. ej. «Cobrar» al terminar de enviar a cocina) arranca su `transition: background-color` DESPUÉS de que un chequeo
 * puntual de transiciones ya dio vacío: axe medía el contraste a mitad de camino (fondo gris claro sobre texto blanco: 1,59) y fallaba en forma intermitente; el estado final cumple. No se excluye ninguna regla.
 * Cada espera tiene tope para no colgarse; las animaciones que no son transiciones (un indicador de carga infinito) no se esperan.
 */
async function esperarElEstadoFinal(pagina: Page): Promise<void> {
  await pagina.waitForLoadState("networkidle");
  await pagina.evaluate(`(async () => {
    const VENTANA_QUIETA = 300;
    const limite = Date.now() + 5000;
    let ultimoCambio = Date.now();
    const observador = new MutationObserver(() => { ultimoCambio = Date.now(); });
    observador.observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
    try {
      for (;;) {
        const corriendo = document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === "running");
        if (corriendo.length > 0) ultimoCambio = Date.now();
        if (Date.now() > limite) return;
        if (corriendo.length === 0 && Date.now() - ultimoCambio >= VENTANA_QUIETA) return;
        await Promise.race([
          Promise.allSettled(corriendo.map((a) => a.finished)),
          new Promise((r) => setTimeout(r, 50)),
        ]);
      }
    } finally {
      observador.disconnect();
    }
  })()`);
}

/** axe sobre la pantalla actual: devuelve las violaciones graves o críticas (las leves no frenan el recorrido). */
export async function violacionesGravesDeAxe(pagina: Page): Promise<string[]> {
  // El botón que se acaba de tocar sigue con el mouse encima y su color está en transición: se saca el mouse (el hover también transiciona) y se espera el estado final.
  await pagina.mouse.move(0, 0);
  await esperarElEstadoFinal(pagina);
  const resultado = await new AxeBuilder({ page: pagina }).analyze();
  return resultado.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} elemento(s), p. ej. ${v.nodes[0]?.target.join(" ")}`,
    );
}
