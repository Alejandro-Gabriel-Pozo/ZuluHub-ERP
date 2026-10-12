import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  claveDeIdempotenciaValida,
  operacionDeIdempotenciaValida,
} from "../../src/adaptadores/postgres/huella-canonica";
import { ACCIONES_DE_PLATAFORMA } from "../../src/puertos/auditoria-de-plataforma";
import { ROLES_DE_ADMINISTRADOR } from "../../src/puertos/autorizacion-de-plataforma";
import type { Dato } from "../../src/puertos/sin-secretos";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  comoGrupo,
  comoTrabajos,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  nombreAlAzar,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import {
  ADMIN_DE_PRUEBA,
  SOPORTE_DE_PRUEBA,
  adminInexistente,
  claveAlAzar,
  comoAdmin,
  comoAdminDe,
  comoSistema,
  comoSoporte,
  crearAdminDeBase,
  esperarAccesoDenegado,
  esperarError,
} from "./plataforma-apoyo";

/**
 * H5 plataforma, tramo P4: los puertos y adaptadores de auditoría, idempotencia y autorización de
 * plataforma, y el chequeo de emails de administradores, contra una base real y con los roles reales.
 * Base propia de este archivo (SERIALIZABLE aborta por falsos positivos si otros archivos escriben las
 * mismas tablas en paralelo).
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("plataforma: auditoría, idempotencia y autorización", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let empresa: EmpresaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    empresa = await crearEmpresaActiva(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async (texto: string, parametros: unknown[] = []) =>
    (await dueno.query<Record<string, unknown>>(texto, parametros)).rows;
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas(texto, parametros))[0]?.["n"]);

  // ===========================================================================================
  // Auditoría de plataforma
  // ===========================================================================================
  describe("auditoría de plataforma", () => {
    const registrarCon = (contexto: ReturnType<typeof comoAdmin>, entidadId: string) =>
      entorno.ejecutar({ contexto }, async ({ auditoriaDePlataforma }) => {
        await auditoriaDePlataforma.registrar({
          accion: "TENANT_ALTA",
          entidad: "tenant",
          entidadId,
          antes: null,
          despues: { nombre: "ACME", activo: true },
        });
        return ok(null);
      });

    it("el actor sale del contexto: el administrador, el soporte o `sistema`", async () => {
      for (const [contexto, actor] of [
        [comoAdmin(), ADMIN_DE_PRUEBA],
        [comoSoporte(), SOPORTE_DE_PRUEBA],
        [comoSistema(), "sistema"],
      ] as const) {
        const entidadId = nombreAlAzar("aud-actor");
        expect(await registrarCon(contexto, entidadId)).toEqual({ ok: true, valor: null });
        const [fila] = await filas(
          "select actor, accion, entidad, entidad_id, antes, despues from auditoria_plataforma where entidad_id = $1",
          [entidadId],
        );
        expect(fila).toEqual({
          actor,
          accion: "TENANT_ALTA",
          entidad: "tenant",
          entidad_id: entidadId,
          antes: null,
          despues: { nombre: "ACME", activo: true },
        });
      }
    });

    it("guarda antes y despues cuando vienen, y null cuando no", async () => {
      const id = nombreAlAzar("aud-datos");
      await entorno.ejecutar({ contexto: comoAdmin() }, async ({ auditoriaDePlataforma }) => {
        await auditoriaDePlataforma.registrar({
          accion: "EMPRESA_SUSPENDIDA",
          entidad: "empresa",
          entidadId: id,
          antes: { estado: "ACTIVE", motivo: null },
          despues: { estado: "SUSPENDED", motivo: "falta de pago", lista: [1, 2] },
        });
        await auditoriaDePlataforma.registrar({
          accion: "EMPRESA_REACTIVADA",
          entidad: "empresa",
          entidadId: id,
        });
        return ok(null);
      });
      const r = await filas(
        "select accion, antes, despues from auditoria_plataforma where entidad_id = $1 order by id",
        [id],
      );
      expect(r).toEqual([
        {
          accion: "EMPRESA_SUSPENDIDA",
          antes: { estado: "ACTIVE", motivo: null },
          despues: { estado: "SUSPENDED", motivo: "falta de pago", lista: [1, 2] },
        },
        { accion: "EMPRESA_REACTIVADA", antes: null, despues: null },
      ]);
    });

    it("cada acción de la unión se puede registrar (la base no rechaza ninguna)", async () => {
      const id = nombreAlAzar("aud-acciones");
      const r = await entorno.ejecutar(
        { contexto: comoAdmin() },
        async ({ auditoriaDePlataforma }) => {
          for (const accion of ACCIONES_DE_PLATAFORMA) {
            await auditoriaDePlataforma.registrar({ accion, entidad: "x", entidadId: id });
          }
          return ok(null);
        },
      );
      expect(r.ok).toBe(true);
      expect(
        await cuenta("select count(*) as n from auditoria_plataforma where entidad_id = $1", [id]),
      ).toBe(ACCIONES_DE_PLATAFORMA.length);
    });

    it("un administrador dado de baja, uno inexistente: la base rechaza el registro", async () => {
      const baja = await crearAdminDeBase(dueno, { activo: false });
      for (const contexto of [comoAdminDe(baja.id), comoAdminDe(adminInexistente())]) {
        const id = nombreAlAzar("aud-rechazo");
        esperarAccesoDenegado(await registrarCon(contexto, id));
        expect(
          await cuenta("select count(*) as n from auditoria_plataforma where entidad_id = $1", [
            id,
          ]),
        ).toBe(0);
      }
    });

    it("nadie audita a nombre de otro: con SQL directo, un actor ajeno al del contexto se rechaza", async () => {
      const id = nombreAlAzar("aud-ajeno");
      for (const [contexto, ajeno] of [
        [comoAdmin(), SOPORTE_DE_PRUEBA],
        [comoSoporte(), ADMIN_DE_PRUEBA],
        [comoSistema(), ADMIN_DE_PRUEBA],
        [comoAdmin(), "sistema"],
      ] as const) {
        const r = await entorno.ejecutar({ contexto }, async ({ db }) => {
          await sql`insert into auditoria_plataforma (actor, accion, entidad, entidad_id)
                    values (${ajeno}, 'PRUEBA', 'x', ${id})`.execute(db);
          return ok(null);
        });
        esperarAccesoDenegado(r);
      }
      expect(
        await cuenta("select count(*) as n from auditoria_plataforma where entidad_id = $1", [id]),
      ).toBe(0);
    });

    it("con un contexto que no es de plataforma lanza RangeError y no escribe nada", async () => {
      const id = nombreAlAzar("aud-otro");
      const registro = {
        accion: "TENANT_ALTA",
        entidad: "tenant",
        entidadId: id,
      } as const;
      await expect(
        entorno.ejecutar(
          { contexto: comoEmpresa(empresa.empresa) },
          async ({ auditoriaDePlataforma }) => {
            await auditoriaDePlataforma.registrar(registro);
            return ok(null);
          },
        ),
      ).rejects.toThrow("auditoría de plataforma: el contexto no es de plataforma");
      await expect(
        entorno.ejecutar({ contexto: comoTrabajos() }, async ({ auditoriaDePlataforma }) => {
          await auditoriaDePlataforma.registrar(registro);
          return ok(null);
        }),
      ).rejects.toThrow(RangeError);
      expect(
        await cuenta("select count(*) as n from auditoria_plataforma where entidad_id = $1", [id]),
      ).toBe(0);
    });

    it("rechaza acciones desconocidas, entidades vacías y secretos (RangeError) sin escribir", async () => {
      const id = nombreAlAzar("aud-invalido");
      const malos: { registro: Record<string, unknown>; mensaje: string }[] = [
        {
          registro: { accion: "INVENTADA", entidad: "x", entidadId: id },
          mensaje: "auditoría de plataforma: acción desconocida 'INVENTADA'",
        },
        {
          registro: { accion: "TENANT_ALTA", entidad: "", entidadId: id },
          mensaje: "la entidad y su id no pueden estar vacíos",
        },
        {
          registro: { accion: "TENANT_ALTA", entidad: "  ", entidadId: id },
          mensaje: "la entidad y su id no pueden estar vacíos",
        },
        {
          registro: { accion: "TENANT_ALTA", entidad: "x", entidadId: "" },
          mensaje: "la entidad y su id no pueden estar vacíos",
        },
        {
          registro: { accion: "TENANT_ALTA", entidad: "x", entidadId: " " },
          mensaje: "la entidad y su id no pueden estar vacíos",
        },
        {
          registro: {
            accion: "TENANT_ALTA",
            entidad: "x",
            entidadId: id,
            despues: { token: "abc" },
          },
          mensaje: "auditoría de plataforma (despues): el campo 'token' parece un secreto",
        },
        {
          registro: {
            accion: "TENANT_ALTA",
            entidad: "x",
            entidadId: id,
            antes: { datos: { hashDelToken: "abc" } },
          },
          mensaje:
            "auditoría de plataforma (antes): el campo 'datos.hashDelToken' parece un secreto",
        },
      ];
      for (const { registro, mensaje } of malos) {
        await expect(
          entorno.ejecutar({ contexto: comoAdmin() }, async ({ auditoriaDePlataforma }) => {
            await auditoriaDePlataforma.registrar(
              registro as unknown as Parameters<typeof auditoriaDePlataforma.registrar>[0],
            );
            return ok(null);
          }),
          mensaje,
        ).rejects.toThrow(mensaje);
      }
      expect(
        await cuenta("select count(*) as n from auditoria_plataforma where entidad_id = $1", [id]),
      ).toBe(0);
    });

    it("es de solo inserción: ni UPDATE ni DELETE ni TRUNCATE, ni para el administrador", async () => {
      const id = nombreAlAzar("aud-inmutable");
      await registrarCon(comoAdmin(), id);
      for (const texto of [
        sql`update auditoria_plataforma set accion = 'OTRA' where entidad_id = ${id}`,
        sql`delete from auditoria_plataforma where entidad_id = ${id}`,
        sql`truncate auditoria_plataforma`,
      ]) {
        const r = await entorno.ejecutar({ contexto: comoAdmin() }, async ({ db }) => {
          await texto.execute(db);
          return ok(null);
        });
        esperarAccesoDenegado(r);
      }
      expect(
        await cuenta(
          "select count(*) as n from auditoria_plataforma where entidad_id = $1 and accion = 'TENANT_ALTA'",
          [id],
        ),
      ).toBe(1);
    });

    it("dos registros simultáneos de administradores distintos quedan con cada uno su actor", async () => {
      const id = nombreAlAzar("aud-simultanea");
      const barrera = crearBarrera(2);
      const de = (contexto: ReturnType<typeof comoAdmin>) =>
        entorno.ejecutar({ contexto }, async ({ auditoriaDePlataforma }) => {
          await barrera();
          await auditoriaDePlataforma.registrar({
            accion: "TENANT_ALTA",
            entidad: "tenant",
            entidadId: id,
          });
          return ok(null);
        });
      const rs = await Promise.all([de(comoAdmin()), de(comoSoporte())]);
      expect(rs.map((r) => r.ok)).toEqual([true, true]);
      const actores = (
        await filas("select actor from auditoria_plataforma where entidad_id = $1 order by actor", [
          id,
        ])
      ).map((f) => f["actor"]);
      expect(actores).toEqual([ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA].sort());
    });
  });

  // ===========================================================================================
  // Idempotencia de plataforma
  // ===========================================================================================
  describe("idempotencia de plataforma", () => {
    const OPERACION = "tenants.alta";

    /** Un caso de uso mínimo con el patrón de B.4: consultar, escribir, auditar, registrar. */
    type Falla = "tras-tenant" | "tras-auditoria" | "tras-registrar" | null;
    async function altaDeTenant(
      tx: TxDePrueba,
      clave: string,
      nombre: string,
      falla: Falla = null,
      operacion = OPERACION,
    ): Promise<Resultado<Dato, "CLAVE_REUTILIZADA">> {
      const entrada = { nombre };
      const consulta = await tx.idempotencia.consultar(operacion, clave, entrada);
      if (consulta.tipo === "REPETIDA") return ok(consulta.resultado);
      if (consulta.tipo === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
      const tenant = await tx.tenants.crear(nombre);
      if (falla === "tras-tenant") throw new Error("falla forzada");
      await tx.auditoriaDePlataforma.registrar({
        accion: "TENANT_ALTA",
        entidad: "tenant",
        entidadId: tenant.id,
        despues: { nombre },
      });
      if (falla === "tras-auditoria") throw new Error("falla forzada");
      const resultado = { tenantId: tenant.id };
      await tx.idempotencia.registrar(operacion, clave, entrada, resultado);
      if (falla === "tras-registrar") throw new Error("falla forzada");
      return ok(resultado);
    }
    const alta = (
      contexto: ReturnType<typeof comoAdmin>,
      clave: string,
      nombre: string,
      falla: Falla = null,
      operacion = OPERACION,
    ) =>
      entorno.ejecutar({ contexto, reintentos: 15 }, (tx) =>
        altaDeTenant(tx, clave, nombre, falla, operacion),
      );
    const tenantsCon = (nombre: string) =>
      cuenta("select count(*) as n from tenant where nombre = $1", [nombre]);
    const auditoriasDe = (nombre: string) =>
      cuenta(
        `select count(*) as n from auditoria_plataforma a join tenant t on t.id::text = a.entidad_id
         where t.nombre = $1`,
        [nombre],
      );
    const clavesCon = (clave: string) =>
      cuenta("select count(*) as n from idempotencia_plataforma where clave = $1", [clave]);

    it("la primera vez ejecuta; la repetición devuelve lo mismo sin escribir nada más", async () => {
      const clave = claveAlAzar();
      const nombre = nombreAlAzar("alta-seq");
      const primera = await alta(comoAdmin(), clave, nombre);
      expect(primera.ok).toBe(true);
      const segunda = await alta(comoAdmin(), clave, nombre);
      const tercera = await alta(comoAdmin(), clave, nombre);
      expect(segunda).toEqual(primera);
      expect(tercera).toEqual(primera);
      expect(await tenantsCon(nombre)).toBe(1);
      expect(await auditoriasDe(nombre)).toBe(1);
      expect(await clavesCon(clave)).toBe(1);
    });

    it("la huella ignora el orden de los campos pero no sus valores", async () => {
      const clave = claveAlAzar();
      const tx = (entrada: Dato) =>
        entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) =>
          ok(await idempotencia.consultar("empresas.alta", clave, entrada)),
        );
      const original = { cuit: "20123456786", datos: { b: 1, a: [1, 2] }, razon: "ACME" };
      await entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) => {
        await idempotencia.registrar("empresas.alta", clave, original, { empresaId: "e1" });
        return ok(null);
      });
      expect(await tx({ razon: "ACME", datos: { a: [1, 2], b: 1 }, cuit: "20123456786" })).toEqual({
        ok: true,
        valor: { tipo: "REPETIDA", resultado: { empresaId: "e1" } },
      });
      for (const distinta of [
        { ...original, razon: "ACME2" },
        { ...original, datos: { a: [2, 1], b: 1 } },
        { cuit: original.cuit, datos: original.datos },
        { ...original, extra: null },
      ]) {
        expect(await tx(distinta), JSON.stringify(distinta)).toEqual({
          ok: true,
          valor: { tipo: "CLAVE_REUTILIZADA" },
        });
      }
    });

    it("la misma clave con otra entrada o con otra operación es CLAVE_REUTILIZADA y no escribe", async () => {
      const clave = claveAlAzar();
      const nombre = nombreAlAzar("alta-reuso");
      expect((await alta(comoAdmin(), clave, nombre)).ok).toBe(true);
      const otraEntrada = nombreAlAzar("alta-reuso-otra");
      expect(await alta(comoAdmin(), clave, otraEntrada)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await tenantsCon(otraEntrada)).toBe(0);
      expect(await alta(comoAdmin(), clave, nombre, null, "tenants.suspender")).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await clavesCon(clave)).toBe(1);
      expect(await tenantsCon(nombre)).toBe(1);
    });

    it("las claves son por administrador: la misma clave de dos administradores no choca ni se ve", async () => {
      const clave = claveAlAzar();
      const nombre = nombreAlAzar("alta-dos-admins");
      const otro = await crearAdminDeBase(dueno);
      // El otro no ve la clave del primero: para él es NUEVA aunque el primero ya la usó.
      expect((await alta(comoAdmin(), clave, nombre)).ok).toBe(true);
      const consulta = await entorno.ejecutar(
        { contexto: comoAdminDe(otro.id) },
        async ({ idempotencia }) => ok(await idempotencia.consultar(OPERACION, clave, { nombre })),
      );
      expect(consulta).toEqual({ ok: true, valor: { tipo: "NUEVA" } });
      // Y con SQL directo, tampoco ve la fila.
      const vista = await entorno.ejecutar({ contexto: comoAdminDe(otro.id) }, async ({ db }) => {
        const { rows } = await sql<{ n: string }>`select count(*) as n from idempotencia_plataforma
          where clave = ${clave}`.execute(db);
        return ok(Number(rows[0]?.n));
      });
      expect(vista).toEqual({ ok: true, valor: 0 });
      // Cada uno registra la suya.
      expect((await alta(comoAdminDe(otro.id), clave, nombre)).ok).toBe(true);
      expect(await clavesCon(clave)).toBe(2);
      // Soporte también puede usar la idempotencia (reenvía y revoca altas).
      const deSoporte = await entorno.ejecutar(
        { contexto: comoSoporte() },
        async ({ idempotencia }) => {
          await idempotencia.registrar(OPERACION, clave, { nombre }, { soporte: true });
          return ok(null);
        },
      );
      expect(deSoporte.ok).toBe(true);
      expect(await clavesCon(clave)).toBe(3);
    });

    it("un administrador de baja o inexistente no registra claves (la base lo rechaza)", async () => {
      const baja = await crearAdminDeBase(dueno, { activo: false });
      for (const id of [baja.id, adminInexistente()]) {
        const clave = claveAlAzar();
        esperarAccesoDenegado(
          await entorno.ejecutar({ contexto: comoAdminDe(id) }, async ({ idempotencia }) => {
            await idempotencia.registrar(OPERACION, clave, { a: 1 }, { ok: true });
            return ok(null);
          }),
        );
        expect(await clavesCon(clave)).toBe(0);
      }
    });

    it("`sistema` y los contextos que no son de plataforma no tienen claves (RangeError)", async () => {
      const clave = claveAlAzar();
      await expect(
        entorno.ejecutar({ contexto: comoSistema() }, async ({ idempotencia }) =>
          ok(await idempotencia.consultar(OPERACION, clave, {})),
        ),
      ).rejects.toThrow("idempotencia de plataforma: solo un administrador tiene claves");
      await expect(
        entorno.ejecutar({ contexto: comoSistema() }, async ({ idempotencia }) => {
          await idempotencia.registrar(OPERACION, clave, {}, {});
          return ok(null);
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        entorno.ejecutar({ contexto: comoEmpresa(empresa.empresa) }, async ({ idempotencia }) =>
          ok(await idempotencia.consultar(OPERACION, clave, {})),
        ),
      ).rejects.toThrow("idempotencia de plataforma: el contexto no es de plataforma");
      await expect(
        entorno.ejecutar(
          { contexto: comoGrupo(empresa.tenant, personaId(ADMIN_DE_PRUEBA)) },
          async ({ idempotencia }) => {
            await idempotencia.registrar(OPERACION, clave, {}, {});
            return ok(null);
          },
        ),
      ).rejects.toThrow(RangeError);
      expect(await clavesCon(clave)).toBe(0);
    });

    it("una clave o una operación con forma inválida es un RangeError, antes de tocar la base", async () => {
      for (const [operacion, clave] of [
        [OPERACION, "corta"],
        [OPERACION, "a".repeat(129)],
        [OPERACION, `${"a".repeat(16)} `],
        ["Tenants.alta", claveAlAzar()],
        ["", claveAlAzar()],
        ["tenants-alta", claveAlAzar()],
      ] as const) {
        await expect(
          entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) =>
            ok(await idempotencia.consultar(operacion, clave, {})),
          ),
          `${operacion} ${clave}`,
        ).rejects.toThrow(RangeError);
        await expect(
          entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) => {
            await idempotencia.registrar(operacion, clave, {}, {});
            return ok(null);
          }),
        ).rejects.toThrow(RangeError);
      }
    });

    it("no guarda un resultado con pinta de secreto, ni una entrada que no se pueda canonizar", async () => {
      const clave = claveAlAzar();
      await expect(
        entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) => {
          await idempotencia.registrar(OPERACION, clave, {}, { invitacionToken: "x" });
          return ok(null);
        }),
      ).rejects.toThrow("idempotencia (resultado): el campo 'invitacionToken' parece un secreto");
      await expect(
        entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) =>
          ok(await idempotencia.consultar(OPERACION, clave, { a: Number.NaN })),
        ),
      ).rejects.toThrow("idempotencia: número no finito");
      expect(await clavesCon(clave)).toBe(0);
    });

    it("el resultado guardado es el que se devuelve, sea el valor que sea", async () => {
      for (const resultado of [null, 0, "", false, [], { a: { b: [1, null] } }] as Dato[]) {
        const clave = claveAlAzar();
        await entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) => {
          await idempotencia.registrar(OPERACION, clave, { r: 1 }, resultado);
          return ok(null);
        });
        const r = await entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) =>
          ok(await idempotencia.consultar(OPERACION, clave, { r: 1 })),
        );
        expect(r, JSON.stringify(resultado)).toEqual({
          ok: true,
          valor: { tipo: "REPETIDA", resultado },
        });
      }
    });

    it("registrar dos veces la misma clave: error de unicidad y se revierte todo (no pisa ni duplica)", async () => {
      const clave = claveAlAzar();
      await entorno.ejecutar({ contexto: comoAdmin() }, async ({ idempotencia }) => {
        await idempotencia.registrar(OPERACION, clave, { a: 1 }, { primero: true });
        return ok(null);
      });
      const nombre = nombreAlAzar("tenant-duplicado");
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async (tx) => {
        await tx.tenants.crear(nombre);
        await tx.idempotencia.registrar(OPERACION, clave, { a: 1 }, { segundo: true });
        return ok(null);
      });
      esperarError(r, "Unicidad", "idempotencia_plataforma_pkey");
      expect(await tenantsCon(nombre)).toBe(0);
      const guardado = await filas(
        "select resultado from idempotencia_plataforma where clave = $1",
        [clave],
      );
      expect(guardado).toEqual([{ resultado: { primero: true } }]);
    });

    it("las filas son de solo inserción, también para el administrador", async () => {
      const clave = claveAlAzar();
      await alta(comoAdmin(), clave, nombreAlAzar("alta-inmutable"));
      for (const texto of [
        sql`update idempotencia_plataforma set resultado = '{}'::jsonb where clave = ${clave}`,
        sql`delete from idempotencia_plataforma where clave = ${clave}`,
        sql`truncate idempotencia_plataforma`,
      ]) {
        esperarAccesoDenegado(
          await entorno.ejecutar({ contexto: comoAdmin() }, async ({ db }) => {
            await texto.execute(db);
            return ok(null);
          }),
        );
      }
      expect(await clavesCon(clave)).toBe(1);
    });

    describe("atomicidad: si algo falla, no queda nada (ni efecto, ni auditoría, ni clave)", () => {
      for (const falla of ["tras-tenant", "tras-auditoria", "tras-registrar"] as const) {
        it(`falla ${falla}`, async () => {
          const clave = claveAlAzar();
          const nombre = nombreAlAzar("alta-atomica");
          await expect(alta(comoAdmin(), clave, nombre, falla)).rejects.toThrow("falla forzada");
          expect(await tenantsCon(nombre)).toBe(0);
          expect(await auditoriasDe(nombre)).toBe(0);
          expect(await clavesCon(clave)).toBe(0);
          // La clave sigue libre: el reintento corre entero.
          expect((await alta(comoAdmin(), clave, nombre)).ok).toBe(true);
          expect(await tenantsCon(nombre)).toBe(1);
          expect(await auditoriasDe(nombre)).toBe(1);
          expect(await clavesCon(clave)).toBe(1);
        });
      }

      it("una falla de la base al registrar (clave duplicada) también revierte la auditoría", async () => {
        const clave = claveAlAzar();
        const primero = nombreAlAzar("alta-doble-a");
        expect((await alta(comoAdmin(), clave, primero)).ok).toBe(true);
        // Salta la consulta y fuerza el INSERT: simula al que perdió la carrera en un nivel menor.
        const segundo = nombreAlAzar("alta-doble-b");
        const r = await entorno.ejecutar({ contexto: comoAdmin() }, async (tx) => {
          const t = await tx.tenants.crear(segundo);
          await tx.auditoriaDePlataforma.registrar({
            accion: "TENANT_ALTA",
            entidad: "tenant",
            entidadId: t.id,
          });
          await tx.idempotencia.registrar(
            OPERACION,
            clave,
            { nombre: segundo },
            { tenantId: t.id },
          );
          return ok(null);
        });
        esperarError(r, "Unicidad", "idempotencia_plataforma_pkey");
        expect(await tenantsCon(segundo)).toBe(0);
        expect(await auditoriasDe(segundo)).toBe(0);
      });
    });

    describe("concurrencia", () => {
      it("SERIALIZABLE: seis pedidos simultáneos con la misma clave hacen UN alta y devuelven lo mismo", async () => {
        const clave = claveAlAzar();
        const nombre = nombreAlAzar("alta-simultanea");
        const N = 6;
        const barrera = crearBarrera(N);
        const rs = await Promise.all(
          Array.from({ length: N }, () =>
            entorno.ejecutar({ contexto: comoAdmin(), reintentos: 15 }, async (tx) => {
              const entrada = { nombre };
              const consulta = await tx.idempotencia.consultar(OPERACION, clave, entrada);
              if (consulta.tipo === "REPETIDA") return ok(consulta.resultado);
              if (consulta.tipo === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA" as const);
              await barrera(); // todos vieron la clave libre antes de que alguno la registre
              const tenant = await tx.tenants.crear(nombre);
              await tx.auditoriaDePlataforma.registrar({
                accion: "TENANT_ALTA",
                entidad: "tenant",
                entidadId: tenant.id,
              });
              const resultado = { tenantId: tenant.id };
              await tx.idempotencia.registrar(OPERACION, clave, entrada, resultado);
              return ok(resultado);
            }),
          ),
        );
        expect(rs.every((r) => r.ok)).toBe(true);
        const valores = rs.map((r) => (r.ok ? r.valor : null));
        expect(new Set(valores.map((v) => JSON.stringify(v))).size).toBe(1);
        expect(await tenantsCon(nombre)).toBe(1);
        expect(await auditoriasDe(nombre)).toBe(1);
        expect(await clavesCon(clave)).toBe(1);
      });

      it("READ COMMITTED: el choque sale como unicidad, gana uno solo y no se duplica nada", async () => {
        const clave = claveAlAzar();
        const nombre = nombreAlAzar("alta-simultanea-rc");
        const N = 5;
        const barrera = crearBarrera(N);
        const rs = await Promise.all(
          Array.from({ length: N }, () =>
            entorno.ejecutar(
              { contexto: comoAdmin(), aislamiento: "read committed" },
              async (tx) => {
                const entrada = { nombre };
                const consulta = await tx.idempotencia.consultar(OPERACION, clave, entrada);
                if (consulta.tipo !== "NUEVA") return err("NO_ES_NUEVA" as const);
                await barrera();
                const tenant = await tx.tenants.crear(nombre);
                await tx.idempotencia.registrar(OPERACION, clave, entrada, {
                  tenantId: tenant.id,
                });
                return ok(tenant.id);
              },
            ),
          ),
        );
        expect(rs.filter((r) => r.ok)).toHaveLength(1);
        for (const r of rs.filter((x) => !x.ok)) {
          esperarError(r, "Unicidad", "idempotencia_plataforma_pkey");
        }
        expect(await tenantsCon(nombre)).toBe(1);
        expect(await clavesCon(clave)).toBe(1);
      });

      it("dos administradores con la MISMA clave a la vez hacen cada uno lo suyo", async () => {
        const clave = claveAlAzar();
        const nombre = nombreAlAzar("alta-dos-a-la-vez");
        const otro = await crearAdminDeBase(dueno);
        const barrera = crearBarrera(2);
        const de = (contexto: ReturnType<typeof comoAdmin>) =>
          entorno.ejecutar({ contexto, reintentos: 15 }, async (tx) => {
            const consulta = await tx.idempotencia.consultar(OPERACION, clave, { nombre });
            if (consulta.tipo !== "NUEVA") return err("NO_ES_NUEVA" as const);
            await barrera();
            const t = await tx.tenants.crear(nombre);
            await tx.idempotencia.registrar(OPERACION, clave, { nombre }, { tenantId: t.id });
            return ok(t.id);
          });
        const rs = await Promise.all([de(comoAdmin()), de(comoAdminDe(otro.id))]);
        expect(rs.map((r) => r.ok)).toEqual([true, true]);
        expect(await tenantsCon(nombre)).toBe(2);
        expect(await clavesCon(clave)).toBe(2);
      });

      it("claves distintas a la vez: ninguna se pierde", async () => {
        const nombre = nombreAlAzar("alta-claves-distintas");
        const claves = Array.from({ length: 6 }, () => claveAlAzar());
        const rs = await Promise.all(
          claves.map((clave, i) => alta(comoAdmin(), clave, `${nombre}-${i}`)),
        );
        expect(rs.every((r) => r.ok)).toBe(true);
        for (const clave of claves) expect(await clavesCon(clave)).toBe(1);
      });
    });

    it("las expresiones de forma de TypeScript dicen lo mismo que los CHECK de la base", async () => {
      const claves = [
        "a".repeat(15),
        "a".repeat(16),
        "A".repeat(128),
        "a".repeat(129),
        "ab-_" + "c".repeat(12),
        `${"a".repeat(16)} `,
        `${"a".repeat(16)}\n`,
        `${"a".repeat(15)}ñ`,
        `${"a".repeat(15)}.`,
        "",
      ];
      const operaciones = ["a", "empresas.alta", "A", "a1", "a b", "a-b", "", "a\n", "_._"];
      const admin = (await filas("select id from admin_plataforma limit 1"))[0]?.["id"];
      const aceptaLaBase = async (clave: string, operacion: string): Promise<boolean> => {
        await dueno.query("begin");
        try {
          await dueno.query(
            `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
             values ($1, $2, $3, $4, '{}'::jsonb)`,
            [admin, clave, operacion, "ab".repeat(32)],
          );
          return true;
        } catch {
          return false;
        } finally {
          await dueno.query("rollback");
        }
      };
      for (const clave of claves) {
        expect(await aceptaLaBase(clave, "empresas.alta"), JSON.stringify(clave)).toBe(
          claveDeIdempotenciaValida(clave),
        );
      }
      for (const operacion of operaciones) {
        expect(await aceptaLaBase(claveAlAzar(), operacion), JSON.stringify(operacion)).toBe(
          operacionDeIdempotenciaValida(operacion),
        );
      }
    });
  });

  // ===========================================================================================
  // Autorización de plataforma
  // ===========================================================================================
  describe("autorización de plataforma", () => {
    const delActor = (contexto: ReturnType<typeof comoAdmin>) =>
      entorno.ejecutar({ contexto }, async ({ autorizacionDePlataforma }) => {
        if (contexto.tipo !== "PLATAFORMA") throw new Error("contexto de prueba");
        return ok(await autorizacionDePlataforma.delActor(contexto));
      });

    it("devuelve el rol del administrador activo: ADMIN o SOPORTE", async () => {
      expect(await delActor(comoAdmin())).toEqual({ ok: true, valor: { rol: "ADMIN" } });
      expect(await delActor(comoSoporte())).toEqual({ ok: true, valor: { rol: "SOPORTE" } });
    });

    it("sin rol (null): `sistema`, un id que no existe y un administrador dado de baja", async () => {
      const baja = await crearAdminDeBase(dueno, { activo: false, rol: "ADMIN" });
      const bajaSoporte = await crearAdminDeBase(dueno, { activo: false, rol: "SOPORTE" });
      for (const contexto of [
        comoSistema(),
        comoAdminDe(adminInexistente()),
        comoAdminDe(baja.id),
        comoAdminDe(bajaSoporte.id),
      ]) {
        expect(await delActor(contexto)).toEqual({ ok: true, valor: { rol: null } });
      }
    });

    it("la baja y la reactivación cortan y devuelven el acceso en la operación siguiente", async () => {
      const admin = await crearAdminDeBase(dueno, { rol: "SOPORTE" });
      expect(await delActor(comoAdminDe(admin.id))).toEqual({
        ok: true,
        valor: { rol: "SOPORTE" },
      });
      await dueno.query("update admin_plataforma set activo = false where id = $1", [admin.id]);
      expect(await delActor(comoAdminDe(admin.id))).toEqual({ ok: true, valor: { rol: null } });
      await dueno.query("update admin_plataforma set activo = true where id = $1", [admin.id]);
      expect(await delActor(comoAdminDe(admin.id))).toEqual({
        ok: true,
        valor: { rol: "SOPORTE" },
      });
    });

    it("nada se guarda entre llamadas: dentro de una misma transacción, vuelve a leer", async () => {
      const admin = await crearAdminDeBase(dueno, { rol: "ADMIN" });
      const contexto = comoAdminDe(admin.id);
      if (contexto.tipo !== "PLATAFORMA") throw new Error("contexto de prueba");
      const r = await entorno.ejecutar(
        { contexto, aislamiento: "read committed" },
        async ({ autorizacionDePlataforma }) => {
          const antes = await autorizacionDePlataforma.delActor(contexto);
          await dueno.query("update admin_plataforma set rol = 'SOPORTE' where id = $1", [
            admin.id,
          ]);
          const despues = await autorizacionDePlataforma.delActor(contexto);
          return ok([antes.rol, despues.rol]);
        },
      );
      expect(r).toEqual({ ok: true, valor: ["ADMIN", "SOPORTE"] });
    });

    it("el actor viaja firmado: dos administradores en transacciones simultáneas no se mezclan", async () => {
      const barrera = crearBarrera(2);
      const de = (contexto: ReturnType<typeof comoAdmin>) =>
        entorno.ejecutar({ contexto }, async ({ autorizacionDePlataforma }) => {
          if (contexto.tipo !== "PLATAFORMA") throw new Error("contexto de prueba");
          await barrera();
          return ok((await autorizacionDePlataforma.delActor(contexto)).rol);
        });
      const rs = await Promise.all([de(comoAdmin()), de(comoSoporte())]);
      expect(rs).toEqual([
        { ok: true, valor: "ADMIN" },
        { ok: true, valor: "SOPORTE" },
      ]);
    });

    it("los roles del puerto son los del CHECK de la base", async () => {
      const [fila] = await filas(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'admin_plataforma_rol_ck'",
      );
      const def = String(fila?.["def"]);
      const enLaBase = [...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort();
      expect(enLaBase).toEqual([...ROLES_DE_ADMINISTRADOR].sort());
    });

    it("un rol que la base no debería tener es un defecto, no un permiso", async () => {
      const aparte = await crearBaseAparte(base!);
      const entornoAparte = crearEntornoDePrueba(aparte.base);
      const duenoAparte = new pg.Client({ connectionString: aparte.base.dueno });
      await duenoAparte.connect();
      try {
        await duenoAparte.query(
          "alter table admin_plataforma drop constraint admin_plataforma_rol_ck",
        );
        await duenoAparte.query("update admin_plataforma set rol = 'ROOT' where id = $1", [
          ADMIN_DE_PRUEBA,
        ]);
        const contexto = comoAdmin();
        if (contexto.tipo !== "PLATAFORMA") throw new Error("contexto de prueba");
        await expect(
          entornoAparte.ejecutar({ contexto }, async ({ autorizacionDePlataforma }) =>
            ok(await autorizacionDePlataforma.delActor(contexto)),
          ),
        ).rejects.toThrow("rol de administrador desconocido en la base: ROOT");
      } finally {
        await duenoAparte.end();
        await entornoAparte.cerrar();
        await aparte.destruir();
      }
    });
  });

  // ===========================================================================================
  // Emails de administradores
  // ===========================================================================================
  describe("emails de administradores de plataforma", () => {
    const esAdmin = (email: string) =>
      entorno.ejecutar({ contexto: comoAdmin() }, async ({ admins }) =>
        ok(await admins.esEmailDeAdminActivo(email)),
      );

    it("reconoce a un administrador activo, ADMIN o SOPORTE, aunque el texto no esté normalizado", async () => {
      const admin = await crearAdminDeBase(dueno, { email: "jefe.de.plataforma@prueba.test" });
      const soporte = await crearAdminDeBase(dueno, { rol: "SOPORTE" });
      for (const email of [
        admin.email,
        "JEFE.de.Plataforma@Prueba.TEST",
        `  ${admin.email}  `,
        soporte.email,
      ]) {
        expect(await esAdmin(email), email).toEqual({ ok: true, valor: true });
      }
    });

    it("no reconoce a un administrador de baja, ni un email desconocido, ni uno parecido", async () => {
      const baja = await crearAdminDeBase(dueno, { activo: false });
      for (const email of [
        baja.email,
        "nadie@prueba.test",
        "jefe.de.plataforma@prueba.tes",
        "%@prueba.test",
        "jefe_de_plataforma@prueba.test",
        "",
        "' or 1=1 --",
      ]) {
        expect(await esAdmin(email), email).toEqual({ ok: true, valor: false });
      }
    });

    it("se lee igual con el actor `sistema` o con soporte, y no con un administrador de baja", async () => {
      const admin = await crearAdminDeBase(dueno);
      const baja = await crearAdminDeBase(dueno, { activo: false });
      for (const [contexto, esperado] of [
        [comoSistema(), true],
        [comoSoporte(), true],
        [comoAdminDe(baja.id), true],
      ] as const) {
        const r = await entorno.ejecutar({ contexto }, async ({ admins }) =>
          ok(await admins.esEmailDeAdminActivo(admin.email)),
        );
        expect(r, contexto.tipo).toEqual({ ok: true, valor: esperado });
      }
    });
  });

  // ===========================================================================================
  // Los cinco roles de base
  // ===========================================================================================
  describe("los roles de base de la aplicación, el grupo, los trabajos y la autenticación no tocan nada de esto", () => {
    const roles = ["app", "grupo", "trabajos", "autenticacion"] as const;
    const codigoDe = async (url: string, texto: string): Promise<string | null> => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        await c.query(texto);
        return null;
      } catch (e) {
        return (e as { code?: string }).code ?? "sin-codigo";
      } finally {
        await c.end();
      }
    };

    it("no leen admin_plataforma, idempotencia_plataforma, auditoria_plataforma ni referencia_de_error", async () => {
      for (const rol of roles) {
        for (const tabla of [
          "admin_plataforma",
          "idempotencia_plataforma",
          "auditoria_plataforma",
          "referencia_de_error",
        ]) {
          expect(
            await codigoDe(propia.base[rol], `select 1 from ${tabla}`),
            `${rol} ${tabla}`,
          ).toBe("42501");
        }
      }
    });

    it("no escriben en admin_plataforma, idempotencia_plataforma ni auditoria_plataforma", async () => {
      for (const rol of roles) {
        for (const texto of [
          `insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('x', 'X', 'x', 'x')`,
          `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
             values ('${ADMIN_DE_PRUEBA}', 'clave-de-prueba-0001', 'a', '${"ab".repeat(32)}', '{}')`,
          `update admin_plataforma set activo = false`,
          `insert into admin_plataforma (email, rol) values ('x@prueba.test', 'ADMIN')`,
        ]) {
          expect(await codigoDe(propia.base[rol], texto), `${rol}: ${texto}`).toBe("42501");
        }
      }
    });

    it("las empresas ni se enteran: con el contexto de una empresa, las tablas de plataforma siguen cerradas", async () => {
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(empresaId(empresa.empresa)) },
        async ({ db }) => {
          await sql`select 1 from idempotencia_plataforma`.execute(db);
          return ok(null);
        },
      );
      esperarAccesoDenegado(r);
    });
  });
});
