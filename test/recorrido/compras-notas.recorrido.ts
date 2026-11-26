import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PREFIJO_DE_NAVEGADOR } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import {
  claveDeCompra,
  huellaAlAzar,
  proveedorDeBase,
  recepcionDeBase,
} from "../integracion/compras-apoyo";
import { numeroUnico } from "../integracion/unicos";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Notas de la factura» y «Cargar una nota del proveedor» de punta a punta en la app REAL con un navegador real y un Postgres real, con la persona como GERENTE (NOTAS-2c-1):
 *  - Desde la ficha de la compra, «Notas de crédito» abre «Notas de la factura» con el importe a pagar del servidor; «Cargar nota de crédito» guarda una nota (un doble clic real es UNA nota y UNA auditoría) y el
 *    importe a pagar baja; en la ficha de la compra el enlace «Declarar pago» sigue ofreciéndose.
 *  - Con una nota por el total, la ficha dice «Saldada por notas» y el enlace «Declarar pago» DESAPARECE (criterio del dueño, 26/11/2026).
 *  - Anular la nota: la hoja pide el motivo, un doble clic es UNA anulación, vuelve el importe a pagar y vuelve «Declarar pago».
 *  - Una nota de crédito que pasa el tope sale como el genérico y no escribe; una nota ya descontada por un pago no se anula (texto del dueño).
 *  - Sin permiso de registrar (operador) la carga no se abre y la lista no ofrece botones.
 * Lo que no ven las pruebas de componentes: las acciones de servidor reales, las páginas con sus acciones ligadas, el rol que sale de la base y la lectura real de la factura.
 */
const base = inject("baseDePruebas");
const GENERICO = "Esta acción no está permitida";
const TEXTO_DEL_DUENO = "Primero anulá el pago: se pagó con esta nota descontada";

