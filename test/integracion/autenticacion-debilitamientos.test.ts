import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { firmarCarga } from "../../src/adaptadores/postgres/contexto-firmado";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  archivoDeAutenticacion,
  conInvitacion,
  conSesion,
  crearUsuarioDeBase,
  empresaConMiembro,
  migracionesPrevias,
  personaConUsuario,
} from "./autenticacion-apoyo";
import { intentoDelDueno } from "./fiscal-apoyo";
import {
  crearInvitacionDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  tokenAlAzar,
} from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  marcaPrincipal,
} from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * Autenticación (W3a): los DEBILITAMIENTOS propios del SQL. Cada caso rompe a propósito la migración 0010 de una
 * forma razonable (quitar una condición de una política, un disparador, una única, un NOT NULL, una guarda...) en
 * una base descartable, y comprueba que una sonda —la misma que pasa sobre la base real— deja de cumplirse. Una
 * sonda que sigue pasando con la migración rota es una prueba que no muerde.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Ctx = Readonly<{ base: BaseDePruebas; dueno: pg.Client }>;
/** `true` cuando la base cumple lo que la sonda protege. */
type Sonda = (ctx: Ctx) => Promise<boolean>;

// ---- transformaciones del texto de la migración ----------------------------------------------------

/** Reemplaza `de` por `a` exigiendo que `de` esté exactamente `veces` veces: un debilitamiento que no cambia nada no prueba nada. */
function cambiar(sql: string, de: string, a: string, veces = 1): string {
  const n = sql.split(de).length - 1;
  if (n !== veces)
    throw new Error(`el texto aparece ${n} veces (tenía que ser ${veces}): ${de.slice(0, 80)}`);
  return sql.split(de).join(a);
}

// ---- las bases ----------------------------------------------------------------------------------------

let plantilla: Awaited<ReturnType<typeof baseConMigraciones>>;
let plantillaNombre = "";
let admin: pg.Client;
let sqlReal = "";

const conBase = (url: string, nombre: string): string => {
  const u = new URL(url);
  u.pathname = `/${nombre}`;
  return u.toString();
};

/** Una copia de la plantilla (las migraciones anteriores) con ese texto de 0010 aplicado; se destruye al terminar. */
async function conMigracion<T>(sql: string, trabajo: (ctx: Ctx) => Promise<T>): Promise<T> {
  const b = base as BaseDePruebas;
  const nombre = `pedernal_deb_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE ${nombre} TEMPLATE ${plantillaNombre}`);
  const carpeta = await carpetaCon(await migracionesPrevias());
  const copia: BaseDePruebas = {
    ...b,
    dueno: conBase(b.dueno, nombre),
    app: conBase(b.app, nombre),
    grupo: conBase(b.grupo, nombre),
    trabajos: conBase(b.trabajos, nombre),
    plataforma: conBase(b.plataforma, nombre),
    autenticacion: conBase(b.autenticacion, nombre),
    publico: conBase(b.publico, nombre),
    captacion: conBase(b.captacion, nombre),
  };
  const dueno = new pg.Client({ connectionString: copia.dueno });
  try {
    await writeFile(join(carpeta, await archivoDeAutenticacion()), sql);
    await aplicarMigraciones(copia.dueno, carpeta);
    await dueno.connect();
    return await trabajo({ base: copia, dueno });
  } finally {
    await dueno.end().catch(() => undefined);
    await rm(carpeta, { recursive: true, force: true });
    await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
  }
}

// ---- sondas --------------------------------------------------------------------------------------------

/** Una sentencia del dueño en su propia transacción, que se deshace: la restricción que salta no deja nada. */
async function intentoAislado(c: pg.Client, texto: string, parametros: unknown[]) {
  await c.query("begin");
  try {
    return await intentoDelDueno(c, texto, parametros);
  } finally {
    await c.query("rollback");
  }
}

