import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODIGOS_PUBLICOS,
  errorDeCodigo,
  type Respuesta,
} from "../../src/capacidades/experiencia/respuesta";

/**
 * La descarga del archivo de compras (`/compras/exportar`): solo GET, sin caché, nombre de archivo del catálogo, error genérico sin texto del cliente, y un pedido que no sale de esta
 * misma aplicación (`Sec-Fetch-Site`) no llega ni a la lectura. Previene: un archivo cacheado con importes de la empresa, un nombre armado con lo que escribió el cliente y registros de
 * auditoría sembrados desde otro sitio. Los permisos, el aislamiento y el contenido se prueban con la base real en `test/integracion/compras-exportacion*.test.ts`.
 */
vi.mock("server-only", () => ({}));
const estado = vi.hoisted(
  (): { cabeceras: Record<string, string>; llamadas: unknown[]; respuesta: unknown } => ({
    cabeceras: {},
    llamadas: [],
    respuesta: null,
  }),
);
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({ get: (nombre: string) => estado.cabeceras[nombre.toLowerCase()] ?? null }),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({ web: {} }));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { registrar: () => undefined } },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => Promise<unknown>) =>
    hacer({ contexto: "de prueba" }),
}));
vi.mock("../../src/composicion/compras-exportacion-web", () => ({
  exportarLasCompras: (_d: unknown, _contexto: unknown, crudo: unknown) => {
    estado.llamadas.push(crudo);
    return Promise.resolve(estado.respuesta);
  },
}));

const RUTA = "../../apps/web/app/s/app/(operacion)/compras/exportar/route";
type Ruta = { GET: (p: Request) => Promise<Response> } & Record<string, unknown>;
const cargar = (): Promise<Ruta> => import(/* @vite-ignore */ RUTA);
const pedir = async (consulta = "desde=2026-07-01&hasta=2026-09-30"): Promise<Response> =>
  (await cargar()).GET(new Request(`https://app.test/compras/exportar?${consulta}`));

const ARCHIVO: Respuesta<{ nombre: string; contenido: Uint8Array }> = {
  ok: true,
  dato: { nombre: "compras_2026-07-01_2026-09-30.xlsx", contenido: new Uint8Array([80, 75, 3, 4]) },
};

beforeEach(() => {
  estado.cabeceras = { "sec-fetch-site": "same-origin" };
  estado.llamadas = [];
  estado.respuesta = ARCHIVO;
});

describe("la descarga del archivo de compras", () => {
  it("sale como archivo adjunto de Excel, sin caché, con el nombre que arma el servidor", async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(r.headers.get("Content-Disposition")).toBe(
      'attachment; filename="compras_2026-07-01_2026-09-30.xlsx"',
    );
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Length")).toBe("4");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([80, 75, 3, 4]);
  });

  it("del pedido solo se leen las dos fechas: cualquier otra clave no llega", async () => {
    await pedir("desde=2026-07-01&hasta=2026-09-30&empresaId=otra&sucursalId=x&nombre=../../etc");
    expect(estado.llamadas).toEqual([{ desde: "2026-07-01", hasta: "2026-09-30" }]);
  });

  it("solo GET: la ruta no ofrece ningún otro método", async () => {
    const ruta = await cargar();
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) expect(ruta[metodo]).toBeUndefined();
    expect(ruta["runtime"]).toBe("nodejs");
    expect(ruta["dynamic"]).toBe("force-dynamic");
    expect(ruta["maxDuration"]).toBe(30);
  });

  it("HEAD no exporta ni deja registro: se rechaza con 405 antes de leer nada", async () => {
    const ruta = await cargar();
    const r = (ruta["HEAD"] as () => Response)();
    expect(r.status).toBe(405);
    expect(r.headers.get("Allow")).toBe("GET");
    expect(await r.text()).toBe("");
    expect(estado.llamadas).toEqual([]);
  });

  it("un error sale solo como código (y referencia), con su estado, sin texto del cliente ni detalle", async () => {
    estado.respuesta = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") };
    const r = await pedir("desde=<script>&hasta=2026-09-30");
    expect(r.status).toBe(CODIGOS_PUBLICOS["COMPRAS_ACCION_NO_PERMITIDA"].estadoHttp);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("Content-Disposition")).toBeNull();
    const cuerpo = await r.text();
    expect(JSON.parse(cuerpo)).toEqual({ codigo: "COMPRAS_ACCION_NO_PERMITIDA" });
    expect(cuerpo).not.toContain("script");
  });

  it.each(["cross-site", "same-site", "", "otra-cosa"])(
    "un pedido con Sec-Fetch-Site «%s» se rechaza antes de leer nada",
    async (valor) => {
      estado.cabeceras = { "sec-fetch-site": valor };
      const r = await pedir();
      expect(r.status).not.toBe(200);
      expect(estado.llamadas).toEqual([]);
    },
  );

  it("un pedido sin Sec-Fetch-Site (no viene de un navegador) se rechaza: se falla cerrado", async () => {
    estado.cabeceras = {};
    const r = await pedir();
    expect(r.status).not.toBe(200);
    expect(estado.llamadas).toEqual([]);
  });

  it.each(["same-origin", "none"])(
    "un pedido con Sec-Fetch-Site «%s» (clic en el sitio o dirección tipeada) pasa",
    async (valor) => {
      estado.cabeceras = { "sec-fetch-site": valor };
      expect((await pedir()).status).toBe(200);
      expect(estado.llamadas).toHaveLength(1);
    },
  );
});
