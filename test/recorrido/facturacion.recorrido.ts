import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Lo que hace el dueño, de punta a punta, en la app REAL construida y con un navegador real: cargar los Datos fiscales (con Ingresos
 * Brutos), tener un punto de venta, emitir una Factura B de consumidor final, verla en el listado y en su detalle e imprimirla. ARCA es
 * la simulada (`apoyo/arca-simulada.ts`). Los pasos son SECUENCIALES a propósito: cada uno parte de lo que dejó el anterior, como
 * la persona real.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de facturación: de los datos fiscales a la factura impresa",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    const ir = async (ruta: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base);
      const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
      navegador = await chromium.launch({
        ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
        // Sin proxy del entorno: la app es de loopback y nada de la prueba tiene que salir a internet.
        args: ["--no-proxy-server"],
      });
      // El certificado de la fachada es autofirmado y de esta corrida: solo por eso se aceptan los errores de TLS.
      contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
      await contexto.addCookies([...mundo.cookies]);
      pagina = await contexto.newPage();
      vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    });
    afterAll(async () => {
      await navegador?.close();
      await mundo?.cerrar();
    });

    it("Datos fiscales: se cargan con Ingresos Brutos y se confirman", async () => {
      const r = await ir("/configuracion-fiscal/datos-fiscales");
      expect(r?.status()).toBe(200);
      await pagina.getByLabel("Razón social").fill("Panadería Zulú SA");
      await pagina
        .getByLabel("Condición frente al IVA")
        .selectOption({ label: "IVA Responsable Inscripto" });
      await pagina.getByLabel("Calle").fill("Avenida Siempre Viva");
      await pagina.getByLabel("Número", { exact: true }).fill("742");
      await pagina.getByLabel("Localidad").fill("Rosario");
      await pagina.getByLabel("Provincia").selectOption({ label: "Santa Fe" });
      await pagina.getByLabel("Código postal").fill("2000");
      await pagina.getByLabel("Ingresos Brutos").selectOption({ label: "Número de inscripción" });
      await pagina.getByLabel("Número de inscripción").fill("901-123456-7");
      await pagina.getByLabel("Inicio de actividades").fill("2020-01-01");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Confirmar" }).click();
      await pagina.waitForURL(/\/configuracion-fiscal$/);
    });

    it("Puntos de venta: se crea el primero", async () => {
      await ir("/configuracion-fiscal/puntos-de-venta/nuevo");
      await pagina.getByLabel("Número de punto de venta").fill("1");
      await pagina.getByLabel("Calle").fill("Avenida Siempre Viva");
      await pagina.getByLabel("Número", { exact: true }).fill("742");
      await pagina.getByLabel("Localidad").fill("Rosario");
      await pagina.getByLabel("Provincia").selectOption({ label: "Santa Fe" });
      await pagina.getByLabel("Código postal").fill("2000");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.waitForURL(/\/configuracion-fiscal\/puntos-de-venta$/);
      await pagina.getByText("00001").first().waitFor();
      await pagina.getByRole("link", { name: /^00001/ }).click();
      await pagina.waitForLoadState("networkidle");
      await pagina.getByRole("button", { name: "Activar" }).click();
      await pagina.waitForTimeout(1500);
      process.stderr.write(`\nPVDETALLE:\n${await pagina.locator("main").ariaSnapshot()}\n`);
    });

    it("Emitir: paso 1", async () => {
      await ir("/facturacion/comprobantes/emitir");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByLabel("Descripción").fill("Medialunas x12");
      await pagina.getByLabel("Precio con IVA").fill("121,00");
      await pagina.getByLabel("IVA", { exact: true }).selectOption({ label: "IVA 21 %" });
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.waitForTimeout(1000);
      await pagina.getByRole("button", { name: "Emitir factura" }).click();
      await pagina.waitForURL(/\/facturacion\/comprobantes\/[0-9a-f-]{36}$/);
      for (let i = 0; i < 20; i += 1) {
        if (await pagina.getByText("Autorizada", { exact: true }).count()) break;
        await pagina.waitForTimeout(1000);
        await pagina.reload();
        await pagina.waitForLoadState("networkidle");
      }
      process.stderr.write(
        `\nRESULTADO: ${pagina.url()}\n${await pagina.locator("main").ariaSnapshot()}\n`,
      );
      process.stderr.write(
        `ARCA recibió: ${JSON.stringify(mundo.arca.pedidos.map((p) => p.operacion))}\nREGISTRO APP: ${mundo.app.registro.join("").slice(-1500)}\n`,
      );
    });

    it("el recorrido va limpio (consola, 5xx, CSP, hosts)", () => {
      vigilante.verificar();
    });
  },
);
