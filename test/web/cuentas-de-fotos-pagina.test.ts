import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de «Conectá tu cuenta de fotos»: pide la lista al servidor, fija UNA clave de declaración por apertura, liga a cada retiro la cuenta y la versión que la persona vio, y pinta cada situación con
 * los textos del catálogo. Sin permiso, o con un error de la lectura, sale el motivo y NINGÚN dato ni formulario. Un solo `h1`.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    respuesta: unknown;
    llamadas: unknown[][];
    claves: string[];
    ligadas: { accion: string; args: unknown[] }[];
  } => ({ permisos: null, respuesta: null, llamadas: [], claves: [], ligadas: [] }),
);
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT ${destino}`);
  },
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { consultasDeEmpresas: () => ({ permisosDelActor: () => Promise.resolve(mundo.permisos) }) },
}));
vi.mock("../../apps/web/servidor/cuentas-de-fotos", () => ({
  cargarLasCuentasDeFotos: (...args: unknown[]) => {
    mundo.llamadas.push(args);
    return Promise.resolve(mundo.respuesta);
  },
  nuevaClaveDeCuentaDeFotos: () => {
    const clave = `clave-${String(mundo.claves.length + 1)}`;
    mundo.claves.push(clave);
    return clave;
  },
}));
const accion = (nombre: string) => ({
  bind: (...ligadas: unknown[]) => {
    mundo.ligadas.push({ accion: nombre, args: ligadas });
    return () => Promise.resolve({ error: null });
  },
});
vi.mock("../../apps/web/app/s/app/acciones-de-cuentas-de-fotos", () => ({
  declararLaCuentaAccion: accion("declarar"),
  retirarLaCuentaAccion: accion("retirar"),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {},
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba", hostDeApp: "app.ejemplo.test" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: { id: "contexto" },
        },
      },
    }),
}));

const PAGINA = "../../apps/web/app/s/app/(operacion)/catalogo/carta-en-linea/cuentas-de-fotos/page";
const html = async () => {
  const { default: Pagina } = (await import(/* @vite-ignore */ PAGINA)) as {
    default: () => Promise<unknown>;
  };
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};
const principal = (m: string) => /<main\b[^>]*>(.*)<\/main>/s.exec(m)?.[1] ?? "";
const texto = (m: string) =>
  principal(m)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
const h1 = (m: string) => [...m.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((x) => x[1]);
const lista = (cuentas: unknown[]): Respuesta<unknown> => ({ ok: true, dato: cuentas });
const CUENTAS = [
  { id: "c-1", cuenta: "mi-hotel", version: 1 },
  { id: "c-2", cuenta: "agencia_2", version: 4 },
];

beforeEach(() => {
  Object.assign(mundo, { llamadas: [], claves: [], ligadas: [], respuesta: lista(CUENTAS) });
  mundo.permisos = {
    ok: true,
    valor: {
      acciones: ["vidrieras.administrar_cuentas_de_imagen"],
      modulos: { activos: ["vidriera"], enSoloLectura: [] },
    },
  };
});

describe("la página «Conectá tu cuenta de fotos»", () => {
  it("un solo h1, pide la lista con el contexto de la empresa y muestra cada cuenta con su motivo y «Quitar»", async () => {
    const marcado = await html();
    expect(h1(marcado)).toEqual(["Conectá tu cuenta de fotos"]);
    expect(mundo.llamadas).toEqual([[{ id: "contexto" }]]);
    const t = texto(marcado);
    expect(t).toContain("mi-hotel");
    expect(t).toContain("agencia_2");
    expect(t).toContain("Guardar");
    expect((marcado.match(/Quitar/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("liga la clave de declaración (una por apertura) y, a cada retiro, SU cuenta y la versión que se vio", async () => {
    await html();
    await html();
    expect(mundo.claves).toEqual(["clave-1", "clave-2"]);
    const primera = mundo.ligadas.slice(0, 3);
    expect(primera).toEqual([
      { accion: "declarar", args: [null, { claveDeIdempotencia: "clave-1" }] },
      { accion: "retirar", args: [null, { id: "c-1", versionEsperada: 1 }] },
      { accion: "retirar", args: [null, { id: "c-2", versionEsperada: 4 }] },
    ]);
  });

  it("sin cuentas, solo el formulario de declarar", async () => {
    mundo.respuesta = lista([]);
    const marcado = await html();
    expect(texto(marcado)).toContain("Guardar");
    expect(marcado).not.toContain("Quitar");
    expect(mundo.ligadas.map((l) => l.accion)).toEqual(["declarar"]);
  });

  it("si la lectura rechaza (sin permiso), sale el motivo y NINGÚN formulario ni acción ligada", async () => {
    mundo.respuesta = { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    const marcado = await html();
    expect(marcado).not.toContain("Guardar");
    expect(marcado).not.toContain("Quitar");
    expect(mundo.ligadas).toEqual([]);
  });
});
