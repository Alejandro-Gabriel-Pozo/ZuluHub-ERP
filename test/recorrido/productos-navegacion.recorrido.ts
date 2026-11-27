import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";

/**
 * LA NAVEGACIÓN DE PRODUCTOS, de punta a punta en la app REAL construida: desde la lista, el nombre de un producto lleva a su ficha, y la ficha
 * lleva a «Precios» (antes solo se llegaba a la ficha por la redirección al crear y a los precios escribiendo la dirección). Con la ficha se
 * destraban «Opciones» y «Cómo se compra». Lo que ve cada persona lo sigue decidiendo el guard de cada pantalla.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de la navegación de productos", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let pagina: Page;
  let productoId: string;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo"],
      activarModulosEnDesarrollo: true,
    });
    productoId = await productoDeBase(mundo.mundo.dueno, mundo.empresa, {
      nombre: "Milanesa a la napolitana",
      clase: "VENDIBLE",
    });
    await precioDeBase(mundo.mundo.dueno, {
      empresa: mundo.empresa,
      producto: productoId,
      precio: "9500",
      desde: "2026-10-01T00:00:00Z",
    });
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    const contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("de la lista a la ficha y de la ficha a «Precios»", async () => {
    await pagina.goto(`${mundo.url}/catalogo/productos`);
    const enlace = pagina.getByRole("link", { name: "Milanesa a la napolitana" });
    await enlace.waitFor();
    expect(await enlace.getAttribute("href")).toBe(`/catalogo/productos/${productoId}`);
    await enlace.click();
    await pagina.waitForURL(new RegExp(`/catalogo/productos/${productoId}$`));
    const precios = pagina.getByRole("link", { name: "Precios", exact: true });
    await precios.waitFor();
    expect(await precios.getAttribute("href")).toBe(`/catalogo/productos/${productoId}/precios`);
    await precios.click();
    await pagina.waitForURL(new RegExp(`/catalogo/productos/${productoId}/precios$`));
    await pagina.getByText("Precio (IVA incluido)").first().waitFor();
    // La ficha también ofrece «Opciones» (se vende).
    await pagina.goBack();
    await pagina.getByRole("link", { name: "Opciones", exact: true }).waitFor();
  });
});
