import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * S-2: la pantalla «Impresoras» con la app REAL construida, un navegador real y una base real, como la usa un gerente: ve el menú «Impresoras», agrega una impresora (con doble clic en «Guardar»: queda UNA), la misma
 * alta desde dos pestañas deja una sola (la otra dice el mensaje genérico), la edita desde su nombre, «Imprimir prueba» abre el diálogo de impresión con la hoja de la impresora y la regla de página de SU ancho (con la CSP
 * real: sin estilos en línea, `window.print` es un espía) y UNA sola vez aunque se toque dos veces, y «Quitar» la saca de la lista pero queda en la base, desactivada y auditada. Que el operador ve la lista y no administra lo
 * prueban `PantallaDeListaDeImpresoras.test.tsx` (Chromium) y `impresoras-web.test.ts` (base y roles reales).
 * MIENTRAS `comandas` ESTÉ `en_desarrollo` EN EL CATÁLOGO REAL, LA APP LO RECHAZA: este recorrido se saltea (el módulo pasó a «disponible» en S-0r).
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const comandasAbierto = (CATALOGO_DE_MODULOS.comandas.estado as string) === "disponible";

/** Reemplaza `window.print` por un espía que anota la regla de página y el texto de la hoja del momento y bloquea la página un rato, como un diálogo abierto. */
const ESPIA_DE_IMPRESION = `
  window.__impresiones = [];
  window.print = () => {
    const reglas = [...document.adoptedStyleSheets].flatMap((h) => [...h.cssRules].map((r) => r.cssText)).join("\\n");
    window.__impresiones.push({ reglas, hoja: document.querySelector("[data-papel]")?.textContent ?? "" });
    const hasta = Date.now() + 400;
    while (Date.now() < hasta) { /* el diálogo está abierto y bloquea la página */ }
  };`;

