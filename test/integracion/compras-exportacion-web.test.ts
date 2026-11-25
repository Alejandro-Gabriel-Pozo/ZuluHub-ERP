import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { leerZipComoTextos } from "../../src/adaptadores/xlsx/leer-zip-de-prueba";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  exportarLasCompras,
  type DependenciasDeExportacionWeb,
} from "../../src/composicion/compras-exportacion-web";
import { crearEscritorDePlanilla } from "../../src/composicion/escritor-de-planilla";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";

/**
 * El archivo de compras de punta a punta por la composición web (T1 + T2 + T2b): el caso de uso, los correos de identidad, los textos del catálogo y el escritor real. Se abre el .xlsx
 * y se mira lo que vería quien lo abre: hojas, encabezados, números exactos, correo de quien cargó, ninguna fórmula; y que lo no permitido sale como el genérico.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const GENERICO = { ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: archivo de compras", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeExportacionWeb;
  const registrados: string[] = [];
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    const identidad = crearConsultasDeIdentidad({
      transacciones: c.entorno,
      reglas: REGLAS_DE_EMPRESA,
    });
    d = {
      casos: () => c.casos,
      consultasDeIdentidad: () => identidad,
      escritor: crearEscritorDePlanilla(),
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async (e?: EscenarioDeCompras) => {
    const esc = e ?? (await c.escenario());
    valorDe(
      await c.casos.configurarCompras(esc.gerente, {
        nivel: "CON_COMPROBANTE",
        versionEsperada: 1,
      }),
    );
    const deposito = await c.deposito(esc);
    const { producto } = await c.articulo(esc, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(esc.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(esc.gerente, { parteId: proveedor, numero: 5 }));
    return { e: esc, deposito, producto, proveedor };
  };
  const compra = (m: Awaited<ReturnType<typeof armar>>, razonSocial?: string) => ({
    clave: nuevoId(),
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
      numero: 100,
      fecha: "2026-10-10",
      lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
      totalSegunFactura: "2420.00",
      cuitDelProveedor: cuitUnico(),
      ...(razonSocial === undefined ? {} : { razonSocial }),
    },
  });
  const pedido = { desde: "2026-01-01", hasta: "2026-12-31" };

  it("el gerente baja el archivo: tres hojas, encabezados del catálogo, el total exacto como número, el correo de quien cargó y ninguna fórmula", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compra(m)));
    const r = await exportarLasCompras(d, m.e.gerente, pedido);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.nombre).toBe("compras_2026-01-01_2026-12-31.xlsx");
    const zip = leerZipComoTextos(r.dato.contenido);
    const libro = zip.get("xl/workbook.xml") ?? "";
    for (const hoja of ["Cabecera", "Detalle", "Resumen"])
      expect(libro).toContain(`name="${hoja}"`);
    const cadenas = zip.get("xl/sharedStrings.xml") ?? "";
    for (const encabezado of [
      "Total según factura",
      "Importe abonado",
      "Costo por kilo (derivado)",
      "Renglones sin precio",
      "Registrado por",
    ]) {
      expect(cadenas).toContain(encabezado);
    }
    // «Tipo» y «Letra» son datos separados, nunca «Factura A» en una celda.
    expect(cadenas).toContain(">Factura<");
    expect(cadenas).toContain(">A<");
    expect(cadenas).not.toContain("Factura A");
    const cabecera = zip.get("xl/worksheets/sheet1.xml") ?? "";
    expect(cabecera).toContain("<v>2420</v>");
    expect(cabecera).toContain("<v>2000</v>");
    for (const [nombre, xml] of zip)
      if (nombre.startsWith("xl/worksheets/")) expect(xml).not.toContain("<f");
    // El correo de quien cargó (el operador) sale del directorio de identidad.
    expect(cadenas).toMatch(/@/);
  });

  it("un proveedor llamado como una fórmula sale como texto inofensivo", async () => {
    const m = await armar();
    valorDe(
      await c.casos.registrarCompraConFactura(m.e.operador, compra(m, '=HYPERLINK("http://x")')),
    );
    const r = await exportarLasCompras(d, m.e.gerente, pedido);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const zip = leerZipComoTextos(r.dato.contenido);
    for (const [nombre, xml] of zip)
      if (nombre.startsWith("xl/worksheets/")) expect(xml).not.toContain("<f");
    expect(zip.get("xl/sharedStrings.xml")).not.toMatch(/>=HYPERLINK/);
  });

  it("lo no permitido no sale: el operador (sin permiso), un período incompleto, uno al revés, uno de más de 12 meses y claves de más", async () => {
    const m = await armar();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, compra(m)));
    // El guard dice su propio código (la pantalla lo traduce): el operador no exporta.
    expect(await exportarLasCompras(d, m.e.operador, pedido)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(await exportarLasCompras(d, m.e.gerente, { desde: "2026-01-01" })).toMatchObject(
      GENERICO,
    );
    expect(await exportarLasCompras(d, m.e.gerente, {})).toMatchObject(GENERICO);
    expect(await exportarLasCompras(d, m.e.gerente, null)).toMatchObject(GENERICO);
    expect(
      await exportarLasCompras(d, m.e.gerente, { desde: "2026-12-31", hasta: "2026-01-01" }),
    ).toMatchObject(GENERICO);
    expect(
      await exportarLasCompras(d, m.e.gerente, { desde: "2025-01-01", hasta: "2026-01-01" }),
    ).toMatchObject(GENERICO);
    expect(await exportarLasCompras(d, m.e.gerente, { desde: "ayer", hasta: "hoy" })).toMatchObject(
      GENERICO,
    );
    // Una empresa que no es la suya no existe en el pedido: aunque la mande, el archivo es de SU empresa.
    const otra = await armar();
    valorDe(await c.casos.registrarCompraConFactura(otra.e.operador, { ...compra(otra) }));
    const r = await exportarLasCompras(d, m.e.gerente, { ...pedido, empresaId: otra.e.empresa });
    expect(r.ok).toBe(true);
    expect(registrados).toEqual([]);
  });
});
