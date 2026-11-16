import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { TAMANO_DE_PAGINA_PARA_VENDER } from "../../src/modulos/catalogo/casos-de-uso/productos-para-vender";
import type { ProductoParaVender } from "../../src/modulos/catalogo/publico";
import {
  cotizarEnTx,
  grupoDeBase,
  montarCatalogo,
  nuevoId,
  opcionDeBase,
  precioDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * `productosParaVender` (mostrador, V1): la lista de lo que se ofrece en UNA sucursal. Se prueba con la base real y los casos de uso reales:
 *  - UN solo cálculo de precio: cada precio y recargo de la lista es EXACTAMENTE el de `cotizarParaVender` para esa sucursal (con el precio propio del local y con el de la empresa);
 *  - no se ofrece lo que no se podría vender: oculto (por la empresa o por el local), inactivo, de otra clase, sin completar, con medida sin precio, con grupo obligatorio sin opciones;
 *  - aislamiento: otra empresa no se ve; la sucursal es obligatoria, de la empresa, abierta y dentro del alcance de quien pide (nunca «todas»);
 *  - autorización en el servidor, páginas con tope y cursor validado, lectura sin efectos (no audita, no escribe) y repetible (dos pedidos iguales dan lo mismo).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("catálogo: productos para vender (mostrador)", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let otra: EscenarioDeCatalogo;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    e = await c.escenario();
    otra = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const DESDE = "2026-01-01T00:00:00Z";
  const pedir = (
    contexto: EscenarioDeCatalogo["gerente"],
    sucursal: string,
    despuesDe?: { nombreClave: string; id: string },
  ) =>
    c.consultas.productosParaVender(contexto, {
      sucursalId: sucursal,
      ...(despuesDe === undefined ? {} : { despuesDe }),
    });
  const ofrecidos = async (escenario: EscenarioDeCatalogo, sucursal: string = escenario.sucursal) =>
    valorDe(await pedir(escenario.gerente, sucursal)).productos;
  const ids = (lista: readonly ProductoParaVender[]) => lista.map((p) => p.id);
  const vendible = async (
    escenario: EscenarioDeCatalogo,
    precio: string | null,
    extra: Parameters<typeof productoDeBase>[2] = {},
  ) => {
    const id = await productoDeBase(c.dueno, escenario.empresa, extra);
    if (precio !== null)
      await precioDeBase(c.dueno, {
        empresa: escenario.empresa,
        producto: id,
        precio,
        desde: DESDE,
      });
    return id;
  };
  const ocultar = (
    escenario: EscenarioDeCatalogo,
    producto: string,
    alcance: { tipo: "EMPRESA" } | { tipo: "SUCURSAL"; sucursalId: string },
    oculto = true,
  ) => c.casos.ocultarProducto(escenario.gerente, { productoId: producto, alcance, oculto });

  it("P1: el precio de la sucursal gana al de la empresa, y cada precio y recargo es el MISMO que `cotizarParaVender` (una sola cuenta)", async () => {
    const simple = await vendible(e, "1000");
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto: simple,
      sucursal: e.sucursal,
      precio: "1250.5",
      desde: DESDE,
    });
    // Con medidas: tres, una sin precio (no se ofrece) y un adicional con recargo de la empresa y otro con recargo propio del local.
    const pizza = await vendible(e, null);
    const medidas = await grupoDeBase(c.dueno, e.empresa, pizza, {
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Medida",
    });
    const chica = await opcionDeBase(c.dueno, e.empresa, pizza, medidas, { nombre: "Chica" });
    const grande = await opcionDeBase(c.dueno, e.empresa, pizza, medidas, { nombre: "Grande" });
    const sinPrecio = await opcionDeBase(c.dueno, e.empresa, pizza, medidas, { nombre: "Gigante" });
    for (const [o, precio] of [
      [chica.opcion, "5000"],
      [grande.opcion, "8000.25"],
    ] as const)
      await precioDeBase(c.dueno, {
        empresa: e.empresa,
        producto: pizza,
        opcion: o,
        precio,
        desde: DESDE,
      });
    expect(sinPrecio.opcion).toBeTruthy();
    const extras = await grupoDeBase(c.dueno, e.empresa, pizza, {
      clase: "ADICIONAL",
      nombre: "Extras",
      admiteVarias: true,
    });
    const queso = await opcionDeBase(c.dueno, e.empresa, pizza, extras, {
      nombre: "Queso",
      recargo: "300",
    });
    const jamon = await opcionDeBase(c.dueno, e.empresa, pizza, extras, {
      nombre: "Jamón",
      recargo: "450",
    });
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto: pizza,
      opcion: jamon.opcion,
      sucursal: e.sucursal,
      precio: "600.75",
      desde: DESDE,
    });

    const lista = await ofrecidos(e);
    const s = lista.find((p) => p.id === simple);
    expect(s?.precio).toEqual({ tipo: "BASE", importe: "1250.500000" });
    const q = valorDe(
      await cotizarEnTx(c, e.gerente, { sucursalId: e.sucursal, productoId: simple }),
    );
    expect(s?.precio).toEqual({ tipo: "BASE", importe: q.precioUnitario });
    // En la otra sucursal rige el de la empresa.
    const enOtra = (await ofrecidos(e, e.otraSucursal)).find((p) => p.id === simple);
    expect(enOtra?.precio).toEqual({ tipo: "BASE", importe: "1000.000000" });

    const p = lista.find((x) => x.id === pizza);
    expect(p?.precio).toEqual({ tipo: "SEGUN_MEDIDA" });
    // La medida sin precio no se ofrece; las otras traen el precio que cotizaría la venta.
    expect(p?.variante?.opciones.map((m) => m.id).sort()).toEqual(
      [chica.opcion, grande.opcion].sort(),
    );
    for (const m of p?.variante?.opciones ?? []) {
      const cotizada = valorDe(
        await cotizarEnTx(c, e.gerente, {
          sucursalId: e.sucursal,
          productoId: pizza,
          opcionIds: [m.id],
        }),
      );
      expect(m.precio).toBe(cotizada.precioUnitario);
    }
    const extrasOfrecidos = p?.grupos.find((g) => g.id === extras);
    expect(extrasOfrecidos).toMatchObject({ clase: "ADICIONAL", admiteVarias: true });
    for (const o of extrasOfrecidos?.opciones ?? []) {
      const cotizada = valorDe(
        await cotizarEnTx(c, e.gerente, {
          sucursalId: e.sucursal,
          productoId: pizza,
          opcionIds: [chica.opcion, o.id],
        }),
      );
      expect(o.recargo).toBe(cotizada.opciones.find((x) => x.opcionId === o.id)?.recargo);
    }
    expect(
      Object.fromEntries(extrasOfrecidos?.opciones.map((o) => [o.id, o.recargo]) ?? []),
    ).toEqual({ [queso.opcion]: "300.000000", [jamon.opcion]: "600.750000" });
  });

  it("P2: un producto en precio abierto se ofrece como «Sin precio»; el dinero sale como texto decimal y repetir el pedido da lo mismo", async () => {
    const abierto = await vendible(e, null);
    const primera = valorDe(await pedir(e.gerente, e.sucursal));
    expect(primera.productos.find((p) => p.id === abierto)?.precio).toEqual({ tipo: "SIN_PRECIO" });
    for (const p of primera.productos) {
      if (p.precio.tipo === "BASE") expect(p.precio.importe).toMatch(/^\d+\.\d{6}$/);
    }
    expect(valorDe(await pedir(e.gerente, e.sucursal))).toEqual(primera);
  });

  it("P3: oculto por la empresa o por el local no se ofrece (y no en otro local); volver a mostrar lo devuelve", async () => {
    const p = await vendible(e, "900");
    expect(ids(await ofrecidos(e))).toContain(p);
    valorDe(await ocultar(e, p, { tipo: "SUCURSAL", sucursalId: e.sucursal }));
    expect(ids(await ofrecidos(e))).not.toContain(p);
    // Oculto en un local NO toca al otro.
    expect(ids(await ofrecidos(e, e.otraSucursal))).toContain(p);
    valorDe(await ocultar(e, p, { tipo: "SUCURSAL", sucursalId: e.sucursal }, false));
    expect(ids(await ofrecidos(e))).toContain(p);
    valorDe(await ocultar(e, p, { tipo: "EMPRESA" }));
    expect(ids(await ofrecidos(e))).not.toContain(p);
    expect(ids(await ofrecidos(e, e.otraSucursal))).not.toContain(p);
    valorDe(await ocultar(e, p, { tipo: "EMPRESA" }, false));
    expect(ids(await ofrecidos(e))).toContain(p);
  });

  it("P4: no se ofrece lo que la venta rechazaría: inactivo, materia prima, sin completar, medida sin precio, grupo obligatorio sin opciones; y a la inversa, nada ofrecido es rechazado al cotizar", async () => {
    const inactivo = await vendible(e, "10", { activo: false });
    const materia = await vendible(e, null, { clase: "MATERIA_PRIMA", alicuota: null });
    const sinCompletar = await vendible(e, null, { faltaCompletar: true, alicuota: null });
    const soloMedidasSinPrecio = await vendible(e, null);
    const g = await grupoDeBase(c.dueno, e.empresa, soloMedidasSinPrecio, {
      clase: "VARIANTE",
      esTamano: true,
    });
    await opcionDeBase(c.dueno, e.empresa, soloMedidasSinPrecio, g);
    const obligatorioVacio = await vendible(e, "10");
    await grupoDeBase(c.dueno, e.empresa, obligatorioVacio, {
      clase: "INCLUIDA",
      esObligatorio: true,
    });
    const lista = await ofrecidos(e);
    for (const no of [inactivo, materia, sinCompletar, soloMedidasSinPrecio, obligatorioVacio])
      expect(ids(lista)).not.toContain(no);
    // Lo ofrecido siempre se puede cotizar sin elegir nada extra (cuando no tiene grupos obligatorios).
    for (const p of lista.filter(
      (x) => x.variante === null && x.grupos.every((y) => !y.obligatorio),
    )) {
      const q = await cotizarEnTx(c, e.gerente, { sucursalId: e.sucursal, productoId: p.id });
      expect(q.ok, p.nombre).toBe(true);
    }
  });

  it("P5: las secciones activas salen en orden; el producto lleva su sección solo si está activa", async () => {
    const entradas = nuevoId();
    const apagada = nuevoId();
    valorDe(
      await c.casos.crearSeccionDeCarta(e.gerente, {
        id: entradas,
        nombre: "Entradas P5",
        orden: 2,
      }),
    );
    valorDe(
      await c.casos.crearSeccionDeCarta(e.gerente, { id: apagada, nombre: "Apagada P5", orden: 1 }),
    );
    const a = await vendible(e, "10");
    const b = await vendible(e, "10");
    await c.dueno.query("update producto set seccion_de_carta_id = $1 where id = $2", [
      entradas,
      a,
    ]);
    await c.dueno.query("update producto set seccion_de_carta_id = $1 where id = $2", [apagada, b]);
    valorDe(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId: apagada }));
    const pagina = valorDe(await pedir(e.gerente, e.sucursal));
    expect(pagina.secciones.some((s) => s.id === apagada)).toBe(false);
    expect(pagina.secciones.find((s) => s.id === entradas)).toEqual({
      id: entradas,
      nombre: "Entradas P5",
      orden: 2,
    });
    expect(pagina.productos.find((p) => p.id === a)?.seccionId).toBe(entradas);
    expect(pagina.productos.find((p) => p.id === b)?.seccionId).toBeNull();
    const orden = pagina.secciones.map((s) => s.orden);
    expect(orden).toEqual([...orden].sort((x, y) => x - y));
  });

  it("A1: aislamiento entre empresas: lo de otra empresa no se ve, y su sucursal pedida desde esta es «no encontrada»", async () => {
    const ajeno = await vendible(otra, "77");
    expect(ids(await ofrecidos(e))).not.toContain(ajeno);
    expect(ids(await ofrecidos(otra))).toContain(ajeno);
    expect(await pedir(e.gerente, otra.sucursal)).toEqual({
      ok: false,
      error: "SUCURSAL_NO_ENCONTRADA",
    });
  });

  it("A2: la sucursal es obligatoria y válida: vacía, mal formada, inexistente o cerrada fallan cerrado (nunca «todas»); un operador no pide un local fuera de su alcance", async () => {
    for (const mala of ["", "no-es-uuid", nuevoId()])
      expect(await pedir(e.gerente, mala)).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
    expect(await pedir(e.operador, e.otraSucursal)).toEqual({
      ok: false,
      error: "SUCURSAL_FUERA_DE_ALCANCE",
    });
    expect(valorDe(await pedir(e.operador, e.sucursal)).productos.length).toBeGreaterThan(0);
    await c.dueno.query("update sucursal set activa = false where id = $1", [e.otraSucursal]);
    expect(await pedir(e.gerente, e.otraSucursal)).toEqual({
      ok: false,
      error: "SUCURSAL_INACTIVA",
    });
    await c.dueno.query("update sucursal set activa = true where id = $1", [e.otraSucursal]);
  });

  it("A3: sin sesión de persona nadie la pide (el servidor autoriza, no el pedido)", async () => {
    expect(await pedir({ ...e.gerente, personaId: null }, e.sucursal)).toEqual({
      ok: false,
      error: "MODULO_NO_ACTIVO",
    });
  });

  it("A4: un cursor que no es un uuid falla cerrado sin llegar a la base", async () => {
    expect(await pedir(e.gerente, e.sucursal, { nombreClave: "a", id: "x'; --" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
  });

  it("L1: la lectura no escribe ni audita, y varios pedidos a la vez dan lo mismo", async () => {
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    const filasAntes = await c.contar("select count(*) as n from producto where empresa_id = $1", [
      e.empresa,
    ]);
    const rondas = await Promise.all(Array.from({ length: 6 }, () => pedir(e.gerente, e.sucursal)));
    for (const r of rondas) expect(r).toEqual(rondas[0]);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
    expect(
      await c.contar("select count(*) as n from producto where empresa_id = $1", [e.empresa]),
    ).toBe(filasAntes);
  });

  describe("páginas con tope", () => {
    it("G1: más productos que el tope se reparten en páginas sin repetir ni perder ninguno, ordenados por nombre", async () => {
      const g = await c.escenario();
      const total = TAMANO_DE_PAGINA_PARA_VENDER + 7;
      const creados: string[] = [];
      for (let i = 0; i < total; i++)
        creados.push(
          await vendible(g, "10", { nombre: `Prod ${String(i).padStart(4, "0")} zzpag` }),
        );
      const primera = valorDe(await pedir(g.gerente, g.sucursal));
      expect(primera.productos).toHaveLength(TAMANO_DE_PAGINA_PARA_VENDER);
      expect(primera.siguiente).not.toBeNull();
      const segunda = valorDe(await pedir(g.gerente, g.sucursal, primera.siguiente ?? undefined));
      expect(segunda.siguiente).toBeNull();
      const todos = [...ids(primera.productos), ...ids(segunda.productos)];
      expect(new Set(todos).size).toBe(todos.length);
      expect([...todos].sort()).toEqual([...creados].sort());
      expect([...primera.productos, ...segunda.productos].map((p) => p.nombre)).toEqual(
        creados.map((_, i) => `Prod ${String(i).padStart(4, "0")} zzpag`),
      );
    });
  });
});
