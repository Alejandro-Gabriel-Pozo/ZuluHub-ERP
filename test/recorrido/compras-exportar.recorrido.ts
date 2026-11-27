import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { leerZipComoTextos } from "../../src/adaptadores/xlsx/leer-zip-de-prueba";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { crearAsignacionDeBase } from "../integracion/fixtures-identidad";
import { claveDeCompra, huellaAlAzar, proveedorDeBase } from "../integracion/compras-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «EXPORTAR COMPRAS» de punta a punta en la app REAL con un navegador real (T1 + T2 + T2b, dueño 25/11/2026): el gerente aplica un período en la lista, toca «Exportar» y baja un archivo de Excel
 * de tres hojas con el importe exacto; sin período no hay enlace; el operador no ve el enlace y, si pide la dirección a mano, no recibe ningún archivo. Lo que no ven las pruebas de
 * componentes ni las de servidor: la ruta de descarga con sus cabeceras en el navegador, el enlace que baja de verdad, la guarda de `Sec-Fetch-Site` con un navegador real y que
 * `write-excel-file` corre en el servidor de Next.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de compras: exportar a Excel", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let persona = "";
  let sucursalDeLaPersona = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "clientes", "compras", "stock"],
      activarModulosEnDesarrollo: true,
    });
    const c = mundo.mundo.dueno;
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
    sucursalDeLaPersona = sucursal;
    const m = { empresa: mundo.empresa, persona, sucursal };
    const proveedor = await proveedorDeBase(c, m, "Carnes del Sur");
    const producto = await productoDeBase(c, mundo.empresa, {
      nombre: "Bife de chorizo",
      clase: "MATERIA_PRIMA",
    });
    // Una compra con precio (10 unidades a 100 = 1000,00): la línea de una recepción solo entra con su cabecera, en la misma transacción.
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
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("el gerente aplica el período, toca «Exportar» y baja el archivo de tres hojas con el importe exacto", async () => {
    await ir("/compras");
    // Sin período aplicado no hay enlace (no se supone uno).
    expect(await pagina.getByRole("link", { name: "Exportar" }).count()).toBe(0);
    await pagina.getByLabel("Desde").fill("2026-11-01");
    await pagina.getByLabel("Hasta").fill("2026-11-30");
    await pagina.getByRole("button", { name: "Aplicar filtros" }).click();
    await pagina.waitForURL(/hasta=2026-11-30/);
    const enlace = pagina.getByRole("link", { name: "Exportar" });
    await enlace.waitFor();
    expect(await enlace.getAttribute("href")).toBe(
      "/compras/exportar?desde=2026-11-01&hasta=2026-11-30",
    );
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const [descarga] = await Promise.all([pagina.waitForEvent("download"), enlace.click()]);
    expect(descarga.suggestedFilename()).toBe("compras_2026-11-01_2026-11-30.xlsx");
    const ruta = await descarga.path();
    const zip = leerZipComoTextos(new Uint8Array(readFileSync(ruta)));
    const libro = zip.get("xl/workbook.xml") ?? "";
    for (const hoja of ["Cabecera", "Detalle", "Resumen"])
      expect(libro).toContain(`name="${hoja}"`);
    expect(zip.get("xl/worksheets/sheet1.xml")).toContain("<v>1000</v>");
    for (const [nombre, xml] of zip)
      if (nombre.startsWith("xl/worksheets/")) expect(xml).not.toContain("<f");
    // La persona sigue en la lista y la descarga dejó su registro de auditoría (sin datos).
    expect(pagina.url()).toContain("/compras?");
    const registros = (
      await mundo.mundo.dueno.query<{ despues: unknown }>(
        "select despues from auditoria_empresa where empresa_id = $1 and accion = 'COMPRAS_EXPORTADAS'",
        [mundo.empresa],
      )
    ).rows;
    expect(registros).toHaveLength(1);
    expect(JSON.stringify(registros[0]?.despues)).not.toContain("1000");
    expect(vigilante.tomar()).toEqual([]);
  });

  it("un período de más de 12 meses no baja ningún archivo: responde el error con su código", async () => {
    const respuesta = await ir("/compras/exportar?desde=2025-01-01&hasta=2026-12-31");
    expect(respuesta).not.toBeNull();
    expect(respuesta?.status()).toBeGreaterThanOrEqual(400);
    expect(respuesta?.headers()["content-disposition"]).toBeUndefined();
    expect(respuesta?.headers()["cache-control"]).toBe("private, no-store");
    expect(Object.keys((await respuesta?.json()) as object)).toEqual(["codigo"]);
  });

  it("el operador no ve el enlace y, si pide la dirección a mano, no recibe ningún archivo", async () => {
    const c = mundo.mundo.dueno;
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
    // Un operador trabaja en las sucursales a las que está asignado.
    await crearAsignacionDeBase(c, mundo.empresa, persona, sucursalDeLaPersona);
    await ir("/compras?desde=2026-11-01&hasta=2026-11-30");
    await pagina
      .getByRole("link", { name: /^Compra \d+ · / })
      .first()
      .waitFor();
    expect(await pagina.getByRole("link", { name: "Exportar" }).count()).toBe(0);
    const respuesta = await ir("/compras/exportar?desde=2026-11-01&hasta=2026-11-30");
    expect(respuesta).not.toBeNull();
    expect(respuesta?.status()).toBeGreaterThanOrEqual(400);
    expect(respuesta?.headers()["content-disposition"]).toBeUndefined();
  });
});
