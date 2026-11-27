import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";

/**
 * LA ENTRADA «CARTA EN LÍNEA» DEL MENÚ, de punta a punta en la app REAL construida: el gerente de una empresa con la perilla `vidriera_por_qr`
 * encendida ve «Carta en línea» en Catálogo, la toca y llega a la pantalla; en una empresa sin la perilla (apagada de base) la entrada no está.
 * «Cuentas de fotos» no tiene entrada (DEC-CAT-002). Lo que oculta la entrada es solo la ayuda: la pantalla vuelve a decidir con su guard.
 */
const base = inject("baseDePruebas");

async function abrirElMenu(mundo: MundoDelRecorrido, navegador: Browser): Promise<Page> {
  const contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
  await contexto.addCookies([...mundo.cookies]);
  const pagina = await contexto.newPage();
  await pagina.goto(`${mundo.url}/ventas/venta-rapida`);
  await pagina.waitForLoadState("networkidle");
  return pagina;
}

const menu = (pagina: Page) => pagina.getByRole("navigation", { name: "Navegación principal" });

describe.skipIf(base === null)("recorrido de la entrada «Carta en línea» del menú", () => {
  let navegador: Browser;

  beforeAll(async () => {
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
  });
  afterAll(async () => {
    await navegador?.close();
  });

  it("con la perilla encendida, el gerente ve «Carta en línea» en Catálogo y llega a la pantalla", async () => {
    if (base === null) return;
    const mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      perillas: { vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true } },
      activarModulosEnDesarrollo: true,
    });
    try {
      const pagina = await abrirElMenu(mundo, navegador);
      const entrada = menu(pagina).locator('a[href="/catalogo/carta-en-linea"]');
      await entrada.waitFor({ state: "attached" });
      expect((await entrada.textContent())?.trim()).toBe("Carta en línea");
      expect(await entrada.getAttribute("href")).toBe("/catalogo/carta-en-linea");
      expect(
        await menu(pagina)
          .getByRole("link", { name: /cuentas de fotos/i })
          .count(),
      ).toBe(0);
      // Las entradas del área cuelgan de un desplegable: el clic va directo al enlace, que es lo que haría el toque.
      await entrada.dispatchEvent("click");
      await pagina.waitForURL(/\/catalogo\/carta-en-linea$/);
      await pagina.getByLabel("Nombre", { exact: true }).waitFor();
    } finally {
      await mundo.cerrar();
    }
  });

  it("sin la perilla (apagada de base) la entrada no está", async () => {
    if (base === null) return;
    const mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      activarModulosEnDesarrollo: true,
    });
    try {
      const pagina = await abrirElMenu(mundo, navegador);
      // El área Catálogo sí está (Productos); la entrada de la carta no.
      await menu(pagina).locator('a[href="/catalogo/secciones"]').waitFor({ state: "attached" });
      expect(await menu(pagina).locator('a[href="/catalogo/carta-en-linea"]').count()).toBe(0);
      expect(HOST_DEL_RECORRIDO).not.toBe("");
    } finally {
      await mundo.cerrar();
    }
  });
});
