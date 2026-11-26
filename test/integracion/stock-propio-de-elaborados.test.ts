import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { productoDeBase } from "./catalogo-apoyo";
import {
  aLaVez,
  montarStock,
  nuevoId,
  RONDAS,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * Stock propio de un elaborado o un vendible (PRO-A, E6 D94): `controlarArticulo` los admite SOLO con la perilla `produccion` de la empresa encendida y una receta vigente no vacía. Cubre el permiso en
 * el servidor, la perilla, la receta, la idempotencia (repetir no escribe ni audita; apagar y volver a encender reactiva el MISMO artículo), la concurrencia (dos activaciones a la vez; activar contra
 * retirar la receta), el aislamiento entre empresas, que encender no mueve stock y que apagar con existencia no borra el libro.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;
type Resultado = { quien: "activar" | "retirar"; ok: boolean; r: unknown };
const FUNCION_NO_INCLUIDA = { error: "FUNCION_NO_INCLUIDA", perilla: "produccion" } as const;

describe.skipIf(base === null)("stock propio de elaborados y vendibles (PRO-A)", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const articulos = (producto: string) =>
    c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [producto]);
  const auditadas = (x: EscenarioDeStock, accion: string) =>
    c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      x.empresa,
      accion,
    ]);
  const movimientos = (x: EscenarioDeStock) =>
    c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [x.empresa]);
  /** Un producto de la clase pedida con una receta vigente de un ingrediente (materia prima). */
  const conReceta = async (clase: "ELABORADO" | "VENDIBLE", x = e) => {
    const harina = await c.articulo(x, { clase: "MATERIA_PRIMA", ...kilos });
    const producto = await productoDeBase(c.dueno, x.empresa, { clase, ...kilos });
    valorDe(
      await c.casos.guardarComposicion(x.gerente, {
        productoId: producto,
        versionEsperada: 0,
        rinde: "1",
        componentes: [{ productoId: harina.producto, cantidad: "1", unidadId: "KILOGRAMO" }],
      }),
    );
    return { producto, harina };
  };

  it("con la perilla apagada ni el elaborado ni el vendible se controlan, aunque tengan receta: FUNCION_NO_INCLUIDA y no se crea nada", async () => {
    c.apagarPerillas();
    for (const clase of ["ELABORADO", "VENDIBLE"] as const) {
      const { producto } = await conReceta(clase);
      const antes = await auditadas(e, "ARTICULO_CONTROLADO");
      expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual({
        ok: false,
        error: FUNCION_NO_INCLUIDA,
      });
      expect(await articulos(producto)).toBe(0);
      expect(await auditadas(e, "ARTICULO_CONTROLADO")).toBe(antes);
    }
  });

  it("con la perilla encendida pero sin receta (nunca la tuvo o la retiraron) tampoco: SIN_COMPOSICION y no se crea nada", async () => {
    c.encenderPerilla("produccion");
    const sin = await productoDeBase(c.dueno, e.empresa, { clase: "ELABORADO", ...kilos });
    expect(await c.casos.controlarArticulo(e.gerente, { productoId: sin })).toEqual({
      ok: false,
      error: "SIN_COMPOSICION",
    });
    const { producto } = await conReceta("VENDIBLE");
    valorDe(
      await c.casos.retirarComposicion(e.gerente, { productoId: producto, versionEsperada: 1 }),
    );
    expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual({
      ok: false,
      error: "SIN_COMPOSICION",
    });
    expect(await articulos(sin)).toBe(0);
    expect(await articulos(producto)).toBe(0);
  });

  it("con la perilla y una receta vigente se controla: artículo con la unidad base, auditado, existencia en cero y SIN movimientos", async () => {
    c.encenderPerilla("produccion");
    for (const clase of ["ELABORADO", "VENDIBLE"] as const) {
      const { producto } = await conReceta(clase);
      const movimientosAntes = await movimientos(e);
      const resultado = valorDe(
        await c.casos.controlarArticulo(e.gerente, { productoId: producto }),
      );
      expect(resultado.yaExistia).toBe(false);
      expect(
        (
          await c.filas(
            "select unidad_de_stock_id, dimension, activo from articulo_de_stock where producto_id = $1",
            [producto],
          )
        )[0],
      ).toEqual({ unidad_de_stock_id: "KILOGRAMO", dimension: "MASA", activo: true });
      const registro = (await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).filter(
        (r) => r["entidad_id"] === resultado.articuloId,
      );
      expect(registro).toHaveLength(1);
      expect(registro[0]).toMatchObject({ despues: { productoId: producto, activo: true } });
      expect(await movimientos(e)).toBe(movimientosAntes);
    }
  });

  it("idempotencia: repetir no escribe ni audita; apagar con existencia no borra el libro y volver a encender reactiva el MISMO artículo", async () => {
    c.encenderPerilla("produccion");
    const { producto } = await conReceta("ELABORADO");
    const dep = await c.deposito(e, { deVenta: true });
    const primero = valorDe(await c.casos.controlarArticulo(e.gerente, { productoId: producto }));
    const repetido = valorDe(await c.casos.controlarArticulo(e.gerente, { productoId: producto }));
    expect(repetido).toEqual({ articuloId: primero.articuloId, yaExistia: true });
    expect(
      (await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).filter(
        (r) => r["entidad_id"] === primero.articuloId,
      ),
    ).toHaveLength(1);
    // Le entra stock propio y se apaga: el libro y el saldo siguen.
    valorDe(
      await c.casos.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [
          { productoId: producto, cantidad: "4", unidadId: "KILOGRAMO", costoUnitario: "10" },
        ],
      }),
    );
    valorDe(await c.casos.dejarDeControlar(e.gerente, { productoId: producto }));
    expect(await c.existencia(dep, primero.articuloId)).toBe("4.0000");
    // Apagada la perilla, reactivarlo ya no se puede; con ella, vuelve el mismo artículo con su libro.
    c.apagarPerillas();
    expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual({
      ok: false,
      error: FUNCION_NO_INCLUIDA,
    });
    c.encenderPerilla("produccion");
    const otra = valorDe(await c.casos.controlarArticulo(e.gerente, { productoId: producto }));
    expect(otra).toEqual({ articuloId: primero.articuloId, yaExistia: false });
    expect(await articulos(producto)).toBe(1);
    expect(await c.existencia(dep, primero.articuloId)).toBe("4.0000");
  });

  it("concurrencia: dos activaciones a la vez dejan UN artículo y UNA auditoría; la otra ve «ya existía» (20 rondas)", async () => {
    c.encenderPerilla("produccion");
    for (let ronda = 0; ronda < Math.max(RONDAS, 20); ronda++) {
      const { producto } = await conReceta("ELABORADO");
      const pedido = () => c.casos.controlarArticulo(e.gerente, { productoId: producto });
      const resultados = await aLaVez(c, [pedido, pedido], ronda);
      const hechos = resultados.map((r) => (r.ok ? r.valor : null));
      expect(
        hechos.every((h) => h !== null),
        JSON.stringify(resultados),
      ).toBe(true);
      expect(hechos.map((h) => h?.yaExistia).sort()).toEqual([false, true]);
      expect(await articulos(producto)).toBe(1);
      const articuloId = hechos[0]?.articuloId as string;
      expect(
        (await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).filter(
          (r) => r["entidad_id"] === articuloId,
        ),
      ).toHaveLength(1);
    }
  });

  it("activar a la vez que se retira la receta: o el artículo nace sobre la receta que había, o se rechaza con SIN_COMPOSICION; nunca queda a medias (20 rondas)", async () => {
    c.encenderPerilla("produccion");
    for (let ronda = 0; ronda < Math.max(RONDAS, 20); ronda++) {
      const { producto } = await conReceta("VENDIBLE");
      const resultados = await aLaVez(
        c,
        [
          () =>
            c.casos
              .controlarArticulo(e.gerente, { productoId: producto })
              .then((r): Resultado => ({ quien: "activar", ok: r.ok, r })),
          () =>
            c.casos
              .retirarComposicion(e.administrador, { productoId: producto, versionEsperada: 1 })
              .then((r): Resultado => ({ quien: "retirar", ok: r.ok, r })),
        ],
        ronda,
      );
      // `aLaVez` alterna cuál sale primero y devuelve en ese orden: se busca cada una por su nombre.
      const activar = resultados.find((x) => x.quien === "activar");
      const retirar = resultados.find((x) => x.quien === "retirar");
      expect(retirar?.ok, JSON.stringify(retirar)).toBe(true);
      const hay = await articulos(producto);
      if (activar?.ok) {
        expect(hay).toBe(1);
      } else {
        expect(activar?.r).toEqual({ ok: false, error: "SIN_COMPOSICION" });
        expect(hay).toBe(0);
      }
      // La receta quedó retirada en los dos casos: una versión vacía nueva.
      expect(
        await c.contar("select count(*) as n from composicion where producto_id = $1", [producto]),
      ).toBe(2);
    }
  });

  it("permisos en el servidor: el operador no puede, un administrador de una sola sucursal tampoco y con el módulo apagado se rechaza; no se escribe nada", async () => {
    c.encenderPerilla("produccion");
    const { producto } = await conReceta("ELABORADO");
    expect(await c.casos.controlarArticulo(e.operador, { productoId: producto })).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(
      await c.casos.controlarArticulo(e.administradorDeUnaSucursal, { productoId: producto }),
    ).toEqual({
      ok: false,
      error: "SUCURSAL_FUERA_DE_ALCANCE",
    });
    c.apagarModulo("stock");
    try {
      expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual({
        ok: false,
        error: "MODULO_NO_ACTIVO",
      });
    } finally {
      c.encenderModulos();
    }
    expect(await articulos(producto)).toBe(0);
  });

  it("aislamiento: otra empresa no puede activar el stock propio de un producto ajeno (no existe para ella) y no se crea nada", async () => {
    c.encenderPerilla("produccion");
    const otra = await c.escenario();
    const { producto } = await conReceta("ELABORADO");
    expect(await c.casos.controlarArticulo(otra.gerente, { productoId: producto })).toEqual({
      ok: false,
      error: "PRODUCTO_NO_ENCONTRADO",
    });
    expect(await articulos(producto)).toBe(0);
  });

  it("las clases que se controlan de siempre (materia prima) siguen sin pedir perilla ni receta", async () => {
    c.apagarPerillas();
    const materia = await productoDeBase(c.dueno, e.empresa, { clase: "MATERIA_PRIMA", ...kilos });
    expect(
      valorDe(await c.casos.controlarArticulo(e.gerente, { productoId: materia })).yaExistia,
    ).toBe(false);
  });
});
