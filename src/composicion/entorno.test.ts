import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../adaptadores/postgres/errores";
import {
  ErrorDeEntorno,
  LARGO_MINIMO_DEL_SECRETO_DEL_CRON,
  NOMBRES_DE_ENTORNO,
  PREFIJO_PROHIBIDO,
  VARIABLES_PROHIBIDAS,
  VARIABLE_DE_TIPO_DE_DESPLIEGUE,
  entornoDelProceso,
  esProduccion,
  prohibidasPresentes,
  registrandoFallosDeEntorno,
  valoresDeLaPieza,
  type FuenteDeEntorno,
  type Pieza,
} from "./entorno";

/**
 * Los valores de estas pruebas son inventados a propósito (marcas de texto reconocibles), nunca
 * valores reales: lo que se verifica es la FORMA de la validación y que ningún error los repita.
 */
const CENTINELA = "valor-secreto-de-prueba-123";

const COMPLETO: FuenteDeEntorno = {
  PEDERNAL_CLAVE_CONTEXTO: "  1:abcdef  ",
  // Una clave maestra al azar de ESTA corrida: el código no lleva ningún valor.
  PEDERNAL_CLAVE_CERTIFICADOS: `k1:${randomBytes(32).toString("hex")}`,
  PEDERNAL_SECRETO_INVITACIONES: "secreto-de-prueba",
  PEDERNAL_RESEND_API_KEY: "clave-de-prueba",
  PEDERNAL_CORREO_REMITENTE: "Prueba <prueba@ejemplo.test>",
  PEDERNAL_NOMBRE_DE_MARCA: "Marca de prueba",
  PEDERNAL_URL_BASE: "https://app.ejemplo.test",
  PEDERNAL_DB_APP: "postgres://usuario:clave@host.test:5432/base",
  PEDERNAL_DB_TRABAJOS: "postgresql://usuario:clave@host.test/base",
  PEDERNAL_DB_PUBLICO: "postgres://usuario:clave@host.test:5432/base",
  PEDERNAL_DB_AUTENTICACION: "postgres://usuario:clave@host.test:5432/base",
  PEDERNAL_AUTH_SECRETO_EMPRESA: "secreto-de-prueba-que-no-es-real-0123456789",
  GOOGLE_CLIENT_ID: "cliente-de-prueba",
  GOOGLE_CLIENT_SECRET: "secreto-de-cliente-de-prueba",
  CRON_SECRET: "el-secreto-largo-del-cron-de-prueba",
};

