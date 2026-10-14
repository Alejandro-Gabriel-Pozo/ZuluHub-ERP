import type { ReactElement } from "react";
import type * as Falso from "../../apps/web/servidor/carta-publica-falsa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_APP_A,
  HOST_LANDING_A,
  HOST_CARTA_A,
  MARCA_A,
  MARCA_B,
} from "../utilidades/puertas-falsas";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * S2 (revisión del PR #48): la carta se busca por código DENTRO DE LA MARCA del dominio. La misma carta pedida
 * desde el dominio de otra marca, aunque el código coincida, no se obtiene; y un host que no es de carta
 * (aplicación, landing, desconocido, retirado) ni llega a buscar. Las páginas se llaman con el falso de la puerta
 * pública y el falso de la carta asociado a las marcas A y B.
 */
vi.mock("server-only", () => ({}));
const pedidoActual = vi.hoisted(() => ({ encabezados: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(pedidoActual.encabezados) }));
vi.mock("../../apps/web/servidor/fuente-de-puertas", async () => {
  const { crearPuertaFalsa } = await import("../utilidades/puertas-falsas");
  const puerta = crearPuertaFalsa();
  return { fuenteDePuertas: { consultarHost: puerta.consultarHost, leerMarca: puerta.leerMarca } };
});
vi.mock("../../apps/web/servidor/carta-publica-falsa", async (original) => {
  const real = await original<typeof Falso>();
  const { MARCA_A, MARCA_B } = await import("../utilidades/puertas-falsas");
  return {
    ...real,
    cartaPublicaFalsa: real.crearCartaPublicaFalsa({
      "ejemplo-cafeteria": MARCA_A.id,
      "ejemplo-hosteria": MARCA_A.id,
      "ejemplo-panaderia": MARCA_B.id,
    }),
  };
});

const HOST_CARTA_B = "carta.panaderialospinos.test";
const CAFETERIA = "ejemplo-cafeteria";
const PANADERIA = "ejemplo-panaderia";

const comoPedido = (host: string): void => {
  pedidoActual.encabezados = new Headers({ host });
};

function esNoEncontrada(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String(error.digest).includes("404")
  );
}

/** Corre `trabajo`; si responde «no existe» (`notFound()`), devuelve `null`. */
async function conNoEncontrada<T>(trabajo: () => Promise<T>): Promise<T | null> {
  try {
    return await trabajo();
  } catch (error) {
    if (esNoEncontrada(error)) return null;
    throw error;
  }
}

/**
 * Las páginas de la carta arrastran componentes de navegador (`window`, `document`) que el `tsc` de la raíz, sin
 * la librería DOM, no puede revisar: se importan por una ruta calculada para que no las siga (la web las revisa
 * con su propio `tsconfig`). Vitest las resuelve igual, en tiempo de ejecución.
 */
type ModuloDePagina<P> = Readonly<{
  default: (p: { params: Promise<P> }) => Promise<unknown>;
  generateMetadata: (p: { params: Promise<P> }) => Promise<object>;
}>;
const RAIZ_DE_LA_CARTA = "../../apps/web/app/s/carta/";
const cargar = <P>(ruta: string): Promise<ModuloDePagina<P>> =>
  import(/* @vite-ignore */ `${RAIZ_DE_LA_CARTA}${ruta}`) as Promise<ModuloDePagina<P>>;

async function paginaDeLaCarta(codigo: string) {
  const { default: Pagina } = await cargar<{ codigo: string }>("[codigo]/page");
  return conNoEncontrada(
    async () => (await Pagina({ params: Promise.resolve({ codigo }) })) as ReactElement,
  );
}

async function metadatosDeLaCarta(codigo: string) {
  const { generateMetadata } = await cargar<{ codigo: string }>("[codigo]/page");
  return conNoEncontrada(() => generateMetadata({ params: Promise.resolve({ codigo }) }));
}

async function paginaDelProducto(codigo: string, producto: string) {
  const { default: Pagina } = await cargar<{ codigo: string; producto: string }>(
    "[codigo]/[producto]/page",
  );
  return conNoEncontrada(
    async () => (await Pagina({ params: Promise.resolve({ codigo, producto }) })) as ReactElement,
  );
}

async function metadatosDelProducto(codigo: string, producto: string) {
  const { generateMetadata } = await cargar<{ codigo: string; producto: string }>(
    "[codigo]/[producto]/page",
  );
  return conNoEncontrada(() => generateMetadata({ params: Promise.resolve({ codigo, producto }) }));
}

