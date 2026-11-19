import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * COBRAR de punta a punta en la app REAL construida con un navegador real: la persona arma una cuenta, abre la vista de cobro, paga con efectivo de más (vuelto), con DOBLE TOQUE en «Cobrar»
 * queda un solo ticket y un solo cobro, el resultado dice «Cobrado» y el número, y «Anular» deja el ticket anulado. Lo que ven las pruebas de componentes y no esta: la página en el servidor
 * (qué caja y qué opciones), la acción de servidor, la CSP y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441). La sesión de caja se siembra en la base
 * (abrir la caja es otra pantalla). Los módulos en desarrollo se leen «disponibles» SOLO en el proceso de la app (`activar-modulos-en-desarrollo.mjs`).
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";

describe.skipIf(base === null)(
  "recorrido de cobrar: de la cuenta al ticket cobrado y anulado",
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
    // El cobro es una vista de la pantalla (no un cuadro); solo «Anular» abre un cuadro de diálogo.
    const enLaVista = () => pagina;
    const enElCuadro = () => pagina.getByRole("dialog");

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

    it("arma la cuenta y abre la vista de cobro con el total del servidor, el efectivo y «Cobro completo»", async () => {
      await ir("/ventas/venta-rapida");
      await pagina.getByRole("button", { name: /^Medialuna/ }).click();
      await pagina.getByRole("button", { name: "Agregar" }).click();
      await expect.poll(() => pagina.locator("[data-total]").innerText()).toBe("$ 800,00");
      await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
      await pagina.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
      expect(await pagina.locator("[data-total-del-cobro]").innerText()).toBe("$ 800,00");
      expect(await enLaVista().getByRole("combobox", { name: "Medio" }).inputValue()).not.toBe("");
      await enLaVista().getByText("Cobro completo").waitFor();
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("efectivo de más: dice el vuelto; con DOBLE TOQUE en «Cobrar» queda un solo ticket y un solo cobro por el neto", async () => {
      await enLaVista().getByRole("textbox", { name: "Importe" }).fill("1000");
      await enLaVista().getByText("Vuelto $ 200,00").waitFor();
      // Pasada la espera de apertura del cobro (500 ms), el doble toque en «Cobrar» manda UN solo cobro.
      await pagina.waitForTimeout(700);
      await enLaVista().getByRole("button", { name: "Cobrar", exact: true }).dblclick();
      await enLaVista().getByText("Ticket N.º 1").waitFor();
      await enLaVista().getByText("Cobrado", { exact: true }).first().waitFor();
      expect(await contar("ticket")).toBe(1);
      expect(await contar("cobro")).toBe(1);
      const cobro = await consulta<{ importe: string }>(
        "select m.importe::text as importe from cobro c join movimiento_caja m on m.id = c.movimiento_id and m.empresa_id = c.empresa_id where c.empresa_id = $1",
        [mundo.empresa],
      );
      expect(cobro[0]?.importe).toBe("800.00");
      await enLaVista().getByRole("button", { name: "Imprimir ticket", exact: true }).waitFor();
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("«Imprimir ticket» (doble toque) muestra el papel del servidor con el total en formato argentino, no escribe nada y «Volver» regresa al resultado", async () => {
      const antes = [
        await contar("ticket"),
        await contar("cobro"),
        await contar("movimiento_caja"),
      ];
      await enLaVista().getByRole("button", { name: "Imprimir ticket", exact: true }).dblclick();
      await enLaVista().getByRole("heading", { name: "Ticket del cliente" }).waitFor();
      const lineas = await pagina.locator("[data-linea-del-papel]").allInnerTexts();
      expect(lineas[0]).toBe("Ticket N.º 1");
      expect(lineas.at(-1)).toMatch(/^Total\s+800,00$/);
      expect(lineas.join("\n")).toMatch(/\d{2}\/\d{2}\/\d{4}/);
      await enLaVista().getByRole("button", { name: "Imprimir", exact: true }).waitFor();
      expect([
        await contar("ticket"),
        await contar("cobro"),
        await contar("movimiento_caja"),
      ]).toEqual(antes);
      await sinViolacionesDeAxe();
      await enLaVista().getByRole("button", { name: "Volver", exact: true }).click();
      await enLaVista().getByRole("button", { name: "Anular", exact: true }).waitFor();
      await enLaVista().getByText("Cobrado", { exact: true }).first().waitFor();
      pantallaLimpia();
    });

    it("anular con motivo deja el ticket anulado y «Nueva venta» vuelve a la cuenta vacía", async () => {
      await enLaVista().getByRole("button", { name: "Anular", exact: true }).click();
      await enElCuadro().getByRole("button", { name: "Anular", exact: true }).click();
      await enElCuadro().getByText("Escribí el motivo").waitFor();
      await enElCuadro().getByRole("textbox", { name: "Motivo" }).fill("Error de carga");
      await enElCuadro().getByRole("button", { name: "Anular", exact: true }).dblclick();
      await enLaVista().getByText("Anulado", { exact: true }).first().waitFor();
      expect(await contar("ticket")).toBe(1); // la anulación es un ejemplar nuevo del mismo ticket
      const estados = await consulta<{ estado: string }>(
        "select estado from ticket where empresa_id = $1 order by numero",
        [mundo.empresa],
      );
      expect(estados.map((e) => e.estado)).toContain("ANULADO");
      await enLaVista().getByRole("button", { name: "Nueva venta", exact: true }).click();
      await expect.poll(() => pagina.locator("[data-total]").innerText()).toBe("$ 0,00");
      pantallaLimpia();
    });
  },
);
