import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * La pantalla «Caja» en la app REAL construida: nace CERRADA mientras el módulo `caja` esté «en desarrollo» (nada se activa en el
 * proceso de la app: no hay interruptor de pruebas en producción). La persona que entra a `/caja` no ve la pantalla ni un error de
 * servidor: ve el aviso genérico, sin nada en la consola, sin pedidos a otros hosts y sin violaciones de accesibilidad. Previene: una
 * pantalla de cliente que rompe al compilarse (un componente de cliente sin `"use client"`, React #441) y que ninguna prueba unitaria ve.
 * Cuando Mostrador 1 pase `caja` a «disponible», este recorrido se amplía a abrir y cerrar la caja.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de caja: la pantalla nace cerrada", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("/caja con el módulo en desarrollo: no muestra la pantalla, sin errores ni violaciones", async () => {
    const respuesta = await pagina.goto(`${mundo.url}/caja`);
    await pagina.waitForLoadState("networkidle");
    expect(respuesta?.status()).toBeLessThan(500);
    expect(await pagina.getByRole("button", { name: "Abrir caja" }).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });
});
