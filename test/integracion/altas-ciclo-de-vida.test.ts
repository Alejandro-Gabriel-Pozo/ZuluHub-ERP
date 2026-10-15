import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { crearCasosDeUsoDeIdentidad } from "../../src/modulos/identidad/publico";
import type { CasosDeUsoDeAltas } from "../../src/plataforma/casos-de-uso/altas";
import { personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { Tokens } from "../../src/puertos/tokens";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import {
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeAlta,
  crearEntornoDeAlta,
  crearMarcaLista,
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
 * Suspender y reactivar un tenant y una empresa desde plataforma (H5 P5, §B.5.2) contra Postgres real:
 * el cambio y su constancia con el antes y el después, que la suspensión corta la operación de la
 * empresa en el acto, lo que no se puede (incluida la activación de un alta desde «reactivar»),
 * la idempotencia, la autorización, la atomicidad y las carreras. Base propia.
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

describe.skipIf(base === null)("suspender y reactivar tenants y empresas", () => {
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

  /** Un tenant con una empresa ACTIVA (de la marca principal de pruebas). */
  const unMundo = () => crearMundoDeMarca(dueno);
  const estadoDelTenant = async (id: string) =>
    una<{ estado: string; motivo_estado: string | null }>(
      "select estado, motivo_estado from tenant where id = $1",
      [id],
    );
  const estadoDeLaEmpresa = async (id: string) =>
    una<{ estado: string; motivo_estado: string | null }>(
      "select estado, motivo_estado from empresa where id = $1",
      [id],
    );
  const constanciasDe = (accion: string, entidadId: string) =>
    todas<{ actor: string; antes: Record<string, unknown>; despues: Record<string, unknown> }>(
      "select actor, antes, despues from auditoria_plataforma where accion = $1 and entidad_id = $2 order by id",
      [accion, entidadId],
    );

  const suspenderTenant = (
    tenantId: string,
    motivo = "mora de tres meses",
    clave = claveAlAzar(),
  ) => casos.suspenderTenant(comoAdminAhora(), { claveDeIdempotencia: clave, tenantId, motivo });
  const reactivarTenant = (tenantId: string, clave = claveAlAzar()) =>
    casos.reactivarTenant(comoAdminAhora(), { claveDeIdempotencia: clave, tenantId });
  const suspenderEmpresa = (empresaId: string, motivo = "pidió pausar", clave = claveAlAzar()) =>
    casos.suspenderEmpresa(comoAdminAhora(), { claveDeIdempotencia: clave, empresaId, motivo });
  const reactivarEmpresa = (empresaId: string, clave = claveAlAzar()) =>
    casos.reactivarEmpresa(comoAdminAhora(), { claveDeIdempotencia: clave, empresaId });

  describe("tenant", () => {
    it("suspende con motivo y reactiva, y cada cambio deja su constancia con el antes y el después", async () => {
      const m = await unMundo();
      const s = exito(await suspenderTenant(m.tenant, "  mora de tres meses "));
      expect(s).toEqual({ tenantId: m.tenant, estado: "SUSPENDED", repetida: false });
      expect(await estadoDelTenant(m.tenant)).toEqual({
        estado: "SUSPENDED",
        motivo_estado: "mora de tres meses",
      });
      const r = exito(await reactivarTenant(m.tenant));
      expect(r).toEqual({ tenantId: m.tenant, estado: "ACTIVE", repetida: false });
      expect(await estadoDelTenant(m.tenant)).toEqual({ estado: "ACTIVE", motivo_estado: null });

      expect(await constanciasDe("TENANT_SUSPENDIDO", m.tenant)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { estado: "ACTIVE", motivo: null },
          despues: { estado: "SUSPENDED", motivo: "mora de tres meses" },
        },
      ]);
      expect(await constanciasDe("TENANT_REACTIVADO", m.tenant)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { estado: "SUSPENDED", motivo: "mora de tres meses" },
          despues: { estado: "ACTIVE", motivo: null },
        },
      ]);
    });

    it("la suspensión corta a sus empresas en el acto (la operación siguiente ya no opera) y reactivar las devuelve", async () => {
      const m = await unMundo();
      const gerente = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, m.empresa, gerente.id, "GERENTE");
      const sucursal = await sucursalDe(dueno, m.empresa);
      const identidad = crearCasosDeUsoDeIdentidad({
        transacciones: entornoGeneral,
        tokens,
        reglas: REGLAS_DE_EMPRESA,
      });
      const invitar = () =>
        identidad.invitarUsuario(comoEmpresa(m.empresa as never, personaId(gerente.id)), {
          email: emailAlAzar("nuevo"),
          rol: "OPERADOR",
          sucursales: [sucursalId(sucursal)],
        });
      exito(await invitar());
      exito(await suspenderTenant(m.tenant));
      expect(falla(await invitar())).toMatchObject({
        codigo: "EMPRESA_NO_OPERA",
        motivo: "TENANT_SUSPENDIDO",
      });
      exito(await reactivarTenant(m.tenant));
      exito(await invitar());
    });

    it("suspender uno ya suspendido (con otra clave) es TENANT_YA_SUSPENDIDO; reactivar uno activo, TENANT_NO_SUSPENDIDO", async () => {
      const m = await unMundo();
      expect(falla(await reactivarTenant(m.tenant))).toBe("TENANT_NO_SUSPENDIDO");
      exito(await suspenderTenant(m.tenant));
      expect(falla(await suspenderTenant(m.tenant))).toBe("TENANT_YA_SUSPENDIDO");
      expect(await constanciasDe("TENANT_SUSPENDIDO", m.tenant)).toHaveLength(1);
    });

    it("sin motivo es MOTIVO_OBLIGATORIO; un tenant que no existe, TENANT_NO_ENCONTRADO; un id malo, ID_INVALIDO", async () => {
      const m = await unMundo();
      for (const motivo of ["", "   ", "\n"]) {
        expect(falla(await suspenderTenant(m.tenant, motivo))).toBe("MOTIVO_OBLIGATORIO");
      }
      expect(falla(await suspenderTenant("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "TENANT_NO_ENCONTRADO",
      );
      expect(falla(await reactivarTenant("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "TENANT_NO_ENCONTRADO",
      );
      expect(falla(await suspenderTenant("x"))).toBe("ID_INVALIDO");
      expect((await estadoDelTenant(m.tenant)).estado).toBe("ACTIVE");
    });

    it("la misma clave devuelve lo mismo (repetida) sin cambiar ni auditar de nuevo; con otro motivo es CLAVE_REUTILIZADA", async () => {
      const m = await unMundo();
      const clave = claveAlAzar();
      const primera = exito(await suspenderTenant(m.tenant, "mora", clave));
      const segunda = exito(await suspenderTenant(m.tenant, "mora", clave));
      expect(segunda).toEqual({ ...primera, repetida: true });
      expect(await constanciasDe("TENANT_SUSPENDIDO", m.tenant)).toHaveLength(1);
      expect(falla(await suspenderTenant(m.tenant, "otro motivo", clave))).toBe(
        "CLAVE_REUTILIZADA",
      );
      // Reactivar con la clave de suspender (otra operación) tampoco.
      expect(falla(await reactivarTenant(m.tenant, clave))).toBe("CLAVE_REUTILIZADA");
      expect((await estadoDelTenant(m.tenant)).estado).toBe("SUSPENDED");
    });
  });

  describe("empresa", () => {
    it("suspende con motivo y reactiva, con su constancia (antes y después)", async () => {
      const m = await unMundo();
      const s = exito(await suspenderEmpresa(m.empresa, " pidió pausar "));
      expect(s).toEqual({ empresaId: m.empresa, estado: "SUSPENDED", repetida: false });
      expect(await estadoDeLaEmpresa(m.empresa)).toEqual({
        estado: "SUSPENDED",
        motivo_estado: "pidió pausar",
      });
      const r = exito(await reactivarEmpresa(m.empresa));
      expect(r).toEqual({ empresaId: m.empresa, estado: "ACTIVE", repetida: false });
      expect(await estadoDeLaEmpresa(m.empresa)).toEqual({ estado: "ACTIVE", motivo_estado: null });
      expect(await constanciasDe("EMPRESA_SUSPENDIDA", m.empresa)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { estado: "ACTIVE", motivo: null, tenantId: m.tenant },
          despues: { estado: "SUSPENDED", motivo: "pidió pausar", tenantId: m.tenant },
        },
      ]);
      expect(await constanciasDe("EMPRESA_REACTIVADA", m.empresa)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { estado: "SUSPENDED", motivo: "pidió pausar", tenantId: m.tenant },
          despues: { estado: "ACTIVE", motivo: null, tenantId: m.tenant },
        },
      ]);
    });

    it("«reactivar» un alta en curso NO la activa: queda en PROVISIONING (solo la acepta el gerente)", async () => {
      const marca = await crearMarcaLista(dueno);
      const enAlta = await crearMundoDeMarca(dueno, { marca: marca.marca, estado: "PROVISIONING" });
      expect(falla(await reactivarEmpresa(enAlta.empresa))).toBe("TRANSICION_NO_PERMITIDA");
      expect((await estadoDeLaEmpresa(enAlta.empresa)).estado).toBe("PROVISIONING");
      expect(await constanciasDe("EMPRESA_REACTIVADA", enAlta.empresa)).toEqual([]);
    });

    it("las transiciones que no existen son TRANSICION_NO_PERMITIDA: suspender un alta o una cancelada, reactivar una activa", async () => {
      const marca = await crearMarcaLista(dueno);
      const enAlta = await crearMundoDeMarca(dueno, { marca: marca.marca, estado: "PROVISIONING" });
      const cancelada = await crearMundoDeMarca(dueno, {
        marca: marca.marca,
        estado: "PROVISIONING",
      });
      await dueno.query(
        "update empresa set estado = 'CANCELLED', motivo_estado = 'antes' where id = $1",
        [cancelada.empresa],
      );
      const activa = await unMundo();
      expect(falla(await suspenderEmpresa(enAlta.empresa))).toBe("TRANSICION_NO_PERMITIDA");
      expect(falla(await suspenderEmpresa(cancelada.empresa))).toBe("TRANSICION_NO_PERMITIDA");
      expect(falla(await reactivarEmpresa(cancelada.empresa))).toBe("TRANSICION_NO_PERMITIDA");
      expect(falla(await reactivarEmpresa(activa.empresa))).toBe("TRANSICION_NO_PERMITIDA");
      exito(await suspenderEmpresa(activa.empresa));
      expect(falla(await suspenderEmpresa(activa.empresa))).toBe("TRANSICION_NO_PERMITIDA");
    });

    it("sin motivo es MOTIVO_OBLIGATORIO; una empresa que no existe, EMPRESA_NO_ENCONTRADA; un id malo, ID_INVALIDO", async () => {
      const m = await unMundo();
      for (const motivo of ["", "  "]) {
        expect(falla(await suspenderEmpresa(m.empresa, motivo))).toBe("MOTIVO_OBLIGATORIO");
      }
      expect(falla(await suspenderEmpresa("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "EMPRESA_NO_ENCONTRADA",
      );
      expect(falla(await reactivarEmpresa("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "EMPRESA_NO_ENCONTRADA",
      );
      expect(falla(await reactivarEmpresa("x"))).toBe("ID_INVALIDO");
      expect((await estadoDeLaEmpresa(m.empresa)).estado).toBe("ACTIVE");
    });

    it("la misma clave devuelve lo mismo (repetida); con otra empresa o motivo es CLAVE_REUTILIZADA", async () => {
      const a = await unMundo();
      const b = await unMundo();
      const clave = claveAlAzar();
      const primera = exito(await suspenderEmpresa(a.empresa, "mora", clave));
      expect(exito(await suspenderEmpresa(a.empresa, "mora", clave))).toEqual({
        ...primera,
        repetida: true,
      });
      expect(await constanciasDe("EMPRESA_SUSPENDIDA", a.empresa)).toHaveLength(1);
      expect(falla(await suspenderEmpresa(b.empresa, "mora", clave))).toBe("CLAVE_REUTILIZADA");
      expect(falla(await suspenderEmpresa(a.empresa, "otro", clave))).toBe("CLAVE_REUTILIZADA");
      expect((await estadoDeLaEmpresa(b.empresa)).estado).toBe("ACTIVE");
    });
  });

  describe("quién puede", () => {
    it("SOPORTE y el sistema: SIN_PERMISO en las cuatro, y no cambia nada", async () => {
      const m = await unMundo();
      const sistema = { ...comoAdminAhora(), actor: { tipo: "SISTEMA", proceso: "x" } } as const;
      for (const contexto of [comoSoporteAhora(), sistema]) {
        const clave = () => claveAlAzar();
        expect(
          falla(
            await casos.suspenderTenant(contexto, {
              claveDeIdempotencia: clave(),
              tenantId: m.tenant,
              motivo: "x",
            }),
          ),
        ).toBe("SIN_PERMISO");
        expect(
          falla(
            await casos.reactivarTenant(contexto, {
              claveDeIdempotencia: clave(),
              tenantId: m.tenant,
            }),
          ),
        ).toBe("SIN_PERMISO");
        expect(
          falla(
            await casos.suspenderEmpresa(contexto, {
              claveDeIdempotencia: clave(),
              empresaId: m.empresa,
              motivo: "x",
            }),
          ),
        ).toBe("SIN_PERMISO");
        expect(
          falla(
            await casos.reactivarEmpresa(contexto, {
              claveDeIdempotencia: clave(),
              empresaId: m.empresa,
            }),
          ),
        ).toBe("SIN_PERMISO");
      }
      expect((await estadoDelTenant(m.tenant)).estado).toBe("ACTIVE");
      expect((await estadoDeLaEmpresa(m.empresa)).estado).toBe("ACTIVE");
    });
  });

  describe("todo o nada", () => {
    it("si falla la constancia, ni el tenant ni la empresa cambian de estado ni queda la clave", async () => {
      const m = await unMundo();
      const roto = crearEntornoDeAlta(propia.base, 3, (tx) => ({
        ...tx,
        auditoriaDePlataforma: {
          registrar: async (...a) => {
            await tx.auditoriaDePlataforma.registrar(...a);
            throw new Error("falla inyectada");
          },
        },
      }));
      const claves = await cuenta("select count(*)::int as n from idempotencia_plataforma");
      try {
        const c = crearCasosDeAlta(roto);
        await expect(
          c.suspenderTenant(comoAdminAhora(), {
            claveDeIdempotencia: claveAlAzar(),
            tenantId: m.tenant,
            motivo: "x",
          }),
        ).rejects.toThrow("falla inyectada");
        await expect(
          c.suspenderEmpresa(comoAdminAhora(), {
            claveDeIdempotencia: claveAlAzar(),
            empresaId: m.empresa,
            motivo: "x",
          }),
        ).rejects.toThrow("falla inyectada");
      } finally {
        await roto.cerrar();
      }
      expect((await estadoDelTenant(m.tenant)).estado).toBe("ACTIVE");
      expect((await estadoDeLaEmpresa(m.empresa)).estado).toBe("ACTIVE");
      expect(await cuenta("select count(*)::int as n from idempotencia_plataforma")).toBe(claves);
    });
  });

  describe("carreras", () => {
    const VUELTAS = 8;

    function conBarrera(participantes: number) {
      const cita = crearBarrera(participantes);
      const e = crearEntornoDeAlta(propia.base, participantes + 2, (tx) => ({
        ...tx,
        tenants: {
          ...tx.tenants,
          obtener: async (...a) => {
            const r = await tx.tenants.obtener(...a);
            await cita();
            return r;
          },
        },
        empresas: {
          ...tx.empresas,
          obtener: async (...a) => {
            const r = await tx.empresas.obtener(...a);
            await cita();
            return r;
          },
        },
      }));
      return { entorno: e, casos: crearCasosDeAlta(e, tokens) };
    }

    it("dos suspensiones del mismo tenant a la vez (claves distintas): una gana y la otra es TENANT_YA_SUSPENDIDO", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno: e, casos: c } = conBarrera(2);
        try {
          const m = await unMundo();
          const rs = await Promise.all(
            [1, 2].map(() =>
              c.suspenderTenant(comoAdminAhora(), {
                claveDeIdempotencia: claveAlAzar(),
                tenantId: m.tenant,
                motivo: "mora",
              }),
            ),
          );
          expect(
            rs.filter((r) => r.ok),
            `vuelta ${vuelta}`,
          ).toHaveLength(1);
          expect(rs.flatMap((r) => (r.ok ? [] : [r.error]))).toEqual(["TENANT_YA_SUSPENDIDO"]);
          expect(await constanciasDe("TENANT_SUSPENDIDO", m.tenant)).toHaveLength(1);
        } finally {
          await e.cerrar();
        }
      }
    });

    it("suspender contra reactivar un tenant suspendido: el resultado es el de algún orden serial y las constancias lo cuentan", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno: e, casos: c } = conBarrera(2);
        try {
          const m = await unMundo();
          await dueno.query(
            "update tenant set estado = 'SUSPENDED', motivo_estado = 'antes' where id = $1",
            [m.tenant],
          );
          const [suspende, reactiva] = await Promise.all([
            c.suspenderTenant(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              tenantId: m.tenant,
              motivo: "otra vez",
            }),
            c.reactivarTenant(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              tenantId: m.tenant,
            }),
          ]);
          const final = (await estadoDelTenant(m.tenant)).estado;
          // Orden serial A: reactivar y luego suspender → los dos entran y queda SUSPENDED.
          // Orden serial B: suspender primero (ya estaba suspendido: error) y luego reactivar → ACTIVE.
          if (suspende.ok) {
            expect(reactiva.ok, `vuelta ${vuelta}`).toBe(true);
            expect(final).toBe("SUSPENDED");
          } else {
            expect(falla(suspende)).toBe("TENANT_YA_SUSPENDIDO");
            expect(reactiva.ok).toBe(true);
            expect(final).toBe("ACTIVE");
          }
          expect(await constanciasDe("TENANT_REACTIVADO", m.tenant)).toHaveLength(1);
          expect(await constanciasDe("TENANT_SUSPENDIDO", m.tenant)).toHaveLength(
            suspende.ok ? 1 : 0,
          );
        } finally {
          await e.cerrar();
        }
      }
    });

    it("dos suspensiones de la misma empresa a la vez: una gana; y la misma clave a la vez cambia una sola vez", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno: e, casos: c } = conBarrera(2);
        try {
          const m = await unMundo();
          const rs = await Promise.all(
            [1, 2].map(() =>
              c.suspenderEmpresa(comoAdminAhora(), {
                claveDeIdempotencia: claveAlAzar(),
                empresaId: m.empresa,
                motivo: "mora",
              }),
            ),
          );
          expect(
            rs.filter((r) => r.ok),
            `vuelta ${vuelta}`,
          ).toHaveLength(1);
          expect(rs.flatMap((r) => (r.ok ? [] : [r.error]))).toEqual(["TRANSICION_NO_PERMITIDA"]);
          expect(await constanciasDe("EMPRESA_SUSPENDIDA", m.empresa)).toHaveLength(1);
        } finally {
          await e.cerrar();
        }
      }
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno: e, casos: c } = conBarrera(3);
        try {
          const m = await unMundo();
          const clave = claveAlAzar();
          const rs = await Promise.all(
            [1, 2, 3].map(() =>
              c.suspenderEmpresa(comoAdminAhora(), {
                claveDeIdempotencia: clave,
                empresaId: m.empresa,
                motivo: "mora",
              }),
            ),
          );
          expect(
            rs.every((r) => r.ok),
            `vuelta ${vuelta}: ${JSON.stringify(rs)}`,
          ).toBe(true);
          expect(rs.flatMap((r) => (r.ok && !r.valor.repetida ? [1] : []))).toHaveLength(1);
          expect(await constanciasDe("EMPRESA_SUSPENDIDA", m.empresa)).toHaveLength(1);
        } finally {
          await e.cerrar();
        }
      }
    });
  });
});
