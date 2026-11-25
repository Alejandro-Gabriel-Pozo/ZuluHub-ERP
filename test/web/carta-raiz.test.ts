import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlcanceDelHost } from "../../src/capacidades/experiencia/puerta";
import type { CartaDeLaLista } from "../../src/puertos/vidriera-publica";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La raíz de la carta (`/` en un host de carta, P3 del dominio propio): con UNA carta en línea redirige (307) a `/<código>`, con varias lista, sin ninguna o en un host compartido da la 404 neutra.
 * El alcance sale de la PUERTA resuelta para el host del pedido, nunca de un dato del navegador (S2). Las páginas se llaman con una puerta falsa que sabe de hosts de empresa y con una lectura de cartas falsa.
 */
vi.mock("server-only", () => ({}));
const pedidoActual = vi.hoisted(() => ({ encabezados: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(pedidoActual.encabezados) }));

const MARCA = "00000e01-0000-4000-8000-0000000000aa";
const EMPRESA = "00000e01-0000-4000-8000-0000000000bb";
const HOST_DE_EMPRESA = "carta.cliente.test";
const HOST_COMPARTIDO = "carta.plataforma.test";
const HOST_DE_APP = "app.cliente.test";

const estado = vi.hoisted(() => ({
  cartas: [] as readonly CartaDeLaLista[],
  pedidos: [] as AlcanceDelHost[],
}));

vi.mock("../../apps/web/servidor/fuente-de-puertas", async () => {
  const { ok: bien } = await import("../../src/primitivas/resultado/resultado");
  return {
    fuenteDePuertas: {
      consultarHost: (host: string, superficie: string) => {
        if (host === HOST_DE_EMPRESA && superficie === "CARTA") {
          return Promise.resolve(
            bien({ marcaId: MARCA, duenio: { tipo: "EMPRESA", empresaId: EMPRESA } }),
          );
        }
        if (host === HOST_COMPARTIDO && superficie === "CARTA") {
          return Promise.resolve(bien({ marcaId: MARCA, duenio: { tipo: "MARCA" } }));
        }
        if (host === HOST_DE_APP && superficie === "APP") {
          return Promise.resolve(
            bien({ marcaId: MARCA, duenio: { tipo: "EMPRESA", empresaId: EMPRESA } }),
          );
        }
        return Promise.resolve(bien(null));
      },
      leerMarca: () => Promise.resolve({ nombre: "Hoteles del Sur", tema: {}, hostDeApp: null }),
    },
  };
});
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    vidrieraPublica: () => ({
      porCodigo: () => Promise.resolve(null),
      // Como el real: en un host de la marca, siempre vacío.
      listarDelHost: (alcance: AlcanceDelHost) => {
        estado.pedidos.push(alcance);
        return Promise.resolve(alcance.duenio.tipo === "EMPRESA" ? estado.cartas : []);
      },
    }),
  },
}));

type Modulo = Readonly<{ default: () => Promise<unknown>; metadata: { robots: unknown } }>;
const cargar = (): Promise<Modulo> =>
  import(/* @vite-ignore */ "../../apps/web/app/s/carta/page") as Promise<Modulo>;

const carta = (n: number, extra: Partial<CartaDeLaLista> = {}): CartaDeLaLista => ({
  codigo: `codigo-de-la-carta-numero-${n}-xxxxxxxx`,
  nombre: `Carta ${n}`,
  rubro: null,
  lugar: null,
  ...extra,
});

const comoPedido = (host: string): void => {
  pedidoActual.encabezados = new Headers({ host });
};

/** Lo que `notFound()` y `redirect()` lanzan: su `digest` dice cuál fue. */
async function resultado(): Promise<
  | { tipo: "pagina"; pagina: ReactElement }
  | { tipo: "noEncontrada" }
  | { tipo: "redireccion"; digest: string }
