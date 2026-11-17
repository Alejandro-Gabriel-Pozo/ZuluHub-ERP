import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  CONTEXTO_CON_AHORA,
  cotizarEnTx,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * La forma de venta del producto (decisiones 162, 166 y 169; E2 §3.8): unidad de venta y paso. Con el piloto (solo unidad base y paso 1)
 * y con las formas habilitadas (se inyecta la función de configuración): conversión exacta de precios y recargos en la misma transacción,
 * producto en precio abierto cuando algo no convierte exacto, solo cambio de paso, fracciones al cotizar y errores.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("catálogo: la forma de venta", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let piloto: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let p: EscenarioDeCatalogo;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base, { fraccionesYPeso: true });
    piloto = await montarCatalogo(base, { conexiones: 4 });
    e = await c.escenario();
    p = await piloto.escenario();
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await piloto.cerrar();
  });

  const crear = async (extra: Record<string, unknown> = {}) =>
    valorDe(
      await c.casos.crearProducto(e.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        ...extra,
      }),
    ).productoId;
  const precio = async (
    productoId: string,
    precio: string | null,
    extra: Record<string, unknown> = {},
  ) => {
    const ultima = (
      await c.filas(
        "select id from precio_de_venta where producto_id = $1 and opcion_id is not distinct from $2::uuid and sucursal_id is not distinct from $3::uuid order by vigente_desde desc limit 1",
        [productoId, extra["opcionId"] ?? null, extra["sucursalId"] ?? null],
      )
    )[0]?.["id"] as string | undefined;
    return valorDe(
      await c.casos.cambiarPrecio(e.gerente, {
        precioId: nuevoId(),
        productoId,
        opcionId: null,
        sucursalId: null,
        precioIdEsperado: ultima ?? null,
        precio,
        ...extra,
      }),
    );
  };
  const producto = async (id: string) =>
    (await c.filas("select * from producto where id = $1", [id]))[0];
  const version = async (id: string) => Number((await producto(id))?.["version"]);
  const filasDePrecio = (id: string) =>
    c.filas(
      "select unidad_id, paso_minimo::text as paso, precio::text as precio, opcion_id, sucursal_id from precio_de_venta where producto_id = $1 order by unidad_id, paso_minimo desc, opcion_id nulls first, sucursal_id nulls first",
      [id],
    );

  it("con el piloto solo se vende en la unidad base con paso 1: cambiar la forma da FORMA_DE_VENTA_NO_SOPORTADA y no escribe nada", async () => {
    const id = valorDe(
      await piloto.casos.crearProducto(p.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "GRAMO",
        alicuota: "21",
      }),
    ).productoId;
    const antes = await piloto.contar(
      "select count(*) as n from auditoria_empresa where entidad_id = $1",
      [id],
    );
    expect(
      await piloto.casos.cambiarFormaDeVenta(p.gerente, {
        productoId: id,
        versionEsperada: 1,
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "1",
      }),
    ).toEqual({ ok: false, error: "FORMA_DE_VENTA_NO_SOPORTADA" });
    expect(
      await piloto.casos.cambiarFormaDeVenta(p.gerente, {
        productoId: id,
        versionEsperada: 1,
        unidadDeVentaId: "GRAMO",
        pasoMinimo: "0.5",
      }),
    ).toEqual({ ok: false, error: "FORMA_DE_VENTA_NO_SOPORTADA" });
    expect(
      await piloto.contar("select count(*) as n from auditoria_empresa where entidad_id = $1", [
        id,
      ]),
    ).toBe(antes);
    // La misma forma que ya tiene es SIN_CAMBIOS aun en el piloto.
    expect(
      await piloto.casos.cambiarFormaDeVenta(p.gerente, {
        productoId: id,
        versionEsperada: 1,
        unidadDeVentaId: "GRAMO",
        pasoMinimo: "1",
      }),
    ).toMatchObject({ ok: true, valor: { resultado: "SIN_CAMBIOS", yaEstaba: true } });
  });

  it("D10: repetir cambiarFormaDeVenta ya aplicado es SIN_CAMBIOS y no escribe", async () => {
    const id = await crear({ unidadBaseId: "GRAMO" });
    await precio(id, "100");
    const pedido = {
      productoId: id,
      versionEsperada: 1,
      unidadDeVentaId: "GRAMO",
      pasoMinimo: "0.5",
    };
    const primero = valorDe(await c.casos.cambiarFormaDeVenta(e.gerente, pedido));
    expect(primero).toMatchObject({
      resultado: "SOLO_PASO",
      preciosConvertidos: 1,
      yaEstaba: false,
    });
    const [filas, auditorias, v] = [
      await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [id]),
      await c.contar("select count(*) as n from auditoria_empresa where entidad_id = $1", [id]),
      await version(id),
    ];
    // El reintento con la versión vieja: ya está así, no es un conflicto.
    expect(await c.casos.cambiarFormaDeVenta(e.gerente, pedido)).toMatchObject({
      ok: true,
      valor: { resultado: "SIN_CAMBIOS", yaEstaba: true, version: v },
    });
    expect(
      await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [id]),
    ).toBe(filas);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where entidad_id = $1", [id]),
    ).toBe(auditorias);
    expect(await version(id)).toBe(v);
  });

  it("D10: solo el paso (1 → 0,5): los precios siguen, quedan filas nuevas con el paso nuevo y las viejas intactas; D8: se cotiza 1,5 y se rechaza 1,25", async () => {
    const id = await crear();
    await precio(id, "100");
    await precio(id, "120", { sucursalId: e.sucursal });
    const r = valorDe(
      await c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: id,
        versionEsperada: 1,
        unidadDeVentaId: "UNIDAD",
        pasoMinimo: "0.5",
      }),
    );
    expect(r).toMatchObject({
      resultado: "SOLO_PASO",
      preciosConvertidos: 2,
      preciosEnAbierto: [],
      recargosEnCero: [],
    });
    expect(await filasDePrecio(id)).toEqual([
      {
        unidad_id: "UNIDAD",
        paso: "1.0000",
        precio: "100.000000",
        opcion_id: null,
        sucursal_id: null,
      },
      {
        unidad_id: "UNIDAD",
        paso: "1.0000",
        precio: "120.000000",
        opcion_id: null,
        sucursal_id: e.sucursal,
      },
      {
        unidad_id: "UNIDAD",
        paso: "0.5000",
        precio: "100.000000",
        opcion_id: null,
        sucursal_id: null,
      },
      {
        unidad_id: "UNIDAD",
        paso: "0.5000",
        precio: "120.000000",
        opcion_id: null,
        sucursal_id: e.sucursal,
      },
    ]);
    expect(await producto(id)).toMatchObject({
      unidad_de_venta_id: "UNIDAD",
      paso_minimo: "0.5000",
    });
    const cotiza = (cantidad: string) =>
      cotizarEnTx(c, e.gerente, { sucursalId: e.sucursal, productoId: id, cantidad });
    expect(await cotiza("1.5")).toMatchObject({
      ok: true,
      valor: {
        precioUnitario: "120.000000",
        pasoMinimo: "0.5000",
        cantidad: "1.5000",
        origenDelPrecio: "SUCURSAL",
      },
    });
    expect(await cotiza("1.25")).toEqual({ ok: false, error: "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO" });
    expect(await cotiza("0.5")).toMatchObject({ ok: true });
  });

  it("D10: kilo → gramo con precios de la empresa, de una sucursal, de cada tamaño y recargos: todo convertido exacto en la misma transacción, filas viejas intactas y consumo conservado", async () => {
    const id = await crear({ unidadBaseId: "GRAMO", unidadDeVentaId: "KILOGRAMO" });
    const tam = {
      id: nuevoId(),
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 0,
      activo: true,
      opciones: [
        { id: nuevoId(), nombre: "Chico", recargo: "0", orden: 1, activa: true },
        { id: nuevoId(), nombre: "Grande", recargo: "0", orden: 2, activa: true },
      ],
    };
    const extras = {
      id: nuevoId(),
      clase: "ADICIONAL",
      nombre: "Extras",
      esObligatorio: false,
      admiteVarias: true,
      seMuestraEnCarta: true,
      orden: 1,
      activo: true,
      opciones: [{ id: nuevoId(), nombre: "Queso", recargo: "600", orden: 1, activa: true }],
    };
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 0,
        grupos: [tam, extras],
      }),
    );
    const [chico, grande] = tam.opciones.map((o) => o.id);
    const queso = extras.opciones[0]?.id as string;
    await precio(id, "3000", { opcionId: chico });
    await precio(id, "4000", { opcionId: grande });
    await precio(id, "3600", { opcionId: chico, sucursalId: e.sucursal });
    await precio(id, "800", { opcionId: queso, sucursalId: e.sucursal });
    const insumo = valorDe(
      await c.casos.crearProductoRapido(e.gerente, {
        id: nuevoId(),
        claseDeUso: "INSUMO",
        nombre: nombreAlAzarDeProducto("Cebolla"),
        unidadBaseId: "GRAMO",
      }),
    ).productoId;
    valorDe(
      await c.casos.guardarConsumoDeGrupo(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 1,
        grupoId: extras.id,
        opciones: [
          {
            opcionId: queso,
            lineas: [{ insumoId: insumo, cantidad: "50", escalaConTamano: false }],
          },
        ],
      }),
    );
    const filasAntes = await c.contar(
      "select count(*) as n from precio_de_venta where producto_id = $1",
      [id],
    );
    const v = await version(id);

    const r = valorDe(
      await c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: id,
        versionEsperada: v,
        unidadDeVentaId: "GRAMO",
        pasoMinimo: "1",
      }),
    );
    expect(r).toMatchObject({
      resultado: "CONVERTIDO",
      preciosConvertidos: 4,
      preciosEnAbierto: [],
      recargosEnCero: [],
      yaEstaba: false,
    });
    expect(await producto(id)).toMatchObject({
      unidad_de_venta_id: "GRAMO",
      paso_minimo: "1.0000",
    });
    // Filas viejas intactas (en kilo) y filas nuevas (en gramo, ÷ 1000).
    expect(
      await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [id]),
    ).toBe(filasAntes + 4);
    expect(
      await c.contar(
        "select count(*) as n from precio_de_venta where producto_id = $1 and unidad_id = 'KILOGRAMO'",
        [id],
      ),
    ).toBe(filasAntes);
    const nuevas = await c.filas(
      "select opcion_id, sucursal_id, precio::text as precio from precio_de_venta where producto_id = $1 and unidad_id = 'GRAMO' order by precio",
      [id],
    );
    expect(nuevas.map((f) => f["precio"])).toEqual([
      "0.800000",
      "3.000000",
      "3.600000",
      "4.000000",
    ]);
    // El recargo de la empresa: versión nueva convertida (0,6 por gramo) que conserva lo que consumía.
    expect(
      await c.filas(
        "select numero, recargo::text as recargo from version_de_opcion where opcion_id = $1 order by numero",
        [queso],
      ),
    ).toEqual([
      { numero: 1, recargo: "600.000000" },
      { numero: 2, recargo: "600.000000" },
      { numero: 3, recargo: "0.600000" },
    ]);
    expect(
      await c.filas(
        "select v.numero, c.cantidad::text as cantidad from consumo_de_opcion c join version_de_opcion v on v.id = c.version_de_opcion_id where v.opcion_id = $1 order by v.numero",
        [queso],
      ),
    ).toEqual([
      { numero: 2, cantidad: "50.0000" },
      { numero: 3, cantidad: "50.0000" },
    ]);
    // Cotizar ya habla en gramos: tamaño chico en la sucursal + queso propio de la sucursal.
    const q = await cotizarEnTx(c, e.gerente, {
      sucursalId: e.sucursal,
      productoId: id,
      opcionIds: [chico as string, queso],
      cantidad: "250",
    });
    expect(q).toMatchObject({
      ok: true,
      valor: {
        unidadDeVentaId: "GRAMO",
        precioBase: "3.600000",
        precioUnitario: "4.400000",
        origenDelPrecio: "SUCURSAL",
        opciones: [{ recargo: "0.800000", origenDelRecargo: "SUCURSAL" }],
      },
    });
    // En la otra sucursal rige lo de la empresa: 3 + 0,6.
    expect(
      await cotizarEnTx(c, e.gerente, {
        sucursalId: e.otraSucursal,
        productoId: id,
        opcionIds: [chico as string, queso],
      }),
    ).toMatchObject({
      ok: true,
      valor: { precioUnitario: "3.600000", origenDelPrecio: "EMPRESA" },
    });
    // Una auditoría con la forma anterior, la nueva y la lista de lo creado.
    const auditoria = (await c.auditoria(e.empresa, "PRODUCTO_FORMA_DE_VENTA_CAMBIADA")).find(
      (a) => a["entidad_id"] === id,
    );
    expect(auditoria).toMatchObject({
      antes: { unidadDeVentaId: "KILOGRAMO", pasoMinimo: "1.0000" },
      despues: { unidadDeVentaId: "GRAMO", resultado: "CONVERTIDO", preciosConvertidos: 4 },
    });
    expect(
      (auditoria?.["despues"] as { filasDePrecioCreadas: unknown[] }).filasDePrecioCreadas,
    ).toHaveLength(4);
  });

  it("D10: un precio que no convierte exacto (3,333333 por kilo → gramo) deja TODO el producto en precio abierto, se puede vender y cargar el precio nuevo lo deja vigente", async () => {
    const id = await crear({ unidadBaseId: "GRAMO", unidadDeVentaId: "KILOGRAMO" });
    const g = {
      id: nuevoId(),
      clase: "ADICIONAL",
      nombre: "Extras",
      esObligatorio: false,
      admiteVarias: true,
      seMuestraEnCarta: true,
      orden: 1,
      activo: true,
      opciones: [{ id: nuevoId(), nombre: "Queso", recargo: "600", orden: 1, activa: true }],
    };
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 0,
        grupos: [g],
      }),
    );
    const queso = g.opciones[0]?.id as string;
    await precio(id, "3.333333");
    await precio(id, "5", { sucursalId: e.sucursal });
    await precio(id, "800", { opcionId: queso, sucursalId: e.sucursal });
    const r = valorDe(
      await c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: id,
        versionEsperada: await version(id),
        unidadDeVentaId: "GRAMO",
        pasoMinimo: "1",
      }),
    );
    expect(r.resultado).toBe("QUEDO_EN_PRECIO_ABIERTO");
    expect(r.preciosEnAbierto).toEqual([
      { opcionId: null, sucursalId: null, precioAnterior: "3.333333" },
      { opcionId: null, sucursalId: e.sucursal, precioAnterior: "5.000000" },
    ]);
    expect(r.recargosEnCero).toEqual(
      expect.arrayContaining([
        { opcionId: queso, sucursalId: e.sucursal, recargoAnterior: "800.000000" },
        { opcionId: queso, sucursalId: null, recargoAnterior: "600.000000" },
      ]),
    );
    expect(r.recargosEnCero).toHaveLength(2);
    // Las filas nuevas son NULL; las viejas siguen ahí; el recargo de la empresa quedó en 0 en la versión nueva.
    expect(
      (await filasDePrecio(id)).filter((f) => f.unidad_id === "GRAMO").map((f) => f.precio),
    ).toEqual([null, null, null]);
    expect(
      await c.filas(
        "select numero, recargo::text as recargo from version_de_opcion where opcion_id = $1 order by numero",
        [queso],
      ),
    ).toEqual([
      { numero: 1, recargo: "600.000000" },
      { numero: 2, recargo: "0.000000" },
    ]);
    // El producto se vende (precio abierto) y no se muestra en la carta; la lista dice «Sin precio».
    const q = await cotizarEnTx(c, e.gerente, {
      sucursalId: e.sucursal,
      productoId: id,
      cantidad: "100",
    });
    expect(q).toMatchObject({
      ok: true,
      valor: {
        origenDelPrecio: "ABIERTO",
        precioBase: null,
        precioUnitario: null,
        unidadDeVentaId: "GRAMO",
      },
    });
    expect(
      valorDe(
        await c.consultas.listarProductos(CONTEXTO_CON_AHORA(e.gerente, "2026-10-12T00:00:00Z"), {
          texto: String((await producto(id))?.["nombre"]).toLowerCase(),
        }),
      ).productos[0]?.precio,
    ).toEqual({ tipo: "SIN_PRECIO" });
    // Cargar el precio nuevo sobre la fila NULL (precioIdEsperado = esa fila) lo deja vigente.
    const nula = (
      await c.filas(
        "select id from precio_de_venta where producto_id = $1 and unidad_id = 'GRAMO' and sucursal_id is null and opcion_id is null",
        [id],
      )
    )[0]?.["id"] as string;
    valorDe(
      await c.casos.cambiarPrecio(e.gerente, {
        precioId: nuevoId(),
        productoId: id,
        opcionId: null,
        sucursalId: null,
        precioIdEsperado: nula,
        precio: "0.004",
      }),
    );
    expect(
      await cotizarEnTx(c, e.gerente, {
        sucursalId: e.otraSucursal,
        productoId: id,
        cantidad: "100",
      }),
    ).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "EMPRESA", precioUnitario: "0.004000" },
    });
  });

  it("errores: unidad de otra dimensión, paso inválido o que no convierte exacto, unidad desconocida, versión vieja, producto no vendible, inexistente y sin permisos", async () => {
    const id = await crear({ unidadBaseId: "KILOGRAMO" });
    const cambiar = (extra: Record<string, unknown>) =>
      c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: id,
        versionEsperada: 1,
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "0.5",
        ...extra,
      });
    expect(await cambiar({ unidadDeVentaId: "LITRO" })).toEqual({
      ok: false,
      error: "DIMENSION_DISTINTA",
    });
    expect(await cambiar({ unidadDeVentaId: "CAJA" })).toEqual({
      ok: false,
      error: "UNIDAD_INVALIDA",
    });
    for (const paso of ["0", "-1", "x", "0.00001"])
      expect(await cambiar({ pasoMinimo: paso }), paso).toEqual({
        ok: false,
        error: "PASO_INVALIDO",
      });
    expect(await cambiar({ unidadDeVentaId: "GRAMO", pasoMinimo: "0.25" })).toEqual({
      ok: false,
      error: "CONVERSION_NO_EXACTA",
    });
    expect(await cambiar({ versionEsperada: 7 })).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(
      await c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: nuevoId(),
        versionEsperada: 1,
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "1",
      }),
    ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
    const insumo = valorDe(
      await c.casos.crearProductoRapido(e.gerente, {
        id: nuevoId(),
        claseDeUso: "INSUMO",
        nombre: nombreAlAzarDeProducto("Sal"),
        unidadBaseId: "KILOGRAMO",
      }),
    ).productoId;
    expect(
      await c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: insumo,
        versionEsperada: 1,
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "0.5",
      }),
    ).toEqual({ ok: false, error: "PRODUCTO_NO_VENDIBLE" });
    expect(
      await c.casos.cambiarFormaDeVenta(e.operador, {
        productoId: id,
        versionEsperada: 1,
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "0.5",
      }),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(
      await c.casos.cambiarFormaDeVenta(e.administradorDeUnaSucursal, {
        productoId: id,
        versionEsperada: 1,
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "0.5",
      }),
    ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(await producto(id)).toMatchObject({
      unidad_de_venta_id: "KILOGRAMO",
      paso_minimo: "1.0000",
      version: 1,
    });
  });

  it("D8: un producto con paso 0,00001 se rechaza al crear y el paso no se escribe a mano por debajo de la base", async () => {
    expect(
      await c.casos.crearProducto(e.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        pasoMinimo: "0.00001",
      }),
    ).toEqual({ ok: false, error: "FORMA_DE_VENTA_INVALIDA" });
    expect(
      await c.casos.crearProducto(e.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        pasoMinimo: "0.5",
      }),
    ).toMatchObject({ ok: true });
  });
});
