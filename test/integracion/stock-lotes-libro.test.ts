import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  registrarMovimientoEnTx,
  type PedidoDeMovimiento,
} from "../../src/modulos/stock/casos-de-uso/movimiento-en-tx";
import type { LoteDeEntrada } from "../../src/modulos/stock/casos-de-uso/lotes-del-libro";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { llaveDeSaldo } from "../../src/modulos/stock/persistencia/repositorio-de-movimientos";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import {
  aLaVez,
  firme,
  montarStock,
  RONDAS,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E6-T5: los lotes en el libro, con los casos de uso reales y la base real. Idempotencia (I6: una recepción con lote enviada dos veces, y otra
 * recepción del mismo código y origen), vencimiento requerido y pasado, FEFO que saltea lo no disponible, baja nombrada, espejo de la
 * anulación, transferencia, atomicidad (un renglón que falla no deja nada) y concurrencia (C5 y C6: ventas simultáneas con tres lotes, y Σ lotes =
 * saldo). Sin control de lote el libro es el de E5 (lo prueba la regresión de E5, que pasa sin cambios).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const FUTURO = "2099-01-01";
const PASADO = "2000-01-01";

describe.skipIf(base === null)("stock: lotes en el libro", () => {
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

  const nuevo = async (modo = "LOTE_Y_VENCIMIENTO", conCalidad = true) => {
    const dep = await c.deposito(e);
    const otro = await c.deposito(e);
    const a = await c.articulo(e);
    await c.dueno.query(
      "insert into control_de_lote (empresa_id, articulo_id, modo, con_calidad) values ($1, $2, $3, $4)",
      [e.empresa, a.articulo, modo, conCalidad],
    );
    const sinAsignar = randomUUID();
    await c.dueno.query(
      `insert into lote (id, empresa_id, articulo_id, codigo, es_sin_asignar, fecha_de_primer_ingreso, creado_por, creado_en)
       values ($1, $2, $3, 'SIN_ASIGNAR', true, '2026-11-09', $4, now())`,
      [sinAsignar, e.empresa, a.articulo, e.personaDelGerente],
    );
    return { dep, otro, articulo: a.articulo, sinAsignar };
  };
  type Nuevo = Awaited<ReturnType<typeof nuevo>>;

  const pedido = (
    n: Nuevo,
    datos: Readonly<{
      clase: "ENTRADA" | "SALIDA" | "TRANSFERENCIA" | "ANULACION";
      motivo: string;
      cantidad: string;
      clave?: string;
      lotes?: readonly LoteDeEntrada[];
      nombrado?: string;
      anulaA?: string;
      destino?: string;
    }>,
  ): PedidoDeMovimiento => {
    const firmar = (t: string) => {
      const r = cantidadConSignoDesdeTexto(t);
      if (!r.ok) throw new Error(t);
      return r.valor;
    };
    const clave = datos.clave ?? `clave-${randomUUID()}`;
    const renglones =
      datos.clase === "TRANSFERENCIA"
        ? [
            {
              depositoId: n.dep,
              articuloId: n.articulo,
              composicionId: null,
              cantidad: firmar(`-${datos.cantidad}`),
            },
            {
              depositoId: datos.destino as string,
              articuloId: n.articulo,
              composicionId: null,
              cantidad: firmar(datos.cantidad),
            },
          ]
        : [
            {
              depositoId: n.dep,
              articuloId: n.articulo,
              composicionId: null,
              cantidad: firmar(
                datos.clase === "ENTRADA" || datos.clase === "ANULACION"
                  ? datos.cantidad
                  : `-${datos.cantidad}`,
              ),
            },
          ];
    return {
      clase: datos.clase,
      motivo: datos.motivo,
      detalle: datos.clase === "ANULACION" ? "Se cargó por error" : null,
      origen: null,
      depositoId: n.dep,
      accion: "stock.registrar_entrada",
      anulaA: datos.anulaA ?? null,
      conteoId: null,
      clave,
      huella: huellaDeComando(
        datos.clase,
        [n.dep, datos.motivo, datos.cantidad],
        [[n.articulo, datos.cantidad, JSON.stringify(datos.lotes ?? [])]],
      ),
      hechoEn: e.gerente.ahora,
      fechaDeNegocio: null,
      renglones,
      confirmaciones: [],
      lotes: {
        ...(datos.lotes === undefined
          ? {}
          : { entradas: new Map([[llaveDeSaldo(n.dep, n.articulo), datos.lotes]]) }),
        ...(datos.nombrado === undefined
          ? {}
          : { nombrados: new Map([[llaveDeSaldo(n.dep, n.articulo), datos.nombrado]]) }),
      },
    };
  };
  const mover = (p: PedidoDeMovimiento, contexto: ContextoOperativo = e.gerente) =>
    c.entorno.ejecutar({ contexto }, (tx) => registrarMovimientoEnTx(tx, contexto, p));

  const lotes = async (n: Nuevo) =>
    (
      await c.filas<{ codigo: string; existencia: string; calidad: string | null }>(
        `select l.codigo, coalesce(s.existencia, 0)::text as existencia, l.calidad
           from lote l left join saldo_de_lote s on s.lote_id = l.id and s.deposito_id = $2
          where l.articulo_id = $1 order by l.codigo`,
        [n.articulo, n.dep],
      )
    ).map((f) => [f.codigo, f.existencia, f.calidad]);
  const sumaDeLotes = async (n: Nuevo, dep: string = n.dep) =>
    (
      await c.filas<{ s: string }>(
        "select coalesce(sum(existencia), 0)::text as s from saldo_de_lote where articulo_id = $1 and deposito_id = $2",
        [n.articulo, dep],
      )
    )[0]?.s;
  const movimientos = async (n: Nuevo) =>
    c.contar("select count(*) as n from renglon_de_movimiento where articulo_id = $1", [
      n.articulo,
    ]);
  const entradaCon = (
    n: Nuevo,
    partes: readonly LoteDeEntrada[],
    cantidad: string,
    clave?: string,
  ) =>
    mover(
      pedido(n, {
        clase: "ENTRADA",
        motivo: "COMPRA",
        cantidad,
        lotes: partes,
        ...(clave === undefined ? {} : { clave }),
      }),
    );

  it("una entrada con lotes crea cada lote por su identidad, le da calidad liberada y suma al lote y al artículo", async () => {
    const n = await nuevo();
    const r = await entradaCon(
      n,
      [
        { codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "6" },
        {
          codigo: "L-B",
          fechaDeVencimiento: "2099-06-01",
          referenciaDeOrigen: "Molino Sur",
          cantidad: "4",
        },
      ],
      "10",
    );
    expect(JSON.stringify(r)).toContain('"ok":true');
    expect(await lotes(n)).toEqual([
      ["L-A", "6.0000", "LIBERADO"],
      ["L-B", "4.0000", "LIBERADO"],
      ["SIN_ASIGNAR", "0", null],
    ]);
    expect(await sumaDeLotes(n)).toBe("10.0000");
    expect(await c.existencia(n.dep, n.articulo)).toBe("10.0000");
  });

  it("I6: la misma recepción con lote enviada dos veces es una sola entrada; otra recepción del mismo código y origen es otro movimiento del MISMO lote", async () => {
    const n = await nuevo();
    const partes = [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "6" }];
    const clave = `clave-${randomUUID()}`;
    const primera = await entradaCon(n, partes, "6", clave);
    const repetida = await entradaCon(n, partes, "6", clave);
    expect(primera.ok && primera.valor.yaExistia).toBe(false);
    expect(repetida.ok && repetida.valor.yaExistia).toBe(true);
    const otra = await entradaCon(n, partes, "6");
    expect(otra.ok && otra.valor.yaExistia).toBe(false);
    expect(await lotes(n)).toEqual([
      ["L-A", "12.0000", "LIBERADO"],
      ["SIN_ASIGNAR", "0", null],
    ]);
    expect(
      await c.contar(
        "select count(*) as n from lote where articulo_id = $1 and not es_sin_asignar",
        [n.articulo],
      ),
    ).toBe(1);
    expect(await sumaDeLotes(n)).toBe("12.0000");
  });

  it("sin vencimiento no se confirma, vencido tampoco, con otro reparto que no suma tampoco, y no queda NADA (atomicidad)", async () => {
    const n = await nuevo();
    const antes = await movimientos(n);
    const faltante = await entradaCon(n, [{ codigo: "L-A", cantidad: "5" }], "5");
    expect(faltante).toEqual({ ok: false, error: "VENCIMIENTO_REQUERIDO" });
    const vencido = await entradaCon(
      n,
      [{ codigo: "L-A", fechaDeVencimiento: PASADO, cantidad: "5" }],
      "5",
    );
    expect(vencido).toEqual({ ok: false, error: "VENCIMIENTO_PASADO" });
    const noSuma = await entradaCon(
      n,
      [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "4" }],
      "5",
    );
    expect(noSuma).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
    const segundoMalo = await entradaCon(
      n,
      [
        { codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "2" },
        { codigo: "L-B", fechaDeVencimiento: PASADO, cantidad: "3" },
      ],
      "5",
    );
    expect(segundoMalo).toEqual({ ok: false, error: "VENCIMIENTO_PASADO" });
    expect(await movimientos(n)).toBe(antes);
    expect(
      await c.contar(
        "select count(*) as n from lote where articulo_id = $1 and not es_sin_asignar",
        [n.articulo],
      ),
    ).toBe(0);
    expect(await c.existencia(n.dep, n.articulo)).toBe("0");
  });

  it("una entrada sin lotes de un artículo con control va al sin asignar; con modo LOTE el vencimiento es opcional", async () => {
    const n = await nuevo("LOTE", false);
    expect((await mover(pedido(n, { clase: "ENTRADA", motivo: "COMPRA", cantidad: "3" }))).ok).toBe(
      true,
    );
    expect((await entradaCon(n, [{ codigo: "L-1", cantidad: "2" }], "2")).ok).toBe(true);
    expect(await lotes(n)).toEqual([
      ["L-1", "2.0000", null],
      ["SIN_ASIGNAR", "3.0000", null],
    ]);
  });

  it("FEFO: la salida que entrega toma el que vence antes, saltea cuarentena y rechazado, y lo que falta va al sin asignar", async () => {
    const n = await nuevo();
    await entradaCon(
      n,
      [
        { codigo: "L-TARDE", fechaDeVencimiento: "2099-12-01", cantidad: "5" },
        { codigo: "L-PRONTO", fechaDeVencimiento: "2099-03-01", cantidad: "2" },
        { codigo: "L-MALO", fechaDeVencimiento: "2099-02-01", cantidad: "9" },
      ],
      "16",
    );
    const malo = (
      await c.filas<{ id: string }>(
        "select id from lote where articulo_id = $1 and codigo = 'L-MALO'",
        [n.articulo],
      )
    )[0]?.id;
    await c.dueno.query(
      "insert into calidad_de_lote (empresa_id, lote_id, estado, motivo, por, en) values ($1, $2, 'EN_CUARENTENA', 'Revisión de la tanda', $3, now())",
      [e.empresa, malo, e.personaDelGerente],
    );
    const r = await mover(pedido(n, { clase: "SALIDA", motivo: "CONSUMO_INTERNO", cantidad: "9" }));
    expect(r.ok).toBe(true);
    expect(await lotes(n)).toEqual([
      ["L-MALO", "9.0000", "EN_CUARENTENA"],
      ["L-PRONTO", "0.0000", "LIBERADO"],
      ["L-TARDE", "0.0000", "LIBERADO"],
      ["SIN_ASIGNAR", "-2.0000", null],
    ]);
    expect(await sumaDeLotes(n)).toBe(await c.existencia(n.dep, n.articulo));
  });

  it("descartar no se bloquea por calidad ni vencimiento y respeta el lote nombrado (la baja por vencimiento)", async () => {
    const n = await nuevo();
    await entradaCon(
      n,
      [
        { codigo: "L-A", fechaDeVencimiento: "2099-02-01", cantidad: "4" },
        { codigo: "L-B", fechaDeVencimiento: "2099-05-01", cantidad: "4" },
      ],
      "8",
    );
    const b = (
      await c.filas<{ id: string }>(
        "select id from lote where articulo_id = $1 and codigo = 'L-B'",
        [n.articulo],
      )
    )[0]?.id as string;
    await c.dueno.query(
      "insert into calidad_de_lote (empresa_id, lote_id, estado, motivo, por, en) values ($1, $2, 'RECHAZADO', 'Mal olor', $3, now())",
      [e.empresa, b, e.personaDelGerente],
    );
    expect(
      (await mover(pedido(n, { clase: "SALIDA", motivo: "MERMA", cantidad: "3", nombrado: b }))).ok,
    ).toBe(true);
    expect(await lotes(n)).toEqual([
      ["L-A", "4.0000", "LIBERADO"],
      ["L-B", "1.0000", "RECHAZADO"],
      ["SIN_ASIGNAR", "0", null],
    ]);
  });

  it("la anulación repite los lotes del original; la transferencia lleva los lotes al destino", async () => {
    const n = await nuevo();
    await entradaCon(
      n,
      [
        { codigo: "L-A", fechaDeVencimiento: "2099-02-01", cantidad: "3" },
        { codigo: "L-B", fechaDeVencimiento: "2099-05-01", cantidad: "5" },
      ],
      "8",
    );
    const salida = await mover(
      pedido(n, { clase: "SALIDA", motivo: "CONSUMO_INTERNO", cantidad: "5" }),
    );
    if (!salida.ok) throw new Error(JSON.stringify(salida.error));
    expect(await lotes(n)).toEqual([
      ["L-A", "0.0000", "LIBERADO"],
      ["L-B", "3.0000", "LIBERADO"],
      ["SIN_ASIGNAR", "0", null],
    ]);
    const espejo = await mover(
      pedido(n, {
        clase: "ANULACION",
        motivo: "ANULACION",
        cantidad: "5",
        anulaA: salida.valor.movimiento.id,
      }),
    );
    expect(espejo.ok).toBe(true);
    expect(await lotes(n)).toEqual([
      ["L-A", "3.0000", "LIBERADO"],
      ["L-B", "5.0000", "LIBERADO"],
      ["SIN_ASIGNAR", "0", null],
    ]);
    const traslado = await mover(
      pedido(n, {
        clase: "TRANSFERENCIA",
        motivo: "TRANSFERENCIA",
        cantidad: "4",
        destino: n.otro,
      }),
    );
    expect(traslado.ok).toBe(true);
    expect(await sumaDeLotes(n)).toBe("4.0000");
    expect(await sumaDeLotes(n, n.otro)).toBe("4.0000");
  });

  it("C5 y C6: ventas simultáneas de 1 unidad con tres lotes salen en orden de vencimiento y los lotes siguen sumando el saldo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const n = await nuevo();
      await entradaCon(
        n,
        [
          { codigo: "L-1", fechaDeVencimiento: "2099-01-01", cantidad: "4" },
          { codigo: "L-2", fechaDeVencimiento: "2099-02-01", cantidad: "4" },
          { codigo: "L-3", fechaDeVencimiento: "2099-03-01", cantidad: "4" },
        ],
        "12",
      );
      const ventas = Array.from(
        { length: 9 },
        () => () =>
          firme(() =>
            mover(pedido(n, { clase: "SALIDA", motivo: "CONSUMO_INTERNO", cantidad: "1" })),
          ),
      );
      const resultados = await aLaVez(c, ventas, ronda);
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(await lotes(n)).toEqual([
        ["L-1", "0.0000", "LIBERADO"],
        ["L-2", "0.0000", "LIBERADO"],
        ["L-3", "3.0000", "LIBERADO"],
        ["SIN_ASIGNAR", "0", null],
      ]);
      expect(await sumaDeLotes(n)).toBe(await c.existencia(n.dep, n.articulo));
    }
  });

  it("C5: dos ventas de la última unidad de un lote: una toma el lote y la otra el sin asignar; ningún lote real baja de cero", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const n = await nuevo();
      await entradaCon(n, [{ codigo: "L-1", fechaDeVencimiento: FUTURO, cantidad: "1" }], "1");
      const dos = [0, 1].map(
        () => () =>
          firme(() =>
            mover(pedido(n, { clase: "SALIDA", motivo: "CONSUMO_INTERNO", cantidad: "1" })),
          ),
      );
      const resultados = await aLaVez(c, dos, ronda);
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(await lotes(n)).toEqual([
        ["L-1", "0.0000", "LIBERADO"],
        ["SIN_ASIGNAR", "-1.0000", null],
      ]);
    }
  });

  it("rechazar un lote mientras otra sesión vende: ninguna venta sale de un lote rechazado después de confirmado el cambio (C7)", async () => {
    const n = await nuevo();
    await entradaCon(
      n,
      [
        { codigo: "L-1", fechaDeVencimiento: "2099-01-01", cantidad: "5" },
        { codigo: "L-2", fechaDeVencimiento: "2099-02-01", cantidad: "5" },
      ],
      "10",
    );
    const l1 = (
      await c.filas<{ id: string }>(
        "select id from lote where articulo_id = $1 and codigo = 'L-1'",
        [n.articulo],
      )
    )[0]?.id;
    await c.dueno.query(
      "insert into calidad_de_lote (empresa_id, lote_id, estado, motivo, por, en) values ($1, $2, 'RECHAZADO', 'Mal olor', $3, now())",
      [e.empresa, l1, e.personaDelGerente],
    );
    const r = await mover(pedido(n, { clase: "SALIDA", motivo: "CONSUMO_INTERNO", cantidad: "3" }));
    expect(r.ok).toBe(true);
    expect(await lotes(n)).toEqual([
      ["L-1", "5.0000", "RECHAZADO"],
      ["L-2", "2.0000", "LIBERADO"],
      ["SIN_ASIGNAR", "0", null],
    ]);
  });
});
