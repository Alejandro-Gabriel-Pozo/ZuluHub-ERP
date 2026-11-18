import { describe, expect, it } from "vitest";
import { medidasDelSalon } from "../../src/composicion/mesas-web";
import { huellaDeMesa } from "../../src/modulos/salon/dominio/celdas";
import { FORMAS_DE_MESA, TAMANOS_DE_MESA } from "../../src/modulos/salon/dominio/mesa";
import {
  armarElFormularioDeMesa,
  armarLaListaDeMesas,
} from "../../apps/web/ui/plantillas/salon/modelo-de-mesas";
import { armarElPlano, conElBorrador } from "../../apps/web/ui/plantillas/salon/modelo-del-plano";
import { MEDIDAS_DE_PRUEBA } from "../../apps/web/ui/pruebas/ayudas-de-mesas";

/**
 * El modelo del mapa chico (S-1b, `mesas.html`): una mesa de cada forma y tamaño cae en su casilla con las casillas del dominio; lo que no se puede ubicar no se dibuja; lo que se sale o se encima
 * se dibuja donde dice (decide el servidor); las desactivadas también, atenuadas y diciendo «Desactivada». Previene: la tabla de casillas desfasada del servidor y un plano que decide validez.
 */
const medidas = medidasDelSalon();
const mesa = (extra: Partial<Parameters<typeof armarElPlano>[0]["mesas"][number]> = {}) => ({
  id: "m1",
  numero: 7,
  forma: "REDONDA",
  tamano: "CHICA",
  columna: 1,
  fila: 1,
  activa: true,
  href: null,
  ...extra,
});
const borrador = (extra = {}) => ({
  numero: "8",
  forma: "REDONDA",
  tamano: "CHICA",
  columna: "3",
  fila: "2",
  ...extra,
});

