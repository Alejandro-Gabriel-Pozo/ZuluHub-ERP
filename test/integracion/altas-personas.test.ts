import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { crearCasosDeUsoDeIdentidad } from "../../src/modulos/identidad/publico";
import type { CasosDeUsoDeAltas } from "../../src/plataforma/casos-de-uso/altas";
import {
  empresaId,
  marcaComercialId,
  personaId,
  sucursalId,
} from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { Tokens } from "../../src/puertos/tokens";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import {
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeAlta,
  crearEntornoDeAlta,
  tokensDePrueba,
  type TxDeAltaDePrueba,
} from "./altas-apoyo";
import { comoEmpresa, crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  sucursalDe,
} from "./fixtures-identidad";
import { crearMundoDeMarca } from "./marcas-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * Suspender y reactivar una persona de todo el sistema (H5 P5, §B.5.6) contra Postgres real: el corte
 * inmediato en todas sus empresas, la constancia de plataforma y la de cada empresa donde es miembro activa,
 * lo que no se puede, la idempotencia, la autorización, la atomicidad y la carrera con su aceptación.
 * Base propia.
 */

const base = inject("baseDePruebas");

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}
const falla = <T>(r: Resultado<T, unknown>) => {
  if (r.ok) throw new Error("tenía que fallar");
  return r.error;
};

