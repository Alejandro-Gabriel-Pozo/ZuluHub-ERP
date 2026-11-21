import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * La VENTA A $ 0 (cortesía, decisión 155) de punta a punta en la app REAL: «Cobrar» con total $ 0 pide la confirmación; «Cancelar» no crea nada; «Confirmar» (con DOBLE TOQUE) deja UN ticket
 * `CORTESIA` sin cobro ni movimiento de caja y el resultado dice «Ticket N.º» sin «Cobrado»; con una línea a $ 0 dentro de un total mayor «Confirmar» pasa al cobro normal. La sesión de caja se
 * siembra en la base (abrirla es otra pantalla). Los módulos en desarrollo se leen «disponibles» SOLO en el proceso de la app.
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";

describe.skipIf(base === null)("recorrido de la venta a $ 0", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;

  const ir = async (ruta: string) => {
    await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
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
  const cobrarBoton = () => pagina.getByRole("button", { name: "Cobrar", exact: true });
  const dialogo = () => pagina.getByRole("dialog");
  const agregar = async (nombre: RegExp) => {
    // Tras cerrar la hoja de un producto un toque sobre otro se ignora 500 ms.
    await pagina.waitForTimeout(700);
    await pagina.getByRole("button", { name: nombre }).click();
    await pagina.getByRole("button", { name: "Agregar" }).click();
  };

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "caja", "ventas"],
      activarModulosEnDesarrollo: true,
    });
    const c = mundo.mundo.dueno;
    for (const [nombre, precio] of [
      ["Cortesía de la casa", "0.00"],
      ["Medialuna", "800.00"],
    ] as const) {
      const producto = await productoDeBase(c, mundo.empresa, { nombre });
      await precioDeBase(c, { empresa: mundo.empresa, producto, precio, desde: DESDE });
    }
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
        [mundo.empresa, caja, persona, `recorrido-${"b".repeat(20)}`, "0".repeat(64)],
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
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("total $ 0: «Cobrar» abre el diálogo y «Cancelar» sigue en la cuenta sin crear ningún ticket", async () => {
    await ir("/ventas/venta-rapida");
    await agregar(/^Cortesía de la casa/);
    await expect.poll(() => pagina.locator("[data-total]").innerText()).toBe("$ 0,00");
    await cobrarBoton().click();
    await dialogo().getByText("Cortesía de la casa").waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await dialogo().getByRole("button", { name: "Cancelar", exact: true }).click();
    await dialogo().waitFor({ state: "detached" });
    expect(await contar("ticket")).toBe(0);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("«Confirmar» con DOBLE TOQUE deja UN ticket de cortesía, sin cobro ni movimiento de caja, y el resultado no dice «Cobrado»", async () => {
    await cobrarBoton().click();
    await dialogo().getByRole("button", { name: "Confirmar", exact: true }).dblclick();
    await pagina.getByText("Ticket N.º 1").waitFor();
    expect(await pagina.getByText("Cobrado", { exact: true }).count()).toBe(0);
    expect(await pagina.getByRole("button", { name: "Imprimir ticket" }).count()).toBe(0);
    await pagina.getByRole("button", { name: "Anular", exact: true }).waitFor();
    expect(await contar("ticket")).toBe(1);
    expect(await contar("cobro")).toBe(0);
    expect(await contar("movimiento_caja")).toBe(0);
    const estados = await consulta<{ estado: string }>(
      "select estado from ticket where empresa_id = $1",
      [mundo.empresa],
    );
    expect(estados.map((e) => e.estado)).toEqual(["CORTESIA"]);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("producto con precio + producto a $ 0: «Confirmar» pasa al cobro normal y cobra", async () => {
    await pagina.getByRole("button", { name: "Nueva venta", exact: true }).click();
    await agregar(/^Medialuna/);
    await agregar(/^Cortesía de la casa/);
    await expect.poll(() => pagina.locator("[data-total]").innerText()).toBe("$ 800,00");
    await cobrarBoton().click();
    await dialogo().getByRole("button", { name: "Confirmar", exact: true }).click();
    await pagina.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
    await pagina.waitForTimeout(700);
    await cobrarBoton().click();
    await pagina.getByText("Cobrado", { exact: true }).first().waitFor();
    expect(await contar("ticket")).toBe(2);
    expect(await contar("cobro")).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });
});
