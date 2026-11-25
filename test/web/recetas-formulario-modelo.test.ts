import { describe, expect, it } from "vitest";
import {
  armarElFormulario,
  armarLaConfirmacion,
  sinCerosDeRelleno,
  textosDelFormulario,
  unidadesDelFormulario,
  type EntradaDelFormulario,
} from "../../apps/web/ui/plantillas/recetas/modelo-de-formulario-de-receta";

/**
 * El modelo del formulario de la receta: lo que se arma para crear o editar y lo que se muestra al confirmar, y nada más. Previene: un ceros de relleno que el campo numérico no admite, una unidad
 * elegida por el navegador, un producto elegido que no se ofrece, un costo que pasa por `Number` o un cero donde falta el costo, y un texto armado a mano en lugar del aprobado.
 */
const P1 = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const P2 = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";
const HARINA = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const SAL = "3e2c9d4b-5f60-4b82-9dae-2f3a4b5c6d7e";
const VIEJO = "4f3dae5c-6071-4c93-8ebf-3a4b5c6d7e8f";

const base: EntradaDelFormulario = {
  producto: null,
  productos: [
    { productoId: P1, nombre: "Pizza" },
    { productoId: P2, nombre: "Flan" },
  ],
  productoElegido: "",
  ingredientes: [
    { productoId: HARINA, nombre: "Harina", unidadId: "KILOGRAMO" },
    { productoId: SAL, nombre: "Sal", unidadId: "GRAMO" },
  ],
  rinde: "",
  pasos: null,
  lineas: [],
  version: 0,
};

describe("sinCerosDeRelleno", () => {
  it("saca los ceros del final de la parte decimal y el punto que queda; no toca enteros", () => {
    expect(sinCerosDeRelleno("2.5000")).toBe("2.5");
    expect(sinCerosDeRelleno("10.0000")).toBe("10");
    expect(sinCerosDeRelleno("0.0000")).toBe("0");
    expect(sinCerosDeRelleno("0.0500")).toBe("0.05");
    expect(sinCerosDeRelleno("1.2345")).toBe("1.2345");
    expect(sinCerosDeRelleno("100")).toBe("100");
    expect(sinCerosDeRelleno("")).toBe("");
  });
});

describe("armar el formulario de una receta nueva", () => {
  it("elige el producto; título «Nueva receta»; nada cargado; la próxima versión es la 1", () => {
    const f = armarElFormulario(base);
    expect(f.modo).toBe("NUEVA");
    expect(f.titulo).toBe("Nueva receta");
    expect(f.productos).toEqual([
      { valor: P1, etiqueta: "Pizza" },
      { valor: P2, etiqueta: "Flan" },
    ]);
    expect(f).toMatchObject({
      productoInicial: "",
      rinde: "",
      pasos: "",
      lineas: [],
      siguienteLinea: 0,
      versionNueva: 1,
    });
    expect(f.textos.guardarComoVersion).toBe("Guardar como versión 1");
  });

  it("el producto de la dirección queda elegido solo si es uno de los que se ofrecen", () => {
    expect(armarElFormulario({ ...base, productoElegido: P2 }).productoInicial).toBe(P2);
    expect(armarElFormulario({ ...base, productoElegido: HARINA }).productoInicial).toBe("");
    expect(armarElFormulario({ ...base, productoElegido: "../x" }).productoInicial).toBe("");
  });

  it("ofrece cada ingrediente con su unidad, y la unidad de cada uno la fija el servidor", () => {
    const f = armarElFormulario(base);
    expect(f.ofrecidos).toEqual([
      { valor: HARINA, etiqueta: "Harina (Kilogramo)" },
      { valor: SAL, etiqueta: "Sal (Gramo)" },
    ]);
    expect(unidadesDelFormulario(f)).toEqual({ [HARINA]: "KILOGRAMO", [SAL]: "GRAMO" });
  });
});

