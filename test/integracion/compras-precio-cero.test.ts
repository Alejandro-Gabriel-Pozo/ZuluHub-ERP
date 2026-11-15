import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { leerPrecioPositivo } from "../../src/modulos/compras/dominio/decimal";
import { codigoDe } from "./concurrencia-apoyo";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * D8 (auditoría de reglas, INTEGRACION §5): una línea de factura del proveedor a precio cero. Decisión del dueño (14/11/2026): no se carga. El dominio ya la rechazaba
 * (`leerPrecioPositivo`); la base la admitía (`precio_neto >= 0`, 0037). Previene: una línea a cero escrita por otro camino que el caso de uso, que haría un costo cero en la
 * entrada de stock (CYN 125: «sin costo, nunca cero»).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ARCHIVO = "0054_precio_de_linea_de_factura_mayor_que_cero.sql";
const REVERSION = "0054_revertir_precio_de_linea_de_factura_mayor_que_cero.sql";

describe.skipIf(base === null)("compras: la línea de factura a precio cero no entra (D8)", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    return { e, deposito, producto, proveedor };
  };
  type M = Awaited<ReturnType<typeof armar>>;
  const compra = (m: M, precioNeto: string, numero = 100, clave = nuevoId()) => ({
    clave,
    sucursalId: m.e.sucursal,
    proveedorId: m.proveedor,
    depositoId: m.deposito,
    renglones: [
      {
        productoId: m.producto,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000",
      },
    ],
    factura: {
      tipo: "FACTURA_A",
      puntoDeVenta: 5,
      numero,
      fecha: "2026-10-10",
      lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto, alicuota: "21" }],
      totalSegunFactura: "2420.00",
      cuitDelProveedor: cuitUnico(),
    },
  });
  const lineasDe = (comprobanteId: string) =>
    c.filas<{ numero: number; precio_neto: string }>(
      "select numero, precio_neto::text as precio_neto from linea_de_comprobante where comprobante_id = $1 order by numero",
      [comprobanteId],
    );
  /** Una línea de más en un comprobante que ya existe, con el disparador de «misma transacción» apagado SOLO dentro de la transacción de la prueba (para aislar la restricción de precio). */
  const insertarLinea = (comprobanteId: string, empresaId: string, precio: string) =>
    c.dueno.query(
      `insert into linea_de_comprobante (empresa_id, comprobante_id, numero, descripcion, unidad, cantidad_facturada, precio_neto, alicuota, neto_de_linea, iva_de_linea)
       values ($1, $2, 99, 'Linea de prueba', 'g', 1, ${precio}, '21', 0, 0)`,
      [empresaId, comprobanteId],
    );
  const apagarCabecera = () =>
    c.dueno.query("alter table linea_de_comprobante disable trigger linea_de_comprobante_cabecera");

  it("el caso de uso rechaza la línea a precio cero y no deja nada escrito (la repetición tampoco)", async () => {
    const m = await armar();
    const clave = nuevoId();
    const antes = await c.contar(
      "select count(*) from comprobante_de_proveedor where empresa_id = $1",
      [m.e.empresa],
    );
    for (let i = 0; i < 2; i++) {
      const r = await c.casos.registrarCompraConFactura(m.e.operador, compra(m, "0", 100, clave));
      expect(r.ok).toBe(false);
      expect(codigoDe(r)).toMatch(/PRECIO_INVALIDO/);
    }
    expect(
      await c.contar("select count(*) from comprobante_de_proveedor where empresa_id = $1", [
        m.e.empresa,
      ]),
    ).toBe(antes);
  });

  it("la base rechaza una línea de factura a precio cero", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compra(m, "1")));
    const comprobanteId = r.comprobanteId as string;
    await c.dueno.query("begin");
    try {
      await apagarCabecera();
      await c.dueno.query("savepoint intento");
      await expect(insertarLinea(comprobanteId, m.e.empresa, "0")).rejects.toMatchObject({
        constraint: "linea_de_comprobante_precio_ck",
      });
      await c.dueno.query("rollback to savepoint intento");
      // Espejo: el mínimo que el dominio acepta entra en la base (si no, la base sería más estricta que el dominio).
      expect(leerPrecioPositivo("0.000001")).not.toBeNull();
      expect(leerPrecioPositivo("0")).toBeNull();
      await insertarLinea(comprobanteId, m.e.empresa, "0.000001");
    } finally {
      await c.dueno.query("rollback");
    }
  });

  it("dos facturas iguales a la vez (misma clave) dejan una sola, con su precio mayor que cero (concurrencia e idempotencia)", async () => {
    const m = await armar();
    const clave = nuevoId();
    const pedido = compra(m, "1", 100, clave);
    const rs = await Promise.all([
      c.casos.registrarCompraConFactura(m.e.operador, pedido),
      c.casos.registrarCompraConFactura(m.e.operador, pedido),
    ]);
    const ids = new Set(rs.filter((r) => r.ok).map((r) => valorDe(r).comprobanteId));
    expect(ids.size).toBe(1);
    const [id] = [...ids] as string[];
    const lineas = await lineasDe(id as string);
    expect(lineas).toHaveLength(1);
    expect(Number(lineas[0]?.precio_neto)).toBeGreaterThan(0);
  });

  describe("la migración 0054", () => {
    const leer = (carpeta: string, archivo: string) =>
      readFile(join(CARPETA_DE_MIGRACIONES, carpeta, archivo), "utf8");

    it("con una línea en cero (base anterior) frena sin cambiar nada; repetir la reversión no cambia nada", async () => {
      const migracion = await leer(".", ARCHIVO);
      const reversion = await leer("reversiones", REVERSION);
      const m = await armar();
      const r = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compra(m, "1")));
      await c.dueno.query("begin");
      try {
        await c.dueno.query(reversion);
        await c.dueno.query(reversion);
        await apagarCabecera();
        await insertarLinea(r.comprobanteId as string, m.e.empresa, "0");
        await c.dueno.query("savepoint freno");
        await expect(c.dueno.query(migracion)).rejects.toMatchObject({ code: "55000" });
        await c.dueno.query("rollback to savepoint freno");
      } finally {
        await c.dueno.query("rollback");
      }
    });

    it("sin líneas en cero aplica y la base vuelve a rechazar el cero", async () => {
      const migracion = await leer(".", ARCHIVO);
      const reversion = await leer("reversiones", REVERSION);
      const m = await armar();
      const r = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compra(m, "1")));
      await c.dueno.query("begin");
      try {
        await c.dueno.query(reversion);
        await c.dueno.query(migracion);
        await apagarCabecera();
        await expect(
          insertarLinea(r.comprobanteId as string, m.e.empresa, "0"),
        ).rejects.toMatchObject({
          constraint: "linea_de_comprobante_precio_ck",
        });
      } finally {
        await c.dueno.query("rollback");
      }
    });
  });
});
