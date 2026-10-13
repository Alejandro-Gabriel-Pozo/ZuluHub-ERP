import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  estadoDeTraspaso,
  type CasosDeUsoDeIdentidad,
  type ConsultasDeIdentidad,
  type Membresia,
} from "../../src/modulos/identidad/publico";
import { personaId } from "../../src/primitivas/identificadores/marca";
import type { OpcionesDeTransaccion, Transacciones } from "../../src/puertos/transacciones";
import {
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type TxDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import { ahora, crearApoyoDeTraspaso, en, type Escenario } from "./traspaso-apoyo";

/**
 * H6, tramo T4: el traspaso de gerencia (proponer, cancelar, aceptar, rechazar), la consulta
 * `traspasoEnCurso` y el cambio de `apagarMembresia` (cancela el traspaso del entrante apagado),
 * contra una base real, con los roles limitados y el contexto firmado (nunca el dueño de la base,
 * salvo para armar el escenario y para mirar). Cubre autorización por rol, aislamiento entre
 * empresas, idempotencia, atomicidad y auditoría. La concurrencia está en
 * `traspaso-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");

// Con la máquina cargada una prueba puede tardar varias veces lo normal: el límite es holgado a
// propósito (lo que se prueba es el efecto de cada caso de uso, no la velocidad).
const LIMITE_EN_MS = 60_000;

describe.skipIf(base === null)(
  "traspaso de gerencia: casos de uso y consulta contra una base real",
  { timeout: LIMITE_EN_MS },
  () => {
    // Base propia de este archivo (ver `identidad-casos-de-uso.test.ts`).
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let casos: CasosDeUsoDeIdentidad;
    let consultas: ConsultasDeIdentidad;
    let apoyo: ReturnType<typeof crearApoyoDeTraspaso>;
    /** Las opciones con las que las consultas abren su transacción. */
    const opcionesVistas: OpcionesDeTransaccion[] = [];

    const REGLAS = REGLAS_DE_EMPRESA;
    const crearCasos = (transacciones: Transacciones<TxDePrueba>) =>
      crearCasosDeUsoDeIdentidad({
        transacciones,
        tokens: crearTokensHmac(randomBytes(32)),
        reglas: REGLAS,
      });

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 10);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      apoyo = crearApoyoDeTraspaso(entorno, dueno);
      casos = crearCasos(entorno);
      const espia: Transacciones<TxDePrueba> = {
        ejecutar: (opciones, trabajo) => {
          opcionesVistas.push(opciones);
          return entorno.ejecutar(opciones, trabajo);
        },
      };
      consultas = crearConsultasDeIdentidad({ transacciones: espia, reglas: REGLAS });
    }, LIMITE_EN_MS);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    }, LIMITE_EN_MS);

    // Atajos a las miradas y escenarios (el apoyo se arma en `beforeAll`).
    const escenario = (tenant?: Escenario["tenant"]) => apoyo.escenario(tenant);
    const miembro = (...a: Parameters<typeof apoyo.miembro>) => apoyo.miembro(...a);
    const auditoria = (...a: Parameters<typeof apoyo.auditoria>) => apoyo.auditoria(...a);
    const trabajos = (empresa: string) => apoyo.trabajos(empresa);
    const traspaso = (id: string) => apoyo.traspaso(id);
    const membresia = (empresa: string, persona: string) => apoyo.membresia(empresa, persona);
    const foto = (empresas: string[]) => apoyo.foto(empresas);

    /** Un traspaso en curso del gerente a un operador nuevo, armado por el dueño. */
    const conTraspaso = async (e: Escenario, rol: "OPERADOR" | "ADMINISTRADOR" = "OPERADOR") => {
      const entrante = await miembro(e, rol);
      const id = await apoyo.proponerDeBase(e, entrante.id);
      return { entrante, id };
    };

    const SIN_PERMISO = { ok: false, error: "SIN_PERMISO" };

    /**
     * Quienes NO tienen permiso de gerente: cada uno da SIN_PERMISO y no cambia nada. El guard lee el
     * rol dentro de la transacción, así que también cubre a quien perdió el acceso hace un instante.
     */
    type Actor = { nombre: string; armar: (e: Escenario) => Promise<ContextoOperativo> };
    const sinAcceso: Actor[] = [
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
    const soloGerente: Actor[] = [
      ...sinAcceso,
      { nombre: "un administrador", armar: async (e) => (await miembro(e, "ADMINISTRADOR")).ctx },
      { nombre: "un operador", armar: async (e) => (await miembro(e, "OPERADOR")).ctx },
    ];

    // =============================================================================================
    describe("proponerTraspaso", () => {
      it("el gerente propone a un operador: nace PROPUESTO a 7 días, con su auditoría y su aviso, sin tocar ningún rol", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");

        const r = await casos.proponerTraspaso(e.ctx, { entrantePersonaId: op.id });

        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.valor.yaExistia).toBe(false);
        const id = r.valor.traspasoId;
        expect(await traspaso(id)).toMatchObject({
          empresa_id: e.empresa,
          origen: "GERENTE",
          propuesto_por: e.gerente,
          saliente_persona_id: e.gerente,
          entrante_persona_id: op.id,
          estado: "PROPUESTO",
          propuesto_en: ahora,
          // Siete días corridos desde `ahora`, escritos acá a propósito (no con la función del dominio).
          vence_en: new Date("2026-10-18T12:00:00Z"),
          resuelto_en: null,
          motivo: null,
          version: 1,
        });
        expect(await auditoria(e.empresa, "TRASPASO_PROPUESTO")).toEqual([
          {
            accion: "TRASPASO_PROPUESTO",
            actor_persona_id: e.gerente,
            entidad: "traspaso_gerencia",
            entidad_id: id,
            antes: null,
            despues: {
              origen: "GERENTE",
              saliente: e.gerente,
              entrante: op.id,
              venceEn: "2026-10-18T12:00:00.000Z",
              reemplazaA: null,
            },
          },
        ]);
        expect(await trabajos(e.empresa)).toEqual([
          {
            tipo: "avisar_traspaso_propuesto",
            datos: { traspasoId: id },
            clave_idempotencia: `traspaso:${id}:propuesto`,
          },
        ]);
        // Proponer no cambia ningún rol: sin aceptación no hay cambio.
        expect(await membresia(e.empresa, e.gerente)).toMatchObject({
          rol: "GERENTE",
          activo: true,
        });
        expect(await membresia(e.empresa, op.id)).toMatchObject({ rol: "OPERADOR", activo: true });
      });

      it("también se le puede proponer a un administrador", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        const r = await casos.proponerTraspaso(e.ctx, { entrantePersonaId: admin.id });
        expect(r).toMatchObject({ ok: true, valor: { yaExistia: false } });
      });

      it("idempotente: proponer dos veces al mismo entrante devuelve el mismo id, sin escribir, auditar ni avisar de nuevo", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        const primera = await casos.proponerTraspaso(e.ctx, { entrantePersonaId: op.id });
        if (!primera.ok) throw new Error("no se pudo proponer");
        const antes = await foto([e.empresa]);

        const segunda = await casos.proponerTraspaso(e.ctx, { entrantePersonaId: op.id });

        expect(segunda).toEqual({
          ok: true,
          valor: { traspasoId: primera.valor.traspasoId, yaExistia: true },
        });
        expect(await foto([e.empresa])).toBe(antes);
        expect(await apoyo.traspasosDe(e.empresa)).toHaveLength(1);
        expect(await auditoria(e.empresa, "TRASPASO_PROPUESTO")).toHaveLength(1);
        expect(await trabajos(e.empresa)).toHaveLength(1);
      });

      it("a otro entrante mientras hay una propuesta vigente da TRASPASO_EN_CURSO y no cambia nada", async () => {
        const e = await escenario();
        const { id } = await conTraspaso(e);
        const otro = await miembro(e, "ADMINISTRADOR");
        const antes = await foto([e.empresa]);

        expect(await casos.proponerTraspaso(e.ctx, { entrantePersonaId: otro.id })).toEqual({
          ok: false,
          error: "TRASPASO_EN_CURSO",
        });

        expect(await foto([e.empresa])).toBe(antes);
        expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO" });
      });

      it("una propuesta VENCIDA se cancela (motivo VENCIDO) y la nueva ocupa su lugar, al mismo entrante o a otro", async () => {
        for (const alMismo of [true, false]) {
          const e = await escenario();
          const viejo = await miembro(e, "OPERADOR");
          const vencido = await apoyo.proponerDeBase(e, viejo.id, {
            propuestoEn: en(-8),
            venceEn: en(-1),
          });
          const nuevoEntrante = alMismo ? viejo : await miembro(e, "ADMINISTRADOR");

          const r = await casos.proponerTraspaso(e.ctx, { entrantePersonaId: nuevoEntrante.id });

          expect(r.ok, `alMismo=${alMismo}`).toBe(true);
          if (!r.ok) return;
          expect(r.valor.yaExistia).toBe(false);
          expect(r.valor.traspasoId).not.toBe(vencido);
          expect(await traspaso(vencido)).toMatchObject({
            estado: "CANCELADO",
            motivo: "VENCIDO",
            resuelto_en: ahora,
          });
          expect(await traspaso(r.valor.traspasoId)).toMatchObject({
            estado: "PROPUESTO",
            entrante_persona_id: nuevoEntrante.id,
            vence_en: new Date("2026-10-18T12:00:00Z"),
          });
          // Una sola en curso, y las dos auditorías van juntas y en orden.
          expect(
            (await apoyo.traspasosDe(e.empresa)).filter((t) => t["estado"] === "PROPUESTO"),
          ).toHaveLength(1);
          expect((await auditoria(e.empresa)).map((a) => a["accion"])).toEqual([
            "TRASPASO_CANCELADO",
            "TRASPASO_PROPUESTO",
          ]);
          expect((await auditoria(e.empresa, "TRASPASO_CANCELADO"))[0]).toMatchObject({
            actor_persona_id: e.gerente,
            entidad_id: vencido,
            antes: { estado: "PROPUESTO", entrante: viejo.id },
            despues: { estado: "CANCELADO", motivo: "VENCIDO" },
          });
          expect((await auditoria(e.empresa, "TRASPASO_PROPUESTO"))[0]).toMatchObject({
            despues: { reemplazaA: vencido },
          });
        }
      });

      it("el límite exacto del vencimiento: con `ahora` igual a `vence_en` ya está vencida; un milisegundo antes sigue vigente", async () => {
        const a = await escenario();
        const opA = await miembro(a, "OPERADOR");
        const exacto = await apoyo.proponerDeBase(a, opA.id, {
          propuestoEn: en(-7),
          venceEn: ahora,
        });
        const rA = await casos.proponerTraspaso(a.ctx, { entrantePersonaId: opA.id });
        expect(rA).toMatchObject({ ok: true, valor: { yaExistia: false } });
        expect(await traspaso(exacto)).toMatchObject({ estado: "CANCELADO", motivo: "VENCIDO" });

        const b = await escenario();
        const opB = await miembro(b, "OPERADOR");
        const vigente = await apoyo.proponerDeBase(b, opB.id, {
          propuestoEn: en(-7),
          venceEn: new Date(ahora.getTime() + 1),
        });
        expect(await casos.proponerTraspaso(b.ctx, { entrantePersonaId: opB.id })).toEqual({
          ok: true,
          valor: { traspasoId: vigente, yaExistia: true },
        });
        expect(await traspaso(vigente)).toMatchObject({ estado: "PROPUESTO" });
      });

      it("una propuesta resuelta (rechazada o cancelada) no estorba: se puede proponer de nuevo", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        expect(await casos.rechazarTraspaso(entrante.ctx, { traspasoId: id })).toMatchObject({
          ok: true,
        });
        const otra = await casos.proponerTraspaso(e.ctx, { entrantePersonaId: entrante.id });
        expect(otra).toMatchObject({ ok: true, valor: { yaExistia: false } });
        expect(await apoyo.traspasosDe(e.empresa)).toHaveLength(2);
      });

      it("el entrante tiene que ser un miembro activo de ESTA empresa", async () => {
        const e = await escenario();
        const otraEmpresa = await escenario(e.tenant);
        const deOtra = await miembro(otraEmpresa, "OPERADOR");
        const inexistente = personaId(apoyo.uuidAlAzar());
        const suelta = await apoyo.personaSuelta();
        const antes = await foto([e.empresa, otraEmpresa.empresa]);

        for (const entrantePersonaId of [suelta, deOtra.id, inexistente]) {
          expect(await casos.proponerTraspaso(e.ctx, { entrantePersonaId })).toEqual({
            ok: false,
            error: "ENTRANTE_NO_ES_MIEMBRO",
          });
        }
        expect(await foto([e.empresa, otraEmpresa.empresa])).toBe(antes);
      });

      it("un miembro apagado o una persona suspendida globalmente dan ENTRANTE_INACTIVO", async () => {
        const e = await escenario();
        const apagado = await miembro(e, "OPERADOR", false);
        const suspendido = await miembro(e, "ADMINISTRADOR");
        await apoyo.suspenderPersona(suspendido.id);
        const antes = await foto([e.empresa]);

        for (const entrantePersonaId of [apagado.id, suspendido.id]) {
          expect(await casos.proponerTraspaso(e.ctx, { entrantePersonaId })).toEqual({
            ok: false,
            error: "ENTRANTE_INACTIVO",
          });
        }
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("no se le propone la gerencia al gerente mismo: ENTRANTE_ES_EL_GERENTE", async () => {
        const e = await escenario();
        const antes = await foto([e.empresa]);
        expect(await casos.proponerTraspaso(e.ctx, { entrantePersonaId: e.gerente })).toEqual({
          ok: false,
          error: "ENTRANTE_ES_EL_GERENTE",
        });
        expect(await foto([e.empresa])).toBe(antes);
      });

      for (const actor of soloGerente) {
        it(`${actor.nombre} no propone: SIN_PERMISO y nada escrito`, async () => {
          const e = await escenario();
          const op = await miembro(e, "OPERADOR");
          const ctx = await actor.armar(e);
          const antes = await foto([e.empresa]);

          expect(await casos.proponerTraspaso(ctx, { entrantePersonaId: op.id })).toEqual(
            SIN_PERMISO,
          );
          expect(await foto([e.empresa])).toBe(antes);
        });
      }

      it("atomicidad: si falla la auditoría no queda la propuesta ni el aviso", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          auditoria: {
            registrar: () => Promise.reject(new Error("falla forzada de la auditoría")),
          },
        }));
        try {
          const roto = crearCasos(falla);
          const antes = await foto([e.empresa]);
          await expect(roto.proponerTraspaso(e.ctx, { entrantePersonaId: op.id })).rejects.toThrow(
            "falla forzada de la auditoría",
          );
          expect(await foto([e.empresa])).toBe(antes);
          expect(await apoyo.traspasosDe(e.empresa)).toEqual([]);
        } finally {
          await falla.cerrar();
        }
      });

      it("atomicidad: si falla el aviso no queda la propuesta ni la auditoría, y cancelar la vencida se deshace", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        const vencido = await apoyo.proponerDeBase(e, op.id, {
          propuestoEn: en(-8),
          venceEn: en(-1),
        });
        const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          trabajos: { encolar: () => Promise.reject(new Error("falla forzada del aviso")) },
        }));
        try {
          const roto = crearCasos(falla);
          const antes = await foto([e.empresa]);
          await expect(roto.proponerTraspaso(e.ctx, { entrantePersonaId: op.id })).rejects.toThrow(
            "falla forzada del aviso",
          );
          expect(await foto([e.empresa])).toBe(antes);
          expect(await traspaso(vencido)).toMatchObject({ estado: "PROPUESTO" });
        } finally {
          await falla.cerrar();
        }
      });

      it("aislamiento: proponer en una empresa no toca la otra (ni su traspaso en curso)", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const { id: idDeB } = await conTraspaso(b);
        const opA = await miembro(a, "OPERADOR");
        const antesB = await foto([b.empresa]);

        const r = await casos.proponerTraspaso(a.ctx, { entrantePersonaId: opA.id });

        expect(r).toMatchObject({ ok: true, valor: { yaExistia: false } });
        expect(await foto([b.empresa])).toBe(antesB);
        expect(await traspaso(idDeB)).toMatchObject({ estado: "PROPUESTO" });
        // Cada empresa tiene SU propuesta en curso.
        expect(await apoyo.traspasosDe(a.empresa)).toHaveLength(1);
        expect(await apoyo.traspasosDe(b.empresa)).toHaveLength(1);
      });
    });

    // =============================================================================================
    describe("cancelarTraspaso", () => {
      it("el gerente cancela la propuesta en curso: queda CANCELADO con su auditoría, sin aviso y sin tocar roles", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);

        expect(await casos.cancelarTraspaso(e.ctx, {})).toEqual({
          ok: true,
          valor: { yaNoHabia: false },
        });

        expect(await traspaso(id)).toMatchObject({
          estado: "CANCELADO",
          resuelto_en: ahora,
          motivo: null,
        });
        expect(await auditoria(e.empresa)).toEqual([
          {
            accion: "TRASPASO_CANCELADO",
            actor_persona_id: e.gerente,
            entidad: "traspaso_gerencia",
            entidad_id: id,
            antes: { estado: "PROPUESTO", entrante: entrante.id },
            despues: { estado: "CANCELADO", motivo: null },
          },
        ]);
        expect(await trabajos(e.empresa)).toEqual([]);
        expect(await apoyo.gerentesActivos(e.empresa)).toEqual([e.gerente]);
        expect(await membresia(e.empresa, entrante.id)).toMatchObject({ rol: "OPERADOR" });
        // Con la plaza libre, se puede volver a proponer.
        expect(
          await casos.proponerTraspaso(e.ctx, { entrantePersonaId: entrante.id }),
        ).toMatchObject({ ok: true, valor: { yaExistia: false } });
      });

      it("idempotente: cancelar dos veces, o sin propuesta, es ok y no escribe ni audita", async () => {
        const e = await escenario();
        expect(await casos.cancelarTraspaso(e.ctx, {})).toEqual({
          ok: true,
          valor: { yaNoHabia: true },
        });
        await conTraspaso(e);
        expect(await casos.cancelarTraspaso(e.ctx, {})).toMatchObject({
          ok: true,
          valor: { yaNoHabia: false },
        });
        const antes = await foto([e.empresa]);

        expect(await casos.cancelarTraspaso(e.ctx, {})).toEqual({
          ok: true,
          valor: { yaNoHabia: true },
        });

        expect(await foto([e.empresa])).toBe(antes);
        expect(await auditoria(e.empresa, "TRASPASO_CANCELADO")).toHaveLength(1);
      });

      it("una propuesta vencida que sigue guardada también se cancela (libera el lugar sin error)", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        const vencido = await apoyo.proponerDeBase(e, op.id, {
          propuestoEn: en(-8),
          venceEn: en(-1),
        });
        expect(await casos.cancelarTraspaso(e.ctx, {})).toEqual({
          ok: true,
          valor: { yaNoHabia: false },
        });
        expect(await traspaso(vencido)).toMatchObject({ estado: "CANCELADO", motivo: null });
      });

      for (const actor of soloGerente) {
        it(`${actor.nombre} no cancela: SIN_PERMISO y nada escrito`, async () => {
          const e = await escenario();
          const { id } = await conTraspaso(e);
          const ctx = await actor.armar(e);
          const antes = await foto([e.empresa]);

          expect(await casos.cancelarTraspaso(ctx, {})).toEqual(SIN_PERMISO);
          expect(await foto([e.empresa])).toBe(antes);
          expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO" });
        });
      }

      it("una vez aceptado, quien era gerente (ahora administrador) ya no cancela, y el nuevo gerente no encuentra nada que cancelar", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        expect(await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id })).toMatchObject({
          ok: true,
        });
        const antes = await foto([e.empresa]);

        expect(await casos.cancelarTraspaso(e.ctx, {})).toEqual(SIN_PERMISO);
        expect(await casos.cancelarTraspaso(entrante.ctx, {})).toEqual({
          ok: true,
          valor: { yaNoHabia: true },
        });
        expect(await foto([e.empresa])).toBe(antes);
        expect(await traspaso(id)).toMatchObject({ estado: "ACEPTADO" });
      });

      it("aislamiento: cancelar en una empresa no toca la propuesta de la otra", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        await conTraspaso(a);
        const { id: idDeB } = await conTraspaso(b);
        const antesB = await foto([b.empresa]);

        expect(await casos.cancelarTraspaso(a.ctx, {})).toMatchObject({
          ok: true,
          valor: { yaNoHabia: false },
        });

        expect(await foto([b.empresa])).toBe(antesB);
        expect(await traspaso(idDeB)).toMatchObject({ estado: "PROPUESTO" });
      });

      it("atomicidad: si falla la auditoría la propuesta sigue en curso", async () => {
        const e = await escenario();
        const { id } = await conTraspaso(e);
        const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          auditoria: {
            registrar: () => Promise.reject(new Error("falla forzada de la auditoría")),
          },
        }));
        try {
          const antes = await foto([e.empresa]);
          await expect(crearCasos(falla).cancelarTraspaso(e.ctx, {})).rejects.toThrow(
            "falla forzada de la auditoría",
          );
          expect(await foto([e.empresa])).toBe(antes);
          expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO", resuelto_en: null });
        } finally {
          await falla.cerrar();
        }
      });

      it("si la actualización no toca la fila (otro la resolvió entre la lectura y la escritura) no inventa un éxito ni audita", async () => {
        const e = await escenario();
        await conTraspaso(e);
        const sinEfecto = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          traspasos: { ...tx.traspasos, cancelar: () => Promise.resolve(false) },
        }));
        try {
          const antes = await foto([e.empresa]);
          expect(await crearCasos(sinEfecto).cancelarTraspaso(e.ctx, {})).toEqual({
            ok: false,
            error: "TRASPASO_RESUELTO",
          });
          expect(await foto([e.empresa])).toBe(antes);
        } finally {
          await sinEfecto.cerrar();
        }
      });
    });

    // =============================================================================================
    describe("aceptarTraspaso", () => {
      for (const rol of ["OPERADOR", "ADMINISTRADOR"] as const) {
        it(`el entrante (${rol}) acepta: el traspaso queda ACEPTADO, el gerente baja a administrador, el entrante sube, con sus tres auditorías y su aviso`, async () => {
          const e = await escenario();
          const { entrante, id } = await conTraspaso(e, rol);
          const trabajosAntes = await trabajos(e.empresa);

          expect(await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id })).toEqual({
            ok: true,
            valor: { yaEstabaAceptado: false },
          });

          expect(await traspaso(id)).toMatchObject({
            estado: "ACEPTADO",
            resuelto_en: ahora,
            saliente_persona_id: e.gerente,
            entrante_persona_id: entrante.id,
            motivo: null,
            version: 2,
          });
          // El rol cambia de las dos membresías, ambas siguen activas, y queda UN solo gerente.
          expect(await membresia(e.empresa, e.gerente)).toMatchObject({
            rol: "ADMINISTRADOR",
            activo: true,
          });
          expect(await membresia(e.empresa, entrante.id)).toMatchObject({
            rol: "GERENTE",
            activo: true,
          });
          expect(await apoyo.gerentesActivos(e.empresa)).toEqual([entrante.id]);
          // Las tres auditorías, en orden, con el antes y el después; las hace el entrante (quien acepta).
          expect(await auditoria(e.empresa)).toEqual([
            {
              accion: "TRASPASO_ACEPTADO",
              actor_persona_id: entrante.id,
              entidad: "traspaso_gerencia",
              entidad_id: id,
              antes: { estado: "PROPUESTO" },
              despues: { estado: "ACEPTADO", saliente: e.gerente, entrante: entrante.id },
            },
            {
              accion: "MEMBRESIA_ROL_CAMBIADO",
              actor_persona_id: entrante.id,
              entidad: "membresia",
              entidad_id: e.gerente,
              antes: { rol: "GERENTE" },
              despues: { rol: "ADMINISTRADOR", traspaso: id },
            },
            {
              accion: "MEMBRESIA_ROL_CAMBIADO",
              actor_persona_id: entrante.id,
              entidad: "membresia",
              entidad_id: entrante.id,
              antes: { rol: rol },
              despues: { rol: "GERENTE", traspaso: id },
            },
          ]);
          expect(await trabajos(e.empresa)).toEqual([
            ...trabajosAntes,
            {
              tipo: "avisar_traspaso_aceptado",
              datos: { traspasoId: id },
              clave_idempotencia: `traspaso:${id}:aceptado`,
            },
          ]);
        });
      }

      it("el nuevo gerente puede apagar al anterior (que quedó como administrador); al revés, el anterior no puede apagar al gerente nuevo", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id });

        expect(await casos.apagarMembresia(e.ctx, { personaId: entrante.id })).toEqual({
          ok: false,
          error: "ES_EL_GERENTE",
        });
        expect(await casos.apagarMembresia(entrante.ctx, { personaId: e.gerente })).toMatchObject({
          ok: true,
          valor: { yaEstabaApagada: false },
        });
        expect(await membresia(e.empresa, e.gerente)).toMatchObject({
          rol: "ADMINISTRADOR",
          activo: false,
        });
        expect(await apoyo.gerentesActivos(e.empresa)).toEqual([entrante.id]);
      });

      it("idempotente: aceptar dos veces es ok y la segunda no escribe, no audita ni avisa de nuevo", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id });
        const antes = await foto([e.empresa]);

        expect(await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id })).toEqual({
          ok: true,
          valor: { yaEstabaAceptado: true },
        });

        expect(await foto([e.empresa])).toBe(antes);
        expect(await auditoria(e.empresa, "TRASPASO_ACEPTADO")).toHaveLength(1);
        expect(await auditoria(e.empresa, "MEMBRESIA_ROL_CAMBIADO")).toHaveLength(2);
        expect(await trabajos(e.empresa)).toHaveLength(1);
      });

      it("solo acepta el entrante: otro miembro, o el propio gerente que propuso, dan TRASPASO_NO_ES_PARA_VOS", async () => {
        const e = await escenario();
        const { id } = await conTraspaso(e);
        const otroAdmin = await miembro(e, "ADMINISTRADOR");
        const otroOperador = await miembro(e, "OPERADOR");
        const antes = await foto([e.empresa]);

        for (const ctx of [e.ctx, otroAdmin.ctx, otroOperador.ctx]) {
          expect(await casos.aceptarTraspaso(ctx, { traspasoId: id })).toEqual({
            ok: false,
            error: "TRASPASO_NO_ES_PARA_VOS",
          });
        }
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("un traspaso inexistente, un texto que no es un id o uno de OTRA empresa dan TRASPASO_NO_ENCONTRADO", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        const { entrante: deOtra, id: idDeOtra } = await conTraspaso(otra);
        const miOperador = await miembro(e, "OPERADOR");
        const antes = await foto([e.empresa, otra.empresa]);

        for (const traspasoId of [apoyo.uuidAlAzar(), "no-es-un-id", "", idDeOtra]) {
          expect(await casos.aceptarTraspaso(miOperador.ctx, { traspasoId })).toEqual({
            ok: false,
            error: "TRASPASO_NO_ENCONTRADO",
          });
        }
        // Ni siquiera el entrante de la otra empresa lo acepta desde esta.
        const entranteDeOtraAca = comoEmpresa(e.empresa, deOtra.id);
        expect(await casos.aceptarTraspaso(entranteDeOtraAca, { traspasoId: idDeOtra })).toEqual(
          SIN_PERMISO,
        );
        expect(await foto([e.empresa, otra.empresa])).toBe(antes);
      });

      it("uno rechazado o cancelado da TRASPASO_RESUELTO y no cambia nada", async () => {
        const e = await escenario();
        const rechazado = await conTraspaso(e);
        await casos.rechazarTraspaso(rechazado.entrante.ctx, { traspasoId: rechazado.id });
        const cancelado = await conTraspaso(e);
        await casos.cancelarTraspaso(e.ctx, {});
        const antes = await foto([e.empresa]);

        expect(
          await casos.aceptarTraspaso(rechazado.entrante.ctx, { traspasoId: rechazado.id }),
        ).toEqual({ ok: false, error: "TRASPASO_RESUELTO" });
        expect(
          await casos.aceptarTraspaso(cancelado.entrante.ctx, { traspasoId: cancelado.id }),
        ).toEqual({ ok: false, error: "TRASPASO_RESUELTO" });
        expect(await foto([e.empresa])).toBe(antes);
        expect(await apoyo.gerentesActivos(e.empresa)).toEqual([e.gerente]);
      });

      it("uno vencido da TRASPASO_VENCIDO: con `ahora` igual a `vence_en` ya no, un milisegundo antes sí", async () => {
        const a = await escenario();
        const opA = await miembro(a, "OPERADOR");
        const exacto = await apoyo.proponerDeBase(a, opA.id, {
          propuestoEn: en(-7),
          venceEn: ahora,
        });
        const antes = await foto([a.empresa]);
        expect(await casos.aceptarTraspaso(opA.ctx, { traspasoId: exacto })).toEqual({
          ok: false,
          error: "TRASPASO_VENCIDO",
        });
        expect(await foto([a.empresa])).toBe(antes);

        const b = await escenario();
        const opB = await miembro(b, "OPERADOR");
        const justo = await apoyo.proponerDeBase(b, opB.id, {
          propuestoEn: en(-7),
          venceEn: new Date(ahora.getTime() + 1),
        });
        expect(await casos.aceptarTraspaso(opB.ctx, { traspasoId: justo })).toMatchObject({
          ok: true,
        });
      });

      it("el entrante apagado no acepta (SIN_PERMISO) y su traspaso ya fue cancelado al apagarlo", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        await casos.apagarMembresia(e.ctx, { personaId: entrante.id });

        expect(await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id })).toEqual(SIN_PERMISO);
        expect(await traspaso(id)).toMatchObject({
          estado: "CANCELADO",
          motivo: "ENTRANTE_DADO_DE_BAJA",
        });
        expect(await apoyo.gerentesActivos(e.empresa)).toEqual([e.gerente]);
      });

      it("una persona suspendida globalmente (activo_global = false) no acepta: el guard le quita todo permiso", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        await apoyo.suspenderPersona(entrante.id);
        const antes = await foto([e.empresa]);

        expect(await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id })).toEqual(SIN_PERMISO);
        expect(await casos.rechazarTraspaso(entrante.ctx, { traspasoId: id })).toEqual(SIN_PERMISO);

        expect(await foto([e.empresa])).toBe(antes);
        expect(await apoyo.gerentesActivos(e.empresa)).toEqual([e.gerente]);
      });

      for (const actor of sinAcceso) {
        it(`${actor.nombre} no acepta: SIN_PERMISO y nada escrito`, async () => {
          const e = await escenario();
          const { id } = await conTraspaso(e);
          const ctx = await actor.armar(e);
          const antes = await foto([e.empresa]);

          expect(await casos.aceptarTraspaso(ctx, { traspasoId: id })).toEqual(SIN_PERMISO);
          expect(await foto([e.empresa])).toBe(antes);
        });
      }

      it("un traspaso de la plataforma (sin saliente anotado) se acepta igual: el saliente es el gerente vigente de ese momento", async () => {
        const e = await escenario();
        const entrante = await miembro(e, "ADMINISTRADOR");
        const id = await apoyo.proponerDePlataformaDeBase(e, entrante.id);
        expect(await traspaso(id)).toMatchObject({
          origen: "PLATAFORMA",
          saliente_persona_id: null,
        });

        expect(await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id })).toMatchObject({
          ok: true,
          valor: { yaEstabaAceptado: false },
        });

        expect(await traspaso(id)).toMatchObject({
          estado: "ACEPTADO",
          saliente_persona_id: e.gerente,
        });
        expect(await apoyo.gerentesActivos(e.empresa)).toEqual([entrante.id]);
        expect(await membresia(e.empresa, e.gerente)).toMatchObject({ rol: "ADMINISTRADOR" });
      });

      for (const caso of [
        { nombre: "suspendida", preparar: "suspenderEmpresa", motivo: "EMPRESA_SUSPENDIDA" },
        {
          nombre: "con el tenant suspendido",
          preparar: "suspenderTenant",
          motivo: "TENANT_SUSPENDIDO",
        },
      ] as const) {
        it(`una empresa ${caso.nombre} no acepta: EMPRESA_NO_OPERA y nada escrito`, async () => {
          const e = await escenario();
          const { entrante, id } = await conTraspaso(e);
          await apoyo[caso.preparar](caso.preparar === "suspenderEmpresa" ? e.empresa : e.tenant);
          const antes = await foto([e.empresa]);

          expect(await casos.aceptarTraspaso(entrante.ctx, { traspasoId: id })).toEqual({
            ok: false,
            error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: caso.motivo },
          });
          expect(await foto([e.empresa])).toBe(antes);
        });
      }

      it("atomicidad: si falla cualquier paso no queda nada (ni el ACEPTADO, ni los roles, ni la auditoría, ni el aviso)", async () => {
        const pasos: { nombre: string; romper: (tx: TxDePrueba) => TxDePrueba }[] = [
          {
            nombre: "el ascenso del entrante",
            romper: (tx) => {
              let llamadas = 0;
              return {
                ...tx,
                membresias: {
                  ...tx.membresias,
                  cambiarRol: (...args) => {
                    llamadas += 1;
                    if (llamadas === 2) return Promise.reject(new Error("falla forzada: ascenso"));
                    return tx.membresias.cambiarRol(...args);
                  },
                },
              };
            },
          },
          {
            nombre: "la tercera auditoría",
            romper: (tx) => {
              let llamadas = 0;
              return {
                ...tx,
                auditoria: {
                  registrar: (registro) => {
                    llamadas += 1;
                    if (llamadas === 3)
                      return Promise.reject(new Error("falla forzada: auditoría"));
                    return tx.auditoria.registrar(registro);
                  },
                },
              };
            },
          },
          {
            nombre: "el aviso",
            romper: (tx) => ({
              ...tx,
              trabajos: { encolar: () => Promise.reject(new Error("falla forzada: aviso")) },
            }),
          },
        ];
        for (const paso of pasos) {
          const e = await escenario();
          const { entrante, id } = await conTraspaso(e);
          const falla = crearEntornoDePrueba(propia.base, 2, paso.romper);
          try {
            const antes = await foto([e.empresa]);
            await expect(
              crearCasos(falla).aceptarTraspaso(entrante.ctx, { traspasoId: id }),
              paso.nombre,
            ).rejects.toThrow("falla forzada");
            expect(await foto([e.empresa]), paso.nombre).toBe(antes);
            expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO", resuelto_en: null });
            expect(await apoyo.gerentesActivos(e.empresa)).toEqual([e.gerente]);
            expect(await membresia(e.empresa, entrante.id)).toMatchObject({ rol: "OPERADOR" });
          } finally {
            await falla.cerrar();
          }
        }
      });

      it("si el saliente ya no es el gerente vigente da SALIENTE_YA_NO_ES_GERENTE y no escribe", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        // La base no deja armar esto de verdad (el gerente solo cambia por traspaso): se lo hace
        // ver al caso de uso con una lectura sin gerente.
        const sinGerente = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          membresias: {
            ...tx.membresias,
            listarActivas: async (empresa) =>
              (await tx.membresias.listarActivas(empresa)).filter(
                (m: Membresia) => m.rol !== "GERENTE",
              ),
          },
        }));
        try {
          const antes = await foto([e.empresa]);
          expect(
            await crearCasos(sinGerente).aceptarTraspaso(entrante.ctx, { traspasoId: id }),
          ).toEqual({ ok: false, error: "SALIENTE_YA_NO_ES_GERENTE" });
          expect(await foto([e.empresa])).toBe(antes);
        } finally {
          await sinGerente.cerrar();
        }
      });

      it("si una actualización no toca la fila (alguien cambió el estado o el rol entre la lectura y la escritura) no inventa un éxito ni deja nada a medias", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        const casosDeFalla: {
          nombre: string;
          tx: (tx: TxDePrueba) => TxDePrueba;
          error: string;
        }[] = [
          {
            nombre: "el traspaso",
            tx: (tx) => ({
              ...tx,
              traspasos: { ...tx.traspasos, aceptar: () => Promise.resolve(false) },
            }),
            error: "TRASPASO_RESUELTO",
          },
          {
            nombre: "el rol del saliente",
            tx: (tx) => ({
              ...tx,
              membresias: { ...tx.membresias, cambiarRol: () => Promise.resolve(false) },
            }),
            error: "SALIENTE_YA_NO_ES_GERENTE",
          },
          {
            nombre: "el rol del entrante",
            tx: (tx) => {
              let llamadas = 0;
              return {
                ...tx,
                membresias: {
                  ...tx.membresias,
                  cambiarRol: (...args) => {
                    llamadas += 1;
                    return llamadas === 1
                      ? tx.membresias.cambiarRol(...args)
                      : Promise.resolve(false);
                  },
                },
              };
            },
            error: "ENTRANTE_INACTIVO",
          },
        ];
        for (const caso of casosDeFalla) {
          const raro = crearEntornoDePrueba(propia.base, 2, caso.tx);
          try {
            const antes = await foto([e.empresa]);
            expect(
              await crearCasos(raro).aceptarTraspaso(entrante.ctx, { traspasoId: id }),
              caso.nombre,
            ).toEqual({ ok: false, error: caso.error });
            expect(await foto([e.empresa]), caso.nombre).toBe(antes);
          } finally {
            await raro.cerrar();
          }
        }
      });
    });

    // =============================================================================================
    describe("rechazarTraspaso", () => {
      it("el entrante rechaza: queda RECHAZADO con su auditoría y su aviso, y no cambia ningún rol", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        const trabajosAntes = await trabajos(e.empresa);

        expect(await casos.rechazarTraspaso(entrante.ctx, { traspasoId: id })).toEqual({
          ok: true,
          valor: { yaEstabaRechazado: false },
        });

        expect(await traspaso(id)).toMatchObject({
          estado: "RECHAZADO",
          resuelto_en: ahora,
          motivo: null,
        });
        expect(await auditoria(e.empresa)).toEqual([
          {
            accion: "TRASPASO_RECHAZADO",
            actor_persona_id: entrante.id,
            entidad: "traspaso_gerencia",
            entidad_id: id,
            antes: { estado: "PROPUESTO", entrante: entrante.id },
            despues: { estado: "RECHAZADO" },
          },
        ]);
        expect(await trabajos(e.empresa)).toEqual([
          ...trabajosAntes,
          {
            tipo: "avisar_traspaso_rechazado",
            datos: { traspasoId: id },
            clave_idempotencia: `traspaso:${id}:rechazado`,
          },
        ]);
        expect(await apoyo.gerentesActivos(e.empresa)).toEqual([e.gerente]);
        expect(await membresia(e.empresa, entrante.id)).toMatchObject({ rol: "OPERADOR" });
      });

      it("idempotente: rechazar dos veces es ok y la segunda no escribe, no audita ni avisa", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        await casos.rechazarTraspaso(entrante.ctx, { traspasoId: id });
        const antes = await foto([e.empresa]);

        expect(await casos.rechazarTraspaso(entrante.ctx, { traspasoId: id })).toEqual({
          ok: true,
          valor: { yaEstabaRechazado: true },
        });

        expect(await foto([e.empresa])).toBe(antes);
        expect(await auditoria(e.empresa, "TRASPASO_RECHAZADO")).toHaveLength(1);
      });

      it("solo rechaza el entrante: otro miembro, o el gerente que propuso, dan TRASPASO_NO_ES_PARA_VOS", async () => {
        const e = await escenario();
        const { id } = await conTraspaso(e);
        const otro = await miembro(e, "ADMINISTRADOR");
        const antes = await foto([e.empresa]);
        for (const ctx of [e.ctx, otro.ctx]) {
          expect(await casos.rechazarTraspaso(ctx, { traspasoId: id })).toEqual({
            ok: false,
            error: "TRASPASO_NO_ES_PARA_VOS",
          });
        }
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("inexistente, mal escrito o de otra empresa: TRASPASO_NO_ENCONTRADO", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        const { id: idDeOtra } = await conTraspaso(otra);
        const op = await miembro(e, "OPERADOR");
        for (const traspasoId of [apoyo.uuidAlAzar(), "no-es-un-id", idDeOtra]) {
          expect(await casos.rechazarTraspaso(op.ctx, { traspasoId })).toEqual({
            ok: false,
            error: "TRASPASO_NO_ENCONTRADO",
          });
        }
      });

      it("uno aceptado o cancelado da TRASPASO_RESUELTO, y uno vencido TRASPASO_VENCIDO", async () => {
        const e = await escenario();
        const aceptado = await conTraspaso(e);
        await casos.aceptarTraspaso(aceptado.entrante.ctx, { traspasoId: aceptado.id });
        // Ahora el gerente es otro: arma un traspaso nuevo desde la nueva gerencia.
        const nuevoCtx = aceptado.entrante.ctx;
        const segundo = await miembro(e, "OPERADOR");
        const cancelado = await casos.proponerTraspaso(nuevoCtx, { entrantePersonaId: segundo.id });
        if (!cancelado.ok) throw new Error("no se pudo proponer");
        await casos.cancelarTraspaso(nuevoCtx, {});
        const antes = await foto([e.empresa]);

        expect(
          await casos.rechazarTraspaso(aceptado.entrante.ctx, { traspasoId: aceptado.id }),
        ).toEqual({ ok: false, error: "TRASPASO_RESUELTO" });
        expect(
          await casos.rechazarTraspaso(segundo.ctx, { traspasoId: cancelado.valor.traspasoId }),
        ).toEqual({ ok: false, error: "TRASPASO_RESUELTO" });
        expect(await foto([e.empresa])).toBe(antes);

        const f = await escenario();
        const opF = await miembro(f, "OPERADOR");
        const vencido = await apoyo.proponerDeBase(f, opF.id, {
          propuestoEn: en(-7),
          venceEn: ahora,
        });
        expect(await casos.rechazarTraspaso(opF.ctx, { traspasoId: vencido })).toEqual({
          ok: false,
          error: "TRASPASO_VENCIDO",
        });
      });

      for (const actor of sinAcceso) {
        it(`${actor.nombre} no rechaza: SIN_PERMISO y nada escrito`, async () => {
          const e = await escenario();
          const { id } = await conTraspaso(e);
          const ctx = await actor.armar(e);
          const antes = await foto([e.empresa]);
          expect(await casos.rechazarTraspaso(ctx, { traspasoId: id })).toEqual(SIN_PERMISO);
          expect(await foto([e.empresa])).toBe(antes);
        });
      }

      it("una empresa suspendida no rechaza: EMPRESA_NO_OPERA y nada escrito", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        await apoyo.suspenderEmpresa(e.empresa);
        const antes = await foto([e.empresa]);
        expect(await casos.rechazarTraspaso(entrante.ctx, { traspasoId: id })).toEqual({
          ok: false,
          error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: "EMPRESA_SUSPENDIDA" },
        });
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("una empresa todavía en alta (PROVISIONING) no opera: ni propone ni acepta ni rechaza ni cancela", async () => {
        const enAlta = await crearEmpresaEnAlta(entorno);
        const g = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, enAlta.empresa, g.id, "GERENTE");
        const ctx = comoEmpresa(enAlta.empresa, personaId(g.id));
        const esperado = {
          ok: false,
          error: {
            codigo: "EMPRESA_NO_OPERA",
            empresaId: enAlta.empresa,
            motivo: "EMPRESA_EN_ALTA",
          },
        };
        expect(await casos.proponerTraspaso(ctx, { entrantePersonaId: personaId(g.id) })).toEqual(
          esperado,
        );
        expect(await casos.cancelarTraspaso(ctx, {})).toEqual(esperado);
        expect(await casos.aceptarTraspaso(ctx, { traspasoId: apoyo.uuidAlAzar() })).toEqual(
          esperado,
        );
        expect(await casos.rechazarTraspaso(ctx, { traspasoId: apoyo.uuidAlAzar() })).toEqual(
          esperado,
        );
      });

      it("atomicidad: si falla la auditoría el traspaso sigue propuesto y no se avisa", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          auditoria: {
            registrar: () => Promise.reject(new Error("falla forzada de la auditoría")),
          },
        }));
        try {
          const antes = await foto([e.empresa]);
          await expect(
            crearCasos(falla).rechazarTraspaso(entrante.ctx, { traspasoId: id }),
          ).rejects.toThrow("falla forzada de la auditoría");
          expect(await foto([e.empresa])).toBe(antes);
          expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO" });
        } finally {
          await falla.cerrar();
        }
      });

      it("si la actualización no toca la fila no inventa un éxito ni avisa", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        const sinEfecto = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          traspasos: { ...tx.traspasos, rechazar: () => Promise.resolve(false) },
        }));
        try {
          const antes = await foto([e.empresa]);
          expect(
            await crearCasos(sinEfecto).rechazarTraspaso(entrante.ctx, { traspasoId: id }),
          ).toEqual({ ok: false, error: "TRASPASO_RESUELTO" });
          expect(await foto([e.empresa])).toBe(antes);
        } finally {
          await sinEfecto.cerrar();
        }
      });
    });

    // =============================================================================================
    describe("apagarMembresia con un traspaso en curso", () => {
      it("apagar al entrante cancela su traspaso (motivo ENTRANTE_DADO_DE_BAJA) en la misma transacción, con su auditoría antes de la baja", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);

        const r = await casos.apagarMembresia(e.ctx, { personaId: entrante.id });

        // El resultado del caso de uso no cambia de forma.
        expect(r).toEqual({
          ok: true,
          valor: { yaEstabaApagada: false, invitacionesRevocadas: 0 },
        });
        expect(await traspaso(id)).toMatchObject({
          estado: "CANCELADO",
          motivo: "ENTRANTE_DADO_DE_BAJA",
          resuelto_en: ahora,
        });
        expect(await membresia(e.empresa, entrante.id)).toMatchObject({ activo: false });
        expect(await auditoria(e.empresa)).toEqual([
          {
            accion: "TRASPASO_CANCELADO",
            actor_persona_id: e.gerente,
            entidad: "traspaso_gerencia",
            entidad_id: id,
            antes: { estado: "PROPUESTO", entrante: entrante.id },
            despues: { estado: "CANCELADO", motivo: "ENTRANTE_DADO_DE_BAJA" },
          },
          {
            accion: "MEMBRESIA_APAGADA",
            actor_persona_id: e.gerente,
            entidad: "membresia",
            entidad_id: entrante.id,
            antes: { activo: true, rol: "OPERADOR" },
            despues: { activo: false, asignacionesApagadas: 0, invitacionesRevocadas: [] },
          },
        ]);
        // Con la plaza libre se puede proponer a otro.
        const otro = await miembro(e, "ADMINISTRADOR");
        expect(await casos.proponerTraspaso(e.ctx, { entrantePersonaId: otro.id })).toMatchObject({
          ok: true,
        });
      });

      it("un administrador también puede apagar al entrante, y el traspaso se cancela igual", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        const { entrante, id } = await conTraspaso(e);
        expect(await casos.apagarMembresia(admin.ctx, { personaId: entrante.id })).toMatchObject({
          ok: true,
        });
        expect(await traspaso(id)).toMatchObject({
          estado: "CANCELADO",
          motivo: "ENTRANTE_DADO_DE_BAJA",
        });
        expect((await auditoria(e.empresa, "TRASPASO_CANCELADO"))[0]).toMatchObject({
          actor_persona_id: admin.id,
        });
      });

      it("también se cancela una propuesta vencida que sigue guardada", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        const id = await apoyo.proponerDeBase(e, op.id, { propuestoEn: en(-8), venceEn: en(-1) });
        await casos.apagarMembresia(e.ctx, { personaId: op.id });
        expect(await traspaso(id)).toMatchObject({
          estado: "CANCELADO",
          motivo: "ENTRANTE_DADO_DE_BAJA",
        });
      });

      it("apagar a otro miembro no toca el traspaso", async () => {
        const e = await escenario();
        const { id } = await conTraspaso(e);
        const otro = await miembro(e, "OPERADOR");
        expect(await casos.apagarMembresia(e.ctx, { personaId: otro.id })).toMatchObject({
          ok: true,
        });
        expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO", resuelto_en: null });
        expect(await auditoria(e.empresa, "TRASPASO_CANCELADO")).toEqual([]);
      });

      it("al saliente (el gerente) no se lo apaga, con o sin traspaso: ES_EL_GERENTE y el traspaso sigue", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        const { id } = await conTraspaso(e);
        const antes = await foto([e.empresa]);
        expect(await casos.apagarMembresia(admin.ctx, { personaId: e.gerente })).toEqual({
          ok: false,
          error: "ES_EL_GERENTE",
        });
        expect(await foto([e.empresa])).toBe(antes);
        expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO" });
      });

      it("apagar a alguien que ya estaba apagado sigue siendo ok sin escribir, aunque haya un traspaso en curso a otro", async () => {
        const e = await escenario();
        const apagado = await miembro(e, "OPERADOR", false);
        await conTraspaso(e);
        const antes = await foto([e.empresa]);
        expect(await casos.apagarMembresia(e.ctx, { personaId: apagado.id })).toEqual({
          ok: true,
          valor: { yaEstabaApagada: true, invitacionesRevocadas: 0 },
        });
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("atomicidad: si falla la auditoría de la baja, el traspaso sigue en curso y el miembro activo", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        const falla = crearEntornoDePrueba(propia.base, 2, (tx) => {
          let llamadas = 0;
          return {
            ...tx,
            auditoria: {
              registrar: (registro) => {
                llamadas += 1;
                if (llamadas === 2) return Promise.reject(new Error("falla forzada de la baja"));
                return tx.auditoria.registrar(registro);
              },
            },
          };
        });
        try {
          const antes = await foto([e.empresa]);
          await expect(
            crearCasos(falla).apagarMembresia(e.ctx, { personaId: entrante.id }),
          ).rejects.toThrow("falla forzada de la baja");
          expect(await foto([e.empresa])).toBe(antes);
          expect(await traspaso(id)).toMatchObject({ estado: "PROPUESTO" });
          expect(await membresia(e.empresa, entrante.id)).toMatchObject({ activo: true });
        } finally {
          await falla.cerrar();
        }
      });

      it("si la cancelación no toca la fila no se apaga a nadie ni se audita", async () => {
        const e = await escenario();
        const { entrante } = await conTraspaso(e);
        const sinEfecto = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          traspasos: { ...tx.traspasos, cancelar: () => Promise.resolve(false) },
        }));
        try {
          const antes = await foto([e.empresa]);
          expect(
            await crearCasos(sinEfecto).apagarMembresia(e.ctx, { personaId: entrante.id }),
          ).toEqual({ ok: false, error: "MEMBRESIA_NO_ENCONTRADA" });
          expect(await foto([e.empresa])).toBe(antes);
        } finally {
          await sinEfecto.cerrar();
        }
      });
    });

    // =============================================================================================
    describe("traspasoEnCurso (consulta)", () => {
      it("el gerente y el entrante lo ven, con el contrato exacto; los demás reciben null", async () => {
        const e = await escenario();
        const { entrante, id } = await conTraspaso(e);
        const admin = await miembro(e, "ADMINISTRADOR");
        const operador = await miembro(e, "OPERADOR");
        const base = {
          id,
          origen: "GERENTE",
          entrante: { personaId: entrante.id, email: entrante.email },
          saliente: { personaId: e.gerente, email: e.gerenteEmail },
          propuestoEn: "2026-10-11T12:00:00.000Z",
          venceEn: "2026-10-18T12:00:00.000Z",
          vencido: false,
        };

        expect(await consultas.traspasoEnCurso(e.ctx)).toEqual({
          ok: true,
          valor: { ...base, soyEntrante: false },
        });
        expect(await consultas.traspasoEnCurso(entrante.ctx)).toEqual({
          ok: true,
          valor: { ...base, soyEntrante: true },
        });
        expect(await consultas.traspasoEnCurso(admin.ctx)).toEqual({ ok: true, valor: null });
        expect(await consultas.traspasoEnCurso(operador.ctx)).toEqual({ ok: true, valor: null });
      });

      it("un administrador que ES el entrante lo ve", async () => {
        const e = await escenario();
        const { entrante } = await conTraspaso(e, "ADMINISTRADOR");
        expect(await consultas.traspasoEnCurso(entrante.ctx)).toMatchObject({
          ok: true,
          valor: { soyEntrante: true },
        });
      });

      it("sin traspaso en curso devuelve null; uno resuelto (aceptado, rechazado, cancelado) ya no cuenta", async () => {
        const e = await escenario();
        expect(await consultas.traspasoEnCurso(e.ctx)).toEqual({ ok: true, valor: null });

        const a = await conTraspaso(e);
        await casos.cancelarTraspaso(e.ctx, {});
        expect(await consultas.traspasoEnCurso(e.ctx)).toEqual({ ok: true, valor: null });
        expect(await consultas.traspasoEnCurso(a.entrante.ctx)).toEqual({ ok: true, valor: null });

        const b = await conTraspaso(e);
        await casos.rechazarTraspaso(b.entrante.ctx, { traspasoId: b.id });
        expect(await consultas.traspasoEnCurso(e.ctx)).toEqual({ ok: true, valor: null });

        const c = await conTraspaso(e);
        await casos.aceptarTraspaso(c.entrante.ctx, { traspasoId: c.id });
        expect(await consultas.traspasoEnCurso(c.entrante.ctx)).toEqual({ ok: true, valor: null });
        expect(await consultas.traspasoEnCurso(e.ctx)).toEqual({ ok: true, valor: null });
      });

      it("vencido: `ahora` igual al vencimiento ya es vencido, un milisegundo antes no, y coincide con el dominio", async () => {
        for (const [venceEn, esperado] of [
          [ahora, true],
          [new Date(ahora.getTime() + 1), false],
          [new Date(ahora.getTime() - 1), true],
        ] as const) {
          const e = await escenario();
          const op = await miembro(e, "OPERADOR");
          const id = await apoyo.proponerDeBase(e, op.id, { propuestoEn: en(-8), venceEn });
          const r = await consultas.traspasoEnCurso(e.ctx);
          expect(r, venceEn.toISOString()).toMatchObject({
            ok: true,
            valor: { id, vencido: esperado, venceEn: venceEn.toISOString() },
          });
          // La misma regla que el dominio, en el mismo instante.
          const guardado = await apoyo.traspaso(id);
          expect(
            estadoDeTraspaso(
              {
                id,
                empresaId: e.empresaId,
                origen: "GERENTE",
                salientePersonaId: e.gerente,
                entrantePersonaId: op.id,
                estado: "PROPUESTO",
                venceEn: guardado?.["vence_en"] as Date,
                version: 1,
              },
              ahora,
            ) === "VENCIDO",
          ).toBe(esperado);
        }
      });

      it("un traspaso de la plataforma no trae saliente (se anota al aceptar), y el gerente vigente lo ve", async () => {
        const e = await escenario();
        const entrante = await miembro(e, "ADMINISTRADOR");
        const id = await apoyo.proponerDePlataformaDeBase(e, entrante.id);
        expect(await consultas.traspasoEnCurso(e.ctx)).toMatchObject({
          ok: true,
          valor: { id, origen: "PLATAFORMA", saliente: null, soyEntrante: false },
        });
      });

      for (const actor of sinAcceso) {
        it(`${actor.nombre} no lo ve: SIN_PERMISO`, async () => {
          const e = await escenario();
          await conTraspaso(e);
          expect(await consultas.traspasoEnCurso(await actor.armar(e))).toEqual(SIN_PERMISO);
        });
      }

      it("no mezcla empresas: cada una ve solo el suyo", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const { id: idA } = await conTraspaso(a);
        expect(await consultas.traspasoEnCurso(b.ctx)).toEqual({ ok: true, valor: null });
        const { id: idB } = await conTraspaso(b);
        expect(await consultas.traspasoEnCurso(a.ctx)).toMatchObject({
          ok: true,
          valor: { id: idA },
        });
        expect(await consultas.traspasoEnCurso(b.ctx)).toMatchObject({
          ok: true,
          valor: { id: idB },
        });
      });

      it("corre en read committed y solo lectura, y no escribe nada", async () => {
        const e = await escenario();
        await conTraspaso(e);
        const antes = await foto([e.empresa]);
        opcionesVistas.length = 0;
        await consultas.traspasoEnCurso(e.ctx);
        expect(opcionesVistas).toHaveLength(1);
        expect(opcionesVistas[0]).toMatchObject({
          aislamiento: "read committed",
          soloLectura: true,
        });
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("una empresa suspendida (o con el tenant suspendido) sigue viendo su traspaso: la lectura no exige que opere", async () => {
        const e = await escenario();
        const { id } = await conTraspaso(e);
        await apoyo.suspenderEmpresa(e.empresa);
        expect(await consultas.traspasoEnCurso(e.ctx)).toMatchObject({ ok: true, valor: { id } });
        const f = await escenario();
        const { id: idF } = await conTraspaso(f);
        await apoyo.suspenderTenant(f.tenant);
        expect(await consultas.traspasoEnCurso(f.ctx)).toMatchObject({
          ok: true,
          valor: { id: idF },
        });
      });

      it("la baja del gerente surte efecto en la operación siguiente (nada se guarda en sesión)", async () => {
        const e = await escenario();
        const { entrante } = await conTraspaso(e);
        expect((await consultas.traspasoEnCurso(entrante.ctx)).ok).toBe(true);
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa, entrante.id],
        );
        expect(await consultas.traspasoEnCurso(entrante.ctx)).toEqual(SIN_PERMISO);
      });
    });
  },
);
