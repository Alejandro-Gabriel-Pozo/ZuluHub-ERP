import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASE_DE_LA_API,
  INTENTOS_DE_LECTURA,
  crearClienteVercel,
  type OpcionesDelCliente,
} from "./cliente-vercel";

const TOKEN = "vcp_TokenDePrueba123";
const PROYECTO = "prj_BZ5e86RcBcfYCAzSW2vVbPpkj7jG";

type Llamada = { url: string; init: RequestInit };
type Respuesta = { estado?: number; cuerpo?: unknown; sinJson?: boolean } | Error;

/** Un `fetch` falso: contesta lo que se le diga, en orden (la última se repite), y anota cada pedido. */
function fetchFalso(...respuestas: Respuesta[]) {
  const llamadas: Llamada[] = [];
  const hacer = (url: string, init?: RequestInit): Promise<Response> => {
    llamadas.push({ url, init: init ?? {} });
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)] as Respuesta;
    if (r instanceof Error) return Promise.reject(r);
    const estado = r.estado ?? 200;
    const cuerpo = r.sinJson === true ? "no es json" : JSON.stringify(r.cuerpo ?? {});
    return Promise.resolve(new Response(cuerpo, { status: estado }));
  };
  return { fetch: hacer as unknown as typeof fetch, llamadas };
}

