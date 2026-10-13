import { randomBytes } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { verificadorScram } from "../../src/adaptadores/postgres/preparar-roles";
import type { RolPorPreparar } from "../../src/adaptadores/postgres/roles-de-la-aplicacion";
import { ejecutarMigracion, VARIABLE_DE_LA_CADENA } from "../../scripts/ejecutar-migracion";
import { crearBaseAparte } from "./entorno";

/**
 * `--preparar-roles`: aplica las migraciones y da LOGIN con contraseña al azar a los roles de la
 * aplicación que todavía no lo tienen, imprimiendo UNA vez las variables para Vercel.
 *
 * Los roles de Postgres son del servidor entero, no de la base: las pruebas NO tocan los `zuluhub_*`
 * reales (los usan las demás pruebas en paralelo) sino roles propios con el mismo recorrido, que el
 * comando recibe por inyección. Que la lista REAL sea la correcta lo prueba su prueba unitaria.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CARPETA_REAL = join(import.meta.dirname, "../../migraciones");
/** Roles propios de CADA prueba (los roles son del servidor y duran más que la base): se crean y se borran por prueba. */
let sufijo = "";
let ROLES: readonly RolPorPreparar[] = [];
let ROLES_DE_AUTENTICACION: readonly RolPorPreparar[] = [];
let AJENO = "";
/** Un nombre con comillas, espacios y eñe: solo sirve si el identificador se escapa bien. */
let ROL_RARO = "";

const entreComillas = (rol: string) => `"${rol.replaceAll('"', '""')}"`;

type Salida = {
  codigo: number;
  info: string;
  error: string;
  /** Lo que salió por el canal de credenciales. */
  secreto: string[];
  /** Las variables del bloque, por nombre. */
  variables: Map<string, URL>;
};

async function preparar(
  cadena: string,
  extras: string[],
  opciones: {
    roles?: readonly RolPorPreparar[];
    entorno?: Record<string, string | undefined>;
    generarClave?: () => string;
  } = {},
): Promise<Salida> {
  const info: string[] = [];
  const error: string[] = [];
  const secreto: string[] = [];
  const roles = opciones.roles ?? ROLES;
  const codigo = await ejecutarMigracion({
    argumentos: ["--preparar-roles", ...extras],
    entorno: { [VARIABLE_DE_LA_CADENA]: cadena, ...opciones.entorno },
    carpeta: CARPETA_REAL,
    info: (l) => info.push(l),
    error: (l) => error.push(l),
    secreto: (l) => secreto.push(l),
    roles: (conAutenticacion) => (conAutenticacion ? [...roles, ...ROLES_DE_AUTENTICACION] : roles),
    ...(opciones.generarClave === undefined ? {} : { generarClave: opciones.generarClave }),
  });
  const variables = new Map<string, URL>();
  for (const linea of secreto) {
    const m = /^(ZULUHUB_DB_[A-Z]+)=(.+)$/.exec(linea);
    if (m !== null) variables.set(m[1] as string, new URL(m[2] as string));
  }
  return { codigo, info: info.join("\n"), error: error.join("\n"), secreto, variables };
}

