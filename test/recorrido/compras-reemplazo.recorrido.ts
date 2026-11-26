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
import { cuitUnico } from "../integracion/entorno";
import { numeroUnico } from "../integracion/unicos";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Reemplazar el comprobante» de punta a punta en la app REAL con un navegador real y un Postgres real, con la persona como GERENTE (NOTAS-2c-2):
 *  - Desde el detalle de la factura (N3/N4) «Reemplazar» abre la pantalla; sin pasos previos se carga el comprobante nuevo, el motivo viene precargado con el número y un doble clic real es UN reemplazo
 *    (la original queda anulada con el motivo y la nueva la reemplaza, una sola auditoría).
 *  - Con una nota vigente la pantalla lista «Qué hay que deshacer antes» con el enlace a las notas y no deja enviar.
 *  - Desde la ficha de la compra (N1/N2) «Cambiar el comprobante de la compra» abre la pantalla con las líneas de la compra y al enviar deja UNA factura vigente.
 *  - Sin permiso de reemplazar (operador) no hay botón y la pantalla responde el genérico.
 * Lo que no ven las pruebas de componentes: las acciones de servidor reales, las páginas con la lectura de «qué hay que deshacer antes», el rol que sale de la base y la factura vigente que se mira.
 */
const base = inject("baseDePruebas");
const GENERICO = "Esta acción no está permitida";

