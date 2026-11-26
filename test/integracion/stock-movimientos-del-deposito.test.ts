import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * STK-B1, «Movimientos»: el libro de un depósito (`movimientosDelDeposito`) contra la base real y los roles reales. Una tarjeta por renglón, del más nuevo al más viejo; la cantidad con
 * signo como texto decimal exacto; `anulable` lo decide el servidor; la paginación por cursor no duplica ni salta filas aunque entren movimientos mientras se pagina; el alcance de sucursales
 * y la empresa se respetan (lo ajeno es indistinguible de lo que no existe) y la lectura nunca trae costos ni la clave de idempotencia.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: movimientos de un depósito", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const nuevo = async (sucursal: Parameters<MontajeDeStock["deposito"]>[0] = e) => ({
    dep: await c.deposito(sucursal),
    ...(await c.articulo(e)),
  });
  const entrar = (producto: string, deposito: string, cantidad: string, extra = {}) =>
    c.casos.registrarEntrada(e.gerente, {
      clave: nuevoId(),
      depositoId: deposito,
      motivo: "COMPRA",
      renglones: [{ productoId: producto, cantidad, unidadId: "UNIDAD" }],
      ...extra,
    });
  const salir = (producto: string, deposito: string, cantidad: string) =>
    c.casos.registrarSalida(e.gerente, {
      clave: nuevoId(),
      depositoId: deposito,
      motivo: "MERMA",
      renglones: [{ productoId: producto, cantidad, unidadId: "UNIDAD" }],
    });
  const pagina = async (
    deposito: string,
    quien = e.gerente,
    despuesDe: Parameters<
      MontajeDeStock["consultas"]["movimientosDelDeposito"]
    >[1]["despuesDe"] = undefined,
  ) =>
    valorDe(await c.consultas.movimientosDelDeposito(quien, { depositoId: deposito, despuesDe }));

  it("una tarjeta por renglón, con el artículo, la clase, el motivo y la cantidad con signo como texto exacto", async () => {
    const a = await nuevo();
    valorDe(await entrar(a.producto, a.dep, "5.5"));
    valorDe(await salir(a.producto, a.dep, "1.25"));
    const { movimientos, siguiente } = await pagina(a.dep);
    expect(siguiente).toBeNull();
    // Dos movimientos con el mismo instante (el reloj de la prueba no avanza) se desempatan por identificador: el orden entre ellos es estable pero no se afirma.
    expect(movimientos.map((m) => [m.clase, m.motivo, m.cantidad, m.unidadId]).sort()).toEqual([
      ["ENTRADA", "COMPRA", "5.5000", "UNIDAD"],
      ["SALIDA", "MERMA", "-1.2500", "UNIDAD"],
    ]);
    expect(movimientos.every((m) => typeof m.cantidad === "string")).toBe(true);
    expect(movimientos.every((m) => m.registradoPor === e.personaDelGerente)).toBe(true);
    expect(movimientos.every((m) => m.articuloId === a.articulo)).toBe(true);
  });

  it("anulable es verdadero solo para un movimiento manual no anulado; la anulación y lo anulado no se anulan", async () => {
    const a = await nuevo();
    const original = valorDe(await entrar(a.producto, a.dep, "3"));
    expect((await pagina(a.dep)).movimientos[0]).toMatchObject({
      anulable: true,
      anulado: false,
      esAnulacion: false,
    });
    valorDe(
      await c.casos.anularMovimiento(e.gerente, {
        clave: nuevoId(),
        movimientoId: original.movimientoId,
        detalle: "Error de carga",
      }),
    );
    const { movimientos } = await pagina(a.dep);
    const anulacion = movimientos.find((m) => m.clase === "ANULACION");
    const anulado = movimientos.find((m) => m.clase === "ENTRADA");
    expect(anulacion).toMatchObject({ anulable: false, esAnulacion: true, cantidad: "-3.0000" });
    expect(anulado).toMatchObject({ anulable: false, anulado: true, esAnulacion: false });
  });

  it("una transferencia aparece en los dos depósitos, cada uno con su renglón", async () => {
    const origen = await nuevo();
    const destino = await c.deposito(e);
    valorDe(await entrar(origen.producto, origen.dep, "4"));
    valorDe(
      await c.casos.transferir(e.gerente, {
        clave: nuevoId(),
        origenId: origen.dep,
        destinoId: destino,
        renglones: [{ productoId: origen.producto, cantidad: "1", unidadId: "UNIDAD" }],
      }),
    );
    expect(
      (await pagina(origen.dep)).movimientos.find((m) => m.clase === "TRANSFERENCIA"),
    ).toMatchObject({
      clase: "TRANSFERENCIA",
      cantidad: "-1.0000",
    });
    expect((await pagina(destino)).movimientos).toHaveLength(1);
    expect((await pagina(destino)).movimientos[0]).toMatchObject({
      clase: "TRANSFERENCIA",
      cantidad: "1.0000",
    });
  });

  it("pagina de a 50 por cursor sin duplicar ni saltar filas, aunque entre un movimiento mientras se pagina", async () => {
    const a = await nuevo();
    for (let i = 0; i < 60; i += 1) valorDe(await entrar(a.producto, a.dep, "1"));
    const primera = await pagina(a.dep);
    expect(primera.movimientos).toHaveLength(50);
    expect(primera.siguiente).not.toBeNull();
    const originales = primera.movimientos.map((m) => `${m.movimientoId}:${String(m.numero)}`);
    // Entra un movimiento nuevo después de haber leído la primera página (el reloj de la prueba no avanza, así que puede caer a un lado u otro del cursor).
    valorDe(await entrar(a.producto, a.dep, "2"));
    const segunda = await pagina(a.dep, e.gerente, primera.siguiente ?? undefined);
    const claves = [...primera.movimientos, ...segunda.movimientos].map(
      (m) => `${m.movimientoId}:${String(m.numero)}`,
    );
    expect(new Set(claves).size).toBe(claves.length);
    expect(originales.every((k) => claves.includes(k))).toBe(true);
    expect(segunda.movimientos.length).toBeGreaterThanOrEqual(10);
    expect(segunda.movimientos.length).toBeLessThanOrEqual(11);
    expect(segunda.siguiente).toBeNull();
  });

  it("el operador ve los depósitos de su sucursal y no los de otra; el administrador de una sola sucursal, igual", async () => {
    const propio = await nuevo();
    const ajeno = await nuevo({ ...e, sucursal: e.otraSucursal });
    valorDe(await entrar(propio.producto, propio.dep, "1"));
    valorDe(await entrar(ajeno.producto, ajeno.dep, "1"));
    expect((await pagina(propio.dep, e.operador)).movimientos).toHaveLength(1);
    expect((await pagina(ajeno.dep, e.operador)).movimientos).toEqual([]);
    expect((await pagina(ajeno.dep, e.administradorDeUnaSucursal)).movimientos).toEqual([]);
    expect((await pagina(ajeno.dep, e.gerente)).movimientos).toHaveLength(1);
  });

  it("la empresa B no ve los movimientos de un depósito de la A: es indistinguible de uno que no existe", async () => {
    const a = await nuevo();
    valorDe(await entrar(a.producto, a.dep, "1"));
    const b = await c.escenario();
    expect((await pagina(a.dep, b.gerente)).movimientos).toEqual([]);
  });

  it.each([
    ["un depósito que no existe", () => nuevoId()],
    ["un identificador que no es un UUID", () => "no-es-un-uuid"],
  ])("%s da una página vacía", async (_caso, id) => {
    expect(await pagina(id())).toEqual({ movimientos: [], siguiente: null });
  });

  it("un cursor roto da una página vacía: nada se adivina", async () => {
    const a = await nuevo();
    valorDe(await entrar(a.producto, a.dep, "1"));
    for (const cursor of [
      { hechoEn: "ayer", movimientoId: nuevoId(), numero: 1 },
      { hechoEn: new Date().toISOString(), movimientoId: "x", numero: 1 },
      { hechoEn: new Date().toISOString(), movimientoId: nuevoId(), numero: 0 },
    ]) {
      expect(await pagina(a.dep, e.gerente, cursor)).toEqual({ movimientos: [], siguiente: null });
    }
  });

  it("cada renglón trae solo lo que la tarjeta muestra: ni costos ni la clave de idempotencia", async () => {
    const a = await nuevo();
    valorDe(
      await entrar(a.producto, a.dep, "2", {
        renglones: [
          { productoId: a.producto, cantidad: "2", unidadId: "UNIDAD", costoUnitario: "10.5" },
        ],
      }),
    );
    const [m] = (await pagina(a.dep, e.operador)).movimientos;
    expect(Object.keys(m ?? {}).sort()).toEqual([
      "anulable",
      "anulado",
      "articuloId",
      "cantidad",
      "clase",
      "esAnulacion",
      "hechoEn",
      "motivo",
      "movimientoId",
      "nombre",
      "numero",
      "registradoPor",
      "unidadId",
    ]);
  });

  it("con el módulo apagado no se lee nada: MODULO_NO_ACTIVO", async () => {
    const a = await nuevo();
    c.apagarModulo("stock");
    try {
      const r = await c.consultas.movimientosDelDeposito(e.gerente, { depositoId: a.dep });
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toBe("MODULO_NO_ACTIVO");
    } finally {
      c.encenderModulos();
    }
  });

  it("articulosControlados: solo los activos, por nombre, con la unidad de stock; el operador los ve; otra empresa no ve los ajenos; sin costos", async () => {
    const a = await c.articulo(e);
    const baja = await c.articulo(e, { activo: false });
    const ids = (r: Awaited<ReturnType<typeof c.consultas.articulosControlados>>) =>
      valorDe(r).map((x) => x.articuloId);
    const mios = valorDe(await c.consultas.articulosControlados(e.operador));
    expect(mios.map((x) => x.articuloId)).toContain(a.articulo);
    expect(mios.map((x) => x.articuloId)).not.toContain(baja.articulo);
    const nombres = mios.map((x) => x.nombre.toLowerCase());
    expect(nombres).toEqual([...nombres].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    const fila = mios.find((x) => x.articuloId === a.articulo);
    expect(Object.keys(fila ?? {}).sort()).toEqual([
      "articuloId",
      "nombre",
      "productoId",
      "unidadId",
    ]);
    expect(fila).toMatchObject({ productoId: a.producto, unidadId: "UNIDAD" });
    const otra = await c.escenario();
    expect(ids(await c.consultas.articulosControlados(otra.gerente))).not.toContain(a.articulo);
  });
});
