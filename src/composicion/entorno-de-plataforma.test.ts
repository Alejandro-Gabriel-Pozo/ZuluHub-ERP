import { describe, expect, it } from "vitest";
import { ErrorDeEntorno, NOMBRES_DE_ENTORNO, type FuenteDeEntorno } from "./entorno";
import {
  PEDERNAL_AUTH_SECRETO_EMPRESA,
  PEDERNAL_AUTH_SECRETO_PLATAFORMA,
  leerSecretoDeAutenticacionDePlataforma,
} from "../adaptadores/autenticacion/configuracion";
import {
  NOMBRES_DE_ENTORNO_DE_PLATAFORMA,
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
  it("son exactamente la cadena de plataforma, la clave de contexto, el secreto de invitaciones y el secreto de ingreso de la consola", () => {
    expect(NOMBRES_DE_ENTORNO_DE_PLATAFORMA.map((e) => [e.nombre, e.piezas])).toEqual([
      ["PEDERNAL_DB_PLATAFORMA", ["transacciones-de-plataforma"]],
      ["PEDERNAL_CLAVE_CONTEXTO", ["transacciones-de-plataforma"]],
      ["PEDERNAL_SECRETO_INVITACIONES", ["tokens-de-plataforma"]],
      ["PEDERNAL_AUTH_SECRETO_PLATAFORMA", ["autenticacion-de-plataforma"]],
    ]);
    expect(PEDERNAL_DB_PLATAFORMA).toBe("PEDERNAL_DB_PLATAFORMA");
  });

  it("la lista de la web sigue sin nombrar la cadena de plataforma ni el secreto de la consola (R10: la web no los recibe)", () => {
    const nombres = NOMBRES_DE_ENTORNO.map((e) => e.nombre) as string[];
    expect(nombres).not.toContain(PEDERNAL_DB_PLATAFORMA);
    expect(nombres).not.toContain(PEDERNAL_AUTH_SECRETO_PLATAFORMA);
    // El de empresa sí es de la web: y es OTRO nombre.
    expect(nombres).toContain(PEDERNAL_AUTH_SECRETO_EMPRESA);
    expect(PEDERNAL_AUTH_SECRETO_PLATAFORMA).not.toBe(PEDERNAL_AUTH_SECRETO_EMPRESA);
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

  it("el secreto de la consola es de su propia pieza, sin blancos en los extremos, y falta se nombra sin valor", () => {
    expect(valoresDeLaPiezaDePlataforma(COMPLETO, "autenticacion-de-plataforma")).toEqual({
      PEDERNAL_AUTH_SECRETO_PLATAFORMA: "0123456789abcdef0123456789abcdef-plat",
    });
    expect(detalleDe(() => valoresDeLaPiezaDePlataforma({}, "autenticacion-de-plataforma"))).toBe(
      "pieza autenticacion-de-plataforma: PEDERNAL_AUTH_SECRETO_PLATAFORMA falta",
    );
    expect(
      detalleDe(() =>
        valoresDeLaPiezaDePlataforma(
          { PEDERNAL_AUTH_SECRETO_PLATAFORMA: "   " },
          "autenticacion-de-plataforma",
        ),
      ),
    ).toBe("pieza autenticacion-de-plataforma: PEDERNAL_AUTH_SECRETO_PLATAFORMA inválida");
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
