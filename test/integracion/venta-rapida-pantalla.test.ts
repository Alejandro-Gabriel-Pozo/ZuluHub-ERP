import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import {
  cargarVentaRapida,
  cotizarElCarrito,
  type DependenciasDeVentaRapidaWeb,
  type VentaRapidaParaLaPantalla,
} from "../../src/composicion/venta-rapida-web";
import { crearConsultasDeCatalogo } from "../../src/modulos/catalogo/publico";
import {
  agregarALaCuenta,
  esCantidadValida,
  formaDeCantidad,
  pedidoDeCotizacion,
  productosVisibles,
  sePuedeAgregar,
  type LineaDeLaVenta,
  type ProductoDeLaVenta,
} from "../../apps/web/ui/plantillas/venta/modelo-de-venta-rapida";
import {
  REGLAS_DE_PRUEBA,
  montarVentas,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * La PANTALLA de la venta rápida contra el servidor real: lo que la base entrega (`cargarVentaRapida`) se lee con el modelo de la pantalla (`modelo-de-venta-rapida.ts`) y lo que el
 * modelo arma (`pedidoDeCotizacion`) lo acepta y lo cotiza el servidor (`cotizarElCarrito`). Prueba que las dos mitades hablan la misma lengua para cada forma de venta (por unidad, por
 * fracciones, por peso, con medidas y con opciones) y que lo que la pantalla rechaza de entrada el servidor también lo rechaza.
 *  - El total y el importe de cada línea salen del servidor, a la vista del dinero exacto (la pantalla no suma nada).
 *  - Cotizar es una lectura: repetirla y pedirla a la vez da lo mismo (doble toque, reintento).
 *  - Aislamiento: lo de otra empresa no aparece en la lista de ésta.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const GENERICO = { codigo: "VENTAS_ACCION_NO_PERMITIDA" };

describe.skipIf(base === null)(
  "venta rápida: el modelo de la pantalla contra el servidor real",
  () => {
    let m: MundoDeVentas;
    let e: EscenarioDeVentas;
    let otra: EscenarioDeVentas;
    let d: DependenciasDeVentaRapidaWeb;
    const ids = {} as Record<
      "fraccion" | "peso" | "cafe" | "chico" | "mediano" | "almendras" | "carne" | "pollo" | "vaca",
      string
    >;

    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base);
      e = await m.escenario();
      otra = await m.escenario();
      const catalogo = crearConsultasDeCatalogo({
        transacciones: m.entorno,
        reglas: REGLAS_DE_PRUEBA,
      });
      d = {
        consultasDeCatalogo: () => catalogo,
        consultasDeVentas: () => m.consultas,
        respuesta: { registrar: () => undefined, azar: () => new Uint8Array([1, 2, 3, 4]) },
      };
      const { productoDeBase } = await import("./catalogo-apoyo");
      const desde = "2026-01-01T00:00:00.000Z";

      // Por fracciones: pizza que se ofrece en mitades y cuartos (paso 0,25).
      ids.fraccion = await productoDeBase(m.dueno, e.empresa, {
        nombre: "Muzzarella",
        paso: "0.25",
      });
      await m.dueno.query("update producto set porciones_ofrecidas = array[2,4] where id = $1", [
        ids.fraccion,
      ]);
      await m.precio({ empresa: e.empresa, producto: ids.fraccion, precio: "9000.00", desde });

      // Por peso: queso a $ 14.000 el kilo, en pasos de 1 g.
      ids.peso = await productoDeBase(m.dueno, e.empresa, {
        nombre: "Queso cremoso",
        unidadBase: "GRAMO",
        dimension: "MASA",
        unidadDeVenta: "KILOGRAMO",
        paso: "0.001",
      });
      await m.precio({ empresa: e.empresa, producto: ids.peso, precio: "14000.00", desde });

      // Con medida (chico y mediano) y un adicional con recargo.
      ids.cafe = await productoDeBase(m.dueno, e.empresa, { nombre: "Latte" });
      const medida = await m.grupoDeBase(e.empresa, ids.cafe, {
        clase: "VARIANTE",
        nombre: "Tamaño",
        esTamano: true,
        esObligatorio: true,
      });
      ids.chico = (await m.opcionDeBase(e.empresa, ids.cafe, medida, { nombre: "Chico" })).opcion;
      ids.mediano = (
        await m.opcionDeBase(e.empresa, ids.cafe, medida, { nombre: "Mediano" })
      ).opcion;
      await m.precio({
        empresa: e.empresa,
        producto: ids.cafe,
        opcion: ids.chico,
        precio: "3200.00",
        desde,
      });
      await m.precio({
        empresa: e.empresa,
        producto: ids.cafe,
        opcion: ids.mediano,
        precio: "3800.00",
        desde,
      });
      const extras = await m.grupoDeBase(e.empresa, ids.cafe, {
        clase: "ADICIONAL",
        nombre: "Adicionales",
        admiteVarias: true,
      });
      ids.almendras = (
        await m.opcionDeBase(e.empresa, ids.cafe, extras, {
          nombre: "Leche de almendras",
          recargo: "700.00",
        })
      ).opcion;

      // Con un grupo obligatorio de una sola opción.
      ids.carne = await productoDeBase(m.dueno, e.empresa, { nombre: "Milanesa" });
      await m.precio({ empresa: e.empresa, producto: ids.carne, precio: "9500.00", desde });
      const grupoCarne = await m.grupoDeBase(e.empresa, ids.carne, {
        clase: "INCLUIDA",
        nombre: "Carne",
        esObligatorio: true,
      });
      ids.pollo = (
        await m.opcionDeBase(e.empresa, ids.carne, grupoCarne, { nombre: "Pollo" })
      ).opcion;
      ids.vaca = (
        await m.opcionDeBase(e.empresa, ids.carne, grupoCarne, { nombre: "Vaca" })
      ).opcion;
    });
    afterAll(async () => {
      if (base !== null) await m.cerrar();
    });

    const cargar = async (): Promise<VentaRapidaParaLaPantalla> => {
      const r = await cargarVentaRapida(d, e.operador, e.sucursal);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      return r.dato;
    };
    const porNombre = (venta: VentaRapidaParaLaPantalla, nombre: string): ProductoDeLaVenta => {
      const p = venta.productos.find((x) => x.nombre === nombre);
      if (p === undefined) throw new Error(`falta ${nombre}`);
      return p;
    };
    const cotizar = (cuenta: readonly LineaDeLaVenta[]) =>
      cotizarElCarrito(d, e.operador, e.sucursal, pedidoDeCotizacion(cuenta));
    const ok = <T>(r: Respuesta<T>): T => {
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      return r.dato;
    };

    it("P1: cada producto se lee con una forma de cantidad y se puede agregar (menos el que no trae precio)", async () => {
      const venta = await cargar();
      for (const p of venta.productos) {
        expect(formaDeCantidad(p), p.nombre).not.toBeNull();
        expect(sePuedeAgregar(p), p.nombre).toBe(true);
      }
      expect(formaDeCantidad(porNombre(venta, "Muzzarella"))).toEqual({
        tipo: "FRACCIONES",
        paso: 2500,
        porciones: [2, 4],
      });
      expect(formaDeCantidad(porNombre(venta, "Queso cremoso"))).toEqual({
        tipo: "MEDIDA",
        paso: 10,
        unidadDeVentaId: "KILOGRAMO",
      });
      expect(formaDeCantidad(porNombre(venta, "Milanesa"))?.tipo).toBe("UNIDAD");
    });

    it("P2: lo que la pantalla arma lo acepta el servidor y el total es SUYO, exacto: fracciones, peso, medida y opciones", async () => {
      const venta = await cargar();
      const muzza = porNombre(venta, "Muzzarella");
      const queso = porNombre(venta, "Queso cremoso");
      const latte = porNombre(venta, "Latte");
      const milanesa = porNombre(venta, "Milanesa");
      let cuenta: readonly LineaDeLaVenta[] = [];
      cuenta = agregarALaCuenta(cuenta, {
        productoId: muzza.id,
        varianteId: null,
        opcionIds: [],
        cantidad: 45000,
      }); // 4 ½
      cuenta = agregarALaCuenta(cuenta, {
        productoId: queso.id,
        varianteId: null,
        opcionIds: [],
        cantidad: 2500,
      }); // 0,25 kg
      cuenta = agregarALaCuenta(cuenta, {
        productoId: latte.id,
        varianteId: ids.mediano,
        opcionIds: [ids.almendras],
        cantidad: 20000,
      });
      cuenta = agregarALaCuenta(cuenta, {
        productoId: milanesa.id,
        varianteId: null,
        opcionIds: [ids.vaca],
        cantidad: 10000,
      });
      const r = ok(await cotizar(cuenta));
      // 4,5 × 9000 = 40500 · 0,25 × 14000 = 3500 · 2 × (3800 + 700) = 9000 · 9500 (la opción «Vaca» no suma: es un grupo incluido).
      expect(r.lineas.map((l) => l.importe.monto)).toEqual([
        expect.stringMatching(/^40500(\.0+)?$/),
        expect.stringMatching(/^3500(\.0+)?$/),
        expect.stringMatching(/^9000(\.0+)?$/),
        expect.stringMatching(/^9500(\.0+)?$/),
      ]);
      expect(r.total.moneda).toBe("ARS");
      expect(r.total.monto).toMatch(/^62500(\.0+)?$/);
    });

    it("P3: una cantidad que la pantalla rechaza, el servidor también (no es múltiplo del paso, cero, vacía o de más)", async () => {
      const venta = await cargar();
      const queso = porNombre(venta, "Queso cremoso");
      const muzza = porNombre(venta, "Muzzarella");
      for (const [p, malas] of [
        [queso, [5, 15 / 10000, 0]],
        [muzza, [1250, 3750, 0, 100000000]],
      ] as const) {
        const paso = formaDeCantidad(p)?.paso ?? 0;
        for (const mala of malas) {
          const cantidad = Math.round(mala);
          expect(esCantidadValida(cantidad, paso), `${p.nombre} ${cantidad}`).toBe(false);
          const linea: LineaDeLaVenta = {
            clave: "x",
            productoId: p.id,
            varianteId: null,
            opcionIds: [],
            cantidad,
            revision: 0,
          };
          expect(await cotizar([linea]), `${p.nombre} ${cantidad}`).toMatchObject({
            ok: false,
            error: GENERICO,
          });
        }
      }
    });

    it("P4: sin lo obligatorio (la medida o la opción del grupo) el servidor no cotiza: la pantalla no deja agregar", async () => {
      const venta = await cargar();
      const latte = porNombre(venta, "Latte");
      const milanesa = porNombre(venta, "Milanesa");
      for (const p of [latte, milanesa]) {
        const linea: LineaDeLaVenta = {
          clave: "x",
          productoId: p.id,
          varianteId: null,
          opcionIds: [],
          cantidad: 10000,
          revision: 0,
        };
        expect(await cotizar([linea]), p.nombre).toMatchObject({ ok: false, error: GENERICO });
      }
    });

    it("P5: repetir la cotización (doble toque, reintento) y pedirla a la vez da lo mismo y no escribe nada", async () => {
      const venta = await cargar();
      const cuenta = agregarALaCuenta([], {
        productoId: porNombre(venta, "Muzzarella").id,
        varianteId: null,
        opcionIds: [],
        cantidad: 15000,
      });
      const contarAuditoria = () =>
        m.contar("select count(*)::text as n from auditoria_empresa where empresa_id = $1", [
          e.empresa,
        ]);
      const antes = await contarAuditoria();
      const resultados = await Promise.all(Array.from({ length: 8 }, () => cotizar(cuenta)));
      for (const r of resultados) expect(r).toEqual(resultados[0]);
      expect(await contarAuditoria()).toBe(antes);
    });

    it("P6: lo de otra empresa no aparece en la lista ni se puede cotizar con la sucursal de ésta", async () => {
      const venta = await cargar();
      expect(venta.productos.map((p) => p.id)).not.toContain(otra.producto);
      const linea: LineaDeLaVenta = {
        clave: "x",
        productoId: otra.producto,
        varianteId: null,
        opcionIds: [],
        cantidad: 10000,
        revision: 0,
      };
      expect(await cotizar([linea])).toMatchObject({ ok: false, error: GENERICO });
    });

    it("P7: la búsqueda de la pantalla encuentra por nombre lo que el servidor ofrece, sin importar tildes ni mayúsculas", async () => {
      const venta = await cargar();
      const visibles = productosVisibles(venta.productos, venta.secciones, "QUESO", null).flatMap(
        (g) => g.productos,
      );
      expect(visibles.map((p) => p.nombre)).toEqual(["Queso cremoso"]);
    });
  },
);
