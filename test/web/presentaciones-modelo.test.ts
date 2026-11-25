import { describe, expect, it } from "vitest";
import {
  armarElFormularioDePresentacion,
  armarLaListaDePresentaciones,
  rutaDeLaCompraDelProducto,
  rutaDeLaPresentacion,
  rutaDeLaPresentacionNueva,
  sePuedeGuardarLaPresentacion,
  textoDelEstado,
  type PresentacionesDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-presentaciones";

/**
 * El modelo de la solapa «Cómo se compra» (T0): lo que se ve en la lista y en los formularios, con los textos del catálogo. Lo que cambia algo sale apagado (no escondido) si la persona no puede
 * editar, y todo lo que no sea exactamente `true` cierra. Previene: un botón de escribir que aparece habilitado por un permiso que no se pudo leer, una cantidad de peso variable que se muestra como
 * exacta y un rótulo que cambia sin que lo apruebe nadie.
 */
const P = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const A = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const B = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const DATO: PresentacionesDeLaPantalla = {
  producto: { id: P, nombre: "Queso cremoso", unidadBase: "kg", activo: true },
  presentaciones: [
    {
      id: A,
      nombre: "Caja de 5 kg",
      cantidad: "5.0000",
      dePesoVariable: false,
      activa: true,
      version: 1,
    },
    { id: B, nombre: "Horma", cantidad: "4.2500", dePesoVariable: true, activa: false, version: 3 },
  ],
};

describe("las direcciones de la solapa", () => {
  it("cuelgan de la ficha del producto", () => {
    expect(rutaDeLaCompraDelProducto(P)).toBe(`/catalogo/productos/${P}/compra`);
    expect(rutaDeLaPresentacionNueva(P)).toBe(`/catalogo/productos/${P}/compra/nueva`);
    expect(rutaDeLaPresentacion(P, A)).toBe(`/catalogo/productos/${P}/compra/${A}`);
  });
});

describe("la lista", () => {
  it("el título es «Cómo se compra»; cada tarjeta dice su cantidad con la unidad base y «≈» si es de peso variable, y las marcas que le tocan", () => {
    const lista = armarLaListaDePresentaciones(DATO, true);
    expect(lista.titulo).toBe("Cómo se compra");
    expect(lista.vacia).toBeNull();
    expect(lista.filas).toEqual([
      {
        id: A,
        nombre: "Caja de 5 kg",
        cantidad: "5 kg",
        marcaDePesoVariable: null,
        marcaDeDesactivada: null,
        editar: { href: rutaDeLaPresentacion(P, A), texto: "Editar", apagado: false },
      },
      {
        id: B,
        nombre: "Horma",
        cantidad: "≈ 4,25 kg",
        marcaDePesoVariable: "De peso variable",
        marcaDeDesactivada: "Desactivado",
        editar: { href: rutaDeLaPresentacion(P, B), texto: "Editar", apagado: false },
      },
    ]);
    expect(lista.agregar).toEqual({
      href: rutaDeLaPresentacionNueva(P),
      texto: "Agregar presentación",
      apagado: false,
    });
  });

  it("sin presentaciones dice «Sin presentaciones» y sigue ofreciendo «Agregar presentación»", () => {
    const lista = armarLaListaDePresentaciones({ ...DATO, presentaciones: [] }, true);
    expect(lista.vacia).toBe("Sin presentaciones");
    expect(lista.filas).toEqual([]);
    expect(lista.agregar.apagado).toBe(false);
  });

  it("sin unidad legible la cantidad sale sin unidad (no se inventa una)", () => {
    const lista = armarLaListaDePresentaciones(
      { ...DATO, producto: { ...DATO.producto, unidadBase: null } },
      true,
    );
    expect(lista.filas[0]?.cantidad).toBe("5");
  });

  it("sin permiso de editar (o sin saberlo) los botones de escribir salen apagados, no escondidos", () => {
    for (const puede of [false, undefined]) {
      const lista = armarLaListaDePresentaciones(DATO, puede);
      expect(lista.agregar.apagado).toBe(true);
      expect(lista.filas.map((f) => f.editar.apagado)).toEqual([true, true]);
    }
  });
});

describe("el formulario", () => {
  const PRODUCTO = DATO.producto;
  const horma = DATO.presentaciones[1];
  const caja = DATO.presentaciones[0];

  it("agregar: nombre vacío, los dos rótulos de la misma cantidad con la unidad base, la casilla, «Agregar presentación» y «Cancelar» a la lista", () => {
    const f = armarElFormularioDePresentacion(PRODUCTO, null, true);
    expect(f).toEqual({
      modo: "ALTA",
      titulo: "Agregar presentación",
      nombre: { etiqueta: "Presentación", valorInicial: "" },
      cantidad: {
        etiqueta: "Cantidad en la unidad base (kg)",
        etiquetaDePesoAproximado: "Peso aproximado (kg)",
      },
      pesoVariable: { etiqueta: "De peso variable" },
      actual: null,
      guardar: "Agregar presentación",
      cancelar: { href: rutaDeLaCompraDelProducto(P), texto: "Cancelar" },
      puedeGuardar: true,
    });
  });

  it("editar: el título es el nombre, el nombre actual en el campo y la cantidad solo se ve (con el rótulo que le toca)", () => {
    const f = armarElFormularioDePresentacion(PRODUCTO, caja ?? null, true);
    expect(f).toMatchObject({
      modo: "EDICION",
      titulo: "Caja de 5 kg",
      nombre: { valorInicial: "Caja de 5 kg" },
      actual: { rotulo: "Cantidad en la unidad base (kg)", valor: "5", marca: null },
      guardar: "Guardar",
    });
    expect(armarElFormularioDePresentacion(PRODUCTO, horma ?? null, true).actual).toEqual({
      rotulo: "Peso aproximado (kg)",
      valor: "≈ 4,25",
      marca: "De peso variable",
    });
  });

  it("sin permiso de editar (o sin saberlo) no se puede guardar", () => {
    for (const puede of [false, undefined]) {
      expect(armarElFormularioDePresentacion(PRODUCTO, null, puede).puedeGuardar).toBe(false);
    }
  });

  it("«Guardar» se ofrece con un nombre escrito y, al agregar, con una cantidad escrita", () => {
    expect(sePuedeGuardarLaPresentacion("ALTA", "Caja", "5")).toBe(true);
    expect(sePuedeGuardarLaPresentacion("ALTA", "Caja", "")).toBe(false);
    expect(sePuedeGuardarLaPresentacion("ALTA", "   ", "5")).toBe(false);
    expect(sePuedeGuardarLaPresentacion("EDICION", "Caja", "")).toBe(true);
    expect(sePuedeGuardarLaPresentacion("EDICION", " ", "")).toBe(false);
  });

  it("el botón de estado dice «Desactivar» si está activa y «Reactivar» si no", () => {
    expect(textoDelEstado(true)).toBe("Desactivar");
    expect(textoDelEstado(false)).toBe("Reactivar");
  });
});
