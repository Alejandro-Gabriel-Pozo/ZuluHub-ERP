import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { productoDeBase, type ClaseDeUsoDePrueba } from "./catalogo-apoyo";
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
 * E5-T7, composiciones (recetas simples): guardar el conjunto final con su `rinde` y retirarla, la consulta de la receta vigente, la perilla de
 * pérdida, los permisos, el aislamiento y P6b (dos guardados a la vez con la misma versión esperada). Con la base real y los casos de uso reales.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: composiciones", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const vendible = (clase: ClaseDeUsoDePrueba = "VENDIBLE", empresa = e.empresa) =>
    productoDeBase(c.dueno, empresa, { clase });
  const insumo = (datos: Parameters<MontajeDeStock["articulo"]>[1] = {}, escenario = e) =>
    c.articulo(escenario, { clase: "INSUMO", ...datos });
  const componente = (producto: string, cantidad = "1", unidadId = "UNIDAD") => ({
    productoId: producto,
    cantidad,
    unidadId,
  });
  const guardar = (producto: string, extra: Record<string, unknown> = {}, quien = e.gerente) =>
    c.casos.guardarComposicion(quien, {
      productoId: producto,
      versionEsperada: 0,
      rinde: "1",
      componentes: [],
      ...extra,
    });
  const versiones = (producto: string) =>
    c.contar("select count(*) as n from composicion where producto_id = $1", [producto]);
  const registros = async (accion: string, entidadId?: string) =>
    (await c.auditoria(e.empresa, accion)).filter(
      (r) => entidadId === undefined || r["entidad_id"] === entidadId,
    );

  describe("guardarComposicion", () => {
    it("guarda la primera versión con su rinde y sus componentes (en la unidad que los escribió), la consulta la devuelve y queda auditada", async () => {
      const pizza = await vendible();
      const harina = await insumo({ unidadBase: "GRAMO", dimension: "MASA" });
      const queso = await insumo();
      const guardada = valorDe(
        await guardar(pizza, {
          rinde: "10",
          componentes: [
            componente(harina.producto, "0.5", "KILOGRAMO"),
            componente(queso.producto, "2"),
          ],
        }),
      );
      expect(guardada).toEqual({ version: 1, yaExistia: false });
      expect(
        await c.filas(
          "select numero, rinde::text as rinde, creada_por from composicion where producto_id = $1",
          [pizza],
        ),
      ).toEqual([{ numero: 1, rinde: "10.0000", creada_por: e.personaDelGerente }]);
      expect(
        await c.filas(
          "select articulo_id, cantidad::text as cantidad, unidad_id, dimension, perdida::text as perdida from componente_de_composicion where empresa_id = $1 and composicion_id = (select id from composicion where producto_id = $2) order by numero",
          [e.empresa, pizza],
        ),
      ).toEqual([
        {
          articulo_id: harina.articulo,
          cantidad: "0.5000",
          unidad_id: "KILOGRAMO",
          dimension: "MASA",
          perdida: "0.0000",
        },
        {
          articulo_id: queso.articulo,
          cantidad: "2.0000",
          unidad_id: "UNIDAD",
          dimension: "CONTEO",
          perdida: "0.0000",
        },
      ]);
      const ficha = valorDe(
        await c.consultas.composicionDeProducto(e.gerente, { productoId: pizza }),
      );
      expect(ficha).toMatchObject({
        productoId: pizza,
        version: 1,
        rinde: "10.0000",
        componentes: [
          {
            articuloId: harina.articulo,
            productoId: harina.producto,
            cantidad: "0.5000",
            unidadId: "KILOGRAMO",
          },
          {
            articuloId: queso.articulo,
            productoId: queso.producto,
            cantidad: "2.0000",
            unidadId: "UNIDAD",
          },
        ],
      });
      const auditadas = await registros("COMPOSICION_GUARDADA");
      const mia = auditadas.filter(
        (r) => (r["despues"] as { productoId: string }).productoId === pizza,
      );
      expect(mia).toHaveLength(1);
      expect(mia[0]).toMatchObject({
        actor_persona_id: e.personaDelGerente,
        entidad: "composicion",
        antes: null,
        despues: { productoId: pizza, version: 1, rinde: "10.0000" },
      });
    });

    it("cambiar el conjunto es una versión nueva (con la versión esperada) y la anterior queda intacta; el administrador también puede", async () => {
      const pizza = await vendible();
      const a = await insumo();
      const b = await insumo();
      valorDe(await guardar(pizza, { componentes: [componente(a.producto)] }));
      const segunda = valorDe(
        await guardar(
          pizza,
          {
            versionEsperada: 1,
            rinde: "2",
            componentes: [componente(a.producto, "3"), componente(b.producto)],
          },
          e.administrador,
        ),
      );
      expect(segunda).toEqual({ version: 2, yaExistia: false });
      expect(await versiones(pizza)).toBe(2);
      expect(
        await c.filas(
          "select c.numero, count(k.*)::int as componentes from composicion c left join componente_de_composicion k on k.composicion_id = c.id where c.producto_id = $1 group by c.numero order by c.numero",
          [pizza],
        ),
      ).toEqual([
        { numero: 1, componentes: 1 },
        { numero: 2, componentes: 2 },
      ]);
      const ficha = valorDe(
        await c.consultas.composicionDeProducto(e.gerente, { productoId: pizza }),
      );
      expect(ficha?.version).toBe(2);
      expect(ficha?.componentes).toHaveLength(2);
      const auditada = (await registros("COMPOSICION_GUARDADA")).filter(
        (r) =>
          (r["despues"] as { productoId: string }).productoId === pizza &&
          (r["despues"] as { version: number }).version === 2,
      );
      expect(auditada[0]).toMatchObject({
        actor_persona_id: expect.any(String) as string,
        antes: { version: 1, rinde: "1.0000" },
        despues: { version: 2, rinde: "2.0000" },
      });
    });

    it("I11: repetir guardarComposicion con el mismo contenido devuelve la versión vigente con yaExistia, sin versión nueva ni auditoría, aunque la versión esperada sea vieja", async () => {
      const pizza = await vendible();
      const a = await insumo({ unidadBase: "GRAMO", dimension: "MASA" });
      const b = await insumo();
      const pedido = {
        rinde: "10",
        componentes: [componente(a.producto, "500", "GRAMO"), componente(b.producto, "2")],
      };
      const primera = valorDe(await guardar(pizza, pedido));
      const auditadas = (await registros("COMPOSICION_GUARDADA")).length;
      expect(primera).toEqual({ version: 1, yaExistia: false });
      // El mismo pedido: igual, con los componentes en otro orden y con `1` escrito como `1.00`.
      expect(valorDe(await guardar(pizza, pedido))).toEqual({ version: 1, yaExistia: true });
      expect(
        valorDe(
          await guardar(pizza, {
            rinde: "10.00",
            componentes: [componente(b.producto, "2.0"), componente(a.producto, "500", "GRAMO")],
          }),
        ),
      ).toEqual({ version: 1, yaExistia: true });
      // Después de una versión nueva, repetir la VIEJA con su versión esperada vieja no es el contenido vigente: es otro cambio, y la versión esperada ya no es esa.
      valorDe(await guardar(pizza, { ...pedido, versionEsperada: 1, rinde: "5" }));
      expect(await guardar(pizza, { ...pedido, versionEsperada: 1 })).toEqual({
        ok: false,
        error: "COMPOSICION_DESACTUALIZADA",
      });
      // Repetir lo que ya es vigente con una versión esperada vieja devuelve lo vigente.
      expect(valorDe(await guardar(pizza, { ...pedido, versionEsperada: 0, rinde: "5" }))).toEqual({
        version: 2,
        yaExistia: true,
      });
      expect(await versiones(pizza)).toBe(2);
      expect((await registros("COMPOSICION_GUARDADA")).length).toBe(auditadas + 1);
    });

    it("solo un producto VENDIBLE tiene receta (PRODUCTO_NO_ES_VENDIBLE); uno que no existe, no es uuid o está inactivo se rechaza", async () => {
      const a = await insumo();
      for (const clase of ["MATERIA_PRIMA", "INSUMO", "REVENTA", "ELABORADO"] as const) {
        const producto = await vendible(clase);
        expect(await guardar(producto, { componentes: [componente(a.producto)] })).toEqual({
          ok: false,
          error: "PRODUCTO_NO_ES_VENDIBLE",
        });
        expect(await versiones(producto)).toBe(0);
      }
      for (const productoId of [nuevoId(), "no-es-un-uuid", 7, undefined, null]) {
        expect(
          await c.casos.guardarComposicion(e.gerente, {
            productoId: productoId as string,
            versionEsperada: 0,
            rinde: "1",
            componentes: [componente(a.producto)],
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      }
      const inactivo = await productoDeBase(c.dueno, e.empresa, {
        clase: "VENDIBLE",
        activo: false,
      });
      expect(await guardar(inactivo, { componentes: [componente(a.producto)] })).toEqual({
        ok: false,
        error: "PRODUCTO_INACTIVO",
      });
    });

    it("valida lo que llega: sin componentes (COMPOSICION_VACIA), rinde inválido, repetidos, cantidad y unidad, y componentes sin artículo o inactivo", async () => {
      const pizza = await vendible();
      const a = await insumo();
      const b = await insumo();
      const antes = await versiones(pizza);
      const error = async (extra: Record<string, unknown>) => {
        const r = await guardar(pizza, extra);
        return r.ok ? "ok" : r.error;
      };
      expect(await error({ componentes: [] })).toBe("COMPOSICION_VACIA");
      expect(await error({ componentes: "nada" })).toBe("COMPOSICION_VACIA");
      for (const rinde of ["0", "0.0000", "-1", "abc", "", 1, null, "1,5", "1e3"]) {
        expect(await error({ rinde, componentes: [componente(a.producto)] }), String(rinde)).toBe(
          "RINDE_INVALIDO",
        );
      }
      expect(
        await error({ componentes: [componente(a.producto), componente(a.producto, "2")] }),
      ).toBe("COMPONENTE_REPETIDO");
      for (const cantidad of ["0", "-1", "abc", "", "1e3", 3, null]) {
        expect(
          await error({ componentes: [componente(a.producto, cantidad as string)] }),
          String(cantidad),
        ).toBe("CANTIDAD_INVALIDA");
      }
      expect(await error({ componentes: [componente(a.producto, "1", "CAJA")] })).toBe(
        "IDENTIFICADOR_INVALIDO",
      );
      expect(await error({ componentes: [componente(a.producto, "1", "toString")] })).toBe(
        "IDENTIFICADOR_INVALIDO",
      );
      expect(await error({ componentes: [componente(a.producto, "1", "LITRO")] })).toBe(
        "DIMENSION_DISTINTA",
      );
      expect(
        await error({
          componentes: [
            componente(b.producto),
            { productoId: "no-es-un-uuid", cantidad: "1", unidadId: "UNIDAD" },
          ],
        }),
      ).toBe("COMPONENTE_NO_CONTROLADO");
      expect(
        await error({
          componentes: [componente(b.producto), { cantidad: "1", unidadId: "UNIDAD" }],
        }),
      ).toBe("COMPONENTE_NO_CONTROLADO");
      // Sin artículo: un producto que nunca se controló, otro que dejó de controlarse, y uno que no existe.
      const sinArticulo = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      expect(await error({ componentes: [componente(sinArticulo)] })).toBe(
        "COMPONENTE_NO_CONTROLADO",
      );
      expect(await error({ componentes: [componente(nuevoId())] })).toBe(
        "COMPONENTE_NO_CONTROLADO",
      );
      const inactivo = await insumo({ activo: false });
      expect(await error({ componentes: [componente(inactivo.producto)] })).toBe(
        "COMPONENTE_NO_CONTROLADO",
      );
      // Nada de lo rechazado escribió una versión.
      expect(await versiones(pizza)).toBe(antes);
    });

    it("la conversión de la cantidad a la unidad de stock es exacta o se rechaza (CONVERSION_NO_EXACTA), y mide la dimensión del artículo", async () => {
      const pizza = await vendible();
      const sal = await insumo({ unidadBase: "KILOGRAMO", dimension: "MASA" });
      // 0,05 g son 0,00005 kg: no cabe en 4 decimales.
      expect(
        await guardar(pizza, { componentes: [componente(sal.producto, "0.05", "GRAMO")] }),
      ).toEqual({
        ok: false,
        error: "CONVERSION_NO_EXACTA",
      });
      expect(
        await guardar(pizza, { componentes: [componente(sal.producto, "0.5", "GRAMO")] }),
      ).toEqual({
        ok: true,
        valor: { version: 1, yaExistia: false },
      });
      expect(
        await guardar(pizza, {
          versionEsperada: 1,
          componentes: [componente(sal.producto, "1", "UNIDAD")],
        }),
      ).toEqual({
        ok: false,
        error: "DIMENSION_DISTINTA",
      });
    });

    it("la versión esperada tiene que ser la vigente (COMPOSICION_DESACTUALIZADA) y un número que no es un entero no negativo es un identificador inválido", async () => {
      const pizza = await vendible();
      const a = await insumo();
      expect(
        await guardar(pizza, { versionEsperada: 1, componentes: [componente(a.producto)] }),
      ).toEqual({
        ok: false,
        error: "COMPOSICION_DESACTUALIZADA",
      });
      for (const versionEsperada of [-1, 1.5, "0", null, Number.NaN, 2 ** 40]) {
        expect(
          await guardar(pizza, { versionEsperada, componentes: [componente(a.producto)] }),
          String(versionEsperada),
        ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      }
      valorDe(await guardar(pizza, { componentes: [componente(a.producto)] }));
      expect(
        await guardar(pizza, { versionEsperada: 0, componentes: [componente(a.producto, "2")] }),
      ).toEqual({
        ok: false,
        error: "COMPOSICION_DESACTUALIZADA",
      });
      expect(await versiones(pizza)).toBe(1);
    });

    it("la pérdida y la subcomposición son de la perilla: apagada es FUNCION_NO_INCLUIDA, y encendida también hasta que la explosión las aplique (nace cerrado)", async () => {
      const pizza = await vendible();
      const a = await insumo();
      const conPerdida = (perdida: unknown) => ({
        componentes: [{ ...componente(a.producto), perdida }],
      });
      expect(await guardar(pizza, conPerdida("5"))).toEqual({
        ok: false,
        error: { error: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" },
      });
      // Una pérdida en cero no es pérdida: pasa.
      expect(await guardar(pizza, conPerdida("0"))).toEqual({
        ok: true,
        valor: { version: 1, yaExistia: false },
      });
      c.encenderPerilla("composiciones_con_perdida");
      try {
        expect(await guardar(pizza, { versionEsperada: 1, ...conPerdida("5.25") })).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" },
        });
      } finally {
        c.apagarPerillas();
      }
      // Lo que no es un porcentaje bien escrito no llega ni a la perilla.
      for (const perdida of ["abc", "-1", "100", "5,5", "1e1", "1.23456", 5]) {
        expect(
          await guardar(pizza, { versionEsperada: 1, ...conPerdida(perdida) }),
          String(perdida),
        ).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
      }
      expect(await versiones(pizza)).toBe(1);
    });

    it("permisos: el operador no guarda (SIN_PERMISO); un administrador de una sola sucursal tampoco (la receta es de toda la empresa); con el módulo apagado nadie", async () => {
      const pizza = await vendible();
      const a = await insumo();
      const pedido = { componentes: [componente(a.producto)] };
      expect(await guardar(pizza, pedido, e.operador)).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await guardar(pizza, pedido, e.administradorDeUnaSucursal)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      c.apagarModulo("stock");
      try {
        expect(await guardar(pizza, pedido)).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      } finally {
        c.encenderModulos();
      }
      expect(await versiones(pizza)).toBe(0);
    });
  });

  describe("retirarComposicion", () => {
    it("inserta una versión vacía (el producto vuelve a «falta receta»), la consulta informa la versión sin componentes y se puede volver a guardar con ella", async () => {
      const pizza = await vendible();
      const a = await insumo();
      valorDe(await guardar(pizza, { rinde: "4", componentes: [componente(a.producto)] }));
      expect(
        valorDe(
          await c.casos.retirarComposicion(e.gerente, { productoId: pizza, versionEsperada: 1 }),
        ),
      ).toEqual({
        version: 2,
        yaEstaba: false,
      });
      expect(await versiones(pizza)).toBe(2);
      expect(
        await c.contar(
          "select count(*) as n from componente_de_composicion where composicion_id = (select id from composicion where producto_id = $1 and numero = 2)",
          [pizza],
        ),
      ).toBe(0);
      expect(
        valorDe(await c.consultas.composicionDeProducto(e.gerente, { productoId: pizza })),
      ).toMatchObject({
        version: 2,
        componentes: [],
      });
      const retiro = (await registros("COMPOSICION_RETIRADA")).filter(
        (r) => (r["despues"] as { productoId: string }).productoId === pizza,
      );
      expect(retiro).toHaveLength(1);
      expect(retiro[0]).toMatchObject({
        antes: { version: 1 },
        despues: { version: 2, componentes: [] },
      });
      // Guardar de nuevo parte de la versión vacía (aunque tenga el mismo contenido que la 1).
      expect(
        valorDe(
          await guardar(pizza, {
            versionEsperada: 2,
            rinde: "4",
            componentes: [componente(a.producto)],
          }),
        ),
      ).toEqual({
        version: 3,
        yaExistia: false,
      });
    });

    it("I12: retirar dos veces la receta es ok y no escribe ni audita la segunda", async () => {
      const pizza = await vendible();
      const a = await insumo();
      valorDe(await guardar(pizza, { componentes: [componente(a.producto)] }));
      const primera = valorDe(
        await c.casos.retirarComposicion(e.gerente, { productoId: pizza, versionEsperada: 1 }),
      );
      const auditadas = (await registros("COMPOSICION_RETIRADA")).length;
      expect(primera).toEqual({ version: 2, yaEstaba: false });
      expect(
        valorDe(
          await c.casos.retirarComposicion(e.gerente, { productoId: pizza, versionEsperada: 1 }),
        ),
      ).toEqual({
        version: 2,
        yaEstaba: true,
      });
      expect(
        valorDe(
          await c.casos.retirarComposicion(e.administrador, {
            productoId: pizza,
            versionEsperada: 2,
          }),
        ),
      ).toEqual({
        version: 2,
        yaEstaba: true,
      });
      expect(await versiones(pizza)).toBe(2);
      expect((await registros("COMPOSICION_RETIRADA")).length).toBe(auditadas);
    });

    it("sin ninguna versión es SIN_COMPOSICION; con otra versión esperada, COMPOSICION_DESACTUALIZADA; un producto que no existe, PRODUCTO_NO_ENCONTRADO", async () => {
      const pizza = await vendible();
      const a = await insumo();
      expect(
        await c.casos.retirarComposicion(e.gerente, { productoId: pizza, versionEsperada: 0 }),
      ).toEqual({
        ok: false,
        error: "SIN_COMPOSICION",
      });
      valorDe(await guardar(pizza, { componentes: [componente(a.producto)] }));
      expect(
        await c.casos.retirarComposicion(e.gerente, { productoId: pizza, versionEsperada: 0 }),
      ).toEqual({
        ok: false,
        error: "COMPOSICION_DESACTUALIZADA",
      });
      for (const productoId of [nuevoId(), "x", 3]) {
        expect(
          await c.casos.retirarComposicion(e.gerente, {
            productoId: productoId as string,
            versionEsperada: 1,
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      }
      for (const versionEsperada of [-1, 0.5, "1", null]) {
        expect(
          await c.casos.retirarComposicion(e.gerente, {
            productoId: pizza,
            versionEsperada: versionEsperada as number,
          }),
        ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      }
      expect(await versiones(pizza)).toBe(1);
    });

    it("el operador no retira (SIN_PERMISO), un administrador de una sucursal tampoco, y con el módulo apagado nadie", async () => {
      const pizza = await vendible();
      const a = await insumo();
      valorDe(await guardar(pizza, { componentes: [componente(a.producto)] }));
      const pedido = { productoId: pizza, versionEsperada: 1 };
      expect(await c.casos.retirarComposicion(e.operador, pedido)).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await c.casos.retirarComposicion(e.administradorDeUnaSucursal, pedido)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      c.apagarModulo("stock");
      try {
        expect(await c.casos.retirarComposicion(e.gerente, pedido)).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
      } finally {
        c.encenderModulos();
      }
      expect(await versiones(pizza)).toBe(1);
    });
  });

  describe("composicionDeProducto", () => {
    it("los tres roles la ven (stock.ver); un producto sin receta, que no existe o que no es un uuid da null; con el módulo apagado nadie la ve", async () => {
      const pizza = await vendible();
      const a = await insumo();
      expect(
        valorDe(await c.consultas.composicionDeProducto(e.gerente, { productoId: pizza })),
      ).toBeNull();
      valorDe(await guardar(pizza, { componentes: [componente(a.producto)] }));
      for (const quien of [e.gerente, e.administrador, e.operador]) {
        expect(
          valorDe(await c.consultas.composicionDeProducto(quien, { productoId: pizza }))?.version,
        ).toBe(1);
      }
      for (const productoId of [nuevoId(), "x", 3]) {
        expect(
          valorDe(
            await c.consultas.composicionDeProducto(e.gerente, {
              productoId: productoId as string,
            }),
          ),
        ).toBeNull();
      }
      c.apagarModulo("stock");
      try {
        expect(await c.consultas.composicionDeProducto(e.gerente, { productoId: pizza })).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
      } finally {
        c.encenderModulos();
      }
    });
  });

  describe("concurrencia y aislamiento", () => {
    it("P6b: dos guardarComposicion del mismo producto con la misma versión esperada a la vez: una gana y la otra es COMPOSICION_DESACTUALIZADA", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const pizza = await vendible();
        const a = await insumo();
        const b = await insumo();
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => guardar(pizza, { componentes: [componente(a.producto)] })),
            () => firme(() => guardar(pizza, { componentes: [componente(b.producto)] })),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
        expect(resultados.find((r) => !r.ok)).toEqual({
          ok: false,
          error: "COMPOSICION_DESACTUALIZADA",
        });
        expect(await versiones(pizza)).toBe(1);
        expect(
          await c.contar(
            "select count(*) as n from componente_de_composicion where composicion_id = (select id from composicion where producto_id = $1)",
            [pizza],
          ),
        ).toBe(1);
      }
    });

    it("P6b: dos guardados del MISMO contenido a la vez dejan una sola versión (la segunda es yaExistia)", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const pizza = await vendible();
        const a = await insumo();
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => guardar(pizza, { componentes: [componente(a.producto)] })),
            () => firme(() => guardar(pizza, { componentes: [componente(a.producto)] })),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(resultados.map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(await versiones(pizza)).toBe(1);
      }
    });

    it("P15: la empresa B no ve la receta de A, y no la guarda, retira ni usa sus artículos como componentes", async () => {
      const pizza = await vendible();
      const a = await insumo();
      valorDe(await guardar(pizza, { componentes: [componente(a.producto)] }));
      expect(
        valorDe(await c.consultas.composicionDeProducto(otra.gerente, { productoId: pizza })),
      ).toBeNull();
      expect(
        await c.casos.guardarComposicion(otra.gerente, {
          productoId: pizza,
          versionEsperada: 1,
          rinde: "1",
          componentes: [componente(a.producto, "9")],
        }),
      ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      expect(
        await c.casos.retirarComposicion(otra.gerente, { productoId: pizza, versionEsperada: 1 }),
      ).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      // Un producto de B con un componente de A: el artículo de A no existe para B.
      const deB = await vendible("VENDIBLE", otra.empresa);
      expect(
        await c.casos.guardarComposicion(otra.gerente, {
          productoId: deB,
          versionEsperada: 0,
          rinde: "1",
          componentes: [componente(a.producto)],
        }),
      ).toEqual({ ok: false, error: "COMPONENTE_NO_CONTROLADO" });
      expect(await versiones(pizza)).toBe(1);
      expect(await versiones(deB)).toBe(0);
    });
  });
});
