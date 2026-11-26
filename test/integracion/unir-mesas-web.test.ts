import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  unirLasMesas,
  type DependenciasDeUnirMesasWeb,
} from "../../src/composicion/unir-mesas-web";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * «Unir con otra mesa» de la web (`unir-mesas-web.ts`, SAL-E1) contra una base real y los roles reales: los ítems pasan sin recotizar y el total del destino es la suma al centavo (con centavos), repetir la misma
 * unión no duplica, dos mozos uniendo A→B y B→A a la vez dejan UNA unión sin deadlock, las dos cuentas tienen que ser de la sucursal de trabajo y los motivos de «No se pueden unir» salen con su texto aprobado.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = { ok: false, error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" } };
const codigo = (r: { ok: boolean; error?: { codigo: string } }) => (r.ok ? null : r.error?.codigo);

describe.skipIf(base === null)("composición web: unir mesas", () => {
  let m: MundoDeSalon;
  let d: DependenciasDeUnirMesasWeb;
  const proxima = new Map<string, number>();
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    d = {
      casosDeUso: () => m.salon,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  /** Una mesa con cuenta y, por cada cantidad, una línea del producto de $ 1000 (sin enviar: unir no lo exige). */
  const mesa = async (
    e: EscenarioDeVentas,
    cantidades: readonly string[],
    productoId = e.producto,
  ) => {
    const n = (proxima.get(e.empresa) ?? 0) + 1;
    proxima.set(e.empresa, n);
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
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    for (const cantidad of cantidades) {
      valorDe(
        await m.salon.agregarAlPedido(e.gerente, {
          cuentaId,
          lineaId: nuevoId(),
          productoId,
          opcionIds: [],
          cantidad,
        }),
      );
    }
    return { mesaId, cuentaId };
  };
  const unir = (
    e: EscenarioDeVentas,
    destino: string,
    origen: string,
    extra: Record<string, unknown> = {},
    sucursal: string = e.sucursal,
  ) =>
    unirLasMesas(d, e.gerente, sucursal, {
      unionId: nuevoId(),
      cuentaDestinoId: destino,
      cuentaOrigenId: origen,
      clave: nuevaClave(),
      ...extra,
    });
  const vigentes = async (cuentaId: string) =>
    m.contar("select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'", [
      cuentaId,
    ]);

  it("une sin recotizar: el total del destino es la suma al centavo (precio con centavos), el origen queda de reserva vacía y la mesa unida", async () => {
    const e = await m.escenario();
    const precio = await m.productoVendible(e.empresa, "333.33");
    const destino = await mesa(e, ["2"], precio);
    const origen = await mesa(e, ["1"], precio);
    const r = await unir(e, destino.cuentaId, origen.cuentaId);
    expect(r).toMatchObject({
      ok: true,
      dato: {
        lineasMovidas: 1,
        totalDestino: { moneda: "ARS", monto: "999.99" },
        yaExistia: false,
      },
    });
    expect(await vigentes(origen.cuentaId)).toBe(0);
    expect(await vigentes(destino.cuentaId)).toBe(2);
    const mapa = valorDe(
      await m.consultasDeSalon.mapaDeMesas(e.gerente, { sucursalId: e.sucursal, filtro: "TODAS" }),
    );
    expect(mapa.find((x) => x.mesaId === origen.mesaId)?.estado).toBe("UNIDA");
  });

  it("IDEMPOTENCIA: repetir la misma unión devuelve yaExistia y los ítems pasan una sola vez; el mismo unionId con otras cuentas no pisa", async () => {
    const e = await m.escenario();
    const destino = await mesa(e, ["1"]);
    const origen = await mesa(e, ["2"]);
    const otra = await mesa(e, ["1"]);
    const pedido = { unionId: nuevoId(), clave: nuevaClave() };
    const primera = await unir(e, destino.cuentaId, origen.cuentaId, pedido);
    const segunda = await unir(e, destino.cuentaId, origen.cuentaId, pedido);
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true, lineasMovidas: 0 } });
    expect(await vigentes(destino.cuentaId)).toBe(2);
    expect(await unir(e, destino.cuentaId, otra.cuentaId, pedido)).toMatchObject(GENERICO);
    expect(await vigentes(otra.cuentaId)).toBe(1);
  });

  it("DOS ACTORES: unir A→B y B→A a la vez deja UNA unión (sin deadlock); cada ítem queda en una sola cuenta", async () => {
    const e = await m.escenario();
    const a = await mesa(e, ["1"]);
    const b = await mesa(e, ["2"]);
    const [x, y] = await Promise.all([
      unir(e, b.cuentaId, a.cuentaId),
      unir(e, a.cuentaId, b.cuentaId),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect((await vigentes(a.cuentaId)) + (await vigentes(b.cuentaId))).toBe(2);
    expect(
      await m.contar("select count(*) as n from union_de_mesas where empresa_id = $1", [e.empresa]),
    ).toBe(1);
  });

  it("AISLAMIENTO: una cuenta de otra sucursal o de otra empresa, o sin sucursal de trabajo, es el genérico y no mueve nada", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const a = await mesa(e, ["1"]);
    const b = await mesa(e, ["1"]);
    const ajena = await mesa(otra, ["1"]);
    expect(await unir(e, a.cuentaId, b.cuentaId, {}, e.otraSucursal)).toMatchObject(GENERICO);
    expect(await unir(e, a.cuentaId, b.cuentaId, {}, "")).toMatchObject(GENERICO);
    expect(await unir(e, a.cuentaId, ajena.cuentaId)).toMatchObject(GENERICO);
    expect(await unir(e, ajena.cuentaId, a.cuentaId)).toMatchObject(GENERICO);
    expect(await vigentes(a.cuentaId)).toBe(1);
    expect(await vigentes(b.cuentaId)).toBe(1);
    expect(await vigentes(ajena.cuentaId)).toBe(1);
  });

  it("los motivos de «No se pueden unir»: mesa libre tiene texto propio; mesa unida o la misma cuenta, «No se pueden unir» sin motivo (con cobro: `salon-union.test.ts`)", async () => {
    const e = await m.escenario();
    const a = await mesa(e, ["1"]);
    const libre = await mesa(e, []);
    expect(codigo(await unir(e, a.cuentaId, libre.cuentaId))).toBe("SALON_UNIR_MESA_LIBRE");
    expect(codigo(await unir(e, a.cuentaId, a.cuentaId))).toBe("SALON_UNIR_NO_SE_PUEDEN_UNIR");
    const b = await mesa(e, ["1"]);
    valorDe(
      await m.salon.unirMesas(e.gerente, {
        sucursalDeTrabajo: e.sucursal,
        unionId: nuevoId(),
        cuentaDestinoId: a.cuentaId,
        cuentaOrigenId: b.cuentaId,
        clave: nuevaClave(),
      }),
    );
    const c = await mesa(e, ["1"]);
    // b ya está unida (reserva): no se une como origen ni destino.
    expect(codigo(await unir(e, c.cuentaId, b.cuentaId))).toBe("SALON_UNIR_NO_SE_PUEDEN_UNIR");
  });

  it("PERMISOS Y FORMA: sin persona no se une; ids o clave mal formados son el genérico; no se escribe nada", async () => {
    const e = await m.escenario();
    const a = await mesa(e, ["1"]);
    const b = await mesa(e, ["1"]);
    expect(
      (
        await unirLasMesas(d, { ...e.gerente, personaId: null }, e.sucursal, {
          unionId: nuevoId(),
          cuentaDestinoId: a.cuentaId,
          cuentaOrigenId: b.cuentaId,
          clave: nuevaClave(),
        })
      ).ok,
    ).toBe(false);
    expect(await unir(e, "no-es-un-id", b.cuentaId)).toMatchObject(GENERICO);
    expect(await unir(e, a.cuentaId, b.cuentaId, { clave: "corta" })).toMatchObject(GENERICO);
    expect(await vigentes(b.cuentaId)).toBe(1);
  });
});
