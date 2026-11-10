import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearEscenario } from "../integracion/facturacion-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Lo que `facturacion.recorrido.ts` no cubre, con la app REAL construida, un navegador real y ARCA simulada (E1-T1): una empresa MONOTRIBUTISTA que
 * emite una Factura C (sin IVA discriminado), la anula con una nota de crédito TOTAL y con una PARCIAL desde la pantalla «Anular», y el estado
 * «Confirmando» cuando ARCA no da una respuesta definitiva (la factura queda incierta y nunca se reenvía). Los pasos son SECUENCIALES a propósito,
 * como la persona real. Los pedidos que ARCA simulada tiene que ver (tipo 11 factura C, tipo 13 nota de crédito C, `CbtesAsoc`, sin `AlicIva`) están
 * en las grabaciones reales de `test/utilidades/arca-grabaciones/corrida1/039` y `043` a `052`: ningún pedido nuevo se inventa.
 *
 * Los datos fiscales y el punto de venta se siembran por SQL con el mismo escenario de las pruebas de integración (el recorrido que carga los datos
 * fiscales a mano ya existe en `facturacion.recorrido.ts`); acá lo que se mira es lo que pasa después.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de facturación (monotributo): Factura C, notas de crédito y «Confirmando»",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;

    const ir = async (ruta: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const idDelComprobante = () => /\/comprobantes\/([0-9a-f-]{36})/.exec(pagina.url())?.[1] ?? "";
    const dueno = () => mundo.mundo.dueno;
    const solicitudes = () => mundo.arca.pedidos.filter((p) => p.operacion === "FECAESolicitar");

    /** La emisión sale a ARCA después de responder: la pantalla se actualiza al recargar. */
    const esperarA = async (estado: string, que: string) => {
      const limite = Date.now() + 30_000;
      while ((await pagina.getByText(estado, { exact: true }).count()) === 0) {
        if (Date.now() > limite) throw new Error(`${que} no llegó a «${estado}» en 30 s`);
        await pagina.waitForTimeout(1000);
        await pagina.reload();
        await pagina.waitForLoadState("networkidle");
      }
    };

    /**
     * La etiqueta «Anulación …» cuenta también la nota que todavía está «Validando» (D-15): se espera además a que ARCA simulada la autorice,
     * que es lo que estos pasos afirman.
     */
    const esperarQueLaNotaSeAutorice = async (factura: string) => {
      const limite = Date.now() + 30_000;
      for (;;) {
        const { rows } = await dueno().query<{ estado: string }>(
          "select estado from comprobante where comprobante_asociado_id = $1",
          [factura],
        );
        if (rows.length > 0 && rows.every((r) => r.estado === "AUTORIZADO")) return;
        if (Date.now() > limite)
          throw new Error("la nota de crédito no llegó a AUTORIZADO en 30 s");
        await pagina.waitForTimeout(500);
      }
    };

    /** Emite una Factura C de consumidor final por `precio` (empresa monotributista: sin selector de IVA) y espera a que quede en `estado`. */
    const emitirFacturaC = async (precio: string, estado: "Autorizada" | "Confirmando") => {
      await ir("/facturacion/comprobantes/emitir");
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByLabel("Descripción").fill("Servicio de reparación");
      // El monotributista no discrimina IVA: el campo se llama «Precio» y no hay selector de alícuota.
      await pagina.getByLabel("Precio", { exact: true }).fill(precio);
      expect(await pagina.getByLabel("IVA", { exact: true }).count()).toBe(0);
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByRole("button", { name: "Emitir factura" }).click();
      await pagina.waitForURL(/\/facturacion\/comprobantes\/[0-9a-f-]{36}$/);
      await esperarA(estado, "la factura C");
    };

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base);
      // Datos fiscales de un MONOTRIBUTISTA (con Ingresos Brutos) y un punto de venta activo, sembrados como en las pruebas de integración.
      const consulta = async <T>(texto: string, parametros: unknown[]): Promise<T> =>
        (await dueno().query<T extends object ? T : never>(texto, parametros)).rows[0] as T;
      const { cuit } = await consulta<{ cuit: string }>("select cuit from empresa where id = $1", [
        mundo.empresa,
      ]);
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
      const { tenant_id: tenant } = await consulta<{ tenant_id: string }>(
        "select tenant_id from empresa where id = $1",
        [mundo.empresa],
      );
      await crearEscenario(dueno(), {
        mundo: { tenant, empresa: mundo.empresa, cuit, sucursal, persona, emisor },
        condicionIva: "MONOTRIBUTO",
        razonSocial: "Taller Zulú",
      });
      const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
      navegador = await chromium.launch({
        ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
        // Sin proxy del entorno: la app es de loopback y nada de la prueba tiene que salir a internet.
        args: ["--no-proxy-server"],
      });
      // El certificado de la fachada es autofirmado y de esta corrida: solo por eso se aceptan los errores de TLS.
      contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
      await contexto.addCookies([...mundo.cookies]);
      pagina = await contexto.newPage();
      vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    });
    afterAll(async () => {
      await navegador?.close();
      await mundo?.cerrar();
    });

    it("Emitir: una Factura C termina AUTORIZADA, sin IVA discriminado, y ARCA recibe el tipo 11", async () => {
      await emitirFacturaC("121,00", "Autorizada");
      expect(await pagina.locator("main").innerText()).toMatch(/CAE\s+86410995\d{6}/);
      const pedido = solicitudes().at(-1)?.cuerpo ?? "";
      expect(pedido).toContain("<ar:CbteTipo>11</ar:CbteTipo>");
      expect(pedido).toContain("<ar:ImpTotal>121.00</ar:ImpTotal>");
      expect(pedido).toContain("<ar:ImpNeto>121.00</ar:ImpNeto>");
      expect(pedido).toContain("<ar:ImpIVA>0.00</ar:ImpIVA>");
      expect(pedido).not.toContain("<ar:AlicIva>");
      const { rows } = await dueno().query<{ tipo: string; estado: string; iva: string }>(
        "select tipo_comprobante as tipo, estado, iva::text as iva from comprobante where id = $1",
        [idDelComprobante()],
      );
      expect(rows).toEqual([{ tipo: "FACTURA_C", estado: "AUTORIZADO", iva: "0.00" }]);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Anular con el total: la nota de crédito C sale AUTORIZADA y la factura queda «Anulación total»", async () => {
      const factura = idDelComprobante();
      await pagina.getByRole("link", { name: "Anular con nota de crédito" }).click();
      await pagina.waitForURL(/\/anular$/);
      await pagina.getByText("Se anula el total").first().waitFor();
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByLabel("Motivo (obligatorio)").fill("El cliente devolvió el servicio");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Anular comprobante" }).click();
      await pagina.waitForURL(new RegExp(`/facturacion/comprobantes/${factura}$`));
      // La nota sale a ARCA después de responder: el detalle de la factura muestra la etiqueta cuando la nota se autoriza.
      const limite = Date.now() + 30_000;
      while ((await pagina.getByText("Anulación total").count()) === 0) {
        if (Date.now() > limite) throw new Error("la nota de crédito no llegó a anular en 30 s");
        await pagina.waitForTimeout(1000);
        await pagina.reload();
        await pagina.waitForLoadState("networkidle");
      }
      await esperarQueLaNotaSeAutorice(factura);
      expect(await pagina.locator("article").innerText()).toContain(
        "Ya anulado con notas de crédito",
      );
      // ARCA simulada vio una nota de crédito C (tipo 13) por el total, asociada a la factura C (tipo 11) y sin IVA.
      const pedido = solicitudes().at(-1)?.cuerpo ?? "";
      expect(pedido).toContain("<ar:CbteTipo>13</ar:CbteTipo>");
      expect(pedido).toContain("<ar:ImpTotal>121.00</ar:ImpTotal>");
      expect(pedido).toContain("<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>11</ar:Tipo>");
      expect(pedido).not.toContain("<ar:AlicIva>");
      const { rows } = await dueno().query<{
        tipo: string;
        estado: string;
        total: string;
        asociado: string;
      }>(
        `select tipo_comprobante as tipo, estado, total::text as total, comprobante_asociado_id as asociado
           from comprobante where comprobante_asociado_id = $1`,
        [factura],
      );
      expect(rows).toEqual([
        { tipo: "NOTA_CREDITO_C", estado: "AUTORIZADO", total: "121.00", asociado: factura },
      ]);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Anular una parte: una nota de crédito C por un importe menor sale AUTORIZADA y la factura queda «Anulación parcial»", async () => {
      await emitirFacturaC("200,00", "Autorizada");
      const factura = idDelComprobante();
      await pagina.getByRole("link", { name: "Anular con nota de crédito" }).click();
      await pagina.waitForURL(/\/anular$/);
      await pagina.getByRole("button", { name: "Anular solo una parte" }).first().click();
      // En letra C no hay alícuotas: un solo importe.
      await pagina.getByLabel("Importe a anular", { exact: true }).fill("50,00");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByLabel("Motivo (obligatorio)").fill("Descuento acordado");
      await pagina.getByRole("button", { name: "Anular comprobante" }).click();
      await pagina.waitForURL(new RegExp(`/facturacion/comprobantes/${factura}$`));
      const limite = Date.now() + 30_000;
      while ((await pagina.getByText("Anulación parcial").count()) === 0) {
        if (Date.now() > limite) throw new Error("la nota parcial no llegó a anular en 30 s");
        await pagina.waitForTimeout(1000);
        await pagina.reload();
        await pagina.waitForLoadState("networkidle");
      }
      await esperarQueLaNotaSeAutorice(factura);
      const pedido = solicitudes().at(-1)?.cuerpo ?? "";
      expect(pedido).toContain("<ar:CbteTipo>13</ar:CbteTipo>");
      expect(pedido).toContain("<ar:ImpTotal>50.00</ar:ImpTotal>");
      const { rows } = await dueno().query<{ tipo: string; estado: string; total: string }>(
        "select tipo_comprobante as tipo, estado, total::text as total from comprobante where comprobante_asociado_id = $1",
        [factura],
      );
      expect(rows).toEqual([{ tipo: "NOTA_CREDITO_C", estado: "AUTORIZADO", total: "50.00" }]);
      // La factura original sigue AUTORIZADA y no se puede decir que quedó anulada del todo.
      expect(await pagina.locator("article").innerText()).not.toContain("Anulación total");
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("«Confirmando»: si ARCA no da una respuesta definitiva la factura queda incierta y NO se reenvía", async () => {
      const antes = solicitudes().length;
      mundo.arca.responderALaSolicitud("SIN_RESPUESTA_DEFINITIVA");
      try {
        await emitirFacturaC("80,00", "Confirmando");
        const incierta = idDelComprobante();
        expect(await pagina.locator("article").innerText()).toContain("ARCA no respondió a tiempo");
        expect(await pagina.locator("article").innerText()).toContain("No lo emitas de nuevo");
        const { rows } = await dueno().query<{
          estado: string;
          numero: string | null;
          cae: string | null;
        }>("select estado, numero::text as numero, cae from comprobante where id = $1", [incierta]);
        expect(rows).toEqual([{ estado: "INCIERTO", numero: null, cae: null }]);
        // La escritura se envió UNA vez; recargar la pantalla varias veces no la repite.
        for (let vez = 0; vez < 3; vez++) {
          await pagina.reload();
          await pagina.waitForLoadState("networkidle");
          await pagina.waitForTimeout(500);
        }
        expect(solicitudes().length - antes).toBe(1);
        expect(await pagina.getByText("Confirmando", { exact: true }).count()).toBeGreaterThan(0);
        await sinViolacionesDeAxe();
      } finally {
        mundo.arca.responderALaSolicitud("AUTORIZA");
      }
      vigilante.tomar();
    });

    it("«Confirmando» no se puede anular: la factura incierta no ofrece la nota de crédito", async () => {
      expect(await pagina.getByRole("link", { name: "Anular con nota de crédito" }).count()).toBe(
        0,
      );
    });

    it("Listado: la factura incierta figura como «Confirmando» y las autorizadas con su anulación", async () => {
      await ir("/facturacion/comprobantes");
      await pagina.getByRole("row", { name: /Factura C.*Confirmando/ }).waitFor();
      await pagina
        .getByRole("row", { name: /Factura C 00001-00000001.*Autorizada.*Anulación total/ })
        .waitFor();
      await pagina
        .getByRole("row", { name: /Factura C 00001-00000002.*Autorizada.*Anulación parcial/ })
        .waitFor();
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });
  },
);
