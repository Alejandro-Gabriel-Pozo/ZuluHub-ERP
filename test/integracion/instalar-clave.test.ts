import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ZULUHUB_CLAVE_CONTEXTO } from "../../src/adaptadores/postgres/contexto-firmado";
import {
  VARIABLE_DE_LA_CADENA,
  ejecutarInstalacionDeClave,
} from "../../scripts/ejecutar-instalar-clave";
import { crearBaseAparte } from "./entorno";

/**
 * `scripts/instalar-clave-de-contexto.ts` (el paso «instalar la clave de contexto» de `migrar.yml`): instala
 * en la base la clave que la aplicación tiene en Vercel, es idempotente, rechaza lo que no sirve y NO imprime
 * la cadena ni el secreto de la clave. Y arranca de verdad con Node sin compilar (sin `tsx`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const ejecutarArchivo = promisify(execFile);

const claveNueva = (kid: number) => `${kid}:${randomBytes(32).toString("hex")}`;

describe.skipIf(base === null)("instalar la clave de contexto", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base, { sinClave: true });
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const kids = async (): Promise<number[]> =>
    (await dueno.query<{ kid: number }>("select kid from contexto_clave order by kid")).rows.map(
      (f) => f.kid,
    );

  async function correr(entorno: Record<string, string | undefined>) {
    const salida: string[] = [];
    const errores: string[] = [];
    const codigo = await ejecutarInstalacionDeClave({
      entorno,
      info: (l) => salida.push(l),
      error: (l) => errores.push(l),
    });
    return { codigo, texto: [...salida, ...errores].join("\n"), salida, errores };
  }

  it("instala la clave, es idempotente, y no imprime ni la cadena ni el secreto", async () => {
    const clave = claveNueva(7);
    const entorno = {
      [VARIABLE_DE_LA_CADENA]: propia.base.dueno,
      [ZULUHUB_CLAVE_CONTEXTO]: clave,
    };
    const primera = await correr(entorno);
    expect(primera.codigo).toBe(0);
    expect(primera.salida).toEqual([
      "RESULTADO: OK, la clave de contexto kid 7 está instalada en la base.",
    ]);
    expect(await kids()).toEqual([7]);
    const segunda = await correr(entorno);
    expect(segunda.codigo).toBe(0);
    expect(await kids()).toEqual([7]);
    for (const { texto } of [primera, segunda]) {
      expect(texto).not.toContain(clave.split(":")[1]);
      expect(texto).not.toContain(new URL(propia.base.dueno).password);
      expect(texto).not.toContain(propia.base.dueno);
    }
  });

  it("el mismo kid con OTRO secreto falla sin decir cuál era ni cuál es (la rotación es con otro kid)", async () => {
    const otra = claveNueva(7);
    const r = await correr({
      [VARIABLE_DE_LA_CADENA]: propia.base.dueno,
      [ZULUHUB_CLAVE_CONTEXTO]: otra,
    });
    expect(r.codigo).toBe(1);
    expect(r.texto).toContain("ya existe la clave de contexto kid 7 con otro secreto");
    expect(r.texto).toContain("RESULTADO: FALLA");
    expect(r.texto).not.toContain(otra.split(":")[1]);
    expect(await kids()).toEqual([7]);
  });

  it("otro kid suma una clave (la rotación)", async () => {
    const r = await correr({
      [VARIABLE_DE_LA_CADENA]: propia.base.dueno,
      [ZULUHUB_CLAVE_CONTEXTO]: claveNueva(8),
    });
    expect(r.codigo).toBe(0);
    expect(await kids()).toEqual([7, 8]);
  });

  it.each([
    ["sin la cadena", { [ZULUHUB_CLAVE_CONTEXTO]: claveNueva(9) }, "falta la variable"],
    [
      "con la cadena vacía",
      { [VARIABLE_DE_LA_CADENA]: "  ", [ZULUHUB_CLAVE_CONTEXTO]: claveNueva(9) },
      "falta la variable",
    ],
    [
      "con una cadena que no es de Postgres",
      { [VARIABLE_DE_LA_CADENA]: "https://ejemplo.test", [ZULUHUB_CLAVE_CONTEXTO]: claveNueva(9) },
      "no tiene forma de cadena de conexión",
    ],
    [
      "con la cadena del pooler",
      {
        [VARIABLE_DE_LA_CADENA]: "postgres://u:c@ep-algo-pooler.region.aws.neon.tech/base",
        [ZULUHUB_CLAVE_CONTEXTO]: claveNueva(9),
      },
      "apunta al pooler",
    ],
  ])("%s: falla antes de tocar nada", async (_cual, entorno, mensaje) => {
    const r = await correr(entorno);
    expect(r.codigo).toBe(1);
    expect(r.errores.join("\n")).toContain(mensaje);
    expect(await kids()).toEqual([7, 8]);
  });

  it.each([
    ["sin clave", undefined],
    ["vacía", "  "],
    ["sin kid", "abcd".repeat(16)],
    ["kid cero", `0:${"ab".repeat(32)}`],
    ["no hexadecimal", `1:${"zz".repeat(32)}`],
    ["muy corta", "1:abcd"],
  ])("la clave %s se rechaza sin repetir su valor", async (_cual, clave) => {
    const r = await correr({
      [VARIABLE_DE_LA_CADENA]: propia.base.dueno,
      [ZULUHUB_CLAVE_CONTEXTO]: clave,
    });
    expect(r.codigo).toBe(1);
    expect(r.errores.join("\n")).toContain(`${ZULUHUB_CLAVE_CONTEXTO} inválida`);
    if (clave !== undefined && clave.trim() !== "") expect(r.texto).not.toContain(clave.trim());
    expect(await kids()).toEqual([7, 8]);
  });

  it("con una cadena que no conecta: falla sin repetir la cadena ni la clave", async () => {
    const clave = claveNueva(9);
    const cadena = "postgres://usuario:clave-secreta-123@127.0.0.1:1/base";
    const r = await correr({ [VARIABLE_DE_LA_CADENA]: cadena, [ZULUHUB_CLAVE_CONTEXTO]: clave });
    expect(r.codigo).toBe(1);
    expect(r.texto).toContain("RESULTADO: FALLA");
    expect(r.texto).not.toContain("clave-secreta-123");
    expect(r.texto).not.toContain(clave.split(":")[1]);
  });

  it("arranca de verdad con Node sin compilar (`npm run instalar-clave`), sin tsx", async () => {
    const clave = claveNueva(10);
    const { stdout, stderr } = await ejecutarArchivo(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        join(import.meta.dirname, "../../scripts/instalar-clave-de-contexto.ts"),
      ],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          [VARIABLE_DE_LA_CADENA]: propia.base.dueno,
          [ZULUHUB_CLAVE_CONTEXTO]: clave,
        },
      },
    );
    expect(stdout.trim()).toBe(
      "RESULTADO: OK, la clave de contexto kid 10 está instalada en la base.",
    );
    expect(stderr).toBe("");
    expect(await kids()).toEqual([7, 8, 10]);
  });
});