describe.skipIf(base === null || !comandasAbierto)("recorrido de impresoras", () => {
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
  /** Vuelve a pedir la pantalla de destino: tras guardar con redirect, en este entorno se ve «No encontrado» hasta recargar (pasa igual en «Secciones», ya en main; el guardado es correcto: se mira en la base). */
  const recargar = async (p: Page) => {
    await p.reload();
    await p.waitForLoadState("networkidle");
  };
  const dueno = () => mundo.mundo.dueno;
  const cuantas = async (nombre: string, soloActivas = false) =>
    Number(
      (
        await dueno().query<{ n: string }>(
          `select count(*) as n from impresora where empresa_id = $1 and nombre = $2${soloActivas ? " and activa" : ""}`,
          [mundo.empresa, nombre],
        )
      ).rows[0]?.n,
    );
  const llenar = async (p: Page, nombre: string, uso: string, papel: string) => {
    await p.getByLabel("Nombre", { exact: true }).fill(nombre);
    await p.getByLabel("Para qué sirve").selectOption(uso);
    await p.getByLabel("Papel").selectOption(papel);
  };

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, ["facturacion", "comandas"]);
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    await pagina.addInitScript(ESPIA_DE_IMPRESION);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("la lista arranca vacía, con «Agregar impresora», y «Impresoras» está en el menú", async () => {
    const respuesta = await ir(pagina, "/salon/impresoras");
    expect(respuesta?.status()).toBe(200);
    await pagina.getByRole("heading", { name: "Impresoras", level: 1 }).waitFor();
    await pagina.getByRole("link", { name: "Agregar impresora" }).waitFor();
    expect(await pagina.getByRole("button", { name: "Quitar" }).count()).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("agregar una impresora con DOBLE CLIC en «Guardar»: vuelve a la lista y queda UNA", async () => {
    await pagina.getByRole("link", { name: "Agregar impresora" }).click();
    await pagina.getByRole("heading", { name: "Agregar impresora" }).waitFor();
    await llenar(pagina, "Cocina", "COMANDA", "80");
    await pagina.getByRole("button", { name: "Guardar" }).dblclick();
    await pagina.waitForURL(`${mundo.url}/salon/impresoras`);
    await recargar(pagina);
    await pagina.getByRole("link", { name: "Cocina" }).waitFor();
    await pagina.getByText("Comanda de cocina").waitFor();
    await pagina.getByText("80 mm").first().waitFor();
    expect(await cuantas("Cocina")).toBe(1);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("la MISMA alta desde DOS PESTAÑAS deja una sola impresora y la otra dice el mensaje genérico", async () => {
    const otra = await contexto.newPage();
    await ir(pagina, "/salon/impresoras/nueva");
    await ir(otra, "/salon/impresoras/nueva");
    await llenar(pagina, "Caja", "TICKET", "58");
    await llenar(otra, "Caja", "TICKET", "58");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL(`${mundo.url}/salon/impresoras`);
    await otra.getByRole("button", { name: "Guardar" }).click();
    await otra.getByText("Esta acción no está permitida").waitFor();
    expect(otra.url()).toBe(`${mundo.url}/salon/impresoras/nueva`);
    expect(await cuantas("Caja")).toBe(1);
    await otra.close();
    expect(vigilante.tomar().filter((h) => !h.includes("403"))).toEqual([]);
  });

  it("«Imprimir prueba» abre el diálogo UNA vez con la hoja de la impresora y la regla de página de SU ancho, con la CSP real", async () => {
    await ir(pagina, "/salon/impresoras");
    const fila = pagina.locator("li", { hasText: "Caja" });
    await fila.getByRole("button", { name: "Imprimir prueba" }).dblclick();
    await pagina.waitForFunction(
      `window.__impresiones.length >= 1 && !document.querySelector("[data-papel]")`,
    );
    const impresiones =
      await pagina.evaluate<{ reglas: string; hoja: string }[]>("window.__impresiones");
    expect(impresiones).toHaveLength(1);
    expect(impresiones[0]?.hoja).toBe("Caja58 mm");
    expect(impresiones[0]?.reglas).toMatch(/size: 58mm \d+mm/);
    expect(await pagina.getByRole("button", { name: "Imprimir prueba" }).count()).toBe(2);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("editar desde el nombre: abre con sus datos y guardar cambia el nombre en la lista", async () => {
    await ir(pagina, "/salon/impresoras");
    await pagina.getByRole("link", { name: "Caja", exact: true }).click();
    await pagina.getByRole("heading", { name: "Impresoras", level: 1 }).waitFor();
    expect(await pagina.getByLabel("Nombre", { exact: true }).inputValue()).toBe("Caja");
    expect(await pagina.getByLabel("Para qué sirve").inputValue()).toBe("TICKET");
    expect(await pagina.getByLabel("Papel").inputValue()).toBe("58");
    await pagina.getByLabel("Nombre", { exact: true }).fill("Caja principal");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL(`${mundo.url}/salon/impresoras`);
    await recargar(pagina);
    await pagina.getByRole("link", { name: "Caja principal" }).waitFor();
    expect(await cuantas("Caja")).toBe(0);
    expect(await cuantas("Caja principal")).toBe(1);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("«Quitar» la saca de la lista pero queda en la base, desactivada y auditada una vez; abrir su edición es el genérico", async () => {
    await ir(pagina, "/salon/impresoras");
    const fila = pagina.locator("li", { hasText: "Cocina" });
    await fila.getByRole("button", { name: "Quitar" }).click();
    await pagina.getByRole("link", { name: "Cocina", exact: true }).waitFor({ state: "detached" });
    expect(await cuantas("Cocina")).toBe(1);
    expect(await cuantas("Cocina", true)).toBe(0);
    const { rows } = await dueno().query<{ n: string }>(
      `select count(*) as n from auditoria_empresa a join impresora i on i.id = a.entidad_id::uuid
        where a.empresa_id = $1 and a.accion = 'IMPRESORA_DESACTIVADA' and i.nombre = 'Cocina'`,
      [mundo.empresa],
    );
    expect(Number(rows[0]?.n)).toBe(1);
    const id = (
      await dueno().query<{ id: string }>(
        "select id from impresora where empresa_id = $1 and nombre = 'Cocina'",
        [mundo.empresa],
      )
    ).rows[0]?.id;
    await ir(pagina, `/salon/impresoras/${String(id)}`);
    await pagina.getByText("Esta acción no está permitida").waitFor();
    expect(await pagina.getByRole("button", { name: "Guardar" }).count()).toBe(0);
    vigilante.tomar();
  });
});
