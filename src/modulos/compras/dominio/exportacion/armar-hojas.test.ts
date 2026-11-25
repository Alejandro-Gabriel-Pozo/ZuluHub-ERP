import { describe, expect, it } from "vitest";
import { armarCabecera, armarDetalle, armarResumen } from "./armar-hojas";
import type {
  CompraParaExportar,
  ComprobanteParaExportar,
  LineaParaExportar,
  RotulosDeExportacion,
} from "./datos";

const ROTULOS: RotulosDeExportacion = {
  estadoDeLaCompra: (e) => e,
  tipoDeComprobante: (t) => t ?? "SIN CLASE",
  estadoDelPago: (e) => e,
  estadoDeLaFactura: (e) => e,
  medioDePago: (m) => m,
  precioPorUnidad: "UNIDAD",
};

const linea = (cambios: Partial<LineaParaExportar> = {}): LineaParaExportar => ({
  numero: 1,
  productoId: "p1",
  productoNombre: "Bife angosto",
  productoCodigo: "BA",
  clasificacion: "Carnes",
  presentacionNombre: null,
  presentacionCantidad: null,
  cantidadDeCompra: "20.0000",
  unidadDeCompraId: "KILOGRAMO",
  unidadDeCompraSimbolo: "kg",
  pesoReal: null,
  cantidadEnStock: "20000.0000",
  unidadDeStockId: "GRAMO",
  unidadDeStockSimbolo: "g",
  precio: "13312.620000",
  precioPorTipo: "UNIDAD",
  unidadDePrecioSimbolo: "kg",
  importeVigente: "266252.40",
  costoPorUnidadDeStock: "13.312620",
  importeAbonadoDerivado: null,
  ...cambios,
});

const factura = (cambios: Partial<ComprobanteParaExportar> = {}): ComprobanteParaExportar => ({
  id: "c1",
  tipo: "FACTURA_A",
  puntoDeVenta: 23,
  numero: 1,
  fechaDelComprobante: "2026-10-23",
  netoGravado: "266252.40",
  noGravado: "0.00",
  exento: "0.00",
  iva: "27956.50",
  tributosTotal: "0.00",
  totalCalculado: "294208.90",
  totalSegunFactura: "294208.90",
  proveedorCuit: "20123456786",
  estado: "REGISTRADO",
  pagos: [],
  ...cambios,
});

const compra = (cambios: Partial<CompraParaExportar> = {}): CompraParaExportar => ({
  recepcionId: "r1",
  numero: 7,
  estado: "CONFIRMADA",
  fechaNegocio: "2026-10-11",
  sucursalId: "s1",
  sucursalNombre: "Casa central",
  proveedorNombre: "Carnes del Sur",
  registradoEn: new Date("2026-10-11T18:30:00Z"),
  registradoPor: "persona-1",
  enCabecera: true,
  enDetalle: true,
  comprobante: factura(),
  lineas: [linea()],
  ...cambios,
});

const col = <C extends string>(
  h: { columnas: readonly C[]; filas: readonly (readonly unknown[])[] },
  c: C,
  fila = 0,
) => h.filas[fila]?.[h.columnas.indexOf(c)];

