import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCuentasDeConsumoParaVender } from "../../src/composicion/cuentas-de-consumo-para-vender";
import { crearCasosDeUsoDeCuentaCorriente } from "../../src/modulos/cuenta_corriente/publico";
import type { TxDeCuentaCorriente } from "../../src/modulos/cuenta_corriente/publico";
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
 * CC-5 (C3 del dueño): quien le vende a cuenta a un cliente ve su estado, su saldo y su crédito disponible, y NADA más. Casos de uso reales y una base real. Previene: un cajero que ve la lista de
 * clientes con saldos, el límite o los movimientos; una consulta que se cuela con una cuenta ajena, cerrada o de otra empresa; un permiso decidido por la pantalla; una consulta sin rastro; y un dato
 * que sale aunque el registro de auditoría haya fallado.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Tx = TxDeCuentaCorriente;

describe.skipIf(base === null)("cuenta corriente: consultar al vender (CC-5)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let transacciones!: Transacciones<Tx>;
  let casos: ReturnType<typeof crearCasosDeUsoDeCuentaCorriente>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
    transacciones = m.entorno as unknown as Transacciones<Tx>;
    casos = crearCasosDeUsoDeCuentaCorriente({
      transacciones,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      cuentasDeConsumoParaVender: crearCuentasDeConsumoParaVender(),
    });
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const cliente = async (
    de: EscenarioDeVentas = e,
    o: Partial<{ limite: string; suspendida: boolean }> = {},
  ): Promise<string> => {
    const id = randomUUID();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, de.empresa, `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
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
    return id;
  };
  /** Una cuenta de consumo abierta con una línea de $1000 en la sucursal pedida. */
  const cuentaAbierta = async (
    de: EscenarioDeVentas = e,
    sucursal = de.sucursal,
  ): Promise<string> => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(de.gerente, { cuentaId: cuenta, sucursalId: sucursal }));
    valorDe(
      await m.casos.agregarLinea(de.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: de.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    return cuenta;
  };
  const cargar = async (clienteId: string) => {
    const cuenta = await cuentaAbierta();
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

  it("dice si quien consulta puede aprobar excesos: lo decide el servidor por el rol (el cajero no; el gerente y el administrador sí)", async () => {
    const c = await cliente(e, { limite: "5000.00" });
    const cuenta = await cuentaAbierta();
    const puede = async (contexto: typeof e.operador) =>
      valorDe(
        await casos.verClienteParaVender(contexto, { cuentaDeConsumoId: cuenta, clienteId: c }),
      ).puedeAprobarElExceso;
    expect(await puede(e.operador)).toBe(false);
    expect(await puede(e.gerente)).toBe(true);
    expect(await puede(e.administrador)).toBe(true);
  });

  it("el cajero ve SOLO el estado, el saldo, el crédito disponible y si está excedido del cliente (con su nombre y CUIT): ni el límite, ni los movimientos, ni otros clientes", async () => {
    const c = await cliente(e, { limite: "5000.00" });
    await cargar(c);
    const cuenta = await cuentaAbierta();
    const r = valorDe(
      await casos.verClienteParaVender(e.operador, { cuentaDeConsumoId: cuenta, clienteId: c }),
    );
    expect(Object.keys(r).sort()).toEqual([
      "cliente",
      "disponible",
      "estado",
      "excedido",
      "puedeAprobarElExceso",
      "saldo",
    ]);
    expect(Object.keys(r.cliente).sort()).toEqual(["cuit", "nombre"]);
    expect(r).toMatchObject({
      estado: "HABILITADA",
      puedeAprobarElExceso: false,
      saldo: { moneda: "ARS", monto: "1000.00" },
      disponible: { moneda: "ARS", monto: "4000.00" },
      excedido: false,
    });
    expect(r.cliente.nombre).toMatch(/^Cliente /);
    expect(r.cliente.cuit).toMatch(/^\d{11}$/);
  });

  it("el límite justo y el excedido: saldo igual al límite no excede (disponible cero); un centavo más, sí", async () => {
    const justo = await cliente(e, { limite: "1000.00" });
    await cargar(justo);
    const cuenta = await cuentaAbierta();
    expect(
      valorDe(
        await casos.verClienteParaVender(e.gerente, {
          cuentaDeConsumoId: cuenta,
          clienteId: justo,
        }),
      ),
    ).toMatchObject({ disponible: { monto: "0.00" }, excedido: false });
    await m.dueno.query("update cuenta_del_cliente set limite = '999.99' where parte_id = $1", [
      justo,
    ]);
    expect(
      valorDe(
        await casos.verClienteParaVender(e.gerente, {
          cuentaDeConsumoId: cuenta,
          clienteId: justo,
        }),
      ),
    ).toMatchObject({ disponible: { monto: "0.00" }, excedido: true });
  });

  it("un cliente suspendido se informa como SUSPENDIDA (la pantalla decide qué hacer): la consulta no lo oculta", async () => {
    const c = await cliente(e, { suspendida: true });
    const cuenta = await cuentaAbierta();
    expect(
      valorDe(
        await casos.verClienteParaVender(e.operador, { cuentaDeConsumoId: cuenta, clienteId: c }),
      ),
    ).toMatchObject({ estado: "SUSPENDIDA" });
  });

  it("guard primero: con el módulo en desarrollo, o sin persona, se rechaza y no se lee ni se deja constancia", async () => {
    const c = await cliente();
    const cuenta = await cuentaAbierta();
    const antes = await constancias();
    const enDesarrollo = crearCasosDeUsoDeCuentaCorriente({
      transacciones,
      reglas: REGLAS_DE_PRUEBA,
      cuentasDeConsumoParaVender: crearCuentasDeConsumoParaVender(),
    });
    const a = await enDesarrollo.verClienteParaVender(e.operador, {
      cuentaDeConsumoId: cuenta,
      clienteId: c,
    });
    expect(a).toMatchObject({ ok: false });
    expect(a.ok ? null : a.error).not.toBe("CLIENTE_NO_DISPONIBLE");
    const sinPersona = { ...e.operador, personaId: null } as unknown as typeof e.operador;
    expect(
      await casos.verClienteParaVender(sinPersona, { cuentaDeConsumoId: cuenta, clienteId: c }),
    ).toMatchObject({ ok: false });
    expect(await constancias()).toBe(antes);
  });

  it("cuenta de consumo que no vale: inexistente, cerrada, anulada, de una sucursal fuera del alcance del cajero o de otra empresa; cliente sin ficha o de otra empresa: siempre el MISMO rechazo, sin constancia", async () => {
    const c = await cliente();
    const antes = await constancias();
    const cerrada = await cuentaAbierta();
    valorDe(
      await m.casos.cerrarCuenta(e.gerente, {
        cuentaId: cerrada,
        ejemplarId: nuevoId(),
        clienteId: c,
        totalEsperado: { moneda: "ARS", monto: "1000.00" },
      }),
    );
    const anulada = await cuentaAbierta();
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: anulada, motivo: "Prueba" }));
    const ajenaALaSucursal = await cuentaAbierta(e, e.otraSucursal);
    const deOtraEmpresa = await cuentaAbierta(otra);
    const abierta = await cuentaAbierta();
    const sinFicha = randomUUID();
    const deOtraEmpresaCliente = await cliente(otra);
    const pedidos = [
      { cuentaDeConsumoId: randomUUID(), clienteId: c },
      { cuentaDeConsumoId: cerrada, clienteId: c },
      { cuentaDeConsumoId: anulada, clienteId: c },
      { cuentaDeConsumoId: ajenaALaSucursal, clienteId: c },
      { cuentaDeConsumoId: deOtraEmpresa, clienteId: c },
      { cuentaDeConsumoId: abierta, clienteId: sinFicha },
      { cuentaDeConsumoId: abierta, clienteId: deOtraEmpresaCliente },
      { cuentaDeConsumoId: "no-es-uuid", clienteId: c },
      { cuentaDeConsumoId: abierta, clienteId: "no-es-uuid" },
    ];
    for (const pedido of pedidos) {
      expect(
        await casos.verClienteParaVender(e.operador, pedido),
        JSON.stringify(pedido),
      ).toMatchObject(noDisponible);
    }
    expect(await constancias()).toBe(antes);
    // El gerente (alcance de todas las sucursales) sí ve la cuenta de la otra sucursal; la de otra empresa, nunca.
    expect(
      await casos.verClienteParaVender(e.gerente, {
        cuentaDeConsumoId: ajenaALaSucursal,
        clienteId: c,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await casos.verClienteParaVender(e.gerente, {
        cuentaDeConsumoId: deOtraEmpresa,
        clienteId: c,
      }),
    ).toMatchObject(noDisponible);
  });

  it("sin el puerto de la composición, la consulta se rechaza (nace cerrado) y no deja constancia", async () => {
    const sinPuerto = crearCasosDeUsoDeCuentaCorriente({
      transacciones,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
    });
    const c = await cliente();
    const cuenta = await cuentaAbierta();
    const antes = await constancias();
    expect(
      await sinPuerto.verClienteParaVender(e.gerente, { cuentaDeConsumoId: cuenta, clienteId: c }),
    ).toMatchObject({ ok: false, error: "CONSULTA_NO_DISPONIBLE" });
    expect(await constancias()).toBe(antes);
  });

  it("consultar dos veces da lo mismo, deja dos registros de auditoría sin importes y no cambia el libro", async () => {
    const c = await cliente();
    await cargar(c);
    const cuenta = await cuentaAbierta();
    const libro = () =>
      m.contar(
        "select (select count(*) from asiento_de_saldo) + (select count(*) from imputacion_de_saldo) + (select count(*) from cuenta_del_cliente) as n",
      );
    const libroAntes = await libro();
    const antes = await constancias();
    const pedido = { cuentaDeConsumoId: cuenta, clienteId: c };
    const a = valorDe(await casos.verClienteParaVender(e.operador, pedido));
    const b = valorDe(await casos.verClienteParaVender(e.operador, pedido));
    expect(b).toEqual(a);
    expect(await libro()).toBe(libroAntes);
    const registros = await m.auditoria(e.empresa, "CUENTA_CORRIENTE_CONSULTADA_AL_VENDER");
    expect(registros.length - antes).toBe(2);
    const ultimo = registros.at(-1) as Record<string, unknown>;
    expect(ultimo["actor_persona_id"]).toBe(e.operador.personaId);
    expect(ultimo["despues"]).toEqual({ cuentaDeConsumoId: cuenta, parteId: c });
    expect(JSON.stringify(ultimo["despues"])).not.toMatch(/\d+\.\d{2}|Cliente /);
  });

  it("si el registro de auditoría falla, la consulta no devuelve el dato (falla cerrado) y no queda constancia a medias", async () => {
    const c = await cliente();
    const cuenta = await cuentaAbierta();
    const roto: Transacciones<Tx> = {
      ejecutar: (opciones, trabajo) =>
        transacciones.ejecutar(opciones, (tx) =>
          trabajo({
            ...tx,
            auditoria: {
              ...tx.auditoria,
              registrar: () => Promise.reject(new Error("falla de la auditoría")),
            },
          }),
        ),
    };
    const conFalla = crearCasosDeUsoDeCuentaCorriente({
      transacciones: roto,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      cuentasDeConsumoParaVender: crearCuentasDeConsumoParaVender(),
    });
    const antes = await constancias();
    await expect(
      conFalla.verClienteParaVender(e.gerente, { cuentaDeConsumoId: cuenta, clienteId: c }),
    ).rejects.toThrow("falla de la auditoría");
    expect(await constancias()).toBe(antes);
  });

  it("concurrencia: dos consultas a la vez, mientras se cierra una venta al mismo cliente, devuelven cada una un saldo que existió (antes o después del cierre) y dejan sus dos registros", async () => {
    const c = await cliente();
    const cuenta = await cuentaAbierta();
    const aCerrar = await cuentaAbierta();
    const antes = await constancias();
    const pedido = { cuentaDeConsumoId: cuenta, clienteId: c };
    const [a, b, cierre] = await Promise.all([
      casos.verClienteParaVender(e.operador, pedido),
      casos.verClienteParaVender(e.operador, pedido),
      m.casos.cerrarCuenta(e.gerente, {
        cuentaId: aCerrar,
        ejemplarId: nuevoId(),
        clienteId: c,
        totalEsperado: { moneda: "ARS", monto: "1000.00" },
      }),
    ]);
    valorDe(cierre);
    for (const r of [a, b]) {
      expect(["0.00", "1000.00"]).toContain(valorDe(r).saldo.monto);
    }
    expect((await constancias()) - antes).toBe(2);
    expect(valorDe(await casos.verClienteParaVender(e.operador, pedido)).saldo.monto).toBe(
      "1000.00",
    );
  });
});
