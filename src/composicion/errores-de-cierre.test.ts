import { describe, expect, it, vi } from "vitest";
import { errorAPublico } from "./a-respuesta";
import { accionDeCierre, correrYTraducir, traducirErrorDelCierre } from "./errores-de-cierre";
import { err, ok } from "../primitivas/resultado/resultado";

const GENERICO = { codigo: "CIERRE_ACCION_NO_PERMITIDA" };
const respuesta = () => {
  const registrados: string[] = [];
  return {
    registrados,
    deps: {
      registrar: (d: string) => registrados.push(d),
      azar: () => new Uint8Array([1, 2, 3, 4]),
    },
  };
};

describe("traducirErrorDelCierre: de un error del cierre, de caja, de ventas o de identidad al código público", () => {
  it.each([
    "JORNADA_NO_ENCONTRADA",
    "FECHA_INVALIDA",
    "JORNADA_CERRADA",
    "JORNADA_NO_EN_AUDITORIA",
    "OBSERVACION_INVALIDA",
    "RECONOCIMIENTO_INVALIDO",
    "SUCURSAL_FUERA_DE_ALCANCE",
    "SUCURSAL_NO_ENCONTRADA",
    "APORTE_NO_DISPONIBLE",
    "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
    "CLAVE_REUTILIZADA",
    "IMPORTE_INVALIDO",
    "MONEDA_NO_SOPORTADA",
    "MOTIVO_INVALIDO",
    "COBRO_NO_ENCONTRADO",
    "MEDIO_NO_ENCONTRADO",
    "MEDIO_INACTIVO",
    "MEDIO_NO_DECLARABLE",
    "MEDIO_DEL_COBRO_SIN_CAMBIOS",
    "CUENTA_DE_COBRO_NO_ENCONTRADA",
    "CUENTA_DE_COBRO_NO_ADMITIDA",
    "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
    "CUENTA_DE_COBRO_INACTIVA",
    "CUENTA_DE_COBRO_INCOMPATIBLE",
    "CURSOR_INVALIDO",
    "LIMITE_INVALIDO",
    "ENTRADA_INVALIDA",
    "HORA_DE_CORTE_INVALIDA",
    "ZONA_HORARIA_INVALIDA",
    "INSTANTE_INVALIDO",
    "TICKET_NO_ENCONTRADO",
  ])("el error %s es el genérico: «Esta acción no está permitida»", (error) => {
    expect(traducirErrorDelCierre(error)).toEqual(GENERICO);
  });

  it.each([
    ["JORNADA_CON_IMPEDIMENTOS", { codigo: "JORNADA_CON_IMPEDIMENTOS", impedimentos: [] }],
    ["APORTE_NO_DISPONIBLE", { codigo: "APORTE_NO_DISPONIBLE", modulo: "caja" }],
    ["CONTROLES_QUE_BLOQUEAN", { codigo: "CONTROLES_QUE_BLOQUEAN", claves: ["caja.x"] }],
    ["CONTROLES_SIN_RECONOCER", { codigo: "CONTROLES_SIN_RECONOCER", claves: ["caja.x"] }],
    [
      "MEDIO_DEL_COBRO_CAMBIO",
      { codigo: "MEDIO_DEL_COBRO_CAMBIO", vigente: { medioDePagoId: "x", cuentaDeCobroId: null } },
    ],
  ])(
    "el error con forma de objeto %s es el genérico y no deja salir sus datos",
    (_codigo, error) => {
      expect(traducirErrorDelCierre(error)).toEqual(GENERICO);
    },
  );

  it("CONTROLES_CAMBIARON tiene su aviso propio, sin los controles", () => {
    expect(
      traducirErrorDelCierre({ codigo: "CONTROLES_CAMBIARON", controles: [{ clave: "caja.x" }] }),
    ).toEqual({ codigo: "CIERRE_CONTROLES_CAMBIARON" });
  });

  it("los motivos del guard, la empresa que no opera y los errores de la base pasan SIN CAMBIOS: ya tienen su código", () => {
    for (const motivo of [
      "MODULO_EN_DESARROLLO",
      "MODULO_NO_ACTIVO",
      "MODULO_EN_SOLO_LECTURA",
      "SIN_CAPACIDAD",
      "SIN_PERMISO",
    ]) {
      expect(traducirErrorDelCierre(motivo)).toBe(motivo);
    }
    const noOpera = { codigo: "EMPRESA_NO_OPERA", empresaId: "x", motivo: "EMPRESA_SUSPENDIDA" };
    expect(traducirErrorDelCierre(noOpera)).toBe(noOpera);
    const base = { tipo: "ConcurrenciaAgotada" };
    expect(traducirErrorDelCierre(base)).toBe(base);
  });

  it("lo que ninguna tabla conoce no se traga: pasa igual y `aRespuesta` lo trata como inesperado, con referencia y sin detalle", () => {
    const { registrados, deps } = respuesta();
    for (const raro of [
      "ALGO_NUEVO",
      { codigo: "OTRO_CODIGO" },
      5,
      null,
      undefined,
      [],
      { codigo: 3 },
    ]) {
      expect(traducirErrorDelCierre(raro)).toBe(raro);
    }
    const publico = errorAPublico(traducirErrorDelCierre("ALGO_NUEVO"), deps);
    expect(publico).toMatchObject({ codigo: "ERROR_INTERNO", presentacion: "INESPERADO" });
    expect(JSON.stringify(publico)).not.toContain("ALGO_NUEVO");
    expect(registrados).toHaveLength(1);
  });

  it("un arreglo que se lee como el nombre de un error no es ese error: pasa SIN CAMBIOS", () => {
    for (const parecido of [["JORNADA_CERRADA"], [["CONTROLES_QUE_BLOQUEAN"]]]) {
      expect(traducirErrorDelCierre(parecido)).toBe(parecido);
    }
    const conCodigoEnArreglo = { codigo: ["CONTROLES_QUE_BLOQUEAN"] };
    expect(traducirErrorDelCierre(conCodigoEnArreglo)).toBe(conCodigoEnArreglo);
  });

  it("un nombre heredado de Object.prototype no es un error del cierre", () => {
    for (const heredado of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(traducirErrorDelCierre(heredado)).toBe(heredado);
      expect(traducirErrorDelCierre({ codigo: heredado })).toEqual({ codigo: heredado });
    }
  });
});

