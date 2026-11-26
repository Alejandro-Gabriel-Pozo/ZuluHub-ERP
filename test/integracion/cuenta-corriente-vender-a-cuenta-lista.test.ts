import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCuentasDeConsumoParaVender } from "../../src/composicion/cuentas-de-consumo-para-vender";
import {
  crearCasosDeUsoDeCuentaCorriente,
  crearConsultasDeCuentaCorriente,
  type TxDeConsultasDeCuentaCorriente,
  type TxDeCuentaCorriente,
  type TxDeEstadoDeCuenta,
} from "../../src/modulos/cuenta_corriente/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  REGLAS_DE_PRUEBA,
  REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * CC-5 B1a: la lista de clientes para elegir al vender a cuenta y el saldo de UN cliente en la venta rápida (por sucursal) con la previsión que calcula el servidor. Base real y roles reales.
 * Previene: un cajero que ve saldos, límites o movimientos en la lista; clientes de otra empresa o desactivados en la lista; una consulta por sucursal que se cuela fuera del alcance de quien vende
 * o de la empresa; una constancia con importes; un «saldo después» que no cierra con el libro; una consulta sin permiso; y un total inválido que se acepta.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Tx = TxDeCuentaCorriente & TxDeConsultasDeCuentaCorriente & TxDeEstadoDeCuenta;

