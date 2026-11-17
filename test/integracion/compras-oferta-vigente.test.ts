import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * D11b (migración 0058): anular una compra deja a la oferta del proveedor (`oferta_de_proveedor`, «qué nos vende cada proveedor») con lo de la última compra VIGENTE de ese
 * proveedor y producto: con sus correcciones, y sin ninguna compra vigente la oferta queda NO vigente (no se borra: trazabilidad) y la ficha no la muestra. Defecto de origen: la
 * oferta seguía mostrando el precio de una compra anulada. Cubre: anular la última, una intermedia, la única, con correcciones, doble anulación (idempotencia), dos anulaciones a la vez
 * (el resultado no depende del orden), y una compra nueva después de quedar no vigente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)(
  "compras: la oferta del proveedor sigue a las compras vigentes",
  () => {
    let c: MontajeDeCompras;
    let e: EscenarioDeCompras;
    beforeAll(async () => {
      if (base === null) return;
      c = await montarCompras(base);
      e = await c.escenario();
    });
    afterAll(async () => {
      if (base !== null) await c.cerrar();
    });

    const armar = async () => {
      const deposito = await c.deposito(e);
      const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
      const proveedor = await c.proveedor(e.operador);
      return { deposito, producto, proveedor };
    };
    type Montaje = Awaited<ReturnType<typeof armar>>;
    /** 2 kg al precio dado el kilo: entran 2000 g a precio/1000 por gramo. */
    const comprar = async (m: Montaje, precio: string, extra: Record<string, unknown> = {}) =>
      valorDe(
        await c.casos.registrarCompra(e.operador, {
          clave: nuevoId(),
          sucursalId: e.sucursal,
          proveedorId: m.proveedor,
          depositoId: m.deposito,
          renglones: [
            {
              productoId: m.producto,
              unidadDeCompraId: "KILOGRAMO",
              cantidad: "2",
              precioPor: "UNIDAD",
              unidadDePrecioId: "KILOGRAMO",
              precio,
              ...extra,
            },
          ],
        }),
      );
    const anular = (recepcionId: string) =>
      c.casos.anularCompra(e.gerente, { recepcionId, motivo: "Se cargó mal" });
    const oferta = async (m: Montaje) =>
      (
        await c.filas<{ precio: string; costo: string; compra: string; vigente: boolean }>(
          "select ultimo_precio::text as precio, ultimo_costo_por_unidad_de_stock::text as costo, ultima_compra_id::text as compra, vigente from oferta_de_proveedor where proveedor_id = $1 and producto_id = $2",
          [m.proveedor, m.producto],
        )
      )[0];
    const enLaFicha = async (m: Montaje) =>
      valorDe(
        await c.consultas.fichaDelProveedorParaCompras(e.gerente, { parteId: m.proveedor }),
      ).queLeCompramos.filter((o) => o.productoId === m.producto);

    it("anular la última compra: la oferta vuelve a lo de la anterior vigente (defecto D11b)", async () => {
      const m = await armar();
      const a = await comprar(m, "1000");
      const b = await comprar(m, "1500");
      expect(await oferta(m)).toEqual({
        precio: "1500.000000",
        costo: "1.500000",
        compra: b.recepcionId,
        vigente: true,
      });
      valorDe(await anular(b.recepcionId));
      expect(await oferta(m)).toEqual({
        precio: "1000.000000",
        costo: "1.000000",
        compra: a.recepcionId,
        vigente: true,
      });
      expect(await enLaFicha(m)).toHaveLength(1);
    });

    it("anular la única compra: la oferta queda NO vigente (la fila se conserva) y la ficha no la muestra; una compra nueva la vuelve vigente", async () => {
      const m = await armar();
      const a = await comprar(m, "1000");
      valorDe(await anular(a.recepcionId));
      expect((await oferta(m))?.vigente).toBe(false);
      expect(await enLaFicha(m)).toEqual([]);
      const nueva = await comprar(m, "1300");
      expect(await oferta(m)).toEqual({
        precio: "1300.000000",
        costo: "1.300000",
        compra: nueva.recepcionId,
        vigente: true,
      });
      expect(await enLaFicha(m)).toHaveLength(1);
    });

    it("anular una compra intermedia no toca la oferta; anular después la última cae a la primera", async () => {
      const m = await armar();
      const a = await comprar(m, "1000");
      const b = await comprar(m, "1200");
      const cc = await comprar(m, "1400");
      valorDe(await anular(b.recepcionId));
      expect(await oferta(m)).toEqual({
        precio: "1400.000000",
        costo: "1.400000",
        compra: cc.recepcionId,
        vigente: true,
      });
      valorDe(await anular(cc.recepcionId));
      expect(await oferta(m)).toEqual({
        precio: "1000.000000",
        costo: "1.000000",
        compra: a.recepcionId,
        vigente: true,
      });
    });

    it("con correcciones: la oferta toma el precio y el costo corregidos de la compra anterior", async () => {
      const m = await armar();
      const a = await comprar(m, "1000");
      const b = await comprar(m, "1500");
      valorDe(
        await c.casos.corregirCompra(e.gerente, {
          clave: nuevoId(),
          recepcionId: a.recepcionId,
          linea: 1,
          correccionesVistas: 0,
          precio: "1100",
          motivo: "El proveedor cobró 1100",
        }),
      );
      valorDe(await anular(b.recepcionId));
      expect(await oferta(m)).toEqual({
        precio: "1100.000000",
        costo: "1.100000",
        compra: a.recepcionId,
        vigente: true,
      });
    });

    it("anular dos veces la misma compra: la segunda es RECEPCION_YA_ANULADA y la oferta no cambia", async () => {
      const m = await armar();
      const a = await comprar(m, "1000");
      const b = await comprar(m, "1500");
      valorDe(await anular(b.recepcionId));
      const antes = await oferta(m);
      const otra = await anular(b.recepcionId);
      expect(otra.ok).toBe(false);
      expect(otra.ok ? null : otra.error).toBe("RECEPCION_YA_ANULADA");
      expect(await oferta(m)).toEqual(antes);
      expect(antes?.compra).toBe(a.recepcionId);
    });

    it("dos anulaciones a la vez (la última y la intermedia): el resultado final es siempre la primera, en cualquier orden", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const m = await armar();
        const a = await comprar(m, "1000");
        const b = await comprar(m, "1200");
        const cc = await comprar(m, "1400");
        const pedidos = ronda % 2 === 0 ? [b, cc] : [cc, b];
        const r = await Promise.all(pedidos.map((x) => anular(x.recepcionId)));
        expect(r.every((x) => x.ok)).toBe(true);
        expect(await oferta(m)).toEqual({
          precio: "1000.000000",
          costo: "1.000000",
          compra: a.recepcionId,
          vigente: true,
        });
      }
    });
  },
);
