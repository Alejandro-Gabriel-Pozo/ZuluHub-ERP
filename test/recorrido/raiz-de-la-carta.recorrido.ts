import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { cartaDeBase } from "../integracion/carta-publica-apoyo";
import { crearDominio, crearDominioDeEmpresa } from "../integracion/marcas-apoyo";
import { levantarFachadaHttps, type FachadaHttps } from "./apoyo/fachada-https";
import { armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";

/**
 * LA RAÍZ DE LA CARTA (P3 del dominio propio), de punta a punta en la app REAL construida: `/` en el host de carta DEDICADO a una empresa redirige (307) a la única carta en línea, lista
 * las que hay si son varias y da la 404 neutra si no hay ninguna; en el host de carta COMPARTIDO de la marca (dueño: la marca) da siempre la 404 neutra. El alcance lo pone la puerta del host.
 */
const base = inject("baseDePruebas");
const HOST_DE_LA_EMPRESA = "carta.cliente.localhost";
const HOST_COMPARTIDO = "carta.zulupan.localhost";

describe.skipIf(base === null)("recorrido de la raíz de la carta", () => {
  let mundo: MundoDelRecorrido;
  let fachadaDeLaEmpresa: FachadaHttps;
  let fachadaCompartida: FachadaHttps;
  let navegador: Browser;
  let contexto: BrowserContext;
  let uno: { id: string; codigo: string };
  let dos: { id: string; codigo: string };

  // Node no resuelve `*.localhost`: se llega por 127.0.0.1 con el `Host` del host de carta, que es lo que mira la puerta. Sin seguir redirecciones: se mira el 307.
  const pedirRaiz = (host: string, puerto: number) =>
    contexto.request.get(`https://127.0.0.1:${puerto}/`, {
      headers: { host: `${host}:${puerto}` },
      maxRedirects: 0,
    });
  const raizDeLaEmpresa = () => pedirRaiz(HOST_DE_LA_EMPRESA, fachadaDeLaEmpresa.puerto);
  const estadoDeLaCarta = (id: string, estado: string) =>
    mundo.mundo.dueno.query("update carta_publica set estado = $2 where id = $1", [id, estado]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      perillas: { vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true } },
      activarModulosEnDesarrollo: true,
    });
    const dueno = mundo.mundo.dueno;
    await crearDominioDeEmpresa(dueno, mundo.empresa, {
      host: HOST_DE_LA_EMPRESA,
      superficie: "CARTA",
    });
    await crearDominio(dueno, mundo.mundo.marcaA, {
      host: HOST_COMPARTIDO,
      superficie: "CARTA",
      canonico: true,
    });
    fachadaDeLaEmpresa = await levantarFachadaHttps(HOST_DE_LA_EMPRESA, mundo.app.puerto);
    fachadaCompartida = await levantarFachadaHttps(HOST_COMPARTIDO, mundo.app.puerto);
    const { rows } = await dueno.query<{ id: string }>(
      "select id from sucursal where empresa_id = $1 order by id limit 1",
      [mundo.empresa],
    );
    const segunda = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Varvarco') returning id",
      [mundo.empresa],
    );
    uno = await cartaDeBase(dueno, mundo.empresa, rows[0]?.id as string, {
      nombre: "Restaurante Uno",
    });
    dos = await cartaDeBase(dueno, mundo.empresa, segunda.rows[0]?.id as string, {
      nombre: "Pileta Dos",
    });
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
  });
  afterAll(async () => {
    await navegador?.close();
    await fachadaCompartida?.cerrar();
    await fachadaDeLaEmpresa?.cerrar();
    await mundo?.cerrar();
  });

  it("con VARIAS cartas en línea: la lista, con un enlace a /<código> por carta, sin indexar y sin guardar", async () => {
    const r = await raizDeLaEmpresa();
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toBe("private, no-store");
    const html = await r.text();
    expect(html).toContain("Restaurante Uno");
    expect(html).toContain("Pileta Dos");
    expect(html).toContain(`href="/${uno.codigo}"`);
    expect(html).toContain(`href="/${dos.codigo}"`);
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });

  it("con UNA sola en línea: redirección 307 temporal a /<código>", async () => {
    await estadoDeLaCarta(dos.id, "FUERA_DE_LINEA");
    try {
      const r = await raizDeLaEmpresa();
      expect(r.status()).toBe(307);
      expect(r.headers()["location"]).toBe(`/${uno.codigo}`);
    } finally {
      await estadoDeLaCarta(dos.id, "EN_LINEA");
    }
  });

  it("sin ninguna en línea: la 404 neutra, igual que un código inventado", async () => {
    await estadoDeLaCarta(uno.id, "FUERA_DE_LINEA");
    await estadoDeLaCarta(dos.id, "FUERA_DE_LINEA");
    try {
      expect((await raizDeLaEmpresa()).status()).toBe(404);
    } finally {
      await estadoDeLaCarta(uno.id, "EN_LINEA");
      await estadoDeLaCarta(dos.id, "EN_LINEA");
    }
  });

  it("el host compartido de la marca NO lista cartas ajenas: la 404 neutra aunque haya cartas en línea", async () => {
    const r = await pedirRaiz(HOST_COMPARTIDO, fachadaCompartida.puerto);
    expect(r.status()).toBe(404);
    const html = await r.text();
    expect(html).not.toContain("Restaurante Uno");
    expect(html).not.toContain(uno.codigo);
  });

  it("el navegador sigue el 307 y llega a la carta (200)", async () => {
    await estadoDeLaCarta(dos.id, "FUERA_DE_LINEA");
    try {
      const pagina = await contexto.newPage();
      const r = await pagina.goto(`https://${HOST_DE_LA_EMPRESA}:${fachadaDeLaEmpresa.puerto}/`);
      expect(r?.status()).toBe(200);
      expect(new URL(pagina.url()).pathname).toBe(`/${uno.codigo}`);
      await pagina.close();
    } finally {
      await estadoDeLaCarta(dos.id, "EN_LINEA");
    }
  });
});
