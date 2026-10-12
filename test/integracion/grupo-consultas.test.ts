import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  crearAuditoriaDeAccesoDeGrupoDePostgres,
  type AuditoriaDeAccesoDeGrupoDb,
} from "../../src/adaptadores/postgres/auditoria-de-acceso-de-grupo";
import {
  crearAutorizacionDeGrupoDePostgres,
  type AutorizacionDeGrupoDb,
} from "../../src/adaptadores/postgres/autorizacion-de-grupo";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_GRUPO, ROLES_DE_GRUPO } from "../../src/capacidades/permisos/grupo";
import type { ContextoDeGrupo } from "../../src/contexto/contexto";
import type { EstadoDeEmpresa } from "../../src/contexto/estados";
import {
  crearConsultasDeGrupo,
  type ConsultasDeGrupo,
  type TxDeConsultasDeGrupo,
  type VistaDeGrupo,
} from "../../src/consultas-de-grupo/publico";
import { crearRepositorioDeEmpresas, type EmpresasDb } from "../../src/modulos/empresas/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
  type TenantId,
} from "../../src/primitivas/identificadores/marca";
import type { OpcionesDeTransaccion, Transacciones } from "../../src/puertos/transacciones";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoPlataforma,
  crearBarrera,
  crearBaseAparte,
  crearEntornoDePrueba,
  crearPropietario,
  cuitAlAzar,
  nombreAlAzar,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";

/**
 * H6, tramo T6: la consulta de grupo `listarEmpresasDelGrupo` contra una base real, con el rol de base
 * de grupo y el contexto firmado (nunca el dueño de la base, salvo para armar el escenario y para
 * mirar). Cubre el aislamiento entre tenants (dos tenants), la autorización (solo el propietario
 * activo), el tenant suspendido, que la consulta no escriba nada más que su registro de acceso y que
 * ese registro quede una sola vez por consulta (también si la transacción se repite, y nunca sin
 * entregar datos si falla). Base propia de este archivo, para poder comparar el estado entero de la
 * base antes y después.
 */

const base = inject("baseDePruebas");

type Fila = Record<string, unknown>;

/** Lo que el trabajo de prueba recibe: lo de la consulta más la conexión cruda para verificar. */
type TxDeGrupoDePrueba = TxDeConsultasDeGrupo & Readonly<{ db: Kysely<SinTablas> }>;

/** Ganchos para inyectar fallas, esperas y espionaje entre los pasos de la consulta. */
type Ganchos = {
  llamadas: string[];
  intentos: number;
  despuesDeLeerElTenant?: () => Promise<void>;
  despuesDeRegistrar?: (intento: number) => Promise<void>;
  alRegistrar?: () => Promise<void>;
};

const errorDeBase = (codigo: string, mensaje: string): pg.DatabaseError =>
  Object.assign(new pg.DatabaseError(mensaje, 0, "error"), { code: codigo });

