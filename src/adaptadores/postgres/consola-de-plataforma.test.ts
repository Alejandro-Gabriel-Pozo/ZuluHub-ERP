import { describe, expect, it } from "vitest";
import {
  aplicarCambioDeLaConsola,
  kidDeLaClaveNueva,
  leerEstadoDeLaConsola,
  type CambioDeLaConsola,
} from "./consola-de-plataforma";
import type { ClienteDeBase } from "./login-temporal-de-plataforma";

const DUENO = "postgres://dueno:clave@ep-uno.sa-east-1.aws.neon.tech/base";
const CLAVE = { kid: 3, secreto: Buffer.from("ab".repeat(32), "hex") };

function clienteFalso(respuestas: Record<string, Record<string, unknown>[]> = {}) {
  const sentencias: string[] = [];
  const cliente: ClienteDeBase = {
    connect: () => Promise.resolve(undefined),
    end: () => Promise.resolve(undefined),
    query: (texto) => {
      sentencias.push(texto.replace(/\s+/g, " ").trim().slice(0, 40));
      const clave = Object.keys(respuestas).find((k) => texto.includes(k));
      return Promise.resolve({ rows: clave === undefined ? [] : (respuestas[clave] ?? []) });
    },
  };
  return { cliente, sentencias };
}

const CAMBIO: CambioDeLaConsola = {
  claveDeContexto: CLAVE,
  loginsNuevos: [{ rol: "pedernal_plataforma", clave: "una-clave" }],
  renovar: ["pedernal_autenticacion_plataforma"],
};
const RESPUESTAS = {
  "secreto = decode": [{ igual: true, vigente: true }],
  "ALTER ROLE": [{ sentencia: "SELECT 1" }],
};

describe("consola de plataforma (base)", () => {
  it("el kid nuevo es el siguiente al más alto y nunca menor que 3", () => {
    expect(kidDeLaClaveNueva(null)).toBe(3);
    expect(kidDeLaClaveNueva(1)).toBe(3);
    expect(kidDeLaClaveNueva(2)).toBe(3);
    expect(kidDeLaClaveNueva(9)).toBe(10);
  });

  it("confirma solo si lo que se hace mientras la transacción está abierta sale bien", async () => {
    const f = clienteFalso(RESPUESTAS);
    expect(
      await aplicarCambioDeLaConsola(DUENO, CAMBIO, () => Promise.resolve(true), {
        crearCliente: () => f.cliente,
      }),
    ).toBe(true);
    expect(f.sentencias[0]).toBe("BEGIN");
    expect(f.sentencias.at(-1)).toBe("COMMIT");
  });

  it("si no sale bien (false o falla), deshace y no confirma", async () => {
    const a = clienteFalso(RESPUESTAS);
    expect(
      await aplicarCambioDeLaConsola(DUENO, CAMBIO, () => Promise.resolve(false), {
        crearCliente: () => a.cliente,
      }),
    ).toBe(false);
    expect(a.sentencias.at(-1)).toBe("ROLLBACK");
    expect(a.sentencias).not.toContain("COMMIT");
    const b = clienteFalso(RESPUESTAS);
    await expect(
      aplicarCambioDeLaConsola(DUENO, CAMBIO, () => Promise.reject(new Error("x")), {
        crearCliente: () => b.cliente,
      }),
    ).rejects.toThrow("x");
    expect(b.sentencias.at(-1)).toBe("ROLLBACK");
  });

  it("la clave ya instalada con otro secreto, o revocada, deshace y no toca ningún rol", async () => {
    for (const fila of [
      { igual: false, vigente: true },
      { igual: true, vigente: false },
    ]) {
      const f = clienteFalso({ ...RESPUESTAS, "secreto = decode": [fila] });
      await expect(
        aplicarCambioDeLaConsola(DUENO, CAMBIO, () => Promise.resolve(true), {
          crearCliente: () => f.cliente,
        }),
      ).rejects.toThrow();
      expect(f.sentencias.some((s) => s.startsWith("SELECT format("))).toBe(false);
      expect(f.sentencias.at(-1)).toBe("ROLLBACK");
    }
  });

  it("no toca un rol que no es de la consola, ni usa el pooler, antes de abrir nada", async () => {
    const f = clienteFalso(RESPUESTAS);
    await expect(
      aplicarCambioDeLaConsola(
        DUENO,
        { claveDeContexto: null, loginsNuevos: [{ rol: "pedernal_app", clave: "x" }], renovar: [] },
        () => Promise.resolve(true),
        { crearCliente: () => f.cliente },
      ),
    ).rejects.toThrow("no es uno de los de la consola");
    await expect(
      aplicarCambioDeLaConsola(
        "postgres://u:p@ep-uno-pooler.sa-east-1.aws.neon.tech/b",
        CAMBIO,
        () => Promise.resolve(true),
        {
          crearCliente: () => f.cliente,
        },
      ),
    ).rejects.toThrow("pooler");
    expect(f.sentencias).toEqual([]);
  });

  it("lee el kid más alto y si cada rol existe y puede entrar", async () => {
    const f = clienteFalso({
      "max(kid)": [{ maximo: 4 }],
      pg_roles: [{ rolname: "pedernal_plataforma", rolcanlogin: true }],
    });
    expect(await leerEstadoDeLaConsola(DUENO, { crearCliente: () => f.cliente })).toEqual({
      kidMaximo: 4,
      roles: {
        pedernal_plataforma: { existe: true, puedeEntrar: true },
        pedernal_autenticacion_plataforma: { existe: false, puedeEntrar: false },
      },
    });
  });
});
