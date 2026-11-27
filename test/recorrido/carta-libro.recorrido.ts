import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { cartaDeBase } from "../integracion/carta-publica-apoyo";
import { crearDominio } from "../integracion/marcas-apoyo";
import { levantarFachadaHttps, type FachadaHttps } from "./apoyo/fachada-https";
import { armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";

/**
 * EL LIBRO DE LA CARTA (L1+L2a), de punta a punta en la app REAL construida y en Chromium: con la perilla `vidriera_modelo_libro`
 * ENCENDIDA y la carta guardada como Libro, el HTML del servidor sigue siendo la Lista (se lee sin JavaScript) y, ya hidratada, la
 * página se vuelve libro (portada, índice, una página por sección, contador único). Con movimiento reducido o con el script tardío
 * (más de 2,5 s) se queda en Lista, sin que nada se mueva, y «Ver como libro» la pasa a libro. Lo que no cambia (perilla apagada =
 * Lista de hoy) lo prueba `carta-modelo-de-la-carta.recorrido.ts`.
 */
const base = inject("baseDePruebas");
const HOST_COMPARTIDO = "carta.libro.localhost";

describe.skipIf(base === null)("recorrido del Libro de la carta", () => {
  let mundo: MundoDelRecorrido;
  let fachada: FachadaHttps;
  let navegador: Browser;
  let codigo: string;

  const direccion = () => `https://${HOST_COMPARTIDO}:${fachada.puerto}/${codigo}`;
  const contexto = (opciones: Parameters<Browser["newContext"]>[0] = {}) =>
    navegador.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 780 },
      ...opciones,
    });

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      perillas: {
        vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
        vidriera_modelo_libro: { tipo: "INTERRUPTOR", encendida: true },
      },
      activarModulosEnDesarrollo: true,
    });
    const dueno = mundo.mundo.dueno;
    await crearDominio(dueno, mundo.mundo.marcaA, {
      host: HOST_COMPARTIDO,
      superficie: "CARTA",
      canonico: true,
    });
    fachada = await levantarFachadaHttps(HOST_COMPARTIDO, mundo.app.puerto);
    const sucursal = (
      await dueno.query<{ id: string }>(
        "select id from sucursal where empresa_id = $1 order by id limit 1",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    let orden = 0;
    for (const [seccion, plato] of [
      ["Entradas", "Provoleta"],
      ["Platos", "Milanesa a la napolitana"],
      ["Postres", "Flan casero"],
    ] as const) {
      const producto = await productoDeBase(dueno, mundo.empresa, {
        nombre: plato,
        clase: "VENDIBLE",
      });
      const idDeSeccion = (
        await dueno.query<{ id: string }>(
          "insert into seccion_de_carta (empresa_id, nombre, nombre_clave, orden, activa) values ($1, $2, lower($2), $3, true) returning id",
          [mundo.empresa, seccion, orden],
        )
      ).rows[0]?.id as string;
      orden += 1;
      await dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
        producto,
        idDeSeccion,
      ]);
      await precioDeBase(dueno, {
        empresa: mundo.empresa,
        producto,
        precio: "9500",
        desde: "2026-10-01T00:00:00Z",
      });
    }
    const carta = await cartaDeBase(dueno, mundo.empresa, sucursal, { nombre: "Parador del Lago" });
    codigo = carta.codigo;
    await dueno.query("update carta_publica set modelo = 'LIBRO' where id = $1", [carta.id]);
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
  });
  afterAll(async () => {
    await navegador?.close();
    await fachada?.cerrar();
    await mundo?.cerrar();
  });

  it("el HTML del servidor es la Lista (se lee sin JavaScript) aunque la carta sea Libro", async () => {
    const ctx = await contexto({ javaScriptEnabled: false });
    const pagina = await ctx.newPage();
    await pagina.goto(direccion());
    expect(await pagina.getByText("Milanesa a la napolitana").first().isVisible()).toBe(true);
    expect(await pagina.getByRole("navigation").count()).toBeGreaterThan(0);
    expect(await pagina.getByRole("button", { name: "Siguiente" }).count()).toBe(0);
    await ctx.close();
  });

  it("hidratada, la carta se vuelve libro: portada, índice y secciones con contador único, teclado y #slug", async () => {
    const ctx = await contexto();
    const pagina = await ctx.newPage();
    await pagina.goto(direccion());
    await pagina.getByText("Desliza para ver el menú").waitFor();
    const contador = pagina.getByRole("status");
    expect(await contador.textContent()).toBe("");
    await pagina.getByRole("button", { name: "Siguiente" }).click();
    await pagina.getByRole("heading", { name: "Índice" }).waitFor();
    await pagina.getByRole("link", { name: /^Platos/ }).click();
    await pagina.getByRole("status").filter({ hasText: "Sección 2 de 3" }).waitFor();
    await pagina.locator("#platos:focus").waitFor();
    await pagina.keyboard.press("ArrowRight");
    await pagina.getByRole("status").filter({ hasText: "Sección 3 de 3" }).waitFor();
    expect(await pagina.getByRole("button", { name: "Siguiente" }).isDisabled()).toBe(true);
    await pagina.keyboard.press("ArrowLeft");
    await pagina.getByRole("status").filter({ hasText: "Sección 2 de 3" }).waitFor();
    // La sección de otra página no se puede tocar ni enfocar (la página fuera de foco es inerte).
    const paginas = pagina.locator('[data-pagina="seccion"]');
    expect(await paginas.nth(1).getAttribute("inert")).toBeNull();
    expect(await paginas.nth(2).getAttribute("inert")).not.toBeNull();
    // Un enlace directo con `#postres` abre esa sección y deja el foco en su título.
    await pagina.goto(`${direccion()}#postres`);
    await pagina.reload();
    await pagina.getByRole("status").filter({ hasText: "Sección 3 de 3" }).waitFor();
    // «Ver como lista» vuelve a la Lista y «Ver como libro» al libro; nada queda guardado.
    await pagina.getByRole("button", { name: "Siguiente" }).waitFor({ state: "visible" });
    for (let i = 0; i < 4; i += 1) await pagina.keyboard.press("ArrowLeft");
    await pagina.getByRole("button", { name: "Ver como lista" }).click();
    await pagina.getByRole("button", { name: "Ver como libro" }).waitFor();
    expect(await pagina.getByRole("button", { name: "Anterior" }).count()).toBe(0);
    await pagina.getByRole("button", { name: "Ver como libro" }).click();
    await pagina.getByText("Desliza para ver el menú").waitFor();
    expect(await pagina.evaluate("window.localStorage.length + document.cookie.length")).toBe(0);
    await ctx.close();
  });

  it("con movimiento reducido se queda en Lista y ofrece «Ver como libro»", async () => {
    const ctx = await contexto({ reducedMotion: "reduce" });
    const pagina = await ctx.newPage();
    await pagina.goto(direccion());
    await pagina.getByRole("button", { name: "Ver como libro" }).waitFor();
    expect(await pagina.getByRole("button", { name: "Anterior" }).count()).toBe(0);
    expect(await pagina.getByText("Milanesa a la napolitana").first().isVisible()).toBe(true);
    await ctx.close();
  });

  it("con el script tardío (más de 2,5 s) no cambia el diseño: queda la Lista y nada se mueve", async () => {
    const ctx = await contexto();
    await ctx.addInitScript(`
      window.__cls = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    `);
    await ctx.route(/\/_next\/static\/.*\.js/, async (ruta) => {
      await new Promise((r) => setTimeout(r, 3000));
      await ruta.continue();
    });
    const pagina = await ctx.newPage();
    await pagina.goto(direccion(), { waitUntil: "commit" });
    await pagina.getByText("Milanesa a la napolitana").first().waitFor();
    await pagina.getByRole("button", { name: "Ver como libro" }).waitFor({ timeout: 20_000 });
    expect(await pagina.getByRole("button", { name: "Anterior" }).count()).toBe(0);
    expect(await pagina.evaluate("window.__cls")).toBe(0);
    await ctx.close();
  });
});
