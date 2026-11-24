import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PREFIJO_DE_NAVEGADOR } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { claveDeCompra, huellaAlAzar, proveedorDeBase } from "../integracion/compras-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «COMPRAS» que ESCRIBE, de punta a punta en la app REAL con un navegador real y un Postgres real (Compras PR 4, PR 10 y PR 11), con la persona como GERENTE:
 *  - «Nivel de compras»: elegir «Con factura» y tocar «Guardar» dos veces seguidas deja UN solo cambio y UNA auditoría (la pantalla sigue en «Con factura»).
 *  - «Corregir» el precio de una línea desde la ficha: dos toques seguidos en «Corregir» = UNA corrección; dos pestañas que corrigen la misma línea: la segunda ve el genérico y no escribe.
 *  - «Anular» desde la ficha: dos toques seguidos = UNA anulación y UNA auditoría; la ficha queda «Anulada», sin botones.
 *  - La ficha del proveedor: «Agregar punto de venta» con dos toques seguidos deja UN solo punto de venta.
 * Lo que no ven las pruebas de componentes: las acciones de servidor reales, las páginas con sus acciones ligadas, el reinicio del formulario tras la acción y que ningún componente rompa en el navegador.
 */
const base = inject("baseDePruebas");
const GENERICO = "Esta acción no está permitida";

