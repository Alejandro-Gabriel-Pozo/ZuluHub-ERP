import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * A2c (a), salón: el departamento de la cuenta (migración 0048). Tomar un pedido con dos o más departamentos exige elegir uno; dividir una cuenta hace que cada hija herede
 * EXACTAMENTE el de la madre (también «sin departamento», aunque después se hayan creado departamentos); unir solo une cuentas del mismo departamento
 * (`DEPARTAMENTO_DISTINTO`, supuesto del ingeniero DEC-0364) y no mueve nada si se rechaza.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("salón: el departamento de la cuenta (0048)", () => {
  let m: MundoDeSalon;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  let proxima = 0;
  const departamento = async (empresa: string, nombre: string) => {
    const id = randomUUID();
    await m.dueno.query(
      "insert into nodo_de_clasificacion (id, empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, null, $3, lower($3))",
      [id, empresa, nombre],
    );
    return id;
  };
  const mesa = async (e: EscenarioDeVentas) => {
    const n = ++proxima;
    const id = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId: id,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    return id;
  };
  /** Una mesa con su cuenta (con el departamento que se diga) y un plato. */
  const conPedido = async (e: EscenarioDeVentas, departamentoId?: string) => {
    const cuenta = valorDe(
      await m.salon.tomarPedido(e.gerente, {
        cuentaId: nuevoId(),
        mesaId: await mesa(e),
        ...(departamentoId === undefined ? {} : { departamentoId }),
      }),
    ).cuentaId;
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "2",
      }),
    );
    return cuenta;
  };
  const departamentoDe = async (cuenta: string) =>
    (
      await m.filas<{ d: string | null }>(
        "select departamento_id as d from cuenta_consumo where id = $1",
        [cuenta],
      )
    )[0]?.d;

  it("tomar un pedido con dos departamentos exige elegir uno; con uno elegido, la cuenta lo lleva", async () => {
    const e = await m.escenario();
    const a = await departamento(e.empresa, "Hotel");
    await departamento(e.empresa, "Spa");
    const mesaId = await mesa(e);
    expect(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId })).toEqual({
      ok: false,
      error: "DEPARTAMENTO_REQUERIDO",
    });
    const cuenta = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId, departamentoId: a }),
    ).cuentaId;
    expect(await departamentoDe(cuenta)).toBe(a);
  });

  it("dividir: cada hija hereda el departamento de la madre, aunque la pantalla pida otro", async () => {
    const e = await m.escenario();
    const a = await departamento(e.empresa, "Hotel");
    await departamento(e.empresa, "Spa");
    const cuenta = await conPedido(e, a);
    const lineas = await m.filas<{ id: string }>(
      "select id from linea_cuenta where cuenta_id = $1",
      [cuenta],
    );
    const r = valorDe(
      await m.salon.dividirCuenta(e.gerente, {
        divisionId: nuevoId(),
        cuentaId: cuenta,
        partes: 2,
        asignaciones: [
          { lineaId: lineas[0]?.id as string, forma: "POR_UNIDADES", cantidades: ["1", "1"] },
        ],
      }),
    );
    expect(r.cuentas).toHaveLength(2);
    for (const hija of r.cuentas) expect(await departamentoDe(hija.cuentaId)).toBe(a);
  });

  it("dividir una cuenta anterior a los departamentos (sin departamento): las hijas quedan sin departamento y no se pide elegir", async () => {
    const e = await m.escenario();
    const cuenta = await conPedido(e); // todavía no hay departamentos
    expect(await departamentoDe(cuenta)).toBeNull();
    await departamento(e.empresa, "Hotel");
    await departamento(e.empresa, "Spa");
    const lineas = await m.filas<{ id: string }>(
      "select id from linea_cuenta where cuenta_id = $1",
      [cuenta],
    );
    const r = valorDe(
      await m.salon.dividirCuenta(e.gerente, {
        divisionId: nuevoId(),
        cuentaId: cuenta,
        partes: 2,
        asignaciones: [
          { lineaId: lineas[0]?.id as string, forma: "POR_UNIDADES", cantidades: ["1", "1"] },
        ],
      }),
    );
    for (const hija of r.cuentas) expect(await departamentoDe(hija.cuentaId)).toBeNull();
  });

  it("unir: cuentas de departamentos distintos se rechazan sin mover nada; del mismo departamento se unen", async () => {
    const e = await m.escenario();
    const a = await departamento(e.empresa, "Hotel");
    const b = await departamento(e.empresa, "Spa");
    const enA1 = await conPedido(e, a);
    const enA2 = await conPedido(e, a);
    const enB = await conPedido(e, b);
    const unir = (destino: string, origen: string) =>
      m.salon.unirMesas(e.gerente, {
        unionId: nuevoId(),
        cuentaDestinoId: destino,
        cuentaOrigenId: origen,
        clave: nuevaClave(),
      });
    expect(await unir(enA1, enB)).toEqual({ ok: false, error: "DEPARTAMENTO_DISTINTO" });
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
        [enB],
      ),
    ).toBe(1);
    expect(valorDe(await unir(enA1, enA2)).lineasMovidas).toBe(1);
  });
});
