import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { SIN_SESION_DE_PLATAFORMA } from "../capacidades/autenticacion/estado-de-sesion-de-plataforma";
import { usuarioAuthId } from "../primitivas/identificadores/marca";
import type { SesionAutenticada } from "../puertos/autenticacion";
import { ErrorDeEntorno, prohibidasPresentes, type FuenteDeEntorno } from "./entorno";
import { armarIngresoDeConsola } from "./ingreso-de-consola";

/**
 * El ingreso de la consola armado, SIN base: las cadenas de conexión son de un host que no existe (`.invalid`) y los pools
 * no abren ninguna conexión hasta la primera consulta. Se prueba lo que es de la composición: que armar no lee nada, que
 * cada pieza valida solo SUS variables, que un error de entorno nombra la variable y nunca el valor, que lo que falló no
 * se memoriza y que la autenticación y la puerta salen atadas al mismo host. Con la base, el Google local y el TOTP de
 * verdad, de punta a punta: `test/integracion/consola-ingreso-compuesto.test.ts`.
 */

const HOST = "consola.pedernal.test";
const CENTINELA = "valor-secreto-inventado-xyz";
const alAzar = () => randomBytes(32).toString("hex");

/** Un entorno completo y válido, con valores al azar de cada corrida. Ninguno es real. */
function entornoCompleto(): Record<string, string> {
  return {
    PEDERNAL_HOST_DE_LA_CONSOLA: HOST,
    PEDERNAL_AUTH_SECRETO_PLATAFORMA: alAzar(),
    GOOGLE_CLIENT_ID_PLATAFORMA: `cliente-${alAzar().slice(0, 12)}`,
    GOOGLE_CLIENT_SECRET_PLATAFORMA: alAzar().slice(0, 24),
    PEDERNAL_DB_AUTENTICACION: "postgres://usuario:clave@base-de-autenticacion.invalid:5432/base",
    PEDERNAL_DB_PLATAFORMA: "postgres://usuario:clave@base-de-plataforma.invalid:5432/base",
    PEDERNAL_CLAVE_CONTEXTO: `1:${alAzar()}`,
    PEDERNAL_SECRETO_INVITACIONES: alAzar(),
  };
}

const sin = (fuente: FuenteDeEntorno, ...nombres: string[]): FuenteDeEntorno => {
  const copia = { ...fuente };
  for (const nombre of nombres) delete copia[nombre];
  return copia;
};

function armar(fuente: FuenteDeEntorno) {
  const registros: string[] = [];
  const ingreso = armarIngresoDeConsola({
    fuente: () => fuente,
    registrar: (d) => registros.push(d),
  });
  return { ingreso, registros };
}

/** El error de entorno que lanza `accion`, con su detalle privado. */
function falla(accion: () => unknown): { error: ErrorDeEntorno; detalle: string } {
  try {
    accion();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorDeEntorno);
    return {
      error: error as ErrorDeEntorno,
      detalle: (error as ErrorDeEntorno).detalleParaElRegistro(),
    };
  }
  throw new Error("tenía que fallar");
}

/** Todo lo que se puede ver de un error y de lo que se registró: nada de eso puede llevar un valor. */
const visibleDe = (error: unknown, registros: readonly string[]): string =>
  [
    String(error),
    inspect(error, { depth: 6, showHidden: true }),
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ...registros,
  ].join("\n");

