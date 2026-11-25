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
 * «RECEPCIONES» de punta a punta en la app REAL con un navegador real (Compras 4, recepción separada): el operador abre «Recibir» (SIN precio), un doble clic real es UNA recepción «Por confirmar» sin stock;
 * el gerente la confirma con un doble clic real (UNA entrada de stock) y la lista muestra su estado; dos pestañas confirmando la misma recepción a la vez dejan UNA entrada; y ningún componente rompe en el
 * navegador (sin errores de consola ni violaciones graves de accesibilidad). Lo que no ven las pruebas de componentes ni las de integración: las acciones de Next con su clave y el rol que sale de la base.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de «Recepciones»: de «Recibir» a «Confirmar recepción»",
  () => {
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
    const movimientos = () =>
      contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [deposito]);
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

    /** Elige el proveedor y agrega el producto, solo con la cantidad (no hay precio). */
    async function recibir(p: Page, cantidad: string) {
      await ir(p, "/compras/recepciones/recibir");
      await p.getByRole("combobox", { name: "Proveedor" }).pressSequentially("Distribuidora");
      await p.getByRole("option", { name: /Distribuidora Central/ }).click();
      await p.getByRole("combobox", { name: "Agregar producto" }).pressSequentially("Harina");
      await p.getByRole("option", { name: /Harina 000/ }).click();
      await p.getByLabel("Cantidad").pressSequentially(cantidad);
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
      await proveedorDeBase(c, m, "Distribuidora Central");
      deposito = await depositoDeBase(c, m);
      const producto = await productoDeBase(c, mundo.empresa, {
        nombre: "Harina 000",
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

    it("el operador abre «Recibir» desde la lista, NO ve precio ni factura ni depósito; un DOBLE CLIC real en «Recibir» es UNA recepción «Por confirmar», sin stock, y abre su detalle sin botones de confirmar", async () => {
      await ir(pagina, "/compras/recepciones");
      await pagina.getByRole("link", { name: "Recibir" }).click();
      await pagina.waitForURL(/\/compras\/recepciones\/recibir$/);
      await recibir(pagina, "60");
      await pagina.getByLabel("Cantidad").waitFor();
      expect(await pagina.getByLabel("Precio por").count()).toBe(0);
      expect(await pagina.getByLabel("Precio", { exact: true }).count()).toBe(0);
      expect(await pagina.getByLabel("Total según la factura").count()).toBe(0);
      await sinViolacionesDeAxe();
      expect(await recepciones()).toBe(0);
      await pagina.getByRole("button", { name: "Recibir", exact: true }).dblclick();
      await pagina.waitForURL(/\/compras\/recepciones\/[0-9a-f-]{36}$/);
      await pagina.getByRole("heading", { name: /^Recepción \d+$/ }).waitFor();
      await pagina.getByText("Por confirmar", { exact: true }).waitFor();
      await pagina.getByText("Harina 000").waitFor();
      expect(await recepciones()).toBe(1);
      expect(await movimientos()).toBe(0);
      expect(await existenciaDe(dueno(), deposito, articulo)).toBe("0");
      // el operador no tiene permiso de confirmar ni de anular: no hay botones
      expect(await pagina.getByRole("button", { name: "Confirmar recepción" }).count()).toBe(0);
      expect(await pagina.getByRole("button", { name: "Anular recepción" }).count()).toBe(0);
      expect(
        await contar(
          "select count(*) as n from linea_de_recepcion where empresa_id = $1 and precio is null and costo_por_unidad_de_stock is null",
          [mundo.empresa],
        ),
      ).toBe(1);
      await sinViolacionesDeAxe();
      expect(vigilante.tomar()).toEqual([]);
    });

    it("el gerente confirma con un DOBLE CLIC real: UNA entrada de stock, el estado pasa a «Recibida sin facturar» y la lista lo muestra", async () => {
      await conRol("GERENTE");
      await ir(pagina, "/compras/recepciones");
      await pagina.getByRole("link", { name: /Recepción \d+ · Distribuidora Central/ }).click();
      await pagina.waitForURL(/\/compras\/recepciones\/[0-9a-f-]{36}$/);
      await pagina.getByRole("button", { name: "Confirmar recepción" }).waitFor();
      await pagina.getByRole("button", { name: "Anular recepción" }).waitFor();
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Confirmar recepción" }).dblclick();
      await pagina.getByText("Recibida sin facturar", { exact: true }).waitFor();
      expect(await pagina.getByRole("button", { name: "Confirmar recepción" }).count()).toBe(0);
      expect(await movimientos()).toBe(1);
      expect(await existenciaDe(dueno(), deposito, articulo)).toBe("60.0000");
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'RECEPCION_CONFIRMADA'",
          [mundo.empresa],
        ),
      ).toBe(1);
      await ir(pagina, "/compras/recepciones");
      await pagina.getByText(/Recibida sin facturar/).waitFor();
      await sinViolacionesDeAxe();
      expect(vigilante.tomar()).toEqual([]);
    });

    it("dos pestañas confirman la misma recepción a la vez: UNA sola entrada de stock", async () => {
      await recibir(pagina, "40");
      await pagina.getByRole("button", { name: "Recibir", exact: true }).click();
      await pagina.waitForURL(/\/compras\/recepciones\/[0-9a-f-]{36}$/);
      const ruta = new URL(pagina.url()).pathname;
      const otra = await contexto.newPage();
      try {
        await Promise.all([ir(pagina, ruta), ir(otra, ruta)]);
        await Promise.all([
          pagina.getByRole("button", { name: "Confirmar recepción" }).click(),
          otra.getByRole("button", { name: "Confirmar recepción" }).click(),
        ]);
        await Promise.all([
          pagina.getByText("Recibida sin facturar", { exact: true }).waitFor(),
          otra.getByText("Recibida sin facturar", { exact: true }).waitFor(),
        ]);
        expect(await movimientos()).toBe(2);
        expect(await existenciaDe(dueno(), deposito, articulo)).toBe("100.0000");
      } finally {
        await otra.close();
      }
    });

    it("«Corregir lo recibido»: el gerente corrige 40 → 35 con un DOBLE CLIC real: UNA corrección, el stock baja 5, el detalle dice lo vigente y la historia; el motivo es de una lista cerrada y la nota es opcional", async () => {
      await ir(pagina, "/compras/recepciones");
      await pagina
        .getByRole("link", { name: /Recepción \d+ · Distribuidora Central/ })
        .first()
        .click();
      await pagina.waitForURL(/\/compras\/recepciones\/[0-9a-f-]{36}$/);
      await pagina.getByText("Recibida sin facturar", { exact: true }).waitFor();
      expect(await pagina.getByRole("button", { name: "Corregir lo recibido" }).count()).toBe(1);
      await pagina.getByRole("button", { name: "Corregir lo recibido" }).click();
      const hoja = pagina.getByRole("dialog");
      expect(await hoja.getByRole("button", { name: "Corregir", exact: true }).isDisabled()).toBe(
        true,
      );
      await hoja.getByLabel("Cantidad recibida").pressSequentially("35");
      await hoja.getByLabel("Motivo de la corrección").selectOption("REPARTO_INTERNO");
      await hoja.getByText(/la otra sucursal/).waitFor();
      await hoja.getByLabel("Motivo de la corrección").selectOption("FALTANTE_DEL_PROVEEDOR");
      await hoja.getByLabel("Nota").pressSequentially("Faltaron 5 bolsas");
      await sinViolacionesDeAxe();
      await hoja.getByRole("button", { name: "Corregir", exact: true }).dblclick();
      await pagina.getByText("Correcciones", { exact: true }).waitFor();
      await pagina
        .getByText(/40 Kilogramo → 35 Kilogramo · Faltante del proveedor · Faltaron 5 bolsas/)
        .waitFor();
      expect(
        await contar("select count(*) as n from correccion_de_lo_recibido where empresa_id = $1", [
          mundo.empresa,
        ]),
      ).toBe(1);
      expect(await movimientos()).toBe(3);
      expect(await existenciaDe(dueno(), deposito, articulo)).toBe("95.0000");
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'COMPRA_CORREGIDA'",
          [mundo.empresa],
        ),
      ).toBe(1);
      await sinViolacionesDeAxe();
      expect(vigilante.tomar()).toEqual([]);
    });

    it("«Anular recepción» pide el motivo y deja la recepción «Anulada» sin stock; una recepción de otra empresa o un id inválido es el genérico", async () => {
      await recibir(pagina, "5");
      await pagina.getByRole("button", { name: "Recibir", exact: true }).click();
      await pagina.waitForURL(/\/compras\/recepciones\/[0-9a-f-]{36}$/);
      await pagina.getByRole("button", { name: "Anular recepción" }).click();
      const hoja = pagina.getByRole("dialog");
      expect(await hoja.getByRole("button", { name: "Anular", exact: true }).isDisabled()).toBe(
        true,
      );
      await hoja.getByLabel("Motivo").pressSequentially("Se cargó de más");
      await sinViolacionesDeAxe();
      await hoja.getByRole("button", { name: "Anular", exact: true }).click();
      await pagina.getByText("Anulada", { exact: true }).waitFor();
      await pagina.getByText("Se cargó de más").waitFor();
      expect(await movimientos()).toBe(3);
      await ir(pagina, "/compras/recepciones/no-es-un-id");
      await pagina.getByText("Esta acción no está permitida").waitFor();
      await ir(pagina, `/compras/recepciones/${randomUUID()}`);
      await pagina.getByText("Esta acción no está permitida").waitFor();
      expect(vigilante.tomar()).toEqual([]);
    });
  },
);
