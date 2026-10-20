import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  adminPlataformaId,
  empresaId,
  personaId,
} from "../../src/primitivas/identificadores/marca";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import {
  HASTA_0007,
  archivoDeCaptacion,
  crearSolicitud,
  firmarCargaDeCaptacion,
  sesionDeCaptacion,
  type ClaimDeCaptacion,
} from "./captacion-apoyo";
import { AHORA_DE_PRUEBA, comoEmpresa, comoPlataforma } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  crearMundoDeMarca,
  marcaPrincipal,
} from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * Alta por solicitud (L1): los DEBILITAMIENTOS propios del SQL, y los que pide la especificación (§8). Cada caso rompe
 * a propósito la migración de captación de una forma razonable (quitar el índice único, el disparador de las
 * transiciones, una condición de una política, el FORCE de RLS, un privilegio, una CHECK...) en una base
 * descartable, y comprueba que una sonda —la misma que pasa sobre la base real— deja de cumplirse. Una sonda que
 * sigue pasando con la migración rota es una prueba que no muerde.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Ctx = Readonly<{ base: BaseDePruebas; dueno: pg.Client }>;
/** `true` cuando la base cumple lo que la sonda protege. */
type Sonda = (ctx: Ctx) => Promise<boolean>;

const ADMIN = ADMIN_DE_PRUEBA as string;
const SOPORTE = SOPORTE_DE_PRUEBA as string;
const T = AHORA_DE_PRUEBA;

// ---- transformaciones del texto de la migración ---------------------------------------------------------

/** Reemplaza `de` por `a` exigiendo que `de` esté exactamente una vez: un debilitamiento que no cambia nada no prueba nada. */
function cambiar(sql: string, de: string, a: string): string {
  const veces = sql.split(de).length - 1;
  if (veces !== 1) {
    throw new Error(`el texto aparece ${veces} veces (tenía que ser 1): ${de.slice(0, 80)}`);
  }
  return sql.replace(de, () => a);
}
/** Quita una sentencia entera que empieza con ese texto (hasta su `;`). */
function quitar(sql: string, comienzo: string): string {
  const i = sql.indexOf(comienzo);
  if (i < 0 || sql.indexOf(comienzo, i + 1) >= 0) {
    throw new Error(`la sentencia no está o está repetida: ${comienzo}`);
  }
  return sql.slice(0, i) + sql.slice(sql.indexOf(";", i) + 1);
}
/** Reemplaza una política entera (`CREATE POLICY <nombre> ON … ;`) por otra definición. */
function cambiarPolitica(sql: string, nombre: string, nueva: string): string {
  const comienzo = `CREATE POLICY ${nombre} ON `;
  const i = sql.indexOf(comienzo);
  if (i < 0 || sql.indexOf(comienzo, i + 1) >= 0) {
    throw new Error(`la política no está o está repetida: ${nombre}`);
  }
  return sql.slice(0, i) + nueva + sql.slice(sql.indexOf(";", i) + 1);
}

// ---- las bases ------------------------------------------------------------------------------------------

let plantilla: Awaited<ReturnType<typeof baseConMigraciones>>;
let plantillaNombre = "";
let admin: pg.Client;
let sqlReal = "";

const conBase = (url: string, nombre: string): string => {
  const u = new URL(url);
  u.pathname = `/${nombre}`;
  return u.toString();
};

/** Una copia de la plantilla (0001 a 0007) con ese texto de la migración de captación aplicado; se destruye al terminar. */
async function conMigracion<T2>(sql: string, trabajo: (ctx: Ctx) => Promise<T2>): Promise<T2> {
  const b = base as BaseDePruebas;
  const nombre = `pedernal_deb_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE ${nombre} TEMPLATE ${plantillaNombre}`);
  const carpeta = await carpetaCon([...HASTA_0007]);
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
    await writeFile(join(carpeta, await archivoDeCaptacion()), sql);
    await aplicarMigraciones(copia.dueno, carpeta);
    await dueno.connect();
    return await trabajo({ base: copia, dueno });
  } finally {
    await dueno.end().catch(() => undefined);
    await rm(carpeta, { recursive: true, force: true });
    await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
  }
}

