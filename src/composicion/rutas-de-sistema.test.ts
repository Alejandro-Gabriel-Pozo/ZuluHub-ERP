import { describe, expect, it } from "vitest";
import type {
  ProcesadorDeTrabajos,
  ResumenDeProcesamiento,
} from "../adaptadores/trabajos/procesador";
import type { ResumenDelBarrido } from "../puertos/autenticacion";
import {
  LIMITE_DE_TRABAJOS_POR_PASADA,
  atenderCron,
  atenderSalud,
  type DependenciasDelCron,
} from "./rutas-de-sistema";

const SECRETO = "el-secreto-largo-del-cron-de-prueba";
const AHORA = new Date("2026-10-14T06:17:00.000Z");
const AZAR = () => new Uint8Array([0x1a, 0x2b, 0x3c, 0x4d]);
const REFERENCIA = "ZH-1A2B-3C4D";

const RESUMEN: ResumenDeProcesamiento = {
  candidatos: 3,
  hechos: 2,
  reprogramados: 1,
  fallidos: 0,
  noTomados: 0,
  perdidos: 0,
  errores: 0,
};
const BARRIDO: ResumenDelBarrido = { sesiones: 4, verificaciones: 5, limitesDePedidos: 6 };

type Registro = {
  procesar: { ahora: Date; limite: number }[];
  barrer: Date[];
  registrados: string[];
  relojes: number;
};

function armar(
  cambios: Partial<{
    secreto: () => string;
    procesar: () => Promise<ResumenDeProcesamiento>;
    barrer: () => Promise<ResumenDelBarrido>;
    registrar: (d: string) => void;
    ahora: () => Date;
  }> = {},
): { dependencias: DependenciasDelCron; registro: Registro } {
  const registro: Registro = { procesar: [], barrer: [], registrados: [], relojes: 0 };
  const procesador = {
    procesarPendientes: (opciones: { ahora: Date; limite: number }) => {
      registro.procesar.push(opciones);
      return (cambios.procesar ?? (() => Promise.resolve(RESUMEN)))();
    },
  } as unknown as ProcesadorDeTrabajos;
  const dependencias: DependenciasDelCron = {
    secreto: cambios.secreto ?? (() => SECRETO),
    procesador: () => procesador,
    barrido: () => ({
      barrerVencidos: (ahora: Date) => {
        registro.barrer.push(ahora);
        return (cambios.barrer ?? (() => Promise.resolve(BARRIDO)))();
      },
    }),
    ahora:
      cambios.ahora ??
      (() => {
        registro.relojes += 1;
        return AHORA;
      }),
    registrar: cambios.registrar ?? ((d) => registro.registrados.push(d)),
    azar: AZAR,
  };
  return { dependencias, registro };
}

const pedido = (autorizacion?: string) =>
  new Request("https://zuluhub-erp.vercel.app/api/trabajos/cron", {
    headers: autorizacion === undefined ? {} : { authorization: autorizacion },
  });

const SIN_CACHE = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };
const sinCookies = (r: Response) => expect(r.headers.get("set-cookie")).toBeNull();

describe("atenderCron: quién puede pedirlo", () => {
  it.each([
    ["sin cabecera", undefined],
    ["cabecera vacía", ""],
    ["otro secreto", "Bearer otro-secreto-que-no-es-el-del-cron"],
    ["el secreto sin esquema", SECRETO],
    ["otro esquema", `Basic ${SECRETO}`],
    ["el secreto con un carácter de más", `Bearer ${SECRETO}x`],
  ])("%s → 401, sin cuerpo, y no ejecuta NADA", async (_cual, autorizacion) => {
    const { dependencias, registro } = armar();
    const r = await atenderCron(pedido(autorizacion), dependencias);
    expect(r.status).toBe(401);
    expect(await r.text()).toBe("");
    for (const [nombre, valor] of Object.entries(SIN_CACHE))
      expect(r.headers.get(nombre)).toBe(valor);
    sinCookies(r);
    expect(registro.procesar).toEqual([]);
    expect(registro.barrer).toEqual([]);
    expect(registro.relojes).toBe(0);
    expect(registro.registrados).toEqual([]);
  });

  it("con el secreto correcto → 200 y ejecuta las dos tareas", async () => {
    const { dependencias, registro } = armar();
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(r.status).toBe(200);
    expect(registro.procesar).toHaveLength(1);
    expect(registro.barrer).toHaveLength(1);
  });

  it("servidor sin secreto utilizable → 401 igual que a cualquiera (sin oráculo), registra y no ejecuta nada", async () => {
    class ErrorDeEntornoDePrueba extends Error {
      constructor() {
        super("falta CRON_SECRET");
        this.name = "ErrorDeEntorno";
      }
    }
    const { dependencias, registro } = armar({
      secreto: () => {
        throw new ErrorDeEntornoDePrueba();
      },
    });
    for (const autorizacion of [undefined, `Bearer ${SECRETO}`]) {
      const r = await atenderCron(pedido(autorizacion), dependencias);
      expect(r.status).toBe(401);
      expect(await r.text()).toBe("");
    }
    expect(registro.procesar).toEqual([]);
    expect(registro.barrer).toEqual([]);
    expect(registro.registrados).toEqual([
      "[cron] sin secreto utilizable (ErrorDeEntorno)",
      "[cron] sin secreto utilizable (ErrorDeEntorno)",
    ]);
  });

  it("si lo que lanzó el secreto no es un Error, igual 401 y un texto fijo", async () => {
    const { dependencias, registro } = armar({
      secreto: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- justamente se prueba lo que no es un Error
        throw "texto crudo con valor-secreto";
      },
    });
    expect((await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias)).status).toBe(401);
    expect(registro.registrados).toEqual([
      "[cron] sin secreto utilizable (falla que no es un Error)",
    ]);
  });

  it("un registro que falla no cambia la respuesta de un servidor sin secreto", async () => {
    const { dependencias } = armar({
      secreto: () => {
        throw new Error("x");
      },
      registrar: () => {
        throw new Error("el registro se cayó");
      },
    });
    expect((await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias)).status).toBe(401);
  });
});

