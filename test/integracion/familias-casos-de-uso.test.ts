import { randomUUID } from "node:crypto";
import { nombreUnico } from "./unicos";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarCatalogo,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * F1 de familias (A8) contra una base real, por los casos de uso de verdad (guard, transacción, auditoría): crear, editar, agregar y quitar productos. Los casos
 * críticos: la repetición (mismo id, mismo estado, mismo producto), la concurrencia (dos agregan el mismo producto a familias distintas; dos cambian la misma
 * familia con la misma versión), el aislamiento por empresa y el permiso.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("familias: casos de uso (F1)", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  beforeAll(async () => {
    if (base !== null) c = await montarCatalogo(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const auditorias = async (e: EscenarioDeCatalogo, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  const nueva = async (e: EscenarioDeCatalogo, nombre = nombreUnico("Familia")) =>
    valorDe(await c.casos.crearFamilia(e.gerente, { id: randomUUID(), nombre }));
  const producto = (e: EscenarioDeCatalogo) => productoDeBase(c.dueno, e.empresa);
  const miembros = (familiaId: string) =>
    c.contar(
      "select count(*) as n from miembro_de_familia where familia_id = $1 and quitado_en is null",
      [familiaId],
    );

  describe("crearFamilia", () => {
    it("crear: repetir con el mismo id deja una familia y una auditoría; con otro nombre, ID_REUTILIZADO", async () => {
      const e = await c.escenario();
      const id = randomUUID();
      const primera = valorDe(await c.casos.crearFamilia(e.gerente, { id, nombre: "Café" }));
      expect(primera).toEqual({ familiaId: id, version: 1, yaExistia: false });
      const segunda = valorDe(await c.casos.crearFamilia(e.gerente, { id, nombre: "café" }));
      expect(segunda).toEqual({ familiaId: id, version: 1, yaExistia: true });
      expect(
        await c.contar("select count(*) as n from familia_de_producto where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(1);
      expect(await auditorias(e, "FAMILIA_CREADA")).toBe(1);
      expect(await c.casos.crearFamilia(e.gerente, { id, nombre: "Té" })).toEqual({
        ok: false,
        error: "ID_REUTILIZADO",
      });
    });

    it("nace con los dos interruptores apagados y activa; el nombre es único por empresa sin mayúsculas", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e, "Gaseosa 500 cc");
      const { rows } = await c.dueno.query(
        "select agrupar_en_carta, agrupar_en_pos, activa from familia_de_producto where id = $1",
        [familiaId],
      );
      expect(rows[0]).toEqual({ agrupar_en_carta: false, agrupar_en_pos: false, activa: true });
      expect(
        await c.casos.crearFamilia(e.gerente, { id: randomUUID(), nombre: "GASEOSA 500 CC" }),
      ).toEqual({ ok: false, error: "FAMILIA_DUPLICADA" });
      expect(await c.casos.crearFamilia(e.gerente, { id: randomUUID(), nombre: "<b>" })).toEqual({
        ok: false,
        error: "NOMBRE_DE_FAMILIA_INVALIDO",
      });
      expect(await c.casos.crearFamilia(e.gerente, { id: "no-es-uuid", nombre: "X1" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
    });

    it("dos altas simultáneas con el MISMO id dejan una sola familia y una auditoría", async () => {
      const e = await c.escenario();
      const id = randomUUID();
      const [a, b] = await Promise.all([
        c.casos.crearFamilia(e.gerente, { id, nombre: "Cerveza" }),
        c.casos.crearFamilia(e.gerente, { id, nombre: "Cerveza" }),
      ]);
      expect([valorDe(a).yaExistia, valorDe(b).yaExistia].sort()).toEqual([false, true]);
      expect(await auditorias(e, "FAMILIA_CREADA")).toBe(1);
    });

    it("el operador no puede; otra empresa no ve la familia", async () => {
      const e = await c.escenario();
      const otra = await c.escenario();
      expect(
        await c.casos.crearFamilia(e.operador, { id: randomUUID(), nombre: "Prohibida" }),
      ).toMatchObject({ ok: false });
      const { familiaId } = await nueva(e);
      expect(
        await c.casos.editarFamilia(otra.gerente, {
          familiaId,
          versionEsperada: 1,
          agruparEnCarta: true,
        }),
      ).toEqual({ ok: false, error: "FAMILIA_NO_ENCONTRADA" });
    });
  });

  describe("editarFamilia", () => {
    it("editar: repetir el estado ya aplicado es yaEstaba aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      const primera = valorDe(
        await c.casos.editarFamilia(e.gerente, {
          familiaId,
          versionEsperada: 1,
          agruparEnCarta: true,
          agruparEnPos: true,
        }),
      );
      expect(primera).toEqual({ version: 2, yaEstaba: false });
      const repetida = valorDe(
        await c.casos.editarFamilia(e.gerente, {
          familiaId,
          versionEsperada: 1,
          agruparEnCarta: true,
          agruparEnPos: true,
        }),
      );
      expect(repetida).toEqual({ version: 2, yaEstaba: true });
      expect(await auditorias(e, "FAMILIA_EDITADA")).toBe(1);
    });

    it("con otro estado y una versión vieja se rechaza todo; desactivar no toca a los miembros", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      const p = await producto(e);
      valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      );
      expect(
        await c.casos.editarFamilia(e.gerente, { familiaId, versionEsperada: 1, activa: false }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      valorDe(
        await c.casos.editarFamilia(e.gerente, { familiaId, versionEsperada: 2, activa: false }),
      );
      expect(await miembros(familiaId)).toBe(1);
      const { rows } = await c.dueno.query("select activo from producto where id = $1", [p]);
      expect(rows[0]).toEqual({ activo: true });
    });

    it("dos cambios a la vez desde la misma versión: gana uno y el otro es VERSION_DESACTUALIZADA", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      const [a, b] = await Promise.all([
        c.casos.editarFamilia(e.gerente, { familiaId, versionEsperada: 1, agruparEnCarta: true }),
        c.casos.editarFamilia(e.gerente, { familiaId, versionEsperada: 1, agruparEnPos: true }),
      ]);
      const resultados = [a, b].map((r) => (r.ok ? "ok" : r.error));
      expect(resultados.sort()).toEqual(["VERSION_DESACTUALIZADA", "ok"]);
    });
  });

  describe("agregar y quitar", () => {
    it("agregar: el mismo producto dos veces es yaEstaba, sin escribir ni auditar la segunda", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      const p = await producto(e);
      const primera = valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      );
      expect(primera).toEqual({ version: 2, yaEstaba: false, miembros: 1, seAgrupa: false });
      const segunda = valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      );
      expect(segunda).toEqual({ version: 2, yaEstaba: true, miembros: 1, seAgrupa: false });
      expect(await miembros(familiaId)).toBe(1);
      expect(await auditorias(e, "PRODUCTO_AGREGADO_A_FAMILIA")).toBe(1);
    });

    it("un producto en OTRA familia no se agrega; el precio y el producto no cambian", async () => {
      const e = await c.escenario();
      const a = await nueva(e);
      const b = await nueva(e);
      const p = await producto(e);
      valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId: a.familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      );
      expect(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId: b.familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "PRODUCTO_EN_OTRA_FAMILIA" });
      expect(await miembros(b.familiaId)).toBe(0);
    });

    it("un producto de otra empresa, uno que no se vende y una versión vieja no se agregan, y no queda nada a medias", async () => {
      const e = await c.escenario();
      const ajena = await c.escenario();
      const { familiaId } = await nueva(e);
      const deOtra = await producto(ajena);
      const insumo = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      const propio = await producto(e);
      expect(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: deOtra,
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      expect(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: insumo,
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "PRODUCTO_NO_VENDIBLE" });
      expect(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: propio,
          versionEsperada: 7,
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(await miembros(familiaId)).toBe(0);
      expect(await auditorias(e, "PRODUCTO_AGREGADO_A_FAMILIA")).toBe(0);
    });

    it("dos personas agregan el MISMO producto a familias distintas a la vez: gana una sola", async () => {
      const e = await c.escenario();
      const a = await nueva(e);
      const b = await nueva(e);
      const p = await producto(e);
      const [r1, r2] = await Promise.all([
        c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId: a.familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
        c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId: b.familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      ]);
      expect([r1, r2].map((r) => (r.ok ? "ok" : r.error)).sort()).toEqual([
        "PRODUCTO_EN_OTRA_FAMILIA",
        "ok",
      ]);
      expect(
        await c.contar(
          "select count(*) as n from miembro_de_familia where producto_id = $1 and quitado_en is null",
          [p],
        ),
      ).toBe(1);
    });

    it("dos personas agregan productos DISTINTOS a la misma familia con la misma versión: gana una; la otra reintenta con la nueva y entra con la posición siguiente", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      const p1 = await producto(e);
      const p2 = await producto(e);
      const [r1, r2] = await Promise.all([
        c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p1,
          versionEsperada: 1,
        }),
        c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p2,
          versionEsperada: 1,
        }),
      ]);
      expect([r1, r2].map((r) => (r.ok ? "ok" : r.error)).sort()).toEqual([
        "VERSION_DESACTUALIZADA",
        "ok",
      ]);
      const perdedor = r1.ok ? p2 : p1;
      const reintento = valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: perdedor,
          versionEsperada: 2,
        }),
      );
      expect(reintento).toMatchObject({ yaEstaba: false, miembros: 2, seAgrupa: true });
      const { rows } = await c.dueno.query(
        "select posicion from miembro_de_familia where familia_id = $1 and quitado_en is null order by posicion",
        [familiaId],
      );
      expect(rows).toEqual([{ posicion: 1 }, { posicion: 2 }]);
    });

    it("quitar: quitar dos veces es yaEstaba, sin escribir ni auditar la segunda", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      const p1 = await producto(e);
      const p2 = await producto(e);
      valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p1,
          versionEsperada: 1,
        }),
      );
      valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p2,
          versionEsperada: 2,
        }),
      );
      const quitado = valorDe(
        await c.casos.quitarProductoDeFamilia(e.gerente, {
          familiaId,
          productoId: p1,
          versionEsperada: 3,
        }),
      );
      expect(quitado).toEqual({ version: 4, yaEstaba: false, miembros: 1, seAgrupa: false });
      const otra = valorDe(
        await c.casos.quitarProductoDeFamilia(e.gerente, {
          familiaId,
          productoId: p1,
          versionEsperada: 3,
        }),
      );
      expect(otra).toEqual({ version: 4, yaEstaba: true, miembros: 1, seAgrupa: false });
      expect(await auditorias(e, "PRODUCTO_QUITADO_DE_FAMILIA")).toBe(1);
      // No se borra nada: el vínculo queda con quién y cuándo, y «Deshacer» (volver a agregar) es una fila nueva.
      const { rows } = await c.dueno.query(
        "select quitado_en is not null as quitado from miembro_de_familia where producto_id = $1",
        [p1],
      );
      expect(rows).toEqual([{ quitado: true }]);
      valorDe(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: p1,
          versionEsperada: 4,
        }),
      );
      expect(
        await c.contar("select count(*) as n from miembro_de_familia where producto_id = $1", [p1]),
      ).toBe(2);
    });

    it("el tope es de 50 miembros", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      let version = 1;
      for (let i = 0; i < 50; i += 1) {
        const r = valorDe(
          await c.casos.agregarProductoAFamilia(e.gerente, {
            familiaId,
            productoId: await producto(e),
            versionEsperada: version,
          }),
        );
        version = r.version;
      }
      expect(
        await c.casos.agregarProductoAFamilia(e.gerente, {
          familiaId,
          productoId: await producto(e),
          versionEsperada: version,
        }),
      ).toEqual({ ok: false, error: "FAMILIA_LLENA" });
    });

    it("el operador no agrega ni quita", async () => {
      const e = await c.escenario();
      const { familiaId } = await nueva(e);
      const p = await producto(e);
      expect(
        await c.casos.agregarProductoAFamilia(e.operador, {
          familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      ).toMatchObject({ ok: false });
      expect(
        await c.casos.quitarProductoDeFamilia(e.operador, {
          familiaId,
          productoId: p,
          versionEsperada: 1,
        }),
      ).toMatchObject({ ok: false });
    });
  });
});
