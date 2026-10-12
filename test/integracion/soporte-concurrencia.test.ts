import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { crearBarrera, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import { claveAlAzar } from "./plataforma-apoyo";
import { crearCasosDeSoporte, crearEntornoDeSoporte } from "./soporte-apoyo";
import { plataformaEn } from "./soporte-datos";
import { AHORA_DE_PRUEBA } from "./entorno";

/**
 * Concurrencia de «explicar por qué» (H5 §D): dos o más pedidos simultáneos con la MISMA clave dejan
 * una sola constancia de acceso y devuelven lo mismo; con claves distintas, una cada uno. Con barrera
 * (todos leen antes de que ninguno confirme) y `Promise.all`. Base propia: SERIALIZABLE aborta por
 * falsos positivos si otros archivos escriben las mismas tablas en paralelo.
 */

const base = inject("baseDePruebas");
const admin = plataformaEn(AHORA_DE_PRUEBA);
const soporte = plataformaEn(AHORA_DE_PRUEBA, { tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });
const PARTICIPANTES = 6;

describe.skipIf(base === null)("soporte de plataforma: concurrencia de explicar por qué", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let datos: ReturnType<typeof crearEntornoDePrueba>;
  let empresa: string;
  let persona: { id: string; email: string };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    datos = crearEntornoDePrueba(propia.base, 3);
    const e = await crearEmpresaActiva(datos);
    empresa = e.empresa;
    persona = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, persona.id, "ADMINISTRADOR");
  });
  afterAll(async () => {
    await dueno.end();
    await datos.cerrar();
    await propia.destruir();
  });

  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query(texto, parametros)).rows[0] as { n: string }).n);
  const constancias = (entidadId: string) =>
    cuenta(
      "select count(*)::int as n from auditoria_plataforma where accion = 'SOPORTE_EXPLICAR' and entidad_id = $1",
      [entidadId],
    );

  /** Un entorno cuyas transacciones esperan en una barrera después de LEER y antes de escribir. */
  function conBarrera(participantes: number) {
    const barrera = crearBarrera(participantes);
    const entorno = crearEntornoDeSoporte(propia.base, participantes + 2, (tx) => ({
      ...tx,
      soporte: {
        ...tx.soporte,
        estadosDeEmpresas: async (...a) => {
          const estados = await tx.soporte.estadosDeEmpresas(...a);
          await barrera();
          return estados;
        },
        invitacionPorId: async (...a) => {
          const invitacion = await tx.soporte.invitacionPorId(...a);
          await barrera();
          return invitacion;
        },
      },
    }));
    return { entorno, casos: crearCasosDeSoporte(entorno) };
  }

  const pedir = (
    casos: ReturnType<typeof crearCasosDeSoporte>,
    contexto: typeof admin,
    clave: string,
  ) =>
    casos.explicarPorQue(contexto, {
      claveDeIdempotencia: clave,
      objetivo: {
        tipo: "ACCION",
        empresaId: empresa,
        persona: { por: "ID", personaId: persona.id },
        accion: "sucursales.crear",
      },
    });

  it("N pedidos simultáneos con la MISMA clave: todos ok, el mismo resultado y UNA sola constancia", async () => {
    const { entorno, casos } = conBarrera(PARTICIPANTES);
    try {
      const clave = claveAlAzar();
      const antesConstancias = await constancias(empresa);
      const antesClaves = await cuenta("select count(*)::int as n from idempotencia_plataforma");
      const resultados = await Promise.all(
        Array.from({ length: PARTICIPANTES }, () => pedir(casos, admin, clave)),
      );
      for (const r of resultados) expect(r).toEqual(resultados[0]);
      expect(resultados[0]?.ok).toBe(true);
      expect(await constancias(empresa)).toBe(antesConstancias + 1);
      expect(await cuenta("select count(*)::int as n from idempotencia_plataforma")).toBe(
        antesClaves + 1,
      );
    } finally {
      await entorno.cerrar();
    }
  });

  it("N pedidos simultáneos con claves DISTINTAS: una constancia por cada uno", async () => {
    const { entorno, casos } = conBarrera(PARTICIPANTES);
    try {
      const antes = await constancias(empresa);
      const resultados = await Promise.all(
        Array.from({ length: PARTICIPANTES }, () => pedir(casos, admin, claveAlAzar())),
      );
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(await constancias(empresa)).toBe(antes + PARTICIPANTES);
    } finally {
      await entorno.cerrar();
    }
  });

  it("la misma clave de dos administradores distintos, a la vez: cada uno deja la suya, sin chocar", async () => {
    const { entorno, casos } = conBarrera(2);
    try {
      const clave = claveAlAzar();
      const antes = await constancias(empresa);
      const [a, b] = await Promise.all([pedir(casos, admin, clave), pedir(casos, soporte, clave)]);
      expect(a.ok && b.ok).toBe(true);
      expect(await constancias(empresa)).toBe(antes + 2);
      const actores = await dueno.query<{ actor: string }>(
        `select actor from auditoria_plataforma where accion = 'SOPORTE_EXPLICAR' and entidad_id = $1
         order by id desc limit 2`,
        [empresa],
      );
      expect(actores.rows.map((f) => f.actor).sort()).toEqual(
        [ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA].sort(),
      );
    } finally {
      await entorno.cerrar();
    }
  });

  it("la misma clave con pedidos DISTINTOS, a la vez: uno gana y el otro es CLAVE_REUTILIZADA", async () => {
    const { entorno, casos } = conBarrera(2);
    try {
      const clave = claveAlAzar();
      const antes = await constancias(empresa);
      const otro = () =>
        casos.explicarPorQue(admin, {
          claveDeIdempotencia: clave,
          objetivo: {
            tipo: "ACCION",
            empresaId: empresa,
            persona: { por: "ID", personaId: persona.id },
            accion: "sucursales.ver",
          },
        });
      const resultados = await Promise.all([pedir(casos, admin, clave), otro()]);
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error))).toEqual([
        "CLAVE_REUTILIZADA",
      ]);
      expect(await constancias(empresa)).toBe(antes + 1);
    } finally {
      await entorno.cerrar();
    }
  });
});
