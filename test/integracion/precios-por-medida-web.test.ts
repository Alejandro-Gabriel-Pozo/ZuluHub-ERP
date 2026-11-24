import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  cambiarLosPreciosPorMedida,
  verLosPreciosPorMedida,
  type DependenciasDePreciosPorMedidaWeb,
} from "../../src/composicion/precios-por-medida-web";
import {
  grupoDeBase,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  opcionDeBase,
  precioDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * Los precios por medida de la web (`precios-por-medida-web.ts`, A13 tramo Medidas) contra una base real y los roles reales: lo que la pantalla recibe, que cada medida cambia con su control de
 * versión, auditoría y una fila nueva en su historial, que repetir no duplica, que dos pestañas no se pisan, el aislamiento entre empresas, el permiso y el módulo en desarrollo.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("precios por medida de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let d: DependenciasDePreciosPorMedidaWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    // El catálogo real con `catalogo` forzado a `en_desarrollo` (en el real es disponible, DEC-0463): el guard rechaza todo.
    cerrado = await montarCatalogo(base, {
      reglas: {
        catalogo: {
          ...CATALOGO_DE_MODULOS,
          catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "en_desarrollo" },
        },
        permisos: PERMISOS_DE_EMPRESA,
      },
    });
    e = await c.escenario();
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
      nuevoId,
    };
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await cerrado.cerrar();
  });

  /** Un producto con variante «Tamaño» (Chico y Grande), en la empresa `x`. */
  const conMedidas = async (x: EscenarioDeCatalogo = e) => {
    const producto = await productoDeBase(c.dueno, x.empresa, { nombre: nombreAlAzarDeProducto() });
    const grupo = await grupoDeBase(c.dueno, x.empresa, producto, {
      clase: "VARIANTE",
      nombre: "Tamaño",
      esTamano: true,
    });
    const chico = (await opcionDeBase(c.dueno, x.empresa, producto, grupo, { nombre: "Chico" }))
      .opcion;
    const grande = (await opcionDeBase(c.dueno, x.empresa, producto, grupo, { nombre: "Grande" }))
      .opcion;
    await c.dueno.query("update opcion set orden = 1 where id = $1", [chico]);
    await c.dueno.query("update opcion set orden = 2 where id = $1", [grande]);
    return { producto, chico, grande };
  };
  const ver = async (id: string, contexto = e.gerente) => {
    const r = await verLosPreciosPorMedida(d, contexto, id);
    if (!r.ok) throw new Error(`se esperaban los precios y vino ${r.error.codigo}`);
    return r.dato;
  };
  type Vista = Awaited<ReturnType<typeof ver>>;
  const cambiar = (
    id: string,
    vista: Pick<Vista, "claveDelCambio" | "medidas">,
    precios: readonly string[],
    contexto = e.gerente,
  ) =>
    cambiarLosPreciosPorMedida(d, contexto, {
      productoId: id,
      claveDelCambio: vista.claveDelCambio,
      filas: vista.medidas.map((m, i) => ({
        opcionId: m.opcionId,
        precioIdEsperado: m.vigente === null ? null : m.vigente.precioId,
        precio: precios[i] ?? "",
      })),
    });
  const codigoDe = (r: Awaited<ReturnType<typeof cambiar>>) => (r.ok ? "OK" : r.error.codigo);
  const filas = (id: string, opcion: string) =>
    c.filas(
      "select precio from precio_de_venta where producto_id = $1 and opcion_id = $2 and sucursal_id is null order by vigente_desde",
      [id, opcion],
    );
  const auditorias = (id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where entidad = 'precio_de_venta' and accion = 'PRECIO_CAMBIADO' and despues->>'productoId' = $1",
      [id],
    );

  it("las medidas activas en su orden, sin precio al principio, y una clave de cambio nueva en cada lectura", async () => {
    const { producto, chico, grande } = await conMedidas();
    const a = await ver(producto);
    const b = await ver(producto);
    expect(a.medidas).toEqual([
      { opcionId: chico, nombre: "Chico", vigente: null },
      { opcionId: grande, nombre: "Grande", vigente: null },
    ]);
    expect(a.claveDelCambio).not.toBe(b.claveDelCambio);
    expect(JSON.stringify(a)).not.toContain(e.personaDelGerente);
  });

  it("muestra el vigente de la empresa de cada medida y no el de una sucursal", async () => {
    const { producto, chico } = await conMedidas();
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto,
      opcion: chico,
      precio: "3200.00",
      desde: "2026-01-01T00:00:00.000Z",
    });
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto,
      opcion: chico,
      sucursal: e.sucursal,
      precio: "9999.00",
      desde: "2026-01-02T00:00:00.000Z",
    });
    const v = await ver(producto);
    expect(v.medidas[0]?.vigente).toMatchObject({ importe: "3200.000000" });
    expect(v.medidas[1]?.vigente).toBeNull();
  });

  it("cambiar agrega una fila a cada medida tocada, audita una vez por medida y no toca la que quedó vacía", async () => {
    const { producto, chico, grande } = await conMedidas();
    const v0 = await ver(producto);
    expect(await cambiar(producto, v0, ["3200.00", ""])).toEqual({
      ok: true,
      dato: { productoId: producto },
    });
    expect(await filas(producto, chico)).toHaveLength(1);
    expect(await filas(producto, grande)).toHaveLength(0);
    const v1 = await ver(producto);
    expect(v1.medidas[0]?.vigente?.importe).toBe("3200.000000");
    expect(await cambiar(producto, v1, ["3200", "3800.5"])).toMatchObject({ ok: true });
    expect(await filas(producto, chico)).toHaveLength(1);
    expect((await filas(producto, grande)).map((f) => f["precio"])).toEqual(["3800.500000"]);
    expect(await auditorias(producto)).toBe(2);
  });

  it("repetir el mismo guardado (doble toque, reintento): una fila por medida y una auditoría por medida", async () => {
    const { producto, chico, grande } = await conMedidas();
    const v0 = await ver(producto);
    for (let i = 0; i < 3; i += 1) {
      expect(await cambiar(producto, v0, ["3200.00", "3800.00"])).toMatchObject({ ok: true });
    }
    expect(await filas(producto, chico)).toHaveLength(1);
    expect(await filas(producto, grande)).toHaveLength(1);
    expect(await auditorias(producto)).toBe(2);
  });

  it("dos pestañas: la que guarda después con la fila vieja recibe el importe vigente en la frase aprobada, asociado a SU medida, y no escribe esa medida", async () => {
    const { producto, chico, grande } = await conMedidas();
    const v0 = await ver(producto);
    expect(await cambiar(producto, v0, ["3200.00", ""])).toMatchObject({ ok: true });
    const segunda = await cambiar(producto, { ...v0, claveDelCambio: nuevoId() }, [
      "9999.00",
      "3800.00",
    ]);
    expect(segunda).toMatchObject({
      ok: false,
      error: {
        codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
        campo: "precio_0",
        parametros: { importe: "3200.000000" },
      },
    });
    expect((await filas(producto, chico)).map((f) => f["precio"])).toEqual(["3200.000000"]);
    // Se corta en la primera que falla: la segunda medida no se aplicó.
    expect(await filas(producto, grande)).toHaveLength(0);
  });

  it("dos guardados de la misma medida a la vez: uno gana, el otro ve el precio cambiado y queda una sola fila", async () => {
    for (let ronda = 0; ronda < 5; ronda += 1) {
      const { producto, chico } = await conMedidas();
      const v0 = await ver(producto);
      const [a, b] = await Promise.all([
        cambiar(producto, { ...v0, claveDelCambio: nuevoId() }, ["1000.00", ""]),
        cambiar(producto, { ...v0, claveDelCambio: nuevoId() }, ["2000.00", ""]),
      ]);
      expect([codigoDe(a), codigoDe(b)].sort()).toEqual(["CATALOGO_PRECIO_DESACTUALIZADO", "OK"]);
      expect(await filas(producto, chico)).toHaveLength(1);
    }
  });

  it("un precio mal escrito sale como «Escribí un precio válido» en el campo de su medida y no escribe nada", async () => {
    const { producto, chico } = await conMedidas();
    const v0 = await ver(producto);
    expect(await cambiar(producto, v0, ["", "abc"])).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_PRECIO_INVALIDO", campo: "precio_1" },
    });
    expect(await filas(producto, chico)).toHaveLength(0);
  });

  it("una medida que no es del producto, un producto sin variante o que no se vende, uno desactivado o que no existe: el genérico", async () => {
    const { producto } = await conMedidas();
    const otro = await conMedidas();
    const v0 = await ver(producto);
    const ajena = { ...v0, medidas: [{ opcionId: otro.chico, nombre: "X", vigente: null }] };
    expect(codigoDe(await cambiar(producto, ajena, ["10.00"]))).toBe(GENERICO);
    expect(await filas(otro.producto, otro.chico)).toHaveLength(0);
    const sinVariante = valorDe(
      await c.casos.crearProducto(e.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
      }),
    ).productoId;
    expect(await verLosPreciosPorMedida(d, e.gerente, sinVariante)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    const insumo = valorDe(
      await c.casos.crearProducto(e.gerente, {
        id: nuevoId(),
        claseDeUso: "INSUMO",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
      }),
    ).productoId;
    expect(await verLosPreciosPorMedida(d, e.gerente, insumo)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(await verLosPreciosPorMedida(d, e.gerente, nuevoId())).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(await verLosPreciosPorMedida(d, e.gerente, "no-es-un-id")).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: producto }));
    expect(codigoDe(await cambiar(producto, v0, ["10.00", ""]))).toBe(GENERICO);
  });

  it("aislamiento: una empresa no ve ni toca los precios de otra", async () => {
    const otra = await c.escenario();
    const ajeno = await conMedidas(otra);
    const mio = await conMedidas();
    const vm = await ver(mio.producto);
    expect(await verLosPreciosPorMedida(d, e.gerente, ajeno.producto)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(
      codigoDe(
        await cambiarLosPreciosPorMedida(d, e.gerente, {
          productoId: ajeno.producto,
          claveDelCambio: vm.claveDelCambio,
          filas: [{ opcionId: ajeno.chico, precioIdEsperado: null, precio: "1.00" }],
        }),
      ),
    ).toBe(GENERICO);
    expect(await filas(ajeno.producto, ajeno.chico)).toHaveLength(0);
  });

  it("el permiso: el operador ve pero no cambia; el administrador de una sola sucursal no cambia el precio de la empresa", async () => {
    const { producto, chico } = await conMedidas();
    const v0 = await ver(producto);
    expect((await ver(producto, e.operador)).nombre).toBeDefined();
    expect(await cambiar(producto, v0, ["10.00", ""], e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(await cambiar(producto, v0, ["10.00", ""], e.administradorDeUnaSucursal)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(await filas(producto, chico)).toHaveLength(0);
    expect(codigoDe(await cambiar(producto, v0, ["10.00", ""], e.administrador))).toBe("OK");
  });

  it("con el catálogo en desarrollo (forzado: en el catálogo real es disponible, DEC-0463) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const producto = await productoDeBase(cerrado.dueno, x.empresa, { nombre: "Cerrado" });
    const dependencias: DependenciasDePreciosPorMedidaWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const v = await verLosPreciosPorMedida(dependencias, contexto, producto);
      expect(v).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      const g = await cambiarLosPreciosPorMedida(dependencias, contexto, {
        productoId: producto,
        claveDelCambio: nuevoId(),
        filas: [],
      });
      expect(g).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(JSON.stringify(v)).not.toContain("Cerrado");
    }
  });
});