const PIEZAS: Record<Pieza, string[]> = {
  "transacciones-app": ["PEDERNAL_CLAVE_CONTEXTO", "PEDERNAL_DB_APP"],
  "transacciones-trabajos": ["PEDERNAL_CLAVE_CONTEXTO", "PEDERNAL_DB_TRABAJOS"],
  // La puerta pública no tiene contexto firmado: no necesita la clave, solo su propia cadena.
  "transacciones-publicas": ["PEDERNAL_DB_PUBLICO"],
  // La autenticación (W3b): la conexión del rol de autenticación se pide sola (el barrido del cron no necesita
  // ni el secreto ni el cliente de Google); el ingreso necesita el secreto y el cliente.
  "conexion-de-autenticacion": ["PEDERNAL_DB_AUTENTICACION"],
  autenticacion: ["PEDERNAL_AUTH_SECRETO_EMPRESA", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  tokens: ["PEDERNAL_SECRETO_INVITACIONES"],
  // El facturador: la clave que cifra las claves privadas de ARCA y los tickets; solo la pide su pieza.
  "cifrador-de-certificados": ["PEDERNAL_CLAVE_CERTIFICADOS"],
  // W6: la guarda de migración y la salud miran la base con el rol de la aplicación, sin firmar contexto.
  esquema: ["PEDERNAL_DB_APP"],
  cron: ["CRON_SECRET"],
  correo: [
    "PEDERNAL_RESEND_API_KEY",
    "PEDERNAL_CORREO_REMITENTE",
    "PEDERNAL_URL_BASE",
    "PEDERNAL_NOMBRE_DE_MARCA",
  ],
};

const sin = (fuente: FuenteDeEntorno, nombre: string): FuenteDeEntorno => {
  const copia = { ...fuente };
  delete copia[nombre];
  return copia;
};

describe("NOMBRES_DE_ENTORNO (P-13: la lista de nombres)", () => {
  const nombres = NOMBRES_DE_ENTORNO.map((e) => e.nombre);

  it("son exactamente los de W1, la cadena de la puerta pública, los de la autenticación, el secreto del cron y la clave de los certificados (los demás llegan en sus tramos)", () => {
    expect([...nombres].sort()).toEqual(
      [
        "CRON_SECRET",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "PEDERNAL_AUTH_SECRETO_EMPRESA",
        "PEDERNAL_CLAVE_CERTIFICADOS",
        "PEDERNAL_CLAVE_CONTEXTO",
        "PEDERNAL_CORREO_REMITENTE",
        "PEDERNAL_DB_APP",
        "PEDERNAL_DB_AUTENTICACION",
        "PEDERNAL_DB_PUBLICO",
        "PEDERNAL_DB_TRABAJOS",
        "PEDERNAL_NOMBRE_DE_MARCA",
        "PEDERNAL_RESEND_API_KEY",
        "PEDERNAL_SECRETO_INVITACIONES",
        "PEDERNAL_URL_BASE",
      ].sort(),
    );
  });

  it("no se repiten y todos llevan el prefijo del producto, salvo el cliente de Google (nombres que el dueño ya conoce)", () => {
    expect(new Set(nombres).size).toBe(nombres.length);
    // `CRON_SECRET` es el nombre que Vercel busca para autorizar su cron: no se puede renombrar.
    const conNombreAjeno = ["CRON_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
    for (const nombre of nombres) {
      if (!conNombreAjeno.includes(nombre)) expect(nombre).toMatch(/^PEDERNAL_[A-Z0-9_]+$/);
    }
    expect(nombres.filter((x) => !x.startsWith("PEDERNAL_")).sort()).toEqual(conNombreAjeno);
  });

  it("no contiene la conexión de plataforma ni la de grupo: la web no las recibe (R10)", () => {
    expect(nombres).not.toContain("PEDERNAL_DB_PLATAFORMA");
    expect(nombres).not.toContain("PEDERNAL_DB_GRUPO");
    for (const nombre of nombres) expect(nombre).not.toMatch(/PLATAFORMA|GRUPO/);
  });

  it("no contiene nada de la consola de plataforma: ni su secreto de ingreso, ni su cliente de Google, ni su host (R10)", () => {
    // Nombres exactos, aunque el patrón de arriba ya los alcance en parte: «CONSOLA» no está en ese patrón.
    for (const deLaConsola of [
      "PEDERNAL_AUTH_SECRETO_PLATAFORMA",
      "GOOGLE_CLIENT_ID_PLATAFORMA",
      "GOOGLE_CLIENT_SECRET_PLATAFORMA",
      "PEDERNAL_HOST_DE_LA_CONSOLA",
    ]) {
      expect(nombres).not.toContain(deLaConsola);
    }
    for (const nombre of nombres) expect(nombre).not.toMatch(/CONSOLA/);
    // La web sigue con SU cliente de Google y SU secreto: son otros nombres.
    expect(nombres).toContain("GOOGLE_CLIENT_ID");
    expect(nombres).toContain("GOOGLE_CLIENT_SECRET");
    expect(nombres).toContain("PEDERNAL_AUTH_SECRETO_EMPRESA");
  });

  it("ninguna pieza de la web entrega las variables de la consola, aunque estén en el entorno", () => {
    const conLaConsola: FuenteDeEntorno = {
      ...COMPLETO,
      PEDERNAL_AUTH_SECRETO_PLATAFORMA: "secreto-de-la-consola-de-prueba",
      GOOGLE_CLIENT_ID_PLATAFORMA: "cliente-de-la-consola-de-prueba",
      GOOGLE_CLIENT_SECRET_PLATAFORMA: "clave-de-la-consola-de-prueba",
      PEDERNAL_HOST_DE_LA_CONSOLA: "consola.pedernal.test",
      PEDERNAL_DB_PLATAFORMA: "postgres://usuario:clave@host.test:5432/base",
    };
    for (const pieza of Object.keys(PIEZAS) as Pieza[]) {
      const valores = valoresDeLaPieza(conLaConsola, pieza);
      expect(Object.keys(valores).sort(), pieza).toEqual([...PIEZAS[pieza]].sort());
    }
  });

  it("ninguno es una variable prohibida", () => {
    for (const nombre of nombres) {
      expect(VARIABLES_PROHIBIDAS).not.toContain(nombre);
      expect(nombre.startsWith(PREFIJO_PROHIBIDO)).toBe(false);
    }
  });

  it("cada nombre declara qué pieza lo usa, y las piezas son las esperadas", () => {
    for (const entrada of NOMBRES_DE_ENTORNO) expect(entrada.piezas.length).toBeGreaterThan(0);
    for (const [pieza, esperados] of Object.entries(PIEZAS)) {
      const usados = NOMBRES_DE_ENTORNO.filter((e) =>
        (e.piezas as readonly string[]).includes(pieza),
      ).map((e) => e.nombre);
      expect([...usados].sort()).toEqual([...esperados].sort());
    }
  });
});

describe("variables prohibidas (P-13)", () => {
  it("son las de la spec", () => {
    expect([...VARIABLES_PROHIBIDAS].sort()).toEqual(
      [
        "AUTH_SECRET",
        "AUTH_URL",
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_SECRETS",
        "BETTER_AUTH_TELEMETRY",
        "BETTER_AUTH_TELEMETRY_ENDPOINT",
        "BETTER_AUTH_TELEMETRY_ID",
        "BETTER_AUTH_TRUSTED_ORIGINS",
        "BETTER_AUTH_URL",
        "DATABASE_URL",
        "DATABASE_URL_UNPOOLED",
      ].sort(),
    );
    expect(PREFIJO_PROHIBIDO).toBe("POSTGRES_");
  });

  it("un entorno limpio no tiene ninguna", () => {
    expect(prohibidasPresentes({})).toEqual([]);
    expect(prohibidasPresentes(COMPLETO)).toEqual([]);
  });

  it.each([
    "BETTER_AUTH_SECRETS",
    "BETTER_AUTH_TRUSTED_ORIGINS",
    "BETTER_AUTH_TELEMETRY_ENDPOINT",
    "BETTER_AUTH_TELEMETRY_ID",
    "AUTH_SECRET",
    "AUTH_URL",
    "BETTER_AUTH_TELEMETRY",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_X",
  ])("detecta %s", (nombre) => {
    expect(prohibidasPresentes({ ...COMPLETO, [nombre]: CENTINELA })).toEqual([nombre]);
  });

  it("G7: con la telemetría de la librería de ingreso presente, la autenticación no se arma (ni su conexión)", () => {
    const fuente = { ...COMPLETO, BETTER_AUTH_TELEMETRY: "false" };
    for (const pieza of ["autenticacion", "conexion-de-autenticacion"] as const) {
      expect(() => valoresDeLaPieza(fuente, pieza)).toThrow(ErrorDeEntorno);
      try {
        valoresDeLaPieza(fuente, pieza);
      } catch (e) {
        expect((e as ErrorDeEntorno).detalleParaElRegistro()).toBe(
          "variables prohibidas presentes: BETTER_AUTH_TELEMETRY",
        );
      }
    }
  });

  it("una variable presente pero vacía también existe", () => {
    expect(prohibidasPresentes({ DATABASE_URL: "" })).toEqual(["DATABASE_URL"]);
  });

  it("una variable undefined no existe", () => {
    expect(prohibidasPresentes({ DATABASE_URL: undefined, POSTGRES_URL: undefined })).toEqual([]);
  });

  it("los parecidos que no son de la lista no cuentan", () => {
    expect(
      prohibidasPresentes({
        DATABASE_URLS: "x",
        MI_DATABASE_URL: "x",
        POSTGRES: "x",
        POSTGRESQL_URL: "x",
        MI_POSTGRES_URL: "x",
        BETTER_AUTH: "x",
      }),
    ).toEqual([]);
  });

  it("las devuelve ordenadas", () => {
    expect(
      prohibidasPresentes({ POSTGRES_URL: "x", DATABASE_URL: "x", BETTER_AUTH_URL: "x" }),
    ).toEqual(["BETTER_AUTH_URL", "DATABASE_URL", "POSTGRES_URL"]);
  });

  it.each(Object.keys(PIEZAS) as Pieza[])(
    "con una prohibida presente la pieza %s no arma nada, aunque lo demás esté bien",
    (pieza) => {
      const fuente = { ...COMPLETO, DATABASE_URL: CENTINELA, POSTGRES_URL: CENTINELA };
      let error: unknown;
      try {
        valoresDeLaPieza(fuente, pieza);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ErrorDeEntorno);
      const detalle = (error as ErrorDeEntorno).detalleParaElRegistro();
      expect(detalle).toBe("variables prohibidas presentes: DATABASE_URL, POSTGRES_URL");
      expect(detalle).not.toContain(CENTINELA);
    },
  );
});

describe("valoresDeLaPieza", () => {
  it.each(Object.entries(PIEZAS) as [Pieza, string[]][])(
    "%s devuelve solo las variables de su pieza",
    (pieza, esperados) => {
      const valores = valoresDeLaPieza(COMPLETO, pieza);
      expect(Object.keys(valores).sort()).toEqual([...esperados].sort());
    },
  );

  it("devuelve los valores sin blancos en los extremos", () => {
    const valores = valoresDeLaPieza(COMPLETO, "transacciones-app");
    expect(valores.PEDERNAL_CLAVE_CONTEXTO).toBe("1:abcdef");
    expect(valores.PEDERNAL_DB_APP).toBe("postgres://usuario:clave@host.test:5432/base");
  });

  it("una pieza no exige las variables de otra", () => {
    expect(valoresDeLaPieza({ PEDERNAL_SECRETO_INVITACIONES: "x" }, "tokens")).toEqual({
      PEDERNAL_SECRETO_INVITACIONES: "x",
    });
  });

  it("con el entorno vacío falla cerrado y nombra TODO lo que falta, solo en el detalle", () => {
    let error: unknown;
    try {
      valoresDeLaPieza({}, "correo");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorDeEntorno);
    const e = error as ErrorDeEntorno;
    expect(e.detalleParaElRegistro()).toBe(
      "pieza correo: PEDERNAL_RESEND_API_KEY falta; PEDERNAL_CORREO_REMITENTE falta; PEDERNAL_URL_BASE falta; PEDERNAL_NOMBRE_DE_MARCA falta",
    );
    expect(e.message).not.toMatch(/PEDERNAL/);
  });

  it.each(Object.entries(PIEZAS).flatMap(([p, ns]) => ns.map((n) => [p, n] as [Pieza, string])))(
    "%s: si falta %s, falla",
    (pieza, nombre) => {
      expect(() => valoresDeLaPieza(sin(COMPLETO, nombre), pieza)).toThrow(ErrorDeEntorno);
    },
  );

  it.each(["", "   ", "\n\t"])("una variable de texto vacía (%j) es inválida", (vacio) => {
    expect(() =>
      valoresDeLaPieza({ ...COMPLETO, PEDERNAL_RESEND_API_KEY: vacio }, "correo"),
    ).toThrow(ErrorDeEntorno);
  });

  it.each([
    ["https://host.test/base", "no es de Postgres"],
    ["postgres://", "sin nada después"],
    ["postgres:// con espacio", "con un espacio"],
    ["mysql://u:c@h/b", "otro motor"],
    ["xpostgres://u:c@h/b", "no empieza con el esquema"],
    ["postgress://u:c@h/b", "esquema mal escrito"],
    ["postgres://u:c@h/b\ncomando", "con un salto de línea"],
    ["", "vacía"],
  ])("la cadena de la base %j es inválida (%s)", (cadena) => {
    expect(() =>
      valoresDeLaPieza({ ...COMPLETO, PEDERNAL_DB_APP: cadena }, "transacciones-app"),
    ).toThrow(ErrorDeEntorno);
    expect(() =>
      valoresDeLaPieza({ ...COMPLETO, PEDERNAL_DB_TRABAJOS: cadena }, "transacciones-trabajos"),
    ).toThrow(ErrorDeEntorno);
    expect(() =>
      valoresDeLaPieza({ ...COMPLETO, PEDERNAL_DB_PUBLICO: cadena }, "transacciones-publicas"),
    ).toThrow(ErrorDeEntorno);
  });

  it("la puerta pública valida solo su cadena: no pide la clave de contexto ni las demás conexiones", () => {
    expect(
      valoresDeLaPieza({ PEDERNAL_DB_PUBLICO: "postgres://u:c@h/b" }, "transacciones-publicas"),
    ).toEqual({
      PEDERNAL_DB_PUBLICO: "postgres://u:c@h/b",
    });
    // Y las demás piezas tampoco la piden.
    expect(() =>
      valoresDeLaPieza(sin(COMPLETO, "PEDERNAL_DB_PUBLICO"), "transacciones-app"),
    ).not.toThrow();
    expect(() =>
      valoresDeLaPieza(sin(COMPLETO, "PEDERNAL_DB_PUBLICO"), "transacciones-trabajos"),
    ).not.toThrow();
  });

  it("la guarda de migración y la salud piden solo la cadena de la aplicación: ni la clave ni las demás conexiones", () => {
    expect(valoresDeLaPieza({ PEDERNAL_DB_APP: "postgres://u:c@h/b" }, "esquema")).toEqual({
      PEDERNAL_DB_APP: "postgres://u:c@h/b",
    });
    expect(() =>
      valoresDeLaPieza({ ...COMPLETO, PEDERNAL_DB_APP: "mysql://u:c@h/b" }, "esquema"),
    ).toThrow(ErrorDeEntorno);
  });

  it("el secreto del cron exige el largo mínimo (borde exacto), recorta los blancos y no repite el valor", () => {
    expect(LARGO_MINIMO_DEL_SECRETO_DEL_CRON).toBe(16);
    const justo = "abcdefghijklmnop".slice(0, LARGO_MINIMO_DEL_SECRETO_DEL_CRON);
    expect(valoresDeLaPieza({ CRON_SECRET: `  ${justo}\n` }, "cron")).toEqual({
      CRON_SECRET: justo,
    });
    const corto = "bcdefghijklmnop".slice(0, LARGO_MINIMO_DEL_SECRETO_DEL_CRON - 1);
    let error: unknown;
    try {
      valoresDeLaPieza({ CRON_SECRET: corto }, "cron");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorDeEntorno);
    expect((error as ErrorDeEntorno).detalleParaElRegistro()).toBe(
      "pieza cron: CRON_SECRET inválida",
    );
    // Con blancos que lo dejan corto después de recortar, también.
    expect(() => valoresDeLaPieza({ CRON_SECRET: `  ${corto}  ` }, "cron")).toThrow(ErrorDeEntorno);
  });

  it("el secreto del cron exige también variedad: 10 caracteres distintos pasa y 9 no, aunque el largo alcance", () => {
    // 16 caracteres con exactamente 10 distintos (borde que pasa) y con 9 (borde que no).
    const diez = "abcdefghij" + "abcdef";
    const nueve = "abcdefghi" + "abcdefg";
    expect(diez).toHaveLength(LARGO_MINIMO_DEL_SECRETO_DEL_CRON);
    expect(nueve).toHaveLength(LARGO_MINIMO_DEL_SECRETO_DEL_CRON);
    expect(valoresDeLaPieza({ CRON_SECRET: diez }, "cron")).toEqual({ CRON_SECRET: diez });
    expect(() => valoresDeLaPieza({ CRON_SECRET: nueve }, "cron")).toThrow(ErrorDeEntorno);
    // Lo repetido a mano, aunque sea largo.
    expect(() => valoresDeLaPieza({ CRON_SECRET: "a".repeat(64) }, "cron")).toThrow(ErrorDeEntorno);
    expect(() => valoresDeLaPieza({ CRON_SECRET: "ab".repeat(32) }, "cron")).toThrow(
      ErrorDeEntorno,
    );
  });

  it("acepta los dos esquemas de Postgres y recorta los blancos", () => {
    const v = valoresDeLaPieza(
      { ...COMPLETO, PEDERNAL_DB_APP: "  postgresql://u:c@h/b  " },
      "transacciones-app",
    );
    expect(v.PEDERNAL_DB_APP).toBe("postgresql://u:c@h/b");
  });

  it("una variable inválida se informa como inválida y nunca se repite su valor", () => {
    const malo = `mysql://usuario:${CENTINELA}@host/base`;
    let error: unknown;
    try {
      valoresDeLaPieza({ ...COMPLETO, PEDERNAL_DB_APP: malo }, "transacciones-app");
    } catch (e) {
      error = e;
    }
    const e = error as ErrorDeEntorno;
    expect(e.detalleParaElRegistro()).toBe("pieza transacciones-app: PEDERNAL_DB_APP inválida");
    for (const texto of [
      e.detalleParaElRegistro(),
      e.message,
      String(e.stack),
      JSON.stringify(e),
      inspect(e),
    ]) {
      expect(texto).not.toContain(CENTINELA);
    }
  });

  it("junta faltantes e inválidas en un solo error", () => {
    const fuente = sin(
      { ...COMPLETO, PEDERNAL_DB_APP: "no-es-una-cadena" },
      "PEDERNAL_CLAVE_CONTEXTO",
    );
    expect(() => valoresDeLaPieza(fuente, "transacciones-app")).toThrow(ErrorDeEntorno);
    try {
      valoresDeLaPieza(fuente, "transacciones-app");
    } catch (e) {
      expect((e as ErrorDeEntorno).detalleParaElRegistro()).toBe(
        "pieza transacciones-app: PEDERNAL_CLAVE_CONTEXTO falta; PEDERNAL_DB_APP inválida",
      );
    }
  });

  it("no modifica la fuente", () => {
    const fuente = { ...COMPLETO };
    valoresDeLaPieza(fuente, "correo");
    expect(fuente).toEqual(COMPLETO);
  });
});

describe("ErrorDeEntorno", () => {
  const error = new ErrorDeEntorno(`pieza x: PEDERNAL_DB_APP falta`);

  it("es un ErrorDeConfiguracion con nombre propio y mensaje genérico", () => {
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ErrorDeEntorno");
    expect(error.message).toBe("el entorno del servidor no está bien configurado");
  });

  it("el detalle solo sale por el método del registro", () => {
    expect(error.detalleParaElRegistro()).toBe("pieza x: PEDERNAL_DB_APP falta");
    expect(JSON.stringify(error)).not.toContain("PEDERNAL_DB_APP");
    expect(Object.keys(error)).toEqual(["name"]);
    expect(inspect(error)).not.toContain("falta");
  });
});

describe("registrandoFallosDeEntorno", () => {
  it("devuelve lo que arma, sin registrar nada", () => {
    const registrados: string[] = [];
    expect(
      registrandoFallosDeEntorno(
        (d) => registrados.push(d),
        () => 42,
      ),
    ).toBe(42);
    expect(registrados).toEqual([]);
  });

  it("un ErrorDeEntorno se registra con su detalle y se vuelve a lanzar tal cual", () => {
    const original = new ErrorDeEntorno("pieza p: PEDERNAL_X falta");
    const registrados: string[] = [];
    let atrapado: unknown;
    try {
      registrandoFallosDeEntorno(
        (d) => registrados.push(d),
        () => {
          throw original;
        },
      );
    } catch (e) {
      atrapado = e;
    }
    expect(atrapado).toBe(original);
    expect(registrados).toEqual(["pieza p: PEDERNAL_X falta"]);
  });

  it("un ErrorDeConfiguracion de un adaptador se vuelve ErrorDeEntorno: el nombre al registro, el mensaje genérico", () => {
    const registrados: string[] = [];
    let atrapado: unknown;
    try {
      registrandoFallosDeEntorno(
        (d) => registrados.push(d),
        () => {
          throw new ErrorDeConfiguracion("PEDERNAL_CLAVE_CONTEXTO inválida: el kid no sirve");
        },
      );
    } catch (e) {
      atrapado = e;
    }
    expect(atrapado).toBeInstanceOf(ErrorDeEntorno);
    expect((atrapado as ErrorDeEntorno).message).not.toContain("PEDERNAL");
    expect(registrados).toEqual(["PEDERNAL_CLAVE_CONTEXTO inválida: el kid no sirve"]);
  });

  it("cualquier otro error pasa tal cual y no se registra", () => {
    const registrados: string[] = [];
    const otro = new TypeError("otra cosa");
    expect(() =>
      registrandoFallosDeEntorno(
        (d) => registrados.push(d),
        () => {
          throw otro;
        },
      ),
    ).toThrow(otro);
    expect(registrados).toEqual([]);
  });

  it("si el registro falla, igual sale el error de entorno", () => {
    expect(() =>
      registrandoFallosDeEntorno(
        () => {
          throw new Error("el registro está caído");
        },
        () => {
          throw new ErrorDeEntorno("d");
        },
      ),
    ).toThrow(ErrorDeEntorno);
  });
});

describe("entornoDelProceso", () => {
  it("es el entorno del proceso", () => {
    expect(entornoDelProceso()).toBe(process.env);
  });
});

describe("esProduccion (VERCEL_ENV)", () => {
  it("la variable de sistema se llama VERCEL_ENV", () => {
    expect(VARIABLE_DE_TIPO_DE_DESPLIEGUE).toBe("VERCEL_ENV");
  });

  it("solo `production` exacto es producción", () => {
    expect(esProduccion({ VERCEL_ENV: "production" })).toBe(true);
  });

  it.each([
    ["preview"],
    ["development"],
    [""],
    ["Production"],
    [" production"],
    ["production "],
    ["prod"],
  ])("%j no es producción", (valor) => {
    expect(esProduccion({ VERCEL_ENV: valor })).toBe(false);
  });

  it("sin la variable no es producción (falla cerrado)", () => {
    expect(esProduccion({})).toBe(false);
    expect(esProduccion({ VERCEL_ENV: undefined })).toBe(false);
  });

  it("no mira otras variables parecidas", () => {
    expect(esProduccion({ NODE_ENV: "production", VERCEL_TARGET_ENV: "production" })).toBe(false);
  });
});
