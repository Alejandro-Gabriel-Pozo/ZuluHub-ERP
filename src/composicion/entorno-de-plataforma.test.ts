import { describe, expect, it } from "vitest";
import { ErrorDeEntorno, NOMBRES_DE_ENTORNO, type FuenteDeEntorno } from "./entorno";
import {
  GOOGLE_CLIENT_ID_PLATAFORMA,
  GOOGLE_CLIENT_SECRET_PLATAFORMA,
  PEDERNAL_AUTH_SECRETO_EMPRESA,
  PEDERNAL_AUTH_SECRETO_PLATAFORMA,
  PEDERNAL_HOST_DE_LA_CONSOLA,
  leerSecretoDeAutenticacionDePlataforma,
} from "../adaptadores/autenticacion/configuracion";
import {
  NOMBRES_DE_ENTORNO_DE_PLATAFORMA,
  PEDERNAL_DB_AUTENTICACION,
  PEDERNAL_DB_PLATAFORMA,
  valoresDeLaPiezaDePlataforma,
} from "./entorno-de-plataforma";

/** Valores inventados y reconocibles: lo que se prueba es la forma de la validación y que ningún error los repita. */
const CENTINELA = "valor-secreto-de-prueba-123";

const COMPLETO: FuenteDeEntorno = {
  PEDERNAL_DB_PLATAFORMA: "  postgres://usuario:contrasena-de-prueba@host.test:5432/base  ",
  PEDERNAL_CLAVE_CONTEXTO: "  1:abcdef  ",
  PEDERNAL_SECRETO_INVITACIONES: "  secreto-de-prueba  ",
  PEDERNAL_AUTH_SECRETO_PLATAFORMA: "  0123456789abcdef0123456789abcdef-plat  ",
  GOOGLE_CLIENT_ID_PLATAFORMA: "  cliente-de-la-consola-de-prueba  ",
  GOOGLE_CLIENT_SECRET_PLATAFORMA: "  clave-de-la-consola-de-prueba  ",
  PEDERNAL_DB_AUTENTICACION: "  postgres://usuario:contrasena-de-prueba@host.test:5432/base  ",
  PEDERNAL_HOST_DE_LA_CONSOLA: "  consola.pedernal.test  ",
};

const detalleDe = (accion: () => unknown): string => {
  try {
    accion();
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorDeEntorno);
    return (e as ErrorDeEntorno).detalleParaElRegistro();
  }
  throw new Error("tenía que fallar");
};

