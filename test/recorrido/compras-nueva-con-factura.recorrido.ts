import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PREFIJO_DE_NAVEGADOR } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { proveedorDeBase } from "../integracion/compras-apoyo";
import { cuitUnico } from "../integracion/unicos";
import { crearDomicilio } from "../integracion/fiscal-apoyo";
import { crearAsignacionDeBase } from "../integracion/fixtures-identidad";
import { depositoDeBase } from "../integracion/stock-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * La factura A pide la condición de la empresa frente al IVA: SIN ella se rechaza con el genérico y la compra no se guarda; con ella (responsable inscripto, cargada como datos fiscales confirmados) se guarda con su IVA. La C (sin IVA discriminado) no la pide.
 * «NUEVA COMPRA CON FACTURA» de punta a punta en la app REAL con un navegador real (Compras PR 7), con la persona como OPERADORA (quien carga las compras y no puede cambiar el nivel): en «Sin factura» no hay bloque de
 * factura; en «Con factura» aparece (lo dice el servidor), cada línea se precarga del renglón, el servidor cuenta y avisa si el total no coincide («se carga igual»), la primera factura de un proveedor sin CUIT lo pide y lo guarda, y
 * un DOBLE CLIC en «Comprar y recibir» es UNA compra, UN comprobante y UNA entrada de stock. La misma factura otra vez dice «Esa factura ya está cargada» y no escribe. Lo que no ven los componentes: las acciones de Next reales,
 * la lectura del nivel y de las cuentas por el servidor y que ningún componente rompa en el navegador.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de «Nueva compra» con factura", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let proveedor = "";
  let persona = "";
  const cuit = cuitUnico();

  const dueno = () => mundo.mundo.dueno;
  const ir = async (ruta: string) => {
    await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
  };
  const contar = async (sql: string, parametros: unknown[]) =>
    Number((await dueno().query<{ n: string }>(sql, parametros)).rows[0]?.n);
  const recepciones = () =>
    contar("select count(*) as n from recepcion where empresa_id = $1", [mundo.empresa]);
  const comprobantes = () =>
    contar("select count(*) as n from comprobante_de_proveedor where empresa_id = $1", [
      mundo.empresa,
    ]);

  async function cargar() {
    await ir("/compras/nueva");
    await pagina.getByRole("combobox", { name: "Proveedor" }).pressSequentially("Carnes");
    await pagina.getByRole("option", { name: /Carnes del Sur/ }).click();
    await pagina.getByRole("combobox", { name: "Agregar producto" }).pressSequentially("Bife");
    await pagina.getByRole("option", { name: /Bife de chorizo/ }).click();
    await pagina.getByLabel("Cantidad", { exact: true }).pressSequentially("2");
    await pagina.getByLabel("Precio", { exact: true }).pressSequentially("1000");
  }
  async function cargarLaFactura(numero: string, total: string, tipo = "FACTURA_C") {
    await pagina.getByLabel("Tipo").selectOption(tipo);
    await pagina.getByLabel("Punto de venta").nth(1).fill("5");
    await pagina.getByLabel("Número").nth(1).fill(numero);
    await pagina.getByLabel("Fecha de la factura").fill("2026-11-20");
    await pagina.getByLabel("Total según la factura").pressSequentially(total);
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
    persona = (
      await c.query<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 limit 1",
        [mundo.empresa],
      )
    ).rows[0]?.persona_id as string;
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
    proveedor = await proveedorDeBase(c, m, "Carnes del Sur");
    await depositoDeBase(c, m);
    const producto = await productoDeBase(c, mundo.empresa, {
      nombre: "Bife de chorizo",
      clase: "MATERIA_PRIMA",
      unidadBase: "KILOGRAMO",
      dimension: "MASA",
    });
    await c.query(
      `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'KILOGRAMO', 'MASA')`,
      [randomUUID(), mundo.empresa, producto],
    );
    // El proveedor declara el punto de venta 5 en su ficha (la ficha de compra se crea con su primer dato).
    await c.query(
      "insert into ficha_de_compra_del_proveedor (empresa_id, parte_id, letra_esperada) values ($1, $2, 'A') on conflict do nothing",
      [mundo.empresa, proveedor],
    );
    await c.query(
      "insert into punto_de_venta_de_la_ficha (empresa_id, parte_id, numero) values ($1, $2, 5)",
      [mundo.empresa, proveedor],
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

  it("en «Sin factura» (el nivel inicial) no hay bloque de factura, y mirar la pantalla no crea la configuración", async () => {
    await cargar();
    expect(await pagina.getByLabel("Tipo").count()).toBe(0);
    expect(
      await contar("select count(*) as n from configuracion_de_compras where empresa_id = $1", [
        mundo.empresa,
      ]),
    ).toBe(0);
  });

  it("en «Con factura» quien opera ve el bloque: precarga del renglón, el servidor cuenta y avisa si el total no coincide; un DOBLE CLIC es UNA compra, UN comprobante; la primera factura guarda el CUIT del proveedor", async () => {
    await dueno().query(
      "insert into configuracion_de_compras (empresa_id, nivel) values ($1, 'CON_COMPROBANTE') on conflict (empresa_id) do update set nivel = 'CON_COMPROBANTE'",
      [mundo.empresa],
    );
    await cargar();
    await pagina.getByLabel("Tipo").waitFor();
    expect(await pagina.getByRole("button", { name: "Comprar y recibir" }).isDisabled()).toBe(true);
    await cargarLaFactura("1187", "2500");
    await pagina.getByText("Total calculado").waitFor();
    await pagina.getByText("$ 2.000,00").first().waitFor();
    await pagina.getByText("El total no coincide").waitFor();
    await pagina.getByLabel("CUIT").fill(cuit);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.getByRole("button", { name: "Comprar y recibir" }).dblclick();
    await pagina.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
    await pagina.getByRole("heading", { name: /^Compra \d+$/ }).waitFor();
    await pagina.getByText(/Factura C 00005-00001187/).waitFor();
    expect(await recepciones()).toBe(1);
    expect(await comprobantes()).toBe(1);
    expect(
      await contar("select count(*) as n from parte where id = $1 and documento_numero = $2", [
        proveedor,
        cuit,
      ]),
    ).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("la MISMA factura otra vez dice «Esa factura ya está cargada» y no escribe nada; con el proveedor ya con CUIT no lo vuelve a pedir", async () => {
    await cargar();
    await pagina.getByLabel("Tipo").waitFor();
    expect(await pagina.getByLabel("CUIT").count()).toBe(0);
    await cargarLaFactura("1187", "2000");
    await pagina.getByRole("button", { name: "Comprar y recibir" }).click();
    await pagina.getByText("Esa factura ya está cargada").waitFor();
    expect(await recepciones()).toBe(1);
    expect(await comprobantes()).toBe(1);
  });

  it("una factura A SIN la condición de la empresa frente al IVA se rechaza con el genérico y la compra no se guarda", async () => {
    const compras = await recepciones();
    const facturas = await comprobantes();
    await cargar();
    await pagina.getByLabel("Tipo").waitFor();
    await cargarLaFactura("1190", "2420", "FACTURA_A");
    await pagina.getByText("Total calculado").waitFor();
    await pagina.getByRole("button", { name: "Comprar y recibir" }).click();
    await pagina.getByText("Esta acción no está permitida").waitFor();
    expect(await recepciones()).toBe(compras);
    expect(await comprobantes()).toBe(facturas);
  });

  it("con la empresa responsable inscripto (datos fiscales confirmados) la factura A se guarda con su IVA: total calculado y total del papel coinciden", async () => {
    const c = dueno();
    const emisor = (
      await c.query<{ id: string }>(
        "select id from emisor where empresa_id = $1 and es_principal",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    const domicilio = await crearDomicilio(c, mundo.empresa);
    const id = randomUUID();
    await c.query(
      `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id, inicio_actividades, iibb_numero, iibb_condicion, creado_por)
       values ($1, $2, $3, 'Panadería Zulú SA', 'RESPONSABLE_INSCRIPTO', $4, '2020-01-01', '901-123456-7', 'LOCAL', $5)`,
      [id, mundo.empresa, emisor, domicilio, persona],
    );
    await c.query(
      `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), confirmada_en = now(), confirmada_por = $2, motivo = 'alta' where id = $1`,
      [id, persona],
    );
    const compras = await recepciones();
    await cargar();
    await pagina.getByLabel("Tipo").waitFor();
    await cargarLaFactura("1190", "2420", "FACTURA_A");
    await pagina.getByText("$ 2.420,00").first().waitFor();
    await pagina.getByText("El total coincide con la factura").waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.getByRole("button", { name: "Comprar y recibir" }).dblclick();
    await pagina.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
    await pagina.getByText(/Factura A 00005-00001190/).waitFor();
    expect(await recepciones()).toBe(compras + 1);
    expect(
      await contar(
        "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and tipo = 'FACTURA_A' and iva = 420 and total_calculado = 2420",
        [mundo.empresa],
      ),
    ).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });
});
