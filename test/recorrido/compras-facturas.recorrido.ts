import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PREFIJO_DE_NAVEGADOR } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { crearAsignacionDeBase } from "../integracion/fixtures-identidad";
import { proveedorDeBase } from "../integracion/compras-apoyo";
import { depositoDeBase } from "../integracion/stock-apoyo";
import { cuitUnico } from "../integracion/unicos";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «FACTURAS» de punta a punta en la app REAL con un navegador real (Compras 4, la factura de la empresa y su conciliación): el operador carga la factura de la EMPRESA (sin sucursal ni stock) y un doble clic real es
 * UNA factura «Facturada, falta recibir»; el gerente recibe y confirma lo de su sucursal, la factura pasa a «Falta conciliar», «Conciliar» trae la propuesta, un doble clic real en «Confirmar conciliación» es UNA
 * conciliación y la factura queda «Conciliada en parte»; dos pestañas conciliando la misma mercadería a la vez dejan UNA; «Anular conciliación» devuelve el saldo; y ningún componente rompe en el navegador (sin
 * errores de consola ni violaciones graves de accesibilidad). Lo que no ven las pruebas de componentes ni las de integración: las acciones de Next con su clave y el rol que sale de la base.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de «Facturas»: de «Cargar factura» a «Anular conciliación»",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    let m: { empresa: string; persona: string; sucursal: string };
    let facturaId = "";
    const cuit = cuitUnico();

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
    const facturas = () =>
      contar("select count(*) as n from comprobante_de_proveedor where empresa_id = $1", [
        mundo.empresa,
      ]);
    const conciliaciones = (acto = "CONCILIACION") =>
      contar("select count(*) as n from conciliacion where empresa_id = $1 and acto = $2", [
        mundo.empresa,
        acto,
      ]);
    const movimientos = () =>
      contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
        mundo.empresa,
      ]);
    const conRol = async (rol: "OPERADOR" | "GERENTE") => {
      const c = dueno();
      await c.query("begin");
      try {
        await c.query("set local session_replication_role = replica");
        await c.query("update membresia set rol = $3 where empresa_id = $1 and persona_id = $2", [
          mundo.empresa,
          m.persona,
          rol,
        ]);
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    };

    /** Recibe y confirma `cantidad` kilos de harina en la sucursal (como gerente). */
    async function recibirYConfirmar(cantidad: string) {
      await ir(pagina, "/compras/recepciones/recibir");
      await pagina.getByRole("combobox", { name: "Proveedor" }).pressSequentially("Distribuidora");
      await pagina.getByRole("option", { name: /Distribuidora Central/ }).click();
      await pagina.getByRole("combobox", { name: "Agregar producto" }).pressSequentially("Harina");
      await pagina.getByRole("option", { name: /Harina 000/ }).click();
      await pagina.getByLabel("Cantidad").pressSequentially(cantidad);
      await pagina.getByRole("button", { name: "Recibir", exact: true }).click();
      await pagina.waitForURL(/\/compras\/recepciones\/[0-9a-f-]{36}$/);
      await pagina.getByRole("button", { name: "Confirmar recepción" }).click();
      await pagina.getByText("Recibida sin facturar", { exact: true }).waitFor();
    }

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulosAdicionales: ["catalogo", "clientes", "compras", "stock"],
        perillas: { recepcion_separada: { tipo: "INTERRUPTOR", encendida: true } },
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
      m = { empresa: mundo.empresa, persona, sucursal };
      await conRol("OPERADOR");
      await crearAsignacionDeBase(c, mundo.empresa, persona, sucursal);
      const proveedor = await proveedorDeBase(c, m, "Distribuidora Central");
      await depositoDeBase(c, m);
      const producto = await productoDeBase(c, mundo.empresa, {
        nombre: "Harina 000",
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
        "insert into ficha_de_compra_del_proveedor (empresa_id, parte_id, letra_esperada) values ($1, $2, 'C') on conflict do nothing",
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

    it("el operador abre «Cargar factura» desde la lista: NO hay sucursal, remito ni depósito; un DOBLE CLIC real es UNA factura «Facturada, falta recibir», sin stock, y su detalle no ofrece «Conciliar»", async () => {
      await ir(pagina, "/compras/facturas");
      await pagina.getByRole("link", { name: "Cargar factura" }).click();
      await pagina.waitForURL(/\/compras\/facturas\/nueva$/);
      await pagina.getByRole("combobox", { name: "Proveedor" }).pressSequentially("Distribuidora");
      await pagina.getByRole("option", { name: /Distribuidora Central/ }).click();
      await pagina.getByRole("combobox", { name: "Agregar producto" }).pressSequentially("Harina");
      await pagina.getByRole("option", { name: /Harina 000/ }).click();
      await pagina.getByLabel("Tipo").selectOption("FACTURA_C");
      await pagina.getByLabel("Punto de venta").fill("5");
      await pagina.getByLabel("Número").fill("1187");
      await pagina.getByLabel("Fecha de la factura").fill("2026-11-20");
      await pagina.getByLabel("CUIT").fill(cuit);
      await pagina.getByLabel("Cantidad facturada").pressSequentially("100");
      await pagina.getByLabel("Precio neto").pressSequentially("1000");
      await pagina.getByLabel("Total según la factura").pressSequentially("100000");
      await pagina.getByText("El total coincide con la factura").waitFor();
      expect(await pagina.getByLabel("Sucursal").count()).toBe(0);
      expect(await pagina.getByLabel("Depósito").count()).toBe(0);
      expect(await pagina.getByText("Remito del proveedor").count()).toBe(0);
      await sinViolacionesDeAxe();
      expect(await facturas()).toBe(0);
      await pagina.getByRole("button", { name: "Cargar factura", exact: true }).dblclick();
      await pagina.waitForURL(/\/compras\/facturas\/[0-9a-f-]{36}$/);
      facturaId = new URL(pagina.url()).pathname.split("/").at(-1) as string;
      await pagina.getByText("Facturada, falta recibir", { exact: true }).waitFor();
      await pagina.getByText("Harina 000", { exact: true }).waitFor();
      expect(await facturas()).toBe(1);
      expect(await movimientos()).toBe(0);
      expect(await pagina.getByRole("link", { name: "Conciliar", exact: true }).count()).toBe(0);
      expect(await pagina.getByRole("heading", { name: "Conciliaciones" }).count()).toBe(0);
      await sinViolacionesDeAxe();
      expect(vigilante.tomar()).toEqual([]);
    });

    it("el gerente recibe y confirma lo suyo: la factura pasa a «Falta conciliar», «Conciliar» trae la propuesta y un DOBLE CLIC real en «Confirmar conciliación» es UNA conciliación («Conciliada en parte»)", async () => {
      await conRol("GERENTE");
      await recibirYConfirmar("60");
      await ir(pagina, `/compras/facturas/${facturaId}`);
      await pagina.getByText("Falta conciliar", { exact: true }).waitFor();
      await pagina
        .getByText(/Recibido/)
        .first()
        .waitFor();
      await sinViolacionesDeAxe();
      await pagina.getByRole("link", { name: "Conciliar", exact: true }).click();
      await pagina.waitForURL(/\/conciliar$/);
      // La propuesta: lo recibido (60) cubre parte de lo facturado (100).
      await pagina.getByLabel(/^A conciliar/).waitFor();
      expect(await pagina.getByLabel(/^A conciliar/).inputValue()).toBe("60");
      await sinViolacionesDeAxe();
      expect(await conciliaciones()).toBe(0);
      await pagina.getByRole("button", { name: "Confirmar conciliación" }).dblclick();
      await pagina.waitForURL(new RegExp(`/compras/facturas/${facturaId}$`));
      await pagina.getByText("Conciliada en parte", { exact: true }).waitFor();
      expect(await conciliaciones()).toBe(1);
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'CONCILIACION_REGISTRADA'",
          [mundo.empresa],
        ),
      ).toBe(1);
      await pagina.getByRole("heading", { name: "Conciliaciones" }).waitFor();
      await pagina.getByRole("button", { name: "Anular conciliación" }).waitFor();
      await sinViolacionesDeAxe();
      expect(vigilante.tomar()).toEqual([]);
    });

    it("dos pestañas concilian lo mismo a la vez: UNA gana y la otra ve el genérico; nunca se concilia más de lo recibido", async () => {
      await recibirYConfirmar("40");
      const ruta = `/compras/facturas/${facturaId}/conciliar`;
      const otra = await contexto.newPage();
      try {
        await Promise.all([ir(pagina, ruta), ir(otra, ruta)]);
        await Promise.all([
          pagina.getByLabel(/^A conciliar/).waitFor(),
          otra.getByLabel(/^A conciliar/).waitFor(),
        ]);
        expect(await pagina.getByLabel(/^A conciliar/).inputValue()).toBe("40");
        expect(await otra.getByLabel(/^A conciliar/).inputValue()).toBe("40");
        await Promise.all([
          pagina.getByRole("button", { name: "Confirmar conciliación" }).click(),
          otra.getByRole("button", { name: "Confirmar conciliación" }).click(),
        ]);
        // Una navega al detalle (ganó) y la otra se queda con el rechazo genérico.
        await Promise.race([
          pagina.waitForURL(new RegExp(`/compras/facturas/${facturaId}$`)),
          otra.waitForURL(new RegExp(`/compras/facturas/${facturaId}$`)),
        ]);
        await Promise.race([
          pagina.getByText("Esta acción no está permitida").waitFor(),
          otra.getByText("Esta acción no está permitida").waitFor(),
        ]);
        expect(await conciliaciones()).toBe(2);
        expect(
          await contar(
            "select count(*) as n from saldo_de_linea_de_comprobante where empresa_id = $1 and cantidad_asignada > cantidad_facturada",
            [mundo.empresa],
          ),
        ).toBe(0);
        expect(
          await contar(
            "select coalesce(sum(cantidad_asignada), 0)::bigint as n from saldo_de_linea_de_comprobante where empresa_id = $1",
            [mundo.empresa],
          ),
        ).toBe(100);
      } finally {
        await otra.close();
      }
      await ir(pagina, `/compras/facturas/${facturaId}`);
      await pagina.getByText("Todo coincide", { exact: true }).waitFor();
    });

    it("«Anular conciliación» no pide motivo, devuelve el saldo y la factura vuelve a «Conciliada en parte»; una factura de otra empresa o un id inválido es el genérico", async () => {
      await ir(pagina, `/compras/facturas/${facturaId}`);
      await pagina.getByRole("button", { name: "Anular conciliación" }).first().click();
      const hoja = pagina.getByRole("dialog");
      expect(await hoja.getByLabel("Motivo").count()).toBe(0);
      await sinViolacionesDeAxe();
      await hoja.getByRole("button", { name: "Anular", exact: true }).click();
      await pagina.getByText("Conciliada en parte", { exact: true }).waitFor();
      await pagina.getByText(/· Anulada$/).waitFor();
      expect(await conciliaciones("ANULACION")).toBe(1);
      expect(
        await contar(
          "select coalesce(sum(cantidad_asignada), 0)::bigint as n from saldo_de_linea_de_comprobante where empresa_id = $1",
          [mundo.empresa],
        ),
      ).toBeLessThan(100);
      await ir(pagina, "/compras/facturas/no-es-un-id");
      await pagina.getByText("Esta acción no está permitida").waitFor();
      await ir(pagina, `/compras/facturas/${randomUUID()}`);
      await pagina.getByText("Esta acción no está permitida").waitFor();
      await ir(pagina, `/compras/facturas/${randomUUID()}/conciliar`);
      await pagina.getByText("Esta acción no está permitida").waitFor();
      expect(vigilante.tomar()).toEqual([]);
    });
  },
);