describe("la Cabecera", () => {
  it("una fila por compra con el dinero exacto, Tipo y Letra por separado, el instante en hora de Argentina y el correo de quien cargó", () => {
    const h = armarCabecera([compra()], new Map([["persona-1", "ana@ejemplo.com"]]), ROTULOS);
    expect(h.filas).toHaveLength(1);
    expect(col(h, "tipo")).toEqual({ tipo: "texto", valor: "FACTURA" });
    expect(col(h, "letra")).toEqual({ tipo: "texto", valor: "A" });
    expect(col(h, "total_segun_factura")).toEqual({
      tipo: "decimal",
      valor: "294208.90",
      decimales: 2,
    });
    expect(col(h, "importe_de_las_lineas")).toEqual({
      tipo: "decimal",
      valor: "266252.40",
      decimales: 2,
    });
    expect(col(h, "registrado_el")).toEqual({ tipo: "texto", valor: "2026-10-11T15:30:00-03:00" });
    expect(col(h, "registrado_por")).toEqual({ tipo: "texto", valor: "ana@ejemplo.com" });
    expect(col(h, "signo")).toEqual({ tipo: "entero", valor: 1 });
    expect(col(h, "cantidad_de_renglones")).toEqual({ tipo: "entero", valor: 1 });
    expect(col(h, "id")).toEqual({ tipo: "texto", valor: "r1" });
    expect(col(h, "numero")).toEqual({ tipo: "entero", valor: 7 });
    expect(col(h, "estado")).toEqual({ tipo: "texto", valor: "CONFIRMADA" });
    expect(col(h, "fecha_de_negocio")).toEqual({ tipo: "fecha", valor: "2026-10-11" });
    expect(col(h, "sucursal")).toEqual({ tipo: "texto", valor: "Casa central" });
    expect(col(h, "proveedor")).toEqual({ tipo: "texto", valor: "Carnes del Sur" });
    expect(col(h, "cuit")).toEqual({ tipo: "texto", valor: "20123456786" });
    expect(col(h, "punto_de_venta")).toEqual({ tipo: "entero", valor: 23 });
    expect(col(h, "numero_del_comprobante")).toEqual({ tipo: "entero", valor: 1 });
    expect(col(h, "fecha_del_comprobante")).toEqual({ tipo: "fecha", valor: "2026-10-23" });
    expect(col(h, "moneda")).toEqual({ tipo: "texto", valor: "ARS" });
    expect(col(h, "neto_gravado")).toEqual({ tipo: "decimal", valor: "266252.40", decimales: 2 });
    expect(col(h, "no_gravado")).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(col(h, "exento")).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(col(h, "iva")).toEqual({ tipo: "decimal", valor: "27956.50", decimales: 2 });
    expect(col(h, "tributos")).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(col(h, "total_calculado")).toEqual({
      tipo: "decimal",
      valor: "294208.90",
      decimales: 2,
    });
    expect(col(h, "estado_de_la_factura")).toEqual({ tipo: "texto", valor: "REGISTRADO" });
  });

  it("un comprobante sin tipo (sin comprobante) deja vacío el tipo, la letra y el número", () => {
    const h = armarCabecera(
      [
        compra({
          comprobante: factura({
            tipo: null,
            puntoDeVenta: null,
            numero: null,
            fechaDelComprobante: null,
          }),
        }),
      ],
      new Map(),
      ROTULOS,
    );
    for (const c of [
      "tipo",
      "letra",
      "punto_de_venta",
      "numero_del_comprobante",
      "fecha_del_comprobante",
    ] as const) {
      expect(col(h, c), c).toBeNull();
    }
    expect(col(h, "signo")).toEqual({ tipo: "entero", valor: 1 });
  });

  it("un importe de la base que no es un decimal de pesos rompe con su motivo (nunca sale uno inventado)", () => {
    expect(() =>
      armarCabecera(
        [compra({ comprobante: factura({ totalSegunFactura: "abc" }) })],
        new Map(),
        ROTULOS,
      ),
    ).toThrow("Un importe de la base no es un decimal de pesos: abc");
  });

  it("sin factura: todo lo fiscal y el pago vacíos; el importe de las líneas sale; el signo es 1", () => {
    const h = armarCabecera([compra({ comprobante: null })], new Map(), ROTULOS);
    for (const c of [
      "tipo",
      "letra",
      "cuit",
      "neto_gravado",
      "total_segun_factura",
      "estado_del_pago",
      "importe_abonado",
      "saldo",
      "fecha_de_pago",
    ] as const) {
      expect(col(h, c), c).toBeNull();
    }
    expect(col(h, "importe_de_las_lineas")).toEqual({
      tipo: "decimal",
      valor: "266252.40",
      decimales: 2,
    });
    expect(col(h, "signo")).toEqual({ tipo: "entero", valor: 1 });
    expect(col(h, "registrado_por")).toBeNull();
  });

  it("una línea «Sin precio» deja vacío el importe de las líneas (nunca cero)", () => {
    const h = armarCabecera(
      [compra({ lineas: [linea(), linea({ numero: 2, importeVigente: null })] })],
      new Map(),
      ROTULOS,
    );
    expect(col(h, "importe_de_las_lineas")).toBeNull();
  });

  it("pago vigente: pagado, abonado el total, saldo cero, fecha y medio; pendiente: abonado 0,00 y saldo todo; solo anulados: anulado", () => {
    const pago = {
      fechaDePago: "2026-10-24",
      medio: "TRANSFERENCIA",
      importe: "294208.90",
      estado: "VIGENTE" as const,
    };
    let h = armarCabecera(
      [compra({ comprobante: factura({ pagos: [pago] }) })],
      new Map(),
      ROTULOS,
    );
    expect(col(h, "estado_del_pago")).toEqual({ tipo: "texto", valor: "PAGADO" });
    expect(col(h, "importe_abonado")).toEqual({
      tipo: "decimal",
      valor: "294208.90",
      decimales: 2,
    });
    expect(col(h, "saldo")).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(col(h, "fecha_de_pago")).toEqual({ tipo: "fecha", valor: "2026-10-24" });
    expect(col(h, "medio_de_pago")).toEqual({ tipo: "texto", valor: "TRANSFERENCIA" });
    h = armarCabecera([compra()], new Map(), ROTULOS);
    expect(col(h, "estado_del_pago")).toEqual({ tipo: "texto", valor: "PENDIENTE" });
    expect(col(h, "importe_abonado")).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
    expect(col(h, "saldo")).toEqual({ tipo: "decimal", valor: "294208.90", decimales: 2 });
    expect(col(h, "fecha_de_pago")).toBeNull();
    h = armarCabecera(
      [compra({ comprobante: factura({ pagos: [{ ...pago, estado: "ANULADO" }] }) })],
      new Map(),
      ROTULOS,
    );
    expect(col(h, "estado_del_pago")).toEqual({ tipo: "texto", valor: "ANULADO" });
    expect(col(h, "importe_abonado")).toEqual({ tipo: "decimal", valor: "0.00", decimales: 2 });
  });

  it("una nota de crédito sale con sus importes tal como el comprobante y Signo -1; el débito, 1", () => {
    const nc = armarCabecera(
      [compra({ comprobante: factura({ tipo: "NOTA_CREDITO_B" }) })],
      new Map(),
      ROTULOS,
    );
    expect(col(nc, "tipo")).toEqual({ tipo: "texto", valor: "NOTA_DE_CREDITO" });
    expect(col(nc, "letra")).toEqual({ tipo: "texto", valor: "B" });
    expect(col(nc, "signo")).toEqual({ tipo: "entero", valor: -1 });
    expect(col(nc, "total_segun_factura")).toEqual({
      tipo: "decimal",
      valor: "294208.90",
      decimales: 2,
    });
    const nd = armarCabecera(
      [compra({ comprobante: factura({ tipo: "NOTA_DEBITO_C" }) })],
      new Map(),
      ROTULOS,
    );
    expect(col(nd, "signo")).toEqual({ tipo: "entero", valor: 1 });
  });

  it("solo salen las compras de la Cabecera (la fecha del comprobante o la de negocio dentro del período)", () => {
    const h = armarCabecera(
      [compra(), compra({ recepcionId: "r2", numero: 8, enCabecera: false })],
      new Map(),
      ROTULOS,
    );
    expect(h.filas).toHaveLength(1);
  });
});

