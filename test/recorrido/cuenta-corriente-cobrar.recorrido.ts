import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  rutaDeCobrarACuenta,
  rutaDeLaFichaDeCuenta,
} from "../../apps/web/ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { sembrarTicketsACuenta, type TicketsACuentaSembrados } from "./apoyo/tickets-a-cuenta";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «COBRAR UN TICKET A CUENTA» de punta a punta en la app REAL con un navegador real (CC-5 B2b): desde la ficha del cliente, «Cobrar un ticket» abre la hoja del cargo MÁS ANTIGUO; con DOBLE CLIC en
 * «Cobrar» queda UN solo cobro y UNA sola cobranza en el libro; la misma pantalla pasa a «Cobrado» con el saldo del cliente y «Cobrar otro ticket» abre el siguiente; sin nada para cobrar la dirección
 * vuelve a la ficha. Lo que no ven las pruebas de componentes ni las de servidor: la página y la acción de servidor reales, la sesión de caja, el cobro atómico con el libro y que ningún componente
 * rompa en el navegador (un `Boton` sin `"use client"`, React #441). La caja y los tickets se siembran por el camino real (`tickets-a-cuenta.ts`).
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de cuenta corriente: cobrar un ticket a cuenta", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let sembrado: TicketsACuentaSembrados;

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const consulta = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await mundo.mundo.dueno.query<T>(texto, p)).rows;
  const contar = async (texto: string, p: unknown[]) =>
    Number((await consulta<{ n: string }>(texto, p))[0]?.n);
  const estadoDe = async (ticketId: string) =>
    (await consulta<{ estado: string }>("select estado from ticket where id = $1", [ticketId]))[0]
      ?.estado;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulos: [
        "facturacion",
        "catalogo",
        "caja",
        "cierre",
        "ventas",
        "clientes",
        "cuenta_corriente",
      ],
      activarModulosEnDesarrollo: true,
    });
    sembrado = await sembrarTicketsACuenta(mundo, { precio: "1000.00", cantidad: 2 });
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

  it("de la ficha al cobro: el cargo más antiguo, doble clic = un solo cobro, «Cobrado» con el saldo y «Cobrar otro ticket»", async () => {
    const [primero, segundo] = sembrado.tickets as [
      { ticketId: string; numero: string },
      { ticketId: string; numero: string },
    ];
    await ir(rutaDeLaFichaDeCuenta(sembrado.clienteId));
    await pagina.getByRole("link", { name: "Cobrar un ticket", exact: true }).click();
    await pagina.waitForURL(`**${rutaDeCobrarACuenta(sembrado.clienteId)}`);
    await pagina.waitForLoadState("networkidle");
    // La hoja del cargo MÁS ANTIGUO, con su total.
    await pagina.getByText(sembrado.clienteNombre).first().waitFor();
    await pagina.getByText(new RegExp(`^${primero.numero} · Mostrador · `)).waitFor();
    await pagina.getByText("$ 1.000,00", { exact: true }).first().waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

    // Doble clic: un solo cobro.
    await pagina.getByRole("button", { name: "Cobrar $ 1.000,00", exact: true }).dblclick();
    await pagina.getByText("Cobrado", { exact: true }).waitFor();
    await pagina
      .getByText(`El ticket ${primero.numero} quedó cobrado el`, { exact: false })
      .waitFor();
    await pagina.getByText(/El saldo de .* bajó a \$ 1\.000,00\./).waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(await estadoDe(primero.ticketId)).toBe("COBRADO");
    expect(
      await contar("select count(*)::text as n from cobranza_de_ticket where ticket_id = $1", [
        primero.ticketId,
      ]),
    ).toBe(1);
    expect(
      await contar(
        `select count(*)::text as n from cobro c join cobranza_de_ticket k on k.id = c.origen_id and k.empresa_id = c.empresa_id where k.ticket_id = $1`,
        [primero.ticketId],
      ),
    ).toBe(1);
    // El otro ticket sigue sin cobrar.
    expect(await estadoDe(segundo.ticketId)).toBe("EMITIDO");

    // «Cobrar otro ticket»: el siguiente cargo pendiente.
    await pagina.getByRole("link", { name: "Cobrar otro ticket", exact: true }).click();
    await pagina.waitForLoadState("networkidle");
    await pagina.getByText(new RegExp(`^${segundo.numero} · Mostrador · `)).waitFor();
    await pagina.getByRole("button", { name: "Cobrar $ 1.000,00", exact: true }).click();
    await pagina.getByText("Cobrado", { exact: true }).waitFor();
    await pagina.getByText(/El saldo de .* bajó a \$ 0,00\./).waitFor();
    expect(await estadoDe(segundo.ticketId)).toBe("COBRADO");

    // «Ver la cuenta del cliente»: la ficha. Y sin nada para cobrar, la dirección de cobrar vuelve a la ficha.
    await pagina.getByRole("link", { name: "Ver la cuenta del cliente", exact: true }).click();
    await pagina.waitForURL(`**${rutaDeLaFichaDeCuenta(sembrado.clienteId)}`);
    await ir(rutaDeCobrarACuenta(sembrado.clienteId));
    expect(new URL(pagina.url()).pathname).toBe(rutaDeLaFichaDeCuenta(sembrado.clienteId));
    expect(
      await contar("select count(*)::text as n from cobranza_de_ticket where empresa_id = $1", [
        mundo.empresa,
      ]),
    ).toBe(2);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("un ticket que no es un cargo pendiente del cliente: la dirección vuelve a la ficha y no cobra nada", async () => {
    const ajeno = `00000000-0000-4000-8000-${"0".repeat(12)}`;
    await ir(`${rutaDeCobrarACuenta(sembrado.clienteId)}?ticket=${ajeno}`);
    expect(new URL(pagina.url()).pathname).toBe(rutaDeLaFichaDeCuenta(sembrado.clienteId));
    expect(
      await contar("select count(*)::text as n from cobranza_de_ticket where empresa_id = $1", [
        mundo.empresa,
      ]),
    ).toBe(2);
    expect(vigilante.tomar()).toEqual([]);
  });
});
