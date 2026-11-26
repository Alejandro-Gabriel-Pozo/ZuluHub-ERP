import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODIGOS_PUBLICOS,
  errorDeCodigo,
  type Respuesta,
} from "../../src/capacidades/experiencia/respuesta";

/**
 * La descarga del archivo de la cuenta corriente (`/caja/cuenta-corriente/exportar`): solo GET, sin caché, nombre de archivo que arma el servidor, error genérico sin detalle, y un pedido que
 * no sale de esta misma aplicación (`Sec-Fetch-Site`) no llega ni a la lectura. Previene: un archivo cacheado con importes y CUIT de clientes, un nombre armado con lo que escribió el cliente y
 * registros de auditoría sembrados desde otro sitio. Los permisos, el aislamiento y el contenido se prueban con la base real en `test/integracion/cuenta-corriente-exportacion-web.test.ts`.
 */
vi.mock("server-only", () => ({}));
const estado = vi.hoisted(
  (): { cabeceras: Record<string, string>; llamadas: number; respuesta: unknown } => ({
    cabeceras: {},
    llamadas: 0,
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
vi.mock("../../src/composicion/cuenta-corriente-exportacion-web", () => ({
  exportarLaCuentaCorriente: () => {
    estado.llamadas += 1;
    return Promise.resolve(estado.respuesta);
  },
}));

const RUTA = "../../apps/web/app/s/app/(operacion)/caja/cuenta-corriente/exportar/route";
type Ruta = { GET: () => Promise<Response> } & Record<string, unknown>;
const cargar = (): Promise<Ruta> => import(/* @vite-ignore */ RUTA);
const pedir = async (): Promise<Response> => (await cargar()).GET();

const ARCHIVO: Respuesta<{ nombre: string; contenido: Uint8Array }> = {
  ok: true,
  dato: { nombre: "cuenta_corriente_2026-11-26.xlsx", contenido: new Uint8Array([80, 75, 3, 4]) },
};

beforeEach(() => {
  estado.cabeceras = { "sec-fetch-site": "same-origin" };
  estado.llamadas = 0;
  estado.respuesta = ARCHIVO;
});

describe("la descarga del archivo de la cuenta corriente", () => {
  it("sale como archivo adjunto de Excel, sin caché, con el nombre que arma el servidor", async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(r.headers.get("Content-Disposition")).toBe(
      'attachment; filename="cuenta_corriente_2026-11-26.xlsx"',
    );
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Length")).toBe("4");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([80, 75, 3, 4]);
  });

  it("solo GET: la ruta no ofrece ningún otro método y declara su ejecución", async () => {
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
    expect(estado.llamadas).toBe(0);
  });

  it("un error sale solo como código (y referencia), con su estado, sin texto ni detalle", async () => {
    estado.respuesta = { ok: false, error: errorDeCodigo("CLIENTES_ACCION_NO_PERMITIDA") };
    const r = await pedir();
    expect(r.status).toBe(CODIGOS_PUBLICOS["CLIENTES_ACCION_NO_PERMITIDA"].estadoHttp);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("Content-Disposition")).toBeNull();
    expect(JSON.parse(await r.text())).toEqual({ codigo: "CLIENTES_ACCION_NO_PERMITIDA" });
  });

  it("un error con referencia la lleva y nada más", async () => {
    estado.respuesta = {
      ok: false,
      error: { ...errorDeCodigo("CLIENTES_ACCION_NO_PERMITIDA"), referencia: "PD-ABCD1234" },
    };
    const cuerpo = JSON.parse(await (await pedir()).text()) as Record<string, unknown>;
    expect(cuerpo).toEqual({ codigo: "CLIENTES_ACCION_NO_PERMITIDA", referencia: "PD-ABCD1234" });
  });

  it.each(["cross-site", "same-site", "", "otra-cosa"])(
    "un pedido con Sec-Fetch-Site «%s» se rechaza antes de leer nada",
    async (valor) => {
      estado.cabeceras = { "sec-fetch-site": valor };
      const r = await pedir();
      expect(r.status).not.toBe(200);
      expect(estado.llamadas).toBe(0);
    },
  );

  it("un pedido sin Sec-Fetch-Site (no viene de un navegador) se rechaza: se falla cerrado", async () => {
    estado.cabeceras = {};
    const r = await pedir();
    expect(r.status).not.toBe(200);
    expect(estado.llamadas).toBe(0);
  });

  it.each(["same-origin", "none"])(
    "un pedido con Sec-Fetch-Site «%s» (clic en el sitio o dirección tipeada) pasa",
    async (valor) => {
      estado.cabeceras = { "sec-fetch-site": valor };
      expect((await pedir()).status).toBe(200);
      expect(estado.llamadas).toBe(1);
    },
  );
});
