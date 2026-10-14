import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_APP_A,
  HOST_APP_B,
  HOST_CARTA_A,
  HOST_LANDING_A,
  HOST_LANDING_B,
  MARCA_A,
  MARCA_B,
  type MarcaSembrada,
  type PuertaFalsa,
} from "../utilidades/puertas-falsas";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * W4: lo que se PINTA. Las páginas y layouts del servidor, con el falso de la puerta pública y dos
 * marcas: cada respuesta de A no trae ni una seña de B (P-1, la parte que se puede probar sin e2e), el
 * tema sale solo del tema validado, todo `<script>` y `<style>` lleva el nonce del pedido y el host que
 * no corresponde a la superficie es la neutra. Las páginas son funciones asíncronas: se llaman, se
 * resuelven y el árbol resultante (síncrono) se renderiza a HTML.
 */
vi.mock("server-only", () => ({}));
const pedidoActual = vi.hoisted(() => ({
  encabezados: new Headers(),
  puerta: null as PuertaFalsa | null,
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(pedidoActual.encabezados) }));
vi.mock("../../apps/web/servidor/fuente-de-puertas", async () => {
  const { crearPuertaFalsa } = await import("../utilidades/puertas-falsas");
  const puerta = crearPuertaFalsa();
  pedidoActual.puerta = puerta;
  return { fuenteDePuertas: { consultarHost: puerta.consultarHost, leerMarca: puerta.leerMarca } };
});

const NONCE = "bm9uY2UtZGUtcHJ1ZWJhLTE2Ynl0ZXM=";
const NONCE_VALIDO = /^[A-Za-z0-9+/]{22,}={0,2}$/;

const comoPedido = (host: string, extra: Record<string, string> = {}): void => {
  pedidoActual.encabezados = new Headers({ host, "x-zh-nonce": NONCE, ...extra });
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

const html = (elemento: ReactElement): string => renderToStaticMarkup(elemento);

/** Landing completa: layout (tema y cabecera) alrededor de la página. */
async function landing(): Promise<string | null> {
  const { default: Layout } = await import("../../apps/web/app/s/landing/layout");
  const { default: Pagina } = await import("../../apps/web/app/s/landing/page");
  return conNoEncontrada(async () => html(await Layout({ children: await Pagina() })));
}

async function app(): Promise<string | null> {
  const { default: Layout } = await import("../../apps/web/app/s/app/layout");
  const { default: Pagina } = await import("../../apps/web/app/s/app/[[...ruta]]/page");
  return conNoEncontrada(async () => {
    const pagina = await conNoEncontrada(() => Pagina());
    if (pagina === null) {
      const { default: NoEncontrada } = await import("../../apps/web/app/s/app/not-found");
      return html(await Layout({ children: createElement(NoEncontrada) }));
    }
    return html(await Layout({ children: pagina }));
  });
}

const senasAjenas = (propia: MarcaSembrada): readonly string[] =>
  (propia === MARCA_A ? MARCA_B : MARCA_A).senas;

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("landing", () => {
  it.each([
    [HOST_LANDING_A, MARCA_A],
    [HOST_LANDING_B, MARCA_B],
  ])(
    "%s muestra SU marca, su tema y su «Ingresar», y nada de la otra (P-1)",
    async (host, marca) => {
      comoPedido(host);
      const cuerpo = await landing();
      expect(cuerpo).not.toBeNull();
      const texto = cuerpo as string;
      expect(texto).toContain(marca.publica.nombre);
      expect(texto).toContain(`href="https://${marca.publica.hostDeApp}/"`);
      expect(texto).toContain(">Ingresar<");
      expect(texto).toContain(`--brand-primary:${marca.publica.tema["primary"]}`);
      for (const sena of senasAjenas(marca)) expect(texto, sena).not.toContain(sena);
    },
  );

  it("el tema va en un style con el nonce del pedido, y solo con variables --brand-*", async () => {
    comoPedido(HOST_LANDING_A);
    const texto = (await landing()) as string;
    const estilos = [...texto.matchAll(/<style([^>]*)>([^<]*)<\/style>/g)];
    expect(estilos).toHaveLength(1);
    expect(estilos[0]?.[1]).toBe(` nonce="${NONCE}"`);
    expect(estilos[0]?.[2]).toBe(
      ":root{--brand-primary:#7a1f1f;--brand-on-primary:#ffffff;--brand-secondary:#444444;--brand-accent:#a15c00}",
    );
  });

  it("sin nonce (o con uno raro) no se pinta ningún style, pero la página sigue", async () => {
    for (const nonce of ["", "a;b", "x"]) {
      comoPedido(HOST_LANDING_A, { "x-zh-nonce": nonce });
      const texto = (await landing()) as string;
      expect(texto).not.toContain("<style");
      expect(texto).toContain(MARCA_A.publica.nombre);
    }
    pedidoActual.encabezados = new Headers({ host: HOST_LANDING_A });
    expect((await landing()) as string).not.toContain("<style");
  });

  it("todo style y script del cuerpo tiene un nonce válido, y no hay scripts en línea sin él", async () => {
    comoPedido(HOST_LANDING_A);
    const texto = (await landing()) as string;
    for (const etiqueta of texto.matchAll(/<(style|script)\b([^>]*)>/gi)) {
      const nonce = /nonce="([^"]+)"/.exec(etiqueta[2] ?? "")?.[1];
      expect(nonce, etiqueta[0]).toMatch(NONCE_VALIDO);
      expect(nonce).toBe(NONCE);
    }
    expect(texto).not.toMatch(/\son\w+=/);
    expect(texto).not.toContain("javascript:");
  });

  it("el nombre de la marca se escapa: nunca se pinta como marcado", async () => {
    const original = MARCA_A.publica.nombre;
    (MARCA_A.publica as { nombre: string }).nombre = '<img src=x onerror="alert(1)">&"';
    try {
      comoPedido(HOST_LANDING_A);
      // La caché de la puerta guarda el objeto de la marca: se lee el mismo, ya modificado.
      const texto = (await landing()) as string;
      expect(texto).not.toContain("<img");
      expect(texto).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
    } finally {
      (MARCA_A.publica as { nombre: string }).nombre = original;
    }
  });

  it("un tema con texto libre no se interpola: se ignora y rige el neutro", async () => {
    const original = MARCA_B.publica.tema;
    (MARCA_B.publica as { tema: unknown }).tema = {
      primary: "red;}body{display:none",
      accent: "#0b6b8a",
    };
    try {
      comoPedido(HOST_LANDING_B);
      const texto = (await landing()) as string;
      expect(texto).not.toContain("display:none");
      expect(texto).toContain(":root{--brand-accent:#0b6b8a}");
    } finally {
      (MARCA_B.publica as { tema: unknown }).tema = original;
    }
  });
});

