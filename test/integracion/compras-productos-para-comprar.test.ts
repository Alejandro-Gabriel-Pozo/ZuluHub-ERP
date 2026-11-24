import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { productoDeBase, type ClaseDeUsoDePrueba } from "./catalogo-apoyo";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { nombreDeLetrasUnico } from "./unicos";
import { TOPE_DE_PRODUCTOS_PARA_COMPRAR } from "../../src/modulos/compras/casos-de-uso/lectura-para-comprar";

/**
 * Compras PR 5: «productos para comprar» contra la base real. Qué se compra (clase y estado), presentaciones activas con su peso variable, búsqueda por prefijo con la regla del catálogo,
 * tope y orden fijos, permisos por rol y módulo apagado, aislamiento entre empresas, y que mirar no escribe nada ni se pisa con una compra que se está registrando a la vez.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: productos para comprar", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const nuevo = (
    e: EscenarioDeCompras,
    clase: ClaseDeUsoDePrueba,
    datos: Parameters<typeof productoDeBase>[2] = {},
  ) =>
    productoDeBase(c.dueno, e.empresa, { clase, unidadBase: "GRAMO", dimension: "MASA", ...datos });
  const ver = async (quien: EscenarioDeCompras["gerente"], texto?: string) =>
    valorDe(await c.consultas.productosParaComprar(quien, texto === undefined ? {} : { texto }));
  const ids = (lista: readonly { productoId: string }[]) => lista.map((p) => p.productoId);

  it("trae materia prima, insumo y reventa activos; deja afuera elaborados, vendibles y desactivados", async () => {
    const e = await c.escenario();
    const materia = await nuevo(e, "MATERIA_PRIMA");
    const insumo = await nuevo(e, "INSUMO");
    const reventa = await nuevo(e, "REVENTA", { unidadBase: "UNIDAD", dimension: "CONTEO" });
    await nuevo(e, "ELABORADO");
    await nuevo(e, "VENDIBLE", { unidadBase: "UNIDAD", dimension: "CONTEO" });
    await nuevo(e, "MATERIA_PRIMA", { activo: false });
    const lista = await ver(e.operador);
    expect(new Set(ids(lista))).toEqual(new Set([materia, insumo, reventa]));
    expect(lista.find((p) => p.productoId === materia)).toMatchObject({
      unidadBase: "GRAMO",
      clase: "MATERIA_PRIMA",
      presentaciones: [],
    });
    expect(lista.find((p) => p.productoId === reventa)).toMatchObject({
      unidadBase: "UNIDAD",
      clase: "REVENTA",
    });
  });

  it("cada producto trae solo sus presentaciones activas, con la cantidad en la unidad base y si es de peso variable", async () => {
    const e = await c.escenario();
    const harina = await nuevo(e, "MATERIA_PRIMA");
    const sinPresentaciones = await nuevo(e, "INSUMO");
    const bolsa = valorDe(
      await c.catalogoCasos.crearPresentacion(e.gerente, {
        productoId: harina,
        nombre: "Bolsa",
        cantidad: "25000",
        dePesoVariable: false,
      }),
    ).presentacion;
    const pieza = valorDe(
      await c.catalogoCasos.crearPresentacion(e.gerente, {
        productoId: harina,
        nombre: "Pieza",
        cantidad: "4000",
        dePesoVariable: true,
      }),
    ).presentacion;
    const vieja = valorDe(
      await c.catalogoCasos.crearPresentacion(e.gerente, {
        productoId: harina,
        nombre: "Caja",
        cantidad: "10000",
        dePesoVariable: false,
      }),
    ).presentacion;
    valorDe(
      await c.catalogoCasos.editarPresentacion(e.gerente, {
        presentacionId: vieja.id,
        nombre: "Caja",
        activa: false,
        versionEsperada: vieja.version,
      }),
    );
    const lista = await ver(e.operador);
    const delaHarina = lista.find((p) => p.productoId === harina);
    expect(delaHarina?.presentaciones).toEqual([
      { id: bolsa.id, nombre: "Bolsa", cantidad: "25000.0000", dePesoVariable: false },
      { id: pieza.id, nombre: "Pieza", cantidad: "4000.0000", dePesoVariable: true },
    ]);
    expect(lista.find((p) => p.productoId === sinPresentaciones)?.presentaciones).toEqual([]);
  });

  it("busca por el prefijo del nombre sin distinguir mayúsculas; `%` y `_` se buscan como letras, no como comodines", async () => {
    const e = await c.escenario();
    const prefijo = nombreDeLetrasUnico("Zeta");
    const a = await nuevo(e, "MATERIA_PRIMA", { nombre: `${prefijo} harina` });
    await nuevo(e, "MATERIA_PRIMA", { nombre: nombreDeLetrasUnico("Otro") });
    expect(ids(await ver(e.operador, prefijo.toUpperCase()))).toEqual([a]);
    expect(ids(await ver(e.operador, `${prefijo} har`))).toEqual([a]);
    // el medio del nombre no cuenta: es prefijo
    expect(await ver(e.operador, "harina")).toEqual([]);
    expect(await ver(e.operador, "%")).toEqual([]);
    expect(await ver(e.operador, "_")).toEqual([]);
  });

  it("el orden es por nombre y el tope lo fija el servidor", async () => {
    const e = await c.escenario();
    const total = TOPE_DE_PRODUCTOS_PARA_COMPRAR + 5;
    for (let i = 0; i < total; i += 1) {
      await nuevo(e, "INSUMO", { nombre: nombreDeLetrasUnico("Orden") });
    }
    const lista = await ver(e.operador);
    expect(lista).toHaveLength(TOPE_DE_PRODUCTOS_PARA_COMPRAR);
    const nombres = lista.map((p) => p.nombre.toLowerCase());
    expect(nombres).toEqual([...nombres].sort());
    // dos lecturas seguidas dan lo mismo (orden estable)
    expect(ids(await ver(e.operador))).toEqual(ids(lista));
  });

  it("aislamiento: los productos de otra empresa no aparecen, ni buscándolos por su nombre exacto", async () => {
    const e = await c.escenario();
    const otra = await c.escenario();
    const propio = await nuevo(e, "MATERIA_PRIMA");
    const nombreAjeno = nombreDeLetrasUnico("Ajeno");
    const ajeno = await nuevo(otra, "MATERIA_PRIMA", { nombre: nombreAjeno });
    valorDe(
      await c.catalogoCasos.crearPresentacion(otra.gerente, {
        productoId: ajeno,
        nombre: "Bolsa",
        cantidad: "1000",
        dePesoVariable: false,
      }),
    );
    expect(ids(await ver(e.gerente))).toEqual([propio]);
    expect(await ver(e.gerente, nombreAjeno)).toEqual([]);
    expect(ids(await ver(otra.gerente, nombreAjeno))).toEqual([ajeno]);
  });

  it("permisos: los tres roles miran; sin persona, módulo apagado o sin sesión de empresa, no", async () => {
    const e = await c.escenario();
    const producto = await nuevo(e, "MATERIA_PRIMA");
    for (const quien of [e.operador, e.gerente, e.administrador]) {
      expect(ids(await ver(quien))).toEqual([producto]);
    }
    expect(
      await c.consultas.productosParaComprar({ ...e.operador, personaId: null }, {}),
    ).toMatchObject({ ok: false });
    c.apagarModulo("compras");
    try {
      expect(await c.consultas.productosParaComprar(e.gerente, {})).toMatchObject({ ok: false });
    } finally {
      c.encenderModulo("compras");
    }
    expect(ids(await ver(e.gerente))).toEqual([producto]);
  });

  it("mirar no escribe: ni auditoría, ni compras, ni stock, ni presentaciones", async () => {
    const e = await c.escenario();
    await nuevo(e, "MATERIA_PRIMA");
    const contar = () =>
      Promise.all([
        c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [e.empresa]),
        c.contar("select count(*) as n from recepcion where empresa_id = $1", [e.empresa]),
        c.contar("select count(*) as n from presentacion_de_producto where empresa_id = $1", [
          e.empresa,
        ]),
        c.contar("select count(*) as n from configuracion_de_compras where empresa_id = $1", [
          e.empresa,
        ]),
      ]);
    const antes = await contar();
    await ver(e.operador);
    await ver(e.gerente, "a");
    expect(await contar()).toEqual(antes);
  });

  it("concurrencia: lecturas simultáneas con una compra que se está registrando no fallan y ven lo mismo", async () => {
    const e = await c.escenario();
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador);
    const otro = await nuevo(e, "INSUMO");
    const compra = {
      clave: nuevoId(),
      sucursalId: e.sucursal,
      proveedorId: proveedor,
      depositoId: deposito,
      renglones: [
        {
          productoId: producto,
          unidadDeCompraId: "KILOGRAMO",
          cantidad: "2",
          precioPor: "UNIDAD",
          unidadDePrecioId: "KILOGRAMO",
          precio: "1000",
        },
      ],
    };
    const [registro, ...lecturas] = await Promise.all([
      c.casos.registrarCompra(e.operador, compra),
      ver(e.operador),
      ver(e.gerente),
      ver(e.administrador),
      ver(e.operador),
    ]);
    expect(registro.ok).toBe(true);
    for (const lectura of lecturas) {
      expect(new Set(ids(lectura))).toEqual(new Set([producto, otro]));
    }
  });
  describe("cotizarCompra", () => {
    const renglonDe = (productoId: string, extra: Record<string, unknown> = {}) => ({
      productoId,
      unidadDeCompraId: "KILOGRAMO",
      cantidad: "2.5",
      precioPor: "UNIDAD",
      unidadDePrecioId: "KILOGRAMO",
      precio: "1234.5678",
      ...extra,
    });
    const armar = async () => {
      const e = await c.escenario();
      const deposito = await c.deposito(e);
      const { producto, articulo } = await c.articulo(e, {
        unidadBase: "GRAMO",
        dimension: "MASA",
      });
      const proveedor = await c.proveedor(e.operador);
      return { e, deposito, producto, articulo, proveedor };
    };
    const cotizar = (quien: EscenarioDeCompras["gerente"], renglones: unknown) =>
      c.consultas.cotizarCompra(quien, { renglones });
    const huella = (e: EscenarioDeCompras) =>
      Promise.all([
        c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [e.empresa]),
        c.contar("select count(*) as n from recepcion where empresa_id = $1", [e.empresa]),
        c.contar("select count(*) as n from linea_de_recepcion where empresa_id = $1", [e.empresa]),
        c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
          e.empresa,
        ]),
        c.contar("select count(*) as n from oferta_de_proveedor where empresa_id = $1", [
          e.empresa,
        ]),
        c.contar("select count(*) as n from configuracion_de_compras where empresa_id = $1", [
          e.empresa,
        ]),
      ]);

    it("da exactamente lo mismo que el alta con los mismos datos, como texto decimal", async () => {
      const m = await armar();
      // el alta no admite el mismo producto dos veces (lo rechaza stock al dar la entrada): tres productos distintos
      const segundo = await c.articulo(m.e, { unidadBase: "GRAMO", dimension: "MASA" });
      const tercero = await c.articulo(m.e, { unidadBase: "GRAMO", dimension: "MASA" });
      const renglones = [
        renglonDe(m.producto),
        renglonDe(segundo.producto, { cantidad: "0.333", precio: "999.999999" }),
        renglonDe(tercero.producto, { precio: null }),
      ];
      const cotizada = valorDe(await cotizar(m.e.operador, renglones));
      expect(cotizada.renglones).toHaveLength(3);
      expect(cotizada.renglones[2]).toMatchObject({ importe: null, costoPorUnidadDeStock: null });
      const alta = valorDe(
        await c.casos.registrarCompra(m.e.operador, {
          clave: nuevoId(),
          sucursalId: m.e.sucursal,
          proveedorId: m.proveedor,
          depositoId: m.deposito,
          renglones,
        }),
      );
      const guardadas = await c.filas<Record<string, string | null>>(
        `select cantidad_en_stock::text as stock, importe::text as importe, costo_por_unidad_de_stock::text as costo
           from linea_de_recepcion where recepcion_id = $1 order by numero`,
        [alta.recepcionId],
      );
      expect(
        cotizada.renglones.map((r) => ({
          stock: r.cantidadEnStock,
          importe: r.importe,
          costo: r.costoPorUnidadDeStock,
        })),
      ).toEqual(guardadas);
    });

    it("no escribe: ni filas, ni movimientos de stock, ni auditoría, ni nivel de compras", async () => {
      const m = await armar();
      const antes = await huella(m.e);
      valorDe(await cotizar(m.e.operador, [renglonDe(m.producto)]));
      valorDe(await cotizar(m.e.gerente, [renglonDe(m.producto, { precio: null })]));
      expect(await cotizar(m.e.operador, [renglonDe(m.producto, { cantidad: "0" })])).toMatchObject(
        {
          ok: false,
        },
      );
      expect(await huella(m.e)).toEqual(antes);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
    });

    it("rechaza lo mismo que el alta: otra empresa, vendible, desactivado, cantidad, precio cero, unidad de otra dimensión", async () => {
      const m = await armar();
      const otra = await c.escenario();
      const ajeno = await nuevo(otra, "MATERIA_PRIMA");
      const vendible = await nuevo(m.e, "VENDIBLE", { unidadBase: "UNIDAD", dimension: "CONTEO" });
      const apagado = await nuevo(m.e, "MATERIA_PRIMA", { activo: false });
      const error = async (renglon: Record<string, unknown>) => {
        const r = await cotizar(m.e.operador, [renglon]);
        return r.ok ? null : r.error;
      };
      expect(await error(renglonDe(ajeno))).toBe("PRODUCTO_NO_ENCONTRADO");
      expect(await error(renglonDe(vendible))).toBe("PRODUCTO_NO_COMPRABLE");
      expect(await error(renglonDe(apagado))).toBe("PRODUCTO_NO_COMPRABLE");
      expect(await error(renglonDe(m.producto, { cantidad: "0" }))).toBe("CANTIDAD_INVALIDA");
      expect(await error(renglonDe(m.producto, { cantidad: "2,5" }))).toBe("CANTIDAD_INVALIDA");
      expect(await error(renglonDe(m.producto, { precio: "0" }))).toBe("PRECIO_INVALIDO");
      expect(await error(renglonDe(m.producto, { unidadDeCompraId: "LITRO" }))).toBe(
        "DIMENSION_DISTINTA",
      );
      expect(await cotizar(m.e.operador, [])).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
      // y el alta con el mismo renglón de otra empresa rechaza igual
      expect(
        await c.casos.registrarCompra(m.e.operador, {
          clave: nuevoId(),
          sucursalId: m.e.sucursal,
          proveedorId: m.proveedor,
          depositoId: m.deposito,
          renglones: [renglonDe(ajeno)],
        }),
      ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
    });

    it("aislamiento y permisos: la empresa sale del contexto; sin persona o con el módulo apagado, no cotiza", async () => {
      const m = await armar();
      const otra = await c.escenario();
      // el producto de m.e visto desde otra empresa no existe
      expect(await cotizar(otra.gerente, [renglonDe(m.producto)])).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      for (const quien of [m.e.operador, m.e.gerente, m.e.administrador]) {
        expect((await cotizar(quien, [renglonDe(m.producto)])).ok).toBe(true);
      }
      expect(
        await cotizar({ ...m.e.operador, personaId: null }, [renglonDe(m.producto)]),
      ).toMatchObject({ ok: false });
      c.apagarModulo("compras");
      try {
        expect(await cotizar(m.e.gerente, [renglonDe(m.producto)])).toMatchObject({ ok: false });
      } finally {
        c.encenderModulo("compras");
      }
    });

    it("concurrencia: cotizaciones simultáneas con el alta de la misma compra no fallan y dan lo mismo que lo guardado", async () => {
      const m = await armar();
      const renglones = [renglonDe(m.producto)];
      const [alta, ...cotizadas] = await Promise.all([
        c.casos.registrarCompra(m.e.operador, {
          clave: nuevoId(),
          sucursalId: m.e.sucursal,
          proveedorId: m.proveedor,
          depositoId: m.deposito,
          renglones,
        }),
        cotizar(m.e.operador, renglones),
        cotizar(m.e.gerente, renglones),
        cotizar(m.e.administrador, renglones),
        cotizar(m.e.operador, renglones),
      ]);
      expect(alta.ok).toBe(true);
      const primera = valorDe(cotizadas[0]);
      for (const cotizada of cotizadas) {
        expect(valorDe(cotizada)).toEqual(primera);
      }
      expect(primera.renglones[0]).toMatchObject({
        cantidadEnStock: "2500.0000",
        importe: "3086.42",
        costoPorUnidadDeStock: "1.234568",
      });
    });
  });
});