describe("atenderCron: qué hace", () => {
  it("toma el reloj UNA vez y lo usa en el despacho y en el barrido, con el tope por pasada", async () => {
    const { dependencias, registro } = armar();
    await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(registro.relojes).toBe(1);
    expect(registro.procesar).toEqual([{ ahora: AHORA, limite: LIMITE_DE_TRABAJOS_POR_PASADA }]);
    expect(registro.barrer).toEqual([AHORA]);
    expect(LIMITE_DE_TRABAJOS_POR_PASADA).toBe(50);
  });

  it("responde 200 con JSON, sin caché, noindex y sin cookies, con las cuentas y nada más", async () => {
    const { dependencias } = armar();
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    for (const [nombre, valor] of Object.entries(SIN_CACHE))
      expect(r.headers.get(nombre)).toBe(valor);
    sinCookies(r);
    expect(await r.json()).toEqual({ ok: true, despacho: RESUMEN, barrido: BARRIDO });
  });

  it("si el despacho falla, el barrido corre igual; 500 con referencia y sin detalle en la respuesta", async () => {
    const { dependencias, registro } = armar({
      procesar: () => Promise.reject(new Error("la cola de trabajos falló: Inesperado 57P01")),
    });
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(registro.barrer).toHaveLength(1);
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(JSON.parse(cuerpo)).toEqual({ codigo: "ERROR_INTERNO", referencia: REFERENCIA });
    expect(cuerpo).not.toMatch(/cola|57P01|despacho/);
    expect(registro.registrados).toEqual([
      `${REFERENCIA} [cron] despacho: Error: la cola de trabajos falló: Inesperado 57P01`,
    ]);
    for (const [nombre, valor] of Object.entries(SIN_CACHE))
      expect(r.headers.get(nombre)).toBe(valor);
    expect(r.headers.get("content-type")).toBe("application/json");
    sinCookies(r);
  });

  it("si el barrido falla, el despacho corre igual y se registra el barrido", async () => {
    const { dependencias, registro } = armar({
      barrer: () => Promise.reject(new Error("permission denied for table session")),
    });
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(registro.procesar).toHaveLength(1);
    expect(r.status).toBe(500);
    expect(registro.registrados).toEqual([
      `${REFERENCIA} [cron] barrido: Error: permission denied for table session`,
    ]);
  });

  it("si fallan las dos, se registran las dos juntas y la respuesta sigue sin detalle", async () => {
    const { dependencias, registro } = armar({
      procesar: () => Promise.reject(new Error("a")),
      barrer: () => Promise.reject(new Error("b")),
    });
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(r.status).toBe(500);
    expect(registro.registrados).toEqual([
      `${REFERENCIA} [cron] despacho: Error: a | barrido: Error: b`,
    ]);
    expect(await r.text()).not.toMatch(/despacho|barrido/);
  });

  it("si el procesador ni siquiera se puede armar (entorno), es una falla del despacho y el barrido corre", async () => {
    const { dependencias, registro } = armar();
    const sinProcesador: DependenciasDelCron = {
      ...dependencias,
      procesador: () => {
        throw new Error("el entorno del servidor no está bien configurado");
      },
    };
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), sinProcesador);
    expect(r.status).toBe(500);
    expect(registro.barrer).toHaveLength(1);
    expect(registro.registrados[0]).toContain(
      "[cron] despacho: Error: el entorno del servidor no está bien configurado",
    );
  });

  it("el texto de la falla pasa por el filtro de secretos (enlaces y tiras largas)", async () => {
    const { dependencias, registro } = armar({
      barrer: () =>
        Promise.reject(
          new Error(`falló postgres://u:clave@host/base ${"a".repeat(40)} y ${SECRETO.length}`),
        ),
    });
    await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(registro.registrados[0]).not.toContain("clave@host");
    expect(registro.registrados[0]).not.toContain("a".repeat(40));
    expect(registro.registrados[0]).toContain("[enlace]");
    expect(registro.registrados[0]).toContain("[oculto]");
  });

  it("una falla que no es un Error se registra con un texto fijo", async () => {
    const { dependencias, registro } = armar({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justamente se prueba lo que no es un Error
      barrer: () => Promise.reject("texto crudo con valor"),
    });
    await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(registro.registrados).toEqual([
      `${REFERENCIA} [cron] barrido: excepción que no es un Error`,
    ]);
  });

  it("un registro que falla no cambia la respuesta de una falla", async () => {
    const { dependencias } = armar({
      barrer: () => Promise.reject(new Error("x")),
      registrar: () => {
        throw new Error("el registro se cayó");
      },
    });
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ codigo: "ERROR_INTERNO", referencia: REFERENCIA });
  });

  it("sin azar inyectado la referencia sale con la forma ZH-XXXX-XXXX", async () => {
    const { dependencias } = armar({ barrer: () => Promise.reject(new Error("x")) });
    const { secreto, procesador, barrido, ahora, registrar } = dependencias;
    const sinAzar: DependenciasDelCron = { secreto, procesador, barrido, ahora, registrar };
    const r = await atenderCron(pedido(`Bearer ${SECRETO}`), sinAzar);
    expect(((await r.json()) as { referencia: string }).referencia).toMatch(
      /^ZH-[0-9A-F]{4}-[0-9A-F]{4}$/,
    );
  });

  it("las dos tareas arrancan sin esperarse una a la otra", async () => {
    const orden: string[] = [];
    let terminarDespacho: () => void = () => undefined;
    const { dependencias } = armar({
      procesar: () =>
        new Promise<ResumenDeProcesamiento>((resolver) => {
          orden.push("despacho empezó");
          terminarDespacho = () => resolver(RESUMEN);
        }),
      barrer: () => {
        orden.push("barrido empezó");
        return Promise.resolve(BARRIDO);
      },
    });
    const pendiente = atenderCron(pedido(`Bearer ${SECRETO}`), dependencias);
    await new Promise((resolver) => setTimeout(resolver, 10));
    expect(orden).toEqual(["despacho empezó", "barrido empezó"]);
    terminarDespacho();
    expect((await pendiente).status).toBe(200);
  });
});