describe.skipIf(base === null)("recorrido de compras: notas del proveedor de una factura", () => {
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
  const notas = (facturaId: string, estado = "REGISTRADO") =>
    contar(
      "select count(*)::text as n from comprobante_de_proveedor where comprobante_asociado_id = $1 and estado = $2",
      [facturaId, estado],
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
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    return { recepcionId, comprobanteId };
  };

  /** Carga una nota de crédito de `total` desde «Notas de la factura» con un doble clic real y espera a volver a la lista. */
  async function cargarNotaDeCredito(facturaId: string, total: string) {
    await ir(`/compras/facturas/${facturaId}/notas`);
    await pagina.getByRole("link", { name: "Cargar nota de crédito" }).click();
    await pagina.waitForURL(`**/compras/facturas/${facturaId}/notas/nueva?clase=credito`);
    await pagina.getByLabel("Tipo").selectOption("NOTA_CREDITO_C");
    await pagina.getByLabel("Punto de venta").fill("1");
    await pagina.getByLabel("Número").fill(String(numeroUnico()));
    await pagina.getByLabel("Fecha").fill("2026-11-12");
    await pagina.getByLabel("Neto").pressSequentially(total.replace(".", ","));
    await pagina.getByLabel("Total de la nota").pressSequentially(total.replace(".", ","));
    await pagina.getByRole("button", { name: "Guardar", exact: true }).dblclick();
  }

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "clientes", "compras", "caja"],
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

  it("desde la ficha de la compra: «Notas de crédito» abre la lista con el importe a pagar; un doble clic en «Guardar» es UNA nota y UNA auditoría, y el importe a pagar baja", async () => {
    const { recepcionId, comprobanteId } = await compraConFactura();
    const antes = await auditorias("NOTA_DE_CREDITO_REGISTRADA");
    await ir(`/compras/${recepcionId}`);
    await pagina.getByRole("link", { name: "Notas de crédito" }).click();
    await pagina.waitForURL(`**/compras/facturas/${comprobanteId}/notas`);
    await pagina.getByText("Importe a pagar", { exact: true }).waitFor();
    await pagina.getByText("$ 1.210,00", { exact: true }).first().waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await cargarNotaDeCredito(comprobanteId, "200.00");
    await pagina.waitForURL(`**/compras/facturas/${comprobanteId}/notas`);
    await pagina.getByText("$ 1.010,00", { exact: true }).first().waitFor();
    expect(await notas(comprobanteId)).toBe(1);
    expect(await auditorias("NOTA_DE_CREDITO_REGISTRADA")).toBe(antes + 1);
    await ir(`/compras/${recepcionId}`);
    await pagina.getByRole("link", { name: "Declarar pago" }).waitFor();
    expect(await pagina.getByText("Saldada por notas", { exact: true }).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("con una nota por el total la ficha dice «Saldada por notas» y no ofrece pagar; anular la nota (la hoja pide el motivo; un doble clic es UNA anulación) devuelve el importe a pagar y «Declarar pago»", async () => {
    const { recepcionId, comprobanteId } = await compraConFactura();
    await cargarNotaDeCredito(comprobanteId, "1210.00");
    await pagina.waitForURL(`**/compras/facturas/${comprobanteId}/notas`);
    await pagina.getByText("Saldada por notas", { exact: true }).waitFor();
    await ir(`/compras/${recepcionId}`);
    await pagina.getByText("Saldada por notas", { exact: true }).waitFor();
    expect(await pagina.getByRole("link", { name: "Declarar pago" }).count()).toBe(0);
    await ir(`/compras/facturas/${comprobanteId}/notas`);
    await pagina.getByRole("button", { name: "Anular", exact: true }).click();
    const hoja = pagina.getByRole("dialog");
    await hoja.getByLabel("Motivo").waitFor();
    expect(await hoja.getByRole("button", { name: "Anular", exact: true }).isDisabled()).toBe(true);
    await hoja.getByLabel("Motivo").fill("Se cargó dos veces");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const anuladasAntes = await auditorias("NOTA_DE_CREDITO_ANULADA");
    await hoja.getByRole("button", { name: "Anular", exact: true }).dblclick();
    await pagina.getByText("Anulada", { exact: true }).first().waitFor();
    expect(await notas(comprobanteId, "ANULADO")).toBe(1);
    expect(await auditorias("NOTA_DE_CREDITO_ANULADA")).toBe(anuladasAntes + 1);
    await ir(`/compras/${recepcionId}`);
    await pagina.getByRole("link", { name: "Declarar pago" }).waitFor();
    expect(await pagina.getByText("Saldada por notas", { exact: true }).count()).toBe(0);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("una nota que pasa el tope sale como el genérico y no escribe; el importe a pagar no cambia", async () => {
    const { comprobanteId } = await compraConFactura();
    await cargarNotaDeCredito(comprobanteId, "1210.01");
    await pagina.getByText(GENERICO).waitFor();
    expect(await notas(comprobanteId)).toBe(0);
  });

  it("una nota ya descontada por un pago no se anula: sale el texto del dueño y no cambia nada", async () => {
    const { recepcionId, comprobanteId } = await compraConFactura();
    await cargarNotaDeCredito(comprobanteId, "200.00");
    await pagina.waitForURL(`**/compras/facturas/${comprobanteId}/notas`);
    await ir(`/compras/${recepcionId}/pago`);
    await pagina.getByLabel("Medio").selectOption("TRANSFERENCIA");
    await pagina.getByRole("button", { name: "Declarar pago" }).click();
    await pagina.waitForURL(`**/compras/${recepcionId}`);
    await ir(`/compras/facturas/${comprobanteId}/notas`);
    await pagina.getByRole("button", { name: "Anular", exact: true }).click();
    const hoja = pagina.getByRole("dialog");
    await hoja.getByLabel("Motivo").fill("Mal cargada");
    await hoja.getByRole("button", { name: "Anular", exact: true }).click();
    await pagina.getByText(TEXTO_DEL_DUENO).waitFor();
    expect(await notas(comprobanteId)).toBe(1);
    expect(await notas(comprobanteId, "ANULADO")).toBe(0);
  });

  it("sin permiso de registrar (operador) la carga no se abre y la lista no ofrece «Cargar» ni «Anular»", async () => {
    const { comprobanteId } = await compraConFactura();
    await cargarNotaDeCredito(comprobanteId, "100.00");
    await pagina.waitForURL(`**/compras/facturas/${comprobanteId}/notas`);
    await conRol("OPERADOR");
    try {
      await ir(`/compras/facturas/${comprobanteId}/notas`);
      await pagina.getByText("Importe a pagar", { exact: true }).waitFor();
      expect(await pagina.getByRole("link", { name: /^Cargar nota/ }).count()).toBe(0);
      expect(await pagina.getByRole("button", { name: "Anular", exact: true }).count()).toBe(0);
      await ir(`/compras/facturas/${comprobanteId}/notas/nueva?clase=credito`);
      await pagina.getByText(GENERICO).waitFor();
      expect(await pagina.getByLabel("Tipo").count()).toBe(0);
    } finally {
      await conRol("GERENTE");
    }
  });

  it("una clase inventada o una factura que no existe responden el genérico y no ofrecen formulario", async () => {
    const { comprobanteId } = await compraConFactura();
    await ir(`/compras/facturas/${comprobanteId}/notas/nueva?clase=otra`);
    await pagina.getByText(GENERICO).waitFor();
    await ir("/compras/facturas/0b0b0b0b-1111-4222-8333-444444444444/notas");
    await pagina.getByText(GENERICO).waitFor();
    expect(await pagina.getByLabel("Tipo").count()).toBe(0);
  });
});
