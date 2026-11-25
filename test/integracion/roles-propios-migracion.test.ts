import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoInvitacion,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import {
  aceptarDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  type RolDePrueba,
} from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import { esperarBloqueo, SesionDePrueba } from "./sesiones";

/**
 * 0097 (roles propios de la empresa, T4 de H4b) contra una base real, con el rol de la aplicación y el contexto firmado de cada persona: la asignación de un rol propio la hace
 * solo el gerente activo de la empresa (segunda línea de `usuarios.asignar_rol`), nunca sobre un gerente, nunca a un rol de otra empresa o archivado; el CHECK PROPIO <=> rol propio;
 * archivar exige que nadie activo lo tenga; y las dos carreras (asignar contra archivar, en los dos órdenes) no dejan a nadie activo en un rol archivado.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const PISO = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
];

describe.skipIf(base === null)("migración 0097: roles propios de la empresa (T4 de H4b)", () => {
  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);
  let dueno: pg.Client;

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
  });

  type Equipo = Readonly<{
    empresa: EmpresaId;
    gerente: PersonaId;
    administrador: PersonaId;
    operador: PersonaId;
    otro: PersonaId;
  }>;

  const miembro = async (empresa: EmpresaId, rol: RolDePrueba, activo = true) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol, activo);
    return personaId(p.id);
  };
  const equipo = async (): Promise<Equipo> => {
    const empresa = (await crearEmpresaActiva(entorno)).empresa;
    return {
      empresa,
      gerente: await miembro(empresa, "GERENTE"),
      administrador: await miembro(empresa, "ADMINISTRADOR"),
      operador: await miembro(empresa, "OPERADOR"),
      otro: await miembro(empresa, "OPERADOR"),
    };
  };
  /** Un rol propio con su primera versión, creado por el dueño de la base (lo que se prueba es la asignación, no la creación). */
  const crearRol = async (empresa: EmpresaId, activo = true): Promise<string> => {
    const autor = (await crearPersonaDeBase(dueno)).id;
    const id = randomUUID();
    await dueno.query(
      "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave, activo) values ($1, $2, $3, $3, $4)",
      [id, empresa, `rol-${id}`, activo],
    );
    await dueno.query(
      "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, 1, $3::text[], $4, now())",
      [empresa, id, [...PISO, "ventas.ver"], autor],
    );
    return id;
  };
  const comoApp = (empresa: EmpresaId, persona: PersonaId | null) =>
    SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", comoEmpresa(empresa, persona));

  const ASIGNAR =
    "update membresia set rol = 'PROPIO', rol_propio_id = $3 where empresa_id = $1 and persona_id = $2";
  const DESASIGNAR =
    "update membresia set rol = $3, rol_propio_id = null where empresa_id = $1 and persona_id = $2";

  /** Una sentencia con el rol de la aplicación de esa persona, en su propia transacción: `null` si anduvo y confirmó, o `codigo:restriccion`; `filas` si no tocó nada. */
  const intentar = async (
    empresa: EmpresaId,
    persona: PersonaId | null,
    sql: string,
    parametros: unknown[],
  ): Promise<string | null> => {
    const s = await comoApp(empresa, persona);
    try {
      const r = await s.intentar(sql, parametros);
      if (!r.ok) return `${r.codigo}:${r.restriccion ?? ""}`;
      if (r.filas === 0) return "0 filas";
      await s.confirmar();
      return null;
    } finally {
      await s.cerrar();
    }
  };
  const estado = async (empresa: EmpresaId, persona: PersonaId) =>
    (
      await dueno.query<{ rol: string; rol_propio_id: string | null }>(
        "select rol, rol_propio_id from membresia where empresa_id = $1 and persona_id = $2",
        [empresa, persona],
      )
    ).rows[0];

  describe("la forma de la fila", () => {
    it("PROPIO exige un rol propio y un rol propio exige PROPIO (CHECK), aun para el dueño de la base", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      const p = await crearPersonaDeBase(dueno);
      for (const [roles, id] of [
        ["PROPIO", null],
        ["OPERADOR", rol],
      ] as const) {
        await expect(
          dueno.query(
            "insert into membresia (empresa_id, persona_id, rol, rol_propio_id) values ($1, $2, $3, $4)",
            [e.empresa, p.id, roles, id],
          ),
        ).rejects.toMatchObject({ code: "23514", constraint: "membresia_rol_propio_ck" });
      }
    });

    it("el rol propio es de la MISMA empresa (clave foránea compuesta)", async () => {
      const e = await equipo();
      const ajeno = await crearRol((await equipo()).empresa);
      const p = await crearPersonaDeBase(dueno);
      await expect(
        dueno.query(
          "insert into membresia (empresa_id, persona_id, rol, rol_propio_id) values ($1, $2, 'PROPIO', $3)",
          [e.empresa, p.id, ajeno],
        ),
      ).rejects.toMatchObject({ code: "23503", constraint: "membresia_rol_propio_fkey" });
    });

    it("las filas de hoy (los tres roles base) no tienen rol propio", async () => {
      const e = await equipo();
      const { rows } = await dueno.query(
        "select count(*)::int as n from membresia where empresa_id = $1 and rol_propio_id is not null",
        [e.empresa],
      );
      expect(rows[0]).toEqual({ n: 0 });
    });
  });

  describe("quién asigna (el disparador exige al gerente activo de la empresa)", () => {
    it("el gerente asigna un rol propio a un operador y lo devuelve a OPERADOR; queda todo consistente", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      expect(
        await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.operador, rol]),
      ).toBeNull();
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "PROPIO", rol_propio_id: rol });
      expect(
        await intentar(e.empresa, e.gerente, DESASIGNAR, [e.empresa, e.operador, "OPERADOR"]),
      ).toBeNull();
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
    });

    it("el gerente cambia a un administrador a un rol propio y a un rol propio a otro rol propio", async () => {
      const e = await equipo();
      const a = await crearRol(e.empresa);
      const b = await crearRol(e.empresa);
      expect(
        await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.administrador, a]),
      ).toBeNull();
      expect(
        await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.administrador, b]),
      ).toBeNull();
      expect(await estado(e.empresa, e.administrador)).toEqual({ rol: "PROPIO", rol_propio_id: b });
    });

    it.each(["administrador", "operador"] as const)(
      "un %s NO asigna roles (23514 membresia_rol_sin_traspaso), ni a otro ni a sí mismo",
      async (quien) => {
        const e = await equipo();
        const rol = await crearRol(e.empresa);
        for (const objetivo of [e.otro, e[quien]]) {
          expect(await intentar(e.empresa, e[quien], ASIGNAR, [e.empresa, objetivo, rol])).toBe(
            "23514:membresia_rol_sin_traspaso",
          );
        }
        expect(await estado(e.empresa, e.otro)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
      },
    );

    it("sin persona (el sistema) y una persona ajena a la empresa no asignan", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      const otraEmpresa = await equipo();
      expect(await intentar(e.empresa, null, ASIGNAR, [e.empresa, e.operador, rol])).toBe(
        "23514:membresia_rol_sin_traspaso",
      );
      expect(
        await intentar(e.empresa, otraEmpresa.gerente, ASIGNAR, [e.empresa, e.operador, rol]),
      ).toBe("23514:membresia_rol_sin_traspaso");
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
    });

    it("una persona APAGADA se reasigna sin reactivarse (sale del callejón del rol archivado) y no a un rol archivado", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      const archivado = await crearRol(e.empresa, false);
      expect(await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.otro, rol])).toBeNull();
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, e.otro],
      );
      // Apagada y con rol propio: el gerente la pasa a un rol base y sigue apagada.
      expect(
        await intentar(e.empresa, e.gerente, DESASIGNAR, [e.empresa, e.otro, "OPERADOR"]),
      ).toBeNull();
      expect(
        (
          await dueno.query(
            "select rol, rol_propio_id, activo from membresia where empresa_id = $1 and persona_id = $2",
            [e.empresa, e.otro],
          )
        ).rows[0],
      ).toEqual({ rol: "OPERADOR", rol_propio_id: null, activo: false });
      // A un rol archivado, tampoco estando apagada.
      expect(await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.otro, archivado])).toBe(
        "23514:membresia_rol_sin_traspaso",
      );
    });

    it("reactivar una persona apagada por UPDATE directo sigue rechazado (solo lo hace el flujo de invitación), sea gerente, administrador u operador", async () => {
      const e = await equipo();
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, e.otro],
      );
      for (const quien of [e.gerente, e.administrador, e.operador]) {
        const r = await intentar(
          e.empresa,
          quien,
          "update membresia set activo = true where empresa_id = $1 and persona_id = $2",
          [e.empresa, e.otro],
        );
        expect(r, "no se reactiva").toBe("42501:");
      }
      expect(
        (
          await dueno.query(
            "select activo from membresia where empresa_id = $1 and persona_id = $2",
            [e.empresa, e.otro],
          )
        ).rows[0],
      ).toEqual({ activo: false });
    });

    it("el flujo real de invitación SÍ reactiva a un apagado (token aceptado por esa persona, mismo rol); con token de OTRA persona, o pendiente, no", async () => {
      const e = await equipo();
      const apagado = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, apagado.id, "OPERADOR", false);
      const ajena = await crearPersonaDeBase(dueno);
      const tenant = (
        await dueno.query<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
          e.empresa,
        ])
      ).rows[0]?.tenant_id as string;
      const invitar = async (persona: { id: string; email: string }, aceptar: boolean) => {
        const inv = await crearInvitacionDeBase(dueno, { tenant, email: persona.email });
        await incluirEmpresa(dueno, inv, e.empresa, "OPERADOR");
        if (aceptar) await aceptarDeBase(dueno, inv, persona.id);
        return inv;
      };
      const reactivar = async (tokenHash: string) => {
        const s = await SesionDePrueba.abrir(
          base as BaseDePruebas,
          "pedernal_app",
          comoInvitacion(tokenHash),
        );
        try {
          const r = await s.intentar(
            "update membresia set activo = true where empresa_id = $1 and persona_id = $2",
            [e.empresa, apagado.id],
          );
          if (r.ok && r.filas === 1) await s.confirmar();
          return r.ok ? r.filas : `${r.codigo}:${r.restriccion ?? ""}`;
        } finally {
          await s.cerrar();
        }
      };
      const activo = async () =>
        (
          await dueno.query<{ activo: boolean }>(
            "select activo from membresia where empresa_id = $1 and persona_id = $2",
            [e.empresa, apagado.id],
          )
        ).rows[0]?.activo;

      // (f) la invitación de OTRA persona (aceptada) y la propia todavía pendiente: no reactivan.
      const deLaAjena = await invitar(ajena, true);
      expect(await reactivar(deLaAjena.tokenHash)).toBe(0);
      const pendiente = await invitar(apagado, false);
      expect(await reactivar(pendiente.tokenHash)).toBe(0);
      expect(await activo()).toBe(false);
      // (e) la propia, aceptada: reactiva (y la guarda del disparador la deja pasar).
      await aceptarDeBase(dueno, pendiente, apagado.id);
      expect(await reactivar(pendiente.tokenHash)).toBe(1);
      expect(await activo()).toBe(true);
    });

    it("un administrador (u operador) no reasigna a una persona apagada", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, e.otro],
      );
      for (const quien of [e.administrador, e.operador]) {
        expect(await intentar(e.empresa, quien, ASIGNAR, [e.empresa, e.otro, rol])).toBe(
          "23514:membresia_rol_sin_traspaso",
        );
      }
    });

    it("el gerente NO puede cambiar `activo` junto con el rol (ni encender ni apagar por esta vía)", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      expect(
        await intentar(
          e.empresa,
          e.gerente,
          "update membresia set rol = 'PROPIO', rol_propio_id = $3, activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa, e.operador, rol],
        ),
      ).toBe("23514:membresia_rol_sin_traspaso");
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, e.otro],
      );
      expect(
        await intentar(
          e.empresa,
          e.gerente,
          "update membresia set rol = 'PROPIO', rol_propio_id = $3, activo = true where empresa_id = $1 and persona_id = $2",
          [e.empresa, e.otro, rol],
        ),
      ).toBe("42501:");
    });
  });

  describe("a quién y a qué rol", () => {
    it("nunca se toca al gerente: ni como persona asignada ni como rol de destino", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      // La fila del gerente no pasa la política: no se ve para actualizar.
      expect(await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.gerente, rol])).toBe(
        "0 filas",
      );
      // Subir a alguien a gerente por esta vía: la política lo rechaza.
      const subir = await intentar(
        e.empresa,
        e.gerente,
        "update membresia set rol = 'GERENTE', rol_propio_id = null where empresa_id = $1 and persona_id = $2",
        [e.empresa, e.operador],
      );
      expect(subir).not.toBeNull();
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
      expect(await estado(e.empresa, e.gerente)).toEqual({ rol: "GERENTE", rol_propio_id: null });
    });

    it("un rol archivado no se asigna", async () => {
      const e = await equipo();
      const archivado = await crearRol(e.empresa, false);
      expect(
        await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.operador, archivado]),
      ).toBe("23514:membresia_rol_sin_traspaso");
    });

    it("el rol propio de OTRA empresa no se asigna (clave foránea compuesta)", async () => {
      const e = await equipo();
      const ajeno = await crearRol((await equipo()).empresa);
      const r = await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.operador, ajeno]);
      expect(r).toMatch(/^(23503|23514):/);
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
    });

    it("un rol que no existe no se asigna", async () => {
      const e = await equipo();
      const r = await intentar(e.empresa, e.gerente, ASIGNAR, [
        e.empresa,
        e.operador,
        randomUUID(),
      ]);
      expect(r).toMatch(/^(23503|23514):/);
    });

    it("el gerente de otra empresa no ve la fila: 0 filas, aunque conozca los ids", async () => {
      const e = await equipo();
      const otra = await equipo();
      const rol = await crearRol(e.empresa);
      expect(
        await intentar(otra.empresa, otra.gerente, ASIGNAR, [e.empresa, e.operador, rol]),
      ).toBe("0 filas");
    });
  });

  describe("archivar un rol propio", () => {
    const ARCHIVAR = "update rol_de_empresa set activo = false where id = $1";

    it("con personas activas se rechaza (23514 rol_de_empresa_con_personas) y, reasignadas, se archiva", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      expect(
        await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.operador, rol]),
      ).toBeNull();
      expect(await intentar(e.empresa, e.gerente, ARCHIVAR, [rol])).toBe(
        "23514:rol_de_empresa_con_personas",
      );
      expect(
        await intentar(e.empresa, e.gerente, DESASIGNAR, [e.empresa, e.operador, "OPERADOR"]),
      ).toBeNull();
      expect(await intentar(e.empresa, e.gerente, ARCHIVAR, [rol])).toBeNull();
    });

    it("una persona APAGADA con ese rol no impide archivarlo", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      expect(await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.otro, rol])).toBeNull();
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, e.otro],
      );
      expect(await intentar(e.empresa, e.gerente, ARCHIVAR, [rol])).toBeNull();
    });
  });

  describe("carreras (dos transacciones a la vez)", () => {
    const ARCHIVAR = "update rol_de_empresa set activo = false where id = $1";

    it("asignar primero, archivar después (sin confirmar la asignación): el archivado espera y, al seguir, se rechaza", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      const a = await comoApp(e.empresa, e.gerente);
      const b = await comoApp(e.empresa, e.gerente);
      try {
        expect((await a.directo(ASIGNAR, [e.empresa, e.operador, rol])).ok).toBe(true);
        const archivar = b.directo(ARCHIVAR, [rol]);
        expect(await esperarBloqueo(dueno, b.pid)).toBe(true);
        await a.confirmar();
        expect(await archivar).toMatchObject({
          ok: false,
          codigo: "23514",
          restriccion: "rol_de_empresa_con_personas",
        });
      } finally {
        await a.cerrar();
        await b.cerrar();
      }
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "PROPIO", rol_propio_id: rol });
      const { rows } = await dueno.query("select activo from rol_de_empresa where id = $1", [rol]);
      expect(rows[0]).toEqual({ activo: true });
    });

    it("archivar primero, asignar después (sin confirmar el archivado): la asignación espera y, al seguir, se rechaza", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      const a = await comoApp(e.empresa, e.gerente);
      const b = await comoApp(e.empresa, e.gerente);
      try {
        expect((await a.directo(ARCHIVAR, [rol])).ok).toBe(true);
        const asignar = b.directo(ASIGNAR, [e.empresa, e.operador, rol]);
        expect(await esperarBloqueo(dueno, b.pid)).toBe(true);
        await a.confirmar();
        expect(await asignar).toMatchObject({
          ok: false,
          codigo: "23514",
          restriccion: "membresia_rol_sin_traspaso",
        });
      } finally {
        await a.cerrar();
        await b.cerrar();
      }
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
    });

    it("dos asignaciones de la misma persona a la vez: se serializan y queda el último, siempre consistente", async () => {
      const e = await equipo();
      const x = await crearRol(e.empresa);
      const y = await crearRol(e.empresa);
      const a = await comoApp(e.empresa, e.gerente);
      const b = await comoApp(e.empresa, e.gerente);
      try {
        expect((await a.directo(ASIGNAR, [e.empresa, e.operador, x])).ok).toBe(true);
        const segunda = b.directo(ASIGNAR, [e.empresa, e.operador, y]);
        expect(await esperarBloqueo(dueno, b.pid)).toBe(true);
        await a.confirmar();
        expect((await segunda).ok).toBe(true);
        await b.confirmar();
      } finally {
        await a.cerrar();
        await b.cerrar();
      }
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "PROPIO", rol_propio_id: y });
    });
  });

  describe("pisos de las acciones nuevas y de la versión de un rol", () => {
    it("las cinco acciones nuevas son SOLO_GERENTE", async () => {
      const { rows } = await dueno.query<{ accion: string; tipo: string }>(
        "select accion, tipo from piso_de_plataforma where accion = any($1::text[]) order by accion",
        [["roles.archivar", "roles.crear", "roles.editar", "roles.ver", "usuarios.asignar_rol"]],
      );
      expect(rows.map((r) => r.tipo)).toEqual(Array(5).fill("SOLO_GERENTE"));
      expect(rows).toHaveLength(5);
    });

    it("la base rechaza una versión de rol propio con una de ellas (el gerente no puede delegarlas)", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      for (const accion of ["roles.ver", "usuarios.asignar_rol"]) {
        await expect(
          dueno.query(
            "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, 2, $3::text[], $4, now())",
            [e.empresa, rol, [...PISO, accion], (await crearPersonaDeBase(dueno)).id],
          ),
        ).rejects.toMatchObject({ code: "23514", constraint: "version_de_rol_pisos" });
      }
    });
  });

  describe("traspaso de gerencia con un entrante que tiene un rol propio", () => {
    it("al aceptar, el entrante queda GERENTE con rol_propio_id nulo y el saliente pasa a ADMINISTRADOR", async () => {
      const e = await equipo();
      const rol = await crearRol(e.empresa);
      expect(
        await intentar(e.empresa, e.gerente, ASIGNAR, [e.empresa, e.operador, rol]),
      ).toBeNull();
      const propuesto = new Date(AHORA_DE_PRUEBA.getTime() - 3_600_000);
      const vence = new Date(AHORA_DE_PRUEBA.getTime() + 6 * 86_400_000);
      const { rows } = await dueno.query<{ id: string }>(
        `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id, entrante_persona_id, propuesto_en, vence_en)
         values ($1, 'GERENTE', $2, $2, $3, $4, $5) returning id`,
        [e.empresa, e.gerente, e.operador, propuesto, vence],
      );
      const s = await comoApp(e.empresa, e.operador);
      try {
        const pasos = [
          await s.directo(
            "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1",
            [rows[0]?.id, AHORA_DE_PRUEBA],
          ),
          await s.directo(
            "update membresia set rol = 'ADMINISTRADOR' where empresa_id = $1 and persona_id = $2",
            [e.empresa, e.gerente],
          ),
          await s.directo(
            "update membresia set rol = 'GERENTE' where empresa_id = $1 and persona_id = $2",
            [e.empresa, e.operador],
          ),
        ];
        expect(pasos.map((p) => p.ok)).toEqual([true, true, true]);
        expect((await s.confirmar()).ok).toBe(true);
      } finally {
        await s.cerrar();
      }
      expect(await estado(e.empresa, e.operador)).toEqual({ rol: "GERENTE", rol_propio_id: null });
      expect(await estado(e.empresa, e.gerente)).toEqual({
        rol: "ADMINISTRADOR",
        rol_propio_id: null,
      });
    });
  });

  describe("privilegios por columna", () => {
    it("el rol de la aplicación solo actualiza rol, rol_propio_id y activo de una membresía (42501 en el resto)", async () => {
      const e = await equipo();
      for (const sql of [
        "update membresia set persona_id = persona_id where empresa_id = $1 and persona_id = $2",
        "update membresia set empresa_id = empresa_id where empresa_id = $1 and persona_id = $2",
        "update membresia set invitacion_id = null where empresa_id = $1 and persona_id = $2",
        "update membresia set creado_en = now() where empresa_id = $1 and persona_id = $2",
      ]) {
        const r = await intentar(e.empresa, e.gerente, sql, [e.empresa, e.operador]);
        expect([sql, r?.split(":")[0]]).toEqual([sql, "42501"]);
      }
    });
  });

  describe("reversión", () => {
    const REVERSION = join(
      import.meta.dirname,
      "../../migraciones/reversiones/0097_revertir_roles_propios_de_la_empresa.sql",
    );

    it("FRENA (55000) con una membresía PROPIO y no cambia nada; sin ellas vuelve la base a como estaba antes de 0097", async () => {
      const aparte = await crearBaseAparte(base as BaseDePruebas);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      const entornoAparte = crearEntornoDePrueba(aparte.base, 2);
      try {
        await cliente.connect();
        const e = await crearEmpresaActiva(entornoAparte);
        const p = await crearPersonaDeBase(cliente);
        await crearMembresiaDeBase(cliente, e.empresa, p.id, "OPERADOR", true);
        const rol = randomUUID();
        const autor = (await crearPersonaDeBase(cliente)).id;
        await cliente.query(
          "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'R', 'r')",
          [rol, e.empresa],
        );
        await cliente.query(
          "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, 1, $3::text[], $4, now())",
          [e.empresa, rol, PISO, autor],
        );
        // Ni el dueño de la base cambia un rol sin pasar por el disparador: para armar la escena se lo apaga un instante.
        await cliente.query("alter table membresia disable trigger membresia_cambio");
        await cliente.query(
          "update membresia set rol = 'PROPIO', rol_propio_id = $2 where empresa_id = $1 and persona_id = $3",
          [e.empresa, rol, p.id],
        );
        await cliente.query("alter table membresia enable trigger membresia_cambio");
        const texto = await readFile(REVERSION, "utf8");
        await cliente.query("begin");
        await expect(cliente.query(texto)).rejects.toMatchObject({ code: "55000" });
        await cliente.query("rollback");
        expect(
          (
            await cliente.query(
              "select count(*)::int as n from membresia where rol_propio_id is not null",
            )
          ).rows[0],
        ).toEqual({ n: 1 });

        // Sin personas con rol propio: se revierte (el rol propio y su historial NO se borran: son de 0094).
        await cliente.query("alter table membresia disable trigger membresia_cambio");
        await cliente.query(
          "update membresia set rol = 'OPERADOR', rol_propio_id = null where empresa_id = $1 and persona_id = $2",
          [e.empresa, p.id],
        );
        await cliente.query("alter table membresia enable trigger membresia_cambio");
        await cliente.query("begin");
        await cliente.query(texto);
        await cliente.query("commit");
        const columnas = await cliente.query(
          "select 1 from information_schema.columns where table_name = 'membresia' and column_name = 'rol_propio_id'",
        );
        expect(columnas.rows).toHaveLength(0);
        expect(
          (
            await cliente.query("select count(*)::int as n from rol_de_empresa where id = $1", [
              rol,
            ])
          ).rows[0],
        ).toEqual({ n: 1 });
        expect(
          (
            await cliente.query(
              "select count(*)::int as n from piso_de_plataforma where autor = 'migracion:0097'",
            )
          ).rows[0],
        ).toEqual({ n: 0 });
        // El CHECK de rol volvió a los tres roles base y el disparador a la regla de 0005.
        await expect(
          cliente.query(
            "update membresia set rol = 'PROPIO' where empresa_id = $1 and persona_id = $2",
            [e.empresa, p.id],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await cliente.end();
        await entornoAparte.cerrar();
        await aparte.destruir();
      }
    });
  });
});