describe.skipIf(base === null)("suspender y reactivar personas", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeAltaDePrueba>;
  let entornoGeneral: ReturnType<typeof crearEntornoDePrueba>;
  let tokens: Tokens;
  let casos: CasosDeUsoDeAltas;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeAlta(propia.base, 6);
    entornoGeneral = crearEntornoDePrueba(propia.base, 4);
    tokens = tokensDePrueba();
    casos = crearCasosDeAlta(entorno, tokens);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoGeneral.cerrar();
    await propia.destruir();
  });

  const una = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows[0] as T);
  const todas = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows);
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query(texto, parametros)).rows[0] as { n: string }).n);

  const suspender = (persona: string, motivo = "fraude con la cuenta", clave = claveAlAzar()) =>
    casos.suspenderPersona(comoAdminAhora(), {
      claveDeIdempotencia: clave,
      personaId: persona,
      motivo,
    });
  const reactivar = (persona: string, clave = claveAlAzar()) =>
    casos.reactivarPersona(comoAdminAhora(), { claveDeIdempotencia: clave, personaId: persona });
  const activaEnLaBase = async (persona: string) =>
    (
      await una<{ activo_global: boolean }>("select activo_global from persona where id = $1", [
        persona,
      ])
    ).activo_global;
  const constanciasDePlataforma = (accion: string, persona: string) =>
    todas<{ actor: string; antes: Record<string, unknown>; despues: Record<string, unknown> }>(
      "select actor, antes, despues from auditoria_plataforma where accion = $1 and entidad_id = $2 order by id",
      [accion, persona],
    );
  const constanciasDeEmpresa = (accion: string, persona: string) =>
    todas<{
      empresa_id: string;
      actor_persona_id: string | null;
      despues: Record<string, unknown>;
    }>(
      "select empresa_id, actor_persona_id, despues from auditoria_empresa where accion = $1 and entidad_id = $2 order by empresa_id",
      [accion, persona],
    );

  /** Una persona que es miembro activa de dos empresas de tenants distintos y apagada en una tercera. */
  async function unaPersonaConEmpresas() {
    const persona = await crearPersonaDeBase(dueno);
    const a = await crearMundoDeMarca(dueno);
    const b = await crearMundoDeMarca(dueno);
    const apagada = await crearMundoDeMarca(dueno);
    await crearMembresiaDeBase(dueno, a.empresa, persona.id, "GERENTE");
    await crearMembresiaDeBase(dueno, b.empresa, persona.id, "OPERADOR");
    await crearMembresiaDeBase(dueno, apagada.empresa, persona.id, "OPERADOR", false);
    return { persona, a, b, apagada };
  }

  describe("suspender y reactivar", () => {
    it("suspende en todo el sistema, deja la constancia de plataforma y una por cada empresa con membresía ACTIVA", async () => {
      const { persona, a, b, apagada } = await unaPersonaConEmpresas();
      const r = exito(await suspender(persona.id, "  fraude con la cuenta "));
      expect(r).toEqual({
        personaId: persona.id,
        activa: false,
        empresasAfectadas: 2,
        repetida: false,
      });
      expect(await activaEnLaBase(persona.id)).toBe(false);
      expect(await constanciasDePlataforma("PERSONA_SUSPENDIDA", persona.id)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { activa: true },
          despues: { activa: false, motivo: "fraude con la cuenta", empresasAfectadas: 2 },
        },
      ]);
      // Una fila en la historia de cada empresa donde es miembro activa, sin actor de persona; ninguna en la apagada.
      expect(await constanciasDeEmpresa("PERSONA_SUSPENDIDA", persona.id)).toEqual(
        [a.empresa, b.empresa].sort().map((empresa_id) => ({
          empresa_id,
          actor_persona_id: null,
          despues: { activa: false, motivo: "fraude con la cuenta" },
        })),
      );
      expect(
        await cuenta("select count(*)::int as n from auditoria_empresa where empresa_id = $1", [
          apagada.empresa,
        ]),
      ).toBe(0);
    });

    it("ninguna constancia lleva el email de la persona", async () => {
      const { persona } = await unaPersonaConEmpresas();
      exito(await suspender(persona.id));
      for (const f of await todas<{ d: string }>(
        `select despues::text as d from auditoria_plataforma where entidad_id = $1
         union all select despues::text from auditoria_empresa where entidad_id = $1`,
        [persona.id],
      )) {
        expect(f.d).not.toContain(persona.email);
      }
    });

    it("reactiva, con su constancia en plataforma y en las mismas empresas", async () => {
      const { persona, a, b } = await unaPersonaConEmpresas();
      exito(await suspender(persona.id));
      const r = exito(await reactivar(persona.id));
      expect(r).toEqual({
        personaId: persona.id,
        activa: true,
        empresasAfectadas: 2,
        repetida: false,
      });
      expect(await activaEnLaBase(persona.id)).toBe(true);
      expect(await constanciasDePlataforma("PERSONA_REACTIVADA", persona.id)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { activa: false },
          despues: { activa: true, empresasAfectadas: 2 },
        },
      ]);
      expect(
        (await constanciasDeEmpresa("PERSONA_REACTIVADA", persona.id)).map((c) => c.empresa_id),
      ).toEqual([a.empresa, b.empresa].sort());
    });

    it("una persona sin empresas también se suspende (0 empresas afectadas)", async () => {
      const persona = await crearPersonaDeBase(dueno);
      const r = exito(await suspender(persona.id));
      expect(r.empresasAfectadas).toBe(0);
      expect(await activaEnLaBase(persona.id)).toBe(false);
    });

    it("el corte es INMEDIATO: la persona suspendida no puede hacer nada en ninguna de sus empresas, y reactivarla lo devuelve", async () => {
      const persona = await crearPersonaDeBase(dueno);
      const a = await crearMundoDeMarca(dueno);
      const b = await crearMundoDeMarca(dueno);
      await crearMembresiaDeBase(dueno, a.empresa, persona.id, "GERENTE");
      await crearMembresiaDeBase(dueno, b.empresa, persona.id, "GERENTE");
      const identidad = crearCasosDeUsoDeIdentidad({
        transacciones: entornoGeneral,
        tokens,
        reglas: REGLAS_DE_EMPRESA,
      });
      const invitar = async (empresa: string) =>
        identidad.invitarUsuario(
          comoEmpresa(
            empresaId(empresa),
            personaId(persona.id),
            marcaComercialId(MARCA_PRINCIPAL_DE_PRUEBA),
          ),
          {
            email: emailAlAzar("nuevo"),
            rol: "OPERADOR",
            sucursales: [sucursalId(await sucursalDe(dueno, empresa))],
          },
        );
      exito(await invitar(a.empresa));
      exito(await suspender(persona.id));
      expect(falla(await invitar(a.empresa))).toBe("SIN_PERMISO");
      expect(falla(await invitar(b.empresa))).toBe("SIN_PERMISO");
      exito(await reactivar(persona.id));
      exito(await invitar(a.empresa));
      exito(await invitar(b.empresa));
    });

    it("suspender a quien ya está suspendido (otra clave) es YA_SUSPENDIDA; reactivar a una activa, NO_SUSPENDIDA", async () => {
      const { persona } = await unaPersonaConEmpresas();
      expect(falla(await reactivar(persona.id))).toBe("NO_SUSPENDIDA");
      exito(await suspender(persona.id));
      const filas = await cuenta(
        "select count(*)::int as n from auditoria_empresa where entidad_id = $1",
        [persona.id],
      );
      expect(falla(await suspender(persona.id))).toBe("YA_SUSPENDIDA");
      expect(
        await cuenta("select count(*)::int as n from auditoria_empresa where entidad_id = $1", [
          persona.id,
        ]),
      ).toBe(filas);
      expect(await constanciasDePlataforma("PERSONA_SUSPENDIDA", persona.id)).toHaveLength(1);
    });

    it("sin motivo es MOTIVO_OBLIGATORIO; una persona que no existe, PERSONA_NO_ENCONTRADA; un id malo, ID_INVALIDO", async () => {
      const persona = await crearPersonaDeBase(dueno);
      for (const motivo of ["", "   "]) {
        expect(falla(await suspender(persona.id, motivo))).toBe("MOTIVO_OBLIGATORIO");
      }
      expect(falla(await suspender("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "PERSONA_NO_ENCONTRADA",
      );
      expect(falla(await reactivar("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "PERSONA_NO_ENCONTRADA",
      );
      expect(falla(await suspender("x"))).toBe("ID_INVALIDO");
      expect(await activaEnLaBase(persona.id)).toBe(true);
    });

    it("la misma clave devuelve lo mismo (repetida) sin volver a auditar; con otro motivo o persona es CLAVE_REUTILIZADA", async () => {
      const { persona } = await unaPersonaConEmpresas();
      const otra = await crearPersonaDeBase(dueno);
      const clave = claveAlAzar();
      const primera = exito(await suspender(persona.id, "fraude", clave));
      expect(exito(await suspender(persona.id, "fraude", clave))).toEqual({
        ...primera,
        repetida: true,
      });
      expect(await constanciasDePlataforma("PERSONA_SUSPENDIDA", persona.id)).toHaveLength(1);
      expect(await constanciasDeEmpresa("PERSONA_SUSPENDIDA", persona.id)).toHaveLength(2);
      expect(falla(await suspender(persona.id, "otro motivo", clave))).toBe("CLAVE_REUTILIZADA");
      expect(falla(await suspender(otra.id, "fraude", clave))).toBe("CLAVE_REUTILIZADA");
      expect(await activaEnLaBase(otra.id)).toBe(true);
    });

    it("SOPORTE y el sistema: SIN_PERMISO, y la persona sigue activa", async () => {
      const { persona } = await unaPersonaConEmpresas();
      const sistema = { ...comoAdminAhora(), actor: { tipo: "SISTEMA", proceso: "x" } } as const;
      for (const contexto of [comoSoporteAhora(), sistema]) {
        expect(
          falla(
            await casos.suspenderPersona(contexto, {
              claveDeIdempotencia: claveAlAzar(),
              personaId: persona.id,
              motivo: "x",
            }),
          ),
        ).toBe("SIN_PERMISO");
        expect(
          falla(
            await casos.reactivarPersona(contexto, {
              claveDeIdempotencia: claveAlAzar(),
              personaId: persona.id,
            }),
          ),
        ).toBe("SIN_PERMISO");
      }
      expect(await activaEnLaBase(persona.id)).toBe(true);
    });
  });

  describe("todo o nada", () => {
    const pasos = [
      "cambiar el estado",
      "leer las membresías",
      "auditar la primera empresa",
      "dejar la constancia de plataforma",
      "registrar la clave",
    ] as const;
    type Paso = (typeof pasos)[number];

    function entornoRotoDespuesDe(paso: Paso) {
      const despues = async <T>(valor: Promise<T>): Promise<T> => {
        await valor;
        throw new Error(`falla inyectada después de ${paso}`);
      };
      return crearEntornoDeAlta(propia.base, 3, (tx) => {
        switch (paso) {
          case "cambiar el estado":
            return {
              ...tx,
              personas: {
                ...tx.personas,
                cambiarActivoGlobal: (...a) => despues(tx.personas.cambiarActivoGlobal(...a)),
              },
            };
          case "leer las membresías":
            return {
              ...tx,
              membresias: {
                empresasConMembresiaActiva: (...a) =>
                  despues(tx.membresias.empresasConMembresiaActiva(...a)),
              },
            };
          case "auditar la primera empresa":
            return {
              ...tx,
              auditoria: { registrar: (...a) => despues(tx.auditoria.registrar(...a)) },
            };
          case "dejar la constancia de plataforma":
            return {
              ...tx,
              auditoriaDePlataforma: {
                registrar: (...a) => despues(tx.auditoriaDePlataforma.registrar(...a)),
              },
            };
          case "registrar la clave":
            return {
              ...tx,
              idempotencia: {
                ...tx.idempotencia,
                registrar: (...a) => despues(tx.idempotencia.registrar(...a)),
              },
            };
        }
      });
    }

    it.each(pasos)(
      "suspender: falla después de «%s» y la persona sigue activa, sin rastro",
      async (paso) => {
        const { persona } = await unaPersonaConEmpresas();
        const antes = {
          empresa: await cuenta("select count(*)::int as n from auditoria_empresa"),
          plataforma: await cuenta("select count(*)::int as n from auditoria_plataforma"),
          claves: await cuenta("select count(*)::int as n from idempotencia_plataforma"),
        };
        const roto = entornoRotoDespuesDe(paso);
        try {
          await expect(
            crearCasosDeAlta(roto).suspenderPersona(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              personaId: persona.id,
              motivo: "fraude",
            }),
          ).rejects.toThrow("falla inyectada");
        } finally {
          await roto.cerrar();
        }
        expect(await activaEnLaBase(persona.id)).toBe(true);
        expect({
          empresa: await cuenta("select count(*)::int as n from auditoria_empresa"),
          plataforma: await cuenta("select count(*)::int as n from auditoria_plataforma"),
          claves: await cuenta("select count(*)::int as n from idempotencia_plataforma"),
        }).toEqual(antes);
      },
    );
  });

  describe("carreras", () => {
    const VUELTAS = 8;

    it("dos suspensiones a la vez (claves distintas): una gana y la otra es YA_SUSPENDIDA; las constancias salen una sola vez", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const cita = crearBarrera(2);
        const e = crearEntornoDeAlta(propia.base, 4, (tx) => ({
          ...tx,
          personas: {
            ...tx.personas,
            obtener: async (...a) => {
              const r = await tx.personas.obtener(...a);
              await cita();
              return r;
            },
          },
        }));
        try {
          const { persona } = await unaPersonaConEmpresas();
          const c = crearCasosDeAlta(e, tokens);
          const rs = await Promise.all(
            [1, 2].map(() =>
              c.suspenderPersona(comoAdminAhora(), {
                claveDeIdempotencia: claveAlAzar(),
                personaId: persona.id,
                motivo: "fraude",
              }),
            ),
          );
          expect(
            rs.filter((r) => r.ok),
            `vuelta ${vuelta}`,
          ).toHaveLength(1);
          expect(rs.flatMap((r) => (r.ok ? [] : [r.error]))).toEqual(["YA_SUSPENDIDA"]);
          expect(await constanciasDePlataforma("PERSONA_SUSPENDIDA", persona.id)).toHaveLength(1);
          expect(await constanciasDeEmpresa("PERSONA_SUSPENDIDA", persona.id)).toHaveLength(2);
        } finally {
          await e.cerrar();
        }
      }
    });

    it("suspender contra la aceptación de una invitación de esa persona: o la membresía nace antes (y queda constancia en su empresa) o la aceptación se rechaza; nunca una membresía activa sin constancia", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const cita = crearBarrera(2);
        const entornoSuspende = crearEntornoDeAlta(propia.base, 4, (tx) => ({
          ...tx,
          membresias: {
            empresasConMembresiaActiva: async (...a) => {
              const r = await tx.membresias.empresasConMembresiaActiva(...a);
              await cita();
              return r;
            },
          },
        }));
        const entornoAcepta = crearEntornoDePrueba(propia.base, 4, (tx) => ({
          ...tx,
          invitaciones: {
            ...tx.invitaciones,
            obtenerPorHash: async (...a) => {
              const r = await tx.invitaciones.obtenerPorHash(...a);
              await cita();
              return r;
            },
          },
        }));
        try {
          // Una empresa con su gerente, y una invitación de USUARIO para una persona que ya existe y tiene OTRA empresa.
          const email = emailAlAzar("invitada");
          const persona = await crearPersonaDeBase(dueno, email);
          const previa = await crearMundoDeMarca(dueno);
          await crearMembresiaDeBase(dueno, previa.empresa, persona.id, "OPERADOR");
          const destino = await crearMundoDeMarca(dueno);
          const gerente = await crearPersonaDeBase(dueno);
          await crearMembresiaDeBase(dueno, destino.empresa, gerente.id, "GERENTE");
          const identidadGerente = crearCasosDeUsoDeIdentidad({
            transacciones: entornoGeneral,
            tokens,
            reglas: REGLAS_DE_EMPRESA,
          });
          const invitada = exito(
            await identidadGerente.invitarUsuario(
              comoEmpresa(
                empresaId(destino.empresa),
                personaId(gerente.id),
                marcaComercialId(MARCA_PRINCIPAL_DE_PRUEBA),
              ),
              {
                email,
                rol: "OPERADOR",
                sucursales: [sucursalId(await sucursalDe(dueno, destino.empresa))],
              },
            ),
          );
          const identidad = crearCasosDeUsoDeIdentidad({
            transacciones: entornoAcepta,
            tokens,
            reglas: REGLAS_DE_EMPRESA,
          });
          const [aceptada, suspendida] = await Promise.all([
            identidad.aceptarInvitacion({
              token: tokens.derivar(invitada.invitacionId),
              emailAutenticado: email,
              usuarioAuth: usuarioDePrueba(email),
              marcaDeEntrada: marcaComercialId(MARCA_PRINCIPAL_DE_PRUEBA),
              ahora: new Date(),
            }),
            crearCasosDeAlta(entornoSuspende, tokens).suspenderPersona(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              personaId: persona.id,
              motivo: "fraude",
            }),
          ]);
          expect(suspendida.ok, `vuelta ${vuelta}`).toBe(true);
          expect(await activaEnLaBase(persona.id)).toBe(false);
          const activas = (
            await todas<{ empresa_id: string }>(
              "select empresa_id from membresia where persona_id = $1 and activo order by empresa_id",
              [persona.id],
            )
          ).map((m) => m.empresa_id);
          const conConstancia = (await constanciasDeEmpresa("PERSONA_SUSPENDIDA", persona.id)).map(
            (c) => c.empresa_id,
          );
          // El invariante: toda empresa donde sigue siendo miembro activa tiene su constancia de suspensión.
          expect(conConstancia, `vuelta ${vuelta}`).toEqual(activas);
          if (aceptada.ok) {
            expect(activas).toContain(destino.empresa);
          } else {
            expect(falla(aceptada)).toBe("PERSONA_SUSPENDIDA");
            expect(activas).not.toContain(destino.empresa);
          }
        } finally {
          await entornoSuspende.cerrar();
          await entornoAcepta.cerrar();
        }
      }
    });
  });
});
