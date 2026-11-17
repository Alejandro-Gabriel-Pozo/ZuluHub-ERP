import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { crearEscenario } from "../integracion/facturacion-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { sembrarTicketCobrado, type TicketSembrado } from "./apoyo/ticket-cobrado";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * E1-T7: facturar un ticket de punta a punta, con la app REAL construida, un navegador real, una base real y ARCA simulada. Lo que hace la persona:
 * una venta cobrada en el mostrador aparece en «Pendientes de facturar», la abre, emite la factura (con doble clic en «Emitir factura»: sale UNA
 * sola), la factura queda autorizada con su CAE y la venta sale de Pendientes; la anula con una nota de crédito por el total y, al autorizarse la
 * nota, la venta REAPARECE en Pendientes (la factura ya no la cubre). Los pasos son SECUENCIALES a propósito, como la persona real. Ningún pedido a
 * ARCA se inventa: los de la factura B (tipo 6), la nota de crédito B (tipo 8) y su comprobante asociado están en `test/utilidades/arca-grabaciones/`.
 *
 * La venta cobrada se siembra por los casos de uso reales de caja y ventas (`apoyo/ticket-cobrado.ts`): todavía no hay pantalla de venta rápida.
 *
 * MIENTRAS `ventas`, `caja` Y `catalogo` ESTÉN `en_desarrollo` EN EL CATÁLOGO REAL, LA APP LOS RECHAZA (`MODULO_EN_DESARROLLO`, antes de mirar plan,
 * rol o permisos): es el «nace cerrado» que el dueño todavía no levantó, no un defecto. En ese caso corre un solo paso que deja a la vista ESE hecho
 * (Pendientes no ofrece la venta y dice que no se puede) y el recorrido completo se saltea; apenas el dueño pasa los tres módulos a «disponible»,
 * el paso del hecho desaparece y corre el recorrido entero SIN tocar este archivo.
 */
const base = inject("baseDePruebas");

/** El celular del mostrador (el mismo de los componentes: 390 x 844) y un escritorio común: Pendientes se mira en los dos. */
const CELULAR = { width: 390, height: 844 } as const;
const ESCRITORIO = { width: 1280, height: 720 } as const;

const modulosDeLaVentaAbiertos = (["ventas", "caja", "catalogo"] as const).every(
  // Como texto: hoy el tipo de cada estado es un literal y el compilador rechazaría comparar con el otro valor.
  (modulo) => (CATALOGO_DE_MODULOS[modulo].estado as string) === "disponible",
);