// ---- sondas ---------------------------------------------------------------------------------------------

/** Una sentencia del dueño (sin transacción abierta): `true` si la base la rechaza. */
const seRechaza = async (
  c: pg.Client,
  texto: string,
  parametros: unknown[] = [],
): Promise<boolean> =>
  c.query(texto, parametros).then(
    () => false,
    () => true,
  );

async function conLanding<R>(
  ctx: Ctx,
  claim: ClaimDeCaptacion | null,
  trabajo: (s: SesionDePrueba) => Promise<R>,
): Promise<R> {
  const s = await sesionDeCaptacion(ctx.base, claim);
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}
async function conActor<R>(
  ctx: Ctx,
  actor: "ADMIN" | "SOPORTE" | "SISTEMA",
  trabajo: (s: SesionDePrueba) => Promise<R>,
): Promise<R> {
  const s = await SesionDePrueba.abrir(
    ctx.base,
    "pedernal_plataforma",
    comoPlataforma(
      actor === "SISTEMA"
        ? { tipo: "SISTEMA", proceso: "barrido-de-solicitudes" }
        : { tipo: "ADMIN", id: adminPlataformaId(actor === "ADMIN" ? ADMIN : SOPORTE) },
    ),
  );
  try {
    return await trabajo(s);
  } finally {
    await s.cerrar();
  }
}
const rechazada = (r: Awaited<ReturnType<SesionDePrueba["intentar"]>>, codigo?: string) =>
  !r.ok && (codigo === undefined || r.codigo === codigo);
const sinFilas = (r: Awaited<ReturnType<SesionDePrueba["intentar"]>>) => r.ok && r.filas === 0;

const ENCOLAR =
  "insert into trabajo (empresa_id, tipo, datos, clave_idempotencia) values ($1, $2, $3::jsonb, $4) on conflict do nothing";
const ANONIMIZAR = `anonimizada_en = $2::timestamptz, email = null, nombre_contacto = null, nombre_negocio = null,
  telefono = null, cuit = null, id_de_medicion = null, nota_interna = null, atribucion = atribucion - 'fbclid'`;

