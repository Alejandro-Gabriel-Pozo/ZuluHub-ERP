import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../adaptadores/postgres/errores";
import { err, ok } from "../primitivas/resultado/resultado";
import { marcaComercialId } from "../primitivas/identificadores/marca";
import type { Autenticacion } from "../puertos/autenticacion";
import type { HostResuelto, ResolucionDeHost, SuperficieDeHost } from "../puertos/marcas";
import { ErrorDeEntorno } from "./entorno";
import {
  atenderRutaDeIngreso,
  respuestaNeutra,
  type DependenciasDeLaRuta,
} from "./ruta-de-ingreso";

/**
 * G8 y ADR-016 sobre la costura de la ruta `/api/auth/*`, con la resolución y la autenticación falsas: acá se prueba la
 * DECISIÓN (qué host se sirve, qué sale en un fallo). Con la base y la librería reales la prueba está en
 * `test/integracion/autenticacion-ruta.test.ts`.
 */

const MARCA = marcaComercialId("11111111-1111-4111-8111-111111111111");
const resuelto = (host: string): HostResuelto => ({
  host,
  superficie: "APP",
  duenio: { tipo: "MARCA", marcaId: MARCA },
  marcaId: MARCA,
});

type Llamada = { host: string; superficie: SuperficieDeHost };

function armar(opciones: {
  resolucion?: (host: string) => ReturnType<ResolucionDeHost["porHost"]>;
  manejar?: (pedido: Request, host: string) => Promise<Response>;
}) {
  const llamadas: Llamada[] = [];
  const atendidos: { host: string; url: string }[] = [];
  const registros: string[] = [];
  const dependencias: DependenciasDeLaRuta = {
    resolucionDeHost: () => ({
      porHost: (host, superficie) => {
        llamadas.push({ host, superficie });
        return (opciones.resolucion ?? (() => Promise.resolve(ok(null))))(host);
      },
    }),
    autenticacion: (): Autenticacion => ({
      sesionDe: () => Promise.resolve(null),
      manejar: (pedido, host) => {
        atendidos.push({ host, url: pedido.url });
        return (opciones.manejar ?? (() => Promise.resolve(new Response("atendido"))))(
          pedido,
          host,
        );
      },
    }),
    registrar: (d) => registros.push(d),
    azar: () => new Uint8Array([0xab, 0xcd, 0x01, 0x23]),
  };
  return { dependencias, llamadas, atendidos, registros };
}

const pedido = (host: string | null, ruta = "/api/auth/get-session") =>
  new Request(`https://interno.test${ruta}`, {
    headers: host === null ? {} : { host, "x-forwarded-host": "ajeno.test" },
  });

describe("respuestaNeutra", () => {
  it("es un 404 sin cuerpo, sin cookies y que nunca se indexa ni se guarda", async () => {
    const r = respuestaNeutra();
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect([...r.headers.keys()].sort()).toEqual(["cache-control", "x-robots-tag"]);
  });
});

describe("atenderRutaDeIngreso: G8, solo en hosts de aplicación", () => {
  it("resuelve el host del pedido para la superficie APP (y solo esa), con la cabecera host y no X-Forwarded-Host", async () => {
    const { dependencias, llamadas } = armar({});
    await atenderRutaDeIngreso(pedido("App.Marca-A.test:443"), dependencias);
    expect(llamadas).toEqual([{ host: "App.Marca-A.test:443", superficie: "APP" }]);
  });

  it("sin cabecera host resuelve el texto vacío (que la resolución trata como desconocido)", async () => {
    const { dependencias, llamadas } = armar({});
    await atenderRutaDeIngreso(pedido(null), dependencias);
    expect(llamadas).toEqual([{ host: "", superficie: "APP" }]);
  });

  it("host de aplicación: atiende la autenticación de ESE host, normalizado como lo resolvió la puerta", async () => {
    const respuesta = new Response("listo", { status: 201 });
    const { dependencias, atendidos } = armar({
      resolucion: () => Promise.resolve(ok(resuelto("app.marca-a.test"))),
      manejar: () => Promise.resolve(respuesta),
    });
    const r = await atenderRutaDeIngreso(pedido("APP.marca-a.test:443"), dependencias);
    expect(r).toBe(respuesta);
    expect(atendidos).toEqual([
      { host: "app.marca-a.test", url: "https://interno.test/api/auth/get-session" },
    ]);
  });

  it("host que no se sirve (null): 404 neutro y la autenticación ni se arma", async () => {
    let armada = false;
    const base = armar({ resolucion: () => Promise.resolve(ok(null)) });
    const dependencias: DependenciasDeLaRuta = {
      ...base.dependencias,
      autenticacion: () => {
        armada = true;
        return base.dependencias.autenticacion();
      },
    };
    const r = await atenderRutaDeIngreso(pedido("landing.marca-a.test"), dependencias);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(armada).toBe(false);
    expect(base.atendidos).toEqual([]);
  });
});

