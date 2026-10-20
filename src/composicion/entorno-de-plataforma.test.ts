import { describe, expect, it } from "vitest";
import { ErrorDeEntorno, NOMBRES_DE_ENTORNO, type FuenteDeEntorno } from "./entorno";
import {
  NOMBRES_DE_ENTORNO_DE_PLATAFORMA,
  ZULUHUB_DB_PLATAFORMA,
  valoresDeLaPiezaDePlataforma,
} from "./entorno-de-plataforma";

/** Valores inventados y reconocibles: lo que se prueba es la forma de la validación y que ningún error los repita. */
const CENTINELA = "valor-secreto-de-prueba-123";

const COMPLETO: FuenteDeEntorno = {
  ZULUHUB_DB_PLATAFORMA: "  postgres://usuario:contrasena-de-prueba@host.test:5432/base  ",
  ZULUHUB_CLAVE_CONTEXTO: "  1:abcdef  ",
  ZULUHUB_SECRETO_INVITACIONES: "  secreto-de-prueba  ",
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
  it("son exactamente la cadena de plataforma, la clave de contexto y el secreto de invitaciones", () => {
    expect(NOMBRES_DE_ENTORNO_DE_PLATAFORMA.map((e) => [e.nombre, e.piezas])).toEqual([
      ["ZULUHUB_DB_PLATAFORMA", ["transacciones-de-plataforma"]],
      ["ZULUHUB_CLAVE_CONTEXTO", ["transacciones-de-plataforma"]],
      ["ZULUHUB_SECRETO_INVITACIONES", ["tokens-de-plataforma"]],
    ]);
    expect(ZULUHUB_DB_PLATAFORMA).toBe("ZULUHUB_DB_PLATAFORMA");
  });

  it("la lista de la web sigue sin nombrar la cadena de plataforma (R10: la web no la recibe)", () => {
    expect(NOMBRES_DE_ENTORNO.map((e) => e.nombre)).not.toContain(ZULUHUB_DB_PLATAFORMA);
  });
});

describe("valoresDeLaPiezaDePlataforma", () => {
  it("devuelve solo las variables de la pieza, sin blancos en los extremos", () => {
    expect(valoresDeLaPiezaDePlataforma(COMPLETO, "transacciones-de-plataforma")).toEqual({
      ZULUHUB_DB_PLATAFORMA: "postgres://usuario:contrasena-de-prueba@host.test:5432/base",
      ZULUHUB_CLAVE_CONTEXTO: "1:abcdef",
    });
    expect(valoresDeLaPiezaDePlataforma(COMPLETO, "tokens-de-plataforma")).toEqual({
      ZULUHUB_SECRETO_INVITACIONES: "secreto-de-prueba",
    });
  });

  it("acepta la cadena con el esquema postgresql://", () => {
    const v = valoresDeLaPiezaDePlataforma(
      { ...COMPLETO, ZULUHUB_DB_PLATAFORMA: "postgresql://u:c@host.test/base" },
      "transacciones-de-plataforma",
    );
    expect(v.ZULUHUB_DB_PLATAFORMA).toBe("postgresql://u:c@host.test/base");
  });

  it("una pieza no exige las variables de la otra", () => {
    expect(
      valoresDeLaPiezaDePlataforma({ ZULUHUB_SECRETO_INVITACIONES: "x" }, "tokens-de-plataforma"),
    ).toEqual({ ZULUHUB_SECRETO_INVITACIONES: "x" });
  });

  it("con el entorno vacío falla cerrado y nombra TODO lo que falta, solo en el detalle", () => {
    expect(detalleDe(() => valoresDeLaPiezaDePlataforma({}, "transacciones-de-plataforma"))).toBe(
      "pieza transacciones-de-plataforma: ZULUHUB_DB_PLATAFORMA falta; ZULUHUB_CLAVE_CONTEXTO falta",
    );
    expect(detalleDe(() => valoresDeLaPiezaDePlataforma({}, "tokens-de-plataforma"))).toBe(
      "pieza tokens-de-plataforma: ZULUHUB_SECRETO_INVITACIONES falta",
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
        { ...COMPLETO, ZULUHUB_DB_PLATAFORMA: cadena },
        "transacciones-de-plataforma",
      ),
    );
    expect(detalle).toBe("pieza transacciones-de-plataforma: ZULUHUB_DB_PLATAFORMA inválida");
  });

  it("una clave de contexto en blanco es inválida (el formato fino lo valida el adaptador)", () => {
    expect(
      detalleDe(() =>
        valoresDeLaPiezaDePlataforma(
          { ...COMPLETO, ZULUHUB_CLAVE_CONTEXTO: "   " },
          "transacciones-de-plataforma",
        ),
      ),
    ).toBe("pieza transacciones-de-plataforma: ZULUHUB_CLAVE_CONTEXTO inválida");
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
