import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, agregar, corregir, desactivar, reactivar } = vi.hoisted(() => ({
  exigirAcceso: vi.fn(),
  agregar: vi.fn(),
  corregir: vi.fn(),
  desactivar: vi.fn(),
  reactivar: vi.fn(),
}));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import {
  agregarValorDeConsola,
  corregirNombreDeConsola,
  desactivarValorDeConsola,
  reactivarValorDeConsola,
} from "../../apps/plataforma/servidor/acciones-listas";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR } from "../../src/modulos/listas/publico";

/**
 * Las acciones de la pantalla Listas (la frontera entre el navegador y los casos de uso): `exigirAcceso` y los casos van simulados. Se prueba lo que la acción
 * garantiza: pasa la clave del navegador tal cual, traduce los errores con el contexto de listas, relanza la redirección de Next y no deja entrar entradas inválidas.
 */

const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const VALOR = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";

const AGREGAR = { claveDeIdempotencia: CLAVE, lista: "marcas", nombre: "Tarjeta Sol" };
const CORREGIR = {
  claveDeIdempotencia: CLAVE,
  valorId: VALOR,
  nombre: "Cabal",
  versionEsperada: 2,
};
const ESTADO = { claveDeIdempotencia: CLAVE, valorId: VALOR, versionEsperada: 2 };

const redireccion = () =>
  Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/ingreso;307;" });

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  for (const f of [exigirAcceso, agregar, corregir, desactivar, reactivar]) f.mockReset();
  exigirAcceso.mockResolvedValue({
    casos: {
      agregarValorDeLista: agregar,
      corregirNombreDeValor: corregir,
      desactivarValorDeLista: desactivar,
      reactivarValorDeLista: reactivar,
    },
  });
  agregar.mockResolvedValue({ ok: true, valor: { valorId: VALOR, version: 1 } });
  corregir.mockResolvedValue({ ok: true, valor: { version: 3, sinCambios: false } });
  desactivar.mockResolvedValue({ ok: true, valor: { version: 3, yaEstabaInactivo: false } });
  reactivar.mockResolvedValue({ ok: true, valor: { version: 4, yaEstabaActivo: false } });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  registro.mockRestore();
});

describe("agregarValorDeConsola", () => {
  it("camino feliz: manda al caso la clave, la lista del dominio y el nombre; devuelve la versión", async () => {
    expect(await agregarValorDeConsola(AGREGAR)).toEqual({ ok: true, dato: { version: 1 } });
    expect(agregar).toHaveBeenCalledWith({
      claveDeIdempotencia: CLAVE,
      lista: "MARCAS_DE_TARJETA",
      nombre: "Tarjeta Sol",
    });
  });

  it("clic doble: la MISMA clave llega al caso las dos veces y el resultado es el mismo", async () => {
    const [a, b] = await Promise.all([
      agregarValorDeConsola(AGREGAR),
      agregarValorDeConsola(AGREGAR),
    ]);
    expect(a).toEqual(b);
    expect(
      agregar.mock.calls.map(([p]) => (p as { claveDeIdempotencia: string }).claveDeIdempotencia),
    ).toEqual([CLAVE, CLAVE]);
  });

  it("el nombre repetido sale en el campo «Nombre» con el texto aprobado, sin el código", async () => {
    agregar.mockResolvedValue({ ok: false, error: "VALOR_DUPLICADO" });
    const r = await agregarValorDeConsola(AGREGAR);
    expect(r).toEqual({
      ok: false,
      error: { tipo: "CAMPO", campo: "nombre", texto: "Ya existe un valor con ese nombre" },
    });
    expect(JSON.stringify(r)).not.toContain("VALOR_DUPLICADO");
  });

  it("un nombre inválido sale en el campo «Nombre» con el tope del dominio (no escrito a mano)", async () => {
    agregar.mockResolvedValue({ ok: false, error: "NOMBRE_INVALIDO" });
    expect(await agregarValorDeConsola(AGREGAR)).toEqual({
      ok: false,
      error: {
        tipo: "CAMPO",
        campo: "nombre",
        texto: `Escribí un nombre de hasta ${String(LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR)} caracteres`,
      },
    });
  });

  it("segundo factor: la puerta lo pide y la acción lo devuelve tal cual, sin registrar una falla", async () => {
    agregar.mockResolvedValue({ ok: false, error: "segundo_factor_reciente_requerido" });
    expect(await agregarValorDeConsola(AGREGAR)).toEqual({
      ok: false,
      error: { tipo: "SEGUNDO_FACTOR" },
    });
    expect(registro).not.toHaveBeenCalled();
  });

  it("sin permiso: la acción se oculta (no hay texto ni código)", async () => {
    agregar.mockResolvedValue({ ok: false, error: "SIN_PERMISO" });
    expect(await agregarValorDeConsola(AGREGAR)).toEqual({
      ok: false,
      error: { tipo: "OCULTAR_ACCION" },
    });
  });

  it.each([
    null,
    undefined,
    {},
    { ...AGREGAR, lista: "otra" },
    { ...AGREGAR, claveDeIdempotencia: "x" },
    { ...AGREGAR, nombre: 3 },
  ])("una entrada inválida (%j) no llega al caso ni pide acceso", async (entrada) => {
    expect(await agregarValorDeConsola(entrada)).toEqual({
      ok: false,
      error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
    });
    expect(agregar).not.toHaveBeenCalled();
    expect(exigirAcceso).not.toHaveBeenCalled();
  });

  it("un fallo inesperado sale con referencia y sin el pedido; el detalle va al registro del servidor", async () => {
    agregar.mockRejectedValue(new Error("detalle interno con Tarjeta Sol"));
    const r = await agregarValorDeConsola(AGREGAR);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("detalle interno");
    expect(registro).toHaveBeenCalledTimes(1);
  });

  it("un resultado de error que no se reconoce es inesperado (no se muestra el código)", async () => {
    agregar.mockResolvedValue({ ok: false, error: "CODIGO_QUE_NO_EXISTE" });
    const r = await agregarValorDeConsola(AGREGAR);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("CODIGO_QUE_NO_EXISTE");
  });

  it("NEXT_REDIRECT (de exigirAcceso o del caso) se relanza tal cual y no se registra como falla", async () => {
    const r = redireccion();
    exigirAcceso.mockRejectedValueOnce(r);
    await expect(agregarValorDeConsola(AGREGAR)).rejects.toBe(r);
    expect(agregar).not.toHaveBeenCalled();
    agregar.mockRejectedValueOnce(r);
    await expect(agregarValorDeConsola(AGREGAR)).rejects.toBe(r);
    expect(registro).not.toHaveBeenCalled();
  });
});

