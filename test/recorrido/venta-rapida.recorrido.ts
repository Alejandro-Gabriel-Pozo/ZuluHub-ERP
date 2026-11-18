import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  grupoDeBase,
  opcionDeBase,
  precioDeBase,
  productoDeBase,
} from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * La VENTA RÁPIDA del mostrador, de punta a punta en la app REAL construida y con un navegador real: la persona abre la venta, ve lo que se ofrece, agrega un producto simple, uno por
 * fracciones (con un doble toque en «Agregar») y uno con medida y opciones, y mira el total. Lo que esta prueba ve y las de componentes no: la página en el servidor (el permiso, la
 * sucursal, la lectura de la base), la acción de servidor que cotiza, las cabeceras de la app (CSP) y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441).
 *
 * Los módulos `catalogo`, `caja` y `ventas` están «en desarrollo» en la app real: SOLO en el proceso de esta prueba se leen como «disponibles» (`apoyo/activar-modulos-en-desarrollo.mjs`);
 * la empresa los tiene activos por su plan, como pide el guard. El total y el importe de cada línea los calcula el servidor: la prueba lo comprueba contra la base.
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";

describe.skipIf(base === null)("recorrido de la venta rápida: de la lista al total", () => {
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
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
  const total = () => pagina.locator("[data-total]");
  const tarjeta = (nombre: string) =>
    pagina.getByRole("button", { name: new RegExp(`^${nombre}`) });
  const contarEnLaBase = async (tabla: string) =>
    Number(
      (
        await mundo.mundo.dueno.query<{ n: string }>(
          `select count(*)::text as n from ${tabla} where empresa_id = $1`,
          [mundo.empresa],
        )
      ).rows[0]?.n,
    );

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "caja", "ventas"],
      activarModulosEnDesarrollo: true,
    });
    const c = mundo.mundo.dueno;
    const medialuna = await productoDeBase(c, mundo.empresa, { nombre: "Medialuna" });
    await precioDeBase(c, {
      empresa: mundo.empresa,
      producto: medialuna,
      precio: "800.00",
      desde: DESDE,
    });
    const muzza = await productoDeBase(c, mundo.empresa, { nombre: "Muzzarella", paso: "0.25" });
    await c.query("update producto set porciones_ofrecidas = array[2,4] where id = $1", [muzza]);
    await precioDeBase(c, {
      empresa: mundo.empresa,
      producto: muzza,
      precio: "9000.00",
      desde: DESDE,
    });
    const latte = await productoDeBase(c, mundo.empresa, { nombre: "Latte" });
    const medida = await grupoDeBase(c, mundo.empresa, latte, {
      clase: "VARIANTE",
      nombre: "Tamaño",
      esTamano: true,
      esObligatorio: true,
    });
    const chico = (await opcionDeBase(c, mundo.empresa, latte, medida, { nombre: "Chico" })).opcion;
    const mediano = (await opcionDeBase(c, mundo.empresa, latte, medida, { nombre: "Mediano" }))
      .opcion;
    await precioDeBase(c, {
      empresa: mundo.empresa,
      producto: latte,
      opcion: chico,
      precio: "3200.00",
      desde: DESDE,
    });
    await precioDeBase(c, {
      empresa: mundo.empresa,
      producto: latte,
      opcion: mediano,
      precio: "3800.00",
      desde: DESDE,
    });
    const extras = await grupoDeBase(c, mundo.empresa, latte, {
      clase: "ADICIONAL",
      nombre: "Adicionales",
      admiteVarias: true,
    });
    await opcionDeBase(c, mundo.empresa, latte, extras, {
      nombre: "Leche de almendras",
      recargo: "700.00",
    });

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

  it("la venta muestra lo que se ofrece, con su precio, y ningún componente rompe", async () => {
    const r = await ir("/ventas/venta-rapida");
    expect(r?.status()).toBe(200);
    await tarjeta("Medialuna").waitFor();
    expect(await tarjeta("Medialuna").innerText()).toContain("$ 800,00");
    expect(await tarjeta("Latte").innerText()).toContain("Según medida");
    expect(await tarjeta("Latte").innerText()).toContain("Con opciones");
    expect(await total().innerText()).toBe("");
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("un producto simple: toca, «Agregar» y el total es el que calcula el servidor", async () => {
    await tarjeta("Medialuna").click();
    await pagina.getByRole("dialog", { name: "Medialuna" }).waitFor();
    await sinViolacionesDeAxe();
    await pagina.getByRole("button", { name: "Agregar" }).click();
    await expect.poll(() => total().innerText()).toBe("$ 800,00");
    pantallaLimpia();
  });

  it("por fracciones con DOBLE TOQUE en «Agregar»: entra una sola vez (4 ½) y el total sigue siendo del servidor", async () => {
    await pagina.waitForTimeout(600); // la espera de 500 ms tras cerrar la hoja
    await tarjeta("Muzzarella").click();
    await pagina.getByRole("textbox", { name: "Cantidad" }).fill("4");
    await pagina.getByRole("button", { name: "½" }).click();
    await pagina.getByRole("button", { name: "Agregar" }).dblclick();
    // 800 + 4,5 × 9000 = 41.300
    await expect.poll(() => total().innerText()).toBe("$ 41.300,00");
    await pagina.getByRole("button", { name: /Ver cuenta/ }).click();
    await pagina.getByText("4 ½ Muzzarella").waitFor();
    expect(await pagina.getByText("4 ½ Muzzarella").count()).toBe(1);
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("con medida y opciones: «Agregar» espera la medida y el total suma el recargo (hecho por el servidor)", async () => {
    await pagina.waitForTimeout(600);
    await tarjeta("Latte").click();
    expect(await pagina.getByRole("button", { name: "Agregar" }).isDisabled()).toBe(true);
    await pagina.getByRole("radio", { name: /Mediano/ }).check();
    await pagina.getByRole("checkbox", { name: /Leche de almendras/ }).check();
    await pagina.getByRole("button", { name: "Agregar" }).click();
    // 41.300 + 3.800 + 700 = 45.800
    await expect.poll(() => total().innerText()).toBe("$ 45.800,00");
    pantallaLimpia();
  });

  it("la cuenta se corrige escribiendo la cantidad y el total vuelve a salir del servidor; nada se escribe en la base", async () => {
    const campo = pagina.getByRole("textbox", { name: "Cantidad" }).first();
    await campo.fill("2");
    await expect.poll(() => total().innerText()).toBe("$ 46.600,00"); // 2 × 800 + 40.500 + 4.500
    await campo.fill("0");
    await pagina.getByText("Cantidad no válida").waitFor();
    expect(await total().innerText()).toBe("$ 46.600,00"); // lo no válido no se manda
    pantallaLimpia();
    // Armar la cuenta es local: no hay cuentas, tickets ni cobros, y la auditoría no se movió.
    expect(await contarEnLaBase("cuenta_consumo")).toBe(0);
    expect(await contarEnLaBase("ticket")).toBe(0);
  });
});
