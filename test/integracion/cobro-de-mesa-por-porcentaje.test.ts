import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cobrarLaMesa,
  type DependenciasDeCobrarMesaWeb,
} from "../../src/composicion/cobrar-mesa-web";
import { importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { MAXIMO_DE_PARTES_POR_PORCENTAJE } from "../../src/primitivas/cuentas/limites-de-division";
import {
  agregarParte,
  escribirPorcentaje,
  importesParaElCobro,
  repartoInicial,
  type RepartoEnEdicion,
} from "../../src/primitivas/cuentas/reparto-por-porcentaje";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * Dividir por porcentaje dentro del cobro de una mesa (SAL-E3): es UN ticket con varios cobros (sin caso de uso nuevo). Los importes salen de la MISMA regla que usa la hoja de la pantalla (`reparto-por-porcentaje.ts`) y el
 * servidor solo comprueba que cuadren al centavo: con centavo suelto y tres partes la suma es exacta, el máximo de partes cobra, un cobro inválido o un centavo de menos no deja nada a medias (todo o nada), repetir con la misma
 * clave devuelve lo cobrado, dos actores con repartos distintos (en las dos órdenes) dejan UN ticket y los cobros del que gana, y otra empresa no cobra ni escribe nada. Todo rechazo sale como el genérico aprobado.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (v: string) => ({ moneda: "ARS", monto: v });
const TOTAL = "2000.00";
const GENERICO = { ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } };

const centavos = (importes: readonly string[]): bigint =>
  importes.reduce((suma, i) => suma + importeDesdeTexto(ARS, i).unidades, 0n);
const conPartes = (cuantas: number): RepartoEnEdicion => {
  let reparto = repartoInicial;
  for (let i = 1; i < cuantas; i++) reparto = agregarParte(reparto);
  return reparto;
};

