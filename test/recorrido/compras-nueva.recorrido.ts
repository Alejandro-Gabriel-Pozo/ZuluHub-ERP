import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PREFIJO_DE_NAVEGADOR } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { crearAsignacionDeBase } from "../integracion/fixtures-identidad";
import { proveedorDeBase } from "../integracion/compras-apoyo";
import { depositoDeBase, existenciaDe } from "../integracion/stock-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «NUEVA COMPRA» de punta a punta en la app REAL con un navegador real (Compras PR 6b): la lista ofrece «Nueva compra»; se elige el proveedor, se agrega el producto, el servidor dice lo que entra al
 * stock ANTES de guardar, y «Comprar y recibir» abre la ficha. Lo que no ven las pruebas de componentes ni las de integración: las acciones de Next con su clave (un doble clic real en el botón es UNA compra y
 * UNA entrada de stock), dos pestañas comprando a la vez el mismo producto (el stock suma las dos), el remito repetido, el alta de proveedor sin salir de la compra (un doble clic es UN proveedor) y que
 * ningún componente rompa en el navegador.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de «Nueva compra»: de la lista a la ficha", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let m: { empresa: string; persona: string; sucursal: string };
  let deposito = "";
  let articulo = "";

  const dueno = () => mundo.mundo.dueno;
  const ir = async (p: Page, ruta: string) => {
    const respuesta = await p.goto(`${mundo.url}${ruta}`);
    await p.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async (p: Page = pagina) =>
    expect(await violacionesGravesDeAxe(p)).toEqual([]);
  const contar = async (sql: string, parametros: unknown[]) =>
    Number((await dueno().query<{ n: string }>(sql, parametros)).rows[0]?.n);
  const recepciones = () =>
    contar("select count(*) as n from recepcion where empresa_id = $1", [mundo.empresa]);

  /** Elige el proveedor y agrega el producto, con cantidad y precio. */
  async function cargar(p: Page, cantidad: string, precio: string) {
    await ir(p, "/compras/nueva");
    await p.getByRole("combobox", { name: "Proveedor" }).pressSequentially("Carnes");
    await p.getByRole("option", { name: /Carnes del Sur/ }).click();
    await p.getByRole("combobox", { name: "Agregar producto" }).pressSequentially("Bife");
    await p.getByRole("option", { name: /Bife de chorizo/ }).click();
    await p.getByLabel("Cantidad").pressSequentially(cantidad);
    await p.getByLabel("Precio", { exact: true }).pressSequentially(precio);
  }

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "clientes", "compras", "stock"],
      activarModulosEnDesarrollo: true,
    });
    const c = dueno();
    const sucursal = (
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
    // La persona pasa a ser operadora de SU sucursal (carga compras; el rol sale de la base).
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
    m = { empresa: mundo.empresa, persona, sucursal };
    await proveedorDeBase(c, m, "Carnes del Sur");
    deposito = await depositoDeBase(c, m);
    const producto = await productoDeBase(c, mundo.empresa, {
      nombre: "Bife de chorizo",
      clase: "MATERIA_PRIMA",
      unidadBase: "KILOGRAMO",
      dimension: "MASA",
    });
    articulo = randomUUID();
    await c.query(
      `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'KILOGRAMO', 'MASA')`,
      [articulo, mundo.empresa, producto],
    );
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
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

  it("la lista ofrece «Nueva compra»; el servidor dice lo que entra al stock antes de guardar; un DOBLE CLIC en «Comprar y recibir» es UNA compra y UNA entrada de stock, y abre la ficha", async () => {
    await ir(pagina, "/compras");
    await pagina.getByRole("link", { name: "Nueva compra" }).click();
    await pagina.waitForURL(/\/compras\/nueva$/);
    await cargar(pagina, "2", "11000");
    await pagina.getByText("Entra a tu stock: 2 Kilogramo").waitFor();
    await pagina.getByText("Costo por unidad de stock: $ 11.000,00").waitFor();
    await sinViolacionesDeAxe();
    expect(await recepciones()).toBe(0);
    await pagina.getByRole("button", { name: "Comprar y recibir" }).dblclick();
    await pagina.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
    await pagina.getByRole("heading", { name: /^Compra \d+$/ }).waitFor();
    await pagina.getByText("Bife de chorizo").waitFor();
    await pagina.getByText(/Entra a tu stock: 2 Kilogramo/).waitFor();
    expect(await recepciones()).toBe(1);
    expect(
      await contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [
        deposito,
      ]),
    ).toBe(1);
    expect(await existenciaDe(dueno(), deposito, articulo)).toBe("2.0000");
    expect(
      await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'COMPRA_REGISTRADA'",
        [mundo.empresa],
      ),
    ).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("dos pestañas compran el mismo producto a la vez: las dos compras quedan y el stock suma las dos", async () => {
    const otra = await contexto.newPage();
    try {
      await Promise.all([cargar(pagina, "3", "11000"), cargar(otra, "4", "11000")]);
      await Promise.all([
        pagina.getByRole("button", { name: "Comprar y recibir" }).click(),
        otra.getByRole("button", { name: "Comprar y recibir" }).click(),
      ]);
      await Promise.all([
        pagina.waitForURL(/\/compras\/[0-9a-f-]{36}$/),
        otra.waitForURL(/\/compras\/[0-9a-f-]{36}$/),
      ]);
      expect(await recepciones()).toBe(3);
      expect(await existenciaDe(dueno(), deposito, articulo)).toBe("9.0000");
    } finally {
      await otra.close();
    }
  });

  it("un remito ya cargado del mismo proveedor se rechaza con su texto, no navega y no entra stock", async () => {
    const remito = async () => {
      await pagina.getByLabel("Punto de venta").pressSequentially("2");
      await pagina.getByLabel("Número", { exact: true }).pressSequentially("7842");
      await pagina.getByLabel("Fecha del remito").fill("2026-11-05");
    };
    await cargar(pagina, "1", "11000");
    await remito();
    await pagina.getByRole("button", { name: "Comprar y recibir" }).click();
    await pagina.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
    const antes = await existenciaDe(dueno(), deposito, articulo);
    await cargar(pagina, "1", "11000");
    await remito();
    await pagina.getByRole("button", { name: "Comprar y recibir" }).click();
    await pagina.getByText("Ese remito ya está cargado").waitFor();
    expect(pagina.url()).toMatch(/\/compras\/nueva$/);
    expect(await existenciaDe(dueno(), deposito, articulo)).toBe(antes);
    await sinViolacionesDeAxe();
  });

  it("«Agregar proveedor» sin salir de la compra: un doble clic crea UN proveedor con el rol Proveedor y queda elegido", async () => {
    await ir(pagina, "/compras/nueva");
    await pagina.getByRole("button", { name: "Agregar proveedor" }).click();
    await pagina.getByLabel("Razón social").pressSequentially("Verdulería Oeste");
    await sinViolacionesDeAxe();
    await pagina.getByRole("button", { name: "Agregar", exact: true }).dblclick();
    await pagina.getByRole("combobox", { name: "Proveedor" }).waitFor();
    await expect
      .poll(async () => pagina.getByRole("combobox", { name: "Proveedor" }).inputValue())
      .toBe("Verdulería Oeste");
    expect(
      await contar(
        `select count(*) as n from parte p join parte_rol r on r.parte_id = p.id and r.empresa_id = p.empresa_id
          where p.empresa_id = $1 and p.nombre = 'Verdulería Oeste' and r.rol = 'PROVEEDOR'`,
        [mundo.empresa],
      ),
    ).toBe(1);
  });

  it("un nombre de proveedor repetido avisa pero no bloquea: el segundo «Agregar» lo agrega igual", async () => {
    await ir(pagina, "/compras/nueva");
    await pagina.getByRole("button", { name: "Agregar proveedor" }).click();
    await pagina.getByLabel("Razón social").pressSequentially("Verdulería Oeste");
    await pagina.getByRole("button", { name: "Agregar", exact: true }).click();
    await pagina.getByText("Ya existe un proveedor con ese nombre").waitFor();
    await pagina.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect
      .poll(async () => pagina.getByRole("combobox", { name: "Proveedor" }).inputValue())
      .toBe("Verdulería Oeste");
    expect(
      await contar(
        "select count(*) as n from parte where empresa_id = $1 and nombre = 'Verdulería Oeste'",
        [mundo.empresa],
      ),
    ).toBe(2);
  });
});
