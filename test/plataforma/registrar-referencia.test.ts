import { describe, expect, it } from "vitest";
import {
  INTENTOS_PARA_REGISTRAR_UNA_REFERENCIA,
  RESTRICCION_DE_UNICIDAD_DE_REFERENCIA,
  armarRegistrarReferenciaDeError,
  type RechazoARegistrar,
  type TxDeReferencias,
} from "../../src/plataforma/casos-de-uso/registrar-referencia";
import { referenciaDeError } from "../../src/plataforma/dominio/referencia";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { err } from "../../src/primitivas/resultado/resultado";
import type { NuevaReferenciaDeError } from "../../src/puertos/referencias-de-error";
import type {
  ErrorDePersistencia,
  OpcionesDeTransaccion,
  Transacciones,
} from "../../src/puertos/transacciones";
import { comoAdministrador, uuid } from "./apoyo-de-soporte";

/**
 * Registro de la referencia de error con reintento ante una colisión (decisión de P6). Sin base de
 * datos: una transacción de mentira devuelve, intento por intento, lo que se le indique. El
 * comportamiento contra Postgres con la restricción de unicidad está en
 * `test/integracion/soporte-referencias.test.ts`.
 */

const colision: ErrorDePersistencia = {
  tipo: "Unicidad",
  restriccion: RESTRICCION_DE_UNICIDAD_DE_REFERENCIA,
};

const RECHAZO: RechazoARegistrar = {
  accion: "usuarios.invitar",
  motivo: "SIN_PERMISO",
  empresaId: empresaId(uuid(1)),
  personaId: personaId(uuid(2)),
};

/** `resultados[i]` es lo que pasa en el intento i: `null` = anda, un error = esa falla (sin correr el trabajo). */
function armar(resultados: ReadonlyArray<ErrorDePersistencia | null>) {
  const opciones: OpcionesDeTransaccion[] = [];
  const registradas: NuevaReferenciaDeError[] = [];
  const transacciones: Transacciones<TxDeReferencias> = {
    ejecutar: async (o, trabajo) => {
      const falla = resultados[opciones.length] ?? null;
      opciones.push(o);
      if (falla !== null) return err(falla);
      return trabajo({
        referenciasDeError: {
          registrar: (r) => {
            registradas.push(r);
            return Promise.resolve();
          },
        },
      });
    },
  };
  let llamadasAlAzar = 0;
  const azar = () => {
    llamadasAlAzar += 1;
    return new Uint8Array([0xab, 0x12, 0xcd, llamadasAlAzar]);
  };
  const registrar = armarRegistrarReferenciaDeError({ transacciones, azar });
  return { registrar, opciones, registradas, llamadasAlAzar: () => llamadasAlAzar };
}

const referenciaDelIntento = (n: number) =>
  referenciaDeError(new Uint8Array([0xab, 0x12, 0xcd, n]));

describe("registrarReferenciaDeError", () => {
  it("registra la referencia con lo del rechazo, en su propia transacción y con el contexto de quien lo recibió", async () => {
    const { registrar, opciones, registradas } = armar([null]);
    const r = await registrar(comoAdministrador, RECHAZO);
    expect(r).toEqual({ ok: true, valor: referenciaDelIntento(1) });
    expect(r.ok && r.valor).toBe("ZH-AB12-CD01");
    expect(registradas).toEqual([{ referencia: "ZH-AB12-CD01", ...RECHAZO }]);
    expect(opciones).toEqual([{ contexto: comoAdministrador, aislamiento: "read committed" }]);
  });

  it("acepta un rechazo sin empresa ni persona", async () => {
    const { registrar, registradas } = armar([null]);
    await registrar(comoAdministrador, { ...RECHAZO, empresaId: null, personaId: null });
    expect(registradas[0]).toMatchObject({ empresaId: null, personaId: null });
  });

  it("ante una colisión sortea OTRA referencia y reintenta; devuelve la que quedó guardada", async () => {
    const { registrar, registradas, opciones, llamadasAlAzar } = armar([colision, colision, null]);
    const r = await registrar(comoAdministrador, RECHAZO);
    expect(r).toEqual({ ok: true, valor: referenciaDelIntento(3) });
    expect(llamadasAlAzar()).toBe(3);
    expect(opciones).toHaveLength(3);
    // Solo el intento que anduvo llegó a registrar; las colisiones fallaron antes de correr el trabajo.
    expect(registradas).toEqual([{ referencia: "ZH-AB12-CD03", ...RECHAZO }]);
  });

  it(`prueba hasta ${INTENTOS_PARA_REGISTRAR_UNA_REFERENCIA} referencias: la última todavía cuenta`, async () => {
    expect(INTENTOS_PARA_REGISTRAR_UNA_REFERENCIA).toBe(5);
    const { registrar, opciones } = armar([colision, colision, colision, colision, null]);
    expect((await registrar(comoAdministrador, RECHAZO)).ok).toBe(true);
    expect(opciones).toHaveLength(5);
  });

  it("si todos los intentos colisionan, devuelve la colisión y no sigue", async () => {
    const { registrar, opciones, llamadasAlAzar } = armar([
      colision,
      colision,
      colision,
      colision,
      colision,
      null,
    ]);
    expect(await registrar(comoAdministrador, RECHAZO)).toEqual({ ok: false, error: colision });
    expect(opciones).toHaveLength(5);
    expect(llamadasAlAzar()).toBe(5);
  });

  it("cualquier otro error vuelve tal cual, sin reintentar", async () => {
    const otros: ErrorDePersistencia[] = [
      { tipo: "AccesoDenegado" },
      { tipo: "Unicidad", restriccion: "otra_restriccion_uk" },
      { tipo: "Unicidad", restriccion: null },
      { tipo: "Check", restriccion: RESTRICCION_DE_UNICIDAD_DE_REFERENCIA },
      { tipo: "Referencia", restriccion: RESTRICCION_DE_UNICIDAD_DE_REFERENCIA },
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: "XX000", mensaje: "falló" },
    ];
    for (const error of otros) {
      const { registrar, opciones } = armar([error, null]);
      expect(await registrar(comoAdministrador, RECHAZO), JSON.stringify(error)).toEqual({
        ok: false,
        error,
      });
      expect(opciones, JSON.stringify(error)).toHaveLength(1);
    }
  });

  it("la restricción que se espera de la base se llama como dice el contrato", () => {
    expect(RESTRICCION_DE_UNICIDAD_DE_REFERENCIA).toBe("referencia_de_error_referencia_uk");
  });
});
