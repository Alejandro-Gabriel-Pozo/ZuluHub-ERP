import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, comoPlataforma, crearBaseAparte, cuitAlAzar } from "./entorno";
import {
  conAppDe,
  conPlataformaDe,
  crearDomicilio,
  crearMundo,
  crearPuntoDeVenta,
  crearSerie,
  intentoDelDueno,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { SesionDePrueba, esperarBloqueo } from "./sesiones";

/**
 * H7 (fiscal base), tramo T3: los DEBILITAMIENTOS propios del SQL. Cada caso rompe a propósito la
 * migración 0006 de una forma razonable (quitar FORCE, una única sin empresa_id, un UPDATE de más, un
 * CHECK, un disparador, una política, un bloqueo...) en una base descartable, y comprueba que una
 * sonda —la misma que pasa sobre la base real— deja de cumplirse. Una sonda que sigue pasando con la
 * migración rota es una prueba que no muerde.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const TABLAS = [
  "emisor",
  "domicilio",
  "datos_fiscales",
  "regla_emisor",
  "punto_de_venta",
  "serie_comprobante",
  "provincia",
];

type Sonda = (b: BaseDePruebas) => Promise<boolean>;

async function conDueno<T>(b: BaseDePruebas, trabajo: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: b.dueno });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
}
/** Lo que haga `trabajo` se deshace. */
async function deshacible<T>(c: pg.Client, trabajo: () => Promise<T>): Promise<T> {
  await c.query("begin");
  try {
    return await trabajo();
  } finally {
    await c.query("rollback");
  }
}
const seRechaza = async (c: pg.Client, texto: string, parametros: unknown[] = []) =>
  !(await intentoDelDueno(c, texto, parametros)).ok;

/** Reemplaza un trozo del cuerpo de una función (la sobrescribe con CREATE OR REPLACE). */
async function reescribirFuncion(
  c: pg.Client,
  nombre: string,
  de: string,
  a: string,
): Promise<void> {
  const { rows } = await c.query<{ def: string }>(
    "select pg_get_functiondef(oid) as def from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace",
    [nombre],
  );
  const def = rows[0]?.def ?? "";
  if (!def.includes(de)) throw new Error(`la función ${nombre} no contiene «${de}»`);
  await c.query(def.replace(de, a));
}

// ---- las sondas: cada una devuelve true cuando la migración cumple lo que protege ----------------

const SONDAS = {
  /** RLS activa y forzada en todas las tablas fiscales. */
  rlsForzada: (b) =>
    conDueno(b, async (c) => {
      const { rows } = await c.query<{ ok: boolean }>(
        `select bool_and(relrowsecurity and relforcerowsecurity) as ok from pg_class
          where relnamespace = 'public'::regnamespace and relname = any ($1)`,
        [TABLAS],
      );
      return rows[0]?.ok === true;
    }),

  /**
   * La única única sin empresa_id es la excepción explícita emisor_cuit_uk. Como en el meta-test del
   * catálogo, no cuentan las claves cuyas columnas el cliente no elige (identidad o valor por defecto).
   */
  unicasGlobales: (b) =>
    conDueno(b, async (c) => {
      const { rows } = await c.query<{ indice: string }>(
        `select ic.relname as indice
           from pg_index i
           join pg_class c on c.oid = i.indrelid
           join pg_class ic on ic.oid = i.indexrelid
           join pg_attribute e on e.attrelid = c.oid and e.attname = 'empresa_id' and not e.attisdropped
          where c.relnamespace = 'public'::regnamespace and i.indisunique and not (e.attnum = any (i.indkey::int2[]))
            and c.relname = any ($1)
            and exists (
              select 1
                from unnest(i.indkey::int2[]) as k(attnum)
                join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
               where a.attidentity = ''
                 and not exists (select 1 from pg_attrdef d where d.adrelid = c.oid and d.adnum = a.attnum)
            )
          order by 1`,
        [TABLAS],
      );
      return rows.length === 1 && rows[0]?.indice === "emisor_cuit_uk";
    }),

  /** Nadie puede actualizar la identidad, los contadores ni lo que fija la base. */
  columnasIntocables: (b) =>
    conDueno(b, async (c) => {
      const { rows } = await c.query(
        `select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = any ($1) and privilege_type = 'UPDATE'
            and grantee in ('zuluhub_app', 'zuluhub_grupo', 'zuluhub_trabajos', 'zuluhub_plataforma', 'zuluhub_autenticacion', 'PUBLIC')
            and column_name in ('id', 'empresa_id', 'emisor_id', 'punto_de_venta_id', 'tipo_comprobante', 'es_principal',
                                'creado_en', 'creado_por', 'actualizado_en', 'version', 'verificacion_arca')`,
        [TABLAS],
      );
      return rows.length === 0;
    }),

  /** El número del domicilio es un entero de hasta seis dígitos o S/N. */
  domicilioRechazaNumeroInvalido: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      return deshacible(c, async () =>
        seRechaza(
          c,
          `insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, 'c', 'abc', 'l', 'AR-S')`,
          [m.empresa],
        ),
      );
    }),

  /** El último número de una serie nunca baja ni salta. */
  serieNoBajaNiSalta: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const pv = await crearPuntoDeVenta(c, m, { numero: 1 });
      await crearSerie(c, m.empresa, pv, m.emisor, "FACTURA_B", 5);
      return deshacible(c, async () => {
        const baja = await seRechaza(
          c,
          "update serie_comprobante set ultimo_numero = 3 where punto_de_venta_id = $1",
          [pv],
        );
        const salto = await seRechaza(
          c,
          "update serie_comprobante set ultimo_numero = 9 where punto_de_venta_id = $1",
          [pv],
        );
        return baja && salto;
      });
    }),

  /** El SOPORTE no crea emisores. */
  soporteNoCreaEmisor: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      return conPlataformaDe(b, "SOPORTE", async (s) => {
        const r = await s.intentar(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2)",
          [m.empresa, cuitAlAzar()],
        );
        return !r.ok;
      });
    }),

  /** Una empresa suspendida no da de alta puntos de venta. */
  empresaNoOperableNoEscribe: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      await c.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [m.empresa],
      );
      return conAppDe(b, m, async (s) => {
        const r = await s.intentar(
          "insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero) values ($1, $2, $3, 1)",
          [m.empresa, m.emisor, m.sucursal],
        );
        return !r.ok;
      });
    }),

  /** Una empresa nueva recibe su emisor principal. */
  empresaNuevaTienePrincipal: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c, { sinEmisor: true });
      const { rows } = await c.query<{ n: number }>(
        "select count(*)::int as n from emisor where empresa_id = $1 and es_principal",
        [m.empresa],
      );
      return rows[0]?.n === 1;
    }),

  /** El CUIT de un secundario no puede ser el de una empresa. */
  cuitSecundarioNoEsDeEmpresa: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      return deshacible(c, async () =>
        seRechaza(c, "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2)", [
          m.empresa,
          m.cuit,
        ]),
      );
    }),

  /** Un principal no tiene CUIT propio. */
  principalSinCuit: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      return deshacible(c, async () =>
        seRechaza(c, "update emisor set cuit = $2 where id = $1", [m.emisor, cuitAlAzar()]),
      );
    }),

  /** Unos datos fiscales confirmados no se modifican. */
  confirmadaInmutable: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const domicilio = await crearDomicilio(c, m.empresa);
      return deshacible(c, async () => {
        const { rows } = await c.query<{ id: string }>(
          `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                  inicio_actividades, creado_por) values ($1, $2, 'Mi SA', 'EXENTO', $3, '2020-01-01', $4) returning id`,
          [m.empresa, m.emisor, domicilio, m.persona],
        );
        const id = rows[0]?.id;
        await c.query(
          `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), confirmada_en = now(),
                  confirmada_por = $2, motivo = 'Alta' where id = $1`,
          [id, m.persona],
        );
        return seRechaza(c, "update datos_fiscales set razon_social = 'Otra' where id = $1", [id]);
      });
    }),

  /** Confirmar exige fecha de vigencia (un CHECK con NULL no la exigiría). */
  confirmarExigeVigencia: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const domicilio = await crearDomicilio(c, m.empresa);
      return deshacible(c, async () => {
        const { rows } = await c.query<{ id: string }>(
          `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                  inicio_actividades, creado_por) values ($1, $2, 'Mi SA', 'EXENTO', $3, '2020-01-01', $4) returning id`,
          [m.empresa, m.emisor, domicilio, m.persona],
        );
        return seRechaza(
          c,
          `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = null, confirmada_en = now(),
                  confirmada_por = $2, motivo = 'Alta' where id = $1`,
          [rows[0]?.id, m.persona],
        );
      });
    }),

  /** La versión confirmada lleva el número siguiente. */
  confirmarExigeNumeroSiguiente: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const domicilio = await crearDomicilio(c, m.empresa);
      return deshacible(c, async () => {
        const { rows } = await c.query<{ id: string }>(
          `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                  inicio_actividades, creado_por) values ($1, $2, 'Mi SA', 'EXENTO', $3, '2020-01-01', $4) returning id`,
          [m.empresa, m.emisor, domicilio, m.persona],
        );
        return seRechaza(
          c,
          `update datos_fiscales set estado = 'CONFIRMADA', numero = 5, vigente_desde = now(), confirmada_en = now(),
                  confirmada_por = $2, motivo = 'Alta' where id = $1`,
          [rows[0]?.id, m.persona],
        );
      });
    }),

  /** Con series usadas el punto de venta no cambia de número. */
  numeroDePuntoDeVentaInmutable: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const pv = await crearPuntoDeVenta(c, m, { numero: 1 });
      await crearSerie(c, m.empresa, pv, m.emisor, "FACTURA_B", 1);
      return deshacible(c, async () =>
        seRechaza(c, "update punto_de_venta set numero = 2 where id = $1", [pv]),
      );
    }),

  /** La plataforma no lee domicilios. */
  plataformaNoLeeDomicilios: (b) =>
    conPlataformaDe(
      b,
      "ADMIN",
      async (s) => !(await s.intentar("select count(*) from domicilio")).ok,
    ),

  /** Una serie no mezcla el emisor de otro con el punto de venta. */
  serieNoMezclaEmisor: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const secundario = (
        await c.query<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [m.empresa, cuitAlAzar()],
        )
      ).rows[0]?.id;
      const pv = await crearPuntoDeVenta(c, m, { numero: 1 });
      return deshacible(c, async () =>
        seRechaza(
          c,
          `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
           values ($1, $2, $3, 'FACTURA_A', 0, 'HOMOLOGACION')`,
          [m.empresa, pv, secundario],
        ),
      );
    }),

  /** Bajo REPEATABLE READ, cambiar el número de un punto de venta cuya serie se reservó después de la lectura aborta. */
  cambioDeNumeroAbortaSiSeReservoDespues: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const pv = await crearPuntoDeVenta(c, m, { numero: 1 });
      await crearSerie(c, m.empresa, pv, m.emisor, "FACTURA_B", 0);
      const ctx = comoEmpresa(empresaId(m.empresa), personaId(m.persona));
      const cambio = await SesionDePrueba.abrir(b, "zuluhub_app", ctx, "repeatable read");
      const reserva = await SesionDePrueba.abrir(b, "zuluhub_app", ctx);
      try {
        await cambio.intentar("select numero from punto_de_venta where id = $1", [pv]);
        await reserva.directo(
          `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = ultimo_numero + 1,
                  solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now() + interval '5 minutes'
            where punto_de_venta_id = $1`,
          [pv],
        );
        await reserva.confirmar();
        const r = await cambio.directo("update punto_de_venta set numero = 2 where id = $1", [pv]);
        return !r.ok;
      } finally {
        await cambio.cerrar();
        await reserva.cerrar();
      }
    }),

  /** Corregir el CUIT espera a una reserva en vuelo (y después se rechaza). */
  cuitEsperaLaReserva: (b) =>
    conDueno(b, async (c) => {
      const m = await crearMundo(c);
      const secundario = (
        await c.query<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [m.empresa, cuitAlAzar()],
        )
      ).rows[0]?.id as string;
      const pv = await crearPuntoDeVenta(c, m, { numero: 1, emisor: secundario });
      await crearSerie(c, m.empresa, pv, secundario);
      const reserva = await SesionDePrueba.abrir(
        b,
        "zuluhub_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
      );
      const cambio = await SesionDePrueba.abrir(b, "zuluhub_plataforma", comoPlataforma());
      try {
        await reserva.directo(
          `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = ultimo_numero + 1,
                  solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now() + interval '5 minutes'
            where punto_de_venta_id = $1`,
          [pv],
        );
        const pendiente = cambio.directo("update emisor set cuit = $2 where id = $1", [
          secundario,
          cuitAlAzar(),
        ]);
        const espero = await esperarBloqueo(c, cambio.pid, 1500);
        await reserva.confirmar();
        const r = await pendiente;
        return espero && !r.ok;
      } finally {
        await reserva.cerrar();
        await cambio.cerrar();
      }
    }),
} satisfies Record<string, Sonda>;

