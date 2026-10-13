import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  type CasosDeUsoDeIdentidad,
  type ConsultasDeIdentidad,
} from "../../src/modulos/identidad/publico";
import { personaId, sucursalId, type SucursalId } from "../../src/primitivas/identificadores/marca";
import type { Transacciones } from "../../src/puertos/transacciones";
import {
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type TxDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import { crearApoyoDeTraspaso, type Escenario } from "./traspaso-apoyo";

/**
 * H6, tramo T3b: `asignarSucursales` contra una base real, con los roles limitados y el contexto
 * firmado (nunca el dueño de la base, salvo para armar el escenario y para mirar). Cubre
 * autorización por rol, aislamiento entre empresas, idempotencia, atomicidad y auditoría. La
 * concurrencia está en `traspaso-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");

// Con la máquina cargada una prueba puede tardar varias veces lo normal: el límite es holgado a
// propósito (lo que se prueba es el efecto del caso de uso, no la velocidad).
const LIMITE_EN_MS = 60_000;

describe.skipIf(base === null)(
  "asignarSucursales contra una base real",
  { timeout: LIMITE_EN_MS },
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let casos: CasosDeUsoDeIdentidad;
    let consultas: ConsultasDeIdentidad;
    let apoyo: ReturnType<typeof crearApoyoDeTraspaso>;

    const crearCasos = (transacciones: Transacciones<TxDePrueba>) =>
      crearCasosDeUsoDeIdentidad({
        transacciones,
        tokens: crearTokensHmac(randomBytes(32)),
        reglas: REGLAS_DE_EMPRESA,
      });

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 10);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      apoyo = crearApoyoDeTraspaso(entorno, dueno);
      casos = crearCasos(entorno);
      consultas = crearConsultasDeIdentidad({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
    }, LIMITE_EN_MS);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    }, LIMITE_EN_MS);

    const escenario = (tenant?: Escenario["tenant"]) => apoyo.escenario(tenant);
    const miembro = (...a: Parameters<typeof apoyo.miembro>) => apoyo.miembro(...a);
    const foto = (empresas: string[]) => apoyo.foto(empresas);
    const SIN_PERMISO = { ok: false, error: "SIN_PERMISO" };

    /** Una empresa con tres sucursales (la central y dos más) y un operador sin asignaciones. */
    const conTresSucursales = async () => {
      const e = await escenario();
      const norte = await apoyo.sucursalExtra(e, "Norte");
      const sur = await apoyo.sucursalExtra(e, "Sur");
      const op = await miembro(e, "OPERADOR");
      const ordenadas = [e.sucursal, norte, sur].sort();
      return { e, norte, sur, op, ordenadas };
    };
    const ids = (...s: SucursalId[]) => [...s].sort();

    // =============================================================================================
    describe("la diferencia entre lo asignado y el conjunto final", () => {
      it("a un miembro sin asignaciones se le agregan las pedidas: salida, filas y auditoría exactas", async () => {
        const { e, norte, op } = await conTresSucursales();

        const r = await casos.asignarSucursales(e.ctx, {
          personaId: op.id,
          sucursales: [norte, e.sucursal],
        });

        expect(r).toEqual({
          ok: true,
          valor: { agregadas: ids(norte, e.sucursal), reactivadas: [], quitadas: [] },
        });
        expect(await apoyo.asignadas(e.empresa, op.id)).toEqual(ids(norte, e.sucursal));
        expect(await apoyo.auditoria(e.empresa, "ASIGNACIONES_CAMBIADAS")).toEqual([
          {
            accion: "ASIGNACIONES_CAMBIADAS",
            actor_persona_id: e.gerente,
            entidad: "membresia",
            entidad_id: op.id,
            antes: { sucursales: [] },
            despues: {
              sucursales: ids(norte, e.sucursal),
              agregadas: ids(norte, e.sucursal),
              reactivadas: [],
              quitadas: [],
            },
          },
        ]);
      });

      it("agrega, reactiva y quita en un solo pedido, y deja UNA auditoría con el antes y el después", async () => {
        const { e, norte, sur, op } = await conTresSucursales();
        await apoyo.asignarDeBase(e, op.id, e.sucursal); // activa: se quita
        await apoyo.asignarDeBase(e, op.id, norte, false); // apagada: se reactiva
        // `sur` no tiene fila: se agrega.

        const r = await casos.asignarSucursales(e.ctx, {
          personaId: op.id,
          sucursales: [sur, norte],
        });

        expect(r).toEqual({
          ok: true,
          valor: { agregadas: [sur], reactivadas: [norte], quitadas: [e.sucursal] },
        });
        expect(await apoyo.asignadas(e.empresa, op.id)).toEqual(ids(norte, sur));
        // Lo quitado queda apagado, no borrado: la historia se conserva.
        expect(
          await apoyo.filas(
            "select sucursal_id, activa from asignacion_sucursal where empresa_id = $1 and persona_id = $2 order by sucursal_id",
            [e.empresa, op.id],
          ),
        ).toEqual(
          [
            { sucursal_id: e.sucursal, activa: false },
            { sucursal_id: norte, activa: true },
            { sucursal_id: sur, activa: true },
          ].sort((a, b) => (a.sucursal_id < b.sucursal_id ? -1 : 1)),
        );
        expect(await apoyo.auditoria(e.empresa, "ASIGNACIONES_CAMBIADAS")).toEqual([
          {
            accion: "ASIGNACIONES_CAMBIADAS",
            actor_persona_id: e.gerente,
            entidad: "membresia",
            entidad_id: op.id,
            antes: { sucursales: ids(e.sucursal) },
            despues: {
              sucursales: ids(norte, sur),
              agregadas: [sur],
              reactivadas: [norte],
              quitadas: [e.sucursal],
            },
          },
        ]);
      });

      it("idempotente: pedir el mismo conjunto (en otro orden, con repetidos) no escribe ni audita", async () => {
        const { e, norte, op } = await conTresSucursales();
        await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [e.sucursal, norte] });
        const antes = await foto([e.empresa]);

        const r = await casos.asignarSucursales(e.ctx, {
          personaId: op.id,
          sucursales: [norte, e.sucursal, norte, e.sucursal],
        });

        expect(r).toEqual({ ok: true, valor: { agregadas: [], reactivadas: [], quitadas: [] } });
        expect(await foto([e.empresa])).toBe(antes);
        expect(await apoyo.auditoria(e.empresa, "ASIGNACIONES_CAMBIADAS")).toHaveLength(1);
      });

      it("un conjunto vacío está permitido: quita todas; y repetirlo no escribe", async () => {
        const { e, norte, op } = await conTresSucursales();
        await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [e.sucursal, norte] });

        expect(await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [] })).toEqual({
          ok: true,
          valor: { agregadas: [], reactivadas: [], quitadas: ids(e.sucursal, norte) },
        });
        expect(await apoyo.asignadas(e.empresa, op.id)).toEqual([]);
        const antes = await foto([e.empresa]);
        expect(await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [] })).toEqual({
          ok: true,
          valor: { agregadas: [], reactivadas: [], quitadas: [] },
        });
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("volver a pedir lo que se quitó lo reactiva (no inserta otra fila)", async () => {
        const { e, norte, op } = await conTresSucursales();
        await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [norte] });
        await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [] });

        expect(
          await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [norte] }),
        ).toEqual({ ok: true, valor: { agregadas: [], reactivadas: [norte], quitadas: [] } });
        expect(
          await apoyo.contar(
            "select count(*) as n from asignacion_sucursal where empresa_id = $1 and persona_id = $2",
            [e.empresa, op.id],
          ),
        ).toBe(1);
      });

      it("el resultado se ve en la lista de miembros (asignación efectiva)", async () => {
        const { e, norte, op } = await conTresSucursales();
        await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [norte, e.sucursal] });
        const lista = await consultas.listarMiembros(e.ctx);
        expect(lista.ok && lista.valor.find((m) => m.personaId === op.id)?.sucursales).toEqual(
          ids(norte, e.sucursal),
        );
      });
    });

    // =============================================================================================
    describe("quién y qué sucursales", () => {
      it("el gerente y el administrador asignan a cualquier miembro activo (también al gerente y a otro administrador)", async () => {
        const { e, norte, op } = await conTresSucursales();
        const admin = await miembro(e, "ADMINISTRADOR");
        const otroAdmin = await miembro(e, "ADMINISTRADOR");
        for (const [actor, objetivo] of [
          [e.ctx, op.id],
          [admin.ctx, op.id],
          [admin.ctx, otroAdmin.id],
          [admin.ctx, e.gerente],
        ] as const) {
          const r = await casos.asignarSucursales(actor, {
            personaId: objetivo,
            sucursales: [norte],
          });
          expect(r.ok, `${actor.personaId} -> ${objetivo}`).toBe(true);
        }
        expect(await apoyo.asignadas(e.empresa, e.gerente)).toEqual([norte]);
      });

      it("un operador no asigna (ni a otros ni a sí mismo): SIN_PERMISO y nada escrito", async () => {
        const { e, norte, op } = await conTresSucursales();
        const antes = await foto([e.empresa]);
        expect(
          await casos.asignarSucursales(op.ctx, { personaId: op.id, sucursales: [norte] }),
        ).toEqual(SIN_PERMISO);
        expect(await foto([e.empresa])).toBe(antes);
      });

      const sinAcceso: {
        nombre: string;
        armar: (e: Escenario) => Promise<ContextoOperativo>;
      }[] = [
        {
          nombre: "un administrador apagado",
          armar: async (e) => (await miembro(e, "ADMINISTRADOR", false)).ctx,
        },
        {
          nombre: "una persona que no es miembro",
          armar: async (e) => comoEmpresa(e.empresa, await apoyo.personaSuelta()),
        },
        {
          nombre: "el sistema (sin persona)",
          armar: (e) => Promise.resolve(comoEmpresa(e.empresa, null)),
        },
        {
          nombre: "el gerente de OTRA empresa",
          armar: async (e) => comoEmpresa(e.empresa, (await escenario(e.tenant)).gerente),
        },
        {
          nombre: "un gerente suspendido globalmente (persona.activo_global = false)",
          armar: async (e) => {
            await apoyo.suspenderPersona(e.gerente);
            return e.ctx;
          },
        },
      ];
      for (const actor of sinAcceso) {
        it(`${actor.nombre} no asigna: SIN_PERMISO y nada escrito`, async () => {
          const { e, norte, op } = await conTresSucursales();
          const ctx = await actor.armar(e);
          const antes = await foto([e.empresa]);
          expect(
            await casos.asignarSucursales(ctx, { personaId: op.id, sucursales: [norte] }),
          ).toEqual(SIN_PERMISO);
          expect(await foto([e.empresa])).toBe(antes);
        });
      }

      it("una persona que no es miembro (suelta, de otra empresa o inexistente) da MEMBRESIA_NO_ENCONTRADA", async () => {
        const { e, norte } = await conTresSucursales();
        const otra = await escenario(e.tenant);
        const deOtra = await miembro(otra, "OPERADOR");
        const antes = await foto([e.empresa, otra.empresa]);
        for (const objetivo of [
          await apoyo.personaSuelta(),
          deOtra.id,
          personaId(apoyo.uuidAlAzar()),
        ]) {
          expect(
            await casos.asignarSucursales(e.ctx, { personaId: objetivo, sucursales: [norte] }),
          ).toEqual({ ok: false, error: "MEMBRESIA_NO_ENCONTRADA" });
        }
        expect(await foto([e.empresa, otra.empresa])).toBe(antes);
      });

      it("un miembro apagado da MEMBRESIA_INACTIVA, incluso con un conjunto vacío", async () => {
        const { e, norte } = await conTresSucursales();
        const apagado = await miembro(e, "OPERADOR", false);
        const antes = await foto([e.empresa]);
        for (const sucursales of [[norte], []]) {
          expect(
            await casos.asignarSucursales(e.ctx, { personaId: apagado.id, sucursales }),
          ).toEqual({ ok: false, error: "MEMBRESIA_INACTIVA" });
        }
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("una sucursal de OTRA empresa (aunque sea del mismo tenant), inexistente o mal escrita da SUCURSAL_NO_ES_DE_LA_EMPRESA y no escribe nada", async () => {
        const { e, norte, op } = await conTresSucursales();
        const otra = await escenario(e.tenant);
        const antes = await foto([e.empresa, otra.empresa]);
        for (const mala of [
          otra.sucursal,
          sucursalId(apoyo.uuidAlAzar()),
          sucursalId("no-es-un-id"),
        ]) {
          // Una buena y una mala: se rechaza todo el pedido, esté donde esté la mala.
          expect(
            await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [norte, mala] }),
          ).toEqual({ ok: false, error: "SUCURSAL_NO_ES_DE_LA_EMPRESA" });
        }
        expect(await foto([e.empresa, otra.empresa])).toBe(antes);
      });

      it("una sucursal desactivada que habría que asignar o reactivar da SUCURSAL_INACTIVA y no escribe nada", async () => {
        const { e, norte, sur, op } = await conTresSucursales();
        await apoyo.asignarDeBase(e, op.id, sur, false); // apagada: reactivarla sería escribir
        await apoyo.desactivarSucursalDeBase(norte);
        await apoyo.desactivarSucursalDeBase(sur);
        const antes = await foto([e.empresa]);
        for (const inactiva of [norte, sur]) {
          expect(
            await casos.asignarSucursales(e.ctx, {
              personaId: op.id,
              sucursales: [e.sucursal, inactiva],
            }),
          ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
        }
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("una asignación activa a una sucursal desactivada después se conserva sin error, y se puede quitar", async () => {
        const { e, norte, op } = await conTresSucursales();
        await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [e.sucursal, norte] });
        await apoyo.desactivarSucursalDeBase(norte);
        const antes = await foto([e.empresa]);

        // Reenviar el mismo conjunto: ok y sin escribir (conservar no es asignar).
        expect(
          await casos.asignarSucursales(e.ctx, {
            personaId: op.id,
            sucursales: [e.sucursal, norte],
          }),
        ).toEqual({ ok: true, valor: { agregadas: [], reactivadas: [], quitadas: [] } });
        expect(await foto([e.empresa])).toBe(antes);

        // Quitarla es posible aunque la sucursal esté desactivada.
        expect(
          await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [e.sucursal] }),
        ).toEqual({ ok: true, valor: { agregadas: [], reactivadas: [], quitadas: [norte] } });
        expect(await apoyo.asignadas(e.empresa, op.id)).toEqual([e.sucursal]);
      });

      it("el error del miembro va antes que el de las sucursales, y el guard antes que todo", async () => {
        const { e, norte } = await conTresSucursales();
        const apagado = await miembro(e, "OPERADOR", false);
        const operador = await miembro(e, "OPERADOR");
        expect(
          await casos.asignarSucursales(e.ctx, {
            personaId: apagado.id,
            sucursales: [sucursalId(apoyo.uuidAlAzar())],
          }),
        ).toEqual({ ok: false, error: "MEMBRESIA_INACTIVA" });
        expect(
          await casos.asignarSucursales(operador.ctx, {
            personaId: apagado.id,
            sucursales: [norte],
          }),
        ).toEqual(SIN_PERMISO);
      });
    });

    // =============================================================================================
    describe("aislamiento entre empresas", () => {
      it("la misma persona en dos empresas: asignar en una no toca las asignaciones de la otra", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const personaCompartida = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, a.empresa, personaCompartida.id, "OPERADOR");
        await crearMembresiaDeBase(dueno, b.empresa, personaCompartida.id, "OPERADOR");
        const persona = personaId(personaCompartida.id);
        await apoyo.asignarDeBase(b, persona, b.sucursal);
        const antesB = await foto([b.empresa]);

        const r = await casos.asignarSucursales(a.ctx, {
          personaId: persona,
          sucursales: [a.sucursal],
        });

        expect(r).toMatchObject({ ok: true, valor: { agregadas: [a.sucursal] } });
        expect(await foto([b.empresa])).toBe(antesB);
        expect(await apoyo.asignadas(b.empresa, persona)).toEqual([b.sucursal]);
        // Y desde A no se puede pedir la sucursal de B.
        expect(
          await casos.asignarSucursales(a.ctx, { personaId: persona, sucursales: [b.sucursal] }),
        ).toEqual({ ok: false, error: "SUCURSAL_NO_ES_DE_LA_EMPRESA" });
        // Ni quitar todo en A deja a la persona sin su asignación de B.
        await casos.asignarSucursales(a.ctx, { personaId: persona, sucursales: [] });
        expect(await apoyo.asignadas(b.empresa, persona)).toEqual([b.sucursal]);
      });

      it("el gerente de una empresa no asigna a un miembro de la otra", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const deB = await miembro(b, "OPERADOR");
        const antesB = await foto([b.empresa]);
        expect(
          await casos.asignarSucursales(a.ctx, { personaId: deB.id, sucursales: [a.sucursal] }),
        ).toEqual({ ok: false, error: "MEMBRESIA_NO_ENCONTRADA" });
        expect(await foto([b.empresa])).toBe(antesB);
      });
    });

    // =============================================================================================
    describe("la empresa tiene que operar", () => {
      for (const caso of [
        { nombre: "suspendida", motivo: "EMPRESA_SUSPENDIDA", donde: "empresa" },
        { nombre: "con el tenant suspendido", motivo: "TENANT_SUSPENDIDO", donde: "tenant" },
      ] as const) {
        it(`una empresa ${caso.nombre} no asigna: EMPRESA_NO_OPERA y nada escrito`, async () => {
          const { e, norte, op } = await conTresSucursales();
          if (caso.donde === "empresa") await apoyo.suspenderEmpresa(e.empresa);
          else await apoyo.suspenderTenant(e.tenant);
          const antes = await foto([e.empresa]);
          expect(
            await casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [norte] }),
          ).toEqual({
            ok: false,
            error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: caso.motivo },
          });
          expect(await foto([e.empresa])).toBe(antes);
        });
      }

      it("una empresa en alta no opera, y el motivo del guard va antes que el de la empresa", async () => {
        const enAlta = await crearEmpresaEnAlta(entorno);
        const g = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, enAlta.empresa, g.id, "GERENTE");
        expect(
          await casos.asignarSucursales(comoEmpresa(enAlta.empresa, personaId(g.id)), {
            personaId: personaId(g.id),
            sucursales: [],
          }),
        ).toEqual({
          ok: false,
          error: {
            codigo: "EMPRESA_NO_OPERA",
            empresaId: enAlta.empresa,
            motivo: "EMPRESA_EN_ALTA",
          },
        });

        const { e, op } = await conTresSucursales();
        await apoyo.suspenderEmpresa(e.empresa);
        expect(await casos.asignarSucursales(op.ctx, { personaId: op.id, sucursales: [] })).toEqual(
          SIN_PERMISO,
        );
      });
    });

    // =============================================================================================
    describe("atomicidad", () => {
      it("si falla una escritura a mitad de camino no queda ninguna (ni las altas, ni las reactivaciones, ni la auditoría)", async () => {
        const pasos: { nombre: string; romper: (tx: TxDePrueba) => TxDePrueba }[] = [
          {
            nombre: "la reactivación",
            romper: (tx) => ({
              ...tx,
              asignaciones: {
                ...tx.asignaciones,
                reactivar: () => Promise.reject(new Error("falla forzada: reactivar")),
              },
            }),
          },
          {
            nombre: "el apagado",
            romper: (tx) => ({
              ...tx,
              asignaciones: {
                ...tx.asignaciones,
                apagar: () => Promise.reject(new Error("falla forzada: apagar")),
              },
            }),
          },
          {
            nombre: "la auditoría",
            romper: (tx) => ({
              ...tx,
              auditoria: { registrar: () => Promise.reject(new Error("falla forzada: auditoría")) },
            }),
          },
        ];
        for (const paso of pasos) {
          const { e, norte, sur, op } = await conTresSucursales();
          await apoyo.asignarDeBase(e, op.id, e.sucursal); // se quita
          await apoyo.asignarDeBase(e, op.id, norte, false); // se reactiva
          // `sur` se agrega
          const falla = crearEntornoDePrueba(propia.base, 2, paso.romper);
          try {
            const antes = await foto([e.empresa]);
            await expect(
              crearCasos(falla).asignarSucursales(e.ctx, {
                personaId: op.id,
                sucursales: [norte, sur],
              }),
              paso.nombre,
            ).rejects.toThrow("falla forzada");
            expect(await foto([e.empresa]), paso.nombre).toBe(antes);
            expect(await apoyo.asignadas(e.empresa, op.id)).toEqual([e.sucursal]);
          } finally {
            await falla.cerrar();
          }
        }
      });

      it("si una actualización no toca la fila (cambió entre la lectura y la escritura) no inventa un éxito ni audita", async () => {
        const { e, norte, op } = await conTresSucursales();
        await apoyo.asignarDeBase(e, op.id, e.sucursal);
        await apoyo.asignarDeBase(e, op.id, norte, false);
        for (const metodo of ["reactivar", "apagar"] as const) {
          const sinEfecto = crearEntornoDePrueba(propia.base, 2, (tx) => ({
            ...tx,
            asignaciones: { ...tx.asignaciones, [metodo]: () => Promise.resolve(false) },
          }));
          try {
            const antes = await foto([e.empresa]);
            // Reactivar `norte` y quitar `e.sucursal`: las dos escrituras se intentan.
            expect(
              await crearCasos(sinEfecto).asignarSucursales(e.ctx, {
                personaId: op.id,
                sucursales: [norte],
              }),
              metodo,
            ).toEqual({ ok: false, error: "MEMBRESIA_NO_ENCONTRADA" });
            expect(await foto([e.empresa]), metodo).toBe(antes);
          } finally {
            await sinEfecto.cerrar();
          }
        }
      });
    });
  },
);