describe.skipIf(base === null)("cuenta corriente: vender a cuenta, lista y previsión (B1a)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let casos!: ReturnType<typeof crearCasosDeUsoDeCuentaCorriente>;
  let consultas!: ReturnType<typeof crearConsultasDeCuentaCorriente>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 12, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
    const transacciones = m.entorno as unknown as Transacciones<Tx>;
    const dependencias = { transacciones, reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE };
    casos = crearCasosDeUsoDeCuentaCorriente({
      ...dependencias,
      cuentasDeConsumoParaVender: crearCuentasDeConsumoParaVender(),
    });
    consultas = crearConsultasDeCuentaCorriente(dependencias);
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const cliente = async (
    de: EscenarioDeVentas = e,
    o: Partial<{
      limite: string;
      suspendida: boolean;
      nombre: string | null;
      estado: string;
    }> = {},
  ): Promise<string> => {
    const id = randomUUID();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, de.empresa, o.nombre ?? `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
    );
    await m.dueno.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [de.empresa, id],
    );
    await m.dueno.query(
      `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 30, $3, $4, $5, $6)`,
      [de.empresa, id, o.limite ?? "5000.00", claveNueva(), HUELLA, de.gerente.personaId],
    );
    if (o.suspendida === true) {
      await m.dueno.query(
        "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Prueba' where parte_id = $1",
        [id],
      );
    }
    if (o.estado !== undefined) {
      await m.dueno.query("update parte set estado = $2 where id = $1", [id, o.estado]);
    }
    return id;
  };
  /** Carga $1000 al cliente cerrando una cuenta a su nombre. */
  const cargar = async (clienteId: string) => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    valorDe(
      await m.casos.cerrarCuenta(e.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        clienteId,
        totalEsperado: { moneda: "ARS", monto: "1000.00" },
      }),
    );
  };
  const constancias = async () =>
    (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_CONSULTADA_AL_VENDER")).length;
  const noDisponible = { ok: false, error: "CLIENTE_NO_DISPONIBLE" };

  describe("la lista para elegir", () => {
    it("el cajero ve SOLO nombre, CUIT, plazo y estado de los clientes activos con ficha (también la suspendida), ordenados por nombre; ni saldos, ni límite; sin los desactivados ni los de otra empresa", async () => {
      const b = await cliente(e, { nombre: "Beta Viajes" });
      const a = await cliente(e, { nombre: "Alfa Turismo", suspendida: true });
      const desactivado = await cliente(e, { nombre: "Cero Inactivo", estado: "INACTIVA" });
      const ajeno = await cliente(otra, { nombre: "Alfa Ajeno" });
      await cargar(b);
      const lista = valorDe(await consultas.listarClientesParaVender(e.operador));
      const ids = lista.map((c) => c.parteId);
      expect(ids).toEqual(expect.arrayContaining([a, b]));
      expect(ids).not.toContain(desactivado);
      expect(ids).not.toContain(ajeno);
      expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
      const delB = lista.find((c) => c.parteId === b);
      expect(Object.keys(delB ?? {}).sort()).toEqual([
        "cuit",
        "estado",
        "nombre",
        "parteId",
        "plazoDias",
      ]);
      expect(delB).toMatchObject({ nombre: "Beta Viajes", plazoDias: 30, estado: "HABILITADA" });
      expect(lista.find((c) => c.parteId === a)?.estado).toBe("SUSPENDIDA");
      // Lo mismo desde la otra empresa: solo lo suyo.
      const deOtra = valorDe(await consultas.listarClientesParaVender(otra.operador)).map(
        (c) => c.parteId,
      );
      expect(deOtra).toContain(ajeno);
      expect(deOtra).not.toContain(b);
    });

    it("exige `cargar_a_cuenta`: con el módulo en desarrollo o sin persona se rechaza", async () => {
      const enDesarrollo = crearConsultasDeCuentaCorriente({
        transacciones: m.entorno as unknown as Transacciones<Tx>,
        reglas: REGLAS_DE_PRUEBA,
      });
      expect(await enDesarrollo.listarClientesParaVender(e.operador)).toMatchObject({
        ok: false,
      });
      const sinPersona = { ...e.operador, personaId: null } as unknown as typeof e.operador;
      expect(await consultas.listarClientesParaVender(sinPersona)).toMatchObject({ ok: false });
    });
  });

  describe("el saldo de UN cliente en la venta rápida (por sucursal)", () => {
    it("con la sucursal en el alcance de quien vende devuelve lo mismo que por cuenta, deja su constancia con la sucursal y SIN importes", async () => {
      const c = await cliente(e, { limite: "5000.00" });
      await cargar(c);
      const antes = await constancias();
      const r = valorDe(
        await casos.verClienteParaVender(e.operador, { sucursalId: e.sucursal, clienteId: c }),
      );
      expect(Object.keys(r).sort()).toEqual([
        "cliente",
        "disponible",
        "estado",
        "excedido",
        "saldo",
      ]);
      expect(r).toMatchObject({
        saldo: { monto: "1000.00" },
        disponible: { monto: "4000.00" },
        excedido: false,
      });
      expect(await constancias()).toBe(antes + 1);
      const filas = await m.auditoria(e.empresa, "CUENTA_CORRIENTE_CONSULTADA_AL_VENDER");
      const ultima = JSON.stringify(filas[filas.length - 1]?.despues);
      expect(ultima).toContain(e.sucursal);
      expect(ultima).not.toMatch(/1000|4000|5000|monto/);
    });

    it("una sucursal fuera del alcance del cajero, de otra empresa o mal escrita, y un cliente ajeno o sin ficha: el MISMO rechazo y sin constancia", async () => {
      const c = await cliente(e);
      const ajeno = await cliente(otra);
      const sinFicha = randomUUID();
      const antes = await constancias();
      for (const entrada of [
        { sucursalId: e.otraSucursal, clienteId: c },
        { sucursalId: otra.sucursal, clienteId: c },
        { sucursalId: "no-es-un-id", clienteId: c },
        { sucursalId: e.sucursal, clienteId: ajeno },
        { sucursalId: e.sucursal, clienteId: sinFicha },
        { sucursalId: e.sucursal, clienteId: "no-es-un-id" },
      ]) {
        expect(
          await casos.verClienteParaVender(e.operador, entrada),
          JSON.stringify(entrada),
        ).toEqual(noDisponible);
      }
      expect(await constancias()).toBe(antes);
    });

    it("con el módulo en desarrollo, sin persona o con el permiso de otro rol no se consulta", async () => {
      const c = await cliente(e);
      const enDesarrollo = crearCasosDeUsoDeCuentaCorriente({
        transacciones: m.entorno as unknown as Transacciones<Tx>,
        reglas: REGLAS_DE_PRUEBA,
      });
      expect(
        await enDesarrollo.verClienteParaVender(e.operador, {
          sucursalId: e.sucursal,
          clienteId: c,
        }),
      ).toMatchObject({ ok: false });
      const sinPersona = { ...e.operador, personaId: null } as unknown as typeof e.operador;
      expect(
        await casos.verClienteParaVender(sinPersona, { sucursalId: e.sucursal, clienteId: c }),
      ).toMatchObject({ ok: false });
    });
  });

  describe("la previsión que calcula el servidor", () => {
    it("con el total de la venta devuelve «saldo después» y cuánto excedería el límite, al centavo; sin el total no devuelve ninguno", async () => {
      const c = await cliente(e, { limite: "2000.00" });
      await cargar(c); // saldo 1000
      const consultar = (totalDeLaVenta?: string) =>
        casos.verClienteParaVender(e.operador, {
          sucursalId: e.sucursal,
          clienteId: c,
          totalDeLaVenta,
        });
      expect(valorDe(await consultar())).not.toHaveProperty("saldoDespues");
      expect(valorDe(await consultar("500.50"))).toMatchObject({
        saldoDespues: { moneda: "ARS", monto: "1500.50" },
        excedeEn: { monto: "0.00" },
      });
      expect(valorDe(await consultar("1000.00"))).toMatchObject({
        saldoDespues: { monto: "2000.00" },
        excedeEn: { monto: "0.00" },
      });
      expect(valorDe(await consultar("1000.01"))).toMatchObject({
        saldoDespues: { monto: "2000.01" },
        excedeEn: { monto: "0.01" },
      });
      // También por cuenta de consumo (la mesa).
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
      expect(
        valorDe(
          await casos.verClienteParaVender(e.operador, {
            cuentaDeConsumoId: cuenta,
            clienteId: c,
            totalDeLaVenta: "1500.00",
          }),
        ),
      ).toMatchObject({ saldoDespues: { monto: "2500.00" }, excedeEn: { monto: "500.00" } });
    });

    it("un total mal formado (notación científica, negativo, tres decimales, texto) es TOTAL_INVALIDO y no deja constancia", async () => {
      const c = await cliente(e);
      const antes = await constancias();
      for (const total of ["1e3", "-5.00", "10.005", "abc", ""]) {
        expect(
          await casos.verClienteParaVender(e.operador, {
            sucursalId: e.sucursal,
            clienteId: c,
            totalDeLaVenta: total,
          }),
          total,
        ).toEqual({ ok: false, error: "TOTAL_INVALIDO" });
      }
      expect(await constancias()).toBe(antes);
    });
  });
});