describe.skipIf(base === null)(
  "recorrido de compras que escribe: nivel, corregir, anular y proveedor",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    let sucursal = "";
    let persona = "";
    let proveedor = "";
    let producto = "";

    const ir = async (ruta: string, p: Page = pagina) => {
      await p.goto(`${mundo.url}${ruta}`);
      await p.waitForLoadState("networkidle");
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const contar = async (consulta: string, parametros: unknown[]) =>
      Number((await mundo.mundo.dueno.query<{ n: string }>(consulta, parametros)).rows[0]?.n);
    const auditorias = (accion: string) =>
      contar(
        "select count(*)::text as n from auditoria_empresa where empresa_id = $1 and accion = $2",
        [mundo.empresa, accion],
      );

    /** Una compra con una línea con precio (10 unidades a 100 = 1000,00), por SQL del dueño. */
    const compraConPrecio = async (): Promise<string> => {
      const c = mundo.mundo.dueno;
      const id = randomUUID();
      await c.query("begin");
      try {
        await c.query(
          `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, hecho_en, clave_idempotencia, huella, registrado_por)
         values ($1, $2, $3, $4, 'COMPRA_SIMPLE', now(), $5, $6, $7)`,
          [id, mundo.empresa, sucursal, proveedor, claveDeCompra(), huellaAlAzar(), persona],
        );
        await c.query(
          `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock,
           precio_por_tipo, unidad_de_precio_id, precio, importe, costo_por_unidad_de_stock)
         values ($1, $2, 1, $3, 'UNIDAD', 10, 10, 'UNIDAD', 'UNIDAD', 100, 1000, 100)`,
          [mundo.empresa, id, producto],
        );
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
      return id;
    };

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
      persona = (
        await c.query<{ persona_id: string }>(
          "select persona_id from membresia where empresa_id = $1 limit 1",
          [mundo.empresa],
        )
      ).rows[0]?.persona_id as string;
      proveedor = await proveedorDeBase(c, { empresa: mundo.empresa, persona }, "Carnes del Sur");
      producto = await productoDeBase(c, mundo.empresa, {
        nombre: "Bife de chorizo",
        clase: "MATERIA_PRIMA",
      });
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

    it("«Nivel de compras»: el gerente elige «Con factura» y toca «Guardar» dos veces seguidas: un solo cambio, una sola auditoría; recargar muestra lo guardado", async () => {
      await ir("/compras");
      await pagina
        .getByRole("navigation", { name: "Navegación principal" })
        .getByText("Compras", { exact: true })
        .first()
        .click();
      const entrada = pagina
        .getByRole("navigation", { name: "Navegación principal" })
        .getByRole("link", { name: "Nivel de compras", exact: true });
      await entrada.waitFor();
      expect(await entrada.getAttribute("href")).toBe("/compras/nivel");
      await ir("/compras/nivel");
      const selector = pagina.getByLabel("Nivel de compras");
      await selector.waitFor();
      expect(await selector.inputValue()).toBe("COMPRA_SIMPLE");
      expect(await pagina.getByRole("button", { name: "Guardar" }).isDisabled()).toBe(true);
      expect(await selector.locator("option").allTextContents()).toEqual([
        "Sin factura",
        "Con factura",
      ]);
      await sinViolacionesDeAxe();
      await selector.selectOption("CON_COMPROBANTE");
      await pagina.getByRole("button", { name: "Guardar" }).dblclick();
      // Se espera a lo que de verdad importa: que el cambio quede hecho (y UNO solo, aunque el segundo toque llegue tarde).
      await expect.poll(() => auditorias("COMPRAS_NIVEL_CAMBIADO")).toBe(1);
      await expect
        .poll(() => pagina.getByRole("button", { name: "Guardar" }).isDisabled())
        .toBe(true);
      expect(await selector.inputValue()).toBe("CON_COMPROBANTE");
      expect(await auditorias("COMPRAS_NIVEL_CAMBIADO")).toBe(1);
      expect(
        await contar(
          "select count(*)::text as n from configuracion_de_compras where empresa_id = $1 and nivel = 'CON_COMPROBANTE' and version = 2",
          [mundo.empresa],
        ),
      ).toBe(1);
      await ir("/compras/nivel");
      expect(await pagina.getByLabel("Nivel de compras").inputValue()).toBe("CON_COMPROBANTE");
      pantallaLimpia();
    });

    it("«Corregir»: dos toques seguidos = UNA corrección; la ficha muestra el importe nuevo, quién, el «Antes» y el motivo", async () => {
      const id = await compraConPrecio();
      await ir(`/compras/${id}`);
      await pagina.getByText("Bife de chorizo").waitFor();
      expect(await pagina.getByRole("link", { name: "Corregir" }).count()).toBe(1);
      await sinViolacionesDeAxe();
      await pagina.getByRole("link", { name: "Corregir" }).click();
      await pagina.getByLabel("Precio por Unidad").fill("120");
      await pagina.getByLabel("Motivo").fill("El proveedor subió el precio");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Corregir" }).dblclick();
      await pagina.waitForURL(`**/compras/${id}`);
      await pagina.getByText(/^Corregido por .+ · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/).waitFor();
      await pagina.getByText(/Antes: \$ 100,00/).waitFor();
      await pagina.getByText("El proveedor subió el precio", { exact: false }).waitFor();
      await pagina.getByText("$ 1.200,00").first().waitFor();
      expect(
        await contar(
          "select count(*)::text as n from correccion_de_compra where empresa_id = $1 and recepcion_id = $2",
          [mundo.empresa, id],
        ),
      ).toBe(1);
      expect(await auditorias("COMPRA_CORREGIDA")).toBe(1);
      pantallaLimpia();
    });

    it("dos pestañas corrigen la misma línea: la primera corrige y la segunda ve el genérico, sin escribir", async () => {
      const id = await compraConPrecio();
      const otra = await contexto.newPage();
      const antes = await auditorias("COMPRA_CORREGIDA");
      try {
        await ir(`/compras/${id}/corregir/1`);
        await ir(`/compras/${id}/corregir/1`, otra);
        await pagina.getByLabel("Precio por Unidad").fill("110");
        await pagina.getByLabel("Motivo").fill("Una pestaña");
        await otra.getByLabel("Precio por Unidad").fill("130");
        await otra.getByLabel("Motivo").fill("Otra pestaña");
        await pagina.getByRole("button", { name: "Corregir" }).click();
        await pagina.waitForURL(`**/compras/${id}`);
        await otra.getByRole("button", { name: "Corregir" }).click();
        await otra.getByText(GENERICO).waitFor();
        expect(
          await contar(
            "select count(*)::text as n from correccion_de_compra where empresa_id = $1 and recepcion_id = $2",
            [mundo.empresa, id],
          ),
        ).toBe(1);
        expect(await auditorias("COMPRA_CORREGIDA")).toBe(antes + 1);
      } finally {
        await otra.close();
      }
    });

    it("«Anular»: la hoja pide el motivo, dos toques seguidos = UNA anulación y UNA auditoría; la ficha queda «Anulada» y sin botones", async () => {
      const id = await compraConPrecio();
      const antes = await auditorias("COMPRA_ANULADA");
      await ir(`/compras/${id}`);
      await pagina.getByRole("button", { name: "Anular" }).click();
      const hoja = pagina.getByRole("dialog");
      await hoja.getByLabel("Motivo").waitFor();
      expect(await hoja.getByRole("button", { name: "Anular" }).isDisabled()).toBe(true);
      await hoja.getByLabel("Motivo").fill("Se cargó dos veces");
      await sinViolacionesDeAxe();
      await hoja.getByRole("button", { name: "Anular" }).dblclick();
      await pagina.getByText("Se cargó dos veces").first().waitFor();
      await pagina.getByText("Anulada", { exact: true }).first().waitFor();
      expect(await pagina.getByRole("main").getByRole("button").count()).toBe(0);
      expect(await pagina.getByRole("link", { name: "Corregir" }).count()).toBe(0);
      expect(
        await contar(
          "select count(*)::text as n from recepcion where id = $1 and estado = 'ANULADA'",
          [id],
        ),
      ).toBe(1);
      expect(await auditorias("COMPRA_ANULADA")).toBe(antes + 1);
      pantallaLimpia();
    });

    it("la ficha del proveedor: «Agregar punto de venta» con dos toques seguidos deja UN solo punto de venta", async () => {
      await ir(`/compras/proveedores/${proveedor}`);
      await pagina.getByRole("heading", { name: "Carnes del Sur" }).first().waitFor();
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Agregar punto de venta" }).click();
      const hoja = pagina.getByRole("dialog");
      await hoja.getByLabel("Número del punto de venta").fill("5");
      await hoja.getByRole("button", { name: "Agregar", exact: true }).dblclick();
      await pagina.getByText("00005").first().waitFor();
      expect(
        await contar(
          "select count(*)::text as n from punto_de_venta_de_la_ficha where empresa_id = $1 and parte_id = $2 and numero = 5",
          [mundo.empresa, proveedor],
        ),
      ).toBe(1);
      pantallaLimpia();
    });

    it("la ficha de un proveedor que no existe dice que ya no está disponible y la de un id mal escrito responde el genérico", async () => {
      await ir("/compras/proveedores/0b0b0b0b-1111-4222-8333-444444444444");
      await pagina.getByText("El proveedor ya no está disponible").waitFor();
      await ir("/compras/proveedores/no-es-un-id");
      await pagina.getByText(GENERICO).waitFor();
    });
  },
);
