import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PREFIJO_DE_NAVEGADOR } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { crearCasosDeUsoDeCaja } from "../../src/modulos/caja/publico";
import { empresaId, personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import {
  claveDeCompra,
  huellaAlAzar,
  proveedorDeBase,
  recepcionDeBase,
} from "../integracion/compras-apoyo";
import { numeroUnico } from "../integracion/unicos";
import { comoEmpresa, crearEntornoDePrueba } from "../integracion/entorno";
import { ahoraDeLaCorrida } from "../integracion/reloj-de-la-corrida";
import { REGLAS_DE_PRUEBA, valorDe } from "../integracion/ventas-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Declarar pago» y anular el pago de una factura (Compras PR 8), de punta a punta en la app REAL con un navegador real y un Postgres real, con la persona como GERENTE:
 *  - Por transferencia: «Declarar pago» desde la ficha, medio «Transferencia» y dos toques seguidos = UN pago y UNA auditoría; la ficha muestra el pago y ya no ofrece pagar.
 *  - En efectivo: aparecen la caja (la abierta) y el motivo; el pago y el egreso de la caja son uno solo (la caja baja el importe de la factura, una sola vez aunque se toque dos veces).
 *  - Dos pestañas pagan la misma factura: la primera paga, la segunda ve el genérico y no escribe (un pago, una auditoría).
 *  - Anular el pago: la hoja pide el motivo; dos toques seguidos = UNA anulación; el efectivo vuelve a la caja una sola vez; la ficha dice «Anulado» y vuelve «Declarar pago».
 * Lo que no ven las pruebas de componentes: las acciones de servidor reales, las páginas con sus acciones ligadas y la lectura real de las cajas abiertas.
 */
const base = inject("baseDePruebas");
const GENERICO = "Esta acción no está permitida";

describe.skipIf(base === null)(
  "recorrido de compras: declarar y anular el pago de una factura",
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
    let cajaId = "";
    let sesionId = "";

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
    const pagos = (comprobanteId: string) =>
      contar("select count(*)::text as n from pago_de_comprobante where comprobante_id = $1", [
        comprobanteId,
      ]);
    const saldoDeLaCaja = async () =>
      (
        await mundo.mundo.dueno.query<{ t: string }>(
          "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1",
          [sesionId],
        )
      ).rows[0]?.t;

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
      // Una caja con la sesión abierta, por el camino real (el caso de uso de caja), para el pago en efectivo.
      await c.query(
        "insert into medio_de_pago (empresa_id, tipo) values ($1, 'EFECTIVO') on conflict do nothing",
        [mundo.empresa],
      );
      cajaId = (
        await c.query<{ id: string }>(
          "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja del recorrido') returning id",
          [mundo.empresa, sucursal],
        )
      ).rows[0]?.id as string;
      const entorno = crearEntornoDePrueba(mundo.mundo.propia.base, 4);
      try {
        const caja = crearCasosDeUsoDeCaja({ transacciones: entorno, reglas: REGLAS_DE_PRUEBA });
        const sesion = valorDe(
          await caja.abrirSesion(
            {
              ...comoEmpresa(empresaId(mundo.empresa), personaId(persona), mundo.mundo.marcaA),
              ahora: ahoraDeLaCorrida(),
            },
            {
              claveDeIdempotencia: `clave-${randomUUID()}`,
              sucursalId: sucursalId(sucursal),
              cajaId,
              fondoInicial: { moneda: "ARS", monto: "5000.00" },
            },
          ),
        );
        sesionId = sesion.sesionId;
      } finally {
        await entorno.cerrar();
      }
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

    it("por transferencia: «Declarar pago» desde la ficha, dos toques seguidos = UN pago y UNA auditoría; la ficha muestra el pago con quién y cuándo y ya no ofrece pagar", async () => {
      const { recepcionId, comprobanteId } = await compraConFactura();
      const antes = await auditorias("PAGO_DECLARADO");
      await ir(`/compras/${recepcionId}`);
      await pagina.getByRole("link", { name: "Declarar pago" }).click();
      await pagina.waitForURL(`**/compras/${recepcionId}/pago`);
      await pagina.getByLabel("Medio").waitFor();
      expect(await pagina.getByText("Importe: $ 1.210,00").count()).toBe(1);
      expect(await pagina.getByLabel("Importe").count()).toBe(0);
      expect(await pagina.getByRole("button", { name: "Declarar pago" }).isDisabled()).toBe(true);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      await pagina.getByLabel("Medio").selectOption("TRANSFERENCIA");
      await pagina.getByRole("button", { name: "Declarar pago" }).dblclick();
      await pagina.waitForURL(`**/compras/${recepcionId}`);
      await pagina.getByText(/^Transferencia · \d{2}\/\d{2}\/\d{4}$/).waitFor();
      await pagina
        .getByText(/· \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)
        .first()
        .waitFor();
      expect(await pagos(comprobanteId)).toBe(1);
      expect(await auditorias("PAGO_DECLARADO")).toBe(antes + 1);
      expect(await pagina.getByRole("link", { name: "Declarar pago" }).count()).toBe(0);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("en efectivo: la caja abierta y el motivo; el pago y el egreso de caja son uno solo y la caja baja el importe de la factura UNA sola vez aunque se toque dos veces", async () => {
      const { recepcionId, comprobanteId } = await compraConFactura();
      const antes = await saldoDeLaCaja();
      await ir(`/compras/${recepcionId}/pago`);
      await pagina.getByLabel("Medio").selectOption("EFECTIVO");
      await pagina.getByLabel("Caja").selectOption({ label: "Caja del recorrido" });
      await pagina.getByLabel("Motivo").fill("Pago de la factura al contado");
      await pagina.getByRole("button", { name: "Declarar pago" }).dblclick();
      await pagina.waitForURL(`**/compras/${recepcionId}`);
      await pagina.getByText(/^Efectivo · \d{2}\/\d{2}\/\d{4}$/).waitFor();
      expect(await pagos(comprobanteId)).toBe(1);
      expect(Number(await saldoDeLaCaja()) - Number(antes)).toBe(-1210);
    });

    it("dos pestañas pagan la misma factura: la primera paga y la segunda ve el genérico, sin escribir", async () => {
      const { recepcionId, comprobanteId } = await compraConFactura();
      const otra = await contexto.newPage();
      const antes = await auditorias("PAGO_DECLARADO");
      try {
        await ir(`/compras/${recepcionId}/pago`);
        await ir(`/compras/${recepcionId}/pago`, otra);
        await pagina.getByLabel("Medio").selectOption("QR");
        await otra.getByLabel("Medio").selectOption("TRANSFERENCIA");
        await pagina.getByRole("button", { name: "Declarar pago" }).click();
        await pagina.waitForURL(`**/compras/${recepcionId}`);
        await otra.getByRole("button", { name: "Declarar pago" }).click();
        await otra.getByText(GENERICO).waitFor();
        expect(await pagos(comprobanteId)).toBe(1);
        expect(await auditorias("PAGO_DECLARADO")).toBe(antes + 1);
      } finally {
        await otra.close();
      }
    });

    it("anular el pago en efectivo: la hoja pide el motivo, dos toques seguidos = UNA anulación y UN reintegro; la ficha dice «Anulado» y vuelve «Declarar pago»", async () => {
      const { recepcionId, comprobanteId } = await compraConFactura();
      const antes = await saldoDeLaCaja();
      await ir(`/compras/${recepcionId}/pago`);
      await pagina.getByLabel("Medio").selectOption("EFECTIVO");
      await pagina.getByLabel("Caja").selectOption({ label: "Caja del recorrido" });
      await pagina.getByLabel("Motivo").fill("Pago de la factura");
      await pagina.getByRole("button", { name: "Declarar pago" }).click();
      await pagina.waitForURL(`**/compras/${recepcionId}`);
      const anuladasAntes = await auditorias("PAGO_ANULADO");
      // La ficha tiene dos «Anular» (el de la compra, al pie, y el del pago, en su tarjeta): acá se toca el del pago.
      await pagina
        .locator("section")
        .filter({ hasText: /Efectivo · \d{2}\/\d{2}\/\d{4}/ })
        .getByRole("button", { name: "Anular" })
        .click();
      const hoja = pagina.getByRole("dialog");
      await hoja.getByLabel("Motivo").waitFor();
      expect(await hoja.getByRole("button", { name: "Anular" }).isDisabled()).toBe(true);
      await hoja.getByLabel("Motivo").fill("Se pagó dos veces");
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      await hoja.getByRole("button", { name: "Anular" }).dblclick();
      await pagina.getByText("Se pagó dos veces").first().waitFor();
      await pagina.getByText("Anulado", { exact: true }).first().waitFor();
      await pagina.getByRole("link", { name: "Declarar pago" }).waitFor();
      expect(await pagos(comprobanteId)).toBe(1);
      expect(
        await contar(
          "select count(*)::text as n from pago_de_comprobante where comprobante_id = $1 and estado = 'ANULADO'",
          [comprobanteId],
        ),
      ).toBe(1);
      expect(await auditorias("PAGO_ANULADO")).toBe(anuladasAntes + 1);
      expect(await saldoDeLaCaja()).toBe(antes);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("una compra sin factura o una dirección de pago de un id que no existe responden el genérico y no ofrecen formulario", async () => {
      await ir("/compras/0b0b0b0b-1111-4222-8333-444444444444/pago");
      await pagina.getByText(GENERICO).waitFor();
      expect(await pagina.getByLabel("Medio").count()).toBe(0);
    });
  },
);
