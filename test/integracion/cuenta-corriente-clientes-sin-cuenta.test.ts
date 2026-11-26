import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "../../src/composicion/apoyo-de-exportacion-de-cuenta-corriente";
import {
  crearConsultasDeCuentaCorriente,
  type TxDeConsultasDeCuentaCorriente,
  type TxDeCuentaCorriente,
  type TxDeEstadoDeCuenta,
} from "../../src/modulos/cuenta_corriente/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
  montarVentas,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * CC-5 A2: los clientes que se pueden habilitar (activos, sin ficha de cuenta corriente), con una base real y los roles reales. Previene: ofrecer a un cliente que ya tiene cuenta (una segunda ficha),
 * ofrecer uno desactivado, mostrar clientes de otra empresa, ocultar al que no tiene CUIT (la pantalla tiene que avisar el motivo) y dejar que mire quien no puede habilitar.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type TxDeLaCuentaCorriente = TxDeCuentaCorriente &
  TxDeConsultasDeCuentaCorriente &
  TxDeEstadoDeCuenta;

describe.skipIf(base === null)("cuenta corriente: clientes sin cuenta (CC-5 A2)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let consultas!: ReturnType<typeof crearConsultasDeCuentaCorriente>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 8, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
    consultas = crearConsultasDeCuentaCorriente({
      transacciones: m.entorno as unknown as Transacciones<TxDeLaCuentaCorriente>,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      apoyo: crearApoyoDeLaExportacionDeCuentaCorriente(),
    });
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const parte = async (
    de: EscenarioDeVentas,
    o: Partial<{ conCuit: boolean; estado: string; rolActivo: boolean; conCuenta: boolean }> = {},
  ): Promise<{ id: string; nombre: string; cuit: string | null }> => {
    const id = randomUUID();
    const nombre = `Cliente ${sufijoUnico()}`;
    const cuit = o.conCuit === false ? null : cuitUnico();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, estado, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, $4, $5, $6, $7)`,
      [
        id,
        de.empresa,
        nombre,
        cuit === null ? null : "CUIT",
        cuit,
        o.estado ?? "ACTIVA",
        de.gerente.personaId,
      ],
    );
    await m.dueno.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', $3)",
      [de.empresa, id, o.rolActivo ?? true],
    );
    if (o.conCuenta === true) {
      await m.dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, 30, '1000.00', $3, $4, $5)`,
        [de.empresa, id, claveNueva(), HUELLA, de.gerente.personaId],
      );
    }
    return { id, nombre, cuit };
  };

  it("ofrece al cliente activo sin ficha (con su CUIT) y también al que no tiene CUIT; no ofrece al que ya tiene cuenta, al desactivado, al que dejó de ser cliente ni a los de otra empresa", async () => {
    const libre = await parte(e);
    const sinCuit = await parte(e, { conCuit: false });
    const conCuenta = await parte(e, { conCuenta: true });
    const desactivado = await parte(e, { estado: "INACTIVA" });
    const noEsCliente = await parte(e, { rolActivo: false });
    const ajeno = await parte(otra);

    const lista = valorDe(await consultas.listarClientesSinCuenta(e.gerente));
    const ids = lista.map((c) => c.parteId);
    expect(ids).toContain(libre.id);
    expect(ids).toContain(sinCuit.id);
    for (const fuera of [conCuenta, desactivado, noEsCliente, ajeno]) {
      expect(ids, fuera.nombre).not.toContain(fuera.id);
    }
    expect(lista.find((c) => c.parteId === libre.id)).toEqual({
      parteId: libre.id,
      nombre: libre.nombre,
      cuit: libre.cuit,
    });
    expect(lista.find((c) => c.parteId === sinCuit.id)?.cuit).toBeNull();
    // Lo mismo desde la otra empresa: solo lo suyo.
    const deOtra = valorDe(await consultas.listarClientesSinCuenta(otra.gerente)).map(
      (c) => c.parteId,
    );
    expect(deOtra).toContain(ajeno.id);
    expect(deOtra).not.toContain(libre.id);
  });

  it("exige cuenta_corriente.administrar: un cajero es rechazado", async () => {
    expect(await consultas.listarClientesSinCuenta(e.operador)).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("es lectura: leerla dos veces seguidas da lo mismo y no deja constancia", async () => {
    const antes = (await m.auditoria(e.empresa, "CUENTA_DEL_CLIENTE_HABILITADA")).length;
    const a = valorDe(await consultas.listarClientesSinCuenta(e.gerente));
    const b = valorDe(await consultas.listarClientesSinCuenta(e.gerente));
    expect(b).toEqual(a);
    expect((await m.auditoria(e.empresa, "CUENTA_DEL_CLIENTE_HABILITADA")).length).toBe(antes);
  });
});