describe("plano de mesas", () => {
  it("las medidas de las pruebas de componente son las del dominio", () => {
    expect(MEDIDAS_DE_PRUEBA).toEqual(medidas);
  });

  it("las medidas salen del dominio: 14 × 9 y la huella de cada forma y tamaño", () => {
    expect([medidas.columnas, medidas.filas]).toEqual([14, 9]);
    for (const forma of FORMAS_DE_MESA) {
      for (const tamano of TAMANOS_DE_MESA) {
        expect(medidas.huellas).toContainEqual({ forma, tamano, ...huellaDeMesa(forma, tamano) });
      }
    }
    expect(medidas.huellas).toHaveLength(FORMAS_DE_MESA.length * TAMANOS_DE_MESA.length);
  });

  it("una mesa de cada forma y tamaño queda en su casilla, con su ancho y su alto", () => {
    for (const forma of FORMAS_DE_MESA) {
      for (const tamano of TAMANOS_DE_MESA) {
        const { ancho, alto } = huellaDeMesa(forma, tamano);
        const plano = armarElPlano({
          medidas,
          mesas: [mesa({ forma, tamano, columna: 3, fila: 2 })],
        });
        const m = plano.mesas[0];
        expect(m?.izquierda).toBeCloseTo((2 / 14) * 100);
        expect(m?.arriba).toBeCloseTo((1 / 9) * 100);
        expect(m?.ancho).toBeCloseTo((ancho / 14) * 100);
        expect(m?.alto).toBeCloseTo((alto / 9) * 100);
        expect(m).toMatchObject({ forma, numero: "7", nombre: "Mesa 7", borrador: false });
      }
    }
    expect(armarElPlano({ medidas, mesas: [] }).etiqueta).toBe("Plano");
  });

  it("pegada al borde derecho entra justo; una más allá se sale del marco (se dibuja, no se juzga)", () => {
    const justa = armarElPlano({ medidas, mesas: [mesa({ columna: 13 })] }).mesas[0];
    expect((justa?.izquierda ?? 0) + (justa?.ancho ?? 0)).toBeCloseTo(100);
    const fuera = armarElPlano({ medidas, mesas: [mesa({ columna: 14 })] }).mesas[0];
    expect((fuera?.izquierda ?? 0) + (fuera?.ancho ?? 0)).toBeGreaterThan(100);
  });

  it("dos mesas que se pisan se dibujan las dos, cada una donde dice", () => {
    const plano = armarElPlano({
      medidas,
      mesas: [mesa({ id: "a", numero: 1 }), mesa({ id: "b", numero: 2, columna: 2 })],
    });
    expect(plano.mesas.map((m) => m.numero)).toEqual(["1", "2"]);
  });

  it("lo que no se puede ubicar no se dibuja (forma o tamaño desconocidos)", () => {
    expect(armarElPlano({ medidas, mesas: [mesa({ forma: "OVAL" })] }).mesas).toEqual([]);
    expect(armarElPlano({ medidas, mesas: [mesa({ tamano: "ENORME" })] }).mesas).toEqual([]);
    expect(armarElPlano({ medidas: { ...medidas, columnas: 0 }, mesas: [mesa()] }).mesas).toEqual(
      [],
    );
  });

  it("el borrador va al final y encima; con columna o fila que no son número entero de 1 o 2 cifras no se dibuja", () => {
    const base = armarElPlano({ medidas, mesas: [mesa()] });
    const con = conElBorrador(base, medidas, borrador(), "Agregar mesa");
    expect(con.mesas).toHaveLength(2);
    expect(con.mesas[1]).toMatchObject({
      borrador: true,
      numero: "8",
      nombre: "Agregar mesa",
      href: null,
    });
    for (const columna of ["", " ", "0", "-1", "1.5", "abc", "007", "100", "1e1"]) {
      expect(conElBorrador(base, medidas, borrador({ columna }), "x")).toBe(base);
    }
    expect(conElBorrador(base, medidas, borrador({ fila: "" }), "x")).toBe(base);
    expect(conElBorrador(base, medidas, borrador({ forma: "OVAL" }), "x")).toBe(base);
    expect(conElBorrador(base, medidas, borrador({ numero: "" }), "x").mesas[1]?.numero).toBe("");
    expect(conElBorrador(base, medidas, borrador({ numero: "abc" }), "x").mesas[1]?.numero).toBe(
      "",
    );
  });

  it("la lista dibuja todas las mesas; solo las activas son enlace y solo si la persona administra", () => {
    const m = (id: string, activa: boolean) => ({
      id,
      numero: id === "a" ? 1 : 2,
      forma: "CUADRADA",
      tamano: "CHICA",
      columna: id === "a" ? 1 : 5,
      fila: 1,
      activa,
      version: 1,
    });
    const con = armarLaListaDeMesas([m("a", true), m("b", false)], true, medidas);
    expect(con.plano.mesas.map((x) => [x.clave, x.href, x.desactivada, x.nombre])).toEqual([
      ["a", "/salon/mesas/a", false, "Mesa 1"],
      ["b", null, true, "Mesa 2, Desactivada"],
    ]);
    for (const puede of [false, undefined]) {
      expect(armarLaListaDeMesas([m("a", true)], puede, medidas).plano.mesas[0]?.href).toBeNull();
    }
  });

  it("el formulario de edición descuenta la mesa que se edita, no deja enlaces y dibuja las desactivadas atenuadas", () => {
    const m = (id: string, activa: boolean) => ({
      id,
      numero: 1,
      forma: "REDONDA",
      tamano: "CHICA",
      columna: 1,
      fila: 1,
      activa,
      version: 1,
    });
    const f = armarElFormularioDeMesa(m("a", true), true, {
      medidas,
      mesas: [m("a", true), m("b", true), m("c", false)],
    });
    expect(f.plano.base.mesas.map((x) => [x.clave, x.href, x.desactivada])).toEqual([
      ["b", null, false],
      ["c", null, true],
    ]);
    expect(f.plano.nombreDelBorrador).toBe("Editar mesa");
    expect(
      armarElFormularioDeMesa(null, true, { medidas, mesas: [] }).plano.nombreDelBorrador,
    ).toBe("Agregar mesa");
  });
});
