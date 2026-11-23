import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cssDelTemaDeLaCarta,
  temaDeLaCarta,
} from "../../src/capacidades/experiencia/vidriera/tema-de-la-carta";
import { deLaMarca } from "../utilidades/alcance-del-host";
import { HOST_VIDRIERA_A, MARCA_A } from "../utilidades/puertas-falsas";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * V1b: la carta pública DIBUJA lo que la persona eligió. De la identidad que lee el puerto (cara, color propio o de la empresa) salen, en la página de la carta y en la de un producto: el tema
 * (`<style nonce>` con los colores, que la CSP deja pasar solo con el nonce del pedido), la cara (`data-cara`) y la placa con la inicial. Una carta que no eligió nada se ve como siempre: ni estilo ni cara
 * ni placa. Contra la base real, `test/integracion/carta-publica-identidad.test.ts`.
 */
vi.mock("server-only", () => ({}));
const pedidoActual = vi.hoisted(() => ({ encabezados: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(pedidoActual.encabezados) }));
vi.mock("../../apps/web/servidor/fuente-de-puertas", async () => {
  const { crearPuertaFalsa } = await import("../utilidades/puertas-falsas");
  const puerta = crearPuertaFalsa();
  return { fuenteDePuertas: { consultarHost: puerta.consultarHost, leerMarca: puerta.leerMarca } };
});
vi.mock("../../apps/web/servidor/composicion", async () => {
  const { crearVidrieraPublicaFalsa } = await import("../utilidades/vidriera-publica-falsa");
  const { MARCA_A } = await import("../utilidades/puertas-falsas");
  const falsa = crearVidrieraPublicaFalsa({
    "ejemplo-cafeteria": MARCA_A.id,
    "ejemplo-hosteria": MARCA_A.id,
    "ejemplo-panaderia": MARCA_A.id,
  });
  const identidad = (
    cara: string | null,
    colorPropio: string | null,
    colorDeLaEmpresa: string | null,
  ) => ({
    modelo: "LISTA" as const,
    cara,
    colorPropio,
    colorDeLaEmpresa,
    logo: null,
  });
  const ELEGIDAS: Record<string, ReturnType<typeof identidad>> = {
    "ejemplo-cafeteria": identidad("NOCHE", "#1f4e79", null),
    "ejemplo-panaderia": identidad("BOLICHE", null, "#7a1f2b"),
    "ejemplo-hosteria": identidad(null, null, null),
  };
  return {
    web: {
      vidrieraPublica: () => ({
        porCodigo: async (puerta: never, codigo: string) => {
          const carta = await falsa.porCodigo(puerta, codigo);
          return carta === null
            ? null
            : { ...carta, identidad: ELEGIDAS[codigo] ?? carta.identidad };
        },
      }),
    },
  };
});

const NONCE = "bm9uY2UtZGUtcHJ1ZWJhLTAx";
const CAFETERIA = "ejemplo-cafeteria";
const PANADERIA = "ejemplo-panaderia";
const HOSTERIA = "ejemplo-hosteria";

const comoPedido = (conNonce = true): void => {
  pedidoActual.encabezados = new Headers({ host: HOST_VIDRIERA_A });
  if (conNonce) pedidoActual.encabezados.set("x-pd-nonce", NONCE);
};

type ModuloDePagina<P> = Readonly<{ default: (p: { params: Promise<P> }) => Promise<unknown> }>;
const RAIZ = "../../apps/web/app/s/carta/";
const cargar = <P>(ruta: string): Promise<ModuloDePagina<P>> =>
  import(/* @vite-ignore */ `${RAIZ}${ruta}`) as Promise<ModuloDePagina<P>>;

const htmlDeLaCarta = async (codigo: string): Promise<string> => {
  const { default: Pagina } = await cargar<{ codigo: string }>("[codigo]/page");
  return renderToStaticMarkup(
    (await Pagina({ params: Promise.resolve({ codigo }) })) as ReactElement,
  );
};
const htmlDelProducto = async (codigo: string): Promise<string> => {
  const { vidrieraParaLaPantalla } = await import("../../apps/web/servidor/vidriera");
  const vidriera = await vidrieraParaLaPantalla(deLaMarca(MARCA_A.id), codigo);
  const segmento = vidriera?.vista.secciones[0]?.productos[0]?.segmento;
  if (segmento === undefined) throw new Error("la carta de ejemplo no tiene productos");
  const { default: Pagina } = await cargar<{ codigo: string; producto: string }>(
    "[codigo]/[producto]/page",
  );
  return renderToStaticMarkup(
    (await Pagina({ params: Promise.resolve({ codigo, producto: segmento }) })) as ReactElement,
  );
};
const cssEsperado = (cara: "DIA" | "BOLICHE" | "NOCHE", color: string): string => {
  const tema = temaDeLaCarta(cara, color);
  if (!tema.ok) throw new Error("color válido esperado");
  return cssDelTemaDeLaCarta(tema.valor);
};

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  comoPedido();
});

describe("la carta pública dibuja lo elegido", () => {
  it("con cara y color propio: el tema en un `<style nonce>`, la cara y la placa con la inicial", async () => {
    const html = await htmlDeLaCarta(CAFETERIA);
    expect(html).toContain(`<style nonce="${NONCE}">${cssEsperado("NOCHE", "#1f4e79")}</style>`);
    expect(html).toMatch(/<main[^>]*data-cara="NOCHE"/);
    expect(html).toMatch(/<span[^>]*data-placa=""[^>]*>L<\/span>/);
  });

  it("sin color propio usa el de la empresa, y la cara elegida", async () => {
    const html = await htmlDeLaCarta(PANADERIA);
    expect(html).toContain(`<style nonce="${NONCE}">${cssEsperado("BOLICHE", "#7a1f2b")}</style>`);
    expect(html).toMatch(/<main[^>]*data-cara="BOLICHE"/);
  });

  it("una carta que no eligió nada se ve como siempre: ni estilo, ni cara, ni placa", async () => {
    const html = await htmlDeLaCarta(HOSTERIA);
    expect(html).not.toContain("<style");
    expect(html).not.toContain("data-cara");
    expect(html).not.toContain("data-placa");
  });

  it("el tema de una carta no se filtra a otra: cada página lleva el suyo", async () => {
    const [noche, boliche] = [await htmlDeLaCarta(CAFETERIA), await htmlDeLaCarta(PANADERIA)];
    expect(noche).not.toContain(cssEsperado("BOLICHE", "#7a1f2b"));
    expect(boliche).not.toContain(cssEsperado("NOCHE", "#1f4e79"));
  });

  it("la página de un producto lleva el mismo tema que su carta", async () => {
    const html = await htmlDelProducto(CAFETERIA);
    expect(html).toContain(`<style nonce="${NONCE}">${cssEsperado("NOCHE", "#1f4e79")}</style>`);
    expect(await htmlDelProducto(HOSTERIA)).not.toContain("<style");
  });

  it("sin el nonce del pedido no se escribe el estilo (la CSP lo bloquearía) pero la cara sigue", async () => {
    comoPedido(false);
    const html = await htmlDeLaCarta(CAFETERIA);
    expect(html).not.toContain("<style");
    expect(html).toMatch(/<main[^>]*data-cara="NOCHE"/);
  });

  it("un nonce con otra forma no se usa", async () => {
    pedidoActual.encabezados.set("x-pd-nonce", "x;}body{display:none");
    expect(await htmlDeLaCarta(CAFETERIA)).not.toContain("<style");
  });
});
