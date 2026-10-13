import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { instalarClaveDeContexto } from "../../src/adaptadores/postgres/contexto-firmado";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { ADMIN_DE_PRUEBA, sembrarAdminsDePrueba } from "./admins-de-prueba";
import { cuitAlAzar, crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la migración 0007 (marcas y planes). Todo se arma con el cliente del DUEÑO de la
 * base (evade RLS): sirve para dejar listo el escenario; lo que se prueba después se hace con los roles
 * limitados y su contexto firmado (`SesionDePrueba`) o, para lo que la base impone aun al dueño, con el
 * mismo cliente del dueño. Respeta los disparadores: las versiones nacen en borrador y se publican o
 * confirman con su número, como lo hará el caso de uso.
 */

export const CARPETA_DE_MIGRACIONES = join(import.meta.dirname, "../../migraciones");

/** Las migraciones anteriores a 0007, en orden. */
export const HASTA_0006 = [
  "0001_base.sql",
  "0002_identidad.sql",
  "0003_trabajos.sql",
  "0004_plataforma.sql",
  "0005_administracion.sql",
  "0006_fiscal.sql",
] as const;
export const ARCHIVO_0007 = "0007_marcas_y_planes.sql";

/** El actor firmado de las pruebas, tal como lo guardan `registrado_por`, `asignado_por` y compañía. */
export const ACTOR_DE_PRUEBA: string = ADMIN_DE_PRUEBA;

const un = async <T extends Record<string, unknown>>(
  c: pg.Client,
  texto: string,
  parametros: unknown[] = [],
): Promise<T> => (await c.query<T>(texto, parametros)).rows[0] as T;

/** Un nombre de host válido y único. */
export const hostAlAzar = (): string =>
  `h${randomUUID().replaceAll("-", "").slice(0, 12)}.prueba.test`;
/** Un código de marca o de plan válido y único. */
export const codigoAlAzar = (prefijo = "m"): string => `${prefijo}-${randomUUID().slice(0, 8)}`;

export async function marcaPrincipal(c: pg.Client): Promise<string> {
  return (await un<{ id: string }>(c, "select id from marca where es_principal")).id;
}

export async function crearMarca(
  c: pg.Client,
  opciones: { codigo?: string; padre?: string | null } = {},
): Promise<string> {
  return (
    await un<{ id: string }>(
      c,
      "insert into marca (codigo, marca_padre_id) values ($1, $2) returning id",
      [opciones.codigo ?? codigoAlAzar(), opciones.padre ?? null],
    )
  ).id;
}

type EstadoDeDominio = "PENDIENTE_VERIFICACION" | "VERIFICADO" | "ACTIVO" | "RETIRADO";
type SuperficieDeDominio = "APP" | "CARTA" | "LANDING" | "CONSOLA";

/** Lleva un dominio recién registrado hasta `estado` por el camino legal (verificar, activar o retirar). */
async function llevarDominioA(
  c: pg.Client,
  id: string,
  estado: EstadoDeDominio,
  motivo = "baja de prueba",
): Promise<void> {
  if (estado === "PENDIENTE_VERIFICACION") return;
  if (estado === "RETIRADO") {
    await c.query("update dominio set estado = 'RETIRADO', motivo = $2 where id = $1", [
      id,
      motivo,
    ]);
    return;
  }
  await c.query("update dominio set estado = 'VERIFICADO', verificado_en = now() where id = $1", [
    id,
  ]);
  if (estado === "ACTIVO")
    await c.query("update dominio set estado = 'ACTIVO' where id = $1", [id]);
}

export type OpcionesDeDominio = Readonly<{
  host?: string;
  canonico?: boolean;
  superficie?: SuperficieDeDominio;
  titular?: "CLIENTE" | "OPERADOR";
  /** El estado final (por defecto ACTIVO: el dominio ya sirve). */
  estado?: EstadoDeDominio;
  registradoPor?: string;
}>;

/** Un dominio de una MARCA (host compartido), llevado hasta el estado pedido. */
export async function crearDominio(
  c: pg.Client,
  marca: string,
  opciones: OpcionesDeDominio = {},
): Promise<{ id: string; host: string }> {
  const host = opciones.host ?? hostAlAzar();
  const fila = await un<{ id: string }>(
    c,
    `insert into dominio (host, superficie, duenio_marca_id, titular, es_canonico, registrado_por)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      host,
      opciones.superficie ?? "APP",
      marca,
      opciones.titular ?? "OPERADOR",
      opciones.canonico ?? false,
      opciones.registradoPor ?? ACTOR_DE_PRUEBA,
    ],
  );
  await llevarDominioA(c, fila.id, opciones.estado ?? "ACTIVO");
  return { id: fila.id, host };
}

/** Un dominio de una EMPRESA (host dedicado): la marca de entrada sale del tenant de la empresa. */
export async function crearDominioDeEmpresa(
  c: pg.Client,
  empresa: string,
  opciones: OpcionesDeDominio = {},
): Promise<{ id: string; host: string }> {
  const host = opciones.host ?? hostAlAzar();
  const fila = await un<{ id: string }>(
    c,
    `insert into dominio (host, superficie, duenio_empresa_id, titular, registrado_por)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      host,
      opciones.superficie ?? "CARTA",
      empresa,
      opciones.titular ?? "CLIENTE",
      opciones.registradoPor ?? ACTOR_DE_PRUEBA,
    ],
  );
  await llevarDominioA(c, fila.id, opciones.estado ?? "ACTIVO");
  return { id: fila.id, host };
}