function cliente(f: ReturnType<typeof fetchFalso>, extra: Partial<OpcionesDelCliente> = {}) {
  const esperas: number[] = [];
  return {
    esperas,
    api: crearClienteVercel({
      token: TOKEN,
      fetch: f.fetch,
      esperar: (ms) => {
        esperas.push(ms);
        return Promise.resolve();
      },
      ...extra,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pedidos exactos", () => {
  it("listar: GET de las variables del proyecto, con el equipo en la consulta y el token solo en el encabezado", async () => {
    const f = fetchFalso({
      cuerpo: { envs: [{ id: "a", key: "A", type: "sensitive", target: ["preview"] }] },
    });
    const { api } = cliente(f);
    const r = await api.listar();
    expect(r).toEqual({
      ok: true,
      valor: [
        {
          id: "a",
          key: "A",
          type: "sensitive",
          target: ["preview"],
          gitBranch: null,
          customEnvironmentIds: [],
        },
      ],
    });
    expect(f.llamadas).toHaveLength(1);
    const { url, init } = f.llamadas[0] as Llamada;
    expect(url).toBe(`${BASE_DE_LA_API}/v10/projects/${PROYECTO}/env?slug=alepozod`);
    expect(BASE_DE_LA_API).toBe("https://api.vercel.com");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(Object.keys(init)).not.toContain("body");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["preview", "production"] as const)(
    "escribir en %s: POST sensible, con upsert, para un solo destino",
    async (destino) => {
      const f = fetchFalso({ cuerpo: { created: {}, failed: [] } });
      const { api } = cliente(f);
      expect(await api.escribir("ZULUHUB_DB_APP", "valor-secreto", destino)).toEqual({
        ok: true,
        valor: null,
      });
      const { url, init } = f.llamadas[0] as Llamada;
      expect(url).toBe(`${BASE_DE_LA_API}/v10/projects/${PROYECTO}/env?upsert=true&slug=alepozod`);
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      });
      expect(JSON.parse(init.body as string)).toEqual({
        key: "ZULUHUB_DB_APP",
        value: "valor-secreto",
        type: "sensitive",
        target: [destino],
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it("borrar: DELETE de esa variable, con el id codificado y sin cuerpo", async () => {
    const f = fetchFalso({});
    const { api } = cliente(f);
    expect(await api.borrar("a/b c")).toEqual({ ok: true, valor: null });
    const { url, init } = f.llamadas[0] as Llamada;
    expect(url).toBe(`${BASE_DE_LA_API}/v9/projects/${PROYECTO}/env/a%2Fb%20c?slug=alepozod`);
    expect(init.method).toBe("DELETE");
    expect(Object.keys(init)).not.toContain("body");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it("quitarDestinos: PATCH con los destinos que se conservan", async () => {
    const f = fetchFalso({});
    const { api } = cliente(f);
    expect(await api.quitarDestinos("abc", ["production"])).toEqual({ ok: true, valor: null });
    const { url, init } = f.llamadas[0] as Llamada;
    expect(url).toBe(`${BASE_DE_LA_API}/v9/projects/${PROYECTO}/env/abc?slug=alepozod`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ target: ["production"] });
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    });
  });

  it("el token no está en la dirección ni en el cuerpo de ningún pedido", async () => {
    const f = fetchFalso({});
    const { api } = cliente(f);
    await api.listar();
    await api.escribir("A", "v", "preview");
    await api.borrar("x");
    await api.quitarDestinos("x", []);
    for (const { url, init } of f.llamadas) {
      expect(url).not.toContain(TOKEN);
      expect(JSON.stringify(init.body ?? "")).not.toContain(TOKEN);
    }
  });

  it("borrar algo que ya no existe (404) es éxito", async () => {
    const f = fetchFalso({ estado: 404, cuerpo: { error: { code: "not_found" } } });
    const { api } = cliente(f);
    expect(await api.borrar("x")).toEqual({ ok: true, valor: null });
  });
});

describe("fallas de Vercel", () => {
  it.each([
    [401, "el token no sirve o no tiene permiso"],
    [403, "el token no sirve o no tiene permiso"],
    [404, "no se encontró el proyecto o la variable"],
    [429, "Vercel pidió esperar"],
    [500, "falla del lado de Vercel"],
    [503, "falla del lado de Vercel"],
    [400, "Vercel rechazó el pedido"],
    [409, "Vercel rechazó el pedido"],
  ])("el estado %i se explica en castellano", async (estado, pista) => {
    const f = fetchFalso({ estado, cuerpo: {} });
    const { api } = cliente(f);
    const r = await api.escribir("A", "v", "preview");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.motivo).toBe(`Vercel respondió ${estado}: ${r.error.motivo.split(": ")[1]}`);
      expect(r.error.motivo).toContain(pista);
    }
  });

  it("solo 429 y 5xx son inciertas; 4xx no", async () => {
    const incierta = async (estado: number) => {
      const { api } = cliente(fetchFalso({ estado }));
      const r = await api.escribir("A", "v", "preview");
      return r.ok ? null : r.error.incierta;
    };
    expect(await incierta(400)).toBe(false);
    expect(await incierta(401)).toBe(false);
    expect(await incierta(404)).toBe(false);
    expect(await incierta(409)).toBe(false);
    expect(await incierta(428)).toBe(false);
    expect(await incierta(429)).toBe(true);
    expect(await incierta(499)).toBe(false);
    expect(await incierta(500)).toBe(true);
    expect(await incierta(502)).toBe(true);
  });

  it("agrega el código y el mensaje de Vercel, sin el token ni el valor que se mandaba", async () => {
    const f = fetchFalso({
      estado: 400,
      cuerpo: {
        error: {
          code: "bad_request",
          message: `valor inválido VALORSECRETO2 con el token ${TOKEN} en https://x.example/ruta`,
        },
      },
    });
    const { api } = cliente(f);
    const r = await api.escribir("A", "VALORSECRETO2", "production");
    expect(r).toEqual({
      ok: false,
      error: {
        motivo:
          "Vercel respondió 400: Vercel rechazó el pedido (bad_request: valor inválido *** con el token *** en [enlace])",
        incierta: false,
      },
    });
  });

  it("una tira larga en el mensaje se oculta aunque no sea el token ni el valor", async () => {
    const f = fetchFalso({
      estado: 400,
      cuerpo: { error: { message: `rastro ${"a".repeat(40)} fin` } },
    });
    const { api } = cliente(f);
    const r = await api.borrar("x");
    expect(r.ok ? "" : r.error.motivo).toBe(
      "Vercel respondió 400: Vercel rechazó el pedido (rastro [oculto] fin)",
    );
  });

  it("un código con caracteres raros o un mensaje que no es texto no se muestran", async () => {
    for (const codigo of ["con espacios", "con espacios!", "a".repeat(65), ""]) {
      const f = fetchFalso({ estado: 400, cuerpo: { error: { code: codigo, message: 5 } } });
      const r = await cliente(f).api.borrar("x");
      expect(r.ok ? "" : r.error.motivo).toBe("Vercel respondió 400: Vercel rechazó el pedido");
    }
    const f = fetchFalso({ estado: 400, cuerpo: { error: { code: 5, message: 5 } } });
    const r = await cliente(f).api.borrar("x");
    expect(r.ok ? "" : r.error.motivo).toBe("Vercel respondió 400: Vercel rechazó el pedido");
  });

  it("un mensaje sin valor que tapar se muestra tal cual (menos el token)", async () => {
    const f = fetchFalso({ estado: 400, cuerpo: { error: { message: "Stryker was here" } } });
    const r = await cliente(f).api.borrar("x");
    expect(r.ok ? "" : r.error.motivo).toBe(
      "Vercel respondió 400: Vercel rechazó el pedido (Stryker was here)",
    );
  });

  it("un código de 64 caracteres todavía se muestra", async () => {
    const codigo = "c".repeat(64);
    const f = fetchFalso({ estado: 400, cuerpo: { error: { code: codigo } } });
    const r = await cliente(f).api.borrar("x");
    expect(r.ok ? "" : r.error.motivo).toContain(`(${codigo})`);
  });

  it("solo el código, sin mensaje, también se muestra", async () => {
    const f = fetchFalso({ estado: 403, cuerpo: { error: { code: "forbidden" } } });
    const { api } = cliente(f);
    const r = await api.borrar("x");
    expect(r.ok ? "" : r.error.motivo).toContain("(forbidden)");
  });

  it("una respuesta que no es JSON se maneja por el estado", async () => {
    const { api } = cliente(fetchFalso({ estado: 502, sinJson: true }));
    const r = await api.borrar("x");
    expect(r.ok ? "" : r.error.motivo).toBe("Vercel respondió 502: falla del lado de Vercel");
  });

  it("una creación que informa `failed` es una falla aunque el estado sea 200", async () => {
    const f = fetchFalso({
      cuerpo: { created: [], failed: [{ error: { code: "ENV_CONFLICT", message: "x" } }] },
    });
    const { api } = cliente(f);
    expect(await api.escribir("A", "v", "preview")).toEqual({
      ok: false,
      error: { motivo: "Vercel no aplicó el cambio (ENV_CONFLICT)", incierta: false },
    });
  });

  it("`failed` sin código reconocible: se dice igual, sin código", async () => {
    const f = fetchFalso({ cuerpo: { failed: [{ error: { code: "no valido!" } }] } });
    const { api } = cliente(f);
    expect(await api.escribir("A", "v", "preview")).toEqual({
      ok: false,
      error: { motivo: "Vercel no aplicó el cambio", incierta: false },
    });
    for (const failed of [[null], [{}], [{ error: {} }], [{ error: { code: 5 } }]]) {
      const g = fetchFalso({ cuerpo: { failed } });
      expect(await cliente(g).api.escribir("A", "v", "preview")).toEqual({
        ok: false,
        error: { motivo: "Vercel no aplicó el cambio", incierta: false },
      });
    }
  });

  it("una lista de fallas vacía o que no es lista no cuenta como falla", async () => {
    expect(
      (await cliente(fetchFalso({ cuerpo: { failed: [] } })).api.escribir("A", "v", "preview")).ok,
    ).toBe(true);
    expect(
      (await cliente(fetchFalso({ cuerpo: { failed: "no" } })).api.escribir("A", "v", "preview"))
        .ok,
    ).toBe(true);
    expect((await cliente(fetchFalso({ cuerpo: null })).api.escribir("A", "v", "preview")).ok).toBe(
      true,
    );
  });

  it("listar con un rechazo devuelve el motivo de Vercel, no una queja sobre la forma", async () => {
    const { api } = cliente(fetchFalso({ estado: 403 }));
    expect(await api.listar()).toEqual({
      ok: false,
      error: {
        motivo:
          "Vercel respondió 403: el token no sirve o no tiene permiso sobre el equipo y el proyecto",
        incierta: false,
      },
    });
  });

  it("una lista con una forma que no se entiende es una falla, no «no hay variables»", async () => {
    const { api } = cliente(fetchFalso({ cuerpo: { otra: 1 } }));
    expect(await api.listar()).toEqual({
      ok: false,
      error: {
        motivo: "Vercel contestó la lista de variables con una forma que no se entiende",
        incierta: false,
      },
    });
  });
});

describe("red y tiempo límite", () => {
  it("una falla de red no repite el texto original (podría traer el token) y es incierta", async () => {
    const f = fetchFalso(new Error(`fetch failed: Authorization: Bearer ${TOKEN}`));
    const { api } = cliente(f);
    const r = await api.escribir("A", "v", "preview");
    expect(r).toEqual({
      ok: false,
      error: { motivo: "no se pudo hablar con Vercel (falla de red)", incierta: true },
    });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(f.llamadas).toHaveLength(1);
  });

  it("un pedido que no termina se corta a los pocos milisegundos del plazo y se dice que no contestó", async () => {
    const colgado = ((_url: string, init: RequestInit) =>
      new Promise((_resolver, rechazar) => {
        init.signal?.addEventListener("abort", () =>
          rechazar(new DOMException("tiempo", "TimeoutError")),
        );
      })) as unknown as typeof fetch;
    const api = crearClienteVercel({ token: TOKEN, fetch: colgado, plazoEnMs: 30 });
    const r = await api.escribir("A", "v", "preview");
    expect(r).toEqual({
      ok: false,
      error: { motivo: "Vercel no contestó a tiempo", incierta: true },
    });
  });

  it("sin plazo propio usa el de por defecto y funciona", async () => {
    const f = fetchFalso({ cuerpo: { envs: [] } });
    const api = crearClienteVercel({ token: TOKEN, fetch: f.fetch });
    expect(await api.listar()).toEqual({ ok: true, valor: [] });
  });
});

describe("reintentos", () => {
  it("una lectura que falla por algo pasajero se repite con espera creciente hasta que sale bien", async () => {
    const f = fetchFalso({ estado: 503 }, new Error("red"), { cuerpo: { envs: [] } });
    const { api, esperas } = cliente(f);
    expect(await api.listar()).toEqual({ ok: true, valor: [] });
    expect(f.llamadas).toHaveLength(3);
    expect(esperas).toEqual([500, 1000]);
  });

  it("si todas las lecturas fallan, devuelve la última falla tras INTENTOS_DE_LECTURA pedidos", async () => {
    const f = fetchFalso({ estado: 429 });
    const { api, esperas } = cliente(f);
    const r = await api.listar();
    expect(r.ok).toBe(false);
    expect(INTENTOS_DE_LECTURA).toBe(3);
    expect(f.llamadas).toHaveLength(INTENTOS_DE_LECTURA);
    expect(esperas).toEqual([500, 1000]);
  });

  it("una lectura rechazada (403) no se repite", async () => {
    const f = fetchFalso({ estado: 403 });
    const { api, esperas } = cliente(f);
    await api.listar();
    expect(f.llamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
  });

  it.each([
    ["500", { estado: 500 }],
    ["una falla de red", new Error("red")],
    ["429", { estado: 429 }],
  ] as [string, Respuesta][])(
    "una escritura con %s NO se reintenta sola",
    async (_n, respuesta) => {
      const f = fetchFalso(respuesta, { cuerpo: {} });
      const { api, esperas } = cliente(f);
      const r = await api.escribir("A", "v", "preview");
      expect(r.ok).toBe(false);
      expect(f.llamadas).toHaveLength(1);
      expect(esperas).toEqual([]);
      const b = await cliente(fetchFalso(respuesta, { cuerpo: {} })).api.borrar("x");
      expect(b.ok).toBe(false);
    },
  );

  it("sin espera inyectada espera de verdad (500 ms, luego 1000 ms)", async () => {
    vi.useFakeTimers();
    const f = fetchFalso({ estado: 500 }, { estado: 500 }, { cuerpo: { envs: [] } });
    const api = crearClienteVercel({ token: TOKEN, fetch: f.fetch });
    const promesa = api.listar();
    await vi.advanceTimersByTimeAsync(499);
    expect(f.llamadas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.llamadas).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.llamadas).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promesa).toEqual({ ok: true, valor: [] });
    expect(f.llamadas).toHaveLength(3);
  });
});
