import { describe, expect, it } from "vitest";
import {
  armarLaFicha,
  type FichaDeCompraParaLaPantalla,
} from "../../apps/web/ui/plantillas/compras/ficha/modelo-de-ficha-de-compra";
import {
  armarLaLista,
  numeroImpreso,
  type ListaDeComprasParaLaPantalla,
} from "../../apps/web/ui/plantillas/compras/lista/modelo-de-lista-de-compras";
import {
  direccionDeLaLista,
  rutaDeLaCompra,
} from "../../apps/web/ui/plantillas/compras/rutas-de-compras";
import { textosDeCompras } from "../../apps/web/ui/plantillas/compras/textos-de-compras";

/**
 * El modelo de vista de la lista y de la ficha de compras (Compras PR 3): una fila sin precio dice «Sin precio» y nunca «$ 0,00»; la fila facturada muestra la factura; la anulada suma «· Anulada»;
 * el modelo no calcula ningún importe. Puro: sin React ni servidor.
 */

const t = textosDeCompras();
const UUID = "0b0b0b0b-1111-4222-8333-444444444444";
const TODAS = { estado: "TODAS", desde: null, hasta: null } as const;

const compra = (cambios: Record<string, unknown> = {}) => ({
  recepcionId: UUID,
  numero: 5,
  proveedor: "Carnes del Sur",
  fechaNegocio: "2026-10-31",
  estado: "RECIBIDA_SIN_FACTURAR",
  total: { moneda: "ARS", monto: "2000.00" },
  factura: null,
  ...cambios,
});
const lista = (compras: unknown[], resto: Record<string, unknown> = {}) =>
  ({
    compras,
    siguiente: null,
    filtros: TODAS,
    ...resto,
  }) as unknown as ListaDeComprasParaLaPantalla;

describe("la lista de compras", () => {
  it("una fila sin factura dice «Recibida sin facturar» y el total en pesos con coma decimal", () => {
    const { filas } = armarLaLista(lista([compra()]), t);
    expect(filas[0]).toMatchObject({
      titulo: "Compra 5 · Carnes del Sur",
      segunda: "Recibida sin facturar",
      total: "$ 2.000,00",
      href: rutaDeLaCompra(UUID),
    });
    expect(filas[0]?.nombreAccesible).toBe(
      "Compra 5 · Carnes del Sur, Recibida sin facturar, $ 2.000,00",
    );
  });

  it("una fila con total null dice «Sin precio» y nunca cero", () => {
    const { filas } = armarLaLista(lista([compra({ total: null })]), t);
    expect(filas[0]?.total).toBe("Sin precio");
    expect(JSON.stringify(filas)).not.toContain("0,00");
  });

  it("una fila facturada muestra el nombre de la factura con su número impreso", () => {
    const { filas } = armarLaLista(
      lista([
        compra({
          estado: "RECIBIDA_Y_FACTURADA",
          factura: { letra: "A", puntoDeVenta: 4, numero: 5678 },
        }),
      ]),
      t,
    );
    expect(filas[0]?.segunda).toBe("Factura A 00004-00005678");
  });

  it("una fila anulada suma « · Anulada» a su segunda línea", () => {
    const { filas } = armarLaLista(lista([compra({ estado: "ANULADA" })]), t);
    expect(filas[0]?.segunda).toBe("Recibida sin facturar · Anulada");
  });

  it("un proveedor que no se puede mostrar sale «—»", () => {
    const { filas } = armarLaLista(lista([compra({ proveedor: null })]), t);
    expect(filas[0]?.titulo).toBe("Compra 5 · —");
  });

  it("los chips son «Todas» y «Sin facturar» y marcan el filtro aplicado", () => {
    const armada = armarLaLista(
      lista([compra()], { filtros: { estado: "SIN_FACTURAR", desde: null, hasta: null } }),
      t,
    );
    expect(armada.estados.map((e) => e.etiqueta)).toEqual(["Todas", "Sin facturar"]);
    expect(armada.filtro.estado).toBe("SIN_FACTURAR");
  });

  it("vacía: «Sin resultados» y «Ver todas» (que vuelve a la lista sin filtros)", () => {
    const armada = armarLaLista(
      lista([], { filtros: { estado: "SIN_FACTURAR", desde: "2026-11-01", hasta: null } }),
      t,
    );
    expect(armada.filas).toEqual([]);
    expect(armada.vacio).toEqual({
      texto: "Sin resultados",
      verTodas: { texto: "Ver todas", href: "/compras" },
    });
    expect(armarLaLista(lista([compra()]), t).vacio).toBeNull();
  });

  it("«Página siguiente» solo si hay cursor y conserva el filtro aplicado", () => {
    expect(armarLaLista(lista([compra()]), t).paginaSiguiente).toBeNull();
    const armada = armarLaLista(
      lista([compra()], {
        siguiente: "2026-10-31|7",
        filtros: { estado: "SIN_FACTURAR", desde: "2026-10-01", hasta: "2026-10-31" },
      }),
      t,
    );
    expect(armada.paginaSiguiente).toEqual({
      texto: "Página siguiente",
      href: "/compras?estado=SIN_FACTURAR&desde=2026-10-01&hasta=2026-10-31&despues=2026-10-31%7C7",
    });
  });
});

