import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * Carta real T8, salón: el pedido de una mesa no carga una línea NUEVA de un producto oculto (`PRODUCTO_OCULTO`), pero lo que ya estaba cargado sigue su camino: unir mesas y
 * dividir la cuenta copian las líneas SIN volver a cotizar (precio congelado), aunque el producto se haya ocultado después.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("salón: un producto oculto (carta real T8)", () => {
  let m: MundoDeSalon;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  let proxima = 0;
  const ocultar = (e: EscenarioDeVentas, producto: string) =>
    m.dueno.query(
      "insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_por, actualizado_en) values ($1, $2, null, true, null, now())",
      [e.empresa, producto],
    );
  const mesaConCuenta = async (e: EscenarioDeVentas) => {
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
    return valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId })).cuentaId;
  };
  const agregar = (e: EscenarioDeVentas, cuenta: string, producto: string, cantidad = "2") =>
    m.salon.agregarAlPedido(e.gerente, {
      cuentaId: cuenta,
      lineaId: nuevoId(),
      productoId: producto,
      opcionIds: [],
      cantidad,
    });
  const vigentes = async (cuenta: string) =>
    Number(
      (
        await m.filas<{ n: string }>(
          "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
          [cuenta],
        )
      )[0]?.n,
    );

  it("agregar al pedido de una mesa un producto oculto se rechaza y no deja nada", async () => {
    const e = await m.escenario();
    const cuenta = await mesaConCuenta(e);
    await ocultar(e, e.producto);
    expect(await agregar(e, cuenta, e.producto)).toEqual({ ok: false, error: "PRODUCTO_OCULTO" });
    expect(await vigentes(cuenta)).toBe(0);
    const otro = await m.productoVendible(e.empresa, "300");
    valorDe(await agregar(e, cuenta, otro));
    expect(await vigentes(cuenta)).toBe(1);
  });

  it("unir mesas con un producto ocultado después sigue funcionando: las líneas pasan con su precio", async () => {
    const e = await m.escenario();
    const destino = await mesaConCuenta(e);
    const origen = await mesaConCuenta(e);
    // La mesa de destino ya tiene su pedido (unir con una mesa libre se rechaza): otro producto, que no se oculta.
    valorDe(await agregar(e, destino, await m.productoVendible(e.empresa, "300")));
    valorDe(await agregar(e, origen, e.producto));
    await ocultar(e, e.producto);
    const r = valorDe(
      await m.salon.unirMesas(e.gerente, {
        unionId: nuevoId(),
        cuentaDestinoId: destino,
        cuentaOrigenId: origen,
        clave: nuevaClave(),
      }),
    );
    expect(r.lineasMovidas).toBe(1);
    expect(await vigentes(destino)).toBe(2);
    expect(await vigentes(origen)).toBe(0);
  });

  it("dividir una cuenta con un producto ocultado después sigue funcionando: cada parte recibe lo suyo", async () => {
    const e = await m.escenario();
    const cuenta = await mesaConCuenta(e);
    valorDe(await agregar(e, cuenta, e.producto));
    await ocultar(e, e.producto);
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
    expect(await vigentes(cuenta)).toBe(0);
  });
});