describe("armar el formulario de una receta que existe", () => {
  const editar: EntradaDelFormulario = {
    ...base,
    producto: { id: P1, nombre: "Pizza muzzarella" },
    productos: [],
    rinde: "10.0000",
    pasos: "Hornear.",
    version: 3,
    lineas: [
      {
        ingredienteId: HARINA,
        nombre: "Harina",
        unidadId: "GRAMO",
        bruto: "2500.0000",
        merma: "0.0000",
      },
      {
        ingredienteId: VIEJO,
        nombre: "Aceite viejo",
        unidadId: "LITRO",
        bruto: "0.5000",
        merma: "12.5000",
      },
    ],
  };

  it("el producto va fijo (título con su nombre, sin selector), con rinde, pasos y líneas sin ceros de relleno; la merma de cero es «sin merma»", () => {
    const f = armarElFormulario(editar);
    expect(f.modo).toBe("EDITAR");
    expect(f.titulo).toBe("Pizza muzzarella");
    expect(f.productos).toBeNull();
    expect(f).toMatchObject({ rinde: "10", pasos: "Hornear.", siguienteLinea: 2, versionNueva: 4 });
    expect(f.lineas).toEqual([
      { clave: "l0", ingredienteId: HARINA, bruto: "2500", merma: "" },
      { clave: "l1", ingredienteId: VIEJO, bruto: "0.5", merma: "12.5" },
    ]);
    expect(f.textos.guardarComoVersion).toBe("Guardar como versión 4");
  });

  it("la unidad con que se guardó cada línea manda sobre la que se ofrece, y un ingrediente que ya no se ofrece sigue en la receta", () => {
    const f = armarElFormulario(editar);
    expect(f.catalogo[HARINA]).toEqual({ nombre: "Harina", unidad: "Gramo", unidadId: "GRAMO" });
    expect(f.catalogo[VIEJO]).toEqual({
      nombre: "Aceite viejo",
      unidad: "Litro",
      unidadId: "LITRO",
    });
    expect(f.catalogo[SAL]).toEqual({ nombre: "Sal", unidad: "Gramo", unidadId: "GRAMO" });
    expect(unidadesDelFormulario(f)).toEqual({
      [HARINA]: "GRAMO",
      [SAL]: "GRAMO",
      [VIEJO]: "LITRO",
    });
  });

  it("sin pasos guardados el campo está vacío", () => {
    expect(armarElFormulario({ ...editar, pasos: null }).pasos).toBe("");
  });
});

describe("los textos del formulario", () => {
  it("son los ya aprobados del catálogo", () => {
    expect(textosDelFormulario(7)).toEqual({
      producto: "Producto",
      sinElegir: "Sin elegir",
      rinde: "Rinde",
      ingredientes: "Ingredientes",
      bruto: "Bruto",
      merma: "Merma",
      neto: "Neto",
      pasos: "Pasos",
      agregar: "Agregar",
      quitar: "Quitar",
      guardar: "Guardar",
      guardarComoVersion: "Guardar como versión 7",
      volverAEditar: "Volver a editar",
      cancelar: "Cancelar",
      costoAntes: "Costo antes",
      costoAhora: "Costo ahora",
      diferencia: "Diferencia",
      sinCosto: "Sin costo",
    });
  });
});

