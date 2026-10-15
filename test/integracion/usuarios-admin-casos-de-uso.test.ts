import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  estadoDeInvitacion,
  type CasosDeUsoDeIdentidad,
  type ConsultasDeIdentidad,
  type Invitacion,
} from "../../src/modulos/identidad/publico";
import {
  invitacionId,
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import type { Tokens } from "../../src/puertos/tokens";
import type { OpcionesDeTransaccion, Transacciones } from "../../src/puertos/transacciones";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import {
  aceptarDeBase,
  crearAsignacionDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  revocarDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";

/**
 * H6, tramo T3a: revocar una invitación, listar miembros, listar invitaciones pendientes y el error
 * `SUCURSAL_INACTIVA` al invitar, contra una base real, con los roles limitados y el contexto
 * firmado (nunca el dueño de la base, salvo para armar el escenario y para mirar). Cubre
 * autorización por rol, aislamiento entre empresas, idempotencia, atomicidad y auditoría. La
 * concurrencia está en `usuarios-admin-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
const DIA = 86_400_000;
const ahora = AHORA_DE_PRUEBA;
const en = (dias: number) => new Date(ahora.getTime() + dias * DIA);

type Fila = Record<string, unknown>;

// Con la máquina cargada una prueba puede tardar varias veces lo normal: el límite es holgado a
// propósito (lo que se prueba es el efecto de cada caso de uso, no la velocidad).
const LIMITE_EN_MS = 60_000;

describe.skipIf(base === null)(
  "administración de usuarios: revocar, listar e invitar contra una base real",
  { timeout: LIMITE_EN_MS },
  () => {
    // Base propia de este archivo (ver `identidad-casos-de-uso.test.ts`): SERIALIZABLE aborta por
    // falsos positivos cuando otros archivos, en paralelo, escriben las mismas tablas.
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let tokens: Tokens;
    let casos: CasosDeUsoDeIdentidad;
    let consultas: ConsultasDeIdentidad;
    /** Las opciones con las que las consultas abren su transacción. */
    const opcionesVistas: OpcionesDeTransaccion[] = [];

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 10);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      tokens = crearTokensHmac(randomBytes(32));
      casos = crearCasosDeUsoDeIdentidad({
        transacciones: entorno,
        tokens,
        reglas: REGLAS_DE_EMPRESA,
      });
      const espia: Transacciones<TxDePrueba> = {
        ejecutar: (opciones, trabajo) => {
          opcionesVistas.push(opciones);
          return entorno.ejecutar(opciones, trabajo);
        },
      };
      consultas = crearConsultasDeIdentidad({ transacciones: espia, reglas: REGLAS_DE_EMPRESA });
    }, LIMITE_EN_MS);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    }, LIMITE_EN_MS);

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;

    // ---- escenarios ---------------------------------------------------------------------------

    type Escenario = EmpresaDePrueba &
      Readonly<{
        empresaId: EmpresaId;
        /** La sucursal que trae la empresa de prueba ("Casa central"). */
        sucursal: SucursalId;
        gerente: PersonaId;
        gerenteEmail: string;
        ctx: ContextoOperativo;
      }>;

    /** Una empresa activa con su sucursal y su gerente (miembro activo). */
    const escenario = async (tenant?: EmpresaDePrueba["tenant"]): Promise<Escenario> => {
      const e = await crearEmpresaActiva(entorno, tenant === undefined ? {} : { tenant });
      const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
      const g = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
      const gerente = personaId(g.id);
      return {
        ...e,
        empresaId: e.empresa,
        sucursal,
        gerente,
        gerenteEmail: g.email,
        ctx: comoEmpresa(e.empresa, gerente),
      };
    };

    /** Un miembro más de la empresa (creado por el dueño de la base). */
    const miembro = async (e: Escenario, rol: RolDePrueba, activo = true, email?: string) => {
      const p = await crearPersonaDeBase(dueno, email);
      await crearMembresiaDeBase(dueno, e.empresa, p.id, rol, activo);
      return { id: personaId(p.id), email: p.email, ctx: comoEmpresa(e.empresa, personaId(p.id)) };
    };

    /** Una sucursal más de la empresa, creada por el dueño de la base. */
    const sucursalExtra = async (e: Escenario, nombre: string): Promise<SucursalId> => {
      const { rows } = await dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa, nombre],
      );
      return sucursalId(rows[0]?.id as string);
    };
    const desactivarSucursalDeBase = (id: string) =>
      dueno.query("update sucursal set activa = false where id = $1", [id]);

    /** Invita con el caso de uso y devuelve el id y el token (derivado, como lo haría el mail). */
    const invitar = async (
      e: Escenario,
      opciones: {
        email?: string;
        rol?: "ADMINISTRADOR" | "OPERADOR";
        sucursales?: SucursalId[];
      } = {},
    ) => {
      const email = opciones.email ?? emailAlAzar("invitado");
      const r = await casos.invitarUsuario(e.ctx, {
        email,
        rol: opciones.rol ?? "OPERADOR",
        sucursales: opciones.sucursales ?? [e.sucursal],
      });
      if (!r.ok) throw new Error(`no se pudo invitar: ${JSON.stringify(r.error)}`);
      return { id: r.valor.invitacionId, email, token: tokens.derivar(r.valor.invitacionId) };
    };

    /** Una invitación de USUARIO a varias empresas, armada por el dueño de la base. */
    const invitacionMultiempresa = async (
      empresas: { e: EmpresaDePrueba; rol: RolDePrueba; sucursales?: string[] }[],
      email = emailAlAzar("multi"),
    ) => {
      const emitido = tokens.emitir();
      const tenant = empresas[0]?.e.tenant as string;
      const inv = await crearInvitacionDeBase(dueno, {
        tenant,
        id: emitido.invitacionId,
        tokenHash: emitido.tokenHash,
        email,
      });
      for (const { e, rol, sucursales } of empresas) {
        await incluirEmpresa(dueno, inv, e.empresa, rol, sucursales ?? []);
      }
      return { inv, email, token: emitido.token };
    };

    // ---- lo que se mira en la base ------------------------------------------------------------

    const auditoria = (empresa: string, accion?: string) =>
      filas(
        `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
         where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
        [empresa, accion ?? null],
      );
    const trabajos = (empresa: string) =>
      filas(
        "select tipo, datos, clave_idempotencia from trabajo where empresa_id = $1 order by id",
        [empresa],
      );
    const invitacion = async (id: string) =>
      (await filas("select * from invitacion where id = $1", [id]))[0];

    /** Todo lo que pueden tocar estos casos de uso, para las empresas indicadas: la "foto" de la base. */
    const foto = async (empresas: string[], emails: string[] = []) =>
      JSON.stringify({
        membresias: await filas(
          "select * from membresia where empresa_id = any($1) order by empresa_id, persona_id",
          [empresas],
        ),
        asignaciones: await filas(
          "select * from asignacion_sucursal where empresa_id = any($1) order by empresa_id, persona_id, sucursal_id",
          [empresas],
        ),
        sucursales: await filas("select * from sucursal where empresa_id = any($1) order by id", [
          empresas,
        ]),
        invitaciones: await filas(
          `select i.* from invitacion i where i.id in (select invitacion_id from invitacion_empresa where empresa_id = any($1))
           order by i.id`,
          [empresas],
        ),
        copias: await filas(
          "select invitacion_id, empresa_id, estado from invitacion_empresa where empresa_id = any($1) order by invitacion_id, empresa_id",
          [empresas],
        ),
        invitacionSucursal: await filas(
          "select * from invitacion_sucursal where empresa_id = any($1) order by invitacion_id, sucursal_id",
          [empresas],
        ),
        auditoria: await filas(
          "select id, empresa_id, accion from auditoria_empresa where empresa_id = any($1) order by id",
          [empresas],
        ),
        trabajos: await filas(
          "select id, empresa_id, tipo, estado from trabajo where empresa_id = any($1) order by id",
          [empresas],
        ),
        personas: await filas("select * from persona where email = any($1) order by email", [
          emails,
        ]),
      });

    const suspenderEmpresa = (empresa: string) =>
      dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [empresa],
      );
    const suspenderTenant = (tenant: string) =>
      dueno.query(
        "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [tenant],
      );

    // =============================================================================================
    describe("revocarInvitacion", () => {
      it("el gerente revoca una pendiente: queda REVOCADA con su motivo, no se puede aceptar y deja su auditoría", async () => {
        const e = await escenario();
        const { id, email, token } = await invitar(e);
        const trabajosAntes = await trabajos(e.empresa);

        expect(await casos.revocarInvitacion(e.ctx, { invitacionId: id })).toEqual({
          ok: true,
          valor: { yaEstabaRevocada: false },
        });

        expect(await invitacion(id)).toMatchObject({
          estado: "REVOCADA",
          revocada_en: ahora,
          motivo_revocacion: "REVOCADA_POR_LA_EMPRESA",
          reemplazada_por: null,
          aceptada_por: null,
        });
        expect(
          await filas("select estado from invitacion_empresa where invitacion_id = $1", [id]),
        ).toEqual([{ estado: "REVOCADA" }]);
        // Quien tenga el enlace ya no entra.
        expect(
          await casos.aceptarInvitacion({
            token,
            emailAutenticado: email,
            usuarioAuth: usuarioDePrueba(email),
            marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
            ahora,
          }),
        ).toEqual({
          ok: false,
          error: "INVITACION_REVOCADA",
        });
        // Revocar no manda ningún mail ni crea otro trabajo.
        expect(await trabajos(e.empresa)).toEqual(trabajosAntes);
        const registros = await auditoria(e.empresa, "INVITACION_REVOCADA");
        expect(registros).toEqual([
          {
            accion: "INVITACION_REVOCADA",
            actor_persona_id: e.gerente,
            entidad: "invitacion",
            entidad_id: id,
            antes: { estado: "PENDIENTE", email },
            despues: { estado: "REVOCADA", motivo: "REVOCADA_POR_LA_EMPRESA" },
          },
        ]);
        // Ni el token ni su hash se guardan en la auditoría.
        const { tokenHash } = tokens.emitir();
        expect(JSON.stringify(registros)).not.toContain(token);
        expect(JSON.stringify(registros)).not.toContain(tokenHash);
      });

      it("el administrador también revoca", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        const { id } = await invitar(e);
        expect(await casos.revocarInvitacion(admin.ctx, { invitacionId: id })).toEqual({
          ok: true,
          valor: { yaEstabaRevocada: false },
        });
        expect((await auditoria(e.empresa, "INVITACION_REVOCADA"))[0]).toMatchObject({
          actor_persona_id: admin.id,
        });
      });

      it("una pendiente VENCIDA también se revoca (el vencimiento no se guarda)", async () => {
        const e = await escenario();
        const inv = await crearInvitacionDeBase(dueno, {
          tenant: e.tenant,
          emitidaEn: en(-20),
          venceEn: en(-13),
        });
        await incluirEmpresa(dueno, inv, e.empresa, "OPERADOR", [e.sucursal]);
        expect(
          await casos.revocarInvitacion(e.ctx, { invitacionId: invitacionId(inv.id) }),
        ).toEqual({ ok: true, valor: { yaEstabaRevocada: false } });
        expect(await invitacion(inv.id)).toMatchObject({ estado: "REVOCADA" });
      });

      it("revocar libera el lugar: se puede volver a invitar al mismo email", async () => {
        const e = await escenario();
        const { id, email } = await invitar(e);
        await casos.revocarInvitacion(e.ctx, { invitacionId: id });
        const otra = await casos.invitarUsuario(e.ctx, {
          email,
          rol: "OPERADOR",
          sucursales: [e.sucursal],
        });
        expect(otra.ok && otra.valor.yaExistia).toBe(false);
        expect(otra.ok && otra.valor.invitacionId).not.toBe(id);
      });

      it("idempotente: revocar dos veces es ok, y la segunda no escribe ni audita", async () => {
        const e = await escenario();
        const { id } = await invitar(e);
        await casos.revocarInvitacion(e.ctx, { invitacionId: id });
        const antes = await foto([e.empresa]);

        expect(await casos.revocarInvitacion(e.ctx, { invitacionId: id })).toEqual({
          ok: true,
          valor: { yaEstabaRevocada: true },
        });
        expect(await casos.revocarInvitacion(e.ctx, { invitacionId: id })).toEqual({
          ok: true,
          valor: { yaEstabaRevocada: true },
        });

        expect(await foto([e.empresa])).toBe(antes);
        expect(await auditoria(e.empresa, "INVITACION_REVOCADA")).toHaveLength(1);
      });

      it("una que ya estaba revocada por otro motivo (reenviada, o por la plataforma) es ok sin escribir", async () => {
        const e = await escenario();
        const origen = await invitar(e);
        const reenviada = await casos.reenviarInvitacion(e.ctx, { invitacionId: origen.id });
        if (!reenviada.ok) throw new Error("no se pudo reenviar");
        const otra = await crearInvitacionDeBase(dueno, { tenant: e.tenant });
        await incluirEmpresa(dueno, otra, e.empresa, "OPERADOR", [e.sucursal]);
        await revocarDeBase(dueno, otra);
        const antes = await foto([e.empresa]);

        for (const id of [origen.id, invitacionId(otra.id)]) {
          expect(await casos.revocarInvitacion(e.ctx, { invitacionId: id })).toEqual({
            ok: true,
            valor: { yaEstabaRevocada: true },
          });
        }
        expect(await foto([e.empresa])).toBe(antes);
        // La reemplazante, en cambio, sigue pendiente y se revoca.
        expect(
          await casos.revocarInvitacion(e.ctx, { invitacionId: reenviada.valor.invitacionId }),
        ).toEqual({ ok: true, valor: { yaEstabaRevocada: false } });
      });

      it("una ya aceptada da INVITACION_ACEPTADA y no cambia nada", async () => {
        const e = await escenario();
        const { id, email, token } = await invitar(e);
        const aceptada = await casos.aceptarInvitacion({
          token,
          emailAutenticado: email,
          usuarioAuth: usuarioDePrueba(email),
          marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
          ahora,
        });
        expect(aceptada.ok).toBe(true);
        const antes = await foto([e.empresa], [email]);

        expect(await casos.revocarInvitacion(e.ctx, { invitacionId: id })).toEqual({
          ok: false,
          error: "INVITACION_ACEPTADA",
        });
        expect(await foto([e.empresa], [email])).toBe(antes);
        expect(await invitacion(id)).toMatchObject({ estado: "ACEPTADA" });
      });

      it("una invitación inexistente, un texto que no es un id o una de otra empresa dan INVITACION_NO_ENCONTRADA", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        const deOtroTenant = await escenario();
        const ajena = await invitar(otra);
        const ajenaDeOtroTenant = await invitar(deOtroTenant);
        const antesDeLasOtras = await foto([otra.empresa, deOtroTenant.empresa]);
        const antes = await foto([e.empresa]);

        for (const id of [randomUUID(), "no-es-un-id", ajena.id, ajenaDeOtroTenant.id]) {
          expect(await casos.revocarInvitacion(e.ctx, { invitacionId: invitacionId(id) })).toEqual({
            ok: false,
            error: "INVITACION_NO_ENCONTRADA",
          });
        }
        expect(await foto([e.empresa])).toBe(antes);
        expect(await foto([otra.empresa, deOtroTenant.empresa])).toBe(antesDeLasOtras);
        expect(await invitacion(ajena.id)).toMatchObject({ estado: "PENDIENTE" });
      });

      it("el alta del gerente no la revoca la empresa: REVOCACION_NO_PERMITIDA", async () => {
        const e = await escenario();
        const alta = await crearInvitacionDeBase(dueno, { tenant: e.tenant, tipo: "ALTA_GERENTE" });
        await incluirEmpresa(dueno, alta, e.empresa, "GERENTE");
        const antes = await foto([e.empresa]);
        expect(
          await casos.revocarInvitacion(e.ctx, { invitacionId: invitacionId(alta.id) }),
        ).toEqual({ ok: false, error: "REVOCACION_NO_PERMITIDA" });
        expect(await foto([e.empresa])).toBe(antes);
        expect(await invitacion(alta.id)).toMatchObject({ estado: "PENDIENTE" });
      });

      it("una invitación a varias empresas se revoca entera, y solo se audita en la empresa que revoca", async () => {
        const e1 = await escenario();
        const e2 = await escenario(e1.tenant);
        const { inv } = await invitacionMultiempresa([
          { e: e1, rol: "OPERADOR" },
          { e: e2, rol: "ADMINISTRADOR" },
        ]);

        expect(
          await casos.revocarInvitacion(e1.ctx, { invitacionId: invitacionId(inv.id) }),
        ).toEqual({ ok: true, valor: { yaEstabaRevocada: false } });

        expect(await invitacion(inv.id)).toMatchObject({ estado: "REVOCADA" });
        expect(
          await filas(
            "select empresa_id, estado from invitacion_empresa where invitacion_id = $1 order by empresa_id",
            [inv.id],
          ),
        ).toEqual(
          [e1.empresa, e2.empresa].sort().map((empresa_id) => ({ empresa_id, estado: "REVOCADA" })),
        );
        expect(await auditoria(e1.empresa, "INVITACION_REVOCADA")).toHaveLength(1);
        expect(await auditoria(e2.empresa, "INVITACION_REVOCADA")).toHaveLength(0);
        // Desde la otra empresa, ya revocada: ok sin escribir.
        expect(
          await casos.revocarInvitacion(e2.ctx, { invitacionId: invitacionId(inv.id) }),
        ).toEqual({ ok: true, valor: { yaEstabaRevocada: true } });
      });

      it("la empresa que no está en la invitación no la ve ni la revoca (aunque sea del mismo tenant)", async () => {
        const e1 = await escenario();
        const e2 = await escenario(e1.tenant);
        const e3 = await escenario(e1.tenant);
        const { inv } = await invitacionMultiempresa([
          { e: e1, rol: "OPERADOR" },
          { e: e2, rol: "OPERADOR" },
        ]);
        expect(
          await casos.revocarInvitacion(e3.ctx, { invitacionId: invitacionId(inv.id) }),
        ).toEqual({ ok: false, error: "INVITACION_NO_ENCONTRADA" });
        expect(await invitacion(inv.id)).toMatchObject({ estado: "PENDIENTE" });
      });

      it("atomicidad: si falla la auditoría la invitación sigue pendiente", async () => {
        const e = await escenario();
        const { id } = await invitar(e);
        const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          auditoria: {
            registrar: () => Promise.reject(new Error("falla forzada de la auditoría")),
          },
        }));
        try {
          const roto = crearCasosDeUsoDeIdentidad({
            transacciones: falla,
            tokens,
            reglas: REGLAS_DE_EMPRESA,
          });
          const antes = await foto([e.empresa]);
          await expect(roto.revocarInvitacion(e.ctx, { invitacionId: id })).rejects.toThrow(
            "falla forzada de la auditoría",
          );
          expect(await foto([e.empresa])).toBe(antes);
          expect(await invitacion(id)).toMatchObject({ estado: "PENDIENTE", revocada_en: null });
        } finally {
          await falla.cerrar();
        }
      });

      it("si la actualización no toca la fila (otra revocó entre la lectura y la escritura) no inventa un éxito ni audita", async () => {
        const e = await escenario();
        const { id } = await invitar(e);
        const sinEfecto = crearEntornoDePrueba(propia.base, 2, (tx) => ({
          ...tx,
          invitaciones: { ...tx.invitaciones, revocar: () => Promise.resolve(false) },
        }));
        try {
          const raro = crearCasosDeUsoDeIdentidad({
            transacciones: sinEfecto,
            tokens,
            reglas: REGLAS_DE_EMPRESA,
          });
          const antes = await foto([e.empresa]);
          expect(await raro.revocarInvitacion(e.ctx, { invitacionId: id })).toEqual({
            ok: false,
            error: "INVITACION_NO_ENCONTRADA",
          });
          expect(await foto([e.empresa])).toBe(antes);
        } finally {
          await sinEfecto.cerrar();
        }
      });
    });

    // =============================================================================================
    describe("invitarUsuario con una sucursal desactivada (SUCURSAL_INACTIVA)", () => {
      it("invitar a una sucursal desactivada da SUCURSAL_INACTIVA y no escribe nada", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        await desactivarSucursalDeBase(norte);
        const email = emailAlAzar("nuevo");
        const antes = await foto([e.empresa], [email]);

        expect(
          await casos.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [norte] }),
        ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });

        expect(await foto([e.empresa], [email])).toBe(antes);
        expect(await trabajos(e.empresa)).toEqual([]);
      });

      it("una desactivada entre varias activas rechaza todo el pedido, esté donde esté", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const sur = await sucursalExtra(e, "Sucursal sur");
        await desactivarSucursalDeBase(sur);
        const antes = await foto([e.empresa]);
        for (const sucursales of [
          [sur, e.sucursal, norte],
          [e.sucursal, norte, sur],
          [e.sucursal, sur],
        ]) {
          expect(
            await casos.invitarUsuario(e.ctx, {
              email: emailAlAzar(),
              rol: "ADMINISTRADOR",
              sucursales,
            }),
          ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
        }
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("las activas pasan aunque haya otra desactivada que no se pidió, y reactivar la deja invitar", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const sur = await sucursalExtra(e, "Sucursal sur");
        await desactivarSucursalDeBase(sur);
        const bien = await casos.invitarUsuario(e.ctx, {
          email: emailAlAzar(),
          rol: "OPERADOR",
          sucursales: [e.sucursal, norte],
        });
        expect(bien.ok).toBe(true);

        await dueno.query("update sucursal set activa = true where id = $1", [sur]);
        const reactivada = await casos.invitarUsuario(e.ctx, {
          email: emailAlAzar(),
          rol: "OPERADOR",
          sucursales: [sur],
        });
        expect(reactivada.ok).toBe(true);
      });

      it("sin sucursales se invita igual", async () => {
        const e = await escenario();
        const r = await casos.invitarUsuario(e.ctx, {
          email: emailAlAzar(),
          rol: "OPERADOR",
          sucursales: [],
        });
        expect(r.ok).toBe(true);
      });

      it("una sucursal repetida en el pedido se juzga una vez", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const bien = await casos.invitarUsuario(e.ctx, {
          email: emailAlAzar(),
          rol: "OPERADOR",
          sucursales: [norte, norte],
        });
        expect(bien.ok).toBe(true);
        await desactivarSucursalDeBase(norte);
        expect(
          await casos.invitarUsuario(e.ctx, {
            email: emailAlAzar(),
            rol: "OPERADOR",
            sucursales: [norte, norte],
          }),
        ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
      });

      it("una sucursal de OTRA empresa sigue dando SUCURSAL_NO_ES_DE_LA_EMPRESA (no se confunde con inactiva)", async () => {
        const e = await escenario();
        const otra = await escenario(e.tenant);
        const deOtra = await sucursalExtra(otra, "Sucursal de la otra");
        await desactivarSucursalDeBase(deOtra);
        for (const sucursales of [[otra.sucursal], [deOtra]]) {
          expect(
            await casos.invitarUsuario(e.ctx, {
              email: emailAlAzar(),
              rol: "OPERADOR",
              sucursales,
            }),
          ).toEqual({ ok: false, error: "SUCURSAL_NO_ES_DE_LA_EMPRESA" });
        }
      });

      it("el pedido se juzga antes que la idempotencia: con una pendiente vigente y una sucursal desactivada, da SUCURSAL_INACTIVA", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const { email } = await invitar(e, { sucursales: [e.sucursal] });
        await desactivarSucursalDeBase(norte);
        expect(
          await casos.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [norte] }),
        ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
        // Con el mismo pedido de antes sigue siendo idempotente.
        const igual = await casos.invitarUsuario(e.ctx, {
          email,
          rol: "OPERADOR",
          sucursales: [e.sucursal],
        });
        expect(igual.ok && igual.valor.yaExistia).toBe(true);
      });

      it("el guard va antes: sin permiso da SIN_PERMISO aunque la sucursal esté desactivada", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        await desactivarSucursalDeBase(norte);
        const op = await miembro(e, "OPERADOR");
        expect(
          await casos.invitarUsuario(op.ctx, {
            email: emailAlAzar(),
            rol: "OPERADOR",
            sucursales: [norte],
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
      });

      it("quien llega a una sucursal desactivada después de invitado la conserva: la invitación ya emitida se acepta", async () => {
        // La baja de la sucursal no revoca las invitaciones ya emitidas (nacieron antes, en un orden válido).
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const { email, token } = await invitar(e, { sucursales: [norte] });
        await desactivarSucursalDeBase(norte);
        const aceptada = await casos.aceptarInvitacion({
          token,
          emailAutenticado: email,
          usuarioAuth: usuarioDePrueba(email),
          marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
          ahora,
        });
        expect(aceptada.ok).toBe(true);
      });
    });

    // =============================================================================================
    describe("listarMiembros", () => {
      it("lista a todos los miembros de la empresa, activos o apagados, ordenados por email y persona, con el contrato exacto", async () => {
        const e = await escenario();
        const zeta = await miembro(e, "OPERADOR", true, "zeta@prueba.test");
        const alfa = await miembro(e, "ADMINISTRADOR", true, "alfa@prueba.test");
        const apagado = await miembro(e, "OPERADOR", false, "beta@prueba.test");
        await crearAsignacionDeBase(dueno, e.empresa, zeta.id, e.sucursal);

        const r = await consultas.listarMiembros(e.ctx);

        const esperado = [
          {
            personaId: alfa.id,
            email: "alfa@prueba.test",
            rol: "ADMINISTRADOR",
            activo: true,
            sucursales: [],
          },
          {
            personaId: apagado.id,
            email: "beta@prueba.test",
            rol: "OPERADOR",
            activo: false,
            sucursales: [],
          },
          {
            personaId: e.gerente,
            email: e.gerenteEmail,
            rol: "GERENTE",
            activo: true,
            sucursales: [],
          },
          {
            personaId: zeta.id,
            email: "zeta@prueba.test",
            rol: "OPERADOR",
            activo: true,
            sucursales: [e.sucursal],
          },
        ].sort((a, b) => (a.email < b.email ? -1 : 1));
        expect(r).toEqual({ ok: true, valor: esperado });
      });

      it("el orden es por email (estable, sin depender del locale de la base)", async () => {
        const e = await escenario();
        const miembros = [
          await miembro(e, "OPERADOR"),
          await miembro(e, "OPERADOR"),
          await miembro(e, "OPERADOR"),
        ];
        const r = await consultas.listarMiembros(e.ctx);
        const lista = r.ok ? r.valor : [];
        expect(lista.map((m) => m.email)).toEqual(
          [...lista.map((m) => m.email)].sort((a, b) => (a < b ? -1 : 1)),
        );
        expect(lista).toHaveLength(miembros.length + 1);
      });

      it("muestra la asignación efectiva: asignación activa Y sucursal activa", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const sur = await sucursalExtra(e, "Sucursal sur");
        const ana = await miembro(e, "OPERADOR");
        await crearAsignacionDeBase(dueno, e.empresa, ana.id, e.sucursal);
        await crearAsignacionDeBase(dueno, e.empresa, ana.id, norte);
        await crearAsignacionDeBase(dueno, e.empresa, ana.id, sur, false); // asignación apagada
        const deAna = async () => {
          const r = await consultas.listarMiembros(e.ctx);
          return r.ok ? r.valor.find((m) => m.personaId === ana.id)?.sucursales : r;
        };

        expect(await deAna()).toEqual([e.sucursal, norte].sort());

        // Desactivar la sucursal no toca la asignación, pero deja de ser efectiva.
        await desactivarSucursalDeBase(norte);
        expect(await deAna()).toEqual([e.sucursal]);
        expect(
          await filas("select activa from asignacion_sucursal where sucursal_id = $1", [norte]),
        ).toEqual([{ activa: true }]);

        // Al reactivarla, la gente vuelve como estaba.
        await dueno.query("update sucursal set activa = true where id = $1", [norte]);
        expect(await deAna()).toEqual([e.sucursal, norte].sort());
      });

      it("el administrador ve lo mismo que el gerente, incluso de las sucursales donde no está asignado (F1)", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const admin = await miembro(e, "ADMINISTRADOR");
        const ana = await miembro(e, "OPERADOR");
        await crearAsignacionDeBase(dueno, e.empresa, ana.id, norte);
        await crearAsignacionDeBase(dueno, e.empresa, admin.id, e.sucursal);

        const delGerente = await consultas.listarMiembros(e.ctx);
        const delAdmin = await consultas.listarMiembros(admin.ctx);
        expect(delAdmin).toEqual(delGerente);
        expect(
          delAdmin.ok && delAdmin.valor.find((m) => m.personaId === ana.id)?.sucursales,
        ).toEqual([norte]);
      });

      it("no mezcla empresas: la persona que está en dos empresas figura en cada una con las sucursales de esa empresa", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const c = await escenario(); // otro tenant
        const norteA = await sucursalExtra(a, "Norte A");
        const norteB = await sucursalExtra(b, "Norte B");
        const compartida = await crearPersonaDeBase(dueno, "compartida@prueba.test");
        await crearMembresiaDeBase(dueno, a.empresa, compartida.id, "OPERADOR");
        await crearMembresiaDeBase(dueno, b.empresa, compartida.id, "ADMINISTRADOR");
        await crearAsignacionDeBase(dueno, a.empresa, compartida.id, norteA);
        await crearAsignacionDeBase(dueno, b.empresa, compartida.id, norteB);
        const soloB = await miembro(b, "OPERADOR", true, "solo-b@prueba.test");
        const soloC = await miembro(c, "OPERADOR", true, "solo-c@prueba.test");

        const deA = await consultas.listarMiembros(a.ctx);
        const deB = await consultas.listarMiembros(b.ctx);
        const deC = await consultas.listarMiembros(c.ctx);

        const ids = (r: typeof deA) => (r.ok ? r.valor.map((m) => m.personaId) : []);
        expect(ids(deA)).toEqual(expect.arrayContaining([a.gerente, personaId(compartida.id)]));
        expect(ids(deA)).toHaveLength(2);
        expect(ids(deB)).toHaveLength(3);
        expect(ids(deB)).toEqual(
          expect.arrayContaining([b.gerente, personaId(compartida.id), soloB.id]),
        );
        expect(ids(deC)).toHaveLength(2);
        expect(ids(deC)).toEqual(expect.arrayContaining([c.gerente, soloC.id]));
        expect(deA.ok && deA.valor.find((m) => m.personaId === compartida.id)).toMatchObject({
          rol: "OPERADOR",
          sucursales: [norteA],
        });
        expect(deB.ok && deB.valor.find((m) => m.personaId === compartida.id)).toMatchObject({
          rol: "ADMINISTRADOR",
          sucursales: [norteB],
        });
      });

      it("corre en read committed y solo lectura, y no escribe nada", async () => {
        const e = await escenario();
        const antes = await foto([e.empresa]);
        opcionesVistas.length = 0;
        await consultas.listarMiembros(e.ctx);
        expect(opcionesVistas).toHaveLength(1);
        expect(opcionesVistas[0]).toMatchObject({
          aislamiento: "read committed",
          soloLectura: true,
        });
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("una empresa suspendida (o con el tenant suspendido) sigue viendo a su gente: la lectura no exige que opere", async () => {
        const e = await escenario();
        await miembro(e, "OPERADOR");
        await suspenderEmpresa(e.empresa);
        const r = await consultas.listarMiembros(e.ctx);
        expect(r.ok && r.valor).toHaveLength(2);

        const f = await escenario();
        await suspenderTenant(f.tenant);
        const s = await consultas.listarMiembros(f.ctx);
        expect(s.ok && s.valor).toHaveLength(1);
      });
    });

    // =============================================================================================
    describe("listarInvitacionesPendientes", () => {
      it("lista las pendientes, vigentes y vencidas, con el contrato exacto y sin el token ni su hash", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        const vigente = await invitar(e, {
          email: "vigente@prueba.test",
          rol: "ADMINISTRADOR",
          sucursales: [e.sucursal, norte],
        });
        const vencida = await crearInvitacionDeBase(dueno, {
          tenant: e.tenant,
          email: "vencida@prueba.test",
          emitidaPor: e.gerente,
          emitidaEn: en(-20),
          venceEn: en(-13),
        });
        await incluirEmpresa(dueno, vencida, e.empresa, "OPERADOR", []);
        const delSistema = await crearInvitacionDeBase(dueno, {
          tenant: e.tenant,
          email: "sistema@prueba.test",
          emitidaEn: en(-1),
          venceEn: en(6),
        });
        await incluirEmpresa(dueno, delSistema, e.empresa, "OPERADOR", [norte]);

        const r = await consultas.listarInvitacionesPendientes(e.ctx);

        expect(r).toEqual({
          ok: true,
          valor: [
            {
              invitacionId: invitacionId(delSistema.id),
              email: "sistema@prueba.test",
              rol: "OPERADOR",
              sucursales: [norte],
              emitidaEn: en(-1).toISOString(),
              venceEn: en(6).toISOString(),
              vencida: false,
              emitidaPor: null,
            },
            {
              invitacionId: vencida.id,
              email: "vencida@prueba.test",
              rol: "OPERADOR",
              sucursales: [],
              emitidaEn: en(-20).toISOString(),
              venceEn: en(-13).toISOString(),
              vencida: true,
              emitidaPor: e.gerente,
            },
            {
              invitacionId: vigente.id,
              email: "vigente@prueba.test",
              rol: "ADMINISTRADOR",
              sucursales: [e.sucursal, norte].sort(),
              emitidaEn: ahora.toISOString(),
              venceEn: en(7).toISOString(),
              vencida: false,
              emitidaPor: e.gerente,
            },
          ],
        });
        const texto = JSON.stringify(r);
        expect(texto).not.toContain(vigente.token);
        expect(texto).not.toMatch(/token|hash/i);
      });

      it("vencida: `ahora` igual al vencimiento ya es vencida, un milisegundo antes no, y coincide con el dominio", async () => {
        const e = await escenario();
        const mismoInstante = await crearInvitacionDeBase(dueno, {
          tenant: e.tenant,
          email: "justo@prueba.test",
          emitidaEn: en(-7),
          venceEn: ahora,
        });
        const unMilisegundoAntes = await crearInvitacionDeBase(dueno, {
          tenant: e.tenant,
          email: "casi@prueba.test",
          emitidaEn: en(-7),
          venceEn: new Date(ahora.getTime() + 1),
        });
        for (const i of [mismoInstante, unMilisegundoAntes]) {
          await incluirEmpresa(dueno, i, e.empresa, "OPERADOR");
        }

        const r = await consultas.listarInvitacionesPendientes(e.ctx);
        const vencidas = r.ok ? r.valor.map((i) => [i.email, i.vencida]) : r;
        expect(vencidas).toEqual([
          ["casi@prueba.test", false],
          ["justo@prueba.test", true],
        ]);

        // La consulta no importa el dominio: la regla está repetida y esta prueba las ata.
        for (const i of [mismoInstante, unMilisegundoAntes]) {
          const guardada = (await invitacion(i.id)) as Fila;
          const deDominio = {
            estado: "PENDIENTE",
            venceEn: guardada["vence_en"],
          } as unknown as Invitacion;
          const delDominio = estadoDeInvitacion(deDominio, ahora) === "VENCIDA";
          const dePantalla = r.ok && r.valor.find((x) => x.invitacionId === i.id)?.vencida;
          expect(dePantalla).toBe(delDominio);
        }
      });

      it("solo las pendientes de usuario: no salen las aceptadas, las revocadas ni el alta del gerente", async () => {
        const e = await escenario();
        const pendiente = await invitar(e);
        const aceptada = await invitar(e);
        await casos.aceptarInvitacion({
          token: aceptada.token,
          emailAutenticado: aceptada.email,
          usuarioAuth: usuarioDePrueba(aceptada.email),
          marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
          ahora,
        });
        const revocada = await invitar(e);
        await casos.revocarInvitacion(e.ctx, { invitacionId: revocada.id });
        const reenviada = await invitar(e);
        const nueva = await casos.reenviarInvitacion(e.ctx, { invitacionId: reenviada.id });
        const alta = await crearInvitacionDeBase(dueno, { tenant: e.tenant, tipo: "ALTA_GERENTE" });
        await incluirEmpresa(dueno, alta, e.empresa, "GERENTE");
        const aceptadaDeBase = await crearInvitacionDeBase(dueno, { tenant: e.tenant });
        await incluirEmpresa(dueno, aceptadaDeBase, e.empresa, "OPERADOR");
        const persona = await crearPersonaDeBase(dueno, aceptadaDeBase.email);
        await aceptarDeBase(dueno, aceptadaDeBase, persona.id);

        const r = await consultas.listarInvitacionesPendientes(e.ctx);

        expect(r.ok && r.valor.map((i) => i.invitacionId).sort()).toEqual(
          [pendiente.id, nueva.ok ? nueva.valor.invitacionId : "?"].sort(),
        );
      });

      it("una invitación a varias empresas figura en cada una con el rol y las sucursales de esa empresa", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const norteB = await sucursalExtra(b, "Norte B");
        const { inv } = await invitacionMultiempresa([
          { e: a, rol: "OPERADOR", sucursales: [a.sucursal] },
          { e: b, rol: "ADMINISTRADOR", sucursales: [norteB] },
        ]);

        const deA = await consultas.listarInvitacionesPendientes(a.ctx);
        const deB = await consultas.listarInvitacionesPendientes(b.ctx);

        expect(deA.ok && deA.valor).toMatchObject([
          { invitacionId: inv.id, rol: "OPERADOR", sucursales: [a.sucursal] },
        ]);
        expect(deB.ok && deB.valor).toMatchObject([
          { invitacionId: inv.id, rol: "ADMINISTRADOR", sucursales: [norteB] },
        ]);
      });

      it("no mezcla empresas: cada una ve solo las suyas (ni las del mismo tenant ni las de otro)", async () => {
        const a = await escenario();
        const b = await escenario(a.tenant);
        const c = await escenario();
        const deA = await invitar(a);
        const deB = await invitar(b);
        const deC = await invitar(c);

        const idsDe = async (e: Escenario) => {
          const r = await consultas.listarInvitacionesPendientes(e.ctx);
          return r.ok ? r.valor.map((i) => i.invitacionId) : r;
        };
        expect(await idsDe(a)).toEqual([deA.id]);
        expect(await idsDe(b)).toEqual([deB.id]);
        expect(await idsDe(c)).toEqual([deC.id]);
      });

      it("revocar la saca de la lista, y reenviar deja solo la nueva", async () => {
        const e = await escenario();
        const primera = await invitar(e);
        const segunda = await invitar(e);
        const ids = async () => {
          const r = await consultas.listarInvitacionesPendientes(e.ctx);
          return r.ok ? r.valor.map((i) => i.invitacionId).sort() : r;
        };
        expect(await ids()).toEqual([primera.id, segunda.id].sort());
        await casos.revocarInvitacion(e.ctx, { invitacionId: primera.id });
        expect(await ids()).toEqual([segunda.id]);
        const nueva = await casos.reenviarInvitacion(e.ctx, { invitacionId: segunda.id });
        expect(await ids()).toEqual([nueva.ok ? nueva.valor.invitacionId : "?"]);
      });

      it("sin invitaciones devuelve una lista vacía", async () => {
        const e = await escenario();
        expect(await consultas.listarInvitacionesPendientes(e.ctx)).toEqual({
          ok: true,
          valor: [],
        });
      });

      it("corre en read committed y solo lectura, y no escribe nada", async () => {
        const e = await escenario();
        await invitar(e);
        const antes = await foto([e.empresa]);
        opcionesVistas.length = 0;
        await consultas.listarInvitacionesPendientes(e.ctx);
        expect(opcionesVistas).toHaveLength(1);
        expect(opcionesVistas[0]).toMatchObject({
          aislamiento: "read committed",
          soloLectura: true,
        });
        expect(await foto([e.empresa])).toBe(antes);
      });

      it("una empresa suspendida sigue viendo sus invitaciones pendientes", async () => {
        const e = await escenario();
        await invitar(e);
        await suspenderEmpresa(e.empresa);
        const r = await consultas.listarInvitacionesPendientes(e.ctx);
        expect(r.ok && r.valor).toHaveLength(1);
      });
    });

    // =============================================================================================
    describe("autorización por rol (en el servidor)", () => {
      type Actor = { nombre: string; armar: (e: Escenario) => Promise<ContextoOperativo> };
      const sinPermiso: Actor[] = [
        { nombre: "un operador", armar: async (e) => (await miembro(e, "OPERADOR")).ctx },
        {
          nombre: "un administrador apagado",
          armar: async (e) => (await miembro(e, "ADMINISTRADOR", false)).ctx,
        },
        {
          nombre: "una persona que no es miembro",
          armar: async (e) =>
            comoEmpresa(e.empresa, personaId((await crearPersonaDeBase(dueno)).id)),
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
            await dueno.query("update persona set activo_global = false where id = $1", [
              e.gerente,
            ]);
            return e.ctx;
          },
        },
      ];

      for (const actor of sinPermiso) {
        it(`${actor.nombre} no revoca ni lista: SIN_PERMISO y nada escrito`, async () => {
          const e = await escenario();
          const { id } = await invitar(e);
          const ctx = await actor.armar(e);
          const antes = await foto([e.empresa]);
          const esperado = { ok: false, error: "SIN_PERMISO" };

          expect(await casos.revocarInvitacion(ctx, { invitacionId: id })).toEqual(esperado);
          expect(await consultas.listarMiembros(ctx)).toEqual(esperado);
          expect(await consultas.listarInvitacionesPendientes(ctx)).toEqual(esperado);
          expect(await foto([e.empresa])).toBe(antes);
          expect(await invitacion(id)).toMatchObject({ estado: "PENDIENTE" });
        });
      }

      it("la baja de un administrador surte efecto en la operación siguiente (nada se guarda en sesión)", async () => {
        const e = await escenario();
        const admin = await miembro(e, "ADMINISTRADOR");
        const { id } = await invitar(e);
        expect((await consultas.listarMiembros(admin.ctx)).ok).toBe(true);
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa, admin.id],
        );
        expect(await casos.revocarInvitacion(admin.ctx, { invitacionId: id })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(await consultas.listarMiembros(admin.ctx)).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      });
    });

    // =============================================================================================
    describe("la empresa tiene que operar", () => {
      const sinOperar: {
        nombre: string;
        preparar: (e: Escenario) => Promise<unknown>;
        motivo: string;
      }[] = [
        {
          nombre: "suspendida",
          preparar: (e) => suspenderEmpresa(e.empresa),
          motivo: "EMPRESA_SUSPENDIDA",
        },
        {
          nombre: "con el tenant suspendido",
          preparar: (e) => suspenderTenant(e.tenant),
          motivo: "TENANT_SUSPENDIDO",
        },
      ];

      for (const caso of sinOperar) {
        it(`una empresa ${caso.nombre} no revoca: EMPRESA_NO_OPERA y nada escrito`, async () => {
          const e = await escenario();
          const { id } = await invitar(e);
          await caso.preparar(e);
          const antes = await foto([e.empresa]);
          expect(await casos.revocarInvitacion(e.ctx, { invitacionId: id })).toEqual({
            ok: false,
            error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: caso.motivo },
          });
          expect(await foto([e.empresa])).toBe(antes);
        });
      }

      it("una empresa todavía en alta (PROVISIONING) no opera", async () => {
        const enAlta = await crearEmpresaEnAlta(entorno);
        const g = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, enAlta.empresa, g.id, "GERENTE");
        expect(
          await casos.revocarInvitacion(comoEmpresa(enAlta.empresa, personaId(g.id)), {
            invitacionId: invitacionId(randomUUID()),
          }),
        ).toEqual({
          ok: false,
          error: {
            codigo: "EMPRESA_NO_OPERA",
            empresaId: enAlta.empresa,
            motivo: "EMPRESA_EN_ALTA",
          },
        });
      });

      it("el motivo del guard va antes que el de la empresa: sin permiso, SIN_PERMISO aunque no opere", async () => {
        const e = await escenario();
        const op = await miembro(e, "OPERADOR");
        const { id } = await invitar(e);
        await suspenderEmpresa(e.empresa);
        expect(await casos.revocarInvitacion(op.ctx, { invitacionId: id })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      });

      it("invitar a una sucursal desactivada en una empresa que no opera da EMPRESA_NO_OPERA (la empresa va antes que la sucursal)", async () => {
        const e = await escenario();
        const norte = await sucursalExtra(e, "Sucursal norte");
        await desactivarSucursalDeBase(norte);
        await suspenderEmpresa(e.empresa);
        expect(
          await casos.invitarUsuario(e.ctx, {
            email: emailAlAzar(),
            rol: "OPERADOR",
            sucursales: [norte],
          }),
        ).toMatchObject({ ok: false, error: { codigo: "EMPRESA_NO_OPERA" } });
      });
    });
  },
);
