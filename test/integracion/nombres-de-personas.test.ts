import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearConsultasDeIdentidad,
  MAXIMO_DE_PERSONAS_POR_CONSULTA,
  type ConsultasDeIdentidad,
} from "../../src/modulos/identidad/publico";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";

/**
 * C6/X6 del mostrador mínimo: `nombresDePersonas` contra una base real, con el contexto firmado (nunca el dueño de la base, salvo para
 * armar el escenario y para mirar). Cubre aislamiento entre empresas (un id de otra empresa no aparece), autorización en el servidor
 * (sin persona o sin membresía no hay nombres; los tres roles pueden), entrada validada, lectura pura (idempotente, no escribe) y
 * lecturas simultáneas.
 */

const base = inject("baseDePruebas");
const LIMITE_EN_MS = 60_000;

describe.skipIf(base === null)(
  "nombresDePersonas contra una base real",
  { timeout: LIMITE_EN_MS },
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let consultas: ConsultasDeIdentidad;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 10);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      consultas = crearConsultasDeIdentidad({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
    }, LIMITE_EN_MS);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    }, LIMITE_EN_MS);

    type Miembro = Readonly<{ id: PersonaId; email: string; empresa: EmpresaId }>;

    const empresaConGente = async () => {
      const e = await crearEmpresaActiva(entorno);
      const alta = async (rol: RolDePrueba, activo = true): Promise<Miembro> => {
        const p = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa, p.id, rol, activo);
        return { id: personaId(p.id), email: p.email, empresa: e.empresa };
      };
      return {
        e,
        gerente: await alta("GERENTE"),
        administrador: await alta("ADMINISTRADOR"),
        operador: await alta("OPERADOR"),
        apagada: await alta("OPERADOR", false),
      };
    };

    const cuentas = async () => {
      const filas = await dueno.query<{ personas: string; membresias: string; auditoria: string }>(
        `select (select count(*) from persona)::text as personas,
                (select count(*) from membresia)::text as membresias,
                (select count(*) from auditoria_empresa)::text as auditoria`,
      );
      return filas.rows[0];
    };

    it("los tres roles obtienen el nombre de las personas de su empresa (activas y apagadas), solo las pedidas", async () => {
      const x = await empresaConGente();
      const esperado = new Map<PersonaId, string>([
        [x.gerente.id, x.gerente.email],
        [x.operador.id, x.operador.email],
        [x.apagada.id, x.apagada.email],
      ]);
      for (const quien of [x.gerente, x.administrador, x.operador]) {
        const r = await consultas.nombresDePersonas(comoEmpresa(x.e.empresa, quien.id), {
          ids: [x.gerente.id, x.operador.id, x.apagada.id],
        });
        expect(r).toEqual({ ok: true, valor: esperado });
      }
    });

    it("aislamiento: un id de otra empresa, o inexistente, no aparece; y no se puede distinguir cuál era cuál", async () => {
      const a = await empresaConGente();
      const b = await empresaConGente();
      const inexistente = "00000000-0000-4000-8000-00000000abcd";
      const r = await consultas.nombresDePersonas(comoEmpresa(a.e.empresa, a.operador.id), {
        ids: [a.gerente.id, b.gerente.id, b.operador.id, inexistente],
      });
      expect(r).toEqual({ ok: true, valor: new Map([[a.gerente.id, a.gerente.email]]) });
      // Del otro lado, lo mismo: la empresa B tampoco ve a la gente de A.
      const rb = await consultas.nombresDePersonas(comoEmpresa(b.e.empresa, b.operador.id), {
        ids: [a.gerente.id, b.gerente.id],
      });
      expect(rb).toEqual({ ok: true, valor: new Map([[b.gerente.id, b.gerente.email]]) });
    });

    it("una persona con membresía en dos empresas se nombra en ambas, pero cada empresa solo ve las suyas", async () => {
      const a = await empresaConGente();
      const b = await empresaConGente();
      const compartida = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, a.e.empresa, compartida.id, "OPERADOR");
      await crearMembresiaDeBase(dueno, b.e.empresa, compartida.id, "OPERADOR");
      const id = personaId(compartida.id);
      for (const [x, solo] of [
        [a, a.gerente],
        [b, b.gerente],
      ] as const) {
        const r = await consultas.nombresDePersonas(comoEmpresa(x.e.empresa, x.operador.id), {
          ids: [id, solo.id],
        });
        expect(r).toEqual({
          ok: true,
          valor: new Map([
            [id, compartida.email],
            [solo.id, solo.email],
          ]),
        });
      }
    });

    it("autorización: sin persona en el contexto, o con una persona que no es de la empresa, no hay nombres", async () => {
      const a = await empresaConGente();
      const b = await empresaConGente();
      const sinPersona = await consultas.nombresDePersonas(comoEmpresa(a.e.empresa, null), {
        ids: [a.gerente.id],
      });
      expect(sinPersona).toEqual({ ok: false, error: "SIN_PERMISO" });
      const deOtraEmpresa = await consultas.nombresDePersonas(
        comoEmpresa(a.e.empresa, b.gerente.id),
        {
          ids: [a.gerente.id],
        },
      );
      expect(deOtraEmpresa).toEqual({ ok: false, error: "SIN_PERMISO" });
      // Una membresía apagada no autoriza.
      const apagada = await consultas.nombresDePersonas(comoEmpresa(a.e.empresa, a.apagada.id), {
        ids: [a.gerente.id],
      });
      expect(apagada.ok).toBe(false);
    });

    it("entrada: solo se permite una lista de hasta 200 uuid; todo lo demás se rechaza entero, sin consultar nada", async () => {
      const x = await empresaConGente();
      const ctx = comoEmpresa(x.e.empresa, x.operador.id);
      const invalidas: unknown[] = [
        ["no-es-un-uuid"],
        [x.gerente.id.toUpperCase()],
        [x.gerente.id, "' or 1=1 --"],
        [""],
        [42],
        [null],
        "no es una lista",
        undefined,
        Array.from(
          { length: MAXIMO_DE_PERSONAS_POR_CONSULTA + 1 },
          (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        ),
      ];
      for (const ids of invalidas) {
        expect(
          await consultas.nombresDePersonas(ctx, { ids: ids as readonly string[] }),
          JSON.stringify(ids)?.slice(0, 60),
        ).toEqual({ ok: false, error: "ENTRADA_INVALIDA" });
      }
    });

    it("entrada: lista vacía da un mapa vacío; los repetidos salen una sola vez; el tope exacto (200) pasa", async () => {
      const x = await empresaConGente();
      const ctx = comoEmpresa(x.e.empresa, x.operador.id);
      expect(await consultas.nombresDePersonas(ctx, { ids: [] })).toEqual({
        ok: true,
        valor: new Map(),
      });
      expect(
        await consultas.nombresDePersonas(ctx, { ids: [x.gerente.id, x.gerente.id, x.gerente.id] }),
      ).toEqual({ ok: true, valor: new Map([[x.gerente.id, x.gerente.email]]) });
      const justo = Array.from({ length: MAXIMO_DE_PERSONAS_POR_CONSULTA }, (_, i) =>
        i === 0 ? x.gerente.id : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );
      expect(await consultas.nombresDePersonas(ctx, { ids: justo })).toEqual({
        ok: true,
        valor: new Map([[x.gerente.id, x.gerente.email]]),
      });
    });

    it("idempotencia y lectura pura: repetirla da lo mismo y no escribe ni audita nada", async () => {
      const x = await empresaConGente();
      const ctx = comoEmpresa(x.e.empresa, x.administrador.id);
      const entrada = { ids: [x.gerente.id, x.operador.id] };
      const antes = await cuentas();
      const primera = await consultas.nombresDePersonas(ctx, entrada);
      const segunda = await consultas.nombresDePersonas(ctx, entrada);
      expect(segunda).toEqual(primera);
      expect(await cuentas()).toEqual(antes);
    });

    it("concurrencia: muchas lecturas simultáneas de la misma gente dan todas el mismo resultado", async () => {
      const x = await empresaConGente();
      const ctx = comoEmpresa(x.e.empresa, x.operador.id);
      const entrada = { ids: [x.gerente.id, x.administrador.id, x.operador.id] };
      const resultados = await Promise.all(
        Array.from({ length: 8 }, () => consultas.nombresDePersonas(ctx, entrada)),
      );
      const esperado = {
        ok: true,
        valor: new Map([
          [x.gerente.id, x.gerente.email],
          [x.administrador.id, x.administrador.email],
          [x.operador.id, x.operador.email],
        ]),
      };
      for (const r of resultados) expect(r).toEqual(esperado);
    });
  },
);
