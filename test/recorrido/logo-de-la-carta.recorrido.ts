import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearDominio } from "../integracion/marcas-apoyo";
import { cartaDeBase } from "../integracion/carta-publica-apoyo";
import { levantarFachadaHttps, type FachadaHttps } from "./apoyo/fachada-https";
import { armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import {
  levantarProveedorDeImagenesSimulado,
  webpDelProveedor,
  type ProveedorDeImagenesSimulado,
} from "./apoyo/proveedor-de-imagenes-simulado";
import { vigilar, type Vigilante } from "./apoyo/vigilante";

/**
 * EL LOGO DE LA CARTA (V1c), de punta a punta en la app REAL construida y con un navegador real: la carta pública (host de CARTA de la marca) dibuja el logo sobre la placa con una
 * dirección PROPIA, el servidor lo trae del proveedor (simulado en 127.0.0.1, con la guarda de red y el traedor REALES) y lo entrega validado, con sus cabeceras; la CSP no se viola
 * (`img-src 'self' data:`); lo que no se sirve (versión vieja, carta fuera de línea, código inventado) da el mismo 404; y 20 visitas a la vez hacen UN solo viaje al proveedor.
 * Lo único de pruebas: `conectar-proveedor-de-imagenes-simulado.mjs` (cargado solo en el proceso de la app del recorrido; una regla de arquitectura impide que producción lo nombre).
 */
const base = inject("baseDePruebas");
const HOST_DE_LA_CARTA = "carta.zulupan.localhost";
const RUTA_DEL_PROVEEDOR = (version: string) =>
  `/demo/image/upload/c_limit,w_240,h_240,f_webp,q_80/v${version}/logos/parador.png`;

describe.skipIf(base === null)("recorrido del logo de la carta pública", () => {
  let proveedor: ProveedorDeImagenesSimulado;
  let mundo: MundoDelRecorrido;
  let fachadaDeLaCarta: FachadaHttps;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let carta: { id: string; codigo: string };

  const url = (ruta: string) => `https://${HOST_DE_LA_CARTA}:${fachadaDeLaCarta.puerto}${ruta}`;
  const pedirLogo = (version: string, codigo = carta.codigo) =>
    contexto.request.get(url(`/${codigo}/logo/${version}.webp`));
  const cambiarLogo = (version: string) =>
    mundo.mundo.dueno.query("update carta_publica set logo_version = $2 where id = $1", [
      carta.id,
      version,
    ]);

  beforeAll(async () => {
    if (base === null) return;
    proveedor = await levantarProveedorDeImagenesSimulado();
    proveedor.servir(RUTA_DEL_PROVEEDOR("1700000000"), webpDelProveedor);
    proveedor.servir(RUTA_DEL_PROVEEDOR("1800000000"), webpDelProveedor);
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      perillas: { vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true } },
      activarModulosEnDesarrollo: true,
      proveedorDeImagenes: proveedor.puerto,
    });
    const dueno = mundo.mundo.dueno;
    await crearDominio(dueno, mundo.mundo.marcaA, {
      host: HOST_DE_LA_CARTA,
      superficie: "CARTA",
      canonico: true,
    });
    fachadaDeLaCarta = await levantarFachadaHttps(HOST_DE_LA_CARTA, mundo.app.puerto);
    const { rows } = await dueno.query<{ id: string }>(
      "select id from sucursal where empresa_id = $1 limit 1",
      [mundo.empresa],
    );
    carta = await cartaDeBase(dueno, mundo.empresa, rows[0]?.id as string, {
      nombre: "Parador El Ensayo",
    });
    await dueno.query(
      `update carta_publica set cara = 'DIA', logo_proveedor = 'CLOUDINARY', logo_cuenta = 'demo', logo_id_publico = 'logos/parador',
         logo_version = '1700000000', logo_extension = 'png' where id = $1`,
      [carta.id],
    );
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DE_LA_CARTA);
  });
  afterAll(async () => {
    await navegador?.close();
    await fachadaDeLaCarta?.cerrar();
    await mundo?.cerrar();
    await proveedor?.cerrar();
  });

  it("la carta pública dibuja el logo sobre la placa, con una dirección propia, sin violar la CSP ni salir a otro host", async () => {
    const r = await pagina.goto(url(`/${carta.codigo}`));
    expect(r?.status()).toBe(200);
    const logo = pagina.locator("[data-placa] img[data-logo]");
    await logo.waitFor();
    expect(await logo.getAttribute("src")).toBe(`/${carta.codigo}/logo/1700000000.webp`);
    expect(await logo.getAttribute("alt")).toBe("");
    await pagina.waitForLoadState("networkidle");
    // El navegador lo decodificó: es una imagen de verdad, 120 por 120.
    expect(await logo.evaluate("(i) => [i.naturalWidth, i.naturalHeight]")).toEqual([120, 120]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("el logo servido: image/webp validado, sin que el navegador adivine, guardable un día; y al proveedor solo salió el pedido fijo", async () => {
    const r = await pedirLogo("1700000000");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/webp");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
    expect(r.headers()["cache-control"]).toBe("public, max-age=86400");
    const cuerpo = await r.body();
    expect(cuerpo.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(cuerpo.subarray(8, 12).toString("latin1")).toBe("WEBP");
    // Un solo viaje al proveedor, con el destino de la plantilla y sin nada de la persona (ni cookies ni credenciales).
    expect(proveedor.pedidos).toHaveLength(1);
    const [pedido] = proveedor.pedidos;
    expect(pedido?.ruta).toBe(RUTA_DEL_PROVEEDOR("1700000000"));
    expect(pedido?.hostDelProveedor).toBe("res.cloudinary.com");
    expect(Object.keys(pedido?.cabeceras ?? {}).sort()).toEqual([
      "accept",
      "accept-encoding",
      "connection",
      "host",
      "user-agent",
      "x-recorrido-host",
    ]);
    expect(pedido?.cabeceras["accept-encoding"]).toBe("identity");
  });

  it("lo que no se sirve es el MISMO 404 sin guardar, y no sale ni un pedido más: versión vieja o inventada, código inventado, carta fuera de línea", async () => {
    const antes = proveedor.pedidos.length;
    const respuestas = [
      await pedirLogo("1699999999"),
      await pedirLogo("1700000000x"),
      await pedirLogo("1700000000", "no-existe-0123456789ab"),
    ];
    await mundo.mundo.dueno.query(
      "update carta_publica set estado = 'FUERA_DE_LINEA' where id = $1",
      [carta.id],
    );
    respuestas.push(await pedirLogo("1700000000"));
    for (const r of respuestas) {
      expect(r.status()).toBe(404);
      expect(r.headers()["cache-control"]).toBe("no-store");
      expect((await r.body()).length).toBe(0);
    }
    expect(proveedor.pedidos).toHaveLength(antes);
    await mundo.mundo.dueno.query("update carta_publica set estado = 'EN_LINEA' where id = $1", [
      carta.id,
    ]);
  });

  it("20 visitas a la vez al logo nuevo: UN solo viaje al proveedor y la misma imagen para todas", async () => {
    await cambiarLogo("1800000000");
    const antes = proveedor.pedidos.length;
    const respuestas = await Promise.all(Array.from({ length: 20 }, () => pedirLogo("1800000000")));
    expect(respuestas.map((r) => r.status())).toEqual(new Array<number>(20).fill(200));
    const cuerpos = await Promise.all(
      respuestas.map(async (r) => (await r.body()).toString("base64")),
    );
    expect(new Set(cuerpos).size).toBe(1);
    expect(proveedor.pedidos).toHaveLength(antes + 1);
    expect(proveedor.pedidos.at(-1)?.ruta).toBe(RUTA_DEL_PROVEEDOR("1800000000"));
    // Y la versión anterior ya no se sirve.
    expect((await pedirLogo("1700000000")).status()).toBe(404);
  });

  it("si el proveedor no tiene la imagen, la carta queda con la inicial (sin imagen rota) y el fallo se recuerda: no se vuelve a pedir", async () => {
    await cambiarLogo("1900000000");
    await pagina.goto(url(`/${carta.codigo}`));
    await pagina.waitForLoadState("networkidle");
    await pagina.locator("[data-placa]").waitFor();
    await pagina.waitForFunction('document.querySelector("[data-placa] img") === null');
    expect(await pagina.locator("[data-placa]").textContent()).toBe("P");
    const viajes = () =>
      proveedor.pedidos.filter((p) => p.ruta === RUTA_DEL_PROVEEDOR("1900000000")).length;
    expect(viajes()).toBe(1);
    expect((await pedirLogo("1900000000")).status()).toBe(404);
    expect((await pedirLogo("1900000000")).status()).toBe(404);
    expect(viajes()).toBe(1);
    vigilante.tomar();
  });
});
