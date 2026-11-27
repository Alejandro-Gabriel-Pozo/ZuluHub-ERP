import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * SAL-A y SAL-B: el mapa del salón y la ficha de la mesa de punta a punta en la app REAL construida, con un navegador real y una base real: el menú ofrece «Salón», el mapa lista la mesa «Libre», su ficha deja tomar
 * el pedido (un doble toque es una sola cuenta), agregar un producto con la hoja de la venta rápida, pasar un plato a «Sale después», quitarlo sin motivo y liberar la mesa. Lo que esta prueba ve y las de componentes no: las acciones
 * de servidor (la sucursal, el permiso y el precio los pone el servidor), la recarga que sigue a cada una y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441).
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";
const CELULAR = { width: 390, height: 844 } as const;

describe.skipIf(base === null)("recorrido del salón: del mapa a la mesa", () => {
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

  it("se carga una mesa y el mapa la muestra «Libre»; «Salón» está en el menú; los filtros funcionan", async () => {
    await ir("/salon/mesas/nueva");
    await pagina.getByLabel("Número", { exact: true }).fill("7");
    await pagina.getByLabel("Columna", { exact: true }).fill("3");
    await pagina.getByLabel("Fila", { exact: true }).fill("2");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL("**/salon/mesas");

    const respuesta = await ir("/salon");
    expect(respuesta?.status()).toBe(200);
    expect(await pagina.locator('a[href="/salon"]').count()).toBeGreaterThan(0);
    const mesa = pagina.getByRole("link", { name: "Mesa 7" });
    await mesa.waitFor();
    await pagina.getByText("Libre", { exact: true }).waitFor();
    await pagina.getByRole("link", { name: "Ocupadas" }).click();
    await pagina.waitForURL("**/salon?filtro=OCUPADAS");
    expect(await pagina.getByRole("link", { name: "Mesa 7" }).count()).toBe(0);
    await pagina.getByRole("link", { name: "Ocupadas" }).click();
    await pagina.waitForURL("**/salon");
    await pagina.getByRole("link", { name: "Mesa 7" }).waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("«Tomar pedido» con un doble toque deja una sola cuenta; se agrega, se pasa a «Sale después», se quita y se libera", async () => {
    await ir("/salon");
    await pagina.getByRole("link", { name: "Mesa 7" }).click();
    await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}$/);
    await pagina.getByText("Mesa libre").waitFor();
    const tomar = pagina.getByRole("button", { name: "Tomar pedido" });
    await tomar.dblclick();
    await pagina.getByText("La mesa no tiene pedido").waitFor();
    expect(
      await contar("select count(*)::text as n from cuenta_consumo where empresa_id = $1", [
        mundo.empresa,
      ]),
    ).toBe(1);

    // Agregar con la hoja de la venta rápida.
    await pagina.getByRole("button", { name: /^Medialuna/ }).click();
    await pagina.getByRole("button", { name: /^Agregar( ·|$)/ }).click();
    await pagina.getByRole("heading", { name: "Para enviar" }).waitFor();
    await pagina.getByText("1 × Medialuna").waitFor();
    await pagina.locator("p", { hasText: "Total" }).getByText("$ 800,00").waitFor();
    expect(
      await contar(
        "select count(*)::text as n from linea_cuenta where empresa_id = $1 and estado = 'VIGENTE'",
        [mundo.empresa],
      ),
    ).toBe(1);

    // «Sale después»: pasa al grupo de los que esperan.
    await pagina.getByRole("button", { name: /^Sale ahora/ }).click();
    await pagina.getByRole("heading", { name: "Esperan para después" }).waitFor();
    expect(await pagina.getByRole("heading", { name: "Para enviar" }).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    // Quitar sin motivo; la línea queda anulada (no se borra) y la mesa se puede liberar.
    await pagina.getByRole("button", { name: "Quitar" }).click();
    await pagina.getByText("La mesa no tiene pedido").waitFor();
    expect(
      await contar(
        "select count(*)::text as n from linea_cuenta where empresa_id = $1 and estado = 'ANULADA' and motivo_de_anulacion = 'SIN_ENVIAR'",
        [mundo.empresa],
      ),
    ).toBe(1);
    await pagina.getByRole("button", { name: "Liberar mesa" }).click();
    await pagina.getByText("Mesa libre").waitFor();
    expect(
      await contar(
        "select count(*)::text as n from cuenta_consumo where empresa_id = $1 and estado = 'ABIERTA'",
        [mundo.empresa],
      ),
    ).toBe(0);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("«Enviar a cocina» imprime la comanda UNA vez aunque se toque dos veces y deja un envío; anular lo enviado pide motivo, avisa a cocina y no borra la línea", async () => {
    // Una impresora de comandas (sin ella el envío se hace igual, pero no hay papel que mirar).
    await ir("/salon/impresoras/nueva");
    await pagina.getByLabel("Nombre", { exact: true }).fill("Cocina");
    await pagina.getByLabel("Para qué sirve").selectOption("COMANDA");
    await pagina.getByLabel("Papel").selectOption("80");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL(`${mundo.url}/salon/impresoras`);
    // `window.print` es un espía: anota la hoja del momento y no abre nada.
    await pagina.addInitScript(
      `window.__impresiones = []; window.print = () => { window.__impresiones.push(document.querySelector("[data-papel]")?.textContent ?? ""); };`,
    );
    const impresiones = () => pagina.evaluate<string[]>("window.__impresiones");
    const filas = async (tabla: string) =>
      contar(`select count(*)::text as n from ${tabla} where empresa_id = $1`, [mundo.empresa]);

    await ir("/salon");
    await pagina.getByRole("link", { name: "Mesa 7" }).click();
    await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}$/);
    await pagina.getByRole("button", { name: "Tomar pedido" }).click();
    await pagina.getByText("La mesa no tiene pedido").waitFor();
    await pagina.getByRole("button", { name: /^Medialuna/ }).click();
    await pagina.getByLabel("Nota para la cocina", { exact: true }).fill("sin cebolla");
    await pagina.getByRole("button", { name: /^Agregar( ·|$)/ }).click();
    await pagina.getByRole("heading", { name: "Para enviar" }).waitFor();
    // La nota queda en el plato (editable mientras no se envió).
    expect(await pagina.getByLabel("Nota para la cocina", { exact: true }).inputValue()).toBe(
      "sin cebolla",
    );

    // Doble toque en «Enviar a cocina»: un solo envío y un solo diálogo de impresión.
    await pagina.getByRole("button", { name: "Enviar a cocina" }).dblclick();
    await pagina.getByText("Impresa").waitFor();
    expect(await filas("envio_de_comanda")).toBe(1);
    expect(await filas("trabajo_de_impresion")).toBe(1);
    expect(await impresiones()).toHaveLength(1);
    // La comanda impresa lleva la nota bajo el plato y la foto del envío la guarda.
    expect((await impresiones())[0]).toContain("sin cebolla");
    expect(
      await contar(
        "select count(*)::text as n from renglon_de_envio where empresa_id = $1 and nota = 'sin cebolla'",
        [mundo.empresa],
      ),
    ).toBe(1);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    // Anular lo enviado: sin motivo no se puede; con motivo queda el aviso y la línea anulada (no se borra).
    await pagina.reload();
    await pagina.getByRole("heading", { name: "Enviadas" }).waitFor();
    await pagina.getByRole("button", { name: "Anular" }).click();
    const hoja = pagina.getByRole("dialog");
    expect(await hoja.getByRole("button", { name: "Anular" }).isDisabled()).toBe(true);
    await hoja.getByLabel("Motivo", { exact: true }).fill("Se cayó al piso");
    await hoja.getByRole("button", { name: "Anular" }).click();
    await pagina.getByText("Impresa").waitFor();
    expect(await filas("aviso_de_anulacion")).toBe(1);
    expect(
      await contar(
        "select count(*)::text as n from linea_cuenta where empresa_id = $1 and estado = 'ANULADA'",
        [mundo.empresa],
      ),
    ).toBeGreaterThanOrEqual(1);
    // Recargar reinició el espía: lo que cuenta ahora es solo el aviso de anulación, UN diálogo.
    expect(await impresiones()).toHaveLength(1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("una mesa que no existe o un id mal formado dan el genérico, sin romper la página", async () => {
    for (const id of ["11111111-1111-4111-8111-111111111111", "no-es-un-id"]) {
      const respuesta = await ir(`/salon/cuenta/${id}`);
      expect(respuesta?.status()).toBe(200);
      await pagina.getByText("Esta acción no está permitida").first().waitFor();
    }
    vigilante.tomar();
  });
});
