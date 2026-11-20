import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, type Vigilante } from "./apoyo/vigilante";

/**
 * El `redirect()` de una acción, con la app REAL (`next start`) y la navegación suave del navegador (SIN recargar). Next resuelve el redirect con un pedido interno a `localhost:<puerto>`: si la
 * puerta contesta ese host desconocido en formato RSC, el navegador recibe la superficie neutra («No encontrado») en lugar de la pantalla a la que vuelve la acción. Se prueba con la sección de
 * la carta (`catalogo.seccion`, que guarda y vuelve a la lista con `redirect`). Previene: «Guardar» que deja la pantalla en «No encontrado» (caso real, mesas del salón, 17/11/2026). Una prueba que
 * recarga la página para «arreglarlo» no sirve: oculta justo lo que se mide acá.
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;

describe.skipIf(base === null)("redirección de una acción sin recargar", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, { modulos: ["facturacion", "catalogo"] });
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("guardar una sección vuelve a la lista y la muestra, sin recargar", async () => {
    await pagina.goto(`${mundo.url}/catalogo/secciones`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("link", { name: "Nueva sección" }).click();
    await pagina.waitForURL("**/catalogo/secciones/nueva");
    await pagina.getByLabel("Nombre", { exact: true }).fill("Postres");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL("**/catalogo/secciones");
    await pagina.getByText("Postres").first().waitFor({ timeout: 10_000 });
    expect(await pagina.getByText("No encontrado").count()).toBe(0);
    vigilante.tomar();
  });
});