export type DatosDeVersionDeMarca = Partial<
  Readonly<{
    nombreVisible: string | null;
    tema: Record<string, string>;
    logo: string | null;
    vocabulario: Record<string, string>;
    modulosIniciales: string[] | null;
    planPorDefecto: string | null;
  }>
>;

/** Un borrador de marca con esos datos (los que no se dan quedan vacíos = heredan). */
export async function crearBorradorDeMarca(
  c: pg.Client,
  marca: string,
  datos: DatosDeVersionDeMarca = {},
): Promise<string> {
  return (
    await un<{ id: string }>(
      c,
      `insert into version_de_marca (marca_id, nombre_visible, tema, logo, vocabulario, modulos_iniciales, plan_por_defecto_id)
       values ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7) returning id`,
      [
        marca,
        datos.nombreVisible ?? null,
        JSON.stringify(datos.tema ?? {}),
        datos.logo ?? null,
        JSON.stringify(datos.vocabulario ?? {}),
        datos.modulosIniciales ?? null,
        datos.planPorDefecto ?? null,
      ],
    )
  ).id;
}

/**
 * Confirma un borrador con el número siguiente de la marca. `desdeSegundos` es la vigencia respecto de
 * ahora (por defecto, hace 30 segundos: ya vigente y dentro de la tolerancia de reloj).
 */
export async function confirmarVersionDeMarca(
  c: pg.Client,
  borrador: string,
  opciones: { desdeSegundos?: number; motivo?: string; por?: string } = {},
): Promise<number> {
  const fila = await un<{ numero: number }>(
    c,
    `update version_de_marca v
        set estado = 'CONFIRMADA',
            numero = (select coalesce(max(o.numero), 0) + 1 from version_de_marca o where o.marca_id = v.marca_id),
            vigente_desde = now() + make_interval(secs => $2::int),
            motivo = $3, confirmada_en = now(), confirmada_por = $4
      where v.id = $1 returning numero`,
    [
      borrador,
      opciones.desdeSegundos ?? -30,
      opciones.motivo ?? "prueba",
      opciones.por ?? ACTOR_DE_PRUEBA,
    ],
  );
  return fila.numero;
}

/** Una versión de marca confirmada de una vez. */
export async function crearVersionDeMarcaConfirmada(
  c: pg.Client,
  marca: string,
  datos: DatosDeVersionDeMarca & { desdeSegundos?: number } = {},
): Promise<{ id: string; numero: number }> {
  const id = await crearBorradorDeMarca(c, marca, datos);
  const numero = await confirmarVersionDeMarca(
    c,
    id,
    datos.desdeSegundos === undefined ? {} : { desdeSegundos: datos.desdeSegundos },
  );
  return { id, numero };
}

export async function crearPlan(c: pg.Client, codigo: string = codigoAlAzar("p")): Promise<string> {
  return (
    await un<{ id: string }>(c, "insert into plan (codigo) values ($1) returning id", [codigo])
  ).id;
}

export type DatosDeVersionDePlan = Partial<
  Readonly<{
    nombreComercial: string;
    modulos: string[];
    perillas: Record<string, unknown>;
  }>
>;

export async function crearBorradorDePlan(
  c: pg.Client,
  plan: string,
  datos: DatosDeVersionDePlan = {},
): Promise<string> {
  return (
    await un<{ id: string }>(
      c,
      `insert into version_de_plan (plan_id, nombre_comercial, modulos, perillas)
       values ($1, $2, $3, $4::jsonb) returning id`,
      [
        plan,
        datos.nombreComercial ?? "Plan de prueba",
        datos.modulos ?? [],
        JSON.stringify(datos.perillas ?? {}),
      ],
    )
  ).id;
}

