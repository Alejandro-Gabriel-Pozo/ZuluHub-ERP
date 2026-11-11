import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * E9-T8: «Comprar y recibir» (N1) y anular la compra, contra la base real y el stock real. Idempotencia (misma clave, mismo remito con otra clave),
 * concurrencia (el mismo remito a la vez, N compras a la vez), atomicidad (una falla inyectada no deja nada), peso variable, stock apagado o artículo no
 * controlado, permisos y alcance, aislamiento entre empresas, la jornada de la sucursal y las consultas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)(
  "compras: recepción de mercadería (N1), anulación y consultas",
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

    /** El código de un error: texto, `{ error }` (los que llevan datos) o el `tipo` de uno de persistencia. */
    const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
      !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
        ? String(r.error.error)
        : codigoDe(r);

    /** Un depósito, un artículo controlado en gramos y un proveedor: lo mínimo para comprar. */
    const armar = async (quien = e) => {
      const deposito = await c.deposito(quien);
      const { producto, articulo } = await c.articulo(quien, {
        unidadBase: "GRAMO",
        dimension: "MASA",
      });
      const proveedor = await c.proveedor(quien.operador);
      return { deposito, producto, articulo, proveedor };
    };
    const compra = (
      m: Awaited<ReturnType<typeof armar>>,
      extra: Record<string, unknown> = {},
      renglon: Record<string, unknown> = {},
    ) => ({
      clave: nuevoId(),
      sucursalId: e.sucursal,
      proveedorId: m.proveedor,
      // la empresa de prueba acumula depósitos en la sucursal: cada compra elige el suyo (el caso «sin elegir» tiene su propia prueba)
      depositoId: m.deposito,
      renglones: [
        {
          productoId: m.producto,
          unidadDeCompraId: "KILOGRAMO",
          cantidad: "2",
          precioPor: "UNIDAD",
          unidadDePrecioId: "KILOGRAMO",
          precio: "1000",
          ...renglon,
        },
      ],
      ...extra,
    });
    const recepciones = (proveedor: string) =>
      c.contar("select count(*) as n from recepcion where proveedor_id = $1", [proveedor]);
    const movimientosDe = (deposito: string) =>
      c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [deposito]);

    // =============================================================================================
    describe("registrarCompra", () => {
      it("el operador carga la compra: entra el stock en la unidad base con su costo, queda la línea, la oferta y la auditoría", async () => {
        const m = await armar();
        const r = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
        expect(r).toMatchObject({ comprobanteId: null, yaExistia: false, avisos: [] });
        expect(r.movimientos).toHaveLength(1);
        expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
        const [linea] = await c.filas<Record<string, string>>(
          `select cantidad_en_stock::text as stock, importe::text as importe, costo_por_unidad_de_stock::text as costo, deposito_id, movimiento_id::text as mov
           from linea_de_recepcion where recepcion_id = $1`,
          [r.recepcionId],
        );
        expect(linea).toMatchObject({
          stock: "2000.0000",
          importe: "2000.00",
          costo: "1.000000",
          deposito_id: m.deposito,
          mov: r.movimientos[0],
        });
        const [rec] = await c.filas<Record<string, unknown>>(
          "select nivel, es_atajo, estado, registrado_por, numero from recepcion where id = $1",
          [r.recepcionId],
        );
        expect(rec).toMatchObject({
          nivel: "COMPRA_SIMPLE",
          es_atajo: true,
          estado: "CONFIRMADA",
          registrado_por: e.operador.personaId,
        });
        const [oferta] = await c.filas<Record<string, string>>(
          "select ultimo_precio::text as p, ultimo_costo_por_unidad_de_stock::text as c, ultima_compra_id from oferta_de_proveedor where proveedor_id = $1",
          [m.proveedor],
        );
        expect(oferta).toMatchObject({
          p: "1000.000000",
          c: "1.000000",
          ultima_compra_id: r.recepcionId,
        });
        expect((await c.auditoria(e.empresa, "COMPRA_REGISTRADA")).at(-1)).toMatchObject({
          actor_persona_id: e.operador.personaId,
          entidad_id: r.recepcionId,
        });
      });

      it("I1: la misma compra dos veces (misma clave) deja una compra y una entrada de stock y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
        const m = await armar();
        const pedido = compra(m);
        const primera = valorDe(await c.casos.registrarCompra(e.operador, pedido));
        const auditorias = (await c.auditoria(e.empresa, "COMPRA_REGISTRADA")).length;
        const segunda = valorDe(await c.casos.registrarCompra(e.operador, pedido));
        expect(segunda).toEqual({ ...primera, yaExistia: true });
        expect(await recepciones(m.proveedor)).toBe(1);
        expect(await movimientosDe(m.deposito)).toBe(1);
        expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
        expect((await c.auditoria(e.empresa, "COMPRA_REGISTRADA")).length).toBe(auditorias);
        const otra = compra(m, { clave: pedido.clave }, { cantidad: "3" });
        expect(await c.casos.registrarCompra(e.operador, otra)).toEqual({
          ok: false,
          error: "CLAVE_REUTILIZADA",
        });
        expect(await recepciones(m.proveedor)).toBe(1);
      });

      it("I3: el mismo remito con otra clave es REMITO_YA_REGISTRADO con el id de la primera; anulada la primera, el remito se puede volver a cargar", async () => {
        const m = await armar();
        const remito = { puntoDeVenta: 4, numero: 1234, fecha: "2026-10-10" };
        const primera = valorDe(await c.casos.registrarCompra(e.operador, compra(m, { remito })));
        expect(await c.casos.registrarCompra(e.operador, compra(m, { remito }))).toEqual({
          ok: false,
          error: { error: "REMITO_YA_REGISTRADO", recepcionId: primera.recepcionId },
        });
        expect(await recepciones(m.proveedor)).toBe(1);
        expect(await movimientosDe(m.deposito)).toBe(1);
        valorDe(
          await c.casos.anularCompra(e.gerente, {
            recepcionId: primera.recepcionId,
            motivo: "Se cargó mal",
          }),
        );
        expect(
          valorDe(await c.casos.registrarCompra(e.operador, compra(m, { remito }))).yaExistia,
        ).toBe(false);
        // el mismo remito de OTRO proveedor es otra cosa
        const otro = await c.proveedor(e.operador);
        expect(
          valorDe(
            await c.casos.registrarCompra(
              e.operador,
              compra({ ...m, proveedor: otro }, { remito }),
            ),
          ).yaExistia,
        ).toBe(false);
      });

      it("C1: dos «Comprar y recibir» con el mismo remito a la vez (misma clave y con claves distintas): una recepción y una entrada", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const m = await armar();
          const remito = { puntoDeVenta: 9, numero: 100 + ronda, fecha: "2026-10-10" };
          const igual = compra(m, { remito });
          c.armarBarrera(4);
          try {
            const resultados = await Promise.all([
              c.casos.registrarCompra(e.operador, igual),
              c.casos.registrarCompra(e.gerente, igual),
              c.casos.registrarCompra(e.operador, compra(m, { remito })),
              c.casos.registrarCompra(e.administrador, compra(m, { remito })),
            ]);
            for (const r of resultados) {
              expect(
                r.ok || ["REMITO_YA_REGISTRADO", "ConcurrenciaAgotada"].includes(codigo(r)),
              ).toBe(true);
            }
            expect(resultados.some((r) => r.ok && !r.valor.yaExistia)).toBe(true);
          } finally {
            c.soltarBarrera();
          }
          expect(await recepciones(m.proveedor)).toBe(1);
          expect(await movimientosDe(m.deposito)).toBe(1);
          expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
        }
      });

      it("C11: N compras a la vez en la misma empresa reciben N números distintos", async () => {
        const m = await armar();
        c.armarBarrera(5);
        try {
          const resultados = await Promise.all(
            Array.from({ length: 5 }, () => c.casos.registrarCompra(e.operador, compra(m))),
          );
          for (const r of resultados)
            expect(r.ok || codigoDe(r) === "ConcurrenciaAgotada").toBe(true);
        } finally {
          c.soltarBarrera();
        }
        const numeros = await c.filas<{ numero: number }>(
          "select numero from recepcion where proveedor_id = $1",
          [m.proveedor],
        );
        expect(new Set(numeros.map((n) => n.numero)).size).toBe(numeros.length);
        expect(numeros.length).toBeGreaterThanOrEqual(1);
        expect(await c.existencia(m.deposito, m.articulo)).toBe(`${numeros.length * 2000}.0000`);
      });

      it("R1: peso variable sin peso real no se confirma; con peso real entra el peso real, no el aproximado ni las cajas", async () => {
        const m = await armar();
        const pieza = valorDe(
          await c.catalogoCasos.crearPresentacion(e.gerente, {
            productoId: m.producto,
            nombre: "Pieza",
            cantidad: "4000",
            dePesoVariable: true,
          }),
        ).presentacion;
        const sinPeso = compra(
          m,
          {},
          {
            presentacionId: pieza.id,
            cantidad: "2",
            precioPor: "PRESENTACION",
            unidadDePrecioId: null,
            precio: "5000",
          },
        );
        expect(await c.casos.registrarCompra(e.operador, sinPeso)).toEqual({
          ok: false,
          error: "PESO_REAL_REQUERIDO",
        });
        expect(await recepciones(m.proveedor)).toBe(0);
        expect(await movimientosDe(m.deposito)).toBe(0);
        const conPeso = valorDe(
          await c.casos.registrarCompra(
            e.operador,
            compra(
              m,
              {},
              {
                presentacionId: pieza.id,
                cantidad: "2",
                precioPor: "PRESENTACION",
                unidadDePrecioId: null,
                precio: "5000",
                pesoReal: "7.5",
              },
            ),
          ),
        );
        expect(await c.existencia(m.deposito, m.articulo)).toBe("7500.0000");
        const [linea] = await c.filas<Record<string, string>>(
          "select importe::text as importe, costo_por_unidad_de_stock::text as costo, de_peso_variable as pv from linea_de_recepcion where recepcion_id = $1",
          [conPeso.recepcionId],
        );
        expect(linea).toMatchObject({ importe: "10000.00", pv: true });
      });

      it("sin precio: la compra entra sin costo y sin oferta; el precio nunca queda en cero", async () => {
        const m = await armar();
        const r = valorDe(
          await c.casos.registrarCompra(
            e.operador,
            compra(m, {}, { precio: null, precioPor: "UNIDAD", unidadDePrecioId: null }),
          ),
        );
        const [linea] = await c.filas<Record<string, unknown>>(
          "select precio, importe, costo_por_unidad_de_stock as costo from linea_de_recepcion where recepcion_id = $1",
          [r.recepcionId],
        );
        expect(linea).toEqual({ precio: null, importe: null, costo: null });
        expect(
          await c.contar("select count(*) as n from oferta_de_proveedor where proveedor_id = $1", [
            m.proveedor,
          ]),
        ).toBe(0);
        expect((await c.consultas.comprasSinPrecio(e.gerente)).ok).toBe(true);
        const sinPrecio = valorDe(await c.consultas.comprasSinPrecio(e.gerente));
        expect(sinPrecio.map((x) => x.recepcionId)).toContain(r.recepcionId);
        expect(await c.casos.registrarCompra(e.operador, compra(m, {}, { precio: "0" }))).toEqual({
          ok: false,
          error: "PRECIO_INVALIDO",
        });
      });

      it("R9: con stock apagado, o con un artículo no controlado, registra la compra sin entrada y sin error", async () => {
        const m = await armar();
        const sinArticulo = await c.producto(e.empresa, { unidadBase: "GRAMO", dimension: "MASA" });
        const r = valorDe(
          await c.casos.registrarCompra(e.operador, compra(m, {}, { productoId: sinArticulo })),
        );
        expect(r.movimientos).toEqual([]);
        const [linea] = await c.filas<Record<string, unknown>>(
          "select deposito_id, movimiento_id from linea_de_recepcion where recepcion_id = $1",
          [r.recepcionId],
        );
        expect(linea).toEqual({ deposito_id: null, movimiento_id: null });
        c.apagarModulo("stock");
        try {
          const apagado = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
          expect(apagado.movimientos).toEqual([]);
        } finally {
          c.encenderModulo("stock");
        }
        expect(await movimientosDe(m.deposito)).toBe(0);
        expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
      });

      it("el depósito: sin elegir se usa el único; con más de uno hay que elegir; uno inactivo o de otra sucursal no sirve", async () => {
        const otra = await c.escenario();
        const deposito = await c.deposito(otra);
        const { producto } = await c.articulo(otra, { unidadBase: "GRAMO", dimension: "MASA" });
        const proveedor = await c.proveedor(otra.operador);
        const pedido = () => ({
          clave: nuevoId(),
          sucursalId: otra.sucursal,
          proveedorId: proveedor,
          renglones: [
            {
              productoId: producto,
              unidadDeCompraId: "GRAMO",
              cantidad: "10",
              precioPor: "UNIDAD",
              unidadDePrecioId: "GRAMO",
              precio: "1",
            },
          ],
        });
        const unico = valorDe(await c.casos.registrarCompra(otra.operador, pedido()));
        expect(unico.movimientos).toHaveLength(1);
        expect(
          await c.existencia(
            deposito,
            (
              await c.filas<{ id: string }>(
                "select id from articulo_de_stock where producto_id = $1",
                [producto],
              )
            )[0]?.id as string,
          ),
        ).toBe("10.0000");
        const segundo = await c.deposito(otra);
        expect(await c.casos.registrarCompra(otra.operador, pedido())).toEqual({
          ok: false,
          error: "DEPOSITO_A_ELEGIR",
        });
        expect(
          valorDe(
            await c.casos.registrarCompra(otra.operador, { ...pedido(), depositoId: segundo }),
          ).movimientos,
        ).toHaveLength(1);
        const deOtraSucursal = await c.deposito({
          empresa: otra.empresa,
          sucursal: otra.otraSucursal,
        });
        expect(
          await c.casos.registrarCompra(otra.operador, { ...pedido(), depositoId: deOtraSucursal }),
        ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
        const inactivo = await c.deposito(otra, { activo: false });
        expect(
          await c.casos.registrarCompra(otra.operador, { ...pedido(), depositoId: inactivo }),
        ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
        expect(
          await c.casos.registrarCompra(otra.operador, { ...pedido(), depositoId: nuevoId() }),
        ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      });

      it("A1: una falla inyectada después de la entrada de stock (en las líneas, o en la oferta) no deja recepción, línea, entrada ni oferta", async () => {
        for (const punto of ["lineas", "oferta"] as const) {
          const m = await armar();
          c.inyectarFalla(punto);
          try {
            await expect(c.casos.registrarCompra(e.operador, compra(m))).rejects.toThrow(
              /falla inyectada/,
            );
          } finally {
            c.inyectarFalla(null);
          }
          expect(await recepciones(m.proveedor)).toBe(0);
          expect(await movimientosDe(m.deposito)).toBe(0);
          expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
          expect(
            await c.contar(
              "select count(*) as n from oferta_de_proveedor where proveedor_id = $1",
              [m.proveedor],
            ),
          ).toBe(0);
        }
      });

      it("A2: si stock rechaza (artículo sin depósito normal activo), no queda nada", async () => {
        const { producto, proveedor } = await armar();
        const sinDeposito = await c.escenario();
        const { producto: p2 } = await c.articulo(sinDeposito, {
          unidadBase: "GRAMO",
          dimension: "MASA",
        });
        const prov2 = await c.proveedor(sinDeposito.operador);
        void producto;
        void proveedor;
        expect(
          await c.casos.registrarCompra(sinDeposito.operador, {
            clave: nuevoId(),
            sucursalId: sinDeposito.sucursal,
            proveedorId: prov2,
            renglones: [
              {
                productoId: p2,
                unidadDeCompraId: "GRAMO",
                cantidad: "5",
                precioPor: "UNIDAD",
                unidadDePrecioId: "GRAMO",
                precio: "2",
              },
            ],
          }),
        ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
        expect(await recepciones(prov2)).toBe(0);
      });

      it("rechaza un proveedor inexistente, de otra empresa o inactivo; un producto que no se compra; una presentación ajena; la fecha futura; la sucursal inexistente", async () => {
        const m = await armar();
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, { proveedorId: nuevoId() })),
        ).toEqual({ ok: false, error: "PROVEEDOR_NO_ENCONTRADO" });
        const otra = await c.escenario();
        const ajeno = await c.proveedor(otra.operador);
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, { proveedorId: ajeno })),
        ).toEqual({ ok: false, error: "PROVEEDOR_NO_ENCONTRADO" });
        const inactivo = await c.proveedor(e.operador);
        valorDe(await c.clientes.desactivarParte(e.gerente, { parteId: inactivo }));
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, { proveedorId: inactivo })),
        ).toEqual({ ok: false, error: "PROVEEDOR_NO_ENCONTRADO" });
        const vendible = await c.producto(e.empresa, { clase: "VENDIBLE" });
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, {}, { productoId: vendible })),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_COMPRABLE" });
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, {}, { productoId: nuevoId() })),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, {}, { presentacionId: nuevoId() })),
        ).toEqual({ ok: false, error: "PRESENTACION_NO_ENCONTRADA" });
        expect(
          await c.casos.registrarCompra(
            e.operador,
            compra(m, { hechoEn: new Date("2026-10-12T00:00:00Z") }),
          ),
        ).toEqual({ ok: false, error: "FECHA_INVALIDA" });
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, { sucursalId: nuevoId() })),
        ).toMatchObject({ ok: false });
        expect(await c.casos.registrarCompra(e.operador, compra(m, { clave: "no-uuid" }))).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
        expect(await c.casos.registrarCompra(e.operador, compra(m, { renglones: [] }))).toEqual({
          ok: false,
          error: "RENGLONES_INVALIDOS",
        });
        expect(await c.casos.registrarCompra(e.operador, compra(m, {}, { cantidad: "0" }))).toEqual(
          { ok: false, error: "CANTIDAD_INVALIDA" },
        );
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, {}, { unidadDeCompraId: "LITRO" })),
        ).toEqual({ ok: false, error: "DIMENSION_DISTINTA" });
        expect(await recepciones(m.proveedor)).toBe(0);
      });

      it("permisos y alcance: el operador solo en su sucursal; el sistema (sin persona) no carga; con el módulo apagado nadie", async () => {
        const m = await armar();
        expect(
          await c.casos.registrarCompra(e.operador, compra(m, { sucursalId: e.otraSucursal })),
        ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
        expect(
          await c.casos.registrarCompra({ ...e.operador, personaId: null }, compra(m)),
        ).toMatchObject({ ok: false });
        c.apagarModulo("compras");
        try {
          expect(await c.casos.registrarCompra(e.gerente, compra(m))).toMatchObject({ ok: false });
        } finally {
          c.encenderModulo("compras");
        }
        expect(
          valorDe(await c.casos.registrarCompra(e.gerente, compra(m, { sucursalId: e.sucursal })))
            .yaExistia,
        ).toBe(false);
        expect(await recepciones(m.proveedor)).toBe(1);
      });

      it("R10: una recepción a las 02:00 con corte 04:00 queda en la jornada anterior, y cambiar el corte después no la mueve", async () => {
        const otra = await c.escenario();
        await c.dueno.query("update sucursal set hora_de_corte = '04:00' where id = $1", [
          otra.sucursal,
        ]);
        const m = await armar(otra);
        // sin entrada de stock: la de stock solo admite la jornada vigente, y acá se prueba la jornada de la recepción
        const sinArticulo = await c.producto(otra.empresa, {
          unidadBase: "GRAMO",
          dimension: "MASA",
        });
        const r = valorDe(
          await c.casos.registrarCompra(otra.operador, {
            ...compra(
              m,
              { sucursalId: otra.sucursal, hechoEn: new Date("2026-10-11T05:00:00Z") },
              { productoId: sinArticulo },
            ),
          }),
        );
        const fecha = async () =>
          (
            await c.filas<{ f: string }>(
              "select fecha_negocio::text as f from recepcion where id = $1",
              [r.recepcionId],
            )
          )[0]?.f;
        expect(await fecha()).toBe("2026-10-10");
        await c.dueno.query("update sucursal set hora_de_corte = '00:00' where id = $1", [
          otra.sucursal,
        ]);
        expect(await fecha()).toBe("2026-10-10");
      });

      it("R6: una empresa B no ve ni toca las compras de la A, y la misma clave en dos empresas son dos compras", async () => {
        const m = await armar();
        const r = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
        const otra = await c.escenario();
        expect(
          await c.casos.anularCompra(otra.gerente, {
            recepcionId: r.recepcionId,
            motivo: "no es mía",
          }),
        ).toEqual({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
        expect(
          valorDe(await c.consultas.fichaDeCompra(otra.gerente, { recepcionId: r.recepcionId })),
        ).toBeNull();
        expect(valorDe(await c.consultas.listarCompras(otra.gerente)).compras).toEqual([]);
        const mb = await armar(otra);
        const claveCompartida = nuevoId();
        valorDe(await c.casos.registrarCompra(e.operador, compra(m, { clave: claveCompartida })));
        const enB = valorDe(
          await c.casos.registrarCompra(otra.operador, {
            clave: claveCompartida,
            sucursalId: otra.sucursal,
            proveedorId: mb.proveedor,
            renglones: [
              {
                productoId: mb.producto,
                unidadDeCompraId: "GRAMO",
                cantidad: "10",
                precioPor: "UNIDAD",
                unidadDePrecioId: "GRAMO",
                precio: "1",
              },
            ],
          }),
        );
        expect(enB.yaExistia).toBe(false);
      });
    });

    // =============================================================================================
    describe("anularCompra", () => {
      it("anular deja el espejo en stock con el mismo costo, la recepción ANULADA con quién y por qué, y auditado", async () => {
        const m = await armar();
        const r = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
        expect(
          valorDe(
            await c.casos.anularCompra(e.administrador, {
              recepcionId: r.recepcionId,
              motivo: "Mercadería devuelta",
            }),
          ),
        ).toEqual({ anulada: true });
        expect(await c.existencia(m.deposito, m.articulo)).toBe("0.0000");
        expect(await movimientosDe(m.deposito)).toBe(2);
        const [rec] = await c.filas<Record<string, unknown>>(
          "select estado, anulada_por, motivo_de_anulacion from recepcion where id = $1",
          [r.recepcionId],
        );
        expect(rec).toMatchObject({
          estado: "ANULADA",
          anulada_por: e.administrador.personaId,
          motivo_de_anulacion: "Mercadería devuelta",
        });
        expect((await c.auditoria(e.empresa, "COMPRA_ANULADA")).at(-1)).toMatchObject({
          entidad_id: r.recepcionId,
        });
        const ficha = valorDe(
          await c.consultas.fichaDeCompra(e.gerente, { recepcionId: r.recepcionId }),
        );
        expect(ficha?.estado).toBe("ANULADA");
      });

      it("I7: anular dos veces la misma compra deja un solo espejo y la segunda da RECEPCION_YA_ANULADA", async () => {
        const m = await armar();
        const r = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
        valorDe(
          await c.casos.anularCompra(e.gerente, {
            recepcionId: r.recepcionId,
            motivo: "Error de carga",
          }),
        );
        expect(
          await c.casos.anularCompra(e.gerente, {
            recepcionId: r.recepcionId,
            motivo: "Error de carga",
          }),
        ).toEqual({ ok: false, error: "RECEPCION_YA_ANULADA" });
        expect(await movimientosDe(m.deposito)).toBe(2);
        expect(await c.existencia(m.deposito, m.articulo)).toBe("0.0000");
      });

      it("anular dos veces a la vez deja un solo espejo", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const m = await armar();
          const r = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
          c.armarBarrera(2);
          try {
            const resultados = await Promise.all([
              c.casos.anularCompra(e.gerente, { recepcionId: r.recepcionId, motivo: "Una" }),
              c.casos.anularCompra(e.administrador, { recepcionId: r.recepcionId, motivo: "Otra" }),
            ]);
            expect(resultados.filter((x) => x.ok)).toHaveLength(1);
            expect(
              resultados
                .filter((x) => !x.ok)
                .every((x) =>
                  ["RECEPCION_YA_ANULADA", "ConcurrenciaAgotada"].includes(codigoDe(x)),
                ),
            ).toBe(true);
          } finally {
            c.soltarBarrera();
          }
          expect(await movimientosDe(m.deposito)).toBe(2);
        }
      });

      it("COMPRA_CONSUMIDA: si lo que entró ya se consumió, no se anula y no cambia nada", async () => {
        const m = await armar();
        const r = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
        valorDe(
          await c.stockCasos.registrarSalida(e.gerente, {
            clave: nuevoId(),
            depositoId: m.deposito,
            motivo: "MERMA",
            detalle: "se tiró",
            renglones: [{ productoId: m.producto, cantidad: "1500", unidadId: "GRAMO" }],
          }),
        );
        expect(
          await c.casos.anularCompra(e.gerente, {
            recepcionId: r.recepcionId,
            motivo: "Quiero anularla",
          }),
        ).toEqual({ ok: false, error: "COMPRA_CONSUMIDA" });
        expect(await c.existencia(m.deposito, m.articulo)).toBe("500.0000");
        const [rec] = await c.filas<{ estado: string }>(
          "select estado from recepcion where id = $1",
          [r.recepcionId],
        );
        expect(rec?.estado).toBe("CONFIRMADA");
      });

      it("permisos y validación: el operador no anula; el motivo es obligatorio; una compra que no existe", async () => {
        const m = await armar();
        const r = valorDe(await c.casos.registrarCompra(e.operador, compra(m)));
        expect(
          await c.casos.anularCompra(e.operador, { recepcionId: r.recepcionId, motivo: "Quiero" }),
        ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
        expect(
          await c.casos.anularCompra(e.gerente, { recepcionId: r.recepcionId, motivo: "" }),
        ).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
        expect(
          await c.casos.anularCompra(e.gerente, { recepcionId: nuevoId(), motivo: "Quiero" }),
        ).toEqual({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
        expect(
          await c.casos.anularCompra(e.gerente, { recepcionId: "x", motivo: "Quiero" }),
        ).toEqual({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
        expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
      });
    });

    // =============================================================================================
    describe("configurarCompras", () => {
      it("solo el gerente cambia el nivel; rige hacia adelante y cada compra sella el nivel con que nació", async () => {
        const otra = await c.escenario();
        const m = await armar(otra);
        const antes = valorDe(
          await c.casos.registrarCompra(otra.operador, {
            ...compra(m, { sucursalId: otra.sucursal }),
          }),
        );
        expect(
          await c.casos.configurarCompras(otra.administrador, {
            nivel: "CON_COMPROBANTE",
            versionEsperada: 1,
          }),
        ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
        const nueva = valorDe(
          await c.casos.configurarCompras(otra.gerente, {
            nivel: "CON_COMPROBANTE",
            versionEsperada: 1,
          }),
        );
        expect(nueva).toMatchObject({ nivel: "CON_COMPROBANTE", version: 2 });
        const despues = valorDe(
          await c.casos.registrarCompra(otra.operador, {
            ...compra(m, { sucursalId: otra.sucursal }),
          }),
        );
        const niveles = await c.filas<{ id: string; nivel: string }>(
          "select id, nivel from recepcion where id = any($1)",
          [[antes.recepcionId, despues.recepcionId]],
        );
        expect(niveles.find((n) => n.id === antes.recepcionId)?.nivel).toBe("COMPRA_SIMPLE");
        expect(niveles.find((n) => n.id === despues.recepcionId)?.nivel).toBe("CON_COMPROBANTE");
      });

      it("N3 y N4 están apagados (FUNCION_NO_INCLUIDA con la perilla); un nivel inválido; versión vieja", async () => {
        const otra = await c.escenario();
        expect(
          await c.casos.configurarCompras(otra.gerente, {
            nivel: "RECEPCION_SEPARADA",
            versionEsperada: 1,
          }),
        ).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "recepcion_separada" },
        });
        expect(
          await c.casos.configurarCompras(otra.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }),
        ).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "conciliacion_de_tres_vias" },
        });
        expect(
          await c.casos.configurarCompras(otra.gerente, { nivel: "OTRO", versionEsperada: 1 }),
        ).toEqual({ ok: false, error: "NIVEL_INVALIDO" });
        valorDe(
          await c.casos.configurarCompras(otra.gerente, {
            nivel: "CON_COMPROBANTE",
            versionEsperada: 1,
          }),
        );
        expect(
          await c.casos.configurarCompras(otra.gerente, {
            nivel: "COMPRA_SIMPLE",
            versionEsperada: 1,
          }),
        ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      });

      it("configurarCompras con el nivel que ya está devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
        const otra = await c.escenario();
        const hecho = valorDe(
          await c.casos.configurarCompras(otra.gerente, {
            nivel: "CON_COMPROBANTE",
            versionEsperada: 1,
          }),
        );
        const auditorias = (await c.auditoria(otra.empresa, "COMPRAS_NIVEL_CAMBIADO")).length;
        expect(
          valorDe(
            await c.casos.configurarCompras(otra.gerente, {
              nivel: "CON_COMPROBANTE",
              versionEsperada: 1,
            }),
          ),
        ).toEqual(hecho);
        expect((await c.auditoria(otra.empresa, "COMPRAS_NIVEL_CAMBIADO")).length).toBe(auditorias);
      });
    });

    // =============================================================================================
    describe("consultas", () => {
      it("listarCompras: de la más nueva a la más vieja, con el estado derivado, el filtro por estado y proveedor, y el alcance del operador", async () => {
        const otra = await c.escenario();
        const m = await armar(otra);
        const a = valorDe(
          await c.casos.registrarCompra(otra.operador, compra(m, { sucursalId: otra.sucursal })),
        );
        const b = valorDe(
          await c.casos.registrarCompra(otra.operador, compra(m, { sucursalId: otra.sucursal })),
        );
        valorDe(
          await c.casos.anularCompra(otra.gerente, { recepcionId: a.recepcionId, motivo: "Error" }),
        );
        const todas = valorDe(await c.consultas.listarCompras(otra.gerente));
        const porId = (x: readonly string[], y: readonly string[]) =>
          (x[0] as string).localeCompare(y[0] as string);
        expect(todas.compras.map((x) => [x.recepcionId, x.estado]).sort(porId)).toEqual(
          [
            [b.recepcionId, "RECIBIDA_SIN_FACTURAR"],
            [a.recepcionId, "ANULADA"],
          ].sort(porId),
        );
        // misma jornada: el desempate es el id, de mayor a menor
        expect(todas.compras.map((x) => x.recepcionId)).toEqual(
          [a.recepcionId, b.recepcionId].sort().reverse(),
        );
        expect(
          valorDe(await c.consultas.listarCompras(otra.gerente, { estado: "ANULADA" })).compras.map(
            (x) => x.recepcionId,
          ),
        ).toEqual([a.recepcionId]);
        expect(
          valorDe(
            await c.consultas.listarCompras(otra.gerente, { estado: "RECIBIDA_SIN_FACTURAR" }),
          ).compras.map((x) => x.recepcionId),
        ).toEqual([b.recepcionId]);
        expect(
          valorDe(await c.consultas.listarCompras(otra.gerente, { estado: "RECIBIDA_Y_FACTURADA" }))
            .compras,
        ).toEqual([]);
        expect(
          valorDe(await c.consultas.listarCompras(otra.gerente, { proveedorId: nuevoId() }))
            .compras,
        ).toEqual([]);
        expect(valorDe(await c.consultas.listarCompras(otra.operador)).compras).toHaveLength(2);
        expect(
          await c.consultas.listarCompras(otra.operador, { sucursalId: otra.otraSucursal }),
        ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
        expect(await c.consultas.listarCompras(otra.gerente, { despuesDe: "basura" })).toEqual({
          ok: false,
          error: "CURSOR_INVALIDO",
        });
        expect(await c.consultas.listarCompras(otra.gerente, { desde: "ayer" })).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
      });

      it("fichaDeCompra muestra las líneas con lo que entra a stock y el costo (o «sin precio»); fuera del alcance es indistinguible de inexistente", async () => {
        const otra = await c.escenario();
        const m = await armar(otra);
        const r = valorDe(
          await c.casos.registrarCompra(otra.operador, compra(m, { sucursalId: otra.sucursal })),
        );
        const ficha = valorDe(
          await c.consultas.fichaDeCompra(otra.operador, { recepcionId: r.recepcionId }),
        );
        expect(ficha).toMatchObject({
          estado: "RECIBIDA_SIN_FACTURAR",
          nivel: "COMPRA_SIMPLE",
          proveedorId: m.proveedor,
        });
        expect(ficha?.lineas[0]).toMatchObject({
          cantidadEnStock: "2000.0000",
          costoPorUnidadDeStock: "1.000000",
          importe: "2000.00",
        });
        c.alcances.set(otra.operador.personaId as string, [otra.otraSucursal]);
        try {
          expect(
            valorDe(await c.consultas.fichaDeCompra(otra.operador, { recepcionId: r.recepcionId })),
          ).toBeNull();
        } finally {
          c.alcances.delete(otra.operador.personaId as string);
        }
        expect(await c.consultas.fichaDeCompra(otra.gerente, { recepcionId: "x" })).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
      });
    });
  },
);
