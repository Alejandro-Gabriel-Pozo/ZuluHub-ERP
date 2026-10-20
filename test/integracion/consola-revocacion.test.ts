import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { darDeBajaAlAdmin } from "../../src/adaptadores/postgres/baja-de-admin";
import { resetearElSegundoFactor } from "../../src/adaptadores/postgres/reseteo-de-segundo-factor";
import { armarConexiones } from "../../src/composicion/conexiones";
import { armarTrabajos } from "../../src/composicion/trabajos";
import { ejecutarBajaDeAdmin } from "../../scripts/ejecutar-baja-de-admin";
import { ejecutarReseteoDelSegundoFactor } from "../../scripts/ejecutar-resetear-segundo-factor";
import { VARIABLE_DE_LA_CADENA } from "../../scripts/entrada-del-dueno";
import { empresaConMiembro, personaConUsuario } from "./autenticacion-apoyo";
import { Navegador } from "./autenticacion-ingreso-apoyo";
import { codigoDeLaAplicacion } from "./autenticacion-plataforma-apoyo";
import {
  HOST_DE_LA_CONSOLA,
  HOST_DE_LA_WEB,
  accesoDe,
  accesoOk,
  adminConSesionCompleta,
  armarMundo,
  enrolarYVerificar,
  ingresar,
  nuevoAdmin,
  pedir,
  sesionesDe,
  type Mundo,
} from "./consola-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * La revocación de sesiones (P8b, h5-p8 §2.5), contra una base real y la autenticación real de la consola:
 *  - el script del dueño `plataforma:baja-admin` (baja + todas sus sesiones en la misma operación, idempotente, auditado
 *    sin el email);
 *  - el script `plataforma:resetear-segundo-factor` (borra el TOTP, apaga la bandera, limpia intentos, revoca sesiones;
 *    el siguiente ingreso vuelve a enrolar);
 *  - el trabajo `revocar_sesiones` que encola la suspensión de una persona, ejecutado por el procesador REAL de la
 *    composición (rol de trabajos para la cola, rol de autenticación para borrar las sesiones).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const ejecutarArchivo = promisify(execFile);