/** Publica un borrador con el número siguiente del plan. */
export async function publicarVersionDePlan(
  c: pg.Client,
  borrador: string,
  opciones: { motivo?: string; por?: string } = {},
): Promise<number> {
  const fila = await un<{ numero: number }>(
    c,
    `update version_de_plan v
        set estado = 'PUBLICADA',
            numero = (select coalesce(max(o.numero), 0) + 1 from version_de_plan o where o.plan_id = v.plan_id),
            motivo = $2, publicada_en = now(), publicada_por = $3
      where v.id = $1 returning numero`,
    [borrador, opciones.motivo ?? "prueba", opciones.por ?? ACTOR_DE_PRUEBA],
  );
  return fila.numero;
}

/** Un plan nuevo con su primera versión publicada. */
export async function crearPlanPublicado(
  c: pg.Client,
  datos: DatosDeVersionDePlan & { codigo?: string } = {},
): Promise<{ plan: string; version: string; numero: number }> {
  const plan = await crearPlan(c, datos.codigo);
  const version = await crearBorradorDePlan(c, plan, datos);
  const numero = await publicarVersionDePlan(c, version);
  return { plan, version, numero };
}

/** Asigna una versión publicada a un tenant con el número siguiente (vigente desde hace 30 s por defecto). */
export async function asignarPlan(
  c: pg.Client,
  tenant: string,
  version: string,
  opciones: { desdeSegundos?: number; origen?: string; motivo?: string; por?: string } = {},
): Promise<number> {
  const fila = await un<{ numero: number }>(
    c,
    `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
     select $1::uuid, coalesce(max(numero), 0) + 1, $2::uuid, now() + make_interval(secs => $3::int), $4::text, $5::text, $6::text
       from plan_de_tenant where tenant_id = $1::uuid
     returning numero`,
    [
      tenant,
      version,
      opciones.desdeSegundos ?? -30,
      opciones.origen ?? "CAMBIO",
      opciones.motivo ?? "prueba",
      opciones.por ?? ACTOR_DE_PRUEBA,
    ],
  );
  return fila.numero;
}

/** Un ajuste con el número siguiente de (tenant, empresa, perilla). */
export async function ajustarPerilla(
  c: pg.Client,
  tenant: string,
  perilla: string,
  valor: string,
  opciones: { empresa?: string | null; desdeSegundos?: number; por?: string } = {},
): Promise<number> {
  const empresa = opciones.empresa ?? null;
  const fila = await un<{ numero: number }>(
    c,
    `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
     select $1::uuid, $2::uuid, $3::text, coalesce(max(numero), 0) + 1, $4::text, now() + make_interval(secs => $5::int), 'prueba', $6::text
       from ajuste_de_perilla where tenant_id = $1::uuid and empresa_id is not distinct from $2::uuid and perilla = $3::text
     returning numero`,
    [
      tenant,
      empresa,
      perilla,
      valor,
      opciones.desdeSegundos ?? -30,
      opciones.por ?? ACTOR_DE_PRUEBA,
    ],
  );
  return fila.numero;
}

async function activarModulo(c: pg.Client, empresa: string, modulo: string): Promise<void> {
  await c.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
    empresa,
    modulo,
  ]);
}

/** Una empresa con su tenant (de esa marca; por defecto, la principal), una sucursal y una persona. */
export type MundoDeMarca = Readonly<{
  marca: string;
  tenant: string;
  empresa: string;
  sucursal: string;
  persona: string;
}>;