describe("atenderRutaDeIngreso: ningún fallo sale con detalle (ADR-016)", () => {
  it("si la base no responde al resolver el host: 503 con referencia, no el 404 neutro", async () => {
    const { dependencias, registros } = armar({
      resolucion: () =>
        Promise.resolve(
          err({
            tipo: "Inesperado",
            sqlstate: "08006",
            mensaje: "password failed for zuluhub_publico",
          }),
        ),
    });
    const r = await atenderRutaDeIngreso(pedido("app.marca-a.test"), dependencias);
    expect(r.status).toBe(503);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect(r.headers.getSetCookie()).toEqual([]);
    const cuerpo = await r.text();
    expect(JSON.parse(cuerpo)).toEqual({ codigo: "NO_DISPONIBLE", referencia: "ZH-ABCD-0123" });
    expect(cuerpo).not.toMatch(/password|zuluhub_publico|08006/);
    // Al registro va la referencia y el tipo del fallo (con eso se encuentra), no el mensaje de la base.
    expect(registros).toEqual(["ZH-ABCD-0123 no se pudo resolver el host: Inesperado"]);
  });

  it("si la autenticación lanza: 500 con referencia, y el detalle solo al registro", async () => {
    const { dependencias, registros } = armar({
      resolucion: () => Promise.resolve(ok(resuelto("app.marca-a.test"))),
      manejar: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432")),
    });
    const r = await atenderRutaDeIngreso(pedido("app.marca-a.test"), dependencias);
    expect(r.status).toBe(500);
    expect(r.headers.get("content-type")).toBe("application/json");
    const cuerpo = await r.text();
    expect(JSON.parse(cuerpo)).toEqual({ codigo: "ERROR_INTERNO", referencia: "ZH-ABCD-0123" });
    expect(cuerpo).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(registros).toEqual(["ZH-ABCD-0123 Error: connect ECONNREFUSED 10.0.0.5:5432"]);
  });

  it("un fallo de entorno (falta una variable) sale igual, y el nombre de la variable no pasa por acá", async () => {
    const { dependencias, registros } = armar({
      resolucion: () => Promise.resolve(ok(resuelto("app.marca-a.test"))),
      manejar: () =>
        Promise.reject(new ErrorDeEntorno("pieza autenticacion: GOOGLE_CLIENT_ID falta")),
    });
    const r = await atenderRutaDeIngreso(pedido("app.marca-a.test"), dependencias);
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(cuerpo).not.toMatch(/GOOGLE|autenticacion|pieza/);
    expect(registros).toEqual(["ZH-ABCD-0123 el entorno no está bien configurado"]);
  });

  it("un error de configuración del adaptador no es un fallo de entorno de la composición: igual sin detalle", async () => {
    const { dependencias, registros } = armar({
      resolucion: () => Promise.resolve(ok(resuelto("app.marca-a.test"))),
      manejar: () => Promise.reject(new ErrorDeConfiguracion("el host de ingreso no es válido")),
    });
    const r = await atenderRutaDeIngreso(pedido("app.marca-a.test"), dependencias);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toMatch(/host de ingreso/);
    expect(registros).toEqual([
      "ZH-ABCD-0123 ErrorDeConfiguracion: el host de ingreso no es válido",
    ]);
  });

  it("algo que se lanzó sin ser un Error también se registra y sale sin detalle", async () => {
    const { dependencias, registros } = armar({
      resolucion: () => Promise.resolve(ok(resuelto("app.marca-a.test"))),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justamente se prueba qué pasa con algo que no es un Error
      manejar: () => Promise.reject("texto suelto"),
    });
    const r = await atenderRutaDeIngreso(pedido("app.marca-a.test"), dependencias);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("texto suelto");
    expect(registros).toEqual(["ZH-ABCD-0123 texto suelto"]);
  });

  it("si el propio registro falla, la respuesta sale igual", async () => {
    const { dependencias } = armar({
      resolucion: () => Promise.resolve(ok(resuelto("app.marca-a.test"))),
      manejar: () => Promise.reject(new Error("x")),
    });
    const r = await atenderRutaDeIngreso(pedido("app.marca-a.test"), {
      ...dependencias,
      registrar: () => {
        throw new Error("el registro no anda");
      },
    });
    expect(r.status).toBe(500);
    expect(JSON.parse(await r.text())).toEqual({
      codigo: "ERROR_INTERNO",
      referencia: "ZH-ABCD-0123",
    });
  });

  it("si la resolución del host lanza (no devuelve un error): también 500 sin detalle", async () => {
    const { dependencias } = armar({ resolucion: () => Promise.reject(new Error("boom")) });
    const r = await atenderRutaDeIngreso(pedido("app.marca-a.test"), dependencias);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("boom");
  });

  it("sin azar inyectado, la referencia es una ZH-XXXX-XXXX distinta cada vez", async () => {
    const { dependencias } = armar({
      manejar: () => Promise.reject(new Error("x")),
      resolucion: () => Promise.resolve(ok(resuelto("a.test"))),
    });
    const sinAzar: DependenciasDeLaRuta = { ...dependencias };
    delete (sinAzar as { azar?: unknown }).azar;
    const referencias = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const cuerpo = JSON.parse(
        await (await atenderRutaDeIngreso(pedido("a.test"), sinAzar)).text(),
      ) as {
        referencia: string;
      };
      expect(cuerpo.referencia).toMatch(/^ZH-[0-9A-F]{4}-[0-9A-F]{4}$/);
      referencias.add(cuerpo.referencia);
    }
    expect(referencias.size).toBeGreaterThan(1);
  });
});

