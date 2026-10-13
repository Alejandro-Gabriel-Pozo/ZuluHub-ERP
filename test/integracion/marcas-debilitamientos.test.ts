import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  adminPlataformaId,
  empresaId,
  personaId,
  tenantId,
} from "../../src/primitivas/identificadores/marca";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { comoEmpresa, comoGrupo, comoPlataforma } from "./entorno";
import { intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  ACTOR_DE_PRUEBA,
  ARCHIVO_0007,
  CARPETA_DE_MIGRACIONES,
  HASTA_0006,
  ajustarPerilla,
  asignarPlan,
  baseConMigraciones,
  carpetaCon,
  crearBorradorDeMarca,
  crearDominio,
  crearDominioDeEmpresa,
  crearMarca,
  crearMundoDeMarca,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
} from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * Marcas y planes (M3): los DEBILITAMIENTOS propios del SQL, y los de la especificación (§D). Cada caso rompe
 * a propósito la migración 0007 de una forma razonable (quitar un FORCE, una condición de una política, una
 * restrictiva de ADMIN, una única, un disparador, un privilegio, un FOR SHARE…) en una base descartable, y
 * comprueba que una sonda —la misma que pasa sobre la base real— deja de cumplirse. Una sonda que sigue
 * pasando con la migración rota es una prueba que no muerde.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Ctx = Readonly<{ base: BaseDePruebas; dueno: pg.Client }>;
/** `true` cuando la base cumple lo que la sonda protege. */
type Sonda = (ctx: Ctx) => Promise<boolean>;

const TABLAS_NUEVAS = [
  "marca",
  "dominio",
  "plan",
  "version_de_plan",
  "version_de_marca",
  "plan_de_tenant",
  "ajuste_de_perilla",
  "modulo_de_empresa",
  "nivel_de_control",
] as const;

// ---- transformaciones del texto de la migración ----------------------------------------------------

/** Reemplaza `de` por `a` exigiendo que `de` esté exactamente una vez: un debilitamiento que no cambia nada no prueba nada. */
function cambiar(sql: string, de: string, a: string): string {
  const veces = sql.split(de).length - 1;
  if (veces !== 1)
    throw new Error(`el texto aparece ${veces} veces (tenía que ser 1): ${de.slice(0, 80)}`);
  return sql.replace(de, () => a);
}
/** Quita una sentencia entera que empieza con ese texto (hasta su `;`). */
function quitar(sql: string, comienzo: string): string {
  const i = sql.indexOf(comienzo);
  if (i < 0 || sql.indexOf(comienzo, i + 1) >= 0)
    throw new Error(`la sentencia no está o está repetida: ${comienzo}`);
  const fin = sql.indexOf(";", i);
  return sql.slice(0, i) + sql.slice(fin + 1);
}

// ---- las bases ----------------------------------------------------------------------------------------

let plantilla: Awaited<ReturnType<typeof baseConMigraciones>>;
let admin: pg.Client;
let sqlReal = "";

const conBase = (url: string, nombre: string): string => {
  const u = new URL(url);
  u.pathname = `/${nombre}`;
  return u.toString();
};

/** Una copia de la plantilla (0001 a 0006) con ese texto de 0007 aplicado; se destruye al terminar. */
async function conMigracion<T>(sql: string, trabajo: (ctx: Ctx) => Promise<T>): Promise<T> {
  const b = base as BaseDePruebas;
  const nombre = `zuluhub_deb_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE ${nombre} TEMPLATE ${plantillaNombre}`);
  const carpeta = await carpetaCon([...HASTA_0006]);
  const copia: BaseDePruebas = {
    ...b,
    dueno: conBase(b.dueno, nombre),
    app: conBase(b.app, nombre),
    grupo: conBase(b.grupo, nombre),
    trabajos: conBase(b.trabajos, nombre),
    plataforma: conBase(b.plataforma, nombre),
    autenticacion: conBase(b.autenticacion, nombre),
    publico: conBase(b.publico, nombre),
  };
  const dueno = new pg.Client({ connectionString: copia.dueno });
  try {
    await writeFile(join(carpeta, ARCHIVO_0007), sql);
    await aplicarMigraciones(copia.dueno, carpeta);
    await dueno.connect();
    return await trabajo({ base: copia, dueno });
  } finally {
    await dueno.end().catch(() => undefined);
    await rm(carpeta, { recursive: true, force: true });
    await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
  }
}
let plantillaNombre = "";

// ---- sondas --------------------------------------------------------------------------------------------

const seRechaza = async (c: pg.Client, texto: string, parametros: unknown[] = []) =>
  !(await intentoDelDueno(c, texto, parametros)).ok;

async function conAdmin<T>(
  ctx: Ctx,
  trabajo: (s: SesionDePrueba) => Promise<T>,
  id: string = ADMIN_DE_PRUEBA,
): Promise<T> {
  const s = await SesionDePrueba.abrir(
    ctx.base,
    "zuluhub_plataforma",
    comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(id) }),
  );
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}
async function conPublico<T>(ctx: Ctx, trabajo: (s: SesionDePrueba) => Promise<T>): Promise<T> {
  const s = await SesionDePrueba.abrir(ctx.base, "zuluhub_publico", null);
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}
async function conApp<T>(
  ctx: Ctx,
  empresa: string | null,
  trabajo: (s: SesionDePrueba) => Promise<T>,
): Promise<T> {
  const s = await SesionDePrueba.abrir(
    ctx.base,
    "zuluhub_app",
    empresa === null ? null : comoEmpresa(empresaId(empresa), null),
  );
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}
const filasDe = (r: Awaited<ReturnType<SesionDePrueba["intentar"]>>): number =>
  r.ok ? r.rows.length : -1;

const INSERTAR_DE_MARCA = `insert into dominio (host, superficie, duenio_marca_id, titular, registrado_por)
                           values ($1, $2, $3, 'OPERADOR', 'x')`;
const INSERTAR_DE_EMPRESA = `insert into dominio (host, superficie, duenio_empresa_id, titular, registrado_por)
                             values ($1, $2, $3, 'CLIENTE', 'x')`;
const INSERTAR_ADMIN_DE_MARCA = `insert into dominio (host, superficie, duenio_marca_id, titular, registrado_por)
                                 values ($1, 'APP', $2, 'OPERADOR', $3)`;
const INSERTAR_ADMIN_DE_EMPRESA = `insert into dominio (host, superficie, duenio_empresa_id, titular, registrado_por)
                                   values ($1, 'CARTA', $2, 'CLIENTE', $3)`;

