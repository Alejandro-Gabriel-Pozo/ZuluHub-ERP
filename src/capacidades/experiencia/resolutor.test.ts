import { describe, expect, it } from "vitest";
import { err, ok } from "../../primitivas/resultado/resultado";
import type { MarcaPublica, SuperficieServible } from "./puerta";
import {
  TAMANO_DE_LA_CACHE,
  VIDA_MAXIMA_DE_LA_CACHE_EN_MS,
  crearResolutorDePuerta,
  type ConsultaDeHost,
  type LecturaDeMarca,
} from "./resolutor";

const marca = (nombre: string): MarcaPublica => ({ nombre, tema: {}, hostDeApp: null });
const MARCAS: Record<string, MarcaPublica> = { mA: marca("Marca A"), mB: marca("Marca B") };
const HOSTS: Record<string, [SuperficieServible, string]> = {
  "app.a.test": ["APP", "mA"],
  "a.test": ["LANDING", "mA"],
  "carta.a.test": ["CARTA", "mA"],
  "app.b.test": ["APP", "mB"],
  "sinmarca.test": ["APP", "mX"],
};

function armar(opciones: { vidaEnMs?: number; tamano?: number } = {}) {
  const reloj = { ms: 1_000 };
  const consultas: string[] = [];
  const lecturas: string[] = [];
  const control = { falla: null as null | "err" | "lanza", marcaFalla: false };
  const consultarHost: ConsultaDeHost = (host, superficie) => {
    consultas.push(`${host}|${superficie}`);
    if (control.falla === "lanza") return Promise.reject(new Error("boom"));
    if (control.falla === "err") return Promise.resolve(err({ tipo: "Inesperado" }));
    const fila = HOSTS[host];
    return Promise.resolve(
      ok(fila !== undefined && fila[0] === superficie ? { marcaId: fila[1] } : null),
    );
  };
  const leerMarca: LecturaDeMarca = (id) => {
    lecturas.push(id);
    if (control.marcaFalla) return Promise.reject(new Error("boom"));
    return Promise.resolve(MARCAS[id] ?? null);
  };
  const resolver = crearResolutorDePuerta({
    consultarHost,
    leerMarca,
    normalizarHost: (crudo) => {
      const h = crudo.toLowerCase().replace(/:\d+$/, "");
      return /^[a-z0-9.-]+$/.test(h) && h !== "" ? h : null;
    },
    ahora: () => reloj.ms,
    ...opciones,
  });
  return { resolver, reloj, consultas, lecturas, control };
}

describe("crearResolutorDePuerta: resolución", () => {
  it("cada host da su superficie y su marca", async () => {
    const { resolver } = armar();
    for (const [host, superficie, id] of [
      ["app.a.test", "APP", "mA"],
      ["a.test", "LANDING", "mA"],
      ["carta.a.test", "CARTA", "mA"],
      ["app.b.test", "APP", "mB"],
    ] as const) {
      const r = await resolver(host);
      expect(r).toEqual({
        tipo: "RESUELTA",
        puerta: { host, superficie, marcaId: id, marca: MARCAS[id] },
      });
    }
  });

  it("normaliza antes de resolver: mayúsculas y puerto dan el mismo host", async () => {
    const { resolver } = armar();
    const r = await resolver("APP.A.TEST:443");
    expect(r.tipo === "RESUELTA" && r.puerta.host).toBe("app.a.test");
  });

  it("un host desconocido es DESCONOCIDO y se preguntó por las tres superficies, en orden", async () => {
    const { resolver, consultas, lecturas } = armar();
    expect(await resolver("otro.test")).toEqual({ tipo: "DESCONOCIDO" });
    expect(consultas).toEqual(["otro.test|APP", "otro.test|LANDING", "otro.test|CARTA"]);
    expect(lecturas).toEqual([]);
  });

  it("corta en la primera superficie que lo sirve", async () => {
    const { resolver, consultas } = armar();
    await resolver("a.test");
    expect(consultas).toEqual(["a.test|APP", "a.test|LANDING"]);
  });

  it("un host cuya marca no se puede leer es DESCONOCIDO (sin versión que servir)", async () => {
    const { resolver } = armar();
    expect(await resolver("sinmarca.test")).toEqual({ tipo: "DESCONOCIDO" });
  });

  it("un host inválido es DESCONOCIDO sin consultar nada", async () => {
    const { resolver, consultas } = armar();
    for (const h of ["", "a b", "a_b.test", "[::1]"]) {
      expect(await resolver(h)).toEqual({ tipo: "DESCONOCIDO" });
    }
    expect(consultas).toEqual([]);
  });
});

