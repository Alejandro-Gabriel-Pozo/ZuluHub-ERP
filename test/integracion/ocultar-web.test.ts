import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  ocultarOMostrarUnProducto,
  verLaVisibilidadDelProducto,
  verLosProductosOcultos,
  volverAMostrarProductos,
  type DependenciasDeOcultarWeb,
} from "../../src/composicion/ocultar-web";
import { montarCatalogo, productoDeBase, type EscenarioDeCatalogo } from "./catalogo-apoyo";

/**
 * «Ocultar» de la web (`ocultar-web.ts`, A15) contra una base real y los roles reales: dónde está oculto un producto, ocultar y mostrar en el local y en toda la empresa, el permiso nuevo
 * (`vidrieras.ocultar_en_empresa`: el operador no oculta lo de todos los locales), el aislamiento entre empresas, el bloqueo con existencia, y las dos reglas que no se negocian: repetir no
 * duplica (la segunda es `yaEstaba`, una sola entrada de auditoría) y dos pedidos a la vez se ponen en fila (el estado final es uno de los pedidos y queda una sola fila).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("ocultar un producto desde la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let d: DependenciasDeOcultarWeb;
  let registrados: string[];
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    registrados = [];
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const producto = (e: EscenarioDeCatalogo) => productoDeBase(c.dueno, e.empresa, {});
  const ocultar = (
    e: EscenarioDeCatalogo,
    contexto: EscenarioDeCatalogo["gerente"],
    productoId: string,
    alcance: "LOCAL" | "EMPRESA",
    oculto: boolean,
    local: string | null = e.sucursal,
  ) => ocultarOMostrarUnProducto(d, contexto, local, { productoId, alcance, oculto });
  const visibilidad = async (
    contexto: EscenarioDeCatalogo["gerente"],
    productoId: string,
    local: string | null,
  ) => {
    const r = await verLaVisibilidadDelProducto(d, contexto, productoId, local);
    if (!r.ok) throw new Error(`se esperaba la visibilidad y vino ${r.error.codigo}`);
    return r.dato;
  };
  /** El dato de una respuesta que tiene que haber salido bien. */
  const datoDe = <D>(r: { ok: true; dato: D } | { ok: false; error: { codigo: string } }): D => {
    if (!r.ok) throw new Error(`se esperaba un resultado y vino ${r.error.codigo}`);
    return r.dato;
  };
  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : r.error?.codigo;
  const filas = (e: EscenarioDeCatalogo, id: string) =>
    c.contar(
      "select count(*) as n from disponibilidad_de_producto where empresa_id = $1 and producto_id = $2",
      [e.empresa, id],
    );
  const auditorias = async (e: EscenarioDeCatalogo, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;

  it("ocultar en el local y volver a mostrar: la visibilidad lo refleja, solo en ese local", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: false, empresa: false });
    const r = await ocultar(e, e.gerente, id, "LOCAL", true);
    expect(r).toEqual({
      ok: true,
      dato: { productoId: id, yaEstaba: false, sigueOcultoPorLaEmpresa: false },
    });
    expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: true, empresa: false });
    expect(await visibilidad(e.gerente, id, e.otraSucursal)).toEqual({
      local: false,
      empresa: false,
    });
    expect(datoDe(await ocultar(e, e.gerente, id, "LOCAL", false))).toMatchObject({
      yaEstaba: false,
    });
    expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: false, empresa: false });
  });

  it("22A: en toda la empresa lo hacen gerente y administrador; el operador, no (ni con su local): SIN_PERMISO y nada cambia", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    expect(codigoDe(await ocultar(e, e.operador, id, "EMPRESA", true))).toBe("SIN_PERMISO");
    expect(await filas(e, id)).toBe(0);
    expect(codigoDe(await ocultar(e, e.gerente, id, "EMPRESA", true))).toBe("OK");
    expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: false, empresa: true });
    // El operador no lo vuelve a mostrar tampoco.
    expect(codigoDe(await ocultar(e, e.operador, id, "EMPRESA", false))).toBe("SIN_PERMISO");
    expect(codigoDe(await ocultar(e, e.administrador, id, "EMPRESA", false))).toBe("OK");
    expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: false, empresa: false });
  });

  it("el operador oculta y muestra en SU local; en otro local o sin local, no", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    expect(codigoDe(await ocultar(e, e.operador, id, "LOCAL", true))).toBe("OK");
    expect(await visibilidad(e.operador, id, e.sucursal)).toEqual({ local: true, empresa: false });
    expect(codigoDe(await ocultar(e, e.operador, id, "LOCAL", true, e.otraSucursal))).toBe(
      GENERICO,
    );
    // Sin local con el que trabajar el alcance LOCAL cierra: no se toma por «toda la empresa».
    expect(codigoDe(await ocultar(e, e.gerente, id, "LOCAL", true, null))).toBe(GENERICO);
    expect(await filas(e, id)).toBe(1);
  });

  it("la visibilidad sin local la ve quien tiene alcance sobre todas las sucursales; el operador, no", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    datoDe(await ocultar(e, e.gerente, id, "EMPRESA", true));
    expect(await visibilidad(e.gerente, id, null)).toEqual({ local: null, empresa: true });
    const r = await verLaVisibilidadDelProducto(d, e.operador, id, null);
    expect(r.ok).toBe(false);
    expect(await visibilidad(e.operador, id, e.sucursal)).toEqual({ local: false, empresa: true });
  });

  it("aislamiento: otra empresa no ve ni toca el producto (el genérico), y su visibilidad sale vacía", async () => {
    const e = await c.escenario();
    const otra = await c.escenario();
    const id = await producto(e);
    datoDe(await ocultar(e, e.gerente, id, "EMPRESA", true));
    expect(codigoDe(await ocultar(otra, otra.gerente, id, "EMPRESA", false, otra.sucursal))).toBe(
      GENERICO,
    );
    expect(codigoDe(await ocultar(otra, otra.gerente, id, "LOCAL", true, otra.sucursal))).toBe(
      GENERICO,
    );
    expect(await visibilidad(otra.gerente, id, otra.sucursal)).toEqual({
      local: false,
      empresa: false,
    });
    expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: false, empresa: true });
    // Un local de otra empresa tampoco sirve.
    expect(codigoDe(await ocultar(e, e.gerente, id, "LOCAL", true, otra.sucursal))).toBe(GENERICO);
  });

  it("con existencia no se oculta (texto propio), sin dejar fila ni auditoría; con 0 sí; mostrar no tiene condiciones", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    c.stock.limpiar();
    c.stock.fijarExistencia(id, e.sucursal, 4);
    expect(codigoDe(await ocultar(e, e.gerente, id, "LOCAL", true))).toBe(
      "CATALOGO_PRODUCTO_CON_EXISTENCIA",
    );
    expect(await filas(e, id)).toBe(0);
    expect(await auditorias(e, "PRODUCTO_OCULTADO")).toBe(0);
    c.stock.fijarExistencia(id, e.sucursal, 0);
    expect(codigoDe(await ocultar(e, e.gerente, id, "LOCAL", true))).toBe("OK");
    c.stock.fijarExistencia(id, e.sucursal, -2);
    expect(codigoDe(await ocultar(e, e.gerente, id, "LOCAL", false))).toBe("OK");
    c.stock.limpiar();
  });

  it("idempotencia: el mismo pedido repetido deja una fila y una entrada de auditoría; la segunda es yaEstaba y no deshace", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    const primera = await ocultar(e, e.gerente, id, "LOCAL", true);
    const segunda = await ocultar(e, e.gerente, id, "LOCAL", true);
    expect(datoDe(primera)).toMatchObject({ yaEstaba: false });
    expect(datoDe(segunda)).toMatchObject({ yaEstaba: true });
    expect(await filas(e, id)).toBe(1);
    expect(await auditorias(e, "PRODUCTO_OCULTADO")).toBe(1);
    expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: true, empresa: false });
    // Mostrar dos veces: igual.
    datoDe(await ocultar(e, e.gerente, id, "LOCAL", false));
    expect(datoDe(await ocultar(e, e.gerente, id, "LOCAL", false))).toMatchObject({
      yaEstaba: true,
    });
    expect(await auditorias(e, "PRODUCTO_MOSTRADO")).toBe(1);
  });

  it("concurrencia: el mismo pedido cuatro veces a la vez (doble toque, dos pestañas) escribe una sola vez", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    const resultados = await Promise.all(
      [1, 2, 3, 4].map(() => ocultar(e, e.gerente, id, "LOCAL", true)),
    );
    expect(resultados.map(codigoDe)).toEqual(["OK", "OK", "OK", "OK"]);
    expect(resultados.filter((r) => r.ok && !r.dato.yaEstaba)).toHaveLength(1);
    expect(await filas(e, id)).toBe(1);
    expect(await auditorias(e, "PRODUCTO_OCULTADO")).toBe(1);
  });

  it("concurrencia: ocultar y mostrar a la vez se ponen en fila; queda una sola fila y el estado es el del último en entrar", async () => {
    const e = await c.escenario();
    const id = await producto(e);
    for (let ronda = 0; ronda < 4; ronda += 1) {
      const resultados = await Promise.all([
        ocultar(e, e.gerente, id, "LOCAL", true),
        ocultar(e, e.administrador, id, "LOCAL", false),
      ]);
      expect(resultados.map(codigoDe)).toEqual(["OK", "OK"]);
      expect(await filas(e, id)).toBeLessThanOrEqual(1);
      const estado = (await visibilidad(e.gerente, id, e.sucursal)).local;
      const ocultas = await c.contar(
        "select count(*) as n from disponibilidad_de_producto where empresa_id = $1 and producto_id = $2 and oculto",
        [e.empresa, id],
      );
      expect(ocultas).toBe(estado ? 1 : 0);
    }
  });

  describe("C2: lista de ocultos y «Volver a mostrar» (uno o varios)", () => {
    const lista = async (contexto: EscenarioDeCatalogo["gerente"], local: string | null) =>
      datoDe(await verLosProductosOcultos(d, contexto, local));
    const mostrar = (
      contexto: EscenarioDeCatalogo["gerente"],
      local: string | null,
      productoIds: readonly string[],
    ) => volverAMostrarProductos(d, contexto, local, { productoIds });

    it("la lista trae lo oculto en el local y en la empresa (dónde), sin lo de otros locales ni lo de otra empresa, ordenado por nombre", async () => {
      const e = await c.escenario();
      const otra = await c.escenario();
      const [a, b, x, ajeno] = [
        await producto(e),
        await producto(e),
        await producto(e),
        await producto(otra),
      ];
      datoDe(await ocultar(e, e.gerente, a, "LOCAL", true));
      datoDe(await ocultar(e, e.gerente, b, "EMPRESA", true));
      datoDe(await ocultar(e, e.gerente, b, "LOCAL", true));
      datoDe(await ocultar(e, e.gerente, x, "LOCAL", true, e.otraSucursal));
      datoDe(await ocultar(otra, otra.gerente, ajeno, "EMPRESA", true, otra.sucursal));
      const l = await lista(e.gerente, e.sucursal);
      expect(l.map((o) => o.productoId).sort()).toEqual([a, b].sort());
      expect(l.find((o) => o.productoId === a)).toMatchObject({ local: true, empresa: false });
      expect(l.find((o) => o.productoId === b)).toMatchObject({ local: true, empresa: true });
      // Sin local no se asume «todas»: solo lo oculto en toda la empresa.
      expect((await lista(e.gerente, null)).map((o) => o.productoId)).toEqual([b]);
      // El operador no puede pedir la lista sin local.
      expect((await verLosProductosOcultos(d, e.operador, null)).ok).toBe(false);
    });

    it("volver a mostrar varios: muestra los alcances que están ocultos, deja una entrada de auditoría por cambio y los demás productos quedan igual", async () => {
      const e = await c.escenario();
      const [a, b, otro] = [await producto(e), await producto(e), await producto(e)];
      datoDe(await ocultar(e, e.gerente, a, "LOCAL", true));
      datoDe(await ocultar(e, e.gerente, b, "EMPRESA", true));
      datoDe(await ocultar(e, e.gerente, b, "LOCAL", true));
      datoDe(await ocultar(e, e.gerente, otro, "LOCAL", true));
      const r = datoDe(await mostrar(e.gerente, e.sucursal, [a, b]));
      expect(r.mostrados).toBe(2);
      expect((await lista(e.gerente, e.sucursal)).map((o) => o.productoId)).toEqual([otro]);
      expect(await auditorias(e, "PRODUCTO_MOSTRADO")).toBe(3);
    });

    it("idempotencia: repetir el mismo pedido no duplica ni deshace (cero cambios y ninguna auditoría nueva)", async () => {
      const e = await c.escenario();
      const [a, b] = [await producto(e), await producto(e)];
      datoDe(await ocultar(e, e.gerente, a, "LOCAL", true));
      datoDe(await ocultar(e, e.gerente, b, "EMPRESA", true));
      expect(datoDe(await mostrar(e.gerente, e.sucursal, [a, b, a])).mostrados).toBe(2);
      expect(datoDe(await mostrar(e.gerente, e.sucursal, [a, b])).mostrados).toBe(0);
      expect(await auditorias(e, "PRODUCTO_MOSTRADO")).toBe(2);
      // Mostrar uno que nunca estuvo oculto tampoco escribe nada.
      const visible = await producto(e);
      expect(datoDe(await mostrar(e.gerente, e.sucursal, [visible])).mostrados).toBe(0);
      expect(await filas(e, visible)).toBe(0);
    });

    it("concurrencia: dos «Volver a mostrar» a la vez (dos personas, dos pestañas) sobre lo mismo escriben una sola vez", async () => {
      const e = await c.escenario();
      const ids = [await producto(e), await producto(e), await producto(e)];
      for (const id of ids) {
        datoDe(await ocultar(e, e.gerente, id, "LOCAL", true));
        datoDe(await ocultar(e, e.gerente, id, "EMPRESA", true));
      }
      const resultados = await Promise.all([
        mostrar(e.gerente, e.sucursal, ids),
        mostrar(e.administrador, e.sucursal, [...ids].reverse()),
      ]);
      expect(resultados.map(codigoDe)).toEqual(["OK", "OK"]);
      expect(await lista(e.gerente, e.sucursal)).toEqual([]);
      // Seis ocultamientos (3 productos x 2 alcances) y seis cambios de vuelta, ni uno más.
      expect(await auditorias(e, "PRODUCTO_MOSTRADO")).toBe(6);
      const ocultas = await c.contar(
        "select count(*) as n from disponibilidad_de_producto where empresa_id = $1 and oculto",
        [e.empresa],
      );
      expect(ocultas).toBe(0);
    });

    it("permiso: el operador muestra lo de su local pero no lo de la empresa (sin cambiar lo que sí pudo); gerente sí", async () => {
      const e = await c.escenario();
      const [soloLocal, deLaEmpresa] = [await producto(e), await producto(e)];
      datoDe(await ocultar(e, e.gerente, soloLocal, "LOCAL", true));
      datoDe(await ocultar(e, e.gerente, deLaEmpresa, "EMPRESA", true));
      const r = await mostrar(e.operador, e.sucursal, [soloLocal, deLaEmpresa]);
      expect(codigoDe(r)).toBe("SIN_PERMISO");
      expect(await visibilidad(e.gerente, soloLocal, e.sucursal)).toEqual({
        local: false,
        empresa: false,
      });
      expect(await visibilidad(e.gerente, deLaEmpresa, e.sucursal)).toEqual({
        local: false,
        empresa: true,
      });
      expect(codigoDe(await mostrar(e.gerente, e.sucursal, [deLaEmpresa]))).toBe("OK");
      expect(await visibilidad(e.gerente, deLaEmpresa, e.sucursal)).toEqual({
        local: false,
        empresa: false,
      });
    });

    it("aislamiento: un id de otra empresa se ignora (no lo toca ni lo cuenta) y el pedido mal formado sale genérico", async () => {
      const e = await c.escenario();
      const otra = await c.escenario();
      const ajeno = await producto(otra);
      datoDe(await ocultar(otra, otra.gerente, ajeno, "EMPRESA", true, otra.sucursal));
      expect(datoDe(await mostrar(e.gerente, e.sucursal, [ajeno])).mostrados).toBe(0);
      expect(await visibilidad(otra.gerente, ajeno, otra.sucursal)).toEqual({
        local: false,
        empresa: true,
      });
      expect(codigoDe(await mostrar(e.gerente, e.sucursal, []))).toBe(GENERICO);
      expect(codigoDe(await mostrar(e.gerente, e.sucursal, ["no-es-un-id"]))).toBe(GENERICO);
    });

    it("sin local nada se asume: no toca lo oculto en un local, solo lo de la empresa", async () => {
      const e = await c.escenario();
      const id = await producto(e);
      datoDe(await ocultar(e, e.gerente, id, "LOCAL", true));
      datoDe(await ocultar(e, e.gerente, id, "EMPRESA", true));
      expect(datoDe(await mostrar(e.gerente, null, [id])).mostrados).toBe(1);
      expect(await visibilidad(e.gerente, id, e.sucursal)).toEqual({ local: true, empresa: false });
    });
  });
});
