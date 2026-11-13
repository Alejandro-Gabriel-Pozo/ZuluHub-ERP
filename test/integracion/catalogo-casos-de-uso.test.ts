import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { GrupoPedido } from "../../src/modulos/catalogo/publico";
import {
  CONTEXTO_CON_AHORA,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * E2 mínimo: los casos de uso y las consultas del catálogo contra una base real, con el rol de la aplicación y el contexto firmado. Cubre
 * permisos y alcance (A4, A5), aislamiento entre empresas (A1), idempotencia (I1 a I6), reglas de clase y datos (D1 a D5), las opciones, el
 * consumo, la copia y las secciones. La concurrencia está en `catalogo-concurrencia.test.ts` y el precio congelado, la cotización y la forma
 * de venta en `catalogo-cotizar.test.ts` y `catalogo-forma-de-venta.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)(
  "catálogo: los casos de uso y las consultas contra una base real",
  () => {
    let c: Awaited<ReturnType<typeof montarCatalogo>>;
    let e: EscenarioDeCatalogo;
    beforeAll(async () => {
      if (base === null) return;
      c = await montarCatalogo(base);
      e = await c.escenario();
    });
    afterAll(async () => {
      if (base !== null) await c.cerrar();
    });

    const nuevoProducto = async (extra: Record<string, unknown> = {}) =>
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
    const producto = (id: string) =>
      c.filas("select * from producto where id = $1", [id]).then((f) => f[0]);
    const version = async (id: string) => Number((await producto(id))?.["version"]);
    const versionDeOpciones = async (id: string) =>
      Number((await producto(id))?.["version_de_opciones"]);
    const cambiosEn = (id: string) =>
      c.contar("select count(*) as n from auditoria_empresa where entidad_id = $1", [id]);

    const grupoAdicional = (extra: Partial<GrupoPedido> = {}): GrupoPedido => ({
      id: nuevoId(),
      clase: "ADICIONAL",
      nombre: nombreAlAzarDeProducto("Extras"),
      esObligatorio: false,
      admiteVarias: true,
      seMuestraEnCarta: true,
      orden: 1,
      activo: true,
      opciones: [
        { id: nuevoId(), nombre: "Leche de almendras", recargo: "600", orden: 1, activa: true },
      ],
      ...extra,
    });
    const grupoDeTamano = (): GrupoPedido => ({
      id: nuevoId(),
      clase: "VARIANTE",
      esTamano: true,
      nombre: nombreAlAzarDeProducto("Tamaño"),
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 0,
      activo: true,
      opciones: [
        { id: nuevoId(), nombre: "Chico", recargo: "0", orden: 1, activa: true },
        {
          id: nuevoId(),
          nombre: "Grande",
          recargo: "0",
          orden: 2,
          activa: true,
          factorDeTamano: "1.5",
        },
      ],
    });

    describe("crear productos (D1, D2, I2)", () => {
      it("el gerente crea un producto vendible: queda activo, en su empresa, se vende y deja su auditoría", async () => {
        const id = nuevoId();
        const r = await c.casos.crearProducto(e.gerente, {
          id,
          claseDeUso: "VENDIBLE",
          nombre: "  Café   con leche ",
          nombreDeCocina: "Cortado",
          descripcionEnCarta: "Con leche vaporizada",
          codigo: "CAF-1",
          codigoDeBarras: "7790001234567",
          unidadBaseId: "UNIDAD",
          alicuota: "21",
        });
        expect(r).toEqual({ ok: true, valor: { productoId: id, yaExistia: false } });
        expect(await producto(id)).toMatchObject({
          empresa_id: e.empresa,
          nombre: "Café con leche",
          nombre_clave: "café con leche",
          clase_de_uso: "VENDIBLE",
          unidad_de_venta_id: "UNIDAD",
          paso_minimo: "1.0000",
          alicuota_iva: "21",
          falta_completar: false,
          se_vende: true,
          activo: true,
          version: 1,
          creado_por: e.personaDelGerente,
        });
        expect(await c.auditoria(e.empresa, "PRODUCTO_CREADO")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              entidad: "producto",
              entidad_id: id,
              actor_persona_id: e.personaDelGerente,
            }),
          ]),
        );
      });

      it("I2: repetir crearProducto con el mismo id deja un producto y devuelve yaExistia; con otro contenido, ID_REUTILIZADO", async () => {
        const id = nuevoId();
        const pedido = {
          id,
          claseDeUso: "VENDIBLE",
          nombre: nombreAlAzarDeProducto(),
          unidadBaseId: "UNIDAD",
          alicuota: "21",
        };
        expect(await c.casos.crearProducto(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { productoId: id, yaExistia: false },
        });
        const auditorias = await cambiosEn(id);
        expect(await c.casos.crearProducto(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { productoId: id, yaExistia: true },
        });
        expect(await c.contar("select count(*) as n from producto where id = $1", [id])).toBe(1);
        expect(await cambiosEn(id)).toBe(auditorias);
        expect(await c.casos.crearProducto(e.gerente, { ...pedido, alicuota: "10.5" })).toEqual({
          ok: false,
          error: "ID_REUTILIZADO",
        });
        // Un id que es de OTRA empresa (que esta no ve) también es `ID_REUTILIZADO`, sin revelar nada.
        const otra = await c.escenario();
        const ajeno = valorDe(
          await c.casos.crearProducto(otra.gerente, {
            ...pedido,
            id: nuevoId(),
            nombre: nombreAlAzarDeProducto(),
          }),
        ).productoId;
        expect(await c.casos.crearProducto(e.gerente, { ...pedido, id: ajeno })).toEqual({
          ok: false,
          error: "ID_REUTILIZADO",
        });
      });

      it("I2: repetir crearProductoRapido con el mismo id deja un producto y devuelve yaExistia; con otro contenido, ID_REUTILIZADO", async () => {
        const id = nuevoId();
        const pedido = {
          id,
          claseDeUso: "MATERIA_PRIMA",
          nombre: nombreAlAzarDeProducto("Harina"),
          unidadBaseId: "KILOGRAMO",
        };
        expect(await c.casos.crearProductoRapido(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { productoId: id, yaExistia: false },
        });
        expect(await c.casos.crearProductoRapido(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { productoId: id, yaExistia: true },
        });
        expect(await c.contar("select count(*) as n from producto where id = $1", [id])).toBe(1);
        expect(
          await c.casos.crearProductoRapido(e.gerente, { ...pedido, unidadBaseId: "GRAMO" }),
        ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
      });

      it("D2: la alta rápida de algo que se vende queda «Falta completar», no se vende, y editarProducto con alícuota la completa", async () => {
        const id = nuevoId();
        valorDe(
          await c.casos.crearProductoRapido(e.gerente, {
            id,
            claseDeUso: "VENDIBLE",
            nombre: nombreAlAzarDeProducto(),
            unidadBaseId: "UNIDAD",
          }),
        );
        expect(await producto(id)).toMatchObject({
          falta_completar: true,
          se_vende: false,
          alicuota_iva: null,
        });
        const nombre = String((await producto(id))?.["nombre"]);
        expect(
          await c.casos.editarProducto(e.gerente, { productoId: id, versionEsperada: 1, nombre }),
        ).toEqual({ ok: false, error: "ALICUOTA_REQUERIDA" });
        expect(
          await c.casos.editarProducto(e.gerente, {
            productoId: id,
            versionEsperada: 1,
            nombre,
            alicuota: "21",
          }),
        ).toEqual({ ok: true, valor: { version: 2 } });
        expect(await producto(id)).toMatchObject({ falta_completar: false, se_vende: true });
      });

      it("D1: cada clase pide y prohíbe lo suyo (alícuota, sección, nombre de cocina, descripción); materia prima, insumo y elaborado no se venden", async () => {
        for (const claseDeUso of ["MATERIA_PRIMA", "INSUMO", "ELABORADO"]) {
          const r = await c.casos.crearProducto(e.gerente, {
            id: nuevoId(),
            claseDeUso,
            nombre: nombreAlAzarDeProducto(),
            unidadBaseId: "UNIDAD",
            alicuota: "21",
          });
          expect(r, claseDeUso).toEqual({
            ok: false,
            error: { error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE", campo: "alicuota" },
          });
          const sin = await c.casos.crearProducto(e.gerente, {
            id: nuevoId(),
            claseDeUso,
            nombre: nombreAlAzarDeProducto(),
            unidadBaseId: "UNIDAD",
          });
          expect(sin.ok, claseDeUso).toBe(true);
        }
        for (const claseDeUso of ["REVENTA", "VENDIBLE"]) {
          const sinAlicuota = await c.casos.crearProducto(e.gerente, {
            id: nuevoId(),
            claseDeUso,
            nombre: nombreAlAzarDeProducto(),
            unidadBaseId: "UNIDAD",
          });
          expect(sinAlicuota, claseDeUso).toEqual({ ok: false, error: "ALICUOTA_REQUERIDA" });
        }
      });

      it("cada error con su nombre: nombre, clase, unidad, alícuota, códigos, sección, forma de venta y duplicados (también contra los desactivados)", async () => {
        const ok = {
          id: nuevoId(),
          claseDeUso: "VENDIBLE",
          nombre: nombreAlAzarDeProducto(),
          unidadBaseId: "UNIDAD",
          alicuota: "21",
        };
        const con = (extra: Record<string, unknown>) =>
          c.casos.crearProducto(e.gerente, {
            ...ok,
            id: nuevoId(),
            nombre: nombreAlAzarDeProducto(),
            ...extra,
          });
        expect(await con({ nombre: "<b>" })).toEqual({
          ok: false,
          error: "NOMBRE_DE_PRODUCTO_INVALIDO",
        });
        expect(await con({ claseDeUso: "COMBO" })).toEqual({ ok: false, error: "CLASE_INVALIDA" });
        expect(await con({ unidadBaseId: "CAJA" })).toEqual({
          ok: false,
          error: "UNIDAD_INVALIDA",
        });
        expect(await con({ alicuota: "20" })).toEqual({ ok: false, error: "ALICUOTA_INVALIDA" });
        expect(await con({ codigo: "con espacio" })).toEqual({
          ok: false,
          error: "CODIGO_INVALIDO",
        });
        expect(await con({ codigoDeBarras: "123" })).toEqual({
          ok: false,
          error: "CODIGO_DE_BARRAS_INVALIDO",
        });
        expect(await con({ id: "no-es-uuid" })).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
        expect(await con({ seccionDeCartaId: nuevoId() })).toEqual({
          ok: false,
          error: "SECCION_NO_ENCONTRADA",
        });
        expect(await con({ unidadDeVentaId: "KILOGRAMO" })).toEqual({
          ok: false,
          error: "FORMA_DE_VENTA_INVALIDA",
        });
        expect(await con({ pasoMinimo: "0.5" })).toEqual({
          ok: false,
          error: "FORMA_DE_VENTA_NO_SOPORTADA",
        });
        expect(await con({ pasoMinimo: "0" })).toEqual({
          ok: false,
          error: "FORMA_DE_VENTA_INVALIDA",
        });
        // Duplicados: nombre (sin distinguir mayúsculas, también desactivados), código y código de barras.
        const original = valorDe(
          await con({ codigo: "DUP-1", codigoDeBarras: "7790009999999" }),
        ).productoId;
        const nombreOriginal = String((await producto(original))?.["nombre"]);
        expect(await con({ nombre: nombreOriginal.toUpperCase() })).toEqual({
          ok: false,
          error: "PRODUCTO_DUPLICADO",
        });
        valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: original }));
        expect(await con({ nombre: nombreOriginal })).toEqual({
          ok: false,
          error: "PRODUCTO_DUPLICADO",
        });
        expect(await con({ codigo: "DUP-1" })).toEqual({ ok: false, error: "CODIGO_DUPLICADO" });
        expect(await con({ codigoDeBarras: "7790009999999" })).toEqual({
          ok: false,
          error: "CODIGO_DE_BARRAS_DUPLICADO",
        });
      });
    });

    describe("editar, desactivar y reactivar", () => {
      it("idempotente: repetir editarProducto ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
        const id = await nuevoProducto();
        const nombre = String((await producto(id))?.["nombre"]);
        const pedido = {
          productoId: id,
          versionEsperada: 1,
          nombre,
          alicuota: "10.5",
          nombreDeCocina: "Cocina",
        };
        expect(await c.casos.editarProducto(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { version: 2 },
        });
        const antes = await cambiosEn(id);
        expect(await c.casos.editarProducto(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { version: 2 },
        });
        expect(await cambiosEn(id)).toBe(antes);
        expect(await version(id)).toBe(2);
        // Otra edición con la versión vieja sí es un conflicto.
        expect(await c.casos.editarProducto(e.gerente, { ...pedido, alicuota: "27" })).toEqual({
          ok: false,
          error: "VERSION_DESACTUALIZADA",
        });
        expect(await c.auditoria(e.empresa, "PRODUCTO_EDITADO")).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              entidad_id: id,
              antes: { alicuota: "21", nombreDeCocina: null },
              despues: { alicuota: "10.5", nombreDeCocina: "Cocina" },
            }),
          ]),
        );
      });

      it("no edita lo inexistente, lo desactivado ni la forma de venta; la clase y la unidad base no cambian", async () => {
        const id = await nuevoProducto();
        const nombre = String((await producto(id))?.["nombre"]);
        expect(
          await c.casos.editarProducto(e.gerente, {
            productoId: nuevoId(),
            versionEsperada: 1,
            nombre,
            alicuota: "21",
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: id }));
        expect(
          await c.casos.editarProducto(e.gerente, {
            productoId: id,
            versionEsperada: 1,
            nombre,
            alicuota: "10.5",
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_INACTIVO" });
        expect(await producto(id)).toMatchObject({
          clase_de_uso: "VENDIBLE",
          unidad_base_id: "UNIDAD",
        });
      });

      it("I5: desactivar dos veces es ok, no escribe ni audita la segunda", async () => {
        const id = await nuevoProducto();
        expect(await c.casos.desactivarProducto(e.gerente, { productoId: id })).toEqual({
          ok: true,
          valor: { yaEstaba: false },
        });
        const [auditorias, v] = [await cambiosEn(id), await version(id)];
        expect(await c.casos.desactivarProducto(e.gerente, { productoId: id })).toEqual({
          ok: true,
          valor: { yaEstaba: true },
        });
        expect(await cambiosEn(id)).toBe(auditorias);
        expect(await version(id)).toBe(v);
        expect(await c.casos.desactivarProducto(e.gerente, { productoId: nuevoId() })).toEqual({
          ok: false,
          error: "PRODUCTO_NO_ENCONTRADO",
        });
      });

      it("I5: reactivar dos veces es ok, no escribe ni audita la segunda", async () => {
        const id = await nuevoProducto();
        valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: id }));
        expect(await c.casos.reactivarProducto(e.gerente, { productoId: id })).toEqual({
          ok: true,
          valor: { yaEstaba: false },
        });
        const auditorias = await cambiosEn(id);
        expect(await c.casos.reactivarProducto(e.gerente, { productoId: id })).toEqual({
          ok: true,
          valor: { yaEstaba: true },
        });
        expect(await cambiosEn(id)).toBe(auditorias);
        expect(await producto(id)).toMatchObject({ activo: true });
      });
    });

    describe("ficha del producto: unidades y sección", () => {
      it("verProducto trae la unidad base y la de venta con su símbolo, y la sección también si está desactivada; listarUnidades trae la lista cerrada", async () => {
        const seccionId = nuevoId();
        const nombreDeSeccion = nombreAlAzarDeProducto("Entradas");
        valorDe(
          await c.casos.crearSeccionDeCarta(e.gerente, {
            id: seccionId,
            nombre: nombreDeSeccion,
            orden: 1,
          }),
        );
        const p = await nuevoProducto({ seccionDeCartaId: seccionId });
        const sin = await nuevoProducto();
        const ficha = valorDe(await c.consultas.verProducto(e.operador, { productoId: p }));
        expect(ficha?.unidadBase).toEqual({
          id: "UNIDAD",
          dimension: "CONTEO",
          simbolo: "u",
          factorABase: "1",
          esBase: true,
        });
        expect(ficha?.unidadDeVenta?.id).toBe("UNIDAD");
        expect(ficha?.seccion).toMatchObject({
          id: seccionId,
          nombre: nombreDeSeccion,
          activa: true,
        });
        // Desactivada, el producto la conserva y la ficha la sigue mostrando (con `activa: false`).
        valorDe(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId }));
        expect(
          valorDe(await c.consultas.verProducto(e.operador, { productoId: p }))?.seccion,
        ).toMatchObject({ id: seccionId, activa: false });
        expect(
          valorDe(await c.consultas.verProducto(e.operador, { productoId: sin }))?.seccion,
        ).toBeNull();
        const unidades = valorDe(await c.consultas.listarUnidades(e.operador));
        expect(unidades.map((u) => u.id).sort()).toEqual([
          "CENTIMETRO",
          "CENTIMETRO_CUADRADO",
          "GRAMO",
          "HORA",
          "KILOGRAMO",
          "LITRO",
          "METRO",
          "METRO_CUADRADO",
          "METRO_CUBICO",
          "MILILITRO",
          "MILIMETRO",
          "MINUTO",
          "TONELADA",
          "UNIDAD",
        ]);
        // Por dimensión, con la unidad base primero.
        const primeras = new Map<string, boolean>();
        for (const u of unidades)
          if (!primeras.has(u.dimension)) primeras.set(u.dimension, u.esBase);
        expect([...primeras.values()].every(Boolean)).toBe(true);
        expect(unidades.find((u) => u.id === "KILOGRAMO")).toEqual({
          id: "KILOGRAMO",
          dimension: "MASA",
          simbolo: "kg",
          factorABase: "1000",
          esBase: false,
        });
        expect(unidades).toHaveLength(14);
        expect(
          unidades
            .filter((u) => u.esBase)
            .map((u) => u.dimension)
            .sort(),
        ).toEqual(["CONTEO", "LONGITUD", "MASA", "SUPERFICIE", "TIEMPO", "VOLUMEN"]);
      });

      it("la lista trae la sección de cada producto, también desactivada; editar el producto SIN tocar una sección apagada o una alícuota «Exento» lo acepta", async () => {
        const seccionId = nuevoId();
        const nombreDeSeccion = nombreAlAzarDeProducto("Postres");
        valorDe(
          await c.casos.crearSeccionDeCarta(e.gerente, {
            id: seccionId,
            nombre: nombreDeSeccion,
            orden: 1,
          }),
        );
        const nombre = nombreAlAzarDeProducto("ConSeccion");
        const p = await nuevoProducto({ nombre, seccionDeCartaId: seccionId, alicuota: "EXENTO" });
        valorDe(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId }));
        const lista = valorDe(
          await c.consultas.listarProductos(e.operador, { texto: nombre.toLowerCase() }),
        );
        expect(lista.productos.find((x) => x.id === p)?.seccion).toEqual({
          id: seccionId,
          nombre: nombreDeSeccion,
          activa: false,
        });
        const sin = await nuevoProducto({ nombre: nombreAlAzarDeProducto("SinSeccion") });
        const todos = valorDe(await c.consultas.listarProductos(e.operador, {}));
        expect(todos.productos.find((x) => x.id === sin)?.seccion).toBeNull();
        // Guardar solo el nombre nuevo, con la sección apagada y la alícuota «Exento» tal como estaban: se acepta (no obliga a tocarlas).
        const nuevoNombre = nombreAlAzarDeProducto("Renombrado");
        const editado = await c.casos.editarProducto(e.gerente, {
          productoId: p,
          versionEsperada: await version(p),
          nombre: nuevoNombre,
          alicuota: "EXENTO",
          seccionDeCartaId: seccionId,
        });
        expect(editado.ok).toBe(true);
        const ficha = valorDe(await c.consultas.verProducto(e.operador, { productoId: p }));
        expect(ficha?.producto).toMatchObject({
          nombre: nuevoNombre,
          alicuota: "EXENTO",
          seccionDeCartaId: seccionId,
        });
        expect(ficha?.seccion).toMatchObject({ id: seccionId, activa: false });
        // Pasar a una sección apagada que el producto NO tenía sí se rechaza.
        expect(
          await c.casos.editarProducto(e.gerente, {
            productoId: sin,
            versionEsperada: await version(sin),
            nombre: String((await producto(sin))?.["nombre"]),
            alicuota: "21",
            seccionDeCartaId: seccionId,
          }),
        ).toEqual({ ok: false, error: "SECCION_NO_ENCONTRADA" });
      });

      it("una sección de otra empresa no aparece en la ficha de un producto de esta (cada empresa ve solo la suya)", async () => {
        const b = await c.escenario();
        const p = await nuevoProducto();
        expect(valorDe(await c.consultas.verProducto(b.gerente, { productoId: p }))).toBeNull();
      });
    });

    describe("secciones de la carta", () => {
      it("secciones: repetir crearSeccionDeCarta con el mismo id deja una sección", async () => {
        const id = nuevoId();
        const pedido = { id, nombre: nombreAlAzarDeProducto("Entradas"), orden: 1 };
        expect(await c.casos.crearSeccionDeCarta(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { seccionId: id, yaExistia: false },
        });
        expect(await c.casos.crearSeccionDeCarta(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { seccionId: id, yaExistia: true },
        });
        expect(
          await c.contar("select count(*) as n from seccion_de_carta where id = $1", [id]),
        ).toBe(1);
        expect(await c.casos.crearSeccionDeCarta(e.gerente, { ...pedido, orden: 2 })).toEqual({
          ok: false,
          error: "ID_REUTILIZADO",
        });
        expect(await c.casos.crearSeccionDeCarta(e.gerente, { ...pedido, id: nuevoId() })).toEqual({
          ok: false,
          error: "SECCION_DUPLICADA",
        });
        expect(
          await c.casos.crearSeccionDeCarta(e.gerente, { id: nuevoId(), nombre: "", orden: 1 }),
        ).toEqual({ ok: false, error: "NOMBRE_DE_SECCION_INVALIDO" });
        expect(
          await c.casos.crearSeccionDeCarta(e.gerente, {
            id: nuevoId(),
            nombre: "Otra seccion",
            orden: -1,
          }),
        ).toEqual({ ok: false, error: "ORDEN_INVALIDO" });
      });

      it("secciones: repetir editarSeccionDeCarta ya aplicada devuelve lo vigente sin escribir", async () => {
        const id = nuevoId();
        valorDe(
          await c.casos.crearSeccionDeCarta(e.gerente, {
            id,
            nombre: nombreAlAzarDeProducto("Postres"),
            orden: 1,
          }),
        );
        const nombre = String(
          (await c.filas("select nombre from seccion_de_carta where id = $1", [id]))[0]?.["nombre"],
        );
        const pedido = { seccionId: id, versionEsperada: 1, nombre: `${nombre} dulces`, orden: 3 };
        expect(await c.casos.editarSeccionDeCarta(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { version: 2 },
        });
        const auditorias = await cambiosEn(id);
        expect(await c.casos.editarSeccionDeCarta(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { version: 2 },
        });
        expect(await cambiosEn(id)).toBe(auditorias);
        expect(await c.casos.editarSeccionDeCarta(e.gerente, { ...pedido, orden: 9 })).toEqual({
          ok: false,
          error: "VERSION_DESACTUALIZADA",
        });
        expect(
          await c.casos.editarSeccionDeCarta(e.gerente, { ...pedido, seccionId: nuevoId() }),
        ).toEqual({ ok: false, error: "SECCION_NO_ENCONTRADA" });
      });

      it("secciones: desactivar dos veces es ok y no audita la segunda; el producto elige una sección activa y desactivarla no lo toca", async () => {
        const id = nuevoId();
        valorDe(
          await c.casos.crearSeccionDeCarta(e.gerente, {
            id,
            nombre: nombreAlAzarDeProducto("Bebidas"),
            orden: 1,
          }),
        );
        const p = await nuevoProducto({ seccionDeCartaId: id });
        expect(await producto(p)).toMatchObject({ seccion_de_carta_id: id });
        expect(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId: id })).toEqual({
          ok: true,
          valor: { yaEstaba: false },
        });
        const auditorias = await cambiosEn(id);
        expect(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId: id })).toEqual({
          ok: true,
          valor: { yaEstaba: true },
        });
        expect(await cambiosEn(id)).toBe(auditorias);
        expect(await producto(p)).toMatchObject({ seccion_de_carta_id: id });
        // Una sección desactivada ya no se ofrece para productos nuevos.
        expect(
          await c.casos.crearProducto(e.gerente, {
            id: nuevoId(),
            claseDeUso: "VENDIBLE",
            nombre: nombreAlAzarDeProducto(),
            unidadBaseId: "UNIDAD",
            alicuota: "21",
            seccionDeCartaId: id,
          }),
        ).toEqual({ ok: false, error: "SECCION_NO_ENCONTRADA" });
        const activas = valorDe(await c.consultas.listarSeccionesDeCarta(e.gerente));
        expect(activas.some((s) => s.id === id)).toBe(false);
      });
    });

    describe("precio (I1, F2, F7)", () => {
      it("I1: doble clic en Guardar precio: el mismo precioId dos veces deja una fila; con otro precio, ID_REUTILIZADO", async () => {
        const p = await nuevoProducto();
        const precioId = nuevoId();
        const pedido = {
          precioId,
          productoId: p,
          opcionId: null,
          sucursalId: null,
          precioIdEsperado: null,
          precio: "3200",
        };
        const primero = valorDe(await c.casos.cambiarPrecio(e.gerente, pedido));
        expect(primero).toMatchObject({ precioId, yaExistia: false });
        expect(await c.casos.cambiarPrecio(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { precioId, vigenteDesde: null, yaExistia: true },
        });
        expect(
          await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [p]),
        ).toBe(1);
        expect(await c.casos.cambiarPrecio(e.gerente, { ...pedido, precio: "3300" })).toEqual({
          ok: false,
          error: "ID_REUTILIZADO",
        });
        expect(await c.auditoria(e.empresa, "PRECIO_CAMBIADO")).toEqual(
          expect.arrayContaining([expect.objectContaining({ entidad_id: precioId })]),
        );
        expect(
          (
            await c.filas(
              "select count(*)::int as n from auditoria_empresa where entidad_id = $1",
              [precioId],
            )
          )[0],
        ).toEqual({ n: 1 });
      });

      it("«Otra persona cambió el precio»: con la fila esperada vieja da PRECIO_DESACTUALIZADO con el precio vigente; dos precios iguales con distinto id son dos cambios", async () => {
        const p = await nuevoProducto();
        const a = nuevoId();
        valorDe(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: a,
            productoId: p,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "3200",
          }),
        );
        const b = nuevoId();
        expect(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: b,
            productoId: p,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "3500",
          }),
        ).toEqual({
          ok: false,
          error: {
            error: "PRECIO_DESACTUALIZADO",
            vigente: { precioId: a, precio: "3200.000000" },
          },
        });
        valorDe(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: b,
            productoId: p,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: a,
            precio: "3200",
          }),
        );
        expect(
          await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [p]),
        ).toBe(2);
      });

      it("F2: precio propio de una sucursal y «volver al de la empresa» sin borrar el historial", async () => {
        const p = await nuevoProducto();
        const emp = nuevoId();
        valorDe(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: emp,
            productoId: p,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "3200",
          }),
        );
        const suc = nuevoId();
        valorDe(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: suc,
            productoId: p,
            opcionId: null,
            sucursalId: e.sucursal,
            precioIdEsperado: null,
            precio: "3600",
          }),
        );
        const efectivo = async (sucursal: string | undefined) =>
          valorDe(
            await c.consultas.preciosDelProducto(
              CONTEXTO_CON_AHORA(e.gerente, "2026-10-12T00:00:00Z"),
              {
                productoId: p,
                ...(sucursal === undefined ? {} : { sucursalId: sucursal }),
              },
            ),
          );
        expect((await efectivo(e.sucursal))?.efectivos[0]).toMatchObject({
          origen: "SUCURSAL",
          precio: "3600.000000",
        });
        const volver = nuevoId();
        valorDe(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: volver,
            productoId: p,
            opcionId: null,
            sucursalId: e.sucursal,
            precioIdEsperado: suc,
            precio: null,
          }),
        );
        expect((await efectivo(e.sucursal))?.efectivos[0]).toMatchObject({
          origen: "EMPRESA",
          precio: "3200.000000",
        });
        expect(
          await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [p]),
        ).toBe(3);
        // Vacío sin sucursal no es un precio de la empresa válido (el precio abierto lo escribe cambiarFormaDeVenta).
        expect(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: nuevoId(),
            productoId: p,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: emp,
            precio: null,
          }),
        ).toEqual({ ok: false, error: "PRECIO_INVALIDO" });
        expect(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: nuevoId(),
            productoId: p,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: emp,
            precio: "1,5",
          }),
        ).toEqual({ ok: false, error: "PRECIO_INVALIDO" });
      });

      it("rechaza precio a lo no vendible, a lo desactivado, a una sucursal inexistente o de otra empresa y un precio propio si hay variante", async () => {
        const insumo = valorDe(
          await c.casos.crearProductoRapido(e.gerente, {
            id: nuevoId(),
            claseDeUso: "INSUMO",
            nombre: nombreAlAzarDeProducto("Sal"),
            unidadBaseId: "KILOGRAMO",
          }),
        ).productoId;
        const pedido = (productoId: string, extra: Record<string, unknown> = {}) => ({
          precioId: nuevoId(),
          productoId,
          opcionId: null,
          sucursalId: null,
          precioIdEsperado: null,
          precio: "10",
          ...extra,
        });
        expect(await c.casos.cambiarPrecio(e.gerente, pedido(insumo))).toEqual({
          ok: false,
          error: "PRODUCTO_NO_VENDIBLE",
        });
        expect(await c.casos.cambiarPrecio(e.gerente, pedido(nuevoId()))).toEqual({
          ok: false,
          error: "PRODUCTO_NO_ENCONTRADO",
        });
        const p = await nuevoProducto();
        expect(
          await c.casos.cambiarPrecio(e.gerente, pedido(p, { sucursalId: nuevoId() })),
        ).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
        const otra = await c.escenario();
        expect(
          await c.casos.cambiarPrecio(e.gerente, pedido(p, { sucursalId: otra.sucursal })),
        ).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
        await c.dueno.query(
          "update sucursal set activa = false where id = $1 and (select count(*) from sucursal where empresa_id = $2 and activa) > 1",
          [e.otraSucursal, e.empresa],
        );
        expect(
          await c.casos.cambiarPrecio(e.gerente, pedido(p, { sucursalId: e.otraSucursal })),
        ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
        await c.dueno.query("update sucursal set activa = true where id = $1", [e.otraSucursal]);
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [grupoDeTamano()],
          }),
        );
        expect(await c.casos.cambiarPrecio(e.gerente, pedido(p))).toEqual({
          ok: false,
          error: "PRECIO_DE_PRODUCTO_CON_VARIANTE",
        });
        valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: p }));
        expect(await c.casos.cambiarPrecio(e.gerente, pedido(p))).toEqual({
          ok: false,
          error: "PRODUCTO_INACTIVO",
        });
      });

      it("F7: recargo propio de una sucursal sobre un adicional: se carga, se quita y no se acepta sobre incluidos, ocultos ni sin sucursal", async () => {
        const p = await nuevoProducto();
        const grupo = grupoAdicional();
        const incluida: GrupoPedido = {
          ...grupoAdicional(),
          clase: "INCLUIDA",
          seMuestraEnCarta: false,
          opciones: [{ id: nuevoId(), nombre: "Sin sal", recargo: "0", orden: 1, activa: true }],
        };
        const oculta: GrupoPedido = {
          ...grupoAdicional(),
          seMuestraEnCarta: false,
          opciones: [{ id: nuevoId(), nombre: "Secreto", recargo: "0", orden: 1, activa: true }],
        };
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [grupo, incluida, oculta],
          }),
        );
        const opcion = grupo.opciones[0]?.id as string;
        const recargo = (opcionId: string, extra: Record<string, unknown>) =>
          c.casos.cambiarPrecio(e.gerente, {
            precioId: nuevoId(),
            productoId: p,
            opcionId,
            sucursalId: e.sucursal,
            precioIdEsperado: null,
            precio: "800",
            ...extra,
          });
        expect(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: nuevoId(),
            productoId: p,
            opcionId: opcion,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "700",
          }),
        ).toEqual({ ok: false, error: "RECARGO_DE_EMPRESA_SE_EDITA_EN_OPCIONES" });
        expect(await recargo(incluida.opciones[0]?.id as string, {})).toEqual({
          ok: false,
          error: "INCLUIDA_CON_RECARGO",
        });
        expect(await recargo(oculta.opciones[0]?.id as string, {})).toEqual({
          ok: false,
          error: "ELECCION_OCULTA_CON_PRECIO",
        });
        const primero = valorDe(await recargo(opcion, {}));
        expect(primero.yaExistia).toBe(false);
        expect(await recargo(opcion, { precioIdEsperado: null, precio: "900" })).toMatchObject({
          ok: false,
          error: { error: "PRECIO_DESACTUALIZADO" },
        });
        valorDe(await recargo(opcion, { precioIdEsperado: primero.precioId, precio: null }));
        expect(
          await c.contar("select count(*) as n from precio_de_venta where opcion_id = $1", [
            opcion,
          ]),
        ).toBe(2);
      });
    });

    describe("opciones (D4, D5, I3, I4)", () => {
      it("I3: reenviar editarOpciones después de un éxito es SIN_CAMBIOS: devuelve lo vigente y no inserta versiones", async () => {
        const p = await nuevoProducto();
        const grupos = [grupoDeTamano(), grupoAdicional()];
        expect(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos,
          }),
        ).toEqual({ ok: true, valor: { versionDeOpciones: 1, yaEstaba: false } });
        const [versiones, auditorias, v] = [
          await c.contar("select count(*) as n from version_de_opcion where empresa_id = $1", [
            e.empresa,
          ]),
          await cambiosEn(p),
          await version(p),
        ];
        // El reenvío con la versión vieja: no es un conflicto, es lo mismo que ya está.
        expect(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos,
          }),
        ).toEqual({ ok: true, valor: { versionDeOpciones: 1, yaEstaba: true } });
        expect(
          await c.contar("select count(*) as n from version_de_opcion where empresa_id = $1", [
            e.empresa,
          ]),
        ).toBe(versiones);
        expect(await cambiosEn(p)).toBe(auditorias);
        expect(await version(p)).toBe(v);
        expect(await versionDeOpciones(p)).toBe(1);
        // Otro conjunto con la versión vieja sí es un conflicto.
        expect(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [grupos[0] as GrupoPedido],
          }),
        ).toEqual({ ok: false, error: "OPCIONES_DESACTUALIZADAS" });
      });

      it("rechaza una segunda variante, grupos o nombres repetidos, recargo en incluidas u ocultas y un grupo sin opciones; no toca la base", async () => {
        const p = await nuevoProducto();
        const antes = await versionDeOpciones(p);
        const probar = async (grupos: GrupoPedido[]) => {
          const r = await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: antes,
            grupos,
          });
          return r.ok ? "ok" : r.error;
        };
        expect(await probar([grupoDeTamano(), grupoDeTamano()])).toBe("SEGUNDA_VARIANTE");
        expect(
          await probar([
            grupoAdicional({
              clase: "INCLUIDA",
              opciones: [{ id: nuevoId(), nombre: "X", recargo: "5", orden: 1, activa: true }],
            }),
          ]),
        ).toBe("INCLUIDA_CON_RECARGO");
        expect(await probar([grupoAdicional({ seMuestraEnCarta: false })])).toBe(
          "ELECCION_OCULTA_CON_PRECIO",
        );
        expect(await probar([grupoAdicional({ opciones: [] })])).toBe("GRUPO_SIN_OPCIONES");
        expect(
          await probar([
            grupoAdicional({ nombre: "Salsas" }),
            grupoAdicional({ nombre: "SALSAS" }),
          ]),
        ).toBe("GRUPO_DUPLICADO");
        expect(await probar([grupoAdicional({ nombre: "" })])).toBe("NOMBRE_DE_GRUPO_INVALIDO");
        expect(
          await probar([
            grupoAdicional({
              opciones: [{ id: nuevoId(), nombre: "Q", recargo: "x", orden: 1, activa: true }],
            }),
          ]),
        ).toBe("RECARGO_INVALIDO");
        expect(await versionDeOpciones(p)).toBe(antes);
        expect(
          await c.contar("select count(*) as n from grupo_de_elecciones where producto_id = $1", [
            p,
          ]),
        ).toBe(0);
      });

      it("quitar es desactivar (nada se borra), un recargo nuevo inserta una versión y el recargo de la empresa se cambia acá", async () => {
        const p = await nuevoProducto();
        const g = grupoAdicional();
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [g],
          }),
        );
        const o = g.opciones[0];
        const cambiado: GrupoPedido = {
          ...g,
          opciones: [{ ...(o as NonNullable<typeof o>), recargo: "750.50" }],
        };
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 1,
            grupos: [cambiado],
          }),
        );
        expect(
          await c.filas(
            "select numero, recargo::text from version_de_opcion where opcion_id = $1 order by numero",
            [o?.id],
          ),
        ).toEqual([
          { numero: 1, recargo: "600.000000" },
          { numero: 2, recargo: "750.500000" },
        ]);
        // El conjunto final vacío desactiva todo.
        expect(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 2,
            grupos: [],
          }),
        ).toEqual({ ok: true, valor: { versionDeOpciones: 3, yaEstaba: false } });
        expect(
          await c.filas("select activo from grupo_de_elecciones where producto_id = $1", [p]),
        ).toEqual([{ activo: false }]);
        expect(await c.filas("select activa from opcion where producto_id = $1", [p])).toEqual([
          { activa: true },
        ]);
        expect(
          await c.contar("select count(*) as n from version_de_opcion where opcion_id = $1", [
            o?.id,
          ]),
        ).toBe(2);
      });

      it("D4: consumo: insumo no admitido, el mismo producto, cantidad cero, insumo repetido, consumo en la variante y escala sin tamaño: cada uno con su error", async () => {
        const p = await nuevoProducto();
        const tam = grupoDeTamano();
        const g = grupoAdicional();
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [tam, g],
          }),
        );
        const harina = valorDe(
          await c.casos.crearProductoRapido(e.gerente, {
            id: nuevoId(),
            claseDeUso: "MATERIA_PRIMA",
            nombre: nombreAlAzarDeProducto("Harina"),
            unidadBaseId: "KILOGRAMO",
          }),
        ).productoId;
        const elaborado = valorDe(
          await c.casos.crearProductoRapido(e.gerente, {
            id: nuevoId(),
            claseDeUso: "ELABORADO",
            nombre: nombreAlAzarDeProducto("Salsa"),
            unidadBaseId: "KILOGRAMO",
          }),
        ).productoId;
        const opcion = g.opciones[0]?.id as string;
        const guardar = (
          lineas: Array<{ insumoId: string; cantidad: string; escalaConTamano: boolean }>,
          extra: Record<string, unknown> = {},
        ) =>
          c.casos.guardarConsumoDeGrupo(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 1,
            grupoId: g.id,
            opciones: [{ opcionId: opcion, lineas }],
            ...extra,
          });
        const linea = (insumoId: string, cantidad = "0.25", escalaConTamano = false) => ({
          insumoId,
          cantidad,
          escalaConTamano,
        });
        expect(await guardar([linea(elaborado)])).toEqual({
          ok: false,
          error: "INSUMO_NO_ADMITIDO",
        });
        expect(await guardar([linea(p)])).toEqual({
          ok: false,
          error: "INSUMO_ES_EL_MISMO_PRODUCTO",
        });
        expect(await guardar([linea(harina, "0")])).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
        expect(await guardar([linea(harina, "-1")])).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
        expect(await guardar([linea(harina, "0.00001")])).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
        expect(await guardar([linea(harina), linea(harina, "2")])).toEqual({
          ok: false,
          error: "CONSUMO_REPETIDO",
        });
        expect(await guardar([linea(nuevoId())])).toEqual({
          ok: false,
          error: "INSUMO_NO_ENCONTRADO",
        });
        expect(await guardar([linea(harina)], { grupoId: tam.id })).toEqual({
          ok: false,
          error: "GRUPO_DE_VARIANTE_SIN_CONSUMO",
        });
        expect(await guardar([linea(harina)], { grupoId: nuevoId() })).toEqual({
          ok: false,
          error: "GRUPO_NO_ENCONTRADO",
        });
        expect(
          await c.casos.guardarConsumoDeGrupo(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 1,
            grupoId: g.id,
            opciones: [{ opcionId: nuevoId(), lineas: [] }],
          }),
        ).toEqual({ ok: false, error: "OPCION_INVALIDA" });
        // Sin variante de tamaño, `escalaConTamano` no se admite.
        const sinTamano = await nuevoProducto();
        const g2 = grupoAdicional();
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: sinTamano,
            versionDeOpcionesEsperada: 0,
            grupos: [g2],
          }),
        );
        expect(
          await c.casos.guardarConsumoDeGrupo(e.gerente, {
            productoId: sinTamano,
            versionDeOpcionesEsperada: 1,
            grupoId: g2.id,
            opciones: [
              { opcionId: g2.opciones[0]?.id as string, lineas: [linea(harina, "1", true)] },
            ],
          }),
        ).toEqual({ ok: false, error: "ESCALA_SIN_TAMANO" });
        expect(
          await c.contar("select count(*) as n from consumo_de_opcion where empresa_id = $1", [
            e.empresa,
          ]),
        ).toBe(0);
      });

      it("I3: reenviar guardarConsumoDeGrupo después de un éxito es SIN_CAMBIOS y no inserta versiones", async () => {
        const p = await nuevoProducto();
        const g = grupoAdicional();
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [g],
          }),
        );
        const harina = valorDe(
          await c.casos.crearProductoRapido(e.gerente, {
            id: nuevoId(),
            claseDeUso: "MATERIA_PRIMA",
            nombre: nombreAlAzarDeProducto("Harina"),
            unidadBaseId: "KILOGRAMO",
          }),
        ).productoId;
        const pedido = {
          productoId: p,
          versionDeOpcionesEsperada: 1,
          grupoId: g.id,
          opciones: [
            {
              opcionId: g.opciones[0]?.id as string,
              lineas: [{ insumoId: harina, cantidad: "0.25", escalaConTamano: false }],
            },
          ],
        };
        expect(await c.casos.guardarConsumoDeGrupo(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { versionDeOpciones: 2, yaEstaba: false },
        });
        const versiones = await c.contar(
          "select count(*) as n from version_de_opcion where empresa_id = $1",
          [e.empresa],
        );
        expect(await c.casos.guardarConsumoDeGrupo(e.gerente, pedido)).toEqual({
          ok: true,
          valor: { versionDeOpciones: 2, yaEstaba: true },
        });
        expect(
          await c.contar("select count(*) as n from version_de_opcion where empresa_id = $1", [
            e.empresa,
          ]),
        ).toBe(versiones);
        expect(
          await c.casos.guardarConsumoDeGrupo(e.gerente, {
            ...pedido,
            opciones: [{ ...(pedido.opciones[0] as (typeof pedido.opciones)[0]), lineas: [] }],
          }),
        ).toEqual({ ok: false, error: "OPCIONES_DESACTUALIZADAS" });
      });

      it("D5: una versión nueva de la opción (cambia el recargo) conserva el consumo y el factor anteriores", async () => {
        const p = await nuevoProducto();
        const tam = grupoDeTamano();
        const g = grupoAdicional();
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [tam, g],
          }),
        );
        const harina = valorDe(
          await c.casos.crearProductoRapido(e.gerente, {
            id: nuevoId(),
            claseDeUso: "MATERIA_PRIMA",
            nombre: nombreAlAzarDeProducto("Harina"),
            unidadBaseId: "KILOGRAMO",
          }),
        ).productoId;
        const opcion = g.opciones[0] as NonNullable<(typeof g.opciones)[0]>;
        valorDe(
          await c.casos.guardarConsumoDeGrupo(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 1,
            grupoId: g.id,
            opciones: [
              {
                opcionId: opcion.id,
                lineas: [{ insumoId: harina, cantidad: "0.2500", escalaConTamano: true }],
              },
            ],
          }),
        );
        const grande = tam.opciones[1] as NonNullable<(typeof tam.opciones)[0]>;
        // Cambia el recargo del adicional y el nombre del tamaño grande (con su factor).
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 2,
            grupos: [
              {
                ...tam,
                opciones: [
                  tam.opciones[0] as NonNullable<typeof grande>,
                  { ...grande, nombre: "Grande XL" },
                ],
              },
              { ...g, opciones: [{ ...opcion, recargo: "900" }] },
            ],
          }),
        );
        const consumo = await c.filas(
          "select v.numero, c.insumo_id, c.cantidad::text, c.escala_con_tamano from version_de_opcion v join consumo_de_opcion c on c.version_de_opcion_id = v.id where v.opcion_id = $1 order by v.numero",
          [opcion.id],
        );
        expect(consumo).toEqual([
          { numero: 2, insumo_id: harina, cantidad: "0.2500", escala_con_tamano: true },
          { numero: 3, insumo_id: harina, cantidad: "0.2500", escala_con_tamano: true },
        ]);
        expect(
          await c.filas(
            "select numero, nombre, factor_de_tamano::text as factor from version_de_opcion where opcion_id = $1 order by numero",
            [grande.id],
          ),
        ).toEqual([
          { numero: 1, nombre: "Grande", factor: "1.5000" },
          { numero: 2, nombre: "Grande XL", factor: "1.5000" },
        ]);
      });

      it("I4: doble clic en Copiar (mismo copiaId) copia una vez y devuelve yaExistia", async () => {
        const origen = await nuevoProducto();
        const destino = await nuevoProducto();
        const tam = grupoDeTamano();
        const extras = grupoAdicional();
        valorDe(
          await c.casos.editarOpciones(e.gerente, {
            productoId: origen,
            versionDeOpcionesEsperada: 0,
            grupos: [tam, extras],
          }),
        );
        // Precios de la empresa de cada tamaño en el origen.
        for (const [i, o] of tam.opciones.entries()) {
          valorDe(
            await c.casos.cambiarPrecio(e.gerente, {
              precioId: nuevoId(),
              productoId: origen,
              opcionId: o.id,
              sucursalId: null,
              precioIdEsperado: null,
              precio: String(3000 + i * 1000),
            }),
          );
        }
        // Lo que consume una opción NO se copia.
        const harina = valorDe(
          await c.casos.crearProductoRapido(e.gerente, {
            id: nuevoId(),
            claseDeUso: "MATERIA_PRIMA",
            nombre: nombreAlAzarDeProducto("Cafe"),
            unidadBaseId: "KILOGRAMO",
          }),
        ).productoId;
        valorDe(
          await c.casos.guardarConsumoDeGrupo(e.gerente, {
            productoId: origen,
            versionDeOpcionesEsperada: 1,
            grupoId: extras.id,
            opciones: [
              {
                opcionId: extras.opciones[0]?.id as string,
                lineas: [{ insumoId: harina, cantidad: "1", escalaConTamano: false }],
              },
            ],
          }),
        );
        const copiaId = nuevoId();
        const pedido = {
          copiaId,
          productoOrigenId: origen,
          productoDestinoId: destino,
          versionDeOpcionesEsperada: 0,
        };
        expect(await c.casos.copiarOpciones(e.gerente, pedido)).toEqual({
          ok: true,
          valor: {
            copiaId,
            yaExistia: false,
            gruposCopiados: 2,
            opcionesCopiadas: 3,
            preciosCopiados: 2,
          },
        });
        const grupos = await c.contar(
          "select count(*) as n from grupo_de_elecciones where producto_id = $1",
          [destino],
        );
        expect(grupos).toBe(2);
        expect(await c.casos.copiarOpciones(e.gerente, pedido)).toEqual({
          ok: true,
          valor: {
            copiaId,
            yaExistia: true,
            gruposCopiados: 0,
            opcionesCopiadas: 0,
            preciosCopiados: 0,
          },
        });
        expect(
          await c.contar("select count(*) as n from grupo_de_elecciones where producto_id = $1", [
            destino,
          ]),
        ).toBe(grupos);
        expect(
          await c.contar("select count(*) as n from copia_de_opciones where id = $1", [copiaId]),
        ).toBe(1);
        expect(
          await c.casos.copiarOpciones(e.gerente, {
            ...pedido,
            productoDestinoId: await nuevoProducto(),
          }),
        ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
        // Es independiente: el destino tiene sus ids, sus precios de empresa de cada tamaño y NINGÚN consumo.
        expect(
          await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [
            destino,
          ]),
        ).toBe(2);
        expect(
          await c.contar(
            "select count(*) as n from consumo_de_opcion c join version_de_opcion v on v.id = c.version_de_opcion_id join opcion o on o.id = v.opcion_id where o.producto_id = $1",
            [destino],
          ),
        ).toBe(0);
        expect(await versionDeOpciones(destino)).toBe(1);
        // Sin nada que traer, y los casos de error.
        expect(
          await c.casos.copiarOpciones(e.gerente, {
            ...pedido,
            copiaId: nuevoId(),
            versionDeOpcionesEsperada: 1,
          }),
        ).toEqual({ ok: false, error: "NADA_PARA_COPIAR" });
        expect(
          await c.casos.copiarOpciones(e.gerente, {
            ...pedido,
            copiaId: nuevoId(),
            productoDestinoId: origen,
          }),
        ).toEqual({ ok: false, error: "COPIA_A_SI_MISMO" });
        expect(
          await c.casos.copiarOpciones(e.gerente, {
            ...pedido,
            copiaId: nuevoId(),
            productoOrigenId: nuevoId(),
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        const otro = await nuevoProducto();
        expect(
          await c.casos.copiarOpciones(e.gerente, {
            ...pedido,
            copiaId: nuevoId(),
            productoDestinoId: otro,
            versionDeOpcionesEsperada: 5,
          }),
        ).toEqual({ ok: false, error: "OPCIONES_DESACTUALIZADAS" });
        // Un destino que ya tiene precio de la empresa no recibe la variante ni sus precios, pero sí los adicionales.
        const conPrecio = await nuevoProducto();
        valorDe(
          await c.casos.cambiarPrecio(e.gerente, {
            precioId: nuevoId(),
            productoId: conPrecio,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "100",
          }),
        );
        expect(
          await c.casos.copiarOpciones(e.gerente, {
            copiaId: nuevoId(),
            productoOrigenId: origen,
            productoDestinoId: conPrecio,
            versionDeOpcionesEsperada: 0,
          }),
        ).toEqual({
          ok: true,
          valor: expect.objectContaining({
            gruposCopiados: 1,
            opcionesCopiadas: 1,
            preciosCopiados: 0,
          }) as unknown,
        });
      });
    });

    describe("permisos y alcance (A4, A5) y módulo en desarrollo", () => {
      it("A4: el operador ve pero no crea, edita ni cambia precios; el administrador sí crea y edita", async () => {
        const p = await nuevoProducto();
        const nombre = String((await producto(p))?.["nombre"]);
        const antes = await c.contar("select count(*) as n from producto where empresa_id = $1", [
          e.empresa,
        ]);
        expect(
          await c.casos.crearProducto(e.operador, {
            id: nuevoId(),
            claseDeUso: "VENDIBLE",
            nombre: "Nuevo",
            unidadBaseId: "UNIDAD",
            alicuota: "21",
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(
          await c.casos.editarProducto(e.operador, {
            productoId: p,
            versionEsperada: 1,
            nombre,
            alicuota: "10.5",
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(
          await c.casos.cambiarPrecio(e.operador, {
            precioId: nuevoId(),
            productoId: p,
            opcionId: null,
            sucursalId: e.sucursal,
            precioIdEsperado: null,
            precio: "5",
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(
          await c.casos.editarOpciones(e.operador, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [],
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(await c.casos.desactivarProducto(e.operador, { productoId: p })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(
          await c.contar("select count(*) as n from producto where empresa_id = $1", [e.empresa]),
        ).toBe(antes);
        const lista = valorDe(await c.consultas.listarProductos(e.operador, {}));
        expect(lista.productos.some((x) => x.id === p)).toBe(true);
        expect(
          valorDe(await c.consultas.verProducto(e.operador, { productoId: p }))?.producto.id,
        ).toBe(p);
        const creado = await c.casos.crearProducto(e.administrador, {
          id: nuevoId(),
          claseDeUso: "VENDIBLE",
          nombre: nombreAlAzarDeProducto(),
          unidadBaseId: "UNIDAD",
          alicuota: "21",
        });
        expect(creado.ok).toBe(true);
        // Sin sesión de persona (sistema) nadie autoriza nada.
        expect(
          await c.casos.crearProducto(
            { ...e.gerente, personaId: null },
            {
              id: nuevoId(),
              claseDeUso: "VENDIBLE",
              nombre: "X",
              unidadBaseId: "UNIDAD",
              alicuota: "21",
            },
          ),
        ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      });

      it("A5: un administrador con alcance de una sola sucursal no cambia el precio de la empresa ni de otra sucursal, y sí el de la suya; y no edita lo que afecta a toda la empresa", async () => {
        const p = await nuevoProducto();
        const pedido = (extra: Record<string, unknown>) => ({
          precioId: nuevoId(),
          productoId: p,
          opcionId: null,
          sucursalId: null,
          precioIdEsperado: null,
          precio: "100",
          ...extra,
        });
        expect(await c.casos.cambiarPrecio(e.administradorDeUnaSucursal, pedido({}))).toEqual({
          ok: false,
          error: "SUCURSAL_FUERA_DE_ALCANCE",
        });
        expect(
          await c.casos.cambiarPrecio(
            e.administradorDeUnaSucursal,
            pedido({ sucursalId: e.otraSucursal }),
          ),
        ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
        expect(
          (
            await c.casos.cambiarPrecio(
              e.administradorDeUnaSucursal,
              pedido({ sucursalId: e.sucursal }),
            )
          ).ok,
        ).toBe(true);
        const nombre = String((await producto(p))?.["nombre"]);
        expect(
          await c.casos.editarProducto(e.administradorDeUnaSucursal, {
            productoId: p,
            versionEsperada: 1,
            nombre,
            alicuota: "10.5",
          }),
        ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
        expect(
          await c.casos.editarOpciones(e.administradorDeUnaSucursal, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [],
          }),
        ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
        // El administrador con alcance TODAS sí cambia el precio de la empresa.
        expect((await c.casos.cambiarPrecio(e.administrador, pedido({}))).ok).toBe(true);
      });

      it("todo nace cerrado: con el catálogo real (`en_desarrollo`) ningún rol hace nada, ni siquiera mirar", async () => {
        const cerrado = await montarCatalogo(base as NonNullable<typeof base>, {
          reglas: REGLAS_DE_EMPRESA,
          conexiones: 4,
        });
        try {
          const x = await cerrado.escenario();
          for (const contexto of [x.gerente, x.administrador, x.operador]) {
            expect(
              await cerrado.casos.crearProducto(contexto, {
                id: nuevoId(),
                claseDeUso: "VENDIBLE",
                nombre: "Nada",
                unidadBaseId: "UNIDAD",
                alicuota: "21",
              }),
            ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
            expect(await cerrado.consultas.listarProductos(contexto, {})).toEqual({
              ok: false,
              error: "MODULO_EN_DESARROLLO",
            });
          }
          expect(
            await cerrado.contar("select count(*) as n from producto where empresa_id = $1", [
              x.empresa,
            ]),
          ).toBe(0);
        } finally {
          await cerrado.cerrar();
        }
      });

      it("un contexto sin permisos de la empresa (otra empresa) no puede nada sobre este catálogo", async () => {
        const otra = await c.escenario();
        const p = await nuevoProducto();
        const nombre = String((await producto(p))?.["nombre"]);
        expect(
          await c.casos.editarProducto(otra.gerente, {
            productoId: p,
            versionEsperada: 1,
            nombre,
            alicuota: "10.5",
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      });
    });

    describe("A1: aislamiento entre empresas", () => {
      it("la empresa B busca, ficha, edita, desactiva, cambia el precio, edita opciones y copia un producto de la empresa A (por id): mismo error que si no existiera; nada de A en ninguna lista", async () => {
        const a = e;
        const b = await c.escenario();
        const p = await nuevoProducto({ nombre: "Exclusivo de A" });
        const propio = valorDe(
          await c.casos.crearProducto(b.gerente, {
            id: nuevoId(),
            claseDeUso: "VENDIBLE",
            nombre: nombreAlAzarDeProducto("De B"),
            unidadBaseId: "UNIDAD",
            alicuota: "21",
          }),
        ).productoId;
        expect(valorDe(await c.consultas.verProducto(b.gerente, { productoId: p }))).toBeNull();
        expect(
          valorDe(await c.consultas.preciosDelProducto(b.gerente, { productoId: p })),
        ).toBeNull();
        expect(
          await c.casos.editarProducto(b.gerente, {
            productoId: p,
            versionEsperada: 1,
            nombre: "Hackeado",
            alicuota: "21",
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        expect(await c.casos.desactivarProducto(b.gerente, { productoId: p })).toEqual({
          ok: false,
          error: "PRODUCTO_NO_ENCONTRADO",
        });
        expect(
          await c.casos.cambiarPrecio(b.gerente, {
            precioId: nuevoId(),
            productoId: p,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "1",
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        expect(
          await c.casos.editarOpciones(b.gerente, {
            productoId: p,
            versionDeOpcionesEsperada: 0,
            grupos: [],
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        expect(
          await c.casos.copiarOpciones(b.gerente, {
            copiaId: nuevoId(),
            productoOrigenId: p,
            productoDestinoId: propio,
            versionDeOpcionesEsperada: 0,
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        expect(
          await c.casos.copiarOpciones(b.gerente, {
            copiaId: nuevoId(),
            productoOrigenId: propio,
            productoDestinoId: p,
            versionDeOpcionesEsperada: 0,
          }),
        ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
        const lista = valorDe(await c.consultas.listarProductos(b.gerente, {}));
        expect(lista.productos.map((x) => x.id)).toEqual([propio]);
        expect(
          valorDe(await c.consultas.productosParaCopiar(b.gerente, { productoDestinoId: p })),
        ).toEqual([]);
        expect(await producto(p)).toMatchObject({
          nombre: "Exclusivo de A",
          activo: true,
          version: 1,
          empresa_id: a.empresa,
        });
      });
    });

    describe("consultas", () => {
      it("listarProductos filtra, pagina de a 50 por nombre y dice el estado y el precio («Según tamaño», «Sin precio»); verProducto trae grupos, consumo y precios", async () => {
        const x = await c.escenario();
        const crear = async (nombre: string, extra: Record<string, unknown> = {}) =>
          valorDe(
            await c.casos.crearProducto(x.gerente, {
              id: nuevoId(),
              claseDeUso: "VENDIBLE",
              nombre,
              unidadBaseId: "UNIDAD",
              alicuota: "21",
              ...extra,
            }),
          ).productoId;
        const conPrecio = await crear("Alfajor");
        valorDe(
          await c.casos.cambiarPrecio(x.gerente, {
            precioId: nuevoId(),
            productoId: conPrecio,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "1500",
          }),
        );
        const sinPrecio = await crear("Bizcocho");
        const conTamanos = await crear("Cafe");
        valorDe(
          await c.casos.editarOpciones(x.gerente, {
            productoId: conTamanos,
            versionDeOpcionesEsperada: 0,
            grupos: [grupoDeTamano()],
          }),
        );
        valorDe(
          await c.casos.crearProductoRapido(x.gerente, {
            id: nuevoId(),
            claseDeUso: "INSUMO",
            nombre: "Dulce",
            unidadBaseId: "KILOGRAMO",
          }),
        );
        const apagado = await crear("Empanada");
        valorDe(await c.casos.desactivarProducto(x.gerente, { productoId: apagado }));
        const lista = valorDe(await c.consultas.listarProductos(x.gerente, {}));
        expect(lista.productos.map((p) => [p.nombre, p.estado, p.precio])).toEqual([
          ["Alfajor", "ACTIVO", { tipo: "EMPRESA", precio: "1500.000000" }],
          ["Bizcocho", "ACTIVO", { tipo: "SIN_PRECIO" }],
          ["Cafe", "ACTIVO", { tipo: "SEGUN_TAMANO" }],
          ["Dulce", "FALTA_COMPLETAR", null],
          ["Empanada", "DESACTIVADO", { tipo: "SIN_PRECIO" }],
        ]);
        expect(lista.siguiente).toBeNull();
        expect(sinPrecio).toBeTruthy();
        expect(
          valorDe(await c.consultas.listarProductos(x.gerente, { texto: "ca" })).productos.map(
            (p) => p.nombre,
          ),
        ).toEqual(["Cafe"]);
        expect(
          valorDe(
            await c.consultas.listarProductos(x.gerente, { claseDeUso: "INSUMO" }),
          ).productos.map((p) => p.nombre),
        ).toEqual(["Dulce"]);
        expect(
          valorDe(await c.consultas.listarProductos(x.gerente, { activo: false })).productos.map(
            (p) => p.nombre,
          ),
        ).toEqual(["Empanada"]);
        // Paginación por (nombre, id).
        for (let i = 0; i < 52; i += 1)
          await crear(
            `Pan ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) | 0))}`,
          );
        const primera = valorDe(await c.consultas.listarProductos(x.gerente, { texto: "pan" }));
        expect(primera.productos).toHaveLength(50);
        const segunda = valorDe(
          await c.consultas.listarProductos(x.gerente, {
            texto: "pan",
            despuesDe: primera.siguiente as NonNullable<typeof primera.siguiente>,
          }),
        );
        expect(segunda.productos).toHaveLength(2);
        expect(segunda.siguiente).toBeNull();
        const ficha = valorDe(await c.consultas.verProducto(x.gerente, { productoId: conTamanos }));
        expect(ficha?.grupos).toHaveLength(1);
        expect(ficha?.grupos[0]?.opciones.map((o) => o.nombre)).toEqual(["Chico", "Grande"]);
        expect(
          valorDe(await c.consultas.verProducto(x.gerente, { productoId: "no-es-uuid" })),
        ).toBeNull();
        expect(
          valorDe(await c.consultas.productosParaConsumo(x.gerente, { texto: "du" })).map(
            (p) => p.nombre,
          ),
        ).toEqual(["Dulce"]);
      });
    });

    it("CONTEXTO_CON_AHORA no cambia al contexto original", () => {
      const antes = e.gerente.ahora.getTime();
      expect(CONTEXTO_CON_AHORA(e.gerente, "2030-01-01T00:00:00Z").ahora.getTime()).not.toBe(antes);
      expect(e.gerente.ahora.getTime()).toBe(antes);
    });
  },
);