describe("armarIngresoDeConsola es perezoso", () => {
  it("armarlo, y pedirle sus piezas por nombre, no lee ninguna variable", () => {
    const fuente = vi.fn(() => entornoCompleto());
    const registrar = vi.fn();
    const ingreso = armarIngresoDeConsola({ fuente, registrar });
    expect(Object.keys(ingreso).sort()).toEqual([
      "autenticacion",
      "barridoDeSesiones",
      "cerrar",
      "hostDeLaConsola",
      "puerta",
    ]);
    expect(fuente).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it("sin variables no se arma ninguna pieza: cada una falla cerrado con un error de entorno de mensaje genérico", async () => {
    const { ingreso, registros } = armar({});
    for (const pedir of [
      () => ingreso.hostDeLaConsola(),
      () => ingreso.autenticacion(),
      () => ingreso.puerta(),
      () => ingreso.barridoDeSesiones(),
    ]) {
      const { error } = falla(pedir);
      expect(error.message).toBe("el entorno del servidor no está bien configurado");
    }
    expect(registros).toEqual([
      "pieza host-de-la-consola: PEDERNAL_HOST_DE_LA_CONSOLA falta",
      "pieza host-de-la-consola: PEDERNAL_HOST_DE_LA_CONSOLA falta",
      "pieza host-de-la-consola: PEDERNAL_HOST_DE_LA_CONSOLA falta",
      "pieza conexion-de-autenticacion-de-plataforma: PEDERNAL_DB_AUTENTICACION falta",
    ]);
    // Cerrar sin haber abierto nada no exige un entorno que nunca se usó.
    await expect(ingreso.cerrar()).resolves.toBeUndefined();
  });

  it("cada pieza valida SOLO sus variables: la que no usa no se mira", () => {
    const completo = entornoCompleto();
    // Solo el host: el host se arma; la autenticación pide, en orden, lo que le falta; la puerta, solo el host.
    expect(armar({ PEDERNAL_HOST_DE_LA_CONSOLA: HOST }).ingreso.hostDeLaConsola()).toBe(HOST);
    expect(() => armar({ PEDERNAL_HOST_DE_LA_CONSOLA: HOST }).ingreso.puerta()).not.toThrow();

    const pasos: Array<[string, string[]]> = [
      [
        "pieza autenticacion-de-plataforma: PEDERNAL_AUTH_SECRETO_PLATAFORMA falta; GOOGLE_CLIENT_ID_PLATAFORMA falta; GOOGLE_CLIENT_SECRET_PLATAFORMA falta",
        ["PEDERNAL_HOST_DE_LA_CONSOLA"],
      ],
      [
        "pieza conexion-de-autenticacion-de-plataforma: PEDERNAL_DB_AUTENTICACION falta",
        [
          "PEDERNAL_HOST_DE_LA_CONSOLA",
          "PEDERNAL_AUTH_SECRETO_PLATAFORMA",
          "GOOGLE_CLIENT_ID_PLATAFORMA",
          "GOOGLE_CLIENT_SECRET_PLATAFORMA",
        ],
      ],
      [
        "pieza transacciones-de-plataforma: PEDERNAL_DB_PLATAFORMA falta; PEDERNAL_CLAVE_CONTEXTO falta",
        [
          "PEDERNAL_HOST_DE_LA_CONSOLA",
          "PEDERNAL_AUTH_SECRETO_PLATAFORMA",
          "GOOGLE_CLIENT_ID_PLATAFORMA",
          "GOOGLE_CLIENT_SECRET_PLATAFORMA",
          "PEDERNAL_DB_AUTENTICACION",
        ],
      ],
    ];
    for (const [esperado, presentes] of pasos) {
      const fuente = Object.fromEntries(presentes.map((n) => [n, completo[n]]));
      const { ingreso, registros } = armar(fuente);
      const { detalle } = falla(() => ingreso.autenticacion());
      expect(detalle).toBe(esperado);
      expect(registros).toContain(esperado);
    }
  });

  it("con todo el entorno la autenticación se arma sin abrir ninguna conexión, y es una sola instancia", async () => {
    const { ingreso, registros } = armar(entornoCompleto());
    const autenticacion = ingreso.autenticacion();
    expect(typeof autenticacion.manejar).toBe("function");
    expect(typeof autenticacion.sesionDe).toBe("function");
    expect(typeof autenticacion.estadoDeSesion).toBe("function");
    expect(ingreso.autenticacion()).toBe(autenticacion);
    expect(ingreso.hostDeLaConsola()).toBe(HOST);
    expect(ingreso.puerta()).toBe(ingreso.puerta());
    expect(typeof ingreso.barridoDeSesiones().barrerVencidos).toBe("function");
    expect(registros).toEqual([]);
    await expect(ingreso.cerrar()).resolves.toBeUndefined();
  });

  it("el barrido de sesiones solo pide la cadena de autenticación (ni el secreto, ni Google, ni el host)", () => {
    const { ingreso, registros } = armar({
      PEDERNAL_DB_AUTENTICACION: entornoCompleto()["PEDERNAL_DB_AUTENTICACION"],
    });
    expect(typeof ingreso.barridoDeSesiones().barrerVencidos).toBe("function");
    expect(registros).toEqual([]);
  });

  it("lo que falló no se memoriza: corregido el entorno, el pedido siguiente se arma", () => {
    const entorno = entornoCompleto();
    delete entorno["PEDERNAL_HOST_DE_LA_CONSOLA"];
    const { ingreso, registros } = armar(entorno);
    falla(() => ingreso.hostDeLaConsola());
    falla(() => ingreso.autenticacion());
    entorno["PEDERNAL_HOST_DE_LA_CONSOLA"] = HOST;
    expect(ingreso.hostDeLaConsola()).toBe(HOST);
    expect(typeof ingreso.autenticacion().manejar).toBe("function");
    expect(registros.length).toBeGreaterThan(0);
  });

  it("las variables prohibidas del entorno impiden armar cualquier pieza", () => {
    const { ingreso } = armar({ ...entornoCompleto(), BETTER_AUTH_SECRET: CENTINELA });
    for (const pedir of [
      () => ingreso.hostDeLaConsola(),
      () => ingreso.autenticacion(),
      () => ingreso.barridoDeSesiones(),
    ]) {
      expect(falla(pedir).detalle).toBe("variables prohibidas presentes: BETTER_AUTH_SECRET");
    }
  });
});

describe("armarIngresoDeConsola: la fuente de las variables", () => {
  /** Que un entorno de desarrollo con variables prohibidas (una cadena de Neon, por ejemplo) no cambie el resultado. */
  const sinProhibidas = () => {
    for (const nombre of prohibidasPresentes(process.env)) vi.stubEnv(nombre, undefined);
  };

  it("sin fuente propia lee el entorno del proceso, y recién cuando se le pide una pieza", () => {
    sinProhibidas();
    vi.stubEnv("PEDERNAL_HOST_DE_LA_CONSOLA", HOST);
    try {
      const ingreso = armarIngresoDeConsola();
      expect(ingreso.hostDeLaConsola()).toBe(HOST);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sin registro propio, un fallo de entorno igual falla cerrado (y no rompe por no tener dónde registrar)", () => {
    sinProhibidas();
    vi.stubEnv("PEDERNAL_HOST_DE_LA_CONSOLA", "");
    try {
      const ingreso = armarIngresoDeConsola();
      expect(falla(() => ingreso.hostDeLaConsola()).error.message).toBe(
        "el entorno del servidor no está bien configurado",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("armarIngresoDeConsola: un error de entorno nombra la variable y nunca el valor", () => {
  it.each([
    [
      "un host con esquema",
      "PEDERNAL_HOST_DE_LA_CONSOLA",
      `https://${CENTINELA}.pedernal.test`,
      "PEDERNAL_HOST_DE_LA_CONSOLA inválido",
    ],
    [
      "un host con mayúsculas",
      "PEDERNAL_HOST_DE_LA_CONSOLA",
      `${CENTINELA.toUpperCase()}.pedernal.test`,
      "PEDERNAL_HOST_DE_LA_CONSOLA inválido",
    ],
    [
      "un secreto corto",
      "PEDERNAL_AUTH_SECRETO_PLATAFORMA",
      CENTINELA,
      "PEDERNAL_AUTH_SECRETO_PLATAFORMA inválido: necesita al menos 32 caracteres",
    ],
    [
      "un secreto repetido",
      "PEDERNAL_AUTH_SECRETO_PLATAFORMA",
      "ab".repeat(40),
      "PEDERNAL_AUTH_SECRETO_PLATAFORMA inválido: necesita al menos 10 caracteres distintos",
    ],
    [
      "una cadena de autenticación que no es de Postgres",
      "PEDERNAL_DB_AUTENTICACION",
      `https://${CENTINELA}.invalid/base`,
      "pieza conexion-de-autenticacion-de-plataforma: PEDERNAL_DB_AUTENTICACION inválida",
    ],
    [
      "una cadena de plataforma que no es de Postgres",
      "PEDERNAL_DB_PLATAFORMA",
      `https://${CENTINELA}.invalid/base`,
      "pieza transacciones-de-plataforma: PEDERNAL_DB_PLATAFORMA inválida",
    ],
    [
      "una clave de contexto mal formada",
      "PEDERNAL_CLAVE_CONTEXTO",
      CENTINELA,
      "PEDERNAL_CLAVE_CONTEXTO",
    ],
  ])("%s", (_cual, nombre, valor, fragmento) => {
    const { ingreso, registros } = armar({ ...entornoCompleto(), [nombre]: valor });
    const { error, detalle } = falla(() => ingreso.autenticacion());
    expect(detalle).toContain(fragmento);
    expect(registros).toContain(detalle);
    const visible = visibleDe(error, registros);
    expect(visible).not.toContain(CENTINELA);
    expect(visible).not.toContain(valor);
    // El valor sano de las demás variables tampoco sale.
    for (const [otra, otroValor] of Object.entries(entornoCompleto())) {
      if (otra !== nombre) expect(visible).not.toContain(otroValor);
    }
    expect(error.message).toBe("el entorno del servidor no está bien configurado");
  });

  it("el secreto de la consola igual al de empresa, si el entorno lo trae a la vista: no se arma, y no se muestra", () => {
    const secreto = alAzar();
    const { ingreso, registros } = armar({
      ...entornoCompleto(),
      PEDERNAL_AUTH_SECRETO_PLATAFORMA: secreto,
      PEDERNAL_AUTH_SECRETO_EMPRESA: `  ${secreto} `,
    });
    const { error, detalle } = falla(() => ingreso.autenticacion());
    expect(detalle).toBe(
      "PEDERNAL_AUTH_SECRETO_PLATAFORMA inválido: no puede ser igual a PEDERNAL_AUTH_SECRETO_EMPRESA",
    );
    expect(visibleDe(error, registros)).not.toContain(secreto);
  });

  it("un secreto de empresa DISTINTO a la vista no estorba", () => {
    const { ingreso } = armar({ ...entornoCompleto(), PEDERNAL_AUTH_SECRETO_EMPRESA: alAzar() });
    expect(typeof ingreso.autenticacion().manejar).toBe("function");
  });

  it.each([
    [
      "el id",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_ID_PLATAFORMA",
      "GOOGLE_CLIENT_ID_PLATAFORMA inválido: no puede ser igual a GOOGLE_CLIENT_ID",
    ],
    [
      "el secreto",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_CLIENT_SECRET_PLATAFORMA",
      "GOOGLE_CLIENT_SECRET_PLATAFORMA inválido: no puede ser igual a GOOGLE_CLIENT_SECRET",
    ],
  ])(
    "el cliente de Google de la consola con %s igual al de la web: no se arma, nombra las variables y no muestra el valor",
    (_cual, deLaWeb, deLaConsola, esperado) => {
      const entorno = entornoCompleto();
      const valor = entorno[deLaConsola] as string;
      const { ingreso, registros } = armar({ ...entorno, [deLaWeb]: valor });
      const { error, detalle } = falla(() => ingreso.autenticacion());
      expect(detalle).toBe(esperado);
      expect(registros).toContain(esperado);
      expect(visibleDe(error, registros)).not.toContain(valor);
    },
  );

  it("el cliente de Google de la web, DISTINTO, a la vista no estorba; sin el de la web tampoco", () => {
    const conLaWeb = armar({
      ...entornoCompleto(),
      GOOGLE_CLIENT_ID: "cliente-de-la-web",
      GOOGLE_CLIENT_SECRET: "clave-de-la-web",
    });
    expect(typeof conLaWeb.ingreso.autenticacion().manejar).toBe("function");
    expect(typeof armar(entornoCompleto()).ingreso.autenticacion().manejar).toBe("function");
  });

  it("sin el cliente de Google de la consola no se arma, aunque esté el de la web (no se reutiliza)", () => {
    const entorno = sin(
      entornoCompleto(),
      "GOOGLE_CLIENT_ID_PLATAFORMA",
      "GOOGLE_CLIENT_SECRET_PLATAFORMA",
    );
    const { ingreso } = armar({
      ...entorno,
      GOOGLE_CLIENT_ID: "cliente-de-la-web",
      GOOGLE_CLIENT_SECRET: "clave-de-la-web",
    });
    expect(falla(() => ingreso.autenticacion()).detalle).toBe(
      "pieza autenticacion-de-plataforma: GOOGLE_CLIENT_ID_PLATAFORMA falta; GOOGLE_CLIENT_SECRET_PLATAFORMA falta",
    );
  });

  it("si el propio registro falla, el error de entorno sale igual", () => {
    const ingreso = armarIngresoDeConsola({
      fuente: () => ({}),
      registrar: () => {
        throw new Error("el registro está caído");
      },
    });
    expect(falla(() => ingreso.hostDeLaConsola()).error.message).toBe(
      "el entorno del servidor no está bien configurado",
    );
  });
});

describe("armarIngresoDeConsola: la autenticación y la puerta salen atadas al mismo host", () => {
  const sesionEn = (host: string): SesionAutenticada => {
    const ahora = Date.now();
    return {
      usuarioAuth: usuarioAuthId("bbbbbbbb-0000-4000-8000-000000000002"),
      email: "admin@dominio-de-prueba.test",
      emailVerificado: true,
      creadaEn: new Date(ahora - 60_000),
      ultimoUso: new Date(ahora - 1_000),
      venceEn: new Date(ahora + 20 * 60_000),
      host,
      segundoFactorEn: new Date(ahora - 1_000),
      segundoFactorEnrolado: true,
      cookiesDeRespuesta: [],
    };
  };

  it("la autenticación de la consola solo atiende el host de la variable: otro host, 404 neutro y ninguna sesión", async () => {
    const { ingreso } = armar(entornoCompleto());
    const autenticacion = ingreso.autenticacion();
    const pedido = {
      headers: new Headers({ cookie: "__Host-pd_plat.session_token=inventada.firma" }),
    };

    const neutra = await autenticacion.manejar(
      new Request("https://otro.pedernal.test/api/auth/get-session"),
      "otro.pedernal.test",
    );
    expect(neutra.status).toBe(404);
    expect(await neutra.text()).toBe("");
    expect(await autenticacion.sesionDe(pedido, "otro.pedernal.test")).toBeNull();
    expect(await autenticacion.estadoDeSesion(pedido, "otro.pedernal.test")).toEqual(
      SIN_SESION_DE_PLATAFORMA,
    );
  });

  it("en el host de la consola, una ruta fuera de la lista cerrada es el mismo 404 neutro (sin tocar la base)", async () => {
    const { ingreso } = armar(entornoCompleto());
    const r = await ingreso
      .autenticacion()
      .manejar(new Request(`https://${HOST}/api/auth/sign-up/email`, { method: "POST" }), HOST);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
  });

  it("la puerta se arma con el host de la variable: una sesión de otro host es sesion_vencida; la del host llega a leer al administrador", async () => {
    // Sin variables de plataforma, leer al administrador falla y la puerta responde `no_habilitado`: la prueba de que la
    // sesión del host de la consola PASÓ el control de host y llegó hasta ahí. La de otro host no llega nunca.
    const { ingreso, registros } = armar({ PEDERNAL_HOST_DE_LA_CONSOLA: HOST });
    const puerta = ingreso.puerta();
    expect(await puerta.conSesion(null)).toEqual({ ok: false, error: "sesion_vencida" });
    expect(await puerta.conSesion(sesionEn("otra-consola.pedernal.test"))).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
    expect(registros).toEqual([]);
    expect(await puerta.conSesion(sesionEn(HOST))).toEqual({ ok: false, error: "no_habilitado" });
    expect(registros).toContain(
      "pieza transacciones-de-plataforma: PEDERNAL_DB_PLATAFORMA falta; PEDERNAL_CLAVE_CONTEXTO falta",
    );
    await puerta.cerrar();
  });

  it("con otro valor en la variable, la puerta sigue a ESE host", async () => {
    const otro = "platform.pedernal.test";
    const { ingreso } = armar({ PEDERNAL_HOST_DE_LA_CONSOLA: otro });
    expect(ingreso.hostDeLaConsola()).toBe(otro);
    expect(await ingreso.puerta().conSesion(sesionEn(HOST))).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
    expect(await ingreso.puerta().conSesion(sesionEn(otro))).toEqual({
      ok: false,
      error: "no_habilitado",
    });
  });

  it("la puerta con el host inválido no se arma", () => {
    const { ingreso } = armar({ PEDERNAL_HOST_DE_LA_CONSOLA: "https://consola.pedernal.test" });
    expect(falla(() => ingreso.puerta()).detalle).toBe(
      "PEDERNAL_HOST_DE_LA_CONSOLA inválido: tiene que ser un nombre de host en minúsculas, sin esquema ni ruta",
    );
  });
});
