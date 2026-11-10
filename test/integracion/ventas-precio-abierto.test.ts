import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

/** Precio abierto (decisión 179): quien vende escribe el importe de un producto sin precio cargado; el servidor manda si hay precio de catálogo. */
describe.skipIf(base === null)("ventas: precio abierto", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let abierto: string;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
    e = await m.escenario();
    abierto = await m.productoVendible(e.empresa, null);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const cuenta = async (contexto = e.gerente) => {
    const id = nuevoId();
    valorDe(await m.casos.abrirCuenta(contexto, { cuentaId: id, sucursalId: e.sucursal }));
    return id;
  };
  const agregar = (
    c: string,
    producto: string,
    extra: Record<string, unknown> = {},
    lineaId = nuevoId(),
    contexto = e.gerente,
  ) =>
    m.casos.agregarLinea(contexto, {
      cuentaId: c,
      lineaId,
      productoId: producto,
      opcionIds: [],
      cantidad: "2",
      ...extra,
    });
  const lineas = (c: string) =>
    m.filas<{
      origen_del_precio: string;
      precio_id: string | null;
      precio_base: string;
      precio_unitario: string;
    }>(
      "select origen_del_precio, precio_id, precio_base::text, precio_unitario::text from linea_cuenta where cuenta_id = $1",
      [c],
    );
  const codigo = (r: { ok: boolean; error?: unknown }) =>
    r.ok ? "ok" : typeof r.error === "string" ? r.error : JSON.stringify(r.error);

  it("se vende con el importe escrito: origen ABIERTO, sin precio de catálogo, total = importe × cantidad, y sale en el ticket", async () => {
    const c = await cuenta();
    const r = valorDe(await agregar(c, abierto, { precioAbierto: "850.50" }));
    expect(r.precioUnitario.monto).toBe("850.500000");
    expect(r.totalProvisorio.monto).toBe("1701.00");
    expect(await lineas(c)).toEqual([
      {
        origen_del_precio: "ABIERTO",
        precio_id: null,
        precio_base: "850.500000",
        precio_unitario: "850.500000",
      },
    ]);
    const t = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: c, ejemplarId: nuevoId() }),
    );
    expect(t.total.monto).toBe("1701.00");
  });

  it("cualquiera de los tres roles puede, y la auditoría deja quién y que fue precio abierto", async () => {
    const c = await cuenta(e.operador);
    const lineaId = nuevoId();
    valorDe(await agregar(c, abierto, { precioAbierto: "10" }, lineaId, e.operador));
    const a = await m.auditoria(e.empresa, "LINEA_AGREGADA");
    const fila = a.find((x) => x["entidad_id"] === lineaId);
    expect(fila?.["actor_persona_id"]).toBe(e.personaDelOperador);
    expect(fila?.["despues"]).toMatchObject({
      origenDelPrecio: "ABIERTO",
      precioUnitario: "10.000000",
    });
  });

  it("sin importe no se vende; con importe inválido, IMPORTE_INVALIDO; no se escribe nada", async () => {
    const c = await cuenta();
    expect(codigo(await agregar(c, abierto))).toBe("PRODUCTO_SIN_PRECIO");
    for (const malo of ["-1", "5,5", "1e3", "abc", "1.234", "", "1000000000"]) {
      expect(codigo(await agregar(c, abierto, { precioAbierto: malo })), malo).toBe(
        "IMPORTE_INVALIDO",
      );
    }
    expect(await lineas(c)).toEqual([]);
  });

  it("un cliente NO puede pisar un precio vigente: con precio de la empresa, el importe enviado se rechaza y la línea no se escribe", async () => {
    const c = await cuenta();
    expect(codigo(await agregar(c, e.producto, { precioAbierto: "1" }))).toBe(
      "PRECIO_ABIERTO_NO_PERMITIDO",
    );
    expect(await lineas(c)).toEqual([]);
    valorDe(await agregar(c, e.producto));
    expect((await lineas(c))[0]).toMatchObject({
      origen_del_precio: "EMPRESA",
      precio_unitario: "1000.000000",
    });
  });

  it("un precio de $0 sigue pidiendo la confirmación de venta a $0", async () => {
    const c = await cuenta();
    const r = await agregar(c, abierto, { precioAbierto: "0" });
    expect(codigo(r)).toContain("CONFIRMACION_REQUERIDA");
    valorDe(await agregar(c, abierto, { precioAbierto: "0.00", confirmaciones: ["VENTA_A_CERO"] }));
  });

  it("idempotencia: el mismo lineaId con el mismo importe devuelve lo hecho; con otro importe, LINEA_ID_EN_USO", async () => {
    const c = await cuenta();
    const lineaId = nuevoId();
    const primera = valorDe(await agregar(c, abierto, { precioAbierto: "99.9" }, lineaId));
    const repetida = valorDe(await agregar(c, abierto, { precioAbierto: "99.90" }, lineaId));
    expect(primera.yaExistia).toBe(false);
    expect(repetida).toMatchObject({ yaExistia: true, posicion: primera.posicion });
    expect(codigo(await agregar(c, abierto, { precioAbierto: "100" }, lineaId))).toBe(
      "LINEA_ID_EN_USO",
    );
    expect(codigo(await agregar(c, abierto, {}, lineaId))).toBe("LINEA_ID_EN_USO");
    expect(await lineas(c)).toHaveLength(1);
  });

  it("cotizarVentaRapida acepta el importe de un producto abierto y rechaza el de uno con precio", async () => {
    const ok = valorDe(
      await m.consultas.cotizarVentaRapida(e.gerente, {
        sucursalId: e.sucursal,
        lineas: [
          { productoId: abierto, opcionIds: [], cantidad: "3", precioAbierto: "10.10" },
          { productoId: e.producto, opcionIds: [], cantidad: "1" },
        ],
      }),
    );
    expect(ok.total.monto).toBe("1030.30");
    const mala = await m.consultas.cotizarVentaRapida(e.gerente, {
      sucursalId: e.sucursal,
      lineas: [{ productoId: e.producto, opcionIds: [], cantidad: "1", precioAbierto: "1" }],
    });
    expect(codigo(mala)).toBe("PRECIO_ABIERTO_NO_PERMITIDO");
  });
});
