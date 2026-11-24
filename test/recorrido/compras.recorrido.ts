import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PREFIJO_DE_NAVEGADOR } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { crearAsignacionDeBase } from "../integracion/fixtures-identidad";
import {
  claveDeCompra,
  huellaAlAzar,
  proveedorDeBase,
  recepcionDeBase,
} from "../integracion/compras-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «COMPRAS» de punta a punta en la app REAL con un navegador real (Compras PR 3, solo lectura): la lista de la sucursal muestra las compras cargadas (la más nueva arriba, con su proveedor, «Recibida sin
 * facturar» y el total o «Sin precio», nunca cero); la entrada del menú está; el filtro por fechas sin resultados dice «Sin resultados» y «Ver todas» vuelve a la lista; la ficha trae las líneas con lo
 * que entra a tu stock y quién la cargó; la ficha de una compra de otra sucursal, la de un id inexistente y la de un id mal escrito responden el genérico. Lo que no ven las pruebas de componentes: las dos
 * páginas en el servidor, el filtro como formulario GET de verdad, el alcance por sucursal y que ningún componente rompa en el navegador. Las compras se siembran en la base (cargarlas es otra pantalla).
 */
const base = inject("baseDePruebas");
const GENERICO = "Esta acción no está permitida";

describe.skipIf(base === null)("recorrido de compras: de la lista a la ficha", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let deOtraSucursal = "";
  let sucursal = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "clientes", "compras"],
      activarModulosEnDesarrollo: true,
    });
    const c = mundo.mundo.dueno;
    sucursal = (
      await c.query<{ id: string }>("select id from sucursal where empresa_id = $1 limit 1", [
        mundo.empresa,
      ])
    ).rows[0]?.id as string;
    const persona = (
      await c.query<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 limit 1",
        [mundo.empresa],
      )
    ).rows[0]?.persona_id as string;
    // La persona pasa a ser operadora de SU sucursal: el alcance de sucursales sale de la base y la de «Norte» queda fuera.
    // Un disparador impide cambiar el rol fuera de un traspaso de gerencia: acá lo hace el dueño de la base, sin disparadores y solo en esta transacción.
    await c.query("begin");
    try {
      await c.query("set local session_replication_role = replica");
      await c.query(
        "update membresia set rol = 'OPERADOR' where empresa_id = $1 and persona_id = $2",
        [mundo.empresa, persona],
      );
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    await crearAsignacionDeBase(c, mundo.empresa, persona, sucursal);
    const m = { empresa: mundo.empresa, persona, sucursal };
    const proveedor = await proveedorDeBase(c, m, "Carnes del Sur");
    const producto = await productoDeBase(c, mundo.empresa, {
      nombre: "Bife de chorizo",
      clase: "MATERIA_PRIMA",
    });
    // Compra 1: sin precio. Compra 2: con precio (10 unidades a 100 = 1000,00).
    await recepcionDeBase(c, m, proveedor, producto, { hechoEn: "2026-11-10T15:00:00Z" });
    await recepcionDeBase(c, m, proveedor, producto, {
      hechoEn: "2026-11-10T16:00:00Z",
    });
    // La línea de una recepción solo entra con su cabecera: se siembra otra compra con precio en una transacción propia.
    await c.query("begin");
    try {
      const id = randomUUID();
      await c.query(
        `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, hecho_en, clave_idempotencia, huella, registrado_por)
         values ($1, $2, $3, $4, 'COMPRA_SIMPLE', '2026-11-10T17:00:00Z', $5, $6, $7)`,
        [id, m.empresa, m.sucursal, proveedor, claveDeCompra(), huellaAlAzar(), m.persona],
      );
      await c.query(
        `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock,
           precio_por_tipo, unidad_de_precio_id, precio, importe, costo_por_unidad_de_stock)
         values ($1, $2, 1, $3, 'UNIDAD', 10, 10, 'UNIDAD', 'UNIDAD', 100, 1000, 100)`,
        [m.empresa, id, producto],
      );
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    // Una compra de OTRA sucursal de la misma empresa: la persona del recorrido trabaja en la suya.
    const otra = (
      await c.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    deOtraSucursal = await recepcionDeBase(c, { ...m, sucursal: otra }, proveedor, producto);
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    // Con dos sucursales abiertas la persona elige con cuál trabaja (cookie validada por el servidor): la propia, no la «Norte».
    await contexto.addCookies([
      ...mundo.cookies,
      {
        // La misma cookie que pone el servidor (`COOKIE_DE_SUCURSAL`, que no se puede importar acá: es de `server-only`).
        name: `${PREFIJO_DE_NAVEGADOR}pd_sucursal`,
        value: sucursal,
        domain: HOST_DEL_RECORRIDO,
        path: "/",
        httpOnly: true,
        secure: true,
      },
    ]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("la lista muestra las compras de la sucursal (la más nueva primero) con «Sin precio» y nunca cero; la entrada del menú lleva a /compras", async () => {
    await ir("/compras");
    await pagina
      .getByRole("link", { name: /^Compra \d+ · Carnes del Sur, Recibida sin facturar, / })
      .first()
      .waitFor();
    const filas: (string | null)[] = [];
    for (const enlace of await pagina.getByRole("link", { name: /^Compra \d+ · / }).all()) {
      filas.push(await enlace.getAttribute("aria-label"));
    }
    expect(filas).toEqual([
      "Compra 3 · Carnes del Sur, Recibida sin facturar, $ 1.000,00",
      "Compra 2 · Carnes del Sur, Recibida sin facturar, Sin precio",
      "Compra 1 · Carnes del Sur, Recibida sin facturar, Sin precio",
    ]);
    expect(await pagina.locator("body").innerText()).not.toContain("$ 0,00");
    await pagina
      .getByRole("navigation", { name: "Navegación principal" })
      .getByText("Compras", { exact: true })
      .first()
      .click();
    const entrada = pagina
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Compras", exact: true });
    await entrada.waitFor();
    expect(await entrada.getAttribute("href")).toBe("/compras");
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("el filtro por fechas es un formulario GET: sin resultados dice «Sin resultados» y «Ver todas» vuelve a la lista; «Sin facturar» se aplica", async () => {
    await ir("/compras");
    await pagina.getByLabel("Desde").fill("2030-01-01");
    await pagina.getByRole("button", { name: "Aplicar filtros" }).click();
    await pagina.waitForURL(/desde=2030-01-01/);
    await pagina.getByText("Sin resultados").waitFor();
    await sinViolacionesDeAxe();
    await pagina.getByRole("link", { name: "Ver todas" }).click();
    await pagina.getByRole("link", { name: /^Compra 3 · / }).waitFor();
    await pagina.getByRole("radio", { name: "Sin facturar" }).check();
    await pagina.getByRole("button", { name: "Aplicar filtros" }).dblclick();
    await pagina.waitForURL(/estado=SIN_FACTURAR/);
    await pagina.getByRole("link", { name: /^Compra 3 · / }).waitFor();
    expect(await pagina.getByRole("link", { name: /^Compra \d+ · / }).count()).toBe(3);
    // Una dirección armada a mano con un estado inventado vuelve a «Todas»; no rompe.
    await ir("/compras?estado=inventado&desde=ayer");
    expect(await pagina.getByRole("link", { name: /^Compra \d+ · / }).count()).toBe(3);
    pantallaLimpia();
  });

  it("la ficha trae las líneas con lo que entra a tu stock, el remito y quién la cargó; solo «Volver»", async () => {
    await ir("/compras");
    await pagina.getByRole("link", { name: /^Compra 3 · / }).click();
    await pagina.getByRole("heading", { name: "Compra 3" }).waitFor();
    await pagina.getByText("Bife de chorizo").waitFor();
    await pagina.getByText(/Entra a tu stock: 10 Unidad/).waitFor();
    await pagina.getByText(/^Costo por unidad de stock: \$ 100,00$/).waitFor();
    await pagina.getByText("Sin remito").waitFor();
    expect(await pagina.getByRole("main").getByRole("button").count()).toBe(0);
    await sinViolacionesDeAxe();
    await pagina.getByRole("link", { name: "Volver", exact: true }).click();
    await pagina.getByRole("link", { name: /^Compra 3 · / }).waitFor();
    pantallaLimpia();
  });

  it("la ficha de una compra de otra sucursal, de un id inexistente o mal escrito responde el genérico", async () => {
    await ir(`/compras/${deOtraSucursal}`);
    await pagina.getByText(GENERICO).waitFor();
    await ir("/compras/0b0b0b0b-1111-4222-8333-444444444444");
    await pagina.getByText(GENERICO).waitFor();
    await ir("/compras/no-es-un-id");
    await pagina.getByText(GENERICO).waitFor();
  });
});
