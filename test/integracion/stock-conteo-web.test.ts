import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  abrirElConteo,
  aplicarElConteo,
  cancelarElConteo,
  cargarLoContado,
  lecturaDelConteo,
  revisionDelConteo,
  type DependenciasDeConteoWeb,
} from "../../src/composicion/conteo-web";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { conReloj, conStock, hace, movimientoEn } from "./stock-conteo-hora-apoyo";
import {
  aLaVez,
  montarStock,
  nuevoId,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * El conteo físico de la web contra una base real y los roles reales: abrir (dos a la vez: uno solo), cargar (también el operador; recontar vale el último; cero es válido; repetir el mismo registro no duplica), el conteo a
 * ciegas (el operador NO recibe lo que el sistema creía, lo movido, la diferencia ni la huella), aplicar (dos «Aplicar» a la vez: un ajuste; un movimiento nuevo mientras se revisaba: no se aplica y la revisión recarga con otra
 * huella), cancelar con motivo, y aislamiento por empresa. El reloj de la prueba es 09:00 en Argentina (12:00Z); las horas se cuentan respecto de él (`hace(-10)` = «08:50»).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("conteo de stock de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let d: DependenciasDeConteoWeb;
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
  const abrir = async (dep: string, quien: ContextoOperativo = e.gerente) => {
    const r = await abrirElConteo(d, quien, e.sucursal, { id: nuevoId(), depositoId: dep });
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.dato.conteoId;
  };
  const cargar = (
    conteoId: string,
    articuloId: string,
    cantidad: string,
    extra: Record<string, unknown> = {},
    quien: ContextoOperativo = conReloj(e.operador, hace(0)),
  ) =>
    cargarLoContado(d, quien, {
      id: nuevoId(),
      conteoId,
      articuloId,
      cantidad,
      hora: "08:50",
      ...extra,
    });
  const revisar = (conteoId: string, quien: ContextoOperativo = e.gerente) =>
    revisionDelConteo(d, quien, { conteoId });

  it("abrir deja UN conteo abierto del depósito (dos a la vez: uno solo, el otro con su texto); un depósito ajeno o de otra empresa es el genérico", async () => {
    const s = await conStock(c, e, "20");
    const rs = await aLaVez(
      c,
      [
        () => abrirElConteo(d, e.gerente, e.sucursal, { id: nuevoId(), depositoId: s.dep }),
        () => abrirElConteo(d, e.administrador, e.sucursal, { id: nuevoId(), depositoId: s.dep }),
      ],
      0,
    );
    expect(rs.map(codigoDe).sort()).toEqual(["OK", "STOCK_CONTEO_EN_CURSO"]);
    const lectura = await lecturaDelConteo(d, e.gerente, e.sucursal, { depositoId: s.dep });
    expect(lectura.ok && lectura.dato.conteoId).toMatch(/^[0-9a-f-]{36}$/);
    const norte = await c.deposito(e, { sucursal: e.otraSucursal });
    expect(
      codigoDe(await abrirElConteo(d, e.gerente, e.sucursal, { id: nuevoId(), depositoId: norte })),
    ).toBe(GENERICO);
    const ajeno = await c.deposito(otra);
    expect(
      codigoDe(await abrirElConteo(d, e.gerente, e.sucursal, { id: nuevoId(), depositoId: ajeno })),
    ).toBe(GENERICO);
  });

  it("repetir abrir con el mismo id devuelve el mismo conteo; el operador no puede abrir", async () => {
    const s = await conStock(c, e, "5");
    const id = nuevoId();
    const primero = await abrirElConteo(d, e.gerente, e.sucursal, { id, depositoId: s.dep });
    const repetido = await abrirElConteo(d, e.gerente, e.sucursal, { id, depositoId: s.dep });
    expect(primero.ok && repetido.ok && repetido.dato).toEqual({
      conteoId: primero.ok ? primero.dato.conteoId : "",
      yaExistia: true,
    });
    const otro = await conStock(c, e, "5");
    expect(
      (await abrirElConteo(d, e.operador, e.sucursal, { id: nuevoId(), depositoId: otro.dep })).ok,
    ).toBe(false);
  });

  it("cargar: el operador carga; cero es válido; las cantidades llegan exactas; recontar vale el último; el mismo registro no duplica y un artículo ajeno es el genérico", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrir(s.dep);
    const registro = nuevoId();
    expect((await cargar(id, s.articulo, "17.5", { id: registro })).ok).toBe(true);
    const repetido = await cargar(id, s.articulo, "17.5", { id: registro });
    expect(repetido.ok && repetido.dato.yaExistia).toBe(true);
    expect(codigoDe(await cargar(id, s.articulo, "99", { id: registro }))).toBe(GENERICO);
    expect((await cargar(id, s.articulo, "0.0001")).ok).toBe(true);
    expect((await cargar(id, s.articulo, "0")).ok).toBe(true);
    const lectura = await lecturaDelConteo(d, e.operador, e.sucursal, { depositoId: s.dep });
    expect(
      lectura.ok && lectura.dato.articulos.find((a) => a.articuloId === s.articulo)?.contado,
    ).toBe("0.0000");
    const ajeno = await c.articulo(otra);
    expect(codigoDe(await cargar(id, ajeno.articulo, "1"))).toBe(GENERICO);
    expect(await c.filas("select 1 from conteo_registro where conteo_id = $1", [id])).toHaveLength(
      3,
    );
  });

  it("a ciegas: el operador no recibe lo que el sistema creía, lo movido, la diferencia ni la huella; el gerente sí", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrir(s.dep);
    expect((await cargar(id, s.articulo, "18")).ok).toBe(true);
    const operador = await revisar(id, e.operador);
    expect(operador.ok && operador.dato.huella).toBeNull();
    expect(operador.ok && operador.dato.filas).toEqual([
      expect.objectContaining({ articuloId: s.articulo, contada: "18.0000" }),
    ]);
    const crudo = JSON.stringify(operador);
    for (const prohibido of ["sistema", "movido", "diferencia", "motivos", "20.0000", "-2.0000"]) {
      expect(crudo, prohibido).not.toContain(prohibido);
    }
    const gerente = await revisar(id);
    expect(gerente.ok && gerente.dato.huella).toEqual(expect.any(String));
    expect(gerente.ok && gerente.dato.filas[0]).toMatchObject({
      sistema: "20.0000",
      movido: "0.0000",
      diferencia: "-2.0000",
    });
    expect(gerente.ok && gerente.dato.filas[0]?.motivos?.map((m) => m.codigo)).toEqual([
      "VENTA_NO_REGISTRADA",
      "CONSUMO_INTERNO",
      "MERMA",
      "ROTURA",
      "VENCIMIENTO",
      "OTRA_SALIDA",
    ]);
  });

  it("aplicar: el operador no puede; el gerente aplica con la huella y el motivo y queda UN ajuste; dos «Aplicar» a la vez dan el mismo movimiento", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrir(s.dep);
    await cargar(id, s.articulo, "18");
    const vista = await revisar(id);
    const huella = vista.ok ? (vista.dato.huella ?? "") : "";
    const pedido = (quien: ContextoOperativo) =>
      aplicarElConteo(d, quien, {
        conteoId: id,
        huella,
        respuestas: [{ articuloId: s.articulo, motivo: "MERMA", detalle: "" }],
      });
    expect((await pedido(e.operador)).ok).toBe(false);
    expect(await c.existencia(s.dep, s.articulo)).toBe("20.0000");
    const rs = await aLaVez(c, [() => pedido(e.gerente), () => pedido(e.administrador)], 0);
    expect(rs.every((r) => r.ok)).toBe(true);
    const movimientos = rs.flatMap((r) => (r.ok ? [r.dato.movimientoId] : []));
    expect(new Set(movimientos).size).toBe(1);
    expect(rs.filter((r) => r.ok && r.dato.yaAplicado)).toHaveLength(1);
    expect(await c.existencia(s.dep, s.articulo)).toBe("18.0000");
    const aplicado = await revisar(id);
    expect(aplicado.ok && aplicado.dato.estado).toBe("APLICADO");
    expect(aplicado.ok && aplicado.dato.aplicadas[0]).toMatchObject({
      contada: "18.0000",
      diferencia: "-2.0000",
      motivo: "MERMA",
    });
    // Aplicado no se vuelve a cargar ni a cancelar.
    expect(codigoDe(await cargar(id, s.articulo, "1"))).toBe(GENERICO);
    expect((await cancelarElConteo(d, e.gerente, { conteoId: id, motivo: "tarde" })).ok).toBe(
      false,
    );
  });

  it("sin motivo para una diferencia, o con uno que no corresponde al sentido, no se aplica y no mueve nada", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrir(s.dep);
    await cargar(id, s.articulo, "18");
    const vista = await revisar(id);
    const huella = vista.ok ? (vista.dato.huella ?? "") : "";
    for (const respuestas of [
      [],
      [{ articuloId: s.articulo, motivo: "DEVOLUCION_DE_CLIENTE" }],
      [{ articuloId: s.articulo, motivo: "OTRA_SALIDA" }],
    ]) {
      expect(
        codigoDe(await aplicarElConteo(d, e.gerente, { conteoId: id, huella, respuestas })),
      ).not.toBe("OK");
    }
    expect(await c.existencia(s.dep, s.articulo)).toBe("20.0000");
    const ok = await aplicarElConteo(d, e.gerente, {
      conteoId: id,
      huella,
      respuestas: [{ articuloId: s.articulo, motivo: "OTRA_SALIDA", detalle: "se cayó la bolsa" }],
    });
    expect(ok.ok).toBe(true);
  });

  it("un movimiento con hora ANTERIOR a la del conteo que entra MIENTRAS se revisa: no se aplica (revisión desactualizada) y la revisión recarga con otra huella", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrir(s.dep);
    expect((await cargar(id, s.articulo, "18")).ok).toBe(true);
    const antes = await revisar(id);
    const huella = antes.ok ? (antes.dato.huella ?? "") : "";
    await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "-1",
      hechoEn: hace(-20),
    });
    const intento = await aplicarElConteo(d, e.gerente, {
      conteoId: id,
      huella,
      respuestas: [{ articuloId: s.articulo, motivo: "MERMA" }],
    });
    expect(codigoDe(intento)).toBe(GENERICO);
    expect(await c.existencia(s.dep, s.articulo)).toBe("19.0000");
    const despues = await revisar(id);
    expect(despues.ok && despues.dato.huella).not.toBe(huella);
    // Entró con hora anterior a la del conteo: lo que el sistema creía a esa hora cambió y la diferencia con él.
    expect(despues.ok && despues.dato.filas[0]).toMatchObject({
      sistema: "19.0000",
      diferencia: "-1.0000",
    });
    const reintento = await aplicarElConteo(d, e.gerente, {
      conteoId: id,
      huella: despues.ok ? (despues.dato.huella ?? "") : "",
      respuestas: [{ articuloId: s.articulo, motivo: "MERMA" }],
    });
    expect(reintento.ok).toBe(true);
  });

  it("cancelar pide motivo y solo gerente y administrador; cancelar y aplicar a la vez: gana uno y el otro no cambia nada", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrir(s.dep);
    await cargar(id, s.articulo, "18");
    expect((await cancelarElConteo(d, e.operador, { conteoId: id, motivo: "x" })).ok).toBe(false);
    expect(codigoDe(await cancelarElConteo(d, e.gerente, { conteoId: id, motivo: "" }))).not.toBe(
      "OK",
    );
    const vista = await revisar(id);
    const huella = vista.ok ? (vista.dato.huella ?? "") : "";
    const rs = await aLaVez<{ ok: boolean }>(
      c,
      [
        () => cancelarElConteo(d, e.gerente, { conteoId: id, motivo: "me equivoqué" }),
        () =>
          aplicarElConteo(d, e.administrador, {
            conteoId: id,
            huella,
            respuestas: [{ articuloId: s.articulo, motivo: "MERMA" }],
          }),
      ],
      0,
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const existencia = await c.existencia(s.dep, s.articulo);
    const estado = await revisar(id);
    expect(
      (estado.ok && estado.dato.estado === "CANCELADO" && existencia === "20.0000") ||
        (estado.ok && estado.dato.estado === "APLICADO" && existencia === "18.0000"),
    ).toBe(true);
  });

  it("aislamiento: el conteo de otra empresa es el genérico y no se puede cargar, revisar ni aplicar", async () => {
    const s = await conStock(c, otra, "20");
    const ajeno = await abrirElConteo(d, otra.gerente, otra.sucursal, {
      id: nuevoId(),
      depositoId: s.dep,
    });
    const conteoId = ajeno.ok ? ajeno.dato.conteoId : "";
    expect(codigoDe(await revisar(conteoId))).toBe(GENERICO);
    expect(codigoDe(await cargar(conteoId, s.articulo, "1"))).toBe(GENERICO);
    expect(
      codigoDe(await aplicarElConteo(d, e.gerente, { conteoId, huella: "x", respuestas: [] })),
    ).toBe(GENERICO);
    expect(codigoDe(await cancelarElConteo(d, e.gerente, { conteoId, motivo: "x" }))).toBe(
      GENERICO,
    );
  });
});
