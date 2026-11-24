import { describe, expect, it } from "vitest";
import {
  armarLaFicha,
  rotuloDelPrecio,
  type FichaDeCompraParaLaPantalla,
} from "../../apps/web/ui/plantillas/compras/ficha/modelo-de-ficha-de-compra";
import { textosDeCompras } from "../../apps/web/ui/plantillas/compras/textos-de-compras";

/**
 * Compras PR 10: el modelo de la ficha con «Corregir» y «Anular» (puro). Nace cerrado: sin permisos no hay botones; una línea sin precio y una compra anulada no se corrigen; las correcciones se
 * muestran con quién, cuándo, el «Antes» y el motivo; el rótulo del precio dice «por» qué se paga.
 */
const textos = textosDeCompras();
const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const pesos = (monto: string) => ({ moneda: "ARS", monto });
const linea = (numero: number, cambios: Record<string, unknown> = {}) => ({
  numero,
  producto: "Bife de chorizo",
  cantidadDeCompra: "2.0000",
  presentacion: null,
  unidadDeCompraId: "KILOGRAMO",
  cantidadEnStock: "2000.0000",
  unidadDeStockId: "GRAMO",
  importe: pesos("2000.00"),
  costoPorUnidadDeStock: pesos("1.000000"),
  precioPor: { tipo: "UNIDAD" as const, unidadId: "KILOGRAMO" },
  correccionesVistas: 0,
  correcciones: [],
  ...cambios,
});
const ficha = (cambios: Record<string, unknown> = {}): FichaDeCompraParaLaPantalla => ({
  recepcionId: ID,
  numero: 5,
  proveedor: "Carnes del Sur",
  fechaNegocio: "2026-10-31",
  estado: "RECIBIDA_SIN_FACTURAR",
  remito: null,
  registradaPor: "ana@ejemplo.com",
  registradaEn: "2026-11-01T00:14:00.000Z",
  anulacion: null,
  lineas: [linea(1), linea(2, { importe: null, costoPorUnidadDeStock: null, precioPor: null })],
  total: null,
  factura: null,
  ...cambios,
});

const TODO = { corregir: true, anular: true };

describe("la ficha de una compra con «Corregir» y «Anular»", () => {
  it("sin permisos (o sin decir nada) no hay ningún botón: todo nace cerrado", () => {
    for (const f of [
      armarLaFicha(ficha(), textos),
      armarLaFicha(ficha(), textos, { corregir: false, anular: false }),
    ]) {
      expect(f.anular).toBe(false);
      expect(f.corregirLaPrimera).toBeNull();
      expect(f.lineas.map((l) => l.corregir)).toEqual([null, null]);
    }
  });

  it("con permisos, «Corregir» va solo en la línea con precio y «Anular» al pie", () => {
    const f = armarLaFicha(ficha(), textos, TODO);
    expect(f.anular).toBe(true);
    expect(f.lineas.map((l) => l.corregir)).toEqual([`/compras/${ID}/corregir/1`, null]);
    expect(f.corregirLaPrimera).toBe(`/compras/${ID}/corregir/1`);
  });

  it("cada permiso es independiente: quien solo anula no corrige y al revés", () => {
    const soloAnula = armarLaFicha(ficha(), textos, { corregir: false, anular: true });
    expect(soloAnula.anular).toBe(true);
    expect(soloAnula.lineas[0]?.corregir).toBeNull();
    const soloCorrige = armarLaFicha(ficha(), textos, { corregir: true, anular: false });
    expect(soloCorrige.anular).toBe(false);
    expect(soloCorrige.lineas[0]?.corregir).not.toBeNull();
  });

  it("una compra anulada no ofrece ni «Corregir» ni «Anular», aunque haya permisos", () => {
    const f = armarLaFicha(
      ficha({
        estado: "ANULADA",
        anulacion: {
          motivo: "Se cargó mal",
          hechaPor: "ana@ejemplo.com",
          hechaEn: "2026-11-02T10:00:00.000Z",
        },
      }),
      textos,
      TODO,
    );
    expect(f.anular).toBe(false);
    expect(f.lineas.map((l) => l.corregir)).toEqual([null, null]);
    expect(f.corregirLaPrimera).toBeNull();
  });

  it("una línea corregida muestra quién y cuándo (la hora de Argentina), el «Antes» y el motivo", () => {
    const f = armarLaFicha(
      ficha({
        lineas: [
          linea(1, {
            correccionesVistas: 1,
            correcciones: [
              {
                numero: 1,
                precioAnterior: pesos("1000.000000"),
                precioNuevo: pesos("1200.000000"),
                motivo: "Subió el precio",
                hechaPor: "gerente@ejemplo.com",
                hechaEn: "2026-11-24T21:14:00.000Z",
              },
            ],
          }),
        ],
      }),
      textos,
    );
    expect(f.lineas[0]?.correcciones).toEqual([
      {
        clave: 1,
        quien: "Corregido por gerente@ejemplo.com · 24/11/2026 18:14",
        antes: "Antes: $ 1.000,00",
        motivo: "Subió el precio",
      },
    ]);
  });

  it("sin correo que mostrar no se dibuja la línea de «quién»; sin precio anterior no se dibuja el «Antes»", () => {
    const f = armarLaFicha(
      ficha({
        lineas: [
          linea(1, {
            correcciones: [
              {
                numero: 1,
                precioAnterior: null,
                precioNuevo: pesos("1200.000000"),
                motivo: "Se completó",
                hechaPor: null,
                hechaEn: "2026-11-24T21:14:00.000Z",
              },
            ],
          }),
        ],
      }),
      textos,
    );
    expect(f.lineas[0]?.correcciones).toEqual([
      { clave: 1, quien: null, antes: null, motivo: "Se completó" },
    ]);
  });

  it("el rótulo del precio dice por qué se paga: la presentación, la unidad o, si no se sabe, «Precio»", () => {
    expect(rotuloDelPrecio(linea(1) as never, textos)).toBe("Precio por Kilogramo");
    expect(
      rotuloDelPrecio(
        linea(1, {
          presentacion: "Caja de 12",
          precioPor: { tipo: "PRESENTACION", unidadId: null },
        }) as never,
        textos,
      ),
    ).toBe("Precio por Caja de 12");
    expect(rotuloDelPrecio(linea(1, { precioPor: null }) as never, textos)).toBe("Precio");
    expect(
      rotuloDelPrecio(
        linea(1, { precioPor: { tipo: "UNIDAD", unidadId: "UNIDAD_RARA" } }) as never,
        textos,
      ),
    ).toBe("Precio por UNIDAD_RARA");
  });
});
