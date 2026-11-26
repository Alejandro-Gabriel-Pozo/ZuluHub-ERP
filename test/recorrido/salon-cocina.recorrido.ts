import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * SAL-H: la pantalla «Comandas» de la cocina de punta a punta en la app REAL construida, con un navegador real y una base real: un envío sin impresora queda pendiente y la cocina lo ve («Mesa N», «Envío 1», la hora) con
 * «Imprimir»; un envío cuyo diálogo falló queda «No se pudo imprimir» y «Reintentar» pide el MISMO trabajo con un intento más (un trabajo, dos intentos) y lo deja «Impresa»; recargada, lo impreso ya no está. Lo que esta
 * prueba ve y las de componentes no: la consulta de la sucursal, el permiso, la recarga y que ningún componente rompa en el navegador (un componente de cliente sin `"use client"`, React #441).
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";
const CELULAR = { width: 390, height: 844 } as const;

describe.skipIf(base === null)("recorrido de la cocina: de la mesa a «Comandas»", () => {
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
  const contar = async (consulta: string, parametros: unknown[] = []) =>
    Number((await mundo.mundo.dueno.query<{ n: string }>(consulta, parametros)).rows[0]?.n);
  /** `window.print` es un espía que anota la hoja y puede fallar a pedido (un diálogo que no se pudo abrir). */
  const espiar = (falla: boolean) =>
    pagina.addInitScript(
      `window.__impresiones = []; window.print = () => { ${falla ? 'throw new Error("sin diálogo");' : ""} window.__impresiones.push(document.querySelector("[data-papel]")?.textContent ?? ""); };`,
    );
  const impresiones = () => pagina.evaluate<string[]>("window.__impresiones");
  /** Abre la mesa 7, agrega una medialuna y la envía a cocina (el diálogo de impresión se abre solo). */
  const enviarUnaMedialuna = async () => {
    await ir("/salon");
    await pagina.getByRole("link", { name: "Mesa 7" }).click();
    await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}$/);
    // La ficha carga con «Tomar pedido» (mesa libre) o con el catálogo para agregar (mesa con cuenta).
    await pagina
      .getByRole("button", { name: /^(Tomar pedido|Medialuna)/ })
      .first()
      .waitFor();
    if ((await pagina.getByRole("button", { name: "Tomar pedido" }).count()) > 0) {
      await pagina.getByRole("button", { name: "Tomar pedido" }).click();
      await pagina.getByText("La mesa no tiene pedido").waitFor();
    }
    await pagina.getByRole("button", { name: /^Medialuna/ }).click();
    await pagina.getByRole("button", { name: /^Agregar( ·|$)/ }).click();
    await pagina.getByRole("heading", { name: "Para enviar" }).waitFor();
    await pagina.getByRole("button", { name: "Enviar a cocina" }).click();
  };

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulos: ["facturacion", "catalogo", "caja", "ventas", "comandas", "salon"],
      perillas: { salon: { tipo: "INTERRUPTOR", encendida: true } },
      activarModulosEnDesarrollo: true,
    });
    const medialuna = await productoDeBase(mundo.mundo.dueno, mundo.empresa, {
      nombre: "Medialuna",
    });
    await precioDeBase(mundo.mundo.dueno, {
      empresa: mundo.empresa,
      producto: medialuna,
      precio: "800.00",
      desde: DESDE,
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

  it("sin impresora: el envío queda pendiente, la cocina lo ve en «Comandas» (con el menú) y «Imprimir» avisa que no hay impresora", async () => {
    await ir("/salon/mesas/nueva");
    await pagina.getByLabel("Número", { exact: true }).fill("7");
    await pagina.getByLabel("Columna", { exact: true }).fill("3");
    await pagina.getByLabel("Fila", { exact: true }).fill("2");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL("**/salon/mesas");
    await espiar(false);
    await enviarUnaMedialuna();
    await pagina.getByText("No hay impresora para la comanda de cocina").waitFor();

    const respuesta = await ir("/salon/comandas");
    expect(respuesta?.status()).toBe(200);
    expect(await pagina.locator('a[href="/salon/comandas"]').count()).toBeGreaterThan(0);
    await pagina.getByText("Mesa 7").waitFor();
    await pagina.getByText(/^Envío 1 · \d{2}:\d{2}$/).waitFor();
    await pagina.getByRole("button", { name: "Imprimir" }).click();
    await pagina.getByText("No hay impresora para la comanda de cocina").waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(
      await contar("select count(*)::text as n from trabajo_de_impresion where empresa_id = $1", [
        mundo.empresa,
      ]),
    ).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("un diálogo que falló queda «No se pudo imprimir»; «Reintentar» es el mismo trabajo con un intento más y lo deja «Impresa»; recargada, ya no está", async () => {
    // Una impresora de comandas y un segundo envío cuyo diálogo falla.
    await ir("/salon/impresoras/nueva");
    await pagina.getByLabel("Nombre", { exact: true }).fill("Cocina");
    await pagina.getByLabel("Para qué sirve").selectOption("COMANDA");
    await pagina.getByLabel("Papel").selectOption("80");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL(`${mundo.url}/salon/impresoras`);
    await espiar(true);
    await enviarUnaMedialuna();
    await pagina.getByText("No se pudo imprimir").waitFor();

    await ir("/salon/comandas");
    const fila = pagina.locator("li", { hasText: "Envío 2" });
    await fila.getByText("No se pudo imprimir").waitFor();
    await fila.getByRole("button", { name: "Reintentar" }).waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    // Ahora el diálogo anda: «Reintentar» (doble toque = un solo intento más).
    await espiar(false);
    await ir("/salon/comandas");
    const reintentar = pagina
      .locator("li", { hasText: "Envío 2" })
      .getByRole("button", { name: "Reintentar" });
    await reintentar.dblclick();
    await pagina.locator("li", { hasText: "Envío 2" }).getByText("Impresa").waitFor();
    expect(await impresiones()).toHaveLength(1);
    const intentos = await mundo.mundo.dueno.query<{ intentos: number; n: string }>(
      `select t.intentos, (select count(*) from intento_de_impresion i where i.trabajo_id = t.id)::text as n
         from trabajo_de_impresion t where t.empresa_id = $1 and t.estado = 'IMPRESA'`,
      [mundo.empresa],
    );
    expect(intentos.rows).toEqual([{ intentos: 2, n: "2" }]);

    await ir("/salon/comandas");
    expect(await pagina.locator("li", { hasText: "Envío 2" }).count()).toBe(0);
    expect(vigilante.tomar()).toEqual([]);
  });
});