// ---- los debilitamientos ------------------------------------------------------------------------

type Caso = Readonly<{
  nombre: string;
  sonda: keyof typeof SONDAS;
  debilitar: (c: pg.Client) => Promise<void>;
}>;

const CASOS: readonly Caso[] = [
  {
    nombre: "quitar FORCE ROW LEVEL SECURITY de una tabla fiscal",
    sonda: "rlsForzada",
    debilitar: async (c) =>
      void (await c.query("alter table datos_fiscales no force row level security")),
  },
  {
    nombre: "quitar ENABLE ROW LEVEL SECURITY de una tabla fiscal",
    sonda: "rlsForzada",
    debilitar: async (c) =>
      void (await c.query("alter table serie_comprobante disable row level security")),
  },
  {
    nombre: "agregar una única sin empresa_id a una tabla con empresa_id",
    sonda: "unicasGlobales",
    debilitar: async (c) =>
      void (await c.query(
        "create unique index datos_fiscales_numero_global_uk on datos_fiscales (numero)",
      )),
  },
  {
    nombre: "agregar una única sin empresa_id al número del punto de venta",
    sonda: "unicasGlobales",
    debilitar: async (c) =>
      void (await c.query(
        "create unique index punto_de_venta_numero_global_uk on punto_de_venta (numero)",
      )),
  },
  {
    nombre: "quitar la única global del CUIT del emisor (y no dejar ninguna)",
    sonda: "unicasGlobales",
    debilitar: async (c) => void (await c.query("drop index emisor_cuit_uk")),
  },
  {
    nombre: "un UPDATE de más: la aplicación puede cambiar el emisor de un punto de venta",
    sonda: "columnasIntocables",
    debilitar: async (c) =>
      void (await c.query("grant update (emisor_id) on punto_de_venta to zuluhub_app")),
  },
  {
    nombre: "un UPDATE de más: la plataforma puede cambiar si un emisor es principal",
    sonda: "columnasIntocables",
    debilitar: async (c) =>
      void (await c.query("grant update (es_principal) on emisor to zuluhub_plataforma")),
  },
  {
    nombre: "un UPDATE de más: la aplicación puede cambiar la verificación de ARCA",
    sonda: "columnasIntocables",
    debilitar: async (c) =>
      void (await c.query("grant update (verificacion_arca) on punto_de_venta to zuluhub_app")),
  },
  {
    nombre: "quitar el CHECK del número del domicilio",
    sonda: "domicilioRechazaNumeroInvalido",
    debilitar: async (c) =>
      void (await c.query("alter table domicilio drop constraint domicilio_numero_ck")),
  },
  {
    nombre: "quitar el disparador de la serie de comprobantes",
    sonda: "serieNoBajaNiSalta",
    debilitar: async (c) =>
      void (await c.query("drop trigger serie_comprobante_cambio on serie_comprobante")),
  },
  {
    nombre: "dejar que el último número suba de cualquier forma (sin la regla de +1)",
    sonda: "serieNoBajaNiSalta",
    debilitar: (c) =>
      reescribirFuncion(
        c,
        "serie_comprobante_validar_cambio",
        "AND NOT (OLD.estado = 'EN_CURSO' AND NEW.estado = 'LIBRE' AND NEW.ultimo_numero = OLD.numero_en_curso)",
        "AND false",
      ),
  },
  {
    nombre: "quitar la restrictiva que exige un ADMIN para crear emisores",
    sonda: "soporteNoCreaEmisor",
    debilitar: async (c) =>
      void (await c.query("drop policy emisor_plataforma_admin_alta on emisor")),
  },
  {
    nombre: "quitar empresa_operable de la política de alta de puntos de venta",
    sonda: "empresaNoOperableNoEscribe",
    debilitar: async (c) =>
      void (await c.query(
        "alter policy punto_de_venta_app_alta on punto_de_venta with check (empresa_id = (select app_empresa_id()))",
      )),
  },
  {
    nombre: "quitar el disparador que crea el emisor principal de las empresas nuevas",
    sonda: "empresaNuevaTienePrincipal",
    debilitar: async (c) =>
      void (await c.query("drop trigger empresa_crear_emisor_principal on empresa")),
  },
  {
    nombre: "quitar el disparador del emisor (el CUIT secundario podría ser el de una empresa)",
    sonda: "cuitSecundarioNoEsDeEmpresa",
    debilitar: async (c) => void (await c.query("drop trigger emisor_cambio on emisor")),
  },
  {
    nombre: "quitar el CHECK que ata el CUIT al carácter de principal",
    sonda: "principalSinCuit",
    debilitar: async (c) =>
      void (await c.query("alter table emisor drop constraint emisor_cuit_ck")),
  },
  {
    nombre: "quitar el disparador de los datos fiscales (la confirmada se podría editar)",
    sonda: "confirmadaInmutable",
    debilitar: async (c) =>
      void (await c.query("drop trigger datos_fiscales_cambio on datos_fiscales")),
  },
  {
    nombre:
      "volver al CHECK de la confirmada tal como estaba escrito en la especificación (con el hueco de los NULL)",
    sonda: "confirmarExigeVigencia",
    debilitar: async (c) => {
      await c.query("alter table datos_fiscales drop constraint datos_fiscales_confirmada_ck");
      await c.query(`alter table datos_fiscales add constraint datos_fiscales_confirmada_ck check (
        (estado = 'CONFIRMADA') = (numero IS NOT NULL) AND (estado = 'BORRADOR' OR (
          numero > 0 AND razon_social IS NOT NULL AND condicion_iva IS NOT NULL AND domicilio_fiscal_id IS NOT NULL
          AND inicio_actividades IS NOT NULL AND vigente_desde >= confirmada_en AND confirmada_por IS NOT NULL)))`);
    },
  },
  {
    nombre: "dejar que la versión confirmada lleve cualquier número",
    sonda: "confirmarExigeNumeroSiguiente",
    debilitar: (c) =>
      reescribirFuncion(
        c,
        "datos_fiscales_validar_cambio",
        "IF NEW.numero IS DISTINCT FROM v_siguiente THEN",
        "IF false THEN",
      ),
  },
  {
    nombre: "quitar el disparador del punto de venta (el número cambiaría con series usadas)",
    sonda: "numeroDePuntoDeVentaInmutable",
    debilitar: async (c) =>
      void (await c.query("drop trigger punto_de_venta_cambio on punto_de_venta")),
  },
  {
    nombre: "darle a la plataforma lectura de los domicilios",
    sonda: "plataformaNoLeeDomicilios",
    debilitar: async (c) => {
      await c.query("grant select on domicilio to zuluhub_plataforma");
      await c.query(
        "create policy domicilio_plataforma_leer on domicilio for select to zuluhub_plataforma using (true)",
      );
    },
  },
  {
    nombre:
      "reemplazar la clave foránea compuesta de la serie por una simple (se mezclarían emisor y punto de venta)",
    sonda: "serieNoMezclaEmisor",
    debilitar: async (c) => {
      await c.query("alter table serie_comprobante drop constraint serie_punto_de_venta_fkey");
      await c.query(
        `alter table serie_comprobante add constraint serie_punto_de_venta_fkey
           foreign key (punto_de_venta_id) references punto_de_venta (id)`,
      );
    },
  },
  {
    nombre: "quitar el FOR SHARE de las series al cambiar el número de un punto de venta",
    sonda: "cambioDeNumeroAbortaSiSeReservoDespues",
    debilitar: (c) => reescribirFuncion(c, "punto_de_venta_validar_cambio", "FOR SHARE;", ";"),
  },
  {
    nombre:
      "quitar el bloqueo compartido del emisor al reservar (el CUIT no esperaría a la reserva)",
    sonda: "cuitEsperaLaReserva",
    debilitar: (c) =>
      reescribirFuncion(
        c,
        "serie_comprobante_validar_cambio",
        "PERFORM pg_advisory_xact_lock_shared(hashtextextended('zuluhub.fiscal.emisor:' || OLD.emisor_id::text, 0));",
        "NULL;",
      ),
  },
];

describe.skipIf(base === null)("fiscal: debilitamientos propios de la migración 0006", () => {
  it("cada sonda pasa sobre la base real (si no, un debilitamiento «detectado» no probaría nada)", async () => {
    if (base === null) return;
    for (const [nombre, sonda] of Object.entries(SONDAS)) {
      expect(await sonda(base), nombre).toBe(true);
    }
  });

  it("todas las sondas se usan, y cada una tiene al menos un debilitamiento", () => {
    const usadas = new Set(CASOS.map((c) => c.sonda));
    expect([...usadas].sort()).toEqual(Object.keys(SONDAS).sort());
    expect(CASOS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(CASOS.map((c) => [c.nombre, c] as const))(
    "con la migración rota — %s — la sonda deja de cumplirse",
    async (_nombre, caso) => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      try {
        const sonda: Sonda = SONDAS[caso.sonda];
        expect(await sonda(aparte.base), "la sonda pasa antes de romper nada").toBe(true);
        await conDueno(aparte.base, caso.debilitar);
        expect(await sonda(aparte.base), "la sonda detecta el debilitamiento").toBe(false);
      } finally {
        await aparte.destruir();
      }
    },
  );
});