describe("crearResolutorDePuerta: fallos", () => {
  it("un error devuelto por la base es NO_DISPONIBLE, no desconocido", async () => {
    const { resolver, control } = armar();
    control.falla = "err";
    expect(await resolver("app.a.test")).toEqual({ tipo: "NO_DISPONIBLE" });
  });

  it("una excepción de la consulta o de la lectura es NO_DISPONIBLE", async () => {
    const { resolver, control } = armar();
    control.falla = "lanza";
    expect(await resolver("app.a.test")).toEqual({ tipo: "NO_DISPONIBLE" });
    control.falla = null;
    control.marcaFalla = true;
    expect(await resolver("app.a.test")).toEqual({ tipo: "NO_DISPONIBLE" });
  });

  it("un fallo no se guarda: al volver la base, resuelve", async () => {
    const { resolver, control } = armar();
    control.falla = "err";
    expect((await resolver("app.a.test")).tipo).toBe("NO_DISPONIBLE");
    control.falla = null;
    expect((await resolver("app.a.test")).tipo).toBe("RESUELTA");
  });

  it("un fallo en medio de las superficies no sigue de largo a «desconocido»", async () => {
    const { resolver, control } = armar();
    control.falla = "err";
    expect(await resolver("carta.a.test")).toEqual({ tipo: "NO_DISPONIBLE" });
  });
});

describe("crearResolutorDePuerta: caché", () => {
  it("las constantes", () => {
    expect(VIDA_MAXIMA_DE_LA_CACHE_EN_MS).toBe(60_000);
    expect(TAMANO_DE_LA_CACHE).toBe(500);
  });

  it("repetir un host dentro de la vida no consulta de nuevo", async () => {
    const { resolver, consultas, lecturas, reloj } = armar();
    const primero = await resolver("app.a.test");
    reloj.ms += 59_999;
    expect(await resolver("app.a.test")).toBe(primero);
    expect(consultas).toEqual(["app.a.test|APP"]);
    expect(lecturas).toEqual(["mA"]);
  });

  it("a los 60 s justos vuelve a consultar (un dominio retirado deja de servirse)", async () => {
    const { resolver, consultas, reloj } = armar();
    await resolver("app.a.test");
    reloj.ms += 60_000;
    await resolver("app.a.test");
    expect(consultas).toEqual(["app.a.test|APP", "app.a.test|APP"]);
  });

  it("la vida pedida se respeta si es menor, y nunca pasa de 60 s", async () => {
    const corta = armar({ vidaEnMs: 1_000 });
    await corta.resolver("app.a.test");
    corta.reloj.ms += 1_000;
    await corta.resolver("app.a.test");
    expect(corta.consultas).toHaveLength(2);

    const larga = armar({ vidaEnMs: 3_600_000 });
    await larga.resolver("app.a.test");
    larga.reloj.ms += 60_000;
    await larga.resolver("app.a.test");
    expect(larga.consultas).toHaveLength(2);
  });

  it("también se guarda el «desconocido»", async () => {
    const { resolver, consultas } = armar();
    await resolver("otro.test");
    await resolver("otro.test");
    expect(consultas).toHaveLength(3);
  });

  it("no se mezcla nada entre hosts: cada uno conserva su marca, aunque estén en caché", async () => {
    const { resolver } = armar();
    const a1 = await resolver("app.a.test");
    const b1 = await resolver("app.b.test");
    const a2 = await resolver("app.a.test");
    const b2 = await resolver("app.b.test");
    const ids = [a1, b1, a2, b2].map((r) => (r.tipo === "RESUELTA" ? r.puerta.marcaId : null));
    expect(ids).toEqual(["mA", "mB", "mA", "mB"]);
    expect(await resolver("otro.test")).toEqual({ tipo: "DESCONOCIDO" });
  });

  it("los mayúsculas y el puerto comparten entrada de caché", async () => {
    const { resolver, consultas } = armar();
    await resolver("app.a.test");
    await resolver("APP.A.TEST:8443");
    expect(consultas).toEqual(["app.a.test|APP"]);
  });

  it("tamaño acotado: al llenarse sale el más viejo", async () => {
    const { resolver, consultas } = armar({ tamano: 2 });
    await resolver("app.a.test");
    await resolver("app.b.test");
    await resolver("a.test");
    const antes = consultas.length;
    await resolver("app.b.test");
    await resolver("a.test");
    expect(consultas).toHaveLength(antes);
    await resolver("app.a.test");
    expect(consultas.length).toBeGreaterThan(antes);
  });

  it("refrescar una entrada vencida no agranda la caché ni expulsa de más", async () => {
    const { resolver, consultas, reloj } = armar({ tamano: 2 });
    await resolver("app.a.test");
    await resolver("app.b.test");
    reloj.ms += 60_000;
    await resolver("app.a.test");
    const antes = consultas.length;
    await resolver("app.a.test");
    expect(consultas).toHaveLength(antes);
    // `app.b.test` venció: se vuelve a consultar, y con ello `app.a.test` (refrescado) sigue vigente.
    await resolver("app.b.test");
    expect(consultas.length).toBeGreaterThan(antes);
  });

  it("un tamaño de 1 guarda solo el último", async () => {
    const { resolver, consultas } = armar({ tamano: 1 });
    await resolver("app.a.test");
    await resolver("app.b.test");
    await resolver("app.b.test");
    expect(consultas).toEqual(["app.a.test|APP", "app.b.test|APP"]);
    await resolver("app.a.test");
    expect(consultas).toHaveLength(3);
  });
});
