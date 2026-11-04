import type { FacturaParaAnular } from "../../apps/web/ui/plantillas/facturacion/eleccion-de-anulacion";

/**
 * Apoyo de las pruebas de la pantalla de anular por importe: la factura del prototipo aprobado el 2026-10-29 («Factura B
 * 00001-00000123 · Juan Pérez», $ 90.750,00: $ 60.500,00 con IVA 21 % y $ 30.250,00 con IVA 10,5 %) y la factura C del mismo
 * prototipo (`OpcionB.dc.html`, «Factura C 00002-00000045 · Marta Gómez», $ 45.000,00). No es una prueba.
 */

export const ID_FACTURA = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

export const factura: FacturaParaAnular = {
  id: ID_FACTURA,
  tipo: "FACTURA_B",
  estado: "AUTORIZADO",
  numero: "00001-00000123",
  concepto: "PRODUCTOS",
  servicio: null,
  importes: { total: "90750.00" },
  alicuotas: [
    { alicuota: "21", total: "60500.00" },
    { alicuota: "10.5", total: "30250.00" },
  ],
  receptor: { nombre: "Juan Pérez", documento: { tipo: "DNI", numero: "12345678" } },
  notasQueLoCitan: [],
  acreditado: "0.00",
};

export const facturaC: FacturaParaAnular = {
  ...factura,
  id: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c",
  tipo: "FACTURA_C",
  numero: "00002-00000045",
  importes: { total: "45000.00" },
  alicuotas: [],
  receptor: { nombre: "Marta Gómez", documento: { tipo: "DNI", numero: "23456789" } },
};

export const conFactura = (cambios: Partial<FacturaParaAnular>): FacturaParaAnular => ({
  ...factura,
  ...cambios,
});

export const notaAnterior = (
  id: string,
  estado: FacturaParaAnular["estado"],
  total: string,
  numero: string | null = "00001-00000012",
): FacturaParaAnular["notasQueLoCitan"][number] => ({
  id,
  tipo: "NOTA_CREDITO_B",
  numero,
  total,
  estado,
});
