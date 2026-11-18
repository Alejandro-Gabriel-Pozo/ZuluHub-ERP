import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Depósitos» de Stock con la app REAL construida, un navegador real y una base real. Previene lo que ninguna prueba de unidad ve: un componente de cliente que rompe en el navegador
 * (un `Boton` sin `"use client"`, React #441), la acción de servidor que no llega o el alta que no vuelve a la lista. Con `stock` disponible en el catálogo real, la empresa del mundo lo
 * tiene por su plan y activo (`catalogo` y `stock`, igual que el recorrido de la venta); el servidor y sus permisos, el aislamiento y la idempotencia del alta los prueban
 * `test/integracion/stock-depositos-web.test.ts` y el formulario en Chromium (`FormularioDeDeposito.test.tsx`).
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const stockAbierto = (CATALOGO_DE_MODULOS.stock.estado as string) === "disponible";

describe.skipIf(base === null || !stockAbierto)("recorrido de depósitos de stock", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulos: ["facturacion", "catalogo", "stock"],
    });
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

  it("la lista carga limpia, el menú ofrece «Stock» y agregar un depósito lo deja en la lista", async () => {
    const respuesta = await pagina.goto(`${mundo.url}/stock/depositos`);
    await pagina.waitForLoadState("networkidle");
    expect(respuesta?.status()).toBe(200);
    await pagina.getByRole("link", { name: "Agregar depósito" }).waitFor();
    // En el celular el menú de Catálogo es un desplegable: «Stock» está adentro y lleva a Depósitos.
    await pagina
      .getByRole("navigation", { name: "Navegación principal" })
      .getByText("Catálogo")
      .click();
    const filaStock = pagina.getByRole("link", { name: "Stock", exact: true });
    await filaStock.waitFor();
    expect(await filaStock.getAttribute("href")).toBe("/stock/depositos");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);

    await pagina.getByRole("link", { name: "Agregar depósito" }).click();
    await pagina.waitForURL("**/stock/depositos/nuevo");
    await pagina.getByLabel("Nombre", { exact: true }).fill("Cocina");
    await pagina.getByLabel("De venta").check();
    await pagina.getByRole("button", { name: "Agregar depósito" }).click();
    // Sin recargar: la navegación suave que sigue al alta tiene que mostrar la lista con el depósito nuevo.
    await pagina.waitForURL((url) => url.pathname === "/stock/depositos");
    await pagina.getByText("Cocina", { exact: true }).waitFor();
    expect(await pagina.getByText("Cocina", { exact: true }).count()).toBe(1);
    expect(await pagina.getByText("De venta", { exact: true }).count()).toBe(1);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("repetir el alta con el mismo nombre dice que ya existe y la lista sigue con uno solo", async () => {
    await pagina.goto(`${mundo.url}/stock/depositos/nuevo`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByLabel("Nombre", { exact: true }).fill("Cocina");
    await pagina.getByRole("button", { name: "Agregar depósito" }).click();
    await pagina.getByText("Ya existe un depósito con ese nombre").waitFor();
    vigilante.tomar();

    await pagina.goto(`${mundo.url}/stock/depositos`);
    await pagina.waitForLoadState("networkidle");
    expect(await pagina.getByText("Cocina", { exact: true }).count()).toBe(1);
  });
});
