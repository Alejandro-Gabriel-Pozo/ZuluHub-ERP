import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeEmpresas,
  type CasosDeUsoDeEmpresas,
} from "../../src/modulos/empresas/publico";
import { personaId, sucursalId, type SucursalId } from "../../src/primitivas/identificadores/marca";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, sucursalDe } from "./fixtures-identidad";

/**
 * H6, tramo T2: concurrencia REAL de los casos de uso de sucursales. Cada prueba lanza varias
 * transacciones a la vez (`Promise.all`) y, con una barrera dentro de la transacción (tras leer la
 * autorización), fuerza que TODAS hayan empezado antes de que cualquiera escriba: es el cruce que
 * importa. Después mira la base: nunca hay duplicados ni estados inválidos, y el perdedor (tras el
 * reintento serializable del adaptador) ve el resultado del ganador.
 */

const base = inject("baseDePruebas");
// Cada ronda crea una empresa y compite dos o tres transacciones; las bajas de sucursales esperan hoy
// el bloqueo de 0005 y repiten tras un aborto. Con la máquina cargada (todas las pruebas de
// integración a la vez) las 25 rondas de S4 pasan de los 5 s que vale una prueba por defecto.
vi.setConfig({ testTimeout: 60_000 });
const RONDAS = 8;
/** Las pruebas del invariante "nunca sin sucursal activa" se repiten más: es el riesgo más serio. */
const RONDAS_CRITICAS = 25;

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDePrueba, esperar: () => Promise<void>) => TxDePrueba;

