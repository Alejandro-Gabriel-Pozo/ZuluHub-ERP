import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";

/**
 * LA BARRA «VER CUENTA» NO TAPA EL MENÚ, en la app REAL y en un celular (390 px): en «Venta rápida» la barra fija de la venta se apoya ENCIMA de la
 * barra inferior del menú (antes la tapaba y la persona no podía salir de la pantalla). Se mide la caja de cada una y se sale por el menú.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de Venta rápida en el celular", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let pagina: Page;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "caja", "ventas"],
      activarModulosEnDesarrollo: true,
    });
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    const contexto = await navegador.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 780 },
    });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("«Ver cuenta» queda encima del menú inferior y el menú sigue tocable para salir", async () => {
    await pagina.goto(`${mundo.url}/ventas/venta-rapida`);
    const verCuenta = pagina.getByRole("button", { name: /Ver cuenta/ });
    await verCuenta.waitFor();
    const menu = pagina.getByRole("navigation", { name: "Navegación principal" });
    await menu.waitFor();
    const barra = await verCuenta.boundingBox();
    const inferior = await menu.boundingBox();
    expect(barra).not.toBeNull();
    expect(inferior).not.toBeNull();
    if (barra === null || inferior === null) return;
    // La barra de la venta termina donde empieza el menú: no se pisan.
    const hueco = inferior.y - (barra.y + barra.height);
    expect(hueco).toBeGreaterThanOrEqual(0);
    // ...y sin un hueco notorio: el botón queda a su relleno (12 px) del menú, no más (el alto del token coincide con el real).
    expect(hueco).toBeLessThanOrEqual(16);
    // Y el menú se puede tocar (no hay nada encima): «Inicio» lleva a la raíz.
    await menu.getByRole("link", { name: "Inicio", exact: true }).click({ timeout: 10_000 });
    await pagina.waitForURL(`${mundo.url}/`);
  });
});
