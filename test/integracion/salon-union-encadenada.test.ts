import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * D1 del salón (decisión del dueño: «una mesa ya unida o dividida no se une ni se divide de nuevo»): una cuenta que ya RECIBIÓ una unión (destino de A→B)
 * no se une como origen (B→C) ni se divide; si se permitiera, la reserva de A quedaría abierta para siempre al cobrar (ventas.cuentas_abiertas la
 * trabaría). Un solo caso de uso decide en la base: dos pedidos a la vez sobre la misma cuenta, una gana. Repetir el mismo pedido no duplica.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)(
  "salón: unión encadenada y división de un destino de unión (D1)",
  () => {
    let m: MundoDeSalon;
    let e: EscenarioDeVentas;
    let caja: Awaited<ReturnType<MundoDeSalon["cajaAbierta"]>>;
    let proxima = 0;
    beforeAll(async () => {
      if (base === null) return;
      m = await montarSalon(base);
      e = await m.escenario();
      caja = await m.cajaAbierta(e);
    });
    afterAll(async () => {
      await m.cerrar();
    });

    /** Una mesa con su cuenta y un plato ya enviado a cocina (así se puede cobrar). */
    const conPedido = async () => {
      const n = ++proxima;
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
      const cuenta = valorDe(
        await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
      ).cuentaId;
      valorDe(
        await m.salon.agregarAlPedido(e.gerente, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId: e.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      valorDe(
        await m.salon.enviarACocina(e.gerente, {
          envioId: nuevoId(),
          cuentaId: cuenta,
          claveIdempotencia: nuevaClave(),
        }),
      );
      return { mesaId, cuenta };
    };
    const unir = (destino: string, origen: string, unionId = nuevoId(), clave = nuevaClave()) =>
      m.salon.unirMesas(e.gerente, {
        unionId,
        cuentaDestinoId: destino,
        cuentaOrigenId: origen,
        clave,
      });
    const dividirEnDos = async (cuenta: string) => {
      const vigentes = await m.filas<{ id: string }>(
        "select id from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE' order by id",
        [cuenta],
      );
      return m.salon.dividirCuenta(e.gerente, {
        divisionId: nuevoId(),
        cuentaId: cuenta,
        partes: 2,
        asignaciones: vigentes.map((l, i) => ({
          lineaId: l.id,
          forma: "ENTERO" as const,
          parte: i === 0 ? 1 : 2,
        })),
      });
    };
    const estadoDe = async (cuenta: string) =>
      (
        await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [
          cuenta,
        ])
      )[0]?.estado;
    const cobrar = (cuenta: string, total: string) =>
      m.salon.cobrarMesa(e.gerente, {
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
      });
    const unionesDe = (cuentas: readonly string[]) =>
      m.contar(
        "select count(*) as n from union_de_mesas where cuenta_destino_id = any($1) or cuenta_origen_id = any($1)",
        [cuentas],
      );

    it("tras unir A con B, unir B con C (B como origen) se rechaza con MESA_UNIDA y no escribe nada", async () => {
      const a = await conPedido();
      const b = await conPedido();
      const c = await conPedido();
      valorDe(await unir(b.cuenta, a.cuenta));
      expect(await unir(c.cuenta, b.cuenta)).toEqual({ ok: false, error: "MESA_UNIDA" });
      expect(await unionesDe([a.cuenta, b.cuenta, c.cuenta])).toBe(1);
      expect(
        await m.contar(
          "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
          [c.cuenta],
        ),
      ).toBe(1);
      expect(
        await m.contar(
          "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
          [b.cuenta],
        ),
      ).toBe(2);
    });

    it("dividir una cuenta que ya recibió una unión se rechaza con MESA_UNIDA y no escribe nada", async () => {
      const a = await conPedido();
      const b = await conPedido();
      valorDe(await unir(b.cuenta, a.cuenta));
      expect(await dividirEnDos(b.cuenta)).toEqual({ ok: false, error: "MESA_UNIDA" });
      expect(
        await m.contar("select count(*) as n from division_de_cuenta where cuenta_madre_id = $1", [
          b.cuenta,
        ]),
      ).toBe(0);
      expect(await estadoDe(b.cuenta)).toBe("ABIERTA");
    });

    it("cobrar el destino libera la reserva de A (no queda ninguna cuenta abierta ni trabada)", async () => {
      const a = await conPedido();
      const b = await conPedido();
      valorDe(await unir(b.cuenta, a.cuenta));
      expect(valorDe(await cobrar(b.cuenta, "2000.00")).estado).toBe("COBRADO");
      expect(await estadoDe(a.cuenta)).toBe("ANULADA");
      expect(await estadoDe(b.cuenta)).toBe("CERRADA");
    });

    it("P6: unir B→C y A→B a la vez sobre la misma cuenta: una gana, la otra se rechaza y no queda una cadena", async () => {
      const a = await conPedido();
      const b = await conPedido();
      const c = await conPedido();
      const [x, y] = await Promise.all([unir(b.cuenta, a.cuenta), unir(c.cuenta, b.cuenta)]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      for (const r of [x, y]) if (!r.ok) expect(r.error).toBe("MESA_UNIDA");
      expect(await unionesDe([a.cuenta, b.cuenta, c.cuenta])).toBe(1);
      expect(
        await m.contar(
          "select count(*) as n from linea_cuenta where cuenta_id = any($1) and estado = 'VIGENTE'",
          [[a.cuenta, b.cuenta, c.cuenta]],
        ),
      ).toBe(3);
    });

    it("P6: dividir B y unir A→B a la vez: una gana, la otra se rechaza (nunca una mesa dividida que además recibió una unión)", async () => {
      const a = await conPedido();
      const b = await conPedido();
      const [u, d] = await Promise.all([unir(b.cuenta, a.cuenta), dividirEnDos(b.cuenta)]);
      expect([u.ok, d.ok].filter(Boolean)).toHaveLength(1);
      const unidas = await unionesDe([a.cuenta, b.cuenta]);
      const divisiones = await m.contar(
        "select count(*) as n from division_de_cuenta where cuenta_madre_id = $1",
        [b.cuenta],
      );
      expect(unidas + divisiones).toBe(1);
    });

    it("I13: repetir la misma unión y repetir el pedido rechazado no duplican nada", async () => {
      const a = await conPedido();
      const b = await conPedido();
      const c = await conPedido();
      const unionId = nuevoId();
      const clave = nuevaClave();
      valorDe(await unir(b.cuenta, a.cuenta, unionId, clave));
      expect(valorDe(await unir(b.cuenta, a.cuenta, unionId, clave)).yaExistia).toBe(true);
      const rechazo = { unionId: nuevoId(), clave: nuevaClave() };
      expect(await unir(c.cuenta, b.cuenta, rechazo.unionId, rechazo.clave)).toEqual({
        ok: false,
        error: "MESA_UNIDA",
      });
      expect(await unir(c.cuenta, b.cuenta, rechazo.unionId, rechazo.clave)).toEqual({
        ok: false,
        error: "MESA_UNIDA",
      });
      expect(await unionesDe([a.cuenta, b.cuenta, c.cuenta])).toBe(1);
      expect(
        await m.contar(
          "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
          [b.cuenta],
        ),
      ).toBe(2);
    });
  },
);
