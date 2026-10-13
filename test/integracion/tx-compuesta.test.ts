import pg from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type TxDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";

/**
 * Tramo previo común, `Tx` compuesta (conciliación §3.3): una operación que cruza módulos corre en UNA
 * transacción con los repositorios de varios módulos (empresas, identidad, auditoría, trabajos y los
 * niveles de control), así que es atómica e idempotente aunque dos la intenten a la vez. «Cobrar» (ventas,
 * caja, stock, fiscal) se apoya en esto. `TxDePrueba` arma exactamente lo que arma la composición.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });
const RONDAS = 8;

type Fila = Record<string, unknown>;

describe.skipIf(base === null)(
  "Tx compuesta: una operación entre módulos es una sola transacción",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 12);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;
    const contar = async (texto: string, parametros: unknown[] = []) =>
      Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

    const escenario = async () => {
      const { empresa } = await crearEmpresaActiva(entorno);
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, empresa, p.id, "OPERADOR");
      return { empresa, persona: personaId(p.id) };
    };

    /** Lo que se ve en la base de lo que escribe la operación de abajo, módulo por módulo. */
    const efectos = async (empresa: EmpresaId, nombre: string) => ({
      sucursales: await contar(
        "select count(*) as n from sucursal where empresa_id = $1 and nombre = $2",
        [empresa, nombre],
      ),
      asignaciones: await contar(
        `select count(*) as n from asignacion_sucursal a join sucursal s on s.id = a.sucursal_id
        where a.empresa_id = $1 and s.nombre = $2`,
        [empresa, nombre],
      ),
      auditoria: await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'ALTA_COMPUESTA' and entidad_id in (select id::text from sucursal where nombre = $2 and empresa_id = $1)",
        [empresa, nombre],
      ),
      trabajos: await contar(
        "select count(*) as n from trabajo where empresa_id = $1 and clave_idempotencia = $2",
        [empresa, `alta_compuesta:${nombre}`],
      ),
    });
    const TODO = { sucursales: 1, asignaciones: 1, auditoria: 1, trabajos: 1 };
    const NADA = { sucursales: 0, asignaciones: 0, auditoria: 0, trabajos: 0 };

    /**
     * Una operación de cuatro módulos: empresas (la sucursal), identidad (la asignación del operador),
     * auditoría y trabajos (el aviso), más una lectura de los niveles de control. Idempotente: si la
     * sucursal ya existía no repite nada. `entre` corre antes del primer paso (para forzar que las dos transacciones empiecen antes de escribir).
     */
    const altaCompuesta = (
      e: { empresa: EmpresaId; persona: PersonaId },
      nombre: string,
      opciones: { entre?: () => Promise<void>; despues?: (tx: TxDePrueba) => Promise<void> } = {},
    ) =>
      entorno.ejecutar({ contexto: comoEmpresa(e.empresa, e.persona) }, async (tx) => {
        await opciones.entre?.();
        const alta = await tx.sucursales.crearSiNoExiste(e.empresa, nombre);
        if (!alta.creada) return ok({ yaExistia: true });
        await tx.asignaciones.crear(e.empresa, e.persona, [alta.sucursal.id]);
        await tx.auditoria.registrar({
          empresaId: e.empresa,
          actorPersonaId: e.persona,
          accion: "ALTA_COMPUESTA",
          entidad: "sucursal",
          entidadId: alta.sucursal.id,
          antes: null,
          despues: { nombre },
        });
        await tx.trabajos.encolar({
          empresaId: e.empresa,
          tipo: "alta_compuesta",
          datos: { nombre },
          claveDeIdempotencia: `alta_compuesta:${nombre}`,
        });
        const nivel = await tx.niveles.nivel(
          "caja.cierre_con_diferencia",
          { empresaId: e.empresa, sucursalId: alta.sucursal.id },
          true,
        );
        await opciones.despues?.(tx);
        return ok({ yaExistia: false, nivel });
      });

    it("si todo sale bien, los cuatro módulos confirman juntos y la lectura de niveles corre en la misma transacción", async () => {
      const e = await escenario();
      const r = await altaCompuesta(e, "Local atómico");
      expect(r).toEqual({ ok: true, valor: { yaExistia: false, nivel: "PERMITIR" } });
      expect(await efectos(e.empresa, "Local atómico")).toEqual(TODO);
    });

    it("una excepción o un error de negocio después de escribir revierte a todos los módulos", async () => {
      const e = await escenario();
      const r = await altaCompuesta(e, "Local revertido", {
        despues: () => Promise.reject(new Error("no se usa")),
      }).catch((falla: unknown) => falla);
      expect(r).toEqual(new Error("no se usa"));
      expect(await efectos(e.empresa, "Local revertido")).toEqual(NADA);

      const negocio = await entorno.ejecutar(
        { contexto: comoEmpresa(e.empresa, e.persona) },
        async (tx) => {
          const alta = await tx.sucursales.crearSiNoExiste(e.empresa, "Local rechazado");
          await tx.asignaciones.crear(e.empresa, e.persona, [alta.sucursal.id]);
          await tx.trabajos.encolar({
            empresaId: e.empresa,
            tipo: "alta_compuesta",
            datos: {},
            claveDeIdempotencia: "alta_compuesta:Local rechazado",
          });
          return err("REGLA_DE_NEGOCIO" as const);
        },
      );
      expect(negocio).toEqual({ ok: false, error: "REGLA_DE_NEGOCIO" });
      expect(await efectos(e.empresa, "Local rechazado")).toEqual(NADA);
    });

    it("un fallo de la base en el último módulo revierte lo que ya habían escrito los otros", async () => {
      const e = await escenario();
      const r = await altaCompuesta(e, "Local a medias", {
        // Una sucursal en otra empresa: la RLS la rechaza después de que los otros módulos escribieron.
        despues: async (tx) => {
          await sql`insert into sucursal (empresa_id, nombre)
                  values (${"00000000-0000-4000-8000-000000000000"}, 'ajena')`.execute(tx.db);
        },
      });
      expect(r).toMatchObject({ ok: false });
      expect(await efectos(e.empresa, "Local a medias")).toEqual(NADA);
    });

    it("idempotente: repetir la operación no duplica ningún efecto en ningún módulo", async () => {
      const e = await escenario();
      expect(await altaCompuesta(e, "Local repetido")).toMatchObject({
        ok: true,
        valor: { yaExistia: false },
      });
      expect(await altaCompuesta(e, "Local repetido")).toEqual({
        ok: true,
        valor: { yaExistia: true },
      });
      expect(await altaCompuesta(e, "LOCAL REPETIDO")).toEqual({
        ok: true,
        valor: { yaExistia: true },
      });
      expect(await efectos(e.empresa, "Local repetido")).toEqual(TODO);
    });

    it("concurrencia: dos operaciones iguales a la vez dejan cada efecto una sola vez y las dos terminan bien", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const nombre = `Local concurrente ${n}`;
        const barrera = crearBarrera(2);
        const [x, y] = await Promise.all([
          altaCompuesta(e, nombre, { entre: barrera }),
          altaCompuesta(e, nombre, { entre: barrera }),
        ]);
        expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
        // Exactamente una creó la sucursal; la otra, tras el reintento serializable, vio que ya existía.
        const creadoras = [x, y].filter((r) => r.ok && !r.valor.yaExistia);
        expect(creadoras, `ronda ${n}`).toHaveLength(1);
        expect(await efectos(e.empresa, nombre), `ronda ${n}`).toEqual(TODO);
      }
    });

    it("el reintento serializable repite la operación COMPLETA, no un módulo suelto", async () => {
      const e = await escenario();
      const nombre = "Local reintentado";
      let intentos = 0;
      const barrera = crearBarrera(2);
      const contar = () => {
        intentos += 1;
      };
      await Promise.all([
        altaCompuesta(e, nombre, { entre: barrera, despues: () => Promise.resolve(contar()) }),
        altaCompuesta(e, nombre, { entre: barrera, despues: () => Promise.resolve(contar()) }),
      ]);
      // El perdedor repite desde el principio: ve la sucursal creada y no llega al último paso.
      expect(intentos).toBe(1);
      expect(await efectos(e.empresa, nombre)).toEqual(TODO);
    });
  },
);
