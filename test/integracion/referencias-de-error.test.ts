import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Contexto } from "../../src/contexto/contexto";
import type { NuevaReferenciaDeError } from "../../src/puertos/referencias-de-error";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  comoGrupo,
  comoInvitacion,
  comoTrabajos,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import { crearPersonaDeBase, tokenAlAzar } from "./fixtures-identidad";
import {
  adminInexistente,
  comoAdmin,
  comoAdminDe,
  comoSistema,
  comoSoporte,
  crearAdminDeBase,
  esperarAccesoDenegado,
  esperarError,
} from "./plataforma-apoyo";

/**
 * H5 plataforma, tramo P4: la escritura de `referencia_de_error` por cada puerta, contra una base real
 * y con los roles reales. Cada contexto escribe solo lo suyo; nadie, salvo la plataforma, lo lee.
 */

const base = inject("baseDePruebas");

const nuevaReferencia = (): string =>
  `ZH-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;

describe.skipIf(base === null)("referencias de error: escritura por puerta", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let e: EmpresaDePrueba;
  let otra: EmpresaDePrueba;
  let persona: string;
  let ajena: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    e = await crearEmpresaActiva(entorno);
    otra = await crearEmpresaActiva(entorno);
    persona = (await crearPersonaDeBase(dueno)).id;
    ajena = (await crearPersonaDeBase(dueno)).id;
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async (texto: string, parametros: unknown[] = []) =>
    (await dueno.query<Record<string, unknown>>(texto, parametros)).rows;
  const guardadas = async (referencia: string) =>
    filas(
      "select referencia, accion, motivo, empresa_id, persona_id from referencia_de_error where referencia = $1",
      [referencia],
    );

  const registrar = (contexto: Contexto, datos: Partial<NuevaReferenciaDeError> = {}) => {
    const referencia = datos.referencia ?? nuevaReferencia();
    return {
      referencia,
      resultado: entorno.ejecutar({ contexto }, async ({ referenciasDeError }) => {
        await referenciasDeError.registrar({
          referencia,
          accion: "usuarios.invitar",
          motivo: "SIN_PERMISO",
          empresaId: null,
          personaId: null,
          ...datos,
        });
        return ok(null);
      }),
    };
  };

  describe("cada contexto escribe lo suyo", () => {
    it("plataforma: un administrador, soporte o `sistema`, sin empresa ni persona", async () => {
      for (const contexto of [comoAdmin(), comoSoporte(), comoSistema()]) {
        const { referencia, resultado } = registrar(contexto, { accion: "empresas.alta" });
        expect(await resultado).toEqual({ ok: true, valor: null });
        expect(await guardadas(referencia)).toEqual([
          {
            referencia,
            accion: "empresas.alta",
            motivo: "SIN_PERMISO",
            empresa_id: null,
            persona_id: null,
          },
        ]);
      }
    });

    it("plataforma: un administrador de baja o inexistente no escribe", async () => {
      const baja = await crearAdminDeBase(dueno, { activo: false });
      for (const contexto of [comoAdminDe(baja.id), comoAdminDe(adminInexistente())]) {
        const { referencia, resultado } = registrar(contexto);
        esperarAccesoDenegado(await resultado);
        expect(await guardadas(referencia)).toEqual([]);
      }
    });

    it("operativo: la empresa y la persona del contexto, o la empresa sola si no hay persona", async () => {
      const conPersona = registrar(comoEmpresa(empresaId(e.empresa), personaId(persona)), {
        empresaId: empresaId(e.empresa),
        personaId: personaId(persona),
        motivo: "EMPRESA_NO_OPERA",
      });
      expect(await conPersona.resultado).toEqual({ ok: true, valor: null });
      expect(await guardadas(conPersona.referencia)).toEqual([
        expect.objectContaining({
          empresa_id: e.empresa,
          persona_id: persona,
          motivo: "EMPRESA_NO_OPERA",
        }),
      ]);
      const sinPersona = registrar(comoEmpresa(empresaId(e.empresa)), {
        empresaId: empresaId(e.empresa),
      });
      expect(await sinPersona.resultado).toEqual({ ok: true, valor: null });
      expect(await guardadas(sinPersona.referencia)).toEqual([
        expect.objectContaining({ empresa_id: e.empresa, persona_id: null }),
      ]);
    });

    it("operativo: no puede escribir a nombre de otra empresa, de otra persona ni sin empresa", async () => {
      const contexto = comoEmpresa(empresaId(e.empresa), personaId(persona));
      for (const datos of [
        { empresaId: empresaId(otra.empresa), personaId: personaId(persona) },
        { empresaId: empresaId(e.empresa), personaId: personaId(ajena) },
        { empresaId: empresaId(e.empresa), personaId: null },
        { empresaId: null, personaId: personaId(persona) },
        { empresaId: null, personaId: null },
      ]) {
        const { referencia, resultado } = registrar(contexto, datos);
        esperarAccesoDenegado(await resultado);
        expect(await guardadas(referencia), JSON.stringify(datos)).toEqual([]);
      }
    });

    it("invitación: sin empresa ni persona; con alguna de las dos, se rechaza", async () => {
      const { tokenHash } = tokenAlAzar();
      const { referencia, resultado } = registrar(comoInvitacion(tokenHash), {
        accion: "invitaciones.aceptar",
        motivo: "INVITACION_VENCIDA",
      });
      expect(await resultado).toEqual({ ok: true, valor: null });
      expect(await guardadas(referencia)).toEqual([
        expect.objectContaining({ empresa_id: null, persona_id: null }),
      ]);
      for (const datos of [
        { empresaId: empresaId(e.empresa) },
        { personaId: personaId(persona) },
      ]) {
        const rechazada = registrar(comoInvitacion(tokenHash), datos);
        esperarAccesoDenegado(await rechazada.resultado);
        expect(await guardadas(rechazada.referencia)).toEqual([]);
      }
    });

    it("grupo: sin empresa y con la persona del contexto", async () => {
      const contexto = comoGrupo(e.tenant, personaId(persona));
      const { referencia, resultado } = registrar(contexto, {
        accion: "grupo.consultar",
        personaId: personaId(persona),
      });
      expect(await resultado).toEqual({ ok: true, valor: null });
      expect(await guardadas(referencia)).toEqual([
        expect.objectContaining({ empresa_id: null, persona_id: persona }),
      ]);
      for (const datos of [
        { personaId: personaId(ajena) },
        { personaId: null },
        { empresaId: empresaId(e.empresa), personaId: personaId(persona) },
      ]) {
        const rechazada = registrar(contexto, datos);
        esperarAccesoDenegado(await rechazada.resultado);
        expect(await guardadas(rechazada.referencia), JSON.stringify(datos)).toEqual([]);
      }
    });

    it("trabajos: no tiene permiso", async () => {
      const { referencia, resultado } = registrar(comoTrabajos());
      esperarAccesoDenegado(await resultado);
      expect(await guardadas(referencia)).toEqual([]);
    });

    it("autenticación: el rol de base no tiene permiso (42501)", async () => {
      const c = new pg.Client({ connectionString: propia.base.autenticacion });
      await c.connect();
      try {
        await expect(
          c.query(
            "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-AAAA-BBBB', 'a.b', 'X')",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(c.query("select 1 from referencia_de_error")).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await c.end();
      }
    });
  });

  describe("quién la lee", () => {
    it("solo la plataforma (con un actor vigente); la aplicación y el grupo escriben pero no leen", async () => {
      const { referencia, resultado } = registrar(comoAdmin());
      await resultado;
      const leer = (contexto: Contexto) =>
        entorno.ejecutar({ contexto }, async ({ db }) => {
          const { rows } = await sql<{ n: string }>`select count(*) as n from referencia_de_error
            where referencia = ${referencia}`.execute(db);
          return ok(Number(rows[0]?.n));
        });
      expect((await leer(comoAdmin())).ok).toBe(true);
      expect(await leer(comoSoporte())).toEqual({ ok: true, valor: 1 });
      expect(await leer(comoSistema())).toEqual({ ok: true, valor: 1 });
      expect(await leer(comoAdminDe(adminInexistente()))).toEqual({ ok: true, valor: 0 });
      esperarAccesoDenegado(await leer(comoEmpresa(empresaId(e.empresa))));
      esperarAccesoDenegado(await leer(comoGrupo(e.tenant, personaId(persona))));
      esperarAccesoDenegado(await leer(comoTrabajos()));
    });
  });

  describe("la forma de cada campo la impone la base", () => {
    const rechazos: [string, Partial<NuevaReferenciaDeError>][] = [
      ["referencia en minúsculas", { referencia: "ZH-abcd-1234" }],
      ["referencia corta", { referencia: "ZH-ABC-1234" }],
      ["referencia larga", { referencia: "ZH-ABCDE-1234" }],
      ["referencia sin prefijo", { referencia: "AB-ABCD-1234" }],
      ["referencia con espacio", { referencia: "ZH-ABCD-1234 " }],
      ["referencia con un salto de línea", { referencia: "ZH-ABCD-1234\n" }],
      ["acción con mayúsculas", { accion: "Usuarios.invitar" }],
      ["acción vacía", { accion: "" }],
      ["acción con espacios", { accion: "usuarios invitar" }],
      ["acción de más de 80 caracteres", { accion: "a".repeat(81) }],
      ["motivo en minúsculas", { motivo: "sin_permiso" }],
      ["motivo vacío", { motivo: "" }],
      ["motivo con texto libre", { motivo: "SIN PERMISO PARA ESTO" }],
      ["motivo de más de 80 caracteres", { motivo: "A".repeat(81) }],
    ];

    for (const [nombre, datos] of rechazos) {
      it(`rechaza: ${nombre}`, async () => {
        const { referencia, resultado } = registrar(comoAdmin(), datos);
        esperarError(await resultado, "Check");
        expect(await guardadas(referencia)).toEqual([]);
      });
    }

    it("acepta los límites: 80 caracteres de acción y de motivo", async () => {
      const { referencia, resultado } = registrar(comoAdmin(), {
        accion: "a".repeat(80),
        motivo: "A".repeat(80),
      });
      expect((await resultado).ok).toBe(true);
      expect(await guardadas(referencia)).toHaveLength(1);
    });

    it("una empresa o una persona que no existen: error de referencia", async () => {
      const r = registrar(comoAdmin(), { empresaId: empresaId(randomUUID()) });
      esperarError(await r.resultado, "Referencia");
      const p = registrar(comoAdmin(), { personaId: personaId(randomUUID()) });
      esperarError(await p.resultado, "Referencia");
    });
  });

  describe("única (desde 0007), solo inserción, atómica y concurrente", () => {
    it("dos referencias iguales (colisión de 32 bits): la segunda choca con la única y no pisa a la primera", async () => {
      const referencia = nuevaReferencia();
      expect((await registrar(comoAdmin(), { referencia, motivo: "UNO" }).resultado).ok).toBe(true);
      const segunda = await registrar(comoAdmin(), { referencia, motivo: "DOS" }).resultado;
      expect(segunda).toMatchObject({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "referencia_de_error_referencia_uk" },
      });
      expect((await guardadas(referencia)).map((f) => f["motivo"])).toEqual(["UNO"]);
    });

    it("es de solo inserción: ni UPDATE ni DELETE ni TRUNCATE, ni para plataforma", async () => {
      const { referencia, resultado } = registrar(comoAdmin());
      await resultado;
      for (const texto of [
        sql`update referencia_de_error set motivo = 'OTRO' where referencia = ${referencia}`,
        sql`delete from referencia_de_error where referencia = ${referencia}`,
        sql`truncate referencia_de_error`,
      ]) {
        esperarAccesoDenegado(
          await entorno.ejecutar({ contexto: comoAdmin() }, async ({ db }) => {
            await texto.execute(db);
            return ok(null);
          }),
        );
      }
      expect(await guardadas(referencia)).toHaveLength(1);
    });

    it("atómica con su transacción: si algo falla después, no queda la referencia", async () => {
      const referencia = nuevaReferencia();
      await expect(
        entorno.ejecutar({ contexto: comoAdmin() }, async ({ referenciasDeError }) => {
          await referenciasDeError.registrar({
            referencia,
            accion: "usuarios.invitar",
            motivo: "SIN_PERMISO",
            empresaId: null,
            personaId: null,
          });
          throw new Error("falla forzada");
        }),
      ).rejects.toThrow("falla forzada");
      expect(await guardadas(referencia)).toEqual([]);
    });

    it("ocho escrituras simultáneas de las distintas puertas: no se pierde ninguna", async () => {
      const contextos: Contexto[] = [
        comoAdmin(),
        comoSoporte(),
        comoSistema(),
        comoEmpresa(empresaId(e.empresa), personaId(persona)),
        comoEmpresa(empresaId(otra.empresa)),
        comoGrupo(e.tenant, personaId(persona)),
        comoInvitacion(tokenAlAzar().tokenHash),
        comoAdmin(),
      ];
      const datos = (c: Contexto): Partial<NuevaReferenciaDeError> =>
        c.tipo === "OPERATIVO"
          ? {
              empresaId: c.empresaId,
              personaId: c.personaId,
            }
          : c.tipo === "GRUPO"
            ? { personaId: c.personaId }
            : {};
      const barrera = crearBarrera(contextos.length);
      // Una referencia distinta por escritura (la misma chocaría con la única de 0007).
      const referencias = contextos.map(() => nuevaReferencia());
      const rs = await Promise.all(
        contextos.map((contexto, i) =>
          entorno.ejecutar({ contexto }, async ({ referenciasDeError }) => {
            await barrera();
            await referenciasDeError.registrar({
              referencia: referencias[i] as string,
              accion: "usuarios.invitar",
              motivo: "SIN_PERMISO",
              empresaId: null,
              personaId: null,
              ...datos(contexto),
            });
            return ok(null);
          }),
        ),
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      for (const referencia of referencias) expect(await guardadas(referencia)).toHaveLength(1);
    });
  });
});
