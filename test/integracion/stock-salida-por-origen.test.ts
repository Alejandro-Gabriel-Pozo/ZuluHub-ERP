import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { traducirMovimiento, type EntradaDeSalidaPorOrigen } from "../../src/modulos/stock/publico";
import {
  aLaVez,
  firme,
  montarStock,
  nuevoId,
  RONDAS,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E9 N4-5, el puerto `salidaPorOrigen` que stock ofrece a compras (devolver mercadería al proveedor), llamado como lo llamará compras: dentro de la transacción
 * de quien llama. Una salida por devolución aunque llegue dos veces o a la vez (identidad = el origen), atómica con el llamador, con el control de existencia
 * negativa, la anulación espejo una sola vez y con el costo congelado, y aislada por empresa.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)(
  "stock: puerto de salida por origen (devolución al proveedor)",
  () => {
    let c: MontajeDeStock;
    let e: EscenarioDeStock;
    let dep: string;
    beforeAll(async () => {
      if (base === null) return;
      c = await montarStock(base);
      e = await c.escenario();
      dep = await c.deposito(e);
    });
    afterAll(async () => {
      if (base !== null) await c.cerrar();
    });

    const meter = (articulo: string, cantidad: string) =>
      c.entrar(e.gerente, { depositoId: dep, articuloId: articulo, cantidad });
    const salir = (
      devolucion: string,
      producto: string,
      cantidad: string,
      extra: Partial<EntradaDeSalidaPorOrigen> = {},
    ) =>
      c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
        c.puertos.salidaPorOrigen.registrarSalida(tx, e.gerente, {
          clave: nuevoId(),
          origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: devolucion },
          accion: "stock.registrar_salida",
          depositoId: dep,
          motivo: "DEVOLUCION_A_PROVEEDOR",
          renglones: [{ productoId: producto, cantidad, unidadId: "UNIDAD" }],
          ...extra,
        }),
      );
    const anular = (devolucion: string, contexto = e.gerente) =>
      c.entorno.ejecutar({ contexto }, (tx) =>
        c.puertos.salidaPorOrigen.anular(tx, contexto, {
          origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: devolucion },
          accion: "stock.registrar_salida",
          detalle: "Se devolvió por error",
        }),
      );
    const movimientos = () =>
      c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [e.empresa]);

    it("descuenta lo devuelto, devuelve el número de cada renglón y repetirla (misma o distinta clave) no vuelve a descontar", async () => {
      const a = await c.articulo(e);
      await meter(a.articulo, "10");
      const devolucion = nuevoId();
      const primera = valorDe(traducirMovimiento(await salir(devolucion, a.producto, "4")));
      expect(primera.yaExistia).toBe(false);
      expect(primera.renglones).toEqual([{ numero: 1, depositoId: dep, articuloId: a.articulo }]);
      expect(await c.existencia(dep, a.articulo)).toBe("6.0000");
      const otraClave = valorDe(traducirMovimiento(await salir(devolucion, a.producto, "4")));
      expect(otraClave).toMatchObject({ yaExistia: true, movimientoId: primera.movimientoId });
      expect(otraClave.renglones).toEqual(primera.renglones);
      // El primer hecho manda: aunque cambie la cantidad, es la misma devolución.
      const distinta = valorDe(traducirMovimiento(await salir(devolucion, a.producto, "9")));
      expect(distinta).toMatchObject({ yaExistia: true, movimientoId: primera.movimientoId });
      expect(await c.existencia(dep, a.articulo)).toBe("6.0000");
    });

    it("la devolución sale también de cuarentena y de rechazo (y se anula de vuelta ahí); la misma salida con otro motivo sigue rechazada", async () => {
      for (const uso of ["CUARENTENA", "RECHAZO"] as const) {
        const a = await c.articulo(e);
        const deposito = await c.deposito(e, { uso });
        valorDe(
          traducirMovimiento(
            await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
              c.puertos.entradaPorOrigen.registrarEntrada(tx, e.gerente, {
                clave: nuevoId(),
                origen: { tipo: "RECEPCION", id: nuevoId() },
                accion: "stock.registrar_entrada",
                depositoId: deposito,
                motivo: "COMPRA",
                renglones: [{ productoId: a.producto, cantidad: "10", unidadId: "UNIDAD" }],
              }),
            ),
          ),
        );
        const devolucion = nuevoId();
        valorDe(
          traducirMovimiento(await salir(devolucion, a.producto, "4", { depositoId: deposito })),
        );
        expect(await c.existencia(deposito, a.articulo)).toBe("6.0000");
        valorDe(traducirMovimiento(await anular(devolucion)));
        expect(await c.existencia(deposito, a.articulo)).toBe("10.0000");
        // Una merma desde ese mismo depósito sigue rechazada por la base.
        await expect(
          c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
            c.puertos.salidaPorOrigen.registrarSalida(tx, e.gerente, {
              clave: nuevoId(),
              origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: nuevoId() },
              accion: "stock.registrar_salida",
              depositoId: deposito,
              motivo: "MERMA" as never,
              renglones: [{ productoId: a.producto, cantidad: "1", unidadId: "UNIDAD" }],
            }),
          ),
        ).resolves.toEqual({ ok: false, error: "MOTIVO_NO_PERMITIDO" });
      }
    });

    it("dos pedidos a la vez de la misma devolución dejan una sola salida", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const a = await c.articulo(e);
        await meter(a.articulo, "10");
        const devolucion = nuevoId();
        const rs = await aLaVez(
          c,
          [1, 2].map(() => () => firme(() => salir(devolucion, a.producto, "3"))),
          ronda,
        );
        expect(rs.every((r) => r.ok)).toBe(true);
        expect(await c.existencia(dep, a.articulo)).toBe("7.0000");
        expect(
          await c.contar(
            "select count(*) as n from movimiento_de_stock where empresa_id = $1 and origen_tipo = 'DEVOLUCION_A_PROVEEDOR' and origen_id = $2",
            [e.empresa, devolucion],
          ),
        ).toBe(1);
      }
    });

    it("existencia negativa: sin fila el control permite y audita; con BLOQUEAR rechaza sin escribir", async () => {
      const a = await c.articulo(e);
      await meter(a.articulo, "2");
      const permitida = valorDe(traducirMovimiento(await salir(nuevoId(), a.producto, "5")));
      expect(permitida.excepciones).toHaveLength(1);
      expect(await c.existencia(dep, a.articulo)).toBe("-3.0000");

      // Otra empresa con el control en BLOQUEAR (no toca a las demás pruebas).
      const b = await c.escenario();
      const depB = await c.deposito(b);
      const bloqueada = await c.articulo(b);
      await c.entrar(b.gerente, {
        depositoId: depB,
        articuloId: bloqueada.articulo,
        cantidad: "2",
      });
      await c.dueno.query(
        "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'stock.existencia_negativa', 'BLOQUEAR')",
        [b.empresa],
      );
      const r = await c.entorno.ejecutar({ contexto: b.gerente }, (tx) =>
        c.puertos.salidaPorOrigen.registrarSalida(tx, b.gerente, {
          clave: nuevoId(),
          origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: nuevoId() },
          accion: "stock.registrar_salida",
          depositoId: depB,
          motivo: "DEVOLUCION_A_PROVEEDOR",
          renglones: [{ productoId: bloqueada.producto, cantidad: "5", unidadId: "UNIDAD" }],
        }),
      );
      expect(r.ok).toBe(false);
      expect(await c.existencia(depB, bloqueada.articulo)).toBe("2.0000");
      expect(
        await c.contar(
          "select count(*) as n from movimiento_de_stock where empresa_id = $1 and clase = 'SALIDA'",
          [b.empresa],
        ),
      ).toBe(0);
    });

    it("atómica con el llamador: si falla después de la salida, no queda movimiento ni saldo cambiado y la devolución sigue libre", async () => {
      const a = await c.articulo(e);
      await meter(a.articulo, "10");
      const devolucion = nuevoId();
      const antes = await movimientos();
      await expect(
        c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
          const r = await c.puertos.salidaPorOrigen.registrarSalida(tx, e.gerente, {
            clave: nuevoId(),
            origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: devolucion },
            accion: "stock.registrar_salida",
            depositoId: dep,
            motivo: "DEVOLUCION_A_PROVEEDOR",
            renglones: [{ productoId: a.producto, cantidad: "4", unidadId: "UNIDAD" }],
          });
          expect(r.ok).toBe(true);
          return Promise.reject(new Error("falla inyectada"));
        }),
      ).rejects.toThrow("falla inyectada");
      expect(await movimientos()).toBe(antes);
      expect(await c.existencia(dep, a.articulo)).toBe("10.0000");
      expect(valorDe(traducirMovimiento(await salir(devolucion, a.producto, "4"))).yaExistia).toBe(
        false,
      );
    });

    it("la anulación es un espejo con el mismo costo, una sola vez, y sin salida previa no hace nada", async () => {
      const a = await c.articulo(e);
      await meter(a.articulo, "10");
      expect(valorDe(traducirMovimiento(await anular(nuevoId())))).toEqual({
        anulacionId: null,
        habiaSalida: false,
        yaExistia: false,
      });
      const devolucion = nuevoId();
      valorDe(traducirMovimiento(await salir(devolucion, a.producto, "4")));
      expect(await c.existencia(dep, a.articulo)).toBe("6.0000");
      const costoAntes = await c.filas<{ costo_unitario: string; cantidad_valorizada: string }>(
        "select costo_unitario::text as costo_unitario, cantidad_valorizada::text as cantidad_valorizada from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
        [dep, a.articulo],
      );
      const primera = valorDe(traducirMovimiento(await anular(devolucion)));
      expect(primera).toMatchObject({ habiaSalida: true, yaExistia: false });
      expect(await c.existencia(dep, a.articulo)).toBe("10.0000");
      const otra = valorDe(traducirMovimiento(await anular(devolucion)));
      expect(otra).toEqual({
        anulacionId: primera.anulacionId,
        habiaSalida: true,
        yaExistia: true,
      });
      expect(await c.existencia(dep, a.articulo)).toBe("10.0000");
      const costoDespues = await c.filas<{ costo_unitario: string; cantidad_valorizada: string }>(
        "select costo_unitario::text as costo_unitario, cantidad_valorizada::text as cantidad_valorizada from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
        [dep, a.articulo],
      );
      expect(costoDespues).toEqual(costoAntes);
    });

    it("dos anulaciones a la vez dejan una sola", async () => {
      const a = await c.articulo(e);
      await meter(a.articulo, "10");
      const devolucion = nuevoId();
      valorDe(traducirMovimiento(await salir(devolucion, a.producto, "4")));
      const rs = await aLaVez(
        c,
        [1, 2].map(() => () => firme(() => anular(devolucion))),
        0,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(await c.existencia(dep, a.articulo)).toBe("10.0000");
    });

    it("entradas inválidas y otra empresa: motivo que no es el de devolución, origen de otro tipo, depósito ajeno, detalle vacío", async () => {
      const a = await c.articulo(e);
      await meter(a.articulo, "10");
      const antes = await movimientos();
      expect(await salir(nuevoId(), a.producto, "1", { motivo: "VENTA" as never })).toEqual({
        ok: false,
        error: "MOTIVO_NO_PERMITIDO",
      });
      expect(
        await salir(nuevoId(), a.producto, "1", {
          origen: { tipo: "RECEPCION", id: nuevoId() } as never,
        }),
      ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      expect(await salir("no-es-uuid", a.producto, "1")).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      const otra = await c.escenario();
      const depDeOtra = await c.deposito(otra);
      expect(await salir(nuevoId(), a.producto, "1", { depositoId: depDeOtra })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      const sinDetalle = await c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
        c.puertos.salidaPorOrigen.anular(tx, e.gerente, {
          origen: { tipo: "DEVOLUCION_A_PROVEEDOR", id: nuevoId() },
          accion: "stock.registrar_salida",
          detalle: "  ",
        }),
      );
      expect(sinDetalle.ok).toBe(false);
      expect(await movimientos()).toBe(antes);
      // La anulación de otra empresa no ve la salida de esta.
      const devolucion = nuevoId();
      valorDe(traducirMovimiento(await salir(devolucion, a.producto, "2")));
      expect(valorDe(traducirMovimiento(await anular(devolucion, otra.gerente))).habiaSalida).toBe(
        false,
      );
      expect(await c.existencia(dep, a.articulo)).toBe("8.0000");
    });
  },
);
