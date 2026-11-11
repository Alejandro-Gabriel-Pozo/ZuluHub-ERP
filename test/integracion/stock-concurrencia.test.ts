import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { registrarMovimientoEnTx } from "../../src/modulos/stock/casos-de-uso/movimiento-en-tx";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import type { ErrorDeStock } from "../../src/modulos/stock/publico";
import { err, type Resultado } from "../../src/primitivas/resultado/resultado";
import { codigoDe } from "./concurrencia-apoyo";
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
 * E5-T5, concurrencia real (P1 a P4, P5, P6, P7 y P13) con las dependencias reales y varias transacciones a la vez (una barrera hace que todas hayan
 * leído antes de que cualquiera escriba). Rondas: `PEDERNAL_RONDAS` (3 por defecto). Cada nivel del control (`PERMITIR`, `AVISAR`, `BLOQUEAR`)
 * vive en su propia empresa: el nivel no admite borrado.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const NEGATIVA = "stock.existencia_negativa";

describe.skipIf(base === null)("stock: concurrencia de movimientos", () => {
  let c: MontajeDeStock;
  let permitir: EscenarioDeStock;
  let avisar: EscenarioDeStock;
  let bloquear: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    permitir = await c.escenario();
    avisar = await c.escenario();
    bloquear = await c.escenario();
    await c.fijarNivel(avisar.empresa, "AVISAR");
    await c.fijarNivel(bloquear.empresa, "BLOQUEAR");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const renglon = (producto: string, cantidad: string) => ({
    productoId: producto,
    cantidad,
    unidadId: "UNIDAD",
  });
  /** Un depósito con un artículo y su existencia inicial por el caso de uso real. */
  const conExistencia = async (m: EscenarioDeStock, cantidad: string) => {
    const dep = await c.deposito(m);
    const a = await c.articulo(m);
    if (cantidad !== "0") {
      valorDe(
        await c.casos.registrarEntrada(m.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "CARGA_INICIAL",
          renglones: [renglon(a.producto, cantidad)],
        }),
      );
    }
    return { dep, ...a };
  };
  const salida = (m: EscenarioDeStock, dep: string, producto: string, cantidad: string) => {
    const pedido = {
      clave: nuevoId(),
      depositoId: dep,
      motivo: "MERMA",
      renglones: [renglon(producto, cantidad)],
    };
    return () => firme(() => c.casos.registrarSalida(m.gerente, pedido));
  };
  const salidasDe = (m: EscenarioDeStock, dep: string) =>
    c.contar(
      "select count(*) as n from movimiento_de_stock where empresa_id = $1 and deposito_id = $2 and clase = 'SALIDA'",
      [m.empresa, dep],
    );

  it("P1: existencia 1 con BLOQUEAR y dos salidas de 1 a la vez (dos cajeros venden el último): una pasa, la otra CONTROL_BLOQUEA, existencia 0 y nunca −1", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await conExistencia(bloquear, "1");
      const resultados = await aLaVez(
        c,
        [salida(bloquear, a.dep, a.producto, "1"), salida(bloquear, a.dep, a.producto, "1")],
        ronda,
      );
      expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
      const perdedor = resultados.find((r) => !r.ok);
      expect(perdedor).toMatchObject({
        ok: false,
        error: {
          error: "CONTROL_BLOQUEA",
          control: NEGATIVA,
          detalle: [{ productoId: a.producto, depositoId: a.dep, existenciaResultante: "-1.0000" }],
        },
      });
      expect(await c.existencia(a.dep, a.articulo)).toBe("0.0000");
      expect(await salidasDe(bloquear, a.dep)).toBe(1);
    }
  });

  it("P2: el mismo caso con PERMITIR: las dos pasan, la existencia queda en −1 exacto y la salida que cruzó el cero deja su excepción auditada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await conExistencia(permitir, "1");
      const antes = (await c.auditoria(permitir.empresa, "CONTROL_EXCEPCION")).length;
      const resultados = await aLaVez(
        c,
        [salida(permitir, a.dep, a.producto, "1"), salida(permitir, a.dep, a.producto, "1")],
        ronda,
      );
      expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
      expect(await c.existencia(a.dep, a.articulo)).toBe("-1.0000");
      expect(await salidasDe(permitir, a.dep)).toBe(2);
      // Una sola dejó la existencia en negativo (la otra la dejó en 0): una sola excepción, y la existencia que informa es la de su momento.
      expect((await c.auditoria(permitir.empresa, "CONTROL_EXCEPCION")).length).toBe(antes + 1);
      expect(
        resultados
          .flatMap((r) => (r.ok ? r.valor.excepciones : []))
          .map((x) => x.existenciaResultante),
      ).toEqual(["-1.0000"]);
    }
  });

  it("P2: con salidas de 2 sobre una existencia de 1 las dos son excepciones y las dos quedan auditadas (−1 y −3)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await conExistencia(permitir, "1");
      const antes = (await c.auditoria(permitir.empresa, "CONTROL_EXCEPCION")).length;
      const resultados = await aLaVez(
        c,
        [salida(permitir, a.dep, a.producto, "2"), salida(permitir, a.dep, a.producto, "2")],
        ronda,
      );
      expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
      expect(await c.existencia(a.dep, a.articulo)).toBe("-3.0000");
      expect((await c.auditoria(permitir.empresa, "CONTROL_EXCEPCION")).length).toBe(antes + 2);
      expect(
        resultados
          .flatMap((r) => (r.ok ? r.valor.excepciones : []))
          .map((x) => x.existenciaResultante)
          .sort(),
      ).toEqual(["-1.0000", "-3.0000"]);
    }
  });

  it("P3: el mismo caso con AVISAR sin confirmación: una pasa y la otra CONTROL_REQUIERE_CONFIRMACION", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const a = await conExistencia(avisar, "1");
      const resultados = await aLaVez(
        c,
        [salida(avisar, a.dep, a.producto, "1"), salida(avisar, a.dep, a.producto, "1")],
        ronda,
      );
      expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
      expect(resultados.find((r) => !r.ok)).toMatchObject({
        ok: false,
        error: { error: "CONTROL_REQUIERE_CONFIRMACION", control: NEGATIVA },
      });
      expect(await c.existencia(a.dep, a.articulo)).toBe("0.0000");
      expect(await salidasDe(avisar, a.dep)).toBe(1);
    }
  });

  it("P4: dos transferencias cruzadas (A→B y B→A de los mismos artículos) a la vez terminan las dos, sin deadlock visible, y la suma no cambia", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const m = permitir;
      const a = await c.deposito(m);
      const b = await c.deposito(m);
      const articulos = [await c.articulo(m), await c.articulo(m), await c.articulo(m)];
      for (const dep of [a, b]) {
        valorDe(
          await c.casos.registrarEntrada(m.gerente, {
            clave: nuevoId(),
            depositoId: dep,
            motivo: "CARGA_INICIAL",
            renglones: articulos.map((x) => renglon(x.producto, "10")),
          }),
        );
      }
      const mover = (origenId: string, destinoId: string, cantidad: string) => {
        const pedido = {
          clave: nuevoId(),
          origenId,
          destinoId,
          renglones: articulos.map((x) => renglon(x.producto, cantidad)),
        };
        return () => firme(() => c.casos.transferir(m.gerente, pedido));
      };
      const resultados = await aLaVez(c, [mover(a, b, "2"), mover(b, a, "3")], ronda);
      expect(resultados.map(codigoDe)).toEqual(["ok", "ok"]);
      for (const x of articulos) {
        expect(await c.existencia(a, x.articulo)).toBe("11.0000");
        expect(await c.existencia(b, x.articulo)).toBe("9.0000");
      }
      expect(valorDe(await c.consultas.verificarSaldos(m.gerente))).toEqual([]);
    }
  });

  it("P6: desactivar un depósito mientras otra sesión le entra mercadería: gana una y el depósito nunca queda inactivo con existencia", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const m = permitir;
      const dep = await c.deposito(m);
      const a = await c.articulo(m);
      const pedido = {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [renglon(a.producto, "5")],
      };
      // `aLaVez` alterna el orden de salida: cada resultado se guarda por su nombre.
      let porEntrada: Awaited<ReturnType<typeof c.casos.registrarEntrada>> | undefined;
      let porDesactivar: Awaited<ReturnType<typeof c.casos.desactivarDeposito>> | undefined;
      await aLaVez(
        c,
        [
          async (): Promise<unknown> =>
            (porEntrada = await firme(() => c.casos.registrarEntrada(m.gerente, pedido))),
          async (): Promise<unknown> =>
            (porDesactivar = await firme(() =>
              c.casos.desactivarDeposito(m.gerente, { depositoId: dep }),
            )),
        ],
        ronda,
      );
      if (porEntrada === undefined || porDesactivar === undefined)
        throw new Error("faltó un resultado");
      const existencia = Number(await c.existencia(dep, a.articulo));
      const activo = (
        await c.filas<{ activo: boolean }>("select activo from deposito where id = $1", [dep])
      )[0]?.activo;
      // O entró la mercadería (y no se pudo desactivar), o se desactivó (y la entrada se rechazó): nunca las dos.
      if (porEntrada.ok) {
        expect(existencia).toBe(5);
        expect(activo).toBe(true);
        expect(codigoDe(porDesactivar)).toBe("DEPOSITO_CON_EXISTENCIA");
      } else {
        expect(codigoDe(porEntrada)).toBe("DEPOSITO_INACTIVO");
        expect(porDesactivar.ok).toBe(true);
        expect(existencia).toBe(0);
        expect(activo).toBe(false);
      }
    }
  });

  it("P7: la misma entrada dos veces A LA VEZ (doble clic): un solo movimiento y el saldo sube una vez; los dos responden bien", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const m = permitir;
      const dep = await c.deposito(m);
      const a = await c.articulo(m);
      const pedido = {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [renglon(a.producto, "5")],
      };
      const una = () => firme(() => c.casos.registrarEntrada(m.gerente, pedido));
      const resultados = await aLaVez(c, [una, una], ronda);
      expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
      const valores = resultados.map((r) => valorDe(r));
      expect(valores.filter((v) => v.yaExistia)).toHaveLength(1);
      expect(valores[0]?.movimientoId).toBe(valores[1]?.movimientoId);
      expect(await c.existencia(dep, a.articulo)).toBe("5.0000");
    }
  });

  describe("conteos (P5 y P6)", () => {
    /** Un depósito con una existencia de 10 y un conteo abierto en el que ya se contó 6 del artículo. */
    const conteoAbierto = async (m: EscenarioDeStock) => {
      const a = await conExistencia(m, "10");
      const conteoId = valorDe(
        await c.casos.abrirConteo(m.gerente, { id: nuevoId(), depositoId: a.dep }),
      ).conteoId;
      valorDe(
        await c.casos.registrarConteo(m.gerente, {
          id: nuevoId(),
          conteoId,
          productoId: a.producto,
          cantidadContada: "6",
          unidadId: "UNIDAD",
        }),
      );
      return { ...a, conteoId };
    };
    const ajustesDe = (conteoId: string) =>
      c.contar("select count(*) as n from movimiento_de_stock where conteo_id = $1", [conteoId]);

    it("P5: dos aplicaciones del mismo conteo a la vez dejan UN solo ajuste: una aplica y la otra ve yaAplicado con el mismo movimiento", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = permitir;
        const x = await conteoAbierto(m);
        const aplicar = () =>
          firme(() => c.casos.aplicarConteo(m.gerente, { conteoId: x.conteoId }));
        const resultados = await aLaVez(c, [aplicar, aplicar], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        const valores = resultados.map((r) => valorDe(r));
        expect(valores.filter((v) => v.yaAplicado)).toHaveLength(1);
        expect(valores[0]?.movimientoId).not.toBeNull();
        expect(valores[0]?.movimientoId).toBe(valores[1]?.movimientoId);
        expect(await ajustesDe(x.conteoId)).toBe(1);
        expect(await c.existencia(x.dep, x.articulo)).toBe("6.0000");
        expect(
          (await c.auditoria(m.empresa, "CONTEO_APLICADO")).filter(
            (r) => r["entidad_id"] === x.conteoId,
          ),
        ).toHaveLength(1);
      }
    });

    it("P5: aplicar mientras se cancela: gana uno solo; el otro ve CONTEO_CANCELADO o CONTEO_CERRADO, y nunca quedan las dos cosas", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = permitir;
        const x = await conteoAbierto(m);
        let porAplicar: Awaited<ReturnType<typeof c.casos.aplicarConteo>> | undefined;
        let porCancelar: Awaited<ReturnType<typeof c.casos.cancelarConteo>> | undefined;
        await aLaVez(
          c,
          [
            async (): Promise<unknown> =>
              (porAplicar = await firme(() =>
                c.casos.aplicarConteo(m.gerente, { conteoId: x.conteoId }),
              )),
            async (): Promise<unknown> =>
              (porCancelar = await firme(() =>
                c.casos.cancelarConteo(m.gerente, { conteoId: x.conteoId, motivo: "Se cancela" }),
              )),
          ],
          ronda,
        );
        if (porAplicar === undefined || porCancelar === undefined)
          throw new Error("faltó un resultado");
        const estado = (
          await c.filas<{ estado: string }>("select estado from conteo_fisico where id = $1", [
            x.conteoId,
          ])
        )[0]?.estado;
        if (porAplicar.ok) {
          expect(estado).toBe("APLICADO");
          expect(codigoDe(porCancelar)).toBe("CONTEO_CERRADO");
          expect(await ajustesDe(x.conteoId)).toBe(1);
          expect(await c.existencia(x.dep, x.articulo)).toBe("6.0000");
        } else {
          expect(estado).toBe("CANCELADO");
          expect(codigoDe(porAplicar)).toBe("CONTEO_CANCELADO");
          expect(porCancelar.ok).toBe(true);
          expect(await ajustesDe(x.conteoId)).toBe(0);
          expect(await c.existencia(x.dep, x.articulo)).toBe("10.0000");
        }
      }
    });

    it("P5: registrar mientras se aplica: o el registro entra y el ajuste lo cuenta, o el conteo ya estaba cerrado; nunca un registro que el ajuste no vio", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = permitir;
        const x = await conteoAbierto(m);
        let porRegistrar: Awaited<ReturnType<typeof c.casos.registrarConteo>> | undefined;
        let porAplicar: Awaited<ReturnType<typeof c.casos.aplicarConteo>> | undefined;
        const registro = {
          id: nuevoId(),
          conteoId: x.conteoId,
          productoId: x.producto,
          cantidadContada: "3",
          unidadId: "UNIDAD",
        };
        await aLaVez(
          c,
          [
            async (): Promise<unknown> =>
              (porRegistrar = await firme(() => c.casos.registrarConteo(m.gerente, registro))),
            async (): Promise<unknown> =>
              (porAplicar = await firme(() =>
                c.casos.aplicarConteo(m.gerente, { conteoId: x.conteoId }),
              )),
          ],
          ronda,
        );
        if (porRegistrar === undefined || porAplicar === undefined)
          throw new Error("faltó un resultado");
        expect(porAplicar.ok, JSON.stringify(porAplicar)).toBe(true);
        const existencia = await c.existencia(x.dep, x.articulo);
        if (porRegistrar.ok) {
          // Entró antes de aplicar: el último registro (3) es el que vale.
          expect(existencia).toBe("3.0000");
        } else {
          expect(codigoDe(porRegistrar)).toBe("CONTEO_CERRADO");
          expect(existencia).toBe("6.0000");
        }
        expect(await ajustesDe(x.conteoId)).toBe(1);
      }
    });

    it("P6: dos abrirConteo en el mismo depósito a la vez: gana uno, el otro ve CONTEO_EN_CURSO y queda un solo conteo abierto", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = permitir;
        const dep = await c.deposito(m);
        const abrir = () =>
          firme(() => c.casos.abrirConteo(m.gerente, { id: nuevoId(), depositoId: dep }));
        const resultados = await aLaVez(c, [abrir, abrir], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
        expect(resultados.filter((r) => !r.ok).map(codigoDe)).toEqual(["CONTEO_EN_CURSO"]);
        expect(
          await c.contar(
            "select count(*) as n from conteo_fisico where deposito_id = $1 and estado = 'ABIERTO'",
            [dep],
          ),
        ).toBe(1);
      }
    });

    it("P6: el mismo abrirConteo dos veces a la vez (doble clic): un solo conteo y los dos responden bien", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = permitir;
        const dep = await c.deposito(m);
        const pedido = { id: nuevoId(), depositoId: dep };
        const abrir = () => firme(() => c.casos.abrirConteo(m.gerente, pedido));
        const resultados = await aLaVez(c, [abrir, abrir], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(resultados.map((r) => valorDe(r)).filter((v) => v.yaExistia)).toHaveLength(1);
        expect(
          await c.contar("select count(*) as n from conteo_fisico where deposito_id = $1", [dep]),
        ).toBe(1);
      }
    });

    it("P6: desactivar un depósito mientras se le abre un conteo: nunca queda inactivo con un conteo abierto", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = permitir;
        const dep = await c.deposito(m);
        let porAbrir: Awaited<ReturnType<typeof c.casos.abrirConteo>> | undefined;
        let porDesactivar: Awaited<ReturnType<typeof c.casos.desactivarDeposito>> | undefined;
        await aLaVez(
          c,
          [
            async (): Promise<unknown> =>
              (porAbrir = await firme(() =>
                c.casos.abrirConteo(m.gerente, { id: nuevoId(), depositoId: dep }),
              )),
            async (): Promise<unknown> =>
              (porDesactivar = await firme(() =>
                c.casos.desactivarDeposito(m.gerente, { depositoId: dep }),
              )),
          ],
          ronda,
        );
        if (porAbrir === undefined || porDesactivar === undefined)
          throw new Error("faltó un resultado");
        const activo = (
          await c.filas<{ activo: boolean }>("select activo from deposito where id = $1", [dep])
        )[0]?.activo;
        if (porAbrir.ok) {
          expect(activo).toBe(true);
          expect(codigoDe(porDesactivar)).toBe("DEPOSITO_CON_CONTEO_ABIERTO");
        } else {
          expect(codigoDe(porAbrir)).toBe("DEPOSITO_INACTIVO");
          expect(porDesactivar.ok).toBe(true);
          expect(activo).toBe(false);
        }
      }
    });
  });

  describe("P13: una transferencia es atómica", () => {
    /** Un núcleo de transferencia armado a mano, con los depósitos en el orden de bloqueo que se pide. */
    const transferenciaEnTx = (
      m: EscenarioDeStock,
      origen: string,
      destino: string,
      articulo: string,
      cantidad: string,
      luego: () => Promise<Resultado<never, ErrorDeStock> | null>,
    ) =>
      c.entorno.ejecutar({ contexto: m.gerente }, async (tx) => {
        const registrado = await registrarMovimientoEnTx(tx, m.gerente, {
          clase: "TRANSFERENCIA",
          motivo: "TRANSFERENCIA",
          detalle: null,
          origen: null,
          depositoId: origen,
          accion: "stock.transferir",
          anulaA: null,
          conteoId: null,
          clave: nuevoId(),
          huella: huellaDeComando("transferencia", [origen, destino], [[articulo, cantidad]]),
          hechoEn: m.gerente.ahora,
          fechaDeNegocio: null,
          renglones: [
            {
              depositoId: origen,
              articuloId: articulo,
              composicionId: null,
              cantidad: valorDe(cantidadConSignoDesdeTexto(`-${cantidad}`)),
            },
            {
              depositoId: destino,
              articuloId: articulo,
              composicionId: null,
              cantidad: valorDe(cantidadConSignoDesdeTexto(cantidad)),
            },
          ],
          confirmaciones: [],
        });
        if (!registrado.ok) return registrado;
        return (await luego()) ?? registrado;
      });
    const nada = (m: EscenarioDeStock, deposito: string) =>
      c.contar(
        "select count(*) as n from renglon_de_movimiento where empresa_id = $1 and deposito_id = $2",
        [m.empresa, deposito],
      );

    it("con una falla después de escribir el origen y el destino no queda ningún renglón ni se mueve ningún saldo", async () => {
      const m = permitir;
      for (const [idOrigen, idDestino] of [
        ["00000000-0000-4000-8000-000000000001", "ffffffff-ffff-4fff-bfff-ffffffffffff"],
        ["ffffffff-ffff-4fff-bfff-fffffffffff0", "00000000-0000-4000-8000-000000000002"],
      ] as const) {
        const origen = await c.deposito(m, { id: idOrigen });
        const destino = await c.deposito(m, { id: idDestino });
        const a = await c.articulo(m);
        valorDe(
          await c.casos.registrarEntrada(m.gerente, {
            clave: nuevoId(),
            depositoId: origen,
            motivo: "COMPRA",
            renglones: [renglon(a.producto, "10")],
          }),
        );
        const movimientosAntes = await c.contar(
          "select count(*) as n from movimiento_de_stock where empresa_id = $1",
          [m.empresa],
        );
        const r = await transferenciaEnTx(m, origen, destino, a.articulo, "4", () =>
          Promise.resolve(err("FALLA_INYECTADA" as ErrorDeStock)),
        );
        expect(r).toEqual({ ok: false, error: "FALLA_INYECTADA" });
        // Una excepción que no es de la base también revierte todo.
        await expect(
          transferenciaEnTx(m, origen, destino, a.articulo, "4", () =>
            Promise.reject(new Error("falla inyectada")),
          ),
        ).rejects.toThrow("falla inyectada");
        expect(await c.existencia(origen, a.articulo)).toBe("10.0000");
        expect(await c.existencia(destino, a.articulo)).toBe("0");
        expect(await nada(m, destino)).toBe(0);
        expect(
          await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
            m.empresa,
          ]),
        ).toBe(movimientosAntes);
      }
    });

    it("con el destino inactivo la base rechaza la pata del destino (en cualquier orden de bloqueo) y el origen no queda movido", async () => {
      const m = permitir;
      for (const [idOrigen, idDestino] of [
        ["00000000-0000-4000-8000-000000000011", "ffffffff-ffff-4fff-bfff-fffffffffff1"],
        ["ffffffff-ffff-4fff-bfff-fffffffffff2", "00000000-0000-4000-8000-000000000012"],
      ] as const) {
        const origen = await c.deposito(m, { id: idOrigen });
        const destino = await c.deposito(m, { id: idDestino, activo: false });
        const a = await c.articulo(m);
        valorDe(
          await c.casos.registrarEntrada(m.gerente, {
            clave: nuevoId(),
            depositoId: origen,
            motivo: "COMPRA",
            renglones: [renglon(a.producto, "10")],
          }),
        );
        // Por el núcleo, sin la comprobación previa del caso de uso: lo frena el disparador del renglón.
        const r = await transferenciaEnTx(m, origen, destino, a.articulo, "4", () =>
          Promise.resolve(null),
        );
        expect(r.ok).toBe(false);
        expect(await c.existencia(origen, a.articulo)).toBe("10.0000");
        expect(await nada(m, destino)).toBe(0);
        // Por el caso de uso: DEPOSITO_INACTIVO, sin escribir.
        expect(
          await c.casos.transferir(m.gerente, {
            clave: nuevoId(),
            origenId: origen,
            destinoId: destino,
            renglones: [renglon(a.producto, "4")],
          }),
        ).toEqual({ ok: false, error: "DEPOSITO_INACTIVO" });
        expect(await c.existencia(origen, a.articulo)).toBe("10.0000");
      }
    });
  });
});
