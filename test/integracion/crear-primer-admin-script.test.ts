import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  VARIABLE_DE_LA_CADENA,
  ejecutarCreacionDelPrimerAdmin,
} from "../../scripts/ejecutar-crear-primer-admin";
import { adminPlataformaId } from "../../src/primitivas/identificadores/marca";
import { crearEmpresaActiva, crearEntornoDePrueba, type EmpresaDePrueba } from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, emailAlAzar } from "./fixtures-identidad";

/**
 * `scripts/crear-primer-admin.ts`: siembra al primer administrador, es idempotente, rechaza lo que no sirve,
 * NO imprime la cadena ni el email, y arranca de verdad con Node sin compilar (`npm run plataforma:primer-admin`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const ejecutarArchivo = promisify(execFile);

describe.skipIf(base === null)("el script del primer administrador", () => {
  let dueno: pg.Client;
  let activa: EmpresaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    activa = await crearEmpresaActiva(crearEntornoDePrueba(base));
  });
  afterAll(async () => {
    await dueno.end();
  });

  const cadena = () => (base as NonNullable<typeof base>).dueno;

  async function correr(
    argumentos: string[],
    entorno: Record<string, string | undefined> = { [VARIABLE_DE_LA_CADENA]: cadena() },
    sembrar?: Parameters<typeof ejecutarCreacionDelPrimerAdmin>[0]["sembrar"],
  ) {
    const salida: string[] = [];
    const errores: string[] = [];
    const codigo = await ejecutarCreacionDelPrimerAdmin({
      argumentos,
      entorno,
      info: (l) => salida.push(l),
      error: (l) => errores.push(l),
      ...(sembrar === undefined ? {} : { sembrar }),
    });
    return { codigo, salida, errores, texto: [...salida, ...errores].join("\n") };
  }

  const cuantosAdmins = async (email: string) =>
    (await dueno.query("select 1 from admin_plataforma where email = $1", [email])).rowCount;

  it("siembra al administrador, imprime su identificador y nunca el email ni la cadena", async () => {
    const email = emailAlAzar("script");
    const r = await correr([email]);
    expect(r.codigo).toBe(0);
    expect(r.errores).toEqual([]);
    const { rows } = await dueno.query<{ id: string }>(
      "select id from admin_plataforma where email = $1",
      [email],
    );
    expect(r.salida).toEqual([
      `RESULTADO: OK, quedó sembrado el administrador de plataforma (ADMIN), identificador ${rows[0]?.id}.`,
    ]);
    expect(r.texto).not.toContain(email);
    expect(r.texto).not.toContain(email.split("@")[0]);
    expect(r.texto).not.toContain(cadena());
    const contrasena = new URL(cadena()).password;
    if (contrasena !== "") expect(r.texto).not.toContain(contrasena);
  });

  it("repetirlo dice «ya estaba», sale con 0 y no duplica", async () => {
    const email = emailAlAzar("script");
    await correr([email]);
    const segunda = await correr([email.toUpperCase()]);
    expect(segunda.codigo).toBe(0);
    expect(segunda.salida).toHaveLength(1);
    expect(segunda.salida[0]).toMatch(/^RESULTADO: OK, ya estaba \(identificador [0-9a-f-]{36}\)/);
    expect(await cuantosAdmins(email)).toBe(1);
  });

  it("un email con membresía se rechaza con una explicación y sin tocar nada", async () => {
    const persona = await crearPersonaDeBase(dueno, emailAlAzar("script"));
    await crearMembresiaDeBase(dueno, activa.empresa, persona.id, "GERENTE");
    const r = await correr([persona.email]);
    expect(r.codigo).toBe(1);
    expect(r.errores.join("\n")).toContain("no puede tener ninguna membresía");
    expect(r.errores.join("\n")).toContain("RESULTADO: RECHAZADO");
    expect(r.texto).not.toContain(persona.email);
    expect(await cuantosAdmins(persona.email)).toBe(0);
  });

  it("un email mal formado sale con 2 y sin conectar", async () => {
    const r = await correr(["no-es-un-email"], {
      [VARIABLE_DE_LA_CADENA]: "postgres://nadie:nada@127.0.0.1:1/ninguna",
    });
    expect(r.codigo).toBe(2);
    expect(r.errores.join("\n")).toContain("no tiene forma de email");
    expect(r.texto).not.toContain("no-es-un-email");
  });

  it.each([
    ["sin argumentos", []],
    ["con el email vacío", ["  "]],
    ["con argumentos de más", ["a@x.test", "b@x.test"]],
  ])("%s: muestra el uso y sale con 2", async (_cual, argumentos) => {
    const r = await correr(argumentos);
    expect(r.codigo).toBe(2);
    expect(r.errores).toEqual([
      "Uso: npm run plataforma:primer-admin -- <email del administrador>",
    ]);
  });

  it.each([
    ["sin la cadena", {}, "falta la variable"],
    ["con la cadena en blanco", { [VARIABLE_DE_LA_CADENA]: "  " }, "falta la variable"],
    [
      "con una cadena que no es de Postgres",
      { [VARIABLE_DE_LA_CADENA]: "https://ejemplo.test" },
      "no tiene forma de cadena de conexión",
    ],
    [
      "con la cadena del pooler",
      { [VARIABLE_DE_LA_CADENA]: "postgres://u:c@ep-algo-pooler.region.aws.neon.tech/base" },
      "apunta al pooler",
    ],
  ])("%s: falla antes de tocar nada", async (_cual, entorno, mensaje) => {
    const email = emailAlAzar("script");
    const r = await correr([email], entorno);
    expect(r.codigo).toBe(1);
    expect(r.errores.join("\n")).toContain(mensaje);
    expect(await cuantosAdmins(email)).toBe(0);
  });

  it("no imprime nunca la cadena ni el email, ni siquiera cuando la falla los repite", async () => {
    const email = emailAlAzar("script");
    const centinela = "centinela-de-la-contrasena-98765";
    const conexion = `postgres://usuario-centinela:${centinela}@127.0.0.1:1/base-centinela`;
    // Una cadena que no conecta: sale por `describirFallaDeBase`.
    const sinConexion = await correr([email], { [VARIABLE_DE_LA_CADENA]: conexion });
    // Una falla que repite todo lo que sabe, como haría un error de red o de la base.
    const repetidora = await correr([email], { [VARIABLE_DE_LA_CADENA]: conexion }, () =>
      Promise.reject(new Error(`falló con ${conexion} para ${email}`)),
    );
    for (const r of [sinConexion, repetidora]) {
      expect(r.codigo).toBe(1);
      expect(r.errores.join("\n")).toContain("RESULTADO: FALLA");
      for (const prohibido of [centinela, "usuario-centinela", "base-centinela", email]) {
        expect(r.texto).not.toContain(prohibido);
      }
    }
  });

  it("un administrador existente que no es ADMIN activo se explica y no se toca", async () => {
    const email = emailAlAzar("script");
    await dueno.query("insert into admin_plataforma (email, rol) values ($1, 'SOPORTE')", [email]);
    const r = await correr([email]);
    expect(r.codigo).toBe(1);
    expect(r.errores.join("\n")).toContain("no es ADMIN activo");
    expect(
      (await dueno.query("select rol from admin_plataforma where email = $1", [email])).rows,
    ).toEqual([{ rol: "SOPORTE" }]);
  });

  it("arranca de verdad con Node sin compilar, con el comando de package.json", async () => {
    const email = emailAlAzar("arranque");
    const comando = (
      JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts["plataforma:primer-admin"];
    expect(comando?.startsWith("node ")).toBe(true);
    const argumentosDeNode = (comando as string).split(" ").slice(1);
    const ejecutar = () =>
      ejecutarArchivo(process.execPath, [...argumentosDeNode, email], {
        cwd: join(import.meta.dirname, "../.."),
        env: {
          NODE_ENV: "test",
          PATH: process.env["PATH"] ?? "",
          [VARIABLE_DE_LA_CADENA]: cadena(),
        },
      });
    const primera = await ejecutar();
    expect(primera.stdout.trim()).toMatch(
      /^RESULTADO: OK, quedó sembrado el administrador de plataforma \(ADMIN\), identificador [0-9a-f-]{36}\.$/,
    );
    expect(primera.stderr).toBe("");
    const segunda = await ejecutar();
    expect(segunda.stdout.trim()).toMatch(/^RESULTADO: OK, ya estaba/);
    expect(primera.stdout + segunda.stdout).not.toContain(email);
    const { rows } = await dueno.query<{ id: string }>(
      "select id from admin_plataforma where email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(adminPlataformaId(rows[0]?.id as string)).toBeTruthy();
  });
});