const SONDAS = {
  /** RLS forzada en la tabla. */
  rlsForzada:
    (tabla: string): Sonda =>
    async ({ dueno }) => {
      const { rows } = await dueno.query<{ f: boolean }>(
        "select relforcerowsecurity as f from pg_class where relnamespace = 'public'::regnamespace and relname = $1",
        [tabla],
      );
      return rows[0]?.f === true;
    },
  /** El público no ve una marca RETIRADA. */
  publicoSoloMarcasActivas: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    await ctx.dueno.query("update marca set estado = 'RETIRADA' where id = $1", [m]);
    return conPublico(
      ctx,
      async (s) => filasDe(await s.intentar("select id from marca where id = $1", [m])) === 0,
    );
  },
  /** El público no ve una versión futura. */
  publicoSoloVersionesVigentes: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    await crearVersionDeMarcaConfirmada(ctx.dueno, m, {
      nombreVisible: "Futura",
      desdeSegundos: 86_400,
    });
    return conPublico(
      ctx,
      async (s) =>
        filasDe(
          await s.intentar("select marca_id from version_de_marca where marca_id = $1", [m]),
        ) === 0,
    );
  },
  /** El público no ve un borrador. */
  publicoNoVeBorradores: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    await crearBorradorDeMarca(ctx.dueno, m, { nombreVisible: "Borrador" });
    return conPublico(
      ctx,
      async (s) =>
        filasDe(
          await s.intentar("select marca_id from version_de_marca where marca_id = $1", [m]),
        ) === 0,
    );
  },
  /** El público ve solo los dominios ACTIVOS (ni pendientes, ni verificados, ni retirados), por la tabla y por la vista. */
  publicoSoloDominiosActivos: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    const pendiente = await crearDominio(ctx.dueno, m, { estado: "PENDIENTE_VERIFICACION" });
    const verificado = await crearDominio(ctx.dueno, m, { estado: "VERIFICADO" });
    const retirado = await crearDominio(ctx.dueno, m, { estado: "RETIRADO" });
    const activo = await crearDominio(ctx.dueno, m, { estado: "ACTIVO" });
    const hosts = [pendiente, verificado, retirado, activo].map((d) => d.host);
    // un dominio ACTIVO de una marca RETIRADA: la tabla lo muestra (la política es por dominio), la vista no
    const deMarcaRetirada = await crearMarca(ctx.dueno);
    const huerfano = await crearDominio(ctx.dueno, deMarcaRetirada, { estado: "ACTIVO" });
    await ctx.dueno.query("update marca set estado = 'RETIRADA' where id = $1", [deMarcaRetirada]);
    return conPublico(ctx, async (s) => {
      for (const relacion of ["dominio", "resolucion_de_host"]) {
        const r = await s.intentar(`select host from ${relacion} where host = any($1)`, [hosts]);
        if (!r.ok || r.rows.length !== 1 || r.rows[0]?.["host"] !== activo.host) return false;
      }
      const vista = await s.intentar("select host from resolucion_de_host where host = $1", [
        huerfano.host,
      ]);
      return vista.ok && vista.rows.length === 0;
    });
  },
  /** Un host sirve solo su superficie: pedido con la otra, la vista no devuelve nada. */
  hostSoloSirveSuSuperficie: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    const app = await crearDominio(ctx.dueno, m, { superficie: "APP" });
    const carta = await crearDominio(ctx.dueno, m, { superficie: "CARTA" });
    return conPublico(ctx, async (s) => {
      const cuantos = async (host: string, superficie: string) =>
        filasDe(
          await s.intentar(
            "select host from resolucion_de_host where host = $1 and superficie = $2",
            [host, superficie],
          ),
        );
      return (
        (await cuantos(app.host, "APP")) === 1 &&
        (await cuantos(app.host, "CARTA")) === 0 &&
        (await cuantos(carta.host, "CARTA")) === 1 &&
        (await cuantos(carta.host, "APP")) === 0
      );
    });
  },
  /** La vista muestra solo host, superficie, dueño y marca, y el público no abre empresa ni tenant. */
  publicoNoVeDatosDeEmpresas: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    const mundo = await crearMundoDeMarca(ctx.dueno, { marca: m });
    const d = await crearDominioDeEmpresa(ctx.dueno, mundo.empresa);
    const { rows: columnas } = await ctx.dueno.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'resolucion_de_host' order by 1`,
    );
    if (
      columnas.map((c) => c.column_name).join() !==
      "duenio_empresa_id,duenio_marca_id,host,marca_id,superficie"
    )
      return false;
    return conPublico(ctx, async (s) => {
      const fila = await s.intentar(
        "select duenio_empresa_id, duenio_marca_id, marca_id from resolucion_de_host where host = $1",
        [d.host],
      );
      if (!fila.ok || fila.rows[0]?.["duenio_empresa_id"] !== mundo.empresa) return false;
      if (fila.rows[0]?.["marca_id"] !== m || fila.rows[0]?.["duenio_marca_id"] !== null)
        return false;
      return (
        !(await s.intentar("select id from empresa")).ok &&
        !(await s.intentar("select id from tenant")).ok &&
        !(await s.intentar("select titular from resolucion_de_host")).ok
      );
    });
  },
  /** El host no se repite entre superficies ni dueños mientras no esté retirado. */
  hostUnicoEntreSuperficies: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const otra = await crearMarca(dueno);
      const d = await crearDominio(dueno, m, { superficie: "APP" });
      return (
        (await seRechaza(dueno, INSERTAR_DE_MARCA, [d.host, "CARTA", otra])) &&
        (await seRechaza(dueno, INSERTAR_DE_MARCA, [d.host, "APP", m]))
      );
    }),
  /** El dueño es una marca o una empresa, nunca las dos ni ninguna. */
  duenioExclusivo: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const mundo = await crearMundoDeMarca(dueno);
      return (
        (await seRechaza(
          dueno,
          `insert into dominio (host, superficie, duenio_marca_id, duenio_empresa_id, titular, registrado_por)
           values ($1, 'CARTA', $2, $3, 'CLIENTE', 'x')`,
          [hostAlAzar(), await marcaPrincipal(dueno), mundo.empresa],
        )) &&
        (await seRechaza(
          dueno,
          `insert into dominio (host, superficie, titular, registrado_por) values ($1, 'APP', 'OPERADOR', 'x')`,
          [hostAlAzar()],
        ))
      );
    }),
  /** La marca de entrada de un host de empresa es la de su tenant, aunque quien registra pida otra. */
  marcaDeEntradaDeLaEmpresa: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const otra = await crearMarca(dueno);
      const mundo = await crearMundoDeMarca(dueno, { marca: m });
      const r = await intentoDelDueno(
        dueno,
        `insert into dominio (host, superficie, duenio_empresa_id, marca_id, titular, registrado_por)
         values ($1, 'CARTA', $2, $3, 'CLIENTE', 'x') returning marca_id`,
        [hostAlAzar(), mundo.empresa, otra],
      );
      const { rows } = await dueno.query<{ marca_id: string }>(
        "select marca_id from dominio where duenio_empresa_id = $1",
        [mundo.empresa],
      );
      return rows.length === 0 ? !r.ok : rows[0]?.marca_id === m;
    }),
  /** Las transiciones de un dominio: de ACTIVO no se pasa a VERIFICADO; de VERIFICADO sí a ACTIVO. */
  transicionesDeDominio: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const activo = await crearDominio(dueno, m, { estado: "ACTIVO" });
      const verificado = await crearDominio(dueno, m, { estado: "VERIFICADO" });
      return (
        (await seRechaza(dueno, "update dominio set estado = 'VERIFICADO' where id = $1", [
          activo.id,
        ])) &&
        !(await seRechaza(dueno, "update dominio set estado = 'ACTIVO' where id = $1", [
          verificado.id,
        ]))
      );
    }),
  /** La fecha de verificación no se vuelve a sellar en un dominio activo. */
  verificacionNoSeResella: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const activo = await crearDominio(dueno, m, { estado: "ACTIVO" });
      return seRechaza(
        dueno,
        "update dominio set verificado_en = now() + interval '1 day' where id = $1",
        [activo.id],
      );
    }),
  /** Un dominio retirado queda congelado. */
  dominioRetiradoCongelado: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const d = await crearDominio(dueno, m, { estado: "RETIRADO" });
      return (
        (await seRechaza(dueno, "update dominio set motivo = 'otro' where id = $1", [d.id])) &&
        (await seRechaza(dueno, "update dominio set estado = 'ACTIVO' where id = $1", [d.id]))
      );
    }),
  /** El dominio canónico no se retira. */
  canonicoNoSeRetira: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const d = await crearDominio(dueno, m, { canonico: true });
      return seRechaza(
        dueno,
        "update dominio set estado = 'RETIRADO', motivo = 'x' where id = $1",
        [d.id],
      );
    }),
  /** Un solo canónico por marca y superficie; de superficies distintas, uno cada una. */
  canonicoPorSuperficie: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      await crearDominio(dueno, m, { canonico: true, superficie: "APP" });
      const otraSuperficie = await intentoDelDueno(
        dueno,
        `insert into dominio (host, superficie, duenio_marca_id, titular, es_canonico, registrado_por)
         values ($1, 'CARTA', $2, 'OPERADOR', true, 'x')`,
        [hostAlAzar(), m],
      );
      const repetido = await intentoDelDueno(
        dueno,
        `insert into dominio (host, superficie, duenio_marca_id, titular, es_canonico, registrado_por)
         values ($1, 'APP', $2, 'OPERADOR', true, 'x')`,
        [hostAlAzar(), m],
      );
      return otraSuperficie.ok && !repetido.ok;
    }),
  /** Una empresa solo tiene aplicación o carta. */
  superficieDeEmpresaAcotada: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const mundo = await crearMundoDeMarca(dueno);
      return seRechaza(dueno, INSERTAR_DE_EMPRESA, [hostAlAzar(), "LANDING", mundo.empresa]);
    }),
  /** Una marca retirada no admite dominios, ni propios ni de las empresas de sus tenants. */
  marcaRetiradaSinDominios: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const mundo = await crearMundoDeMarca(dueno, { marca: m });
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [m]);
      return (
        (await seRechaza(dueno, INSERTAR_DE_MARCA, [hostAlAzar(), "APP", m])) &&
        (await seRechaza(dueno, INSERTAR_DE_EMPRESA, [hostAlAzar(), "CARTA", mundo.empresa]))
      );
    }),
  /** Un dominio nace pendiente de verificación. */
  dominioNacePendiente: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      return seRechaza(
        dueno,
        `insert into dominio (host, superficie, duenio_marca_id, titular, registrado_por, estado, verificado_en)
         values ($1, 'APP', $2, 'OPERADOR', 'x', 'ACTIVO', now())`,
        [hostAlAzar(), m],
      );
    }),
  /** Retirar la marca espera a un alta de dominio de esa marca (y de una empresa de esa marca). */
  retirarEsperaAlAltaDeDominio: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    const mundo = await crearMundoDeMarca(ctx.dueno, { marca: m });
    for (const [texto, parametros] of [
      [INSERTAR_ADMIN_DE_MARCA, [hostAlAzar(), m, ACTOR_DE_PRUEBA]],
      [INSERTAR_ADMIN_DE_EMPRESA, [hostAlAzar(), mundo.empresa, ACTOR_DE_PRUEBA]],
    ] as const) {
      const alta = await SesionDePrueba.abrir(
        ctx.base,
        "zuluhub_plataforma",
        comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(ADMIN_DE_PRUEBA) }),
      );
      const retiro = await SesionDePrueba.abrir(
        ctx.base,
        "zuluhub_plataforma",
        comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(ADMIN_DE_PRUEBA) }),
      );
      try {
        const r1 = await alta.directo(texto, [...parametros]);
        if (!r1.ok) return false;
        await retiro.directo("set local lock_timeout = '400ms'");
        const r2 = await retiro.directo("update marca set estado = 'RETIRADA' where id = $1", [m]);
        if (!(!r2.ok && r2.codigo === "55P03")) return false;
      } finally {
        await alta.cerrar();
        await retiro.cerrar();
      }
    }
    return true;
  },
  /** Un SOPORTE no registra ni cambia dominios. */
  soporteNoRegistraDominios: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    return conAdmin(
      ctx,
      async (s) =>
        !(
          await s.intentar(
            `insert into dominio (host, superficie, duenio_marca_id, titular, registrado_por)
             values ($1, 'APP', $2, 'OPERADOR', $3)`,
            [hostAlAzar(), m, SOPORTE_DE_PRUEBA],
          )
        ).ok,
      SOPORTE_DE_PRUEBA,
    );
  },
  soporteNoVerificaDominios: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    const d = await crearDominio(ctx.dueno, m, { estado: "PENDIENTE_VERIFICACION" });
    return conAdmin(
      ctx,
      async (s) => {
        const r = await s.intentar(
          "update dominio set estado = 'VERIFICADO', verificado_en = now() where id = $1",
          [d.id],
        );
        return r.ok && r.filas === 0;
      },
      SOPORTE_DE_PRUEBA,
    );
  },
  /** La aplicación ve solo los dominios canónicos y ACTIVOS (y con contexto). */
  appVeSoloCanonicosActivos: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    const mundo = await crearMundoDeMarca(ctx.dueno, { marca: m });
    const canonico = await crearDominio(ctx.dueno, m, { canonico: true, superficie: "APP" });
    const alias = await crearDominio(ctx.dueno, m, { superficie: "CARTA" });
    const pendiente = await crearDominio(ctx.dueno, m, {
      canonico: true,
      superficie: "LANDING",
      estado: "PENDIENTE_VERIFICACION",
    });
    const deEmpresa = await crearDominioDeEmpresa(ctx.dueno, mundo.empresa);
    const hosts = [canonico, alias, pendiente, deEmpresa].map((d) => d.host);
    return conApp(ctx, mundo.empresa, async (s) => {
      const r = await s.intentar("select host from dominio where host = any($1)", [hosts]);
      return r.ok && r.rows.length === 1 && r.rows[0]?.["host"] === canonico.host;
    });
  },
  /** El público no puede leer los módulos iniciales, el plan por defecto ni el motivo. */
  publicoNoLeeLoPrivado: async (ctx: Ctx) =>
    conPublico(ctx, async (s) => {
      for (const columna of [
        "modulos_iniciales",
        "plan_por_defecto_id",
        "motivo",
        "confirmada_por",
        "estado",
      ]) {
        if ((await s.intentar(`select ${columna} from version_de_marca`)).ok) return false;
      }
      for (const columna of [
        "titular",
        "registrado_por",
        "motivo",
        "verificado_en",
        "es_canonico",
      ]) {
        if ((await s.intentar(`select ${columna} from dominio`)).ok) return false;
      }
      return (
        !(await s.intentar("select estado from marca")).ok &&
        !(await s.intentar("select id from empresa")).ok
      );
    }),
  /** El público no escribe. */
  publicoNoEscribe: async (ctx: Ctx) =>
    conPublico(
      ctx,
      async (s) =>
        !(await s.intentar("update marca set codigo = codigo")).ok &&
        !(await s.intentar("insert into plan (codigo) values ('x-zz')")).ok,
    ),
  /** El público no ejecuta funciones. */
  publicoNoEjecutaFunciones: async (ctx: Ctx) =>
    conPublico(ctx, async (s) => !(await s.intentar("select host_valido('a.com')")).ok),
  /** La única de número por tenant vale aunque no estuviera el disparador. */
  unicaDeAsignacion: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno);
      await dueno.query("alter table plan_de_tenant disable trigger plan_de_tenant_alta");
      const insertar = () =>
        intentoDelDueno(
          dueno,
          `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
           values ($1, 1, $2, now(), 'ALTA', 'x', 'a')`,
          [m.tenant, version],
        );
      return (await insertar()).ok && !(await insertar()).ok;
    }),
  /** La única de número por (tenant, empresa, perilla) cuenta los NULL como iguales. */
  unicaDeAjusteConNulos: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMundoDeMarca(dueno);
      await dueno.query("alter table ajuste_de_perilla disable trigger ajuste_de_perilla_alta");
      const insertar = () =>
        intentoDelDueno(
          dueno,
          `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
           values ($1, 'empresas_por_tenant', 1, '1', now(), 'x', 'a')`,
          [m.tenant],
        );
      return (await insertar()).ok && !(await insertar()).ok;
    }),
  /** La asignación y el ajuste no se modifican ni con los permisos del dueño. */
  asignacionDeSoloInsercion: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno);
      await asignarPlan(dueno, m.tenant, version);
      return (
        (await seRechaza(dueno, "update plan_de_tenant set motivo = 'otro'")) &&
        (await seRechaza(dueno, "delete from plan_de_tenant"))
      );
    }),
  ajusteDeSoloInsercion: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMundoDeMarca(dueno);
      await ajustarPerilla(dueno, m.tenant, "empresas_por_tenant", "2");
      return (
        (await seRechaza(dueno, "update ajuste_de_perilla set valor = '3'")) &&
        (await seRechaza(dueno, "delete from ajuste_de_perilla"))
      );
    }),
  /** El host retirado se puede volver a registrar (la única es parcial). */
  hostUnicoSoloActivo: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const d = await crearDominio(dueno, m, { estado: "RETIRADO" });
      return !(await seRechaza(dueno, INSERTAR_DE_MARCA, [d.host, "APP", m]));
    }),
  /** El host tiene que ser un host ya normalizado. */
  hostValidoEnElCheck: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      return seRechaza(dueno, INSERTAR_DE_MARCA, ["A.COM", "APP", m]);
    }),
  /** Un SOPORTE no escribe marcas. */
  soporteNoCreaMarcas: async (ctx: Ctx) =>
    conAdmin(
      ctx,
      async (s) =>
        !(
          await s.intentar("insert into marca (codigo) values ($1)", [
            `s-${randomUUID().slice(0, 6)}`,
          ])
        ).ok,
      SOPORTE_DE_PRUEBA,
    ),
  soporteNoAsigna: async (ctx: Ctx) => {
    const m = await crearMundoDeMarca(ctx.dueno);
    const { version } = await crearPlanPublicado(ctx.dueno);
    return conAdmin(
      ctx,
      async (s) =>
        !(
          await s.intentar(
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 1, $2, now(), 'ALTA', 'x', $3)`,
            [m.tenant, version, SOPORTE_DE_PRUEBA],
          )
        ).ok,
      SOPORTE_DE_PRUEBA,
    );
  },
  soporteNoActivaModulos: async (ctx: Ctx) => {
    const m = await crearMundoDeMarca(ctx.dueno);
    await ctx.dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')",
      [m.empresa],
    );
    return conAdmin(
      ctx,
      async (s) => {
        const r = await s.intentar(
          "update modulo_de_empresa set activo = false where empresa_id = $1",
          [m.empresa],
        );
        return r.ok && r.filas === 0;
      },
      SOPORTE_DE_PRUEBA,
    );
  },
  /** La marca del tenant no cambia. */
  marcaDelTenantInmutable: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const otra = await crearMarca(dueno);
      const m = await crearMundoDeMarca(dueno);
      return seRechaza(dueno, "update tenant set marca_id = $2 where id = $1", [m.tenant, otra]);
    }),
  /** Un tenant sin marca no se da de alta. */
  tenantSinMarcaFalla: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () =>
      seRechaza(dueno, "insert into tenant (nombre) values ('sin marca')"),
    ),
  /** Una versión de marca confirmada o una de plan publicada queda congelada. */
  versionDeMarcaCongelada: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      const { id } = await crearVersionDeMarcaConfirmada(dueno, m, { nombreVisible: "Antes" });
      return seRechaza(
        dueno,
        "update version_de_marca set nombre_visible = 'Después' where id = $1",
        [id],
      );
    }),
  versionDePlanCongelada: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const { version } = await crearPlanPublicado(dueno);
      return seRechaza(
        dueno,
        "update version_de_plan set nombre_comercial = 'Otro' where id = $1",
        [version],
      );
    }),
  /** El código de una marca no cambia. */
  codigoDeMarcaInmutable: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      return seRechaza(dueno, "update marca set codigo = 'otro-codigo' where id = $1", [m]);
    }),
  /** El número de la asignación es el siguiente. */
  numeroDeAsignacionConsecutivo: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno);
      return seRechaza(
        dueno,
        `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
         values ($1, 3, $2, now(), 'ALTA', 'x', 'a')`,
        [m.tenant, version],
      );
    }),
  /** Retirar la marca padre espera a quien le está creando una hija (FOR SHARE). */
  retirarEsperaAlAlta: async (ctx: Ctx) => {
    const padre = await crearMarca(ctx.dueno);
    const alta = await SesionDePrueba.abrir(
      ctx.base,
      "zuluhub_plataforma",
      comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(ADMIN_DE_PRUEBA) }),
    );
    const retiro = await SesionDePrueba.abrir(
      ctx.base,
      "zuluhub_plataforma",
      comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(ADMIN_DE_PRUEBA) }),
    );
    try {
      const r1 = await alta.directo("insert into marca (codigo, marca_padre_id) values ($1, $2)", [
        `h-${randomUUID().slice(0, 6)}`,
        padre,
      ]);
      if (!r1.ok) return false;
      await retiro.directo("set local lock_timeout = '400ms'");
      const r2 = await retiro.directo("update marca set estado = 'RETIRADA' where id = $1", [
        padre,
      ]);
      return !r2.ok && r2.codigo === "55P03"; // tuvo que esperar: lock_not_available
    } finally {
      await alta.cerrar();
      await retiro.cerrar();
    }
  },
  /** El propietario no puede registrarse como un intento fallido, y quien no lo es no puede registrarse como un acceso. */
  auditoriaDeGrupoDistingue: async (ctx: Ctx) => {
    const m = await crearMundoDeMarca(ctx.dueno);
    await ctx.dueno.query(
      "insert into membresia_tenant (persona_id, tenant_id, rol) values ($1, $2, 'PROPIETARIO')",
      [m.persona, m.tenant],
    );
    const otra = (
      await ctx.dueno.query<{ id: string }>(
        "insert into persona (email) values ($1) returning id",
        [`${randomUUID().slice(0, 10)}@prueba.test`],
      )
    ).rows[0]?.id as string;
    const abrir = (persona: string) =>
      SesionDePrueba.abrir(
        ctx.base,
        "zuluhub_grupo",
        comoGrupo(tenantId(m.tenant), personaId(persona)),
      );
    const propietario = await abrir(m.persona);
    const ajeno = await abrir(otra);
    try {
      const insertar = (s: SesionDePrueba, persona: string, resultado: string) =>
        s.intentar(
          "insert into auditoria_acceso_grupo (tenant_id, persona_id, resultado) values ($1, $2, $3)",
          [m.tenant, persona, resultado],
        );
      return (
        (await insertar(propietario, m.persona, "PERMITIDO")).ok &&
        (await insertar(ajeno, otra, "DENEGADO")).ok &&
        !(await insertar(propietario, m.persona, "DENEGADO")).ok &&
        !(await insertar(ajeno, otra, "PERMITIDO")).ok
      );
    } finally {
      await propietario.cerrar();
      await ajeno.cerrar();
    }
  },
  /** Un ADMIN puede escribir (las funciones de validación se ejecutan con sus permisos). */
  adminPuedeRegistrarUnDominio: async (ctx: Ctx) => {
    const m = await crearMarca(ctx.dueno);
    return conAdmin(
      ctx,
      async (s) =>
        (await s.intentar(INSERTAR_ADMIN_DE_MARCA, [hostAlAzar(), m, ACTOR_DE_PRUEBA])).ok,
    );
  },
  /** La hora de corte no admite las 24:00 ni segundos. */
  horaDeCorteSinVeinticuatro: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMundoDeMarca(dueno);
      return (
        (await seRechaza(dueno, "update sucursal set hora_de_corte = '24:00' where id = $1", [
          m.sucursal,
        ])) &&
        (await seRechaza(dueno, "update sucursal set hora_de_corte = '04:30:15' where id = $1", [
          m.sucursal,
        ]))
      );
    }),
  /** La referencia de error no se repite. */
  referenciaUnica: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const r = `ZH-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
      const insertar = () =>
        intentoDelDueno(
          dueno,
          "insert into referencia_de_error (referencia, accion, motivo) values ($1, 'a.b', 'X')",
          [r],
        );
      return (await insertar()).ok && !(await insertar()).ok;
    }),
  /** El tema es de la lista cerrada con colores #rrggbb. */
  temaCerrado: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const m = await crearMarca(dueno);
      return (
        (await seRechaza(
          dueno,
          "insert into version_de_marca (marca_id, tema) values ($1, $2::jsonb)",
          [m, '{"primary":"red"}'],
        )) &&
        (await seRechaza(
          dueno,
          "insert into version_de_marca (marca_id, tema) values ($1, $2::jsonb)",
          [m, '{"fondo":"#aabbcc"}'],
        ))
      );
    }),
  /** Los textos visibles no admiten «<» ni caracteres de formato. */
  textoVisibleSinMarcado: async ({ dueno }: Ctx) => {
    const { rows } = await dueno.query<{ a: boolean; b: boolean; c: boolean }>(
      "select texto_visible_valido('a<b', 10) as a, texto_visible_valido('a' || chr(8203), 10) as b, texto_visible_valido(' a', 10) as c",
    );
    return rows[0]?.a === false && rows[0]?.b === false && rows[0]?.c === false;
  },
  /** Las claves del vocabulario van en minúsculas. */
  vocabularioEnMinusculas: async ({ dueno }: Ctx) => {
    const { rows } = await dueno.query<{ v: boolean }>(
      `select vocabulario_valido('{"Mal.clave":"x"}'::jsonb) as v`,
    );
    return rows[0]?.v === false;
  },
  /** Una perilla con un campo que falta no es válida. */
  perillasSinNulos: async ({ dueno }: Ctx) => {
    const { rows } = await dueno.query<{ v: boolean }>(
      `select perillas_validas('{"empresas_por_tenant":{"tipo":"LIMITE","encendida":true}}'::jsonb, false) as v`,
    );
    return rows[0]?.v === false;
  },
  /** La empresa de otro tenant no ve la asignación de plan ajena. */
  appVeSoloSuTenant: async (ctx: Ctx) => {
    const a = await crearMundoDeMarca(ctx.dueno);
    const b = await crearMundoDeMarca(ctx.dueno);
    const { version } = await crearPlanPublicado(ctx.dueno);
    await asignarPlan(ctx.dueno, a.tenant, version);
    await asignarPlan(ctx.dueno, b.tenant, version);
    return conApp(ctx, a.empresa, async (s) => {
      const r = await s.intentar("select tenant_id from plan_de_tenant");
      return r.ok && r.rows.length === 1 && r.rows[0]?.["tenant_id"] === a.tenant;
    });
  },
  /** La empresa no ve el ajuste de otra empresa de su tenant. */
  appVeSoloSusAjustes: async (ctx: Ctx) => {
    const a = await crearMundoDeMarca(ctx.dueno);
    const otra = await crearMundoDeMarca(ctx.dueno, { tenant: a.tenant });
    await ajustarPerilla(ctx.dueno, a.tenant, "empresas_por_tenant", "4", {
      empresa: otra.empresa,
    });
    return conApp(
      ctx,
      a.empresa,
      async (s) => filasDe(await s.intentar("select valor from ajuste_de_perilla")) === 0,
    );
  },
  /** Sin contexto firmado la aplicación no ve las marcas. */
  appSinContextoNoVeMarcas: async (ctx: Ctx) =>
    conApp(ctx, null, async (s) => filasDe(await s.intentar("select id from marca")) === 0),
  /** Una empresa que no opera no cambia el nivel de sus controles. */
  nivelDeControlSoloSiOpera: async (ctx: Ctx) => {
    const m = await crearMundoDeMarca(ctx.dueno, { estado: "PROVISIONING" });
    return conApp(
      ctx,
      m.empresa,
      async (s) =>
        !(
          await s.intentar(
            "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', 'AVISAR')",
            [m.empresa],
          )
        ).ok,
    );
  },
  /** La plataforma no inserta marcas «principales» ni cambia la marca de un tenant (privilegios por columna). */
  plataformaSinPrivilegiosDeIdentidad: async (ctx: Ctx) => {
    const m = await crearMundoDeMarca(ctx.dueno);
    return conAdmin(ctx, async (s) => {
      const a = await s.intentar("insert into marca (codigo, es_principal) values ($1, true)", [
        `p-${randomUUID().slice(0, 6)}`,
      ]);
      const b = await s.intentar("update tenant set marca_id = marca_id where id = $1", [m.tenant]);
      return (
        !a.ok && /permission denied/.test(a.mensaje) && !b.ok && /permission denied/.test(b.mensaje)
      );
    });
  },
  /** Una marca con padre RETIRADA no nace; y un tercer nivel no existe. */
  jerarquiaAcotada: async ({ dueno }: Ctx) =>
    sinConfirmar(dueno, async () => {
      const hija = await crearMarca(dueno, { padre: await marcaPrincipal(dueno) });
      const nieta = await crearMarca(dueno, { padre: hija });
      return seRechaza(
        dueno,
        "insert into marca (codigo, marca_padre_id) values ('bisnieta', $1)",
        [nieta],
      );
    }),
};

// ---- los debilitamientos -----------------------------------------------------------------------------

type Debilitamiento = Readonly<{
  nombre: string;
  /** El texto de 0007 roto. */
  romper: (sql: string) => string;
  sonda: Sonda;
}>;

const SELECT_PUBLICO_DE_VERSION =
  "GRANT SELECT (marca_id, numero, vigente_desde, nombre_visible, tema, logo, vocabulario)\n  ON version_de_marca TO zuluhub_publico;";

const DEBILITAMIENTOS: readonly Debilitamiento[] = [
  // --- RLS y políticas del rol público
  ...TABLAS_NUEVAS.map((tabla): Debilitamiento => ({
    nombre: `quitar el FORCE ROW LEVEL SECURITY de ${tabla}`,
    romper: (sql) => cambiar(sql, `ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY;`, ""),
    sonda: SONDAS.rlsForzada(tabla),
  })),
  {
    nombre: "la política pública de marca sin estado = 'ACTIVA'",
    romper: (sql) => cambiar(sql, "USING (estado = 'ACTIVA');", "USING (true);"),
    sonda: SONDAS.publicoSoloMarcasActivas,
  },
  {
    nombre: "la política pública de versiones sin vigente_desde <= now()",
    romper: (sql) =>
      cambiar(
        sql,
        "version_de_marca_publico_leer ON version_de_marca FOR SELECT TO zuluhub_publico\n  USING (estado = 'CONFIRMADA' AND vigente_desde <= now());",
        "version_de_marca_publico_leer ON version_de_marca FOR SELECT TO zuluhub_publico\n  USING (estado = 'CONFIRMADA');",
      ),
    sonda: SONDAS.publicoSoloVersionesVigentes,
  },
  {
    nombre: "la política pública de versiones sin estado = 'CONFIRMADA'",
    romper: (sql) =>
      cambiar(
        sql,
        "version_de_marca_publico_leer ON version_de_marca FOR SELECT TO zuluhub_publico\n  USING (estado = 'CONFIRMADA' AND vigente_desde <= now());",
        "version_de_marca_publico_leer ON version_de_marca FOR SELECT TO zuluhub_publico\n  USING (vigente_desde <= now() OR vigente_desde IS NULL);",
      ),
    sonda: SONDAS.publicoNoVeBorradores,
  },
  {
    nombre: "la política pública de dominios sin estado = 'ACTIVO'",
    romper: (sql) =>
      cambiar(
        sql,
        "dominio_publico_leer ON dominio FOR SELECT TO zuluhub_publico\n  USING (estado = 'ACTIVO');",
        "dominio_publico_leer ON dominio FOR SELECT TO zuluhub_publico\n  USING (true);",
      ),
    sonda: SONDAS.publicoSoloDominiosActivos,
  },
  {
    nombre: "un GRANT de modulos_iniciales al rol público",
    romper: (sql) =>
      cambiar(
        sql,
        SELECT_PUBLICO_DE_VERSION,
        "GRANT SELECT (marca_id, numero, vigente_desde, nombre_visible, tema, logo, vocabulario, modulos_iniciales)\n  ON version_de_marca TO zuluhub_publico;",
      ),
    sonda: SONDAS.publicoNoLeeLoPrivado,
  },
  {
    nombre: "un GRANT de estado de la marca al rol público",
    romper: (sql) =>
      cambiar(
        sql,
        "GRANT SELECT (id, codigo, marca_padre_id, nivel, es_principal) ON marca TO zuluhub_publico;",
        "GRANT SELECT (id, codigo, marca_padre_id, nivel, es_principal, estado) ON marca TO zuluhub_publico;",
      ),
    sonda: SONDAS.publicoNoLeeLoPrivado,
  },
  {
    nombre: "un GRANT de UPDATE de la marca al rol público",
    romper: (sql) =>
      cambiar(
        sql,
        "GRANT USAGE ON SCHEMA public TO zuluhub_publico;",
        "GRANT USAGE ON SCHEMA public TO zuluhub_publico;\nGRANT UPDATE (codigo) ON marca TO zuluhub_publico;",
      ),
    sonda: SONDAS.publicoNoEscribe,
  },
  {
    nombre: "un EXECUTE de host_valido para el rol público",
    romper: (sql) =>
      cambiar(
        sql,
        "GRANT USAGE ON SCHEMA public TO zuluhub_publico;",
        "GRANT USAGE ON SCHEMA public TO zuluhub_publico;\nGRANT EXECUTE ON FUNCTION host_valido(text) TO zuluhub_publico;",
      ),
    sonda: SONDAS.publicoNoEjecutaFunciones,
  },
  // --- aislamiento de la aplicación
  {
    nombre: "la lectura de la asignación de plan sin acotar al tenant de la empresa",
    romper: (sql) =>
      cambiar(
        sql,
        "USING (tenant_id = (SELECT tenant_de_empresa((SELECT app_empresa_id()))));",
        "USING (true);",
      ),
    sonda: SONDAS.appVeSoloSuTenant,
  },
  {
    nombre: "la lectura de ajustes sin acotar a la empresa propia",
    romper: (sql) =>
      cambiar(
        sql,
        "AND (empresa_id IS NULL OR empresa_id = (SELECT app_empresa_id()))",
        "AND true",
      ),
    sonda: SONDAS.appVeSoloSusAjustes,
  },
  {
    nombre: "la lectura de marcas por la aplicación sin exigir contexto",
    romper: (sql) =>
      cambiar(
        sql,
        "CREATE POLICY marca_app_leer ON marca FOR SELECT TO zuluhub_app\n  USING ((SELECT contexto_firmado()) IS NOT NULL);",
        "CREATE POLICY marca_app_leer ON marca FOR SELECT TO zuluhub_app\n  USING (true);",
      ),
    sonda: SONDAS.appSinContextoNoVeMarcas,
  },
  {
    nombre: "el alta de un nivel de control sin empresa_operable",
    romper: (sql) =>
      cambiar(
        sql,
        "CREATE POLICY nivel_de_control_app_alta ON nivel_de_control FOR INSERT TO zuluhub_app\n  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));",
        "CREATE POLICY nivel_de_control_app_alta ON nivel_de_control FOR INSERT TO zuluhub_app\n  WITH CHECK (empresa_id = (SELECT app_empresa_id()));",
      ),
    sonda: SONDAS.nivelDeControlSoloSiOpera,
  },
  // --- la plataforma
  {
    nombre: "quitar la restrictiva ADMIN del alta de marcas",
    romper: (sql) =>
      quitar(sql, "CREATE POLICY marca_plataforma_admin_alta ON marca AS RESTRICTIVE"),
    sonda: SONDAS.soporteNoCreaMarcas,
  },
  {
    nombre: "quitar la restrictiva ADMIN del alta de asignaciones de plan",
    romper: (sql) =>
      quitar(
        sql,
        "CREATE POLICY plan_de_tenant_plataforma_admin_alta ON plan_de_tenant AS RESTRICTIVE",
      ),
    sonda: SONDAS.soporteNoAsigna,
  },
  {
    nombre: "quitar la restrictiva ADMIN del cambio de módulos activados",
    romper: (sql) =>
      quitar(
        sql,
        "CREATE POLICY modulo_de_empresa_plataforma_admin_cambiar ON modulo_de_empresa AS RESTRICTIVE",
      ),
    sonda: SONDAS.soporteNoActivaModulos,
  },
  {
    nombre: "quitar el EXECUTE de las funciones de validación para la plataforma",
    romper: (sql) => quitar(sql, "GRANT EXECUTE ON FUNCTION\n  host_valido(text)"),
    sonda: SONDAS.adminPuedeRegistrarUnDominio,
  },
  {
    nombre: "un GRANT de es_principal en el alta de marcas",
    romper: (sql) =>
      cambiar(
        sql,
        "GRANT INSERT (codigo, marca_padre_id) ON marca TO zuluhub_plataforma;",
        "GRANT INSERT (codigo, marca_padre_id, es_principal) ON marca TO zuluhub_plataforma;",
      ),
    sonda: SONDAS.plataformaSinPrivilegiosDeIdentidad,
  },
  {
    nombre: "un GRANT de UPDATE (marca_id) del tenant a la plataforma",
    romper: (sql) =>
      cambiar(
        sql,
        "GRANT INSERT (marca_id) ON tenant TO zuluhub_plataforma;",
        "GRANT INSERT (marca_id) ON tenant TO zuluhub_plataforma;\nGRANT UPDATE (marca_id) ON tenant TO zuluhub_plataforma;",
      ),
    sonda: SONDAS.plataformaSinPrivilegiosDeIdentidad,
  },
  // --- dominios por superficie (dueño, 2026-10-12)
  {
    nombre: "la vista de resolución sin security_invoker (corre con los permisos de su dueño)",
    romper: (sql) =>
      cambiar(
        sql,
        "CREATE VIEW resolucion_de_host WITH (security_invoker = true) AS",
        "CREATE VIEW resolucion_de_host AS",
      ),
    sonda: SONDAS.publicoSoloDominiosActivos,
  },
  {
    nombre: "la vista de resolución sin su filtro de dominios ACTIVOS Y sin la política pública",
    romper: (sql) =>
      cambiar(
        cambiar(
          sql,
          "USING (estado = 'ACTIVO');\nCREATE POLICY version_de_marca_publico_leer",
          "USING (true);\nCREATE POLICY version_de_marca_publico_leer",
        ),
        "   WHERE d.estado = 'ACTIVO';",
        "   WHERE true;",
      ),
    sonda: SONDAS.publicoSoloDominiosActivos,
  },
  {
    nombre: "la vista de resolución no distingue la superficie",
    romper: (sql) =>
      cambiar(
        sql,
        "SELECT d.host, d.superficie, d.duenio_marca_id",
        "SELECT d.host, 'APP'::text AS superficie, d.duenio_marca_id",
      ),
    sonda: SONDAS.hostSoloSirveSuSuperficie,
  },
  {
    nombre: "la vista de resolución expone el titular del dominio",
    romper: (sql) =>
      cambiar(
        sql,
        "SELECT d.host, d.superficie, d.duenio_marca_id",
        "SELECT d.host, d.titular, d.superficie, d.duenio_marca_id",
      ),
    sonda: SONDAS.publicoNoVeDatosDeEmpresas,
  },
  {
    nombre: "un GRANT de SELECT sobre empresa al rol público",
    romper: (sql) =>
      cambiar(
        sql,
        "GRANT SELECT ON resolucion_de_host TO zuluhub_publico;",
        "GRANT SELECT ON resolucion_de_host TO zuluhub_publico;\nGRANT SELECT ON empresa TO zuluhub_publico;",
      ),
    sonda: SONDAS.publicoNoVeDatosDeEmpresas,
  },
  {
    nombre: "un GRANT del titular del dominio al rol público",
    romper: (sql) =>
      cambiar(
        sql,
        "GRANT SELECT (host, superficie, estado, duenio_marca_id, duenio_empresa_id, marca_id) ON dominio TO zuluhub_publico;",
        "GRANT SELECT (host, superficie, estado, duenio_marca_id, duenio_empresa_id, marca_id, titular) ON dominio TO zuluhub_publico;",
      ),
    sonda: SONDAS.publicoNoLeeLoPrivado,
  },
  {
    nombre: "quitar dominio_host_uk",
    romper: (sql) => quitar(sql, "CREATE UNIQUE INDEX dominio_host_uk"),
    sonda: SONDAS.hostUnicoEntreSuperficies,
  },
  {
    nombre: "quitar dominio_duenio_ck (el dueño deja de ser exclusivo)",
    romper: (sql) =>
      cambiar(
        sql,
        "  CONSTRAINT dominio_duenio_ck CHECK ((duenio_marca_id IS NOT NULL) <> (duenio_empresa_id IS NOT NULL)),\n",
        "",
      ),
    sonda: SONDAS.duenioExclusivo,
  },
  {
    nombre: "la marca de entrada de un host de empresa la elige quien lo registra",
    romper: (sql) =>
      cambiar(
        sql,
        "  NEW.marca_id := v_marca;\n  RETURN NEW;",
        "  NEW.marca_id := COALESCE(NEW.marca_id, v_marca);\n  RETURN NEW;",
      ),
    sonda: SONDAS.marcaDeEntradaDeLaEmpresa,
  },
  {
    nombre: "de ACTIVO se puede pasar a VERIFICADO",
    romper: (sql) =>
      cambiar(
        sql,
        "OR (OLD.estado = 'ACTIVO' AND NEW.estado IN ('PENDIENTE_VERIFICACION', 'RETIRADO'))",
        "OR (OLD.estado = 'ACTIVO' AND NEW.estado IN ('PENDIENTE_VERIFICACION', 'VERIFICADO', 'RETIRADO'))",
      ),
    sonda: SONDAS.transicionesDeDominio,
  },
  {
    nombre: "quitar el chequeo de transiciones de estado del dominio",
    romper: (sql) =>
      cambiar(
        sql,
        "IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (\n       (OLD.estado = 'PENDIENTE_VERIFICACION'",
        "IF false AND NOT (\n       (OLD.estado = 'PENDIENTE_VERIFICACION'",
      ),
    sonda: SONDAS.transicionesDeDominio,
  },
  {
    nombre: "la fecha de verificación se puede volver a sellar",
    romper: (sql) =>
      cambiar(
        sql,
        "IF NEW.verificado_en IS DISTINCT FROM OLD.verificado_en\n     AND NOT (OLD.estado",
        "IF false\n     AND NOT (OLD.estado",
      ),
    sonda: SONDAS.verificacionNoSeResella,
  },
  {
    nombre: "quitar el congelamiento del dominio retirado",
    romper: (sql) =>
      cambiar(
        sql,
        "IF OLD.estado = 'RETIRADO' THEN\n    RAISE EXCEPTION 'un dominio retirado",
        "IF false THEN\n    RAISE EXCEPTION 'un dominio retirado",
      ),
    sonda: SONDAS.dominioRetiradoCongelado,
  },
  {
    nombre: "el dominio canónico se puede retirar",
    romper: (sql) =>
      cambiar(sql, "IF OLD.es_canonico AND NEW.estado = 'RETIRADO' THEN", "IF false THEN"),
    sonda: SONDAS.canonicoNoSeRetira,
  },
  {
    nombre: "el canónico es uno por marca, sin distinguir la superficie",
    romper: (sql) =>
      cambiar(
        sql,
        "CREATE UNIQUE INDEX dominio_canonico_uk ON dominio (duenio_marca_id, superficie)",
        "CREATE UNIQUE INDEX dominio_canonico_uk ON dominio (duenio_marca_id)",
      ),
    sonda: SONDAS.canonicoPorSuperficie,
  },
  {
    nombre: "quitar dominio_canonico_uk",
    romper: (sql) => quitar(sql, "CREATE UNIQUE INDEX dominio_canonico_uk"),
    sonda: SONDAS.canonicoPorSuperficie,
  },
  {
    nombre: "una empresa puede tener la landing o la consola",
    romper: (sql) =>
      cambiar(
        sql,
        "  CONSTRAINT dominio_superficie_duenio_ck CHECK (duenio_empresa_id IS NULL OR superficie IN ('APP', 'CARTA')),\n",
        "",
      ),
    sonda: SONDAS.superficieDeEmpresaAcotada,
  },
  {
    nombre: "una marca retirada admite dominios nuevos",
    romper: (sql) =>
      cambiar(
        sql,
        "  IF FOUND AND v_estado <> 'ACTIVA' THEN\n    RAISE EXCEPTION 'la marca está retirada: no admite dominios nuevos'",
        "  IF false THEN\n    RAISE EXCEPTION 'la marca está retirada: no admite dominios nuevos'",
      ),
    sonda: SONDAS.marcaRetiradaSinDominios,
  },
  {
    nombre: "un dominio puede nacer ya activo",
    romper: (sql) =>
      cambiar(
        sql,
        "IF NEW.estado <> 'PENDIENTE_VERIFICACION' THEN\n    RAISE EXCEPTION 'un dominio nace pendiente",
        "IF false THEN\n    RAISE EXCEPTION 'un dominio nace pendiente",
      ),
    sonda: SONDAS.dominioNacePendiente,
  },
  {
    nombre: "la marca del dominio sin FOR SHARE",
    romper: (sql) => {
      const de = "WHERE m.id = v_marca FOR SHARE;";
      if (sql.split(de).length - 1 !== 2) throw new Error("tenía que aparecer dos veces");
      return sql.replaceAll(de, "WHERE m.id = v_marca;");
    },
    sonda: SONDAS.retirarEsperaAlAltaDeDominio,
  },
  {
    nombre: "quitar la restrictiva ADMIN del alta de dominios",
    romper: (sql) =>
      quitar(sql, "CREATE POLICY dominio_plataforma_admin_alta ON dominio AS RESTRICTIVE"),
    sonda: SONDAS.soporteNoRegistraDominios,
  },
  {
    nombre: "quitar la restrictiva ADMIN del cambio de dominios",
    romper: (sql) =>
      quitar(sql, "CREATE POLICY dominio_plataforma_admin_cambiar ON dominio AS RESTRICTIVE"),
    sonda: SONDAS.soporteNoVerificaDominios,
  },
  {
    nombre: "la aplicación lee también los dominios no canónicos",
    romper: (sql) =>
      cambiar(
        sql,
        "USING (estado = 'ACTIVO' AND es_canonico AND (SELECT contexto_firmado()) IS NOT NULL);",
        "USING (estado = 'ACTIVO' AND (SELECT contexto_firmado()) IS NOT NULL);",
      ),
    sonda: SONDAS.appVeSoloCanonicosActivos,
  },
  {
    nombre: "la aplicación lee también los dominios que no están activos",
    romper: (sql) =>
      cambiar(
        sql,
        "USING (estado = 'ACTIVO' AND es_canonico AND (SELECT contexto_firmado()) IS NOT NULL);",
        "USING (es_canonico AND (SELECT contexto_firmado()) IS NOT NULL);",
      ),
    sonda: SONDAS.appVeSoloCanonicosActivos,
  },
  // --- inmutabilidad y solo inserción
  {
    nombre: "quitar el disparador tenant_marca_inmutable",
    romper: (sql) => quitar(sql, "CREATE TRIGGER tenant_marca_inmutable"),
    sonda: SONDAS.marcaDelTenantInmutable,
  },
  {
    nombre: "marca_id del tenant nullable (sin NOT NULL)",
    romper: (sql) =>
      cambiar(
        sql,
        "ADD COLUMN marca_id uuid NOT NULL DEFAULT %L",
        "ADD COLUMN marca_id uuid DEFAULT %L",
      ),
    sonda: SONDAS.tenantSinMarcaFalla,
  },
  {
    nombre: "quitar solo_insercion de las asignaciones de plan",
    romper: (sql) => quitar(sql, "CREATE TRIGGER plan_de_tenant_solo_insercion"),
    sonda: SONDAS.asignacionDeSoloInsercion,
  },
  {
    nombre: "quitar solo_insercion de los ajustes de perillas",
    romper: (sql) => quitar(sql, "CREATE TRIGGER ajuste_de_perilla_solo_insercion"),
    sonda: SONDAS.ajusteDeSoloInsercion,
  },
  {
    nombre: "quitar plan_de_tenant_numero_uk",
    romper: (sql) =>
      cambiar(sql, "  CONSTRAINT plan_de_tenant_numero_uk UNIQUE (tenant_id, numero),\n", ""),
    sonda: SONDAS.unicaDeAsignacion,
  },
  {
    nombre: "la única de ajustes sin NULLS NOT DISTINCT",
    romper: (sql) =>
      cambiar(
        sql,
        "UNIQUE NULLS NOT DISTINCT (tenant_id, empresa_id, perilla, numero)",
        "UNIQUE (tenant_id, empresa_id, perilla, numero)",
      ),
    sonda: SONDAS.unicaDeAjusteConNulos,
  },
  {
    nombre: "volver no parcial el índice único del host",
    romper: (sql) =>
      cambiar(
        sql,
        "CREATE UNIQUE INDEX dominio_host_uk ON dominio (host) WHERE estado <> 'RETIRADO';",
        "CREATE UNIQUE INDEX dominio_host_uk ON dominio (host);",
      ),
    sonda: SONDAS.hostUnicoSoloActivo,
  },
  {
    nombre: "quitar host_valido del CHECK del dominio",
    romper: (sql) => cambiar(sql, "CHECK (host_valido(host))", "CHECK (true)"),
    sonda: SONDAS.hostValidoEnElCheck,
  },
  {
    nombre: "quitar el congelamiento de la versión de marca confirmada",
    romper: (sql) => cambiar(sql, "IF OLD.estado = 'CONFIRMADA' THEN", "IF false THEN"),
    sonda: SONDAS.versionDeMarcaCongelada,
  },
  {
    nombre: "quitar el congelamiento de la versión de plan publicada",
    romper: (sql) => cambiar(sql, "IF OLD.estado = 'PUBLICADA' THEN", "IF false THEN"),
    sonda: SONDAS.versionDePlanCongelada,
  },
  {
    nombre: "el código de la marca deja de ser inmutable",
    romper: (sql) =>
      cambiar(
        sql,
        "     OR NEW.codigo IS DISTINCT FROM OLD.codigo\n     OR NEW.es_principal IS DISTINCT FROM OLD.es_principal",
        "     OR NEW.es_principal IS DISTINCT FROM OLD.es_principal",
      ),
    sonda: SONDAS.codigoDeMarcaInmutable,
  },
  {
    nombre: "el disparador de la asignación deja de exigir el número siguiente",
    romper: (sql) =>
      cambiar(
        sql,
        "IF NEW.numero IS DISTINCT FROM v_siguiente THEN\n    RAISE EXCEPTION 'el número de la asignación",
        "IF false THEN\n    RAISE EXCEPTION 'el número de la asignación",
      ),
    sonda: SONDAS.numeroDeAsignacionConsecutivo,
  },
  {
    nombre: "el padre de una marca sin FOR SHARE",
    romper: (sql) =>
      cambiar(
        sql,
        "WHERE m.id = NEW.marca_padre_id FOR SHARE;",
        "WHERE m.id = NEW.marca_padre_id;",
      ),
    sonda: SONDAS.retirarEsperaAlAlta,
  },
  {
    nombre: "el nivel de la marca no se acota (sin el CHECK de nivel)",
    romper: (sql) =>
      cambiar(
        sql,
        "CONSTRAINT marca_nivel_ck CHECK (nivel BETWEEN 0 AND 2)",
        "CONSTRAINT marca_nivel_ck CHECK (nivel BETWEEN 0 AND 9)",
      ),
    sonda: SONDAS.jerarquiaAcotada,
  },
  // --- la parte 0
  {
    nombre: "la política de acceso permitido sin exigir el resultado PERMITIDO",
    romper: (sql) =>
      cambiar(
        sql,
        "AND resultado = 'PERMITIDO' AND es_propietario_activo(tenant_id)",
        "AND es_propietario_activo(tenant_id)",
      ),
    sonda: SONDAS.auditoriaDeGrupoDistingue,
  },
  {
    nombre: "la política de acceso permitido sin exigir ser propietario",
    romper: (sql) =>
      cambiar(
        sql,
        "AND resultado = 'PERMITIDO' AND es_propietario_activo(tenant_id)",
        "AND resultado = 'PERMITIDO'",
      ),
    sonda: SONDAS.auditoriaDeGrupoDistingue,
  },
  {
    nombre: "la política de intento fallido deja registrar al propietario",
    romper: (sql) =>
      cambiar(
        sql,
        "AND resultado = 'DENEGADO' AND NOT es_propietario_activo(tenant_id)",
        "AND resultado = 'DENEGADO'",
      ),
    sonda: SONDAS.auditoriaDeGrupoDistingue,
  },
  {
    nombre: "la hora de corte admite las 24:00",
    romper: (sql) =>
      cambiar(
        sql,
        "CHECK (hora_de_corte < time '24:00' AND extract(second FROM hora_de_corte) = 0)",
        "CHECK (extract(second FROM hora_de_corte) = 0)",
      ),
    sonda: SONDAS.horaDeCorteSinVeinticuatro,
  },
  {
    nombre: "la hora de corte admite segundos",
    romper: (sql) =>
      cambiar(
        sql,
        "CHECK (hora_de_corte < time '24:00' AND extract(second FROM hora_de_corte) = 0)",
        "CHECK (hora_de_corte < time '24:00')",
      ),
    sonda: SONDAS.horaDeCorteSinVeinticuatro,
  },
  {
    nombre: "quitar referencia_de_error_referencia_uk",
    romper: (sql) =>
      quitar(
        sql,
        "ALTER TABLE referencia_de_error\n  ADD CONSTRAINT referencia_de_error_referencia_uk",
      ),
    sonda: SONDAS.referenciaUnica,
  },
  // --- las funciones de validación
  {
    nombre: "tema_valido deja pasar cualquier color",
    romper: (sql) => cambiar(sql, "OR (e.valor #>> '{}') !~ '^#[0-9a-f]{6}$'", "OR false"),
    sonda: SONDAS.temaCerrado,
  },
  {
    nombre: "texto_visible_valido deja pasar «<» y «>»",
    romper: (sql) => cambiar(sql, "'[\\x01-\\x1f\\x7f-\\x9f<>'", "'[\\x01-\\x1f\\x7f-\\x9f'"),
    sonda: SONDAS.textoVisibleSinMarcado,
  },
  {
    nombre: "texto_visible_valido deja pasar el ancho cero",
    romper: (sql) => cambiar(sql, "\\u200b-\\u200f", "\\u200c-\\u200f"),
    sonda: SONDAS.textoVisibleSinMarcado,
  },
  {
    nombre: "vocabulario_valido acepta claves en mayúsculas",
    romper: (sql) =>
      cambiar(
        sql,
        "e.texto !~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+){1,5}$'",
        "e.texto !~ '^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+){1,5}$'",
      ),
    sonda: SONDAS.vocabularioEnMinusculas,
  },
  {
    nombre: "perillas_validas trata un campo que falta como válido (NULL)",
    romper: (sql) =>
      cambiar(
        sql,
        "END,\n                 false\n               )",
        "END,\n                 true\n               )",
      ),
    sonda: SONDAS.perillasSinNulos,
  },
];

describe.skipIf(base === null)("marcas y planes: los debilitamientos de la migración 0007", () => {
  beforeAll(async () => {
    if (base === null) return;
    const b = base;
    plantilla = await baseConMigraciones(b, HASTA_0006);
    // la plantilla no puede tener conexiones abiertas para copiarse
    await plantilla.cliente.end();
    plantillaNombre = new URL(plantilla.aparte.base.dueno).pathname.slice(1);
    admin = new pg.Client({ connectionString: b.admin });
    await admin.connect();
    sqlReal = await readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO_0007), "utf8");
  });
  afterAll(async () => {
    await admin?.end();
    await rm(plantilla?.carpeta ?? "", { recursive: true, force: true });
    await plantilla?.aparte.destruir();
  });

  it("control: sobre la migración sin romper TODAS las sondas se cumplen", async () => {
    const sondas = new Map<string, Sonda>();
    for (const d of DEBILITAMIENTOS) sondas.set(d.nombre, d.sonda);
    await conMigracion(sqlReal, async (ctx) => {
      const fallan: string[] = [];
      for (const [nombre, sonda] of sondas) {
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
      const cumple = await conMigracion(rota, async (ctx) => {
        try {
          return await d.sonda(ctx);
        } catch {
          // una sonda que revienta sobre la base rota también delata el cambio (la sana no revienta: ver el control)
          return false;
        }
      });
      expect(cumple, "la sonda tiene que dejar de cumplirse").toBe(false);
    },
  );
});
