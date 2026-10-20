import { describe, expect, it, vi } from "vitest";
import type { TrabajoTomado } from "../../../puertos/cola-de-trabajos";
import type { RevocacionDeSesiones } from "../../../puertos/revocacion-de-sesiones";
import { TRABAJO_REVOCAR_SESIONES, claveDeRevocacionDeSesiones } from "./contrato";
import { crearManejadorDeRevocarSesiones } from "./revocar-sesiones";

/** El manejador de `revocar_sesiones` con una revocación de mentira. Con la base real: `test/integracion/consola-revocacion.test.ts`. */

const AHORA = new Date("2026-10-20T12:00:00.000Z");
const USUARIO = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const trabajo = (datos: TrabajoTomado["datos"]): TrabajoTomado => ({
  id: "trabajo-1",
  empresaId: null,
  tipo: TRABAJO_REVOCAR_SESIONES,
  datos,
  intentos: 1,
});

function armar(borradas = 2) {
  const revocarDelUsuario = vi.fn((usuario: string) => {
    void usuario;
    return Promise.resolve(borradas);
  });
  const revocacion = vi.fn((): RevocacionDeSesiones => ({ revocarDelUsuario }));
  return {
    manejador: crearManejadorDeRevocarSesiones({ revocacion }),
    revocacion,
    revocarDelUsuario,
  };
}

describe("los nombres del trabajo", () => {
  it("el tipo y la clave de idempotencia (persona:<id>:suspension:<clave del pedido>)", () => {
    expect(TRABAJO_REVOCAR_SESIONES).toBe("revocar_sesiones");
    expect(claveDeRevocacionDeSesiones("p-1", "clave-1")).toBe("persona:p-1:suspension:clave-1");
  });
});

describe("el manejador de revocar_sesiones", () => {
  it("borra las sesiones del usuario y termina HECHO, con cuántas borró y nada del usuario", async () => {
    const { manejador, revocarDelUsuario } = armar(3);
    const r = await manejador(trabajo({ usuarioAuthId: USUARIO }), AHORA);
    expect(r).toEqual({ tipo: "HECHO", nota: "sesiones revocadas: 3" });
    expect(revocarDelUsuario).toHaveBeenCalledExactlyOnceWith(USUARIO);
    expect(JSON.stringify(r)).not.toContain(USUARIO);
  });

  it("si no hay sesiones no falla: HECHO con cero (idempotente, se puede repetir)", async () => {
    const { manejador } = armar(0);
    const dato = trabajo({ usuarioAuthId: USUARIO });
    expect(await manejador(dato, AHORA)).toEqual({ tipo: "HECHO", nota: "sesiones revocadas: 0" });
    expect(await manejador(dato, AHORA)).toEqual({ tipo: "HECHO", nota: "sesiones revocadas: 0" });
  });

  it.each([
    ["sin el dato", {}],
    ["con el dato vacío", { usuarioAuthId: "" }],
    ["con un texto que no es uuid", { usuarioAuthId: "no-es-un-uuid" }],
    ["con un número", { usuarioAuthId: 5 }],
    ["con un nulo", { usuarioAuthId: null }],
    ["con un objeto", { usuarioAuthId: { id: USUARIO } }],
    ["con el dato en otro campo", { usuario: USUARIO }],
  ])("%s: falla DEFINITIVO sin tocar nada (reintentar no lo arregla)", async (_cual, datos) => {
    const { manejador, revocarDelUsuario } = armar();
    const r = await manejador(trabajo(datos), AHORA);
    expect(r).toEqual({
      tipo: "ERROR",
      error: "los datos del trabajo no traen un usuarioAuthId válido",
      definitivo: true,
    });
    expect(revocarDelUsuario).not.toHaveBeenCalled();
  });

  it("un fallo de la base se propaga: el procesador lo reintenta", async () => {
    const revocacion = (): RevocacionDeSesiones => ({
      revocarDelUsuario: () => Promise.reject(new Error("la base no responde")),
    });
    const manejador = crearManejadorDeRevocarSesiones({ revocacion });
    await expect(manejador(trabajo({ usuarioAuthId: USUARIO }), AHORA)).rejects.toThrow(
      "la base no responde",
    );
  });

  it("la conexión se pide recién al ejecutar el trabajo (armar el manejador no exige la base)", async () => {
    const { manejador, revocacion } = armar();
    expect(revocacion).not.toHaveBeenCalled();
    await manejador(trabajo({ usuarioAuthId: USUARIO }), AHORA);
    expect(revocacion).toHaveBeenCalledOnce();
    await manejador(trabajo({}), AHORA);
    expect(revocacion).toHaveBeenCalledOnce();
  });
});
