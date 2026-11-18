import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cambiarDeMesaLaCuenta,
  liberarLaMesa,
  tomarElPedido,
  verElMapaDeMesas,
  verLaFichaDeLaMesa,
  type DependenciasDeCuentaDeMesaWeb,
} from "../../src/composicion/cuenta-de-mesa-web";
import { agotadaSegunElRegistro, repetirSiAgotada } from "./concurrencia-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * La cuenta de mesa de la web (`cuenta-de-mesa-web.ts`, S-0r) contra una base real y los roles reales: el mapa y la ficha con lo declarado y nada más, «Tomar pedido» repetido o desde dos pestañas a la vez
 * (una sola cuenta), «Liberar mesa» y «Cambiar de mesa» repetidos sin escribir de más, la sucursal que fija el servidor (vacía cierra; una mesa o cuenta de otra sucursal o empresa no existe), el permiso que
 * decide el servidor (operador sin permiso de ventas ajeno, perilla del plan apagada) y que todo error del negocio sale como el genérico.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";
const codigo = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? null : (r.error?.codigo ?? null);

describe.skipIf(base === null)("cuenta de mesa de la web", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  let registrados: string[];
  let d: DependenciasDeCuentaDeMesaWeb;
  let proxima = 0;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    e = await m.escenario();
    registrados = [];
    d = {
      casosDeUso: () => m.salon,
      consultas: () => m.consultasDeSalon,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const mesa = async (escenario = e) => {
    const n = ++proxima;
    const id = nuevoId();
    valorDe(
      await m.salon.crearMesa(escenario.gerente, {
        mesaId: id,
        sucursalId: escenario.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    return id;
  };
  const tomar = (mesaId: string, cuentaId = nuevoId(), escenario = e, contexto = e.gerente) =>
    tomarElPedido(d, contexto, escenario.sucursal, { cuentaId, mesaId });
  /** Quien pierde una carrera puede recibir el agotamiento del motor (reintentar con el mismo pedido es seguro): se repite y se juzga el resultado de negocio. */
  const repetir = <R extends { ok: boolean; error?: { codigo?: unknown } }>(
    trabajo: () => Promise<R>,
  ) => repetirSiAgotada(trabajo, { esAgotada: agotadaSegunElRegistro(registrados) });
  const cuentas = (mesaId: string) =>
    m.contar("select count(*) as n from cuenta_consumo where ancla_id = $1", [mesaId]);

  it("el mapa trae solo lo declarado, con el filtro pedido, y la ficha la cuenta con sus líneas", async () => {
    const libre = await mesa();
    const conPedido = await mesa();
    const cuenta = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: conPedido }),
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
    const mapa = await verElMapaDeMesas(d, e.gerente, e.sucursal);
    expect(mapa).toMatchObject({ ok: true });
    if (!mapa.ok) return;
    const dellibre = mapa.dato.mesas.find((x) => x.mesaId === libre);
    expect(dellibre).toMatchObject({ estado: "LIBRE" });
    expect(Object.keys(dellibre ?? {}).sort()).toEqual(
      ["columna", "estado", "fila", "forma", "mesaId", "numero", "tamano"].sort(),
    );
    const delpedido = mapa.dato.mesas.find((x) => x.mesaId === conPedido);
    expect(delpedido).toMatchObject({
      estado: "EN_PEDIDO",
      cuentaId: cuenta,
      total: { moneda: "ARS", monto: "2000.00" },
    });
    const libres = await verElMapaDeMesas(d, e.gerente, e.sucursal, { filtro: "LIBRES" });
    expect(libres.ok && libres.dato.mesas.some((x) => x.mesaId === conPedido)).toBe(false);
    expect(libres.ok && libres.dato.mesas.some((x) => x.mesaId === libre)).toBe(true);
    const ficha = await verLaFichaDeLaMesa(d, e.gerente, e.sucursal, { mesaId: conPedido });
    expect(ficha).toMatchObject({ ok: true, dato: { mesaId: conPedido, estado: "EN_PEDIDO" } });
    if (!ficha.ok) return;
    expect(ficha.dato.cuentas[0]?.lineas).toHaveLength(1);
    expect(Object.keys(ficha.dato.cuentas[0]?.lineas[0] ?? {}).sort()).toEqual(
      [
        "cantidad",
        "comanda",
        "compartida",
        "deLaMesa",
        "descripcion",
        "importe",
        "lineaId",
        "numeroDeEnvio",
        "posicion",
        "precioUnitario",
        "varianteNombre",
      ].sort(),
    );
  });

  it("un filtro fuera del conjunto, o un pedido mal formado, es el genérico", async () => {
    expect(codigo(await verElMapaDeMesas(d, e.gerente, e.sucursal, { filtro: "TODO" }))).toBe(
      GENERICO,
    );
    expect(
      codigo(await verLaFichaDeLaMesa(d, e.gerente, e.sucursal, { mesaId: "no-es-un-id" })),
    ).toBe(GENERICO);
    expect(codigo(await tomar("no-es-un-id"))).toBe(GENERICO);
  });

  it("IDEMPOTENCIA: «Tomar pedido» dos veces con el mismo id es una sola cuenta (yaExistia) y audita una vez", async () => {
    const id = await mesa();
    const cuentaId = nuevoId();
    const primera = await tomar(id, cuentaId);
    const segunda = await tomar(id, cuentaId);
    expect(primera).toMatchObject({ ok: true, dato: { cuentaId, yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { cuentaId, yaExistia: true } });
    expect(await cuentas(id)).toBe(1);
    const auditadas = (await m.auditoria(e.empresa, "PEDIDO_TOMADO")).filter(
      (a) => a["entidad_id"] === cuentaId,
    );
    expect(auditadas).toHaveLength(1);
  });

  it("CONCURRENCIA: «Tomar pedido» en la misma mesa desde dos pestañas (ids distintos) deja UNA sola cuenta y las dos reciben la misma", async () => {
    const id = await mesa();
    const [cuentaA, cuentaB] = [nuevoId(), nuevoId()];
    const [a, b] = await Promise.all([
      repetir(() => tomar(id, cuentaA, e, e.gerente)),
      repetir(() => tomar(id, cuentaB, e, e.administrador)),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    if (!a.ok || !b.ok) return;
    expect(a.dato.cuentaId).toBe(b.dato.cuentaId);
    expect([a.dato.yaExistia, b.dato.yaExistia].filter(Boolean)).toHaveLength(1);
    expect(
      await m.contar(
        "select count(*) as n from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
        [id],
      ),
    ).toBe(1);
  });

  it("IDEMPOTENCIA: liberar la mesa dos veces anula la cuenta una vez (yaEstabaLibre)", async () => {
    const id = await mesa();
    const cuentaId = nuevoId();
    await tomar(id, cuentaId);
    const primera = await liberarLaMesa(d, e.gerente, e.sucursal, { cuentaId });
    const segunda = await liberarLaMesa(d, e.gerente, e.sucursal, { cuentaId });
    expect(primera).toMatchObject({ ok: true, dato: { yaEstabaLibre: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaEstabaLibre: true } });
    const mapa = await verElMapaDeMesas(d, e.gerente, e.sucursal);
    expect(mapa.ok && mapa.dato.mesas.find((x) => x.mesaId === id)?.estado).toBe("LIBRE");
    // Con una cuenta que tiene un plato no se libera: el genérico, y la cuenta sigue.
    const ocupada = await mesa();
    const cuenta2 = nuevoId();
    await tomar(ocupada, cuenta2);
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId: cuenta2,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    expect(codigo(await liberarLaMesa(d, e.gerente, e.sucursal, { cuentaId: cuenta2 }))).toBe(
      GENERICO,
    );
    expect(
      await m.contar(
        "select count(*) as n from cuenta_consumo where id = $1 and estado = 'ABIERTA'",
        [cuenta2],
      ),
    ).toBe(1);
  });

  it("«Cambiar de mesa» mueve la cuenta entera, repetido no escribe de más y un destino ocupado es el genérico", async () => {
    const origen = await mesa();
    const destino = await mesa();
    const ocupada = await mesa();
    const cuentaId = nuevoId();
    await tomar(origen, cuentaId);
    await tomar(ocupada);
    const cambiar = (mesaDestinoId: string) =>
      cambiarDeMesaLaCuenta(d, e.gerente, e.sucursal, { cuentaId, mesaDestinoId });
    expect(codigo(await cambiar(ocupada))).toBe(GENERICO);
    expect(await cambiar(destino)).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(await cambiar(destino)).toMatchObject({ ok: true, dato: { yaExistia: true } });
    const mapa = await verElMapaDeMesas(d, e.gerente, e.sucursal);
    expect(mapa.ok && mapa.dato.mesas.find((x) => x.mesaId === destino)?.cuentaId).toBe(cuentaId);
    expect(mapa.ok && mapa.dato.mesas.find((x) => x.mesaId === origen)?.estado).toBe("LIBRE");
  });

  it("CONCURRENCIA: dos cuentas que pasan a la misma mesa libre a la vez: una sola entra, la otra recibe el genérico", async () => {
    const destino = await mesa();
    const c1 = nuevoId();
    const c2 = nuevoId();
    await tomar(await mesa(), c1);
    await tomar(await mesa(), c2);
    const [x, y] = await Promise.all([
      repetir(() =>
        cambiarDeMesaLaCuenta(d, e.gerente, e.sucursal, { cuentaId: c1, mesaDestinoId: destino }),
      ),
      repetir(() =>
        cambiarDeMesaLaCuenta(d, e.administrador, e.sucursal, {
          cuentaId: c2,
          mesaDestinoId: destino,
        }),
      ),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(codigo(x.ok ? y : x)).toBe(GENERICO);
    expect(
      await m.contar(
        "select count(*) as n from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
        [destino],
      ),
    ).toBe(1);
  });

  it("SUCURSAL: la fija el servidor; vacía cierra y una mesa o cuenta de otra sucursal no existe", async () => {
    const id = await mesa();
    const cuentaId = nuevoId();
    await tomar(id, cuentaId);
    expect(codigo(await verElMapaDeMesas(d, e.gerente, ""))).toBe(GENERICO);
    expect(codigo(await tomarElPedido(d, e.gerente, "", { cuentaId: nuevoId(), mesaId: id }))).toBe(
      GENERICO,
    );
    // Desde la otra sucursal de la misma empresa: ni la mesa ni la cuenta son suyas.
    const otra = e.otraSucursal;
    expect(codigo(await verLaFichaDeLaMesa(d, e.gerente, otra, { mesaId: id }))).toBe(GENERICO);
    expect(
      codigo(await tomarElPedido(d, e.gerente, otra, { cuentaId: nuevoId(), mesaId: id })),
    ).toBe(GENERICO);
    const destino = await mesa();
    expect(
      codigo(await cambiarDeMesaLaCuenta(d, e.gerente, otra, { cuentaId, mesaDestinoId: destino })),
    ).toBe(GENERICO);
    const mapaOtra = await verElMapaDeMesas(d, e.gerente, otra);
    expect(mapaOtra.ok && mapaOtra.dato.mesas.some((x) => x.mesaId === id)).toBe(false);
  });

  it("AISLAMIENTO: lo de otra empresa no se ve ni se toca", async () => {
    const otra = await m.escenario();
    const ajena = await mesa(otra);
    const cuentaAjena = valorDe(
      await m.salon.tomarPedido(otra.gerente, { cuentaId: nuevoId(), mesaId: ajena }),
    ).cuentaId;
    expect(codigo(await verLaFichaDeLaMesa(d, e.gerente, e.sucursal, { mesaId: ajena }))).toBe(
      GENERICO,
    );
    expect(
      codigo(await verLaFichaDeLaMesa(d, e.gerente, otra.sucursal, { mesaId: ajena })),
    ).not.toBeNull();
    expect(codigo(await tomar(ajena))).toBe(GENERICO);
    expect(
      codigo(
        await cambiarDeMesaLaCuenta(d, e.gerente, e.sucursal, {
          cuentaId: cuentaAjena,
          mesaDestinoId: await mesa(),
        }),
      ),
    ).toBe(GENERICO);
    // Liberar la cuenta de otra empresa: el caso de uso no la encuentra (el genérico) y la cuenta sigue abierta.
    expect(
      codigo(await liberarLaMesa(d, e.gerente, e.sucursal, { cuentaId: cuentaAjena })),
    ).not.toBeNull();
    expect(
      await m.contar(
        "select count(*) as n from cuenta_consumo where id = $1 and estado = 'ABIERTA'",
        [cuentaAjena],
      ),
    ).toBe(1);
  });

  it("PERMISOS: sin la perilla `salon` del plan no se lee ni se escribe nada, y el operador (con los permisos de ventas) sí opera", async () => {
    const id = await mesa();
    m.perillaSalon(false);
    try {
      const mapa = await verElMapaDeMesas(d, e.gerente, e.sucursal);
      expect(mapa.ok).toBe(false);
      const antes = await cuentas(id);
      expect((await tomar(id)).ok).toBe(false);
      expect(await cuentas(id)).toBe(antes);
    } finally {
      m.perillaSalon(true);
    }
    expect(await tomar(id, nuevoId(), e, e.operador)).toMatchObject({ ok: true });
    // Una persona sin sesión (sin `personaId`) no puede escribir.
    expect((await tomar(await mesa(), nuevoId(), e, { ...e.gerente, personaId: null })).ok).toBe(
      false,
    );
  });
});