describe("las direcciones", () => {
  it("la lista sin filtro es /compras; solo viaja lo que se aparta del valor por defecto", () => {
    expect(direccionDeLaLista(TODAS, null)).toBe("/compras");
    expect(direccionDeLaLista({ estado: "SIN_FACTURAR", desde: null, hasta: null }, null)).toBe(
      "/compras?estado=SIN_FACTURAR",
    );
  });
  it("el número impreso lleva cinco dígitos de punto de venta y ocho de número", () => {
    expect(numeroImpreso(1, 45)).toBe("00001-00000045");
  });
});

const ficha = (cambios: Record<string, unknown> = {}) =>
  ({
    recepcionId: UUID,
    numero: 5,
    proveedor: "Carnes del Sur",
    fechaNegocio: "2026-10-31",
    estado: "RECIBIDA_SIN_FACTURAR",
    remito: null,
    registradaPor: "ana@ejemplo.com",
    registradaEn: "2026-11-01T00:14:00.000Z",
    anulacion: null,
    lineas: [
      {
        numero: 1,
        producto: "Bife de chorizo",
        cantidadDeCompra: "2.0000",
        presentacion: "Caja",
        unidadDeCompraId: "KILOGRAMO",
        cantidadEnStock: "46.6000",
        unidadDeStockId: "KILOGRAMO",
        importe: { moneda: "ARS", monto: "512600.00" },
        costoPorUnidadDeStock: { moneda: "ARS", monto: "11000.000000" },
      },
    ],
    total: { moneda: "ARS", monto: "512600.00" },
    factura: null,
    ...cambios,
  }) as unknown as FichaDeCompraParaLaPantalla;

describe("la ficha de una compra", () => {
  it("título, proveedor y fecha DD/MM/AAAA, línea con lo que entra al stock y el costo por unidad de stock", () => {
    const f = armarLaFicha(ficha(), t);
    expect(f.titulo).toBe("Compra 5");
    expect(f.anulada).toBeNull();
    expect(f.proveedorYFecha).toBe("Carnes del Sur · 31/10/2026");
    expect(f.lineas).toEqual([
      {
        clave: 1,
        nombre: "Bife de chorizo",
        importe: "$ 512.600,00",
        cantidad: "2 Caja · Entra a tu stock: 46,6 Kilogramo",
        costo: "Costo por unidad de stock: $ 11.000,00",
      },
    ]);
    expect(f.total).toEqual({ rotulo: "Total", valor: "$ 512.600,00" });
    expect(f.remito.rotulo).toBe("Sin remito");
    expect(f.factura).toBeNull();
    expect(f.quien).toBe("ana@ejemplo.com · 31/10/2026 21:14");
    expect(f.volver).toEqual({ texto: "Volver", href: "/compras" });
  });

  it("sin presentación la cantidad va en la unidad de compra", () => {
    const f = armarLaFicha(
      ficha({
        lineas: [
          {
            ...(ficha().lineas[0] as object),
            presentacion: null,
            cantidadDeCompra: "3.5000",
          },
        ],
      }),
      t,
    );
    expect(f.lineas[0]?.cantidad).toBe("3,5 Kilogramo · Entra a tu stock: 46,6 Kilogramo");
  });

  it("una línea sin precio dice «Sin precio», no muestra costo y el total también", () => {
    const f = armarLaFicha(
      ficha({
        lineas: [{ ...(ficha().lineas[0] as object), importe: null, costoPorUnidadDeStock: null }],
        total: null,
      }),
      t,
    );
    expect(f.lineas[0]?.importe).toBe("Sin precio");
    expect(f.lineas[0]?.costo).toBeNull();
    expect(f.total.valor).toBe("Sin precio");
    expect(JSON.stringify(f)).not.toContain("0,00");
  });

  it("el remito se muestra con su número y fecha", () => {
    const f = armarLaFicha(
      ficha({ remito: { puntoDeVenta: 1, numero: 45, fecha: "2026-10-30" } }),
      t,
    );
    expect(f.remito).toEqual({
      rotulo: "Remito del proveedor",
      valor: "00001-00000045 · 30/10/2026",
    });
  });

  it("anulada: marca «Anulada», motivo, quién y cuándo", () => {
    const f = armarLaFicha(
      ficha({
        estado: "ANULADA",
        anulacion: {
          motivo: "Se cargó por error",
          hechaPor: "bea@ejemplo.com",
          hechaEn: "2026-11-02T15:00:00.000Z",
        },
      }),
      t,
    );
    expect(f.anulada).toBe("Anulada");
    expect(f.anulacion).toEqual({
      rotulo: "Motivo",
      motivo: "Se cargó por error",
      quien: "bea@ejemplo.com · 02/11/2026 12:00",
    });
  });

  it("con factura: su nombre, fechas con «Vence» y el total; sin ella no hay tarjeta", () => {
    const f = armarLaFicha(
      ficha({
        estado: "RECIBIDA_Y_FACTURADA",
        factura: {
          letra: "A",
          puntoDeVenta: 2,
          numero: 1187,
          fecha: "2026-10-31",
          vencimientoDePago: "2026-11-30",
          totalSegunLaFactura: { moneda: "ARS", monto: "29225040.00" },
        },
      }),
      t,
    );
    expect(f.factura).toEqual({
      titulo: "Factura A 00002-00001187",
      fechas: "31/10/2026 · Vence 30/11/2026",
      rotuloDelTotal: "Total",
      total: "$ 29.225.040,00",
    });
  });

  it("sin correo no se dibuja «quién»: nunca un nombre inventado", () => {
    expect(armarLaFicha(ficha({ registradaPor: null }), t).quien).toBeNull();
  });
});