describe.skipIf(base === null)("sucursales: concurrencia de los casos de uso (S1 a S13)", () => {
  // Base propia de este archivo (ver `identidad-concurrencia.test.ts`).
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let casos: CasosDeUsoDeEmpresas;
  // La barrera de la ronda en curso: cada ronda arma una nueva (una barrera se usa una vez).
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 12, (tx) => gancho(tx, () => barrera()));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    casos = crearCasosDeUsoDeEmpresas({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Prepara la ronda: `participantes` transacciones esperan tras su primera lectura. */
  const ronda = (participantes: number) => {
    barrera = crearBarrera(participantes);
    gancho = (tx, esperar) => {
      let primera = true;
      const original = tx.autorizacion;
      return {
        ...tx,
        autorizacion: {
          delActor: async (contexto) => {
            const r = await original.delActor(contexto);
            if (primera) {
              primera = false;
              await esperar();
            }
            return r;
          },
        },
      };
    };
  };

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

  type Escenario = EmpresaDePrueba & Readonly<{ sucursal: SucursalId; ctx: ContextoOperativo }>;

  const escenario = async (): Promise<Escenario> => {
    const e = await crearEmpresaActiva(entorno);
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const g = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
    return { ...e, sucursal, ctx: comoEmpresa(e.empresa, personaId(g.id)) };
  };

  /** Una empresa con `cantidad` sucursales activas (la "Casa central" más las que se crean). */
  const conSucursales = async (cantidad: number) => {
    const e = await escenario();
    const ids = [e.sucursal];
    for (let i = 1; i < cantidad; i++) {
      const r = await casos.crearSucursal(e.ctx, { nombre: `Local ${i}` });
      if (!r.ok) throw new Error("no se pudo crear la sucursal de prueba");
      ids.push(r.valor.sucursalId);
    }
    return { e, ids };
  };

  const activas = (empresa: string) =>
    contar("select count(*) as n from sucursal where empresa_id = $1 and activa", [empresa]);
  const auditorias = (empresa: string, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      empresa,
      accion,
    ]);

  // =============================================================================================
  it("S1: dos altas simultáneas del mismo nombre dejan una sola sucursal (una creada, otra yaExistia)", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      ronda(2);
      const [x, y] = await Promise.all([
        casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" }),
        casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" }),
      ]);
      if (!x.ok || !y.ok) throw new Error(`ronda ${n}: ambas tenían que salir bien`);
      expect([x.valor.yaExistia, y.valor.yaExistia].sort(), `ronda ${n}`).toEqual([false, true]);
      expect(x.valor.sucursalId, `ronda ${n}`).toBe(y.valor.sucursalId);
      expect(
        await contar("select count(*) as n from sucursal where empresa_id = $1", [e.empresa]),
      ).toBe(2);
      expect(await auditorias(e.empresa, "SUCURSAL_CREADA"), `ronda ${n}`).toBe(1);
    }
  });

  it("S2: tres altas simultáneas del mismo nombre (con mayúsculas distintas) dejan una sola", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      ronda(3);
      const rs = await Promise.all([
        casos.crearSucursal(e.ctx, { nombre: "Sucursal norte" }),
        casos.crearSucursal(e.ctx, { nombre: "SUCURSAL NORTE" }),
        casos.crearSucursal(e.ctx, { nombre: " sucursal norte " }),
      ]);
      const valores = rs.map((r) => {
        if (!r.ok) throw new Error(`ronda ${n}: todas tenían que salir bien`);
        return r.valor;
      });
      expect(
        valores.filter((v) => !v.yaExistia),
        `ronda ${n}`,
      ).toHaveLength(1);
      expect(new Set(valores.map((v) => v.sucursalId)).size, `ronda ${n}`).toBe(1);
      expect(
        await contar("select count(*) as n from sucursal where empresa_id = $1", [e.empresa]),
      ).toBe(2);
      expect(await auditorias(e.empresa, "SUCURSAL_CREADA")).toBe(1);
    }
  });

  it("S3: dos altas simultáneas de nombres distintos dejan las dos", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      ronda(2);
      const [x, y] = await Promise.all([
        casos.crearSucursal(e.ctx, { nombre: "Norte" }),
        casos.crearSucursal(e.ctx, { nombre: "Sur" }),
      ]);
      expect([x.ok && !x.valor.yaExistia, y.ok && !y.valor.yaExistia], `ronda ${n}`).toEqual([
        true,
        true,
      ]);
      expect(
        await contar("select count(*) as n from sucursal where empresa_id = $1", [e.empresa]),
      ).toBe(3);
      expect(await auditorias(e.empresa, "SUCURSAL_CREADA")).toBe(2);
    }
  });

  it("S4: desactivar a la vez las dos últimas activas deja una activa (la otra da ULTIMA_SUCURSAL_ACTIVA)", async () => {
    for (let n = 0; n < RONDAS_CRITICAS; n++) {
      const { e, ids } = await conSucursales(2);
      const [a, b] = ids;
      if (a === undefined || b === undefined) throw new Error("faltan sucursales");
      ronda(2);
      const [x, y] = await Promise.all([
        casos.desactivarSucursal(e.ctx, { sucursalId: a }),
        casos.desactivarSucursal(e.ctx, { sucursalId: b }),
      ]);
      expect([x.ok, y.ok].sort(), `ronda ${n}: una gana y la otra es rechazada`).toEqual([
        false,
        true,
      ]);
      const perdedora = x.ok ? y : x;
      expect(perdedora, `ronda ${n}`).toEqual({ ok: false, error: "ULTIMA_SUCURSAL_ACTIVA" });
      expect(await activas(e.empresa), `ronda ${n}: nunca ninguna`).toBe(1);
      expect(await auditorias(e.empresa, "SUCURSAL_DESACTIVADA")).toBe(1);
    }
  });

  it("S5: desactivar a la vez las tres activas deja exactamente una", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { e, ids } = await conSucursales(3);
      ronda(3);
      const rs = await Promise.all(
        ids.map((id) => casos.desactivarSucursal(e.ctx, { sucursalId: id })),
      );
      expect(
        rs.filter((r) => r.ok),
        `ronda ${n}`,
      ).toHaveLength(2);
      expect(
        rs.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error)),
        `ronda ${n}`,
      ).toEqual(["ULTIMA_SUCURSAL_ACTIVA"]);
      expect(await activas(e.empresa), `ronda ${n}`).toBe(1);
      expect(await auditorias(e.empresa, "SUCURSAL_DESACTIVADA")).toBe(2);
    }
  });

  it("S6: crear una sucursal mientras se desactiva la única activa: nunca queda la empresa sin activas", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      ronda(2);
      const [alta, baja] = await Promise.all([
        casos.crearSucursal(e.ctx, { nombre: "Sucursal nueva" }),
        casos.desactivarSucursal(e.ctx, { sucursalId: e.sucursal }),
      ]);
      expect(alta.ok, `ronda ${n}`).toBe(true);
      // Según el orden en que se serialicen, la baja ve la nueva (ok) o no (última activa).
      if (!baja.ok) expect(baja.error, `ronda ${n}`).toBe("ULTIMA_SUCURSAL_ACTIVA");
      expect(await activas(e.empresa), `ronda ${n}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("S7: dos desactivaciones simultáneas de la misma sucursal escriben una vez (la otra ve que ya estaba)", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { e, ids } = await conSucursales(2);
      const objetivo = ids[1] as SucursalId;
      ronda(2);
      const [x, y] = await Promise.all([
        casos.desactivarSucursal(e.ctx, { sucursalId: objetivo }),
        casos.desactivarSucursal(e.ctx, { sucursalId: objetivo }),
      ]);
      expect([x, y].map((r) => r.ok && r.valor.yaEstabaInactiva).sort(), `ronda ${n}`).toEqual([
        false,
        true,
      ]);
      expect(await auditorias(e.empresa, "SUCURSAL_DESACTIVADA")).toBe(1);
      expect(
        (await filas("select activa, version from sucursal where id = $1", [objetivo]))[0],
      ).toEqual({ activa: false, version: 2 });
    }
  });

  it("S8: dos reactivaciones simultáneas de la misma sucursal escriben una vez", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { e, ids } = await conSucursales(2);
      const objetivo = ids[1] as SucursalId;
      await casos.desactivarSucursal(e.ctx, { sucursalId: objetivo });
      ronda(2);
      const [x, y] = await Promise.all([
        casos.reactivarSucursal(e.ctx, { sucursalId: objetivo }),
        casos.reactivarSucursal(e.ctx, { sucursalId: objetivo }),
      ]);
      expect([x, y].map((r) => r.ok && r.valor.yaEstabaActiva).sort(), `ronda ${n}`).toEqual([
        false,
        true,
      ]);
      expect(await auditorias(e.empresa, "SUCURSAL_REACTIVADA")).toBe(1);
      expect(
        (await filas("select activa, version from sucursal where id = $1", [objetivo]))[0],
      ).toEqual({ activa: true, version: 3 });
    }
  });

  it("S9: desactivar y reactivar a la vez la misma sucursal: ambas terminan bien y el estado coincide con la auditoría", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { e, ids } = await conSucursales(2);
      const objetivo = ids[1] as SucursalId;
      ronda(2);
      const [baja, alta] = await Promise.all([
        casos.desactivarSucursal(e.ctx, { sucursalId: objetivo }),
        casos.reactivarSucursal(e.ctx, { sucursalId: objetivo }),
      ]);
      expect([baja.ok, alta.ok], `ronda ${n}`).toEqual([true, true]);
      const fila = (await filas("select activa from sucursal where id = $1", [objetivo]))[0];
      const bajas = await auditorias(e.empresa, "SUCURSAL_DESACTIVADA");
      const reactivaciones = await auditorias(e.empresa, "SUCURSAL_REACTIVADA");
      // Empezó activa: por cada baja que escribió, la reactivación solo pudo escribir si ya estaba
      // inactiva. El estado final es el de la última escritura.
      expect(bajas, `ronda ${n}`).toBe(1);
      expect(reactivaciones, `ronda ${n}`).toBeLessThanOrEqual(1);
      expect(fila?.["activa"], `ronda ${n}`).toBe(reactivaciones === 1);
    }
  });

  it("S10: dos ediciones simultáneas con la misma versión: gana una, la otra da VERSION_DESACTUALIZADA", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      ronda(2);
      const [x, y] = await Promise.all([
        casos.editarSucursal(e.ctx, { sucursalId: e.sucursal, versionEsperada: 1, nombre: "Uno" }),
        casos.editarSucursal(e.ctx, { sucursalId: e.sucursal, versionEsperada: 1, nombre: "Dos" }),
      ]);
      expect([x.ok, y.ok].sort(), `ronda ${n}`).toEqual([false, true]);
      expect(x.ok ? y : x, `ronda ${n}`).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      const ganador = x.ok ? "Uno" : "Dos";
      expect(
        (await filas("select nombre, version from sucursal where id = $1", [e.sucursal]))[0],
      ).toEqual({ nombre: ganador, version: 2 });
      expect(await auditorias(e.empresa, "SUCURSAL_EDITADA")).toBe(1);
    }
  });

  it("S11: dos ediciones simultáneas al mismo nombre: las dos terminan bien y se escribe una vez", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      ronda(2);
      const entrada = { sucursalId: e.sucursal, versionEsperada: 1, nombre: "Matriz" };
      const [x, y] = await Promise.all([
        casos.editarSucursal(e.ctx, entrada),
        casos.editarSucursal(e.ctx, entrada),
      ]);
      expect([x, y], `ronda ${n}`).toEqual([
        { ok: true, valor: { version: 2 } },
        { ok: true, valor: { version: 2 } },
      ]);
      expect(await auditorias(e.empresa, "SUCURSAL_EDITADA")).toBe(1);
    }
  });

  it("S12: dos sucursales renombradas a la vez al mismo nombre (mayúsculas distintas): una gana, la otra da SUCURSAL_DUPLICADA", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { e, ids } = await conSucursales(2);
      const [a, b] = ids as [SucursalId, SucursalId];
      ronda(2);
      const [x, y] = await Promise.all([
        casos.editarSucursal(e.ctx, { sucursalId: a, versionEsperada: 1, nombre: "Centro" }),
        casos.editarSucursal(e.ctx, { sucursalId: b, versionEsperada: 1, nombre: "CENTRO" }),
      ]);
      expect([x.ok, y.ok].sort(), `ronda ${n}`).toEqual([false, true]);
      expect(x.ok ? y : x, `ronda ${n}`).toEqual({ ok: false, error: "SUCURSAL_DUPLICADA" });
      expect(
        await contar(
          "select count(*) as n from sucursal where empresa_id = $1 and lower(nombre) = 'centro'",
          [e.empresa],
        ),
      ).toBe(1);
      expect(await auditorias(e.empresa, "SUCURSAL_EDITADA")).toBe(1);
    }
  });

  it("S13: editar y desactivar a la vez la misma sucursal: la baja siempre sale bien y la edición es coherente", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { e, ids } = await conSucursales(2);
      const objetivo = ids[1] as SucursalId;
      ronda(2);
      const [edicion, baja] = await Promise.all([
        casos.editarSucursal(e.ctx, {
          sucursalId: objetivo,
          versionEsperada: 1,
          nombre: "Nombre nuevo",
        }),
        casos.desactivarSucursal(e.ctx, { sucursalId: objetivo }),
      ]);
      expect(baja, `ronda ${n}`).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
      // La edición lleva la versión que vio la pantalla: si la baja se serializó antes, quedó vieja.
      if (!edicion.ok) expect(edicion.error, `ronda ${n}`).toBe("VERSION_DESACTUALIZADA");
      const fila = (
        await filas("select nombre, activa from sucursal where id = $1", [objetivo])
      )[0];
      expect(fila, `ronda ${n}`).toEqual({
        nombre: edicion.ok ? "Nombre nuevo" : "Local 1",
        activa: false,
      });
      expect(await auditorias(e.empresa, "SUCURSAL_EDITADA")).toBe(edicion.ok ? 1 : 0);
    }
  });

  it("S14: dos empresas distintas operan a la vez sin pisarse (mismo nombre, mismas operaciones)", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const a = await escenario();
      const b = await escenario();
      ronda(2);
      const [x, y] = await Promise.all([
        casos.crearSucursal(a.ctx, { nombre: "Centro" }),
        casos.crearSucursal(b.ctx, { nombre: "Centro" }),
      ]);
      expect([x.ok && !x.valor.yaExistia, y.ok && !y.valor.yaExistia], `ronda ${n}`).toEqual([
        true,
        true,
      ]);
      expect(
        await contar("select count(*) as n from sucursal where empresa_id = $1", [a.empresa]),
      ).toBe(2);
      expect(
        await contar("select count(*) as n from sucursal where empresa_id = $1", [b.empresa]),
      ).toBe(2);
    }
  });
});