describe("accionDeCierre y correrYTraducir: lo común de las acciones de la web del cierre", () => {
  const leerBien = (crudo: unknown) => ok({ dato: crudo });
  const leerMal = () => err("ENTRADA_INVALIDA" as const);

  it("un pedido con otra forma es el genérico y NO corre el caso de uso", async () => {
    const { deps } = respuesta();
    const correr = vi.fn();
    const r = await accionDeCierre(deps, {}, leerMal, correr, () => "x");
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "CIERRE_ACCION_NO_PERMITIDA", presentacion: "AVISO" },
    });
    expect(correr).not.toHaveBeenCalled();
  });

  it("lo bueno sale presentado; un error del negocio sale con su código", async () => {
    const { deps } = respuesta();
    expect(
      await accionDeCierre(
        deps,
        7,
        leerBien,
        (e) => Promise.resolve(ok(Number(e.dato))),
        (n) => n * 2,
      ),
    ).toEqual({ ok: true, dato: 14 });
    expect(
      await accionDeCierre(
        deps,
        7,
        leerBien,
        () => Promise.resolve(err("JORNADA_CERRADA")),
        () => 1,
      ),
    ).toMatchObject({
      ok: false,
      error: { codigo: "CIERRE_ACCION_NO_PERMITIDA" },
    });
    expect(
      await correrYTraducir(
        deps,
        () => Promise.resolve(err({ codigo: "CONTROLES_CAMBIARON", controles: [] })),
        () => 1,
      ),
    ).toMatchObject({
      ok: false,
      error: { codigo: "CIERRE_CONTROLES_CAMBIARON", clave: "cierre.error.controles_cambiaron" },
    });
    expect(
      await correrYTraducir(
        deps,
        () => Promise.resolve(err("SIN_PERMISO")),
        () => 1,
      ),
    ).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
  });

  it("una excepción (la base caída, un defecto) sale sin detalle y con referencia; el detalle va al registro", async () => {
    const { registrados, deps } = respuesta();
    const r = await correrYTraducir(
      deps,
      () => Promise.reject(new Error("la base dijo: password=secreta")),
      () => 1,
    );
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO", presentacion: "INESPERADO" },
    });
    expect(JSON.stringify(r)).not.toContain("secreta");
    expect(registrados).toHaveLength(1);
    expect(registrados[0]).toContain("secreta");
    const a = await accionDeCierre(
      deps,
      1,
      leerBien,
      () => Promise.reject(new Error("x")),
      () => 1,
    );
    expect(a).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
  });
});
