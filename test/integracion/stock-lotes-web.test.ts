import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  lotesDelArticulo,
  vencimientosDeLaSucursal,
  type DependenciasDeLotesWeb,
} from "../../src/composicion/lotes-web";
import type { LoteDeEntrada } from "../../src/modulos/stock/casos-de-uso/lotes-del-libro";
import {
  registrarMovimientoEnTx,
  type PedidoDeMovimiento,
} from "../../src/modulos/stock/casos-de-uso/movimiento-en-tx";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { llaveDeSaldo } from "../../src/modulos/stock/persistencia/repositorio-de-movimientos";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * La pestaña «Lotes» de la web contra la base real y los roles reales: los lotes de un artículo controlado salen en el orden del servidor (vence antes primero) con la existencia como texto exacto, el id de
 * `articulosControlados` sirve para `lotesDeArticulo`, lo que vence trae su estado, una empresa ajena es indistinguible de lo que no existe y NUNCA sale un importe. Las reglas de las consultas
 * (disponible, jornada, costos.ver, alcance del operador) tienen su prueba en `stock-lotes.test.ts`; acá solo lo que suma la composición. Es lectura: repetirla da lo mismo.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("lotes de stock de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let d: DependenciasDeLotesWeb;
  let deposito: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    c.encenderPerilla("lotes");
    deposito = await c.deposito(e, { deVenta: true });
    d = { consultas: () => c.consultas, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const firmar = (t: string) => {
    const r = cantidadConSignoDesdeTexto(t);
    if (!r.ok) throw new Error(t);
    return r.valor;
  };
  /** Un artículo controlado por lote con una entrada repartida en los lotes dados. */
  const conLotes = async (lotes: readonly LoteDeEntrada[], cantidad: string) => {
    const a = await c.articulo(e);
    valorDe(
      await c.casos.controlarLote(e.gerente, {
        productoId: a.producto,
        modo: "LOTE_Y_VENCIMIENTO",
        conCalidad: false,
      }),
    );
    const pedido: PedidoDeMovimiento = {
      clase: "ENTRADA",
      motivo: "COMPRA",
      detalle: null,
      origen: null,
      depositoId: deposito,
      accion: "stock.registrar_entrada",
      anulaA: null,
      conteoId: null,
      clave: `clave-${randomUUID()}`,
      huella: huellaDeComando("ENTRADA", [deposito, "COMPRA", cantidad], [[a.articulo, cantidad]]),
      hechoEn: e.gerente.ahora,
      fechaDeNegocio: null,
      renglones: [
        {
          depositoId: deposito,
          articuloId: a.articulo,
          composicionId: null,
          cantidad: firmar(cantidad),
        },
      ],
      confirmaciones: [],
      lotes: { entradas: new Map([[llaveDeSaldo(deposito, a.articulo), lotes]]) },
    };
    const r = await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
      registrarMovimientoEnTx(tx, e.gerente, pedido),
    );
    if (!JSON.stringify(r).includes('"ok":true')) throw new Error(JSON.stringify(r));
    return a;
  };
  const enDias = (dias: number) =>
    new Date(e.gerente.ahora.getTime() + dias * 86_400_000).toISOString().slice(0, 10);

  it("los lotes del artículo salen con el que vence antes primero y la existencia como texto exacto, sin importes; repetir da lo mismo", async () => {
    const a = await conLotes(
      [
        { codigo: "L-B", fechaDeVencimiento: "2099-02-01", cantidad: "2" },
        { codigo: "L-A", fechaDeVencimiento: "2098-02-01", cantidad: "3" },
      ],
      "5",
    );
    const pedir = () => lotesDelArticulo(d, e.gerente, { articuloId: a.articulo });
    const r = await pedir();
    expect(r.ok && r.dato.articuloId).toBe(a.articulo);
    expect(
      r.ok && r.dato.lotes.map((l) => [l.codigo, l.vence, l.existencia, l.sinAsignar]),
    ).toEqual([
      ["L-A", "2098-02-01", "3.0000", false],
      ["L-B", "2099-02-01", "2.0000", false],
    ]);
    expect(r.ok && r.dato.articulos.some((x) => x.id === a.articulo)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/seLosPierde|costo/i);
    expect(await pedir()).toEqual(r);
  });

  it("un artículo de otra empresa, o inexistente, sale como el genérico; el operador también puede mirar (lotes.ver)", async () => {
    const ajeno = await c.articulo(otra);
    for (const articuloId of [ajeno.articulo, nuevoId()]) {
      expect(codigoDe(await lotesDelArticulo(d, e.gerente, { articuloId }))).toBe(GENERICO);
    }
    expect((await lotesDelArticulo(d, e.operador, {})).ok).toBe(true);
  });

  it("lo que vence en el horizonte sale de la sucursal elegida, sin estado si vence más adelante, y nada de otra empresa", async () => {
    await conLotes([{ codigo: "V-60", fechaDeVencimiento: enDias(30), cantidad: "4" }], "4");
    const r = await vencimientosDeLaSucursal(d, e.gerente, e.sucursal, { dias: "60" });
    const fila = r.ok ? r.dato.vencimientos.find((v) => v.codigo === "V-60") : undefined;
    expect(fila).toMatchObject({ existencia: "4.0000", estado: null });
    expect(JSON.stringify(r)).not.toMatch(/seLosPierde/);
    const corto = await vencimientosDeLaSucursal(d, e.gerente, e.sucursal, { dias: "7" });
    expect(corto.ok && corto.dato.vencimientos.some((v) => v.codigo === "V-60")).toBe(false);
    const deLaOtra = await vencimientosDeLaSucursal(d, otra.gerente, otra.sucursal, {
      dias: "365",
    });
    expect(deLaOtra.ok && deLaOtra.dato.vencimientos.some((v) => v.codigo === "V-60")).toBe(false);
  });

  it("una sucursal fuera del alcance de quien mira no muestra nada ajeno", async () => {
    const r = await vencimientosDeLaSucursal(d, e.operador, e.otraSucursal, { dias: "365" });
    expect(r.ok && r.dato.vencimientos).toEqual([]);
  });
});