describe("el Detalle", () => {
  it("una fila por línea con cantidades de 4 decimales, precio de 6, el costo por kilo derivado junto a lo cargado y el importe vacío si no hay precio", () => {
    const h = armarDetalle(
      [
        compra({
          lineas: [
            linea(),
            linea({
              numero: 2,
              productoId: "p2",
              importeVigente: null,
              precio: null,
              precioPorTipo: null,
              unidadDePrecioSimbolo: null,
            }),
          ],
        }),
      ],
      ROTULOS,
    );
    expect(h.filas).toHaveLength(2);
    expect(col(h, "cantidad_de_compra")).toEqual({
      tipo: "decimal",
      valor: "20.0000",
      decimales: 4,
    });
    expect(col(h, "precio")).toEqual({ tipo: "decimal", valor: "13312.620000", decimales: 6 });
    expect(col(h, "precio_por")).toEqual({ tipo: "texto", valor: "UNIDAD" });
    expect(col(h, "importe_vigente")).toEqual({
      tipo: "decimal",
      valor: "266252.40",
      decimales: 2,
    });
    expect(col(h, "costo_por_unidad_de_stock")).toEqual({
      tipo: "decimal",
      valor: "13.312620",
      decimales: 6,
    });
    // 266.252,40 / 20 kg = 13.312,62 por kilo.
    expect(col(h, "costo_por_kilo_derivado")).toEqual({
      tipo: "decimal",
      valor: "13312.620000",
      decimales: 6,
    });
    expect(col(h, "importe_vigente", 1)).toBeNull();
    expect(col(h, "costo_por_kilo_derivado", 1)).toBeNull();
    expect(col(h, "precio_por", 1)).toBeNull();
    expect(col(h, "moneda")).toEqual({ tipo: "texto", valor: "ARS" });
    expect(col(h, "producto")).toEqual({ tipo: "texto", valor: "Bife angosto" });
    expect(col(h, "codigo_del_producto")).toEqual({ tipo: "texto", valor: "BA" });
    expect(col(h, "clasificacion")).toEqual({ tipo: "texto", valor: "Carnes" });
    expect(col(h, "unidad_de_compra")).toEqual({ tipo: "texto", valor: "kg" });
    expect(col(h, "unidad_de_stock")).toEqual({ tipo: "texto", valor: "g" });
    expect(col(h, "unidad_de_precio")).toEqual({ tipo: "texto", valor: "kg" });
    expect(col(h, "tipo")).toEqual({ tipo: "texto", valor: "FACTURA" });
    expect(col(h, "letra")).toEqual({ tipo: "texto", valor: "A" });
    expect(col(h, "estado_del_pago")).toEqual({ tipo: "texto", valor: "PENDIENTE" });
  });

  it("si lo que entra al stock no se puede leer como cantidad, el costo por kilo queda vacío (no se inventa)", () => {
    const h = armarDetalle([compra({ lineas: [linea({ cantidadEnStock: "abc" })] })], ROTULOS);
    expect(col(h, "costo_por_kilo_derivado")).toBeNull();
  });

  it("el costo por kilo usa el peso real cuando lo hay y se deja vacío si la unidad no es de masa", () => {
    const conPeso = armarDetalle(
      [
        compra({
          lineas: [
            linea({
              unidadDeCompraId: "UNIDAD",
              pesoReal: "4.0000",
              cantidadDeCompra: "1.0000",
              importeVigente: "100.00",
            }),
          ],
        }),
      ],
      ROTULOS,
    );
    // La unidad de compra es UNIDAD (no es de masa): el peso real no se convierte, queda vacío.
    expect(col(conPeso, "costo_por_kilo_derivado")).toBeNull();
    const enCajas = armarDetalle(
      [
        compra({
          lineas: [
            linea({
              unidadDeCompraId: "UNIDAD",
              unidadDeStockId: "UNIDAD",
              unidadDeStockSimbolo: "u",
              cantidadEnStock: "12.0000",
            }),
          ],
        }),
      ],
      ROTULOS,
    );
    expect(col(enCajas, "costo_por_kilo_derivado")).toBeNull();
  });

  it("precio por presentación: sale el nombre de la presentación", () => {
    const h = armarDetalle(
      [compra({ lineas: [linea({ precioPorTipo: "PRESENTACION", presentacionNombre: "Caja" })] })],
      ROTULOS,
    );
    expect(col(h, "precio_por")).toEqual({ tipo: "texto", valor: "Caja" });
  });

  it("solo salen las líneas de las compras cuyo período es el del Detalle (la fecha de negocio)", () => {
    const h = armarDetalle([compra({ enDetalle: false })], ROTULOS);
    expect(h.filas).toHaveLength(0);
  });
});

