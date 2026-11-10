import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { sucursalId } from "../../src/primitivas/identificadores/marca";
import { aporteDeVentas } from "../../src/modulos/ventas/publico";
import { crearCasosDeUsoDeCierre } from "../../src/modulos/cierre/publico";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import {
  FECHA_DE_NEGOCIO,
  montarVentas,
  REGLAS_DE_PRUEBA,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Ventas (E4 fase B), concurrencia e idempotencia del cobro con el motor real (SERIALIZABLE, 20 reintentos al cobrar): dos `venderYCobrar` de
 * la misma cuenta (P6), el mismo pedido repetido a la vez (doble clic), muchos cobros del mismo ticket, anular contra cobrar (P27c), vender
 * contra el cierre de la caja (P10) y contra el inicio de la auditoría del día (P26), y muchas ventas a la vez en una caja (números sin huecos).
 * Cada ronda usa una sucursal y una caja nuevas. Rondas: `PEDERNAL_RONDAS` (8 por defecto para no gastar el presupuesto del CI; al cerrar el tramo se corre con 50 o más).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 1_800_000 });

const RONDAS = (() => {
  const crudo = process.env["PEDERNAL_RONDAS"];
  const n = crudo === undefined ? 8 : Number(crudo);
  return Number.isInteger(n) && n >= 1 ? n : 8;
})();

type Cualquiera = Resultado<unknown, unknown>;

/** El código de un resultado: `ok`, el error si es texto, o su `codigo`, `error` o `tipo` si es un objeto tipado. */
function codigo(r: Cualquiera): string {
  if (r.ok) return "ok";
  const x = r.error;
  if (typeof x === "string") return x;
  if (typeof x === "object" && x !== null) {
    if ("codigo" in x && typeof x.codigo === "string") return x.codigo;
    if ("error" in x && typeof x.error === "string") return x.error;
    if ("tipo" in x && typeof x.tipo === "string") return x.tipo;
  }
  return "otro";
}

/** El mismo pedido se repite si pierde por agotamiento: es seguro por su clave. */
const firme = <R extends Cualquiera>(trabajo: () => Promise<R>) =>
  repetirSiAgotada(trabajo, { esAgotada: agotadaEnElResultado });

const monto = (v: string) => ({ moneda: "ARS", monto: v });

