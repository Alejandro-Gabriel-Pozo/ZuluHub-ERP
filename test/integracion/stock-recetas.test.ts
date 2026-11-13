import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { fechaCivilDesdeTexto } from "../../src/primitivas/tiempo/fecha-civil";
import { productoDeBase } from "./catalogo-apoyo";
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
 * E6-T6, recetas: subcomposiciones (un componente es un producto ELABORADO, D96), merma por componente, pasos, ciclos y cinco niveles hacia
 * abajo Y hacia arriba, la explosión anidada con la base real (D2), la merma (D4), los dos guardados cruzados (C8), la misma versión (C9), repetir
 * el guardado (I8) y las consultas: ficha con costo (solo con `costos.ver`), comparar versiones, versiones y ficha de cocina.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const JORNADA = "2026-10-09";

function noNulo<T>(valor: T | null): T {
  if (valor === null) throw new Error("la consulta devolvió null y tenía que haber dato");
  return valor;
}

describe.skipIf(base === null)("stock: recetas (E6-T6)", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let dep: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    dep = await c.deposito(e, { deVenta: true });
    c.encenderPerilla("subcomposiciones");
    c.encenderPerilla("composiciones_con_perdida");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;
  const insumo = (datos: Parameters<MontajeDeStock["articulo"]>[1] = {}, escenario = e) =>
    c.articulo(escenario, { clase: "INSUMO", ...datos });
  const materia = (datos: Parameters<MontajeDeStock["articulo"]>[1] = {}) =>
    c.articulo(e, { clase: "MATERIA_PRIMA", ...datos });
  const elaborado = (datos: Parameters<typeof productoDeBase>[2] = {}, empresa = e.empresa) =>
    productoDeBase(c.dueno, empresa, { clase: "ELABORADO", ...kilos, ...datos });
  const vendible = (datos: Parameters<typeof productoDeBase>[2] = {}, empresa = e.empresa) =>
    productoDeBase(c.dueno, empresa, { clase: "VENDIBLE", ...datos });
  const componente = (
    productoId: string,
    cantidad = "1",
    unidadId = "UNIDAD",
    perdida?: string,
  ) => ({
    productoId,
    cantidad,
    unidadId,
    ...(perdida === undefined ? {} : { perdida }),
  });
  const guardar = (
    producto: string,
    componentes: readonly Record<string, unknown>[],
    extra: Record<string, unknown> = {},
    quien = e.gerente,
  ) =>
    c.casos.guardarComposicion(quien, {
      productoId: producto,
      versionEsperada: 0,
      rinde: "1",
      componentes: componentes as never,
      ...extra,
    });
  const versiones = (producto: string) =>
    c.contar("select count(*) as n from composicion where producto_id = $1", [producto]);
  /** Las consultas que devuelven `null` si no existe, para los casos en que tiene que existir. */
  const lleno = {
    fichaDeReceta: async (...a: Parameters<MontajeDeStock["consultas"]["fichaDeReceta"]>) =>
      noNulo(valorDe(await c.consultas.fichaDeReceta(...a))),
    fichaDeCocina: async (...a: Parameters<MontajeDeStock["consultas"]["fichaDeCocina"]>) =>
      noNulo(valorDe(await c.consultas.fichaDeCocina(...a))),
    compararVersiones: async (...a: Parameters<MontajeDeStock["consultas"]["compararVersiones"]>) =>
      noNulo(valorDe(await c.consultas.compararVersiones(...a))),
  };
  const fecha = (texto: string) => valorDe(fechaCivilDesdeTexto(texto));
  const meter = (articulo: string, cantidad: string) =>
    c.entrar(e.gerente, { depositoId: dep, articuloId: articulo, cantidad });
  const vender = async (producto: string, cantidad: string) =>
    c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
      c.puertos.consumoDeStock.registrarSalidaPorVentaEnTx(tx, e.gerente, {
        origen: { tipo: "EJEMPLAR_DE_TICKET", id: nuevoId() },
        accion: "cuentas.cerrar",
        depositoId: dep,
        hechoEn: e.gerente.ahora,
        fechaDeNegocio: fecha(JORNADA),
        renglones: [
          {
            posicion: 1,
            productoId: producto,
            cantidad,
            unidadDeVentaId: "UNIDAD",
            opciones: [],
          },
        ],
      }),
    );
  const existencia = (articulo: string) => c.existencia(dep, articulo);
  /** Mercadería con su costo, por el caso de uso real: COMPRA fija el último costo de compra; CARGA_INICIAL solo el promedio (D91). */
  const costear = async (
    producto: string,
    costoUnitario: string,
    cantidad = "10",
    motivo = "COMPRA",
  ) =>
    valorDe(
      await c.casos.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo,
        renglones: [{ productoId: producto, cantidad, unidadId: "KILOGRAMO", costoUnitario }],
      }),
    );
  /** Un artículo de stock propio para un producto que ya existe (el elaborado que se produce en tanda). */
  const conStockPropio = async (producto: string, unidad = "KILOGRAMO", dimension = "MASA") => {
    const articulo = nuevoId();
    await c.dueno.query(
      "insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, $4, $5)",
      [articulo, e.empresa, producto, unidad, dimension],
    );
    return articulo;
  };

  /** La masa de la especificación (D2): rinde 10 kg; harina 6, manteca 2, agua 1,2, azúcar 0,5, levadura 0,2 y sal 0,1 kg. */
  const masaDeLaSpec = async () => {
    const ingredientes = {
      harina: await materia(kilos),
      manteca: await materia(kilos),
      agua: await insumo({ unidadBase: "LITRO", dimension: "VOLUMEN" }),
      azucar: await materia(kilos),
      levadura: await materia(kilos),
      sal: await materia(kilos),
    };
    const masa = await elaborado();
    valorDe(
      await guardar(
        masa,
        [
          componente(ingredientes.harina.producto, "6", "KILOGRAMO"),
          componente(ingredientes.manteca.producto, "2", "KILOGRAMO"),
          componente(ingredientes.agua.producto, "1.2", "LITRO"),
          componente(ingredientes.azucar.producto, "0.5", "KILOGRAMO"),
          componente(ingredientes.levadura.producto, "0.2", "KILOGRAMO"),
          componente(ingredientes.sal.producto, "0.1", "KILOGRAMO"),
        ],
        { rinde: "10" },
      ),
    );
    return { masa, ingredientes };
  };

  describe("guardarComposicion con elaborados, merma y pasos", () => {
    it("guarda un elaborado como componente (compuesto_id, con la dimensión del elaborado), con merma y pasos; la consulta lo devuelve y queda auditada", async () => {
      const { masa } = await masaDeLaSpec();
      const sal = await materia(kilos);
      const medialuna = await vendible();
      const guardada = valorDe(
        await guardar(
          medialuna,
          [componente(masa, "6", "KILOGRAMO", "10"), componente(sal.producto, "0.01", "KILOGRAMO")],
          { rinde: "100", pasos: "Cortar, enrollar y hornear 20 min." },
        ),
      );
      expect(guardada).toEqual({ version: 1, yaExistia: false });
      expect(
        await c.filas(
          "select articulo_id, compuesto_id, cantidad::text as cantidad, unidad_id, dimension, perdida::text as perdida from componente_de_composicion where composicion_id = (select id from composicion where producto_id = $1) order by numero",
          [medialuna],
        ),
      ).toEqual([
        {
          articulo_id: null,
          compuesto_id: masa,
          cantidad: "6.0000",
          unidad_id: "KILOGRAMO",
          dimension: "MASA",
          perdida: "10.0000",
        },
        {
          articulo_id: sal.articulo,
          compuesto_id: null,
          cantidad: "0.0100",
          unidad_id: "KILOGRAMO",
          dimension: "MASA",
          perdida: "0.0000",
        },
      ]);
      expect(
        (await c.filas("select pasos from composicion where producto_id = $1", [medialuna]))[0],
      ).toEqual({ pasos: "Cortar, enrollar y hornear 20 min." });
      const ficha = valorDe(
        await c.consultas.composicionDeProducto(e.gerente, { productoId: medialuna }),
      );
      expect(ficha).toMatchObject({
        pasos: "Cortar, enrollar y hornear 20 min.",
        componentes: [
          { articuloId: null, compuestoId: masa, productoId: masa, perdida: "10.0000" },
          { articuloId: sal.articulo, compuestoId: null, productoId: sal.producto },
        ],
      });
      const auditadas = (await c.auditoria(e.empresa, "COMPOSICION_GUARDADA")).filter(
        (r) => (r["despues"] as { productoId: string }).productoId === medialuna,
      );
      expect(auditadas).toHaveLength(1);
      expect(auditadas[0]).toMatchObject({
        despues: {
          pasos: "Cortar, enrollar y hornear 20 min.",
          componentes: [{ compuestoId: masa, perdida: "10.0000" }, { articuloId: sal.articulo }],
        },
      });
    });

    it("un elaborado también lleva receta (la de su tanda); una materia prima, un insumo o una reventa no", async () => {
      const harina = await materia(kilos);
      const masa = await elaborado();
      expect(await guardar(masa, [componente(harina.producto, "1", "KILOGRAMO")])).toEqual({
        ok: true,
        valor: { version: 1, yaExistia: false },
      });
      const reventa = await c.articulo(e, { clase: "REVENTA" });
      expect(
        await guardar(reventa.producto, [componente(harina.producto, "1", "KILOGRAMO")]),
      ).toEqual({
        ok: false,
        error: "PRODUCTO_NO_LLEVA_RECETA",
      });
    });

    it("I8: guardar la misma receta dos veces es yaExistia y no crea versión; cambiar solo los pasos o la merma sí", async () => {
      const { masa } = await masaDeLaSpec();
      const medialuna = await vendible();
      const receta = [componente(masa, "6", "KILOGRAMO")];
      expect(
        valorDe(await guardar(medialuna, receta, { rinde: "100", pasos: "Hornear." })),
      ).toEqual({
        version: 1,
        yaExistia: false,
      });
      // Repetición: aunque la versión esperada sea vieja, y con la merma en cero escrita o ausente (es lo mismo).
      expect(
        valorDe(
          await guardar(medialuna, [componente(masa, "6.0", "KILOGRAMO", "0")], {
            rinde: "100.0",
            pasos: "Hornear.",
          }),
        ),
      ).toEqual({ version: 1, yaExistia: true });
      expect(await versiones(medialuna)).toBe(1);
      expect(
        valorDe(
          await guardar(medialuna, receta, {
            rinde: "100",
            pasos: "Hornear fuerte.",
            versionEsperada: 1,
          }),
        ),
      ).toEqual({ version: 2, yaExistia: false });
      expect(
        valorDe(
          await guardar(medialuna, [componente(masa, "6", "KILOGRAMO", "5")], {
            rinde: "100",
            pasos: "Hornear fuerte.",
            versionEsperada: 2,
          }),
        ),
      ).toEqual({ version: 3, yaExistia: false });
      // Pasos ausentes y vacíos son lo mismo: sin pasos.
      expect(
        valorDe(await guardar(medialuna, receta, { rinde: "100", versionEsperada: 3, pasos: "" })),
      ).toEqual({ version: 4, yaExistia: false });
      expect(
        valorDe(
          await guardar(medialuna, receta, { rinde: "100", versionEsperada: 4, pasos: null }),
        ),
      ).toEqual({ version: 4, yaExistia: true });
    });

    it("el elaborado es de la perilla: apagada es FUNCION_NO_INCLUIDA subcomposiciones; con merma sin su perilla, composiciones_con_perdida", async () => {
      const { masa } = await masaDeLaSpec();
      const medialuna = await vendible();
      c.apagarPerillas();
      try {
        expect(await guardar(medialuna, [componente(masa, "6", "KILOGRAMO")])).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "subcomposiciones" },
        });
        c.encenderPerilla("subcomposiciones");
        expect(await guardar(medialuna, [componente(masa, "6", "KILOGRAMO", "5")])).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" },
        });
      } finally {
        c.apagarPerillas();
        c.encenderPerilla("subcomposiciones");
        c.encenderPerilla("composiciones_con_perdida");
      }
      expect(await versiones(medialuna)).toBe(0);
    });

    it("valida el elaborado: la unidad de la dimensión del elaborado (con conversión exacta), sin repetirlo, inactivo no, y el producto no puede ser su propio componente", async () => {
      const { masa } = await masaDeLaSpec();
      const medialuna = await vendible();
      expect(await guardar(medialuna, [componente(masa, "6", "LITRO")])).toEqual({
        ok: false,
        error: "DIMENSION_DISTINTA",
      });
      expect(
        await guardar(medialuna, [
          componente(masa, "6", "KILOGRAMO"),
          componente(masa, "1", "GRAMO"),
        ]),
      ).toEqual({ ok: false, error: "COMPONENTE_REPETIDO" });
      expect(await guardar(medialuna, [componente(medialuna, "1")])).toEqual({
        ok: false,
        error: "COMPONENTE_NO_CONTROLADO",
      });
      const inactivo = await elaborado({ activo: false });
      expect(await guardar(medialuna, [componente(inactivo, "1", "KILOGRAMO")])).toEqual({
        ok: false,
        error: "PRODUCTO_INACTIVO",
      });
      // Un producto sin artículo que no es elaborado no es componente.
      const suelto = await vendible();
      expect(await guardar(medialuna, [componente(suelto)])).toEqual({
        ok: false,
        error: "COMPONENTE_NO_CONTROLADO",
      });
      expect(await versiones(medialuna)).toBe(0);
    });

    it("los pasos tienen que ser una línea de la lista de permitidos (hasta 2000 caracteres)", async () => {
      const harina = await materia(kilos);
      const medialuna = await vendible();
      for (const pasos of ["Dos\nlíneas", "<b>x</b>", "=SUMA(A1)", "a".repeat(2001), 7]) {
        expect(
          await guardar(medialuna, [componente(harina.producto, "1", "KILOGRAMO")], { pasos }),
          String(pasos).slice(0, 12),
        ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      }
      expect(await versiones(medialuna)).toBe(0);
    });
  });

  describe("ciclos y niveles (D2)", () => {
    it("un ciclo directo o indirecto es CICLO_EN_LA_RECETA", async () => {
      const harina = await materia(kilos);
      const a = await elaborado();
      const b = await elaborado();
      const cc = await elaborado();
      valorDe(await guardar(a, [componente(harina.producto, "1", "KILOGRAMO")]));
      valorDe(await guardar(b, [componente(a, "1", "KILOGRAMO")]));
      valorDe(await guardar(cc, [componente(b, "1", "KILOGRAMO")]));
      // A lleva a B (que lleva a A): ciclo directo de dos; A lleva a C (C→B→A): indirecto.
      expect(await guardar(a, [componente(b, "1", "KILOGRAMO")], { versionEsperada: 1 })).toEqual({
        ok: false,
        error: "CICLO_EN_LA_RECETA",
      });
      expect(await guardar(a, [componente(cc, "1", "KILOGRAMO")], { versionEsperada: 1 })).toEqual({
        ok: false,
        error: "CICLO_EN_LA_RECETA",
      });
      expect(await versiones(a)).toBe(1);
    });

    it("cinco niveles pasan y el sexto es RECETA_DEMASIADO_ANIDADA, también cuando se agrega por debajo de quien ya lo usa", async () => {
      const harina = await materia(kilos);
      const e5 = await elaborado();
      const e4 = await elaborado();
      const e3 = await elaborado();
      const e2 = await elaborado();
      const p1 = await vendible();
      valorDe(await guardar(e5, [componente(harina.producto, "1", "KILOGRAMO")]));
      valorDe(await guardar(e4, [componente(e5, "1", "KILOGRAMO")]));
      valorDe(await guardar(e3, [componente(e4, "1", "KILOGRAMO")]));
      valorDe(await guardar(e2, [componente(e3, "1", "KILOGRAMO")]));
      // El vendible es el nivel 1: con e2..e5 son cinco.
      valorDe(await guardar(p1, [componente(e2, "1", "KILOGRAMO")]));
      // Un sexto nivel directo.
      const e6 = await elaborado();
      valorDe(await guardar(e6, [componente(harina.producto, "1", "KILOGRAMO")]));
      expect(await guardar(e5, [componente(e6, "1", "KILOGRAMO")], { versionEsperada: 1 })).toEqual(
        {
          ok: false,
          error: "RECETA_DEMASIADO_ANIDADA",
        },
      );
      expect(await versiones(e5)).toBe(1);
      // Visto solo desde e5 (e5 → e6: dos niveles) sería válido: lo frena que p1 ya lo usa en el quinto.
      const aparte = await elaborado();
      valorDe(await guardar(aparte, [componente(e6, "1", "KILOGRAMO")]));
      expect(
        await guardar(p1, [componente(aparte, "1", "KILOGRAMO")], { versionEsperada: 1 }),
      ).toEqual({
        ok: true,
        valor: { version: 2, yaExistia: false },
      });
    });

    it("C8: dos guardados cruzados a la vez (A lleva B, B lleva A): a lo sumo uno se guarda y la base nunca queda con un ciclo", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const harina = await materia(kilos);
        const a = await elaborado();
        const b = await elaborado();
        valorDe(await guardar(a, [componente(harina.producto, "1", "KILOGRAMO")]));
        valorDe(await guardar(b, [componente(harina.producto, "1", "KILOGRAMO")]));
        const resultados = await aLaVez(
          c,
          [
            () =>
              firme(() => guardar(a, [componente(b, "1", "KILOGRAMO")], { versionEsperada: 1 })),
            () =>
              firme(() => guardar(b, [componente(a, "1", "KILOGRAMO")], { versionEsperada: 1 })),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
        expect(resultados.find((r) => !r.ok)).toEqual({ ok: false, error: "CICLO_EN_LA_RECETA" });
        const ciclo = await c.filas(
          `with vigente as (select distinct on (producto_id) id, producto_id from composicion where producto_id in ($1, $2) order by producto_id, numero desc)
           select v.producto_id, k.compuesto_id from vigente v join componente_de_composicion k on k.composicion_id = v.id where k.compuesto_id is not null`,
          [a, b],
        );
        expect(ciclo).toHaveLength(1);
      }
    });

    it("C9: dos guardados del mismo producto con la misma versión esperada y un elaborado: una gana y la otra es COMPOSICION_DESACTUALIZADA", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const { masa } = await masaDeLaSpec();
        const otraMasa = (await masaDeLaSpec()).masa;
        const medialuna = await vendible();
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => guardar(medialuna, [componente(masa, "1", "KILOGRAMO")])),
            () => firme(() => guardar(medialuna, [componente(otraMasa, "1", "KILOGRAMO")])),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
        expect(resultados.find((r) => !r.ok)).toEqual({
          ok: false,
          error: "COMPOSICION_DESACTUALIZADA",
        });
        expect(await versiones(medialuna)).toBe(1);
      }
    });
  });

  describe("la explosión anidada con la base real (D2, D4)", () => {
    it("D2: la medialuna con la masa SIN stock propio descuenta los ingredientes en proporción; con stock propio de la masa, descuenta la masa", async () => {
      const { masa, ingredientes } = await masaDeLaSpec();
      const medialuna = await vendible();
      valorDe(await guardar(medialuna, [componente(masa, "6", "KILOGRAMO")], { rinde: "100" }));
      for (const i of Object.values(ingredientes)) await meter(i.articulo, "100");
      // 10 medialunas llevan 0,6 kg de masa: 0,36 de harina, 0,12 de manteca, 0,072 l de agua, 0,03 de azúcar, 0,012 de levadura y 0,006 de sal.
      const vendida = await vender(medialuna, "10");
      expect(vendida.ok, JSON.stringify(vendida)).toBe(true);
      expect(await existencia(ingredientes.harina.articulo)).toBe("99.6400");
      expect(await existencia(ingredientes.manteca.articulo)).toBe("99.8800");
      expect(await existencia(ingredientes.agua.articulo)).toBe("99.9280");
      expect(await existencia(ingredientes.azucar.articulo)).toBe("99.9700");
      expect(await existencia(ingredientes.levadura.articulo)).toBe("99.9880");
      expect(await existencia(ingredientes.sal.articulo)).toBe("99.9940");
      // Con stock propio de la masa se descuenta la masa y los ingredientes no se tocan.
      const articuloDeLaMasa = await conStockPropio(masa);
      await meter(articuloDeLaMasa, "50");
      const conStock = await vender(medialuna, "10");
      expect(conStock.ok, JSON.stringify(conStock)).toBe(true);
      expect(await existencia(articuloDeLaMasa)).toBe("49.4000");
      expect(await existencia(ingredientes.harina.articulo)).toBe("99.6400");
    });

    it("D4 (13/11/2026): la receta carga el BRUTO; 1 kg con 20 % de merma descuenta 1 kg, se costea 1 kg y la ficha muestra 0,8 kg de neto", async () => {
      const harina = await materia(kilos);
      const torta = await vendible();
      valorDe(await guardar(torta, [componente(harina.producto, "1", "KILOGRAMO", "20")]));
      await meter(harina.articulo, "10");
      expect((await vender(torta, "1")).ok).toBe(true);
      expect(await existencia(harina.articulo)).toBe("9.0000");
      const cocina = await lleno.fichaDeCocina(e.operador, { productoId: torta });
      expect(cocina.componentes).toMatchObject([{ cantidad: "1.0000", unidadId: "KILOGRAMO" }]);
      // Costo: $ 100 el kilo × 1 kg bruto = $ 100 (la merma no se aplica otra vez).
      await costear(harina.producto, "100", "0.0001");
      const ficha = await lleno.fichaDeReceta(e.gerente, { productoId: torta });
      expect(ficha.costos).toEqual({
        moneda: "ARS",
        total: "100.000000",
        porUnidad: "100.000000",
        incompleto: false,
        sinCosto: [],
      });
      expect(ficha.componentes[0]).toMatchObject({
        bruto: "1.0000",
        merma: "20.0000",
        neto: "0.8000",
        costo: "100.000000",
      });
    });
  });

  describe("consultas", () => {
    it("fichaDeReceta: costo por línea y de la receta con costos.ver; sin costo no es cero (incompleto y se lista); el insumo operativo va aparte; el operador no ve costos", async () => {
      const harina = await materia(kilos);
      const manteca = await materia(kilos);
      const bolsa = await insumo();
      const masa = await elaborado();
      valorDe(
        await guardar(
          masa,
          [
            componente(harina.producto, "6", "KILOGRAMO"),
            componente(manteca.producto, "2", "KILOGRAMO"),
            componente(bolsa.producto, "1"),
          ],
          { rinde: "9.5" },
        ),
      );
      await costear(harina.producto, "1000");
      await costear(manteca.producto, "9000");
      const ficha = await lleno.fichaDeReceta(e.gerente, { productoId: masa });
      // D3 de la especificación: $ 24.000 para 9,5 kg = $ 2.526,315789 por kg. La bolsa no tiene costo y NO suma (es un insumo).
      expect(ficha).toMatchObject({
        version: 1,
        esLaVigente: true,
        rinde: "9.5000",
        costos: {
          moneda: "ARS",
          total: "24000.000000",
          porUnidad: "2526.315789",
          incompleto: false,
          sinCosto: [],
        },
      });
      expect(ficha.componentes.map((l) => [l.tipo, l.clase, l.noEntraAlCosto, l.costo])).toEqual([
        ["ARTICULO", "MATERIA_PRIMA", false, "6000.000000"],
        ["ARTICULO", "MATERIA_PRIMA", false, "18000.000000"],
        ["ARTICULO", "INSUMO", true, null],
      ]);
      // Sin costo de la manteca: incompleto, listado, y la línea es null (nunca cero).
      const sinManteca = await vendible();
      const queso = await materia(kilos);
      valorDe(
        await guardar(sinManteca, [
          componente(harina.producto, "1", "KILOGRAMO"),
          componente(queso.producto, "1", "KILOGRAMO"),
        ]),
      );
      const incompleta = await lleno.fichaDeReceta(e.gerente, { productoId: sinManteca });
      expect(incompleta.costos).toMatchObject({
        total: "1000.000000",
        incompleto: true,
        sinCosto: [queso.producto],
      });
      expect(incompleta.componentes.map((l) => l.costo)).toEqual(["1000.000000", null]);
      // El operador mira la receta pero no los costos.
      const delOperador = await lleno.fichaDeReceta(e.operador, { productoId: masa });
      expect(delOperador.costos).toBeUndefined();
      expect(delOperador.componentes.every((l) => !("costo" in l))).toBe(true);
    });

    it("el costo de un elaborado sin stock propio entra por su receta; con stock propio, por el promedio de su artículo; el último costo de compra manda sobre el promedio", async () => {
      const harina = await materia(kilos);
      const masa = await elaborado();
      valorDe(await guardar(masa, [componente(harina.producto, "1", "KILOGRAMO")], { rinde: "2" }));
      await costear(harina.producto, "1000");
      const medialuna = await vendible();
      valorDe(await guardar(medialuna, [componente(masa, "4", "KILOGRAMO")], { rinde: "8" }));
      // La masa cuesta $ 500 el kilo (1 kg de harina a $ 1.000 rinde 2 kg); la medialuna lleva 4 kg de masa para 8 unidades: $ 250 cada una.
      const sinStock = await lleno.fichaDeReceta(e.gerente, { productoId: medialuna });
      expect(sinStock.costos).toMatchObject({
        total: "2000.000000",
        porUnidad: "250.000000",
        incompleto: false,
      });
      expect(sinStock.componentes[0]).toMatchObject({
        tipo: "ELABORADO",
        clase: "ELABORADO",
        costo: "2000.000000",
      });
      // Con stock propio manda el promedio de su artículo (no se recalcula desde la receta).
      await conStockPropio(masa);
      await costear(masa, "600", "5", "CARGA_INICIAL");
      const conStock = await lleno.fichaDeReceta(e.gerente, { productoId: medialuna });
      expect(conStock.costos).toMatchObject({ total: "2400.000000", porUnidad: "300.000000" });
    });

    it("versionesDeReceta, fichaDeReceta de una versión vieja y compararVersiones (con los precios de hoy; la diferencia solo con costos.ver)", async () => {
      const harina = await materia(kilos);
      const azucar = await materia(kilos);
      const torta = await vendible();
      valorDe(
        await guardar(torta, [componente(harina.producto, "1", "KILOGRAMO")], {
          pasos: "Mezclar.",
        }),
      );
      valorDe(
        await guardar(
          torta,
          [
            componente(harina.producto, "2", "KILOGRAMO"),
            componente(azucar.producto, "1", "KILOGRAMO"),
          ],
          { versionEsperada: 1 },
        ),
      );
      await costear(harina.producto, "100");
      await costear(azucar.producto, "50");
      const lista = valorDe(await c.consultas.versionesDeReceta(e.operador, { productoId: torta }));
      expect(lista.map((v) => v.version)).toEqual([2, 1]);
      expect(lista[1]).toMatchObject({ pasos: "Mezclar." });
      const vieja = await lleno.fichaDeReceta(e.gerente, { productoId: torta, version: 1 });
      expect(vieja).toMatchObject({
        version: 1,
        esLaVigente: false,
        costos: { total: "100.000000" },
      });
      const comparacion = await lleno.compararVersiones(e.gerente, {
        productoId: torta,
        desde: 1,
        hasta: 2,
      });
      expect(comparacion.cambios).toHaveLength(2);
      expect(comparacion.cambios.map((x) => [x.productoId, x.tipo])).toEqual(
        expect.arrayContaining([
          [harina.producto, "CAMBIADO"],
          [azucar.producto, "AGREGADO"],
        ]),
      );
      expect(comparacion.costos).toEqual({
        moneda: "ARS",
        porUnidadDesde: "100.000000",
        porUnidadHasta: "250.000000",
        diferencia: "150.000000",
        incompleto: false,
      });
      const sinCostos = await lleno.compararVersiones(e.operador, {
        productoId: torta,
        desde: 1,
        hasta: 2,
      });
      expect(sinCostos.costos).toBeUndefined();
      expect(sinCostos.cambios).toHaveLength(2);
      // Lo que no existe, no es un id o es de otra empresa: null, sin distinguir.
      for (const entrada of [
        { productoId: torta, desde: 1, hasta: 9 },
        { productoId: torta, desde: 0, hasta: 1 },
        { productoId: "no-es-uuid", desde: 1, hasta: 2 },
      ]) {
        expect(valorDe(await c.consultas.compararVersiones(e.gerente, entrada))).toBeNull();
      }
      expect(
        valorDe(
          await c.consultas.compararVersiones(otra.gerente, {
            productoId: torta,
            desde: 1,
            hasta: 2,
          }),
        ),
      ).toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeReceta(otra.gerente, { productoId: torta })),
      ).toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeCocina(otra.gerente, { productoId: torta })),
      ).toBeNull();
      expect(
        valorDe(await c.consultas.versionesDeReceta(otra.gerente, { productoId: torta })),
      ).toEqual([]);
    });

    it("las consultas piden stock.ver: con el módulo apagado nadie las ve", async () => {
      const harina = await materia(kilos);
      const torta = await vendible();
      valorDe(await guardar(torta, [componente(harina.producto, "1", "KILOGRAMO")]));
      c.apagarModulo("stock");
      try {
        for (const consulta of [
          () => c.consultas.fichaDeReceta(e.gerente, { productoId: torta }),
          () => c.consultas.fichaDeCocina(e.gerente, { productoId: torta }),
          () => c.consultas.versionesDeReceta(e.gerente, { productoId: torta }),
          () => c.consultas.compararVersiones(e.gerente, { productoId: torta, desde: 1, hasta: 1 }),
        ]) {
          expect((await consulta()).ok).toBe(false);
        }
      } finally {
        c.encenderModulos();
      }
    });
  });

  describe("aislamiento", () => {
    it("D8: la empresa B no usa un elaborado de A como componente ni ve su receta", async () => {
      const harina = await materia(kilos);
      const masa = await elaborado();
      valorDe(await guardar(masa, [componente(harina.producto, "1", "KILOGRAMO")]));
      const deB = await vendible({}, otra.empresa);
      expect(await guardar(deB, [componente(masa, "1", "KILOGRAMO")], {}, otra.gerente)).toEqual({
        ok: false,
        error: "COMPONENTE_NO_CONTROLADO",
      });
      expect(
        valorDe(await c.consultas.composicionDeProducto(otra.gerente, { productoId: masa })),
      ).toBeNull();
    });
  });
});
