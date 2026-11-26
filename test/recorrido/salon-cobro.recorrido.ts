import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * SAL-D: «Cobrar la mesa» de punta a punta en la app REAL construida, con un navegador real y una base real: con platos sin enviar «Cobrar» está apagado y se enciende al enviar a cocina; abre la hoja de cobro de ESA mesa con el
 * total del servidor; con DOBLE TOQUE en «Cobrar» queda un solo ticket y un solo cobro, el resultado dice «Cobrado» y el número y «Anular», y la mesa queda libre; desde DOS pestañas cobrando la misma mesa a la vez, uno cobra y
 * el otro no (un solo ticket). Lo que esta prueba ve y las de componentes no: la página en el servidor (caja, opciones y total), la acción de servidor, la CSP y que ningún componente rompa en el navegador (React #441).
 * La sesión de caja se siembra en la base (abrirla es otra pantalla).
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";
const CELULAR = { width: 390, height: 844 } as const;

describe.skipIf(base === null)(
  "recorrido de cobrar la mesa: de la ficha al ticket y la mesa libre",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;

    const ir = async (p: Page, ruta: string) => {
      const respuesta = await p.goto(`${mundo.url}${ruta}`);
      await p.waitForLoadState("networkidle");
      return respuesta;
    };
    const consulta = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
      (await mundo.mundo.dueno.query<T>(texto, p)).rows;
    const contar = async (tabla: string) =>
      Number(
        (
          await consulta<{ n: string }>(
            `select count(*)::text as n from ${tabla} where empresa_id = $1`,
            [mundo.empresa],
          )
        )[0]?.n,
      );
    const cuentasAbiertas = async () =>
      Number(
        (
          await consulta<{ n: string }>(
            "select count(*)::text as n from cuenta_consumo where empresa_id = $1 and estado = 'ABIERTA'",
            [mundo.empresa],
          )
        )[0]?.n,
      );
    /** Una mesa nueva con una medialuna agregada (sin enviar), parado en su ficha. */
    const mesaConPedido = async (numero: number, columna: number) => {
      await ir(pagina, "/salon/mesas/nueva");
      await pagina.getByLabel("Número", { exact: true }).fill(String(numero));
      await pagina.getByLabel("Columna", { exact: true }).fill(String(columna));
      await pagina.getByLabel("Fila", { exact: true }).fill("2");
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.waitForURL("**/salon/mesas");
      await ir(pagina, "/salon");
      await pagina.getByRole("link", { name: `Mesa ${String(numero)}` }).click();
      await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}$/);
      await pagina.getByRole("button", { name: "Tomar pedido" }).click();
      await pagina.getByText("La mesa no tiene pedido").waitFor();
      await pagina.getByRole("button", { name: /^Medialuna/ }).click();
      await pagina.getByRole("button", { name: /^Agregar( ·|$)/ }).click();
      await pagina.getByRole("heading", { name: "Para enviar" }).waitFor();
    };
    const enviarYRecargar = async () => {
      await pagina.getByRole("button", { name: "Enviar a cocina" }).click();
      await pagina.getByText("No hay impresora para la comanda de cocina").waitFor();
      await pagina.reload();
      await pagina.getByRole("heading", { name: "Enviadas" }).waitFor();
    };

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulos: ["facturacion", "catalogo", "caja", "ventas", "comandas", "salon"],
        perillas: { salon: { tipo: "INTERRUPTOR", encendida: true } },
        activarModulosEnDesarrollo: true,
      });
      const c = mundo.mundo.dueno;
      const medialuna = await productoDeBase(c, mundo.empresa, { nombre: "Medialuna" });
      await precioDeBase(c, {
        empresa: mundo.empresa,
        producto: medialuna,
        precio: "800.00",
        desde: DESDE,
      });
      // La caja con su sesión abierta de hoy (abrirla es otra pantalla) y el efectivo.
      const sucursal = (
        await consulta<{ id: string }>("select id from sucursal where empresa_id = $1 limit 1", [
          mundo.empresa,
        ])
      )[0]?.id;
      const persona = (
        await consulta<{ persona_id: string }>(
          "select persona_id from membresia where empresa_id = $1 limit 1",
          [mundo.empresa],
        )
      )[0]?.persona_id;
      const caja = (
        await consulta<{ id: string }>(
          "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja 1') returning id",
          [mundo.empresa, sucursal],
        )
      )[0]?.id;
      await c.query(
        "insert into medio_de_pago (empresa_id, tipo) values ($1, 'EFECTIVO') on conflict do nothing",
        [mundo.empresa],
      );
      // Un disparador exige que la sesión la abra la persona del contexto firmado: acá la siembra el dueño de la base, sin disparadores (solo esta transacción).
      try {
        await c.query("begin");
        await c.query("set local session_replication_role = replica");
        await c.query(
          `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por, clave_idempotencia, huella)
           values ($1, $2, (now() at time zone 'America/Argentina/Buenos_Aires')::date, '00:00', 'America/Argentina/Buenos_Aires', now(), $3, $4, $5)`,
          [mundo.empresa, caja, persona, `recorrido-${"a".repeat(20)}`, "0".repeat(64)],
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
      contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
      await contexto.addCookies([...mundo.cookies]);
      pagina = await contexto.newPage();
      vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    });
    afterAll(async () => {
      await navegador?.close();
      await mundo?.cerrar();
    });

    it("«Cobrar» está apagado con platos sin enviar; enviado, abre la hoja de cobro de la mesa; doble toque en «Cobrar»: un solo ticket, «Cobrado», con «Anular», y la mesa queda libre", async () => {
      await mesaConPedido(7, 3);
      expect(await pagina.getByRole("button", { name: "Cobrar", exact: true }).isDisabled()).toBe(
        true,
      );
      await enviarYRecargar();
      expect(await pagina.getByRole("button", { name: "Cobrar", exact: true }).isDisabled()).toBe(
        false,
      );
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}\/cobrar$/);
      await pagina.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
      await pagina.locator("[data-total-del-cobro]").getByText("$ 800,00").waitFor();
      expect(await pagina.getByText("Propina").count()).toBe(0);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

      await pagina.getByRole("button", { name: "Cobrar", exact: true }).dblclick();
      await pagina.getByText("Cobrado", { exact: true }).waitFor();
      await pagina.getByText("Ticket N.º 1").waitFor();
      expect(await pagina.getByRole("button", { name: "Anular", exact: true }).count()).toBe(1);
      expect(await contar("ticket")).toBe(1);
      expect(await contar("cobranza_de_ticket")).toBe(1);
      expect(await cuentasAbiertas()).toBe(0);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

      await pagina.getByRole("button", { name: "Volver", exact: true }).click();
      await pagina.waitForURL(`${mundo.url}/salon`);
      await pagina.getByText("Libre", { exact: true }).first().waitFor();
      expect(vigilante.tomar()).toEqual([]);
    });

    it("DOS PESTAÑAS cobrando la misma mesa a la vez: uno cobra, el otro recibe «No se pudo cobrar»; en la base hay UN solo ticket más", async () => {
      await mesaConPedido(8, 5);
      await enviarYRecargar();
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.waitForURL(/\/cobrar$/);
      const url = pagina.url();
      await pagina.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
      const otra = await contexto.newPage();
      await otra.goto(url);
      await otra.waitForLoadState("networkidle");
      await otra.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
      const antes = await contar("ticket");
      await Promise.all([
        pagina.getByRole("button", { name: "Cobrar", exact: true }).click(),
        otra.getByRole("button", { name: "Cobrar", exact: true }).click(),
      ]);
      const termino = async (p: Page) =>
        p
          .getByText(/^(Cobrado|No se pudo cobrar)/)
          .first()
          .waitFor();
      await termino(pagina);
      await termino(otra);
      const cobrados =
        (await pagina.getByText("Cobrado", { exact: true }).count()) +
        (await otra.getByText("Cobrado", { exact: true }).count());
      expect(cobrados).toBe(1);
      expect(await contar("ticket")).toBe(antes + 1);
      await otra.close();
      vigilante.tomar();
    });

    it("UNIR: la mesa 10 se une con la 9 (con «Cuánto queda»), un doble toque pasa los platos UNA vez, el mapa dice «Unida a la mesa 9» y cobrar la 9 libera las dos", async () => {
      await mesaConPedido(9, 7);
      await mesaConPedido(10, 9);
      await pagina.getByRole("button", { name: "Unir con otra mesa" }).click();
      await pagina.getByRole("button", { name: "Mesa 9", exact: true }).click();
      await pagina.getByText("Cuánto queda").waitFor();
      await pagina.getByText("$ 1.600,00").last().waitFor();
      await pagina.getByText(/Esto no se deshace/).waitFor();
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      await pagina.getByRole("button", { name: "Confirmar unión" }).dblclick();
      await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}$/);
      await pagina.getByRole("heading", { name: "Mesa 9" }).first().waitFor();
      expect(await pagina.getByText("1 × Medialuna").count()).toBe(2);
      expect(await contar("union_de_mesas")).toBe(1);

      await ir(pagina, "/salon");
      await pagina.getByText("Unida a la mesa 9").waitFor();
      await ir(pagina, "/salon");
      await pagina.getByRole("link", { name: "Mesa 9" }).click();
      await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}$/);
      await enviarYRecargar();
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).waitFor();
      await pagina.locator("[data-total-del-cobro]").getByText("$ 1.600,00").waitFor();
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.getByText("Cobrado", { exact: true }).waitFor();
      expect(await cuentasAbiertas()).toBe(0);
      vigilante.tomar();
    });
    it("ANULAR el cobro de la mesa: sin motivo no deja; con motivo queda «Anulado», no se reabre la mesa y la caja no se toca", async () => {
      await mesaConPedido(12, 13);
      await enviarYRecargar();
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.waitForURL(/\/cobrar$/);
      await pagina.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.getByText("Cobrado", { exact: true }).waitFor();
      const movimientos = await contar("movimiento_caja");
      await pagina.getByRole("button", { name: "Anular", exact: true }).click();
      const cuadro = pagina.getByRole("dialog");
      await cuadro.getByRole("button", { name: "Anular", exact: true }).click();
      await pagina.getByText("Escribí el motivo").waitFor();
      expect(await contar("ticket_correccion")).toBe(0);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      await cuadro.getByRole("textbox", { name: /Motivo/ }).fill("Se cobró de más");
      await cuadro.getByRole("button", { name: "Anular", exact: true }).dblclick();
      await pagina.getByText("Anulado", { exact: true }).first().waitFor();
      expect(await contar("ticket_correccion")).toBe(1);
      expect(await contar("movimiento_caja")).toBe(movimientos);
      expect(await cuentasAbiertas()).toBe(0);
      await pagina.getByRole("button", { name: "Volver", exact: true }).click();
      await pagina.waitForURL(`${mundo.url}/salon`);
      expect(vigilante.tomar()).toEqual([]);
    });
  },
);
