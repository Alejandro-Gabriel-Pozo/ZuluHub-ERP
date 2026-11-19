import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";
import {
  fijarElControlDeStock,
  verElControlDeStock,
  type DependenciasDeControlDeStockWeb,
} from "../../src/composicion/control-de-stock-web";
import { productoDeBase } from "./catalogo-apoyo";
import {
  aLaVez,
  firme,
  montarStock,
  nuevoId,
  RONDAS,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * El tilde «Se controla el stock» de la ficha del producto contra una base real y los roles reales (PR-3 de Catálogo): nace sin tildar, fijar crea o reactiva el artículo con una sola
 * auditoría, repetir y hacerlo a la vez no duplica nada, lo que no se controla sale como el genérico, una empresa no toca a la otra y el permiso lo decide el caso de uso. Los casos de uso
 * en sí (guard, auditoría, concurrencia del dominio) tienen sus pruebas en `stock-depositos.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("el tilde «Se controla el stock» de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let d: DependenciasDeControlDeStockWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const GENERICO = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };
  const insumo = (empresa = e.empresa, activo = true) =>
    productoDeBase(c.dueno, empresa, { clase: "INSUMO", activo });
  const ver = (producto: string, quien = e.gerente) => verElControlDeStock(d, quien, producto);
  const fijar = (producto: string, controlado: boolean, quien = e.gerente) =>
    fijarElControlDeStock(d, quien, { productoId: producto, controlado });
  const articulos = (producto: string) =>
    c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [producto]);
  const auditorias = async (accion: string, empresa = e.empresa) =>
    (await c.auditoria(empresa, accion)).length;
  const dato = <T>(r: Readonly<{ ok: boolean; dato?: T }>): T | undefined =>
    r.ok ? r.dato : undefined;

  it("1. un producto nuevo nace sin tildar", async () => {
    expect(await ver(await insumo())).toEqual({ ok: true, dato: { controlado: false } });
  });

  it("2. fijar «true» crea el artículo, deja UNA auditoría y se lee tildado", async () => {
    const producto = await insumo();
    const antes = await auditorias("ARTICULO_CONTROLADO");
    const r = await fijar(producto, true);
    expect(dato(r)).toEqual({ productoId: producto, controlado: true, yaEstaba: false });
    expect(await articulos(producto)).toBe(1);
    expect(await auditorias("ARTICULO_CONTROLADO")).toBe(antes + 1);
    expect(await ver(producto)).toEqual({ ok: true, dato: { controlado: true } });
  });

  it("3. idempotencia: el mismo pedido dos veces deja un artículo y una auditoría; la segunda dice «ya estaba» (igual con «false»)", async () => {
    const producto = await insumo();
    const antes = await auditorias("ARTICULO_CONTROLADO");
    expect(dato(await fijar(producto, true))?.yaEstaba).toBe(false);
    expect(dato(await fijar(producto, true))?.yaEstaba).toBe(true);
    expect(await articulos(producto)).toBe(1);
    expect(await auditorias("ARTICULO_CONTROLADO")).toBe(antes + 1);
    const antesDeDejar = await auditorias("ARTICULO_DEJADO_DE_CONTROLAR");
    expect(dato(await fijar(producto, false))?.yaEstaba).toBe(false);
    expect(dato(await fijar(producto, false))?.yaEstaba).toBe(true);
    expect(await auditorias("ARTICULO_DEJADO_DE_CONTROLAR")).toBe(antesDeDejar + 1);
    // Un producto que nunca se controló: dejarlo de controlar es «ya estaba» y no escribe nada.
    const virgen = await insumo();
    expect(dato(await fijar(virgen, false))?.yaEstaba).toBe(true);
    expect(await articulos(virgen)).toBe(0);
  });

  it("4. concurrencia: dos «true» a la vez dejan un artículo y una auditoría; un «true» y un «false» a la vez dejan el estado de la última auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const mismos = await insumo();
      const antes = await auditorias("ARTICULO_CONTROLADO");
      const dos = await aLaVez(
        c,
        [() => firme(() => fijar(mismos, true)), () => firme(() => fijar(mismos, true))],
        ronda,
      );
      expect(dos.every((r) => r.ok)).toBe(true);
      expect(await articulos(mismos)).toBe(1);
      expect(await auditorias("ARTICULO_CONTROLADO")).toBe(antes + 1);

      const opuestos = await insumo();
      const mezcla = await aLaVez(
        c,
        [() => firme(() => fijar(opuestos, true)), () => firme(() => fijar(opuestos, false))],
        ronda,
      );
      expect(mezcla.every((r) => r.ok)).toBe(true);
      expect(await articulos(opuestos)).toBeLessThanOrEqual(1);
      const filas = await c.filas<{ activo: boolean }>(
        "select activo from articulo_de_stock where producto_id = $1",
        [opuestos],
      );
      const leido = dato(await ver(opuestos))?.controlado ?? null;
      expect(leido).toBe(filas[0]?.activo ?? false);
    }
  });

  it("5. fijar «false» y otra vez «true» reactiva el MISMO artículo", async () => {
    const producto = await insumo();
    await fijar(producto, true);
    const [primero] = await c.filas<{ id: string }>(
      "select id from articulo_de_stock where producto_id = $1",
      [producto],
    );
    await fijar(producto, false);
    expect(await ver(producto)).toEqual({ ok: true, dato: { controlado: false } });
    await fijar(producto, true);
    const despues = await c.filas<{ id: string; activo: boolean }>(
      "select id, activo from articulo_de_stock where producto_id = $1",
      [producto],
    );
    expect(despues).toEqual([{ id: primero?.id, activo: true }]);
  });

  it("6. una clase que no se controla y un producto desactivado salen como el genérico, sin escribir", async () => {
    for (const clase of ["VENDIBLE", "ELABORADO"] as const) {
      const producto = await productoDeBase(c.dueno, e.empresa, { clase });
      expect(await fijar(producto, true)).toEqual(GENERICO);
      expect(await articulos(producto)).toBe(0);
    }
    const inactivo = await insumo(e.empresa, false);
    expect(await fijar(inactivo, true)).toEqual(GENERICO);
    expect(await articulos(inactivo)).toBe(0);
    expect(await fijar(nuevoId(), true)).toEqual(GENERICO);
  });

  it("7. con el producto en una receta vigente, dejar de controlarlo sale como el genérico y sigue tildado", async () => {
    const harina = await c.articulo(e, { clase: "MATERIA_PRIMA" });
    const pizza = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
    valorDe(
      await c.casos.guardarComposicion(e.gerente, {
        productoId: pizza,
        versionEsperada: 0,
        rinde: "1",
        componentes: [{ productoId: harina.producto, cantidad: "1", unidadId: "UNIDAD" }],
      }),
    );
    expect(await fijar(harina.producto, false)).toEqual(GENERICO);
    expect(await ver(harina.producto)).toEqual({ ok: true, dato: { controlado: true } });
  });

  it("8. aislamiento: una empresa no ve ni cambia el control de un producto de otra", async () => {
    const ajeno = await insumo(otra.empresa);
    await fijar(ajeno, true, otra.gerente);
    const antes = await auditorias("ARTICULO_DEJADO_DE_CONTROLAR", otra.empresa);
    expect(await ver(ajeno, e.gerente)).toEqual({ ok: true, dato: { controlado: false } });
    expect(await fijar(ajeno, false, e.gerente)).toEqual(GENERICO);
    expect(await fijar(ajeno, true, e.gerente)).toEqual(GENERICO);
    expect(await ver(ajeno, otra.gerente)).toEqual({ ok: true, dato: { controlado: true } });
    expect(await auditorias("ARTICULO_DEJADO_DE_CONTROLAR", otra.empresa)).toBe(antes);
  });

  it("9. permisos: el operador ve y no cambia; gerente y administrador cambian; un pedido con claves de más o mal formado sale como el genérico", async () => {
    const producto = await insumo();
    expect(await fijar(producto, true, e.operador)).toEqual(GENERICO);
    expect(await articulos(producto)).toBe(0);
    expect(dato(await fijar(producto, true, e.administrador))?.yaEstaba).toBe(false);
    expect(await ver(producto, e.operador)).toEqual({ ok: true, dato: { controlado: true } });
    expect(dato(await fijar(producto, false, e.gerente))?.controlado).toBe(false);
    for (const crudo of [
      { productoId: producto, controlado: true, empresaId: otra.empresa },
      { productoId: producto },
      { productoId: "no-es-un-uuid", controlado: true },
      { productoId: producto, controlado: "true" },
      null,
    ]) {
      expect(await fijarElControlDeStock(d, e.gerente, crudo)).toEqual(GENERICO);
    }
    expect(await articulos(producto)).toBe(1);
    expect(await ver("no-es-un-uuid")).toEqual(GENERICO);
  });

  it("10. ver es una lectura: no escribe ni audita", async () => {
    const producto = await insumo();
    const antes = await auditorias("ARTICULO_CONTROLADO");
    await ver(producto);
    await ver(producto);
    expect(await articulos(producto)).toBe(0);
    expect(await auditorias("ARTICULO_CONTROLADO")).toBe(antes);
  });

  it("con el módulo de stock apagado la lectura no se ofrece (cierra) y no se puede fijar", async () => {
    const producto = await insumo();
    c.apagarModulo("stock");
    try {
      expect((await ver(producto)).ok).toBe(false);
      expect((await fijar(producto, true)).ok).toBe(false);
      expect(await articulos(producto)).toBe(0);
    } finally {
      c.encenderModulos();
    }
  });
});
