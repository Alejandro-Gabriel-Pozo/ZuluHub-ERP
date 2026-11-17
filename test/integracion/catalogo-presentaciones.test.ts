import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS } from "./clientes-apoyo";
import {
  montarCatalogo,
  nuevoId,
  productoDeBase,
  valorDe,
  type ClaseDeUsoDePrueba,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * E9 (§3.2, X5): las presentaciones de un producto («caja de 12», «pieza ≈ 4 kg») son un dato del catálogo. Casos de uso contra la base real: permisos
 * por rol (gerente y administrador editan, como el resto del catálogo), idempotencia, concurrencia (dos altas iguales a la vez dejan una) y aislamiento
 * entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("catálogo: presentaciones de un producto", () => {
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

  const auditorias = async (accion: string) => (await c.auditoria(e.empresa, accion)).length;
  const nuevoProducto = (
    empresa: string,
    datos: Readonly<{ clase?: ClaseDeUsoDePrueba; unidadBase?: string; dimension?: string }> = {},
  ) =>
    productoDeBase(c.dueno, empresa, {
      clase: datos.clase ?? "MATERIA_PRIMA",
      ...(datos.unidadBase === undefined ? {} : { unidadBase: datos.unidadBase }),
      ...(datos.dimension === undefined ? {} : { dimension: datos.dimension }),
    });

  describe("presentaciones", () => {
    it("el gerente crea una presentación de peso variable y otra de cantidad fija; queda auditado", async () => {
      const producto = await nuevoProducto(e.empresa, { unidadBase: "GRAMO", dimension: "MASA" });
      const caja = valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Caja x 12",
          cantidad: "12000",
          dePesoVariable: false,
        }),
      );
      expect(caja.yaExistia).toBe(false);
      expect(caja.presentacion).toMatchObject({
        nombre: "Caja x 12",
        cantidad: "12000.0000",
        dePesoVariable: false,
        activa: true,
      });
      const pieza = valorDe(
        await c.casos.crearPresentacion(e.administrador, {
          productoId: producto,
          nombre: "Pieza",
          cantidad: "4000",
          dePesoVariable: true,
        }),
      );
      expect(pieza.presentacion.dePesoVariable).toBe(true);
      expect((await c.auditoria(e.empresa, "PRESENTACION_CREADA")).at(-1)).toMatchObject({
        actor_persona_id: e.administrador.personaId,
        entidad_id: pieza.presentacion.id,
      });
    });

    it("I8: crear dos veces la misma presentación devuelve la existente; con otra cantidad, PRESENTACION_REPETIDA", async () => {
      const producto = await nuevoProducto(e.empresa);
      const entrada = {
        productoId: producto,
        nombre: "Bolsa",
        cantidad: "25",
        dePesoVariable: false,
      };
      const primera = valorDe(await c.casos.crearPresentacion(e.gerente, entrada));
      const antes = await auditorias("PRESENTACION_CREADA");
      const segunda = valorDe(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, nombre: "BOLSA" }),
      );
      expect(segunda).toEqual({ presentacion: primera.presentacion, yaExistia: true });
      expect(await auditorias("PRESENTACION_CREADA")).toBe(antes);
      expect(await c.casos.crearPresentacion(e.gerente, { ...entrada, cantidad: "50" })).toEqual({
        ok: false,
        error: "PRESENTACION_REPETIDA",
      });
      expect(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, dePesoVariable: true }),
      ).toEqual({
        ok: false,
        error: "PRESENTACION_REPETIDA",
      });
    });

    it("rechaza un producto que no se compra, inexistente, de otra empresa o con datos inválidos; el operador no edita el catálogo", async () => {
      const vendible = await nuevoProducto(e.empresa, { clase: "VENDIBLE" });
      const entrada = {
        productoId: vendible,
        nombre: "Caja",
        cantidad: "1",
        dePesoVariable: false,
      };
      expect(await c.casos.crearPresentacion(e.gerente, entrada)).toEqual({
        ok: false,
        error: "PRODUCTO_NO_COMPRABLE",
      });
      expect(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, productoId: nuevoId() }),
      ).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      const otra = await c.escenario();
      const deOtra = await nuevoProducto(otra.empresa);
      expect(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, productoId: deOtra }),
      ).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      const comprable = await nuevoProducto(e.empresa);
      expect(
        await c.casos.crearPresentacion(e.gerente, {
          ...entrada,
          productoId: comprable,
          nombre: "",
        }),
      ).toEqual({
        ok: false,
        error: "NOMBRE_INVALIDO",
      });
      expect(
        await c.casos.crearPresentacion(e.gerente, {
          ...entrada,
          productoId: comprable,
          cantidad: "0",
        }),
      ).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
      expect(
        await c.casos.crearPresentacion(e.operador, { ...entrada, productoId: comprable }),
      ).toMatchObject({
        ok: false,
        error: "SIN_PERMISO",
      });
    });

    it("I8: editar una presentación con lo que ya tiene devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const producto = await nuevoProducto(e.empresa);
      const creada = valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Pack",
          cantidad: "6",
          dePesoVariable: false,
        }),
      ).presentacion;
      const editada = valorDe(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: creada.id,
          nombre: "Pack grande",
          activa: true,
          versionEsperada: creada.version,
        }),
      );
      expect(editada).toMatchObject({
        nombre: "Pack grande",
        cantidad: "6.0000",
        version: creada.version + 1,
      });
      const antes = await auditorias("PRESENTACION_EDITADA");
      const repetida = valorDe(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: creada.id,
          nombre: "Pack grande",
          activa: true,
          versionEsperada: creada.version,
        }),
      );
      expect(repetida).toEqual(editada);
      expect(await auditorias("PRESENTACION_EDITADA")).toBe(antes);
      expect(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: creada.id,
          nombre: "Otro",
          activa: true,
          versionEsperada: creada.version,
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    });

    it("renombrar a un nombre de otra presentación del mismo producto es PRESENTACION_REPETIDA; apagar y reactivar funciona", async () => {
      const producto = await nuevoProducto(e.empresa);
      const a = valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Uno",
          cantidad: "1",
          dePesoVariable: false,
        }),
      ).presentacion;
      valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Dos",
          cantidad: "2",
          dePesoVariable: false,
        }),
      );
      expect(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: a.id,
          nombre: "dos",
          activa: true,
          versionEsperada: a.version,
        }),
      ).toEqual({ ok: false, error: "PRESENTACION_REPETIDA" });
      const apagada = valorDe(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: a.id,
          nombre: "Uno",
          activa: false,
          versionEsperada: a.version,
        }),
      );
      expect(apagada.activa).toBe(false);
      expect(
        valorDe(
          await c.casos.editarPresentacion(e.administrador, {
            presentacionId: a.id,
            nombre: "Uno",
            activa: true,
            versionEsperada: apagada.version,
          }),
        ).activa,
      ).toBe(true);
      expect(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: nuevoId(),
          nombre: "X",
          activa: true,
          versionEsperada: 1,
        }),
      ).toEqual({
        ok: false,
        error: "PRESENTACION_NO_ENCONTRADA",
      });
    });

    it("dos altas iguales a la vez dejan una presentación (la otra devuelve la existente)", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const producto = await nuevoProducto(e.empresa);
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all([
            c.casos.crearPresentacion(e.gerente, {
              productoId: producto,
              nombre: "Doble",
              cantidad: "3",
              dePesoVariable: false,
            }),
            c.casos.crearPresentacion(e.administrador, {
              productoId: producto,
              nombre: "Doble",
              cantidad: "3",
              dePesoVariable: false,
            }),
          ]);
          expect(resultados.every((r) => r.ok || codigoDe(r) === "ConcurrenciaAgotada")).toBe(true);
          expect(resultados.some((r) => r.ok)).toBe(true);
        } finally {
          c.soltarBarrera();
        }
        expect(
          await c.contar(
            "select count(*) as n from presentacion_de_producto where producto_id = $1",
            [producto],
          ),
        ).toBe(1);
      }
    });
  });

  // =============================================================================================
});