describe.skipIf(base === null)("recorrido de compras: reemplazar el comprobante", () => {
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
  const contar = async (consulta: string, parametros: unknown[]) =>
    Number((await mundo.mundo.dueno.query<{ n: string }>(consulta, parametros)).rows[0]?.n);
  const auditorias = (accion: string) =>
    contar(
      "select count(*)::text as n from auditoria_empresa where empresa_id = $1 and accion = $2",
      [mundo.empresa, accion],
    );
  const conRol = async (rol: "OPERADOR" | "GERENTE") => {
    const c = mundo.mundo.dueno;
    await c.query("begin");
    try {
      await c.query("set local session_replication_role = replica");
      await c.query("update membresia set rol = $3 where empresa_id = $1 and persona_id = $2", [
        mundo.empresa,
        persona,
        rol,
      ]);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
  };

  /** Una factura A de la empresa (N4, sin compra) por SQL del dueño, con su producto y su cargo en el libro. */
  const facturaDeLaEmpresa = async (): Promise<string> => {
    const c = mundo.mundo.dueno;
    const comprobanteId = randomUUID();
    await c.query("begin");
    try {
      await c.query(
        `insert into comprobante_de_proveedor (id, empresa_id, proveedor_id, clase, tipo, punto_de_venta, numero, fecha_del_comprobante, neto_gravado, no_gravado, exento,
           iva, tributos_total, credito_fiscal_computable, total_calculado, total_segun_factura, proveedor_razon_social, nivel, clave_idempotencia, huella, registrado_por)
         values ($1, $2, $3, 'FACTURA', 'FACTURA_A', 1, $4, '2026-11-10', 1000, 0, 0, 210, 0, 210, 1210, 1210, 'Carnes del Sur', 'TRES_VIAS', $5, $6, $7)`,
        [
          comprobanteId,
          mundo.empresa,
          proveedor,
          numeroUnico(),
          claveDeCompra(),
          huellaAlAzar(),
          persona,
        ],
      );
      await c.query(
        `insert into linea_de_comprobante (empresa_id, comprobante_id, numero, descripcion, unidad, cantidad_facturada, precio_neto, alicuota, neto_de_linea, iva_de_linea, producto_id)
         values ($1, $2, 1, 'Bife de chorizo', 'kg', 10, 100, '21', 1000, 210, $3)`,
        [mundo.empresa, comprobanteId, producto],
      );
      const asiento = await c.query<{ id: string }>(
        `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, origen_orden, clave_idempotencia, huella, hecho_en, registrado_por)
         values ($1, $2, 'A_PAGAR', 'CARGO_DE_FACTURA_DE_COMPRA', 1210, 'compras.factura', $3, 1, $4, $5, now(), $6) returning id`,
        [mundo.empresa, proveedor, comprobanteId, claveDeCompra(), huellaAlAzar(), persona],
      );
      await c.query(
        `insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) values ($1, $2, $3, 1210)`,
        [mundo.empresa, asiento.rows[0]?.id, sucursal],
      );
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    return comprobanteId;
  };
  const estadoDe = async (id: string) =>
    (
      await mundo.mundo.dueno.query<{ estado: string; motivo: string | null }>(
        "select estado, motivo_de_anulacion as motivo from comprobante_de_proveedor where id = $1",
        [id],
      )
    ).rows[0];
  const reemplazos = (id: string) =>
    contar("select count(*)::text as n from comprobante_de_proveedor where reemplaza_a_id = $1", [
      id,
    ]);

  /** Una compra con su factura A (total 1210,00) cargada por SQL del dueño: la línea de la factura apunta a la recepción, que es lo que ata la factura a la compra (las tablas son de solo inserción). */
  const compraConFactura = async (): Promise<{ recepcionId: string; comprobanteId: string }> => {
    const c = mundo.mundo.dueno;
    const m = { empresa: mundo.empresa, persona, sucursal };
    const recepcionId = await recepcionDeBase(c, m, proveedor, producto);
    const comprobanteId = randomUUID();
    await c.query("begin");
    try {
      await c.query(
        `insert into comprobante_de_proveedor (id, empresa_id, proveedor_id, clase, tipo, punto_de_venta, numero, fecha_del_comprobante, neto_gravado, no_gravado, exento,
           iva, tributos_total, credito_fiscal_computable, total_calculado, total_segun_factura, proveedor_razon_social, nivel, clave_idempotencia, huella, registrado_por)
         values ($1, $2, $3, 'FACTURA', 'FACTURA_A', 1, $4, '2026-11-10', 1000, 0, 0, 210, 0, 210, 1210, 1210, 'Carnes del Sur', 'CON_COMPROBANTE', $5, $6, $7)`,
        [
          comprobanteId,
          mundo.empresa,
          proveedor,
          numeroUnico(),
          claveDeCompra(),
          huellaAlAzar(),
          persona,
        ],
      );
      await c.query(
        `insert into linea_de_comprobante (empresa_id, comprobante_id, numero, descripcion, unidad, cantidad_facturada, precio_neto, alicuota, neto_de_linea, iva_de_linea,
           recepcion_id, linea_de_recepcion)
         values ($1, $2, 1, 'Bife de chorizo', 'kg', 10, 100, '21', 1000, 210, $3, 1)`,
        [mundo.empresa, comprobanteId, recepcionId],
      );
      // El cargo de la factura en el libro, como lo deja «Registrar» (L1): sin él el pago falla cerrado (una factura anterior al libro no se paga).
      const asiento = await c.query<{ id: string }>(
        `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, origen_orden, clave_idempotencia, huella, hecho_en, registrado_por)
         values ($1, $2, 'A_PAGAR', 'CARGO_DE_FACTURA_DE_COMPRA', 1210, 'compras.factura', $3, 1, $4, $5, now(), $6) returning id`,
        [mundo.empresa, proveedor, comprobanteId, claveDeCompra(), huellaAlAzar(), persona],
      );
      await c.query(
        `insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) values ($1, $2, $3, 1210)`,
        [mundo.empresa, asiento.rows[0]?.id, sucursal],
      );
      // La compra es de «Con factura» (N2): la recepción y su factura son las del atajo.
      await c.query("set local session_replication_role = replica");
      await c.query(
        "update recepcion set es_atajo = true, nivel = 'CON_COMPROBANTE' where id = $1",
        [recepcionId],
      );
      await c.query("update comprobante_de_proveedor set es_atajo = true where id = $1", [
        comprobanteId,
      ]);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    return { recepcionId, comprobanteId };
  };

  /** Escribe el comprobante nuevo de la factura de la empresa (con el producto de la línea). */
  async function escribirLaFacturaNueva(numero: number, conProducto: boolean) {
    if (conProducto) {
      await pagina.getByRole("combobox", { name: "Agregar producto" }).pressSequentially("bife");
      await pagina.getByRole("option", { name: /Bife de chorizo/ }).click();
    }
    await pagina.getByLabel("Tipo").selectOption("FACTURA_C");
    await pagina.getByLabel("Punto de venta").fill("1");
    await pagina.getByLabel("Número").fill(String(numero));
    await pagina.getByLabel("Fecha de la factura").fill("2026-11-12");
    if (conProducto) await pagina.getByLabel("Cantidad facturada").pressSequentially("10");
    await pagina.getByLabel("Precio neto").pressSequentially("100");
    await pagina.getByLabel("Total según la factura").pressSequentially("1000");
  }

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "clientes", "compras", "caja"],
      perillas: { recepcion_separada: { tipo: "INTERRUPTOR", encendida: true } },
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
    // El proveedor ya tiene su CUIT, como lo deja la primera factura real (esa lo exige): el reemplazo no lo pide de nuevo.
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    await c.query(
      "update parte set documento_tipo = 'CUIT', documento_numero = $2, condicion_iva = 'MONOTRIBUTO' where id = $1",
      [proveedor, cuitUnico()],
    );
    await c.query("commit");
    producto = await productoDeBase(c, mundo.empresa, {
      nombre: "Bife de chorizo",
      clase: "MATERIA_PRIMA",
    });
    // La ficha del proveedor con su punto de venta (una nota, como una factura, tiene que ir por un punto de venta declarado).
    await c.query(
      "insert into ficha_de_compra_del_proveedor (empresa_id, parte_id) values ($1, $2)",
      [mundo.empresa, proveedor],
    );
    await c.query(
      "insert into punto_de_venta_de_la_ficha (empresa_id, parte_id, numero) values ($1, $2, 1)",
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

  it("desde el detalle de la factura: «Reemplazar» abre la pantalla sin pasos previos; el motivo viene precargado con el número; un doble clic es UN reemplazo y la original queda anulada con el motivo", async () => {
    const original = await facturaDeLaEmpresa();
    const antes = await auditorias("FACTURA_REEMPLAZADA");
    await ir(`/compras/facturas/${original}`);
    await pagina.getByRole("link", { name: "Reemplazar", exact: true }).click();
    await pagina.waitForURL(`**/compras/facturas/${original}/reemplazar`);
    await pagina.getByRole("heading", { name: "Reemplazar el comprobante" }).waitFor();
    expect(await pagina.getByText("Qué hay que deshacer antes").count()).toBe(0);
    const numero = numeroUnico();
    await escribirLaFacturaNueva(numero, true);
    const motivo = `Reemplazada por la factura 0001-${String(numero).padStart(8, "0")}`;
    expect(await pagina.getByLabel("Motivo").inputValue()).toBe(motivo);
    // El importe de la nueva (1000) difiere del de la original (1210): el aviso del dueño.
    await pagina
      .getByText("El costo del stock no cambia; si hace falta, usá Corregir lo recibido")
      .waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.getByRole("button", { name: "Reemplazar", exact: true }).dblclick();
    await pagina.waitForURL(
      (url) =>
        /\/compras\/facturas\/[0-9a-f-]{36}$/.test(url.pathname) &&
        !url.pathname.includes(original),
    );
    expect(await estadoDe(original)).toEqual({ estado: "ANULADO", motivo });
    expect(await reemplazos(original)).toBe(1);
    expect(await auditorias("FACTURA_REEMPLAZADA")).toBe(antes + 1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("con una nota vigente la pantalla lista «Qué hay que deshacer antes» con el enlace a las notas y el envío queda apagado; sin el motivo tampoco se envía", async () => {
    const original = await facturaDeLaEmpresa();
    await ir(`/compras/facturas/${original}/notas/nueva?clase=credito`);
    await pagina.getByLabel("Tipo").selectOption("NOTA_CREDITO_C");
    await pagina.getByLabel("Punto de venta").fill("1");
    await pagina.getByLabel("Número").fill(String(numeroUnico()));
    await pagina.getByLabel("Fecha").fill("2026-11-12");
    await pagina.getByLabel("Neto").pressSequentially("100,00");
    await pagina.getByLabel("Total de la nota").pressSequentially("100,00");
    await pagina.getByRole("button", { name: "Guardar", exact: true }).click();
    await pagina.waitForURL(`**/compras/facturas/${original}/notas`);
    await ir(`/compras/facturas/${original}/reemplazar`);
    await pagina.getByRole("heading", { name: "Qué hay que deshacer antes" }).waitFor();
    await pagina.getByRole("link", { name: "Notas de la factura" }).waitFor();
    await escribirLaFacturaNueva(numeroUnico(), true);
    expect(await pagina.getByRole("button", { name: "Reemplazar", exact: true }).isDisabled()).toBe(
      true,
    );
    expect(await reemplazos(original)).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  });

  it("desde la ficha de la compra (N2): «Cambiar el comprobante de la compra» abre la pantalla con la línea de la compra precargada y deja UNA factura vigente con la nueva", async () => {
    const { recepcionId, comprobanteId } = await compraConFactura();
    await ir(`/compras/${recepcionId}`);
    await pagina.getByRole("link", { name: "Cambiar el comprobante de la compra" }).click();
    await pagina.waitForURL(`**/compras/${recepcionId}/cambiar-comprobante`);
    await pagina.getByRole("heading", { name: "Reemplazar el comprobante" }).waitFor();
    expect(await pagina.getByRole("combobox", { name: "Agregar producto" }).count()).toBe(0);
    await escribirLaFacturaNueva(numeroUnico(), false);
    expect(await pagina.getByLabel("Cantidad facturada").inputValue()).not.toBe("");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina
      .getByRole("button", { name: "Cambiar el comprobante de la compra", exact: true })
      .dblclick();
    await pagina.waitForURL(`**/compras/${recepcionId}`);
    expect(await reemplazos(comprobanteId)).toBe(1);
    expect((await estadoDe(comprobanteId))?.estado).toBe("ANULADO");
    expect(vigilante.tomar()).toEqual([]);
  });

  it("sin permiso de reemplazar (operador) el detalle no ofrece «Reemplazar» y la pantalla responde el genérico sin formulario", async () => {
    const original = await facturaDeLaEmpresa();
    await crearAsignacionDeBase(mundo.mundo.dueno, mundo.empresa, persona, sucursal);
    await conRol("OPERADOR");
    try {
      await ir(`/compras/facturas/${original}`);
      expect(await pagina.getByRole("link", { name: "Reemplazar", exact: true }).count()).toBe(0);
      await ir(`/compras/facturas/${original}/reemplazar`);
      await pagina.getByText(GENERICO).waitFor();
      expect(await pagina.getByLabel("Tipo").count()).toBe(0);
    } finally {
      await conRol("GERENTE");
    }
    expect((await estadoDe(original))?.estado).toBe("REGISTRADO");
  });

  it("una factura que no existe o un id mal escrito responden el genérico y no ofrecen formulario", async () => {
    await ir("/compras/facturas/0b0b0b0b-1111-4222-8333-444444444444/reemplazar");
    await pagina.getByText(GENERICO).waitFor();
    await ir("/compras/0b0b0b0b-1111-4222-8333-444444444444/cambiar-comprobante");
    await pagina.getByText(GENERICO).waitFor();
    expect(await pagina.getByLabel("Tipo").count()).toBe(0);
  });
});
