import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { empresaId, personaId, tenantId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, comoGrupo, comoTrabajos, cuitAlAzar } from "./entorno";
import {
  acepta,
  conAppDe,
  conPlataformaDe,
  crearDomicilio,
  crearMundo,
  crearPuntoDeVenta,
  crearSerie,
  denegado,
  filas,
  referencia,
  usarSerie,
  type Mundo,
} from "./fiscal-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * H7 (fiscal base), tramo T3: aislamiento de lo fiscal contra una base real. Una empresa no lee ni
 * escribe lo fiscal de otra (tampoco del mismo tenant); el rol de grupo, el de trabajos y el de
 * autenticación no leen nada; la plataforma lee emisores, series y 4 columnas del punto de venta,
 * y nunca domicilios, datos fiscales ni reglas; una empresa que no opera (suspendida, o de un tenant
 * suspendido) lee pero no escribe; y cerrar una autorización deja serie y auditoría juntas o ninguna.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

const TABLAS_DE_LA_EMPRESA = [
  "emisor",
  "domicilio",
  "datos_fiscales",
  "regla_emisor",
  "punto_de_venta",
  "serie_comprobante",
] as const;
const TABLAS_FISCALES = [...TABLAS_DE_LA_EMPRESA, "provincia"] as const;

type Datos = Readonly<{
  m: Mundo;
  secundario: string;
  domicilio: string;
  datos: string;
  regla: string;
  pv: string;
  pvSecundario: string;
}>;