describe.skipIf(base === null)("la revocación de sesiones", () => {
  let m: Mundo;

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("NODE_ENV", "production");
    m = await armarMundo(base);
  });
  afterAll(async () => {
    await m.cerrar();
    vi.unstubAllEnvs();
  });

  const n = async (consulta: string, parametros: unknown[] = []) =>
    Number(((await m.dueno.query<{ n: string }>(consulta, parametros)).rows[0] as { n: string }).n);
  const entornoDelDueno = () => ({ [VARIABLE_DE_LA_CADENA]: m.base.dueno });
  const conTodo = (...textos: string[]) => textos.join("\n");

  /** Un ingreso a la web de empresa con el mismo perfil (la tabla de sesiones y la cuenta son compartidas). */
  async function ingresarALaWeb(admin: Parameters<typeof ingresar>[1]): Promise<Navegador> {
    const nav = new Navegador();
    const r = await nav.ingresarConGoogle(m.web.autenticacion, HOST_DE_LA_WEB, m.proveedor, admin);
    expect(r.ubicacion).toBe("/");
    return nav;
  }

  const constancias = async (accion: string, adminId: string) =>
    (
      await m.dueno.query<{
        actor: string;
        entidad: string;
        antes: unknown;
        despues: Record<string, unknown>;
      }>(
        `select actor, entidad, antes, despues from auditoria_plataforma
          where accion = $1 and entidad_id = $2 order by id`,
        [accion, adminId],
      )
    ).rows;

  // =============================================================================================
  // plataforma:baja-admin
  // =============================================================================================
  describe("plataforma:baja-admin", () => {
    async function correrBaja(
      argumentos: string[],
      entorno: Record<string, string | undefined> = entornoDelDueno(),
      dar?: typeof darDeBajaAlAdmin,
    ) {
      const salida: string[] = [];
      const errores: string[] = [];
      const codigo = await ejecutarBajaDeAdmin({
        argumentos,
        entorno,
        info: (l) => salida.push(l),
        error: (l) => errores.push(l),
        ...(dar === undefined ? {} : { dar }),
      });
      return { codigo, salida, errores, texto: conTodo(...salida, ...errores) };
    }

    it("da de baja y cierra las sesiones de la consola Y de la web en la misma operación, y deja una constancia sin el email", async () => {
      const { admin, n: nav } = await adminConSesionCompleta(m);
      const otraConsola = await ingresar(m, admin);
      const web = await ingresarALaWeb(admin);
      expect(await sesionesDe(m, admin.email)).toBe(3);

      const r = await correrBaja([admin.email]);
      expect(r.codigo).toBe(0);
      expect(r.errores).toEqual([]);
      expect(r.salida).toEqual([
        `RESULTADO: OK, quedó dado de baja el administrador de plataforma (identificador ${admin.adminId}). Sesiones cerradas: 3.`,
      ]);
      expect(r.texto).not.toContain(admin.email);
      expect(r.texto).not.toContain(admin.email.split("@")[0]);
      expect(r.texto).not.toContain(m.base.dueno);

      expect(
        (await m.dueno.query("select activo from admin_plataforma where id = $1", [admin.adminId]))
          .rows,
      ).toEqual([{ activo: false }]);
      expect(await sesionesDe(m, admin.email)).toBe(0);
      // Ninguna cookie sirve: ni las dos de la consola ni la de la web.
      for (const x of [nav, otraConsola]) {
        expect(await accesoDe(m, x)).toEqual({ ok: false, error: "sesion_vencida" });
      }
      expect(
        await m.web.autenticacion.sesionDe(web.pedidoDe(HOST_DE_LA_WEB), HOST_DE_LA_WEB),
      ).toBeNull();

      const filas = await constancias("ADMIN_PLATAFORMA_BAJA", admin.adminId);
      expect(filas).toEqual([
        {
          actor: "sistema",
          entidad: "admin_plataforma",
          antes: { activo: true },
          despues: { activo: false, sesionesRevocadas: 3, origen: "script baja-de-admin" },
        },
      ]);
      expect(JSON.stringify(filas)).not.toContain(admin.email);
    });

    it("repetirla es idempotente: «ya estaba», sale con 0, no audita de nuevo (también con el email en mayúsculas)", async () => {
      const { admin } = await adminConSesionCompleta(m);
      await correrBaja([admin.email]);
      const segunda = await correrBaja([admin.email.toUpperCase()]);
      expect(segunda.codigo).toBe(0);
      expect(segunda.salida).toEqual([
        `RESULTADO: OK, ya estaba dado de baja (identificador ${admin.adminId}). Sesiones cerradas ahora: 0.`,
      ]);
      expect(await constancias("ADMIN_PLATAFORMA_BAJA", admin.adminId)).toHaveLength(1);
    });

    it("si a un dado de baja le quedó una sesión (un ingreso que ya estaba en curso), repetirla la cierra y lo deja asentado", async () => {
      const { admin } = await adminConSesionCompleta(m);
      await correrBaja([admin.email]);
      // Una sesión que nace después de la baja (lo que dejaría un ingreso concurrente).
      const usuario = (
        await m.dueno.query<{ id: string }>(
          `select id from autenticacion."user" where email = $1`,
          [admin.email],
        )
      ).rows[0]?.id;
      await m.dueno.query(
        `insert into autenticacion.session (token, "expiresAt", "userId", host)
         values ($1, now() + interval '1 hour', $2, $3)`,
        [randomBytes(16).toString("hex"), usuario, HOST_DE_LA_CONSOLA],
      );
      const r = await correrBaja([admin.email]);
      expect(r.salida).toEqual([
        `RESULTADO: OK, ya estaba dado de baja (identificador ${admin.adminId}). Sesiones cerradas ahora: 1.`,
      ]);
      expect(await sesionesDe(m, admin.email)).toBe(0);
      expect(await constancias("ADMIN_PLATAFORMA_BAJA", admin.adminId)).toHaveLength(2);
    });

    it("un administrador que nunca ingresó se da de baja igual (no hay sesiones que cerrar)", async () => {
      const admin = await nuevoAdmin(m);
      const r = await correrBaja([admin.email]);
      expect(r.salida).toEqual([
        `RESULTADO: OK, quedó dado de baja el administrador de plataforma (identificador ${admin.adminId}). Sesiones cerradas: 0.`,
      ]);
    });

    it("el email de nadie, uno mal formado, la línea de comandos y la cadena mala se rechazan sin tocar nada", async () => {
      const antes = await n("select count(*) as n from auditoria_plataforma");
      const sinAdmin = await correrBaja(["nadie@dominio-de-prueba.test"]);
      expect(sinAdmin.codigo).toBe(1);
      expect(sinAdmin.errores).toEqual([
        "ERROR: No existe ningún administrador de plataforma con ese email.",
        "RESULTADO: RECHAZADO (no se cambió nada).",
      ]);
      expect(sinAdmin.texto).not.toContain("nadie@dominio-de-prueba.test");

      const malo = await correrBaja(["no-es-un-email"], {
        [VARIABLE_DE_LA_CADENA]: "postgres://nadie:nada@127.0.0.1:1/ninguna",
      });
      expect(malo.codigo).toBe(2);
      expect(malo.errores.join("\n")).toContain("no tiene forma de email");
      expect(malo.texto).not.toContain("no-es-un-email");

      for (const argumentos of [[], ["  "], ["a@x.test", "b@x.test"]]) {
        const r = await correrBaja(argumentos);
        expect(r.codigo).toBe(2);
        expect(r.errores).toEqual([
          "Uso: npm run plataforma:baja-admin -- <email del administrador>",
        ]);
      }
      for (const [entorno, mensaje] of [
        [{}, "falta la variable"],
        [
          { [VARIABLE_DE_LA_CADENA]: "https://ejemplo.test" },
          "no tiene forma de cadena de conexión",
        ],
        [
          { [VARIABLE_DE_LA_CADENA]: "postgres://u:c@ep-algo-pooler.region.aws.neon.tech/base" },
          "apunta al pooler",
        ],
      ] as const) {
        const r = await correrBaja(["a@x.test"], entorno);
        expect(r.codigo).toBe(1);
        expect(r.errores.join("\n")).toContain(mensaje);
      }
      expect(await n("select count(*) as n from auditoria_plataforma")).toBe(antes);
    });

    it("no imprime nunca la cadena ni el email, ni siquiera cuando la falla los repite", async () => {
      const email = `centinela-${randomUUID().slice(0, 8)}@dominio-de-prueba.test`;
      const clave = "clave-de-juguete-98765";
      const conexion = `postgres://usuario-juguete:${clave}@127.0.0.1:1/base-juguete`;
      const sinConexion = await correrBaja([email], { [VARIABLE_DE_LA_CADENA]: conexion });
      const repetidora = await correrBaja([email], { [VARIABLE_DE_LA_CADENA]: conexion }, () =>
        Promise.reject(new Error(`falló con ${conexion} para ${email}`)),
      );
      for (const r of [sinConexion, repetidora]) {
        expect(r.codigo).toBe(1);
        expect(r.errores.join("\n")).toContain("RESULTADO: FALLA");
        for (const prohibido of [clave, "usuario-juguete", "base-juguete", email]) {
          expect(r.texto).not.toContain(prohibido);
        }
      }
    });

    it("arranca de verdad con Node sin compilar, con el comando de package.json", async () => {
      const admin = await nuevoAdmin(m);
      const comando = (
        JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as {
          scripts: Record<string, string>;
        }
      ).scripts["plataforma:baja-admin"];
      expect(comando?.startsWith("node ")).toBe(true);
      const ejecutar = () =>
        ejecutarArchivo(
          process.execPath,
          [...(comando as string).split(" ").slice(1), admin.email],
          {
            cwd: join(import.meta.dirname, "../.."),
            env: { NODE_ENV: "test", PATH: process.env["PATH"] ?? "", ...entornoDelDueno() },
          },
        );
      const primera = await ejecutar();
      expect(primera.stdout.trim()).toBe(
        `RESULTADO: OK, quedó dado de baja el administrador de plataforma (identificador ${admin.adminId}). Sesiones cerradas: 0.`,
      );
      expect(primera.stderr).toBe("");
      const segunda = await ejecutar();
      expect(segunda.stdout.trim()).toMatch(/^RESULTADO: OK, ya estaba dado de baja/);
      expect(primera.stdout + segunda.stdout).not.toContain(admin.email);
    });
  });

  // =============================================================================================
  // plataforma:resetear-segundo-factor
  // =============================================================================================
  describe("plataforma:resetear-segundo-factor", () => {
    async function correrReseteo(
      argumentos: string[],
      entorno: Record<string, string | undefined> = entornoDelDueno(),
      resetear?: typeof resetearElSegundoFactor,
    ) {
      const salida: string[] = [];
      const errores: string[] = [];
      const codigo = await ejecutarReseteoDelSegundoFactor({
        argumentos,
        entorno,
        info: (l) => salida.push(l),
        error: (l) => errores.push(l),
        ...(resetear === undefined ? {} : { resetear }),
      });
      return { codigo, salida, errores, texto: conTodo(...salida, ...errores) };
    }
    const filaDeUsuario = async (email: string) =>
      (
        await m.dueno.query<{ id: string; enabled: boolean }>(
          `select id, "twoFactorEnabled" as enabled from autenticacion."user" where email = $1`,
          [email],
        )
      ).rows[0] as { id: string; enabled: boolean };

    it("borra el TOTP, apaga la bandera, limpia intentos y pasos usados y cierra las sesiones; el siguiente ingreso vuelve a enrolar", async () => {
      const { admin, n: nav, alta } = await adminConSesionCompleta(m);
      await ingresar(m, admin);
      const usuario = await filaDeUsuario(admin.email);
      expect(usuario.enabled).toBe(true);
      // Un bloqueo a medias y un paso gastado.
      await m.dueno.query(
        `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ($1, now()), ($1, now())`,
        [usuario.id],
      );
      expect(
        await n(`select count(*) as n from autenticacion.codigo_totp_usado where usuario_id = $1`, [
          usuario.id,
        ]),
      ).toBeGreaterThan(0);

      const r = await correrReseteo([admin.email]);
      expect(r.codigo).toBe(0);
      expect(r.errores).toEqual([]);
      expect(r.salida).toEqual([
        `RESULTADO: OK, se reseteó el segundo factor del administrador (identificador ${admin.adminId}). Sesiones cerradas: 2. En su próximo ingreso lo vuelve a enrolar (tiene 10 minutos desde que entra).`,
      ]);
      expect(r.texto).not.toContain(admin.email);
      expect(r.texto).not.toContain(alta.secreto);

      expect(
        await n(`select count(*) as n from autenticacion."twoFactor" where "userId" = $1`, [
          usuario.id,
        ]),
      ).toBe(0);
      expect((await filaDeUsuario(admin.email)).enabled).toBe(false);
      expect(
        await n(
          `select count(*) as n from autenticacion.intento_segundo_factor where usuario_id = $1`,
          [usuario.id],
        ),
      ).toBe(0);
      expect(
        await n(`select count(*) as n from autenticacion.codigo_totp_usado where usuario_id = $1`, [
          usuario.id,
        ]),
      ).toBe(0);
      expect(await sesionesDe(m, admin.email)).toBe(0);
      expect(await accesoDe(m, nav)).toEqual({ ok: false, error: "sesion_vencida" });
      // Sigue siendo administrador activo: solo perdió el dispositivo.
      expect(
        (await m.dueno.query("select activo from admin_plataforma where id = $1", [admin.adminId]))
          .rows,
      ).toEqual([{ activo: true }]);

      const filas = await constancias("SEGUNDO_FACTOR_RESETEADO", admin.adminId);
      expect(filas).toEqual([
        {
          actor: "sistema",
          entidad: "admin_plataforma",
          antes: { segundoFactorEnrolado: true },
          despues: {
            segundoFactorEnrolado: false,
            sesionesRevocadas: 2,
            origen: "script resetear-segundo-factor",
          },
        },
      ]);
      expect(JSON.stringify(filas)).not.toContain(admin.email);
      expect(JSON.stringify(filas)).not.toContain(alta.secreto);

      // El siguiente ingreso: sin TOTP, a enrolar; enrola con un secreto NUEVO y entra.
      const nuevo = await ingresar(m, admin);
      expect(await accesoDe(m, nuevo)).toEqual({ ok: false, error: "segundo_factor_a_enrolar" });
      const otraAlta = await enrolarYVerificar(m, nuevo);
      expect(otraAlta.secreto).not.toBe(alta.secreto);
      expect((await accesoOk(m, nuevo)).admin.id).toBe(admin.adminId);
      // El código del dispositivo viejo ya no sirve.
      const viejo = await ingresar(m, admin);
      const rechazado = await pedir(m, viejo, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(rechazado.estado).toBe(401);
    });

    it("un administrador bloqueado por intentos fallidos queda desbloqueado", async () => {
      const { admin } = await adminConSesionCompleta(m);
      const nav = await ingresar(m, admin);
      for (let i = 0; i < 5; i++) {
        await pedir(m, nav, "POST", "/api/auth/two-factor/verify-totp", { code: "000000" });
      }
      const bloqueado = await pedir(m, nav, "POST", "/api/auth/two-factor/verify-totp", {
        code: "000000",
      });
      expect(bloqueado.estado).toBe(429);
      const r = await correrReseteo([admin.email]);
      expect(r.codigo).toBe(0);
      const nuevo = await ingresar(m, admin);
      await enrolarYVerificar(m, nuevo);
      expect((await accesoDe(m, nuevo)).ok).toBe(true);
    });

    it("repetirlo es idempotente: «ya estaba», sin constancia nueva", async () => {
      const { admin } = await adminConSesionCompleta(m);
      await correrReseteo([admin.email]);
      const segunda = await correrReseteo([admin.email.toUpperCase()]);
      expect(segunda.codigo).toBe(0);
      expect(segunda.salida).toEqual([
        `RESULTADO: OK, ya estaba sin segundo factor ni sesiones abiertas (identificador ${admin.adminId}). No se cambió nada.`,
      ]);
      expect(await constancias("SEGUNDO_FACTOR_RESETEADO", admin.adminId)).toHaveLength(1);
    });

    it("dos reseteos simultáneos dejan una sola constancia", async () => {
      const { admin } = await adminConSesionCompleta(m);
      await ingresar(m, admin);
      const resultados = await Promise.all(
        Array.from({ length: 6 }, () => resetearElSegundoFactor(m.base.dueno, admin.email)),
      );
      expect(resultados.every((x) => x.ok)).toBe(true);
      expect(resultados.filter((x) => x.ok && !x.valor.yaEstaba)).toHaveLength(1);
      expect(await constancias("SEGUNDO_FACTOR_RESETEADO", admin.adminId)).toHaveLength(1);
      expect(await sesionesDe(m, admin.email)).toBe(0);
    });

    it("un administrador dado de baja, un email de nadie y uno mal formado se rechazan sin tocar nada", async () => {
      const { admin, alta } = await adminConSesionCompleta(m);
      await darDeBajaAlAdmin(m.base.dueno, admin.email);
      const deBaja = await correrReseteo([admin.email]);
      expect(deBaja.codigo).toBe(1);
      expect(deBaja.errores).toEqual([
        "ERROR: Ese administrador está dado de baja: no hay segundo factor que resetear.",
        "RESULTADO: RECHAZADO (no se cambió nada).",
      ]);
      // Su TOTP sigue ahí: no se borran secretos de quien ya no puede entrar.
      expect(
        await n(
          `select count(*) as n from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
          [admin.email],
        ),
      ).toBe(1);
      expect(alta.secreto).toBeTruthy();

      const nadie = await correrReseteo(["nadie@dominio-de-prueba.test"]);
      expect(nadie.codigo).toBe(1);
      expect(nadie.errores[0]).toBe(
        "ERROR: No existe ningún administrador de plataforma con ese email.",
      );
      const malo = await correrReseteo(["no-es-un-email"], {
        [VARIABLE_DE_LA_CADENA]: "postgres://nadie:nada@127.0.0.1:1/ninguna",
      });
      expect(malo.codigo).toBe(2);
      for (const argumentos of [[], ["a@x.test", "b@x.test"]]) {
        const r = await correrReseteo(argumentos);
        expect(r.codigo).toBe(2);
        expect(r.errores).toEqual([
          "Uso: npm run plataforma:resetear-segundo-factor -- <email del administrador>",
        ]);
      }
    });

    it("no imprime nunca la cadena ni el email, ni siquiera cuando la falla los repite", async () => {
      const email = `centinela-${randomUUID().slice(0, 8)}@dominio-de-prueba.test`;
      const conexion = "postgres://usuario-juguete:clave-de-juguete-4321@127.0.0.1:1/base-juguete";
      const sinConexion = await correrReseteo([email], { [VARIABLE_DE_LA_CADENA]: conexion });
      const repetidora = await correrReseteo([email], { [VARIABLE_DE_LA_CADENA]: conexion }, () =>
        Promise.reject(new Error(`falló con ${conexion} para ${email}`)),
      );
      for (const r of [sinConexion, repetidora]) {
        expect(r.codigo).toBe(1);
        for (const prohibido of [
          "clave-de-juguete-4321",
          "usuario-juguete",
          "base-juguete",
          email,
        ]) {
          expect(r.texto).not.toContain(prohibido);
        }
      }
    });

    it("arranca de verdad con Node sin compilar, con el comando de package.json", async () => {
      const { admin } = await adminConSesionCompleta(m);
      const comando = (
        JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as {
          scripts: Record<string, string>;
        }
      ).scripts["plataforma:resetear-segundo-factor"];
      expect(comando?.startsWith("node ")).toBe(true);
      const ejecutar = () =>
        ejecutarArchivo(
          process.execPath,
          [...(comando as string).split(" ").slice(1), admin.email],
          {
            cwd: join(import.meta.dirname, "../.."),
            env: { NODE_ENV: "test", PATH: process.env["PATH"] ?? "", ...entornoDelDueno() },
          },
        );
      const primera = await ejecutar();
      expect(primera.stdout.trim()).toMatch(/^RESULTADO: OK, se reseteó el segundo factor/);
      expect(primera.stderr).toBe("");
      const segunda = await ejecutar();
      expect(segunda.stdout.trim()).toMatch(/^RESULTADO: OK, ya estaba sin segundo factor/);
      expect(primera.stdout + segunda.stdout).not.toContain(admin.email);
    });
  });

  // =============================================================================================
  // El trabajo revocar_sesiones
  // =============================================================================================
  describe("el trabajo revocar_sesiones al suspender una persona", () => {
    /** El procesador REAL de la composición, con las cadenas de la base de esta prueba. */
    function procesadorReal() {
      const conexiones = armarConexiones({
        fuente: () => ({
          ZULUHUB_DB_APP: m.base.app,
          ZULUHUB_DB_TRABAJOS: m.base.trabajos,
          ZULUHUB_DB_AUTENTICACION: m.base.autenticacion,
          ZULUHUB_CLAVE_CONTEXTO: m.entorno["ZULUHUB_CLAVE_CONTEXTO"],
          ZULUHUB_SECRETO_INVITACIONES: m.entorno["ZULUHUB_SECRETO_INVITACIONES"],
          ZULUHUB_RESEND_API_KEY: "clave-de-relleno",
          ZULUHUB_CORREO_REMITENTE: "Prueba <prueba@ejemplo.test>",
          ZULUHUB_NOMBRE_DE_MARCA: "Marca de relleno",
          ZULUHUB_URL_BASE: "https://app.ejemplo.test",
        }),
        registrar: (d) => m.registros.push(d),
      });
      return {
        procesador: armarTrabajos(conexiones).procesador(),
        cerrar: async () => {
          await conexiones.transaccionesDeApp().cerrar();
          await conexiones.transaccionesDeTrabajos().cerrar();
        },
      };
    }

    /** Sesiones de la web de empresa de ese usuario, armadas por el dueño (la tabla es la misma que usa el ingreso). */
    async function sesionesDeEmpresa(usuario: string, cuantas: number) {
      for (let i = 0; i < cuantas; i++) {
        await m.dueno.query(
          `insert into autenticacion.session (token, "expiresAt", "userId", host)
           values ($1, now() + interval '1 hour', $2, $3)`,
          [randomBytes(16).toString("hex"), usuario, HOST_DE_LA_WEB],
        );
      }
    }
    const sesionesDelUsuario = async (usuario: string) =>
      n(`select count(*) as n from autenticacion.session where "userId" = $1`, [usuario]);
    const trabajosDe = async (persona: string) =>
      (
        await m.dueno.query<{
          id: string;
          estado: string;
          empresa_id: string | null;
          datos: Record<string, unknown>;
          ultimo_error: string | null;
        }>(
          `select id, estado, empresa_id, datos, ultimo_error from trabajo where clave_idempotencia like $1`,
          [`persona:${persona}:suspension:%`],
        )
      ).rows;

    it("suspender encola el trabajo en la misma transacción; el procesador real borra las sesiones de EMPRESA de esa persona y no las de otros", async () => {
      const { n: nav } = await adminConSesionCompleta(m);
      const acceso = await accesoOk(m, nav);
      const p = await personaConUsuario(m.dueno);
      const otra = await personaConUsuario(m.dueno);
      await empresaConMiembro(m.dueno, p);
      await sesionesDeEmpresa(p.usuario, 3);
      await sesionesDeEmpresa(otra.usuario, 2);

      const suspendida = await acceso.casos.suspenderPersona({
        claveDeIdempotencia: claveAlAzar(),
        personaId: p.persona,
        motivo: "prueba de revocación",
      });
      expect(suspendida.ok).toBe(true);
      // Encolado, sin ningún secreto, y todavía sin ejecutar: las sesiones siguen ahí hasta que corra el procesador.
      const [trabajo, ...resto] = await trabajosDe(p.persona);
      expect(resto).toEqual([]);
      expect(trabajo).toMatchObject({
        estado: "PENDIENTE",
        empresa_id: null,
        datos: { usuarioAuthId: p.usuario },
      });
      expect(await sesionesDelUsuario(p.usuario)).toBe(3);

      const { procesador, cerrar } = procesadorReal();
      try {
        const resumen = await procesador.procesarPendientes({ ahora: new Date(), limite: 50 });
        expect(resumen.hechos).toBeGreaterThanOrEqual(1);
        expect(resumen.fallidos).toBe(0);
      } finally {
        await cerrar();
      }
      expect(await sesionesDelUsuario(p.usuario)).toBe(0);
      expect(await sesionesDelUsuario(otra.usuario)).toBe(2);
      const despues = (await trabajosDe(p.persona))[0];
      // La cola guarda la nota del trabajo terminado en `ultimo_error`: solo cuántas sesiones, nada del usuario.
      expect(despues).toMatchObject({ estado: "HECHO", ultimo_error: "sesiones revocadas: 3" });
      // El usuario y su cuenta quedan: solo se revocan las sesiones.
      expect(
        await n(`select count(*) as n from autenticacion."user" where id = $1`, [p.usuario]),
      ).toBe(1);
    });

    it("la suspensión que se revierte no deja el trabajo, y una persona que nunca ingresó no encola nada", async () => {
      const { n: nav } = await adminConSesionCompleta(m);
      const acceso = await accesoOk(m, nav);
      // Sin usuario vinculado: nunca ingresó, no tiene sesiones.
      const sinUsuario = (
        await m.dueno.query<{ id: string }>(
          "insert into persona (email) values ($1) returning id",
          [`sin-usuario-${randomUUID().slice(0, 8)}@dominio-de-prueba.test`],
        )
      ).rows[0]?.id as string;
      const r = await acceso.casos.suspenderPersona({
        claveDeIdempotencia: claveAlAzar(),
        personaId: sinUsuario,
        motivo: "nunca ingresó",
      });
      expect(r.ok).toBe(true);
      expect(await trabajosDe(sinUsuario)).toEqual([]);

      // Un rechazo del caso (sin motivo) no deja trabajo.
      const p = await personaConUsuario(m.dueno);
      const rechazo = await acceso.casos.suspenderPersona({
        claveDeIdempotencia: claveAlAzar(),
        personaId: p.persona,
        motivo: "  ",
      });
      expect(rechazo).toEqual({ ok: false, error: "MOTIVO_OBLIGATORIO" });
      expect(await trabajosDe(p.persona)).toEqual([]);
    });

    it("reactivar a la persona no encola nada ni devuelve las sesiones", async () => {
      const { n: nav } = await adminConSesionCompleta(m);
      const acceso = await accesoOk(m, nav);
      const p = await personaConUsuario(m.dueno);
      await acceso.casos.suspenderPersona({
        claveDeIdempotencia: claveAlAzar(),
        personaId: p.persona,
        motivo: "para reactivar",
      });
      expect(await trabajosDe(p.persona)).toHaveLength(1);
      const r = await acceso.casos.reactivarPersona({
        claveDeIdempotencia: claveAlAzar(),
        personaId: p.persona,
      });
      expect(r.ok).toBe(true);
      expect(await trabajosDe(p.persona)).toHaveLength(1);
    });

    it("el manejador es idempotente: repetir el trabajo, o correrlo sin sesiones, no falla", async () => {
      const { n: nav } = await adminConSesionCompleta(m);
      const acceso = await accesoOk(m, nav);
      const p = await personaConUsuario(m.dueno);
      await acceso.casos.suspenderPersona({
        claveDeIdempotencia: claveAlAzar(),
        personaId: p.persona,
        motivo: "sin sesiones",
      });
      const { procesador, cerrar } = procesadorReal();
      try {
        // La persona no tiene ninguna sesión: el trabajo termina HECHO igual.
        await procesador.procesarPendientes({ ahora: new Date(), limite: 50 });
        const [trabajo] = await trabajosDe(p.persona);
        expect(trabajo?.estado).toBe("HECHO");
        // Se vuelve a poner en cola a mano (otro intento del mismo efecto) con sesiones nuevas: se borran sin falla.
        await sesionesDeEmpresa(p.usuario, 2);
        const revocacion = m.consola.conexion.revocacion;
        expect(await revocacion.revocarDelUsuario(p.usuario)).toBe(2);
        expect(await revocacion.revocarDelUsuario(p.usuario)).toBe(0);
      } finally {
        await cerrar();
      }
      expect(await sesionesDelUsuario(p.usuario)).toBe(0);
    });

    it("el rol de autenticación solo borra sesiones: no puede borrar el usuario ni sus cuentas (permisos de base intactos)", async () => {
      const p = await personaConUsuario(m.dueno);
      const cliente = new pg.Client({ connectionString: m.base.autenticacion });
      await cliente.connect();
      try {
        await expect(
          cliente.query(`delete from autenticacion."user" where id = $1`, [p.usuario]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          cliente.query(`delete from autenticacion.account where "userId" = $1`, [p.usuario]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          cliente.query(`delete from autenticacion.session where "userId" = $1`, [p.usuario]),
        ).resolves.toBeTruthy();
      } finally {
        await cliente.end();
      }
    });
  });

  it("la constancia y el trabajo no llevan secretos: ni el TOTP, ni los códigos de recuperación, ni las cookies", async () => {
    const { admin, n: nav, alta } = await adminConSesionCompleta(m);
    const acceso = await accesoOk(m, nav);
    const p = await personaConUsuario(m.dueno);
    await acceso.casos.suspenderPersona({
      claveDeIdempotencia: claveAlAzar(),
      personaId: p.persona,
      motivo: "centinelas",
    });
    await darDeBajaAlAdmin(m.base.dueno, admin.email);
    const centinelas = [
      alta.secreto,
      ...alta.codigosDeRecuperacion,
      m.consola.secreto,
      ...nav.cookiesDe(HOST_DE_LA_CONSOLA).map((c) => c.valor),
      admin.email,
    ];
    const tablas = [
      "auditoria_plataforma",
      "trabajo",
      "idempotencia_plataforma",
      "auditoria_empresa",
    ];
    const filas: unknown[] = [];
    for (const t of tablas) {
      const { rows } = await m.dueno.query<Record<string, unknown>>(`select * from ${t}`);
      filas.push(...rows);
    }
    const volcado = JSON.stringify(filas);
    for (const c of centinelas) {
      expect(c.length).toBeGreaterThan(8);
      expect(volcado, c.slice(0, 6)).not.toContain(c);
    }
  });
});