export async function crearMundoDeMarca(
  c: pg.Client,
  opciones: {
    marca?: string;
    tenant?: string;
    estado?: "ACTIVE" | "PROVISIONING" | "SUSPENDED";
  } = {},
): Promise<MundoDeMarca> {
  const marca = opciones.marca ?? (await marcaPrincipal(c));
  const tenant =
    opciones.tenant ??
    (
      await un<{ id: string }>(
        c,
        "insert into tenant (nombre, marca_id) values ($1, $2) returning id",
        [`tenant-${randomUUID().slice(0, 8)}`, marca],
      )
    ).id;
  const estado = opciones.estado ?? "ACTIVE";
  const empresa = (
    await un<{ id: string }>(
      c,
      `insert into empresa (tenant_id, cuit, razon_social, estado, motivo_estado)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        tenant,
        cuitAlAzar(),
        `empresa-${randomUUID().slice(0, 8)}`,
        estado,
        estado === "SUSPENDED" ? "prueba" : null,
      ],
    )
  ).id;
  const sucursal = (
    await un<{ id: string }>(
      c,
      "insert into sucursal (empresa_id, nombre) values ($1, 'Casa central') returning id",
      [empresa],
    )
  ).id;
  const persona = (
    await un<{ id: string }>(c, "insert into persona (email) values ($1) returning id", [
      `${randomUUID().slice(0, 12)}@prueba.test`,
    ])
  ).id;
  return { marca, tenant, empresa, sucursal, persona };
}

/**
 * Una fila en cada tabla nueva que la plataforma lee (marcas, dominios, versiones, planes, asignación,
 * ajuste y módulo), para que «0 filas» no se cumpla por vacío en las pruebas genéricas de lectura.
 */
export async function sembrarMarcasYPlanes(
  c: pg.Client,
  e: Readonly<{ tenant: string; empresa: string }>,
): Promise<void> {
  const principal = await marcaPrincipal(c);
  await crearDominio(c, principal, { canonico: true });
  await crearDominioDeEmpresa(c, e.empresa);
  await crearVersionDeMarcaConfirmada(c, principal, { nombreVisible: "Marca de prueba" });
  const { version } = await crearPlanPublicado(c, { modulos: [] });
  await asignarPlan(c, e.tenant, version, { origen: "ALTA" });
  await ajustarPerilla(c, e.tenant, "empresas_por_tenant", "2");
  await activarModulo(c, e.empresa, "modulo_de_prueba");
}

/** Los archivos de migración dados, copiados a una carpeta temporal. */
export async function carpetaCon(archivos: readonly string[]): Promise<string> {
  const carpeta = await mkdtemp(join(tmpdir(), "zuluhub-mig-0007-"));
  for (const archivo of archivos) {
    await copyFile(join(CARPETA_DE_MIGRACIONES, archivo), join(carpeta, archivo));
  }
  return carpeta;
}

/**
 * Una base aparte con esas migraciones aplicadas, la clave de contexto y los administradores de prueba
 * (si ya está 0004), SIN la marca de prueba: queda como la dejan las migraciones.
 */
export async function baseConMigraciones(base: BaseDePruebas, archivos: readonly string[]) {
  const aparte = await crearBaseAparte(base, { migrar: false });
  const carpeta = await carpetaCon(archivos);
  await aplicarMigraciones(aparte.base.dueno, carpeta);
  await instalarClaveDeContexto(aparte.base.dueno, base.clave);
  if (archivos.includes("0004_plataforma.sql")) await sembrarAdminsDePrueba(aparte.base.dueno);
  const cliente = new pg.Client({ connectionString: aparte.base.dueno });
  await cliente.connect();
  return {
    aparte,
    cliente,
    carpeta,
    cerrar: async () => {
      await cliente.end().catch(() => undefined);
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    },
  };
}

/**
 * Todo lo que el catálogo declara del esquema `public`: columnas, restricciones (sin los NOT NULL de
 * Postgres 18), índices, disparadores, políticas, funciones, privilegios y roles. Dos bases con la misma
 * huella tienen el mismo esquema.
 */
export async function huellaDeCatalogo(c: pg.Client): Promise<Record<string, string[]>> {
  const lista = async (texto: string) =>
    (await c.query<{ x: string }>(texto)).rows.map((f) => f.x).sort();
  return {
    columnas: await lista(
      `select format('%s.%s:%s:%s:%s:%s', table_name, column_name, ordinal_position, data_type, is_nullable,
                     coalesce(column_default, '')) as x
       from information_schema.columns where table_schema = 'public'`,
    ),
    restricciones: await lista(
      `select format('%s.%s:%s:%s', conrelid::regclass, conname, contype, pg_get_constraintdef(oid)) as x
       from pg_constraint where connamespace = 'public'::regnamespace and contype <> 'n'`,
    ),
    indices: await lista(`select indexdef as x from pg_indexes where schemaname = 'public'`),
    disparadores: await lista(
      `select pg_get_triggerdef(t.oid) as x from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and c.relnamespace = 'public'::regnamespace`,
    ),
    politicas: await lista(
      `select format('%s.%s:%s:%s:%s:%s:%s', tablename, policyname, permissive, array_to_string(roles, '+'), cmd,
                     coalesce(qual, ''), coalesce(with_check, '')) as x
       from pg_policies where schemaname = 'public'`,
    ),
    funciones: await lista(
      `select format('%s(%s):%s:%s:%s:%s:%s', proname, pg_get_function_identity_arguments(oid), prosecdef,
                     provolatile, coalesce(array_to_string(proconfig, ','), ''), md5(prosrc), coalesce(proacl::text, ''))
              as x
       from pg_proc where pronamespace = 'public'::regnamespace`,
    ),
    esquema: await lista(
      `select coalesce(nspacl::text, '') as x from pg_namespace where nspname = 'public'`,
    ),
    tablas: await lista(
      `select format('%s:%s:%s:%s:%s', relname, relkind, relrowsecurity, relforcerowsecurity, coalesce(relacl::text, ''))
              as x
       from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'S')`,
    ),
    privilegiosPorColumna: await lista(
      `select format('%s.%s:%s', c.relname, a.attname, a.attacl::text) as x
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and a.attacl is not null and not a.attisdropped`,
    ),
  };
}
