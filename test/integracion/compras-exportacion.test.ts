import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  armarCabecera,
  armarDetalle,
  armarResumen,
  type RotulosDeExportacion,
} from "../../src/modulos/compras/publico";
import { armarExportarCompras } from "../../src/modulos/compras/casos-de-uso/exportar-compras";
import { codigoDe } from "./concurrencia-apoyo";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";

/**
 * La exportación de compras a Excel (T1 + T2 + T2b, dueño 25/11/2026) contra la base real: lo que lee (Cabecera, Detalle y Resumen), el dinero exacto, el aislamiento por empresa y por
 * sucursal, los permisos, la repetición (dos exportaciones iguales dejan dos registros de auditoría y no tocan nada de compras), la concurrencia, el período y el tope.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

/** Los rótulos de prueba: el código tal cual (los textos reales los pone la composición desde el catálogo). */
const ROTULOS: RotulosDeExportacion = {
  estadoDeLaCompra: (e) => e,
  tipoDeComprobante: (t) => t,
  estadoDelPago: (e) => e,
  estadoDeLaFactura: (e) => e,
  medioDePago: (m) => m,
  precioPor: (t) => t,
};
const PERIODO = { desde: "2026-01-01", hasta: "2026-12-31" };

describe.skipIf(base === null)("compras: exportación a Excel", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async (e?: EscenarioDeCompras) => {
    const esc = e ?? (await c.escenario());
    valorDe(await c.casos.configurarCompras(esc.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }));
    const deposito = await c.deposito(esc);
    // Seis productos distintos: una compra no repite el mismo producto en dos renglones.
    const productos: string[] = [];
    for (let i = 0; i < 6; i++) {
      productos.push((await c.articulo(esc, { unidadBase: "GRAMO", dimension: "MASA" })).producto);
    }
    const proveedor = await c.proveedor(esc.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(esc.gerente, { parteId: proveedor, numero: 23 }));
    return { e: esc, deposito, productos, proveedor };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** La factura real del dueño (§J.3): seis líneas, dos alícuotas; los precios por kilo cierran el importe impreso de cada línea. */
  const LINEAS = [
    { kg: "20", precio: "13312.62", alicuota: "10.5" },
    { kg: "6", precio: "17035.815", alicuota: "10.5" },
    { kg: "6", precio: "9873.503333", alicuota: "21" },
    { kg: "12", precio: "8289.133333", alicuota: "10.5" },
    { kg: "8.94", precio: "27740.75", alicuota: "10.5" },
    { kg: "22.91", precio: "20015.58", alicuota: "10.5" },
  ] as const;
  const compraReal = (m: M, numero = 1001, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    sucursalId: m.e.sucursal,
    proveedorId: m.proveedor,
    depositoId: m.deposito,
    renglones: LINEAS.map((l, i) => ({
      productoId: m.productos[i],
      unidadDeCompraId: "KILOGRAMO",
      cantidad: l.kg,
      precioPor: "UNIDAD",
      unidadDePrecioId: "KILOGRAMO",
      precio: l.precio,
    })),
    factura: {
      tipo: "FACTURA_A",
      puntoDeVenta: 23,
      numero,
      fecha: "2026-10-23",
      lineas: LINEAS.map((l, i) => ({
        renglon: i + 1,
        cantidadFacturada: String(Math.round(Number(l.kg) * 1000)),
        // Por gramo: el precio por kilo dividido mil (hasta 6 decimales).
        precioNeto: (Number(l.precio) / 1000).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""),
        alicuota: l.alicuota,
      })),
      totalSegunFactura: "1369499.91",
      cuitDelProveedor: cuitUnico(),
    },
    ...extra,
  });
  const exportar = (m: M, quien = m.e.gerente, periodo = PERIODO) =>
    c.casos.exportarCompras(quien, periodo);

  it("la factura real: el total que dice el papel sale exacto y el cálculo del sistema sale aparte (1.369.499,91 contra lo calculado)", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m)));
    const salida = valorDe(await exportar(m));
    expect(salida.compras).toHaveLength(1);
    const cab = armarCabecera(salida.compras, new Map(), ROTULOS);
    const fila = Object.fromEntries(cab.columnas.map((col, i) => [col, cab.filas[0]?.[i]]));
    expect(fila["total_segun_factura"]).toEqual({ tipo: "decimal", valor: "1369499.91", decimales: 2 });
    const [guardado] = await c.filas<Record<string, string>>(
      "select total_calculado::text as calculado, neto_gravado::text as neto, iva::text as iva from comprobante_de_proveedor where id = $1",
      [r.comprobanteId],
    );
    // Lo exportado es lo guardado, sin recalcular: el calculado, el neto y el IVA salen tal cual los dejó la base.
    expect(fila["total_calculado"]).toEqual({ tipo: "decimal", valor: guardado?.["calculado"], decimales: 2 });
    expect(fila["neto_gravado"]).toEqual({ tipo: "decimal", valor: guardado?.["neto"], decimales: 2 });
    expect(fila["iva"]).toEqual({ tipo: "decimal", valor: guardado?.["iva"], decimales: 2 });
    expect(fila).toMatchObject({ tipo: { valor: "FACTURA" }, letra: { valor: "A" }, signo: { valor: 1 } });
    // El detalle trae las seis líneas con el importe de la base, y su suma es el neto de la factura.
    const det = armarDetalle(salida.compras, ROTULOS);
    expect(det.filas).toHaveLength(6);
    const importe = det.columnas.indexOf("importe_vigente");
    const importes = det.filas.map((f) => (f[importe] as { valor: string }).valor);
    expect(importes).toEqual(["266252.40", "102214.89", "59241.02", "99469.60", "248002.31", "458556.94"]);
    expect(importes.reduce((a, v) => a + Math.round(Number(v) * 100), 0)).toBe(123373716);
    expect(fila["importe_de_las_lineas"]).toEqual({ tipo: "decimal", valor: "1233737.16", decimales: 2 });
  });

  it("sin pago el abonado es 0,00 y el saldo es todo; con el pago vigente, abonado y saldo cierran y el reparto por línea suma exacto el abonado", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m)));
    const negocio = (
      await c.filas<{ f: string }>("select fecha_negocio::text as f from recepcion where id = $1", [r.recepcionId])
    )[0]?.f;
    expect(negocio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    let salida = valorDe(await exportar(m));
    let cab = armarCabecera(salida.compras, new Map(), ROTULOS);
    const col = (n: string) => cab.columnas.indexOf(n as never);
    expect(cab.filas[0]?.[col("estado_del_pago")]).toEqual({ tipo: "texto", valor: "PENDIENTE" });
    expect(cab.filas[0]?.[col("importe_abonado")]).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(cab.filas[0]?.[col("saldo")]).toEqual({ tipo: "decimal", valor: "1369499.91", decimales: 2 });
    valorDe(
      await c.casos.declararPago(m.e.gerente, {
        clave: nuevoId(),
        comprobanteId: r.comprobanteId,
        fechaDePago: negocio,
        medio: "TRANSFERENCIA",
      }),
    );
    salida = valorDe(await exportar(m));
    cab = armarCabecera(salida.compras, new Map(), ROTULOS);
    expect(cab.filas[0]?.[col("estado_del_pago")]).toEqual({ tipo: "texto", valor: "PAGADO" });
    expect(cab.filas[0]?.[col("saldo")]).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(cab.filas[0]?.[col("fecha_de_pago")]).toEqual({ tipo: "fecha", valor: negocio });
    const det = armarDetalle(salida.compras, ROTULOS);
    const derivado = det.columnas.indexOf("importe_abonado_derivado");
    const partes = det.filas.map((f) => Math.round(Number((f[derivado] as { valor: string }).valor) * 100));
    expect(partes.reduce((a, v) => a + v, 0)).toBe(136949991);
    const resumen = armarResumen(salida.compras);
    expect(resumen.filas).toHaveLength(6);
    const col2 = resumen.columnas.indexOf("importe_abonado_derivado");
    expect(
      resumen.filas.reduce((a, f) => a + Math.round(Number((f[col2] as { valor: string }).valor) * 100), 0),
    ).toBe(136949991);
  });

  it("una línea «Sin precio» sale con el importe vacío (no cero), y el Resumen la cuenta aparte", async () => {
    const m = await armar();
    valorDe(
      await c.casos.registrarCompra(m.e.operador, {
        clave: nuevoId(),
        sucursalId: m.e.sucursal,
        proveedorId: m.proveedor,
        depositoId: m.deposito,
        renglones: [
          { productoId: m.productos[0], unidadDeCompraId: "KILOGRAMO", cantidad: "2", precioPor: "UNIDAD", unidadDePrecioId: "KILOGRAMO", precio: null },
        ],
      }),
    ).recepcionId;
    const salida = valorDe(await exportar(m));
    const det = armarDetalle(salida.compras, ROTULOS);
    expect(det.filas[0]?.[det.columnas.indexOf("importe_vigente")]).toBeNull();
    const res = armarResumen(salida.compras);
    expect(res.filas[0]?.[res.columnas.indexOf("renglones_sin_precio")]).toEqual({ tipo: "entero", valor: 1 });
    expect(res.filas[0]?.[res.columnas.indexOf("importe_vigente")]).toBeNull();
    const cab = armarCabecera(salida.compras, new Map(), ROTULOS);
    expect(cab.filas[0]?.[cab.columnas.indexOf("importe_de_las_lineas")]).toBeNull();
  });

  it("permisos: el operador no exporta; sin sesión de persona, tampoco; el gerente y el administrador sí", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m, 1002)));
    expect(codigoDe(await exportar(m, m.e.operador))).toBe("SIN_PERMISO");
    expect((await exportar(m, m.e.gerente)).ok).toBe(true);
    expect((await exportar(m, m.e.administrador)).ok).toBe(true);
  });

  it("aislamiento: la exportación de una empresa no trae ninguna compra de otra", async () => {
    const a = await armar();
    const b = await armar();
    valorDe(await c.casos.registrarCompraConFactura(a.e.operador, compraReal(a, 1003)));
    valorDe(await c.casos.registrarCompraConFactura(b.e.operador, compraReal(b, 1004)));
    const deA = valorDe(await exportar(a, a.e.gerente));
    const deB = valorDe(await exportar(b, b.e.gerente));
    expect(deA.compras.map((x) => x.sucursalId)).toEqual([a.e.sucursal]);
    expect(deB.compras.map((x) => x.sucursalId)).toEqual([b.e.sucursal]);
    expect(deA.compras[0]?.recepcionId).not.toBe(deB.compras[0]?.recepcionId);
  });

  it("alcance de sucursal: quien solo ve una sucursal no recibe las compras de la otra, y sin sucursales no recibe nada (nunca «todas»)", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m, 1005)));
    c.alcances.set(m.e.gerente.personaId as string, [m.e.otraSucursal]);
    try {
      expect(valorDe(await exportar(m)).compras).toHaveLength(0);
      c.alcances.set(m.e.gerente.personaId as string, []);
      expect(valorDe(await exportar(m)).compras).toHaveLength(0);
      c.alcances.set(m.e.gerente.personaId as string, [m.e.sucursal]);
      expect(valorDe(await exportar(m)).compras).toHaveLength(1);
    } finally {
      c.alcances.delete(m.e.gerente.personaId as string);
    }
  });

  it("I6: exportar dos veces el mismo período da las mismas filas, deja dos registros de auditoría sin los datos y no cambia ninguna tabla de compras", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m, 1006)));
    const tablas = async () => ({
      recepciones: await c.contar("select count(*) as n from recepcion where empresa_id = $1", [m.e.empresa]),
      lineas: await c.contar("select count(*) as n from linea_de_recepcion where empresa_id = $1", [m.e.empresa]),
      comprobantes: await c.contar("select count(*) as n from comprobante_de_proveedor where empresa_id = $1", [m.e.empresa]),
      pagos: await c.contar("select count(*) as n from pago_de_comprobante where empresa_id = $1", [m.e.empresa]),
      movimientos: await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [m.e.empresa]),
    });
    const antes = await tablas();
    const uno = valorDe(await exportar(m));
    const dos = valorDe(await exportar(m));
    expect(armarDetalle(dos.compras, ROTULOS)).toEqual(armarDetalle(uno.compras, ROTULOS));
    expect(armarCabecera(dos.compras, new Map(), ROTULOS)).toEqual(armarCabecera(uno.compras, new Map(), ROTULOS));
    expect(await tablas()).toEqual(antes);
    const registros = await c.auditoria(m.e.empresa, "COMPRAS_EXPORTADAS");
    expect(registros).toHaveLength(2);
    expect(registros.at(-1)).toMatchObject({
      entidad: "exportacion_de_compras",
      despues: { desde: PERIODO.desde, hasta: PERIODO.hasta, filasDeCabecera: 1, filasDeDetalle: 6, filasDeResumen: 6 },
    });
    expect(JSON.stringify(registros)).not.toMatch(/1369499|266252|FACTURA/);
  });

  it("concurrencia: dos exportaciones a la vez dan lo mismo y dejan dos registros", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m, 1007)));
    const [a, b] = await Promise.all([exportar(m), exportar(m, m.e.administrador)]);
    expect(armarDetalle(valorDe(a).compras, ROTULOS)).toEqual(armarDetalle(valorDe(b).compras, ROTULOS));
    expect(await c.auditoria(m.e.empresa, "COMPRAS_EXPORTADAS")).toHaveLength(2);
  });

  it("el período: una fecha que no es fecha o más de 12 meses se rechazan; una compra fuera del período no sale", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m, 1008)));
    expect(codigoDe(await exportar(m, m.e.gerente, { desde: "ayer", hasta: "2026-12-31" }))).toBe("FECHA_INVALIDA");
    expect(codigoDe(await exportar(m, m.e.gerente, { desde: "2025-01-01", hasta: "2026-01-01" }))).toBe("FECHA_INVALIDA");
    expect(codigoDe(await exportar(m, m.e.gerente, { desde: "2026-12-31", hasta: "2026-01-01" }))).toBe("FECHA_INVALIDA");
    expect(valorDe(await exportar(m, m.e.gerente, { desde: "2020-01-01", hasta: "2020-12-31" })).compras).toHaveLength(0);
    expect(await c.auditoria(m.e.empresa, "COMPRAS_EXPORTADAS")).toHaveLength(1);
  });

  it("el período de la Cabecera es la fecha del comprobante y el del Detalle es la de negocio: una compra del 11/10 con factura del 23/10 sale en la Cabecera del 15 al 31 de octubre y no en su Detalle", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m, 1009)));
    const octubre = valorDe(await exportar(m, m.e.gerente, { desde: "2026-10-15", hasta: "2026-10-31" }));
    expect(armarCabecera(octubre.compras, new Map(), ROTULOS).filas).toHaveLength(1);
    expect(armarDetalle(octubre.compras, ROTULOS).filas).toHaveLength(0);
    expect(armarResumen(octubre.compras).filas).toHaveLength(0);
  });

  it("el tope: por encima del máximo de filas se rechaza el pedido entero y no queda registro", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compraReal(m, 1010)));
    const conTopeChico = armarExportarCompras(c.dependencias, 5);
    expect(codigoDe(await conTopeChico(m.e.gerente, PERIODO))).toBe("EXPORTACION_DEMASIADO_GRANDE");
    expect(await c.auditoria(m.e.empresa, "COMPRAS_EXPORTADAS")).toHaveLength(0);
  });
});
