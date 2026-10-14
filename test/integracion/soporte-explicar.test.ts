import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import { crearCasosDeUsoDeEmpresas } from "../../src/modulos/empresas/publico";
import { crearCasosDeUsoDeIdentidad } from "../../src/modulos/identidad/publico";
import type { SalidaDeExplicar } from "../../src/plataforma/casos-de-uso/explicar-por-que";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { Tokens } from "../../src/puertos/tokens";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import {
  aceptarDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  revocarDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import { adminInexistente, claveAlAzar, crearAdminDeBase } from "./plataforma-apoyo";
import { crearCasosDeSoporte, crearEntornoDeSoporte } from "./soporte-apoyo";
import { plataformaEn } from "./soporte-datos";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";

/**
 * «Explicar por qué» (H5 §B.5.9) contra una base real: qué deja asentado (y que es lo ÚNICO que escribe),
 * la idempotencia con Postgres, la atomicidad y, sobre todo, la FIDELIDAD: lo que explica es lo que
 * responden de verdad los casos de uso reales de empresa e identidad. Base propia de este archivo.
 */

const base = inject("baseDePruebas");
const DIA = 86_400_000;
const AHORA = AHORA_DE_PRUEBA;
const admin = plataformaEn(AHORA);
const soporte = plataformaEn(AHORA, { tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });

/** Las tablas cuyo contenido NO puede cambiar por explicar (todas menos las dos que escribe). */
const TABLAS_QUE_NO_CAMBIAN = [
  "tenant",
  "empresa",
  "sucursal",
  "persona",
  "membresia_tenant",
  "membresia",
  "asignacion_sucursal",
  "invitacion",
  "invitacion_empresa",
  "invitacion_sucursal",
  "trabajo",
  "auditoria_empresa",
  "auditoria_acceso_grupo",
  "referencia_de_error",
  "admin_plataforma",
] as const;

describe.skipIf(base === null)(
  "soporte de plataforma: explicar por qué contra una base real",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let soporteEnv: ReturnType<typeof crearEntornoDeSoporte>;
    let casos: ReturnType<typeof crearCasosDeSoporte>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let tokens: Tokens;
    let reales: ReturnType<typeof crearCasosDeUsoDeEmpresas>;
    let identidad: ReturnType<typeof crearCasosDeUsoDeIdentidad>;
    let bajaId: ReturnType<typeof adminInexistente>;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      soporteEnv = crearEntornoDeSoporte(propia.base, 10);
      casos = crearCasosDeSoporte(soporteEnv);
      entorno = crearEntornoDePrueba(propia.base, 10);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      bajaId = (await crearAdminDeBase(dueno, { activo: false })).id;
      tokens = crearTokensHmac(randomBytes(32));
      reales = crearCasosDeUsoDeEmpresas({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
      identidad = crearCasosDeUsoDeIdentidad({
        transacciones: entorno,
        tokens,
        reglas: REGLAS_DE_EMPRESA,
      });
    });
    afterAll(async () => {
      await dueno.end();
      await soporteEnv.cerrar();
      await entorno.cerrar();
      await propia.destruir();
    });

    const filas = async (texto: string, parametros: unknown[] = []) =>
      (await dueno.query<Record<string, unknown>>(texto, parametros)).rows;
    const cuenta = async (tabla: string) =>
      Number((await filas(`select count(*)::int as n from ${tabla}`))[0]?.["n"]);

    /** La «foto» de las tablas que no pueden cambiar: cuántas filas y un resumen de su contenido. */
    const foto = async () => {
      const resultado: Record<string, unknown> = {};
      for (const tabla of TABLAS_QUE_NO_CAMBIAN) {
        resultado[tabla] = (
          await filas(
            `select count(*)::int as n, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as huella from ${tabla} t`,
          )
        )[0];
      }
      return resultado;
    };

    const constancias = (entidadId?: string) =>
      filas(
        `select actor, accion, entidad, entidad_id, antes, despues from auditoria_plataforma
       where accion = 'SOPORTE_EXPLICAR' and ($1::text is null or entidad_id = $1) order by id`,
        [entidadId ?? null],
      );
    const claves = () =>
      filas(
        "select admin_id, clave, operacion from idempotencia_plataforma order by creado_en, clave",
      );

    // ---- escenarios ---------------------------------------------------------------------------

    type Escenario = EmpresaDePrueba & Readonly<{ gerente: string; emailDelGerente: string }>;

    /** Una empresa activa con su gerente (miembro activo). */
    const escenario = async (): Promise<Escenario> => {
      const e = await crearEmpresaActiva(entorno);
      const g = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
      return { ...e, gerente: g.id, emailDelGerente: g.email };
    };

    const miembro = async (e: Escenario, rol: RolDePrueba, activo = true) => {
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, p.id, rol, activo);
      return p;
    };

    const explicarAccion = (
      e: { empresa: string },
      persona: { email: string } | { id: string },
      accion: string,
      contexto: ContextoDePlataforma = admin,
      claveDeIdempotencia = claveAlAzar(),
    ) =>
      casos.explicarPorQue(contexto, {
        claveDeIdempotencia,
        objetivo: {
          tipo: "ACCION",
          empresaId: e.empresa,
          persona:
            "email" in persona
              ? { por: "EMAIL", email: persona.email }
              : { por: "ID", personaId: persona.id },
          accion,
        },
      });

    const esperarOk = <T extends SalidaDeExplicar>(r: {
      ok: boolean;
      valor?: T;
      error?: unknown;
    }): T => {
      if (!r.ok || r.valor === undefined) throw new Error(`no esperaba ${JSON.stringify(r)}`);
      return r.valor;
    };

    // ===========================================================================================
    // Lo que deja asentado, y lo único que escribe
    // ===========================================================================================
    describe("auditoría de acceso", () => {
      it("deja EXACTAMENTE una constancia y una clave de idempotencia, y no cambia nada más", async () => {
        const e = await escenario();
        const antes = await foto();
        const constanciasAntes = await cuenta("auditoria_plataforma");
        const clavesAntes = await cuenta("idempotencia_plataforma");

        const clave = claveAlAzar();
        const r = await explicarAccion(
          e,
          { email: e.emailDelGerente },
          "sucursales.crear",
          admin,
          clave,
        );
        const salida = esperarOk(r);
        expect(salida).toMatchObject({
          tipo: "ACCION",
          empresaId: e.empresa,
          personaId: e.gerente,
        });

        expect(await foto()).toEqual(antes);
        expect(await cuenta("auditoria_plataforma")).toBe(constanciasAntes + 1);
        expect(await cuenta("idempotencia_plataforma")).toBe(clavesAntes + 1);
        expect(await constancias(e.empresa)).toEqual([
          {
            actor: ADMIN_DE_PRUEBA,
            accion: "SOPORTE_EXPLICAR",
            entidad: "empresa",
            entidad_id: e.empresa,
            antes: null,
            despues: {
              objetivo: "ACCION",
              accion: "sucursales.crear",
              personaId: e.gerente,
              resultado: "PERMITIDA",
            },
          },
        ]);
        expect((await claves()).filter((c) => c["clave"] === clave)).toEqual([
          { admin_id: ADMIN_DE_PRUEBA, clave, operacion: "soporte.explicar" },
        ]);
      });

      it("el actor de la constancia es quien explicó: un ADMIN o un SOPORTE", async () => {
        const e = await escenario();
        await explicarAccion(e, { id: e.gerente }, "sucursales.ver", admin);
        await explicarAccion(e, { id: e.gerente }, "sucursales.ver", soporte);
        expect((await constancias(e.empresa)).map((c) => c["actor"])).toEqual([
          ADMIN_DE_PRUEBA,
          SOPORTE_DE_PRUEBA,
        ]);
      });

      it("la constancia no lleva el email de nadie ni nada que parezca un secreto", async () => {
        const e = await escenario();
        await explicarAccion(e, { email: e.emailDelGerente }, "sucursales.crear");
        const rastro = JSON.stringify(await constancias(e.empresa));
        expect(rastro).not.toContain(e.emailDelGerente);
        expect(rastro).not.toContain("@");
        expect(rastro).not.toMatch(/token|hash|secret/i);
      });

      it("explicar una aceptación deja la constancia sobre la invitación", async () => {
        const e = await escenario();
        const emitido = tokens.emitir();
        const inv = await crearInvitacionDeBase(dueno, {
          tenant: e.tenant,
          id: emitido.invitacionId,
          tokenHash: emitido.tokenHash,
          emitidaEn: new Date(AHORA.getTime() - DIA),
          venceEn: new Date(AHORA.getTime() + DIA),
        });
        await incluirEmpresa(dueno, inv, e.empresa, "OPERADOR");
        const antes = await foto();
        const r = await casos.explicarPorQue(soporte, {
          claveDeIdempotencia: claveAlAzar(),
          objetivo: { tipo: "ACEPTACION", invitacionId: inv.id },
        });
        expect(esperarOk(r)).toMatchObject({
          tipo: "ACEPTACION",
          invitacionId: inv.id,
          explicacion: {
            estadoDeLaInvitacion: "PENDIENTE",
            decision: { ok: true, valor: { tipo: "ACEPTAR" } },
          },
        });
        expect(await foto()).toEqual(antes);
        expect(await constancias(inv.id)).toEqual([
          {
            actor: SOPORTE_DE_PRUEBA,
            accion: "SOPORTE_EXPLICAR",
            entidad: "invitacion",
            entidad_id: inv.id,
            antes: null,
            despues: { objetivo: "ACEPTACION", resultado: "ACEPTAR" },
          },
        ]);
      });

      it("lo que no se pudo explicar (empresa o invitación inexistente) no deja constancia ni clave", async () => {
        const antes = await foto();
        const constanciasAntes = await cuenta("auditoria_plataforma");
        const clavesAntes = await cuenta("idempotencia_plataforma");
        expect(
          await explicarAccion(
            { empresa: "00000000-0000-4000-8000-0000000000aa" },
            { id: "00000000-0000-4000-8000-0000000000bb" },
            "sucursales.ver",
          ),
        ).toEqual({ ok: false, error: "EMPRESA_NO_ENCONTRADA" });
        expect(
          await casos.explicarPorQue(admin, {
            claveDeIdempotencia: claveAlAzar(),
            objetivo: { tipo: "ACEPTACION", invitacionId: "00000000-0000-4000-8000-0000000000cc" },
          }),
        ).toEqual({ ok: false, error: "INVITACION_NO_ENCONTRADA" });
        expect(await foto()).toEqual(antes);
        expect(await cuenta("auditoria_plataforma")).toBe(constanciasAntes);
        expect(await cuenta("idempotencia_plataforma")).toBe(clavesAntes);
      });

      it("quien no es un administrador vigente recibe SIN_PERMISO y no deja nada", async () => {
        const e = await escenario();
        const antes = await foto();
        const constanciasAntes = await cuenta("auditoria_plataforma");
        const clavesAntes = await cuenta("idempotencia_plataforma");
        for (const contexto of [
          plataformaEn(AHORA, { tipo: "ADMIN", id: bajaId }),
          plataformaEn(AHORA, { tipo: "ADMIN", id: adminInexistente() }),
          plataformaEn(AHORA, { tipo: "SISTEMA", proceso: "barrido" }),
        ]) {
          expect(await explicarAccion(e, { id: e.gerente }, "sucursales.ver", contexto)).toEqual({
            ok: false,
            error: "SIN_PERMISO",
          });
        }
        expect(await foto()).toEqual(antes);
        expect(await cuenta("auditoria_plataforma")).toBe(constanciasAntes);
        expect(await cuenta("idempotencia_plataforma")).toBe(clavesAntes);
      });
    });

    // ===========================================================================================
    // Idempotencia
    // ===========================================================================================
    describe("idempotencia", () => {
      it("repetir el pedido con la misma clave devuelve lo mismo y deja UNA sola constancia", async () => {
        const e = await escenario();
        const administrador = await miembro(e, "ADMINISTRADOR");
        const clave = claveAlAzar();
        const primera = await explicarAccion(
          e,
          { email: administrador.email },
          "sucursales.crear",
          admin,
          clave,
        );
        // Mientras tanto la realidad cambió: la repetición devuelve lo que se explicó, no lo de ahora.
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa, administrador.id],
        );
        const segunda = await explicarAccion(
          e,
          { email: administrador.email },
          "sucursales.crear",
          admin,
          clave,
        );
        expect(segunda).toEqual(primera);
        expect(esperarOk(segunda)).toMatchObject({ explicacion: { rol: "ADMINISTRADOR" } });
        expect(await constancias(e.empresa)).toHaveLength(1);
        expect((await claves()).filter((c) => c["clave"] === clave)).toHaveLength(1);
        // Otra clave es otro pedido: ve la realidad de ahora.
        const otra = await explicarAccion(e, { email: administrador.email }, "sucursales.crear");
        expect(esperarOk(otra)).toMatchObject({
          explicacion: { rol: null, razonDelRol: "MEMBRESIA_APAGADA" },
        });
        expect(await constancias(e.empresa)).toHaveLength(2);
      });

      it("la misma clave con OTRO pedido es CLAVE_REUTILIZADA y no escribe nada", async () => {
        const e = await escenario();
        const clave = claveAlAzar();
        await explicarAccion(e, { email: e.emailDelGerente }, "sucursales.crear", admin, clave);
        const constanciasAntes = await cuenta("auditoria_plataforma");
        expect(
          await explicarAccion(e, { email: e.emailDelGerente }, "sucursales.ver", admin, clave),
        ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
        expect(await cuenta("auditoria_plataforma")).toBe(constanciasAntes);
      });

      it("dos administradores pueden usar la misma clave sin chocar, cada uno con su constancia", async () => {
        const e = await escenario();
        const clave = claveAlAzar();
        const a = await explicarAccion(e, { id: e.gerente }, "sucursales.ver", admin, clave);
        const b = await explicarAccion(e, { id: e.gerente }, "sucursales.ver", soporte, clave);
        expect(a.ok && b.ok).toBe(true);
        expect((await constancias(e.empresa)).map((c) => c["actor"])).toEqual([
          ADMIN_DE_PRUEBA,
          SOPORTE_DE_PRUEBA,
        ]);
      });

      it("una clave con forma inválida es un error con nombre", async () => {
        const e = await escenario();
        const r = await explicarAccion(e, { id: e.gerente }, "sucursales.ver", admin, "corta");
        expect(r).toEqual({ ok: false, error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA" });
      });
    });

    // ===========================================================================================
    // Atomicidad
    // ===========================================================================================
    describe("atomicidad", () => {
      it("si falla al guardar la clave después de asentar la constancia, no queda NADA", async () => {
        const fallida = crearEntornoDeSoporte(propia.base, 3, (tx) => ({
          ...tx,
          idempotencia: {
            ...tx.idempotencia,
            registrar: () => Promise.reject(new Error("falla forzada al registrar la clave")),
          },
        }));
        try {
          const e = await escenario();
          const casosFallidos = crearCasosDeSoporte(fallida);
          const constanciasAntes = await cuenta("auditoria_plataforma");
          const clavesAntes = await cuenta("idempotencia_plataforma");
          await expect(
            casosFallidos.explicarPorQue(admin, {
              claveDeIdempotencia: claveAlAzar(),
              objetivo: {
                tipo: "ACCION",
                empresaId: e.empresa,
                persona: { por: "ID", personaId: e.gerente },
                accion: "sucursales.ver",
              },
            }),
          ).rejects.toThrow("falla forzada");
          expect(await cuenta("auditoria_plataforma")).toBe(constanciasAntes);
          expect(await cuenta("idempotencia_plataforma")).toBe(clavesAntes);
        } finally {
          await fallida.cerrar();
        }
      });
    });

    // ===========================================================================================
    // Fidelidad contra los casos de uso reales
    // ===========================================================================================
    describe("fidelidad: lo explicado es lo que responden los casos de uso reales", () => {
      type Persona = { id: string; email: string };

      /** Lo que responde el caso de uso REAL de empresa a esa persona, para `sucursales.crear`. */
      const realCrear = (empresa: string, persona: string) =>
        reales.crearSucursal(comoEmpresa(empresaId(empresa), personaId(persona)), {
          nombre: `Sucursal ${randomBytes(4).toString("hex")}`,
        });
      /** Y para `sucursales.desactivar` (solo el gerente) y `sucursales.ver` (gerente y administrador). */
      const realDesactivar = (empresa: string, persona: string) =>
        reales.desactivarSucursal(comoEmpresa(empresaId(empresa), personaId(persona)), {
          sucursalId: "00000000-0000-4000-8000-0000000000ee" as never,
        });

      /** Compara lo explicado con lo real: un rechazo del guard o de «la empresa no opera» tiene que coincidir. */
      const compararConLoReal = async (
        e: { empresa: string },
        persona: Persona,
        accion: "sucursales.crear" | "sucursales.desactivar",
      ) => {
        const explicada = esperarOk(await explicarAccion(e, { id: persona.id }, accion));
        if (explicada.tipo !== "ACCION") throw new Error("no era una acción");
        const real =
          accion === "sucursales.crear"
            ? await realCrear(e.empresa, persona.id)
            : await realDesactivar(e.empresa, persona.id);
        const { decision } = explicada.explicacion;
        if (decision.ok) {
          // Pasó el guard y la empresa opera: lo real NO puede ser un rechazo del guard ni de «no opera».
          const rechazo =
            !real.ok &&
            (real.error === "SIN_PERMISO" ||
              (typeof real.error === "object" &&
                "codigo" in real.error &&
                real.error.codigo === "EMPRESA_NO_OPERA"));
          expect(rechazo, `${accion}: lo explicado permitía y lo real rechazó`).toBe(false);
        } else {
          expect(real.ok, `${accion}: lo explicado rechazaba y lo real anduvo`).toBe(false);
          if (!real.ok) expect(real.error).toEqual(decision.error);
        }
        return decision;
      };

      it("cada rol, en una empresa que opera, para una acción de gerente y administrador y otra solo de gerente", async () => {
        const e = await escenario();
        const resultados: Record<string, unknown> = {};
        for (const [nombre, persona] of [
          ["GERENTE", { id: e.gerente, email: e.emailDelGerente }],
          ["ADMINISTRADOR", await miembro(e, "ADMINISTRADOR")],
          ["OPERADOR", await miembro(e, "OPERADOR")],
          ["APAGADA", await miembro(e, "ADMINISTRADOR", false)],
          ["SIN_MEMBRESIA", await crearPersonaDeBase(dueno)],
        ] as const) {
          for (const accion of ["sucursales.crear", "sucursales.desactivar"] as const) {
            const decision = await compararConLoReal(e, persona, accion);
            resultados[`${nombre} ${accion}`] = decision.ok ? "PERMITIDA" : decision.error;
          }
        }
        expect(resultados).toEqual({
          "GERENTE sucursales.crear": "PERMITIDA",
          "GERENTE sucursales.desactivar": "PERMITIDA",
          "ADMINISTRADOR sucursales.crear": "PERMITIDA",
          "ADMINISTRADOR sucursales.desactivar": "SIN_PERMISO",
          "OPERADOR sucursales.crear": "SIN_PERMISO",
          "OPERADOR sucursales.desactivar": "SIN_PERMISO",
          "APAGADA sucursales.crear": "SIN_PERMISO",
          "APAGADA sucursales.desactivar": "SIN_PERMISO",
          "SIN_MEMBRESIA sucursales.crear": "SIN_PERMISO",
          "SIN_MEMBRESIA sucursales.desactivar": "SIN_PERMISO",
        });
      });

      it("una persona suspendida globalmente pierde todos sus permisos aunque su membresía siga activa", async () => {
        const e = await escenario();
        const p = await miembro(e, "ADMINISTRADOR");
        await dueno.query("update persona set activo_global = false where id = $1", [p.id]);
        const decision = await compararConLoReal(e, p, "sucursales.crear");
        expect(decision).toEqual({ ok: false, error: "SIN_PERMISO" });
      });

      it("una persona que no existe no tiene ningún permiso", async () => {
        const e = await escenario();
        const decision = await compararConLoReal(
          e,
          { id: "00000000-0000-4000-8000-0000000000dd", email: "no-existe@x.test" },
          "sucursales.crear",
        );
        expect(decision).toEqual({ ok: false, error: "SIN_PERMISO" });
      });

      it("una empresa suspendida, un tenant suspendido y una empresa en alta no operan", async () => {
        const suspendida = await escenario();
        await dueno.query(
          "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [suspendida.empresa],
        );
        expect(
          await compararConLoReal(
            suspendida,
            { id: suspendida.gerente, email: "" },
            "sucursales.crear",
          ),
        ).toMatchObject({
          ok: false,
          error: { codigo: "EMPRESA_NO_OPERA", motivo: "EMPRESA_SUSPENDIDA" },
        });

        const delTenant = await escenario();
        await dueno.query(
          "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [delTenant.tenant],
        );
        expect(
          await compararConLoReal(
            delTenant,
            { id: delTenant.gerente, email: "" },
            "sucursales.crear",
          ),
        ).toMatchObject({
          ok: false,
          error: { codigo: "EMPRESA_NO_OPERA", motivo: "TENANT_SUSPENDIDO" },
        });

        const enAlta = await crearEmpresaEnAlta(entorno);
        const g = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, enAlta.empresa, g.id, "GERENTE");
        expect(await compararConLoReal(enAlta, g, "sucursales.crear")).toMatchObject({
          ok: false,
          error: { codigo: "EMPRESA_NO_OPERA", motivo: "EMPRESA_EN_ALTA" },
        });
      });

      // ---- aceptación ---------------------------------------------------------------------------

      type DatosDeInvitacion = Readonly<{
        tipo?: "ALTA_GERENTE" | "USUARIO";
        rol?: RolDePrueba;
        emitidaEn?: Date;
        venceEn?: Date;
      }>;

      /** Una invitación con token derivado (como el mail), a una empresa. */
      const invitacionA = async (
        empresa: EmpresaDePrueba,
        email: string,
        datos: DatosDeInvitacion = {},
      ) => {
        const emitido = tokens.emitir();
        const tipo = datos.tipo ?? "USUARIO";
        const inv = await crearInvitacionDeBase(dueno, {
          tenant: empresa.tenant,
          id: emitido.invitacionId,
          tokenHash: emitido.tokenHash,
          tipo,
          email,
          emitidaEn: datos.emitidaEn ?? new Date(AHORA.getTime() - DIA),
          venceEn: datos.venceEn ?? new Date(AHORA.getTime() + DIA),
        });
        await incluirEmpresa(
          dueno,
          inv,
          empresa.empresa,
          datos.rol ?? (tipo === "ALTA_GERENTE" ? "GERENTE" : "OPERADOR"),
        );
        return { inv, token: emitido.token };
      };

      const explicarAceptacion = async (invitacionId: string) => {
        const salida = esperarOk(
          await casos.explicarPorQue(admin, {
            claveDeIdempotencia: claveAlAzar(),
            objetivo: { tipo: "ACEPTACION", invitacionId },
          }),
        );
        if (salida.tipo !== "ACEPTACION") throw new Error("no era una aceptación");
        return salida.explicacion;
      };

      /** Lo explicado ANTES de aceptar tiene que ser lo que da aceptar de verdad. */
      const compararAceptacion = async (token: string, invitacionId: string, email: string) => {
        const explicada = await explicarAceptacion(invitacionId);
        const real = await identidad.aceptarInvitacion({
          token,
          emailAutenticado: email,
          usuarioAuth: usuarioDePrueba(email),
          marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
          ahora: AHORA,
        });
        if (explicada.decision.ok) {
          expect(real.ok, `explicaba que se aceptaba y lo real dio ${JSON.stringify(real)}`).toBe(
            true,
          );
          if (real.ok) {
            expect(real.valor.yaEstabaAceptada).toBe(
              explicada.decision.valor.tipo === "YA_ACEPTADA",
            );
          }
        } else {
          expect(real).toEqual({ ok: false, error: explicada.decision.error });
        }
        return explicada;
      };

      it("una invitación pendiente de alguien sin cuenta se acepta", async () => {
        const e = await escenario();
        const email = emailAlAzar("nuevo");
        const { inv, token } = await invitacionA(e, email);
        const explicada = await compararAceptacion(token, inv.id, email);
        expect(explicada.decision).toEqual({ ok: true, valor: { tipo: "ACEPTAR" } });
      });

      it("el alta del gerente de una empresa en alta se acepta; con la empresa ya activa, ALTA_NO_PENDIENTE", async () => {
        const enAlta = await crearEmpresaEnAlta(entorno);
        const email = emailAlAzar("gerente");
        const a = await invitacionA(enAlta, email, { tipo: "ALTA_GERENTE" });
        expect((await compararAceptacion(a.token, a.inv.id, email)).decision).toEqual({
          ok: true,
          valor: { tipo: "ACEPTAR" },
        });

        const activa = await escenario();
        const otro = emailAlAzar("gerente");
        const b = await invitacionA(activa, otro, { tipo: "ALTA_GERENTE" });
        expect((await compararAceptacion(b.token, b.inv.id, otro)).decision).toEqual({
          ok: false,
          error: "ALTA_NO_PENDIENTE",
        });
      });

      it("vencida, revocada y aceptada por otra: los errores coinciden con los reales", async () => {
        const e = await escenario();
        const emailVencida = emailAlAzar("vencida");
        const vencida = await invitacionA(e, emailVencida, {
          emitidaEn: new Date(AHORA.getTime() - 3 * DIA),
          venceEn: new Date(AHORA.getTime() - DIA),
        });
        expect(
          (await compararAceptacion(vencida.token, vencida.inv.id, emailVencida)).decision,
        ).toEqual({
          ok: false,
          error: "INVITACION_VENCIDA",
        });

        const emailRevocada = emailAlAzar("revocada");
        const revocada = await invitacionA(e, emailRevocada);
        await revocarDeBase(dueno, revocada.inv);
        expect(
          (await compararAceptacion(revocada.token, revocada.inv.id, emailRevocada)).decision,
        ).toEqual({
          ok: false,
          error: "INVITACION_REVOCADA",
        });

        // Aceptada por la persona del email: repetirla es ok (YA_ACEPTADA), igual que lo real.
        const emailAceptada = emailAlAzar("aceptada");
        const aceptada = await invitacionA(e, emailAceptada);
        const persona = await crearPersonaDeBase(dueno, emailAceptada);
        await crearMembresiaDeBase(dueno, e.empresa, persona.id, "OPERADOR");
        await aceptarDeBase(dueno, aceptada.inv, persona.id);
        const explicada = await compararAceptacion(aceptada.token, aceptada.inv.id, emailAceptada);
        expect(explicada.decision).toEqual({ ok: true, valor: { tipo: "YA_ACEPTADA" } });
      });

      it("persona suspendida, ya miembro y rol distinto al anterior", async () => {
        const e = await escenario();

        const emailSuspendida = emailAlAzar("suspendida");
        const suspendida = await crearPersonaDeBase(dueno, emailSuspendida);
        await dueno.query("update persona set activo_global = false where id = $1", [
          suspendida.id,
        ]);
        const a = await invitacionA(e, emailSuspendida);
        expect((await compararAceptacion(a.token, a.inv.id, emailSuspendida)).decision).toEqual({
          ok: false,
          error: "PERSONA_SUSPENDIDA",
        });

        const emailMiembro = emailAlAzar("miembro");
        const miembroActivo = await crearPersonaDeBase(dueno, emailMiembro);
        await crearMembresiaDeBase(dueno, e.empresa, miembroActivo.id, "OPERADOR");
        const b = await invitacionA(e, emailMiembro);
        expect((await compararAceptacion(b.token, b.inv.id, emailMiembro)).decision).toEqual({
          ok: false,
          error: "YA_ES_MIEMBRO",
        });

        const emailAnterior = emailAlAzar("anterior");
        const anterior = await crearPersonaDeBase(dueno, emailAnterior);
        await crearMembresiaDeBase(dueno, e.empresa, anterior.id, "ADMINISTRADOR", false);
        const c = await invitacionA(e, emailAnterior, { rol: "OPERADOR" });
        expect((await compararAceptacion(c.token, c.inv.id, emailAnterior)).decision).toEqual({
          ok: false,
          error: { codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: e.empresa },
        });

        // Con el MISMO rol anterior, la membresía apagada se reactiva.
        const emailMismo = emailAlAzar("mismo");
        const mismo = await crearPersonaDeBase(dueno, emailMismo);
        await crearMembresiaDeBase(dueno, e.empresa, mismo.id, "OPERADOR", false);
        const d = await invitacionA(e, emailMismo, { rol: "OPERADOR" });
        expect((await compararAceptacion(d.token, d.inv.id, emailMismo)).decision).toEqual({
          ok: true,
          valor: { tipo: "ACEPTAR" },
        });
      });

      it("una empresa suspendida o con el tenant suspendido no deja aceptar", async () => {
        const suspendida = await escenario();
        await dueno.query(
          "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [suspendida.empresa],
        );
        const email = emailAlAzar("a");
        const a = await invitacionA(suspendida, email);
        expect((await compararAceptacion(a.token, a.inv.id, email)).decision).toEqual({
          ok: false,
          error: {
            codigo: "EMPRESA_NO_OPERA",
            empresaId: suspendida.empresa,
            motivo: "EMPRESA_SUSPENDIDA",
          },
        });

        const delTenant = await escenario();
        await dueno.query(
          "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [delTenant.tenant],
        );
        const otro = emailAlAzar("b");
        const b = await invitacionA(delTenant, otro);
        expect((await compararAceptacion(b.token, b.inv.id, otro)).decision).toEqual({
          ok: false,
          error: {
            codigo: "EMPRESA_NO_OPERA",
            empresaId: delTenant.empresa,
            motivo: "TENANT_SUSPENDIDO",
          },
        });
      });
    });
  },
);
