import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearConexionDeAutenticacion } from "../../src/adaptadores/postgres/conexion-de-autenticacion";
import { crearAdminsDePostgres, type AdminsDb } from "../../src/adaptadores/postgres/admins";
import {
  crearAuditoriaDeIngresoDePlataformaDePostgres,
  type TxDeAuditoriaDeIngreso,
} from "../../src/adaptadores/postgres/auditoria-de-ingreso-de-plataforma";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../../src/adaptadores/postgres/auditoria-de-plataforma";
import {
  crearPersonalHabilitadoDePostgres,
  type TxDePersonalHabilitado,
} from "../../src/adaptadores/postgres/personal-habilitado";
import { crearTransacciones } from "../../src/adaptadores/postgres/transacciones";
import { crearUsuarioDeBase } from "./autenticacion-apoyo";
import { crearBaseAparte } from "./entorno";
import { EMAIL_DE_ADMIN_DE_PRUEBA } from "./admins-de-prueba";

/**
 * Los adaptadores de datos del segundo factor y de la lista de personal contra una base real y con los ROLES reales: el
 * intento serializado (qué se guarda y qué no cuando el verificador falla), el paso usado con clave única, la marca de
 * la sesión que no retrocede, el personal habilitado leído con la conexión de plataforma y la constancia del bloqueo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const MINUTO = 60_000;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const en = (ms: number) => new Date(AHORA.getTime() + ms);

describe.skipIf(base === null)("segundo factor y personal habilitado: adaptadores de datos", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexion: ReturnType<typeof crearConexionDeAutenticacion>;
  let usuario: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    conexion = crearConexionDeAutenticacion({
      url: propia.base.autenticacion,
      maximoDeConexiones: 8,
    });
  });
  afterAll(async () => {
    await conexion.cerrar();
    await dueno.end();
    await propia.destruir();
  });

  // Cada prueba arma sus usuarios: el conteo de fallos y pasos es por usuario.
  const nuevoUsuario = async (): Promise<string> => (await crearUsuarioDeBase(dueno)).id;
  const fallos = async (u: string) =>
    Number(
      (
        await dueno.query<{ n: string }>(
          `select count(*) as n from autenticacion.intento_segundo_factor where usuario_id = $1`,
          [u],
        )
      ).rows[0]?.n,
    );
  const pasos = async (u: string) =>
    (
      await dueno.query<{ paso: string }>(
        `select paso from autenticacion.codigo_totp_usado where usuario_id = $1 order by paso`,
        [u],
      )
    ).rows.map((f) => Number(f.paso));

  describe("intentarCodigo", () => {
    it("un código bueno devuelve VALIDO, deja el paso registrado y borra los fallos anteriores", async () => {
      usuario = await nuevoUsuario();
      for (let i = 0; i < 3; i++) {
        await conexion.segundoFactor.intentarCodigo(usuario, en(i * 1000), () =>
          Promise.resolve(false),
        );
      }
      expect(await fallos(usuario)).toBe(3);
      const r = await conexion.segundoFactor.intentarCodigo(usuario, en(10_000), async (tx) =>
        tx.registrarPasoUsado(42),
      );
      expect(r).toEqual({ tipo: "VALIDO" });
      expect(await fallos(usuario)).toBe(0);
      expect(await pasos(usuario)).toEqual([42]);
    });

    it("un código malo devuelve INVALIDO y anota el fallo; el quinto avisa que ESE fallo completó el bloqueo (y solo ese)", async () => {
      usuario = await nuevoUsuario();
      const resultados = [];
      for (let i = 0; i < 5; i++) {
        resultados.push(
          await conexion.segundoFactor.intentarCodigo(usuario, en(i * 1000), () =>
            Promise.resolve(false),
          ),
        );
      }
      expect(resultados.slice(0, 4)).toEqual(
        Array(4).fill({ tipo: "INVALIDO", bloqueoNuevo: null }),
      );
      expect(resultados[4]).toEqual({
        tipo: "INVALIDO",
        bloqueoNuevo: { hasta: en(4000 + 15 * MINUTO), fallos: 5 },
      });
      expect(await fallos(usuario)).toBe(5);
    });

    it("con el bloqueo vigente devuelve BLOQUEADO con la hora, NO llama al verificador y NO anota nada", async () => {
      usuario = await nuevoUsuario();
      for (let i = 0; i < 5; i++) {
        await conexion.segundoFactor.intentarCodigo(usuario, en(i * 1000), () =>
          Promise.resolve(false),
        );
      }
      let llamadas = 0;
      const r = await conexion.segundoFactor.intentarCodigo(usuario, en(60_000), () => {
        llamadas += 1;
        return Promise.resolve(true);
      });
      expect(r).toEqual({ tipo: "BLOQUEADO", hasta: en(4000 + 15 * MINUTO) });
      expect(llamadas).toBe(0);
      expect(await fallos(usuario)).toBe(5);
      // Pasado el bloqueo, el verificador vuelve a correr y un acierto limpia los fallos.
      const libre = await conexion.segundoFactor.intentarCodigo(
        usuario,
        en(4000 + 15 * MINUTO),
        () => Promise.resolve(true),
      );
      expect(libre).toEqual({ tipo: "VALIDO" });
      expect(await fallos(usuario)).toBe(0);
    });

    it("si el verificador falla (lanza), se revierte TODO: ni fallo anotado, ni paso registrado, y el error sale tal cual", async () => {
      usuario = await nuevoUsuario();
      await expect(
        conexion.segundoFactor.intentarCodigo(usuario, AHORA, async (tx) => {
          await tx.registrarPasoUsado(7);
          throw new Error("el verificador se rompió");
        }),
      ).rejects.toThrow("el verificador se rompió");
      expect(await fallos(usuario)).toBe(0);
      expect(await pasos(usuario)).toEqual([]);
    });

    it("un paso se registra una sola vez por usuario (la clave única): el segundo intento con el mismo paso no es válido", async () => {
      usuario = await nuevoUsuario();
      const otro = await nuevoUsuario();
      const registrar = (u: string, paso: number) =>
        conexion.segundoFactor.intentarCodigo(u, AHORA, async (tx) => tx.registrarPasoUsado(paso));
      expect(await registrar(usuario, 100)).toEqual({ tipo: "VALIDO" });
      expect(await registrar(usuario, 100)).toMatchObject({ tipo: "INVALIDO" });
      expect(await fallos(usuario)).toBe(1); // repetir un paso cuenta como fallo
      expect(await registrar(usuario, 101)).toEqual({ tipo: "VALIDO" });
      // Otro usuario puede usar el mismo paso.
      expect(await registrar(otro, 100)).toEqual({ tipo: "VALIDO" });
      expect(await pasos(usuario)).toEqual([100, 101]);
      expect(await fallos(usuario)).toBe(0); // y un acierto los borra
    });

    it("dentro de un mismo intento, registrar el mismo paso dos veces devuelve true y después false", async () => {
      usuario = await nuevoUsuario();
      const vistos: boolean[] = [];
      await conexion.segundoFactor.intentarCodigo(usuario, AHORA, async (tx) => {
        vistos.push(await tx.registrarPasoUsado(5), await tx.registrarPasoUsado(5));
        return true;
      });
      expect(vistos).toEqual([true, false]);
    });

    it("borra lo viejo de ese usuario al intentar (fallos de más de 25 minutos, pasos de más de un día) y deja lo de otros", async () => {
      usuario = await nuevoUsuario();
      const otro = await nuevoUsuario();
      await dueno.query(
        `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ($1, $2), ($1, $3), ($4, $2)`,
        [usuario, en(-26 * MINUTO), en(-24 * MINUTO), otro],
      );
      await dueno.query(
        `insert into autenticacion.codigo_totp_usado (usuario_id, paso, usado_en) values ($1, 1, $2), ($1, 2, $3), ($4, 1, $2)`,
        [usuario, en(-25 * 60 * MINUTO), en(-23 * 60 * MINUTO), otro],
      );
      await conexion.segundoFactor.intentarCodigo(usuario, AHORA, () => Promise.resolve(false));
      expect(await fallos(usuario)).toBe(2); // el de -24 min y el nuevo
      expect(await pasos(usuario)).toEqual([2]);
      expect(await fallos(otro)).toBe(1);
      expect(await pasos(otro)).toEqual([1]);
    });

    it("los intentos del mismo usuario se SERIALIZAN: veinte a la vez anotan exactamente cinco fallos y bloquean al resto", async () => {
      usuario = await nuevoUsuario();
      let corriendo = 0;
      let maximo = 0;
      const resultados = await Promise.all(
        Array.from({ length: 20 }, () =>
          conexion.segundoFactor.intentarCodigo(usuario, AHORA, async () => {
            corriendo += 1;
            maximo = Math.max(maximo, corriendo);
            await new Promise((r) => setTimeout(r, 5));
            corriendo -= 1;
            return false;
          }),
        ),
      );
      expect(maximo, "nunca dos verificadores a la vez para el mismo usuario").toBe(1);
      expect(resultados.filter((r) => r.tipo === "INVALIDO")).toHaveLength(5);
      expect(resultados.filter((r) => r.tipo === "BLOQUEADO")).toHaveLength(15);
      expect(
        resultados.filter((r) => r.tipo === "INVALIDO" && r.bloqueoNuevo !== null),
      ).toHaveLength(1);
      expect(await fallos(usuario)).toBe(5);
    });

    it("usuarios distintos NO se serializan entre sí", async () => {
      const usuarios = [await nuevoUsuario(), await nuevoUsuario(), await nuevoUsuario()];
      let corriendo = 0;
      let maximo = 0;
      await Promise.all(
        usuarios.map((u) =>
          conexion.segundoFactor.intentarCodigo(u, AHORA, async () => {
            corriendo += 1;
            maximo = Math.max(maximo, corriendo);
            await new Promise((r) => setTimeout(r, 50));
            corriendo -= 1;
            return true;
          }),
        ),
      );
      expect(maximo).toBe(3);
    });
  });

  describe("marcarSegundoFactor", () => {
    async function sesion(u: string, marca: Date | null = null): Promise<string> {
      const token = randomUUID();
      await dueno.query(
        `insert into autenticacion.session ("expiresAt", token, "userId", host, segundo_factor_en) values (now() + interval '1 hour', $1, $2, 'consola.example.test', $3)`,
        [token, u, marca],
      );
      return token;
    }
    const marcaDe = async (token: string) =>
      (
        await dueno.query<{ m: Date | null }>(
          `select segundo_factor_en as m from autenticacion.session where token = $1`,
          [token],
        )
      ).rows[0]?.m;

    it("marca la sesión con ese token (y solo esa)", async () => {
      const u = await nuevoUsuario();
      const a = await sesion(u);
      const b = await sesion(u);
      expect(await conexion.segundoFactor.marcarSegundoFactor(a, AHORA)).toBe(true);
      expect(await marcaDe(a)).toEqual(AHORA);
      expect(await marcaDe(b)).toBeNull();
    });

    it("un token que no existe devuelve false y no toca nada", async () => {
      expect(await conexion.segundoFactor.marcarSegundoFactor(randomUUID(), AHORA)).toBe(false);
    });

    it("no retrocede: una marca más vieja que la que ya tiene no la pisa; una más nueva sí", async () => {
      const u = await nuevoUsuario();
      const t = await sesion(u, en(10_000));
      expect(await conexion.segundoFactor.marcarSegundoFactor(t, en(5_000))).toBe(true);
      expect(await marcaDe(t)).toEqual(en(10_000));
      expect(await conexion.segundoFactor.marcarSegundoFactor(t, en(20_000))).toBe(true);
      expect(await marcaDe(t)).toEqual(en(20_000));
    });
  });

  describe("el rol de la librería solo puede lo que 0015 le dio", () => {
    it("no borra su segundo factor (42501), ni cambia el usuario de una fila, ni toca las tablas de otro rol", async () => {
      const u = await nuevoUsuario();
      await dueno.query(
        `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('cifrado', '[]', $1)`,
        [u],
      );
      const auth = new pg.Client({ connectionString: propia.base.autenticacion });
      await auth.connect();
      try {
        const codigo = async (texto: string, ps: unknown[] = []) => {
          try {
            await auth.query(texto, ps);
            return null;
          } catch (e) {
            return (e as { code?: string }).code ?? "?";
          }
        };
        expect(await codigo(`delete from autenticacion."twoFactor" where "userId" = $1`, [u])).toBe(
          "42501",
        );
        expect(
          await codigo(`update autenticacion."twoFactor" set "userId" = $1`, [randomUUID()]),
        ).toBe("42501");
        expect(await codigo(`update autenticacion."twoFactor" set "lockedUntil" = now()`)).toBe(
          "42501",
        );
        expect(
          await codigo(
            `update autenticacion."twoFactor" set secret = 'otro', "backupCodes" = '[]', verified = true`,
          ),
        ).toBeNull();
        expect(await codigo(`update autenticacion.codigo_totp_usado set paso = 1`)).toBe("42501");
        expect(
          await codigo(`update autenticacion.intento_segundo_factor set fallo_en = now()`),
        ).toBe("42501");
        expect(await codigo(`truncate autenticacion.intento_segundo_factor`)).toBe("42501");
        expect(await codigo(`alter table autenticacion."twoFactor" add column x int`)).toBe(
          "42501",
        );
      } finally {
        await auth.end();
      }
      const { rows } = await dueno.query(
        `select 1 from autenticacion."twoFactor" where "userId" = $1`,
        [u],
      );
      expect(rows).toHaveLength(1);
    });
  });
});

describe.skipIf(base === null)(
  "personal habilitado y constancia del bloqueo (conexión de plataforma)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let habilitado: ReturnType<typeof crearPersonalHabilitadoDePostgres>;
    let auditoria: ReturnType<typeof crearAuditoriaDeIngresoDePlataformaDePostgres>;
    const cerrar: (() => Promise<void>)[] = [];

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      const lectura = crearTransacciones<TxDePersonalHabilitado>({
        urls: { PLATAFORMA: propia.base.plataforma },
        clave: propia.base.clave,
        maximoDeConexiones: 3,
        armar: (db) => ({ admins: crearAdminsDePostgres(db.withTables<AdminsDb>()) }),
      });
      const escritura = crearTransacciones<TxDeAuditoriaDeIngreso>({
        urls: { PLATAFORMA: propia.base.plataforma },
        clave: propia.base.clave,
        maximoDeConexiones: 3,
        armar: (db, contexto) => ({
          admins: crearAdminsDePostgres(db.withTables<AdminsDb>()),
          auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
            db.withTables<AuditoriaDePlataformaDb>(),
            contexto,
          ),
        }),
      });
      cerrar.push(
        () => lectura.cerrar(),
        () => escritura.cerrar(),
      );
      habilitado = crearPersonalHabilitadoDePostgres(lectura, () => AHORA);
      auditoria = crearAuditoriaDeIngresoDePlataformaDePostgres(escritura, () => AHORA);
    });
    afterAll(async () => {
      for (const c of cerrar) await c();
      await dueno.end();
      await propia.destruir();
    });

    const alta = async (email: string, rol = "ADMIN", activo = true) =>
      (
        await dueno.query<{ id: string }>(
          `insert into admin_plataforma (email, rol, activo) values ($1, $2, $3) returning id`,
          [email, rol, activo],
        )
      ).rows[0]?.id as string;

    describe("esHabilitado", () => {
      it("un administrador ACTIVO (ADMIN o SOPORTE) está habilitado", async () => {
        expect(await habilitado.esHabilitado(EMAIL_DE_ADMIN_DE_PRUEBA)).toBe(true);
        await alta("soporte-habilitado@ejemplo.test", "SOPORTE");
        expect(await habilitado.esHabilitado("soporte-habilitado@ejemplo.test")).toBe(true);
      });

      it("uno dado de baja, o un email que no está en la tabla, NO está habilitado", async () => {
        await alta("baja@ejemplo.test", "ADMIN", false);
        expect(await habilitado.esHabilitado("baja@ejemplo.test")).toBe(false);
        expect(await habilitado.esHabilitado("desconocido@ejemplo.test")).toBe(false);
        expect(await habilitado.esHabilitado("")).toBe(false);
      });

      it("el email se normaliza como se guardó (minúsculas, sin blancos en los extremos)", async () => {
        await alta("normalizado@ejemplo.test");
        for (const variante of [
          "NORMALIZADO@ejemplo.test",
          "  normalizado@ejemplo.test ",
          "Normalizado@Ejemplo.Test",
        ]) {
          expect(await habilitado.esHabilitado(variante), JSON.stringify(variante)).toBe(true);
        }
        // Pero un email PARECIDO no: ni un prefijo ni con comodines de LIKE.
        for (const otro of [
          "normalizado@ejemplo.tes",
          "normalizad%@ejemplo.test",
          "n_rmalizado@ejemplo.test",
          "normalizado@ejemplo.test.ar",
        ]) {
          expect(await habilitado.esHabilitado(otro), otro).toBe(false);
        }
      });

      it("la baja y el alta se ven en la lectura siguiente (no hay caché)", async () => {
        const id = await alta("alterna@ejemplo.test");
        expect(await habilitado.esHabilitado("alterna@ejemplo.test")).toBe(true);
        await dueno.query(`update admin_plataforma set activo = false where id = $1`, [id]);
        expect(await habilitado.esHabilitado("alterna@ejemplo.test")).toBe(false);
        await dueno.query(`update admin_plataforma set activo = true where id = $1`, [id]);
        expect(await habilitado.esHabilitado("alterna@ejemplo.test")).toBe(true);
      });

      it("si la base no responde, LANZA (quien llama lo trata como «no habilitado»): nunca devuelve true por error", async () => {
        const rota = crearTransacciones<TxDePersonalHabilitado>({
          urls: { PLATAFORMA: propia.base.app }, // el rol de la aplicación NO ve `admin_plataforma`
          clave: propia.base.clave,
          maximoDeConexiones: 1,
          armar: (db) => ({ admins: crearAdminsDePostgres(db.withTables<AdminsDb>()) }),
        });
        try {
          await expect(
            crearPersonalHabilitadoDePostgres(rota, () => AHORA).esHabilitado(
              EMAIL_DE_ADMIN_DE_PRUEBA,
            ),
          ).rejects.toThrow(/no se pudo consultar al personal habilitado/);
        } finally {
          await rota.cerrar();
        }
      });
    });

    describe("registrarBloqueoDeSegundoFactor", () => {
      it("deja UNA constancia a nombre del sistema, sobre el administrador, con solo hasta cuándo y cuántos fallos", async () => {
        const id = await alta("bloqueado@ejemplo.test");
        await auditoria.registrarBloqueoDeSegundoFactor({
          email: "BLOQUEADO@ejemplo.test",
          hasta: en(15 * MINUTO),
          fallos: 5,
        });
        const { rows } = await dueno.query<{
          actor: string;
          accion: string;
          entidad: string;
          entidad_id: string;
          antes: unknown;
          despues: unknown;
        }>(
          `select actor, accion, entidad, entidad_id, antes, despues from auditoria_plataforma where entidad_id = $1`,
          [id],
        );
        expect(rows).toEqual([
          {
            actor: "sistema",
            accion: "SEGUNDO_FACTOR_BLOQUEADO",
            entidad: "admin_plataforma",
            entidad_id: id,
            antes: null,
            despues: { bloqueadoHasta: en(15 * MINUTO).toISOString(), fallos: 5 },
          },
        ]);
        expect(JSON.stringify(rows)).not.toContain("bloqueado@ejemplo.test");
      });

      it("si el email no es de un administrador, no hay nada que auditar (y no falla)", async () => {
        const antes = Number(
          (await dueno.query<{ n: string }>(`select count(*) as n from auditoria_plataforma`))
            .rows[0]?.n,
        );
        await auditoria.registrarBloqueoDeSegundoFactor({
          email: "nadie@ejemplo.test",
          hasta: AHORA,
          fallos: 5,
        });
        const despues = Number(
          (await dueno.query<{ n: string }>(`select count(*) as n from auditoria_plataforma`))
            .rows[0]?.n,
        );
        expect(despues).toBe(antes);
      });

      it("un administrador dado de baja igual deja constancia (la fila existe; es la del bloqueo de su cuenta)", async () => {
        // `plataforma_actor_vigente()` mira al ACTOR (el sistema), no al administrador sobre el que se escribe.
        const id = await alta("baja-bloqueada@ejemplo.test", "ADMIN", false);
        await auditoria.registrarBloqueoDeSegundoFactor({
          email: "baja-bloqueada@ejemplo.test",
          hasta: AHORA,
          fallos: 5,
        });
        const { rows } = await dueno.query(
          `select 1 from auditoria_plataforma where entidad_id = $1`,
          [id],
        );
        expect(rows).toHaveLength(1);
      });

      it("la auditoría es de solo inserción: el rol de plataforma no la cambia ni la borra", async () => {
        const id = await alta("solo-insercion@ejemplo.test");
        await auditoria.registrarBloqueoDeSegundoFactor({
          email: "solo-insercion@ejemplo.test",
          hasta: AHORA,
          fallos: 5,
        });
        const c = new pg.Client({ connectionString: propia.base.plataforma });
        await c.connect();
        try {
          await expect(
            c.query(`delete from auditoria_plataforma where entidad_id = $1`, [id]),
          ).rejects.toMatchObject({ code: "42501" });
          await expect(
            c.query(`update auditoria_plataforma set accion = 'x' where entidad_id = $1`, [id]),
          ).rejects.toMatchObject({
            code: "42501",
          });
        } finally {
          await c.end();
        }
      });
    });
  },
);
