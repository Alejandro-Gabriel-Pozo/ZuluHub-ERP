import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * S-1: la pantalla «Mesas» con la app REAL construida, un navegador real y una base real. MIENTRAS `salon` ESTÉ `en_desarrollo` EN EL CATÁLOGO REAL, LA APP LO RECHAZA
 * (`MODULO_EN_DESARROLLO`, antes de mirar plan, rol o permisos): es el «nace cerrado» que el dueño todavía no levantó, no un defecto. Este recorrido deja a la vista ESE hecho: la pantalla
 * no muestra ninguna mesa ni botón de cambio, dice que todavía está en desarrollo, el menú no ofrece «Mesas», la página carga limpia y sin violaciones graves de accesibilidad. El
 * funcionamiento con el módulo abierto (alta, edición, doble envío, dos administradores) lo prueban `test/integracion/mesas-web.test.ts` y el formulario en Chromium
 * (`FormularioDeMesa.test.tsx`).
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const salonAbierto = (CATALOGO_DE_MODULOS.salon.estado as string) === "disponible";

describe.skipIf(base === null || salonAbierto)(
  "recorrido de mesas con «salon» en desarrollo",
  () => {
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
      contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
      await contexto.addCookies([...mundo.cookies]);
      pagina = await contexto.newPage();
      vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    });
    afterAll(async () => {
      await navegador?.close();
      await mundo?.cerrar();
    });

    it("«Mesas» dice que está en desarrollo, no ofrece cambios y no está en el menú", async () => {
      const respuesta = await pagina.goto(`${mundo.url}/salon/mesas`);
      await pagina.waitForLoadState("networkidle");
      expect(respuesta?.status()).toBe(200);
      await pagina.getByText("Esta función todavía está en desarrollo.").first().waitFor();
      expect(await pagina.getByRole("link", { name: "Agregar mesa" }).count()).toBe(0);
      expect(await pagina.getByRole("button", { name: "Desactivar" }).count()).toBe(0);
      expect(await pagina.getByRole("link", { name: "Mesas" }).count()).toBe(0);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("el alta y la edición también están cerradas", async () => {
      for (const ruta of [
        "/salon/mesas/nueva",
        "/salon/mesas/11111111-1111-4111-8111-111111111111",
      ]) {
        const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
        await pagina.waitForLoadState("networkidle");
        expect(respuesta?.status()).toBe(200);
        expect(await pagina.getByRole("button", { name: "Guardar" }).count()).toBe(
          ruta.endsWith("nueva") ? 1 : 0,
        );
      }
      vigilante.tomar();
    });
  },
);
