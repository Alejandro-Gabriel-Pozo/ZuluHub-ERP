import { describe, expect, it } from "vitest";
import {
  armarLaFichaDelProveedor,
  digitosDelPuntoDeVenta,
  nombreDelTipo,
  rutaDeLaFichaDelProveedor,
  type FichaDelProveedorParaLaPantalla,
} from "../../apps/web/ui/plantillas/compras/proveedor/modelo-de-ficha-de-proveedor";
import { textosDeProveedor } from "../../apps/web/ui/plantillas/compras/proveedor/textos-de-proveedor";

/** Compras PR 4: el modelo puro de la ficha del proveedor. El modelo muestra lo que dice el servidor y no calcula nada. */
const TIPOS = [
  "FACTURA_A",
  "FACTURA_B",
  "FACTURA_C",
  "NOTA_DEBITO_A",
  "NOTA_DEBITO_B",
  "NOTA_DEBITO_C",
  "NOTA_CREDITO_A",
  "NOTA_CREDITO_B",
  "NOTA_CREDITO_C",
];
const textos = textosDeProveedor();
const ficha = (
  resto: Partial<FichaDelProveedorParaLaPantalla> = {},
): FichaDelProveedorParaLaPantalla => ({
  parteId: "0b6c7c2e-5d8f-4f3a-9a53-2f6a1c3d4e5f",
  nombre: "Carnes del Sur",
  documento: { tipo: "CUIT", numero: "30712345678" },
  condicionIva: "RESPONSABLE_INSCRIPTO",
  letraEsperada: "A",
  puntosDeVenta: [4, 12],
  comprobantes: ["FACTURA_A"],
  pedidosPendientes: [],
  queLeCompramos: [],
  facturas: [],
  tiposDeComprobante: TIPOS,
  puntoDeVentaMaximo: 99998,
  ...resto,
});

describe("modelo de la ficha del proveedor de compras", () => {
  it("muestra los datos del directorio, los puntos de venta con cinco dígitos y lo que emite", () => {
    const f = armarLaFichaDelProveedor(ficha(), textos);
    expect(f.titulo).toBe("Carnes del Sur");
    expect(f.datos.cuit).toBe("CUIT 30-71234567-8");
    expect(f.datos.condicion).toBe("IVA Responsable Inscripto");
    expect(f.puntosDeVenta.numeros.map((n) => n.texto)).toEqual(["00004", "00012"]);
    expect(f.puntosDeVenta.vacio).toBeNull();
    expect(f.comprobantes.valor).toBe("Factura A");
    expect(f.comprobantes.porCondicion).toBe("Por ser IVA Responsable Inscripto emite A.");
    expect(f.comprobantes.agregables).toHaveLength(8);
    expect(f.comprobantes.agregables.map((a) => a.valor)).not.toContain("FACTURA_A");
  });

  it("sin letra esperada dice que se elige a mano; sin nada cargado lo dice con los textos aprobados", () => {
    const f = armarLaFichaDelProveedor(
      ficha({ letraEsperada: null, puntosDeVenta: [], comprobantes: [], condicionIva: null }),
      textos,
    );
    expect(f.comprobantes.porCondicion).toBe("Su condición no define la letra: se elige a mano.");
    expect(f.comprobantes.valor).toBe("Ninguno cargado");
    expect(f.puntosDeVenta.vacio).toBe("Sin puntos de venta");
    expect(f.datos.condicion).toBeNull();
    expect(f.queLeCompramos.vacio).toBe("Todavía no se le compró nada");
    expect(f.facturas.vacio).toBe("Todavía no tiene facturas");
    expect(f.facturas.verTodas).toBeNull();
  });

  it("sin pedidos pendientes no se dibuja el bloque; con pedidos, cada uno con su nombre", () => {
    expect(armarLaFichaDelProveedor(ficha(), textos).pedidos).toBeNull();
    const f = armarLaFichaDelProveedor(
      ficha({
        pedidosPendientes: [
          { id: "a", objeto: "PUNTO_DE_VENTA", valor: "7", pedidoEn: "2026-11-24T15:00:00.000Z" },
          {
            id: "b",
            objeto: "COMPROBANTE",
            valor: "NOTA_CREDITO_B",
            pedidoEn: "2026-11-24T15:00:00.000Z",
          },
        ],
      }),
      textos,
    );
    expect(f.pedidos?.filas.map((p) => p.nombre)).toEqual([
      "Punto de venta 00007",
      "Nota de crédito B",
    ]);
    expect(f.pedidos?.filas[0]?.fecha).toContain("24/11/2026");
  });

  it("las facturas: tres en la ficha, todas en «Ver todas»; una nota de crédito lleva el signo menos y una anulada lo dice con texto", () => {
    const una = (n: number, resto: object = {}) => ({
      clase: "FACTURA",
      tipo: "FACTURA_A",
      puntoDeVenta: 4,
      numero: n,
      fecha: "2026-11-10",
      total: { moneda: "ARS", monto: "1210.00" },
      anulado: false,
      ...resto,
    });
    const f = armarLaFichaDelProveedor(
      ficha({
        facturas: [
          una(5),
          una(4, { clase: "NOTA_DE_CREDITO", tipo: "NOTA_CREDITO_A" }),
          una(3, { anulado: true }),
          una(2),
        ],
      }),
      textos,
    );
    expect(f.facturas.titulo).toBe("Facturas y notas (4)");
    expect(f.facturas.filas).toHaveLength(3);
    expect(f.facturas.filas[0]?.nombre).toBe("Factura A 00004-00000005");
    expect(f.facturas.filas[1]?.total).toBe("−$ 1.210,00");
    expect(f.facturas.filas[2]?.segunda).toBe("10/11/2026 · Anulada");
    expect(f.facturas.verTodas?.href).toBe(
      `${rutaDeLaFichaDelProveedor(ficha().parteId)}/facturas`,
    );
  });

  it("el largo del campo del punto de venta sale del máximo del dominio y los nombres de tipo salen del catálogo", () => {
    expect(digitosDelPuntoDeVenta(99998)).toBe(5);
    expect(nombreDelTipo("NOTA_DEBITO_C")).toBe("Nota de débito C");
  });
});
