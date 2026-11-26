import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  registrarLaCargaInicial,
  type DependenciasDeCargaInicialWeb,
} from "../../src/composicion/carga-inicial-web";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  aLaVez,
  montarStock,
  nuevoId,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * La carga inicial en tanda de la web contra una base real y los roles reales: una sola entrada con todos los renglones (todo o nada), repetir el gesto no duplica, el operador no puede (DEC-STK-004), un
 * depósito de Cuarentena o un artículo de otra empresa salen como el genérico, el aviso de existencia previa (lo decide el caso de uso, después de detectar la repetición) no escribe y confirmar sí, y dos tandas a la vez en el mismo depósito se suman exacto.
 * Sin pruebas de carga (directiva del orquestador): el tope de 9.999 renglones se prueba en la composición.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("carga inicial de stock de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let d: DependenciasDeCargaInicialWeb;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const cargar = (
    deposito: string,
    renglones: readonly Record<string, string>[],
    quien: ContextoOperativo = e.gerente,
    extra: Record<string, unknown> = {},
  ) =>
    registrarLaCargaInicial(d, quien, e.sucursal, {
      clave: nuevoId(),
      depositoId: deposito,
      renglones,
      ...extra,
    });
  const filas = async (deposito: string) =>
    (
      await c.filas<{ motivo: string; renglones: number }>(
        `select m.motivo, (select count(*) from renglon_de_movimiento r where r.movimiento_id = m.id)::int as renglones
           from movimiento_de_stock m where m.id in (select movimiento_id from renglon_de_movimiento where deposito_id = $1) group by m.id, m.motivo`,
        [deposito],
      )
    ).map((f) => [f.motivo, f.renglones]);

  it("una tanda de varios artículos es UNA entrada CARGA_INICIAL con todos sus renglones; la existencia queda exacta, con y sin costo", async () => {
    const dep = await c.deposito(e);
    const a = await c.articulo(e);
    const b = await c.articulo(e);
    const sinCosto = await c.articulo(e);
    const r = await cargar(dep, [
      { articuloId: a.articulo, cantidad: "10", costoUnitario: "12.5" },
      { articuloId: b.articulo, cantidad: "0.0001", costoUnitario: "0.000001" },
      { articuloId: sinCosto.articulo, cantidad: "2.5", costoUnitario: "" },
    ]);
    expect(r.ok && r.dato.yaExistia).toBe(false);
    expect(await c.existencia(dep, a.articulo)).toBe("10.0000");
    expect(await c.existencia(dep, b.articulo)).toBe("0.0001");
    expect(await c.existencia(dep, sinCosto.articulo)).toBe("2.5000");
    expect(await filas(dep)).toEqual([["CARGA_INICIAL", 3]]);
  });

  it("idempotencia: el mismo gesto dos veces (y a la vez) deja una sola carga; la clave con otro contenido no pasa", async () => {
    const dep = await c.deposito(e);
    const a = await c.articulo(e);
    const clave = nuevoId();
    const pedir = (cantidad = "7") =>
      cargar(dep, [{ articuloId: a.articulo, cantidad }], e.gerente, { clave });
    const rs = await aLaVez(c, [() => pedir(), () => pedir()], 0);
    expect(rs.every((x) => x.ok)).toBe(true);
    expect(await c.existencia(dep, a.articulo)).toBe("7.0000");
    const repetida = await pedir();
    expect(repetida.ok && repetida.dato.yaExistia).toBe(true);
    expect(codigoDe(await pedir("9"))).toBe(GENERICO);
    expect(await c.existencia(dep, a.articulo)).toBe("7.0000");
    expect(await filas(dep)).toEqual([["CARGA_INICIAL", 1]]);
  });

  it("todo o nada: un renglón malo (cantidad cero, artículo repetido, costo roto) frena la tanda y no queda ningún saldo", async () => {
    const dep = await c.deposito(e);
    const a = await c.articulo(e);
    const b = await c.articulo(e);
    const buena = { articuloId: a.articulo, cantidad: "5", costoUnitario: "1" };
    for (const [mala, codigo] of [
      [{ articuloId: b.articulo, cantidad: "0" }, "STOCK_CANTIDAD_INVALIDA"],
      [{ articuloId: a.articulo, cantidad: "1" }, GENERICO],
      [{ articuloId: b.articulo, cantidad: "1", costoUnitario: "no-es-un-costo" }, GENERICO],
      [{ articuloId: b.articulo, cantidad: "1", costoUnitario: "1.1234567" }, GENERICO],
    ] as const) {
      expect(codigoDe(await cargar(dep, [buena, mala])), JSON.stringify(mala)).toBe(codigo);
    }
    expect(await c.existencia(dep, a.articulo)).toBe("0");
    expect(await c.existencia(dep, b.articulo)).toBe("0");
    expect(await filas(dep)).toEqual([]);
  });

  it("permisos en el servidor: el operador no puede cargar (y no mueve nada); el administrador sí", async () => {
    const dep = await c.deposito(e);
    const a = await c.articulo(e);
    const r = await cargar(dep, [{ articuloId: a.articulo, cantidad: "5" }], e.operador);
    expect(r.ok).toBe(false);
    expect(await c.existencia(dep, a.articulo)).toBe("0");
    expect(
      (await cargar(dep, [{ articuloId: a.articulo, cantidad: "5" }], e.administrador)).ok,
    ).toBe(true);
    expect(await c.existencia(dep, a.articulo)).toBe("5.0000");
  });

  it("aislamiento: un artículo de otra empresa, un depósito de Cuarentena o uno de otra sucursal salen como el genérico y no escriben", async () => {
    const dep = await c.deposito(e);
    const cuarentena = await c.deposito(e, { uso: "CUARENTENA" });
    const norte = await c.deposito(e, { sucursal: e.otraSucursal });
    const propio = await c.articulo(e);
    const ajeno = await c.articulo(otra);
    expect(codigoDe(await cargar(dep, [{ articuloId: ajeno.articulo, cantidad: "1" }]))).toBe(
      GENERICO,
    );
    for (const deposito of [cuarentena, norte]) {
      expect(
        codigoDe(await cargar(deposito, [{ articuloId: propio.articulo, cantidad: "1" }])),
      ).toBe(GENERICO);
    }
    expect(await c.existencia(dep, ajeno.articulo)).toBe("0");
    expect(await c.existencia(cuarentena, propio.articulo)).toBe("0");
    expect(await c.existencia(norte, propio.articulo)).toBe("0");
  });

  it("aviso de existencia previa: avisa y NO escribe; confirmar con la misma clave escribe una sola vez", async () => {
    const dep = await c.deposito(e);
    const a = await c.articulo(e);
    expect((await cargar(dep, [{ articuloId: a.articulo, cantidad: "3" }])).ok).toBe(true);
    const clave = nuevoId();
    const pedir = (extra: Record<string, unknown> = {}) =>
      cargar(dep, [{ articuloId: a.articulo, cantidad: "4" }], e.gerente, { clave, ...extra });
    expect(codigoDe(await pedir())).toBe("STOCK_YA_HAY_EXISTENCIA");
    expect(await c.existencia(dep, a.articulo)).toBe("3.0000");
    expect((await pedir({ confirmar: "1" })).ok).toBe(true);
    const otraVez = await pedir({ confirmar: "1" });
    expect(otraVez.ok && otraVez.dato.yaExistia).toBe(true);
    expect(await c.existencia(dep, a.articulo)).toBe("7.0000");
    // Un depósito con saldos en cero no avisa.
    const vacio = await c.deposito(e);
    expect((await cargar(vacio, [{ articuloId: a.articulo, cantidad: "1" }])).ok).toBe(true);
  });

  it("concurrencia: dos gerentes cargan tandas distintas del mismo depósito a la vez; las dos pasan y los saldos suman exacto", async () => {
    const dep = await c.deposito(e);
    const a = await c.articulo(e);
    const b = await c.articulo(e);
    for (let ronda = 0; ronda < 2; ronda++) {
      const rs = await aLaVez(
        c,
        [
          () =>
            cargar(
              dep,
              [
                { articuloId: a.articulo, cantidad: "5.5" },
                { articuloId: b.articulo, cantidad: "1" },
              ],
              e.gerente,
              { confirmar: "1" },
            ),
          () =>
            cargar(
              dep,
              [
                { articuloId: b.articulo, cantidad: "2" },
                { articuloId: a.articulo, cantidad: "7" },
              ],
              e.administrador,
              { confirmar: "1" },
            ),
        ],
        ronda,
      );
      expect(
        rs.every((x) => x.ok),
        `ronda ${ronda}`,
      ).toBe(true);
    }
    expect(await c.existencia(dep, a.articulo)).toBe("25.0000");
    expect(await c.existencia(dep, b.articulo)).toBe("6.0000");
    expect(await filas(dep)).toHaveLength(4);
  });

  it("la carga es «de hoy»: sin fecha en el pedido, queda con la hora del servidor", async () => {
    const dep = await c.deposito(e);
    const a = await c.articulo(e);
    expect((await cargar(dep, [{ articuloId: a.articulo, cantidad: "1" }])).ok).toBe(true);
    const libro = await c.consultas.movimientosDelDeposito(e.gerente, { depositoId: dep });
    const hechoEn = libro.ok ? libro.valor.movimientos[0]?.hechoEn : undefined;
    expect(hechoEn?.toISOString()).toBe(e.gerente.ahora.toISOString());
  });
});
