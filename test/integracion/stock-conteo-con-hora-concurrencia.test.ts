import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { abrirConteoDe, conReloj, conStock, contarEn, hace } from "./stock-conteo-hora-apoyo";
import {
  aLaVez,
  firme,
  montarStock,
  nuevoId,
  RONDAS,
  soloOk,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5, conteo con hora, concurrencia (spec §5, CC1 a CC4; CC5 está en `stock-concurrencia.test.ts`): dos personas a la vez sobre el mismo conteo, una
 * venta que se cierra mientras se aplica, un movimiento con hora anterior que entra mientras se revisa y dos cargas del mismo artículo. Base real,
 * transacciones serializables reales y la barrera de la ronda: todas leyeron su autorización antes de que cualquiera escriba. Se repite `RONDAS` veces
 * alternando quién sale primero.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const codigoDe = (r: { ok: boolean; error?: unknown }): string =>
  r.ok ? "ok" : typeof r.error === "string" ? r.error : JSON.stringify(r.error);

describe.skipIf(base === null)("stock: conteo con hora (concurrencia)", () => {
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

  const cuenta = (tabla: string, conteoId: string) =>
    c.contar(`select count(*) as n from ${tabla} where conteo_id = $1`, [conteoId]);
  /** 20 en el depósito, 20 contados a las 10:00 (sin diferencia): el caso del dueño. */
  const sinDiferencia = async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "20", { contadoEn: hace(-10) }));
    return { ...s, id };
  };

  it("CC1: dos personas aplican el mismo conteo a la vez: un solo ajuste y un solo juego de explicaciones; la otra ve yaAplicado con el mismo movimiento", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const s = await conStock(c, e, "20");
      const id = await abrirConteoDe(c, e, s.dep);
      valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
      const pedido = {
        conteoId: id,
        huella: await c.huellaDeConteo(e.gerente, id),
        respuestas: [{ productoId: s.producto, motivo: "ROTURA" }],
      };
      const aplicar = () => firme(() => c.casos.aplicarConteo(e.gerente, pedido));
      const resultados = await aLaVez(c, [aplicar, aplicar], ronda);
      expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
      const valores = resultados.map((r) => valorDe(r));
      expect(valores.filter((v) => v.yaAplicado)).toHaveLength(1);
      expect(valores[0]?.movimientoId).not.toBeNull();
      expect(valores[0]?.movimientoId).toBe(valores[1]?.movimientoId);
      expect(await cuenta("movimiento_de_stock", id)).toBe(1);
      expect(await cuenta("conteo_diferencia", id)).toBe(1);
      expect(await c.existencia(s.dep, s.articulo)).toBe("18.0000");
    }
  });

  it("CC2: la venta de 3 se cierra justo mientras se aplica (en las dos órdenes): el saldo final es 17 siempre y no hay ajuste; nunca 20 ni 23", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const t = await sinDiferencia();
      const pedido = {
        conteoId: t.id,
        huella: await c.huellaDeConteo(e.gerente, t.id),
        respuestas: undefined,
      };
      const aplicar = () => firme(() => c.casos.aplicarConteo(e.gerente, pedido));
      const vender = () =>
        firme(() =>
          c.casos.registrarSalida(conReloj(e.gerente, hace(-5)), {
            clave: nuevoId(),
            depositoId: t.dep,
            motivo: "MERMA",
            renglones: [{ productoId: t.producto, cantidad: "3", unidadId: "UNIDAD" }],
          }),
        );
      let porAplicar: Awaited<ReturnType<typeof aplicar>> | undefined;
      let porVender: Awaited<ReturnType<typeof vender>> | undefined;
      await aLaVez(
        c,
        [
          async (): Promise<unknown> => (porAplicar = await aplicar()),
          async (): Promise<unknown> => (porVender = await vender()),
        ],
        ronda,
      );
      if (porAplicar === undefined || porVender === undefined)
        throw new Error("faltó un resultado");
      expect(porAplicar.ok, JSON.stringify(porAplicar)).toBe(true);
      expect(porVender.ok, JSON.stringify(porVender)).toBe(true);
      expect(await c.existencia(t.dep, t.articulo)).toBe("17.0000");
      expect(await cuenta("movimiento_de_stock", t.id)).toBe(0);
      expect(
        await c.filas("select diferencia_final::text from conteo_diferencia where conteo_id = $1", [
          t.id,
        ]),
      ).toEqual([{ diferencia_final: "0.0000" }]);
      expect(valorDe(await c.consultas.verificarSaldos(e.gerente))).toEqual([]);
    }
  });

  it("CC3: una compra con hora ANTERIOR a la del conteo entra mientras se aplica: o se aplica con lo que se vio (y la compra suma después), o REVISION_DESACTUALIZADA sin escribir nada; nunca un ajuste calculado con datos que no se vieron", async () => {
    let desactualizadas = 0;
    let aplicadas = 0;
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const s = await conStock(c, e, "20");
      const id = await abrirConteoDe(c, e, s.dep);
      valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
      const pedido = {
        conteoId: id,
        huella: await c.huellaDeConteo(e.gerente, id),
        respuestas: [{ productoId: s.producto, motivo: "ROTURA" }],
      };
      const aplicar = () => firme(() => c.casos.aplicarConteo(e.gerente, pedido));
      const comprar = () =>
        firme(() =>
          c.casos.registrarEntrada(e.gerente, {
            clave: nuevoId(),
            depositoId: s.dep,
            motivo: "COMPRA",
            hechoEn: hace(-20),
            renglones: [{ productoId: s.producto, cantidad: "2", unidadId: "UNIDAD" }],
          }),
        );
      // `aLaVez` devuelve en el orden en que salieron (se alterna): cada resultado se guarda donde corresponde.
      let porAplicar: Awaited<ReturnType<typeof aplicar>> | undefined;
      let porComprar: Awaited<ReturnType<typeof comprar>> | undefined;
      await aLaVez(
        c,
        [
          async (): Promise<unknown> => (porAplicar = await aplicar()),
          async (): Promise<unknown> => (porComprar = await comprar()),
        ],
        ronda,
      );
      if (porAplicar === undefined || porComprar === undefined)
        throw new Error("faltó un resultado");
      expect(porComprar.ok, JSON.stringify(porComprar)).toBe(true);
      if (porAplicar.ok) {
        aplicadas += 1;
        // Aplicó con lo que se vio (E = 20, −2) y la compra de 2 entró después: 20 − 2 + 2.
        expect(await c.existencia(s.dep, s.articulo)).toBe("20.0000");
        expect(await cuenta("movimiento_de_stock", id)).toBe(1);
      } else {
        desactualizadas += 1;
        expect(codigoDe(porAplicar)).toBe("REVISION_DESACTUALIZADA");
        expect(await c.existencia(s.dep, s.articulo)).toBe("22.0000");
        expect(await cuenta("movimiento_de_stock", id)).toBe(0);
        expect(await cuenta("conteo_diferencia", id)).toBe(0);
      }
    }
    expect(aplicadas + desactualizadas).toBe(RONDAS);
  });

  it("CC4: dos cargas del mismo artículo a la vez con ids distintos: entran las dos y vale la de mayor orden", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const s = await conStock(c, e, "20");
      const id = await abrirConteoDe(c, e, s.dep);
      const cargar = (cantidad: string) => () =>
        firme(() => contarEn(c, e.gerente, id, s.producto, cantidad, { contadoEn: hace(-10) }));
      const resultados = await aLaVez(c, [cargar("18"), cargar("19")], ronda);
      expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
      const ficha = valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: id }));
      expect(ficha?.registros).toHaveLength(2);
      const vigentes = ficha?.registros.filter((r) => r.vigente) ?? [];
      expect(vigentes).toHaveLength(1);
      const ultima = (
        await c.filas<{ cantidad_contada: string }>(
          "select cantidad_contada::text from conteo_registro where conteo_id = $1 order by orden desc limit 1",
          [id],
        )
      )[0]?.cantidad_contada;
      expect(vigentes[0]?.cantidadContada).toBe(ultima);
    }
  });
});
