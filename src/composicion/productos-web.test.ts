import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import type { ContextoOperativo } from "../contexto/contexto";
import { empresaId, personaId } from "../primitivas/identificadores/marca";
import { ok } from "../primitivas/resultado/resultado";
import { listarLosProductos, type DependenciasDeProductosWeb } from "./productos-web";

/**
 * Lo que agrega la composición a la lista de productos: la lista blanca de lo que sale por fila (con el NOMBRE de la sección y nada más de ella: ni su id ni si está activa; decisión del
 * dueño 13/11/2026, «clase · sección») y que una búsqueda inválida no consulta y devuelve la lista vacía. El permiso, el aislamiento y los filtros son de la consulta: se prueban con la
 * base real en `test/integracion/productos-web.test.ts`; acá la consulta es falsa.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-11-13T12:00:00.000Z"),
};
const ID_SECCION = "33333333-3333-4333-8333-333333333333";
const SIN_FILTROS = { texto: "", clase: "", estado: "", despues: "" };

const producto = (seccion: unknown, precio: unknown = null) => ({
  id: "p-1",
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  estado: "ACTIVO",
  unidadDeVentaId: "UNIDAD",
  seccion,
  precio,
});

function con(productos: readonly unknown[], siguiente: unknown = null) {
  const pedidos: unknown[] = [];
  const d: DependenciasDeProductosWeb = {
    consultas: () => ({
      listarProductos: (_contexto: unknown, entrada: unknown) => {
        pedidos.push(entrada);
        return Promise.resolve(ok({ productos, siguiente }));
      },
    }),
    respuesta: { registrar: () => undefined },
  } as never;
  return { d, pedidos };
}

describe("lista de productos de la web: lo que sale por fila", () => {
  it("la sección sale solo con su nombre, también si está desactivada; ni su id ni su estado", async () => {
    const { d } = con([
      producto({ id: ID_SECCION, nombre: "Platos", activa: true }),
      producto({ id: ID_SECCION, nombre: "Postres", activa: false }),
    ]);
    const r = await listarLosProductos(d, contexto, SIN_FILTROS);
    if (!r.ok) throw new Error("se esperaba la lista");
    expect(r.dato.productos.map((p) => p.seccion)).toEqual(["Platos", "Postres"]);
    expect(JSON.stringify(r.dato)).not.toContain(ID_SECCION);
  });

  it("sin sección, `null`", async () => {
    const { d } = con([producto(null)]);
    const r = await listarLosProductos(d, contexto, SIN_FILTROS);
    if (!r.ok) throw new Error("se esperaba la lista");
    expect(r.dato.productos[0]?.seccion).toBeNull();
  });

  it("nada de más: id, nombre, clase, estado, sección y precio", async () => {
    const { d } = con([producto({ id: ID_SECCION, nombre: "Platos", activa: true })]);
    const r = await listarLosProductos(d, contexto, SIN_FILTROS);
    if (!r.ok) throw new Error("se esperaba la lista");
    expect(Object.keys(r.dato.productos[0] ?? {}).sort()).toEqual([
      "claseDeUso",
      "estado",
      "id",
      "nombre",
      "precio",
      "seccion",
    ]);
  });

  it("una búsqueda inválida devuelve la lista vacía sin consultar", async () => {
    const { d, pedidos } = con([producto(null)]);
    const r = await listarLosProductos(d, contexto, { ...SIN_FILTROS, texto: "a<b>" });
    expect(r).toEqual({ ok: true, dato: { productos: [], siguiente: null } });
    expect(pedidos).toEqual([]);
  });

  it("el precio: el importe de la empresa como texto, «según tamaño», «sin precio» o nada si no se vende", async () => {
    const { d } = con([
      producto(null, { tipo: "EMPRESA", precio: "1500.000000" }),
      producto(null, { tipo: "SEGUN_TAMANO" }),
      producto(null, { tipo: "SIN_PRECIO" }),
      producto(null, null),
    ]);
    const r = await listarLosProductos(d, contexto, SIN_FILTROS);
    if (!r.ok) throw new Error("se esperaba la lista");
    expect(r.dato.productos.map((p) => p.precio)).toEqual([
      { tipo: "EMPRESA", importe: "1500.000000" },
      { tipo: "SEGUN_TAMANO" },
      { tipo: "SIN_PRECIO" },
      null,
    ]);
  });

  it("la página que sigue sale codificada para la dirección; sin más páginas, null", async () => {
    const { d } = con([producto(null)], { nombreClave: "harina", id: ID_SECCION });
    const r = await listarLosProductos(d, contexto, SIN_FILTROS);
    expect(r).toMatchObject({ ok: true, dato: { siguiente: `${ID_SECCION}:harina` } });
    const ultima = await listarLosProductos(con([producto(null)]).d, contexto, SIN_FILTROS);
    expect(ultima).toMatchObject({ ok: true, dato: { siguiente: null } });
  });

  it("un fallo inesperado de la consulta sale sin detalle, con referencia, y queda en el registro", async () => {
    const registrados: string[] = [];
    const d = {
      consultas: () => ({
        listarProductos: () => Promise.reject(new Error("detalle interno de la base")),
      }),
      respuesta: { registrar: (x: string) => registrados.push(x) },
    } as never;
    const r = await listarLosProductos(d, contexto, SIN_FILTROS);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalle interno");
    expect(registrados).toHaveLength(1);
    expect(registrados[0]).toContain("detalle interno de la base");
  });
});
