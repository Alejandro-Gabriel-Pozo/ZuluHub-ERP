import { describe, expect, it } from "vitest";
import {
  BARBERIA,
  CAFETERIA,
  CARTAS_DE_EJEMPLO,
  HOSTERIA,
  PANADERIA,
  type CartaDeEjemplo,
  type ProductoDeEjemplo,
} from "../../../../test/fixtures/cartas";
import { validarDescripcionDeProducto } from "./descripcion";
import { direccionesDeCarta, resolverProductoPorSegmento } from "./direccion";
import { modeloEfectivo } from "./modelos";
import { listaDePreciosDelProducto } from "./precios";

/** Las cartas de ejemplo (C-0) cumplen las reglas que después usa C-2: son datos válidos, no solo datos. */

const productosDe = (c: CartaDeEjemplo): ProductoDeEjemplo[] =>
  c.secciones.flatMap((s) => [...s.productos]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("cartas de ejemplo: estructura", () => {
  it("son las cuatro del spec, en orden", () => {
    expect(CARTAS_DE_EJEMPLO).toEqual([CAFETERIA, PANADERIA, HOSTERIA, BARBERIA]);
    expect(CARTAS_DE_EJEMPLO.map((c) => c.rubro)).toEqual([
      "CAFETERIA",
      "PANADERIA",
      "HOSTERIA",
      "BARBERIA",
    ]);
  });

  it("la cafetería tiene 60 productos en 6 secciones", () => {
    expect(productosDe(CAFETERIA)).toHaveLength(60);
    expect(CAFETERIA.secciones.map((s) => s.nombre)).toEqual([
      "Cafés",
      "Infusiones",
      "Bebidas frías",
      "Desayunos y meriendas",
      "Salados",
      "Pastelería",
    ]);
  });

  it("la cafetería tiene tamaños, guarniciones, adicionales, agotados y descripciones", () => {
    const ps = productosDe(CAFETERIA);
    expect(ps.filter((p) => p.tamanos.length > 0).length).toBeGreaterThanOrEqual(15);
    expect(ps.filter((p) => p.obligatorios.length > 0).length).toBeGreaterThanOrEqual(4);
    expect(ps.filter((p) => p.adicionales.length > 0).length).toBeGreaterThanOrEqual(10);
    expect(ps.filter((p) => p.agotado).length).toBeGreaterThanOrEqual(2);
    expect(ps.filter((p) => p.descripcion !== null).length).toBeGreaterThanOrEqual(5);
    expect(ps.every((p) => p.foto === null)).toBe(true);
  });

  it("la panadería tiene fotos visibles, ocultas y rotas, y productos sin foto", () => {
    const estados = productosDe(PANADERIA).map((p) => p.foto?.estado ?? "SIN_FOTO");
    for (const e of ["VISIBLE", "OCULTA", "ROTA", "SIN_FOTO"]) expect(estados).toContain(e);
    expect(productosDe(PANADERIA).some((p) => p.foto?.alt === null)).toBe(true);
  });

  it("la hostería tiene carta de vinos con copa o botella", () => {
    const vinos = HOSTERIA.secciones.filter((s) => s.nombre.startsWith("Vinos"));
    expect(vinos.length).toBeGreaterThanOrEqual(2);
    for (const s of vinos) {
      for (const p of s.productos)
        expect(p.tamanos.map((t) => t.nombre)).toEqual(["Copa", "Botella"]);
    }
  });

  it("la barbería ofrece servicios, no comidas, y ninguno tiene foto", () => {
    expect(productosDe(BARBERIA).length).toBeGreaterThanOrEqual(8);
    expect(productosDe(BARBERIA).every((p) => p.foto === null)).toBe(true);
  });

  it("cada carta tiene secciones y productos con nombre, y ninguna sección vacía", () => {
    for (const c of CARTAS_DE_EJEMPLO) {
      expect(c.nombre.trim(), c.codigo).not.toBe("");
      expect(c.secciones.length, c.codigo).toBeGreaterThan(0);
      for (const s of c.secciones) {
        expect(s.productos.length, `${c.codigo}/${s.nombre}`).toBeGreaterThan(0);
        for (const p of s.productos) expect(p.nombre.trim(), c.codigo).not.toBe("");
      }
    }
  });
});

describe("cartas de ejemplo: ids y datos serializables", () => {
  it("todos los ids son UUID v4 y no se repiten en ninguna carta ni entre cartas", () => {
    const ids = CARTAS_DE_EJEMPLO.flatMap((c) => [
      c.id,
      ...c.secciones.flatMap((s) => [s.id, ...s.productos.map((p) => p.id)]),
    ]);
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("son JSON puro: sobreviven a stringify/parse sin cambios (nada de bigint, Date ni number de dinero)", () => {
    for (const c of CARTAS_DE_EJEMPLO) expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  it("todo importe es texto decimal, nunca un number", () => {
    for (const p of CARTAS_DE_EJEMPLO.flatMap(productosDe)) {
      const textos = [
        p.precioBase,
        ...p.tamanos.map((t) => t.recargo),
        ...[...p.obligatorios, ...p.adicionales].flatMap((g) => g.opciones.map((o) => o.recargo)),
      ];
      for (const t of textos) expect(typeof t, p.nombre).toBe("string");
    }
  });
});

describe("cartas de ejemplo: contra las piezas puras", () => {
  it("todos los importes son válidos: cada producto arma su lista de precios", () => {
    for (const c of CARTAS_DE_EJEMPLO) {
      for (const p of productosDe(c)) {
        const r = listaDePreciosDelProducto(p);
        expect(r.ok, `${c.codigo}/${p.nombre}: ${JSON.stringify(r)}`).toBe(true);
        if (r.ok) {
          expect(r.valor.precioDeLista.moneda).toBe("ARS");
          expect(r.valor.tamanos).toHaveLength(p.tamanos.length);
        }
      }
    }
  });

  it("el precio de lista de un producto con tamaños es «desde» y el de uno sin variantes no", () => {
    const cafe = productosDe(CAFETERIA).find((p) => p.nombre === "Capuchino") as ProductoDeEjemplo;
    const lista = listaDePreciosDelProducto(cafe);
    expect(lista.ok && lista.valor.desde).toBe(true);
    expect(lista.ok && lista.valor.precioDeLista).toEqual({ moneda: "ARS", monto: "3300.00" });
    const tarta = productosDe(CAFETERIA).find(
      (p) => p.nombre === "Alfajor de maicena",
    ) as ProductoDeEjemplo;
    const simple = listaDePreciosDelProducto(tarta);
    expect(simple.ok && simple.valor.desde).toBe(false);
  });

  it("la hostería ejercita el redondeo con fracciones de centavo", () => {
    const trucha = productosDe(HOSTERIA).find(
      (p) => p.nombre === "Trucha patagónica",
    ) as ProductoDeEjemplo;
    const r = listaDePreciosDelProducto(trucha);
    expect(r.ok && r.valor.precioDeLista.monto).toBe("33901.00");
    const botella = productosDe(HOSTERIA).find(
      (p) => p.nombre === "Malbec reserva",
    ) as ProductoDeEjemplo;
    const rb = listaDePreciosDelProducto(botella);
    expect(rb.ok && rb.valor.tamanos.map((t) => t.precio.monto)).toEqual(["6800.00", "24133.34"]);
  });

  it("todas las descripciones son válidas y ya están en su forma canónica", () => {
    for (const p of CARTAS_DE_EJEMPLO.flatMap(productosDe)) {
      if (p.descripcion === null) continue;
      expect(validarDescripcionDeProducto(p.descripcion), p.nombre).toEqual({
        ok: true,
        valor: p.descripcion,
      });
    }
  });

  it("las direcciones de cada carta no se repiten y cada una resuelve a su producto", () => {
    for (const c of CARTAS_DE_EJEMPLO) {
      const ps = productosDe(c).map((p) => ({ productoId: p.id, nombre: p.nombre }));
      const direcciones = direccionesDeCarta(c.id, ps);
      expect(new Set(direcciones.map((d) => d.segmento)).size, c.codigo).toBe(ps.length);
      for (const [i, p] of ps.entries()) {
        const r = resolverProductoPorSegmento(
          c.id,
          ps,
          (direcciones[i] as { segmento: string }).segmento,
        );
        expect(r.ok && r.valor.productoId, c.codigo).toBe(p.productoId);
        expect(r.ok && r.valor.redirigir, c.codigo).toBe(false);
      }
    }
  });

  it("la panadería mantiene la Cuadrícula con las fotos visibles y cae a Lista si el plan baja o no hay fotos", () => {
    const visibles = productosDe(PANADERIA).filter((p) => p.foto?.estado === "VISIBLE").length;
    expect(visibles).toBeGreaterThan(0);
    const base = { elegido: PANADERIA.modeloElegido, ahorroDeDatos: false };
    const perillasEncendidas = PANADERIA.perillasEncendidas;
    expect(modeloEfectivo({ ...base, perillasEncendidas, fotosVisibles: visibles })).toBe(
      "CUADRICULA",
    );
    expect(modeloEfectivo({ ...base, perillasEncendidas: [], fotosVisibles: visibles })).toBe(
      "LISTA",
    );
    expect(modeloEfectivo({ ...base, perillasEncendidas, fotosVisibles: 0 })).toBe("LISTA");
  });

  it("la hostería se ve en Libro y las que no eligieron nada, en Lista", () => {
    expect(
      modeloEfectivo({
        elegido: HOSTERIA.modeloElegido,
        perillasEncendidas: HOSTERIA.perillasEncendidas,
        fotosVisibles: 0,
        ahorroDeDatos: false,
      }),
    ).toBe("LIBRO");
    for (const c of [CAFETERIA, BARBERIA]) {
      expect(
        modeloEfectivo({
          elegido: c.modeloElegido,
          perillasEncendidas: c.perillasEncendidas,
          fotosVisibles: 0,
          ahorroDeDatos: false,
        }),
      ).toBe("LISTA");
    }
  });
});
