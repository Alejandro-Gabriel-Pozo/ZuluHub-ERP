import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { traducirErrorDeBase } from "../../src/adaptadores/postgres/errores";
import {
  ERRORES_DE_FISCAL_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_FISCAL,
  errorFiscalDeRestriccion,
  traducirErroresDeFiscal,
  type ErrorDeFiscalPorRestriccion,
} from "../../src/modulos/fiscal/publico";
import { err } from "../../src/primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import { crearBaseAparte } from "./entorno";
import {
  RENGLON_DE_121,
  asegurarSerie,
  cerrarSerie,
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  datosDeLetraC,
  entrarEnValidacion,
  huellaAlAzar,
  insertarComprobante,
  marcarAutorizado,
  serieDe,
  type Contenido,
  type Ejecutor,
  type Escenario,
} from "./facturacion-apoyo";

/**
 * Facturación F3: la TRADUCCIÓN de cada restricción y cada disparador de 0009 a su motivo del dominio, contra la base REAL.
 *  1. Exhaustiva: toda restricción (y todo índice único) de las seis tablas de la facturación tiene su entrada en el mapa, no
 *     sobra ninguna, y los 11 errores con nombre de los disparadores son exactamente los de la lista. Si una migración agrega
 *     una restricción sin traducirla, o el mapa nombra una que no existe, esta prueba falla.
 *  2. Cada traducción que tiene motivo se fuerza con el error verdadero de la base (el mismo traductor del adaptador) y cae en
 *     su motivo; cada `NO_TRADUCIDA` de muestra sale tal cual, tipada, sin disfrazarse.
 * Base propia: los casos arman filas y se deshacen. El resto (privilegios, políticas, estados) es de las pruebas de F2.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS_DE_LA_FACTURACION = [
  "comprobante",
  "comprobante_linea",
  "comprobante_alicuota",
  "certificado_arca",
  "acceso_arca",
  "intento_arca",
] as const;

/** Las funciones de disparador de 0009 que lanzan errores de la facturación (con `CONSTRAINT = '...'`). */
const FUNCIONES_DE_LA_FACTURACION = [
  "comprobante_validar_alta",
  "comprobante_validar_cambio",
  "comprobante_verificar_serie",
  "comprobante_serie_con_reserva",
  "comprobante_verificar_cuadre",
  "comprobante_hijo_validar_alta",
  "certificado_arca_validar_alta",
  "certificado_arca_validar_cambio",
] as const;

const DISPARADORES_DE_LA_FACTURACION = RESTRICCIONES_DE_DISPARADORES_DE_FISCAL.filter((n) =>
  /^(comprobante|certificado)_/.test(n),
);

