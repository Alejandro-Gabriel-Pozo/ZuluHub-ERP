import { execFileSync } from "node:child_process";

import {
  chownSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { OPCIONES_DE_BASE } from "./opciones-de-base";
import { sufijoUnico } from "./unicos";

/**
 * Las migraciones corridas como el rol que migra en Neon: NO superusuario.
 *
 * Qué previene: el primer despliegue real (Neon, PostgreSQL 18, rama `preview`) aplicó 0001-0011 y falló en 0012
 * («el rol de respaldo no puede tener pertenencias (neondb_owner es miembro de pedernal_respaldo)»). Desde
 * PostgreSQL 16, cuando un rol CREATEROLE que no es superusuario crea un rol, el servidor lo hace miembro del rol
 * creado (admin_option = true, inherit_option = false, set_option = false). Todas las demás pruebas de integración
 * migran con un superusuario (que no recibe esa pertenencia), y por eso nadie lo vio.
 *
 * Cómo lo imita (sin falsear lo que se verifica):
 *  - Levanta su PROPIO servidor PostgreSQL ≥ 16, descartable (initdb + pg_ctl en un directorio temporal y un puerto
 *    libre). Los roles son del clúster entero: en el servidor compartido de las demás pruebas `pedernal_*` ya
 *    existe, creado por un superusuario, y la pertenencia automática no aparecería. Con un clúster aparte los
 *    `pedernal_*` los crea de verdad el rol que no es superusuario.
 *  - `neondb_owner` (el nombre que usa Neon) es LOGIN, NOSUPERUSER, CREATEROLE, CREATEDB y dueño de la base, y miembro
 *    de `neon_superuser` SIN heredar ni poder hacer SET ROLE (la forma que se leyó en la base real).
 *  - DIFERENCIA CON NEON: la migración 0006 exige que quien migra evada RLS (BYPASSRLS), y un servidor local solo
 *    deja otorgarlo a un superusuario. En Neon lo da la membresía en `neon_superuser`; acá se le da el atributo
 *    BYPASSRLS al crear `neondb_owner` (lo hace el administrador del clúster, igual que Neon al crear el rol). Es lo
 *    único que se le agrega; no es superusuario y no hereda nada. Todo lo demás lo ejecuta ese rol.
 *
 * Sin binarios de PostgreSQL ≥ 16 (initdb, pg_ctl) la prueba se saltea, salvo en el CI, donde faltar es un error
 * (la ruta se puede dar con PEDERNAL_PG_BIN; es una ruta, no un secreto).
 */

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CARPETA_REAL = join(import.meta.dirname, "../../migraciones");
const DUENO = "neondb_owner";
const GRUPO_DEL_PROVEEDOR = "neon_superuser";
const RESPALDO = "pedernal_respaldo";

function carpetaDeBinarios(): string | null {
  const candidatas: string[] = [];
  const dada = process.env["PEDERNAL_PG_BIN"];
  if (dada !== undefined && dada !== "") candidatas.push(dada);
  for (const base of ["/usr/lib/postgresql", "/usr/local/pgsql", "/opt/homebrew/opt"]) {
    if (!existsSync(base)) continue;
    for (const v of readdirSync(base).sort((a, b) => b.localeCompare(a, "en", { numeric: true })))
      candidatas.push(join(base, v, "bin"), join(base, v));
  }
  for (const carpeta of candidatas) {
    if (!existsSync(join(carpeta, "initdb")) || !existsSync(join(carpeta, "pg_ctl"))) continue;
    const salida = execFileSync(join(carpeta, "initdb"), ["--version"], { encoding: "utf8" });
    const mayor = Number(/\)\s+(\d+)/.exec(salida)?.[1] ?? "0");
    if (mayor >= 16) return carpeta;
  }
  return null;
}

const binarios = carpetaDeBinarios();
if (binarios === null && process.env["CI"] === "true") {
  throw new Error(
    "En el CI faltan los binarios de PostgreSQL 16 o más (initdb, pg_ctl): la prueba de migraciones sin superusuario no puede saltearse.",
  );
}

async function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const direccion = s.address();
      const puerto = typeof direccion === "object" && direccion !== null ? direccion.port : 0;
      s.close(() => resolve(puerto));
    });
  });
}

