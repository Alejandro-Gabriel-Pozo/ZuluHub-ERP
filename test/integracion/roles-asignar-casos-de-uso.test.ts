import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  type CasosDeUsoDeIdentidad,
  type ConsultasDeIdentidad,
} from "../../src/modulos/identidad/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { crearBaseAparte, crearEntornoDePrueba, type TxDePrueba } from "./entorno";
import { crearApoyoDeTraspaso, type Escenario } from "./traspaso-apoyo";

/**
 * H4b T4b-2: `asignarRol` y `rolesAsignables` contra una base real, con el contexto firmado (nunca el dueño de la base, salvo para armar el escenario y mirar). Cubre autorización,
 * aislamiento entre empresas, idempotencia, que el gerente nunca se toca ni pierde permisos, el efecto en la operación siguiente y dos actores a la vez.
 */

const base = inject("baseDePruebas");
const LIMITE_EN_MS = 60_000;
const PISOS_DE_TODOS = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
];

describe.skipIf(base === null)(
  "asignar un rol a una persona contra una base real",
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

    const SIN_PERMISO = { ok: false, error: "SIN_PERMISO" };

    const crearRol = async (e: Escenario, nombre: string, acciones?: string[]) => {
      const r = await casos.crearRol(e.ctx, {
        rolId: randomUUID(),
        nombre,
        origen: { tipo: "VACIO" },
      });
      if (!r.ok) throw new Error(`no se pudo crear el rol: ${JSON.stringify(r.error)}`);
      if (acciones !== undefined) {
        const ed = await casos.editarRol(e.ctx, { rolId: r.valor.rolId, acciones });
        if (!ed.ok) throw new Error(`no se pudo editar el rol: ${JSON.stringify(ed.error)}`);
      }
      return r.valor.rolId;
    };
    const estado = async (e: Escenario, persona: string) =>
      (
        await apoyo.filas<{ rol: string; rol_propio_id: string | null; activo: boolean }>(
          "select rol, rol_propio_id, activo from membresia where empresa_id = $1 and persona_id = $2",
          [e.empresa, persona],
        )
      )[0];
    const auditoria = (e: Escenario) =>
      apoyo.filas<{ antes: unknown; despues: unknown; actor_persona_id: string }>(
        "select antes, despues, actor_persona_id from auditoria_empresa where empresa_id = $1 and accion = 'ROL_ASIGNADO' order by id",
        [e.empresa],
      );

    describe("asignarRol", () => {
      it("a un rol propio y de vuelta a uno base: cambia el rol y el puntero, la persona sigue activa y se audita el antes y el después", async () => {
        const e = await apoyo.escenario();
        const op = await apoyo.miembro(e, "OPERADOR");
        const rol = await crearRol(e, "Cajero");

        const ida = await casos.asignarRol(e.ctx, {
          personaId: op.id,
          destino: { tipo: "PROPIO", rolId: rol },
        });
        const alPropio = await estado(e, op.id);
        const vuelta = await casos.asignarRol(e.ctx, {
          personaId: op.id,
          destino: { tipo: "BASE", rol: "ADMINISTRADOR" },
        });

        expect([ida, vuelta]).toEqual([
          { ok: true, valor: { cambio: true } },
          { ok: true, valor: { cambio: true } },
        ]);
        expect(alPropio).toEqual({ rol: "PROPIO", rol_propio_id: rol, activo: true });
        expect(await estado(e, op.id)).toEqual({
          rol: "ADMINISTRADOR",
          rol_propio_id: null,
          activo: true,
        });
        expect(await auditoria(e)).toEqual([
          {
            actor_persona_id: e.gerente,
            antes: { rol: "OPERADOR", rolPropioId: null },
            despues: { rol: "PROPIO", rolPropioId: rol },
          },
          {
            actor_persona_id: e.gerente,
            antes: { rol: "PROPIO", rolPropioId: rol },
            despues: { rol: "ADMINISTRADOR", rolPropioId: null },
          },
        ]);
      });

      it("asignarRol: asignar el mismo rol dos veces no escribe ni audita de nuevo", async () => {
        const e = await apoyo.escenario();
        const op = await apoyo.miembro(e, "OPERADOR");
        const pedido = {
          personaId: op.id,
          destino: { tipo: "PROPIO", rolId: await crearRol(e, "Mozo") },
        } as const;

        const primera = await casos.asignarRol(e.ctx, pedido);
        const antes = await apoyo.foto([e.empresa]);
        const segunda = await casos.asignarRol(e.ctx, pedido);

        expect([primera, segunda]).toEqual([
          { ok: true, valor: { cambio: true } },
          { ok: true, valor: { cambio: false } },
        ]);
        expect(await apoyo.foto([e.empresa])).toBe(antes);
      });

      it("rechazos sin escribir: el gerente no se toca (y sigue pudiendo todo), rol archivado o de otra empresa, persona de otra empresa", async () => {
        const e = await apoyo.escenario();
        const ajena = await apoyo.escenario();
        const op = await apoyo.miembro(e, "OPERADOR");
        const deAjena = await apoyo.miembro(ajena, "OPERADOR");
        const archivado = await crearRol(e, "Archivado");
        expect(await casos.archivarRol(e.ctx, { rolId: archivado })).toMatchObject({ ok: true });
        const rolAjeno = await crearRol(ajena, "Ajeno");
        const antes = await apoyo.foto([e.empresa, ajena.empresa]);
        const asignar = (
          personaId: string,
          destino: Parameters<typeof casos.asignarRol>[1]["destino"],
        ) => casos.asignarRol(e.ctx, { personaId: personaId as never, destino });

        expect([
          await asignar(e.gerente, { tipo: "BASE", rol: "OPERADOR" }),
          await asignar(op.id, { tipo: "PROPIO", rolId: archivado }),
          await asignar(op.id, { tipo: "PROPIO", rolId: rolAjeno }),
          await asignar(deAjena.id, { tipo: "BASE", rol: "ADMINISTRADOR" }),
        ]).toEqual([
          { ok: false, error: "ES_EL_GERENTE" },
          { ok: false, error: "ROL_ARCHIVADO" },
          { ok: false, error: "ROL_NO_ENCONTRADO" },
          { ok: false, error: "MEMBRESIA_NO_ENCONTRADA" },
        ]);
        expect(await apoyo.foto([e.empresa, ajena.empresa])).toBe(antes);
        expect(await consultas.listarRoles(e.ctx)).toMatchObject({ ok: true });
      });

      it("una persona apagada se reasigna y sigue apagada (reactivar es solo por invitación)", async () => {
        const e = await apoyo.escenario();
        const apagada = await apoyo.miembro(e, "OPERADOR", false);

        const r = await casos.asignarRol(e.ctx, {
          personaId: apagada.id,
          destino: { tipo: "BASE", rol: "ADMINISTRADOR" },
        });

        expect(r).toEqual({ ok: true, valor: { cambio: true } });
        expect(await estado(e, apagada.id)).toEqual({
          rol: "ADMINISTRADOR",
          rol_propio_id: null,
          activo: false,
        });
      });

      it("solo el gerente: el administrador y el operador son SIN_PERMISO (asignar y ver lo asignable) y no escriben nada", async () => {
        const e = await apoyo.escenario();
        const administrador = await apoyo.miembro(e, "ADMINISTRADOR");
        const operador = await apoyo.miembro(e, "OPERADOR");
        const antes = await apoyo.foto([e.empresa]);

        for (const { ctx } of [administrador, operador]) {
          const destino = { tipo: "BASE", rol: "ADMINISTRADOR" } as const;
          expect(await casos.asignarRol(ctx, { personaId: operador.id, destino })).toEqual(
            SIN_PERMISO,
          );
          expect(await consultas.rolesAsignables(ctx)).toEqual(SIN_PERMISO);
        }
        expect(await apoyo.foto([e.empresa])).toBe(antes);
      });

      it("el rol propio rige desde la operación siguiente y nunca da lo reservado al gerente (ni se puede guardar)", async () => {
        const e = await apoyo.escenario();
        const persona = await apoyo.miembro(e, "OPERADOR");
        const rol = await crearRol(e, "Supervisor", [...PISOS_DE_TODOS, "usuarios.ver"]);
        const reservadas = await casos.editarRol(e.ctx, {
          rolId: rol,
          acciones: [...PISOS_DE_TODOS, "roles.crear", "usuarios.asignar_rol"],
        });
        const sinRol = await consultas.listarMiembros(persona.ctx);
        await casos.asignarRol(e.ctx, {
          personaId: persona.id,
          destino: { tipo: "PROPIO", rolId: rol },
        });

        const conAcceso = await consultas.listarMiembros(persona.ctx);
        const sobreLoReservado = await casos.asignarRol(persona.ctx, {
          personaId: persona.id,
          destino: { tipo: "BASE", rol: "ADMINISTRADOR" },
        });
        await casos.editarRol(e.ctx, { rolId: rol, acciones: PISOS_DE_TODOS });
        const sinAcceso = await consultas.listarMiembros(persona.ctx);

        expect(reservadas).toMatchObject({
          ok: false,
          error: { codigo: "CONJUNTO_DE_ACCIONES_INVALIDO" },
        });
        expect([sinRol, sobreLoReservado, sinAcceso]).toEqual([
          SIN_PERMISO,
          SIN_PERMISO,
          SIN_PERMISO,
        ]);
        expect(conAcceso).toMatchObject({ ok: true });
      });

      it("concurrencia: asignar un rol y archivarlo a la vez nunca deja a una persona activa con un rol archivado", async () => {
        const e = await apoyo.escenario();
        const persona = await apoyo.miembro(e, "OPERADOR");
        const rol = await crearRol(e, "Disputado");

        const [asignada, archivada] = await Promise.all([
          casos.asignarRol(e.ctx, {
            personaId: persona.id,
            destino: { tipo: "PROPIO", rolId: rol },
          }),
          casos.archivarRol(e.ctx, { rolId: rol }),
        ]);

        const huerfanas = await apoyo.contar(
          `select count(*) as n from membresia m join rol_de_empresa r on r.id = m.rol_propio_id and r.empresa_id = m.empresa_id
            where m.empresa_id = $1 and m.activo and not r.activo`,
          [e.empresa],
        );
        expect(huerfanas).toBe(0);
        // Gana la asignación (el archivado se rechaza por tener personas) o gana el archivado (la asignación se rechaza por archivado).
        expect(asignada.ok ? archivada : asignada).toEqual({
          ok: false,
          error: asignada.ok ? "ROL_CON_PERSONAS" : "ROL_ARCHIVADO",
        });
      });

      it("concurrencia: asignar un rol y apagar a la persona a la vez termina con las dos cosas aplicadas", async () => {
        const e = await apoyo.escenario();
        const persona = await apoyo.miembro(e, "OPERADOR");
        const rol = await crearRol(e, "Mientras tanto");

        const resultados = await Promise.all([
          casos.asignarRol(e.ctx, {
            personaId: persona.id,
            destino: { tipo: "PROPIO", rolId: rol },
          }),
          casos.apagarMembresia(e.ctx, { personaId: persona.id }),
        ]);

        expect(resultados.every((r) => r.ok)).toBe(true);
        expect(await estado(e, persona.id)).toEqual({
          rol: "PROPIO",
          rol_propio_id: rol,
          activo: false,
        });
      });
    });

    it("rolesAsignables: el gerente ve los dos roles base y los propios activos, no los archivados", async () => {
      const e = await apoyo.escenario();
      const activo = await crearRol(e, "Activo");
      const archivado = await crearRol(e, "Archivado");
      expect(await casos.archivarRol(e.ctx, { rolId: archivado })).toMatchObject({ ok: true });

      expect(await consultas.rolesAsignables(e.ctx)).toEqual({
        ok: true,
        valor: {
          base: ["ADMINISTRADOR", "OPERADOR"],
          propios: [{ rolId: activo, nombre: "Activo" }],
        },
      });
    });
  },
);
