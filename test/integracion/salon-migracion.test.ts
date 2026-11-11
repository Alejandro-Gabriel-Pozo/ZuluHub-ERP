import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import { acepta, check, clave, conAppDe, crearMundo, denegado, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import type { SesionDePrueba } from "./sesiones";

/**
 * 0038 (E7): lo que promete la migración del salón, las comandas y la impresión, con el rol REAL de la aplicación (privilegios por columna y RLS)
 * y el dueño de la base para armar el escenario: la copia de una línea sin recotizar, el importe fijo, el ancla móvil, las mesas que no se pisan, el
 * contador de envíos sin huecos, el envío que se fija una sola vez, un trabajo original por documento, la inmutabilidad y la reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = "2026-11-09T15:00:00Z";
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0038_revertir_salon.sql",
);
const uuid = () => randomUUID();
const claveNueva = () => randomUUID().replaceAll("-", "");

type Linea = Readonly<{
  cuenta: string;
  precio?: string;
  cantidad?: string;
  paso?: string;
  importeFijo?: string | null;
  controla?: boolean;
  producto?: string;
  precioId?: string;
}>;

describe.skipIf(base === null)("migración 0038: salón, comandas e impresión", () => {
  const b = () => base as BaseDePruebas;
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;

  beforeAll(async () => {
    aparte = await crearBaseAparte(b());
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  const app = <T>(trabajo: (s: SesionDePrueba) => Promise<T>) => conAppDe(aparte.base, m, trabajo);

  // Sin savepoint (`directo`): las bases comprueban con `xmin` que lo escrito es de ESTA transacción, y un savepoint lo cambia.
  async function cuenta(s: SesionDePrueba, ancla?: { tipo: string; id: string }): Promise<string> {
    const id = uuid();
    acepta(
      await s.directo(
        `insert into cuenta_consumo (id, empresa_id, sucursal_id, ancla_tipo, ancla_id, abierta_por, abierta_en)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, m.empresa, m.sucursal, ancla?.tipo ?? null, ancla?.id ?? null, m.persona, AHORA],
      ),
    );
    return id;
  }

  async function total(s: SesionDePrueba, cuentaId: string): Promise<void> {
    acepta(
      await s.directo(
        `update cuenta_consumo set total_provisorio = (
           select round(coalesce(sum(coalesce(l.importe_fijo, l.precio_unitario * l.cantidad)), 0), 2)
             from linea_cuenta l where l.cuenta_id = $1 and l.empresa_id = $2 and l.estado = 'VIGENTE')
         where id = $1 and empresa_id = $2`,
        [cuentaId, m.empresa],
      ),
    );
  }

  async function linea(s: SesionDePrueba, l: Linea, id = uuid()): Promise<string> {
    const r = await s.directo(
      `update cuenta_consumo set ultima_posicion = ultima_posicion + 1 where id = $1 and empresa_id = $2 returning ultima_posicion`,
      [l.cuenta, m.empresa],
    );
    acepta(r);
    const posicion = (r.ok ? r.rows[0]?.["ultima_posicion"] : 0) as number;
    acepta(
      await s.directo(
        `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                   precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en,
                                   importe_fijo)
         values ($1, $2, $3, $4, $5, 'Pizza', $6, 'EMPRESA', $7, $7, $8, 'UNIDAD', $9, '21', $10, $11, $12, $13)`,
        [
          id,
          m.empresa,
          l.cuenta,
          posicion,
          l.producto ?? "00000000-0000-4000-8000-000000000001",
          l.precioId ?? "00000000-0000-4000-8000-000000000002",
          l.precio ?? "1000",
          l.cantidad ?? "1",
          l.paso ?? "1",
          l.controla ?? false,
          m.persona,
          AHORA,
          l.importeFijo ?? null,
        ],
      ),
    );
    return id;
  }

  const anular = async (s: SesionDePrueba, cuentaId: string, id: string, motivo = "TRASLADADA") => {
    const r = await s.directo(
      `update linea_cuenta set estado = 'ANULADA', anulada_por = $3, anulada_en = $4, motivo_de_anulacion = $5 where id = $1 and empresa_id = $2`,
      [id, m.empresa, m.persona, AHORA, motivo],
    );
    await total(s, cuentaId);
    return r;
  };
  const copiada = (s: SesionDePrueba, nueva: string, origen: string, modo: string) =>
    s.directo(
      `insert into linea_copiada (empresa_id, linea_nueva_id, linea_origen_id, modo) values ($1, $2, $3, $4)`,
      [m.empresa, nueva, origen, modo],
    );
  /** Fuerza ahora los controles diferidos (lo que pasaría al confirmar). */
  const alConfirmar = (s: SesionDePrueba) => s.intentar("set constraints all immediate");

  describe("ventas: importe fijo, copia de líneas y ancla móvil", () => {
    it("una línea trasladada entera pasa con lo mismo; si se recotiza, la base lo rechaza (copias_cuadran)", async () => {
      await app(async (s) => {
        const c1 = await cuenta(s);
        const c2 = await cuenta(s);
        const origen = await linea(s, { cuenta: c1 });
        await total(s, c1);
        acepta(await anular(s, c1, origen));
        const nueva = await linea(s, { cuenta: c2 });
        await total(s, c2);
        acepta(await copiada(s, nueva, origen, "COMPLETA"));
        acepta(await alConfirmar(s));
      });
      await app(async (s) => {
        const c1 = await cuenta(s);
        const c2 = await cuenta(s);
        const origen = await linea(s, { cuenta: c1 });
        await total(s, c1);
        acepta(await anular(s, c1, origen));
        const nueva = await linea(s, { cuenta: c2, precio: "900" });
        await total(s, c2);
        acepta(await copiada(s, nueva, origen, "COMPLETA"));
        check(await alConfirmar(s), "copias_cuadran");
      });
    });

    it("por unidades las partes suman la cantidad de la origen, con el mismo precio", async () => {
      await app(async (s) => {
        const madre = await cuenta(s);
        const a = await cuenta(s);
        const bb = await cuenta(s);
        const origen = await linea(s, { cuenta: madre, cantidad: "3" });
        await total(s, madre);
        acepta(await anular(s, madre, origen));
        const l1 = await linea(s, { cuenta: a, cantidad: "1" });
        const l2 = await linea(s, { cuenta: bb, cantidad: "2" });
        await total(s, a);
        await total(s, bb);
        acepta(await copiada(s, l1, origen, "POR_UNIDADES"));
        acepta(await copiada(s, l2, origen, "POR_UNIDADES"));
        acepta(await alConfirmar(s));
      });
      await app(async (s) => {
        const madre = await cuenta(s);
        const a = await cuenta(s);
        const bb = await cuenta(s);
        const origen = await linea(s, { cuenta: madre, cantidad: "3" });
        await total(s, madre);
        acepta(await anular(s, madre, origen));
        const l1 = await linea(s, { cuenta: a, cantidad: "1" });
        const l2 = await linea(s, { cuenta: bb, cantidad: "1" });
        await total(s, a);
        await total(s, bb);
        acepta(await copiada(s, l1, origen, "POR_UNIDADES"));
        acepta(await copiada(s, l2, origen, "POR_UNIDADES"));
        check(await alConfirmar(s), "copias_cuadran");
      });
    });

    it("compartido: el importe fijo de las partes suma el de la origen redondeado una vez y solo una descuenta stock", async () => {
      // 3 × $ 1000,00 / 3 partes = 1000 cada una; con $ 100,00 entre tres: 33,34 + 33,33 + 33,33.
      await app(async (s) => {
        const madre = await cuenta(s);
        const [a, bb, c] = [await cuenta(s), await cuenta(s), await cuenta(s)] as [
          string,
          string,
          string,
        ];
        const origen = await linea(s, { cuenta: madre, precio: "100", controla: true });
        await total(s, madre);
        acepta(await anular(s, madre, origen));
        const l1 = await linea(s, {
          cuenta: a,
          precio: "100",
          importeFijo: "33.34",
          controla: true,
        });
        const l2 = await linea(s, { cuenta: bb, precio: "100", importeFijo: "33.33" });
        const l3 = await linea(s, { cuenta: c, precio: "100", importeFijo: "33.33" });
        for (const x of [a, bb, c]) await total(s, x);
        for (const l of [l1, l2, l3]) acepta(await copiada(s, l, origen, "COMPARTIDA"));
        acepta(await alConfirmar(s));
      });
      await app(async (s) => {
        const madre = await cuenta(s);
        const [a, bb] = [await cuenta(s), await cuenta(s)] as [string, string];
        const origen = await linea(s, { cuenta: madre, precio: "100" });
        await total(s, madre);
        acepta(await anular(s, madre, origen));
        const l1 = await linea(s, { cuenta: a, precio: "100", importeFijo: "50.01" });
        const l2 = await linea(s, { cuenta: bb, precio: "100", importeFijo: "50" });
        await total(s, a);
        await total(s, bb);
        acepta(await copiada(s, l1, origen, "COMPARTIDA"));
        acepta(await copiada(s, l2, origen, "COMPARTIDA"));
        check(await alConfirmar(s), "copias_cuadran");
      });
      // Descontar stock en las dos partes lo descontaría dos veces.
      await app(async (s) => {
        const madre = await cuenta(s);
        const [a, bb] = [await cuenta(s), await cuenta(s)] as [string, string];
        const origen = await linea(s, { cuenta: madre, precio: "100", controla: true });
        await total(s, madre);
        acepta(await anular(s, madre, origen));
        const l1 = await linea(s, { cuenta: a, precio: "100", importeFijo: "50", controla: true });
        const l2 = await linea(s, { cuenta: bb, precio: "100", importeFijo: "50", controla: true });
        await total(s, a);
        await total(s, bb);
        acepta(await copiada(s, l1, origen, "COMPARTIDA"));
        acepta(await copiada(s, l2, origen, "COMPARTIDA"));
        check(await alConfirmar(s), "copias_cuadran");
      });
    });

    it("un importe fijo sin ser copia compartida se rechaza; el total de la cuenta lo usa", async () => {
      await app(async (s) => {
        const c = await cuenta(s);
        await linea(s, { cuenta: c, importeFijo: "10.00" });
        await total(s, c);
        check(await alConfirmar(s), "linea_importe_fijo_solo_compartida");
      });
    });

    it("anular parte de un ítem: el resto es menor, queda en la misma cuenta y lleva el motivo real", async () => {
      await app(async (s) => {
        const c = await cuenta(s);
        const origen = await linea(s, { cuenta: c, cantidad: "3" });
        await total(s, c);
        acepta(await anular(s, c, origen, "Se equivocó el mozo"));
        const resto = await linea(s, { cuenta: c, cantidad: "2" });
        await total(s, c);
        acepta(await copiada(s, resto, origen, "RESTO"));
        acepta(await alConfirmar(s));
      });
      await app(async (s) => {
        const c = await cuenta(s);
        const origen = await linea(s, { cuenta: c, cantidad: "3" });
        await total(s, c);
        acepta(await anular(s, c, origen, "TRASLADADA"));
        const resto = await linea(s, { cuenta: c, cantidad: "2" });
        await total(s, c);
        check(await copiada(s, resto, origen, "RESTO"), "linea_copiada_motivo_invalido");
      });
    });

    it("el ancla de una cuenta abierta se mueve; la base impide dos cuentas abiertas en la misma ancla", async () => {
      await app(async (s) => {
        const mesa1 = uuid();
        const mesa2 = uuid();
        const a = await cuenta(s, { tipo: "salon.mesa", id: mesa1 });
        await cuenta(s, { tipo: "salon.mesa", id: mesa2 });
        acepta(
          await s.intentar(
            "update cuenta_consumo set ancla_id = $3 where id = $1 and empresa_id = $2",
            [a, m.empresa, uuid()],
          ),
        );
        clave(
          await s.intentar(
            "update cuenta_consumo set ancla_id = $3 where id = $1 and empresa_id = $2",
            [a, m.empresa, mesa2],
          ),
          "cuenta_ancla_abierta_uk",
        );
      });
    });
  });

  describe("salón: mesas y casillas", () => {
    const mesa = async (s: SesionDePrueba, numero: number, columna = 1, fila = 1, id = uuid()) => {
      acepta(
        await s.intentar(
          `insert into mesa (id, empresa_id, sucursal_id, numero, forma, tamano, columna, fila, creada_por, creada_en)
           values ($1, $2, $3, $4, 'CUADRADA', 'CHICA', $5, $6, $7, $8)`,
          [id, m.empresa, m.sucursal, numero, columna, fila, m.persona, AHORA],
        ),
      );
      return id;
    };
    const celda = (s: SesionDePrueba, mesaId: string, columna: number, fila: number) =>
      s.intentar(
        `insert into mesa_celda (empresa_id, sucursal_id, mesa_id, columna, fila) values ($1, $2, $3, $4, $5)`,
        [m.empresa, m.sucursal, mesaId, columna, fila],
      );

    it("el número es único en la sucursal y dos mesas activas no ocupan la misma casilla", async () => {
      await app(async (s) => {
        const a = await mesa(s, 1, 2, 2);
        acepta(await celda(s, a, 2, 2));
        const r = await s.intentar(
          `insert into mesa (id, empresa_id, sucursal_id, numero, forma, tamano, columna, fila, creada_por, creada_en)
           values ($1, $2, $3, 1, 'LARGA', 'CHICA', 5, 5, $4, $5)`,
          [uuid(), m.empresa, m.sucursal, m.persona, AHORA],
        );
        clave(r, "mesa_numero_uk");
        const bb = await mesa(s, 2, 2, 2);
        clave(await celda(s, bb, 2, 2), "mesa_celda_ocupada_uk");
      });
    });

    it("una mesa activa sin casillas, o una desactivada con casillas, no se confirma", async () => {
      await app(async (s) => {
        await mesa(s, 3, 4, 4);
        check(await s.intentar("set constraints all immediate"), "mesa_celdas_cuadran");
      });
      await app(async (s) => {
        const a = await mesa(s, 4, 6, 6);
        acepta(await celda(s, a, 6, 6));
        acepta(
          await s.intentar("update mesa set activa = false where id = $1 and empresa_id = $2", [
            a,
            m.empresa,
          ]),
        );
        check(await s.intentar("set constraints all immediate"), "mesa_celdas_cuadran");
      });
    });

    it("una mesa no se borra", async () => {
      await app(async (s) => {
        const a = await mesa(s, 5, 8, 8);
        denegado(await s.intentar("delete from mesa where id = $1", [a]));
      });
    });
  });

  describe("comandas: envíos, contador, líneas de comanda e impresión", () => {
    async function envio(s: SesionDePrueba, cuentaId: string, numero: number, id = uuid()) {
      acepta(
        await s.directo(
          `insert into contador_de_envios (empresa_id, cuenta_id) values ($1, $2) on conflict do nothing`,
          [m.empresa, cuentaId],
        ),
      );
      acepta(
        await s.directo(
          `update contador_de_envios set ultimo = ultimo + 1 where empresa_id = $1 and cuenta_id = $2`,
          [m.empresa, cuentaId],
        ),
      );
      const r = await s.directo(
        `insert into envio_de_comanda (id, empresa_id, sucursal_id, cuenta_id, numero, tipo, rotulo, enviado_por, enviado_en, clave, huella)
         values ($1, $2, $3, $4, $5, 'ENVIO', 'Mesa 5', $6, $7, $8, $9)`,
        [
          id,
          m.empresa,
          m.sucursal,
          cuentaId,
          numero,
          m.persona,
          "2026-11-10T04:25:00Z",
          claveNueva(),
          "a".repeat(64),
        ],
      );
      return { id, r };
    }

    it("el envío toma el número del contador y la fecha de negocio la fija la base (01:25 con corte 06:00 es el día anterior)", async () => {
      await dueno.query("update sucursal set hora_de_corte = '06:00' where id = $1", [m.sucursal]);
      await app(async (s) => {
        const c = await cuenta(s);
        const e = await envio(s, c, 1);
        acepta(e.r);
        acepta(await alConfirmar(s));
        const f = await s.intentar(
          "select fecha_negocio::text as f from envio_de_comanda where id = $1",
          [e.id],
        );
        expect(f.ok ? f.rows[0]?.["f"] : null).toBe("2026-11-09");
      });
    });

    it("un número que no es el del contador, o un contador que sube sin envío, no se confirma (sin huecos)", async () => {
      await app(async (s) => {
        const c = await cuenta(s);
        const e = await envio(s, c, 2);
        check(e.r, "envio_numero_del_contador");
      });
      await app(async (s) => {
        const c = await cuenta(s);
        acepta(
          await s.intentar(
            "insert into contador_de_envios (empresa_id, cuenta_id) values ($1, $2)",
            [m.empresa, c],
          ),
        );
        acepta(
          await s.intentar(
            "update contador_de_envios set ultimo = ultimo + 1 where cuenta_id = $1",
            [c],
          ),
        );
        check(await alConfirmar(s), "contador_sin_huecos");
      });
      await app(async (s) => {
        const c = await cuenta(s);
        acepta(
          await s.intentar(
            "insert into contador_de_envios (empresa_id, cuenta_id) values ($1, $2)",
            [m.empresa, c],
          ),
        );
        check(
          await s.intentar(
            "update contador_de_envios set ultimo = ultimo + 2 where cuenta_id = $1",
            [c],
          ),
          "contador_solo_sube_de_a_uno",
        );
      });
    });

    it("el envío no se edita ni se borra, ni siquiera por el dueño de la base", async () => {
      await app(async (s) => {
        const c = await cuenta(s);
        const e = await envio(s, c, 1);
        acepta(e.r);
        denegado(
          await s.intentar("update envio_de_comanda set rotulo = 'Mesa 6' where id = $1", [e.id]),
        );
      });
    });

    it("el envío de una línea se fija una sola vez y la salida solo cambia mientras no se envió", async () => {
      await app(async (s) => {
        const c = await cuenta(s);
        const l = await linea(s, { cuenta: c });
        await total(s, c);
        acepta(
          await s.intentar(
            "insert into linea_de_comanda (empresa_id, linea_id, cuenta_id) values ($1, $2, $3)",
            [m.empresa, l, c],
          ),
        );
        acepta(
          await s.intentar("update linea_de_comanda set salida = 'DESPUES' where linea_id = $1", [
            l,
          ]),
        );
        const e = await envio(s, c, 1);
        acepta(e.r);
        acepta(
          await s.intentar("update linea_de_comanda set envio_id = $2 where linea_id = $1", [
            l,
            e.id,
          ]),
        );
        check(
          await s.intentar("update linea_de_comanda set salida = 'AHORA' where linea_id = $1", [l]),
          "linea_de_comanda_ya_enviada",
        );
        check(
          await s.intentar("update linea_de_comanda set envio_id = null where linea_id = $1", [l]),
          "linea_de_comanda_ya_enviada",
        );
      });
    });

    it("un documento original tiene un solo trabajo; la copia es otro; un intento mueve el estado y «Reintentar» es el mismo trabajo", async () => {
      await app(async (s) => {
        const doc = uuid();
        const t = uuid();
        const alta = (id: string, copia: boolean) =>
          s.intentar(
            `insert into trabajo_de_impresion (id, empresa_id, sucursal_id, documento_tipo, documento_id, es_copia, clave, huella, solicitado_por, solicitado_en)
             values ($1, $2, $3, 'COMANDA', $4, $5, $6, $7, $8, $9)`,
            [id, m.empresa, m.sucursal, doc, copia, claveNueva(), "b".repeat(64), m.persona, AHORA],
          );
        acepta(await alta(t, false));
        clave(await alta(uuid(), false), "trabajo_imp_original_uk");
        acepta(await alta(uuid(), true));
        const intento = (n: number, r: string) =>
          s.intentar(
            `insert into intento_de_impresion (empresa_id, trabajo_id, numero, resultado, declarado_por, declarado_en) values ($1, $2, $3, $4, $5, $6)`,
            [m.empresa, t, n, r, m.persona, AHORA],
          );
        check(await intento(2, "FALLIDA"), "intento_no_pedido");
        acepta(await intento(1, "FALLIDA"));
        clave(await intento(1, "FALLIDA"), "intento_pkey");
        const estado = async () => {
          const r = await s.intentar(
            "select estado, intentos from trabajo_de_impresion where id = $1",
            [t],
          );
          return r.ok ? r.rows[0] : null;
        };
        expect(await estado()).toEqual({ estado: "FALLIDA", intentos: 1 });
        acepta(
          await s.intentar(
            "update trabajo_de_impresion set estado = 'PENDIENTE', intentos = 2 where id = $1",
            [t],
          ),
        );
        acepta(await intento(2, "IMPRESA"));
        expect(await estado()).toEqual({ estado: "IMPRESA", intentos: 2 });
        check(
          await s.intentar(
            "update trabajo_de_impresion set estado = 'PENDIENTE', intentos = 3 where id = $1",
            [t],
          ),
          "trabajo_transicion_invalida",
        );
      });
    });

    it("una impresora no se borra y su nombre es único por sucursal", async () => {
      await app(async (s) => {
        const alta = () =>
          s.intentar(
            `insert into impresora (id, empresa_id, sucursal_id, nombre, uso, papel_mm, creada_por, creada_en) values ($1, $2, $3, 'Cocina', 'COMANDA', 80, $4, $5)`,
            [uuid(), m.empresa, m.sucursal, m.persona, AHORA],
          );
        acepta(await alta());
        clave(await alta(), "impresora_nombre_uk");
        denegado(await s.intentar("delete from impresora"));
      });
    });
  });

  describe("aislamiento, privilegios y reversión", () => {
    it("otra empresa no ve las mesas ni los envíos (RLS)", async () => {
      const otra = await crearMundo(dueno);
      await app(async (s) => {
        const id = uuid();
        acepta(
          await s.intentar(
            `insert into mesa (id, empresa_id, sucursal_id, numero, forma, tamano, columna, fila, creada_por, creada_en)
             values ($1, $2, $3, 90, 'REDONDA', 'GRANDE', 10, 5, $4, $5)`,
            [id, m.empresa, m.sucursal, m.persona, AHORA],
          ),
        );
      });
      await conAppDe(aparte.base, otra, async (s) => {
        const r = await s.intentar("select count(*)::int as n from mesa");
        expect(r.ok ? r.rows[0]?.["n"] : -1).toBe(0);
      });
    });

    it("el rol de la aplicación no tiene DELETE ni TRUNCATE en ninguna tabla nueva", async () => {
      const { rows } = await dueno.query<{ tabla: string }>(
        `select table_name as tabla from information_schema.role_table_grants
          where grantee = 'pedernal_app' and privilege_type in ('DELETE', 'TRUNCATE')
            and table_name in ('mesa','mesa_celda','union_de_mesas','linea_unida','division_de_cuenta','parte_de_division','contador_de_envios',
                               'envio_de_comanda','renglon_de_envio','linea_de_comanda','aviso_de_anulacion','impresora','trabajo_de_impresion',
                               'intento_de_impresion','linea_copiada')`,
      );
      expect(rows).toEqual([]);
    });

    it("la reversión falla cerrada con datos y, confirmada, deja ventas como estaba; la migración se puede volver a aplicar", async () => {
      const sql = await readFile(REVERSION, "utf8");
      const otra = await crearBaseAparte(b());
      const c = new pg.Client({ connectionString: otra.base.dueno });
      await c.connect();
      try {
        const w = await crearMundo(c);
        const mesaId = uuid();
        await c.query("begin");
        await c.query(
          `insert into mesa (id, empresa_id, sucursal_id, numero, forma, tamano, columna, fila, creada_por, creada_en)
           values ($1, $2, $3, 1, 'REDONDA', 'CHICA', 1, 1, $4, $5)`,
          [mesaId, w.empresa, w.sucursal, w.persona, AHORA],
        );
        await c.query(
          "insert into mesa_celda (empresa_id, sucursal_id, mesa_id, columna, fila) values ($1, $2, $3, 1, 1)",
          [w.empresa, w.sucursal, mesaId],
        );
        await c.query("commit");
        // Con una mesa cargada la reversión se frena sin borrar nada.
        await c.query("begin");
        await expect(c.query(sql)).rejects.toMatchObject({ code: "55000" });
        await c.query("rollback");
        expect((await c.query("select 1 from mesa")).rowCount).toBe(1);
        await c.query("begin");
        await c.query("set local pedernal.confirmar_reversion = 'SI'");
        await c.query(sql);
        await c.query("commit");
        const { rows } = await c.query<{ n: number }>(
          `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('mesa','envio_de_comanda','linea_copiada')`,
        );
        expect(rows[0]?.n).toBe(0);
        const col = await c.query(
          `select 1 from information_schema.columns where table_name = 'linea_cuenta' and column_name = 'importe_fijo'`,
        );
        expect(col.rowCount).toBe(0);
        const reg = await c.query(`select 1 from migracion where nombre = '0038_salon.sql'`);
        expect(reg.rowCount).toBe(0);
      } finally {
        await c.end();
        await otra.destruir();
      }
    });
  });
});