describe.skipIf(base === null)("facturación F3: la traducción de las restricciones de 0009", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let e: Escenario;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    e = await crearEscenario(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  // ===============================================================================================
  // 1. El mapa es el de la base
  // ===============================================================================================
  describe("el mapa de la facturación es el de la base", () => {
    it("toda restricción de las seis tablas tiene su traducción declarada, y no sobra ninguna (falla si aparece una nueva)", async () => {
      // `contype in (...)` deja afuera los NOT NULL que Postgres 18 lista (contype 'n') y 16 no.
      const reales = await filas<{ nombre: string }>(
        `select conname as nombre from pg_constraint
          where conrelid = any($1::text[]::regclass[]) and contype in ('p', 'u', 'c', 'f', 'x')
         union
         select indexname as nombre from pg_indexes
          where schemaname = 'public' and tablename = any($1)
            and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
        [[...TABLAS_DE_LA_FACTURACION]],
      );
      const existentes = new Set(reales.map((r) => r.nombre));
      const declaradas = new Set(Object.keys(ERRORES_DE_FISCAL_POR_RESTRICCION));
      const disparadores = new Set<string>(DISPARADORES_DE_LA_FACTURACION);
      expect(existentes.size).toBeGreaterThan(90);
      expect([...existentes].filter((n) => !declaradas.has(n)).sort(), "sin traducción").toEqual(
        [],
      );
      // Lo que el mapa declara de estas tablas (por prefijo) y no existe ni es un disparador, sobra.
      const deLaFacturacion = [...declaradas].filter((n) =>
        /^(comprobante|certificado|acceso|intento)_/.test(n),
      );
      expect(
        deLaFacturacion.filter((n) => !existentes.has(n) && !disparadores.has(n)).sort(),
        "traducciones de restricciones que no existen",
      ).toEqual([]);
    });

    it("los 11 nombres que lanzan los disparadores de la facturación son exactamente la lista, y cada uno tiene motivo", async () => {
      const cuerpos = await filas<{ prosrc: string }>(
        `select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`,
        [[...FUNCIONES_DE_LA_FACTURACION]],
      );
      expect(cuerpos).toHaveLength(FUNCIONES_DE_LA_FACTURACION.length);
      const lanzadas = new Set<string>();
      for (const { prosrc } of cuerpos) {
        for (const m of prosrc.matchAll(/CONSTRAINT = '([a-z_]+)'/g)) lanzadas.add(m[1] as string);
      }
      expect([...lanzadas].sort()).toEqual([...DISPARADORES_DE_LA_FACTURACION].sort());
      expect(lanzadas.size).toBe(11);
      for (const nombre of lanzadas) {
        const motivo = (ERRORES_DE_FISCAL_POR_RESTRICCION as Record<string, string>)[nombre];
        expect(motivo, nombre).toBeDefined();
        expect(motivo, nombre).not.toBe("NO_TRADUCIDA");
      }
    });

    it("los nombres de los disparadores no se confunden con una restricción del catálogo", async () => {
      const reales = await filas<{ nombre: string }>(
        `select conname as nombre from pg_constraint
          where conrelid = any($1::text[]::regclass[]) and contype in ('p', 'u', 'c', 'f', 'x')`,
        [[...TABLAS_DE_LA_FACTURACION]],
      );
      const existentes = new Set(reales.map((r) => r.nombre));
      for (const nombre of DISPARADORES_DE_LA_FACTURACION)
        expect(existentes.has(nombre), nombre).toBe(false);
    });
  });

  // ===============================================================================================
  // 2. Cada traducción, forzada con el error real
  // ===============================================================================================
  type Caso = Readonly<{
    restriccion: string;
    tipo: ErrorDePersistencia["tipo"];
    provocar: () => Promise<ErrorDePersistencia>;
  }>;

  /**
   * Corre la acción en una transacción del dueño que SIEMPRE se deshace y devuelve el primer error de la base, ya
   * traducido por el mismo traductor del adaptador. Si nada falla, evalúa las restricciones diferidas (`set constraints all
   * immediate`) y devuelve la que salte. Sin ningún error, la prueba falla.
   */
  async function provocar(
    accion: (ej: Ejecutor) => Promise<unknown>,
    opciones: { sinAlta?: boolean } = {},
  ): Promise<ErrorDePersistencia> {
    let primero: unknown = null;
    const ej: Ejecutor = async (texto, parametros = []) => {
      try {
        const r = await dueno.query(texto, parametros);
        return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
      } catch (error) {
        primero ??= error;
        const x = error as { code?: string; constraint?: string; message?: string };
        return {
          ok: false,
          codigo: x.code ?? "?",
          restriccion: x.constraint,
          mensaje: x.message ?? "",
        };
      }
    };
    await dueno.query("begin");
    try {
      // El disparador de alta corre antes que los CHECK: para probarlos solos se apaga (dentro de la transacción).
      if (opciones.sinAlta === true) {
        await dueno.query("alter table comprobante disable trigger comprobante_alta");
      }
      await accion(ej);
      if (primero === null) {
        try {
          await dueno.query("set constraints all immediate");
        } catch (error) {
          primero = error;
        }
      }
    } finally {
      await dueno.query("rollback");
    }
    const traducido = traducirErrorDeBase(primero);
    if (traducido === null) throw new Error("la base tenía que rechazar y no lo hizo");
    return traducido;
  }

  /** Inserta un comprobante completo con esos cambios (y renglones/desglose opcionales) en la acción. */
  const insertando =
    (
      cambios: Contenido,
      opciones: {
        x?: Escenario;
        letraC?: boolean;
        renglones?: Parameters<typeof insertarComprobante>[2];
        desglose?: Parameters<typeof insertarComprobante>[3];
      } = {},
    ) =>
    async (ej: Ejecutor) => {
      const x = opciones.x ?? e;
      const datos =
        opciones.letraC === true ? datosDeLetraC(x, cambios) : datosDeComprobante(x, cambios);
      await insertarComprobante(ej, datos, opciones.renglones, opciones.desglose);
    };
  const unaSerie = (x: Escenario) => serieDe(x);

  const certificadoSql = `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem,
                                                         clave_cifrada, clave_nonce, clave_etiqueta, clave_kid, creado_por)
                          values ($1, $2, $3, $4, $5, $6, 'P', $7, $8, $9, 'k1', $10)`;
  const certificado = (
    x: Escenario,
    cambios: Partial<
      Record<"id" | "empresa" | "emisor" | "ambiente" | "alias" | "cuit" | "persona", string>
    > = {},
  ) => [
    cambios.id ?? randomUUID(),
    cambios.empresa ?? x.empresa,
    cambios.emisor ?? x.emisor,
    cambios.ambiente ?? "HOMOLOGACION",
    cambios.alias ?? "abc123",
    cambios.cuit ?? x.cuit,
    randomBytes(8),
    randomBytes(12),
    randomBytes(16),
    cambios.persona ?? x.persona,
  ];
  const cargarSql = `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'C', huella_sha256 = $2,
                            vence_en = now() + interval '1 year' where id = $1`;

  const casos: readonly Caso[] = [
    // ---- comprobante: claves foráneas ------------------------------------------------------------------
    {
      restriccion: "comprobante_empresa_id_fkey",
      tipo: "Referencia",
      provocar: () => provocar(insertando({ empresa_id: randomUUID() })),
    },
    {
      restriccion: "comprobante_creado_por_fkey",
      tipo: "Referencia",
      provocar: () => provocar(insertando({ creado_por: randomUUID() })),
    },
    {
      restriccion: "comprobante_emisor_fkey",
      tipo: "Referencia",
      provocar: () => provocar(insertando({ emisor_id: randomUUID() })),
    },
    {
      restriccion: "comprobante_pv_fkey",
      tipo: "Referencia",
      provocar: () => provocar(insertando({ punto_de_venta_id: randomUUID() })),
    },
    {
      restriccion: "comprobante_datos_fiscales_fkey",
      tipo: "Referencia",
      provocar: () => provocar(insertando({ datos_fiscales_id: randomUUID() })),
    },
    {
      restriccion: "comprobante_asociado_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(
          insertando({
            clase: "NOTA_CREDITO",
            tipo_comprobante: "NOTA_CREDITO_B",
            comprobante_asociado_id: randomUUID(),
            motivo: "x",
          }),
        ),
    },
    // ---- comprobante: CHECK (con el disparador de alta apagado para que se prueben solos) ----------------
    ...(
      [
        ["comprobante_origen_id_ck", { origen_id: " x" }],
        ["comprobante_tipo_ck", { tipo_comprobante: "FACTURA_Z", clase: "FACTURA" }],
        ["comprobante_servicio_ck", { concepto: "SERVICIOS" }],
        ["comprobante_emisor_cuit_ck", { emisor_cuit: "20123456787" }],
        ["comprobante_emisor_razon_social_ck", { emisor_razon_social: " Mi SA" }],
        ["comprobante_emisor_condicion_ck", { emisor_condicion_iva: "CONSUMIDOR_FINAL" }],
        ["comprobante_emisor_inicio_ck", { emisor_inicio_actividades: "0001-12-31 BC" }],
        ["comprobante_emisor_iibb_numero_ck", { emisor_iibb_numero: "  " }],
        ["comprobante_emisor_iibb_condicion_ck", { emisor_iibb_condicion: "OTRA" }],
        ["comprobante_pv_numero_ck", { punto_de_venta_numero: 0 }],
        [
          "comprobante_receptor_nombre_ck",
          {
            receptor_nombre: "Ana ",
            receptor_documento_tipo: "DNI",
            receptor_documento_numero: "30111222",
          },
        ],
        ["comprobante_receptor_domicilio_ck", { receptor_domicilio: "x".repeat(301) }],
        [
          "comprobante_receptor_documento_ck",
          {
            receptor_documento_tipo: "DNI",
            receptor_documento_numero: "30A11222",
            receptor_nombre: "Ana",
          },
        ],
        ["comprobante_motivo_ck", { motivo: "porque sí" }],
      ] as const
    ).map(([restriccion, cambios]): Caso => ({
      restriccion,
      tipo: "Check",
      provocar: () => provocar(insertando({ ...cambios }), { sinAlta: true }),
    })),
    {
      restriccion: "comprobante_modo_c_ck",
      tipo: "Check",
      provocar: () =>
        provocar(
          insertando(
            { modo_de_precio: "IVA_DISCRIMINADO" },
            { letraC: true, renglones: [], desglose: [] },
          ),
          {
            sinAlta: true,
          },
        ),
    },
    // ---- comprobante: descartar sin motivo -----------------------------------------------------------------
    {
      restriccion: "comprobante_descarte_ck",
      tipo: "Check",
      provocar: async () => {
        const id = await crearComprobante(dueno, e);
        return provocar(async (ej) => {
          await ej(
            "update comprobante set estado = 'DESCARTADO', motivo_descarte = ' ' where id = $1",
            [id],
          );
        });
      },
    },
    // ---- comprobante: únicas ---------------------------------------------------------------------------------
    {
      restriccion: "comprobante_identidad_uk",
      tipo: "Unicidad",
      provocar: () => {
        const origen = { origen_tipo: "SUSCRIPCION", origen_id: `s-${randomUUID()}` };
        return provocar(async (ej) => {
          await insertando(origen)(ej);
          await insertando(origen)(ej);
        });
      },
    },
    {
      restriccion: "comprobante_manual_uk",
      tipo: "Unicidad",
      provocar: async () => {
        const origen = { origen_id: `m-${randomUUID()}` };
        const id = await crearComprobante(dueno, e, origen);
        // Descartado: libera la identidad vigente, pero la clave manual sigue tomada.
        await dueno.query(
          "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'x' where id = $1",
          [id],
        );
        return provocar(insertando(origen));
      },
    },
    {
      restriccion: "comprobante_numero_uk",
      tipo: "Unicidad",
      provocar: async () => {
        const x = await crearEscenario(dueno);
        const uno = await crearComprobante(dueno, x);
        const dos = await crearComprobante(dueno, x);
        return provocar(async (ej) => {
          for (const id of [uno, dos]) {
            await entrarEnValidacion(ej, id, "5");
            await marcarAutorizado(ej, id);
          }
        });
      },
    },
    {
      restriccion: "comprobante_en_vuelo_uk",
      tipo: "Unicidad",
      provocar: async () => {
        const x = await crearEscenario(dueno);
        const uno = await crearComprobante(dueno, x);
        const dos = await crearComprobante(dueno, x);
        return provocar(async (ej) => {
          await entrarEnValidacion(ej, uno, "1");
          await entrarEnValidacion(ej, dos, "2");
        });
      },
    },
    // ---- comprobante: disparadores -----------------------------------------------------------------------------
    {
      restriccion: "comprobante_alta_invalida",
      tipo: "Check",
      provocar: () => provocar(insertando({ envios: 1 })),
    },
    {
      restriccion: "comprobante_asociado_invalido",
      tipo: "Check",
      provocar: async () => {
        const x = await crearEscenario(dueno);
        const pendiente = await crearComprobante(dueno, x);
        return provocar(
          insertando(
            {
              clase: "NOTA_CREDITO",
              tipo_comprobante: "NOTA_CREDITO_B",
              comprobante_asociado_id: pendiente,
              motivo: "x",
            },
            { x },
          ),
        );
      },
    },
    {
      restriccion: "comprobante_inmutable",
      tipo: "Check",
      provocar: async () => {
        const id = await crearComprobante(dueno, e);
        return provocar(async (ej) => {
          await ej("update comprobante set receptor_nombre = 'Otro' where id = $1", [id]);
        });
      },
    },
    {
      restriccion: "comprobante_transicion_invalida",
      tipo: "Check",
      provocar: async () => {
        const id = await crearComprobante(dueno, e);
        return provocar(async (ej) => {
          await ej("update comprobante set estado = 'RECHAZADO' where id = $1", [id]);
        });
      },
    },
    {
      restriccion: "comprobante_sin_reserva",
      tipo: "Check",
      provocar: async () => {
        const x = await crearEscenario(dueno);
        const id = await crearComprobante(dueno, x);
        return provocar(async (ej) => {
          await entrarEnValidacion(ej, id, "1");
        });
      },
    },
    {
      restriccion: "comprobante_serie_sin_reserva",
      tipo: "Check",
      provocar: async () => {
        const x = await crearEscenario(dueno);
        const id = await crearComprobante(dueno, x);
        const serie = unaSerie(x);
        // Preparado y confirmado: el comprobante EN_VALIDACION con su número reservado en la serie.
        await dueno.query("begin");
        await asegurarSerie(
          (t, p = []) =>
            dueno
              .query(t, p)
              .then((r) => ({
                ok: true as const,
                filas: r.rowCount ?? 0,
                rows: r.rows as Record<string, unknown>[],
              })),
          serie,
        );
        await dueno.query(
          `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = 1, solicitud_en_curso = $2, en_curso_hasta = now() + interval '5 minutes'
            where punto_de_venta_id = $1`,
          [x.pv, id],
        );
        await dueno.query(
          "update comprobante set estado = 'EN_VALIDACION', envios = 1, numero_reservado = 1, fecha_emision = current_date where id = $1",
          [id],
        );
        await dueno.query("commit");
        // La serie suelta la reserva sin resolver el comprobante.
        return provocar(async (ej) => {
          await cerrarSerie(ej, serie, true);
        });
      },
    },
    {
      restriccion: "comprobante_descuadrado",
      tipo: "Check",
      provocar: () =>
        provocar(insertando({}, { renglones: [{ ...RENGLON_DE_121, importe: "120.00" }] })),
    },
    // ---- renglones y desglose -----------------------------------------------------------------------------------
    {
      restriccion: "comprobante_linea_empresa_id_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, importe)
               values ($1, $2, 1, 'x', 1, 1, 1)`,
            [randomUUID(), randomUUID()],
          );
        }),
    },
    {
      restriccion: "comprobante_linea_comprobante_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, importe)
               values ($1, $2, 1, 'x', 1, 1, 1)`,
            [e.empresa, randomUUID()],
          );
        }),
    },
    ...(
      [
        ["comprobante_linea_posicion_ck", { posicion: 201 }],
        ["comprobante_linea_descripcion_ck", { descripcion: "" }],
        ["comprobante_linea_cantidad_ck", { cantidad: "0.0000" }],
        ["comprobante_linea_precio_ck", { precio_unitario: "-1.000000" }],
      ] as const
    ).map(([restriccion, cambios]): Caso => ({
      restriccion,
      tipo: "Check",
      provocar: () => provocar(insertando({}, { renglones: [{ ...RENGLON_DE_121, ...cambios }] })),
    })),
    {
      restriccion: "comprobante_linea_tardia",
      tipo: "Check",
      provocar: async () => {
        const id = await crearComprobante(dueno, e);
        return provocar(async (ej) => {
          await ej(
            `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, importe)
               values ($1, $2, 2, 'tarde', 1, 1, 1)`,
            [e.empresa, id],
          );
        });
      },
    },
    {
      restriccion: "comprobante_alicuota_empresa_id_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva) values ($1, $2, '21', 1, 1, 0)`,
            [randomUUID(), randomUUID()],
          );
        }),
    },
    {
      restriccion: "comprobante_alicuota_comprobante_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva) values ($1, $2, '21', 1, 1, 0)`,
            [e.empresa, randomUUID()],
          );
        }),
    },
    {
      restriccion: "comprobante_alicuota_tardia",
      tipo: "Check",
      provocar: async () => {
        const id = await crearComprobante(dueno, e);
        return provocar(async (ej) => {
          await ej(
            `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva) values ($1, $2, '10.5', 1, 1, 0)`,
            [e.empresa, id],
          );
        });
      },
    },
    // ---- certificados ----------------------------------------------------------------------------------------------
    ...(
      [
        ["certificado_arca_empresa_id_fkey", { empresa: randomUUID() }],
        ["certificado_arca_creado_por_fkey", { persona: randomUUID() }],
        ["certificado_emisor_fkey", { emisor: randomUUID() }],
      ] as const
    ).map(([restriccion, cambios]): Caso => ({
      restriccion,
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(certificadoSql, certificado(e, cambios));
        }),
    })),
    {
      restriccion: "certificado_alias_ck",
      tipo: "Check",
      provocar: () =>
        provocar(async (ej) => {
          await ej(certificadoSql, certificado(e, { alias: "con espacios" }));
        }),
    },
    {
      restriccion: "certificado_cuit_titular_ck",
      tipo: "Check",
      provocar: () =>
        provocar(async (ej) => {
          await ej(certificadoSql, certificado(e, { cuit: "20123456787" }));
        }),
    },
    {
      restriccion: "certificado_pem_ck",
      tipo: "Check",
      provocar: async () => {
        const id = randomUUID();
        await dueno.query(certificadoSql, certificado(e, { id }));
        return provocar(async (ej) => {
          await ej(
            `update certificado_arca set estado = 'VIGENTE', certificado_pem = $2, huella_sha256 = $3, vence_en = now() where id = $1`,
            [id, "x".repeat(16385), huellaAlAzar()],
          );
        });
      },
    },
    {
      restriccion: "certificado_vigente_uk",
      tipo: "Unicidad",
      provocar: async () => {
        const x = await crearEscenario(dueno);
        const ids = [randomUUID(), randomUUID()];
        for (const id of ids) await dueno.query(certificadoSql, certificado(x, { id }));
        return provocar(async (ej) => {
          for (const id of ids) await ej(cargarSql, [id, huellaAlAzar()]);
        });
      },
    },
    {
      restriccion: "certificado_huella_uk",
      tipo: "Unicidad",
      provocar: async () => {
        const x = await crearEscenario(dueno);
        const homologacion = randomUUID();
        const produccion = randomUUID();
        await dueno.query(certificadoSql, certificado(x, { id: homologacion }));
        await dueno.query(
          certificadoSql,
          certificado(x, { id: produccion, ambiente: "PRODUCCION" }),
        );
        const huella = huellaAlAzar();
        await dueno.query(cargarSql, [homologacion, huella]);
        return provocar(async (ej) => {
          await ej(cargarSql, [produccion, huella]);
        });
      },
    },
    {
      restriccion: "certificado_transicion_invalida",
      tipo: "Check",
      provocar: async () => {
        const id = randomUUID();
        await dueno.query(certificadoSql, certificado(e, { id }));
        return provocar(async (ej) => {
          await ej("update certificado_arca set estado = 'REEMPLAZADO' where id = $1", [id]);
        });
      },
    },
    {
      restriccion: "certificado_inmutable",
      tipo: "Check",
      provocar: async () => {
        const id = randomUUID();
        await dueno.query(certificadoSql, certificado(e, { id }));
        return provocar(async (ej) => {
          await ej("update certificado_arca set alias = 'otro' where id = $1", [id]);
        });
      },
    },
    // ---- accesos e intentos ------------------------------------------------------------------------------------------
    {
      restriccion: "acceso_arca_empresa_id_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [randomUUID(), randomUUID()],
          );
        }),
    },
    {
      restriccion: "acceso_certificado_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [e.empresa, randomUUID()],
          );
        }),
    },
    {
      restriccion: "intento_arca_empresa_id_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            `insert into intento_arca (empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms)
               values ($1, $2, 'AUTORIZAR', 'AUTORIZADO', now(), 1)`,
            [randomUUID(), randomUUID()],
          );
        }),
    },
    {
      restriccion: "intento_comprobante_fkey",
      tipo: "Referencia",
      provocar: () =>
        provocar(async (ej) => {
          await ej(
            `insert into intento_arca (empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms)
               values ($1, $2, 'AUTORIZAR', 'AUTORIZADO', now(), 1)`,
            [e.empresa, randomUUID()],
          );
        }),
    },
  ];

  // Las que tienen un motivo en el mapa de las seis tablas (restricciones y disparadores).
  const CON_MOTIVO = Object.entries(ERRORES_DE_FISCAL_POR_RESTRICCION)
    .filter(
      ([n, v]) => /^(comprobante|certificado|acceso|intento)_/.test(n) && v !== "NO_TRADUCIDA",
    )
    .map(([n]) => n);

  describe("cada traducción de la facturación, forzada con el error real de la base", () => {
    it("los casos cubren exactamente las restricciones con motivo, una vez cada una", () => {
      expect(casos.map((c) => c.restriccion).sort()).toEqual([...CON_MOTIVO].sort());
      expect(new Set(casos.map((c) => c.restriccion)).size).toBe(casos.length);
      // Las 11 de los disparadores están entre ellas.
      for (const n of DISPARADORES_DE_LA_FACTURACION) {
        expect(
          casos.some((c) => c.restriccion === n),
          n,
        ).toBe(true);
      }
    });

    for (const caso of casos) {
      const motivo = (ERRORES_DE_FISCAL_POR_RESTRICCION as Record<string, string>)[
        caso.restriccion
      ];
      it(`${caso.restriccion} → ${motivo ?? "?"}`, async () => {
        const error = await caso.provocar();
        // La base lanzó exactamente esa restricción...
        expect(error).toEqual({ tipo: caso.tipo, restriccion: caso.restriccion });
        // ...el mapa la traduce a su motivo...
        expect(errorFiscalDeRestriccion(error)).toBe(motivo);
        const esperado = motivo as ErrorDeFiscalPorRestriccion;
        // ...el caso de uso que la admite recibe un Resultado con nombre, nunca una excepción cruda...
        expect(traducirErroresDeFiscal(err(error), [esperado])).toEqual(err(esperado));
        // ...y el que no la admite recibe el error de persistencia tipado, intacto.
        expect(traducirErroresDeFiscal(err(error), [])).toEqual(err(error));
      });
    }
  });

  describe("las restricciones sin motivo (NO_TRADUCIDA) salen tal cual, tipadas", () => {
    const sinMotivo: readonly (readonly [string, Contenido])[] = [
      ["comprobante_ambiente_ck", { ambiente: "PRUEBAS" }],
      ["comprobante_origen_tipo_ck", { origen_tipo: "VENTA" }],
      ["comprobante_concepto_ck", { concepto: "OTRO" }],
      ["comprobante_moneda_ck", { moneda: "USD" }],
      ["comprobante_modo_ck", { modo_de_precio: "NETO" }],
      ["comprobante_importes_ck", { iva: "20.00" }],
      ["comprobante_receptor_condicion_ck", { receptor_condicion_iva: "MONO" }],
      ["comprobante_huella_ck", { huella: "abc" }],
      ["comprobante_envios_ck", { envios: -1 }],
      ["comprobante_reserva_ck", { numero_reservado: "5", fecha_emision: "2026-10-13" }],
    ];

    it.each(sinMotivo)("%s", async (restriccion, cambios) => {
      expect((ERRORES_DE_FISCAL_POR_RESTRICCION as Record<string, string>)[restriccion]).toBe(
        "NO_TRADUCIDA",
      );
      const error = await provocar(insertando({ ...cambios }), { sinAlta: true });
      expect(error).toEqual({ tipo: "Check", restriccion });
      expect(errorFiscalDeRestriccion(error)).toBeNull();
      const original = err(error);
      expect(
        traducirErroresDeFiscal(original, ["COMPROBANTE_ALTA_INVALIDA", "COMPROBANTE_DESCUADRADO"]),
      ).toBe(original);
    });

    it("el alta de un id repetido no llega a la base como error: la absorbe el repositorio (comprobante_pkey es NO_TRADUCIDA)", () => {
      expect(
        (ERRORES_DE_FISCAL_POR_RESTRICCION as Record<string, string>)["comprobante_pkey"],
      ).toBe("NO_TRADUCIDA");
      expect((ERRORES_DE_FISCAL_POR_RESTRICCION as Record<string, string>)["acceso_pkey"]).toBe(
        "NO_TRADUCIDA",
      );
    });
  });
});
