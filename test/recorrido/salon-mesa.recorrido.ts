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

  it("una mesa que no existe o un id mal formado dan el genérico, sin romper la página", async () => {
    for (const id of ["11111111-1111-4111-8111-111111111111", "no-es-un-id"]) {
      const respuesta = await ir(`/salon/cuenta/${id}`);
      expect(respuesta?.status()).toBe(200);
      await pagina.getByText("Esta acción no está permitida").first().waitFor();
    }
    vigilante.tomar();
  });
});