describe.skipIf(base === null)("consultas de grupo: listarEmpresasDelGrupo", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  /** Para armar escenarios con la plataforma (todas las puertas). */
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  /** Solo la puerta de GRUPO: pedirle otra puerta falla (nunca cae en la de la aplicación). */
  let transaccionesDeGrupo: TransaccionesDePostgres<TxDeGrupoDePrueba>;
  let consultas: ConsultasDeGrupo;
  let dueno: pg.Client;
  const opcionesVistas: OpcionesDeTransaccion[] = [];
  const ganchos: Ganchos = { llamadas: [], intentos: 0 };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    transaccionesDeGrupo = crearTransacciones<TxDeGrupoDePrueba>({
      urls: { GRUPO: propia.base.grupo },
      armar: (db, contexto) => {
        const tenants = crearRepositorioDeTenants(db.withTables<TenantsDb>());
        const empresas = crearRepositorioDeEmpresas(db.withTables<EmpresasDb>());
        const autorizacion = crearAutorizacionDeGrupoDePostgres(
          db.withTables<AutorizacionDeGrupoDb>(),
        );
        const accesos = crearAuditoriaDeAccesoDeGrupoDePostgres(
          db.withTables<AuditoriaDeAccesoDeGrupoDb>(),
          contexto,
        );
        // Lo que ve la consulta es lo que armaría la composición, más espías que dejan rastro de qué
        // se tocó y en qué orden, y ganchos para inyectar fallas entre los pasos.
        return {
          db,
          autorizacion: {
            delPropietario: async (c) => {
              ganchos.intentos += 1;
              ganchos.llamadas.push("autorizacion");
              return autorizacion.delPropietario(c);
            },
          },
          tenants: {
            obtener: async (id) => {
              ganchos.llamadas.push("tenants");
              const tenant = await tenants.obtener(id);
              await ganchos.despuesDeLeerElTenant?.();
              return tenant;
            },
          },
          empresas: {
            listarDelTenant: (id) => {
              ganchos.llamadas.push("empresas");
              return empresas.listarDelTenant(id);
            },
          },
          accesos: {
            registrar: async (registro) => {
              ganchos.llamadas.push("accesos");
              await ganchos.alRegistrar?.();
              await accesos.registrar(registro);
              await ganchos.despuesDeRegistrar?.(ganchos.intentos);
            },
          },
        };
      },
      maximoDeConexiones: 20,
      clave: propia.base.clave,
    });
    const espia: Transacciones<TxDeConsultasDeGrupo> = {
      ejecutar: (opciones, trabajo) => {
        opcionesVistas.push(opciones);
        return transaccionesDeGrupo.ejecutar(opciones, trabajo);
      },
    };
    consultas = crearConsultasDeGrupo({ transacciones: espia, reglas: REGLAS_DE_GRUPO });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await transaccionesDeGrupo.cerrar();
    await propia.destruir();
  });

  /** Cada prueba arranca sin ganchos ni rastros de la anterior. */
  const limpiarGanchos = () => {
    ganchos.llamadas = [];
    ganchos.intentos = 0;
    delete ganchos.despuesDeLeerElTenant;
    delete ganchos.despuesDeRegistrar;
    delete ganchos.alRegistrar;
  };

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

  // ---- escenarios ---------------------------------------------------------------------------

  const grupo = (tenant: TenantId, persona: PersonaId): ContextoDeGrupo => ({
    tipo: "GRUPO",
    tenantId: tenant,
    personaId: persona,
    ahora: AHORA_DE_PRUEBA,
  });

  const tenantNuevo = async (nombre: string = nombreAlAzar("grupo")): Promise<TenantId> => {
    const r = await entorno.ejecutar(
      { contexto: comoPlataforma(), aislamiento: "read committed" },
      async ({ tenants }) => ({ ok: true as const, valor: (await tenants.crear(nombre)).id }),
    );
    if (!r.ok) throw new Error("no se pudo crear el tenant de prueba");
    return r.valor;
  };

  /** El camino de estados (con su motivo) que lleva una empresa recién creada al estado pedido. */
  const CAMINOS: Record<EstadoDeEmpresa, readonly (readonly [EstadoDeEmpresa, string | null])[]> = {
    PROVISIONING: [],
    ACTIVE: [["ACTIVE", null]],
    SUSPENDED: [
      ["ACTIVE", null],
      ["SUSPENDED", "revisión"],
    ],
    CANCELLED: [["CANCELLED", "alta abandonada"]],
    DELETING: [
      ["ACTIVE", null],
      ["DELETING", null],
    ],
  };

  type EmpresaCreada = Readonly<{ id: EmpresaId; razonSocial: string; cuit: string }>;

  const empresaNueva = async (
    tenant: TenantId,
    razonSocial: string,
    estado: EstadoDeEmpresa = "ACTIVE",
  ): Promise<EmpresaCreada> => {
    const r = await entorno.ejecutar(
      { contexto: comoPlataforma(), aislamiento: "read committed" },
      async ({ empresas }) => {
        const cuit = cuitAlAzar();
        let actual = await empresas.crear({ tenantId: tenant, cuit, razonSocial });
        for (const [paso, motivo] of CAMINOS[estado]) {
          const cambio = await empresas.cambiarEstado(actual.id, actual.version, {
            estado: paso,
            motivoEstado: motivo,
          });
          if (!cambio.ok) throw new Error(`no se pudo pasar la empresa a ${paso}`);
          actual = cambio.empresa;
        }
        return { ok: true as const, valor: { id: actual.id, razonSocial, cuit: String(cuit) } };
      },
    );
    if (!r.ok) throw new Error(`no se pudo crear la empresa de prueba: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  const suspenderTenant = async (tenant: TenantId) => {
    const r = await entorno.ejecutar(
      { contexto: comoPlataforma(), aislamiento: "read committed" },
      async ({ tenants }) => {
        const t = await tenants.obtener(tenant);
        if (t === null) throw new Error("sin tenant");
        const cambio = await tenants.cambiarEstado(t.id, t.version, {
          estado: "SUSPENDED",
          motivoEstado: "prueba",
        });
        return { ok: true as const, valor: cambio.ok };
      },
    );
    expect(r).toEqual({ ok: true, valor: true });
  };

  const propietario = (tenant: TenantId, opciones: { activo?: boolean } = {}) =>
    crearPropietario(entorno, tenant, opciones);

  /** Una persona que existe pero no es propietaria de nada. */
  const personaSuelta = async (): Promise<PersonaId> =>
    personaId((await crearPersonaDeBase(dueno)).id);

  /** El resumen de lo que la vista debería mostrar de estas empresas, en este orden. */
  const resumen = (vista: VistaDeGrupo) =>
    vista.empresas.map((e) => [e.razonSocial, e.estado, e.estadoEfectivo]);

  const valor = <T, E>(r: { ok: true; valor: T } | { ok: false; error: E }): T => {
    if (!r.ok) throw new Error(`se esperaba ok y llegó ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  // ---- lo que se mira en la base ------------------------------------------------------------

  type Acceso = { tenant_id: string; persona_id: string; empresa_id: string | null };
  const accesosDe = (tenant: string, persona?: string) =>
    filas<Acceso & { creado_en: Date }>(
      `select tenant_id, persona_id, empresa_id, creado_en from auditoria_acceso_grupo
       where tenant_id = $1 and ($2::uuid is null or persona_id = $2) order by id`,
      [tenant, persona ?? null],
    );

  /**
   * Una huella del contenido de TODAS las tablas del esquema salvo el registro de acceso: si una
   * consulta escribe en cualquier otra, la huella cambia.
   */
  const huellaDeLaBase = async (): Promise<Record<string, string>> => {
    const tablas = await filas<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and tablename <> 'auditoria_acceso_grupo' order by tablename`,
    );
    const huella: Record<string, string> = {};
    for (const { tablename } of tablas) {
      const r = await filas<{ h: string }>(
        `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h
         from public."${tablename}" t`,
      );
      huella[tablename] = r[0]?.h ?? "";
    }
    return huella;
  };

  // ============================================================================================
  // La vista del propietario
  // ============================================================================================
  describe("el propietario ve las empresas de su tenant", () => {
    it("devuelve el tenant y sus empresas ordenadas por razón social e id, cada una con su estado", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo("Grupo Ordenado");
      // Se crean desordenadas: el orden de la vista no es el de alta.
      const gama = await empresaNueva(tenant, "Gama SA", "PROVISIONING");
      const alfa = await empresaNueva(tenant, "Alfa SA", "ACTIVE");
      const epsilon = await empresaNueva(tenant, "Epsilon SA", "DELETING");
      const beta = await empresaNueva(tenant, "Beta SRL", "SUSPENDED");
      const delta = await empresaNueva(tenant, "Delta SA", "CANCELLED");
      const dueno1 = await propietario(tenant);

      const vista = valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, dueno1)));

      expect(vista).toEqual({
        tenant: { nombre: "Grupo Ordenado", estado: "ACTIVE" },
        empresas: [
          {
            id: alfa.id,
            razonSocial: "Alfa SA",
            cuit: alfa.cuit,
            estado: "ACTIVE",
            estadoEfectivo: "OPERA",
          },
          {
            id: beta.id,
            razonSocial: "Beta SRL",
            cuit: beta.cuit,
            estado: "SUSPENDED",
            estadoEfectivo: "EMPRESA_SUSPENDIDA",
          },
          {
            id: delta.id,
            razonSocial: "Delta SA",
            cuit: delta.cuit,
            estado: "CANCELLED",
            estadoEfectivo: "EMPRESA_CANCELADA",
          },
          {
            id: epsilon.id,
            razonSocial: "Epsilon SA",
            cuit: epsilon.cuit,
            estado: "DELETING",
            estadoEfectivo: "EMPRESA_EN_BAJA",
          },
          {
            id: gama.id,
            razonSocial: "Gama SA",
            cuit: gama.cuit,
            estado: "PROVISIONING",
            estadoEfectivo: "EMPRESA_EN_ALTA",
          },
        ],
      });
      // El CUIT sale como texto y la vista no arrastra campos internos.
      for (const fila of vista.empresas) {
        expect(typeof fila.cuit).toBe("string");
        expect(Object.keys(fila).sort()).toEqual([
          "cuit",
          "estado",
          "estadoEfectivo",
          "id",
          "razonSocial",
        ]);
      }
    });

    it("las razones sociales iguales se desempatan por id: el orden es estable entre llamadas", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      const iguales = await Promise.all(
        [1, 2, 3, 4].map(() => empresaNueva(tenant, "Misma Razon SA")),
      );
      const dueno1 = await propietario(tenant);
      const primera = valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, dueno1)));
      const segunda = valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, dueno1)));
      expect(primera.empresas.map((e) => e.id)).toEqual(iguales.map((e) => e.id).sort());
      expect(segunda).toEqual(primera);
    });

    it("un tenant sin empresas devuelve la lista vacía (y deja su registro)", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo("Grupo Vacío");
      const dueno1 = await propietario(tenant);
      expect(valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, dueno1)))).toEqual({
        tenant: { nombre: "Grupo Vacío", estado: "ACTIVE" },
        empresas: [],
      });
      expect(await accesosDe(tenant)).toHaveLength(1);
    });

    it("la consulta abre una transacción de la puerta de GRUPO, en read committed y no de solo lectura", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      const dueno1 = await propietario(tenant);
      opcionesVistas.length = 0;
      valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, dueno1)));
      expect(opcionesVistas).toEqual([
        { contexto: grupo(tenant, dueno1), aislamiento: "read committed" },
      ]);
    });

    it("usa el rol de base de grupo y la puerta de la aplicación no existe para ella", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      const dueno1 = await propietario(tenant);
      const rol = await transaccionesDeGrupo.ejecutar(
        { contexto: grupo(tenant, dueno1), aislamiento: "read committed" },
        async ({ db }) => {
          const { rows } = await sql<{ actual: string }>`select current_user as actual`.execute(db);
          return { ok: true as const, valor: rows[0]?.actual };
        },
      );
      expect(rol).toEqual({ ok: true, valor: "zuluhub_grupo" });
      // Con un contexto de la aplicación el adaptador de grupo no tiene a dónde conectarse: no cae en
      // otra puerta (R10).
      await expect(
        transaccionesDeGrupo.ejecutar(
          {
            contexto: comoEmpresa((await empresaNueva(tenant, "Alguna SA")).id, dueno1),
          },
          () => Promise.resolve({ ok: true as const, valor: null }),
        ),
      ).rejects.toThrow("falta la cadena de conexión de la puerta OPERATIVO");
    });
  });

  // ============================================================================================
  // Aislamiento entre tenants
  // ============================================================================================
  describe("aislamiento entre tenants", () => {
    it("cada propietario ve solo las empresas de su tenant, nunca las del otro", async () => {
      limpiarGanchos();
      const a = await tenantNuevo("Grupo A");
      const b = await tenantNuevo("Grupo B");
      const deA = [
        await empresaNueva(a, "Aaa SA"),
        await empresaNueva(a, "Aab SA", "SUSPENDED"),
        await empresaNueva(a, "Aac SA", "PROVISIONING"),
      ];
      const deB = [await empresaNueva(b, "Bba SA"), await empresaNueva(b, "Bbb SA")];
      const propA = await propietario(a);
      const propB = await propietario(b);

      const vistaA = valor(await consultas.listarEmpresasDelGrupo(grupo(a, propA)));
      const vistaB = valor(await consultas.listarEmpresasDelGrupo(grupo(b, propB)));

      expect(vistaA.tenant.nombre).toBe("Grupo A");
      expect(vistaA.empresas.map((e) => e.id)).toEqual(deA.map((e) => e.id));
      expect(vistaB.tenant.nombre).toBe("Grupo B");
      expect(vistaB.empresas.map((e) => e.id)).toEqual(deB.map((e) => e.id));
      // Nada de B (ni su id, ni su CUIT, ni su razón social) aparece en lo que ve A, y al revés.
      const textoA = JSON.stringify(vistaA);
      for (const ajena of deB) {
        expect(textoA).not.toContain(ajena.id);
        expect(textoA).not.toContain(ajena.cuit);
        expect(textoA).not.toContain(ajena.razonSocial);
      }
      const textoB = JSON.stringify(vistaB);
      for (const ajena of deA) {
        expect(textoB).not.toContain(ajena.id);
        expect(textoB).not.toContain(ajena.cuit);
        expect(textoB).not.toContain(ajena.razonSocial);
      }
    });

    it("el propietario de A que pide el tenant B (contexto de B con su persona) recibe SIN_PERMISO y no se lee ni se registra nada", async () => {
      limpiarGanchos();
      const a = await tenantNuevo();
      const b = await tenantNuevo("Grupo B secreto");
      await empresaNueva(b, "Empresa Secreta SA");
      const propA = await propietario(a);
      await propietario(b);

      const r = await consultas.listarEmpresasDelGrupo(grupo(b, propA));

      expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
      // Sin guard no se lee: solo se consultó la autorización.
      expect(ganchos.llamadas).toEqual(["autorizacion"]);
      expect(await accesosDe(b)).toEqual([]);
      expect(await accesosDe(a)).toEqual([]);
    });

    it("aunque el código se equivocara, la base no entrega nada de otro tenant: el rol de grupo con el contexto de B ve 0 empresas, 0 tenants", async () => {
      limpiarGanchos();
      const a = await tenantNuevo();
      const b = await tenantNuevo();
      await empresaNueva(a, "Empresa de A");
      await empresaNueva(b, "Empresa de B");
      const propA = await propietario(a);

      const r = await transaccionesDeGrupo.ejecutar(
        { contexto: grupo(b, propA), aislamiento: "read committed" },
        async (tx) => ({
          ok: true as const,
          valor: {
            empresasDeB: await tx.empresas.listarDelTenant(b),
            empresasDeA: await tx.empresas.listarDelTenant(a),
            tenantB: await tx.tenants.obtener(b),
            tenantA: await tx.tenants.obtener(a),
          },
        }),
      );
      expect(r).toEqual({
        ok: true,
        valor: { empresasDeB: [], empresasDeA: [], tenantB: null, tenantA: null },
      });
    });

    it("la misma persona dueña de dos tenants ve en cada contexto solo el tenant del contexto", async () => {
      limpiarGanchos();
      const a = await tenantNuevo("Doble A");
      const b = await tenantNuevo("Doble B");
      const ea = await empresaNueva(a, "Solo de A SA");
      const eb = await empresaNueva(b, "Solo de B SA");
      const persona = await propietario(a);
      await dueno.query(
        `insert into membresia_tenant (persona_id, tenant_id, rol) values ($1, $2, 'PROPIETARIO')`,
        [persona, b],
      );

      const enA = valor(await consultas.listarEmpresasDelGrupo(grupo(a, persona)));
      const enB = valor(await consultas.listarEmpresasDelGrupo(grupo(b, persona)));

      expect(enA.tenant.nombre).toBe("Doble A");
      expect(enA.empresas.map((e) => e.id)).toEqual([ea.id]);
      expect(enB.tenant.nombre).toBe("Doble B");
      expect(enB.empresas.map((e) => e.id)).toEqual([eb.id]);
      // Cada consulta dejó su registro en su propio tenant.
      expect(await accesosDe(a, persona)).toHaveLength(1);
      expect(await accesosDe(b, persona)).toHaveLength(1);
    });

    it("un tenant que no existe da SIN_PERMISO (no hay propietario), no un error ni una lista vacía", async () => {
      limpiarGanchos();
      const a = await tenantNuevo();
      const propA = await propietario(a);
      const inexistente = grupo(randomUUID() as TenantId, propA);
      expect(await consultas.listarEmpresasDelGrupo(inexistente)).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    });
  });

  // ============================================================================================
  // Autorización: solo el propietario activo
  // ============================================================================================
  describe("solo el propietario activo, y el guard va primero", () => {
    const sinAcceso = async (tenant: TenantId, persona: PersonaId) => {
      limpiarGanchos();
      const huella = await huellaDeLaBase();
      const registrosAntes = await accesosDe(tenant, persona);
      const r = await consultas.listarEmpresasDelGrupo(grupo(tenant, persona));
      expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
      // Sin guard no se lee: ni el tenant, ni las empresas, ni el registro de acceso.
      expect(ganchos.llamadas).toEqual(["autorizacion"]);
      expect(await accesosDe(tenant, persona)).toEqual(registrosAntes);
      expect(await huellaDeLaBase()).toEqual(huella);
    };

    it("un gerente de una empresa del tenant, que no es propietario, recibe SIN_PERMISO", async () => {
      const tenant = await tenantNuevo();
      const empresa = await empresaNueva(tenant, "Empresa del gerente SA");
      const gerente = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, empresa.id, gerente.id, "GERENTE");
      await sinAcceso(tenant, personaId(gerente.id));
    });

    it("un propietario con la membresía de tenant apagada recibe SIN_PERMISO", async () => {
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      await sinAcceso(tenant, await propietario(tenant, { activo: false }));
    });

    it("un propietario suspendido globalmente (persona inactiva) recibe SIN_PERMISO aunque su membresía siga activa", async () => {
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      await dueno.query("update persona set activo_global = false where id = $1", [persona]);
      await sinAcceso(tenant, persona);
    });

    it("una persona sin ninguna membresía, y un id que no es de ninguna persona, reciben SIN_PERMISO", async () => {
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      await sinAcceso(tenant, await personaSuelta());
      await sinAcceso(tenant, personaId(randomUUID()));
    });

    it("apagar al propietario corta su acceso en la consulta siguiente (nada se guarda entre llamadas)", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, persona)));
      await dueno.query(
        "update membresia_tenant set activo = false where persona_id = $1 and tenant_id = $2",
        [persona, tenant],
      );
      await sinAcceso(tenant, persona);
      // Y reactivarlo lo devuelve.
      await dueno.query(
        "update membresia_tenant set activo = true where persona_id = $1 and tenant_id = $2",
        [persona, tenant],
      );
      limpiarGanchos();
      valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, persona)));
    });

    it("los roles de grupo del código son exactamente los del CHECK de la base", async () => {
      const [{ def }] = (await filas<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
         where conname = 'membresia_tenant_rol_ck'`,
      )) as [{ def: string }];
      const enLaBase = [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
      expect(enLaBase).toEqual([...ROLES_DE_GRUPO].sort());
    });
  });

  // ============================================================================================
  // Tenant suspendido
  // ============================================================================================
  describe("con el tenant suspendido", () => {
    it("el propietario ve la lista y los estados (las activas figuran como TENANT_SUSPENDIDO, las finales conservan el suyo) y el acceso queda registrado", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo("Grupo Suspendido");
      await empresaNueva(tenant, "Activa SA", "ACTIVE");
      await empresaNueva(tenant, "Cancelada SA", "CANCELLED");
      await empresaNueva(tenant, "En alta SA", "PROVISIONING");
      await empresaNueva(tenant, "Suspendida SA", "SUSPENDED");
      const persona = await propietario(tenant);
      await suspenderTenant(tenant);

      const vista = valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, persona)));

      expect(vista.tenant).toEqual({ nombre: "Grupo Suspendido", estado: "SUSPENDED" });
      expect(resumen(vista)).toEqual([
        ["Activa SA", "ACTIVE", "TENANT_SUSPENDIDO"],
        ["Cancelada SA", "CANCELLED", "EMPRESA_CANCELADA"],
        ["En alta SA", "PROVISIONING", "TENANT_SUSPENDIDO"],
        ["Suspendida SA", "SUSPENDED", "TENANT_SUSPENDIDO"],
      ]);
      expect(await accesosDe(tenant, persona)).toHaveLength(1);
    });

    it("el tenant suspendido de otro no cambia lo que ve un tenant activo", async () => {
      limpiarGanchos();
      const suspendido = await tenantNuevo();
      const activo = await tenantNuevo();
      await empresaNueva(suspendido, "De suspendido SA");
      await empresaNueva(activo, "De activo SA");
      const persona = await propietario(activo);
      await suspenderTenant(suspendido);
      const vista = valor(await consultas.listarEmpresasDelGrupo(grupo(activo, persona)));
      expect(resumen(vista)).toEqual([["De activo SA", "ACTIVE", "OPERA"]]);
    });
  });

  // ============================================================================================
  // Solo lectura, salvo el registro de acceso
  // ============================================================================================
  describe("la consulta no escribe nada salvo su registro de acceso", () => {
    it("después de consultar, todas las demás tablas quedan idénticas y el registro tiene exactamente una fila más", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      await empresaNueva(tenant, "Otra SA", "SUSPENDED");
      const persona = await propietario(tenant);
      const huella = await huellaDeLaBase();
      const antes = await contar("select count(*) as n from auditoria_acceso_grupo");

      valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, persona)));

      expect(await huellaDeLaBase()).toEqual(huella);
      expect(await contar("select count(*) as n from auditoria_acceso_grupo")).toBe(antes + 1);
    });

    it("el rol de grupo no puede escribir en ninguna otra tabla, ni siquiera dentro de la transacción de la consulta", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      const empresa = await empresaNueva(tenant, "Intocable SA");
      const persona = await propietario(tenant);
      for (const escritura of [
        sql`update empresa set razon_social = 'x' where id = ${empresa.id}`,
        sql`insert into sucursal (empresa_id, nombre) values (${empresa.id}, 'nueva')`,
        sql`update tenant set nombre = 'x' where id = ${tenant}`,
        sql`insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id)
            values (${empresa.id}, 'X', 'empresa', 'x')`,
        sql`delete from auditoria_acceso_grupo`,
      ]) {
        const r = await transaccionesDeGrupo.ejecutar(
          { contexto: grupo(tenant, persona), aislamiento: "read committed" },
          async ({ db }) => {
            await escritura.execute(db);
            return { ok: true as const, valor: null };
          },
        );
        expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }
    });
  });

  // ============================================================================================
  // Auditoría: una consulta, un registro
  // ============================================================================================
  describe("el registro de acceso: cada consulta deja uno, a nombre del propietario", () => {
    it("cada consulta suma exactamente un registro con el tenant y la persona del contexto y sin empresa", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      const otro = await propietario(tenant);

      const antes = await filas<{ ahora: Date }>("select now() as ahora");
      valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, persona)));
      expect(await accesosDe(tenant)).toHaveLength(1);
      valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, persona)));
      valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, otro)));
      const despues = await filas<{ ahora: Date }>("select now() as ahora");

      const registros = await accesosDe(tenant);
      expect(registros.map((r) => [r.tenant_id, r.persona_id, r.empresa_id])).toEqual([
        [tenant, persona, null],
        [tenant, persona, null],
        [tenant, otro, null],
      ]);
      // El instante lo fija la base, no la aplicación.
      for (const r of registros) {
        expect(r.creado_en.getTime()).toBeGreaterThanOrEqual(
          (antes[0]?.ahora ?? r.creado_en).getTime(),
        );
        expect(r.creado_en.getTime()).toBeLessThanOrEqual(
          (despues[0]?.ahora ?? r.creado_en).getTime(),
        );
      }
      expect(await accesosDe(tenant, otro)).toHaveLength(1);
    });

    it("ante un conflicto de serialización la transacción se repite entera y el registro queda UNA sola vez", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      // El primer intento llega a registrar y recién después el servidor aborta por serialización.
      ganchos.despuesDeRegistrar = (intento) =>
        intento === 1
          ? Promise.reject(errorDeBase("40001", "conflicto de serialización simulado"))
          : Promise.resolve();

      const vista = valor(await consultas.listarEmpresasDelGrupo(grupo(tenant, persona)));

      expect(vista.tenant.estado).toBe("ACTIVE");
      expect(ganchos.intentos).toBe(2);
      // Los dos intentos registraron, pero el del intento abortado se revirtió con él.
      expect(ganchos.llamadas.filter((l) => l === "accesos")).toHaveLength(2);
      expect(await accesosDe(tenant, persona)).toHaveLength(1);
    });

    it("si el registro falla no se entrega ningún dato: la consulta devuelve el error y no queda registro", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      ganchos.alRegistrar = () => Promise.reject(errorDeBase("42501", "permiso denegado simulado"));

      const r = await consultas.listarEmpresasDelGrupo(grupo(tenant, persona));

      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      expect(await accesosDe(tenant)).toEqual([]);
    });

    it("si apagan al propietario después del guard y antes del registro, la base rechaza el registro y no se entrega nada", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      // Entre leer el tenant y registrar el acceso, alguien apaga la membresía y confirma.
      ganchos.despuesDeLeerElTenant = async () => {
        await dueno.query(
          "update membresia_tenant set activo = false where persona_id = $1 and tenant_id = $2",
          [persona, tenant],
        );
      };

      const r = await consultas.listarEmpresasDelGrupo(grupo(tenant, persona));

      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      expect(ganchos.llamadas).toEqual(["autorizacion", "tenants", "empresas", "accesos"]);
      expect(await accesosDe(tenant)).toEqual([]);
    });

    it("el adaptador de registro solo funciona con un contexto de grupo", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      const empresa = await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      await expect(
        entorno.ejecutar(
          { contexto: comoEmpresa(empresa.id, persona), aislamiento: "read committed" },
          ({ db }) =>
            crearAuditoriaDeAccesoDeGrupoDePostgres(
              db.withTables<AuditoriaDeAccesoDeGrupoDb>(),
              comoEmpresa(empresa.id, persona),
            )
              .registrar({ empresaId: null })
              .then(() => ({ ok: true as const, valor: null })),
        ),
      ).rejects.toThrow(new RangeError("auditoría de acceso de grupo: el contexto no es de grupo"));
      expect(await accesosDe(tenant)).toEqual([]);
    });
  });

  // ============================================================================================
  // Concurrencia
  // ============================================================================================
  describe("concurrencia", () => {
    it("consultas simultáneas de dos tenants, todas a la vez: cada una ve solo lo suyo y cada una deja su registro", async () => {
      limpiarGanchos();
      const a = await tenantNuevo("Concurrente A");
      const b = await tenantNuevo("Concurrente B");
      const deA = [await empresaNueva(a, "Cuenta A1 SA"), await empresaNueva(a, "Cuenta A2 SA")];
      const deB = [await empresaNueva(b, "Cuenta B1 SA")];
      const propA = await propietario(a);
      const propB = await propietario(b);
      const porTenant = 6;
      // Todas llegan hasta después del guard y recién entonces siguen: se superponen de verdad.
      const barrera = crearBarrera(porTenant * 2);
      ganchos.despuesDeLeerElTenant = barrera;

      const resultados = await Promise.all([
        ...Array.from({ length: porTenant }, () =>
          consultas.listarEmpresasDelGrupo(grupo(a, propA)),
        ),
        ...Array.from({ length: porTenant }, () =>
          consultas.listarEmpresasDelGrupo(grupo(b, propB)),
        ),
      ]);

      const vistas = resultados.map(valor);
      for (const vista of vistas.slice(0, porTenant)) {
        expect(vista.tenant.nombre).toBe("Concurrente A");
        expect(vista.empresas.map((e) => e.id)).toEqual(deA.map((e) => e.id));
      }
      for (const vista of vistas.slice(porTenant)) {
        expect(vista.tenant.nombre).toBe("Concurrente B");
        expect(vista.empresas.map((e) => e.id)).toEqual(deB.map((e) => e.id));
      }
      expect(await accesosDe(a, propA)).toHaveLength(porTenant);
      expect(await accesosDe(b, propB)).toHaveLength(porTenant);
    });

    it("una consulta que corre mientras el propietario es apagado: o ve la lista y queda registrada, o recibe un error y no queda registro; nunca datos sin registro", async () => {
      limpiarGanchos();
      const tenant = await tenantNuevo();
      await empresaNueva(tenant, "Alguna SA");
      const persona = await propietario(tenant);
      const barrera = crearBarrera(2);
      ganchos.despuesDeLeerElTenant = barrera;

      const [consulta] = await Promise.all([
        consultas.listarEmpresasDelGrupo(grupo(tenant, persona)),
        (async () => {
          await barrera();
          await dueno.query(
            "update membresia_tenant set activo = false where persona_id = $1 and tenant_id = $2",
            [persona, tenant],
          );
        })(),
      ]);

      const registros = await accesosDe(tenant, persona);
      if (consulta.ok) {
        expect(registros).toHaveLength(1);
      } else {
        expect(consulta.error).toEqual({ tipo: "AccesoDenegado" });
        expect(registros).toEqual([]);
      }
    });
  });
});
