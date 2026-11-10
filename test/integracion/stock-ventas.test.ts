import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { fechaCivilDesdeTexto } from "../../src/primitivas/tiempo/fecha-civil";
import {
  traducirMovimiento,
  type EntradaDeEntradaPorOrigen,
  type EntradaDeSalidaPorVenta,
} from "../../src/modulos/stock/publico";
import {
  grupoDeBase,
  opcionDeBase,
  productoDeBase,
  type ClaseDeUsoDePrueba,
} from "./catalogo-apoyo";
import {
  aLaVez,
  firme,
  montarStock,
  nuevoId,
  RONDAS,
  soloOk,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T7, los puertos que stock ofrece a ventas y a compras, llamados como los llamaría ventas (E4 todavía no está cableado): dentro de la
 * transacción de quien llama y con la `Tx` que arma la composición. P9, P10 y P14 (la salida por venta es una por ejemplar y atómica con el
 * llamador), P18 (la explosión: rinde, factor de tamaño, fracciones, un solo redondeo, conversión exacta), P19 (falta receta no frena la venta),
 * P20 (con el módulo apagado nada controla ni descuenta), la reversión idempotente, la entrada por origen y el aislamiento entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const JORNADA_DEL_TICKET = "2026-10-09";

describe.skipIf(base === null)("stock: puertos de venta", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  /** El depósito de venta de la sucursal de `e`, y el de `otra`. */
  let dep: string;
  let depDeOtra: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    dep = await c.deposito(e, { deVenta: true });
    depDeOtra = await c.deposito(otra, { deVenta: true });
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  // ---- el escenario ---------------------------------------------------------------------------------------------------------------

  const insumo = (
    datos: Parameters<MontajeDeStock["articulo"]>[1] = {},
    escenario: Pick<EscenarioDeStock, "empresa"> = e,
  ) => c.articulo(escenario, { clase: "INSUMO", ...datos });
  const reventa = (datos: Parameters<MontajeDeStock["articulo"]>[1] = {}) =>
    c.articulo(e, { clase: "REVENTA", ...datos });
  const vendible = (
    datos: Parameters<typeof productoDeBase>[2] = {},
    empresa: string = e.empresa,
  ) => productoDeBase(c.dueno, empresa, { clase: "VENDIBLE", ...datos });
  const clase = (tipo: ClaseDeUsoDePrueba, empresa: string = e.empresa) =>
    productoDeBase(c.dueno, empresa, { clase: tipo });
  /** Un vendible con su receta guardada por el caso de uso real; devuelve el producto y el id de la versión de la receta. */
  const conReceta = async (
    rinde: string,
    componentes: ReadonlyArray<readonly [producto: string, cantidad: string, unidad?: string]>,
    datos: Parameters<typeof productoDeBase>[2] = {},
  ) => {
    const producto = await vendible(datos);
    valorDe(
      await c.casos.guardarComposicion(e.gerente, {
        productoId: producto,
        versionEsperada: 0,
        rinde,
        componentes: componentes.map(([productoId, cantidad, unidadId]) => ({
          productoId,
          cantidad,
          unidadId: unidadId ?? "UNIDAD",
        })),
      }),
    );
    const receta = (
      await c.filas<{ id: string }>("select id from composicion where producto_id = $1", [producto])
    )[0]?.id as string;
    return { producto, receta };
  };
  /** Una opción de un grupo adicional con su versión sellada y lo que consume, cargado en la misma transacción que la versión (lo exige la base). */
  const opcion = async (
    vendibleId: string,
    datos: Readonly<{
      consumos?: ReadonlyArray<readonly [insumo: string, cantidad: string, escala: boolean]>;
    }> = {},
  ): Promise<string> => {
    await c.dueno.query("begin");
    try {
      const grupo = await grupoDeBase(c.dueno, e.empresa, vendibleId, { clase: "ADICIONAL" });
      const creada = await opcionDeBase(c.dueno, e.empresa, vendibleId, grupo);
      let numero = 0;
      for (const [insumoId, cantidad, escala] of datos.consumos ?? []) {
        numero += 1;
        await c.dueno.query(
          "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad, escala_con_tamano) values ($1, $2, $3, $4, $5, $6)",
          [e.empresa, creada.version, numero, insumoId, cantidad, escala],
        );
      }
      await c.dueno.query("commit");
      return creada.version;
    } catch (error) {
      await c.dueno.query("rollback");
      throw error;
    }
  };
  /** La variante de tamaño de un vendible (un solo grupo por producto) con una opción por factor; devuelve la versión sellada de cada una. */
  const tamanos = async (vendibleId: string, factores: readonly string[]): Promise<string[]> => {
    await c.dueno.query("begin");
    try {
      const grupo = await grupoDeBase(c.dueno, e.empresa, vendibleId, {
        clase: "VARIANTE",
        esTamano: true,
      });
      const versiones: string[] = [];
      for (const factor of factores) {
        versiones.push(
          (await opcionDeBase(c.dueno, e.empresa, vendibleId, grupo, { factor })).version,
        );
      }
      await c.dueno.query("commit");
      return versiones;
    } catch (error) {
      await c.dueno.query("rollback");
      throw error;
    }
  };
  const meter = (articulo: string, cantidad: string, deposito = dep) =>
    c.entrar(e.gerente, { depositoId: deposito, articuloId: articulo, cantidad });
  const fecha = (texto: string) => valorDe(fechaCivilDesdeTexto(texto));

  type Linea = EntradaDeSalidaPorVenta["renglones"][number];
  const linea = (
    producto: string,
    cantidad = "1",
    extra: Partial<Linea> = {},
    posicion = 1,
  ): Linea => ({
    posicion,
    productoId: producto,
    cantidad,
    unidadDeVentaId: "UNIDAD",
    opciones: [],
    ...extra,
  });
  /** La llamada de ventas: el puerto dentro de la transacción de quien llama, traducida como lo hace stock (`traducirMovimiento`). */
  const vender = async (
    renglones: readonly Linea[],
    extra: Partial<EntradaDeSalidaPorVenta> = {},
    contexto = e.gerente,
  ) => {
    const entrada: EntradaDeSalidaPorVenta = {
      origen: { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() },
      accion: "cuentas.cerrar",
      depositoId: dep,
      hechoEn: contexto.ahora,
      fechaDeNegocio: fecha(JORNADA_DEL_TICKET),
      renglones,
      ...extra,
    };
    return traducirMovimiento(
      await c.entorno.ejecutar({ contexto }, (tx) =>
        c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, contexto, entrada),
      ),
    );
  };
  const revertir = async (
    ejemplarId: string,
    extra: Record<string, unknown> = {},
    contexto = e.gerente,
  ) =>
    traducirMovimiento(
      await c.entorno.ejecutar({ contexto }, (tx) =>
        c.puertos.reversionDeStock.revertirPorOrigen(tx, contexto, {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplarId },
          accion: "tickets.corregir",
          detalle: "Ticket anulado",
          ...extra,
        }),
      ),
    );
  const recibir = async (
    extra: Partial<EntradaDeEntradaPorOrigen> & Record<string, unknown> = {},
    contexto = e.gerente,
  ) =>
    traducirMovimiento(
      await c.entorno.ejecutar({ contexto }, (tx) =>
        c.puertos.entradaPorOrigen.registrarEntrada(tx, contexto, {
          clave: nuevoId(),
          origen: { tipo: "RECEPCION", id: nuevoId() },
          accion: "stock.registrar_entrada",
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [],
          ...extra,
        }),
      ),
    );
  const movimientos = (escenario: Pick<EscenarioDeStock, "empresa"> = e) =>
    c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
      escenario.empresa,
    ]);
  const renglonesDe = (movimientoId: string) =>
    c.filas<{
      articulo_id: string;
      cantidad: string;
      composicion_id: string | null;
      deposito_id: string;
    }>(
      "select articulo_id, cantidad::text as cantidad, composicion_id, deposito_id from renglon_de_movimiento where movimiento_id = $1 order by articulo_id",
      [movimientoId],
    );
  const delEjemplar = (ejemplarId: string, clase_: string) =>
    c.filas<{ id: string; clave_idempotencia: string; accion: string }>(
      "select id, clave_idempotencia, accion from movimiento_de_stock where origen_tipo = 'EJEMPLAR_DE_TICKET' and origen_id = $1 and clase = $2 order by registrado_en",
      [ejemplarId, clase_],
    );
  const controla = (productos: readonly string[], contexto = e.gerente) =>
    c.entorno.ejecutar({ contexto }, async (tx) => ({
      ok: true as const,
      valor: await c.puertos.articulosDeVenta.controla(tx, contexto, productos),
    }));

  // ---- P18: la explosión ---------------------------------------------------------------------------------------------------------

  describe("P18: la explosión de lo vendido", () => {
    it("una receta que rinde 10 con una opción que escala por el factor de tamaño (1,5): cantidades exactas por artículo, con la versión de la receta, la jornada del ticket y la acción de quien llama", async () => {
      const harina = await insumo({ unidadBase: "GRAMO", dimension: "MASA" });
      const queso = await insumo({ unidadBase: "GRAMO", dimension: "MASA" });
      const aceitunas = await insumo();
      await meter(harina.articulo, "10000");
      await meter(queso.articulo, "10000");
      await meter(aceitunas.articulo, "50");
      const pizza = await conReceta("10", [[harina.producto, "500", "GRAMO"]]);
      const [grande, chica] = await tamanos(pizza.producto, ["1.5", "1"]);
      const extraQueso = await opcion(pizza.producto, {
        consumos: [
          [queso.producto, "100", true],
          [aceitunas.producto, "2", false],
        ],
      });
      const ejemplar = nuevoId();
      const hechoEn = new Date(e.gerente.ahora.getTime() - 5 * 60_000);
      const resultado = valorDe(
        await vender(
          [
            linea(pizza.producto, "2", {
              varianteVersionDeOpcionId: grande,
              opciones: [{ versionDeOpcionId: extraQueso }],
            }),
          ],
          { origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar }, hechoEn },
        ),
      );
      expect(resultado).toMatchObject({ yaExistia: false, excepciones: [], avisos: [] });
      const movimientoId = resultado.movimientoId as string;
      const filas = await renglonesDe(movimientoId);
      const de = (articulo: string) => filas.find((f) => f.articulo_id === articulo);
      // harina: 500 g × 2 ÷ 10 = 100 g (de la versión de la receta). queso: 100 g × 2 × 1,5 = 300 g, aceitunas: 2 × 2 = 4 (sin factor).
      expect(de(harina.articulo)).toMatchObject({
        cantidad: "-100.0000",
        composicion_id: pizza.receta,
        deposito_id: dep,
      });
      expect(de(queso.articulo)).toMatchObject({ cantidad: "-300.0000", composicion_id: null });
      expect(de(aceitunas.articulo)).toMatchObject({ cantidad: "-4.0000", composicion_id: null });
      expect(filas).toHaveLength(3);
      expect(await c.existencia(dep, harina.articulo)).toBe("9900.0000");
      expect(await c.existencia(dep, queso.articulo)).toBe("9700.0000");
      expect(await c.existencia(dep, aceitunas.articulo)).toBe("46.0000");
      // El movimiento: venta con el origen del ejemplar, la acción de quien llama, la jornada DEL TICKET (no la de `hecho_en`) y una clave que no es un uuid.
      const [m] = await c.filas<Record<string, unknown>>(
        "select clase, motivo, origen_tipo, origen_id, accion, clave_idempotencia, hecho_en, fecha_negocio::text as fecha_negocio, registrado_por, deposito_id from movimiento_de_stock where id = $1",
        [movimientoId],
      );
      expect(m).toMatchObject({
        clase: "SALIDA",
        motivo: "VENTA",
        origen_tipo: "EJEMPLAR_DE_TICKET",
        origen_id: ejemplar,
        accion: "cuentas.cerrar",
        clave_idempotencia: `venta_${ejemplar}`,
        fecha_negocio: JORNADA_DEL_TICKET,
        registrado_por: e.personaDelGerente,
        deposito_id: dep,
      });
      expect((m?.["hecho_en"] as Date).toISOString()).toBe(hechoEn.toISOString());
      // Una variante sin escala no toca lo que no escala; con la chica (factor 1) el queso escala 1×.
      const otra_ = valorDe(
        await vender([
          linea(pizza.producto, "1", {
            varianteVersionDeOpcionId: chica,
            opciones: [{ versionDeOpcionId: extraQueso }],
          }),
        ]),
      );
      expect(
        (await renglonesDe(otra_.movimientoId as string)).find(
          (f) => f.articulo_id === queso.articulo,
        )?.cantidad,
      ).toBe("-100.0000");
    });

    it("con fracciones (media pizza, paso 0,5) dos líneas de 0,5 suman ANTES de redondear: un solo redondeo por renglón del libro", async () => {
      const levadura = await insumo();
      await meter(levadura.articulo, "5");
      // 0,0925 ÷ 10 = 0,00925 por unidad: 0,5 + 0,5 = 0,00925 → 0,0093 (una vez), no 0,0046 + 0,0046 = 0,0092.
      const pizza = await conReceta("10", [[levadura.producto, "0.0925"]], { paso: "0.5" });
      const dos = valorDe(
        await vender([linea(pizza.producto, "0.5"), linea(pizza.producto, "0.5", {}, 2)]),
      );
      expect(await renglonesDe(dos.movimientoId as string)).toEqual([
        {
          articulo_id: levadura.articulo,
          cantidad: "-0.0093",
          composicion_id: pizza.receta,
          deposito_id: dep,
        },
      ]);
      // Una sola línea de 0,5 redondea por su cuenta: 0,004625 → 0,0046.
      const una = valorDe(await vender([linea(pizza.producto, "0.5")]));
      expect((await renglonesDe(una.movimientoId as string))[0]?.cantidad).toBe("-0.0046");
      expect(await c.existencia(dep, levadura.articulo)).toBe("4.9861");
    });

    it("lo que redondea a cero no se escribe y se avisa (CANTIDAD_EN_CERO); sin nada que descontar no hay movimiento", async () => {
      const sal = await insumo();
      await meter(sal.articulo, "5");
      const pizza = await conReceta("10", [[sal.producto, "0.0001"]]);
      const antes = await movimientos();
      expect(valorDe(await vender([linea(pizza.producto, "1")]))).toEqual({
        movimientoId: null,
        yaExistia: false,
        excepciones: [],
        avisos: [
          { tipo: "CANTIDAD_EN_CERO", articuloId: sal.articulo, composicionId: pizza.receta },
        ],
      });
      expect(await movimientos()).toBe(antes);
      expect(await c.existencia(dep, sal.articulo)).toBe("5.0000");
    });

    it("la conversión de la unidad de venta a la base es exacta o se rechaza (CONVERSION_NO_EXACTA), y una dimensión distinta también (DIMENSION_DISTINTA)", async () => {
      const queso = await reventa({ unidadBase: "KILOGRAMO", dimension: "MASA" });
      await meter(queso.articulo, "5");
      const antes = await movimientos();
      // 0,05 g son 0,00005 kg: no entra en 4 decimales.
      for (const [cantidad, unidad, esperado] of [
        ["0.05", "GRAMO", "CONVERSION_NO_EXACTA"],
        ["1", "LITRO", "DIMENSION_DISTINTA"],
        ["1", "UNIDAD", "DIMENSION_DISTINTA"],
      ] as const) {
        expect(
          await vender([linea(queso.producto, cantidad, { unidadDeVentaId: unidad })]),
          `${cantidad} ${unidad}`,
        ).toEqual({
          ok: false,
          error: esperado,
        });
      }
      expect(await movimientos()).toBe(antes);
      const vendida = valorDe(
        await vender([linea(queso.producto, "250", { unidadDeVentaId: "GRAMO" })]),
      );
      expect(await renglonesDe(vendida.movimientoId as string)).toMatchObject([
        { cantidad: "-0.2500" },
      ]);
      expect(await c.existencia(dep, queso.articulo)).toBe("4.7500");
    });

    it("una venta por peso con una opción que consume no está definida y se rechaza (S-9, OPCION_CON_CONSUMO_EN_VENTA_POR_PESO)", async () => {
      const sal = await insumo();
      await meter(sal.articulo, "5");
      const harina = await insumo({ unidadBase: "KILOGRAMO", dimension: "MASA" });
      const pan = await conReceta("1", [[harina.producto, "1", "KILOGRAMO"]], {
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
      });
      const conSal = await opcion(pan.producto, { consumos: [[sal.producto, "1", false]] });
      const sinConsumo = await opcion(pan.producto);
      const antes = await movimientos();
      expect(
        await vender([
          linea(pan.producto, "2", {
            unidadDeVentaId: "KILOGRAMO",
            opciones: [{ versionDeOpcionId: conSal }],
          }),
        ]),
      ).toEqual({ ok: false, error: "OPCION_CON_CONSUMO_EN_VENTA_POR_PESO" });
      expect(await movimientos()).toBe(antes);
      // Una opción que no consume sí se puede vender por peso.
      expect(
        valorDe(
          await vender([
            linea(pan.producto, "2", {
              unidadDeVentaId: "KILOGRAMO",
              opciones: [{ versionDeOpcionId: sinConsumo }],
            }),
          ]),
        ).movimientoId,
      ).not.toBeNull();
    });

    it("un insumo de una opción sin artículo activo no descuenta y se avisa (INSUMO_SIN_ARTICULO): la venta pasa", async () => {
      const queso = await insumo();
      const sinArticulo = await clase("INSUMO");
      await meter(queso.articulo, "10");
      const pizza = await conReceta("1", [[queso.producto, "1"]]);
      const extra = await opcion(pizza.producto, { consumos: [[sinArticulo, "3", false]] });
      const r = valorDe(
        await vender([linea(pizza.producto, "1", { opciones: [{ versionDeOpcionId: extra }] })]),
      );
      expect(r.avisos).toEqual([
        { tipo: "INSUMO_SIN_ARTICULO", posicion: 1, insumoId: sinArticulo },
      ]);
      expect(await renglonesDe(r.movimientoId as string)).toHaveLength(1);
    });

    it("lo que lee de la opción es la versión SELLADA: editar el consumo después no cambia lo que ya se vendió ni lo que se vende con esa versión", async () => {
      const queso = await insumo();
      await meter(queso.articulo, "100");
      const pizza = await conReceta("1", [[queso.producto, "1"]]);
      const viejo = await opcion(pizza.producto, { consumos: [[queso.producto, "2", false]] });
      const nuevo = await opcion(pizza.producto, { consumos: [[queso.producto, "7", false]] });
      const r1 = valorDe(
        await vender([linea(pizza.producto, "1", { opciones: [{ versionDeOpcionId: viejo }] })]),
      );
      const r2 = valorDe(
        await vender([linea(pizza.producto, "1", { opciones: [{ versionDeOpcionId: nuevo }] })]),
      );
      // La receta (1) y la opción (2 o 7) van al mismo artículo pero en renglones distintos del libro (con y sin versión de receta).
      expect((await renglonesDe(r1.movimientoId as string)).map((f) => f.cantidad).sort()).toEqual([
        "-1.0000",
        "-2.0000",
      ]);
      expect((await renglonesDe(r2.movimientoId as string)).map((f) => f.cantidad).sort()).toEqual([
        "-1.0000",
        "-7.0000",
      ]);
    });
  });

  // ---- P19: falta receta ---------------------------------------------------------------------------------------------------------

  describe("P19: falta receta no frena la venta", () => {
    it("un VENDIBLE sin receta vende y devuelve FALTA_RECETA sin descontar nada; una REVENTA sin artículo no es «falta receta»: se vende sin controlar", async () => {
      const sinReceta = await vendible();
      const reventaSinArticulo = await clase("REVENTA");
      const antes = await movimientos();
      expect(valorDe(await vender([linea(sinReceta)]))).toEqual({
        movimientoId: null,
        yaExistia: false,
        excepciones: [{ posicion: 1, tipo: "FALTA_RECETA" }],
        avisos: [],
      });
      expect(valorDe(await vender([linea(reventaSinArticulo)]))).toEqual({
        movimientoId: null,
        yaExistia: false,
        excepciones: [],
        avisos: [],
      });
      expect(await movimientos()).toBe(antes);
      expect(valorDe(await controla([sinReceta, reventaSinArticulo]))).toEqual(
        new Map([
          [sinReceta, { controla: false, faltaReceta: true }],
          [reventaSinArticulo, { controla: false, faltaReceta: false }],
        ]),
      );
    });

    it("con varias líneas descuenta las que tienen receta o artículo y señala solo las que no (por posición); una receta retirada vuelve a ser «falta receta»", async () => {
      const gaseosa = await reventa();
      const harina = await insumo();
      await meter(gaseosa.articulo, "10");
      await meter(harina.articulo, "10");
      const pizza = await conReceta("1", [[harina.producto, "2"]]);
      const sinReceta = await vendible();
      const r = valorDe(
        await vender([
          linea(gaseosa.producto, "3"),
          linea(sinReceta, "1", {}, 2),
          linea(pizza.producto, "1", {}, 3),
        ]),
      );
      expect(r.excepciones).toEqual([{ posicion: 2, tipo: "FALTA_RECETA" }]);
      expect(r.movimientoId).not.toBeNull();
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("7.0000");
      expect(await c.existencia(dep, harina.articulo)).toBe("8.0000");
      expect(valorDe(await controla([gaseosa.producto, pizza.producto, sinReceta]))).toEqual(
        new Map([
          [gaseosa.producto, { controla: true, faltaReceta: false }],
          [pizza.producto, { controla: true, faltaReceta: false }],
          [sinReceta, { controla: false, faltaReceta: true }],
        ]),
      );
      valorDe(
        await c.casos.retirarComposicion(e.gerente, {
          productoId: pizza.producto,
          versionEsperada: 1,
        }),
      );
      expect(valorDe(await vender([linea(pizza.producto)])).excepciones).toEqual([
        { posicion: 1, tipo: "FALTA_RECETA" },
      ]);
      expect(valorDe(await controla([pizza.producto])).get(pizza.producto)).toEqual({
        controla: false,
        faltaReceta: true,
      });
    });

    it("controla: un id que no existe, de otra empresa o mal escrito no controla; todo id pedido figura en el resultado", async () => {
      const gaseosa = await reventa();
      const ajeno = await c.articulo(otra, { clase: "REVENTA" });
      const ids = [gaseosa.producto, nuevoId(), ajeno.producto, "x"];
      const mapa = valorDe(await controla(ids));
      expect([...mapa.keys()]).toEqual(ids);
      expect(mapa.get(gaseosa.producto)).toEqual({ controla: true, faltaReceta: false });
      for (const id of ids.slice(1))
        expect(mapa.get(id), id).toEqual({ controla: false, faltaReceta: false });
      // Un artículo que dejó de controlarse ya no controla.
      valorDe(await c.casos.dejarDeControlar(e.gerente, { productoId: gaseosa.producto }));
      expect(valorDe(await controla([gaseosa.producto])).get(gaseosa.producto)).toEqual({
        controla: false,
        faltaReceta: false,
      });
    });
  });

  // ---- P9, P10: una sola salida por ejemplar ------------------------------------------------------------------------------------

  describe("la identidad es el ejemplar", () => {
    it("P9: la misma salida por ejemplar dos veces deja una sola (la segunda es yaExistia con el mismo movimiento), aunque la receta se edite en el medio", async () => {
      const harina = await insumo();
      const sal = await insumo();
      await meter(harina.articulo, "100");
      await meter(sal.articulo, "100");
      const pizza = await conReceta("1", [[harina.producto, "3"]]);
      const origen = { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() } as const;
      const primera = valorDe(await vender([linea(pizza.producto, "2")], { origen }));
      expect(primera.yaExistia).toBe(false);
      expect(await c.existencia(dep, harina.articulo)).toBe("94.0000");
      // Se edita la receta (versión 2, otro componente) y el ticket vuelve a cerrarse: el primer hecho manda.
      valorDe(
        await c.casos.guardarComposicion(e.gerente, {
          productoId: pizza.producto,
          versionEsperada: 1,
          rinde: "1",
          componentes: [
            { productoId: harina.producto, cantidad: "9", unidadId: "UNIDAD" },
            { productoId: sal.producto, cantidad: "1", unidadId: "UNIDAD" },
          ],
        }),
      );
      const segunda = valorDe(await vender([linea(pizza.producto, "2")], { origen }));
      expect(segunda).toEqual({
        movimientoId: primera.movimientoId,
        yaExistia: true,
        excepciones: [],
        avisos: [],
      });
      // Aunque el llamador mande renglones distintos, la identidad es el ejemplar.
      expect(valorDe(await vender([linea(pizza.producto, "9")], { origen })).movimientoId).toBe(
        primera.movimientoId,
      );
      expect(await delEjemplar(origen.id, "SALIDA")).toHaveLength(1);
      expect(await c.existencia(dep, harina.articulo)).toBe("94.0000");
      expect(await c.existencia(dep, sal.articulo)).toBe("100.0000");
    });

    it("P9: también cuando la salida ya existe con OTRA clave de idempotencia (el único de origen la sostiene): el puerto devuelve esa y no escribe otra", async () => {
      const gaseosa = await reventa();
      await meter(gaseosa.articulo, "10");
      const previa = await c.ventaPorSql({
        empresa: e.empresa,
        depositoId: dep,
        articuloId: gaseosa.articulo,
        persona: e.personaDelGerente,
        cantidad: "2",
      });
      expect(
        valorDe(
          await vender([linea(gaseosa.producto, "2")], {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: previa.ejemplarId },
          }),
        ),
      ).toEqual({
        movimientoId: previa.movimientoId,
        yaExistia: true,
        excepciones: [],
        avisos: [],
      });
      expect(await delEjemplar(previa.ejemplarId, "SALIDA")).toHaveLength(1);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("8.0000");
    });

    it("una salida que no descontó nada (todo sin receta) no deja rastro: repetirla vuelve a evaluar, sin escribir mientras siga sin nada que descontar", async () => {
      const sinReceta = await vendible();
      const origen = { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() } as const;
      const antes = await movimientos();
      for (let i = 0; i < 2; i += 1) {
        expect(valorDe(await vender([linea(sinReceta)], { origen }))).toMatchObject({
          movimientoId: null,
          excepciones: [{ posicion: 1, tipo: "FALTA_RECETA" }],
        });
      }
      expect(await movimientos()).toBe(antes);
    });

    it("P10: dos cierres del mismo ejemplar a la vez descuentan una sola vez", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const gaseosa = await reventa();
        await meter(gaseosa.articulo, "10");
        const origen = { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() } as const;
        const pedido = () => firme(() => vender([linea(gaseosa.producto, "3")], { origen }));
        const resultados = await aLaVez(c, [pedido, pedido], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        const hechos = resultados.map((r) => (r.ok ? r.valor : null));
        expect(hechos.map((h) => h?.yaExistia).sort()).toEqual([false, true]);
        expect(new Set(hechos.map((h) => h?.movimientoId)).size).toBe(1);
        expect(await delEjemplar(origen.id, "SALIDA")).toHaveLength(1);
        expect(await c.existencia(dep, gaseosa.articulo)).toBe("7.0000");
      }
    });
  });

  // ---- P14: atómico con el llamador ----------------------------------------------------------------------------------------------

  describe("P14: la salida es atómica con la transacción de quien llama", () => {
    it("una falla del llamador después de la salida no deja ningún movimiento ni cambia el saldo", async () => {
      const gaseosa = await reventa();
      await meter(gaseosa.articulo, "10");
      const antes = await movimientos();
      const origen = { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() } as const;
      await expect(
        c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
          const r = await c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, e.gerente, {
            origen,
            accion: "cuentas.cerrar",
            depositoId: dep,
            hechoEn: e.gerente.ahora,
            fechaDeNegocio: fecha(JORNADA_DEL_TICKET),
            renglones: [linea(gaseosa.producto, "4")],
          });
          expect(r.ok).toBe(true);
          return Promise.reject(new Error("falla inyectada"));
        }),
      ).rejects.toThrow("falla inyectada");
      expect(await movimientos()).toBe(antes);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("10.0000");
      expect(await delEjemplar(origen.id, "SALIDA")).toHaveLength(0);
      // Y el ejemplar sigue libre: cerrarlo después descuenta normalmente.
      expect(valorDe(await vender([linea(gaseosa.producto, "4")], { origen })).yaExistia).toBe(
        false,
      );
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("6.0000");
    });

    it("con un depósito de venta inexistente el puerto devuelve el error y el llamador, al devolverlo, revierte todo lo suyo (aquí, una entrada escrita antes)", async () => {
      const gaseosa = await reventa();
      const recepcion = nuevoId();
      const antes = await movimientos();
      const r = await c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
        const entrada = await c.puertos.entradaPorOrigen.registrarEntrada(tx, e.gerente, {
          clave: nuevoId(),
          origen: { tipo: "RECEPCION", id: recepcion },
          accion: "stock.registrar_entrada",
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [{ productoId: gaseosa.producto, cantidad: "5", unidadId: "UNIDAD" }],
        });
        expect(entrada.ok).toBe(true);
        return c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, e.gerente, {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() },
          accion: "cuentas.cerrar",
          depositoId: nuevoId(),
          hechoEn: e.gerente.ahora,
          fechaDeNegocio: fecha(JORNADA_DEL_TICKET),
          renglones: [linea(gaseosa.producto, "1")],
        });
      });
      expect(r).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      expect(await movimientos()).toBe(antes);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("0");
    });

    it("el depósito de venta tiene que existir en la empresa, estar activo y ser de uso normal (cuarentena y rechazo no venden)", async () => {
      const gaseosa = await reventa();
      const inactivo = await c.deposito(e, { activo: false });
      const cuarentena = await c.deposito(e, { uso: "CUARENTENA" });
      const rechazo = await c.deposito(e, { uso: "RECHAZO" });
      const antes = await movimientos();
      for (const [depositoId, esperado] of [
        [nuevoId(), "DEPOSITO_NO_ENCONTRADO"],
        ["no-es-un-uuid", "DEPOSITO_NO_ENCONTRADO"],
        [depDeOtra, "DEPOSITO_NO_ENCONTRADO"],
        [inactivo, "DEPOSITO_INACTIVO"],
        [cuarentena, "MOTIVO_NO_PERMITIDO"],
        [rechazo, "MOTIVO_NO_PERMITIDO"],
      ] as const) {
        expect(await vender([linea(gaseosa.producto)], { depositoId }), depositoId).toEqual({
          ok: false,
          error: esperado,
        });
      }
      expect(await movimientos()).toBe(antes);
    });

    it("DepositoDeVenta: el depósito de venta activo de la sucursal, o null si no hay (la otra sucursal, un id que no existe o mal escrito)", async () => {
      const buscar = (sucursal: string, escenario = e) =>
        c.entorno.ejecutar({ contexto: escenario.gerente }, async (tx) => ({
          ok: true as const,
          valor: await c.puertos.depositoDeVenta.deVenta(tx, escenario.gerente, sucursal),
        }));
      expect(valorDe(await buscar(e.sucursal))).toEqual({ depositoId: dep });
      expect(valorDe(await buscar(e.otraSucursal))).toBeNull();
      expect(valorDe(await buscar(nuevoId()))).toBeNull();
      expect(valorDe(await buscar("x"))).toBeNull();
      // Otra empresa no ve el depósito de venta de esta, ni con su sucursal.
      expect(valorDe(await buscar(e.sucursal, otra))).toBeNull();
      expect(valorDe(await buscar(otra.sucursal, otra))).toEqual({ depositoId: depDeOtra });
    });
  });

  // ---- lo que llega mal ------------------------------------------------------------------------------------------------------------

  describe("lo que llega de ventas se vuelve a comprobar (lista de permitidos)", () => {
    it("renglones, posiciones, cantidades, unidades, productos, versiones y origen inválidos se rechazan sin escribir nada", async () => {
      const gaseosa = await reventa();
      await meter(gaseosa.articulo, "10");
      const pizza = await conReceta("1", [[(await insumo()).producto, "1"]]);
      const opcionValida = await opcion(pizza.producto);
      const antes = await movimientos();
      const casos: ReadonlyArray<readonly [string, Parameters<typeof vender>, string]> = [
        ["sin renglones", [[]], "RENGLONES_INVALIDOS"],
        ["renglones que no es una lista", ["x" as never], "RENGLONES_INVALIDOS"],
        ["posición cero", [[linea(gaseosa.producto, "1", {}, 0)]], "RENGLONES_INVALIDOS"],
        [
          "posición con decimales",
          [[linea(gaseosa.producto, "1", {}, 1.5)]],
          "RENGLONES_INVALIDOS",
        ],
        [
          "posición repetida",
          [[linea(gaseosa.producto, "1", {}, 1), linea(gaseosa.producto, "1", {}, 1)]],
          "RENGLONES_INVALIDOS",
        ],
        ["cantidad cero", [[linea(gaseosa.producto, "0")]], "CANTIDAD_INVALIDA"],
        ["cantidad negativa", [[linea(gaseosa.producto, "-1")]], "CANTIDAD_INVALIDA"],
        ["cantidad con más decimales", [[linea(gaseosa.producto, "0.00001")]], "CANTIDAD_INVALIDA"],
        ["cantidad con texto", [[linea(gaseosa.producto, "1e3")]], "CANTIDAD_INVALIDA"],
        [
          "unidad desconocida",
          [[linea(gaseosa.producto, "1", { unidadDeVentaId: "CAJA" })]],
          "IDENTIFICADOR_INVALIDO",
        ],
        ["producto que no es uuid", [[linea("x")]], "PRODUCTO_NO_ENCONTRADO"],
        ["producto que no existe", [[linea(nuevoId())]], "PRODUCTO_NO_ENCONTRADO"],
        [
          "opción que no existe",
          [[linea(pizza.producto, "1", { opciones: [{ versionDeOpcionId: nuevoId() }] })]],
          "VERSION_DE_OPCION_NO_ENCONTRADA",
        ],
        [
          "opción que no es uuid",
          [[linea(pizza.producto, "1", { opciones: [{ versionDeOpcionId: "x" }] })]],
          "VERSION_DE_OPCION_NO_ENCONTRADA",
        ],
        [
          "variante que no existe",
          [[linea(pizza.producto, "1", { varianteVersionDeOpcionId: nuevoId() })]],
          "VERSION_DE_OPCION_NO_ENCONTRADA",
        ],
        [
          "variante que no es uuid",
          [[linea(pizza.producto, "1", { varianteVersionDeOpcionId: "x" })]],
          "VERSION_DE_OPCION_NO_ENCONTRADA",
        ],
        [
          "opciones sin lista",
          [[{ ...linea(pizza.producto), opciones: "x" as never }]],
          "RENGLONES_INVALIDOS",
        ],
        [
          "la misma opción dos veces",
          [
            [
              linea(pizza.producto, "1", {
                opciones: [
                  { versionDeOpcionId: opcionValida },
                  { versionDeOpcionId: opcionValida },
                ],
              }),
            ],
          ],
          "RENGLONES_INVALIDOS",
        ],
        [
          "origen de otro tipo",
          [[linea(gaseosa.producto)], { origen: { tipo: "RECEPCION", id: nuevoId() } as never }],
          "IDENTIFICADOR_INVALIDO",
        ],
        [
          "origen sin uuid",
          [[linea(gaseosa.producto)], { origen: { tipo: "EJEMPLAR_DE_TICKET", id: "x" } }],
          "IDENTIFICADOR_INVALIDO",
        ],
        [
          "confirmación desconocida",
          [[linea(gaseosa.producto)], { confirmaciones: ["otro.control"] }],
          "IDENTIFICADOR_INVALIDO",
        ],
        [
          "fecha de negocio inválida",
          [[linea(gaseosa.producto)], { fechaDeNegocio: "2026-02-30" as never }],
          "IDENTIFICADOR_INVALIDO",
        ],
        [
          "momento inválido",
          [[linea(gaseosa.producto)], { hechoEn: "ayer" as never }],
          "IDENTIFICADOR_INVALIDO",
        ],
      ];
      for (const [nombre, argumentos, esperado] of casos) {
        expect(await vender(...argumentos), nombre).toEqual({ ok: false, error: esperado });
      }
      expect(await movimientos()).toBe(antes);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("10.0000");
    });
  });

  // ---- el control de existencia negativa ---------------------------------------------------------------------------------------

  describe("el control de existencia negativa en la venta", () => {
    /** Una empresa con su nivel y su depósito de venta; el nivel no admite borrado. */
    const conNivel = async (nivel: "PERMITIR" | "AVISAR" | "BLOQUEAR") => {
      const m = await c.escenario();
      await c.fijarNivel(m.empresa, nivel);
      const deposito = await c.deposito(m, { deVenta: true });
      const articulo = await c.articulo(m, { clase: "REVENTA" });
      return { m, deposito, ...articulo };
    };
    const venderDe = async (
      x: Awaited<ReturnType<typeof conNivel>>,
      cantidad: string,
      extra: Partial<EntradaDeSalidaPorVenta> = {},
    ) =>
      traducirMovimiento(
        await c.entorno.ejecutar({ contexto: x.m.gerente }, (tx) =>
          c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, x.m.gerente, {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() },
            accion: "cuentas.cerrar",
            depositoId: x.deposito,
            hechoEn: x.m.gerente.ahora,
            fechaDeNegocio: fecha(JORNADA_DEL_TICKET),
            renglones: [linea(x.producto, cantidad)],
            ...extra,
          }),
        ),
      );

    it("BLOQUEAR: la venta que dejaría el saldo en negativo es CONTROL_BLOQUEA con el detalle, y no escribe nada", async () => {
      const x = await conNivel("BLOQUEAR");
      await c.entrar(x.m.gerente, {
        depositoId: x.deposito,
        articuloId: x.articulo,
        cantidad: "2",
      });
      const antes = await movimientos(x.m);
      expect(await venderDe(x, "3")).toEqual({
        ok: false,
        error: {
          error: "CONTROL_BLOQUEA",
          control: "stock.existencia_negativa",
          detalle: [
            { productoId: x.producto, depositoId: x.deposito, existenciaResultante: "-1.0000" },
          ],
        },
      });
      expect(await movimientos(x.m)).toBe(antes);
      expect(await c.existencia(x.deposito, x.articulo)).toBe("2.0000");
      expect(valorDe(await venderDe(x, "2")).movimientoId).not.toBeNull();
    });

    it("AVISAR: sin confirmar es CONTROL_REQUIERE_CONFIRMACION; confirmada pasa, queda en negativo y lo informa en los avisos", async () => {
      const x = await conNivel("AVISAR");
      await c.entrar(x.m.gerente, {
        depositoId: x.deposito,
        articuloId: x.articulo,
        cantidad: "1",
      });
      expect(await venderDe(x, "3")).toMatchObject({
        ok: false,
        error: { error: "CONTROL_REQUIERE_CONFIRMACION", control: "stock.existencia_negativa" },
      });
      expect(await c.existencia(x.deposito, x.articulo)).toBe("1.0000");
      const confirmada = valorDe(
        await venderDe(x, "3", { confirmaciones: ["stock.existencia_negativa"] }),
      );
      expect(confirmada.avisos).toEqual([
        {
          tipo: "EXISTENCIA_NEGATIVA",
          productoId: x.producto,
          depositoId: x.deposito,
          existenciaResultante: "-2.0000",
        },
      ]);
      expect(await c.existencia(x.deposito, x.articulo)).toBe("-2.0000");
    });

    it("PERMITIR (el nivel por defecto): la venta pasa en negativo, lo informa en los avisos y deja la excepción auditada", async () => {
      const x = await conNivel("PERMITIR");
      const antes = (await c.auditoria(x.m.empresa, "CONTROL_EXCEPCION")).length;
      const r = valorDe(await venderDe(x, "2"));
      expect(r.avisos).toEqual([
        {
          tipo: "EXISTENCIA_NEGATIVA",
          productoId: x.producto,
          depositoId: x.deposito,
          existenciaResultante: "-2.0000",
        },
      ]);
      expect(await c.existencia(x.deposito, x.articulo)).toBe("-2.0000");
      expect((await c.auditoria(x.m.empresa, "CONTROL_EXCEPCION")).length).toBe(antes + 1);
    });
  });

  // ---- P20: con el módulo apagado ------------------------------------------------------------------------------------------------

  describe("P20: con el módulo apagado", () => {
    it("nada controla (ni falta receta), el puerto de salida y el de entrada no escriben (MODULO_NO_ACTIVO) y la reversión de lo ya descontado sigue funcionando", async () => {
      const gaseosa = await reventa();
      const sinReceta = await vendible();
      await meter(gaseosa.articulo, "10");
      const ejemplar = nuevoId();
      valorDe(
        await vender([linea(gaseosa.producto, "2")], {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
        }),
      );
      const antes = await movimientos();
      c.apagarModulo("stock");
      try {
        expect(valorDe(await controla([gaseosa.producto, sinReceta]))).toEqual(
          new Map([
            [gaseosa.producto, { controla: false, faltaReceta: false }],
            [sinReceta, { controla: false, faltaReceta: false }],
          ]),
        );
        expect(await vender([linea(gaseosa.producto, "1")])).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
        expect(
          await recibir({
            renglones: [{ productoId: gaseosa.producto, cantidad: "1", unidadId: "UNIDAD" }],
          }),
        ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
        expect(await movimientos()).toBe(antes);
        // Revertir lo que ya salió siempre se puede: el descuento ya está hecho.
        expect(valorDe(await revertir(ejemplar)).habiaSalida).toBe(true);
      } finally {
        c.encenderModulos();
      }
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("10.0000");
      expect(valorDe(await controla([gaseosa.producto, sinReceta]))).toEqual(
        new Map([
          [gaseosa.producto, { controla: true, faltaReceta: false }],
          [sinReceta, { controla: false, faltaReceta: true }],
        ]),
      );
    });
  });

  // ---- la reversión ---------------------------------------------------------------------------------------------------------------

  describe("ReversionDeStock.revertirPorOrigen", () => {
    it("anula la salida del ejemplar con un espejo exacto (mismos artículos, versiones de receta y depósito), la clave derivada y el mismo origen; el saldo vuelve", async () => {
      const harina = await insumo();
      const gaseosa = await reventa();
      await meter(harina.articulo, "50");
      await meter(gaseosa.articulo, "50");
      const pizza = await conReceta("2", [[harina.producto, "5"]]);
      const ejemplar = nuevoId();
      const salida = valorDe(
        await vender([linea(pizza.producto, "4"), linea(gaseosa.producto, "3", {}, 2)], {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
        }),
      );
      expect(await c.existencia(dep, harina.articulo)).toBe("40.0000");
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("47.0000");
      const r = valorDe(await revertir(ejemplar));
      expect(r).toMatchObject({ habiaSalida: true, yaExistia: false });
      const anulacionId = r.anulacionId as string;
      expect(await c.existencia(dep, harina.articulo)).toBe("50.0000");
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("50.0000");
      const espejo = await renglonesDe(anulacionId);
      expect(espejo).toEqual(
        (await renglonesDe(salida.movimientoId as string)).map((f) => ({
          ...f,
          cantidad: f.cantidad.replace("-", ""),
        })),
      );
      const [m] = await c.filas<Record<string, unknown>>(
        "select clase, motivo, detalle, anula_a, origen_tipo, origen_id, accion, clave_idempotencia, deposito_id, registrado_por from movimiento_de_stock where id = $1",
        [anulacionId],
      );
      expect(m).toMatchObject({
        clase: "ANULACION",
        motivo: "ANULACION",
        detalle: "Ticket anulado",
        anula_a: salida.movimientoId,
        origen_tipo: "EJEMPLAR_DE_TICKET",
        origen_id: ejemplar,
        accion: "tickets.corregir",
        clave_idempotencia: `anulacion_venta_${ejemplar}`,
        deposito_id: dep,
        registrado_por: e.personaDelGerente,
      });
      // La consulta por origen muestra las dos cosas, la salida y su anulación.
      const porOrigen = valorDe(
        await c.consultas.movimientosPorOrigen(e.gerente, {
          origenTipo: "EJEMPLAR_DE_TICKET",
          origenId: ejemplar,
        }),
      );
      expect(porOrigen.map((f) => f.movimiento.clase)).toEqual(["SALIDA", "ANULACION"]);
      // Stock no deja anularla a mano: la revierte su módulo.
      expect(
        await c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId: salida.movimientoId as string,
          detalle: "x",
        }),
      ).toEqual({ ok: false, error: "MOVIMIENTO_NO_ANULABLE" });
    });

    it("es idempotente: revertir dos veces deja un solo espejo y devuelve la misma anulación con yaExistia; sin salida previa es habiaSalida false, sin error y sin escribir", async () => {
      const gaseosa = await reventa();
      await meter(gaseosa.articulo, "10");
      const ejemplar = nuevoId();
      valorDe(
        await vender([linea(gaseosa.producto, "4")], {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
        }),
      );
      const primera = valorDe(await revertir(ejemplar));
      const segunda = valorDe(
        await revertir(ejemplar, { detalle: "Otro motivo", accion: "tickets.cobrar" }),
      );
      expect(primera).toMatchObject({ habiaSalida: true, yaExistia: false });
      expect(segunda).toEqual({
        anulacionId: primera.anulacionId,
        habiaSalida: true,
        yaExistia: true,
      });
      expect(await delEjemplar(ejemplar, "ANULACION")).toHaveLength(1);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("10.0000");
      // Revertido, el ejemplar no se puede volver a descontar: el primer hecho manda y su anulación también.
      expect(
        valorDe(
          await vender([linea(gaseosa.producto, "4")], {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
          }),
        ).yaExistia,
      ).toBe(true);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("10.0000");

      const antes = await movimientos();
      const nunca = nuevoId();
      expect(valorDe(await revertir(nunca))).toEqual({
        anulacionId: null,
        habiaSalida: false,
        yaExistia: false,
      });
      expect(await movimientos()).toBe(antes);
    });

    it("dos reversiones del mismo ejemplar a la vez dejan un solo espejo", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const gaseosa = await reventa();
        await meter(gaseosa.articulo, "10");
        const ejemplar = nuevoId();
        valorDe(
          await vender([linea(gaseosa.producto, "4")], {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
          }),
        );
        const pedido = () => firme(() => revertir(ejemplar));
        const resultados = await aLaVez(c, [pedido, pedido], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(resultados.map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(await delEjemplar(ejemplar, "ANULACION")).toHaveLength(1);
        expect(await c.existencia(dep, gaseosa.articulo)).toBe("10.0000");
      }
    });

    it("exige el detalle (DETALLE_REQUERIDO) y un origen de ejemplar bien escrito; revertir lo de un artículo que dejó de controlarse también se puede", async () => {
      const gaseosa = await reventa();
      await meter(gaseosa.articulo, "10");
      const ejemplar = nuevoId();
      valorDe(
        await vender([linea(gaseosa.producto, "4")], {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
        }),
      );
      for (const detalle of [undefined, "", "   ", 5, "a".repeat(1000)]) {
        expect(await revertir(ejemplar, { detalle }), String(detalle)).toEqual({
          ok: false,
          error: "DETALLE_REQUERIDO",
        });
      }
      expect(await revertir(ejemplar, { origen: { tipo: "RECEPCION", id: ejemplar } })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await revertir(ejemplar, { origen: { tipo: "EJEMPLAR_DE_TICKET", id: "x" } })).toEqual(
        {
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        },
      );
      expect(await revertir(ejemplar, { origen: null })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await delEjemplar(ejemplar, "ANULACION")).toHaveLength(0);
      valorDe(await c.casos.dejarDeControlar(e.gerente, { productoId: gaseosa.producto }));
      expect(valorDe(await revertir(ejemplar)).habiaSalida).toBe(true);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("10.0000");
    });
  });

  // ---- la entrada por origen -----------------------------------------------------------------------------------------------------

  describe("EntradaPorOrigen.registrarEntrada", () => {
    const unRenglon = (producto: string, cantidad = "5", unidadId = "UNIDAD") => [
      { productoId: producto, cantidad, unidadId },
    ];
    const entradasDe = (recepcion: string) =>
      c.filas<{
        id: string;
        accion: string;
        motivo: string;
        origen_tipo: string;
        clave_idempotencia: string;
      }>(
        "select id, accion, motivo, origen_tipo, clave_idempotencia from movimiento_de_stock where origen_id = $1 and clase = 'ENTRADA'",
        [recepcion],
      );

    it("escribe una entrada COMPRA con el origen de la recepción y la acción de quien llama; la misma recepción con otra clave es la misma entrada (P12)", async () => {
      const gaseosa = await reventa();
      const recepcion = nuevoId();
      const clave = nuevoId();
      const primera = valorDe(
        await recibir({
          clave,
          origen: { tipo: "RECEPCION", id: recepcion },
          renglones: unRenglon(gaseosa.producto),
        }),
      );
      expect(primera.yaExistia).toBe(false);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("5.0000");
      expect(await entradasDe(recepcion)).toEqual([
        {
          id: primera.movimientoId,
          accion: "stock.registrar_entrada",
          motivo: "COMPRA",
          origen_tipo: "RECEPCION",
          clave_idempotencia: clave,
        },
      ]);
      // Misma clave y mismo contenido: la repetición de siempre. Otra clave, otros renglones: la identidad es la recepción.
      expect(
        valorDe(
          await recibir({
            clave,
            origen: { tipo: "RECEPCION", id: recepcion },
            renglones: unRenglon(gaseosa.producto),
          }),
        ),
      ).toEqual({ movimientoId: primera.movimientoId, yaExistia: true });
      expect(
        valorDe(
          await recibir({
            origen: { tipo: "RECEPCION", id: recepcion },
            renglones: unRenglon(gaseosa.producto, "9"),
          }),
        ),
      ).toEqual({ movimientoId: primera.movimientoId, yaExistia: true });
      expect(await entradasDe(recepcion)).toHaveLength(1);
      expect(await c.existencia(dep, gaseosa.articulo)).toBe("5.0000");
      // La misma clave con otra recepción no es una repetición: es una clave reutilizada.
      expect(
        await recibir({
          clave,
          origen: { tipo: "RECEPCION", id: nuevoId() },
          renglones: unRenglon(gaseosa.producto),
        }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    });

    it("dos entradas de la misma recepción a la vez dejan una sola", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const gaseosa = await reventa();
        const recepcion = nuevoId();
        const pedido = () =>
          firme(() =>
            recibir({
              origen: { tipo: "RECEPCION", id: recepcion },
              renglones: unRenglon(gaseosa.producto, "3"),
            }),
          );
        const resultados = await aLaVez(c, [pedido, pedido], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(resultados.map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(await entradasDe(recepcion)).toHaveLength(1);
        expect(await c.existencia(dep, gaseosa.articulo)).toBe("3.0000");
      }
    });

    it("lleva las cantidades a la unidad de stock (exacta o se rechaza) y rechaza lo que no es una compra a un depósito normal, activo y de la empresa", async () => {
      const harina = await insumo({ unidadBase: "GRAMO", dimension: "MASA" });
      const sinArticulo = await clase("INSUMO");
      const cuarentena = await c.deposito(e, { uso: "CUARENTENA" });
      const inactivo = await c.deposito(e, { activo: false });
      const antes = await movimientos();
      expect(
        valorDe(await recibir({ renglones: unRenglon(harina.producto, "2", "KILOGRAMO") }))
          .yaExistia,
      ).toBe(false);
      expect(await c.existencia(dep, harina.articulo)).toBe("2000.0000");
      const rechazos: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
        [
          "motivo que no es compra",
          { motivo: "OTRA_ENTRADA", renglones: unRenglon(harina.producto) },
          "MOTIVO_NO_PERMITIDO",
        ],
        [
          "origen de otro tipo",
          {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() },
            renglones: unRenglon(harina.producto),
          },
          "IDENTIFICADOR_INVALIDO",
        ],
        [
          "origen sin uuid",
          { origen: { tipo: "RECEPCION", id: "x" }, renglones: unRenglon(harina.producto) },
          "IDENTIFICADOR_INVALIDO",
        ],
        [
          "clave que no es uuid",
          { clave: "una-clave-cualquiera", renglones: unRenglon(harina.producto) },
          "IDENTIFICADOR_INVALIDO",
        ],
        ["sin renglones", { renglones: [] }, "RENGLONES_INVALIDOS"],
        ["cantidad cero", { renglones: unRenglon(harina.producto, "0") }, "CANTIDAD_INVALIDA"],
        ["producto sin artículo", { renglones: unRenglon(sinArticulo) }, "ARTICULO_NO_CONTROLADO"],
        [
          "unidad de otra dimensión",
          { renglones: unRenglon(harina.producto, "1", "LITRO") },
          "DIMENSION_DISTINTA",
        ],
        [
          "conversión no exacta",
          { renglones: unRenglon(harina.producto, "0.00001", "TONELADA") },
          "CANTIDAD_INVALIDA",
        ],
        [
          "depósito que no existe",
          { depositoId: nuevoId(), renglones: unRenglon(harina.producto) },
          "DEPOSITO_NO_ENCONTRADO",
        ],
        [
          "depósito de otra empresa",
          { depositoId: depDeOtra, renglones: unRenglon(harina.producto) },
          "DEPOSITO_NO_ENCONTRADO",
        ],
        [
          "depósito de cuarentena",
          { depositoId: cuarentena, renglones: unRenglon(harina.producto) },
          "MOTIVO_NO_PERMITIDO",
        ],
        [
          "depósito inactivo",
          { depositoId: inactivo, renglones: unRenglon(harina.producto) },
          "DEPOSITO_INACTIVO",
        ],
        [
          "antes de la jornada vigente",
          {
            hechoEn: new Date(e.gerente.ahora.getTime() - 3 * 24 * 3600_000),
            renglones: unRenglon(harina.producto),
          },
          "FECHA_PASADA_NO_ADMITIDA",
        ],
        [
          "en el futuro",
          {
            hechoEn: new Date(e.gerente.ahora.getTime() + 3600_000),
            renglones: unRenglon(harina.producto),
          },
          "FECHA_FUTURA_NO_ADMITIDA",
        ],
      ];
      for (const [nombre, pedido, esperado] of rechazos) {
        expect(await recibir(pedido), nombre).toEqual({ ok: false, error: esperado });
      }
      expect(await movimientos()).toBe(antes + 1);
    });

    it("un hechoEn dentro de la jornada vigente se respeta como el momento de la recepción", async () => {
      const gaseosa = await reventa();
      const hechoEn = new Date(e.gerente.ahora.getTime() - 60_000);
      const r = valorDe(await recibir({ hechoEn, renglones: unRenglon(gaseosa.producto) }));
      const [m] = await c.filas<{ hecho_en: Date }>(
        "select hecho_en from movimiento_de_stock where id = $1",
        [r.movimientoId],
      );
      expect(m?.hecho_en.toISOString()).toBe(hechoEn.toISOString());
    });
  });

  // ---- existencia para mostrar ----------------------------------------------------------------------------------------------------

  describe("ExistenciaParaMostrar.existencias", () => {
    it("da la existencia exacta (en la unidad de stock) de los productos con artículo; los demás no figuran; negativa si el control la permitió", async () => {
      const gaseosa = await reventa();
      const agua = await reventa({ unidadBase: "LITRO", dimension: "VOLUMEN" });
      const quieto = await reventa();
      const sinArticulo = await clase("REVENTA");
      await meter(gaseosa.articulo, "7");
      await meter(agua.articulo, "2.5");
      valorDe(await vender([linea(gaseosa.producto, "9")]));
      const existencias = (productos: readonly string[], deposito = dep, escenario = e) =>
        c.entorno.ejecutar({ contexto: escenario.gerente }, async (tx) => ({
          ok: true as const,
          valor: await c.puertos.existenciaParaMostrar.existencias(
            tx,
            escenario.gerente,
            productos,
            deposito,
          ),
        }));
      const lista = valorDe(
        await existencias([
          gaseosa.producto,
          agua.producto,
          quieto.producto,
          sinArticulo,
          nuevoId(),
          "x",
        ]),
      );
      expect([...lista].sort((a, b) => a.productoId.localeCompare(b.productoId))).toEqual(
        [
          { productoId: gaseosa.producto, existencia: "-2.0000", unidadId: "UNIDAD" },
          { productoId: agua.producto, existencia: "2.5000", unidadId: "LITRO" },
          { productoId: quieto.producto, existencia: "0.0000", unidadId: "UNIDAD" },
        ].sort((a, b) => a.productoId.localeCompare(b.productoId)),
      );
      expect(valorDe(await existencias([]))).toEqual([]);
      // Un depósito que no existe, mal escrito o de otra empresa no tiene existencia que mostrar.
      for (const [deposito, escenario] of [
        [nuevoId(), e],
        ["x", e],
        [depDeOtra, e],
        [dep, otra],
      ] as const) {
        expect(
          valorDe(await existencias([gaseosa.producto], deposito, escenario)),
          deposito,
        ).toEqual([]);
      }
    });
  });

  // ---- aislamiento ------------------------------------------------------------------------------------------------------------------

  describe("P15: aislamiento entre empresas", () => {
    it("el mismo ejemplar en dos empresas son dos salidas; B no ve ni revierte lo de A, ni usa su depósito o sus productos", async () => {
      const deA = await reventa();
      await meter(deA.articulo, "10");
      const ejemplar = nuevoId();
      const ventaDeA = valorDe(
        await vender([linea(deA.producto, "3")], {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
        }),
      );
      const deB = await c.articulo(otra, { clase: "REVENTA" });
      await c.entrar(otra.gerente, {
        depositoId: depDeOtra,
        articuloId: deB.articulo,
        cantidad: "10",
      });
      const ventaDeB = valorDe(
        traducirMovimiento(
          await c.entorno.ejecutar({ contexto: otra.gerente }, (tx) =>
            c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, otra.gerente, {
              origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
              accion: "cuentas.cerrar",
              depositoId: depDeOtra,
              hechoEn: otra.gerente.ahora,
              fechaDeNegocio: fecha(JORNADA_DEL_TICKET),
              renglones: [linea(deB.producto, "1")],
            }),
          ),
        ),
      );
      expect(ventaDeB.yaExistia).toBe(false);
      expect(ventaDeB.movimientoId).not.toBe(ventaDeA.movimientoId);
      expect(await delEjemplar(ejemplar, "SALIDA")).toHaveLength(2);
      expect(await c.existencia(dep, deA.articulo)).toBe("7.0000");
      expect(await c.existencia(depDeOtra, deB.articulo)).toBe("9.0000");

      // B con el depósito de A, con un producto de A, y revirtiendo un ejemplar que solo existe en A.
      const soloDeA = nuevoId();
      valorDe(
        await vender([linea(deA.producto, "1")], {
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: soloDeA },
        }),
      );
      const comoB = (trabajo: (tx: never) => Promise<unknown>) =>
        c.entorno.ejecutar({ contexto: otra.gerente }, trabajo as never);
      expect(
        await comoB((tx) =>
          c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, otra.gerente, {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() },
            accion: "cuentas.cerrar",
            depositoId: dep,
            hechoEn: otra.gerente.ahora,
            fechaDeNegocio: fecha(JORNADA_DEL_TICKET),
            renglones: [linea(deB.producto, "1")],
          }),
        ),
      ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      expect(
        await comoB((tx) =>
          c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, otra.gerente, {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() },
            accion: "cuentas.cerrar",
            depositoId: depDeOtra,
            hechoEn: otra.gerente.ahora,
            fechaDeNegocio: fecha(JORNADA_DEL_TICKET),
            renglones: [linea(deA.producto, "1")],
          }),
        ),
      ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      expect(
        await comoB((tx) =>
          c.puertos.reversionDeStock.revertirPorOrigen(tx, otra.gerente, {
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: soloDeA },
            accion: "tickets.corregir",
            detalle: "x",
          }),
        ),
      ).toEqual({ ok: true, valor: { anulacionId: null, habiaSalida: false, yaExistia: false } });
      expect(await delEjemplar(soloDeA, "ANULACION")).toHaveLength(0);
      expect(
        (
          (await comoB(async (tx) => ({
            ok: true,
            valor: await c.puertos.articulosDeVenta.controla(tx, otra.gerente, [deA.producto]),
          }))) as { valor: ReadonlyMap<string, unknown> }
        ).valor.get(deA.producto),
      ).toEqual({ controla: false, faltaReceta: false });
    });
  });
});