/** ¿Cuántas filas ve la sesión de ese usuario en esa consulta? (`null`: la consulta falló). */
async function veces(ctx: Ctx, usuario: string, texto: string): Promise<number | null> {
  return conSesion(ctx.base, usuario as never, async (s) => {
    const r = await s.intentar(texto);
    return r.ok ? Number(r.rows[0]?.["n"]) : null;
  });
}

/** Dos usuarios con dos empresas cada uno (una con membresía apagada), para las sondas de aislamiento. */
async function escenario(ctx: Ctx) {
  const principal = await marcaPrincipal(ctx.dueno);
  const a = await personaConUsuario(ctx.dueno);
  const a1 = await empresaConMiembro(ctx.dueno, a, { marca: principal });
  await empresaConMiembro(ctx.dueno, a, { marca: principal, activo: false });
  const b = await personaConUsuario(ctx.dueno);
  await empresaConMiembro(ctx.dueno, b, { marca: principal });
  return { a, a1, b };
}

/** Una invitación pendiente para una persona nueva (sin usuario) y lo necesario para vincularla. */
async function paraVincular(ctx: Ctx) {
  const principal = await marcaPrincipal(ctx.dueno);
  const dueño = await personaConUsuario(ctx.dueno);
  const mundo = await empresaConMiembro(ctx.dueno, dueño, { marca: principal });
  const invitada = await crearPersonaDeBase(ctx.dueno);
  const otra = await crearPersonaDeBase(ctx.dueno);
  const { tokenHash } = tokenAlAzar();
  const inv = await crearInvitacionDeBase(ctx.dueno, {
    tenant: mundo.tenant,
    email: invitada.email,
    tokenHash,
  });
  await incluirEmpresa(ctx.dueno, inv, mundo.empresa);
  const usuario = await crearUsuarioDeBase(ctx.dueno, invitada.email);
  const otroUsuario = await crearUsuarioDeBase(ctx.dueno);
  return { tokenHash, invitada, otra, usuario, otroUsuario };
}

