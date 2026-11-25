import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Clientes y proveedores» con la app REAL construida, un navegador real y una base real. Previene lo que ninguna prueba de unidad ve: un componente de cliente que rompe en el navegador
 * (un `Boton` o una `Casilla` sin `"use client"`, React #441), la acción de servidor que no llega, el alta que no vuelve a la lista (la acción no redirige: navega la pantalla), el doble toque que
 * crea dos partes y la edición desde una pestaña vieja que pisa lo guardado. El servidor, sus permisos, el aislamiento y la concurrencia los prueba `test/integracion/directorio-web.test.ts`.
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const clientesAbierto = (CATALOGO_DE_MODULOS.clientes.estado as string) === "disponible";
const sufijo = (): string =>
  Math.random()
    .toString(36)
    .replace(/[^a-z]/g, "")
    .slice(0, 8);
const GENERICO = "Esta acción no está permitida";

describe.skipIf(base === null || !clientesAbierto)("recorrido de clientes y proveedores", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, { modulos: ["facturacion", "clientes"] });
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

  /** Da de alta una parte por la pantalla y vuelve a la lista. */
  const alta = async (
    p: Page,
    nombre: string,
    extra: (p: Page) => Promise<void> = async () => {},
  ) => {
    await p.goto(`${mundo.url}/clientes/nuevo`);
    await p.waitForLoadState("networkidle");
    await p.getByLabel("Nombre", { exact: true }).fill(nombre);
    await extra(p);
    await p.getByRole("button", { name: "Guardar", exact: true }).click();
    await p.waitForURL((url) => url.pathname === "/clientes");
    await p.waitForLoadState("networkidle");
  };
  const enLista = (p: Page, nombre: string) => p.locator("ul a", { hasText: nombre });

  it("R1: «Nuevo» guarda una persona, vuelve a la lista y aparece; sin violaciones graves ni errores de consola", async () => {
    const respuesta = await pagina.goto(`${mundo.url}/clientes`);
    await pagina.waitForLoadState("networkidle");
    expect(respuesta?.status()).toBe(200);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.getByRole("link", { name: "Nuevo" }).click();
    await pagina.waitForURL("**/clientes/nuevo");
    const nombre = `Ana ${sufijo()}`;
    await pagina.getByLabel("Nombre", { exact: true }).fill(nombre);
    await pagina.getByRole("button", { name: "Guardar", exact: true }).click();
    await pagina.waitForURL((url) => url.pathname === "/clientes");
    await enLista(pagina, nombre).waitFor();
    expect(await enLista(pagina, nombre).count()).toBe(1);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("R2 DOBLE TOQUE: dos toques seguidos en «Guardar» crean UNA parte", async () => {
    const nombre = `Doble ${sufijo()}`;
    await pagina.goto(`${mundo.url}/clientes/nuevo`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByLabel("Nombre", { exact: true }).fill(nombre);
    await pagina.getByRole("button", { name: "Guardar", exact: true }).dblclick();
    await pagina.waitForURL((url) => url.pathname === "/clientes");
    await pagina.waitForLoadState("networkidle");
    await pagina.getByLabel("Buscar").fill(nombre);
    await pagina.getByRole("button", { name: "Aplicar filtros" }).click();
    await pagina.waitForURL(/texto=/);
    await enLista(pagina, nombre).first().waitFor();
    expect(await enLista(pagina, nombre).count()).toBe(1);
    vigilante.tomar();
  });

  it("R3 DOS PESTAÑAS: la segunda que guarda ve el genérico y no pisa lo guardado", async () => {
    const nombre = `Pestañas ${sufijo()}`;
    await alta(pagina, nombre);
    await enLista(pagina, nombre).click();
    await pagina.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
    const ficha = pagina.url();
    const otra = await contexto.newPage();
    await otra.goto(ficha);
    await otra.waitForLoadState("networkidle");

    await pagina.getByLabel("Teléfono (opcional)").fill("111111");
    await pagina.getByRole("button", { name: "Guardar", exact: true }).click();
    await pagina.waitForURL((url) => url.pathname === "/clientes");

    await otra.getByLabel("Teléfono (opcional)").fill("222222");
    await otra.getByRole("button", { name: "Guardar", exact: true }).click();
    await otra.getByText(GENERICO).first().waitFor();
    expect(otra.url()).toBe(ficha);

    await otra.goto(ficha);
    await otra.waitForLoadState("networkidle");
    expect(await otra.getByLabel("Teléfono (opcional)").inputValue()).toBe("111111");
    await otra.close();
    vigilante.tomar();
  });

  it("R4: filtrar por «Proveedores» no trae a quien solo es cliente y «Mostrar desactivados» trae al desactivado con su marca", async () => {
    const quien = sufijo();
    const cliente = `Cliente ${quien}`;
    const proveedor = `Proveedor ${quien}`;
    await alta(pagina, cliente, (p) => p.getByLabel("Cliente", { exact: true }).check());
    await alta(pagina, proveedor, (p) => p.getByLabel("Proveedor", { exact: true }).check());

    await pagina.goto(`${mundo.url}/clientes?rol=proveedor&texto=${quien}`);
    await pagina.waitForLoadState("networkidle");
    await enLista(pagina, proveedor).waitFor();
    expect(await enLista(pagina, cliente).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    // Desactivar al proveedor desde su ficha: sale de la lista común y vuelve con «Mostrar desactivados».
    await enLista(pagina, proveedor).click();
    await pagina.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
    await pagina.getByRole("button", { name: "Desactivar" }).click();
    await pagina.waitForURL((url) => url.pathname === "/clientes");
    await pagina.goto(`${mundo.url}/clientes?rol=proveedor&texto=${quien}`);
    await pagina.waitForLoadState("networkidle");
    expect(await enLista(pagina, proveedor).count()).toBe(0);

    await pagina.getByLabel("Mostrar desactivados").check();
    await pagina.getByRole("button", { name: "Aplicar filtros" }).click();
    await pagina.waitForURL(/desactivados=on/);
    const fila = enLista(pagina, proveedor);
    await fila.waitFor();
    expect(await fila.innerText()).toContain("Desactivado");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("el menú ofrece «Clientes» (Ventas) y «Proveedores» (Compras) y la ficha ajena sale como el genérico", async () => {
    await pagina.goto(`${mundo.url}/clientes`);
    await pagina.waitForLoadState("networkidle");
    expect(await pagina.locator('a[href="/clientes?rol=cliente"]').count()).toBeGreaterThan(0);
    expect(await pagina.locator('a[href="/clientes?rol=proveedor"]').count()).toBeGreaterThan(0);
    await pagina.goto(`${mundo.url}/clientes/11111111-1111-4111-8111-111111111111`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByText(GENERICO).first().waitFor();
    vigilante.tomar();
  });
});