describe.skipIf(binarios === null)(
  "migraciones corridas por un rol que NO es superusuario (como en Neon)",
  () => {
    const bin = binarios as string;
    // Como root, PostgreSQL se niega a correr: se ejecuta con el uid del usuario `postgres` del sistema.
    const comoRoot = typeof process.getuid === "function" && process.getuid() === 0;
    const sistema = comoRoot
      ? /^postgres:[^:]*:(\d+):(\d+):/m.exec(readFileSync("/etc/passwd", "utf8"))
      : null;
    const identidad = sistema === null ? {} : { uid: Number(sistema[1]), gid: Number(sistema[2]) };
    const ejecutar = (programa: string, args: string[]) =>
      execFileSync(join(bin, programa), args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...identidad,
      });

    let raiz = "";
    let puerto = 0;
    let admin: pg.Client;
    let migradas: string; // carpeta con 0001..0012
    const url = (usuario: string, base: string) =>
      `postgres://${usuario}@127.0.0.1:${puerto}/${base}`;
    const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
      (await admin.query<T>(texto, p)).rows;

    beforeAll(async () => {
      raiz = mkdtempSync(join(tmpdir(), "pedernal-pg-"));
      if (sistema !== null) chownSync(raiz, Number(sistema[1]), Number(sistema[2]));
      const datos = join(raiz, "datos");
      puerto = await puertoLibre();
      ejecutar("initdb", ["-D", datos, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
      ejecutar("pg_ctl", [
        "-D",
        datos,
        "-w",
        "-l",
        join(raiz, "servidor.log"),
        "-o",
        `-p ${puerto} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${raiz} -c fsync=off`,
        "start",
      ]);
      admin = new pg.Client({ connectionString: url("postgres", "postgres") });
      await admin.connect();

      // El rol del proveedor y el que migra, con la forma leída en la base real de Neon.
      await admin.query(`CREATE ROLE ${GRUPO_DEL_PROVEEDOR} NOLOGIN CREATEDB CREATEROLE BYPASSRLS`);
      await admin.query(`CREATE ROLE ${DUENO} LOGIN NOSUPERUSER CREATEDB CREATEROLE BYPASSRLS`);
      await admin.query(
        `GRANT ${GRUPO_DEL_PROVEEDOR} TO ${DUENO} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
      );
      await admin.query(`CREATE DATABASE neondb OWNER ${DUENO} ${OPCIONES_DE_BASE}`);

      // Solo 0001..0012: la prueba llega hasta la migración del rol de respaldo.
      migradas = join(raiz, "migraciones-hasta-0012");
      mkdirSync(migradas);
      for (const f of readdirSync(CARPETA_REAL)) {
        if (/^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 12)
          copyFileSync(join(CARPETA_REAL, f), join(migradas, f));
      }
    });

    afterAll(async () => {
      await admin.end();
      try {
        ejecutar("pg_ctl", ["-D", join(raiz, "datos"), "-m", "immediate", "stop"]);
      } finally {
        rmSync(raiz, { recursive: true, force: true });
      }
    });

    it("el rol que migra no es superusuario y el servidor es PostgreSQL 16 o más", async () => {
      const [r] = await filas<{ rolsuper: boolean; v: number }>(
        `select rolsuper, current_setting('server_version_num')::int as v from pg_roles where rolname = $1`,
        [DUENO],
      );
      expect(r?.rolsuper).toBe(false);
      expect(r?.v).toBeGreaterThanOrEqual(160000);
    });

    it("migra hasta 0012 como rol no superusuario, y repetirlo no hace nada", async () => {
      const resultado = await aplicarMigraciones(url(DUENO, "neondb"), migradas);
      expect(resultado.aplicadas).toHaveLength(12);
      expect(resultado.aplicadas.at(-1)).toBe("0012_respaldo.sql");
      const otra = await aplicarMigraciones(url(DUENO, "neondb"), migradas);
      expect(otra.aplicadas).toEqual([]);
      expect(otra.yaAplicadas).toHaveLength(12);
    });

    it("la prueba ejercita lo que falló en Neon: el creador es miembro automático del rol, sin heredar ni SET", async () => {
      const membresias = await filas<{
        m: string;
        admin_option: boolean;
        inherit_option: boolean;
        set_option: boolean;
      }>(
        `select m.rolname as m, am.admin_option, am.inherit_option, am.set_option
           from pg_auth_members am join pg_roles m on m.oid = am.member join pg_roles g on g.oid = am.roleid
          where g.rolname = $1`,
        [RESPALDO],
      );
      expect(membresias).toEqual([
        { m: DUENO, admin_option: true, inherit_option: false, set_option: false },
      ]);
    });

    // Cada caso toca las pertenencias con el administrador (que las confirma) y corre el SQL de 0012 como el rol que
    // migra, dentro de una transacción que se revierte: lo que se prueba es el chequeo, con el archivo real.
    const sqlDe0012 = async () => {
      const { readFile } = await import("node:fs/promises");
      return (await readFile(join(CARPETA_REAL, "0012_respaldo.sql"), "utf8")).replaceAll(
        "\r\n",
        "\n",
      );
    };
    async function correr0012ComoDueno(): Promise<{
      error: { code?: string; message: string } | null;
    }> {
      const c = new pg.Client({ connectionString: url(DUENO, "neondb") });
      await c.connect();
      try {
        await c.query("BEGIN");
        try {
          await c.query(await sqlDe0012());
          return { error: null };
        } catch (e) {
          return { error: e as { code?: string; message: string } };
        } finally {
          await c.query("ROLLBACK");
        }
      } finally {
        await c.end();
      }
    }
    const sufijo = () => sufijoUnico();

    it("con la pertenencia automática del creador, 0012 repetida pasa", async () => {
      expect((await correr0012ComoDueno()).error).toBeNull();
    });

    it("sin ninguna pertenencia (creador superusuario), 0012 pasa", async () => {
      await admin.query(`REVOKE ${RESPALDO} FROM ${DUENO}`);
      try {
        expect((await correr0012ComoDueno()).error).toBeNull();
      } finally {
        await admin.query(
          `GRANT ${RESPALDO} TO ${DUENO} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
        );
      }
    });

    it("FALLA si la pertenencia del que migra hereda (inherit_option)", async () => {
      await admin.query(`GRANT ${RESPALDO} TO ${DUENO} WITH ADMIN TRUE, INHERIT TRUE, SET FALSE`);
      try {
        const { error } = await correr0012ComoDueno();
        expect(error?.code).toBe("55000");
        expect(error?.message).toContain(`${DUENO} es miembro de ${RESPALDO}`);
      } finally {
        await admin.query(
          `GRANT ${RESPALDO} TO ${DUENO} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
        );
      }
    });

    it("FALLA si la pertenencia del que migra permite SET ROLE (set_option)", async () => {
      await admin.query(`GRANT ${RESPALDO} TO ${DUENO} WITH ADMIN TRUE, INHERIT FALSE, SET TRUE`);
      try {
        const { error } = await correr0012ComoDueno();
        expect(error?.code).toBe("55000");
        expect(error?.message).toContain(`${DUENO} es miembro de ${RESPALDO}`);
      } finally {
        await admin.query(
          `GRANT ${RESPALDO} TO ${DUENO} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
        );
      }
    });

    for (const [nombre, opciones] of [
      ["inherit y set", "INHERIT TRUE, SET TRUE"],
      ["solo inherit", "INHERIT TRUE, SET FALSE"],
      ["solo set", "INHERIT FALSE, SET TRUE"],
      ["ni inherit ni set (otro rol, no el que migra)", "INHERIT FALSE, SET FALSE"],
    ] as const) {
      it(`FALLA si OTRO rol es miembro del rol de respaldo (${nombre})`, async () => {
        const otro = `ajeno_${sufijo()}`;
        await admin.query(`CREATE ROLE ${otro} NOLOGIN`);
        await admin.query(`GRANT ${RESPALDO} TO ${otro} WITH ADMIN FALSE, ${opciones}`);
        try {
          const { error } = await correr0012ComoDueno();
          expect(error?.code).toBe("55000");
          expect(error?.message).toContain(`${otro} es miembro de ${RESPALDO}`);
          // La pertenencia automática del creador NO aparece entre las ajenas.
          expect(error?.message).not.toContain(`${DUENO} es miembro`);
        } finally {
          await admin.query(`DROP ROLE ${otro}`);
        }
      });
    }

    it("FALLA si el rol de respaldo es miembro de otro rol (el caso neon_superuser)", async () => {
      await admin.query(
        `GRANT ${GRUPO_DEL_PROVEEDOR} TO ${RESPALDO} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
      );
      try {
        const { error } = await correr0012ComoDueno();
        expect(error?.code).toBe("55000");
        expect(error?.message).toContain(`${RESPALDO} es miembro de ${GRUPO_DEL_PROVEEDOR}`);
      } finally {
        await admin.query(`REVOKE ${GRUPO_DEL_PROVEEDOR} FROM ${RESPALDO}`);
      }
    });

    it("la pertenencia automática de OTRO creador no se ignora (solo la del rol que migra)", async () => {
      // Un segundo rol CREATEROLE crea y es miembro automático; migrando como DUENO esa pertenencia es ajena.
      const otro = `creador_${sufijo()}`;
      await admin.query(`CREATE ROLE ${otro} NOLOGIN`);
      await admin.query(`GRANT ${RESPALDO} TO ${otro} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
      try {
        const { error } = await correr0012ComoDueno();
        expect(error?.code).toBe("55000");
        expect(error?.message).toContain(`${otro} es miembro de ${RESPALDO}`);
      } finally {
        await admin.query(`DROP ROLE ${otro}`);
      }
    });

    it("el resto del historial (0013 en adelante) también migra como rol no superusuario", async () => {
      const resultado = await aplicarMigraciones(url(DUENO, "neondb"), CARPETA_REAL);
      expect(resultado.yaAplicadas).toHaveLength(12);
      expect(resultado.aplicadas.length).toBeGreaterThan(0);
      expect(resultado.aplicadas[0]).toBe("0013_permisos_minimos.sql");
    });
  },
);