describe("corregirNombreDeConsola", () => {
  it("manda al caso la clave, el valor, el nombre y la versión que la pantalla vio", async () => {
    expect(await corregirNombreDeConsola(CORREGIR)).toEqual({ ok: true, dato: { version: 3 } });
    expect(corregir).toHaveBeenCalledWith(CORREGIR);
  });

  it("el valor fijo, el idioma de la pantalla vieja y la versión vieja salen con textos que ya existen", async () => {
    corregir.mockResolvedValue({ ok: false, error: "VALOR_FIJO" });
    expect(await corregirNombreDeConsola(CORREGIR)).toEqual({
      ok: false,
      error: { tipo: "GENERAL", texto: "Esta acción no está permitida" },
    });
    corregir.mockResolvedValue({ ok: false, error: "VERSION_DESACTUALIZADA" });
    expect(await corregirNombreDeConsola(CORREGIR)).toMatchObject({
      ok: false,
      error: { tipo: "PANTALLA_VIEJA" },
    });
    corregir.mockResolvedValue({ ok: false, error: "VALOR_DUPLICADO" });
    expect(await corregirNombreDeConsola(CORREGIR)).toMatchObject({
      ok: false,
      error: { tipo: "CAMPO", campo: "nombre" },
    });
  });

  it.each([
    null,
    { ...CORREGIR, versionEsperada: 0 },
    { ...CORREGIR, valorId: "x" },
    { ...CORREGIR, nombre: undefined },
  ])("una entrada inválida (%j) no llega al caso", async (entrada) => {
    expect(await corregirNombreDeConsola(entrada)).toMatchObject({ ok: false });
    expect(corregir).not.toHaveBeenCalled();
  });
});

describe("desactivarValorDeConsola y reactivarValorDeConsola", () => {
  it("desactivar manda al caso de desactivar y reactivar al de reactivar, cada uno con su clave y su versión", async () => {
    expect(await desactivarValorDeConsola(ESTADO)).toEqual({ ok: true, dato: { version: 3 } });
    expect(desactivar).toHaveBeenCalledWith(ESTADO);
    expect(reactivar).not.toHaveBeenCalled();
    expect(await reactivarValorDeConsola(ESTADO)).toEqual({ ok: true, dato: { version: 4 } });
    expect(reactivar).toHaveBeenCalledWith(ESTADO);
    expect(desactivar).toHaveBeenCalledTimes(1);
  });

  it("repetir el pedido (mismo valor y misma clave) devuelve lo mismo: es éxito aunque no escriba", async () => {
    desactivar.mockResolvedValue({ ok: true, valor: { version: 3, yaEstabaInactivo: true } });
    expect(await desactivarValorDeConsola(ESTADO)).toEqual({ ok: true, dato: { version: 3 } });
  });

  it("el valor fijo no se desactiva y la lista inválida no existe: ambos son «Esta acción no está permitida»", async () => {
    for (const codigo of ["VALOR_FIJO", "LISTA_INVALIDA"]) {
      desactivar.mockResolvedValue({ ok: false, error: codigo });
      expect(await desactivarValorDeConsola(ESTADO)).toEqual({
        ok: false,
        error: { tipo: "GENERAL", texto: "Esta acción no está permitida" },
      });
    }
  });

  it.each([null, { ...ESTADO, versionEsperada: 0 }, { ...ESTADO, valorId: 5 }])(
    "una entrada inválida (%j) no llega a ningún caso",
    async (entrada) => {
      expect(await desactivarValorDeConsola(entrada)).toMatchObject({ ok: false });
      expect(await reactivarValorDeConsola(entrada)).toMatchObject({ ok: false });
      expect(desactivar).not.toHaveBeenCalled();
      expect(reactivar).not.toHaveBeenCalled();
    },
  );
});