describe.skipIf(base === null)("ventas: concurrencia e idempotencia del cobro", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16 });
    e = await m.escenario();
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** `n` pedidos a la vez con una barrera de `n`. */
  const enParalelo = async <T>(pedidos: readonly (() => Promise<T>)[]): Promise<T[]> => {
    m.armarBarrera(pedidos.length);
    try {
      return await Promise.all(pedidos.map((p) => p()));
    } finally {
      m.soltarBarrera();
    }
  };

  /** Dos pedidos distintos a la vez con una barrera de dos. */
  const dosALaVez = async <A, B>(a: () => Promise<A>, b: () => Promise<B>): Promise<[A, B]> => {
    m.armarBarrera(2);
    try {
      return await Promise.all([a(), b()]);
    } finally {
      m.soltarBarrera();
    }
  };

  /** Una sucursal nueva con su caja abierta: aísla cada ronda de las demás. */
  const sucursalConCaja = async () => {
    const fila = (
      await m.filas<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa, `Suc ${nuevoId().slice(0, 8)}`],
      )
    )[0];
    const s: EscenarioDeVentas = { ...e, sucursal: sucursalId(fila?.id as string) };
    return { s, caja: await m.cajaAbierta(s, { sucursal: s.sucursal }) };
  };

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;
  const pedido = (
    s: EscenarioDeVentas,
    caja: Caja,
    cambios: Partial<Parameters<MundoDeVentas["casos"]["venderYCobrar"]>[1]> = {},
  ): Parameters<MundoDeVentas["casos"]["venderYCobrar"]>[1] => ({
    claveIdempotencia: nuevaClave(),
    cuentaId: nuevoId(),
    ejemplarId: nuevoId(),
    sucursalId: s.sucursal,
    lineas: [{ lineaId: nuevoId(), productoId: s.producto, opcionIds: [], cantidad: "1" }],
    totalEsperado: monto("1000.00"),
    cobro: {
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"] as string,
          cuentaDeCobroId: null,
          importe: monto("1000.00"),
        },
      ],
    },
    ...cambios,
  });

  const contar = (tabla: string, sucursal?: string) =>
    sucursal === undefined
      ? m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [e.empresa])
      : m.contar(`select count(*) as n from ${tabla} where empresa_id = $1 and sucursal_id = $2`, [
          e.empresa,
          sucursal,
        ]);
  const cobrosDeLaSesion = (sesion: string) =>
    m.contar(
      "select count(*) as n from movimiento_caja where empresa_id = $1 and sesion_id = $2 and clase = 'COBRO'",
      [e.empresa, sesion],
    );
  const aplicaciones = () => contar("aplicacion_de_cobro");

  it("P6: dos venderYCobrar de la misma cuenta con claves distintas, a la vez: una sola venta; la otra devuelve la venta hecha", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const { s, caja } = await sucursalConCaja();
      const a = pedido(s, caja);
      const b = { ...a, claveIdempotencia: nuevaClave() };
      const r = await enParalelo([
        () => firme(() => m.casos.venderYCobrar(s.gerente, a)),
        () => firme(() => m.casos.venderYCobrar(s.gerente, b)),
      ]);
      const ctx = `ronda ${i}: ${r.map(codigo).join(" / ")}`;
      const ganadoras = r.filter((x) => x.ok && !x.valor.yaExistia);
      expect(ganadoras, ctx).toHaveLength(1);
      for (const x of r) {
        // La perdedora recibe la venta hecha (misma clave) o dice que el ticket ya estaba cobrado, con su cobranza.
        if (!x.ok) expect(codigo(x), ctx).toBe("TICKET_YA_COBRADO");
      }
      expect(await contar("ticket", s.sucursal), ctx).toBe(1);
      expect(await cobrosDeLaSesion(caja.sesionId), ctx).toBe(1);
    }
  });

  it("el mismo pedido de venderYCobrar tres veces a la vez (doble clic): una venta, un ticket, un cobro; todas devuelven lo mismo", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const { s, caja } = await sucursalConCaja();
      const p = pedido(s, caja);
      const r = await enParalelo([
        () => firme(() => m.casos.venderYCobrar(s.gerente, p)),
        () => firme(() => m.casos.venderYCobrar(s.gerente, p)),
        () => firme(() => m.casos.venderYCobrar(s.gerente, p)),
      ]);
      const ctx = `ronda ${i}: ${r.map(codigo).join(" / ")}`;
      expect(
        r.every((x) => x.ok),
        ctx,
      ).toBe(true);
      const valores = r.map((x) => valorDe(x));
      expect(new Set(valores.map((v) => v.ticketId)).size, ctx).toBe(1);
      expect(
        valores.filter((v) => !v.yaExistia),
        ctx,
      ).toHaveLength(1);
      expect(await contar("ticket", s.sucursal), ctx).toBe(1);
      expect(await cobrosDeLaSesion(caja.sesionId), ctx).toBe(1);
    }
  });

  it("cobrar el mismo ticket con claves distintas a la vez: una cobranza, un cobro; las demás reciben TICKET_YA_COBRADO", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const { s, caja } = await sucursalConCaja();
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(s.gerente, { cuentaId: cuenta, sucursalId: s.sucursal }));
      valorDe(
        await m.casos.agregarLinea(s.gerente, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId: s.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      const t = valorDe(
        await m.casos.cerrarCuenta(s.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
      );
      const intento = () =>
        firme(() =>
          m.casos.cobrar(s.gerente, {
            claveIdempotencia: nuevaClave(),
            ticketId: t.ticketId,
            ejemplarId: t.ejemplarId,
            cajaId: caja.cajaId,
            cobros: [
              {
                medioDePagoId: caja.medios["EFECTIVO"] as string,
                cuentaDeCobroId: null,
                importe: monto("1000.00"),
              },
            ],
          }),
        );
      const r = await enParalelo([intento, intento, intento, intento]);
      const ctx = `ronda ${i}: ${r.map(codigo).join(" / ")}`;
      expect(
        r.filter((x) => x.ok),
        ctx,
      ).toHaveLength(1);
      for (const x of r) if (!x.ok) expect(codigo(x), ctx).toBe("TICKET_YA_COBRADO");
      expect(
        await m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [
          t.ticketId,
        ]),
        ctx,
      ).toBe(1);
      expect(await cobrosDeLaSesion(caja.sesionId), ctx).toBe(1);
    }
  });

  it("P27c: anular un ticket y cobrarlo a la vez: nunca a medias (si se cobró hay cobranza, aplicación y cobro de caja; si no, nada de eso)", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const { s, caja } = await sucursalConCaja();
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(s.gerente, { cuentaId: cuenta, sucursalId: s.sucursal }));
      valorDe(
        await m.casos.agregarLinea(s.gerente, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId: s.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      const t = valorDe(
        await m.casos.cerrarCuenta(s.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
      );
      const [cobro, anulacion] = await dosALaVez(
        () =>
          firme(() =>
            m.casos.cobrar(s.gerente, {
              claveIdempotencia: nuevaClave(),
              ticketId: t.ticketId,
              ejemplarId: t.ejemplarId,
              cajaId: caja.cajaId,
              cobros: [
                {
                  medioDePagoId: caja.medios["EFECTIVO"] as string,
                  cuentaDeCobroId: null,
                  importe: monto("1000.00"),
                },
              ],
            }),
          ),
        () =>
          firme(() =>
            m.casos.anularTicket(s.gerente, {
              claveIdempotencia: nuevaClave(),
              ticketId: t.ticketId,
              ejemplarBaseId: t.ejemplarId,
              ejemplarNuevoId: nuevoId(),
              motivo: "Error del cajero",
            }),
          ),
      );
      const ctx = `ronda ${i}: cobrar=${codigo(cobro)} anular=${codigo(anulacion)}`;
      const estado = (
        await m.filas<{ estado: string }>("select estado from ticket where id = $1", [t.ticketId])
      )[0]?.estado;
      const cobranzas = await m.contar(
        "select count(*) as n from cobranza_de_ticket where ticket_id = $1",
        [t.ticketId],
      );
      const cobros = await cobrosDeLaSesion(caja.sesionId);
      if (cobro.ok) {
        // Se cobró: cobranza, aplicación y un cobro en caja; si la anulación entró después, el cobro NO se toca (queda como diferencia).
        expect(cobranzas, ctx).toBe(1);
        expect(cobros, ctx).toBe(1);
        expect(
          await m.contar(
            "select count(*) as n from aplicacion_de_cobro where cobranza_id in (select id from cobranza_de_ticket where ticket_id = $1)",
            [t.ticketId],
          ),
          ctx,
        ).toBe(1);
      } else {
        expect(["TICKET_ANULADO", "EJEMPLAR_DESACTUALIZADO"], ctx).toContain(codigo(cobro));
        expect(cobranzas, ctx).toBe(0);
        expect(cobros, ctx).toBe(0);
      }
      // La anulación siempre entra (anular un cobrado está permitido) y deja un solo ejemplar de anulación.
      expect(anulacion.ok, ctx).toBe(true);
      expect(estado, ctx).toBe("ANULADO");
      expect(
        await m.contar(
          "select count(*) as n from ticket_ejemplar where ticket_id = $1 and tipo = 'ANULACION'",
          [t.ticketId],
        ),
        ctx,
      ).toBe(1);
    }
  });

  it("P10: venderYCobrar contra el inicio del cierre de la caja: el cobro entra antes del cierre o la venta recibe CAJA_EN_CIERRE sin escribir nada", async () => {
    const resultados = new Set<string>();
    for (let i = 0; i < RONDAS; i++) {
      const { s, caja } = await sucursalConCaja();
      const [venta, cierre] = await dosALaVez(
        () => firme(() => m.casos.venderYCobrar(s.gerente, pedido(s, caja))),
        () => firme(() => m.caja.iniciarCierre(s.gerente, { sesionId: caja.sesionId })),
      );
      const ctx = `ronda ${i}: venta=${codigo(venta)} cierre=${codigo(cierre)}`;
      expect(cierre.ok, ctx).toBe(true);
      const cobros = await cobrosDeLaSesion(caja.sesionId);
      if (venta.ok) {
        resultados.add("entró antes del cierre");
        expect(cobros, ctx).toBe(1);
        expect(await contar("ticket", s.sucursal), ctx).toBe(1);
        // El cobro quedó asentado ANTES que el inicio del cierre (orden de los asientos de la misma base).
        const orden = await m.filas<{ accion: string }>(
          `select accion from auditoria_empresa
            where empresa_id = $1 and accion in ('COBRO_REGISTRADO', 'SESION_CAJA_CIERRE_INICIADO')
              and (entidad_id = $2 or entidad_id = $3) order by id`,
          [e.empresa, venta.ok ? (venta.valor.cobros[0]?.cobroId ?? "") : "", caja.sesionId],
        );
        expect(
          orden.map((f) => f.accion),
          ctx,
        ).toEqual(["COBRO_REGISTRADO", "SESION_CAJA_CIERRE_INICIADO"]);
      } else {
        resultados.add("la caja ya se estaba contando");
        expect(codigo(venta), ctx).toBe("CAJA_EN_CIERRE");
        expect(cobros, ctx).toBe(0);
        expect(await contar("ticket", s.sucursal), ctx).toBe(0);
        expect(await contar("cuenta_consumo", s.sucursal), ctx).toBe(0);
      }
    }
    expect(resultados.size).toBeGreaterThan(0);
  });

  it("P26: venderYCobrar contra el inicio de la auditoría del día: la venta entra antes, o recibe JORNADA_EN_AUDITORIA; nunca un ticket en una jornada ya en auditoría", async () => {
    const cierre = crearCasosDeUsoDeCierre({
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA,
      aportes: [aporteDeVentas],
    });
    for (let i = 0; i < RONDAS; i++) {
      const { s, caja } = await sucursalConCaja();
      const [venta, auditoria] = await dosALaVez(
        () => firme(() => m.casos.venderYCobrar(s.gerente, pedido(s, caja))),
        () =>
          firme(() =>
            cierre.iniciarAuditoria(s.administrador, {
              sucursalId: s.sucursal,
              fechaDeNegocio: FECHA_DE_NEGOCIO,
            }),
          ),
      );
      const ctx = `ronda ${i}: venta=${codigo(venta)} auditoria=${codigo(auditoria)}`;
      expect(auditoria.ok, ctx).toBe(true);
      const tickets = await contar("ticket", s.sucursal);
      if (venta.ok) {
        expect(tickets, ctx).toBe(1);
        const orden = await m.filas<{ accion: string }>(
          `select accion from auditoria_empresa
            where empresa_id = $1 and accion in ('TICKET_COBRADO', 'JORNADA_EN_AUDITORIA')
              and (entidad_id = $2 or entidad_id = $3) order by id`,
          [e.empresa, venta.ok ? venta.valor.ticketId : "", `${s.sucursal}:${FECHA_DE_NEGOCIO}`],
        );
        expect(
          orden.map((f) => f.accion),
          ctx,
        ).toEqual(["TICKET_COBRADO", "JORNADA_EN_AUDITORIA"]);
      } else {
        expect(codigo(venta), ctx).toBe("JORNADA_EN_AUDITORIA");
        expect(tickets, ctx).toBe(0);
        expect(await cobrosDeLaSesion(caja.sesionId), ctx).toBe(0);
      }
    }
  });

  it("muchas ventas a la vez en una misma caja: cada una su ticket, su cobro y su número, sin huecos ni repetidos", async () => {
    const { s, caja } = await sucursalConCaja();
    const n = 8;
    for (let ronda = 0; ronda < Math.max(1, Math.ceil(RONDAS / 4)); ronda++) {
      const r = await enParalelo(
        Array.from(
          { length: n },
          () => () => firme(() => m.casos.venderYCobrar(s.gerente, pedido(s, caja))),
        ),
      );
      expect(
        r.every((x) => x.ok),
        `ronda ${ronda}: ${r.map(codigo).join(" / ")}`,
      ).toBe(true);
    }
    const total = n * Math.max(1, Math.ceil(RONDAS / 4));
    const numeros = (
      await m.filas<{ numero: number }>(
        "select numero from ticket where empresa_id = $1 and sucursal_id = $2 order by numero",
        [e.empresa, s.sucursal],
      )
    ).map((f) => f.numero);
    expect(numeros).toEqual(Array.from({ length: total }, (_, k) => k + 1));
    expect(await cobrosDeLaSesion(caja.sesionId)).toBe(total);
    expect(await aplicaciones()).toBeGreaterThanOrEqual(total);
  });
});
