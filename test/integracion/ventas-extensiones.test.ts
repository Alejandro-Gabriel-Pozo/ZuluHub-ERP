import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  aporteDeVentas,
  anularLineaEnTx,
  cerrarYCobrarEnTx,
  copiarLineaEnTx,
  lineasDeCuenta,
  reanclarCuentaEnTx,
  type EntradaDeCerrarYCobrar,
  type ErrorDeVentas,
  type TxDeAporteDeVentas,
} from "../../src/modulos/ventas/publico";
import { personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import {
  FECHA_DE_NEGOCIO,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  cuentaConLinea,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * E7 (T3), extensiones de ventas con el rol REAL de la aplicación: `cerrarYCobrarEnTx` (cobrar una cuenta que ya existe: idempotente, `TOTAL_CAMBIO`,
 * una sola venta si dos cobran a la vez), `copiarLineaEnTx` (pasar una línea a otra cuenta SIN recotizar, el centavo del ítem compartido), el control
 * de la jornada que no cuenta los traslados y `reanclarCuentaEnTx` (cambiar de mesa: gana uno).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)("ventas: las extensiones de E7", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base !== null) m = await montarVentas(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  /** Corre `trabajo` en UNA transacción de la aplicación como esa persona (lo que hace un caso de uso de arriba). */
  const enTx = <T, E>(
    contexto: ContextoOperativo,
    trabajo: (
      tx: Parameters<Parameters<MundoDeVentas["entorno"]["ejecutar"]>[1]>[0],
      persona: ReturnType<typeof personaId>,
    ) => Promise<Resultado<T, E>>,
  ) =>
    m.entorno.ejecutar({ contexto, reintentos: 20 }, (tx) =>
      trabajo(tx, personaId(contexto.personaId as string)),
    );

  const cobro = (
    cuenta: string,
    caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>,
    total: string,
    cambios: Partial<EntradaDeCerrarYCobrar> = {},
  ): EntradaDeCerrarYCobrar => ({
    claveIdempotencia: nuevaClave(),
    cuentaId: cuenta,
    ejemplarId: nuevoId(),
    totalEsperado: monto(total),
    cobro: {
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"] as string,
          cuentaDeCobroId: null,
          importe: monto(total),
        },
      ],
    },
    ...cambios,
  });

  const total = async (cuenta: string) =>
    (
      await m.filas<{ t: string }>(
        "select total_provisorio::text as t from cuenta_consumo where id = $1",
        [cuenta],
      )
    )[0]?.t;

  describe("cerrarYCobrarEnTx", () => {
    let e: EscenarioDeVentas;
    let caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;
    beforeAll(async () => {
      e = await m.escenario();
      caja = await m.cajaAbierta(e);
    });

    it("cobra una cuenta que ya existe: un ticket cobrado con la fecha de la sesión de caja; repetir devuelve la misma venta", async () => {
      const { cuenta } = await cuentaConLinea(m, e, e.gerente, "2");
      const pedido = cobro(cuenta, caja, "2000.00");
      const a = valorDe(
        await enTx(e.gerente, (tx, p) => cerrarYCobrarEnTx(tx, e.gerente, p, pedido)),
      );
      expect(a).toMatchObject({
        estado: "COBRADO",
        yaExistia: false,
        fechaNegocio: FECHA_DE_NEGOCIO,
      });
      const b = valorDe(
        await enTx(e.gerente, (tx, p) => cerrarYCobrarEnTx(tx, e.gerente, p, pedido)),
      );
      expect(b).toMatchObject({ ticketId: a.ticketId, numero: a.numero, yaExistia: true });
      expect(
        await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]),
      ).toBe(1);
      expect(
        await m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [
          a.ticketId,
        ]),
      ).toBe(1);
    });

    it("si otro agregó algo entre medio (TOTAL_CAMBIO) no se cobra nada: la cuenta sigue abierta, sin ticket ni número consumido", async () => {
      const { cuenta } = await cuentaConLinea(m, e, e.gerente);
      const antes = await m.contar(
        "select coalesce(max(ultimo), 0) as n from numerador_ticket where sucursal_id = $1",
        [e.sucursal],
      );
      const r = await enTx(e.gerente, (tx, p) =>
        cerrarYCobrarEnTx(tx, e.gerente, p, cobro(cuenta, caja, "500.00")),
      );
      expect(r).toEqual({
        ok: false,
        error: { error: "TOTAL_CAMBIO", totalActual: monto("1000.00") },
      });
      expect(
        await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]),
      ).toBe(0);
      expect(
        await m.contar(
          "select coalesce(max(ultimo), 0) as n from numerador_ticket where sucursal_id = $1",
          [e.sucursal],
        ),
      ).toBe(antes);
      expect(
        (
          await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [
            cuenta,
          ])
        )[0]?.estado,
      ).toBe("ABIERTA");
    });

    it("dos cobros a la vez de la misma cuenta con claves distintas: una sola venta (el otro ve TICKET_YA_COBRADO o la misma)", async () => {
      const { cuenta } = await cuentaConLinea(m, e, e.gerente);
      const [x, y] = await Promise.all([
        enTx(e.gerente, (tx, p) =>
          cerrarYCobrarEnTx(tx, e.gerente, p, cobro(cuenta, caja, "1000.00")),
        ),
        enTx(e.gerente, (tx, p) =>
          cerrarYCobrarEnTx(tx, e.gerente, p, cobro(cuenta, caja, "1000.00")),
        ),
      ]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      expect(
        await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]),
      ).toBe(1);
      expect(
        await m.contar(
          "select count(*) as n from cobranza_de_ticket c join ticket t on t.id = c.ticket_id where t.cuenta_id = $1",
          [cuenta],
        ),
      ).toBe(1);
    });

    it("con una falla después del cobro (excepción tras cerrar) no queda ticket, ni cobro, ni número: todo o nada", async () => {
      const { cuenta } = await cuentaConLinea(m, e, e.gerente);
      const antes = await m.contar("select count(*) as n from cobro", []).catch(() => 0);
      const r = await enTx<never, ErrorDeVentas | "FALLA_INYECTADA">(e.gerente, async (tx, p) => {
        const hecho = await cerrarYCobrarEnTx(tx, e.gerente, p, cobro(cuenta, caja, "1000.00"));
        if (!hecho.ok) return hecho;
        return err("FALLA_INYECTADA" as const);
      });
      expect(r).toEqual({ ok: false, error: "FALLA_INYECTADA" });
      expect(
        await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]),
      ).toBe(0);
      expect(await m.contar("select count(*) as n from cobro", []).catch(() => 0)).toBe(antes);
      expect(
        (
          await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [
            cuenta,
          ])
        )[0]?.estado,
      ).toBe("ABIERTA");
    });
  });

  describe("copiarLineaEnTx", () => {
    let e: EscenarioDeVentas;
    beforeAll(async () => {
      e = await m.escenario();
    });

    const abrir = async () => {
      const id = nuevoId();
      valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: id, sucursalId: e.sucursal }));
      return id;
    };
    const trasladar = (
      origen: string,
      linea: string,
      destino: string,
      nueva: string,
      cantidad: string,
      modo: "COMPLETA" | "POR_UNIDADES" | "COMPARTIDA" | "RESTO",
      extra: { importeFijo?: string; controlaStock?: boolean } = {},
    ) =>
      enTx(e.gerente, async (tx, p) => {
        const an = await anularLineaEnTx(tx, e.gerente, p, {
          cuentaId: origen,
          lineaId: linea,
          motivo: modo === "RESTO" ? "Se equivocó el mozo" : "TRASLADADA",
        });
        if (!an.ok) return an;
        return copiarLineaEnTx(tx, e.gerente, p, {
          lineaOrigenId: linea,
          cuentaDestinoId: destino,
          lineaNuevaId: nueva,
          cantidad,
          modo,
          ...extra,
        });
      });

    it("pasa la línea SIN recotizar: si el catálogo cambia de precio en el medio, la copia conserva el precio congelado", async () => {
      const { cuenta, linea } = await cuentaConLinea(m, e, e.gerente, "2");
      const destino = await abrir();
      await m.precio({
        empresa: e.empresa,
        producto: e.producto,
        precio: "1500",
        desde: "2026-11-09T14:00:00Z",
      });
      const nueva = nuevoId();
      const r = valorDe(await trasladar(cuenta, linea, destino, nueva, "2", "COMPLETA"));
      expect(r.yaExistia).toBe(false);
      expect(await total(destino)).toBe("2000.00");
      expect(await total(cuenta)).toBe("0.00");
      const filas = await m.filas<{ precio_unitario: string }>(
        "select precio_unitario::text from linea_cuenta where id = $1",
        [nueva],
      );
      expect(filas[0]?.precio_unitario).toBe("1000.000000");
      expect(
        await m.contar(
          "select count(*) as n from linea_copiada where linea_origen_id = $1 and modo = 'COMPLETA'",
          [linea],
        ),
      ).toBe(1);
    });

    it("repetir la misma copia no duplica nada (misma línea nueva): devuelve yaExistia", async () => {
      const { cuenta, linea } = await cuentaConLinea(m, e, e.gerente);
      const destino = await abrir();
      const nueva = nuevoId();
      valorDe(await trasladar(cuenta, linea, destino, nueva, "1", "COMPLETA"));
      const otra = valorDe(
        await enTx(e.gerente, async (tx, p) => {
          const an = await anularLineaEnTx(tx, e.gerente, p, {
            cuentaId: cuenta,
            lineaId: linea,
            motivo: "TRASLADADA",
          });
          if (!an.ok) return an;
          return copiarLineaEnTx(tx, e.gerente, p, {
            lineaOrigenId: linea,
            cuentaDestinoId: destino,
            lineaNuevaId: nueva,
            cantidad: "1",
            modo: "COMPLETA",
          });
        }),
      );
      expect(otra.yaExistia).toBe(true);
      expect(
        await m.contar("select count(*) as n from linea_cuenta where cuenta_id = $1", [destino]),
      ).toBe(1);
    });

    it("el ítem compartido entre tres: el centavo que sobra queda en la Cuenta 1 y la suma de las tres cuentas es el importe de la línea", async () => {
      const barato = await m.productoVendible(e.empresa, "100");
      const madre = await abrir();
      const linea = nuevoId();
      valorDe(
        await m.casos.agregarLinea(e.gerente, {
          cuentaId: madre,
          lineaId: linea,
          productoId: barato,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      const [c1, c2, c3] = [await abrir(), await abrir(), await abrir()] as [
        string,
        string,
        string,
      ];
      valorDe(
        await enTx(e.gerente, async (tx, p) => {
          const an = await anularLineaEnTx(tx, e.gerente, p, {
            cuentaId: madre,
            lineaId: linea,
            motivo: "TRASLADADA",
          });
          if (!an.ok) return an;
          for (const [cuenta, fijo] of [
            [c1, "33.34"],
            [c2, "33.33"],
            [c3, "33.33"],
          ] as const) {
            const c = await copiarLineaEnTx(tx, e.gerente, p, {
              lineaOrigenId: linea,
              cuentaDestinoId: cuenta,
              lineaNuevaId: nuevoId(),
              cantidad: "1",
              modo: "COMPARTIDA",
              importeFijo: fijo,
              controlaStock: false,
            });
            if (!c.ok) return c;
          }
          return ok(null);
        }),
      );
      expect([await total(c1), await total(c2), await total(c3)]).toEqual([
        "33.34",
        "33.33",
        "33.33",
      ]);
    });

    it("una línea no se traslada dos veces: la segunda anulación dice que ya estaba anulada", async () => {
      const { cuenta, linea } = await cuentaConLinea(m, e, e.gerente);
      const a = await abrir();
      const b = await abrir();
      valorDe(await trasladar(cuenta, linea, a, nuevoId(), "1", "COMPLETA"));
      const segunda = valorDe(
        await enTx(e.gerente, (tx, p) =>
          anularLineaEnTx(tx, e.gerente, p, {
            cuentaId: cuenta,
            lineaId: linea,
            motivo: "TRASLADADA",
          }),
        ),
      );
      expect(segunda.yaEstabaAnulada).toBe(true);
      expect(await total(b)).toBe("0.00");
    });

    it("el control de la jornada no cuenta los traslados, pero sí lo anulado en parte (RESTO)", async () => {
      const x = await m.escenario();
      const { cuenta, linea } = await cuentaConLinea(m, x, x.gerente, "3");
      const destino = nuevoId();
      valorDe(await m.casos.abrirCuenta(x.gerente, { cuentaId: destino, sucursalId: x.sucursal }));
      valorDe(
        await enTx(x.gerente, async (tx, p) => {
          const an = await anularLineaEnTx(tx, x.gerente, p, {
            cuentaId: cuenta,
            lineaId: linea,
            motivo: "TRASLADADA",
          });
          if (!an.ok) return an;
          return copiarLineaEnTx(tx, x.gerente, p, {
            lineaOrigenId: linea,
            cuentaDestinoId: destino,
            lineaNuevaId: nuevoId(),
            cantidad: "3",
            modo: "COMPLETA",
          });
        }),
      );
      const { cuenta: c2, linea: l2 } = await cuentaConLinea(m, x, x.gerente, "3");
      valorDe(
        await enTx(x.gerente, async (tx, p) => {
          const an = await anularLineaEnTx(tx, x.gerente, p, {
            cuentaId: c2,
            lineaId: l2,
            motivo: "Se equivocó el mozo",
          });
          if (!an.ok) return an;
          return copiarLineaEnTx(tx, x.gerente, p, {
            lineaOrigenId: l2,
            cuentaDestinoId: c2,
            lineaNuevaId: nuevoId(),
            cantidad: "2",
            modo: "RESTO",
          });
        }),
      );
      const controles = valorDe(
        await enTx(x.gerente, (tx) =>
          aporteDeVentas.controles(tx as unknown as TxDeAporteDeVentas, {
            empresaId: x.gerente.empresaId,
            sucursalId: sucursalId(x.sucursal),
            fechaDeNegocio: FECHA_DE_NEGOCIO as never,
          }),
        ),
      );
      const anulaciones = controles.find((c) => c.clave === "ventas.anulaciones");
      expect(anulaciones?.cantidad).toBe(1);
    });
  });

  describe("reanclarCuentaEnTx", () => {
    let e: EscenarioDeVentas;
    beforeAll(async () => {
      e = await m.escenario();
    });
    const conAncla = async (mesa: string) => {
      const id = nuevoId();
      valorDe(
        await m.casos.abrirCuenta(e.gerente, {
          cuentaId: id,
          sucursalId: e.sucursal,
          ancla: { tipo: "salon.mesa", id: mesa },
        }),
      );
      return id;
    };
    const mover = (cuenta: string, mesa: string) =>
      enTx(e.gerente, (tx, p) =>
        reanclarCuentaEnTx(tx, e.gerente, p, {
          cuentaId: cuenta,
          ancla: { tipo: "salon.mesa", id: mesa },
        }),
      );

    it("a una mesa libre pasa; a una ocupada, ANCLA_OCUPADA; al mismo destino otra vez, yaExistia", async () => {
      const [m1, m2, m3] = [nuevoId(), nuevoId(), nuevoId()];
      const a = await conAncla(m1);
      await conAncla(m2);
      expect(valorDe(await mover(a, m3))).toEqual({ yaExistia: false });
      expect(valorDe(await mover(a, m3))).toEqual({ yaExistia: true });
      expect(await mover(a, m2)).toEqual({ ok: false, error: "ANCLA_OCUPADA" });
    });

    it("dos cuentas que van a la misma mesa libre a la vez: gana una y la otra se queda donde estaba", async () => {
      const [libre, ma, mb] = [nuevoId(), nuevoId(), nuevoId()];
      const a = await conAncla(ma);
      const b = await conAncla(mb);
      const [x, y] = await Promise.all([mover(a, libre), mover(b, libre)]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      expect(
        await m.contar(
          "select count(*) as n from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
          [libre],
        ),
      ).toBe(1);
    });
  });

  it("las líneas de la cuenta se leen con la foto congelada (lineasDeCuenta)", async () => {
    const e = await m.escenario();
    const { cuenta } = await cuentaConLinea(m, e, e.gerente, "2");
    const lineas = valorDe(
      await enTx(e.gerente, async (tx) =>
        ok(await lineasDeCuenta(tx, e.gerente.empresaId, cuenta)),
      ),
    );
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ cantidad: "2.0000", importeFijo: null });
  });
});