const SONDAS = {
  unaSolaAbiertaPorCorreo: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    const a = await crearSolicitud(dueno, { marca });
    return seRechaza(
      dueno,
      `insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro, version_de_terminos,
         version_de_privacidad, ultimo_envio_en, creada_en)
       values ($1, $2, 'Ana', 'Café', 'bar', '2026-10-13', '2026-10-13.1', $3, $3)`,
      [marca, a.email, T],
    );
  },
  unaTerminalNoVuelve: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    const c = await crearSolicitud(dueno, { marca, estado: "SPAM" });
    return seRechaza(
      dueno,
      "update solicitud_de_alta set estado = 'NUEVA', decidida_por = null, decidida_en = null where id = $1",
      [c.id],
    );
  },
  landingVeSoloLaSuya: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) => {
      const r = await s.intentar("select id from solicitud_de_alta");
      return r.ok && r.rows.length === 1 && r.rows[0]?.["id"] === a.id;
    });
  },
  landingNoSaltaDeEstado: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar("update solicitud_de_alta set estado = 'SPAM' where id = $1", [a.id]),
        "42501",
      ),
    );
  },
  landingSoloActuaSobreNuevas: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const v = await crearSolicitud(ctx.dueno, { marca, estado: "VERIFICADA" });
    return conLanding(ctx, { s: v.id }, async (s) =>
      sinFilas(
        await s.intentar(
          "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = $2 where id = $1",
          [v.id, new Date(T.getTime() + 300_000)],
        ),
      ),
    );
  },
  laAplicacionNoLeeSolicitudes: async (ctx: Ctx) => {
    // el rol de la aplicación, con su contexto normal de empresa
    const mundo = await crearMundoDeMarca(ctx.dueno, {});
    const s = await SesionDePrueba.abrir(
      ctx.base,
      "pedernal_app",
      comoEmpresa(empresaId(mundo.empresa), personaId(mundo.persona)),
    );
    try {
      return rechazada(await s.intentar("select 1 from solicitud_de_alta"), "42501");
    } finally {
      await s.cerrar();
    }
  },
  laLandingNoLeeElNombre: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(await s.intentar("select nombre_contacto from solicitud_de_alta"), "42501"),
    );
  },
  laLandingNoTocaLaDecision: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar("update solicitud_de_alta set decidida_por = 'sistema' where id = $1", [
          a.id,
        ]),
        "42501",
      ),
    );
  },
  unAdminDecideConSuId: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const v = await crearSolicitud(ctx.dueno, { marca, estado: "VERIFICADA" });
    return conActor(ctx, "ADMIN", async (s) =>
      rechazada(
        await s.intentar(
          "update solicitud_de_alta set estado = 'APROBADA', decidida_por = $2, decidida_en = $3 where id = $1",
          [v.id, SOPORTE, T],
        ),
        "42501",
      ),
    );
  },
  elSistemaNoAprueba: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const v = await crearSolicitud(ctx.dueno, { marca, estado: "VERIFICADA" });
    return conActor(ctx, "SISTEMA", async (s) =>
      rechazada(
        await s.intentar(
          "update solicitud_de_alta set estado = 'APROBADA', decidida_por = 'sistema', decidida_en = $2 where id = $1",
          [v.id, T],
        ),
        "42501",
      ),
    );
  },
  soporteNoDecide: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const v = await crearSolicitud(ctx.dueno, { marca, estado: "VERIFICADA" });
    return conActor(ctx, "SOPORTE", async (s) =>
      sinFilas(
        await s.intentar(
          "update solicitud_de_alta set estado = 'APROBADA', decidida_por = $2, decidida_en = $3 where id = $1",
          [v.id, SOPORTE, T],
        ),
      ),
    );
  },
  sinConsentimientoNoHayFbclid: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    const a = await crearSolicitud(dueno, { marca });
    return seRechaza(
      dueno,
      "insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro, atribucion, version_de_terminos, version_de_privacidad, ultimo_envio_en, creada_en) values ($1, $2, 'Ana', 'Café', 'bar', '{\"fbclid\":\"abc\"}'::jsonb, '2026-10-13', '2026-10-13.1', $3, $3)",
      [marca, `otro-${a.email}`, T],
    );
  },
  anonimizarTambienElTelefono: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    const c = await crearSolicitud(dueno, { marca, estado: "SPAM" });
    return seRechaza(
      dueno,
      `update solicitud_de_alta set ${ANONIMIZAR.replace("telefono = null,", "")} where id = $1`,
      [c.id, T],
    );
  },
  laAuditoriaNoLlevaElCorreo: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(
          `insert into auditoria_plataforma (actor, accion, entidad, entidad_id, despues)
           values ('captacion', 'SOLICITUD_RECIBIDA', 'solicitud_de_alta', $1, $2::jsonb)`,
          [a.id, JSON.stringify({ email: "ana@x.com" })],
        ),
        "42501",
      ),
    );
  },
  laAuditoriaNoLlevaTextoLibre: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(
          `insert into auditoria_plataforma (actor, accion, entidad, entidad_id, despues)
           values ('captacion', 'SOLICITUD_RECIBIDA', 'solicitud_de_alta', $1, $2::jsonb)`,
          [a.id, JSON.stringify({ estado: "ana@x.com" })],
        ),
        "42501",
      ),
    );
  },
  laAuditoriaSigueAlEstado: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(
          `insert into auditoria_plataforma (actor, accion, entidad, entidad_id)
           values ('captacion', 'SOLICITUD_VERIFICADA', 'solicitud_de_alta', $1)`,
          [a.id],
        ),
        "42501",
      ),
    );
  },
  laAuditoriaNoSeRepite: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) => {
      const constancia = () =>
        s.intentar(
          `insert into auditoria_plataforma (actor, accion, entidad, entidad_id)
           values ('captacion', 'SOLICITUD_RECIBIDA', 'solicitud_de_alta', $1)`,
          [a.id],
        );
      const primera = await constancia();
      return primera.ok && rechazada(await constancia(), "23505");
    });
  },
  elNumeroDeEnvioTieneRango: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca, numeroDeEnvios: 2 });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(
          `insert into auditoria_plataforma (actor, accion, entidad, entidad_id, despues)
           values ('captacion', 'SOLICITUD_REENVIO', 'solicitud_de_alta', $1, '{"numeroDeEnvio": 9}'::jsonb)`,
          [a.id],
        ),
        "42501",
      ),
    );
  },
  losDatosDelTrabajoNoLlevanDatosPersonales: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(ENCOLAR, [
          null,
          "enviar_verificacion_de_solicitud",
          JSON.stringify({ solicitudId: a.id, email: a.email }),
          `solicitud:${a.id}:verificacion:1`,
        ]),
        "42501",
      ),
    );
  },
  elTrabajoEsDeAmbitoPlataforma: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    const mundo = await crearMundoDeMarca(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(ENCOLAR, [
          mundo.empresa,
          "enviar_verificacion_de_solicitud",
          JSON.stringify({ solicitudId: a.id }),
          `solicitud:${a.id}:verificacion:1`,
        ]),
        "42501",
      ),
    );
  },
  unCorreoPorEnvioContado: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(ENCOLAR, [
          null,
          "enviar_verificacion_de_solicitud",
          JSON.stringify({ solicitudId: a.id }),
          `solicitud:${a.id}:verificacion:2`,
        ]),
        "42501",
      ),
    );
  },
  avisoSoloDeVerificadas: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(ENCOLAR, [
          null,
          "avisar_solicitud_verificada",
          JSON.stringify({ solicitudId: a.id }),
          `solicitud:${a.id}:aviso`,
        ]),
        "42501",
      ),
    );
  },
  eventoSoloConConsentimiento: async (ctx: Ctx) => {
    const marca = await marcaPrincipal(ctx.dueno);
    const a = await crearSolicitud(ctx.dueno, { marca, medicionConsentida: false });
    return conLanding(ctx, { s: a.id }, async (s) =>
      rechazada(
        await s.intentar(ENCOLAR, [
          null,
          "evento_de_captacion",
          JSON.stringify({ solicitudId: a.id, evento: "solicitud_enviada" }),
          `solicitud:${a.id}:evento:solicitud_enviada`,
        ]),
        "42501",
      ),
    );
  },
  tope5Envios: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    const a = await crearSolicitud(dueno, { marca, numeroDeEnvios: 5 });
    return seRechaza(
      dueno,
      "update solicitud_de_alta set numero_de_envios = 6, ultimo_envio_en = $2 where id = $1",
      [a.id, new Date(T.getTime() + 600_000)],
    );
  },
  enviosSoloEnNuevas: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    const v = await crearSolicitud(dueno, { marca, estado: "VERIFICADA" });
    return seRechaza(
      dueno,
      "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = $2 where id = $1",
      [v.id, new Date(T.getTime() + 600_000)],
    );
  },
  losPersonalesNoCambian: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    const a = await crearSolicitud(dueno, { marca });
    return seRechaza(
      dueno,
      "update solicitud_de_alta set email = 'otro@prueba.test' where id = $1",
      [a.id],
    );
  },
  elContadorSoloSube: async (ctx: Ctx) =>
    conLanding(ctx, {}, async (s) => {
      const clave = `ip:${randomBytes(32).toString("hex")}`;
      await s.intentar(
        "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ($1, 'HORA', $2, 5)",
        [clave, T],
      );
      return rechazada(
        await s.intentar("update limite_de_captacion set cuenta = 1 where clave = $1", [clave]),
        "23514",
      );
    }),
  laPurgaNoBorraLoReciente: async (ctx: Ctx) => {
    const clave = `ip:${randomBytes(32).toString("hex")}`;
    await ctx.dueno.query(
      "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ($1, 'HORA', now(), 1)",
      [clave],
    );
    return conLanding(ctx, {}, async (s) =>
      sinFilas(await s.intentar("delete from limite_de_captacion where clave = $1", [clave])),
    );
  },
  unContextoQueNoEsUnObjetoNoVale: async (ctx: Ctx) => {
    const s = await SesionDePrueba.abrirConToken(
      ctx.base,
      "pedernal_captacion",
      firmarCargaDeCaptacion(ctx.base, { c: "x" }),
    );
    try {
      return rechazada(
        await s.intentar(
          "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ('global:solicitudes', 'HORA', $1, 1)",
          [T],
        ),
        "42501",
      );
    } finally {
      await s.cerrar();
    }
  },
  rlsForzada: async ({ dueno }: Ctx) => {
    const { rows } = await dueno.query<{ f: boolean }>(
      "select relforcerowsecurity as f from pg_class where relnamespace = 'public'::regnamespace and relname = 'solicitud_de_alta'",
    );
    return rows[0]?.f === true;
  },
  elCuitEsOpcional: async ({ dueno }: Ctx) => {
    const marca = await marcaPrincipal(dueno);
    return !(await seRechaza(
      dueno,
      `insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro, version_de_terminos,
         version_de_privacidad, ultimo_envio_en, creada_en)
       values ($1, $2, 'Ana', 'Café', 'bar', '2026-10-13', '2026-10-13.1', $3, $3)`,
      [marca, `sin-cuit-${randomBytes(4).toString("hex")}@prueba.test`, T],
    ));
  },
} satisfies Record<string, Sonda>;

