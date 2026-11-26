import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  lotesDelArticulo,
  type DependenciasDeLotesWeb,
  type LotesParaLaPantalla,
} from "../../src/composicion/lotes-web";
import {
  controlarElLoteDelArticulo,
  corregirElLote,
  dejarDeControlarElLoteDelArticulo,
  reasignarEntreLotes,
  type DependenciasDeLotesEscrituraWeb,
} from "../../src/composicion/lotes-escritura-web";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { LoteDeEntrada } from "../../src/modulos/stock/casos-de-uso/lotes-del-libro";
import {
  registrarMovimientoEnTx,
  type PedidoDeMovimiento,
} from "../../src/modulos/stock/casos-de-uso/movimiento-en-tx";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { llaveDeSaldo } from "../../src/modulos/stock/persistencia/repositorio-de-movimientos";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import {
  aLaVez,
  montarStock,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * Las acciones de escritura de «Lotes» de la web (STK-E1) contra la base real y los roles reales, TODAS a través de la composición: controlar y dejar de controlar (dos a la vez, también una contra otra), corregir (con la
 * versión: dos correcciones a la vez, una gana y la otra no pisa), reasignar (el mismo clic dos veces es una sola reasignación; dos que juntas pasan del saldo, una sola entra; reasignar contra una salida del mismo artículo y
 * depósito deja los lotes sumando el saldo), permisos del operador, perilla apagada y aislamiento por empresa. Las reglas del caso de uso tienen su prueba en `stock-lotes.test.ts`; acá lo que suma la composición.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";
const RONDAS = 2;
const FUTURO = "2099-06-01";

describe.skipIf(base === null)("lotes de stock de la web: escritura", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let d: DependenciasDeLotesEscrituraWeb;
  let lectura: DependenciasDeLotesWeb;
  let deposito: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    c.encenderPerilla("lotes");
    deposito = await c.deposito(e, { deVenta: true });
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
    lectura = { consultas: () => c.consultas, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const exito = (r: { ok: boolean }): void => {
    if (!r.ok) throw new Error(JSON.stringify(r));
  };
  const firmar = (t: string) => {
    const r = cantidadConSignoDesdeTexto(t);
    if (!r.ok) throw new Error(t);
    return r.valor;
  };
  const leerLotes = async (articulo: string): Promise<LotesParaLaPantalla> => {
    const r = await lotesDelArticulo(lectura, e.gerente, { articuloId: articulo });
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.dato;
  };
  const loteDe = async (articulo: string, codigo: string) => {
    const l = (await leerLotes(articulo)).lotes.find((x) =>
      codigo === "SIN_ASIGNAR" ? x.sinAsignar : x.codigo === codigo,
    );
    if (l === undefined) throw new Error(`falta el lote ${codigo}`);
    return l;
  };
  /** Un artículo controlado por lote (por la composición) con `sinAsignar` de existencia sin lote y los lotes dados. */
  const armar = async (sinAsignar: string, lotes: readonly (readonly [string, string])[] = []) => {
    const a = await c.articulo(e);
    exito(await controlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo }));
    if (sinAsignar !== "0") {
      exito(
        await c.casos.registrarEntrada(e.gerente, {
          clave: randomUUID(),
          depositoId: deposito,
          motivo: "COMPRA",
          renglones: [{ productoId: a.producto, cantidad: sinAsignar, unidadId: "UNIDAD" }],
        }),
      );
    }
    for (const [codigo, cantidad] of lotes) {
      const entrada: LoteDeEntrada = { codigo, fechaDeVencimiento: FUTURO, cantidad };
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
        huella: huellaDeComando(
          "ENTRADA",
          [deposito, "COMPRA", cantidad, codigo],
          [[a.articulo, cantidad]],
        ),
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
        lotes: { entradas: new Map([[llaveDeSaldo(deposito, a.articulo), [entrada]]]) },
      };
      const r = await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
        registrarMovimientoEnTx(tx, e.gerente, pedido),
      );
      if (!JSON.stringify(r).includes('"ok":true')) throw new Error(JSON.stringify(r));
    }
    return a;
  };
  /** Los lotes de un artículo suman su saldo y ninguno real queda negativo: la regla que ninguna acción puede romper. */
  const losLotesSuman = async (articulo: string) => {
    const lotes = (await leerLotes(articulo)).lotes;
    const suma = lotes.reduce((s, l) => s + BigInt(l.existencia.replace(".", "")), 0n);
    const saldo = BigInt((await c.existencia(deposito, articulo)).replace(".", ""));
    expect(suma).toBe(saldo);
    for (const l of lotes.filter((x) => !x.sinAsignar))
      expect(l.existencia.startsWith("-")).toBe(false);
  };
  const reasignar = (
    articulo: string,
    origen: string,
    destino: string,
    cantidad: string,
    extra: Record<string, unknown> = {},
    quien: ContextoOperativo = e.gerente,
  ) =>
    reasignarEntreLotes(d, quien, e.sucursal, {
      clave: randomUUID(),
      articuloId: articulo,
      depositoId: deposito,
      loteOrigenId: origen,
      loteDestinoId: destino,
      cantidad,
      detalle: "llegó la información del lote",
      ...extra,
    });

  it("controlar: el gerente controla por lote (con vencimiento, sin calidad) y el «Sin asignar» recibe lo que ya había; repetir no escribe de nuevo; el operador no puede", async () => {
    const a = await c.articulo(e);
    exito(
      await c.casos.registrarEntrada(e.gerente, {
        clave: randomUUID(),
        depositoId: deposito,
        motivo: "COMPRA",
        renglones: [{ productoId: a.producto, cantidad: "4", unidadId: "UNIDAD" }],
      }),
    );
    expect(
      codigoDe(await controlarElLoteDelArticulo(d, e.operador, { articuloId: a.articulo })),
    ).toBe("SIN_PERMISO");
    expect((await leerLotes(a.articulo)).control).toBeNull();
    const primero = await controlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo });
    expect(primero).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const despues = await leerLotes(a.articulo);
    expect(despues.control).toEqual({ activo: true });
    expect(despues.lotes.map((l) => [l.sinAsignar, l.existencia])).toEqual([[true, "4.0000"]]);
    expect(
      await controlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo }),
    ).toMatchObject({
      ok: true,
      dato: { yaExistia: true },
    });
    expect(
      await c.auditoria(e.empresa, "LOTE_CONTROLADO").then((x) => x.length),
    ).toBeGreaterThanOrEqual(1);
    await losLotesSuman(a.articulo);
  });

  it("controlar dos veces A LA VEZ deja un solo «Sin asignar» y una sola apertura; controlar contra dejar de controlar termina coherente", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await c.articulo(e);
      exito(
        await c.casos.registrarEntrada(e.gerente, {
          clave: randomUUID(),
          depositoId: deposito,
          motivo: "COMPRA",
          renglones: [{ productoId: a.producto, cantidad: "3", unidadId: "UNIDAD" }],
        }),
      );
      const rs = await aLaVez(
        c,
        [
          () => controlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo }),
          () => controlarElLoteDelArticulo(d, e.administrador, { articuloId: a.articulo }),
        ],
        ronda,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(rs.filter((r) => r.ok && r.dato.yaExistia)).toHaveLength(1);
      const lotes = (await leerLotes(a.articulo)).lotes;
      expect(lotes.filter((l) => l.sinAsignar)).toHaveLength(1);
      await losLotesSuman(a.articulo);
      // Controlar contra dejar de controlar: ambas terminan bien y los lotes siguen sumando el saldo.
      const mixto = await aLaVez<{ ok: boolean }>(
        c,
        [
          () => dejarDeControlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo }),
          () => controlarElLoteDelArticulo(d, e.administrador, { articuloId: a.articulo }),
        ],
        ronda,
      );
      expect(mixto.every((r) => r.ok)).toBe(true);
      await losLotesSuman(a.articulo);
    }
  });

  it("dejar de controlar: el operador no puede; el gerente sí, y repetirlo dice que ya estaba", async () => {
    const a = await armar("2");
    expect(
      codigoDe(await dejarDeControlarElLoteDelArticulo(d, e.operador, { articuloId: a.articulo })),
    ).toBe("SIN_PERMISO");
    expect(
      await dejarDeControlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo }),
    ).toMatchObject({ ok: true, dato: { yaEstaba: false } });
    expect((await leerLotes(a.articulo)).control).toEqual({ activo: false });
    expect(
      await dejarDeControlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo }),
    ).toMatchObject({ ok: true, dato: { yaEstaba: true } });
  });

  it("corregir: la fecha cambia con su versión y su auditoría; las mismas fechas no escriben; una versión vieja no pisa; el «Sin asignar», el operador y una empresa ajena son el genérico", async () => {
    const a = await armar("1", [["L-A", "5"]]);
    const l = await loteDe(a.articulo, "L-A");
    const corregir = (
      vence: string,
      version = l.version,
      quien: ContextoOperativo = e.gerente,
      loteId = l.loteId,
    ) => corregirElLote(d, quien, { loteId, version, vence, detalle: "se cargó mal" });
    expect(codigoDe(await corregir("2099-07-01", l.version, e.operador))).toBe("SIN_PERMISO");
    expect(
      await leerLotes(a.articulo).then((x) => x.lotes.find((y) => y.codigo === "L-A")?.vence),
    ).toBe(FUTURO);
    const hecho = await corregir("2099-07-01");
    expect(hecho).toMatchObject({ ok: true });
    const nueva = await loteDe(a.articulo, "L-A");
    expect(nueva.vence).toBe("2099-07-01");
    expect(nueva.version).toBeGreaterThan(l.version);
    // Las mismas fechas, aun con la versión vieja: no escribe ni audita.
    const antes = (await c.auditoria(e.empresa, "LOTE_CORREGIDO")).length;
    expect(await corregir("2099-07-01")).toMatchObject({ ok: true });
    expect((await c.auditoria(e.empresa, "LOTE_CORREGIDO")).length).toBe(antes);
    // Otra fecha con la versión vieja: no pisa.
    expect(codigoDe(await corregir("2099-08-01", l.version))).toBe(GENERICO);
    expect((await loteDe(a.articulo, "L-A")).vence).toBe("2099-07-01");
    const sin = await loteDe(a.articulo, "SIN_ASIGNAR");
    expect(codigoDe(await corregir("2099-08-01", sin.version, e.gerente, sin.loteId))).toBe(
      GENERICO,
    );
    expect(
      codigoDe(
        await corregirElLote(d, otra.gerente, {
          loteId: l.loteId,
          version: nueva.version,
          vence: "2099-08-01",
          detalle: "x",
        }),
      ),
    ).toBe(GENERICO);
    expect((await loteDe(a.articulo, "L-A")).vence).toBe("2099-07-01");
  });

  it("corregir DOS A LA VEZ con la misma versión: una gana y la otra no pisa (una sola auditoría)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await armar("0", [["L-A", "5"]]);
      const l = await loteDe(a.articulo, "L-A");
      const antes = (await c.auditoria(e.empresa, "LOTE_CORREGIDO")).length;
      const rs = await aLaVez(
        c,
        [
          () =>
            corregirElLote(d, e.gerente, {
              loteId: l.loteId,
              version: l.version,
              vence: "2099-07-01",
              detalle: "una",
            }),
          () =>
            corregirElLote(d, e.administrador, {
              loteId: l.loteId,
              version: l.version,
              vence: "2099-08-01",
              detalle: "otra",
            }),
        ],
        ronda,
      );
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect((await c.auditoria(e.empresa, "LOTE_CORREGIDO")).length).toBe(antes + 1);
      expect(["2099-07-01", "2099-08-01"]).toContain((await loteDe(a.articulo, "L-A")).vence);
    }
  });

  it("reasignar: mueve del «Sin asignar» a un lote que ya existe sin tocar el saldo del artículo; el operador, otro depósito y un destino ajeno son el genérico; pasarse del saldo del lote tiene su texto", async () => {
    const a = await armar("6", [["L-A", "2"]]);
    const sin = await loteDe(a.articulo, "SIN_ASIGNAR");
    const destino = await loteDe(a.articulo, "L-A");
    expect(
      codigoDe(await reasignar(a.articulo, sin.loteId, destino.loteId, "1", {}, e.operador)),
    ).toBe("SIN_PERMISO");
    expect(
      codigoDe(
        await reasignar(a.articulo, sin.loteId, destino.loteId, "1", {
          depositoId: await c.deposito(otra),
        }),
      ),
    ).toBe(GENERICO);
    expect(codigoDe(await reasignar(a.articulo, sin.loteId, randomUUID(), "1"))).toBe(GENERICO);
    expect(codigoDe(await reasignar(a.articulo, sin.loteId, sin.loteId, "1"))).toBe(GENERICO);
    const otroArticulo = await armar("0", [["L-X", "1"]]);
    const ajeno = await loteDe(otroArticulo.articulo, "L-X");
    expect(codigoDe(await reasignar(a.articulo, sin.loteId, ajeno.loteId, "1"))).toBe(GENERICO);
    const antes = await c.existencia(deposito, a.articulo);
    expect(await reasignar(a.articulo, sin.loteId, destino.loteId, "4")).toMatchObject({
      ok: true,
      dato: { yaExistia: false },
    });
    expect(await c.existencia(deposito, a.articulo)).toBe(antes);
    expect((await leerLotes(a.articulo)).lotes.map((l) => [l.codigo, l.existencia])).toEqual(
      expect.arrayContaining([["L-A", "6.0000"]]),
    );
    expect(codigoDe(await reasignar(a.articulo, destino.loteId, sin.loteId, "99"))).toBe(
      "STOCK_SALDO_DE_LOTE_INSUFICIENTE",
    );
    await losLotesSuman(a.articulo);
  });

  it("reasignar: el mismo clic dos veces (misma clave) es UNA reasignación, a la vez también; la misma clave con otro contenido se rechaza", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await armar("6", [["L-A", "2"]]);
      const sin = await loteDe(a.articulo, "SIN_ASIGNAR");
      const destino = await loteDe(a.articulo, "L-A");
      const clave = randomUUID();
      const antes = (await c.auditoria(e.empresa, "LOTE_REASIGNADO")).length;
      const rs = await aLaVez(
        c,
        [
          () => reasignar(a.articulo, sin.loteId, destino.loteId, "3", { clave }),
          () => reasignar(a.articulo, sin.loteId, destino.loteId, "3", { clave }),
        ],
        ronda,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(rs.filter((r) => r.ok && r.dato.yaExistia)).toHaveLength(1);
      expect((await c.auditoria(e.empresa, "LOTE_REASIGNADO")).length).toBe(antes + 1);
      expect((await loteDe(a.articulo, "L-A")).existencia).toBe("5.0000");
      expect(
        codigoDe(await reasignar(a.articulo, sin.loteId, destino.loteId, "2", { clave })),
      ).toBe(GENERICO);
      expect((await loteDe(a.articulo, "L-A")).existencia).toBe("5.0000");
      await losLotesSuman(a.articulo);
    }
  });

  it("reasignar DOS A LA VEZ que juntas pasan del saldo del lote: entra una sola y ningún lote real queda negativo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await armar("0", [
        ["L-A", "5"],
        ["L-B", "1"],
      ]);
      const origen = await loteDe(a.articulo, "L-A");
      const destino = await loteDe(a.articulo, "L-B");
      const rs = await aLaVez(
        c,
        [
          () => reasignar(a.articulo, origen.loteId, destino.loteId, "3"),
          () => reasignar(a.articulo, origen.loteId, destino.loteId, "3", {}, e.administrador),
        ],
        ronda,
      );
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.filter((r) => !r.ok).map(codigoDe)).toEqual(["STOCK_SALDO_DE_LOTE_INSUFICIENTE"]);
      expect((await loteDe(a.articulo, "L-A")).existencia).toBe("2.0000");
      expect((await loteDe(a.articulo, "L-B")).existencia).toBe("4.0000");
      await losLotesSuman(a.articulo);
    }
  });

  it("reasignar contra una SALIDA del mismo artículo y depósito, a la vez: los lotes siguen sumando el saldo y ninguno real queda negativo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await armar("0", [
        ["L-A", "5"],
        ["L-B", "1"],
      ]);
      const origen = await loteDe(a.articulo, "L-A");
      const destino = await loteDe(a.articulo, "L-B");
      const rs = await aLaVez<{ ok: boolean }>(
        c,
        [
          () => reasignar(a.articulo, origen.loteId, destino.loteId, "4"),
          () =>
            c.casos.registrarSalida(e.gerente, {
              clave: randomUUID(),
              depositoId: deposito,
              motivo: "MERMA",
              renglones: [{ productoId: a.producto, cantidad: "3", unidadId: "UNIDAD" }],
            }),
        ],
        ronda,
      );
      expect(rs.some((r) => r.ok)).toBe(true);
      await losLotesSuman(a.articulo);
    }
  });

  it("con la perilla `lotes` apagada controlar es el genérico y no escribe; al encenderla vuelve a andar", async () => {
    const a = await c.articulo(e);
    c.apagarPerillas();
    try {
      expect(
        codigoDe(await controlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo })),
      ).toBe(GENERICO);
      expect((await leerLotes(a.articulo)).control).toBeNull();
    } finally {
      c.encenderPerilla("lotes");
    }
    expect((await controlarElLoteDelArticulo(d, e.gerente, { articuloId: a.articulo })).ok).toBe(
      true,
    );
  });

  it("una empresa ajena no controla, corrige ni reasigna lo de otra: es indistinguible de lo que no existe", async () => {
    const a = await armar("2", [["L-A", "2"]]);
    const l = await loteDe(a.articulo, "L-A");
    const sin = await loteDe(a.articulo, "SIN_ASIGNAR");
    expect(
      codigoDe(await controlarElLoteDelArticulo(d, otra.gerente, { articuloId: a.articulo })),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await dejarDeControlarElLoteDelArticulo(d, otra.gerente, { articuloId: a.articulo }),
      ),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await reasignarEntreLotes(d, otra.gerente, otra.sucursal, {
          clave: randomUUID(),
          articuloId: a.articulo,
          depositoId: deposito,
          loteOrigenId: sin.loteId,
          loteDestinoId: l.loteId,
          cantidad: "1",
          detalle: "x",
        }),
      ),
    ).toBe(GENERICO);
    expect((await leerLotes(a.articulo)).control).toEqual({ activo: true });
  });
});