const sondas = {
  /** Cada usuario ve solo SU persona, y la sesión de A no ve nada de B. */
  soloLaPropiaPersona: async (ctx: Ctx) => {
    const { a } = await escenario(ctx);
    return (await veces(ctx, a.usuario, "select count(*)::int as n from persona")) === 1;
  },
  /** Una persona suspendida globalmente no ve nada con su sesión. */
  suspendidaNoVeNada: async (ctx: Ctx) => {
    const principal = await marcaPrincipal(ctx.dueno);
    const c = await personaConUsuario(ctx.dueno, { activaGlobal: false });
    await empresaConMiembro(ctx.dueno, c, { marca: principal });
    for (const tabla of ["persona", "membresia", "empresa", "tenant"]) {
      if ((await veces(ctx, c.usuario, `select count(*)::int as n from ${tabla}`)) !== 0)
        return false;
    }
    return true;
  },
  /** La sesión de A ve solo SUS membresías ACTIVAS (una), no las de B ni la apagada. */
  soloMembresiasPropiasActivas: async (ctx: Ctx) => {
    const { a } = await escenario(ctx);
    return (await veces(ctx, a.usuario, "select count(*)::int as n from membresia")) === 1;
  },
  /** La sesión de A ve solo SUS empresas activas. */
  soloEmpresasPropias: async (ctx: Ctx) => {
    const { a } = await escenario(ctx);
    return (await veces(ctx, a.usuario, "select count(*)::int as n from empresa")) === 1;
  },
  /** La sesión de A ve solo SUS tenants. */
  soloTenantsPropios: async (ctx: Ctx) => {
    const { a } = await escenario(ctx);
    return (await veces(ctx, a.usuario, "select count(*)::int as n from tenant")) === 1;
  },
  /** La sesión no escribe: ni siquiera apagar su propia membresía. */
  sesionNoEscribe: async (ctx: Ctx) => {
    const { a, a1 } = await escenario(ctx);
    const r = await conSesion(ctx.base, a.usuario, (s) =>
      s.intentar("update membresia set activo = false where empresa_id = $1", [a1.empresa]),
    );
    return r.ok && r.filas === 0;
  },
  /** El invitado vincula a la persona de SU email; no vincula a la de otro email. */
  noVinculaAOtraPersona: async (ctx: Ctx) => {
    const p = await paraVincular(ctx);
    return conInvitacion(ctx.base, p.tokenHash, p.usuario.id, async (s) => {
      const ajena = await s.intentar("update persona set usuario_auth_id = $2 where id = $1", [
        p.otra.id,
        p.usuario.id,
      ]);
      return ajena.ok && ajena.filas === 0;
    });
  },
  /** El invitado solo vincula hacia el usuario firmado en su contexto. */
  soloHaciaSuUsuario: async (ctx: Ctx) => {
    const p = await paraVincular(ctx);
    return conInvitacion(ctx.base, p.tokenHash, p.usuario.id, async (s) => {
      const r = await s.intentar("update persona set usuario_auth_id = $2 where id = $1", [
        p.invitada.id,
        p.otroUsuario.id,
      ]);
      return !r.ok && r.codigo === "42501";
    });
  },
  /** Una persona ya vinculada no se re-vincula por la vía del invitado (la política lo corta con 0 filas, no con un error). */
  noReVincula: async (ctx: Ctx) => {
    const p = await paraVincular(ctx);
    await ctx.dueno.query("update persona set usuario_auth_id = $2 where id = $1", [
      p.invitada.id,
      p.usuario.id,
    ]);
    return conInvitacion(ctx.base, p.tokenHash, p.otroUsuario.id, async (s) => {
      const r = await s.intentar("update persona set usuario_auth_id = $2 where id = $1", [
        p.invitada.id,
        p.otroUsuario.id,
      ]);
      return r.ok && r.filas === 0;
    });
  },
  /** Sin usuario en el contexto de la invitación, nadie se vincula. */
  sinUsuarioNoVincula: async (ctx: Ctx) => {
    const p = await paraVincular(ctx);
    return conInvitacion(ctx.base, p.tokenHash, null, async (s) => {
      const r = await s.intentar("update persona set usuario_auth_id = $2 where id = $1", [
        p.invitada.id,
        p.usuario.id,
      ]);
      return r.ok && r.filas === 0;
    });
  },
  /** Una persona suspendida no se vincula. */
  suspendidaNoSeVincula: async (ctx: Ctx) => {
    const p = await paraVincular(ctx);
    await ctx.dueno.query("update persona set activo_global = false where id = $1", [
      p.invitada.id,
    ]);
    return conInvitacion(ctx.base, p.tokenHash, p.usuario.id, async (s) => {
      const r = await s.intentar("update persona set usuario_auth_id = $2 where id = $1", [
        p.invitada.id,
        p.usuario.id,
      ]);
      return r.ok && r.filas === 0;
    });
  },
  /** Una vez fijado, el vínculo no cambia ni por SQL del dueño. */
  vinculoInmutable: async (ctx: Ctx) => {
    const a = await personaConUsuario(ctx.dueno);
    const otro = await crearUsuarioDeBase(ctx.dueno);
    const r = await intentoAislado(
      ctx.dueno,
      "update persona set usuario_auth_id = $2 where id = $1",
      [a.persona, otro.id],
    );
    return !r.ok && r.restriccion === "persona_usuario_auth_inmutable";
  },
  /** Un usuario es de una sola persona. */
  usuarioUnico: async (ctx: Ctx) => {
    const a = await personaConUsuario(ctx.dueno);
    const otra = await crearPersonaDeBase(ctx.dueno);
    const r = await intentoAislado(
      ctx.dueno,
      "update persona set usuario_auth_id = $2 where id = $1",
      [otra.id, a.usuario],
    );
    return !r.ok && r.restriccion === "persona_usuario_auth_id_uk";
  },
  /** Un `s` que no es uuid no tumba la consulta: es «sin usuario». */
  sMalFormadoFallaCerrado: async (ctx: Ctx) => {
    // Con filas en las tablas (una consulta sobre una tabla vacía ni evalúa la política).
    await escenario(ctx);
    const token = firmarCarga(ctx.base.clave, {
      u: "pedernal_app",
      e: null,
      t: null,
      p: null,
      i: null,
      x: Math.floor(Date.now() / 1000) + 300,
      a: null,
      s: "no-es-un-uuid",
    });
    const s = await SesionDePrueba.abrirConToken(ctx.base, "pedernal_app", token);
    try {
      for (const tabla of ["persona", "membresia", "empresa", "tenant"]) {
        const r = await s.intentar(`select count(*)::int as n from ${tabla}`);
        if (!r.ok || Number(r.rows[0]?.["n"]) !== 0) return false;
      }
      return true;
    } finally {
      await s.cerrar();
    }
  },
  /** La RLS de las tablas de la librería está forzada. */
  rlsForzada: async (ctx: Ctx) => {
    const { rows } = await ctx.dueno.query<{ n: number }>(
      `select count(*)::int as n from pg_class
       where relnamespace = 'autenticacion'::regnamespace and relkind = 'r' and not relforcerowsecurity`,
    );
    return rows[0]?.n === 0;
  },
  /** Las políticas de la librería son solo del rol de la librería. */
  politicasSoloDelRol: async (ctx: Ctx) => {
    const { rows } = await ctx.dueno.query<{ n: number }>(
      `select count(*)::int as n from pg_policies
       where schemaname = 'autenticacion' and roles <> array['pedernal_autenticacion']::name[]`,
    );
    return rows[0]?.n === 0;
  },
  /** `session.host` es obligatorio. */
  hostObligatorio: async (ctx: Ctx) => {
    const u = await crearUsuarioDeBase(ctx.dueno);
    const r = await intentoAislado(
      ctx.dueno,
      `insert into autenticacion.session ("expiresAt", token, "userId", host) values (now(), $1, $2, null)`,
      [randomUUID(), u.id],
    );
    return !r.ok && r.codigo === "23502";
  },
  /** Una cuenta de proveedor es de un solo usuario. */
  cuentaUnica: async (ctx: Ctx) => {
    const a = await crearUsuarioDeBase(ctx.dueno);
    const b = await crearUsuarioDeBase(ctx.dueno);
    const sub = randomUUID();
    const texto = `insert into autenticacion.account ("accountId", "providerId", "userId") values ($1, 'google', $2)`;
    await ctx.dueno.query(texto, [sub, a.id]);
    const r = await intentoAislado(ctx.dueno, texto, [sub, b.id]);
    return !r.ok && r.restriccion === "account_proveedor_sub_uq";
  },
  /** Ningún otro rol (la aplicación) ve el esquema de la librería. */
  esquemaCerrado: async (ctx: Ctx) => {
    const { rows } = await ctx.dueno.query<{ puede: boolean }>(
      `select has_schema_privilege('pedernal_app', 'autenticacion', 'USAGE') as puede`,
    );
    return rows[0]?.puede === false;
  },
  /** El rol de la librería no toca `persona`. */
  autenticacionNoTocaNegocio: async (ctx: Ctx) => {
    const c = new pg.Client({ connectionString: ctx.base.autenticacion });
    await c.connect();
    try {
      const r = await c.query("select 1 from persona limit 1").then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "?",
      );
      return r === "42501";
    } finally {
      await c.end();
    }
  },
  /** La aplicación solo puede actualizar la columna del vínculo de `persona` (y no `activo_global`). */
  soloLaColumnaDelVinculo: async (ctx: Ctx) => {
    const { rows } = await ctx.dueno.query<{ puede: boolean }>(
      `select has_column_privilege('pedernal_app', 'public.persona', 'activo_global', 'UPDATE') as puede`,
    );
    return rows[0]?.puede === false;
  },
} satisfies Record<string, Sonda>;