// ---- los debilitamientos ---------------------------------------------------------------------------------------

type Debilitamiento = Readonly<{
  nombre: string;
  romper: (sql: string) => string;
  sonda: Sonda;
}>;

const DEBILITAMIENTOS: readonly Debilitamiento[] = [
  {
    nombre: "quitar solicitud_abierta_uk (la única parcial de las abiertas)",
    romper: (sql) => quitar(sql, "CREATE UNIQUE INDEX solicitud_abierta_uk"),
    sonda: SONDAS.unaSolaAbiertaPorCorreo,
  },
  {
    nombre: "quitar el disparador de las transiciones",
    romper: (sql) =>
      quitar(sql, "CREATE TRIGGER solicitud_cambio BEFORE UPDATE ON solicitud_de_alta"),
    sonda: SONDAS.unaTerminalNoVuelve,
  },
  {
    nombre: "USING (true) en solicitud_captacion_leer",
    romper: (sql) =>
      cambiarPolitica(
        sql,
        "solicitud_captacion_leer",
        "CREATE POLICY solicitud_captacion_leer ON solicitud_de_alta FOR SELECT TO pedernal_captacion USING (true);",
      ),
    sonda: SONDAS.landingVeSoloLaSuya,
  },
  {
    nombre: "el WITH CHECK de solicitud_captacion_verificar sin el estado",
    romper: (sql) =>
      cambiar(sql, "  WITH CHECK (estado IN ('NUEVA', 'VERIFICADA'));", "  WITH CHECK (true);"),
    sonda: SONDAS.landingNoSaltaDeEstado,
  },
  {
    nombre: "el USING de solicitud_captacion_verificar sin exigir NUEVA",
    romper: (sql) =>
      cambiar(
        sql,
        "  USING (\n    estado = 'NUEVA'\n    AND anonimizada_en IS NULL",
        "  USING (\n    anonimizada_en IS NULL",
      ),
    sonda: SONDAS.landingSoloActuaSobreNuevas,
  },
  {
    nombre: "dar SELECT de solicitud_de_alta a pedernal_app",
    romper: (sql) => `${sql}\nGRANT SELECT ON solicitud_de_alta TO pedernal_app;\n`,
    sonda: SONDAS.laAplicacionNoLeeSolicitudes,
  },
  {
    nombre: "dar SELECT del nombre del contacto a la landing",
    romper: (sql) =>
      `${sql}\nGRANT SELECT (nombre_contacto) ON solicitud_de_alta TO pedernal_captacion;\n`,
    sonda: SONDAS.laLandingNoLeeElNombre,
  },
  {
    nombre: "dar UPDATE de la decisión a la landing",
    romper: (sql) =>
      `${sql}\nGRANT UPDATE (decidida_por) ON solicitud_de_alta TO pedernal_captacion;\n`,
    sonda: SONDAS.laLandingNoTocaLaDecision,
  },
  {
    nombre: "quitar `decidida_por = actor` (nadie decide a nombre de otro)",
    romper: (sql) => cambiar(sql, "      AND decidida_por = (SELECT app_actor_plataforma())\n", ""),
    sonda: SONDAS.unAdminDecideConSuId,
  },
  {
    nombre: "dejar que `sistema` apruebe",
    romper: (sql) => cambiar(sql, "        OR anonimizada_en IS NOT NULL\n", "        OR true\n"),
    sonda: SONDAS.elSistemaNoAprueba,
  },
  {
    nombre: "quitar la restrictiva solicitud_plataforma_quien_cambia (SOPORTE decidiría)",
    romper: (sql) =>
      quitar(
        sql,
        "CREATE POLICY solicitud_plataforma_quien_cambia ON solicitud_de_alta AS RESTRICTIVE FOR UPDATE",
      ),
    sonda: SONDAS.soporteNoDecide,
  },
  {
    nombre: "quitar la regla del fbclid de solicitud_medicion_ck",
    romper: (sql) =>
      cambiar(
        sql,
        "AND (medicion_consentida OR (id_de_medicion IS NULL AND NOT (atribucion ? 'fbclid'))))",
        "AND true)",
      ),
    sonda: SONDAS.sinConsentimientoNoHayFbclid,
  },
  {
    nombre: "no anonimizar el teléfono (solicitud_personales_ck sin `telefono IS NULL`)",
    romper: (sql) =>
      cambiar(
        sql,
        "AND email IS NULL AND nombre_contacto IS NULL AND nombre_negocio IS NULL AND telefono IS NULL\n        AND cuit IS NULL",
        "AND email IS NULL AND nombre_contacto IS NULL AND nombre_negocio IS NULL\n        AND cuit IS NULL",
      ),
    sonda: SONDAS.anonimizarTambienElTelefono,
  },
  {
    nombre: "auditar el correo (la política sin revisar `despues`)",
    romper: (sql) => cambiar(sql, "    AND datos_de_auditoria_de_captacion_validos(despues)\n", ""),
    sonda: SONDAS.laAuditoriaNoLlevaElCorreo,
  },
  {
    nombre: "auditar texto libre (los valores de la lista blanca sin forma de identificador)",
    romper: (sql) => cambiar(sql, "~ '^[A-Za-z0-9._~:-]{1,200}$')", "~ '^.*$')"),
    sonda: SONDAS.laAuditoriaNoLlevaTextoLibre,
  },
  {
    nombre: "auditar una verificación que no ocurrió (la acción sin mirar el estado)",
    romper: (sql) =>
      cambiar(
        sql,
        "        AND (\n          (accion = 'SOLICITUD_RECIBIDA' AND s.estado = 'NUEVA')\n          OR (accion = 'SOLICITUD_REENVIO' AND s.estado = 'NUEVA' AND s.numero_de_envios > 1)\n          OR (accion = 'SOLICITUD_VERIFICADA' AND s.estado = 'VERIFICADA')\n        )\n",
        "",
      ),
    sonda: SONDAS.laAuditoriaSigueAlEstado,
  },
  {
    nombre: "repetir la constancia de la landing (sin el índice único de la auditoría)",
    romper: (sql) => quitar(sql, "CREATE UNIQUE INDEX auditoria_plataforma_captacion_uk"),
    sonda: SONDAS.laAuditoriaNoSeRepite,
  },
  {
    nombre: "un número de envío fuera del 1 al 5 en la constancia",
    romper: (sql) =>
      cambiar(
        sql,
        "       OR (e.key = 'numeroDeEnvio' AND NOT (jsonb_typeof(e.value) = 'number' AND (e.value #>> '{}') ~ '^[1-5]$'))\n",
        "",
      ),
    sonda: SONDAS.elNumeroDeEnvioTieneRango,
  },
  {
    nombre: "poner el correo en trabajo.datos (datos sin lista cerrada de claves)",
    romper: (sql) =>
      cambiar(
        sql,
        "    AND tipo = 'enviar_verificacion_de_solicitud'\n    AND jsonb_typeof(datos) = 'object'\n    AND datos - 'solicitudId' = '{}'::jsonb\n",
        "    AND tipo = 'enviar_verificacion_de_solicitud'\n",
      ),
    sonda: SONDAS.losDatosDelTrabajoNoLlevanDatosPersonales,
  },
  {
    nombre: "encolar un trabajo de una empresa (la política sin `empresa_id IS NULL`)",
    romper: (sql) =>
      cambiar(
        sql,
        "WITH CHECK (\n    empresa_id IS NULL\n    AND tipo = 'enviar_verificacion_de_solicitud'",
        "WITH CHECK (\n    tipo = 'enviar_verificacion_de_solicitud'",
      ),
    sonda: SONDAS.elTrabajoEsDeAmbitoPlataforma,
  },
  {
    nombre: "encolar más correos de verificación que envíos contados",
    romper: (sql) =>
      cambiar(
        sql,
        "        AND (regexp_match(clave_idempotencia, ':verificacion:([1-5])$'))[1]::int <= s.numero_de_envios\n",
        "",
      ),
    sonda: SONDAS.unCorreoPorEnvioContado,
  },
  {
    nombre: "avisar al dueño de una solicitud sin verificar",
    romper: (sql) =>
      cambiar(
        sql,
        "WHERE s.id::text = datos->>'solicitudId' AND s.estado = 'VERIFICADA'",
        "WHERE s.id::text = datos->>'solicitudId'",
      ),
    sonda: SONDAS.avisoSoloDeVerificadas,
  },
  {
    nombre: "mandar un evento a terceros sin consentimiento",
    romper: (sql) =>
      cambiar(
        sql,
        "WHERE s.id::text = datos->>'solicitudId' AND s.medicion_consentida",
        "WHERE s.id::text = datos->>'solicitudId'",
      ),
    sonda: SONDAS.eventoSoloConConsentimiento,
  },
  {
    nombre: "no recortar el tope de envíos (50 en lugar de 5)",
    romper: (sql) =>
      cambiar(
        sql,
        "CHECK (numero_de_envios BETWEEN 1 AND 5)",
        "CHECK (numero_de_envios BETWEEN 1 AND 50)",
      ),
    sonda: SONDAS.tope5Envios,
  },
  {
    nombre: "subir los envíos de una solicitud que ya no es NUEVA",
    romper: (sql) =>
      cambiar(
        sql,
        "IF OLD.estado <> 'NUEVA' OR NEW.estado <> 'NUEVA' OR NEW.numero_de_envios <> OLD.numero_de_envios + 1 THEN",
        "IF NEW.numero_de_envios <> OLD.numero_de_envios + 1 THEN",
      ),
    sonda: SONDAS.enviosSoloEnNuevas,
  },
  {
    nombre:
      "cambiar los datos personales sin anonimizar (quitar la rama de solicitud_personales_inmutables)",
    romper: (sql) =>
      cambiar(
        sql,
        "  ELSIF NEW.email IS DISTINCT FROM OLD.email\n     OR NEW.nombre_contacto IS DISTINCT FROM OLD.nombre_contacto\n     OR NEW.nombre_negocio IS DISTINCT FROM OLD.nombre_negocio\n     OR NEW.telefono IS DISTINCT FROM OLD.telefono\n     OR NEW.cuit IS DISTINCT FROM OLD.cuit\n     OR NEW.id_de_medicion IS DISTINCT FROM OLD.id_de_medicion\n     OR NEW.atribucion IS DISTINCT FROM OLD.atribucion THEN",
        "  ELSIF false THEN",
      ),
    sonda: SONDAS.losPersonalesNoCambian,
  },
  {
    nombre: "un contador que baja (sin el disparador limite_cuenta)",
    romper: (sql) =>
      quitar(sql, "CREATE TRIGGER limite_cuenta BEFORE UPDATE ON limite_de_captacion"),
    sonda: SONDAS.elContadorSoloSube,
  },
  {
    nombre: "purgar sin la política de los 8 días (la landing borraría un contador reciente)",
    romper: (sql) =>
      cambiar(
        sql,
        "USING ((SELECT app_captacion()) IS NOT NULL AND ventana_inicio < now() - interval '8 days')",
        "USING ((SELECT app_captacion()) IS NOT NULL)",
      ),
    sonda: SONDAS.laPurgaNoBorraLoReciente,
  },
  {
    nombre: "un claim `c` que no es un objeto cuenta como contexto",
    romper: (sql) => cambiar(sql, "  WHERE jsonb_typeof(x.c) = 'object'\n", ""),
    sonda: SONDAS.unContextoQueNoEsUnObjetoNoVale,
  },
  {
    nombre: "quitar FORCE ROW LEVEL SECURITY de la solicitud",
    romper: (sql) => quitar(sql, "ALTER TABLE solicitud_de_alta FORCE ROW LEVEL SECURITY"),
    sonda: SONDAS.rlsForzada,
  },
  {
    nombre: "CUIT obligatorio (el CHECK de la especificación, sin `cuit IS NULL OR`)",
    romper: (sql) =>
      cambiar(sql, "CHECK (cuit IS NULL OR cuit_valido(cuit))", "CHECK (cuit_valido(cuit))"),
    sonda: SONDAS.elCuitEsOpcional,
  },
];

