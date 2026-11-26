import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "../../src/composicion/apoyo-de-exportacion-de-cuenta-corriente";
import {
  fichaDeLaCuenta,
  listarLasCuentas,
  type DependenciasDeCuentaCorrienteWeb,
} from "../../src/composicion/cuenta-corriente-web";
import {
  crearConsultasDeCuentaCorriente,
  type TxDeConsultasDeCuentaCorriente,
  type TxDeEstadoDeCuenta,
} from "../../src/modulos/cuenta_corriente/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Las pantallas de la cuenta corriente de clientes (CC-5, A1), por la composición de la web y con una base real: la lista y la ficha salen campo por campo, con el estado visible («Excedida» derivado), el
 * orden pedido y el genérico ante cualquier cosa que no se puede mostrar. Previene: datos de otra empresa o de otro cliente en la pantalla, un permiso decidido por la pantalla, un campo de más que se ignora en
 * silencio, un error crudo del módulo en el navegador y una ficha interna (clave, huella, versión) que se filtra.
 */

/** El dato de una respuesta que tiene que haber salido bien. */
const dato = <T>(r: { ok: true; dato: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`se esperaba ok y vino ${JSON.stringify(r.error)}`);
  return r.dato;
};

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("cuenta corriente: la lista y la ficha en la web (CC-5, A1)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let d: DependenciasDeCuentaCorrienteWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 12, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
    const transacciones = m.entorno as unknown as Transacciones<
      TxDeConsultasDeCuentaCorriente & TxDeEstadoDeCuenta
    >;
    const consultas = crearConsultasDeCuentaCorriente({
      transacciones,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      apoyo: crearApoyoDeLaExportacionDeCuentaCorriente(),
    });
    d = { consultas: () => consultas, respuesta: { registrar: (x) => registrados.push(x) } };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const cliente = async (
    de: EscenarioDeVentas = e,
    o: Partial<{ limite: string; suspendida: boolean; nombre: string }> = {},
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
        "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Pago atrasado' where parte_id = $1",
        [id],
      );
    }
    return id;
  };
  const venderA = async (clienteId: string, de: EscenarioDeVentas = e) => {
    const { cuenta } = await cuentaConLinea(m, de, de.gerente);
    return valorDe(
      await m.casos.cerrarCuenta(de.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        clienteId,
      }),
    );
  };
  const GENERICO = { ok: false, error: { codigo: "CLIENTES_ACCION_NO_PERMITIDA" } };

  it("la lista trae cada cliente con SOLO lo que la pantalla muestra: estado visible (excedida derivada), saldo, vencido, límite, crédito y el cargo más antiguo; sin ficha interna ni ids de persona", async () => {
    const mia = await m.escenario();
    const excedida = await cliente(mia, { limite: "5000.00", nombre: "Excedida SA" });
    await venderA(excedida, mia);
    await venderA(excedida, mia);
    // El límite baja después de vender (un gerente lo cambia): el cliente queda por encima.
    await m.dueno.query("update cuenta_del_cliente set limite = '1500.00' where parte_id = $1", [
      excedida,
    ]);
    await cliente(mia, { suspendida: true, nombre: "Suspendida SA" });
    const habilitada = await cliente(mia, { limite: "9000.00", nombre: "Habilitada SA" });
    await venderA(habilitada, mia);
    const r = dato(await listarLasCuentas(d, mia.gerente, { orden: "SALDO" }));
    expect(r.orden).toBe("SALDO");
    expect(r.alDia).toBe("2026-11-09");
    expect(r.clientes.map((c) => [c.nombre, c.estado, c.saldo.monto, c.disponible.monto])).toEqual([
      ["Excedida SA", "EXCEDIDA", "2000.00", "0.00"],
      ["Habilitada SA", "HABILITADA", "1000.00", "8000.00"],
      ["Suspendida SA", "SUSPENDIDA", "0.00", "5000.00"],
    ]);
    expect(Object.keys(r.clientes[0] ?? {}).sort()).toEqual([
      "cargoMasAntiguo",
      "cuit",
      "disponible",
      "estado",
      "limite",
      "nombre",
      "parteId",
      "saldo",
      "vencido",
    ]);
    expect(r.clientes[0]?.cargoMasAntiguo).toEqual({ fecha: "2026-11-09", dias: 0 });
    expect(r.clientes[2]?.cargoMasAntiguo).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/huella|clave|version|motivo|habilitada_por|personaId/i);
  });

  it("el orden pedido se respeta (vencido y antigüedad), uno que no existe o un campo de más es el genérico, y sin orden es por saldo", async () => {
    const mia = await m.escenario();
    await cliente(mia, { nombre: "Uno" });
    const lista = async (crudo: unknown) => listarLasCuentas(d, mia.gerente, crudo);
    for (const orden of ["SALDO", "VENCIDO", "ANTIGUEDAD"]) {
      expect(await lista({ orden })).toMatchObject({ ok: true, dato: { orden } });
    }
    expect(await lista({})).toMatchObject({ ok: true, dato: { orden: "SALDO" } });
    expect(await lista(undefined)).toMatchObject({ ok: true, dato: { orden: "SALDO" } });
    expect(await lista({ orden: "NOMBRE" })).toMatchObject(GENERICO);
    expect(await lista({ orden: "SALDO", empresaId: otra.empresa })).toMatchObject(GENERICO);
  });

  it("la ficha trae el cliente, sus condiciones, el estado y los movimientos con su ticket y su medio; el motivo solo si está suspendida", async () => {
    const c = await cliente(e, { limite: "5000.00", nombre: "Ficha SA" });
    const t = await venderA(c);
    const caja = await m.cajaAbierta(e);
    valorDe(
      await m.casos.cobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarId: t.ejemplarId,
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: { moneda: "ARS", monto: "1000.00" },
          },
        ],
      }),
    );
    await venderA(c);
    const r = await fichaDeLaCuenta(d, e.gerente, { parteId: c });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato).toMatchObject({
      parteId: c,
      nombre: "Ficha SA",
      estado: "HABILITADA",
      motivoDeSuspension: null,
      plazoDias: 30,
      limite: { monto: "5000.00" },
      saldo: { monto: "1000.00" },
      disponible: { monto: "4000.00" },
    });
    expect(
      r.dato.movimientos.map((x) => [x.tipo, x.importe.monto, x.medioDePago, x.ticket?.canal]),
    ).toEqual([
      ["VENTA_A_CUENTA", "1000.00", null, "MOSTRADOR"],
      ["COBRANZA", "-1000.00", "EFECTIVO", "MOSTRADOR"],
      ["VENTA_A_CUENTA", "1000.00", null, "MOSTRADOR"],
    ]);
    expect(Object.keys(r.dato).sort()).toEqual([
      "cuentaId",
      "cuit",
      "disponible",
      "estado",
      "limite",
      "motivoDeSuspension",
      "movimientos",
      "nombre",
      "parteId",
      "plazoDias",
      "saldo",
      "version",
    ]);
    const s = await cliente(e, { suspendida: true });
    expect(await fichaDeLaCuenta(d, e.gerente, { parteId: s })).toMatchObject({
      ok: true,
      dato: { estado: "SUSPENDIDA", motivoDeSuspension: "Pago atrasado" },
    });
  });

  it("autorización y aislamiento: el cajero, otra empresa, un cliente sin ficha, un id mal formado y un campo de más dan el MISMO genérico; la pantalla no decide nada", async () => {
    const c = await cliente();
    const pedidos = [
      await fichaDeLaCuenta(d, e.operador, { parteId: c }),
      await fichaDeLaCuenta(d, otra.gerente, { parteId: c }),
      await fichaDeLaCuenta(d, e.gerente, { parteId: randomUUID() }),
      await fichaDeLaCuenta(d, e.gerente, { parteId: "no-es-uuid" }),
      await fichaDeLaCuenta(d, e.gerente, { parteId: c, empresaId: otra.empresa }),
      await fichaDeLaCuenta(d, e.gerente, {}),
    ];
    // El cajero recibe el rechazo del guard (su propio código); el resto, el genérico: ninguno distingue «no existe» de «no es tuyo».
    expect(pedidos[0]).toMatchObject({ ok: false });
    for (const r of pedidos.slice(1)) expect(r).toMatchObject(GENERICO);
    expect(await listarLasCuentas(d, e.operador, {})).toMatchObject({ ok: false });
    const deOtra = dato(await listarLasCuentas(d, otra.gerente, {}));
    expect(deOtra.clientes.map((x) => x.parteId)).not.toContain(c);
  });
});