describe("cada página vuelve a resolver el host (no confía en el proxy)", () => {
  it.each([
    ["landing", HOST_APP_A],
    ["landing", HOST_CARTA_A],
    ["landing", "otro.ejemplo.com"],
    ["landing", "viejo.hoteldellago.test"],
    ["landing", "zuluhub-erp.vercel.app"],
    ["landing", ""],
  ])(
    "la %s pedida con el host %j es la neutra, aunque el proxy la hubiera dejado pasar",
    async (_p, host) => {
      comoPedido(host === "" ? "sin-host.invalido!" : host);
      if (host === "")
        pedidoActual.encabezados = new Headers({ "x-forwarded-host": HOST_LANDING_A });
      expect(await landing()).toBeNull();
    },
  );

  it("la app en un host de landing, de carta o desconocido es la neutra", async () => {
    for (const host of [HOST_LANDING_A, HOST_CARTA_A, HOST_LANDING_B, "otro.ejemplo.com"]) {
      comoPedido(host);
      expect(await app(), host).toBeNull();
    }
  });

  it("un X-Forwarded-Host de A en un pedido de B no cambia de marca", async () => {
    comoPedido(HOST_LANDING_B, { "x-forwarded-host": HOST_LANDING_A });
    const texto = (await landing()) as string;
    expect(texto).toContain(MARCA_B.publica.nombre);
    for (const sena of MARCA_A.senas) expect(texto).not.toContain(sena);
  });

  it("con la base caída las páginas son la neutra (no se inventa una marca)", async () => {
    const puerta = pedidoActual.puerta as PuertaFalsa;
    puerta.baseCaida.valor = true;
    try {
      comoPedido("recien.llegado.hoteldellago.test");
      expect(await landing()).toBeNull();
    } finally {
      puerta.baseCaida.valor = false;
    }
  });
});

describe("app", () => {
  it.each([
    [HOST_APP_A, MARCA_A],
    [HOST_APP_B, MARCA_B],
  ])("%s: cabecera de SU marca, 404 propio y nada de la otra", async (host, marca) => {
    comoPedido(host);
    const texto = (await app()) as string;
    expect(texto).toContain(marca.publica.nombre);
    expect(texto).toContain("No encontrado");
    expect(texto).toContain(`--brand-primary:${marca.publica.tema["primary"]}`);
    for (const sena of senasAjenas(marca)) expect(texto, sena).not.toContain(sena);
  });
});

describe("metadatos y robots de cada superficie", () => {
  it("la landing solo se indexa en producción; la app, nunca", async () => {
    const { generateMetadata: deLanding } = await import("../../apps/web/app/s/landing/layout");
    const { generateMetadata: deApp } = await import("../../apps/web/app/s/app/layout");
    comoPedido(HOST_LANDING_A);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await deLanding()).toEqual({
      title: "Hotel del Lago",
      robots: { index: true, follow: true },
    });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await deLanding()).toEqual({
      title: "Hotel del Lago",
      robots: { index: false, follow: false },
    });
    comoPedido(HOST_APP_A);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await deApp()).toEqual({
      title: "Hotel del Lago",
      robots: { index: false, follow: false },
    });
  });

  it("los metadatos de una superficie en el host equivocado son la neutra", async () => {
    const { generateMetadata } = await import("../../apps/web/app/s/landing/layout");
    comoPedido(HOST_APP_A);
    await expect(generateMetadata()).rejects.toSatisfy(esNoEncontrada);
  });
});

describe("servidor/pedido", () => {
  it("el nonce solo se lee si tiene forma de nonce", async () => {
    const { nonceDelPedido } = await import("../../apps/web/servidor/pedido");
    comoPedido(HOST_APP_A);
    expect(await nonceDelPedido()).toBe(NONCE);
    comoPedido(HOST_APP_A, { "x-zh-nonce": "no es un nonce;" });
    expect(await nonceDelPedido()).toBeNull();
    pedidoActual.encabezados = new Headers({ host: HOST_APP_A });
    expect(await nonceDelPedido()).toBeNull();
  });
});

describe("la neutra", () => {
  it("no trae nada de ninguna marca ni cookies", async () => {
    const { default: Neutra } = await import("../../apps/web/app/s/neutra/page");
    const { default: NoEncontradaDeLaRaiz } = await import("../../apps/web/app/not-found");
    for (const componente of [Neutra, NoEncontradaDeLaRaiz]) {
      const texto = html(createElement(componente));
      expect(texto).toContain("No encontrado");
      for (const sena of [...MARCA_A.senas, ...MARCA_B.senas]) expect(texto).not.toContain(sena);
      expect(texto).not.toContain("<style");
      expect(texto.toLowerCase()).not.toContain("<script");
    }
  });
});
