import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearBarrera, crearBaseAparte } from "./entorno";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { acepta, check, conAppDe, crearMundo, referencia, type Mundo } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { SesionDePrueba, type Intento } from "./sesiones";
import { sufijoUnico } from "./unicos";

/**
 * Migración LB-3 (0092): el libro de saldos por parte. SQL directo con el rol de la aplicación sobre una base propia con todas las migraciones.
 * Cada caso corre en una transacción que se deshace (`conAppDe`), salvo los de cuadre diferido, concurrencia y reversión, que confirman datos
 * de verdad. Previene: un saldo que no suma sus asientos, una imputación que pasa lo disponible, un asiento anulado con algo imputado (o al
 * revés), un «deshacer» que baja de cero, una distribución por centro de costo que no suma exacto, un derivado escrito por fuera del
 * disparador, datos de una empresa vistos desde otra, y una migración que toca lo que ya existía.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const MIGRACION = "0092_libro_de_saldos.sql";
const REVERSION = "reversiones/0092_revertir_libro_de_saldos.sql";
const AHORA = "2026-11-09T22:00:00Z";
const AISLAMIENTOS = ["read committed", "serializable"] as const;
type Aislamiento = (typeof AISLAMIENTOS)[number];

const TABLAS_NUEVAS = [
  "clase_de_asiento",
  "asiento_de_saldo",
  "distribucion_de_asiento",
  "imputacion_de_saldo",
  "saldo_de_asiento",
  "saldo_de_imputacion",
  "saldo_de_parte",
  "saldo_de_parte_por_centro_de_costo",
] as const;
const DERIVADOS = [
  "saldo_de_asiento",
  "saldo_de_imputacion",
  "saldo_de_parte",
  "saldo_de_parte_por_centro_de_costo",
] as const;
const FUNCIONES_NUEVAS = [
  "libro_saldo_guardia",
  "asiento_de_saldo_validar_alta",
  "asiento_de_saldo_aplicar",
  "imputacion_de_saldo_aplicar",
  "distribucion_de_asiento_aplicar",
  "asiento_de_saldo_verificar_distribucion",
] as const;

type Asiento = Partial<{
  sentido: string;
  clase: string;
  naturaleza: string;
  importe: string;
  moneda: string;
  origenTipo: string;
  origenId: string;
  origenOrden: number;
  venceEl: string | null;
  detalle: string | null;
  anulaA: string | null;
  clave: string;
  hechoEn: string;
  referenciaTipo: string | null;
  referenciaId: string | null;
}>;

const CARGO = "CARGO_DE_FACTURA_DE_COMPRA";
const PAGO = "PAGO_A_PROVEEDOR";

describe.skipIf(base === null)("migración 0092: libro de saldos (SQL directo)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let otra: Mundo;
  let norte: string;
  let sur: string;
  let sucursalDeOtra: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    otra = await crearMundo(dueno);
    const sucursal = async (mundo: Mundo, nombre: string) =>
      (
        await dueno.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
          [mundo.empresa, nombre],
        )
      ).rows[0]?.id as string;
    norte = await sucursal(m, "Norte");
    sur = await sucursal(m, "Sur");
    sucursalDeOtra = otra.sucursal;
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const b = () => propia.base;

  // ---------------------------------------------------------------------------------------------
  // Apoyo
  // ---------------------------------------------------------------------------------------------
  const crearParte = async (
    mundo: Mundo = m,
    estado: "ACTIVA" | "INACTIVA" | "ANONIMIZADA" = "ACTIVA",
  ): Promise<string> => {
    const id = randomUUID();
    await dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, $4)`,
      [id, mundo.empresa, `Proveedor ${sufijoUnico()}`, mundo.persona],
    );
    if (estado === "INACTIVA") {
      await dueno.query("update parte set estado = 'INACTIVA' where id = $1", [id]);
    } else if (estado === "ANONIMIZADA") {
      await dueno.query("update parte set estado = 'ANONIMIZADA', nombre = null where id = $1", [
        id,
      ]);
    }
    return id;
  };

  const insertarAsiento = (
    s: SesionDePrueba,
    parte: string,
    a: Asiento = {},
    mundo: Mundo = m,
  ): Promise<Intento> =>
    s.intentar(
      `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, naturaleza, importe, moneda, origen_tipo, origen_id,
                                     origen_orden, referencia_tipo, referencia_id, vence_el, detalle, anula_a, clave_idempotencia,
                                     huella, hecho_en, registrado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) returning id`,
      [
        mundo.empresa,
        parte,
        a.sentido ?? "A_PAGAR",
        a.clase ?? CARGO,
        a.naturaleza ?? "ORIGINAL",
        a.importe ?? "100.00",
        a.moneda ?? "ARS",
        a.origenTipo ?? "compras.factura",
        a.origenId ?? randomUUID(),
        a.origenOrden ?? 1,
        a.referenciaTipo ?? null,
        a.referenciaId ?? null,
        a.venceEl ?? null,
        a.detalle ?? null,
        a.anulaA ?? null,
        a.clave ?? claveNueva(),
        HUELLA,
        a.hechoEn ?? AHORA,
        mundo.persona,
      ],
    );

  const distribuir = async (
    s: SesionDePrueba,
    asiento: string,
    filas: ReadonlyArray<readonly [string | null, string]>,
    mundo: Mundo = m,
  ): Promise<Intento[]> => {
    const r: Intento[] = [];
    for (const [sucursal, importe] of filas) {
      r.push(
        await s.intentar(
          `insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) values ($1, $2, $3, $4)`,
          [mundo.empresa, asiento, sucursal, importe],
        ),
      );
    }
    return r;
  };

  /** Un asiento con su distribución (por defecto, todo a la sucursal de la empresa). Devuelve su id; falla la prueba si no entra. */
  const asiento = async (
    s: SesionDePrueba,
    parte: string,
    a: Asiento = {},
    filas?: ReadonlyArray<readonly [string | null, string]>,
    mundo: Mundo = m,
  ): Promise<string> => {
    const r = await insertarAsiento(s, parte, a, mundo);
    acepta(r);
    const id = (r.ok ? r.rows[0]?.["id"] : "") as string;
    for (const d of await distribuir(
      s,
      id,
      filas ?? [[mundo.sucursal, a.importe ?? "100.00"]],
      mundo,
    ))
      acepta(d);
    return id;
  };

  /** El espejo de un asiento: mismo origen, importe negado y la distribución negada de su original. */
  const espejoDe = async (
    s: SesionDePrueba,
    parte: string,
    original: string,
    extra: Asiento = {},
    filas?: ReadonlyArray<readonly [string | null, string]>,
    mundo: Mundo = m,
  ): Promise<{ intento: Intento; id: string }> => {
    const o = await uno<{
      importe: string;
      origen_tipo: string;
      origen_id: string;
      origen_orden: number;
      clase: string;
    }>(
      s,
      "select importe::text as importe, origen_tipo, origen_id, origen_orden, clase from asiento_de_saldo where id = $1",
      [original],
    );
    const importe = (-Number(o.importe)).toFixed(2);
    const intento = await insertarAsiento(
      s,
      parte,
      {
        naturaleza: "ANULACION",
        anulaA: original,
        importe,
        clase: o.clase,
        origenTipo: o.origen_tipo,
        origenId: o.origen_id,
        origenOrden: o.origen_orden,
        detalle: "Anulo el asiento",
        ...extra,
      },
      mundo,
    );
    const id = (intento.ok ? intento.rows[0]?.["id"] : "") as string;
    if (intento.ok && filas !== undefined) {
      await distribuir(s, id, filas, mundo);
    } else if (intento.ok) {
      const d = await s.intentar(
        "select sucursal_id, (-importe)::text as importe from distribucion_de_asiento where asiento_id = $1",
        [original],
      );
      if (d.ok)
        await distribuir(
          s,
          id,
          d.rows.map((f) => [f["sucursal_id"] as string | null, f["importe"] as string] as const),
          mundo,
        );
    }
    return { intento, id };
  };

  const insertarImputacion = (
    s: SesionDePrueba,
    parte: string,
    saldante: string,
    saldado: string,
    importe: string,
    o: { clave?: string; numero?: number; sentido?: string } = {},
    mundo: Mundo = m,
  ): Promise<Intento> =>
    s.intentar(
      `insert into imputacion_de_saldo (empresa_id, numero, saldante_id, saldado_id, parte_id, sentido, importe, clave_idempotencia, huella,
                                        registrado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        mundo.empresa,
        o.numero ?? 1,
        saldante,
        saldado,
        parte,
        o.sentido ?? "A_PAGAR",
        importe,
        o.clave ?? claveNueva(),
        HUELLA,
        mundo.persona,
      ],
    );

  const uno = async <T>(s: SesionDePrueba, texto: string, p: unknown[] = []): Promise<T> => {
    const r = await s.intentar(texto, p);
    if (!r.ok) throw new Error(`${r.codigo} ${r.restriccion ?? ""}: ${r.mensaje}`);
    return r.rows[0] as T;
  };
  const saldoDe = async (s: SesionDePrueba, parte: string): Promise<string | null> =>
    (
      await uno<{ saldo: string | null }>(
        s,
        "select saldo::text as saldo from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
        [parte],
      )
    )?.saldo ?? null;
  const imputadoDe = async (s: SesionDePrueba, id: string): Promise<string> =>
    (
      await uno<{ v: string }>(
        s,
        "select importe_imputado::text as v from saldo_de_asiento where asiento_id = $1",
        [id],
      )
    ).v;
  const porCentro = async (s: SesionDePrueba, parte: string) => {
    const r = await s.intentar(
      `select sucursal_id, saldo::text as saldo from saldo_de_parte_por_centro_de_costo where parte_id = $1 order by sucursal_id nulls last`,
      [parte],
    );
    return r.ok ? r.rows : [];
  };

  const abrir = (mundo: Mundo = m, aislamiento: Aislamiento = "read committed") =>
    SesionDePrueba.abrir(
      b(),
      "pedernal_app",
      comoEmpresa(empresaId(mundo.empresa), personaId(mundo.persona)),
      aislamiento,
    );

  /** Confirma de verdad lo que arma `trabajo` (una transacción de la aplicación) y devuelve el resultado de la confirmación. */
  const confirmando = async (
    trabajo: (s: SesionDePrueba) => Promise<void>,
    mundo: Mundo = m,
  ): Promise<Intento> => {
    const s = await abrir(mundo);
    try {
      await trabajo(s);
      return await s.confirmar();
    } finally {
      await s.cerrar();
    }
  };

  // ---------------------------------------------------------------------------------------------
  describe("1. estructura, privilegios y guardia de los derivados", () => {
    it("RLS activa y forzada en las ocho tablas, sin política FOR ALL, y funciones con search_path fijo", async () => {
      const { rows } = await dueno.query<{
        t: string;
        activa: boolean;
        forzada: boolean;
        todas: number;
      }>(
        `select c.relname as t, c.relrowsecurity as activa, c.relforcerowsecurity as forzada,
                (select count(*)::int from pg_policy p where p.polrelid = c.oid and p.polcmd = '*') as todas
           from pg_class c where c.relname = any($1) and c.relnamespace = 'public'::regnamespace`,
        [TABLAS_NUEVAS],
      );
      expect(rows.map((r) => r.t).sort()).toEqual([...TABLAS_NUEVAS].sort());
      for (const r of rows) {
        expect(r.activa, r.t).toBe(true);
        expect(r.forzada, r.t).toBe(true);
        expect(r.todas, r.t).toBe(0);
      }
      const { rows: fn } = await dueno.query<{ proname: string; fijo: boolean; definer: boolean }>(
        `select proname, coalesce(proconfig::text like '%search_path=pg_catalog, public, pg_temp%', false) as fijo, prosecdef as definer
           from pg_proc where proname = any($1) and pronamespace = 'public'::regnamespace`,
        [FUNCIONES_NUEVAS],
      );
      expect(fn.map((f) => f.proname).sort()).toEqual([...FUNCIONES_NUEVAS].sort());
      for (const f of fn) {
        expect(f.fijo, f.proname).toBe(true);
        expect(f.definer, f.proname).toBe(false);
      }
    });

    it("la aplicación no puede borrar ni truncar nada, ni actualizar los libros ni el catálogo", async () => {
      const { rows } = await dueno.query<{
        t: string;
        borrar: boolean;
        truncar: boolean;
        actualizar: boolean;
      }>(
        `select t, has_table_privilege('pedernal_app', t::regclass, 'DELETE') as borrar,
                has_table_privilege('pedernal_app', t::regclass, 'TRUNCATE') as truncar,
                has_any_column_privilege('pedernal_app', t::regclass, 'UPDATE') as actualizar
           from unnest($1::text[]) as t`,
        [TABLAS_NUEVAS],
      );
      for (const r of rows) {
        expect(r.borrar, r.t).toBe(false);
        expect(r.truncar, r.t).toBe(false);
        expect(r.actualizar, r.t).toBe(DERIVADOS.includes(r.t as (typeof DERIVADOS)[number]));
      }
    });

    it("un INSERT o UPDATE directo de la aplicación sobre cada derivado se rechaza por la guardia; el DELETE, por falta de privilegio", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const a = await asiento(s, parte);
        const inserciones: Record<(typeof DERIVADOS)[number], [string, unknown[]]> = {
          saldo_de_asiento: [
            "insert into saldo_de_asiento (empresa_id, asiento_id, tope) values ($1, $2, 5)",
            [m.empresa, a],
          ],
          saldo_de_imputacion: [
            "insert into saldo_de_imputacion (empresa_id, saldante_id, saldado_id, importe) values ($1, $2, $2, 1)",
            [m.empresa, a],
          ],
          saldo_de_parte: [
            "insert into saldo_de_parte (empresa_id, parte_id, sentido, moneda, saldo) values ($1, $2, 'A_COBRAR', 'ARS', 1)",
            [m.empresa, parte],
          ],
          saldo_de_parte_por_centro_de_costo: [
            "insert into saldo_de_parte_por_centro_de_costo (empresa_id, parte_id, sentido, moneda, sucursal_id, saldo) values ($1, $2, 'A_COBRAR', 'ARS', null, 1)",
            [m.empresa, parte],
          ],
        };
        for (const t of DERIVADOS) {
          const [texto, p] = inserciones[t];
          const r = await s.intentar(texto, p);
          expect(r.ok, `insert ${t}`).toBe(false);
          if (!r.ok) expect(r.mensaje, t).toMatch(/solo el libro de saldos/);
        }
        const cambios: Record<(typeof DERIVADOS)[number], string> = {
          saldo_de_asiento: "update saldo_de_asiento set importe_imputado = 1",
          saldo_de_imputacion: "update saldo_de_imputacion set importe = 1",
          saldo_de_parte: "update saldo_de_parte set saldo = 0",
          saldo_de_parte_por_centro_de_costo:
            "update saldo_de_parte_por_centro_de_costo set saldo = 0",
        };
        // `saldo_de_imputacion` no tiene filas todavía: se crea una con una imputación legítima.
        const pago = await asiento(s, parte, { clase: PAGO, importe: "-50.00" });
        acepta(await insertarImputacion(s, parte, pago, a, "50.00"));
        for (const t of DERIVADOS) {
          const r = await s.intentar(cambios[t]);
          expect(r.ok, `update ${t}`).toBe(false);
          if (!r.ok) expect(r.mensaje, t).toMatch(/solo el libro de saldos/);
          const d = await s.intentar(`delete from ${t}`);
          expect(d.ok, `delete ${t}`).toBe(false);
          if (!d.ok) expect(d.codigo).toBe("42501");
        }
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("3. alta de un asiento", () => {
    it("clase no sembrada, de otro sentido, signo contrario, ± en ambos signos, importe cero, tope y moneda", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        referencia(
          await insertarAsiento(s, parte, { clase: "INVENTADA" }),
          "asiento_de_saldo_clase_fkey",
        );
        referencia(
          await insertarAsiento(s, parte, { sentido: "A_COBRAR" }),
          "asiento_de_saldo_clase_fkey",
        );
        check(
          await insertarAsiento(s, parte, { importe: "-10.00" }),
          "asiento_de_saldo_signo_de_la_clase",
        );
        check(
          await insertarAsiento(s, parte, { clase: PAGO, importe: "10.00" }),
          "asiento_de_saldo_signo_de_la_clase",
        );
        acepta(
          await insertarAsiento(s, parte, {
            clase: "AJUSTE_DE_SALDO",
            importe: "10.00",
            detalle: "Ajuste uno",
          }),
        );
        acepta(
          await insertarAsiento(s, parte, {
            clase: "AJUSTE_DE_SALDO",
            importe: "-10.00",
            detalle: "Ajuste dos",
          }),
        );
        check(
          await insertarAsiento(s, parte, { importe: "0.00" }),
          "asiento_de_saldo_importe_no_cero_ck",
        );
        check(
          await insertarAsiento(s, parte, { importe: "1000000000.00" }),
          "asiento_de_saldo_importe_tope_ck",
        );
        check(await insertarAsiento(s, parte, { moneda: "USD" }), "asiento_de_saldo_moneda_ck");
      });
    });

    it("estado de la parte: la anonimizada no admite nada; la inactiva no admite lo que aumenta la deuda pero sí lo que la reduce", async () => {
      await conAppDe(b(), m, async (s) => {
        const anonimizada = await crearParte(m, "ANONIMIZADA");
        check(await insertarAsiento(s, anonimizada), "asiento_de_saldo_parte_anonimizada");
        check(
          await insertarAsiento(s, anonimizada, { clase: PAGO, importe: "-1.00" }),
          "asiento_de_saldo_parte_anonimizada",
        );
        const inactiva = await crearParte(m, "INACTIVA");
        check(await insertarAsiento(s, inactiva), "asiento_de_saldo_parte_inactiva");
        acepta(await insertarAsiento(s, inactiva, { clase: PAGO, importe: "-1.00" }));
      });
    });

    it("vencimiento, detalle, origen y referencia: solo lo que la clase y la forma admiten", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        acepta(await insertarAsiento(s, parte, { venceEl: "2026-12-31" }));
        check(
          await insertarAsiento(s, parte, { clase: PAGO, importe: "-1.00", venceEl: "2026-12-31" }),
          "asiento_de_saldo_vencimiento_no_admitido",
        );
        check(
          await insertarAsiento(s, parte, { venceEl: "infinity" }),
          "asiento_de_saldo_vence_el_ck",
        );
        check(
          await insertarAsiento(s, parte, { hechoEn: "infinity" }),
          "asiento_de_saldo_hecho_en_ck",
        );
        check(
          await insertarAsiento(s, parte, { detalle: "no corresponde" }),
          "asiento_de_saldo_detalle_no_admitido",
        );
        check(
          await insertarAsiento(s, parte, { clase: "AJUSTE_DE_SALDO", importe: "5.00" }),
          "asiento_de_saldo_detalle_obligatorio",
        );
        check(
          await insertarAsiento(s, parte, {
            clase: "AJUSTE_DE_SALDO",
            importe: "5.00",
            detalle: "con <etiqueta>",
          }),
          "asiento_de_saldo_detalle_ck",
        );
        check(
          await insertarAsiento(s, parte, { origenTipo: "Mal Formado" }),
          "asiento_de_saldo_origen_tipo_ck",
        );
        check(
          await insertarAsiento(s, parte, { origenOrden: 0 }),
          "asiento_de_saldo_origen_orden_ck",
        );
        check(
          await insertarAsiento(s, parte, { origenOrden: 1001 }),
          "asiento_de_saldo_origen_orden_ck",
        );
        check(
          await insertarAsiento(s, parte, { referenciaTipo: "compras.pago", referenciaId: null }),
          "asiento_de_saldo_referencia_ck",
        );
        check(await insertarAsiento(s, parte, { clave: "corta" }), "asiento_de_saldo_clave_ck");
      });
    });

    it("una parte de otra empresa no existe para el asiento", async () => {
      await conAppDe(b(), m, async (s) => {
        const deOtra = await crearParte(otra);
        referencia(await insertarAsiento(s, deOtra), "asiento_de_saldo_parte_fkey");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("4. idempotencia en la base", () => {
    it("misma clave → choque; mismo origen con otra clave → choque; el espejo del mismo origen entra", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const clave = claveNueva();
        const origenId = randomUUID();
        const a = await asiento(s, parte, { clave, origenId });
        const dup = await insertarAsiento(s, parte, { clave });
        expect(dup.ok).toBe(false);
        if (!dup.ok)
          expect([dup.codigo, dup.restriccion]).toEqual(["23505", "asiento_de_saldo_clave_uk"]);
        const mismoOrigen = await insertarAsiento(s, parte, { origenId });
        expect(mismoOrigen.ok).toBe(false);
        if (!mismoOrigen.ok)
          expect([mismoOrigen.codigo, mismoOrigen.restriccion]).toEqual([
            "23505",
            "asiento_de_saldo_origen_uk",
          ]);
        // Otro orden del mismo origen es otro efecto: entra.
        acepta(await insertarAsiento(s, parte, { origenId, origenOrden: 2 }));
        // El espejo comparte el origen de su original.
        acepta(
          await insertarAsiento(s, parte, {
            naturaleza: "ANULACION",
            anulaA: a,
            importe: "-100.00",
            origenId,
            detalle: "Anulación de prueba",
          }),
        );
      });
    });

    it("el mismo (clave, numero) de imputación choca; la misma operación repetida en la transacción deja un solo efecto", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const cargo = await asiento(s, parte);
        const pago = await asiento(s, parte, { clase: PAGO, importe: "-100.00" });
        const clave = claveNueva();
        acepta(await insertarImputacion(s, parte, pago, cargo, "40.00", { clave, numero: 1 }));
        const otra2 = await insertarImputacion(s, parte, pago, cargo, "40.00", {
          clave,
          numero: 1,
        });
        expect(otra2.ok).toBe(false);
        if (!otra2.ok)
          expect([otra2.codigo, otra2.restriccion]).toEqual([
            "23505",
            "imputacion_de_saldo_clave_uk",
          ]);
        expect(await imputadoDe(s, cargo)).toBe("40.00");
        // Un numero distinto con la misma clave es la segunda fila de la misma operación.
        acepta(await insertarImputacion(s, parte, pago, cargo, "10.00", { clave, numero: 2 }));
        expect(await imputadoDe(s, cargo)).toBe("50.00");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("5. concurrencia (confirma datos de verdad)", () => {
    for (const aislamiento of AISLAMIENTOS) {
      describe(aislamiento, () => {
        /** Corre `a` y `b` en dos sesiones a la vez, con una barrera antes del paso crítico; reintenta el que cae por 40001/40P01. */
        const enParalelo = async (
          preparar: () => Promise<unknown>,
          pasoA: (s: SesionDePrueba, datos: never) => Promise<Intento>,
          pasoB: (s: SesionDePrueba, datos: never) => Promise<Intento>,
        ) => {
          const datos = (await preparar()) as never;
          const una = await abrir(m, aislamiento);
          const dos = await abrir(m, aislamiento);
          try {
            const barrera = crearBarrera(2);
            const correr = async (s: SesionDePrueba, paso: typeof pasoA): Promise<Intento> => {
              await s.intentar("select 1");
              await barrera();
              const r = await paso(s, datos);
              if (!r.ok) {
                await s.deshacer();
                return r;
              }
              return s.confirmar();
            };
            return await Promise.all([correr(una, pasoA), correr(dos, pasoB)]);
          } finally {
            await una.cerrar();
            await dos.cerrar();
          }
        };

        const reintentable = (r: Intento) =>
          !r.ok && (r.codigo === "40001" || r.codigo === "40P01");

        it("a. dos imputaciones sobre el mismo asiento que juntas lo exceden: una confirma, la otra falla por el tope", async () => {
          const parte = await crearParte();
          const s0 = await abrir();
          const cargo = await asiento(s0, parte, { importe: "100.00" });
          const pago1 = await asiento(s0, parte, { clase: PAGO, importe: "-80.00" });
          const pago2 = await asiento(s0, parte, { clase: PAGO, importe: "-80.00" });
          acepta(await s0.confirmar());
          await s0.cerrar();
          const [r1, r2] = await enParalelo(
            () => Promise.resolve({}),
            (s) => insertarImputacion(s, parte, pago1, cargo, "80.00"),
            (s) => insertarImputacion(s, parte, pago2, cargo, "80.00"),
          );
          const falladas = [r1, r2].filter((r) => !r.ok);
          expect(falladas.length).toBe(1);
          const f = falladas[0] as Extract<Intento, { ok: false }>;
          if (aislamiento === "read committed")
            expect(f.restriccion).toBe("saldo_de_asiento_tope_ck");
          else expect(f.restriccion === "saldo_de_asiento_tope_ck" || reintentable(f)).toBe(true);
          const s = await abrir();
          try {
            expect(await imputadoDe(s, cargo)).toBe("80.00");
          } finally {
            await s.cerrar();
          }
        });

        it("a'. dos imputaciones que caben las dos: confirman y la suma es exacta", async () => {
          const parte = await crearParte();
          const s0 = await abrir();
          const cargo = await asiento(s0, parte, { importe: "100.00" });
          const p1 = await asiento(s0, parte, { clase: PAGO, importe: "-30.00" });
          const p2 = await asiento(s0, parte, { clase: PAGO, importe: "-30.00" });
          acepta(await s0.confirmar());
          await s0.cerrar();
          const rs = await enParalelo(
            () => Promise.resolve({}),
            (s) => insertarImputacion(s, parte, p1, cargo, "30.00"),
            (s) => insertarImputacion(s, parte, p2, cargo, "30.00"),
          );
          // Bajo SERIALIZABLE uno puede caer por 40001: se reintenta solo ese.
          for (const [i, r] of rs.entries()) {
            if (!r.ok) {
              expect(reintentable(r), r.mensaje).toBe(true);
              const s = await abrir(m, aislamiento);
              acepta(await insertarImputacion(s, parte, i === 0 ? p1 : p2, cargo, "30.00"));
              acepta(await s.confirmar());
              await s.cerrar();
            }
          }
          const s = await abrir();
          try {
            expect(await imputadoDe(s, cargo)).toBe("60.00");
          } finally {
            await s.cerrar();
          }
        });

        it("b. anular un asiento e imputarlo a la vez: una sola gana y nunca queda imputado un asiento anulado", async () => {
          const parte = await crearParte();
          const s0 = await abrir();
          const cargo = await asiento(s0, parte, { importe: "100.00" });
          const pago = await asiento(s0, parte, { clase: PAGO, importe: "-100.00" });
          acepta(await s0.confirmar());
          await s0.cerrar();
          const rs = await enParalelo(
            () => Promise.resolve({}),
            async (s) => (await espejoDe(s, parte, cargo, { detalle: "Anulo la factura" })).intento,
            (s) => insertarImputacion(s, parte, pago, cargo, "100.00"),
          );
          void rs;
          // Con cualquier entrelazado: o está anulado e imputado 0, o no lo está. Jamás las dos cosas.
          const s = await abrir();
          try {
            const v = await uno<{ anulado: boolean; imputado: string; espejos: string }>(
              s,
              `select a.anulado, a.importe_imputado::text as imputado,
                      (select count(*)::text from asiento_de_saldo e where e.anula_a = a.asiento_id) as espejos
                 from saldo_de_asiento a where a.asiento_id = $1`,
              [cargo],
            );
            expect(v.anulado ? v.imputado === "0.00" : true).toBe(true);
            expect(v.anulado).toBe(v.espejos === "1");
          } finally {
            await s.cerrar();
          }
        });

        it("c. dos asientos simultáneos de la misma parte: el saldo es la suma exacta y el desglose por centro de costo la iguala", async () => {
          const parte = await crearParte();
          const nuevoAsiento = (importe: string, sucursal: string) => async (s: SesionDePrueba) => {
            const r = await insertarAsiento(s, parte, { importe });
            if (!r.ok) return r;
            const id = r.rows[0]?.["id"] as string;
            const d = await distribuir(s, id, [[sucursal, importe]]);
            return d.find((x) => !x.ok) ?? r;
          };
          const rs = await enParalelo(
            () => Promise.resolve({}),
            nuevoAsiento("70.00", norte),
            nuevoAsiento("30.00", sur),
          );
          for (const [i, r] of rs.entries()) {
            if (!r.ok) {
              expect(reintentable(r), r.mensaje).toBe(true);
              const s = await abrir(m, aislamiento);
              acepta(await nuevoAsiento(i === 0 ? "70.00" : "30.00", i === 0 ? norte : sur)(s));
              acepta(await s.confirmar());
              await s.cerrar();
            }
          }
          const s = await abrir();
          try {
            expect(await saldoDe(s, parte)).toBe("100.00");
            const centros = await porCentro(s, parte);
            const total = centros.reduce((a, c) => a + Math.round(Number(c["saldo"]) * 100), 0);
            expect(total).toBe(10000);
          } finally {
            await s.cerrar();
          }
        });

        it("d. dos «deshacer» simultáneos del mismo par: el neto del par nunca baja de cero", async () => {
          const parte = await crearParte();
          const s0 = await abrir();
          const cargo1 = await asiento(s0, parte, { importe: "100.00" });
          const cargo2 = await asiento(s0, parte, { importe: "100.00" });
          const pago = await asiento(s0, parte, { clase: PAGO, importe: "-100.00" });
          acepta(await insertarImputacion(s0, parte, pago, cargo1, "60.00"));
          acepta(await insertarImputacion(s0, parte, pago, cargo2, "40.00"));
          acepta(await s0.confirmar());
          await s0.cerrar();
          // El asiento del pago tiene 100 imputados: por el piso del PAR (no del asiento) solo se puede deshacer 60 contra cargo1.
          const deshacer = (s: SesionDePrueba) =>
            insertarImputacion(s, parte, pago, cargo1, "-60.00");
          const rs = await enParalelo(() => Promise.resolve({}), deshacer, deshacer);
          const confirmadas = rs.filter((r) => r.ok).length;
          expect(confirmadas).toBeLessThanOrEqual(1);
          if (aislamiento === "read committed") expect(confirmadas).toBe(1);
          for (const r of rs) {
            if (!r.ok) {
              expect(
                r.restriccion === "saldo_de_imputacion_no_negativo_ck" || reintentable(r),
                `${r.codigo} ${r.restriccion ?? ""} ${r.mensaje}`,
              ).toBe(true);
            }
          }
          const s = await abrir();
          try {
            const v = await uno<{ neto: string; imputado: string }>(
              s,
              `select (select importe::text from saldo_de_imputacion where saldante_id = $1 and saldado_id = $2) as neto,
                      (select importe_imputado::text from saldo_de_asiento where asiento_id = $1) as imputado`,
              [pago, cargo1],
            );
            expect(Number(v.neto)).toBeGreaterThanOrEqual(0);
            // Se imputaron 100 y se deshizo, como mucho, el 60 de este par: el asiento conserva al menos los 40 del otro.
            expect(Number(v.imputado)).toBeGreaterThanOrEqual(40);
            expect(Number(v.neto) === 0 ? confirmadas === 1 : confirmadas === 0).toBe(true);
          } finally {
            await s.cerrar();
          }
        });

        it("e. dos asientos simultáneos de la PRIMERA vez de la parte y del centro «sin centro de costo»: una sola fila, suma exacta", async () => {
          const parte = await crearParte();
          const sinCentro = (importe: string) => async (s: SesionDePrueba) => {
            const r = await insertarAsiento(s, parte, { importe });
            if (!r.ok) return r;
            const d = await distribuir(s, r.rows[0]?.["id"] as string, [[null, importe]]);
            return d.find((x) => !x.ok) ?? r;
          };
          const rs = await enParalelo(
            () => Promise.resolve({}),
            sinCentro("10.00"),
            sinCentro("5.50"),
          );
          for (const [i, r] of rs.entries()) {
            if (!r.ok) {
              expect(reintentable(r), r.mensaje).toBe(true);
              const s = await abrir(m, aislamiento);
              acepta(await sinCentro(i === 0 ? "10.00" : "5.50")(s));
              acepta(await s.confirmar());
              await s.cerrar();
            }
          }
          const s = await abrir();
          try {
            expect(await saldoDe(s, parte)).toBe("15.50");
            const filas = await porCentro(s, parte);
            expect(filas).toEqual([{ sucursal_id: null, saldo: "15.50" }]);
          } finally {
            await s.cerrar();
          }
        });
      });
    }

    it("f. un asiento y la anonimización simultánea de la misma parte: el asiento espera y, si la anonimización confirma antes, se rechaza", async () => {
      const parte = await crearParte();
      const otro = new pg.Client({ connectionString: b().dueno });
      await otro.connect();
      const s = await abrir();
      try {
        await otro.query("begin");
        await otro.query("update parte set estado = 'ANONIMIZADA', nombre = null where id = $1", [
          parte,
        ]);
        const pendiente = insertarAsiento(s, parte); // espera el FOR SHARE de la fila bloqueada
        await new Promise((r) => setTimeout(r, 400));
        await otro.query("commit");
        const r = await pendiente;
        check(r, "asiento_de_saldo_parte_anonimizada");
      } finally {
        await s.cerrar();
        await otro.end();
      }
    });

    it("6. el rol de la aplicación puede hacer SELECT … FOR SHARE sobre parte (el alta del asiento lo necesita)", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        acepta(await s.intentar("select id from parte where id = $1 for share", [parte]));
        acepta(await insertarAsiento(s, parte));
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("7. atomicidad y cuadre de la distribución (se verifica al confirmar)", () => {
    const existe = async (id: string): Promise<boolean> =>
      ((await dueno.query("select 1 from asiento_de_saldo where id = $1", [id])).rowCount ?? 0) > 0;

    it("un asiento sin distribución falla al confirmar y no deja nada: ni asiento ni saldos", async () => {
      const parte = await crearParte();
      let id = "";
      const r = await confirmando(async (s) => {
        const a = await insertarAsiento(s, parte);
        acepta(a);
        id = (a.ok ? a.rows[0]?.["id"] : "") as string;
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.restriccion).toBe("distribucion_de_asiento_no_cuadra");
      expect(await existe(id)).toBe(false);
      expect(
        (await dueno.query("select 1 from saldo_de_parte where parte_id = $1", [parte])).rowCount,
      ).toBe(0);
    });

    it("una distribución que no suma (por un centavo), una de otro signo que igual suma, y una fila agregada después, fallan al confirmar", async () => {
      const parte = await crearParte();
      const falla = (r: Intento) => {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.restriccion).toBe("distribucion_de_asiento_no_cuadra");
      };
      falla(
        await confirmando(async (s) => {
          await asiento(s, parte, { importe: "10.00" }, [
            [norte, "6.67"],
            [sur, "3.32"],
          ]);
        }),
      );
      falla(
        await confirmando(async (s) => {
          await asiento(s, parte, { importe: "10.00" }, [
            [norte, "12.00"],
            [sur, "-2.00"],
          ]);
        }),
      );
      let id = "";
      acepta(
        await confirmando(async (s) => {
          id = await asiento(s, parte, { importe: "10.00" }, [[norte, "10.00"]]);
        }),
      );
      falla(
        await confirmando(async (s) => {
          await distribuir(s, id, [[sur, "1.00"]]);
        }),
      );
      const lectura = await abrir();
      try {
        expect(await saldoDe(lectura, parte)).toBe("10.00");
      } finally {
        await lectura.cerrar();
      }
    });

    it("una imputación que falla a mitad de una serie no deja ninguna de las anteriores", async () => {
      const parte = await crearParte();
      const s0 = await abrir();
      const cargo = await asiento(s0, parte, { importe: "100.00" });
      const pago = await asiento(s0, parte, { clase: PAGO, importe: "-100.00" });
      acepta(await s0.confirmar());
      await s0.cerrar();
      const s = await abrir();
      try {
        const clave = claveNueva();
        acepta(await insertarImputacion(s, parte, pago, cargo, "60.00", { clave, numero: 1 }));
        acepta(await insertarImputacion(s, parte, pago, cargo, "30.00", { clave, numero: 2 }));
        const tercera = await insertarImputacion(s, parte, pago, cargo, "30.00", {
          clave,
          numero: 3,
        });
        expect(tercera.ok).toBe(false); // 60 + 30 + 30 supera el tope del cargo
        await s.deshacer(); // la aplicación revierte toda la serie
      } finally {
        await s.cerrar();
      }
      const v = await dueno.query<{ n: number }>(
        "select count(*)::int as n from imputacion_de_saldo where saldado_id = $1",
        [cargo],
      );
      expect(v.rows[0]?.n).toBe(0);
      const t = await abrir();
      try {
        expect(await imputadoDe(t, cargo)).toBe("0.00");
      } finally {
        await t.cerrar();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("8. centro de costo", () => {
    it("10,00 en tres sucursales (3,34 + 3,33 + 3,33) suma 10,00; el desglose es el de la distribución; «sin centro de costo» admite una sola fila", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        await asiento(s, parte, { importe: "10.00" }, [
          [m.sucursal, "3.34"],
          [norte, "3.33"],
          [sur, "3.33"],
        ]);
        const filas = await porCentro(s, parte);
        expect(filas.length).toBe(3);
        expect(filas.reduce((a, f) => a + Math.round(Number(f["saldo"]) * 100), 0)).toBe(1000);
        expect(await saldoDe(s, parte)).toBe("10.00");
        const parte2 = await crearParte();
        const a = await insertarAsiento(s, parte2, { importe: "5.00" });
        acepta(a);
        const id = (a.ok ? a.rows[0]?.["id"] : "") as string;
        const [d1, d2] = await distribuir(s, id, [
          [null, "2.00"],
          [null, "3.00"],
        ]);
        acepta(d1 as Intento);
        const dup = d2 as Intento;
        expect(dup.ok).toBe(false);
        if (!dup.ok) expect(dup.restriccion).toBe("distribucion_de_asiento_asiento_uk");
      });
    });

    it("una sucursal de otra empresa no se admite", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const a = await insertarAsiento(s, parte, { importe: "5.00" });
        acepta(a);
        const [d] = await distribuir(s, (a.ok ? a.rows[0]?.["id"] : "") as string, [
          [sucursalDeOtra, "5.00"],
        ]);
        referencia(d as Intento, "distribucion_de_asiento_sucursal_fkey");
      });
    });

    it("el espejo con otra distribución se rechaza al confirmar; con la negada exacta entra y el desglose vuelve a cero", async () => {
      const parte = await crearParte();
      let original = "";
      acepta(
        await confirmando(async (s) => {
          original = await asiento(s, parte, { importe: "10.00" }, [
            [norte, "6.00"],
            [sur, "4.00"],
          ]);
        }),
      );
      const espejo = async (filas: ReadonlyArray<readonly [string | null, string]>) =>
        confirmando(async (s) => {
          acepta((await espejoDe(s, parte, original, {}, filas)).intento);
        });
      const mal = await espejo([
        [norte, "-5.00"],
        [sur, "-5.00"],
      ]);
      expect(mal.ok).toBe(false);
      if (!mal.ok) expect(mal.restriccion).toBe("distribucion_de_asiento_espejo_no_cuadra");
      acepta(
        await espejo([
          [norte, "-6.00"],
          [sur, "-4.00"],
        ]),
      );
      const s = await abrir();
      try {
        expect(await saldoDe(s, parte)).toBe("0.00");
        for (const f of await porCentro(s, parte)) expect(f["saldo"]).toBe("0.00");
      } finally {
        await s.cerrar();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("9. imputación", () => {
    it("orientación: el saldante resta y el saldado suma; mismo signo, invertidos o contra un espejo se rechazan", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const cargo = await asiento(s, parte);
        const cargo2 = await asiento(s, parte);
        const pago = await asiento(s, parte, { clase: PAGO, importe: "-100.00" });
        const pago2 = await asiento(s, parte, { clase: PAGO, importe: "-100.00" });
        for (const [a, b2] of [
          [cargo, cargo2],
          [pago, pago2],
          [cargo, pago],
        ] as const) {
          check(
            await insertarImputacion(s, parte, a, b2, "10.00"),
            "imputacion_de_saldo_signos_invalidos",
          );
        }
        const espejoId = (await espejoDe(s, parte, cargo2)).id;
        check(
          await insertarImputacion(s, parte, espejoId, cargo, "10.00"),
          "imputacion_de_saldo_signos_invalidos",
        );
        const mismo = await insertarImputacion(s, parte, pago, pago, "10.00");
        expect(mismo.ok).toBe(false);
        if (!mismo.ok) expect(mismo.restriccion).toBe("imputacion_de_saldo_distintos_ck");
      });
    });

    it("entre partes distintas o sentidos distintos la FK lo rechaza; el tope y el deshacer se respetan", async () => {
      await conAppDe(b(), m, async (s) => {
        const p1 = await crearParte();
        const p2 = await crearParte();
        const cargo = await asiento(s, p1);
        const pagoDeOtra = await asiento(s, p2, { clase: PAGO, importe: "-100.00" });
        referencia(
          await insertarImputacion(s, p1, pagoDeOtra, cargo, "10.00"),
          "imputacion_de_saldo_saldante_fkey",
        );
        const pago = await asiento(s, p1, { clase: PAGO, importe: "-100.00" });
        referencia(
          await insertarImputacion(s, p1, pago, cargo, "10.00", { sentido: "A_COBRAR" }),
          "imputacion_de_saldo_saldante_fkey",
        );
        const sobrepasa = await insertarImputacion(s, p1, pago, cargo, "100.01");
        expect(sobrepasa.ok).toBe(false);
        if (!sobrepasa.ok) expect(sobrepasa.restriccion).toBe("saldo_de_asiento_tope_ck");
        acepta(await insertarImputacion(s, p1, pago, cargo, "70.00"));
        acepta(await insertarImputacion(s, p1, pago, cargo, "-30.00")); // deshacer parcial
        expect(await imputadoDe(s, cargo)).toBe("40.00");
        const demasiado = await insertarImputacion(s, p1, pago, cargo, "-40.01");
        expect(demasiado.ok).toBe(false);
        if (!demasiado.ok) expect(demasiado.restriccion).toBe("saldo_de_imputacion_no_negativo_ck");
        acepta(await insertarImputacion(s, p1, pago, cargo, "-40.00")); // deshacer total
        expect(await imputadoDe(s, cargo)).toBe("0.00");
        // Un par que nunca se imputó no se puede «deshacer».
        const nuevo = await asiento(s, p1, { clase: PAGO, importe: "-5.00" });
        const sinPar = await insertarImputacion(s, p1, nuevo, cargo, "-1.00");
        expect(sinPar.ok).toBe(false);
        if (!sinPar.ok) expect(sinPar.restriccion).toBe("saldo_de_imputacion_no_negativo_ck");
      });
    });

    it("imputar entre sucursales distintas no mueve ninguna distribución ni el desglose", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const cargo = await asiento(s, parte, { importe: "80.00" }, [[sur, "80.00"]]);
        const nota = await asiento(
          s,
          parte,
          { clase: "NOTA_DE_CREDITO_DE_COMPRA", importe: "-10.00" },
          [[norte, "-10.00"]],
        );
        const antes = await porCentro(s, parte);
        acepta(await insertarImputacion(s, parte, nota, cargo, "10.00"));
        expect(await porCentro(s, parte)).toEqual(antes);
        expect(await saldoDe(s, parte)).toBe("70.00");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("10. espejo", () => {
    it("exacto, con detalle, sobre un original, una sola vez, y no con algo imputado; tras deshacer, se anula", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const cargo = await asiento(s, parte);
        const pago = await asiento(s, parte, { clase: PAGO, importe: "-100.00" });
        const espejo = async (a: Asiento) => (await espejoDe(s, parte, cargo, a)).intento;
        check(await espejo({ detalle: null }), "asiento_de_saldo_espejo_detalle_ck");
        check(await espejo({ importe: "-90.00" }), "asiento_de_saldo_espejo_invalido");
        check(await espejo({ clase: PAGO }), "asiento_de_saldo_espejo_invalido");
        check(await espejo({ origenOrden: 2 }), "asiento_de_saldo_espejo_invalido");
        check(await espejo({ venceEl: "2026-12-31" }), "asiento_de_saldo_vence_el_ck");
        // Con algo imputado no se anula (el CHECK del saldo del asiento lo impide).
        acepta(await insertarImputacion(s, parte, pago, cargo, "10.00"));
        const conImputacion = await espejo({});
        expect(conImputacion.ok).toBe(false);
        if (!conImputacion.ok)
          expect(conImputacion.restriccion).toBe("saldo_de_asiento_anulado_ck");
        // Tras deshacer, se anula.
        acepta(await insertarImputacion(s, parte, pago, cargo, "-10.00"));
        const hecho = await espejoDe(s, parte, cargo);
        acepta(hecho.intento);
        const id = hecho.id;
        // Una sola vez.
        const dos = await espejo({ clave: claveNueva() });
        expect(dos.ok).toBe(false);
        if (!dos.ok) expect(dos.restriccion).toBe("asiento_de_saldo_anula_uk");
        // El anulado no admite nuevas imputaciones, y una anulación no se anula.
        const sobreAnulado = await insertarImputacion(s, parte, pago, cargo, "1.00");
        expect(sobreAnulado.ok).toBe(false);
        if (!sobreAnulado.ok)
          expect(sobreAnulado.restriccion).toBe("imputacion_de_saldo_asiento_anulado");
        check(
          await insertarAsiento(s, parte, {
            naturaleza: "ANULACION",
            anulaA: id,
            importe: "100.00",
            detalle: "x",
          }),
          "asiento_de_saldo_espejo_invalido",
        );
        // Un asiento no se anula contra otra parte (la FK de ancla lo impide).
        const otraParte = await crearParte();
        const otroCargo = await asiento(s, otraParte);
        referencia((await espejoDe(s, parte, otroCargo)).intento, "asiento_de_saldo_anula_fkey");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("11. aislamiento entre empresas", () => {
    it("con el contexto de una empresa no se ve ni se inserta nada de la otra", async () => {
      const parteA = await crearParte(m);
      const parteB = await crearParte(otra);
      acepta(
        await confirmando(async (s) => {
          await asiento(s, parteA, { importe: "10.00" });
        }, m),
      );
      acepta(
        await confirmando(async (s) => {
          await asiento(s, parteB, { importe: "20.00" }, undefined, otra);
        }, otra),
      );
      const sa = await abrir(m);
      const sb = await abrir(otra);
      try {
        for (const t of TABLAS_NUEVAS.filter((x) => x !== "clase_de_asiento")) {
          const deA = await uno<{ n: string }>(
            sa,
            `select count(*)::text as n from ${t} where empresa_id <> $1`,
            [m.empresa],
          );
          const deB = await uno<{ n: string }>(
            sb,
            `select count(*)::text as n from ${t} where empresa_id <> $1`,
            [otra.empresa],
          );
          expect(deA.n, t).toBe("0");
          expect(deB.n, t).toBe("0");
        }
        // Una fila con la empresa de la otra no se inserta (RLS).
        const r = await sa.intentar(
          `insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) values ($1, gen_random_uuid(), null, 1)`,
          [otra.empresa],
        );
        expect(r.ok).toBe(false);
        // Un asiento de A contra una sucursal de B: FK.
        const a = await insertarAsiento(sa, parteA, { importe: "5.00" });
        acepta(a);
        const [d] = await distribuir(sa, (a.ok ? a.rows[0]?.["id"] : "") as string, [
          [sucursalDeOtra, "5.00"],
        ]);
        referencia(d as Intento, "distribucion_de_asiento_sucursal_fkey");
      } finally {
        await sa.cerrar();
        await sb.cerrar();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("12. paridad aritmética con una secuencia al azar", () => {
    /** Generador con semilla fija: la secuencia es siempre la misma. */
    const generador = (semilla: number) => () => {
      semilla = (semilla * 1664525 + 1013904223) % 4294967296;
      return semilla / 4294967296;
    };

    it("tras cada operación: saldo = Σ de los asientos; Σ por centro = saldo; lo imputado de cada asiento = Σ de sus imputaciones", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const azar = generador(20261121);
        const cargos: string[] = [];
        const pagos: string[] = [];
        const todos: string[] = [];
        const centavos = (): string => ((Math.floor(azar() * 99_999) + 1) / 100).toFixed(2);
        const verificar = async () => {
          const v = await uno<{
            saldo: string | null;
            suma: string | null;
            centros: string | null;
          }>(
            s,
            `select (select saldo::text from saldo_de_parte where parte_id = $1) as saldo,
                    (select sum(importe)::text from asiento_de_saldo where parte_id = $1) as suma,
                    (select sum(saldo)::text from saldo_de_parte_por_centro_de_costo where parte_id = $1) as centros`,
            [parte],
          );
          expect(v.saldo).toBe(v.suma);
          expect(v.centros).toBe(v.suma);
          const d = await s.intentar(
            `select a.asiento_id from saldo_de_asiento a
              where a.importe_imputado <> coalesce((select sum(i.importe) from imputacion_de_saldo i
                                                     where i.saldante_id = a.asiento_id or i.saldado_id = a.asiento_id), 0)
                and a.asiento_id = any($1)`,
            [todos],
          );
          expect(d.ok && d.rows.length === 0, "lo imputado no coincide con las imputaciones").toBe(
            true,
          );
        };
        for (let i = 0; i < 60; i += 1) {
          const dado = azar();
          if (dado < 0.3) {
            const imp = centavos();
            const mitad = (Math.floor((Number(imp) * 100) / 2) / 100).toFixed(2);
            const resto = (Number(imp) - Number(mitad)).toFixed(2);
            const id = await asiento(s, parte, { importe: imp }, [
              [norte, mitad],
              [sur, resto],
            ]);
            cargos.push(id);
            todos.push(id);
          } else if (dado < 0.55) {
            const imp = centavos();
            const id = await asiento(s, parte, { clase: PAGO, importe: `-${imp}` }, [
              [null, `-${imp}`],
            ]);
            pagos.push(id);
            todos.push(id);
          } else if (dado < 0.85 && cargos.length > 0 && pagos.length > 0) {
            const pago = pagos[Math.floor(azar() * pagos.length)] as string;
            const cargo = cargos[Math.floor(azar() * cargos.length)] as string;
            const signo = azar() < 0.2 ? "-" : "";
            await insertarImputacion(s, parte, pago, cargo, `${signo}${centavos()}`, { numero: 1 }); // puede rechazarse: la base manda
          } else if (cargos.length > 0) {
            const cargo = cargos[Math.floor(azar() * cargos.length)] as string;
            const r = await espejoDe(s, parte, cargo, { detalle: "Anulo al azar" }); // con algo imputado la base lo rechaza
            if (r.intento.ok) {
              todos.push(r.id);
              cargos.splice(cargos.indexOf(cargo), 1);
            }
          }
          await verificar();
        }
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("13 y 14. fecha de negocio y auditoría", () => {
    it("la fecha de negocio la fija la base con la zona de la empresa (23:30 y 00:30 de Buenos Aires caen en días distintos)", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const fecha = async (hechoEn: string) =>
          (
            await uno<{ f: string }>(
              s,
              "select fecha_negocio::text as f from asiento_de_saldo where id = $1",
              [await asiento(s, parte, { hechoEn })],
            )
          ).f;
        expect(await fecha("2026-11-21T02:30:00Z")).toBe("2026-11-20"); // 23:30 del 20/11 en Buenos Aires
        expect(await fecha("2026-11-21T03:30:00Z")).toBe("2026-11-21"); // 00:30 del 21/11
      });
    });

    it("una empresa con otra zona horaria usa la suya", async () => {
      const mundo = await crearMundo(dueno);
      await dueno.query("update empresa set zona_horaria = 'Asia/Tokyo' where id = $1", [
        mundo.empresa,
      ]);
      const parte = await crearParte(mundo);
      await conAppDe(b(), mundo, async (s) => {
        const id = await asiento(s, parte, { hechoEn: "2026-11-21T02:30:00Z" }, undefined, mundo);
        const v = await uno<{ f: string }>(
          s,
          "select fecha_negocio::text as f from asiento_de_saldo where id = $1",
          [id],
        );
        expect(v.f).toBe("2026-11-21"); // 11:30 en Tokio
      });
    });

    it("la aplicación no puede mandar la fecha de negocio ni el momento de registro; el actor es la persona del contexto", async () => {
      await conAppDe(b(), m, async (s) => {
        const parte = await crearParte();
        const r = await s.intentar(
          `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella,
                                         hecho_en, registrado_por, fecha_negocio)
           values ($1, $2, 'A_PAGAR', $3, 1, 'compras.factura', gen_random_uuid(), $4, $5, $6, $7, '2000-01-01')`,
          [m.empresa, parte, CARGO, claveNueva(), HUELLA, AHORA, m.persona],
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.codigo).toBe("42501");
        const otraPersona = (
          await dueno.query<{ id: string }>(
            "insert into persona (email) values ($1) returning id",
            [`${sufijoUnico()}@otra.test`],
          )
        ).rows[0]?.id as string;
        const ajena = await s.intentar(
          `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella, hecho_en, registrado_por)
           values ($1, $2, 'A_PAGAR', $3, 1, 'compras.factura', gen_random_uuid(), $4, $5, $6, $7)`,
          [m.empresa, parte, CARGO, claveNueva(), HUELLA, AHORA, otraPersona],
        );
        expect(ajena.ok).toBe(false);
        if (!ajena.ok) expect(ajena.codigo).toBe("42501");
        const id = await asiento(s, parte);
        const v = await uno<{ ok: boolean }>(
          s,
          "select registrado_en is not null and registrado_por = $2 as ok from asiento_de_saldo where id = $1",
          [id, m.persona],
        );
        expect(v.ok).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("15. la migración no toca lo que ya existía", () => {
    it("el catálogo de todo lo anterior (tablas, columnas, restricciones, disparadores, políticas, privilegios y funciones) queda idéntico", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base, { migrar: false });
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      const carpeta = await mkdtemp(join(tmpdir(), "pedernal-sin-0092-"));
      try {
        for (const f of await readdir(CARPETA_DE_MIGRACIONES)) {
          // 0106 (cuenta corriente) depende de 0092: sin el libro no corre, y no es parte de «lo que ya existía».
          if (f.endsWith(".sql") && f !== MIGRACION && f !== "0106_cuenta_del_cliente.sql")
            await cp(join(CARPETA_DE_MIGRACIONES, f), join(carpeta, f));
        }
        await aplicarMigraciones(aparte.base.dueno, carpeta);
        const nuevas = TABLAS_NUEVAS as unknown as string[];
        const funciones = FUNCIONES_NUEVAS as unknown as string[];
        const foto = async (): Promise<string> => {
          const q = async (texto: string, p: unknown[] = []) =>
            (await c.query<{ x: string }>(texto, p)).rows.map((r) => r.x);
          const partes = {
            columnas: await q(
              `select concat_ws('|', table_name, column_name, data_type, is_nullable, column_default, is_generated, generation_expression) as x
                 from information_schema.columns where table_schema = 'public' and table_name <> all($1) order by 1`,
              [nuevas],
            ),
            restricciones: await q(
              `select concat_ws('|', k.conrelid::regclass::text, k.conname, pg_get_constraintdef(k.oid)) as x
                 from pg_constraint k join pg_class r on r.oid = k.conrelid
                where r.relnamespace = 'public'::regnamespace and r.relname <> all($1) order by 1`,
              [nuevas],
            ),
            disparadores: await q(
              `select pg_get_triggerdef(t.oid) as x from pg_trigger t join pg_class r on r.oid = t.tgrelid
                where not t.tgisinternal and r.relnamespace = 'public'::regnamespace and r.relname <> all($1) order by 1`,
              [nuevas],
            ),
            politicas: await q(
              `select concat_ws('|', tablename, policyname, cmd, roles, qual, with_check) as x from pg_policies
                where schemaname = 'public' and tablename <> all($1) order by 1`,
              [nuevas],
            ),
            rls: await q(
              `select concat_ws('|', relname, relrowsecurity, relforcerowsecurity, relacl) as x from pg_class
                where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> all($1) order by 1`,
              [nuevas],
            ),
            columnasConPrivilegio: await q(
              `select concat_ws('|', table_name, column_name, grantee, privilege_type) as x from information_schema.column_privileges
                where table_schema = 'public' and table_name <> all($1) and grantee like 'pedernal%' order by 1`,
              [nuevas],
            ),
            funciones: await q(
              `select concat(pg_get_functiondef(p.oid), '|', coalesce(p.proacl::text, '')) as x from pg_proc p
                where p.pronamespace = 'public'::regnamespace and p.proname <> all($1) order by 1`,
              [funciones],
            ),
            relaciones: await q(
              `select concat_ws('|', relname, relkind) as x from pg_class where relnamespace = 'public'::regnamespace and relname <> all($1)
                 and relkind in ('r', 'v', 'S', 'm') and relname !~ '^(asiento_de_saldo|distribucion_de_asiento|imputacion_de_saldo|saldo_de_|clase_de_asiento)' order by 1`,
              [nuevas],
            ),
          };
          return JSON.stringify(partes);
        };
        const antes = await foto();
        await c.query(await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8"));
        const despues = await foto();
        expect(despues).toBe(antes);
        const { rows } = await c.query<{ n: number }>(
          "select count(*)::int as n from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace",
          [nuevas],
        );
        expect(rows[0]?.n).toBe(nuevas.length);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("16. reversión", () => {
    it("ciclo aplicar → revertir → aplicar deja el mismo esquema; con un asiento cargado se frena siempre", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const reversion = await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8");
        const migracion = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
        const esquema = async (): Promise<string> =>
          JSON.stringify(
            (
              await c.query(
                `select 'c' as t, table_name || '.' || column_name || ':' || data_type as x from information_schema.columns where table_schema = 'public' and table_name = any($1)
                 union all select 'k', conname || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid::regclass::text = any($1)
                 union all select 'g', tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text = any($1)
                 union all select 'f', proname from pg_proc where proname = any($2)
                 union all select 'p', policyname from pg_policies where tablename = any($1) order by 1, 2`,
                [TABLAS_NUEVAS as unknown as string[], FUNCIONES_NUEVAS as unknown as string[]],
              )
            ).rows,
          );
        const hay = async () =>
          (
            await c.query<{ v: boolean }>(
              "select to_regclass('public.asiento_de_saldo') is not null as v",
            )
          ).rows[0]?.v === true;
        const correr = async (texto: string): Promise<string | null> => {
          try {
            await c.query(`begin; ${texto}; commit;`);
            return null;
          } catch (e) {
            await c.query("rollback");
            return (e as { message: string }).message;
          }
        };
        const original = await esquema();
        expect(await hay()).toBe(true);
        expect(await correr(reversion)).toBeNull();
        expect(await hay()).toBe(false);
        expect(await correr(reversion)).toBeNull(); // repetida: no cambia nada
        expect(
          (await c.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount,
        ).toBe(0);
        await c.query(migracion);
        expect(await esquema()).toBe(original);

        // Con un rol sin BYPASSRLS el mensaje es claro y no se toca nada.
        const rol = `revisor_${sufijoUnico()}`;
        await c.query(`create role ${rol} nologin`);
        try {
          expect(await correr(`set local role ${rol}; ${reversion}`)).toMatch(/evada RLS/);
          expect(await hay()).toBe(true);
        } finally {
          await c.query(`drop role ${rol}`);
        }

        // Con un asiento cargado, se frena siempre (ni con la variable de confirmación de otras reversiones).
        const mundo = await crearMundo(c);
        const parte = randomUUID();
        await c.query(
          `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, creado_por)
           values ($1, $2, gen_random_uuid(), 'JURIDICA', 'Proveedor de reversión', $3)`,
          [parte, mundo.empresa, mundo.persona],
        );
        const s = await SesionDePrueba.abrir(
          aparte.base,
          "pedernal_app",
          comoEmpresa(empresaId(mundo.empresa), personaId(mundo.persona)),
        );
        try {
          const a = await s.intentar(
            `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella, hecho_en, registrado_por)
             values ($1, $2, 'A_PAGAR', $3, 10, 'compras.factura', gen_random_uuid(), $4, $5, $6, $7) returning id`,
            [mundo.empresa, parte, CARGO, claveNueva(), HUELLA, AHORA, mundo.persona],
          );
          acepta(a);
          acepta(
            await s.intentar(
              "insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) values ($1, $2, $3, 10)",
              [mundo.empresa, a.ok ? a.rows[0]?.["id"] : null, mundo.sucursal],
            ),
          );
          acepta(await s.confirmar());
        } finally {
          await s.cerrar();
        }
        expect(await correr(reversion)).toMatch(/hay 1 asientos en el libro de saldos/);
        expect(await correr(`set local pedernal.confirmar_reversion = 'SI'; ${reversion}`)).toMatch(
          /hay 1 asientos/,
        );
        expect(await hay()).toBe(true);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });
});