type Debilitamiento = Readonly<{
  nombre: string;
  romper: (sql: string) => string;
  /** Las sondas que tienen que dejar de cumplirse (alguna alcanza). */
  detectan: readonly (keyof typeof sondas)[];
}>;

const DEBILITAMIENTOS: readonly Debilitamiento[] = [
  {
    nombre: "la política de persona deja ver a todos (sin comparar el usuario)",
    romper: (s) =>
      cambiar(
        s,
        "USING (usuario_auth_id = (SELECT app_usuario_auth()) AND activo_global);",
        "USING (activo_global);",
      ),
    detectan: ["soloLaPropiaPersona"],
  },
  {
    nombre: "la política de persona no exige persona activa",
    romper: (s) =>
      cambiar(
        s,
        "USING (usuario_auth_id = (SELECT app_usuario_auth()) AND activo_global);",
        "USING (usuario_auth_id = (SELECT app_usuario_auth()));",
      ),
    detectan: ["suspendidaNoVeNada"],
  },
  {
    nombre: "la política de membresía deja ver las de todos (sin comparar la persona)",
    romper: (s) =>
      cambiar(s, "ELSE activo AND persona_id = (SELECT app_persona_de_sesion())", "ELSE activo"),
    detectan: ["soloMembresiasPropiasActivas"],
  },
  {
    nombre: "la política de membresía deja ver también las apagadas",
    romper: (s) =>
      cambiar(
        s,
        "ELSE activo AND persona_id = (SELECT app_persona_de_sesion())",
        "ELSE persona_id = (SELECT app_persona_de_sesion())",
      ),
    detectan: ["soloMembresiasPropiasActivas"],
  },
  {
    // La política de empresa repite el filtro por persona aunque la RLS de `membresia` ya lo impone (defensa en
    // profundidad): una sola de las dos defensas rotas no se nota, las dos juntas sí.
    nombre: "ni la política de membresía ni la de empresa comparan la persona de la sesión",
    romper: (s) => {
      const r = cambiar(
        s,
        "ELSE activo AND persona_id = (SELECT app_persona_de_sesion())",
        "ELSE activo",
      );
      return cambiar(
        r,
        `        SELECT m.empresa_id FROM membresia m
         WHERE m.activo AND m.persona_id = (SELECT app_persona_de_sesion())
      )
    END
  );

CREATE POLICY tenant_sesion_leer`,
        `        SELECT m.empresa_id FROM membresia m
         WHERE m.activo
      )
    END
  );

CREATE POLICY tenant_sesion_leer`,
      );
    },
    detectan: ["soloEmpresasPropias"],
  },
  {
    nombre: "la política de tenant deja ver todos los tenants",
    romper: (s) =>
      cambiar(
        s,
        `      ELSE id IN (
        SELECT e.tenant_id FROM empresa e`,
        `      ELSE true OR id IN (
        SELECT e.tenant_id FROM empresa e`,
      ),
    detectan: ["soloTenantsPropios"],
  },
  {
    nombre:
      "se agrega una política que deja a la sesión actualizar membresías (ya no es solo lectura)",
    romper: (s) =>
      `${s}\nCREATE POLICY membresia_sesion_cambiar ON membresia FOR UPDATE TO pedernal_app USING (true) WITH CHECK (true);\n`,
    detectan: ["sesionNoEscribe"],
  },
  {
    // El UPDATE necesita VER la fila: `persona_invitado_leer` (0002) ya la limita al email de la invitación. Las
    // dos defensas rotas juntas sí se notan (se abre la lectura de persona y se saca el email del vínculo).
    nombre: "ni la lectura ni el vínculo limitan a la persona del email de la invitación",
    romper: (s) => {
      const r = cambiar(
        s,
        "    AND email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))\n  )\n  WITH CHECK",
        "  )\n  WITH CHECK",
      );
      return `${cambiar(
        r,
        "    usuario_auth_id = (SELECT app_usuario_auth())\n    AND email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))",
        "    usuario_auth_id = (SELECT app_usuario_auth())",
      )}\nCREATE POLICY persona_abierta ON persona FOR SELECT TO pedernal_app USING (true);\n`;
    },
    detectan: ["noVinculaAOtraPersona"],
  },
  {
    nombre: "el WITH CHECK del vínculo deja cualquier usuario (no exige el firmado en `s`)",
    romper: (s) =>
      cambiar(
        s,
        "    usuario_auth_id = (SELECT app_usuario_auth())\n    AND email = (SELECT i.email",
        "    usuario_auth_id IS NOT NULL\n    AND email = (SELECT i.email",
      ),
    detectan: ["soloHaciaSuUsuario"],
  },
  {
    nombre: "el vínculo se puede pisar por la política (se saca `usuario_auth_id IS NULL`)",
    romper: (s) =>
      cambiar(s, "    usuario_auth_id IS NULL\n    AND activo_global\n", "    activo_global\n"),
    detectan: ["noReVincula"],
  },
  {
    nombre: "el vínculo no exige usuario en el contexto de la invitación",
    romper: (s) =>
      cambiar(
        s,
        "    AND (SELECT app_usuario_auth()) IS NOT NULL\n    AND email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))\n  )\n  WITH CHECK (\n    usuario_auth_id = (SELECT app_usuario_auth())",
        "    AND email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))\n  )\n  WITH CHECK (\n    usuario_auth_id IS NOT NULL OR usuario_auth_id = (SELECT app_usuario_auth())",
      ),
    detectan: ["sinUsuarioNoVincula"],
  },
  {
    nombre:
      "se vincula también a una persona suspendida (se saca `activo_global` de la política de vincular)",
    romper: (s) =>
      cambiar(
        s,
        "    usuario_auth_id IS NULL\n    AND activo_global\n",
        "    usuario_auth_id IS NULL\n",
      ),
    detectan: ["suspendidaNoSeVincula"],
  },
  {
    nombre: "se saca el disparador que vuelve inmutable el vínculo",
    romper: (s) =>
      cambiar(
        s,
        "CREATE TRIGGER persona_vinculo_inmutable BEFORE UPDATE OF usuario_auth_id ON persona\n  FOR EACH ROW EXECUTE FUNCTION persona_validar_vinculo();",
        "",
      ),
    detectan: ["vinculoInmutable"],
  },
  {
    nombre: "se saca la restricción única del usuario",
    romper: (s) =>
      cambiar(
        s,
        "ALTER TABLE persona ADD CONSTRAINT persona_usuario_auth_id_uk UNIQUE (usuario_auth_id);",
        "",
      ),
    detectan: ["usuarioUnico"],
  },
  {
    nombre: "app_usuario_auth() convierte sin validar el formato (un `s` raro tira un error)",
    romper: (s) => {
      const a = s.indexOf("CREATE FUNCTION app_usuario_auth()");
      const fin = s.indexOf(";\n", s.indexOf("$$", s.indexOf("$$", a) + 2)) + 2;
      return (
        s.slice(0, a) +
        "CREATE FUNCTION app_usuario_auth() RETURNS uuid LANGUAGE sql STABLE\n  SET search_path = pg_catalog, public, pg_temp AS\n$$ SELECT nullif(public.contexto_firmado()->>'s', '')::uuid $$;\n" +
        s.slice(fin)
      );
    },
    detectan: ["sMalFormadoFallaCerrado"],
  },
  {
    nombre: "se saca el FORCE de la RLS de las tablas de la librería",
    romper: (s) =>
      cambiar(
        s,
        "    EXECUTE format('ALTER TABLE autenticacion.%I FORCE ROW LEVEL SECURITY', t);\n",
        "",
      ),
    detectan: ["rlsForzada"],
  },
  {
    nombre: "las políticas de la librería pasan a ser de PUBLIC",
    romper: (s) =>
      cambiar(
        s,
        "FOR SELECT TO pedernal_autenticacion USING (true)', t);",
        "FOR SELECT TO PUBLIC USING (true)', t);",
      ),
    detectan: ["politicasSoloDelRol"],
  },
  {
    nombre: "`session.host` pasa a ser opcional",
    romper: (s) => cambiar(s, "  host         text NOT NULL,", "  host         text,"),
    detectan: ["hostObligatorio"],
  },
  {
    nombre: "se saca la única de la cuenta del proveedor",
    romper: (s) =>
      cambiar(
        s,
        `,
  -- Una cuenta de Google (su \`sub\`) es de un solo usuario: la librería no lo impone por sí sola.
  CONSTRAINT account_proveedor_sub_uq UNIQUE ("providerId", "accountId")`,
        "",
      ),
    detectan: ["cuentaUnica"],
  },
  {
    nombre: "el esquema de la librería queda abierto a todos (USAGE para PUBLIC)",
    romper: (s) =>
      cambiar(
        s,
        "GRANT USAGE ON SCHEMA autenticacion TO pedernal_autenticacion;",
        "GRANT USAGE ON SCHEMA autenticacion TO pedernal_autenticacion, PUBLIC;",
      ),
    detectan: ["esquemaCerrado"],
  },
  {
    nombre: "el rol de la librería recibe SELECT sobre `persona`",
    romper: (s) =>
      cambiar(
        s,
        "GRANT USAGE ON SCHEMA autenticacion TO pedernal_autenticacion;",
        "GRANT USAGE ON SCHEMA autenticacion TO pedernal_autenticacion;\nGRANT USAGE ON SCHEMA public TO pedernal_autenticacion;\nGRANT SELECT ON persona TO pedernal_autenticacion;",
      ),
    detectan: ["autenticacionNoTocaNegocio"],
  },
  {
    nombre: "la aplicación recibe UPDATE sobre TODA la tabla persona (no solo el vínculo)",
    romper: (s) =>
      cambiar(
        s,
        "GRANT UPDATE (usuario_auth_id) ON persona TO pedernal_app;",
        "GRANT UPDATE ON persona TO pedernal_app;",
      ),
    detectan: ["soloLaColumnaDelVinculo"],
  },
];

