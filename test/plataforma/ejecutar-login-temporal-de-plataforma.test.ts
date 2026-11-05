import { describe, expect, it, vi } from "vitest";
import {
  ejecutarLoginTemporal,
  type EntradaDeLoginTemporal,
} from "../../scripts/ejecutar-login-temporal-de-plataforma";

/**
 * Los dos pasos del login temporal del rol de plataforma con todo inyectado (sin base): `abrir` instala la clave de
 * contexto de la corrida, abre el login y entrega las dos variables por `GITHUB_ENV` ya enmascaradas; `cerrar` lo
 * cierra y falla fuerte si no queda cerrado. Ningún secreto sale por la salida.
 */

const DUENO =
  "postgres://dueno-centinela:clave-dueno-centinela@ep-prueba-1.sa-east-1.aws.neon.tech/base";
const CADENA_ROL =
  "postgres://pedernal_plataforma:clave-rol-centinela@ep-prueba-1.sa-east-1.aws.neon.tech/base";
const SECRETO_HEX = "ab".repeat(32);

function armar(cambios: Partial<EntradaDeLoginTemporal> = {}) {
  const salida: string[] = [];
  const errores: string[] = [];
  const comandos: string[] = [];
  const entorno: string[] = [];
  const llamadas: string[] = [];
  const entrada: EntradaDeLoginTemporal = {
    accion: "abrir",
    entorno: { PEDERNAL_DB_MIGRACIONES: DUENO, GITHUB_ACTIONS: "true", GITHUB_ENV: "/ruta/env" },
    info: (l) => salida.push(l),
    error: (l) => errores.push(l),
    comando: (l) => comandos.push(l),
    agregarAlEntorno: (ruta, texto) => {
      entorno.push(`${ruta}|${texto}`);
      return Promise.resolve();
    },
    instalarClave: vi.fn((_cadena: string, clave: { kid: number }) => {
      llamadas.push(`instalar:${clave.kid}`);
      return Promise.resolve();
    }),
    abrir: vi.fn(() => {
      llamadas.push("abrir");
      return Promise.resolve({ cadena: CADENA_ROL, clave: "clave-rol-centinela" });
    }),
    cerrar: vi.fn(() => {
      llamadas.push("cerrar");
      return Promise.resolve({ claveVerificada: true });
    }),
    bytesAlAzar: () => Buffer.from(SECRETO_HEX, "hex"),
    kidAlAzar: () => 12345,
    ...cambios,
  };
  return {
    entrada,
    salida,
    errores,
    comandos,
    entorno,
    llamadas,
    texto: () => [...salida, ...errores].join("\n"),
  };
}

describe("login temporal: abrir", () => {
  it("instala la clave de contexto, abre el login y entrega las variables enmascaradas por GITHUB_ENV", async () => {
    const t = armar();
    expect(await ejecutarLoginTemporal(t.entrada)).toBe(0);
    expect(t.llamadas).toEqual(["instalar:12345", "abrir"]);
    expect(t.entorno).toEqual([
      `/ruta/env|PEDERNAL_DB_PLATAFORMA=${CADENA_ROL}\nPEDERNAL_CLAVE_CONTEXTO=12345:${SECRETO_HEX}\n`,
    ]);
    // Cada valor se entrega al runner con ::add-mask:: ANTES de escribirlo al entorno.
    expect(t.comandos).toEqual(
      expect.arrayContaining([
        `::add-mask::${SECRETO_HEX}`,
        `::add-mask::12345:${SECRETO_HEX}`,
        `::add-mask::clave-rol-centinela`,
        `::add-mask::${CADENA_ROL}`,
      ]),
    );
  });

  it("ningún secreto sale por la salida", async () => {
    const t = armar();
    await ejecutarLoginTemporal(t.entrada);
    for (const prohibido of [
      "dueno-centinela",
      "clave-dueno-centinela",
      "clave-rol-centinela",
      SECRETO_HEX,
      CADENA_ROL,
    ]) {
      expect(t.texto()).not.toContain(prohibido);
    }
  });

  it("fuera de GitHub Actions no hace nada (no hay GITHUB_ENV)", async () => {
    const t = armar({ entorno: { PEDERNAL_DB_MIGRACIONES: DUENO } });
    expect(await ejecutarLoginTemporal(t.entrada)).toBe(1);
    expect(t.llamadas).toEqual([]);
  });

  it("si falla al abrir, falla y no entrega variables (el cierre corre aparte)", async () => {
    const t = armar({ abrir: () => Promise.reject(new Error(`falla con ${DUENO}`)) });
    expect(await ejecutarLoginTemporal(t.entrada)).toBe(1);
    expect(t.entorno).toEqual([]);
    expect(t.texto()).not.toContain("clave-dueno-centinela");
  });

  it("con la cadena del pooler o sin cadena, falla sin tocar nada", async () => {
    for (const cadena of [DUENO.replace("ep-prueba-1", "ep-prueba-1-pooler"), undefined]) {
      const t = armar({
        entorno: { PEDERNAL_DB_MIGRACIONES: cadena, GITHUB_ACTIONS: "true", GITHUB_ENV: "/x" },
      });
      expect(await ejecutarLoginTemporal(t.entrada)).toBe(1);
      expect(t.llamadas).toEqual([]);
    }
  });

  it("una acción desconocida falla", async () => {
    const t = armar({ accion: "otra" });
    expect(await ejecutarLoginTemporal(t.entrada)).toBe(1);
    expect(t.llamadas).toEqual([]);
  });
});

describe("login temporal: cerrar", () => {
  it("cierra y lo dice; sirve fuera de Actions y sin GITHUB_ENV", async () => {
    const t = armar({ accion: "cerrar", entorno: { PEDERNAL_DB_MIGRACIONES: DUENO } });
    expect(await ejecutarLoginTemporal(t.entrada)).toBe(0);
    expect(t.llamadas).toEqual(["cerrar"]);
    expect(t.salida.join("\n")).toContain("CERRADO");
  });

  it("si el cierre no queda verificado, falla fuerte (código 1) sin repetir secretos", async () => {
    const t = armar({
      accion: "cerrar",
      cerrar: () => Promise.reject(new Error(`sigue abierto ${DUENO}`)),
    });
    expect(await ejecutarLoginTemporal(t.entrada)).toBe(1);
    expect(t.texto()).not.toContain("clave-dueno-centinela");
  });
});
