import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ResumenDeProcesamiento } from "../../src/adaptadores/trabajos/procesador";
import type { ResumenDelBarrido } from "../../src/puertos/autenticacion";

/**
 * W6: las dos rutas de `apps/web/app/api` son delgadas; esta prueba verifica el cableado real
 * (`servidor/rutas-de-sistema.ts`) contra una composición falsa: quién autoriza, qué se llama y con qué. La
 * lógica de cada ruta tiene sus pruebas en `src/composicion/rutas-de-sistema.test.ts`, y la prueba con base
 * real está en `test/integracion/rutas-de-sistema.test.ts`.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(() => {
  const secreto: { valor: string | Error } = { valor: "secreto-del-cron-de-prueba-0123456789" };
  return {
    secreto,
    procesar: undefined as unknown as Mock<
      (opciones: { ahora: Date; limite: number }) => Promise<ResumenDeProcesamiento>
    >,
    barrer: undefined as unknown as Mock<(ahora: Date) => Promise<ResumenDelBarrido>>,
    baseResponde: undefined as unknown as Mock<() => Promise<boolean>>,
  };
});
vi.mock("../../apps/web/servidor/composicion", () => {
  mundo.procesar = vi.fn(() =>
    Promise.resolve({
      candidatos: 0,
      hechos: 0,
      reprogramados: 0,
      fallidos: 0,
      noTomados: 0,
      perdidos: 0,
      errores: 0,
    }),
  );
  mundo.barrer = vi.fn(() =>
    Promise.resolve({ sesiones: 0, verificaciones: 0, limitesDePedidos: 0 }),
  );
  mundo.baseResponde = vi.fn(() => Promise.resolve(true));
  return {
    sistema: {
      secretoDeCron: () => {
        if (mundo.secreto.valor instanceof Error) throw mundo.secreto.valor;
        return mundo.secreto.valor;
      },
      baseResponde: () => mundo.baseResponde,
    },
    trabajos: { procesador: () => ({ procesarPendientes: mundo.procesar }) },
    web: { barridoDeAutenticacion: () => ({ barrerVencidos: mundo.barrer }) },
  };
});

import * as rutaDelCron from "../../apps/web/app/api/trabajos/cron/route";
import * as rutaDeLaSalud from "../../apps/web/app/api/salud/route";

const SECRETO = "secreto-del-cron-de-prueba-0123456789";
const pedido = (url: string, autorizacion?: string) =>
  new Request(url, autorizacion === undefined ? {} : { headers: { authorization: autorizacion } });

beforeEach(() => {
  mundo.secreto.valor = SECRETO;
  mundo.procesar.mockClear();
  mundo.barrer.mockClear();
  mundo.baseResponde.mockClear();
  mundo.baseResponde.mockImplementation(() => Promise.resolve(true));
});

describe("app/api/trabajos/cron", () => {
  const URL_DEL_CRON = "https://zuluhub-erp.vercel.app/api/trabajos/cron";

  it("expone solo GET, en Node, sin generarse al compilar, con tope de duración", () => {
    expect(Object.keys(rutaDelCron).sort()).toEqual(["GET", "dynamic", "maxDuration", "runtime"]);
    expect(rutaDelCron.runtime).toBe("nodejs");
    expect(rutaDelCron.dynamic).toBe("force-dynamic");
    expect(rutaDelCron.maxDuration).toBe(60);
  });

  it("sin el secreto: 401 sin cuerpo y no toca la cola ni el barrido", async () => {
    for (const autorizacion of [undefined, "Bearer otro-secreto-que-no-es-el-del-cron", SECRETO]) {
      const r = await rutaDelCron.GET(pedido(URL_DEL_CRON, autorizacion));
      expect(r.status).toBe(401);
      expect(await r.text()).toBe("");
    }
    expect(mundo.procesar).not.toHaveBeenCalled();
    expect(mundo.barrer).not.toHaveBeenCalled();
  });

  it("con el secreto: despacha la cola y barre, con el mismo `ahora`", async () => {
    const r = await rutaDelCron.GET(pedido(URL_DEL_CRON, `Bearer ${SECRETO}`));
    expect(r.status).toBe(200);
    expect(mundo.procesar).toHaveBeenCalledTimes(1);
    expect(mundo.barrer).toHaveBeenCalledTimes(1);
    const { ahora, limite } = mundo.procesar.mock.calls[0]?.[0] as { ahora: Date; limite: number };
    expect(mundo.barrer.mock.calls[0]?.[0]).toBe(ahora);
    expect(limite).toBe(50);
  });

  it("sin CRON_SECRET en el servidor: 401 igual, y no ejecuta nada ni con el 'secreto' vacío", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mundo.secreto.valor = new Error("sin secreto");
    for (const autorizacion of [undefined, "Bearer ", `Bearer ${SECRETO}`]) {
      expect((await rutaDelCron.GET(pedido(URL_DEL_CRON, autorizacion))).status).toBe(401);
    }
    expect(mundo.procesar).not.toHaveBeenCalled();
    expect(mundo.barrer).not.toHaveBeenCalled();
  });

  it("una falla de la tarea sale como 500 con referencia y se registra en el servidor", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mundo.barrer.mockImplementationOnce(() => Promise.reject(new Error("permission denied")));
    const r = await rutaDelCron.GET(pedido(URL_DEL_CRON, `Bearer ${SECRETO}`));
    expect(r.status).toBe(500);
    const { referencia } = (await r.json()) as { referencia: string };
    expect(referencia).toMatch(/^ZH-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(String(registro.mock.calls[0]?.[0])).toContain(`${referencia} [cron] barrido: Error`);
  });
});

describe("app/api/salud", () => {
  it("expone solo GET, en Node y sin generarse al compilar", () => {
    expect(Object.keys(rutaDeLaSalud).sort()).toEqual(["GET", "dynamic", "runtime"]);
    expect(rutaDeLaSalud.runtime).toBe("nodejs");
    expect(rutaDeLaSalud.dynamic).toBe("force-dynamic");
  });

  it("base que responde: 200 {ok:true}", async () => {
    const r = await rutaDeLaSalud.GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("base que no responde: 503 {ok:false}, sin ningún otro dato", async () => {
    mundo.baseResponde.mockImplementation(() => Promise.resolve(false));
    const r = await rutaDeLaSalud.GET();
    expect(r.status).toBe(503);
    expect(await r.text()).toBe('{"ok":false}');
  });
});
