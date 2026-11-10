import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  ESTADOS_DE_JORNADA,
  explicacionDesdeTexto,
  transicionPermitida,
  type EstadoDeJornada,
} from "../../src/modulos/cierre/publico";
import { crearBaseAparte } from "./entorno";
import { check, conAppDe, crearMundo, denegado, filas, acepta, type Mundo } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import type { SesionDePrueba } from "./sesiones";

/**
 * La migración 0026 (E3b: la jornada de la sucursal y la foto de controles al cerrar). Se prueba: que las tablas nacen con RLS forzada
 * y sin privilegios para otros roles, que la jornada admite exactamente las tres transiciones y queda congelada al cerrar (también para
 * el dueño de la base), que la persona que inicia y cierra es la del contexto, los CHECK de las marcas, que la foto de controles solo
 * entra al cerrar y es de solo inserción, el aislamiento entre empresas y la reversión (solo con las tablas vacías).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const AHORA = "2026-11-09T22:00:00Z";
const DESPUES = "2026-11-10T02:00:00Z";

type Intento = Awaited<ReturnType<SesionDePrueba["intentar"]>>;
const HASH = "a".repeat(64);

describe.skipIf(base === null)("migración 0026: el cierre del día", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let otra: Mundo;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    otra = await crearMundo(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const b = () => propia.base;
  /** Una jornada nueva (fecha distinta cada vez) creada por la app. */
  let contador = 0;
  const fechaNueva = () => {
    contador += 1;
    return `2027-01-${String(contador).padStart(2, "0")}`;
  };
  const crear = (s: SesionDePrueba, fecha: string, mundo: Mundo = m): Promise<Intento> =>
    s.intentar(
      "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)",
      [mundo.empresa, mundo.sucursal, fecha],
    );
  const iniciar = (s: SesionDePrueba, fecha: string, persona: string = m.persona) =>
    s.intentar(
      `update jornada_de_sucursal set estado = 'EN_AUDITORIA', auditoria_iniciada_en = $4, auditoria_iniciada_por = $5
        where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3`,
      [m.empresa, m.sucursal, fecha, AHORA, persona],
    );
  const cancelar = (s: SesionDePrueba, fecha: string) =>
    s.intentar(
      `update jornada_de_sucursal set estado = 'ABIERTA', auditoria_iniciada_en = null, auditoria_iniciada_por = null
        where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3`,
      [m.empresa, m.sucursal, fecha],
    );
  const cerrar = (s: SesionDePrueba, fecha: string, persona: string = m.persona) =>
    s.intentar(
      `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $4, cerrada_por = $5, huella_de_cierre = $6
        where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3`,
      [m.empresa, m.sucursal, fecha, DESPUES, persona, HASH],
    );
  /** Como `cerrar`, pero sin savepoint: el cierre estampa su transacción en la fila (`xmin`), y la foto de controles lo exige. */
  const cerrarDirecto = (s: SesionDePrueba, fecha: string, persona: string = m.persona) =>
    s.directo(
      `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $4, cerrada_por = $5, huella_de_cierre = $6
        where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3`,
      [m.empresa, m.sucursal, fecha, DESPUES, persona, HASH],
    );
  const control = (
    s: SesionDePrueba,
    fecha: string,
    c: Partial<{
      modulo: string;
      clave: string;
      severidad: string;
      cantidad: number;
      reconocido: boolean;
      por: string | null;
      texto: string | null;
    }> = {},
  ) =>
    s.intentar(
      `insert into control_de_jornada_cerrada (empresa_id, sucursal_id, fecha_negocio, modulo, clave, severidad, cantidad,
                                               reconocido, reconocido_en, reconocido_por, texto)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        m.empresa,
        m.sucursal,
        fecha,
        c.modulo ?? "caja",
        c.clave ?? "caja.diferencia_de_arqueo",
        c.severidad ?? "RECONOCIBLE",
        c.cantidad ?? 2,
        c.reconocido ?? false,
        c.por === undefined || c.por === null ? null : DESPUES,
        c.por ?? null,
        c.texto ?? null,
      ],
    );

  it("las dos tablas existen con RLS activa y forzada, y solo la aplicación tiene privilegios", async () => {
    const { rows } = await dueno.query<{ relname: string; on: boolean; forzada: boolean }>(
      `select relname, relrowsecurity as on, relforcerowsecurity as forzada from pg_class
        where relname in ('jornada_de_sucursal', 'control_de_jornada_cerrada') order by relname`,
    );
    expect(rows).toEqual([
      { relname: "control_de_jornada_cerrada", on: true, forzada: true },
      { relname: "jornada_de_sucursal", on: true, forzada: true },
    ]);
    for (const rol of [
      "pedernal_plataforma",
      "pedernal_grupo",
      "pedernal_trabajos",
      "pedernal_publico",
    ]) {
      for (const tabla of ["jornada_de_sucursal", "control_de_jornada_cerrada"]) {
        const { rows: p } = await dueno.query<{ ok: boolean }>(
          "select has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') as ok",
          [rol, tabla],
        );
        expect(p[0]?.ok, `${rol} sobre ${tabla}`).toBe(false);
      }
    }
    const { rows: app } = await dueno.query<{ d: boolean; t: boolean }>(
      `select has_table_privilege('pedernal_app', 'jornada_de_sucursal', 'DELETE') as d,
              has_table_privilege('pedernal_app', 'control_de_jornada_cerrada', 'UPDATE') as t`,
    );
    expect(app[0]).toEqual({ d: false, t: false });
  });

  it("la jornada nace ABIERTA y sin marcas; repetir el alta no duplica (on conflict do nothing)", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      const repetida = await s.intentar(
        `insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)
         on conflict do nothing`,
        [m.empresa, m.sucursal, fecha],
      );
      filas(repetida, 0);
      const leida = await s.intentar(
        "select estado, auditoria_iniciada_en, cerrada_en, version from jornada_de_sucursal where fecha_negocio = $1",
        [fecha],
      );
      expect(leida.ok && leida.rows).toEqual([
        { estado: "ABIERTA", auditoria_iniciada_en: null, cerrada_en: null, version: 1 },
      ]);
    });
  });

  it("la aplicación no puede crear una jornada ya iniciada ni con el estado a su gusto", async () => {
    await conAppDe(b(), m, async (s) => {
      denegado(
        await s.intentar(
          "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio, estado) values ($1, $2, $3, 'CERRADA')",
          [m.empresa, m.sucursal, fechaNueva()],
        ),
      );
    });
  });

  it("una fecha imposible no crea una jornada", async () => {
    await conAppDe(b(), m, async (s) => {
      check(await crear(s, "0001-01-01"), "jornada_fecha_ck");
      check(await crear(s, "9999-12-31"), "jornada_fecha_ck");
    });
  });

  it("transiciones exactas: ABIERTA → EN_AUDITORIA → ABIERTA → EN_AUDITORIA → CERRADA, y nada más", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      // ABIERTA no salta directo a CERRADA.
      check(await cerrar(s, fecha), "jornada_transicion_invalida");
      filas(await iniciar(s, fecha), 1);
      filas(await cancelar(s, fecha), 1);
      filas(await iniciar(s, fecha), 1);
      acepta(await cerrar(s, fecha));
      const leida = await s.intentar(
        "select estado, cerrada_por, version from jornada_de_sucursal where fecha_negocio = $1",
        [fecha],
      );
      expect(leida.ok && leida.rows).toEqual([
        { estado: "CERRADA", cerrada_por: m.persona, version: 5 },
      ]);
    });
  });

  it("una jornada CERRADA no admite ningún cambio, tampoco para el dueño de la base", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      filas(await iniciar(s, fecha), 1);
      filas(await cerrar(s, fecha), 1);
      check(await cancelar(s, fecha), "jornada_cerrada_congelada");
      check(await iniciar(s, fecha), "jornada_cerrada_congelada");
      await s.confirmar();
    });
    await dueno.query("begin");
    try {
      for (const cambio of [
        "set estado = 'ABIERTA', auditoria_iniciada_en = null, auditoria_iniciada_por = null, cerrada_en = null, cerrada_por = null, huella_de_cierre = null",
        "set observacion = 'cambiada'",
        "set version = 99",
      ]) {
        await dueno.query("savepoint s");
        const r = await dueno
          .query(`update jornada_de_sucursal ${cambio} where fecha_negocio = $1`, [fecha])
          .then(
            () => null,
            (e: { constraint?: string; code?: string }) => e,
          );
        await dueno.query("rollback to savepoint s");
        // El dueño evade RLS: el disparador es lo que frena (CHECK 23514).
        expect(r?.code, cambio).toBe("23514");
        expect(r?.constraint, cambio).toBe("jornada_cerrada_congelada");
      }
    } finally {
      await dueno.query("rollback");
    }
  });

  it("no hay otras transiciones: EN_AUDITORIA no se queda en EN_AUDITORIA con otros datos ni cambia la identidad", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      filas(await iniciar(s, fecha), 1);
      check(
        await s.intentar(
          "update jornada_de_sucursal set auditoria_iniciada_en = $2 where fecha_negocio = $1",
          [fecha, DESPUES],
        ),
        "jornada_transicion_invalida",
      );
      denegado(
        await s.intentar(
          "update jornada_de_sucursal set fecha_negocio = '2027-06-01' where fecha_negocio = $1",
          [fecha],
        ),
      );
    });
  });

  it("quien inicia y quien cierra es la persona del contexto: no se puede poner a otra", async () => {
    const fecha = fechaNueva();
    const otraPersona = (
      await dueno.query<{ id: string }>("insert into persona (email) values ($1) returning id", [
        `otra-${fecha}@prueba.test`,
      ])
    ).rows[0]?.id as string;
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      check(await iniciar(s, fecha, otraPersona), "jornada_persona_del_contexto");
      filas(await iniciar(s, fecha), 1);
      check(await cerrar(s, fecha, otraPersona), "jornada_persona_del_contexto");
    });
  });

  it("sin persona en el contexto nadie inicia ni cierra", async () => {
    const fecha = fechaNueva();
    await conAppDe(
      b(),
      m,
      async (s) => {
        filas(await crear(s, fecha), 1);
        check(await iniciar(s, fecha), "jornada_persona_del_contexto");
      },
      null,
    );
  });

  it("las marcas y la observación respetan sus CHECK", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      // Una observación suelta, sin cerrar, no es una transición permitida.
      check(
        await s.intentar(
          "update jornada_de_sucursal set observacion = 'x' where fecha_negocio = $1",
          [fecha],
        ),
        "jornada_transicion_invalida",
      );
      filas(await iniciar(s, fecha), 1);
      // Cerrar con una huella que no es sha256 hex.
      check(
        await s.intentar(
          `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3, huella_de_cierre = 'xyz'
            where fecha_negocio = $1`,
          [fecha, DESPUES, m.persona],
        ),
        "jornada_huella_ck",
      );
      // Cerrar sin la huella.
      check(
        await s.intentar(
          `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3 where fecha_negocio = $1`,
          [fecha, DESPUES, m.persona],
        ),
        "jornada_estado_marcas_ck",
      );
      // Cerrar antes de haber iniciado.
      check(
        await s.intentar(
          `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = '2020-01-01T00:00:00Z', cerrada_por = $2,
                  huella_de_cierre = $3 where fecha_negocio = $1`,
          [fecha, m.persona, HASH],
        ),
        "jornada_estado_marcas_ck",
      );
      // Una observación con control o de más de 500 caracteres.
      for (const observacion of ["a\nb", "x".repeat(501), " con borde", ""]) {
        check(
          await s.intentar(
            `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3, huella_de_cierre = $4,
                    observacion = $5 where fecha_negocio = $1`,
            [fecha, DESPUES, m.persona, HASH, observacion],
          ),
          "jornada_observacion_ck",
        );
      }
      acepta(
        await s.intentar(
          `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3, huella_de_cierre = $4,
                  observacion = $5 where fecha_negocio = $1`,
          [fecha, DESPUES, m.persona, HASH, "x".repeat(500)],
        ),
      );
    });
  });

  it("la jornada no se borra ni se vacía, ni el dueño de la base", async () => {
    await dueno.query("begin");
    try {
      for (const sentencia of ["delete from jornada_de_sucursal", "truncate jornada_de_sucursal"]) {
        await dueno.query("savepoint s");
        const e = await dueno.query(sentencia).then(
          () => null,
          (x: { code?: string }) => x,
        );
        await dueno.query("rollback to savepoint s");
        // `truncate` de una tabla con claves foráneas hacia ella ya lo frena Postgres (0A000); el disparador es la segunda barrera.
        expect(["42501", "0A000"], sentencia).toContain(e?.code);
      }
    } finally {
      await dueno.query("rollback");
    }
    await conAppDe(b(), m, async (s) => {
      denegado(await s.intentar("delete from jornada_de_sucursal"));
    });
  });

  it("la foto de controles solo entra con la jornada pasando a CERRADA en la misma transacción", async () => {
    const abierta = fechaNueva();
    const enAuditoria = fechaNueva();
    const cerradaAntes = fechaNueva();
    const cierraAhora = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      for (const f of [abierta, enAuditoria, cerradaAntes, cierraAhora])
        filas(await crear(s, f), 1);
      filas(await iniciar(s, enAuditoria), 1);
      for (const f of [cerradaAntes, cierraAhora]) filas(await iniciar(s, f), 1);
      filas(await cerrar(s, cerradaAntes), 1);
      await s.confirmar();
    });
    await conAppDe(b(), m, async (s) => {
      // Cierra ahora: primero la jornada (sin savepoint: un `ROLLBACK TO` previo dejaría al cierre en una subtransacción), después la foto.
      filas(await cerrarDirecto(s, cierraAhora), 1);
      // Abierta, en auditoría y cerrada en otra transacción: ninguna acepta controles.
      for (const f of [abierta, enAuditoria, cerradaAntes]) {
        check(await control(s, f), "control_solo_al_cerrar");
      }
      filas(await control(s, cierraAhora), 1);
      filas(
        await control(s, cierraAhora, {
          modulo: "ventas",
          clave: "ventas.cortesias",
          severidad: "RECONOCIBLE",
          cantidad: 3,
          reconocido: true,
          por: m.persona,
          texto: "autorizadas por el gerente",
        }),
        1,
      );
      expect((await s.confirmar()).ok).toBe(true);
    });
    // Confirmada, ya no entra nada más (la jornada cerró en otra transacción).
    await conAppDe(b(), m, async (s) => {
      check(
        await control(s, cierraAhora, {
          modulo: "stock",
          clave: "stock.conteos",
          severidad: "INFORMA",
          cantidad: 1,
        }),
        "control_solo_al_cerrar",
      );
    });
  });

  it("la foto es de solo inserción: ni UPDATE ni DELETE ni TRUNCATE, tampoco el dueño", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      filas(await iniciar(s, fecha), 1);
      filas(await cerrarDirecto(s, fecha), 1);
      filas(await control(s, fecha), 1);
      await s.confirmar();
    });
    await dueno.query("begin");
    try {
      for (const sentencia of [
        "update control_de_jornada_cerrada set cantidad = 0",
        "delete from control_de_jornada_cerrada",
        "truncate control_de_jornada_cerrada",
      ]) {
        await dueno.query("savepoint s");
        const e = await dueno.query(sentencia).then(
          () => null,
          (x: { code?: string }) => x,
        );
        await dueno.query("rollback to savepoint s");
        expect(e?.code, sentencia).toBe("42501");
      }
    } finally {
      await dueno.query("rollback");
    }
    await conAppDe(b(), m, async (s) => {
      denegado(await s.intentar("update control_de_jornada_cerrada set cantidad = 0"));
      denegado(await s.intentar("delete from control_de_jornada_cerrada"));
    });
  });

  it("los CHECK de la foto: forma de módulo y clave, severidad, cantidad y reconocimiento con constancia", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), m, async (s) => {
      filas(await crear(s, fecha), 1);
      filas(await iniciar(s, fecha), 1);
      filas(await cerrarDirecto(s, fecha), 1);
      // Un módulo mal escrito arrastra a su clave (que empieza con él): lo frena una de las dos restricciones.
      const mal = await control(s, fecha, { modulo: "Caja", clave: "Caja.diferencia" });
      expect(!mal.ok && mal.codigo).toBe("23514");
      check(
        await control(s, fecha, { modulo: "caja-1", clave: "caja.diferencia" }),
        "control_clave_ck",
      );
      check(
        await control(s, fecha, { modulo: "a".repeat(41), clave: `${"a".repeat(41)}.x` }),
        "control_modulo_ck",
      );
      check(await control(s, fecha, { clave: "sin_punto" }), "control_clave_ck");
      check(await control(s, fecha, { clave: "ventas.cortesias" }), "control_clave_ck");
      check(await control(s, fecha, { clave: "caja.con-guion" }), "control_clave_ck");
      check(await control(s, fecha, { severidad: "GRAVE" }), "control_severidad_ck");
      check(await control(s, fecha, { cantidad: -1 }), "control_cantidad_ck");
      // Reconocido sin quién y cuándo, o con ellos pero sin marcar.
      check(await control(s, fecha, { reconocido: true }), "control_reconocido_ck");
      check(
        await control(s, fecha, { reconocido: false, por: m.persona }),
        "control_reconocido_ck",
      );
      // Solo se reconoce lo RECONOCIBLE y con hallazgos.
      check(
        await control(s, fecha, { severidad: "INFORMA", reconocido: true, por: m.persona }),
        "control_reconocido_ck",
      );
      check(
        await control(s, fecha, { severidad: "BLOQUEA", reconocido: true, por: m.persona }),
        "control_reconocido_ck",
      );
      check(
        await control(s, fecha, { cantidad: 0, reconocido: true, por: m.persona }),
        "control_reconocido_ck",
      );
      // El texto solo existe en un control reconocido y es de una línea.
      check(await control(s, fecha, { texto: "explicación" }), "control_texto_ck");
      check(
        await control(s, fecha, { reconocido: true, por: m.persona, texto: "con\nsalto" }),
        "control_texto_ck",
      );
      check(
        await control(s, fecha, { reconocido: true, por: m.persona, texto: "x".repeat(501) }),
        "control_texto_ck",
      );
      filas(
        await control(s, fecha, { reconocido: true, por: m.persona, texto: "x".repeat(500) }),
        1,
      );
      // Un mismo control no entra dos veces en la misma jornada.
      expect((await control(s, fecha, { reconocido: true, por: m.persona })).ok).toBe(false);
    });
  });

  it("aislamiento entre empresas: no se ve ni se escribe la jornada de otra", async () => {
    const fecha = fechaNueva();
    await conAppDe(b(), otra, async (s) => {
      filas(await crear(s, fecha, otra), 1);
      await s.confirmar();
    });
    await conAppDe(b(), m, async (s) => {
      const vistas = await s.intentar(
        "select empresa_id from jornada_de_sucursal where fecha_negocio = $1",
        [fecha],
      );
      expect(vistas.ok && vistas.rows).toEqual([]);
      // Crear la jornada de una sucursal ajena (o con la empresa ajena) lo rechaza la política o la clave foránea.
      expect((await crear(s, fecha, otra)).ok).toBe(false);
      expect(
        (
          await s.intentar(
            "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)",
            [m.empresa, otra.sucursal, fecha],
          )
        ).ok,
      ).toBe(false);
      filas(
        await s.intentar(
          "update jornada_de_sucursal set observacion = null where fecha_negocio = $1",
          [fecha],
        ),
        0,
      );
    });
  });

  it("una empresa suspendida no inicia, ni cierra ni crea jornadas", async () => {
    const suspendida = await crearMundo(dueno, { estado: "SUSPENDED" });
    await conAppDe(b(), suspendida, async (s) => {
      expect((await crear(s, fechaNueva(), suspendida)).ok).toBe(false);
    });
  });

  it("la base no conoce a los módulos: no hay claves foráneas ni disparadores hacia otras tablas de negocio", async () => {
    const { rows } = await dueno.query<{ destino: string }>(
      `select distinct confrelid::regclass::text as destino from pg_constraint
        where contype = 'f' and conrelid in ('jornada_de_sucursal'::regclass, 'control_de_jornada_cerrada'::regclass)
        order by 1`,
    );
    expect(rows.map((r) => r.destino)).toEqual([
      "empresa",
      "jornada_de_sucursal",
      "persona",
      "sucursal",
    ]);
  });

  it("la base permite exactamente las transiciones del dominio (los nueve pares de estados)", async () => {
    const llegar = async (s: SesionDePrueba, fecha: string, a: EstadoDeJornada) => {
      filas(await crear(s, fecha), 1);
      if (a === "ABIERTA") return;
      filas(await iniciar(s, fecha), 1);
      if (a === "CERRADA") filas(await cerrar(s, fecha), 1);
    };
    const intentar = (s: SesionDePrueba, fecha: string, hacia: EstadoDeJornada) => {
      if (hacia === "ABIERTA") return cancelar(s, fecha);
      if (hacia === "EN_AUDITORIA") return iniciar(s, fecha);
      return cerrar(s, fecha);
    };
    for (const desde of ESTADOS_DE_JORNADA) {
      for (const hacia of ESTADOS_DE_JORNADA) {
        const fecha = fechaNueva();
        await conAppDe(b(), m, async (s) => {
          await llegar(s, fecha, desde);
          const r = await intentar(s, fecha, hacia);
          expect(r.ok, `${desde} → ${hacia}`).toBe(transicionPermitida(desde, hacia));
        });
      }
    }
  });

  it("la lista de permitidos de la base y la de TypeScript (`explicacion.ts`) aceptan exactamente los mismos caracteres", async () => {
    const texto = await readFile(join(CARPETA_DE_MIGRACIONES, "0026_cierre.sql"), "utf8");
    const literales = [...texto.matchAll(/(?:observacion|texto) ~ '([^\n]*)'\n/g)].map(
      (m) => m[1] as string,
    );
    // Los dos CHECK (observación y texto) usan la misma lista.
    expect(literales).toHaveLength(2);
    expect(new Set(literales).size).toBe(1);
    const patron = (literales[0] as string).replaceAll("''", "'");
    // Todos los caracteres del plano básico hasta U+024F, más tipográficos y de otros alfabetos, que la lista no debe admitir.
    const candidatos = [
      ...Array.from({ length: 0x250 }, (_, i) => String.fromCharCode(i)),
      "\u2013",
      "\u2014",
      "\u2018",
      "\u2019",
      "\u201C",
      "\u201D",
      "\u20AC",
      "\u0301",
      "\u200B",
      "\u202E",
      "\u3042",
      "\u05D0",
      "\u0627",
      "\uFFFD",
    ].filter((c) => c !== " " && c !== "\u0000");
    const dudosos: string[] = [];
    for (const c of candidatos) {
      const ts = explicacionDesdeTexto(`a${c}a`);
      // La forma canónica de TypeScript recorta y compone; para comparar, solo importa si el carácter del medio entra o no.
      const enTs = ts.ok && ts.valor === `a${c}a`;
      const { rows } = await dueno.query<{ ok: boolean }>("select $1::text ~ $2::text as ok", [
        `a${c}a`,
        patron,
      ]);
      if (enTs !== rows[0]?.ok) dudosos.push(`U+${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    }
    expect(dudosos).toEqual([]);
  });

  describe("reversión", () => {
    const rutaDeReversion = async () => {
      const [nombre] = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
        /^0026_revertir_cierre\.sql$/.test(n),
      );
      if (nombre === undefined) throw new Error("falta la reversión 0026");
      return join(CARPETA_DE_MIGRACIONES, "reversiones", nombre);
    };

    it("se niega con una sola jornada guardada y no cambia nada", async () => {
      const sql = await readFile(await rutaDeReversion(), "utf8");
      await dueno.query("begin");
      try {
        const error = await dueno.query(sql).then(
          () => null,
          (e: { code?: string; message?: string }) => e,
        );
        expect(error?.code).toBe("55000");
        expect(error?.message).toMatch(/solo corre con las tablas vacías/);
      } finally {
        await dueno.query("rollback");
      }
      const { rows } = await dueno.query<{ n: string }>(
        "select count(*)::text as n from jornada_de_sucursal",
      );
      expect(Number(rows[0]?.n)).toBeGreaterThan(0);
    });

    it("con las tablas vacías deja el catálogo sin tablas ni funciones de cierre, borra su fila del registro y se puede repetir", async () => {
      const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const sql = await readFile(await rutaDeReversion(), "utf8");
        await c.query("begin");
        await c.query(sql);
        await c.query(sql); // repetirla no cambia nada
        const { rows } = await c.query<{ n: string }>(
          `select count(*)::text as n from pg_class where relname in ('jornada_de_sucursal', 'control_de_jornada_cerrada')`,
        );
        expect(rows[0]?.n).toBe("0");
        const { rows: funciones } = await c.query<{ n: string }>(
          `select count(*)::text as n from pg_proc where proname in
             ('jornada_validar_cambio', 'jornada_no_se_borra', 'control_de_jornada_validar_alta')`,
        );
        expect(funciones[0]?.n).toBe("0");
        const { rows: registro } = await c.query<{ n: string }>(
          "select count(*)::text as n from migracion where nombre like '%\\_cierre.sql' escape '\\'",
        );
        expect(registro[0]?.n).toBe("0");
        await c.query("rollback");
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });
});