describe.skipIf(base === null)("composición web: cobrar una mesa dividida por porcentaje", () => {
  let m: MundoDeSalon;
  let d: DependenciasDeCobrarMesaWeb;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    d = { casosDeUso: () => m.salon, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeSalon["cajaAbierta"]>>;
  const proximaMesa = new Map<string, number>();

  /** Una mesa con su cuenta, 2 unidades del producto de $ 1000 y enviada a cocina: lista para cobrar por $ 2000,00. */
  const mesaConPedido = async (e: EscenarioDeVentas) => {
    const n = (proximaMesa.get(e.empresa) ?? 0) + 1;
    proximaMesa.set(e.empresa, n);
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "2",
      }),
    );
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId,
        claveIdempotencia: nuevaClave(),
      }),
    );
    return { mesaId, cuentaId };
  };

  /** Lo que arma la pantalla con «Usar en el cobro»: un cobro por parte, cada uno con un medio (se reparten entre los de la caja que no dan vuelto). */
  const MEDIOS_POR_PARTE = ["TRANSFERENCIA", "QR", "TARJETA_DEBITO"] as const;
  const pedido = (
    cuentaId: string,
    caja: Caja,
    importes: readonly string[],
    cambios: Record<string, unknown> = {},
  ) => ({
    claveIdempotencia: nuevaClave(),
    cuentaId,
    ejemplarId: nuevoId(),
    totalEsperado: monto(TOTAL),
    cajaId: caja.cajaId,
    cobros: importes.map((importe, i) => ({
      medioDePagoId: caja.medios[MEDIOS_POR_PARTE[i % MEDIOS_POR_PARTE.length] as string],
      cuentaDeCobroId: null,
      importe: monto(importe),
    })),
    ...cambios,
  });
  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const rastros = async (e: EscenarioDeVentas) => ({
    tickets: await contar("ticket", e.empresa),
    cobranzas: await contar("cobranza_de_ticket", e.empresa),
    cobros: await contar("cobro", e.empresa),
    movimientos: await contar("movimiento_caja", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
  });
  const propuesta = (reparto: RepartoEnEdicion): readonly string[] =>
    importesParaElCobro(TOTAL, reparto) as readonly string[];

  it("DINERO: tres partes iguales de $ 2.000,00 (sobran dos centavos, van a las primeras partes): los tres cobros cuadran al centavo y quedan registrados con su medio", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const importes = propuesta(conPartes(3));
    expect(importes).toEqual(["666.67", "666.67", "666.66"]);
    const r = await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja, importes));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.total).toEqual(monto(TOTAL));
    // El servidor no promete el orden de los cobros: se compara como conjunto.
    expect(r.dato.cobros.map((c) => c.importe.monto).sort()).toEqual([...importes].sort());
    expect(centavos(r.dato.cobros.map((c) => c.importe.monto))).toBe(200000n);
    expect(await contar("cobro", e.empresa)).toBe(3);
    expect(await contar("ticket", e.empresa)).toBe(1);
  });

  it("DINERO: por porcentaje escrito (33,33 % y 33,33 %; la parte 1 queda con 33,34 %) cuadra al centavo", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    let reparto = conPartes(3);
    reparto = escribirPorcentaje(escribirPorcentaje(reparto, 0, "33.33"), 1, "33.33");
    const importes = propuesta(reparto);
    expect(centavos(importes)).toBe(200000n);
    const r = await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja, importes));
    expect(r.ok).toBe(true);
    expect(await contar("cobro", e.empresa)).toBe(3);
  });

  it("LÍMITE: con el máximo de partes de la primitiva de límites cobra y la suma es exacta", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const importes = propuesta(conPartes(MAXIMO_DE_PARTES_POR_PORCENTAJE));
    expect(importes).toHaveLength(MAXIMO_DE_PARTES_POR_PORCENTAJE);
    const r = await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja, importes));
    expect(r.ok).toBe(true);
    expect(await contar("cobro", e.empresa)).toBe(MAXIMO_DE_PARTES_POR_PORCENTAJE);
    expect(centavos(importes)).toBe(200000n);
  });

  it("DINERO: un centavo de menos en la última parte no cobra ninguna: el genérico y nada escrito", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const antes = await rastros(e);
    const [a, b] = propuesta(conPartes(3)) as readonly [string, string, string];
    const r = await cobrarLaMesa(
      d,
      e.gerente,
      e.sucursal,
      pedido(cuentaId, caja, [a, b, "666.65"]),
    );
    expect(r).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(antes);
  });

  it("ATOMICIDAD: con un medio inexistente en la tercera parte no se cobra ni la primera ni la segunda; después, el cobro bien armado entra completo", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const antes = await rastros(e);
    const importes = propuesta(conPartes(3));
    const mal = pedido(cuentaId, caja, importes);
    const cobros = [...mal.cobros];
    cobros[2] = { ...(cobros[2] as (typeof cobros)[number]), medioDePagoId: nuevoId() };
    expect(await cobrarLaMesa(d, e.gerente, e.sucursal, { ...mal, cobros })).toMatchObject(
      GENERICO,
    );
    expect(await rastros(e)).toEqual(antes);
    const bien = await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja, importes));
    expect(bien.ok).toBe(true);
    expect(await contar("cobro", e.empresa)).toBe(3);
  });

  it("IDEMPOTENCIA: repetir el mismo pedido (misma clave y mismo ejemplar) devuelve lo cobrado sin duplicar cobros, movimientos ni auditoría", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const unico = pedido(cuentaId, caja, propuesta(conPartes(3)));
    const primero = await cobrarLaMesa(d, e.gerente, e.sucursal, unico);
    expect(primero.ok).toBe(true);
    const despues = await rastros(e);
    const repetido = await cobrarLaMesa(d, e.gerente, e.sucursal, unico);
    expect(repetido).toMatchObject({ ok: true, dato: { yaExistia: true } });
    if (primero.ok && repetido.ok) {
      expect(repetido.dato.ticketId).toBe(primero.dato.ticketId);
      const montos = (cobros: readonly { importe: { monto: string } }[]) =>
        cobros.map((c) => c.importe.monto).sort();
      expect(montos(repetido.dato.cobros)).toEqual(montos(primero.dato.cobros));
    }
    expect(await rastros(e)).toEqual(despues);
  });

  it.each([
    ["A y después B", false],
    ["B y después A", true],
  ])(
    "DOS ACTORES (%s): dos mozos cobran la misma mesa a la vez con repartos y claves distintas: UN ticket y los cobros del que gana; el otro recibe el genérico",
    async (_nombre, invertido) => {
      const e = await m.escenario();
      const caja = await m.cajaAbierta(e);
      const { cuentaId } = await mesaConPedido(e);
      const dosPartes = pedido(cuentaId, caja, propuesta(conPartes(2)));
      const tresPartes = pedido(cuentaId, caja, propuesta(conPartes(3)));
      const cobrar = (p: typeof dosPartes) => cobrarLaMesa(d, e.gerente, e.sucursal, p);
      const resultados = invertido
        ? (await Promise.all([cobrar(tresPartes), cobrar(dosPartes)])).reverse()
        : await Promise.all([cobrar(dosPartes), cobrar(tresPartes)]);
      const [a, b] = resultados;
      expect([a?.ok, b?.ok].filter(Boolean)).toHaveLength(1);
      const perdedor = a?.ok === true ? b : a;
      expect(perdedor).toMatchObject(GENERICO);
      const ganador = a?.ok === true ? a : b;
      if (ganador?.ok !== true) throw new Error("nadie cobró");
      const esperados = ganador.dato.cobros.length;
      expect([2, 3]).toContain(esperados);
      expect(await contar("ticket", e.empresa)).toBe(1);
      expect(await contar("cobranza_de_ticket", e.empresa)).toBe(1);
      expect(await contar("cobro", e.empresa)).toBe(esperados);
      expect(centavos(ganador.dato.cobros.map((c) => c.importe.monto))).toBe(200000n);
    },
  );

  it("AISLAMIENTO: otra empresa, con la misma cuenta y los mismos importes, recibe el genérico y no escribe nada", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const cajaOtra = await m.cajaAbierta(otra);
    const { cuentaId } = await mesaConPedido(e);
    const antesE = await rastros(e);
    const antesOtra = await rastros(otra);
    const r = await cobrarLaMesa(
      d,
      otra.gerente,
      otra.sucursal,
      pedido(cuentaId, cajaOtra, propuesta(conPartes(3))),
    );
    expect(r).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(antesE);
    expect(await rastros(otra)).toEqual(antesOtra);
    // La cuenta sigue cobrable por quien corresponde.
    const ok = await cobrarLaMesa(
      d,
      e.gerente,
      e.sucursal,
      pedido(cuentaId, caja, propuesta(conPartes(3))),
    );
    expect(ok.ok).toBe(true);
  });
});