describe("el Resumen", () => {
  it("agrupa por sucursal × producto × unidad de compra: kilos y cajas del mismo producto NO se suman", () => {
    const h = armarResumen([
      compra({
        lineas: [
          linea(),
          linea({
            numero: 2,
            unidadDeCompraId: "UNIDAD",
            unidadDeCompraSimbolo: "u",
            cantidadDeCompra: "3.0000",
            importeVigente: "30.00",
          }),
        ],
      }),
      compra({
        recepcionId: "r2",
        numero: 8,
        lineas: [linea({ cantidadDeCompra: "5.0000", importeVigente: "100.00" })],
      }),
    ]);
    expect(h.filas).toHaveLength(2);
    const kilos = h.filas.findIndex(
      (f) => (f[h.columnas.indexOf("unidad_de_compra")] as { valor: string }).valor === "kg",
    );
    expect(col(h, "cantidad_de_compra", kilos)).toEqual({
      tipo: "decimal",
      valor: "25.0000",
      decimales: 4,
    });
    expect(col(h, "importe_vigente", kilos)).toEqual({
      tipo: "decimal",
      valor: "266352.40",
      decimales: 2,
    });
    expect(col(h, "compras", kilos)).toEqual({ tipo: "entero", valor: 2 });
    expect(col(h, "renglones", kilos)).toEqual({ tipo: "entero", valor: 2 });
    const cajas = 1 - kilos;
    expect(col(h, "cantidad_de_compra", cajas)).toEqual({
      tipo: "decimal",
      valor: "3.0000",
      decimales: 4,
    });
  });

  it("una línea sin precio no entra al importe y se cuenta aparte; si todas están sin precio, el importe queda vacío (nunca cero)", () => {
    const parcial = armarResumen([
      compra({ lineas: [linea(), linea({ numero: 2, productoId: "p1", importeVigente: null })] }),
    ]);
    expect(col(parcial, "importe_vigente")).toEqual({
      tipo: "decimal",
      valor: "266252.40",
      decimales: 2,
    });
    expect(col(parcial, "renglones_sin_precio")).toEqual({ tipo: "entero", valor: 1 });
    const ninguna = armarResumen([compra({ lineas: [linea({ importeVigente: null })] })]);
    expect(col(ninguna, "importe_vigente")).toBeNull();
    expect(col(ninguna, "renglones_sin_precio")).toEqual({ tipo: "entero", valor: 1 });
  });

  it("suma el abonado derivado exacto en centavos; sin reparto posible queda vacío", () => {
    const h = armarResumen([
      compra({
        lineas: [
          linea({ importeAbonadoDerivado: "100.01" }),
          linea({ numero: 2, importeAbonadoDerivado: "200.02" }),
        ],
      }),
    ]);
    expect(col(h, "importe_abonado_derivado")).toEqual({
      tipo: "decimal",
      valor: "300.03",
      decimales: 2,
    });
    expect(col(armarResumen([compra()]), "importe_abonado_derivado")).toBeNull();
  });

  it("las compras que no son del período del Detalle no entran al Resumen; suma lo que entra al stock y cuenta bien con y sin precio", () => {
    const h = armarResumen([
      compra({ enDetalle: false }),
      compra({
        recepcionId: "r2",
        numero: 8,
        lineas: [linea({ cantidadEnStock: "5000.0000", importeAbonadoDerivado: "10.00" })],
      }),
      compra({
        recepcionId: "r3",
        numero: 9,
        lineas: [linea({ cantidadEnStock: "2500.5000", importeVigente: null })],
      }),
    ]);
    expect(h.filas).toHaveLength(1);
    expect(col(h, "cantidad_en_stock")).toEqual({
      tipo: "decimal",
      valor: "7500.5000",
      decimales: 4,
    });
    expect(col(h, "renglones")).toEqual({ tipo: "entero", valor: 2 });
    expect(col(h, "renglones_sin_precio")).toEqual({ tipo: "entero", valor: 1 });
    expect(col(h, "importe_vigente")).toEqual({
      tipo: "decimal",
      valor: "266252.40",
      decimales: 2,
    });
    expect(col(h, "importe_abonado_derivado")).toEqual({
      tipo: "decimal",
      valor: "10.00",
      decimales: 2,
    });
    expect(col(h, "moneda")).toEqual({ tipo: "texto", valor: "ARS" });
    expect(col(h, "unidad_de_stock")).toEqual({ tipo: "texto", valor: "g" });
  });

  it("el orden es por sucursal, después producto y después unidad de compra (y los iguales siguen al siguiente criterio)", () => {
    const l = (producto: string, unidad: string) =>
      linea({
        productoId: `${producto}-${unidad}`,
        productoNombre: producto,
        unidadDeCompraId: unidad,
        unidadDeCompraSimbolo: unidad,
      });
    const h = armarResumen([
      compra({ sucursalId: "s2", sucursalNombre: "Norte", lineas: [l("Arroz", "kg")] }),
      compra({
        recepcionId: "r2",
        numero: 8,
        lineas: [l("Zanahoria", "kg"), l("Arroz", "u"), l("Arroz", "kg"), l("Bife", "kg")],
      }),
    ]);
    const orden = h.filas.map((f) =>
      [0, 1, 2].map((i) => (f[i] as { valor: string }).valor).join("|"),
    );
    expect(orden).toEqual([
      "Casa central|Arroz|kg",
      "Casa central|Arroz|u",
      "Casa central|Bife|kg",
      "Casa central|Zanahoria|kg",
      "Norte|Arroz|kg",
    ]);
  });

  it("dos sucursales con el mismo producto son dos filas", () => {
    const h = armarResumen([
      compra(),
      compra({ recepcionId: "r2", numero: 8, sucursalId: "s2", sucursalNombre: "Norte" }),
    ]);
    expect(h.filas.map((f) => (f[0] as { valor: string }).valor)).toEqual([
      "Casa central",
      "Norte",
    ]);
  });
});