> {
  const { default: Pagina } = await cargar();
  try {
    return { tipo: "pagina", pagina: (await Pagina()) as ReactElement };
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? "");
    if (digest.includes("404")) return { tipo: "noEncontrada" };
    if (digest.startsWith("NEXT_REDIRECT")) return { tipo: "redireccion", digest };
    throw error;
  }
}

beforeEach(() => {
  estado.cartas = [];
  estado.pedidos = [];
  vi.stubEnv("VERCEL_ENV", "preview");
});

describe("la raíz de la carta en un host de carta", () => {
  it("sin ninguna carta en línea: la 404 neutra", async () => {
    comoPedido(HOST_DE_EMPRESA);
    expect(await resultado()).toEqual({ tipo: "noEncontrada" });
  });

  it("con UNA carta: redirección 307 temporal a /<código>, sin lista", async () => {
    estado.cartas = [carta(1)];
    comoPedido(HOST_DE_EMPRESA);
    const r = await resultado();
    expect(r.tipo).toBe("redireccion");
    if (r.tipo !== "redireccion") return;
    expect(r.digest).toContain(`/${carta(1).codigo}`);
    expect(r.digest).toContain("307");
  });

  it("con VARIAS: la lista, con el nombre, el rubro y el lugar de cada una, bajo el nombre de la marca", async () => {
    estado.cartas = [
      carta(1, { rubro: "Cafetería", lugar: "Av. Belgrano 412" }),
      carta(2),
      carta(3, { lugar: "Neuquén" }),
    ];
    comoPedido(HOST_DE_EMPRESA);
    const r = await resultado();
    expect(r.tipo).toBe("pagina");
    if (r.tipo !== "pagina") return;
    const props = r.pagina.props as { titulo: string; children: ReactElement };
    expect(props.titulo).toBe("Hoteles del Sur");
    const lista = props.children.props as {
      cartas: readonly CartaDeLaLista[];
      rutaDe: (codigo: string) => string;
    };
    expect(lista.cartas).toEqual(estado.cartas);
    expect(lista.rutaDe("abc")).toBe("/abc");
  });

  it("el alcance es el de la puerta del host (marca y dueño), nunca un dato del navegador", async () => {
    estado.cartas = [carta(1), carta(2)];
    comoPedido(HOST_DE_EMPRESA);
    await resultado();
    expect(estado.pedidos).toHaveLength(1);
    expect(estado.pedidos[0]).toMatchObject({
      marcaId: MARCA,
      duenio: { tipo: "EMPRESA", empresaId: EMPRESA },
    });
  });

  it("el host compartido (dueño: la marca) da la 404 neutra aunque haya cartas: no lista cartas ajenas", async () => {
    estado.cartas = [carta(1), carta(2)];
    comoPedido(HOST_COMPARTIDO);
    expect(await resultado()).toEqual({ tipo: "noEncontrada" });
    expect(estado.pedidos[0]?.duenio).toEqual({ tipo: "MARCA" });
  });

  it("un host que no es de carta (aplicación, desconocido) da la 404 sin ni buscar las cartas", async () => {
    estado.cartas = [carta(1), carta(2)];
    for (const host of [HOST_DE_APP, "desconocido.test"]) {
      comoPedido(host);
      expect(await resultado(), host).toEqual({ tipo: "noEncontrada" });
    }
    expect(estado.pedidos).toEqual([]);
  });

  it("no se indexa nunca: los mismos metadatos que la carta que no está", async () => {
    const { metadata } = await cargar();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("un fallo de la lectura NO se disfraza de lista vacía: se propaga", async () => {
    const composicion = await import("../../apps/web/servidor/composicion");
    const original = composicion.web.vidrieraPublica;
    (composicion.web as { vidrieraPublica: unknown }).vidrieraPublica = () => ({
      listarDelHost: () => Promise.reject(new Error("base caída")),
    });
    try {
      comoPedido(HOST_DE_EMPRESA);
      await expect(resultado()).rejects.toThrow("base caída");
    } finally {
      (composicion.web as { vidrieraPublica: unknown }).vidrieraPublica = original;
    }
  });
});
