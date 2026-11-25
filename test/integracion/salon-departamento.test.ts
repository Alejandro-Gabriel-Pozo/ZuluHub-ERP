import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * Salón: el departamento sale del PRODUCTO (dueño, 25/11/2026, vía el orquestador; reemplaza DEC-0363 y DEC-0364). Tomar un pedido no pide departamento aunque haya 2 o 3 activos (el hotel: alojamiento,
 * restaurante y cafetería); la cuenta queda sin departamento y cada línea conserva el departamento y el camino de SU producto (0047). Unir ya no bloquea por departamento y dividir no hereda nada: las líneas
 * copiadas mantienen el departamento de cada producto, sin mezclar datos entre departamentos. Dos actores sobre la misma mesa dejan UNA cuenta.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
// El reloj fijo del contexto de ventas es el 09/11/2026 15:00Z.
const ANTES = "2026-11-01T00:00:00Z";

describe.skipIf(base === null)("salón: el departamento sale del producto", () => {
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
  /** Un producto vendible clasificado en un departamento nuevo de la empresa (devuelve ambos). */
  const productoDeUnDepartamento = async (e: EscenarioDeVentas, nombre: string) => {
    const dep = await departamento(e.empresa, nombre);
    const producto = await m.productoVendible(e.empresa, "1000");
    await m.dueno.query(
      "insert into clasificacion_de_producto (empresa_id, producto_id, nodo_id, vigente_desde, cargado_por) values ($1, $2, $3, $4, $5)",
      [e.empresa, producto, dep, ANTES, e.gerente.personaId],
    );
    return { dep, producto };
  };
  /** Una mesa con su cuenta (sin nombrar departamento) y un renglón de 2 unidades de cada producto. */
  const conPedido = async (e: EscenarioDeVentas, productos: readonly string[]) => {
    const cuenta = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: await mesa(e) }),
    ).cuentaId;
    for (const productoId of productos) {
      valorDe(
        await m.salon.agregarAlPedido(e.gerente, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId,
          opcionIds: [],
          cantidad: "2",
        }),
      );
    }
    return cuenta;
  };
  const departamentoDe = async (cuenta: string) =>
    (
      await m.filas<{ d: string | null }>(
        "select departamento_id as d from cuenta_consumo where id = $1",
        [cuenta],
      )
    )[0]?.d;
  /** Los departamentos de las líneas vigentes de las cuentas, ordenados (uno por línea). */
  const departamentosDeLasLineas = async (cuentas: readonly string[]) =>
    (
      await m.filas<{ d: string | null }>(
        "select departamento_id as d from linea_cuenta where cuenta_id = any($1) and estado = 'VIGENTE' order by departamento_id",
        [cuentas],
      )
    ).map((f) => f.d);
  const ordenados = (ids: readonly string[]) => [...ids].sort();

  it("tomar un pedido con 2 y con 3 departamentos activos: no pide elegir y la cuenta queda sin departamento", async () => {
    const e = await m.escenario();
    await departamento(e.empresa, "Alojamiento");
    await departamento(e.empresa, "Restaurante");
    const conDos = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: await mesa(e) }),
    ).cuentaId;
    expect(await departamentoDe(conDos)).toBeNull();
    await departamento(e.empresa, "Cafetería");
    const conTres = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: await mesa(e) }),
    ).cuentaId;
    expect(await departamentoDe(conTres)).toBeNull();
  });

  it("DOS ACTORES: la misma mesa abierta a la vez desde dos pestañas deja UNA cuenta, sin departamento", async () => {
    const e = await m.escenario();
    await departamento(e.empresa, "Alojamiento");
    await departamento(e.empresa, "Restaurante");
    const mesaId = await mesa(e);
    const [x, y] = await Promise.all([
      m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
      m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ]);
    const cuentas = new Set([valorDe(x).cuentaId, valorDe(y).cuentaId]);
    expect(cuentas.size).toBe(1);
    expect(
      await m.contar(
        "select count(*) as n from cuenta_consumo where empresa_id = $1 and estado = 'ABIERTA' and ancla_id = $2",
        [e.empresa, mesaId],
      ),
    ).toBe(1);
    expect(await departamentoDe([...cuentas][0] as string)).toBeNull();
  });

  it("IDEMPOTENCIA: repetir «Tomar pedido» con el mismo id devuelve la misma cuenta y no escribe otra", async () => {
    const e = await m.escenario();
    await departamento(e.empresa, "Alojamiento");
    await departamento(e.empresa, "Restaurante");
    const mesaId = await mesa(e);
    const cuentaId = nuevoId();
    const primera = valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId, mesaId }));
    const segunda = valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId, mesaId }));
    expect(segunda.cuentaId).toBe(primera.cuentaId);
    expect(await m.filas("select 1 from cuenta_consumo where id = $1", [cuentaId])).toHaveLength(1);
  });

  it("una cuenta con líneas de dos departamentos: cada línea conserva el de su producto y la cuenta no tiene departamento", async () => {
    const e = await m.escenario();
    const desayuno = await productoDeUnDepartamento(e, "Alojamiento");
    const plato = await productoDeUnDepartamento(e, "Restaurante");
    const cuenta = await conPedido(e, [desayuno.producto, plato.producto]);
    expect(await departamentoDe(cuenta)).toBeNull();
    expect(await departamentosDeLasLineas([cuenta])).toEqual(ordenados([desayuno.dep, plato.dep]));
  });

  it("unir: cuentas de departamentos distintos se unen (sin DEPARTAMENTO_DISTINTO) y cada línea copiada conserva su departamento; con 3 no se mezclan", async () => {
    const e = await m.escenario();
    const a = await productoDeUnDepartamento(e, "Alojamiento");
    const b = await productoDeUnDepartamento(e, "Restaurante");
    const c = await productoDeUnDepartamento(e, "Cafetería");
    const destino = await conPedido(e, [a.producto, b.producto]);
    const origen = await conPedido(e, [c.producto]);
    const r = valorDe(
      await m.salon.unirMesas(e.gerente, {
        unionId: nuevoId(),
        cuentaDestinoId: destino,
        cuentaOrigenId: origen,
        clave: nuevaClave(),
      }),
    );
    expect(r.lineasMovidas).toBe(1);
    expect(await departamentosDeLasLineas([destino])).toEqual(ordenados([a.dep, b.dep, c.dep]));
    expect(await departamentosDeLasLineas([origen])).toEqual([]);
  });

  it("dividir: las hijas nacen sin departamento y cada línea copiada conserva el de su producto", async () => {
    const e = await m.escenario();
    const a = await productoDeUnDepartamento(e, "Alojamiento");
    const b = await productoDeUnDepartamento(e, "Restaurante");
    const cuenta = await conPedido(e, [a.producto, b.producto]);
    const lineas = await m.filas<{ id: string }>(
      "select id from linea_cuenta where cuenta_id = $1 order by id",
      [cuenta],
    );
    const r = valorDe(
      await m.salon.dividirCuenta(e.gerente, {
        divisionId: nuevoId(),
        cuentaId: cuenta,
        partes: 2,
        asignaciones: lineas.map((l) => ({
          lineaId: l.id,
          forma: "POR_UNIDADES" as const,
          cantidades: ["1", "1"],
        })),
      }),
    );
    expect(r.cuentas).toHaveLength(2);
    const hijas = r.cuentas.map((h) => h.cuentaId);
    for (const hija of hijas) expect(await departamentoDe(hija)).toBeNull();
    // cada hija tiene una línea de cada departamento: los datos no se mezclan ni se pierden
    for (const hija of hijas) {
      expect(await departamentosDeLasLineas([hija])).toEqual(ordenados([a.dep, b.dep]));
    }
  });
});