describe.skipIf(base === null)("migrar-base --preparar-roles", () => {
  let admin: pg.Client;
  const bases: (() => Promise<void>)[] = [];

  const nuevaBase = async () => {
    if (base === null) throw new Error("sin base");
    const aparte = await crearBaseAparte(base, { migrar: false });
    bases.push(aparte.destruir);
    return aparte.base.dueno;
  };

  const verificadoresDe = async (roles: readonly RolPorPreparar[]) => {
    const resultado: (string | null)[] = [];
    for (const { rol } of roles) resultado.push(await verificadorDe(rol));
    return resultado;
  };
  const verificadorDe = async (rol: string): Promise<string | null> => {
    const r = await admin.query<{ p: string | null }>(
      "SELECT rolpassword AS p FROM pg_authid WHERE rolname = $1",
      [rol],
    );
    return r.rows[0]?.p ?? null;
  };
  const puedeEntrar = async (rol: string): Promise<boolean> =>
    (
      await admin.query<{ c: boolean }>(
        "SELECT rolcanlogin AS c FROM pg_roles WHERE rolname = $1",
        [rol],
      )
    ).rows[0]?.c === true;

  /** El verificador guardado corresponde EXACTAMENTE a esa contraseña (misma sal, mismo cálculo). */
  const guardaLaClave = async (rol: string, clave: string): Promise<boolean> => {
    const guardado = await verificadorDe(rol);
    const sal = /^SCRAM-SHA-256\$\d+:([^$]+)\$/.exec(guardado ?? "")?.[1];
    return sal !== undefined && guardado === verificadorScram(clave, Buffer.from(sal, "base64"));
  };

  const hostYBase = (cadena: string) => {
    const u = new URL(cadena);
    return { host: u.hostname, puerto: u.port, base: u.pathname };
  };

  beforeAll(async () => {
    if (base === null) return;
    admin = new pg.Client({ connectionString: base.admin });
    await admin.connect();
  });

  const todosLosRoles = () =>
    [...ROLES, ...ROLES_DE_AUTENTICACION].map((r) => r.rol).concat(AJENO, ROL_RARO);

  beforeEach(async () => {
    if (base === null) return;
    sufijo = randomBytes(4).toString("hex");
    ROLES = [
      { rol: `zz_${sufijo}_app`, variable: "ZULUHUB_DB_APP" },
      { rol: `zz_${sufijo}_trabajos`, variable: "ZULUHUB_DB_TRABAJOS" },
      { rol: `zz_${sufijo}_publico`, variable: "ZULUHUB_DB_PUBLICO" },
    ];
    ROLES_DE_AUTENTICACION = [
      { rol: `zz_${sufijo}_autenticacion`, variable: "ZULUHUB_DB_AUTENTICACION" },
      { rol: `zz_${sufijo}_captacion`, variable: "ZULUHUB_DB_CAPTACION" },
    ];
    AJENO = `zz_${sufijo}_ajeno`;
    ROL_RARO = `zz ${sufijo} "raro" ñ`;
    for (const rol of todosLosRoles())
      await admin.query(`CREATE ROLE ${entreComillas(rol)} NOLOGIN`);
  });

  afterEach(async () => {
    if (base === null) return;
    for (const destruir of bases.splice(0)) await destruir();
    for (const rol of todosLosRoles())
      await admin.query(`DROP ROLE IF EXISTS ${entreComillas(rol)}`);
  });

  afterAll(async () => {
    if (base === null) return;
    await admin.end();
  });

  it("da LOGIN a los roles sin LOGIN, imprime exactamente las tres variables, y cada contraseña impresa es la guardada y permite conectarse", async () => {
    const url = await nuevaBase();
    const antesDeLosAjenos: (readonly [string, boolean])[] = [];
    for (const r of ["zuluhub_grupo", "zuluhub_plataforma"]) {
      antesDeLosAjenos.push([r, await puedeEntrar(r)]);
    }
    const salida = await preparar(url, []);
    expect(salida.codigo).toBe(0);
    expect(salida.error).toBe("");
    // Migraciones aplicadas primero.
    expect(salida.info).toContain("Aplicadas ahora (10)");
    // Exactamente las variables esperadas, en orden, y nada más con forma de variable.
    expect([...salida.variables.keys()]).toEqual([
      "ZULUHUB_DB_APP",
      "ZULUHUB_DB_TRABAJOS",
      "ZULUHUB_DB_PUBLICO",
    ]);
    expect(salida.secreto.filter((l) => /^[A-Z_]+=/.test(l))).toHaveLength(3);
    const { host, puerto, base: nombreDeBase } = hostYBase(url);
    for (const [i, { rol, variable }] of ROLES.entries()) {
      const cadena = salida.variables.get(variable) as URL;
      expect(decodeURIComponent(cadena.username)).toBe(rol);
      expect(cadena.password).toMatch(/^[A-Za-z0-9]{32}$/);
      expect(cadena.hostname).toBe(host);
      expect(cadena.port).toBe(puerto);
      expect(cadena.pathname).toBe(nombreDeBase);
      expect(await puedeEntrar(rol)).toBe(true);
      expect(await guardaLaClave(rol, cadena.password)).toBe(true);
      // La contraseña de cada rol es distinta.
      for (const otra of ROLES.slice(i + 1)) {
        expect((salida.variables.get(otra.variable) as URL).password).not.toBe(cadena.password);
      }
      // Y con la cadena armada realmente se entra, como ese rol.
      const cliente = new pg.Client({ connectionString: cadena.toString() });
      await cliente.connect();
      try {
        const quien = await cliente.query<{ u: string }>("SELECT current_user AS u");
        expect(quien.rows[0]?.u).toBe(rol);
      } finally {
        await cliente.end();
      }
    }
    // Nada de lo anterior llegó a los canales públicos.
    for (const cadena of salida.variables.values()) {
      expect(salida.info + salida.error).not.toContain(cadena.password);
    }
    expect(salida.info).toContain("RESULTADO: OK, 3 roles con contraseña nueva.");
    // Los roles ajenos a la lista no se tocaron.
    expect(await puedeEntrar(AJENO)).toBe(false);
    expect(await verificadorDe(AJENO)).toBeNull();
    for (const [rol, antes] of antesDeLosAjenos) expect(await puedeEntrar(rol)).toBe(antes);
    for (const { rol } of ROLES_DE_AUTENTICACION) expect(await puedeEntrar(rol)).toBe(false);
  });

  it("la segunda corrida no cambia nada ni imprime contraseñas: los roles con LOGIN quedan intactos", async () => {
    const url = await nuevaBase();
    const primera = await preparar(url, []);
    expect(primera.variables.size).toBe(3);
    const antes = await verificadoresDe(ROLES);
    const segunda = await preparar(url, []);
    expect(segunda.codigo).toBe(0);
    expect(segunda.secreto).toEqual([]);
    expect(segunda.info).toContain("Aplicadas ahora (0)");
    expect(segunda.info).toContain("no hubo nada para cambiar; no se generó ninguna contraseña");
    for (const { rol } of ROLES)
      expect(segunda.info).toContain(`${rol}: ya tenía LOGIN, no se tocó`);
    expect(await verificadoresDe(ROLES)).toEqual(antes);
  });

  it("con --rotar cambia la contraseña de los que ya tienen LOGIN y la anterior deja de valer; sin la bandera no", async () => {
    const url = await nuevaBase();
    const primera = await preparar(url, []);
    const vieja = (primera.variables.get("ZULUHUB_DB_APP") as URL).password;
    const rotada = await preparar(url, ["--rotar"]);
    expect(rotada.codigo).toBe(0);
    expect(rotada.info).toContain("contraseña ROTADA");
    expect([...rotada.variables.keys()]).toHaveLength(3);
    const nueva = (rotada.variables.get("ZULUHUB_DB_APP") as URL).password;
    expect(nueva).not.toBe(vieja);
    expect(await guardaLaClave(ROLES[0]?.rol as string, nueva)).toBe(true);
    expect(await guardaLaClave(ROLES[0]?.rol as string, vieja)).toBe(false);
  });

  it("--con-autenticacion suma los dos roles de autenticación, con aviso de nombre provisorio", async () => {
    const url = await nuevaBase();
    const salida = await preparar(url, ["--con-autenticacion"]);
    expect(salida.codigo).toBe(0);
    expect([...salida.variables.keys()]).toEqual([
      "ZULUHUB_DB_APP",
      "ZULUHUB_DB_TRABAJOS",
      "ZULUHUB_DB_PUBLICO",
      "ZULUHUB_DB_AUTENTICACION",
      "ZULUHUB_DB_CAPTACION",
    ]);
    for (const { rol } of ROLES_DE_AUTENTICACION) expect(await puedeEntrar(rol)).toBe(true);
    expect(salida.info).toContain("ZULUHUB_DB_AUTENTICACION es un nombre provisorio");
    expect(salida.info).not.toContain("ZULUHUB_DB_APP es un nombre provisorio");
  });

  it("dos corridas simultáneas: solo una genera contraseñas y la impresa es la que quedó guardada", async () => {
    const url = await nuevaBase();
    const [a, b] = await Promise.all([preparar(url, []), preparar(url, [])]);
    expect([a.codigo, b.codigo]).toEqual([0, 0]);
    const ganadora = a.variables.size > 0 ? a : b;
    const perdedora = ganadora === a ? b : a;
    expect(ganadora.variables.size).toBe(3);
    expect(perdedora.variables.size).toBe(0);
    expect(perdedora.secreto).toEqual([]);
    for (const { rol, variable } of ROLES) {
      expect(await guardaLaClave(rol, (ganadora.variables.get(variable) as URL).password)).toBe(
        true,
      );
    }
  });

  it("un rol que no existe frena todo: ningún otro queda con LOGIN, no se imprime nada y el error no trae la cadena", async () => {
    const url = await nuevaBase();
    const roles = [
      ROLES[0] as RolPorPreparar,
      { rol: `zz_${sufijo}_no_existe`, variable: "ZULUHUB_DB_X" },
    ];
    const salida = await preparar(url, [], { roles });
    expect(salida.codigo).toBe(1);
    expect(salida.error).toContain(`el rol zz_${sufijo}_no_existe no existe`);
    expect(salida.error).toContain("RESULTADO: FALLA");
    expect(salida.secreto).toEqual([]);
    expect(await puedeEntrar(ROLES[0]?.rol as string)).toBe(false);
    expect(await verificadorDe(ROLES[0]?.rol as string)).toBeNull();
    const u = new URL(url);
    for (const rastro of [u.password, u.hostname]) {
      if (rastro.length >= 3) expect(salida.error + salida.info).not.toContain(rastro);
    }
  });

  it("el identificador y la contraseña se escapan: un rol con comillas y una contraseña con comilla y barra funcionan", async () => {
    const url = await nuevaBase();
    const clave = `ab'cd\\ef"gh$$`;
    const salida = await preparar(url, [], {
      roles: [{ rol: ROL_RARO, variable: "ZULUHUB_DB_APP" }],
      generarClave: () => clave,
    });
    expect(salida.codigo).toBe(0);
    expect(await puedeEntrar(ROL_RARO)).toBe(true);
    expect(await guardaLaClave(ROL_RARO, clave)).toBe(true);
    const cadena = salida.variables.get("ZULUHUB_DB_APP") as URL;
    const cliente = new pg.Client({ connectionString: cadena.toString() });
    await cliente.connect();
    try {
      expect((await cliente.query<{ u: string }>("SELECT current_user AS u")).rows[0]?.u).toBe(
        ROL_RARO,
      );
    } finally {
      await cliente.end();
    }
  });

  it("si la corrida falla, ninguna contraseña aparece en el error (ni siquiera la generada)", async () => {
    const url = await nuevaBase();
    const clave = "ClaveGeneradaQueNoDebeFiltrarse1234";
    // Dos veces el mismo rol: el segundo ALTER ve el rol como ya existente, pero fallamos a propósito
    // con un rol inexistente al final, después de haber generado la contraseña del primero.
    const salida = await preparar(url, [], {
      roles: [ROLES[0] as RolPorPreparar, { rol: `zz_${sufijo}_falta`, variable: "ZULUHUB_DB_X" }],
      generarClave: () => clave,
    });
    expect(salida.codigo).toBe(1);
    expect(salida.error + salida.info + salida.secreto.join("\n")).not.toContain(clave);
  });

  it("se niega a correr en GitHub Actions (el registro queda guardado) y no toca la base", async () => {
    const url = await nuevaBase();
    const salida = await preparar(url, [], { entorno: { GITHUB_ACTIONS: "true" } });
    expect(salida.codigo).toBe(2);
    expect(salida.error).toContain("no se corre en GitHub Actions");
    expect(salida.secreto).toEqual([]);
    expect(await puedeEntrar(ROLES[0]?.rol as string)).toBe(false);
    const tablas = await admin.query("SELECT 1");
    expect(tablas.rowCount).toBe(1);
  });

  it("las banderas solo valen con --preparar-roles y sin repetirse; sin cadena no hay nada que hacer", async () => {
    const vacio = {
      carpeta: CARPETA_REAL,
      info: () => undefined,
      error: () => undefined,
      secreto: () => undefined,
    };
    const correr = (argumentos: string[]) =>
      ejecutarMigracion({
        ...vacio,
        argumentos,
        entorno: { [VARIABLE_DE_LA_CADENA]: "postgresql://u:c@h/b" },
      });
    expect(await correr(["--rotar"])).toBe(2);
    expect(await correr(["--ver", "--rotar"])).toBe(2);
    expect(await correr(["--aplicar", "--directa"])).toBe(2);
    expect(await correr(["--preparar-roles", "--rotar", "--rotar"])).toBe(2);
    expect(await correr(["--preparar-roles", "--ver"])).toBe(2);
    expect(await correr(["--preparar-roles", "--otra"])).toBe(2);
    expect(
      await ejecutarMigracion({ ...vacio, argumentos: ["--preparar-roles"], entorno: {} }),
    ).toBe(1);
  });
});