describe("la confirmación", () => {
  const f = armarElFormulario({
    ...base,
    ingredientes: [
      { productoId: HARINA, nombre: "Harina", unidadId: "KILOGRAMO" },
      { productoId: SAL, nombre: "Sal", unidadId: "GRAMO" },
    ],
  });
  const estado = {
    rinde: "10",
    pasos: "  Hornear.  ",
    lineas: [
      { clave: "l0", ingredienteId: HARINA, bruto: "2.5", merma: "10" },
      { clave: "l1", ingredienteId: SAL, bruto: "30", merma: "" },
    ],
  };

  it("la receta final: rinde, cada ingrediente con su bruto y, si hay merma, merma y neto; los pasos recortados", () => {
    const c = armarLaConfirmacion(estado, f, { netos: { [HARINA]: "2.2500", [SAL]: "30.0000" } });
    expect(c.rinde).toEqual({ rotulo: "Rinde", valor: "10" });
    expect(c.ingredientes.rotulo).toBe("Ingredientes");
    expect(c.filas).toEqual([
      {
        clave: "l0",
        nombre: "Harina",
        detalle: "Bruto 2,5 Kilogramo · Merma 10 % · Neto 2,25 Kilogramo",
      },
      { clave: "l1", nombre: "Sal", detalle: "Bruto 30 Gramo" },
    ]);
    expect(c.pasos).toEqual({ rotulo: "Pasos", texto: "Hornear." });
    expect(c.costos).toEqual([]);
  });

  it("una merma de cero escrita («0», «0,0») es sin merma: ni merma ni neto", () => {
    const c = armarLaConfirmacion(
      { ...estado, lineas: [{ clave: "l0", ingredienteId: HARINA, bruto: "1", merma: "0" }] },
      f,
      { netos: { [HARINA]: "1.0000" } },
    );
    expect(c.filas[0]?.detalle).toBe("Bruto 1 Kilogramo");
  });

  it("sin vista (no se pudo calcular) igual muestra la receta, sin neto ni costos; sin pasos no hay sección", () => {
    const c = armarLaConfirmacion({ ...estado, pasos: "  " }, f, null);
    expect(c.filas[0]?.detalle).toBe("Bruto 2,5 Kilogramo · Merma 10 %");
    expect(c.pasos).toBeNull();
    expect(c.costos).toEqual([]);
  });

  it("al crear: solo «Costo ahora», a 2 decimales (mitad hacia arriba) y destacado", () => {
    const c = armarLaConfirmacion(estado, f, { netos: {}, costos: { ahora: "333.335000" } });
    expect(c.costos).toEqual([{ rotulo: "Costo ahora", valor: "$ 333,34", fuerte: true }]);
  });

  it("al editar: antes, ahora y la diferencia con su signo, exactos", () => {
    const c = armarLaConfirmacion(estado, f, {
      netos: {},
      costos: { antes: "1000.000000", ahora: "1234.565000", diferencia: "234.565000" },
    });
    expect(c.costos).toEqual([
      { rotulo: "Costo antes", valor: "$ 1.000,00", fuerte: false },
      { rotulo: "Costo ahora", valor: "$ 1.234,57", fuerte: true },
      { rotulo: "Diferencia", valor: "$ 234,57", fuerte: false },
    ]);
    const baja = armarLaConfirmacion(estado, f, {
      netos: {},
      costos: { antes: "1234.565000", ahora: "1000.000000", diferencia: "-234.565000" },
    });
    expect(baja.costos[2]).toEqual({ rotulo: "Diferencia", valor: "-$ 234,57", fuerte: false });
  });

  it("un costo que falta dice «Sin costo», nunca cero, y la diferencia tampoco se inventa", () => {
    const c = armarLaConfirmacion(estado, f, {
      netos: {},
      costos: { antes: null, ahora: null, diferencia: null },
    });
    expect(c.costos.map((x) => x.valor)).toEqual(["Sin costo", "Sin costo", "Sin costo"]);
    expect(JSON.stringify(c)).not.toContain("$ 0");
  });

  it("una diferencia de cero es un cero verdadero, no «Sin costo»", () => {
    const c = armarLaConfirmacion(estado, f, {
      netos: {},
      costos: { antes: "5.000000", ahora: "5.000000", diferencia: "0.000000" },
    });
    expect(c.costos[2]?.valor).toBe("$ 0,00");
  });

  it("un ingrediente que el catálogo no conoce no rompe la confirmación (nombre vacío, unidad dicha tal cual)", () => {
    const c = armarLaConfirmacion(
      { ...estado, lineas: [{ clave: "l0", ingredienteId: VIEJO, bruto: "3", merma: "" }] },
      f,
      null,
    );
    expect(c.filas).toEqual([{ clave: "l0", nombre: "", detalle: "Bruto 3" }]);
  });
});