describe("atenderRutaDeIngreso: S1, el ingreso social solo acepta provider y callbackURL", () => {
  const aplicacion = () =>
    armar({
      resolucion: () => Promise.resolve(ok(resuelto("app.marca-a.test"))),
      manejar: async (p) => new Response(await p.text(), { status: 200 }),
    });
  const social = (cuerpo: string, metodo = "POST", ruta = "/api/auth/sign-in/social") =>
    new Request(`https://interno.test${ruta}`, {
      method: metodo,
      headers: { host: "app.marca-a.test", "content-type": "application/json" },
      ...(metodo === "GET" ? {} : { body: cuerpo }),
    });
  const VALIDO = JSON.stringify({ provider: "google", callbackURL: "/inicio" });

  it("un idToken mandado directo: 400 sin tocar la autenticación, sin cookies y sin eco del cuerpo", async () => {
    const { dependencias, atendidos } = aplicacion();
    const ataque = JSON.stringify({
      provider: "google",
      idToken: { token: "TOKEN-AJENO", nonce: "n" },
    });
    const r = await atenderRutaDeIngreso(social(ataque), dependencias);
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect(r.headers.getSetCookie()).toEqual([]);
    const cuerpo = await r.text();
    expect(JSON.parse(cuerpo)).toEqual({ codigo: "SOLICITUD_INVALIDA" });
    expect(cuerpo).not.toContain("TOKEN-AJENO");
    expect(atendidos).toEqual([]);
  });

  it("un accessToken, o un cuerpo que no es JSON, también se rechazan", async () => {
    const { dependencias, atendidos } = aplicacion();
    for (const cuerpo of [
      JSON.stringify({ provider: "google", accessToken: { accessToken: "x" } }),
      "no es json",
      "",
    ]) {
      const r = await atenderRutaDeIngreso(social(cuerpo), dependencias);
      expect(r.status, cuerpo).toBe(400);
    }
    expect(atendidos).toEqual([]);
  });

  it("el pedido válido pasa y la librería todavía puede leer su cuerpo", async () => {
    const { dependencias, atendidos } = aplicacion();
    const r = await atenderRutaDeIngreso(social(VALIDO), dependencias);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(VALIDO);
    expect(atendidos).toHaveLength(1);
  });

  it("solo mira el ingreso social: otro POST o un GET con otro cuerpo siguen su camino", async () => {
    const { dependencias, atendidos } = aplicacion();
    const raro = JSON.stringify({ idToken: "x" });
    await atenderRutaDeIngreso(social(raro, "POST", "/api/auth/sign-out"), dependencias);
    await atenderRutaDeIngreso(social(raro, "GET"), dependencias);
    await atenderRutaDeIngreso(social(raro, "POST", "/api/auth/sign-in/social/otra"), dependencias);
    expect(atendidos).toHaveLength(3);
  });

  it("en un host que no es de aplicación sigue siendo el 404 neutro, no el 400", async () => {
    const { dependencias } = armar({ resolucion: () => Promise.resolve(ok(null)) });
    const r = await atenderRutaDeIngreso(social("{}"), dependencias);
    expect(r.status).toBe(404);
  });
});
