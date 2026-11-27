import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { cartaDeBase } from "../integracion/carta-publica-apoyo";
import { crearDominio } from "../integracion/marcas-apoyo";
import { levantarFachadaHttps, type FachadaHttps } from "./apoyo/fachada-https";
import { armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";

/**
 * EL MODELO DE LA CARTA (L1 del Libro), de punta a punta en la app REAL construida: con la perilla `vidriera_modelo_libro` APAGADA (como todas las empresas de hoy), una carta que guardó el modelo Libro
 * se ve EXACTAMENTE como la Lista de siempre, con o sin `Save-Data: on`, y no cambia ningún encabezado ni el estado de la respuesta. Es la garantía de que declarar la perilla y leerla en cada visita no
 * mueve nada para nadie: solo las empresas con la perilla encendida ven el Libro (`carta-libro.recorrido.ts`). Se compara `<main>`: la cabecera del documento la arma Next y varía de un pedido a otro.
 */
const base = inject("baseDePruebas");
const HOST_COMPARTIDO = "carta.zulupan.localhost";

/** La carta en sí (`<main>`): el resto del documento es la cabecera y el flujo de Next, que no es de la carta y varía de un pedido a otro. */
const laCarta = (html: string): string =>
  html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);

/** Lo que cambia en cada pedido sin que sea de la carta: el nonce de la política de contenido. */
const sinNonce = (html: string): string => html.replace(/nonce="[^"]*"/g, 'nonce=""');

describe.skipIf(base === null)("recorrido del modelo de la carta", () => {
  let mundo: MundoDelRecorrido;
  let fachada: FachadaHttps;
  let navegador: Browser;
  let contexto: BrowserContext;
  let carta: { id: string; codigo: string };

  const pedir = (encabezados: Record<string, string> = {}) =>
    contexto.request.get(`https://127.0.0.1:${fachada.puerto}/${carta.codigo}`, {
      headers: { host: `${HOST_COMPARTIDO}:${fachada.puerto}`, ...encabezados },
      maxRedirects: 0,
    });
  const elegir = (modelo: string) =>
    mundo.mundo.dueno.query("update carta_publica set modelo = $2 where id = $1", [
      carta.id,
      modelo,
    ]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      perillas: { vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true } },
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
    const producto = await productoDeBase(dueno, mundo.empresa, {
      nombre: "Milanesa a la napolitana",
      clase: "VENDIBLE",
    });
    const seccion = (
      await dueno.query<{ id: string }>(
        "insert into seccion_de_carta (empresa_id, nombre, nombre_clave, orden, activa) values ($1, 'Platos', 'platos', 0, true) returning id",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    await dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
      producto,
      seccion,
    ]);
    await precioDeBase(dueno, {
      empresa: mundo.empresa,
      producto,
      precio: "9500",
      desde: "2026-10-01T00:00:00Z",
    });
    carta = await cartaDeBase(dueno, mundo.empresa, sucursal, { nombre: "Parador del Lago" });
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
  });
  afterAll(async () => {
    await navegador?.close();
    await fachada?.cerrar();
    await mundo?.cerrar();
  });

  it("con la perilla apagada, la carta que guardó Libro es EXACTAMENTE la Lista de hoy: mismo estado, mismos encabezados y mismo HTML, con y sin Save-Data", async () => {
    await elegir("LISTA");
    // El primer pedido de la app recién arrancada arma la cabecera de otra manera que los siguientes (Next): se descarta.
    await pedir();
    const lista = await pedir();
    expect(lista.status()).toBe(200);
    const htmlDeLista = laCarta(sinNonce(await lista.text()));
    expect(htmlDeLista).toContain("Milanesa a la napolitana");
    expect(htmlDeLista).toContain("Parador del Lago");

    await elegir("LIBRO");
    for (const encabezados of [{}, { "save-data": "on" }]) {
      const libro = await pedir(encabezados);
      expect(libro.status()).toBe(200);
      expect(libro.headers()["cache-control"]).toBe(lista.headers()["cache-control"]);
      expect(libro.headers()["content-type"]).toBe(lista.headers()["content-type"]);
      const htmlDeLibro = laCarta(sinNonce(await libro.text()));
      expect(htmlDeLibro).toBe(htmlDeLista);
    }
  });
});