describe("NOMBRES_DE_ENTORNO_DE_PLATAFORMA", () => {
  it("son exactamente la cadena de plataforma, la clave de contexto, el secreto de invitaciones y lo del ingreso de la consola (secreto, Google, cadena de autenticación y host)", () => {
    expect(NOMBRES_DE_ENTORNO_DE_PLATAFORMA.map((e) => [e.nombre, e.piezas])).toEqual([
      ["PEDERNAL_DB_PLATAFORMA", ["transacciones-de-plataforma"]],
      ["PEDERNAL_CLAVE_CONTEXTO", ["transacciones-de-plataforma"]],
      ["PEDERNAL_SECRETO_INVITACIONES", ["tokens-de-plataforma"]],
      ["PEDERNAL_AUTH_SECRETO_PLATAFORMA", ["autenticacion-de-plataforma"]],
      ["GOOGLE_CLIENT_ID_PLATAFORMA", ["autenticacion-de-plataforma"]],
      ["GOOGLE_CLIENT_SECRET_PLATAFORMA", ["autenticacion-de-plataforma"]],
      ["PEDERNAL_DB_AUTENTICACION", ["conexion-de-autenticacion-de-plataforma"]],
      ["PEDERNAL_HOST_DE_LA_CONSOLA", ["host-de-la-consola"]],
    ]);
    expect(PEDERNAL_DB_PLATAFORMA).toBe("PEDERNAL_DB_PLATAFORMA");
    expect(PEDERNAL_DB_AUTENTICACION).toBe("PEDERNAL_DB_AUTENTICACION");
  });

  it("la lista de la web sigue sin nombrar la cadena de plataforma, el secreto, el cliente de Google ni el host de la consola (R10: la web no los recibe)", () => {
    const nombres = NOMBRES_DE_ENTORNO.map((e) => e.nombre) as string[];
    expect(nombres).not.toContain(PEDERNAL_DB_PLATAFORMA);
    expect(nombres).not.toContain(PEDERNAL_AUTH_SECRETO_PLATAFORMA);
    expect(nombres).not.toContain(GOOGLE_CLIENT_ID_PLATAFORMA);
    expect(nombres).not.toContain(GOOGLE_CLIENT_SECRET_PLATAFORMA);
    expect(nombres).not.toContain(PEDERNAL_HOST_DE_LA_CONSOLA);
    // El de empresa sí es de la web: y es OTRO nombre.
    expect(nombres).toContain(PEDERNAL_AUTH_SECRETO_EMPRESA);
    expect(PEDERNAL_AUTH_SECRETO_PLATAFORMA).not.toBe(PEDERNAL_AUTH_SECRETO_EMPRESA);
  });

  it("la lista de la consola solo repite de la web los nombres que la consola carga por su cuenta en su proyecto de Vercel", () => {
    const deLaWeb = NOMBRES_DE_ENTORNO.map((e) => e.nombre) as string[];
    const deLaConsola = NOMBRES_DE_ENTORNO_DE_PLATAFORMA.map((e) => e.nombre) as string[];
    expect(deLaConsola.filter((nombre) => deLaWeb.includes(nombre)).sort()).toEqual([
      "PEDERNAL_CLAVE_CONTEXTO",
      "PEDERNAL_DB_AUTENTICACION",
      "PEDERNAL_SECRETO_INVITACIONES",
    ]);
    // Los dos clientes de Google son nombres distintos: el de la consola nunca se confunde con el de la web.
    expect(GOOGLE_CLIENT_ID_PLATAFORMA).not.toBe("GOOGLE_CLIENT_ID");
    expect(GOOGLE_CLIENT_SECRET_PLATAFORMA).not.toBe("GOOGLE_CLIENT_SECRET");
  });
});