describe.skipIf(base === null)("captación: los debilitamientos propios del SQL", () => {
  beforeAll(async () => {
    if (base === null) return;
    const b = base;
    plantilla = await baseConMigraciones(b, [...HASTA_0007]);
    // la plantilla no puede tener conexiones abiertas para copiarse
    await plantilla.cliente.end();
    plantillaNombre = new URL(plantilla.aparte.base.dueno).pathname.slice(1);
    admin = new pg.Client({ connectionString: b.admin });
    await admin.connect();
    sqlReal = await readFile(join(CARPETA_DE_MIGRACIONES, await archivoDeCaptacion()), "utf8");
  });
  afterAll(async () => {
    await admin?.end();
    await rm(plantilla?.carpeta ?? "", { recursive: true, force: true });
    await plantilla?.aparte.destruir();
  });

  it("control: sobre la migración sin romper TODAS las sondas se cumplen", async () => {
    await conMigracion(sqlReal, async (ctx) => {
      const fallan: string[] = [];
      for (const [nombre, sonda] of Object.entries(SONDAS)) {
        if (!(await sonda(ctx))) fallan.push(nombre);
      }
      expect(fallan, "sondas que no se cumplen ni sobre la migración sana").toEqual([]);
    });
  });

  it("cada sonda se usa en algún debilitamiento (no hay sondas de adorno)", () => {
    const usadas = new Set(DEBILITAMIENTOS.map((d) => d.sonda));
    const todas = Object.values(SONDAS) as Sonda[];
    expect(todas.filter((s) => !usadas.has(s))).toEqual([]);
  });

  it.each(DEBILITAMIENTOS.map((d) => [d.nombre, d] as const))(
    "%s: alguna sonda lo detecta",
    async (_nombre, d) => {
      const rota = d.romper(sqlReal);
      expect(rota, "el debilitamiento tiene que cambiar el texto").not.toBe(sqlReal);
      await conMigracion(rota, async (ctx) => {
        expect(await d.sonda(ctx), "la sonda sigue cumpliéndose con la migración rota").toBe(false);
      });
    },
  );
});