describe.skipIf(base === null)("autenticación: debilitamientos de la migración 0010", () => {
  beforeAll(async () => {
    if (base === null) return;
    plantilla = await baseConMigraciones(base, await migracionesPrevias());
    // la plantilla no puede tener conexiones abiertas para copiarse
    await plantilla.cliente.end();
    plantillaNombre = new URL(plantilla.aparte.base.dueno).pathname.slice(1);
    admin = new pg.Client({ connectionString: base.admin });
    await admin.connect();
    sqlReal = await readFile(join(CARPETA_DE_MIGRACIONES, await archivoDeAutenticacion()), "utf8");
  });
  afterAll(async () => {
    await admin?.end();
    await rm(plantilla?.carpeta ?? "", { recursive: true, force: true });
    await plantilla?.aparte.destruir();
  });

  it("control: sobre la migración sin romper TODAS las sondas se cumplen", async () => {
    await conMigracion(sqlReal, async (ctx) => {
      const fallan: string[] = [];
      for (const [nombre, sonda] of Object.entries(sondas) as [string, Sonda][]) {
        if (!(await sonda(ctx))) fallan.push(nombre);
      }
      expect(fallan, "sondas que no se cumplen ni sobre la migración sana").toEqual([]);
    });
  });

  it.each(DEBILITAMIENTOS.map((d) => [d.nombre, d] as const))(
    "%s: alguna sonda lo detecta",
    async (_nombre, d) => {
      const rota = d.romper(sqlReal);
      expect(rota, "el debilitamiento tiene que cambiar el texto").not.toBe(sqlReal);
      await conMigracion(rota, async (ctx) => {
        const resultados: Record<string, boolean> = {};
        for (const nombre of d.detectan) {
          resultados[nombre] = await sondas[nombre](ctx).catch(() => false);
        }
        expect(
          Object.values(resultados).some((cumple) => !cumple),
          `ninguna de estas sondas detectó el debilitamiento: ${JSON.stringify(resultados)}`,
        ).toBe(true);
      });
    },
  );

  it("cada sonda la usa algún debilitamiento (ninguna sonda queda sin morder)", () => {
    const usadas = new Set(DEBILITAMIENTOS.flatMap((d) => d.detectan));
    expect([...usadas].sort()).toEqual(Object.keys(sondas).sort());
  });
});