describe("valoresDeLaPiezaDePlataforma", () => {
  it("devuelve solo las variables de la pieza, sin blancos en los extremos", () => {
    expect(valoresDeLaPiezaDePlataforma(COMPLETO, "transacciones-de-plataforma")).toEqual({
      PEDERNAL_DB_PLATAFORMA: "postgres://usuario:contrasena-de-prueba@host.test:5432/base",
      PEDERNAL_CLAVE_CONTEXTO: "1:abcdef",
    });
    expect(valoresDeLaPiezaDePlataforma(COMPLETO, "tokens-de-plataforma")).toEqual({
      PEDERNAL_SECRETO_INVITACIONES: "secreto-de-prueba",
    });
  });

  it("acepta la cadena con el esquema postgresql://", () => {
    const v = valoresDeLaPiezaDePlataforma(
      { ...COMPLETO, PEDERNAL_DB_PLATAFORMA: "postgresql://u:c@host.test/base" },
      "transacciones-de-plataforma",
    );
    expect(v.PEDERNAL_DB_PLATAFORMA).toBe("postgresql://u:c@host.test/base");
  });

  it("el ingreso de la consola es de su propia pieza (secreto y cliente de Google), sin blancos en los extremos, y lo que falta se nombra sin valor", () => {
    expect(valoresDeLaPiezaDePlataforma(COMPLETO, "autenticacion-de-plataforma")).toEqual({
      PEDERNAL_AUTH_SECRETO_PLATAFORMA: "0123456789abcdef0123456789abcdef-plat",
      GOOGLE_CLIENT_ID_PLATAFORMA: "cliente-de-la-consola-de-prueba",
      GOOGLE_CLIENT_SECRET_PLATAFORMA: "clave-de-la-consola-de-prueba",
    });
    expect(detalleDe(() => valoresDeLaPiezaDePlataforma({}, "autenticacion-de-plataforma"))).toBe(
      "pieza autenticacion-de-plataforma: PEDERNAL_AUTH_SECRETO_PLATAFORMA falta; GOOGLE_CLIENT_ID_PLATAFORMA falta; GOOGLE_CLIENT_SECRET_PLATAFORMA falta",
    );
    expect(
      detalleDe(() =>
        valoresDeLaPiezaDePlataforma(
          { ...COMPLETO, PEDERNAL_AUTH_SECRETO_PLATAFORMA: "   " },
          "autenticacion-de-plataforma",
        ),
      ),
    ).toBe("pieza autenticacion-de-plataforma: PEDERNAL_AUTH_SECRETO_PLATAFORMA inválida");
    expect(
      detalleDe(() =>
        valoresDeLaPiezaDePlataforma(
          { ...COMPLETO, GOOGLE_CLIENT_ID_PLATAFORMA: " ", GOOGLE_CLIENT_SECRET_PLATAFORMA: "" },
          "autenticacion-de-plataforma",
        ),
      ),
    ).toBe(
      "pieza autenticacion-de-plataforma: GOOGLE_CLIENT_ID_PLATAFORMA inválida; GOOGLE_CLIENT_SECRET_PLATAFORMA inválida",
    );
  });

  it("la cadena de autenticación es de su propia pieza (el barrido no pide ni el secreto ni Google), con la forma de una cadena de Postgres", () => {
    expect(
      valoresDeLaPiezaDePlataforma(COMPLETO, "conexion-de-autenticacion-de-plataforma"),
    ).toEqual({
      PEDERNAL_DB_AUTENTICACION: "postgres://usuario:contrasena-de-prueba@host.test:5432/base",
    });
    expect(
      detalleDe(() => valoresDeLaPiezaDePlataforma({}, "conexion-de-autenticacion-de-plataforma")),
    ).toBe("pieza conexion-de-autenticacion-de-plataforma: PEDERNAL_DB_AUTENTICACION falta");
    for (const cadena of ["https://ejemplo.test/base", "host.test/base", "", "  "]) {
      expect(
        detalleDe(() =>
          valoresDeLaPiezaDePlataforma(
            { PEDERNAL_DB_AUTENTICACION: cadena },
            "conexion-de-autenticacion-de-plataforma",
          ),
        ),
      ).toBe("pieza conexion-de-autenticacion-de-plataforma: PEDERNAL_DB_AUTENTICACION inválida");
    }
  });

  it("el host de la consola es de su propia pieza, sin blancos en los extremos; falta o en blanco se nombra sin valor", () => {
    expect(valoresDeLaPiezaDePlataforma(COMPLETO, "host-de-la-consola")).toEqual({
      PEDERNAL_HOST_DE_LA_CONSOLA: "consola.pedernal.test",
    });
    expect(detalleDe(() => valoresDeLaPiezaDePlataforma({}, "host-de-la-consola"))).toBe(
      "pieza host-de-la-consola: PEDERNAL_HOST_DE_LA_CONSOLA falta",
    );
    expect(
      detalleDe(() =>
        valoresDeLaPiezaDePlataforma({ PEDERNAL_HOST_DE_LA_CONSOLA: "  " }, "host-de-la-consola"),
      ),
    ).toBe("pieza host-de-la-consola: PEDERNAL_HOST_DE_LA_CONSOLA inválida");
  });

  it("el secreto de la consola, validado con la misma exigencia que el de empresa y nunca igual a él", () => {
    const valores = valoresDeLaPiezaDePlataforma(COMPLETO, "autenticacion-de-plataforma");
    const secreto = valores.PEDERNAL_AUTH_SECRETO_PLATAFORMA;
    expect(leerSecretoDeAutenticacionDePlataforma(secreto)).toBe(secreto);
    expect(
      leerSecretoDeAutenticacionDePlataforma(
        secreto,
        "otro-secreto-de-empresa-distinto-1234567890",
      ),
    ).toBe(secreto);
    // Si el entorno tiene a la vista el de empresa y es el mismo, no se arma.
    expect(() => leerSecretoDeAutenticacionDePlataforma(secreto, `  ${secreto}  `)).toThrow(
      "PEDERNAL_AUTH_SECRETO_PLATAFORMA inválido: no puede ser igual a PEDERNAL_AUTH_SECRETO_EMPRESA",
    );
  });

  it("una pieza no exige las variables de la otra", () => {
    expect(
      valoresDeLaPiezaDePlataforma({ PEDERNAL_SECRETO_INVITACIONES: "x" }, "tokens-de-plataforma"),
    ).toEqual({ PEDERNAL_SECRETO_INVITACIONES: "x" });
    expect(
      valoresDeLaPiezaDePlataforma(
        { PEDERNAL_HOST_DE_LA_CONSOLA: "consola.pedernal.test" },
        "host-de-la-consola",
      ),
    ).toEqual({ PEDERNAL_HOST_DE_LA_CONSOLA: "consola.pedernal.test" });
  });

  it("con las variables prohibidas presentes ninguna pieza del ingreso de la consola arma nada", () => {
    for (const pieza of [
      "autenticacion-de-plataforma",
      "conexion-de-autenticacion-de-plataforma",
      "host-de-la-consola",
    ] as const) {
      expect(
        detalleDe(() =>
          valoresDeLaPiezaDePlataforma({ ...COMPLETO, BETTER_AUTH_SECRET: CENTINELA }, pieza),
        ),
        pieza,
      ).toBe("variables prohibidas presentes: BETTER_AUTH_SECRET");
    }
  });

  it("con el entorno vacío falla cerrado y nombra TODO lo que falta, solo en el detalle", () => {
    expect(detalleDe(() => valoresDeLaPiezaDePlataforma({}, "transacciones-de-plataforma"))).toBe(
      "pieza transacciones-de-plataforma: PEDERNAL_DB_PLATAFORMA falta; PEDERNAL_CLAVE_CONTEXTO falta",
    );
    expect(detalleDe(() => valoresDeLaPiezaDePlataforma({}, "tokens-de-plataforma"))).toBe(
      "pieza tokens-de-plataforma: PEDERNAL_SECRETO_INVITACIONES falta",
    );
  });

  it("el mensaje público del error es genérico: no nombra variables", () => {
    try {
      valoresDeLaPiezaDePlataforma({}, "transacciones-de-plataforma");
    } catch (e) {
      expect((e as Error).message).toBe("el entorno del servidor no está bien configurado");
    }
  });

  it.each([
    ["una cadena que no es de Postgres", "https://ejemplo.test/base"],
    ["una cadena sin esquema", "host.test/base"],
    ["una cadena vacía", ""],
    ["una cadena en blanco", "   "],
    ["una cadena con espacios adentro", "postgres://usuario:con espacio@host.test/base"],
  ])("rechaza %s sin repetir su valor", (_cual, cadena) => {
    const detalle = detalleDe(() =>
      valoresDeLaPiezaDePlataforma(
        { ...COMPLETO, PEDERNAL_DB_PLATAFORMA: cadena },
        "transacciones-de-plataforma",
      ),
    );
    expect(detalle).toBe("pieza transacciones-de-plataforma: PEDERNAL_DB_PLATAFORMA inválida");
  });

  it("una clave de contexto en blanco es inválida (el formato fino lo valida el adaptador)", () => {
    expect(
      detalleDe(() =>
        valoresDeLaPiezaDePlataforma(
          { ...COMPLETO, PEDERNAL_CLAVE_CONTEXTO: "   " },
          "transacciones-de-plataforma",
        ),
      ),
    ).toBe("pieza transacciones-de-plataforma: PEDERNAL_CLAVE_CONTEXTO inválida");
  });

  it("con una variable prohibida presente no arma nada y no repite su valor", () => {
    const detalle = detalleDe(() =>
      valoresDeLaPiezaDePlataforma(
        { ...COMPLETO, DATABASE_URL: CENTINELA, POSTGRES_URL: CENTINELA },
        "transacciones-de-plataforma",
      ),
    );
    expect(detalle).toBe("variables prohibidas presentes: DATABASE_URL, POSTGRES_URL");
    expect(detalle).not.toContain(CENTINELA);
  });
});
