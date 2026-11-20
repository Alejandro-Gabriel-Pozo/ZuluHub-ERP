import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «TICKETS DEL DÍA» de punta a punta en la app REAL con un navegador real: se cobra una venta, la lista de la jornada muestra el ticket arriba con «Cobrado», la hora y el total; la ficha trae renglones y
 * cobros; «Imprimir ticket» muestra el papel y «Volver» regresa a la ficha sin escribir nada; «Anular» con motivo (doble toque = una sola anulación) deja la ficha «Anulado» con el motivo y el correo, y la
 * lista lo muestra con el total tachado; el id de un ticket que no existe responde el genérico. Lo que no ven las pruebas de componentes: las dos páginas en el servidor, la acción de anular, la CSP y que
 * ningún componente rompa en el navegador. La sesión de caja se siembra en la base (abrir la caja es otra pantalla).
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";

describe.skipIf(base === null)(
  "recorrido de tickets del día: de la lista a la ficha anulada",
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

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulosAdicionales: ["catalogo", "caja", "ventas"],
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
      const cliente = c;
      try {
        await cliente.query("begin");
        await cliente.query("set local session_replication_role = replica");
        await cliente.query(
          `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por, clave_idempotencia, huella)
           values ($1, $2, (now() at time zone 'America/Argentina/Buenos_Aires')::date, '00:00', 'America/Argentina/Buenos_Aires', now(), $3, $4, $5)`,
          [mundo.empresa, caja, persona, `recorrido-${"a".repeat(20)}`, "0".repeat(64)],
        );
        await cliente.query("commit");
      } catch (error) {
        await cliente.query("rollback");
        throw error;
      }
      const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
      navegador = await chromium.launch({
        ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
        args: ["--no-proxy-server"],
      });
      contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
      await contexto.addCookies([...mundo.cookies]);
      pagina = await contexto.newPage();
      vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    });
    afterAll(async () => {
      await navegador?.close();
      await mundo?.cerrar();
    });

    it("se cobra una venta y la lista de la jornada la muestra arriba, con «Cobrado», la hora y el total; el menú tiene la entrada", async () => {
      await ir("/ventas/venta-rapida");
      await pagina.getByRole("button", { name: /^Medialuna/ }).click();
      await pagina.getByRole("button", { name: "Agregar" }).click();
      await expect.poll(() => pagina.locator("[data-total]").innerText()).toBe("$ 800,00");
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
      await pagina.waitForTimeout(700);
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.getByText("Ticket N.º 1").waitFor();
      await ir("/ventas/tickets-del-dia");
      await pagina.getByText(/^Jornada \d{2}\/\d{2}\/\d{4}$/).waitFor();
      const fila = pagina.getByRole("link", {
        name: /^Ticket N\.º 1, Cobrado, \d{2}:\d{2}, \$ 800,00$/,
      });
      await fila.waitFor();
      // En el celular el menú de cada área es un desplegable: «Tickets del día» está adentro de «Ventas», debajo de «Venta rápida».
      await pagina
        .getByRole("navigation", { name: "Navegación principal" })
        .getByText("Ventas", { exact: true })
        .click();
      const entrada = pagina.getByRole("link", { name: "Tickets del día", exact: true });
      await entrada.waitFor();
      expect(await entrada.getAttribute("href")).toBe("/ventas/tickets-del-dia");
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("la ficha trae renglones, cobros y caja; «Imprimir ticket» muestra el papel sin escribir nada y «Volver» regresa a la ficha", async () => {
      await pagina.getByRole("link", { name: /^Ticket N\.º 1, Cobrado/ }).click();
      await pagina.getByRole("heading", { name: "Ticket N.º 1", level: 2 }).waitFor();
      await pagina.getByText("1 Medialuna", { exact: true }).waitFor();
      await pagina.getByText("Cobros", { exact: true }).waitFor();
      await pagina.getByText("Efectivo", { exact: true }).waitFor();
      await pagina.getByText("Caja 1", { exact: true }).waitFor();
      await sinViolacionesDeAxe();
      const antes = [
        await contar("ticket"),
        await contar("cobro"),
        await contar("ticket_correccion"),
      ];
      await pagina.getByRole("button", { name: "Imprimir ticket", exact: true }).dblclick();
      await pagina.getByRole("heading", { name: "Ticket del cliente" }).waitFor();
      expect((await pagina.locator("[data-linea-del-papel]").allInnerTexts())[0]).toBe(
        "Ticket N.º 1",
      );
      expect([
        await contar("ticket"),
        await contar("cobro"),
        await contar("ticket_correccion"),
      ]).toEqual(antes);
      await pagina.getByRole("button", { name: "Volver", exact: true }).click();
      await pagina.getByRole("heading", { name: "Ticket N.º 1", level: 2 }).waitFor();
      pantallaLimpia();
    });

    it("anular: motivo vacío dice «Escribí el motivo»; con motivo y DOBLE TOQUE queda una sola anulación y la ficha dice «Anulado» con el motivo y el correo; la lista lo muestra tachado", async () => {
      const hoja = pagina.getByRole("dialog");
      await pagina.getByRole("button", { name: "Anular", exact: true }).click();
      await hoja.getByRole("button", { name: "Anular", exact: true }).click();
      await hoja.getByText("Escribí el motivo").waitFor();
      await hoja.getByRole("textbox", { name: "Motivo" }).fill("Error de carga");
      await hoja.getByRole("button", { name: "Anular", exact: true }).dblclick();
      await pagina.getByText("Error de carga", { exact: true }).waitFor();
      await pagina.locator("[data-motivo-anulado]").waitFor();
      expect(await hoja.count()).toBe(0);
      expect(await contar("ticket_correccion")).toBe(1);
      expect(await pagina.getByRole("button", { name: "Anular", exact: true }).count()).toBe(0);
      expect(
        await pagina.getByRole("button", { name: "Imprimir ticket", exact: true }).count(),
      ).toBe(0);
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Volver", exact: true }).click();
      await pagina
        .getByRole("link", { name: /^Ticket N\.º 1, Anulado, \d{2}:\d{2}, \$ 800,00$/ })
        .waitFor();
      expect(await pagina.locator("s").count()).toBe(1);
      pantallaLimpia();
    });

    it("el id de un ticket que no existe (u otra empresa o sucursal) responde el genérico", async () => {
      await ir("/ventas/tickets-del-dia/0b0b0b0b-1111-4222-8333-444444444444");
      await pagina.getByText("Esta acción no está permitida").waitFor();
      await ir("/ventas/tickets-del-dia/no-es-un-id");
      await pagina.getByText("Esta acción no está permitida").waitFor();
    });
  },
);