describe("atenderSalud", () => {
  it("base que responde → 200 {ok:true}, y nada más", async () => {
    const r = await atenderSalud({ baseResponde: () => Promise.resolve(true) });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"ok":true}');
    expect(r.headers.get("content-type")).toBe("application/json");
    for (const [nombre, valor] of Object.entries(SIN_CACHE))
      expect(r.headers.get(nombre)).toBe(valor);
    sinCookies(r);
  });

  it("base que no responde → 503 {ok:false}, sin detalle", async () => {
    const r = await atenderSalud({ baseResponde: () => Promise.resolve(false) });
    expect(r.status).toBe(503);
    expect(await r.text()).toBe('{"ok":false}');
    for (const [nombre, valor] of Object.entries(SIN_CACHE))
      expect(r.headers.get(nombre)).toBe(valor);
    sinCookies(r);
  });

  it("si la comprobación lanza, falla cerrado: 503 {ok:false} sin ningún detalle del error", async () => {
    const r = await atenderSalud({
      baseResponde: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:5432 clave=zzz")),
    });
    expect(r.status).toBe(503);
    expect(await r.text()).toBe('{"ok":false}');
  });

  it("solo un true estricto es ok (un valor raro no cuenta)", async () => {
    const raro = (valor: unknown) => ({ baseResponde: () => Promise.resolve(valor as boolean) });
    for (const valor of [undefined, null, 1, "true", {}, []]) {
      const r = await atenderSalud(raro(valor));
      expect(r.status).toBe(503);
      expect(await r.text()).toBe('{"ok":false}');
    }
  });
});