describe.skipIf(base === null)("fiscal: aislamiento entre empresas y entre roles", () => {
  let dueno: pg.Client;
  let a: Datos;
  let b: Datos; // mismo tenant que A
  let c: Datos; // otro tenant

  /** Una empresa con filas en todas las tablas fiscales (armadas por el dueño). */
  const sembrar = async (tenant?: string): Promise<Datos> => {
    const m = await crearMundo(dueno, tenant === undefined ? {} : { tenant });
    const secundario = (
      await dueno.query<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [m.empresa, cuitAlAzar()],
      )
    ).rows[0]?.id as string;
    const domicilio = await crearDomicilio(dueno, m.empresa);
    const datos = (
      await dueno.query<{ id: string }>(
        `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                                    inicio_actividades, creado_por)
         values ($1, $2, 'Mi Empresa', 'MONOTRIBUTO', $3, '2020-01-01', $4) returning id`,
        [m.empresa, m.emisor, domicilio, m.persona],
      )
    ).rows[0]?.id as string;
    const regla = (
      await dueno.query<{ id: string }>(
        "insert into regla_emisor (empresa_id, creado_por) values ($1, $2) returning id",
        [m.empresa, m.persona],
      )
    ).rows[0]?.id as string;
    const pv = await crearPuntoDeVenta(dueno, m, { numero: 1, domicilio });
    const pvSecundario = await crearPuntoDeVenta(dueno, m, { numero: 1, emisor: secundario });
    await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_B", 10);
    await crearSerie(dueno, m.empresa, pvSecundario, secundario, "FACTURA_C", 20);
    return { m, secundario, domicilio, datos, regla, pv, pvSecundario };
  };

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    a = await sembrar();
    b = await sembrar(a.m.tenant);
    c = await sembrar();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const conApp = <T>(
    d: Datos,
    trabajo: (s: SesionDePrueba) => Promise<T>,
    persona?: string | null,
  ) => conAppDe(base!, d.m, trabajo, persona);
  const contar = async (s: SesionDePrueba, tabla: string, filtro = "true"): Promise<number> => {
    const r = await s.intentar(`select count(*)::int as n from ${tabla} where ${filtro}`);
    if (!r.ok) throw new Error(`${tabla}: ${r.mensaje}`);
    return Number(r.rows[0]?.["n"]);
  };

  describe("entre empresas", () => {
    it("cada empresa ve solo lo suyo en toda tabla fiscal, sea del mismo tenant o de otro", async () => {
      for (const [propia, ajenas] of [
        [a, [b, c]],
        [b, [a, c]],
        [c, [a, b]],
      ] as const) {
        await conApp(propia, async (s) => {
          for (const tabla of TABLAS_DE_LA_EMPRESA) {
            expect(await contar(s, tabla), `${tabla}: ve algo`).toBeGreaterThan(0);
            for (const ajena of ajenas) {
              expect(
                await contar(s, tabla, `empresa_id = '${ajena.m.empresa}'`),
                `${tabla}: filas de otra empresa`,
              ).toBe(0);
            }
            expect(await contar(s, tabla, `empresa_id <> '${propia.m.empresa}'`), tabla).toBe(0);
          }
          // El catálogo global es de todos.
          expect(await contar(s, "provincia")).toBe(24);
          // Por id, tampoco: no hay forma de pedir la fila de otra empresa.
          for (const ajena of ajenas) {
            expect(await contar(s, "emisor", `id = '${ajena.m.emisor}'`)).toBe(0);
            expect(await contar(s, "punto_de_venta", `id = '${ajena.pv}'`)).toBe(0);
            expect(await contar(s, "domicilio", `id = '${ajena.domicilio}'`)).toBe(0);
            expect(await contar(s, "datos_fiscales", `id = '${ajena.datos}'`)).toBe(0);
            expect(await contar(s, "regla_emisor", `id = '${ajena.regla}'`)).toBe(0);
          }
        });
      }
    });

    it("una empresa no escribe en otra: ni altas con su empresa_id (42501) ni cambios sobre sus filas (0 filas)", async () => {
      for (const ajena of [b, c]) {
        await conApp(a, async (s) => {
          denegado(
            await s.intentar(
              "insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, 'c', '1', 'l', 'AR-S')",
              [ajena.m.empresa],
            ),
          );
          denegado(
            await s.intentar(
              "insert into datos_fiscales (empresa_id, emisor_id, creado_por) values ($1, $2, $3)",
              [ajena.m.empresa, ajena.m.emisor, a.m.persona],
            ),
          );
          denegado(
            await s.intentar("insert into regla_emisor (empresa_id, creado_por) values ($1, $2)", [
              ajena.m.empresa,
              a.m.persona,
            ]),
          );
          denegado(
            await s.intentar(
              "insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero) values ($1, $2, $3, 9)",
              [ajena.m.empresa, ajena.m.emisor, ajena.m.sucursal],
            ),
          );
          denegado(
            await s.intentar(
              `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero)
               values ($1, $2, $3, 'FACTURA_A', 0)`,
              [ajena.m.empresa, ajena.pv, ajena.m.emisor],
            ),
          );
          // Cambios: la fila ajena ni se ve, así que no se toca.
          filas(
            await s.intentar("update datos_fiscales set razon_social = 'X' where id = $1", [
              ajena.datos,
            ]),
            0,
          );
          filas(
            await s.intentar(
              "update regla_emisor set permitir_eleccion_manual = false where id = $1",
              [ajena.regla],
            ),
            0,
          );
          filas(
            await s.intentar("update punto_de_venta set estado = 'INACTIVO' where id = $1", [
              ajena.pv,
            ]),
            0,
          );
          filas(
            await s.intentar(
              "update serie_comprobante set ultimo_numero = ultimo_numero where punto_de_venta_id = $1",
              [ajena.pv],
            ),
            0,
          );
        });
      }
      // Nada de eso cambió la base.
      expect(
        (await dueno.query("select 1 from datos_fiscales where razon_social = 'X'")).rowCount,
      ).toBe(0);
    });

    it("una empresa no apunta con sus filas al emisor, la sucursal ni el domicilio de otra — tampoco de su mismo tenant (claves foráneas compuestas)", async () => {
      for (const ajena of [b, c]) {
        await conApp(a, async (s) => {
          referencia(
            await s.intentar(
              "insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero) values ($1, $2, $3, 9)",
              [a.m.empresa, ajena.m.emisor, a.m.sucursal],
            ),
            "punto_de_venta_emisor_fkey",
          );
          referencia(
            await s.intentar(
              "insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero) values ($1, $2, $3, 9)",
              [a.m.empresa, a.m.emisor, ajena.m.sucursal],
            ),
            "punto_de_venta_sucursal_fkey",
          );
          referencia(
            await s.intentar(
              "insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero, domicilio_id) values ($1, $2, $3, 9, $4)",
              [a.m.empresa, a.m.emisor, a.m.sucursal, ajena.domicilio],
            ),
            "punto_de_venta_domicilio_fkey",
          );
          referencia(
            await s.intentar(
              "insert into datos_fiscales (empresa_id, emisor_id, creado_por) values ($1, $2, $3)",
              [a.m.empresa, ajena.m.emisor, a.m.persona],
            ),
            "datos_fiscales_emisor_fkey",
          );
          referencia(
            await s.intentar(
              "insert into datos_fiscales (empresa_id, emisor_id, domicilio_fiscal_id, creado_por) values ($1, $2, $3, $4)",
              // El secundario no tiene borrador todavía: así el único error posible es el domicilio.
              [a.m.empresa, a.secundario, ajena.domicilio, a.m.persona],
            ),
            "datos_fiscales_domicilio_fkey",
          );
          // Una serie no mezcla el emisor de una empresa con el punto de venta de otra.
          referencia(
            await s.intentar(
              `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero)
               values ($1, $2, $3, 'FACTURA_A', 0)`,
              [a.m.empresa, ajena.pv, a.m.emisor],
            ),
            "serie_punto_de_venta_fkey",
          );
        });
      }
    });

    it("el contexto de otra empresa no deja ver lo de esta, y un contexto sin empresa no ve nada", async () => {
      // El mismo rol, la empresa B: nada de A.
      await conApp(b, async (s) => {
        expect(await contar(s, "emisor", `empresa_id = '${a.m.empresa}'`)).toBe(0);
      });
      // Sin contexto firmado: falla cerrado en toda tabla fiscal (salvo el catálogo global).
      const s = await SesionDePrueba.abrir(base!, "zuluhub_app", null);
      try {
        for (const tabla of TABLAS_DE_LA_EMPRESA) expect(await contar(s, tabla), tabla).toBe(0);
        denegado(
          await s.intentar(
            "insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, 'c', '1', 'l', 'AR-S')",
            [a.m.empresa],
          ),
        );
      } finally {
        await s.cerrar();
      }
    });
  });

  describe("entre roles de base", () => {
    it("el grupo, los trabajos y la autenticación no leen ni escriben nada fiscal (42501)", async () => {
      const grupo = await SesionDePrueba.abrir(
        base!,
        "zuluhub_grupo",
        comoGrupo(tenantId(a.m.tenant), personaId(a.m.persona)),
      );
      const trabajos = await SesionDePrueba.abrir(base!, "zuluhub_trabajos", comoTrabajos());
      const autenticacion = new pg.Client({ connectionString: base!.autenticacion });
      await autenticacion.connect();
      try {
        for (const tabla of TABLAS_FISCALES) {
          denegado(await grupo.intentar(`select * from ${tabla}`));
          denegado(await trabajos.intentar(`select * from ${tabla}`));
          await expect(autenticacion.query(`select * from ${tabla}`), tabla).rejects.toMatchObject({
            code: "42501",
          });
        }
        denegado(
          await grupo.intentar("insert into emisor (empresa_id, es_principal) values ($1, true)", [
            a.m.empresa,
          ]),
        );
        denegado(await trabajos.intentar("update emisor set activo = true"));
      } finally {
        await grupo.cerrar();
        await trabajos.cerrar();
        await autenticacion.end();
      }
    });

    it("la plataforma lee los emisores y las series de todas las empresas, y del punto de venta solo id, empresa, emisor y estado", async () => {
      await conPlataformaDe(base!, "ADMIN", async (s) => {
        for (const d of [a, b, c]) {
          expect(await contar(s, "emisor", `empresa_id = '${d.m.empresa}'`)).toBe(2);
          expect(await contar(s, "serie_comprobante", `empresa_id = '${d.m.empresa}'`)).toBe(2);
          expect(await contar(s, "punto_de_venta", `empresa_id = '${d.m.empresa}'`)).toBe(2);
        }
        const columnas = await s.intentar(
          "select id, empresa_id, emisor_id, estado from punto_de_venta where empresa_id = $1 order by id",
          [a.m.empresa],
        );
        expect(columnas.ok && columnas.rows).toHaveLength(2);
        for (const columna of [
          "numero",
          "sucursal_id",
          "domicilio_id",
          "verificacion_arca",
          "version",
          "*",
        ]) {
          denegado(await s.intentar(`select ${columna} from punto_de_venta`));
        }
        // La CUIT del secundario es un dato que la plataforma administra.
        const cuits = await s.intentar("select cuit from emisor where id = $1", [a.secundario]);
        expect(cuits.ok && cuits.rows[0]?.["cuit"]).toMatch(/^[0-9]{11}$/);
      });
    });

    it("la plataforma no lee domicilios, datos fiscales, reglas del emisor ni provincias, y no escribe nada que no sea el emisor", async () => {
      await conPlataformaDe(base!, "ADMIN", async (s) => {
        for (const tabla of ["domicilio", "datos_fiscales", "regla_emisor", "provincia"]) {
          denegado(await s.intentar(`select count(*) from ${tabla}`));
        }
        denegado(
          await s.intentar(
            "insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, 'c', '1', 'l', 'AR-S')",
            [a.m.empresa],
          ),
        );
        denegado(await s.intentar("update punto_de_venta set estado = 'INACTIVO'"));
        denegado(await s.intentar("update serie_comprobante set ultimo_numero = 0"));
        denegado(
          await s.intentar(
            "insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero) values ($1, $2, $3, 9)",
            [a.m.empresa, a.m.emisor, a.m.sucursal],
          ),
        );
        denegado(await s.intentar("delete from punto_de_venta"));
        denegado(await s.intentar("delete from serie_comprobante"));
      });
    });

    it("sin un actor vigente la plataforma no ve ninguna fila fiscal (ni con el contexto de otro rol)", async () => {
      const sinContexto = await SesionDePrueba.abrir(base!, "zuluhub_plataforma", null);
      try {
        for (const tabla of ["emisor", "serie_comprobante"])
          expect(await contar(sinContexto, tabla), tabla).toBe(0);
        const r = await sinContexto.intentar("select id from punto_de_venta");
        expect(r.ok && r.rows).toEqual([]);
      } finally {
        await sinContexto.cerrar();
      }
      // El sistema (el barrido de altas vencidas) sí es un actor vigente: lee, pero no escribe.
      await conPlataformaDe(base!, "SISTEMA", async (s) => {
        expect(await contar(s, "emisor")).toBeGreaterThan(0);
        // La restrictiva exige un ADMIN: el cambio no alcanza ninguna fila.
        filas(await s.intentar("update emisor set activo = true where id = $1", [a.secundario]), 0);
      });
    });
  });

  describe("una empresa que no opera lee, pero no escribe", () => {
    const intentarEscribir = async (d: Datos) => {
      const nuevo = randomUUID();
      return conApp(d, async (s) => {
        // Lee todo lo suyo.
        for (const tabla of TABLAS_DE_LA_EMPRESA)
          expect(await contar(s, tabla), tabla).toBeGreaterThan(0);
        // Altas: la política exige empresa_operable.
        denegado(
          await s.intentar(
            "insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, 'c', '1', 'l', 'AR-S')",
            [d.m.empresa],
          ),
        );
        denegado(
          await s.intentar(
            "insert into datos_fiscales (id, empresa_id, emisor_id, creado_por) values ($1, $2, $3, $4)",
            [nuevo, d.m.empresa, d.secundario, d.m.persona],
          ),
        );
        denegado(
          await s.intentar("insert into regla_emisor (empresa_id, creado_por) values ($1, $2)", [
            d.m.empresa,
            d.m.persona,
          ]),
        );
        denegado(
          await s.intentar(
            "insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero) values ($1, $2, $3, 9)",
            [d.m.empresa, d.m.emisor, d.m.sucursal],
          ),
        );
        denegado(
          await s.intentar(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero)
             values ($1, $2, $3, 'FACTURA_A', 0)`,
            [d.m.empresa, d.pv, d.m.emisor],
          ),
        );
        // Cambios: 0 filas.
        filas(
          await s.intentar("update datos_fiscales set razon_social = 'X' where id = $1", [d.datos]),
          0,
        );
        filas(
          await s.intentar(
            "update regla_emisor set permitir_eleccion_manual = false where id = $1",
            [d.regla],
          ),
          0,
        );
        filas(
          await s.intentar("update punto_de_venta set estado = 'INACTIVO' where id = $1", [d.pv]),
          0,
        );
        filas(await s.intentar("update punto_de_venta set numero = 3 where id = $1", [d.pv]), 0);
        filas(
          await s.intentar(
            "update serie_comprobante set ultimo_numero = ultimo_numero where punto_de_venta_id = $1",
            [d.pv],
          ),
          0,
        );
      });
    };
    const operaDeNuevo = async (d: Datos) =>
      conApp(d, async (s) => {
        acepta(
          await s.intentar(
            "insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, 'c', '1', 'l', 'AR-S')",
            [d.m.empresa],
          ),
        );
        filas(
          await s.intentar("update punto_de_venta set numero = numero where id = $1", [d.pv]),
          1,
        );
      });

    it("con la empresa suspendida", async () => {
      const d = await sembrar();
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [d.m.empresa],
      );
      await intentarEscribir(d);
      await dueno.query(
        "update empresa set estado = 'ACTIVE', motivo_estado = null where id = $1",
        [d.m.empresa],
      );
      await operaDeNuevo(d);
    });

    it("con el tenant suspendido", async () => {
      const d = await sembrar();
      await dueno.query(
        "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [d.m.tenant],
      );
      await intentarEscribir(d);
      await dueno.query("update tenant set estado = 'ACTIVE', motivo_estado = null where id = $1", [
        d.m.tenant,
      ]);
      await operaDeNuevo(d);
    });
  });

  describe("cerrar una autorización", () => {
    it("deja la serie y la auditoría juntas o ninguna: una falla a mitad de camino revierte la serie", async () => {
      const m = await crearMundo(dueno);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_B", 41);
      await usarSerie(dueno, pv, "EN_CURSO");
      const otraPersona = (await crearMundo(dueno)).persona;
      const cerrar = (s: SesionDePrueba) =>
        s.directo(
          `update serie_comprobante set estado = 'LIBRE', ultimo_numero = numero_en_curso, numero_en_curso = null,
                  solicitud_en_curso = null, en_curso_hasta = null
            where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B' and estado = 'EN_CURSO'`,
          [pv],
        );
      const auditar = (s: SesionDePrueba, actor: string) =>
        s.directo(
          `insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id, despues)
           values ($1, $2, 'NUMERO_AUTORIZADO', 'serie_comprobante', $3, '{"numero":42}'::jsonb)`,
          [m.empresa, actor, pv],
        );
      const estadoDeLaSerie = async () =>
        (
          await dueno.query<{ estado: string; ultimo: string }>(
            "select estado, ultimo_numero::text as ultimo from serie_comprobante where punto_de_venta_id = $1",
            [pv],
          )
        ).rows[0];
      const auditorias = async () =>
        (await dueno.query("select 1 from auditoria_empresa where entidad_id = $1", [pv])).rowCount;

      // La auditoría falla (actor que no es el del contexto): se revierte también el cierre de la serie.
      const fallida = await SesionDePrueba.abrir(
        base!,
        "zuluhub_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
      );
      try {
        acepta(await cerrar(fallida));
        expect((await auditar(fallida, otraPersona)).ok).toBe(false);
        await fallida.deshacer();
      } finally {
        await fallida.cerrar();
      }
      expect(await estadoDeLaSerie()).toEqual({ estado: "EN_CURSO", ultimo: "41" });
      expect(await auditorias()).toBe(0);

      // Si todo sale bien, las dos cosas se confirman juntas.
      await conAppDe(base!, m, async (s) => {
        acepta(await cerrar(s));
        acepta(await auditar(s, m.persona));
        const confirmada = await s.confirmar();
        expect(confirmada.ok).toBe(true);
      });
      expect(await estadoDeLaSerie()).toEqual({ estado: "LIBRE", ultimo: "42" });
      expect(await auditorias()).toBe(1);
    });
  });
});