/** El tramo final de la dirección de un producto de la cafetería (de la marca A), para pedirlo por separado. */
async function segmentoDeUnProductoDeA(): Promise<string> {
  const { cartaParaLaPantalla } = await import("../../apps/web/servidor/carta");
  const carta = await cartaParaLaPantalla(MARCA_A.id, CAFETERIA);
  const segmento = carta?.vista.secciones[0]?.productos[0]?.segmento;
  if (segmento === undefined) throw new Error("la cafetería de ejemplo no tiene productos");
  return segmento;
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
});

describe("la carta es de la marca del dominio (S2)", () => {
  it("en el dominio de la marca A se ve su carta; la de B, con su código, no", async () => {
    comoPedido(HOST_CARTA_A);
    const propia = await paginaDeLaCarta(CAFETERIA);
    expect((propia?.props as { vista: { nombre: string } }).vista.nombre).toBe("La Esquina Café");
    expect(await paginaDeLaCarta(PANADERIA)).toBeNull();
    expect(await metadatosDeLaCarta(PANADERIA)).toMatchObject({
      robots: { index: false, follow: false },
    });
    expect(await metadatosDeLaCarta(PANADERIA)).not.toHaveProperty("title");
  });

  it("en el dominio de la marca B, la carta de A con su código tampoco se obtiene", async () => {
    comoPedido(HOST_CARTA_B);
    expect(await paginaDeLaCarta(CAFETERIA)).toBeNull();
    expect(await metadatosDeLaCarta(CAFETERIA)).not.toHaveProperty("title");
    const propia = await paginaDeLaCarta(PANADERIA);
    expect((propia?.props as { vista: { nombre: string } }).vista.nombre).toBe(
      "Panadería El Trigal",
    );
  });

  it("un producto de la carta de A no sale desde el dominio de B, ni su título en los metadatos", async () => {
    const segmento = await segmentoDeUnProductoDeA();
    comoPedido(HOST_CARTA_A);
    expect(await paginaDelProducto(CAFETERIA, segmento)).not.toBeNull();
    expect(await metadatosDelProducto(CAFETERIA, segmento)).toHaveProperty("title");
    comoPedido(HOST_CARTA_B);
    expect(await paginaDelProducto(CAFETERIA, segmento)).toBeNull();
    expect(await metadatosDelProducto(CAFETERIA, segmento)).not.toHaveProperty("title");
  });

  it.each([
    ["la aplicación de A", HOST_APP_A],
    ["la landing de A", HOST_LANDING_A],
    ["un host desconocido", "otro.ejemplo.com"],
    ["un dominio retirado", "viejo.hoteldellago.test"],
    ["la consola de A", "consola.hoteldellago.test"],
    ["un X-Forwarded-Host no cuenta", "sin-host.invalido!"],
  ])("en %s (host que no es de carta) la carta no llega: es la neutra", async (_n, host) => {
    const segmento = await segmentoDeUnProductoDeA();
    comoPedido(host);
    pedidoActual.encabezados.set("x-forwarded-host", HOST_CARTA_A);
    expect(await paginaDeLaCarta(CAFETERIA)).toBeNull();
    expect(await metadatosDeLaCarta(CAFETERIA)).toBeNull();
    expect(await paginaDelProducto(CAFETERIA, segmento)).toBeNull();
    expect(await metadatosDelProducto(CAFETERIA, segmento)).toBeNull();
  });
});

describe("el falso de la carta respeta la marca (S2)", () => {
  it("devuelve la carta solo a su marca, y a cualquier otra o a un código desconocido, null", async () => {
    const { crearCartaPublicaFalsa } = await vi.importActual<typeof Falso>(
      "../../apps/web/servidor/carta-publica-falsa",
    );
    const falso = crearCartaPublicaFalsa({ [CAFETERIA]: MARCA_A.id });
    expect((await falso.porCodigo(MARCA_A.id, CAFETERIA))?.codigo).toBe(CAFETERIA);
    expect(await falso.porCodigo(MARCA_B.id, CAFETERIA)).toBeNull();
    expect(await falso.porCodigo("", CAFETERIA)).toBeNull();
    expect(await falso.porCodigo(MARCA_A.id, PANADERIA)).toBeNull();
    expect(await falso.porCodigo(MARCA_A.id, "no-existe")).toBeNull();
  });

  it("el falso que usa la web de verdad pertenece a marcas inventadas: ninguna marca real recibe una carta", async () => {
    const { cartaPublicaFalsa } = await vi.importActual<typeof Falso>(
      "../../apps/web/servidor/carta-publica-falsa",
    );
    for (const marca of [MARCA_A.id, MARCA_B.id]) {
      for (const codigo of [CAFETERIA, PANADERIA, "ejemplo-hosteria", "ejemplo-barberia"]) {
        expect(await cartaPublicaFalsa.porCodigo(marca, codigo), `${marca} ${codigo}`).toBeNull();
      }
    }
  });
});
