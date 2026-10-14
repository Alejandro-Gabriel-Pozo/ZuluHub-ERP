import { spawn } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { leerEstadoDeMigraciones } from "../../src/adaptadores/postgres/estado-de-migraciones";
import { ejecutarMigracion, VARIABLE_DE_LA_CADENA } from "../../scripts/ejecutar-migracion";
import { crearBaseAparte } from "./entorno";

/**
 * El comando que migra la base real (`scripts/migrar-base.ts`, lo que corre el workflow «Migrar base»),
 * contra un Postgres de verdad: «ver» no escribe nada, «aplicar» aplica y repetirlo no hace nada, dos
 * «aplicar» a la vez no se pisan, el pooler se rechaza y NINGÚN mensaje repite la cadena de conexión
 * (ni usuario, ni clave, ni host) aunque la conexión falle.
 *
 * Los flujos principales corren el script de verdad en un proceso aparte (así se prueba también que
 * Node lo carga sin compilar y que el código de salida es el correcto); los casos que necesitan una
 * carpeta de migraciones propia llaman a `ejecutarMigracion` en el mismo proceso.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const RAIZ = join(import.meta.dirname, "../..");
const CARPETA_REAL = join(RAIZ, "migraciones");
const SCRIPT = join(RAIZ, "scripts/migrar-base.ts");

type Salida = { codigo: number; texto: string; stdout: string; stderr: string };

/** Corre el script como lo hace `npm run migrar` y junta lo que escribió. Solo recibe PATH y la cadena. */
function correrScript(argumento: string, cadena: string | undefined): Promise<Salida> {
  // Los tipos de Next (que entran al `tsc` raíz por las pruebas de la web) exigen `NODE_ENV` en
  // `ProcessEnv`; este entorno mínimo es a propósito solo PATH y la cadena.
  const entorno = { PATH: process.env["PATH"] ?? "" } as Record<
    string,
    string
  > as NodeJS.ProcessEnv;
  if (cadena !== undefined) entorno[VARIABLE_DE_LA_CADENA] = cadena;
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SCRIPT, argumento],
      { env: entorno, cwd: RAIZ },
    );
    let stdout = "";
    let stderr = "";
    hijo.stdout.on("data", (trozo: Buffer) => (stdout += trozo.toString()));
    hijo.stderr.on("data", (trozo: Buffer) => (stderr += trozo.toString()));
    hijo.on("error", rechazar);
    hijo.on("close", (codigo) =>
      resolver({ codigo: codigo ?? -1, texto: `${stdout}\n${stderr}`, stdout, stderr }),
    );
  });
}

/** Lo mismo, en este proceso y con la carpeta que se elija. */
async function correrAca(argumento: string, cadena: string | undefined, carpeta: string) {
  const info: string[] = [];
  const error: string[] = [];
  const entorno: Record<string, string | undefined> = { [VARIABLE_DE_LA_CADENA]: cadena };
  const codigo = await ejecutarMigracion({
    argumentos: [argumento],
    entorno,
    carpeta,
    info: (l) => info.push(l),
    error: (l) => error.push(l),
    secreto: () => undefined,
  });
  return {
    codigo,
    info: info.join("\n"),
    error: error.join("\n"),
    texto: [...info, ...error].join("\n"),
  };
}

const cuantasAplicadasAhora = (texto: string) =>
  Number(/Aplicadas ahora \((\d+)\)/.exec(texto)?.[1] ?? Number.NaN);

async function consultar<T extends pg.QueryResultRow>(url: string, sql: string): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return (await cliente.query<T>(sql)).rows;
  } finally {
    await cliente.end();
  }
}

const tablasDeLaBase = async (url: string) =>
  (
    await consultar<{ relname: string }>(
      url,
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY 1",
    )
  ).map((f) => f.relname);

const registradas = async (url: string) =>
  (await consultar<{ nombre: string }>(url, "SELECT nombre FROM migracion ORDER BY nombre")).map(
    (f) => f.nombre,
  );

