import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «OCULTAR» un producto desde su ficha, de punta a punta en la app REAL construida y con un navegador real: la persona abre la ficha, ve la tarjeta de visibilidad, toca «Ocultar» (con un
 * doble toque), el producto queda oculto en el local, vuelve a mostrarse y se oculta en toda la empresa. Lo que esta prueba ve y las de componentes no: la página en el servidor (permisos,
 * sucursal, lectura de la base), la acción de servidor, las cabeceras de la app (CSP) y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441).
 *
 * Los módulos `catalogo` y `vidriera` están «en desarrollo» en la app real: SOLO en el proceso de esta prueba se leen como «disponibles» (`apoyo/activar-modulos-en-desarrollo.mjs`); la
 * empresa los tiene activos por su plan, como pide el guard. Lo que queda escrito lo comprueba la prueba contra la base.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de Ocultar: de la ficha al producto oculto", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let producto = "";

  const consultar = async (sql: string) =>
    Number(
      (await mundo.mundo.dueno.query<{ n: string }>(sql, [mundo.empresa, producto])).rows[0]?.n,
    );
  const ocultos = () =>
    consultar(
      "select count(*)::text as n from disponibilidad_de_producto where empresa_id = $1 and producto_id = $2 and oculto",
    );
  const auditorias = (accion: string) =>
    consultar(
      `select count(*)::text as n from auditoria_empresa where empresa_id = $1 and entidad_id = $2 and accion = '${accion}'`,
    );
  const boton = (nombre: string) => pagina.getByRole("button", { name: nombre, exact: true });

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      activarModulosEnDesarrollo: true,
    });
    producto = await productoDeBase(mundo.mundo.dueno, mundo.empresa, { nombre: "Medialuna" });
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

  it("la ficha muestra la tarjeta con «Ocultar» y «Ocultar en toda la empresa»; ningún componente rompe", async () => {
    const r = await pagina.goto(`${mundo.url}/catalogo/productos/${producto}`);
    await pagina.waitForLoadState("networkidle");
    expect(r?.status()).toBe(200);
    await boton("Ocultar").waitFor();
    await boton("Ocultar en toda la empresa").waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("«Ocultar» con DOBLE TOQUE: queda oculto en el local, una sola fila y una sola entrada de auditoría", async () => {
    await boton("Ocultar").dblclick();
    await pagina.getByText("Oculto", { exact: true }).waitFor();
    await boton("Volver a mostrar").waitFor();
    expect(await ocultos()).toBe(1);
    expect(await auditorias("PRODUCTO_OCULTADO")).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("«Volver a mostrar» lo muestra de nuevo y no deja nada oculto", async () => {
    await boton("Volver a mostrar").click();
    await boton("Ocultar").waitFor();
    expect(await ocultos()).toBe(0);
    expect(await auditorias("PRODUCTO_MOSTRADO")).toBe(1);
  });

  it("«Ocultar en toda la empresa» lo oculta para todos y la ficha lo dice", async () => {
    await boton("Ocultar en toda la empresa").click();
    await pagina.getByText("Oculto en toda la empresa", { exact: true }).waitFor();
    expect(await ocultos()).toBe(1);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });
});
