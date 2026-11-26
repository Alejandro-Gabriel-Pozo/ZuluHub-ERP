import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { articuloDeBase } from "../integracion/stock-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Depósitos» de Stock con la app REAL construida, un navegador real y una base real. Previene lo que ninguna prueba de unidad ve: un componente de cliente que rompe en el navegador
 * (un `Boton` sin `"use client"`, React #441), la acción de servidor que no llega o el alta que no vuelve a la lista. Con `stock` disponible en el catálogo real, la empresa del mundo lo
 * tiene por su plan y activo (`catalogo` y `stock`, igual que el recorrido de la venta); el servidor y sus permisos, el aislamiento y la idempotencia del alta los prueban
 * `test/integracion/stock-depositos-web.test.ts` y el formulario en Chromium (`FormularioDeDeposito.test.tsx`). STK-A suma editar, desactivar y reactivar: la acción de «Desactivar» llega y la lista
 * se refresca, el rechazo del «de venta» sale con su texto y dos pestañas que editan lo mismo no se pisan. STK-B1 suma Existencias y Movimientos (solo lectura): cargan limpias, las pestañas llevan de una
 * a otra, el selector de depósitos son enlaces que cambian el depósito y un cursor o un depósito ajenos dan el genérico en vez de romper. STK-B2 suma la entrada a mano (con doble clic) y su anulación.
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

  it("la lista carga limpia, el menú ofrece «Stock» (que entra por Existencias) y agregar un depósito lo deja en la lista", async () => {
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
    expect(await filaStock.getAttribute("href")).toBe("/stock/existencias");
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

  it("al entrar a «Agregar depósito» la lista y las pestañas siguen a la vista y «Cancelar» vuelve sin crear nada", async () => {
    await pagina.goto(`${mundo.url}/stock/depositos`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("link", { name: "Agregar depósito" }).click();
    await pagina.waitForURL("**/stock/depositos/nuevo");
    const pestana = pagina.getByRole("main").getByRole("link", { name: "Depósitos" });
    await pestana.waitFor();
    expect(await pestana.getAttribute("aria-current")).toBe("page");
    expect(await pagina.getByRole("heading", { name: "Depósitos" }).count()).toBe(1);
    expect(await pagina.getByText("Cocina", { exact: true }).count()).toBe(1);
    await pagina.getByLabel("Nombre", { exact: true }).waitFor();
    await pagina.getByLabel("Nombre", { exact: true }).fill("No se crea");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    await pagina.getByRole("link", { name: "Cancelar" }).click();
    await pagina.waitForURL((url) => url.pathname === "/stock/depositos");
    await pagina.getByRole("link", { name: "Agregar depósito" }).waitFor();
    expect(await pagina.getByText("No se crea", { exact: true }).count()).toBe(0);
    expect(await pagina.getByText("Cocina", { exact: true }).count()).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("un doble clic en «Agregar depósito» deja un solo depósito", async () => {
    await pagina.goto(`${mundo.url}/stock/depositos/nuevo`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByLabel("Nombre", { exact: true }).fill("Barra");
    await pagina.getByRole("button", { name: "Agregar depósito" }).dblclick();
    await pagina.waitForURL((url) => url.pathname === "/stock/depositos");
    await pagina.getByText("Barra", { exact: true }).waitFor();
    await pagina.waitForLoadState("networkidle");
    expect(await pagina.getByText("Barra", { exact: true }).count()).toBe(1);
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

  const tarjeta = (nombre: string) =>
    pagina.getByRole("listitem").filter({ has: pagina.getByText(nombre, { exact: true }) });

  it("desactivar el «de venta» dice por qué no; desactivar otro lo deja «Desactivado» con «Reactivar», y reactivarlo lo devuelve", async () => {
    await pagina.goto(`${mundo.url}/stock/depositos`);
    await pagina.waitForLoadState("networkidle");
    await tarjeta("Cocina").getByRole("button", { name: "Desactivar" }).click();
    await pagina.getByText("No se puede desactivar el depósito de venta").waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    vigilante.tomar();

    await tarjeta("Barra").getByRole("button", { name: "Desactivar" }).click();
    await tarjeta("Barra").getByText("Desactivado", { exact: true }).waitFor();
    expect(await tarjeta("Barra").getByRole("link", { name: "Editar" }).count()).toBe(0);
    expect(await tarjeta("Barra").getByRole("button", { name: "Desactivar" }).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    await tarjeta("Barra").getByRole("button", { name: "Reactivar" }).click();
    await tarjeta("Barra").getByRole("button", { name: "Desactivar" }).waitFor();
    expect(await tarjeta("Barra").getByText("Desactivado", { exact: true }).count()).toBe(0);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("un doble clic en «Desactivar» deja el depósito desactivado una sola vez", async () => {
    await pagina.goto(`${mundo.url}/stock/depositos`);
    await pagina.waitForLoadState("networkidle");
    await tarjeta("Barra").getByRole("button", { name: "Desactivar" }).dblclick();
    await tarjeta("Barra").getByRole("button", { name: "Reactivar" }).waitFor();
    await pagina.waitForLoadState("networkidle");
    expect(await tarjeta("Barra").getByText("Desactivado", { exact: true }).count()).toBe(1);
    await tarjeta("Barra").getByRole("button", { name: "Reactivar" }).click();
    await tarjeta("Barra").getByRole("button", { name: "Desactivar" }).waitFor();
    expect(vigilante.tomar()).toEqual([]);
  });

  it("editar cambia el nombre y vuelve a la lista; dos pestañas con la misma versión: la segunda recibe «otra persona lo modificó»", async () => {
    await pagina.goto(`${mundo.url}/stock/depositos`);
    await pagina.waitForLoadState("networkidle");
    await tarjeta("Barra").getByRole("link", { name: "Editar" }).click();
    await pagina.waitForURL("**/editar");
    const urlDeEdicion = pagina.url();
    await pagina.getByLabel("Nombre", { exact: true }).waitFor();
    expect(await pagina.getByLabel("Uso").count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    const otra = await contexto.newPage();
    await otra.goto(urlDeEdicion);
    await otra.waitForLoadState("networkidle");

    await pagina.getByLabel("Nombre", { exact: true }).fill("Barra grande");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL((url) => url.pathname === "/stock/depositos");
    await pagina.getByText("Barra grande", { exact: true }).waitFor();
    expect(await pagina.getByText("Barra", { exact: true }).count()).toBe(0);

    await otra.getByLabel("Nombre", { exact: true }).fill("Barra chica");
    await otra.getByRole("button", { name: "Guardar" }).click();
    await otra.getByText("Otra persona modificó este depósito. Actualizá la pantalla").waitFor();
    await otra.close();

    await pagina.goto(`${mundo.url}/stock/depositos`);
    await pagina.waitForLoadState("networkidle");
    expect(await pagina.getByText("Barra grande", { exact: true }).count()).toBe(1);
    expect(await pagina.getByText("Barra chica", { exact: true }).count()).toBe(0);
    vigilante.tomar();
  });

  it("Existencias y Movimientos cargan limpias, el selector cambia de depósito y las pestañas navegan entre las pantallas", async () => {
    await pagina.goto(`${mundo.url}/stock/existencias`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("navigation", { name: "Depósitos" }).waitFor();
    const enlaces = pagina.getByRole("navigation", { name: "Depósitos" }).getByRole("link");
    expect(await enlaces.count()).toBeGreaterThanOrEqual(2);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);

    const otro = enlaces.nth(1);
    const href = await otro.getAttribute("href");
    expect(href).toMatch(/^\/stock\/existencias\?deposito=[0-9a-f-]{36}$/);
    await otro.click();
    await pagina.waitForURL((url) => url.search === `?${(href ?? "").split("?")[1] ?? ""}`);
    expect(
      await pagina
        .getByRole("navigation", { name: "Depósitos" })
        .getByRole("link")
        .nth(1)
        .getAttribute("aria-current"),
    ).toBe("page");

    await pagina.getByRole("main").getByRole("link", { name: "Movimientos" }).click();
    await pagina.waitForURL((url) => url.pathname === "/stock/movimientos");
    await pagina.getByRole("navigation", { name: "Depósitos" }).waitFor();
    expect(await pagina.getByRole("button").filter({ hasText: "Anular" }).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("un depósito que no es de la sucursal o un cursor roto dan el mensaje genérico y no rompen la pantalla", async () => {
    for (const ruta of [
      "/stock/existencias?deposito=00000000-0000-4000-8000-000000000000",
      "/stock/movimientos?deposito=no-es-un-id",
      "/stock/movimientos?despues=cursor-roto",
    ]) {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      expect(respuesta?.status(), ruta).toBe(200);
      await pagina.getByText("Esta acción no está permitida").waitFor();
    }
    vigilante.tomar();
  });

  it("registrar una entrada desde Existencias la deja en Movimientos una sola vez (doble clic) y anularla la marca «Anulado» con su espejo", async () => {
    const { articulo } = await articuloDeBase(mundo.mundo.dueno, { empresa: mundo.empresa });
    expect(articulo).toMatch(/^[0-9a-f-]{36}$/);
    await pagina.goto(`${mundo.url}/stock/existencias`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("link", { name: "Entrada", exact: true }).click();
    await pagina.waitForURL("**/stock/movimientos/entrada");
    await pagina.getByLabel("Artículo").selectOption(articulo);
    await pagina.getByLabel("Cantidad").fill("5");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.getByRole("button", { name: "Registrar" }).dblclick();
    await pagina.waitForURL((url) => url.pathname === "/stock/movimientos");
    await pagina.waitForLoadState("networkidle");
    const tarjetas = pagina.getByRole("listitem").filter({ hasText: "+5" });
    expect(await tarjetas.count()).toBe(1);
    expect(await tarjetas.first().getByText("Entrada", { exact: true }).count()).toBe(1);
    expect(vigilante.tomar()).toEqual([]);

    await tarjetas.first().getByRole("link", { name: "Anular" }).click();
    await pagina.waitForURL("**/anular");
    await pagina.getByLabel("Detalle").fill("Error de carga");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.getByRole("button", { name: "Anular" }).click();
    await pagina.waitForURL((url) => url.pathname === "/stock/movimientos");
    await pagina.getByText("Anulación", { exact: true }).waitFor();
    expect(await pagina.getByText("Anulado", { exact: true }).count()).toBe(1);
    expect(await pagina.getByRole("link", { name: "Anular" }).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("con el nivel AVISAR, una salida que deja negativo avisa y «Registrar» la confirma una sola vez", async () => {
    const { articulo } = await articuloDeBase(mundo.mundo.dueno, { empresa: mundo.empresa });
    await mundo.mundo.dueno.query(
      `insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'stock.existencia_negativa', 'AVISAR')
       on conflict on constraint nivel_de_control_uk do update set nivel = excluded.nivel`,
      [mundo.empresa],
    );
    try {
      await pagina.goto(`${mundo.url}/stock/movimientos/salida`);
      await pagina.waitForLoadState("networkidle");
      await pagina.getByLabel("Artículo").selectOption(articulo);
      await pagina.getByLabel("Cantidad").fill("2");
      await pagina.getByRole("button", { name: "Registrar" }).click();
      await pagina.getByText("Va a quedar en negativo. ¿Confirmás?").waitFor();
      expect(pagina.url()).toContain("/stock/movimientos/salida");
      await pagina.getByRole("button", { name: "Registrar" }).dblclick();
      await pagina.waitForURL((url) => url.pathname === "/stock/movimientos");
      await pagina.waitForLoadState("networkidle");
      const tarjetas = pagina.getByRole("listitem").filter({ hasText: "-2 Unidad" });
      expect(await tarjetas.count()).toBe(1);
      expect(vigilante.tomar()).toEqual([]);
    } finally {
      await mundo.mundo.dueno.query(
        "update nivel_de_control set nivel = 'PERMITIR' where empresa_id = $1 and control = 'stock.existencia_negativa'",
        [mundo.empresa],
      );
    }
  });
});
