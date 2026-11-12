import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { MOTIVOS_DE_DIFERENCIA } from "../../src/modulos/stock/dominio/motivos-de-diferencia";
import { crearMundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  baseConMigraciones,
  carpetaCon,
  CARPETA_DE_MIGRACIONES,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import { articuloDeBase, depositoDeBase } from "./stock-apoyo";
import {
  montarStock,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";
import { abrirConteoDe, conStock, contarEn, hace, movimientoEn } from "./stock-conteo-hora-apoyo";

/**
 * La migración 0042 (E5, conteo con hora) contra una base real: aditiva y compatible hacia atrás (CM1: los registros viejos se leen con la hora de
 * carga), reversible y la reversión frena con datos; las tablas nuevas son de solo inserción aun para el dueño de la base (CT1), la lista de motivos
 * es la del código, y la base rechaza por sí sola lo que el caso de uso ya valida (la cuenta, el motivo del sentido, las marcas que no explican).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ARCHIVO = "0042_conteo_con_hora.sql";
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};
const textoDeLaReversion = () =>
  readFile(
    join(CARPETA_DE_MIGRACIONES, "reversiones", "0042_revertir_conteo_con_hora.sql"),
    "utf8",
  );
const migracionesPrevias = async () =>
  (await readdir(CARPETA_DE_MIGRACIONES))
    .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < ARCHIVO)
    .sort();

describe.skipIf(base === null)("0042 conteo con hora: la migración y su reversión", () => {
  it("CM1: se aplica con un conteo abierto y registros viejos (se leen con la hora de carga), baja dejando el esquema como antes, y la reversión pide confirmar si hay datos", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    const conMia = await carpetaCon([...(await migracionesPrevias()), ARCHIVO]);
    try {
      await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
      const c = previa.cliente;
      const antes = await huellaDeCatalogo(c);
      const reversion = await textoDeLaReversion();
      const fila = async () =>
        (await c.query("select 1 from migracion where nombre = $1", [ARCHIVO])).rows.length;

      // Un conteo abierto con un registro cargado ANTES de la migración (sin hora declarada).
      const m = await crearMundo(c);
      const dep = await depositoDeBase(c, m);
      const a = await articuloDeBase(c, m);
      const conteo = randomUUID();
      await c.query(
        "insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())",
        [conteo, m.empresa, dep, m.persona],
      );
      const viejo = randomUUID();
      await c.query(
        `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en)
         values ($1, $2, $3, $4, 5, $5, '2026-10-11T12:00:00Z')`,
        [viejo, m.empresa, conteo, a.articulo, m.persona],
      );

      // Si ya existe una de sus tablas, frena sin aplicar nada.
      await c.query("create table conteo_marca (x int)");
      await expect(aplicarMigraciones(previa.aparte.base.dueno, conMia)).rejects.toThrow(
        /ya está aplicada/,
      );
      await c.query("drop table conteo_marca");
      expect(await fila()).toBe(0);
      expect(await huellaDeCatalogo(c)).toEqual(antes);

      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(await fila()).toBe(1);
      const conHora = await huellaDeCatalogo(c);
      expect(conHora).not.toEqual(antes);
      // El registro viejo sigue ahí, sin hora declarada: vale la de carga.
      const leido = (
        await c.query<{ contado_en: Date | null; hora: Date }>(
          "select contado_en, coalesce(contado_en, registrado_en) as hora from conteo_registro where id = $1",
          [viejo],
        )
      ).rows[0];
      expect(leido?.contado_en).toBeNull();
      expect(leido?.hora.toISOString()).toBe("2026-10-11T12:00:00.000Z");

      // Sin datos de la migración (el registro viejo no cuenta), la reversión baja sin confirmar y deja el esquema como estaba.
      await c.query(`begin; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);
      expect(await fila()).toBe(0);
      expect(
        (
          await c.query("select cantidad_contada::text as q from conteo_registro where id = $1", [
            viejo,
          ])
        ).rows[0],
      ).toEqual({ q: "5.0000" });
      await aplicarMigraciones(previa.aparte.base.dueno, conMia);

      // Con una hora declarada cargada: sin confirmar no borra nada; confirmada, sí.
      await c.query(
        `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en, contado_en)
         values ($1, $2, $3, $4, 6, $5, '2026-10-11T12:10:00Z', '2026-10-11T12:00:00Z')`,
        [randomUUID(), m.empresa, conteo, a.articulo, m.persona],
      );
      await c.query("begin");
      await expect(c.query(reversion)).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/avisar al dueño/) as string,
      });
      await c.query("rollback");
      expect(await fila()).toBe(1);
      expect(
        (
          await c.query(
            "select count(*)::int as n from conteo_registro where contado_en is not null",
          )
        ).rows[0],
      ).toEqual({ n: 1 });
      await c.query(`begin; set local pedernal.confirmar_reversion = 'SI'; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);
      // Repetirla no cambia nada.
      await c.query(`begin; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  it("la reversión declara que es destructiva con datos, no usa CASCADE ni TRUNCATE y solo borra su fila del registro", async () => {
    const texto = await textoDeLaReversion();
    const plano = texto.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/DESTRUCTIVA/);
    expect(plano).toMatch(/NO SE RECUPERA/);
    expect(plano).toMatch(/NO lo aplica el ejecutor de migraciones/);
    const codigo = texto.replace(/--.*$/gm, "");
    const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
    expect(borrados).toHaveLength(1);
    expect(borrados[0]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
    expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
  });
});

describe.skipIf(base === null)("0042 conteo con hora: lo que la base impone por sí sola", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  type Armado = Readonly<{
    dep: string;
    articulo: string;
    producto: string;
    id: string;
    registro: string;
    /** Una venta de 1 posterior a la hora del conteo (candidata para marcar un faltante). */
    venta: string;
  }>;
  /** Un conteo con 20 en el depósito y 18 contados a las 10:00, ya APLICADO por SQL (sin explicación escrita): lo que sigue la escribe el dueño a mano. */
  const armar = async (aplicar = true): Promise<Armado> => {
    const s = await conStock(c, e, "20");
    const venta = await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "-1",
      hechoEn: hace(-5),
    });
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    const registro = (
      await c.filas<{ id: string }>("select id from conteo_registro where conteo_id = $1", [id])
    )[0]?.id as string;
    if (aplicar) {
      await c.dueno.query(
        "update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1",
        [id, e.personaDelGerente],
      );
    }
    return { ...s, id, registro, venta };
  };
  const diferencia = (t: Armado, valores: Record<string, unknown> = {}) => {
    const v = {
      registro_id: t.registro,
      articulo_id: t.articulo,
      contada: "18",
      contado_en: hace(-10),
      existencia_a_la_hora: "20",
      diferencia_bruta: "-2",
      marcado: "0",
      diferencia_final: "-2",
      motivo: "ROTURA",
      detalle: null,
      ...valores,
    };
    return c.dueno.query(
      `insert into conteo_diferencia (empresa_id, conteo_id, articulo_id, registro_id, contada, contado_en, existencia_a_la_hora, diferencia_bruta,
                                      marcado, diferencia_final, motivo, detalle, explicada_por, explicada_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
      [
        e.empresa,
        t.id,
        v.articulo_id,
        v.registro_id,
        v.contada,
        v.contado_en,
        v.existencia_a_la_hora,
        v.diferencia_bruta,
        v.marcado,
        v.diferencia_final,
        v.motivo,
        v.detalle,
        e.personaDelGerente,
      ],
    );
  };
  const marca = (
    t: Armado,
    movimiento: string,
    numero: number,
    cantidad: string,
    articulo = t.articulo,
  ) =>
    c.dueno.query(
      `insert into conteo_marca (empresa_id, conteo_id, articulo_id, movimiento_id, numero, cantidad, marcada_por, marcada_en)
       values ($1, $2, $3, $4, $5, $6, $7, now())`,
      [e.empresa, t.id, articulo, movimiento, numero, cantidad, e.personaDelGerente],
    );
  /** El trabajo dentro de una transacción que se deshace: lo que la base rechaza no deja nada. */
  const rechazada = async (
    trabajo: () => Promise<unknown>,
    codigo: string,
    restriccion: string,
  ) => {
    await c.dueno.query("begin");
    try {
      await expect(trabajo()).rejects.toMatchObject({ code: codigo, constraint: restriccion });
    } finally {
      await c.dueno.query("rollback");
    }
  };

  it("la lista de motivos sembrada es la del código (mismo orden, sentido y detalle) y es de solo lectura", async () => {
    const filas = await c.filas<{
      codigo: string;
      sentido: string;
      pide_detalle: boolean;
      orden: number;
    }>(
      "select codigo, sentido, pide_detalle, orden from motivo_de_diferencia order by sentido, orden",
    );
    expect(filas).toEqual(
      [...MOTIVOS_DE_DIFERENCIA]
        .map((m) => ({
          codigo: m.codigo,
          sentido: m.sentido,
          pide_detalle: m.pideDetalle,
          orden: m.orden,
        }))
        .sort((x, y) =>
          x.sentido === y.sentido ? x.orden - y.orden : x.sentido < y.sentido ? -1 : 1,
        ),
    );
    await expect(
      c.dueno.query("update motivo_de_diferencia set pide_detalle = true"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(c.dueno.query("delete from motivo_de_diferencia")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("CT1: nada del conteo se actualiza, se borra ni se vacía: ni conteo_diferencia, ni conteo_marca, ni conteo_registro (aun el dueño de la base)", async () => {
    const t = await armar();
    // Con filas en las tres (una diferencia explicada con una marca): sobre una tabla vacía ningún disparador de fila llegaría a correr.
    await c.dueno.query("begin");
    await diferencia(t, { marcado: "-1", diferencia_final: "-1" });
    await marca(t, t.venta, 1, "-1");
    await c.dueno.query("commit");
    for (const tabla of ["conteo_diferencia", "conteo_marca", "conteo_registro"]) {
      await expect(
        c.dueno.query(`update ${tabla} set empresa_id = empresa_id`),
        `update ${tabla}`,
      ).rejects.toMatchObject({ code: "42501" });
      await expect(c.dueno.query(`delete from ${tabla}`), `delete ${tabla}`).rejects.toMatchObject({
        code: "42501",
      });
      // Vaciar una tabla que otra referencia lo frena Postgres antes (`0A000`); las demás, el disparador (`42501`).
      await expect(c.dueno.query(`truncate ${tabla}`), `truncate ${tabla}`).rejects.toMatchObject({
        code: expect.stringMatching(/^(42501|0A000)$/) as string,
      });
    }
  });

  it("la explicación solo entra con el conteo aplicado, de la carga vigente y con lo contado y la hora de esa carga", async () => {
    const abierto = await armar(false);
    await rechazada(() => diferencia(abierto), "23514", "conteo_diferencia_conteo_no_aplicado");
    const t = await armar();
    // Una carga de otro conteo.
    await rechazada(
      () => diferencia(t, { registro_id: abierto.registro }),
      "23514",
      "conteo_diferencia_registro_ajeno",
    );
    await rechazada(
      () => diferencia(t, { registro_id: randomUUID() }),
      "23503",
      "conteo_diferencia_registro_fkey",
    );
    // Lo contado y la hora son los de la carga.
    await rechazada(
      () => diferencia(t, { contada: "17", diferencia_bruta: "-3", diferencia_final: "-3" }),
      "23514",
      "conteo_diferencia_distinta_de_la_carga",
    );
    await rechazada(
      () => diferencia(t, { contado_en: hace(-9) }),
      "23514",
      "conteo_diferencia_distinta_de_la_carga",
    );
    // Una carga que ya no es la vigente (se recontó después de cargarla).
    const recontado = await armar(false);
    valorDe(
      await contarEn(c, e.gerente, recontado.id, recontado.producto, "19", {
        contadoEn: hace(-10),
      }),
    );
    await c.dueno.query(
      "update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1",
      [recontado.id, e.personaDelGerente],
    );
    await rechazada(() => diferencia(recontado), "23514", "conteo_diferencia_registro_no_vigente");
    // La explicación correcta entra, y una sola vez por artículo.
    await diferencia(t);
    await rechazada(() => diferencia(t), "23505", "conteo_diferencia_pkey");
  });

  it("la cuenta y el motivo los exige la base: bruta = contada − existencia, final = bruta − marcado, motivo nulo si y solo si no queda diferencia, del sentido que corresponde y con detalle si lo pide", async () => {
    const t = await armar();
    const casos: [Record<string, unknown>, string, string][] = [
      [{ diferencia_bruta: "-3" }, "23514", "conteo_diferencia_bruta_ck"],
      [{ diferencia_final: "-1" }, "23514", "conteo_diferencia_cuenta_ck"],
      [{ motivo: null }, "23514", "conteo_diferencia_motivo_ck"],
      [
        { contada: "20", diferencia_bruta: "0", diferencia_final: "0" },
        "23514",
        "conteo_diferencia_distinta_de_la_carga",
      ],
      [
        { marcado: "-3", diferencia_final: "1", motivo: "DEVOLUCION_DE_CLIENTE" },
        "23514",
        "conteo_diferencia_marcado_ck",
      ],
      [{ marcado: "1", diferencia_final: "-3" }, "23514", "conteo_diferencia_marcado_ck"],
      [{ motivo: "DEVOLUCION_DE_CLIENTE" }, "23514", "conteo_diferencia_motivo_sentido"],
      [{ motivo: "OTRA_SALIDA" }, "23514", "conteo_diferencia_detalle_requerido"],
      // Un motivo que no está en la lista tampoco tiene sentido: lo frena el disparador antes que la clave.
      [{ motivo: "COMPRA" }, "23514", "conteo_diferencia_motivo_sentido"],
      [{ detalle: "con <script>" }, "23514", "conteo_diferencia_detalle_ck"],
    ];
    for (const [valores, codigo, restriccion] of casos) {
      await rechazada(() => diferencia(t, valores), codigo, restriccion);
    }
    // Sin diferencia no hay motivo ni detalle (la carga de 20 contra lo que había).
    const igual = await armar(false);
    valorDe(await contarEn(c, e.gerente, igual.id, igual.producto, "20", { contadoEn: hace(-10) }));
    await c.dueno.query(
      "update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1",
      [igual.id, e.personaDelGerente],
    );
    const vigente = (
      await c.filas<{ id: string }>(
        "select id from conteo_registro where conteo_id = $1 order by orden desc limit 1",
        [igual.id],
      )
    )[0]?.id as string;
    const sinDiferencia = {
      registro_id: vigente,
      contada: "20",
      diferencia_bruta: "0",
      diferencia_final: "0",
    };
    await rechazada(
      () => diferencia(igual, { ...sinDiferencia, motivo: "DEVOLUCION_DE_CLIENTE" }),
      "23514",
      "conteo_diferencia_motivo_ck",
    );
    await rechazada(
      () => diferencia(igual, { ...sinDiferencia, motivo: null, detalle: "algo" }),
      "23514",
      "conteo_diferencia_detalle_con_motivo_ck",
    );
    await diferencia(igual, { ...sinDiferencia, motivo: null });
  });

  it("las marcas: del mismo depósito y artículo, posteriores a la hora y del sentido de la diferencia; y lo marcado es EXACTAMENTE la suma de las marcas al confirmar", async () => {
    const t = await armar();
    const entradaPosterior = await movimientoEn(c, e, {
      dep: t.dep,
      articulo: t.articulo,
      cantidad: "5",
      hechoEn: hace(-5),
    });
    const anterior = await movimientoEn(c, e, {
      dep: t.dep,
      articulo: t.articulo,
      cantidad: "-1",
      hechoEn: hace(-20),
    });
    const otroArticulo = await c.articulo(e);
    const deOtro = await movimientoEn(c, e, {
      dep: t.dep,
      articulo: otroArticulo.articulo,
      cantidad: "-1",
      hechoEn: hace(-5),
    });
    const conMarcado = (trabajo: () => Promise<unknown>) => async () => {
      await diferencia(t, { marcado: "-1", diferencia_final: "-1" });
      return trabajo();
    };
    const noExplica = "conteo_marca_no_explica";
    await rechazada(
      conMarcado(() => marca(t, entradaPosterior, 1, "5")),
      "23514",
      noExplica,
    );
    await rechazada(
      conMarcado(() => marca(t, anterior, 1, "-1")),
      "23514",
      noExplica,
    );
    await rechazada(
      conMarcado(() => marca(t, deOtro, 1, "-1")),
      "23514",
      noExplica,
    );
    await rechazada(
      conMarcado(() => marca(t, t.venta, 1, "-2")),
      "23514",
      noExplica,
    );
    await rechazada(
      conMarcado(() => marca(t, randomUUID(), 1, "-1")),
      "23503",
      "conteo_marca_renglon_fkey",
    );
    // Marcar sin la explicación del artículo.
    await rechazada(() => marca(t, t.venta, 1, "-1"), "23503", "conteo_marca_diferencia_fkey");
    // Lo marcado sin sus marcas, o las marcas sin lo marcado, no se confirma.
    await c.dueno.query("begin");
    await diferencia(t, { marcado: "-1", diferencia_final: "-1" });
    await expect(c.dueno.query("commit")).rejects.toMatchObject({
      code: "23514",
      constraint: "conteo_diferencia_marcado_distinto_de_las_marcas",
    });
    // Con la marca que corresponde, sí.
    await c.dueno.query("begin");
    await diferencia(t, { marcado: "-1", diferencia_final: "-1" });
    await marca(t, t.venta, 1, "-1");
    await c.dueno.query("commit");
    expect(
      await c.contar("select count(*) as n from conteo_marca where conteo_id = $1", [t.id]),
    ).toBe(1);
    await rechazada(() => marca(t, t.venta, 1, "-1"), "23505", "conteo_marca_pkey");
  });
});