describe.skipIf(base === null)(
  "recorrido de facturación de un ticket: Pendientes → Emitir → Autorizada → nota de crédito → reaparece",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    let ticket: TicketSembrado;
    let facturaId = "";

    const ir = async (ruta: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const dueno = () => mundo.mundo.dueno;
    const solicitudes = () => mundo.arca.pedidos.filter((p) => p.operacion === "FECAESolicitar");
    const idDelComprobanteEnLaDireccion = () =>
      /\/comprobantes\/([0-9a-f-]{36})/.exec(pagina.url())?.[1] ?? "";
    /** La tarjeta de la venta sembrada en Pendientes: el enlace a SU pantalla de emitir (el texto, «Venta N.º 1», día y total, se afirma aparte). */
    const tarjetaDeLaVenta = () =>
      pagina.locator(`a[href$="/facturacion/comprobantes/emitir/venta/${ticket.ticketId}"]`);
    const textoDeLaTarjeta = async () =>
      (await tarjetaDeLaVenta().innerText()).replace(/\s+/g, " ");

    /**
     * La emisión sale a ARCA después de responder. Se espera a que la BASE diga que el comprobante llegó al estado (sin dormir un tiempo fijo:
     * `expect.poll` reintenta hasta el límite) y recién entonces se recarga la pantalla, que es lo que ve la persona.
     */
    const esperarEnLaBase = async (consulta: string, parametros: unknown[], estado: string) => {
      await expect
        .poll(
          async () =>
            (await dueno().query<{ estado: string }>(consulta, parametros)).rows.map(
              (r) => r.estado,
            ),
          { timeout: 30_000, message: `el comprobante no llegó a ${estado} en 30 s` },
        )
        .toEqual([estado]);
      await pagina.reload();
      await pagina.waitForLoadState("networkidle");
    };

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base);
      // Datos fiscales de un RESPONSABLE INSCRIPTO y un punto de venta activo, sembrados como en las pruebas de integración (el recorrido que
      // los carga a mano ya existe en `facturacion.recorrido.ts`); la venta cobrada, por los casos de uso reales.
      const consulta = async <T extends object>(texto: string, parametros: unknown[]): Promise<T> =>
        (await dueno().query<T>(texto, parametros)).rows[0] as T;
      const { cuit, tenant_id: tenant } = await consulta<{ cuit: string; tenant_id: string }>(
        "select cuit, tenant_id from empresa where id = $1",
        [mundo.empresa],
      );
      const { id: sucursal } = await consulta<{ id: string }>(
        "select id from sucursal where empresa_id = $1 limit 1",
        [mundo.empresa],
      );
      const { id: emisor } = await consulta<{ id: string }>(
        "select id from emisor where empresa_id = $1 and es_principal",
        [mundo.empresa],
      );
      const { persona_id: persona } = await consulta<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 limit 1",
        [mundo.empresa],
      );
      await crearEscenario(dueno(), {
        mundo: { tenant, empresa: mundo.empresa, cuit, sucursal, persona, emisor },
        razonSocial: "Panadería Zulú SA",
      });
      ticket = await sembrarTicketCobrado(mundo, { precio: "1210.00" });
      const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
      navegador = await chromium.launch({
        ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
        // Sin proxy del entorno: la app es de loopback y nada de la prueba tiene que salir a internet.
        args: ["--no-proxy-server"],
      });
      // El certificado de la fachada es autofirmado y de esta corrida: solo por eso se aceptan los errores de TLS.
      contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
      await contexto.addCookies([...mundo.cookies]);
      pagina = await contexto.newPage();
      vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    });
    afterAll(async () => {
      await navegador?.close();
      await mundo?.cerrar();
    });

    if (!modulosDeLaVentaAbiertos) {
      // HECHO CONOCIDO (verificado en la app real, 2026-11-15): con `ventas`, `caja` y `catalogo` en desarrollo, Pendientes no puede listar nada.
      it("«ventas» sigue en desarrollo: Pendientes no ofrece la venta cobrada y dice que no se puede (hecho conocido)", async () => {
        const respuesta = await ir("/facturacion/comprobantes/pendientes");
        expect(respuesta?.status()).toBe(200);
        expect(await tarjetaDeLaVenta().count()).toBe(0);
        expect(await pagina.getByText("No hay ventas pendientes de facturar").count()).toBe(0);
        await pagina.getByText("Esta función todavía está en desarrollo.").first().waitFor();
        // El ticket SÍ está cobrado en la base: lo que falta es que el módulo esté abierto, no la venta.
        const { rows } = await dueno().query<{ estado: string }>(
          "select estado from ticket where id = $1",
          [ticket.ticketId],
        );
        expect(rows).toEqual([{ estado: "COBRADO" }]);
        vigilante.tomar();
      });
      return;
    }

    it("Pendientes: la venta cobrada aparece con su número y su total", async () => {
      const r = await ir("/facturacion/comprobantes/pendientes");
      expect(r?.status()).toBe(200);
      await tarjetaDeLaVenta().waitFor();
      expect(await textoDeLaTarjeta()).toMatch(
        new RegExp(`^Venta N\\.º ${ticket.numero}\\b.*\\$ 1\\.210,00$`),
      );
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    // Antes marcada como falla conocida (`it.fails`: en escritorio la pantalla quedaba vacía). Con catalogo, caja y ventas «disponible» (DEC-0463)
    // pasa: la marca de falla esperada ya no corresponde y se quitó.
    it("Pendientes en escritorio: la venta cobrada se ve", async () => {
      await pagina.setViewportSize(ESCRITORIO);
      try {
        await ir("/facturacion/comprobantes/pendientes");
        await tarjetaDeLaVenta().waitFor({ timeout: 3_000 });
      } finally {
        await pagina.setViewportSize(CELULAR);
        vigilante.tomar();
      }
    });

    it("Emitir desde la venta: los renglones son los del ticket y no se pueden editar", async () => {
      await tarjetaDeLaVenta().click();
      await pagina.waitForURL(
        new RegExp(`/facturacion/comprobantes/emitir/venta/${ticket.ticketId}$`),
      );
      await pagina.getByText(`Venta N.º ${ticket.numero}`).first().waitFor();
      await sinViolacionesDeAxe();
      // Consumidor final por el total (lo que la pantalla propone): se sigue al paso de revisar.
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      const revision = await pagina.locator("main").innerText();
      expect(revision).toContain("Medialunas x12");
      expect(revision).toContain("1.210,00");
      // Los renglones se ven pero no se editan: no hay campos para escribirlos ni agregarlos.
      expect(await pagina.getByLabel("Descripción").count()).toBe(0);
      expect(await pagina.getByLabel("Precio con IVA").count()).toBe(0);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Emitir con DOBLE CLIC: sale UNA sola factura B, autorizada con el CAE de ARCA, y ARCA recibe UN solo pedido", async () => {
      await pagina.getByRole("button", { name: "Emitir factura" }).dblclick();
      await pagina.waitForURL(/\/facturacion\/comprobantes\/[0-9a-f-]{36}$/);
      facturaId = idDelComprobanteEnLaDireccion();
      await esperarEnLaBase(
        "select estado from comprobante where id = $1",
        [facturaId],
        "AUTORIZADO",
      );
      await pagina.getByText("Autorizada", { exact: true }).waitFor();
      expect(await pagina.locator("main").innerText()).toMatch(/CAE\s+86410995\d{6}/);

      // Idempotencia visible: UNA factura en la empresa, UN documento de ticket vigente y UN pedido de emisión a ARCA.
      const { rows: facturas } = await dueno().query<{
        tipo: string;
        estado: string;
        total: string;
      }>(
        "select tipo_comprobante as tipo, estado, total::text as total from comprobante where empresa_id = $1",
        [mundo.empresa],
      );
      expect(facturas).toEqual([{ tipo: "FACTURA_B", estado: "AUTORIZADO", total: "1210.00" }]);
      const { rows: documentos } = await dueno().query<{ comprobante_id: string }>(
        "select comprobante_id from documento_de_ticket where empresa_id = $1 and ticket_id = $2 and vigente",
        [mundo.empresa, ticket.ticketId],
      );
      expect(documentos).toEqual([{ comprobante_id: facturaId }]);
      expect(solicitudes()).toHaveLength(1);
      // ARCA simulada vio una Factura B (tipo 6) de 1.210,00 con el IVA discriminado por dentro (consumidor final, sin identificar).
      const pedido = solicitudes()[0]?.cuerpo ?? "";
      expect(pedido).toContain("<ar:CbteTipo>6</ar:CbteTipo>");
      expect(pedido).toContain("<ar:ImpTotal>1210.00</ar:ImpTotal>");
      expect(pedido).toContain("<ar:DocTipo>99</ar:DocTipo>");
      // Emisión no es venta: facturar nunca cambia el ticket ya cobrado.
      const { rows: tickets } = await dueno().query<{ estado: string; total: string }>(
        "select estado, total::text as total from ticket where id = $1",
        [ticket.ticketId],
      );
      expect(tickets).toEqual([{ estado: "COBRADO", total: "1210.00" }]);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Pendientes: la venta ya facturada sale de la lista", async () => {
      await ir("/facturacion/comprobantes/pendientes");
      await pagina.getByText("No hay ventas pendientes de facturar").waitFor();
      expect(await tarjetaDeLaVenta().count()).toBe(0);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Anular por el total: la nota de crédito B sale AUTORIZADA y la factura queda «Anulación total»", async () => {
      await ir(`/facturacion/comprobantes/${facturaId}`);
      await pagina.getByRole("link", { name: "Anular con nota de crédito" }).click();
      await pagina.waitForURL(/\/anular$/);
      await pagina.getByText("Se anula el total").first().waitFor();
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByLabel("Motivo (obligatorio)").fill("El cliente devolvió la compra");
      await pagina.getByRole("button", { name: "Anular comprobante" }).click();
      await pagina.waitForURL(new RegExp(`/facturacion/comprobantes/${facturaId}$`));
      await esperarEnLaBase(
        "select estado from comprobante where comprobante_asociado_id = $1",
        [facturaId],
        "AUTORIZADO",
      );
      await pagina.getByText("Anulación total").first().waitFor();
      // ARCA simulada vio una nota de crédito B (tipo 8) por el total, asociada a la factura B (tipo 6).
      expect(solicitudes()).toHaveLength(2);
      const pedido = solicitudes()[1]?.cuerpo ?? "";
      expect(pedido).toContain("<ar:CbteTipo>8</ar:CbteTipo>");
      expect(pedido).toContain("<ar:ImpTotal>1210.00</ar:ImpTotal>");
      expect(pedido).toContain("<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>6</ar:Tipo>");
      const { rows } = await dueno().query<{ tipo: string; estado: string; total: string }>(
        "select tipo_comprobante as tipo, estado, total::text as total from comprobante where comprobante_asociado_id = $1",
        [facturaId],
      );
      expect(rows).toEqual([{ tipo: "NOTA_CREDITO_B", estado: "AUTORIZADO", total: "1210.00" }]);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Pendientes: con la nota autorizada la venta REAPARECE (la factura anulada ya no la cubre)", async () => {
      await ir("/facturacion/comprobantes/pendientes");
      await tarjetaDeLaVenta().waitFor();
      expect(await pagina.getByText("No hay ventas pendientes de facturar").count()).toBe(0);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });
  },
);