describe.skipIf(base === null)("migrar-base: el comando que migra la base real", () => {
  let archivosReales: string[];

  beforeAll(async () => {
    archivosReales = (await readdir(CARPETA_REAL)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  });

  describe("«ver» y «aplicar» sobre una base vacía", () => {
    let url: string;
    let destruir: () => Promise<void>;

    beforeAll(async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base, { migrar: false });
      url = aparte.base.dueno;
      destruir = aparte.destruir;
    });
    afterAll(async () => {
      await destruir?.();
    });

    it("«ver» en una base vacía lista todas como pendientes y no escribe nada (ni la tabla de control)", async () => {
      const salida = await correrScript("--ver", url);
      expect(salida.codigo).toBe(0);
      expect(salida.stdout).toContain("Modo: VER");
      expect(salida.stdout).toContain("Tabla de control: todavía no existe");
      expect(salida.stdout).toContain("Aplicadas (0):");
      expect(salida.stdout).toContain(`Pendientes (${archivosReales.length}):`);
      for (const archivo of archivosReales) expect(salida.stdout).toContain(`  - ${archivo}`);
      expect(salida.stdout).toContain(`faltan aplicar ${archivosReales.length} migraciones`);
      expect(archivosReales.length).toBeGreaterThanOrEqual(10);
      // Ni una tabla, ni la de control: la base quedó exactamente como estaba.
      expect(await tablasDeLaBase(url)).toEqual([]);
    });

    it("«ver» corre en una transacción READ ONLY que termina en ROLLBACK, sin pedir el bloqueo de sesión", async () => {
      const espia = vi.spyOn(pg.Client.prototype, "query");
      let consultas: string[];
      try {
        await leerEstadoDeMigraciones(url, CARPETA_REAL);
        consultas = espia.mock.calls.map(([primero]) =>
          typeof primero === "string" ? primero : "",
        );
      } finally {
        espia.mockRestore();
      }
      expect(consultas[0]).toBe("BEGIN READ ONLY");
      expect(consultas.at(-1)).toBe("ROLLBACK");
      const escritura =
        /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|COMMIT|pg_advisory_lock)\b/i;
      expect(consultas.filter((c) => escritura.test(c))).toEqual([]);
    });

    it("«aplicar» aplica todas, en orden, y deja el registro", async () => {
      const salida = await correrScript("--aplicar", url);
      expect(salida.codigo).toBe(0);
      expect(cuantasAplicadasAhora(salida.stdout)).toBe(archivosReales.length);
      expect(salida.stdout).toContain(`se aplicaron ${archivosReales.length} migraciones`);
      expect(await registradas(url)).toEqual(archivosReales);
      expect(await tablasDeLaBase(url)).toContain("empresa");
    });

    it("repetir «aplicar» no hace nada: mismo resultado exitoso, el registro queda intacto", async () => {
      const antes = await consultar<{ nombre: string; aplicada_en: Date }>(
        url,
        "SELECT nombre, aplicada_en FROM migracion ORDER BY nombre",
      );
      const salida = await correrScript("--aplicar", url);
      expect(salida.codigo).toBe(0);
      expect(cuantasAplicadasAhora(salida.stdout)).toBe(0);
      expect(salida.stdout).toContain(`Ya estaban aplicadas: ${archivosReales.length}.`);
      expect(salida.stdout).toContain("la base ya estaba al día; no se cambió nada");
      const despues = await consultar<{ nombre: string; aplicada_en: Date }>(
        url,
        "SELECT nombre, aplicada_en FROM migracion ORDER BY nombre",
      );
      expect(despues).toEqual(antes);
    });

    it("«ver» después de aplicar: nada pendiente y nada editado (el checksum coincide con el del ejecutor)", async () => {
      const salida = await correrScript("--ver", url);
      expect(salida.codigo).toBe(0);
      expect(salida.stdout).toContain(`Aplicadas (${archivosReales.length}):`);
      expect(salida.stdout).toContain("Pendientes (0):");
      expect(salida.stdout).toContain("la base está al día");
      expect(salida.stderr).toBe("");
    });
  });

  describe("sobre una base ya migrada con una carpeta propia", () => {
    let url: string;
    let destruir: () => Promise<void>;
    let carpeta: string;

    beforeAll(async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base, { migrar: false });
      url = aparte.base.dueno;
      destruir = aparte.destruir;
      carpeta = await mkdtemp(join(tmpdir(), "zuluhub-migrar-"));
      for (const archivo of archivosReales) {
        await cp(join(CARPETA_REAL, archivo), join(carpeta, archivo));
      }
      const aplicada = await correrAca("--aplicar", url, carpeta);
      expect(aplicada.codigo).toBe(0);
    });
    afterAll(async () => {
      await destruir?.();
      if (carpeta !== undefined) await rm(carpeta, { recursive: true, force: true });
    });

    it("«ver» detecta una migración aplicada que se editó, y «aplicar» no toca nada (ni las pendientes)", async () => {
      const segunda = join(carpeta, archivosReales[1] as string);
      const original = await readFile(segunda, "utf8");
      const nueva = join(carpeta, "9999_nueva.sql");
      try {
        await writeFile(segunda, `${original}\n-- editada\n`);
        await writeFile(nueva, "CREATE TABLE no_debe_existir (id int);\n");
        const ver = await correrAca("--ver", url, carpeta);
        expect(ver.codigo).toBe(1);
        expect(ver.error).toContain(`${archivosReales[1]} ya se aplicó y el archivo se editó`);
        const aplicar = await correrAca("--aplicar", url, carpeta);
        expect(aplicar.codigo).toBe(1);
        expect(aplicar.texto).toContain("RESULTADO: FALLA");
        expect(await registradas(url)).toEqual(archivosReales);
        expect(await tablasDeLaBase(url)).not.toContain("no_debe_existir");
      } finally {
        await writeFile(segunda, original);
        await rm(nueva, { force: true });
      }
    });

    it("«ver» detecta una migración registrada cuyo archivo ya no está", async () => {
      const tercera = join(carpeta, archivosReales[2] as string);
      const original = await readFile(tercera, "utf8");
      try {
        await rm(tercera);
        const ver = await correrAca("--ver", url, carpeta);
        expect(ver.codigo).toBe(1);
        expect(ver.error).toContain(
          `${archivosReales[2]} figura como aplicada pero su archivo ya no existe`,
        );
      } finally {
        await writeFile(tercera, original);
      }
    });

    it("un checkout con fin de línea CRLF no hace pasar por editada una migración aplicada", async () => {
      const originales = new Map<string, string>();
      try {
        for (const archivo of archivosReales) {
          const ruta = join(carpeta, archivo);
          const texto = await readFile(ruta, "utf8");
          originales.set(ruta, texto);
          await writeFile(ruta, texto.replaceAll("\n", "\r\n"));
        }
        const ver = await correrAca("--ver", url, carpeta);
        expect(ver.codigo).toBe(0);
        expect(ver.info).toContain("Pendientes (0):");
      } finally {
        for (const [ruta, texto] of originales) await writeFile(ruta, texto);
      }
    });

    it("«ver» con la carpeta con menos archivos que la base, y con una pendiente nueva, las muestra aparte", async () => {
      const nueva = join(carpeta, "9998_pendiente.sql");
      try {
        await writeFile(nueva, "SELECT 1;\n");
        const ver = await correrAca("--ver", url, carpeta);
        expect(ver.codigo).toBe(0);
        expect(ver.info).toContain(`Aplicadas (${archivosReales.length}):`);
        expect(ver.info).toContain("Pendientes (1):\n  - 9998_pendiente.sql");
        expect(ver.info).toContain("faltan aplicar 1 migraciones");
      } finally {
        await rm(nueva, { force: true });
      }
    });

    it("«aplicar» con una migración que falla: dice cuál quedó pendiente, nada queda a medias y el mensaje es el de la base", async () => {
      const buena = join(carpeta, "9001_buena.sql");
      const mala = join(carpeta, "9002_mala.sql");
      try {
        await writeFile(buena, "CREATE TABLE prueba_buena (id int);\n");
        await writeFile(
          mala,
          `CREATE TABLE prueba_mala (id int);
DO $$ BEGIN
  RAISE EXCEPTION 'los roles de ZuluHub no pueden ser miembros de otros roles (zuluhub_app es miembro de neon_superuser): revocar la pertenencia y repetir'
    USING ERRCODE = '55000';
END $$;\n`,
        );
        const salida = await correrAca("--aplicar", url, carpeta);
        expect(salida.codigo).toBe(1);
        expect(salida.error).toContain(
          "los roles de ZuluHub no pueden ser miembros de otros roles (zuluhub_app es miembro de neon_superuser): revocar la pertenencia y repetir",
        );
        expect(salida.error).toContain("[55000]");
        expect(salida.error).toContain("es la primera pendiente (9002_mala.sql)");
        expect(salida.error).toContain("RESULTADO: FALLA");
        const tablas = await tablasDeLaBase(url);
        expect(tablas).toContain("prueba_buena");
        expect(tablas).not.toContain("prueba_mala");
        expect(await registradas(url)).toEqual([...archivosReales, "9001_buena.sql"]);
      } finally {
        await rm(buena, { force: true });
        await rm(mala, { force: true });
      }
    });
  });

  describe("dos «aplicar» a la vez", () => {
    it("dos procesos sobre una base vacía: no duplican ni se rompen, y entre los dos aplican cada migración una sola vez", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base, { migrar: false });
      try {
        const url = aparte.base.dueno;
        const salidas = await Promise.all([
          correrScript("--aplicar", url),
          correrScript("--aplicar", url),
          correrScript("--aplicar", url),
        ]);
        expect(salidas.map((s) => s.codigo)).toEqual([0, 0, 0]);
        const aplicadas = salidas.map((s) => cuantasAplicadasAhora(s.stdout)).sort((a, b) => a - b);
        expect(aplicadas).toEqual([0, 0, archivosReales.length]);
        expect(await registradas(url)).toEqual(archivosReales);
        const duplicadas = await consultar<{ nombre: string }>(
          url,
          "SELECT nombre FROM migracion GROUP BY nombre HAVING count(*) > 1",
        );
        expect(duplicadas).toEqual([]);
      } finally {
        await aparte.destruir();
      }
    });

    it("dos ejecuciones en el mismo proceso, soltadas a la vez, tampoco: una aplica todo y la otra espera su turno", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base, { migrar: false });
      try {
        const url = aparte.base.dueno;
        const resultados = await Promise.all([
          correrAca("--aplicar", url, CARPETA_REAL),
          correrAca("--aplicar", url, CARPETA_REAL),
        ]);
        expect(resultados.map((r) => r.codigo)).toEqual([0, 0]);
        const aplicadas = resultados
          .map((r) => cuantasAplicadasAhora(r.info))
          .sort((a, b) => a - b);
        expect(aplicadas).toEqual([0, archivosReales.length]);
        expect(await registradas(url)).toEqual(archivosReales);
      } finally {
        await aparte.destruir();
      }
    });
  });

  describe("la cadena de conexión no aparece jamás en lo que se escribe", () => {
    const USUARIO = "usuario_secreto_zz";
    const CLAVE = "clave-secreta-zz-123";
    const HOST = "ep-fria-luna-123456-pooler.sa-east-1.aws.ejemplo.tech";
    const rastros = [USUARIO, CLAVE, "ep-fria-luna", "ejemplo.tech", "base_secreta_zz"];

    const sinRastros = (texto: string) => {
      for (const rastro of rastros) expect(texto).not.toContain(rastro);
    };

    it.each(["--ver", "--aplicar"])(
      "%s con la cadena del pooler: falla con un mensaje claro, sin conectarse y sin repetir la cadena",
      async (modo) => {
        const cadena = `postgresql://${USUARIO}:${CLAVE}@${HOST}/base_secreta_zz?sslmode=require`;
        const salida = await correrScript(modo, cadena);
        expect(salida.codigo).toBe(1);
        expect(salida.stderr).toContain("apunta al pooler");
        expect(salida.stderr).toContain("cadena DIRECTA");
        expect(salida.stderr).toContain("RESULTADO: FALLA");
        sinRastros(salida.texto);
      },
    );

    it.each(["--ver", "--aplicar"])(
      "%s con una base que no responde: falla por el código de la conexión, sin host, usuario ni clave",
      async (modo) => {
        const cadena = `postgresql://${USUARIO}:${CLAVE}@127.0.0.1:1/base_secreta_zz`;
        const salida = await correrScript(modo, cadena);
        expect(salida.codigo).toBe(1);
        expect(salida.stderr).toContain(
          "no se pudo conectar con el servidor de la base (ECONNREFUSED)",
        );
        sinRastros(salida.texto);
        expect(salida.texto).not.toContain("127.0.0.1");
      },
    );

    it("sin la variable, con un valor que no es una cadena o con argumentos incorrectos falla con código distinto de cero", async () => {
      const sinVariable = await correrScript("--ver", undefined);
      expect(sinVariable.codigo).toBe(1);
      expect(sinVariable.stderr).toContain(`falta la variable ${VARIABLE_DE_LA_CADENA}`);

      const vacia = await correrScript("--ver", "   ");
      expect(vacia.codigo).toBe(1);
      expect(vacia.stderr).toContain(`falta la variable ${VARIABLE_DE_LA_CADENA}`);

      const rara = await correrScript("--ver", `${USUARIO} ${CLAVE}`);
      expect(rara.codigo).toBe(1);
      expect(rara.stderr).toContain("no tiene forma de cadena de conexión");
      sinRastros(rara.texto);

      const otroProtocolo = await correrScript(
        "--ver",
        `https://${USUARIO}:${CLAVE}@algo.ejemplo.tech/x`,
      );
      expect(otroProtocolo.codigo).toBe(1);
      sinRastros(otroProtocolo.texto);

      const sinModo = await correrScript("", "postgresql://u:c@h/b");
      expect(sinModo.codigo).toBe(2);
      expect(sinModo.stderr).toContain("uso: migrar-base --ver | --aplicar | --preparar-roles");

      const modoInexistente = await correrScript("--borrar-todo", "postgresql://u:c@h/b");
      expect(modoInexistente.codigo).toBe(2);
    });

    it("dos modos a la vez o ninguno es un uso incorrecto (código 2)", async () => {
      const dos = await ejecutarMigracion({
        argumentos: ["--ver", "--aplicar"],
        entorno: {},
        carpeta: CARPETA_REAL,
        info: () => undefined,
        error: () => undefined,
        secreto: () => undefined,
      });
      expect(dos).toBe(2);
      const ninguno = await ejecutarMigracion({
        argumentos: [],
        entorno: {},
        carpeta: CARPETA_REAL,
        info: () => undefined,
        error: () => undefined,
        secreto: () => undefined,
      });
      expect(ninguno).toBe(2);
    });

    it("un secreto pegado con espacios o salto de línea al final funciona igual", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base, { migrar: false });
      try {
        const salida = await correrScript("--ver", `  ${aparte.base.dueno}\n`);
        expect(salida.codigo).toBe(0);
        expect(salida.stdout).toContain("Modo: VER");
      } finally {
        await aparte.destruir();
      }
    });
  });
});
