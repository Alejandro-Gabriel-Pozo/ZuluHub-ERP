import { describe, expect, it } from "vitest";
import { CLASES_DE_USO } from "../../src/modulos/catalogo/publico";
import { ALICUOTAS_DEL_PRODUCTO } from "../../src/modulos/fiscal/publico";
import {
  CLAVE_DE_ALICUOTA,
  RUTA_DE_PRODUCTOS,
  armarLaFicha,
  rutaDeLaFicha,
  type FichaDeLaPantalla,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-ficha-de-producto";

/**
 * El modelo de vista de la ficha de datos de un producto (A1, T2a; maqueta `productos.html`, solapa «Datos»), con los textos reales del catálogo: qué campos salen según la
 * clase, con qué rótulo y en qué estado. Previene: una alícuota que el producto ofrece sin su texto, una clase sin su texto y un dato guardado que un desplegable no ofrece y que
 * «Guardar» borraría en silencio.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OFRECIDAS = ["21", "10.5", "27", "5", "2.5", "0"];

const ficha = (cambios: Partial<FichaDeLaPantalla> = {}): FichaDeLaPantalla => ({
  id: ID,
  version: 4,
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  seVende: true,
  nombreDeCocina: "MILA",
  codigo: "MIL-1",
  codigoDeBarras: "12345678",
  alicuota: "10.5",
  seccionDeCartaId: SECCION,
  alicuotas: OFRECIDAS,
  secciones: [
    { id: SECCION, nombre: "Minutas" },
    { id: "otra", nombre: "Bebidas" },
  ],
  ...cambios,
});

describe("las alícuotas de la pantalla coinciden con las que ofrece el módulo fiscal", () => {
  it("la misma lista, cada una con su texto del catálogo", () => {
    // El orden en que se ven lo da la lista del módulo (`alicuotas`); la tabla de claves solo tiene que cubrirlas todas, ni una más ni una menos.
    expect(Object.keys(CLAVE_DE_ALICUOTA).sort()).toEqual([...ALICUOTAS_DEL_PRODUCTO].sort());
    const f = armarLaFicha(ficha({ alicuotas: [...ALICUOTAS_DEL_PRODUCTO], alicuota: null }));
    expect(f.alicuota?.opciones.map((o) => o.etiqueta)).toEqual([
      "21 %",
      "10,5 %",
      "27 %",
      "5 %",
      "2,5 %",
      "0 %",
    ]);
  });

  it("las cinco clases tienen su texto", () => {
    const textos = CLASES_DE_USO.map((c) => armarLaFicha(ficha({ claseDeUso: c })).clase.valor);
    expect(textos).toEqual([
      "Materia prima",
      "Insumo",
      "Reventa",
      "Elaborado",
      "Producto vendible",
    ]);
  });
});

describe("armarLaFicha de un producto que se vende", () => {
  const f = armarLaFicha(ficha());

  it("trae el título, el id y la versión que la acción va a llevar", () => {
    expect([f.titulo, f.id, f.version]).toEqual(["Milanesa", ID, 4]);
  });

  it("la clase y la unidad solo se ven, con su rótulo aprobado", () => {
    expect(f.clase).toEqual({ etiqueta: "¿Qué es?", valor: "Producto vendible" });
    expect(f.unidad).toEqual({ etiqueta: "Unidad", valor: "UNIDAD" });
  });

  it("los campos llevan los rótulos y valores de la maqueta", () => {
    expect(f.nombre).toEqual({ etiqueta: "Nombre", valor: "Milanesa" });
    expect(f.nombreDeCocina).toEqual({ etiqueta: "Nombre de cocina", valor: "MILA" });
    expect(f.codigo).toEqual({ etiqueta: "Código interno", valor: "MIL-1" });
    expect(f.codigoDeBarras).toEqual({ etiqueta: "Código de barras", valor: "12345678" });
    expect(f.textoDeElegir).toBe("Sin elegir");
    expect(f.guardar).toBe("Guardar");
  });

  it("la alícuota ofrece las seis, con la guardada elegida y el desplegable activo", () => {
    expect(f.alicuota).toMatchObject({
      etiqueta: "Alícuota de IVA",
      valor: "10.5",
      apagado: false,
    });
    expect(f.alicuota?.opciones).toHaveLength(6);
    expect(f.alicuota?.opciones[1]).toEqual({ valor: "10.5", etiqueta: "10,5 %" });
  });

  it("la sección ofrece las activas, con la guardada elegida", () => {
    expect(f.seccion).toEqual({
      etiqueta: "Sección de la carta",
      valor: SECCION,
      opciones: [
        { valor: SECCION, etiqueta: "Minutas" },
        { valor: "otra", etiqueta: "Bebidas" },
      ],
      apagado: false,
    });
  });

  it("lo que no tiene valor sale vacío (el desplegable, en «Sin elegir»)", () => {
    const vacia = armarLaFicha(
      ficha({
        nombreDeCocina: null,
        codigo: null,
        codigoDeBarras: null,
        alicuota: null,
        seccionDeCartaId: null,
      }),
    );
    expect(vacia.nombreDeCocina?.valor).toBe("");
    expect(vacia.codigo.valor).toBe("");
    expect(vacia.codigoDeBarras.valor).toBe("");
    expect(vacia.alicuota).toMatchObject({ valor: "", apagado: false });
    expect(vacia.seccion).toMatchObject({ valor: "", apagado: false });
  });
});

describe("armarLaFicha de un producto que no se vende", () => {
  it("no lleva nombre de cocina, alícuota ni sección; sí el nombre y los códigos", () => {
    const f = armarLaFicha(
      ficha({
        claseDeUso: "MATERIA_PRIMA",
        seVende: false,
        nombreDeCocina: null,
        alicuota: null,
        seccionDeCartaId: null,
      }),
    );
    expect(f.nombreDeCocina).toBeNull();
    expect(f.alicuota).toBeNull();
    expect(f.seccion).toBeNull();
    expect(f.nombre.valor).toBe("Milanesa");
    expect(f.codigo.valor).toBe("MIL-1");
    expect(f.codigoDeBarras.valor).toBe("12345678");
  });
});

describe("un valor guardado que la pantalla no ofrece", () => {
  it("una alícuota que el producto ya no ofrece (Exento) se ve con su valor y el desplegable sale apagado", () => {
    const f = armarLaFicha(ficha({ alicuota: "EXENTO" }));
    expect(f.alicuota?.apagado).toBe(true);
    expect(f.alicuota?.valor).toBe("EXENTO");
    expect(f.alicuota?.opciones.at(-1)).toEqual({ valor: "EXENTO", etiqueta: "EXENTO" });
    expect(f.alicuota?.opciones).toHaveLength(7);
  });

  it("una sección desactivada (no está entre las activas) se ve y el desplegable sale apagado", () => {
    const f = armarLaFicha(ficha({ seccionDeCartaId: "desactivada" }));
    expect(f.seccion?.apagado).toBe(true);
    expect(f.seccion?.valor).toBe("desactivada");
    expect(f.seccion?.opciones.at(-1)).toEqual({ valor: "desactivada", etiqueta: "desactivada" });
    expect(f.seccion?.opciones).toHaveLength(3);
  });

  it("una clase desconocida se dice con su propio valor (no se esconde)", () => {
    expect(armarLaFicha(ficha({ claseDeUso: "SERVICIO" })).clase.valor).toBe("SERVICIO");
    for (const heredado of ["toString", "constructor", "__proto__"]) {
      expect(armarLaFicha(ficha({ claseDeUso: heredado })).clase.valor).toBe(heredado);
    }
  });

  it("una alícuota heredada de Object.prototype no se confunde con una conocida", () => {
    const f = armarLaFicha(ficha({ alicuota: "constructor" }));
    expect(f.alicuota?.apagado).toBe(true);
  });
});

describe("las direcciones", () => {
  it("la ficha vive bajo la lista de productos", () => {
    expect(RUTA_DE_PRODUCTOS).toBe("/catalogo/productos");
    expect(rutaDeLaFicha(ID)).toBe(`/catalogo/productos/${ID}`);
  });
});
