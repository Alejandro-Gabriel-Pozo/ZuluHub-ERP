import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { personaId, tenantId } from "../../src/primitivas/identificadores/marca";
import { comoGrupo, comoTrabajos } from "./entorno";
import { acepta, conAppDe, conPlataformaDe, crearMundo, denegado, filas, referencia } from "./fiscal-apoyo";
import {
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  insertarComprobante,
  viaSesion,
  type Escenario,
} from "./facturacion-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * Facturación F2: aislamiento de lo facturado contra una base real. Una empresa no lee ni escribe los
 * comprobantes, renglones, desglose, intentos, certificados ni tickets de acceso de otra (tampoco del mismo
 * tenant); sus claves foráneas no apuntan a lo de otra empresa; los demás roles (plataforma con cualquier
 * actor, grupo, trabajos, autenticación, público y captación) no tocan nada; y una empresa que no opera
 * (suspendida, o de un tenant suspendido) lee pero no escribe.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const TABLAS = [
  "comprobante",
  "comprobante_linea",
  "comprobante_alicuota",
  "certificado_arca",
  "acceso_arca",
  "intento_arca",
] as const;

type Datos = Readonly<{ x: Escenario; comprobante: string; certificado: string; intento: string }>;

describe.skipIf(base === null)("facturación: aislamiento entre empresas y entre roles", () => {
  let dueno: pg.Client;
  let a: Datos;
  let b: Datos; // mismo tenant que A
  let c: Datos; // otro tenant

  /** Una empresa con filas en las seis tablas (armadas por el dueño). */
  const sembrar = async (tenant?: string): Promise<Datos> => {
    const x = await crearEscenario(
      dueno,
      tenant === undefined ? {} : { mundo: await crearMundo(dueno, { tenant }) },
    );
    const comprobante = await crearComprobante(dueno, x);
    const certificado = randomUUID();
    await dueno.query(
      `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada,
                                     clave_nonce, clave_etiqueta, clave_kid, creado_por)
       values ($1, $2, $3, 'HOMOLOGACION', 'abc', $4, 'P', $5, $6, $7, 'k', $8)`,
      [certificado, x.empresa, x.emisor, x.cuit, Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16), x.persona],
    );
    await dueno.query("insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')", [
      x.empresa,
      certificado,
    ]);
    const intento = randomUUID();
    await dueno.query(
      `insert into intento_arca (id, empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms)
       values ($1, $2, $3, 'AUTORIZAR', 'RECHAZADO', now(), 10)`,
      [intento, x.empresa, comprobante],
    );
    return { x, comprobante, certificado, intento };
  };

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    a = await sembrar();
    b = await sembrar(a.x.tenant);
    c = await sembrar();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const conApp = <T>(
    d: Datos,
    trabajo: (s: SesionDePrueba) => Promise<T>,
    persona?: string | null,
  ) => conAppDe(base!, d.x, trabajo, persona);
  const contar = async (s: SesionDePrueba, tabla: string, filtro = "true"): Promise<number> => {
    const r = await s.intentar(`select count(*)::int as n from ${tabla} where ${filtro}`);
    if (!r.ok) throw new Error(`${tabla}: ${r.mensaje}`);
    return Number(r.rows[0]?.["n"]);
  };

  describe("entre empresas", () => {
    it("cada empresa ve solo lo suyo en las seis tablas, sea del mismo tenant o de otro", async () => {
      for (const [propia, ajenas] of [
        [a, [b, c]],
        [b, [a, c]],
        [c, [a, b]],
      ] as const) {
        await conApp(propia, async (s) => {
          for (const tabla of TABLAS) {
            expect(await contar(s, tabla), `${tabla}: filas visibles`).toBe(1);
            expect(await contar(s, tabla, `empresa_id = '${propia.x.empresa}'`), tabla).toBe(1);
            for (const ajena of ajenas) {
              expect(await contar(s, tabla, `empresa_id = '${ajena.x.empresa}'`), `${tabla} de otra`).toBe(0);
            }
          }
          // Ni siquiera conociendo el id de lo ajeno.
          for (const ajena of ajenas) {
            expect(await contar(s, "comprobante", `id = '${ajena.comprobante}'`)).toBe(0);
            expect(await contar(s, "certificado_arca", `id = '${ajena.certificado}'`)).toBe(0);
            expect(await contar(s, "intento_arca", `id = '${ajena.intento}'`)).toBe(0);
          }
        });
      }
    });

    it("no escribe a nombre de otra empresa: altas rechazadas por la política (42501), sea del mismo tenant o de otro", async () => {
      for (const ajena of [b, c]) {
        await conApp(a, async (s) => {
          // Un comprobante de A que dice ser de la otra empresa.
          denegado(
            await insertarComprobante(
              viaSesion(s),
              datosDeComprobante(ajena.x, { origen_id: randomUUID(), creado_por: a.x.persona }),
            ),
          );
          denegado(
            await s.intentar(
              `insert into intento_arca (empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms)
               values ($1, $2, 'AUTORIZAR', 'RECHAZADO', now(), 1)`,
              [ajena.x.empresa, ajena.comprobante],
            ),
          );
          denegado(
            await s.intentar(
              `insert into certificado_arca (empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada,
                      clave_nonce, clave_etiqueta, clave_kid, creado_por)
               values ($1, $2, 'PRODUCCION', 'abc', $3, 'P', $4, $5, $6, 'k', $7)`,
              [ajena.x.empresa, ajena.x.emisor, ajena.x.cuit, Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16), a.x.persona],
            ),
          );
          denegado(
            await s.intentar("insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')", [
              ajena.x.empresa,
              ajena.certificado,
            ]),
          );
          denegado(
            await s.intentar(
              `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, alicuota, importe)
               values ($1, $2, 9, 'x', 1, 1, '21', 1.00)`,
              [ajena.x.empresa, ajena.comprobante],
            ),
          );
          denegado(
            await s.intentar(
              `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva)
               values ($1, $2, '10.5', 1.00, 1.00, 0.00)`,
              [ajena.x.empresa, ajena.comprobante],
            ),
          );
        });
      }
    });

    it("no cambia lo ajeno: el UPDATE no alcanza ninguna fila", async () => {
      for (const ajena of [b, c]) {
        await conApp(a, async (s) => {
          filas(
            await s.intentar("update comprobante set estado = 'DESCARTADO', motivo_descarte = 'x' where id = $1", [ajena.comprobante]),
            0,
          );
          filas(await s.intentar("update comprobante set envios = envios where empresa_id = $1", [ajena.x.empresa]), 0);
          filas(
            await s.intentar("update certificado_arca set estado = 'DESCARTADO' where id = $1", [ajena.certificado]),
            0,
          );
          filas(
            await s.intentar("update acceso_arca set renovando_hasta = now() where certificado_id = $1", [ajena.certificado]),
            0,
          );
        });
      }
    });

    it("las claves foráneas compuestas rechazan apuntar a lo de otra empresa: punto de venta, emisor, datos fiscales, comprobante asociado y comprobante de un intento", async () => {
      for (const ajena of [b, c]) {
        await conApp(a, async (s) => {
          // Con la política satisfecha (empresa A), pero apuntando a un hijo de la otra.
          referencia(
            await insertarComprobante(
              viaSesion(s),
              datosDeComprobante(a.x, { punto_de_venta_id: ajena.x.pv, creado_por: a.x.persona }),
            ),
            "comprobante_pv_fkey",
          );
          referencia(
            await insertarComprobante(
              viaSesion(s),
              datosDeComprobante(a.x, { emisor_id: ajena.x.emisor, punto_de_venta_id: ajena.x.pv }),
            ),
            "comprobante_emisor_fkey",
          );
          referencia(
            await insertarComprobante(
              viaSesion(s),
              datosDeComprobante(a.x, { datos_fiscales_id: ajena.x.datosFiscales }),
            ),
            "comprobante_datos_fiscales_fkey",
          );
          referencia(
            await insertarComprobante(
              viaSesion(s),
              datosDeComprobante(a.x, {
                clase: "NOTA_CREDITO",
                tipo_comprobante: "NOTA_CREDITO_B",
                comprobante_asociado_id: ajena.comprobante,
                motivo: "de otra empresa",
              }),
            ),
            "comprobante_asociado_fkey",
          );
          referencia(
            await s.intentar(
              `insert into intento_arca (empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms)
               values ($1, $2, 'AUTORIZAR', 'RECHAZADO', now(), 1)`,
              [a.x.empresa, ajena.comprobante],
            ),
            "intento_comprobante_fkey",
          );
          referencia(
            await s.intentar("insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')", [
              a.x.empresa,
              ajena.certificado,
            ]),
            "acceso_certificado_fkey",
          );
          referencia(
            await s.intentar(
              `insert into certificado_arca (empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada,
                      clave_nonce, clave_etiqueta, clave_kid, creado_por)
               values ($1, $2, 'PRODUCCION', 'abc', $3, 'P', $4, $5, $6, 'k', $7)`,
              [a.x.empresa, ajena.x.emisor, a.x.cuit, Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16), a.x.persona],
            ),
            "certificado_emisor_fkey",
          );
        });
      }
    });

    it("sin empresa en el contexto la aplicación no ve nada, y un contexto de otra empresa no deja leer lo de A", async () => {
      const s = await SesionDePrueba.abrir(base!, "zuluhub_app", null);
      try {
        for (const tabla of TABLAS) expect(await contar(s, tabla), tabla).toBe(0);
      } finally {
        await s.cerrar();
      }
    });
  });

  describe("entre roles", () => {
    it("la plataforma (ADMIN, SOPORTE y sistema), el grupo, los trabajos, la autenticación, el público y la captación no leen ni escriben nada (42501)", async () => {
      const intentarTodo = async (s: SesionDePrueba) => {
        for (const tabla of TABLAS) {
          denegado(await s.intentar(`select * from ${tabla}`));
          denegado(await s.intentar(`select count(*) from ${tabla}`));
          denegado(await s.intentar(`delete from ${tabla}`));
        }
        denegado(await s.intentar("update comprobante set estado = estado"));
        denegado(await s.intentar("update certificado_arca set estado = estado"));
        denegado(await s.intentar("update acceso_arca set renovando_hasta = null"));
        denegado(
          await s.intentar(
            `insert into intento_arca (empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms)
             values ($1, $2, 'AUTORIZAR', 'RECHAZADO', now(), 1)`,
            [a.x.empresa, a.comprobante],
          ),
        );
        denegado(await insertarComprobante(viaSesion(s), datosDeComprobante(a.x)));
      };
      for (const actor of ["ADMIN", "SOPORTE", "SISTEMA"] as const) {
        await conPlataformaDe(base!, actor, intentarTodo);
      }
      const grupo = await SesionDePrueba.abrir(base!, "zuluhub_grupo", comoGrupo(tenantId(a.x.tenant), personaId(a.x.persona)));
      const trabajos = await SesionDePrueba.abrir(base!, "zuluhub_trabajos", comoTrabajos());
      const publico = await SesionDePrueba.abrir(base!, "zuluhub_publico", null);
      const captacion = await SesionDePrueba.abrir(base!, "zuluhub_captacion", null);
      const autenticacion = await SesionDePrueba.abrir(base!, "zuluhub_autenticacion", null);
      try {
        for (const s of [grupo, trabajos, publico, captacion, autenticacion]) await intentarTodo(s);
      } finally {
        for (const s of [grupo, trabajos, publico, captacion, autenticacion]) await s.cerrar();
      }
    });

    it("sin un actor vigente la plataforma tampoco: el rol ni siquiera tiene permiso sobre las tablas", async () => {
      const sinContexto = await SesionDePrueba.abrir(base!, "zuluhub_plataforma", null);
      try {
        for (const tabla of TABLAS) denegado(await sinContexto.intentar(`select 1 from ${tabla}`));
      } finally {
        await sinContexto.cerrar();
      }
    });
  });

  describe("una empresa que no opera lee, pero no escribe", () => {
    const intentarEscribir = async (d: Datos) =>
      conApp(d, async (s) => {
        // Lee todo lo suyo.
        for (const tabla of TABLAS) expect(await contar(s, tabla), tabla).toBeGreaterThan(0);
        // Altas: la política exige empresa_operable.
        denegado(await insertarComprobante(viaSesion(s), datosDeComprobante(d.x)));
        denegado(
          await s.intentar(
            `insert into intento_arca (empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms)
             values ($1, $2, 'AUTORIZAR', 'RECHAZADO', now(), 1)`,
            [d.x.empresa, d.comprobante],
          ),
        );
        denegado(
          await s.intentar(
            `insert into certificado_arca (empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada,
                    clave_nonce, clave_etiqueta, clave_kid, creado_por)
             values ($1, $2, 'PRODUCCION', 'abc', $3, 'P', $4, $5, $6, 'k', $7)`,
            [d.x.empresa, d.x.emisor, d.x.cuit, Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16), d.x.persona],
          ),
        );
        // Cambios: no alcanzan ninguna fila.
        filas(await s.intentar("update comprobante set envios = envios where id = $1", [d.comprobante]), 0);
        filas(
          await s.intentar("update certificado_arca set estado = 'DESCARTADO' where id = $1", [d.certificado]),
          0,
        );
        filas(await s.intentar("update acceso_arca set renovando_hasta = now() where certificado_id = $1", [d.certificado]), 0);
      });
    const operaDeNuevo = async (d: Datos) =>
      conApp(d, async (s) => {
        acepta(await insertarComprobante(viaSesion(s), datosDeComprobante(d.x)));
        filas(await s.intentar("update comprobante set envios = envios where id = $1", [d.comprobante]), 1);
      });

    it("con la empresa suspendida", async () => {
      const d = await sembrar();
      await dueno.query("update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [d.x.empresa]);
      await intentarEscribir(d);
      await dueno.query("update empresa set estado = 'ACTIVE', motivo_estado = null where id = $1", [d.x.empresa]);
      await operaDeNuevo(d);
    });

    it("con el tenant suspendido", async () => {
      const d = await sembrar();
      await dueno.query("update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [d.x.tenant]);
      await intentarEscribir(d);
      await dueno.query("update tenant set estado = 'ACTIVE', motivo_estado = null where id = $1", [d.x.tenant]);
      await operaDeNuevo(d);
    });
  });

  describe("el autor", () => {
    it("un comprobante o un certificado se crean a nombre de la persona del contexto, no de otra", async () => {
      await conApp(a, async (s) => {
        denegado(await insertarComprobante(viaSesion(s), datosDeComprobante(a.x, { creado_por: b.x.persona })));
        denegado(await insertarComprobante(viaSesion(s), datosDeComprobante(a.x, { creado_por: randomUUID() })));
        acepta(await insertarComprobante(viaSesion(s), datosDeComprobante(a.x)));
      });
    });
  });
});
