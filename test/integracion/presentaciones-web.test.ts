import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  cambiarElEstadoDeLaPresentacion,
  crearLaPresentacion,
  renombrarLaPresentacion,
  verLaPresentacion,
  verLasPresentaciones,
  type DependenciasDePresentacionesWeb,
} from "../../src/composicion/presentaciones-web";
import {
  montarCatalogo,
  nuevoId,
  productoDeBase,
  type ClaseDeUsoDePrueba,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * La solapa «Cómo se compra» de la web (`presentaciones-web.ts`, T0) contra una base real y los roles reales: lo que la pantalla recibe (todas las presentaciones, también las apagadas, y nada más),
 * qué se escribe y qué se audita, que una empresa no ve ni toca las presentaciones de otra, que el permiso y el módulo en desarrollo los deciden la consulta y el caso de uso, agregar dos veces lo mismo
 * (una sola presentación, también a la vez), dos cambios a la vez con la misma versión (uno gana, el otro recibe el genérico y no escribe) y que desactivar y reactivar repetidos no escriben ni
 * auditan de nuevo. Los casos de uso en sí tienen sus pruebas en `catalogo-presentaciones.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 5;

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("presentaciones de compra de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let registrados: string[];
  let d: DependenciasDePresentacionesWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    // El catálogo real con `catalogo` forzado a `en_desarrollo` (en el real es disponible, DEC-0463): el guard rechaza todo.
    cerrado = await montarCatalogo(base, {
      reglas: {
        catalogo: {
          ...CATALOGO_DE_MODULOS,
          catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "en_desarrollo" },
        },
        permisos: PERMISOS_DE_EMPRESA,
      },
    });
    e = await c.escenario();
    registrados = [];
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await cerrado.cerrar();
  });

  const producto = (
    x: EscenarioDeCatalogo = e,
    datos: Readonly<{ clase?: ClaseDeUsoDePrueba; unidadBase?: string; dimension?: string }> = {},
  ) =>
    productoDeBase(c.dueno, x.empresa, {
      clase: datos.clase ?? "MATERIA_PRIMA",
      unidadBase: datos.unidadBase ?? "KILOGRAMO",
      dimension: datos.dimension ?? "MASA",
    });
  const codigoDe = (r: { ok: true } | { ok: false; error: { codigo: string } }) =>
    r.ok ? "OK" : r.error.codigo;
  const agregar = (
    productoId: string,
    nombre: string,
    cantidad = "5",
    pesoVariable = false,
    x: EscenarioDeCatalogo = e,
  ) => crearLaPresentacion(d, x.gerente, { productoId, nombre, cantidad, pesoVariable });
  const nueva = async (
    productoId: string,
    nombre: string,
    cantidad = "5",
    pesoVariable = false,
  ): Promise<string> => {
    const r = await agregar(productoId, nombre, cantidad, pesoVariable);
    if (!r.ok) throw new Error(`se esperaba la presentación y vino ${r.error.codigo}`);
    return r.dato.presentacionId;
  };
  const fila = (id: string) =>
    c.filas("select * from presentacion_de_producto where id = $1", [id]).then((f) => f[0]);
  const auditorias = (id: string, accion: string) =>
    c.contar("select count(*) as n from auditoria_empresa where entidad_id = $1 and accion = $2", [
      id,
      accion,
    ]);
  const lista = async (productoId: string, contexto = e.gerente) => {
    const r = await verLasPresentaciones(d, contexto, productoId);
    if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
    return r.dato;
  };
  const version = async (id: string) => (await fila(id))?.["version"] as number;

  it("la lista trae todas las presentaciones, también las apagadas, por nombre, con la unidad base y nada más", async () => {
    const p = await producto();
    const caja = await nueva(p, "Caja de 5 kg", "5");
    await nueva(p, "Bolsa", "25");
    const horma = await nueva(p, "Horma", "4", true);
    const v = await version(caja);
    expect(
      codigoDe(
        await cambiarElEstadoDeLaPresentacion(
          d,
          e.gerente,
          {
            productoId: p,
            presentacionId: caja,
            versionEsperada: v,
          },
          false,
        ),
      ),
    ).toBe("OK");
    const vista = await lista(p);
    expect(vista.producto).toEqual({
      id: p,
      nombre: expect.any(String) as string,
      unidadBase: "kg",
      activo: true,
    });
    expect(vista.presentaciones.map((x) => x.nombre)).toEqual(["Bolsa", "Caja de 5 kg", "Horma"]);
    expect(vista.presentaciones.map((x) => x.activa)).toEqual([true, false, true]);
    expect(vista.presentaciones.find((x) => x.id === horma)).toEqual({
      id: horma,
      nombre: "Horma",
      cantidad: "4.0000",
      dePesoVariable: true,
      activa: true,
      version: expect.any(Number) as number,
    });
    for (const x of vista.presentaciones) {
      expect(Object.keys(x).sort()).toEqual([
        "activa",
        "cantidad",
        "dePesoVariable",
        "id",
        "nombre",
        "version",
      ]);
    }
  });

  it("un producto de otra empresa, inexistente, mal escrito o que no se compra es el mismo genérico", async () => {
    const otra = await c.escenario();
    const deOtra = await producto(otra);
    const vendible = await producto(e, {
      clase: "VENDIBLE",
      unidadBase: "UNIDAD",
      dimension: "CONTEO",
    });
    for (const id of [deOtra, nuevoId(), "no-es-un-id", vendible]) {
      const r = await verLasPresentaciones(d, e.gerente, id);
      expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    }
    expect(await agregar(deOtra, "Caja")).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(
      await c.contar("select count(*) as n from presentacion_de_producto where producto_id = $1", [
        deOtra,
      ]),
    ).toBe(0);
  });

  it("quien mira ve; quien opera no cambia: el operador recibe SIN_PERMISO y el administrador de una sola sucursal, el genérico", async () => {
    const p = await producto();
    const a = await nueva(p, "Caja");
    const antes = await fila(a);
    const v = await version(a);
    expect((await lista(p, e.operador)).presentaciones.map((x) => x.id)).toEqual([a]);
    expect(
      await crearLaPresentacion(d, e.operador, {
        productoId: p,
        nombre: "Otra",
        cantidad: "1",
        pesoVariable: false,
      }),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(
      await renombrarLaPresentacion(d, e.operador, {
        productoId: p,
        presentacionId: a,
        versionEsperada: v,
        nombre: "Renombrada",
      }),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(
      await cambiarElEstadoDeLaPresentacion(
        d,
        e.operador,
        { productoId: p, presentacionId: a, versionEsperada: v },
        false,
      ),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(
      await cambiarElEstadoDeLaPresentacion(
        d,
        e.administradorDeUnaSucursal,
        { productoId: p, presentacionId: a, versionEsperada: v },
        false,
      ),
    ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await fila(a)).toEqual(antes);
    expect(
      codigoDe(
        await cambiarElEstadoDeLaPresentacion(
          d,
          e.administrador,
          { productoId: p, presentacionId: a, versionEsperada: v },
          false,
        ),
      ),
    ).toBe("OK");
  });

  it("con el catálogo en desarrollo (forzado) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const dependencias: DependenciasDePresentacionesWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const resultados = [
        await verLasPresentaciones(dependencias, contexto, nuevoId()),
        await verLaPresentacion(dependencias, contexto, nuevoId(), nuevoId()),
        await crearLaPresentacion(dependencias, contexto, {
          productoId: nuevoId(),
          nombre: "Cerrada",
          cantidad: "1",
          pesoVariable: false,
        }),
        await cambiarElEstadoDeLaPresentacion(
          dependencias,
          contexto,
          { productoId: nuevoId(), presentacionId: nuevoId(), versionEsperada: 1 },
          false,
        ),
      ];
      for (const r of resultados) {
        expect(r).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      }
    }
  });

  it("agregar escribe y audita; la cantidad inválida sale con su texto y su campo; un nombre vacío o repetido con otra cantidad es el genérico", async () => {
    const p = await producto();
    const r = await agregar(p, "  Bolsa   de 10 kg ", "10");
    if (!r.ok) throw new Error(r.error.codigo);
    expect(r.dato.yaExistia).toBe(false);
    expect(await fila(r.dato.presentacionId)).toMatchObject({
      producto_id: p,
      nombre: "Bolsa de 10 kg",
      cantidad: "10.0000",
      de_peso_variable: false,
      activa: true,
    });
    expect(await auditorias(r.dato.presentacionId, "PRESENTACION_CREADA")).toBe(1);
    expect(await agregar(p, "Cero", "0")).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_CANTIDAD_INVALIDA", campo: "cantidad" },
    });
    expect(await agregar(p, "Cinco decimales", "1.12345")).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_CANTIDAD_INVALIDA" },
    });
    expect(await agregar(p, "   ", "1")).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await agregar(p, "bolsa de 10 KG", "20")).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect((await lista(p)).presentaciones).toHaveLength(1);
  });

  it("el pedido con una forma que no es la pedida es el genérico y no escribe", async () => {
    const p = await producto();
    for (const crudo of [
      { productoId: "x", nombre: "A", cantidad: "1", pesoVariable: false },
      { productoId: p, nombre: "A", cantidad: "1", pesoVariable: "on" },
      { productoId: p, nombre: 7, cantidad: "1", pesoVariable: false },
      { productoId: p, nombre: "A", pesoVariable: false },
    ]) {
      expect(await crearLaPresentacion(d, e.gerente, crudo)).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
    }
    expect((await lista(p)).presentaciones).toHaveLength(0);
  });

  it("agregar dos veces lo mismo deja una sola presentación y una sola auditoría; la segunda dice que ya existía", async () => {
    const p = await producto();
    const a = await agregar(p, "Pack", "6");
    const b = await agregar(p, "pack", "6");
    if (!a.ok || !b.ok) throw new Error("se esperaban dos éxitos");
    expect(b.dato.presentacionId).toBe(a.dato.presentacionId);
    expect([a.dato.yaExistia, b.dato.yaExistia]).toEqual([false, true]);
    expect((await lista(p)).presentaciones).toHaveLength(1);
    expect(await auditorias(a.dato.presentacionId, "PRESENTACION_CREADA")).toBe(1);
  });

  it("dos altas A LA VEZ de lo mismo dan una sola presentación", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const p = await producto();
      const r = await Promise.all([agregar(p, "Doble", "3"), agregar(p, "Doble", "3")]);
      expect(r.map(codigoDe)).toEqual(["OK", "OK"]);
      expect((await lista(p)).presentaciones).toHaveLength(1);
      expect(
        await c.contar(
          "select count(*) as n from auditoria_empresa where accion = 'PRESENTACION_CREADA' and entidad_id = $1",
          [(await lista(p)).presentaciones[0]?.id],
        ),
      ).toBe(1);
    }
  });

  it("renombrar con la versión que se vio sube la versión y audita; lo mismo otra vez no escribe; con una versión vieja es el genérico", async () => {
    const p = await producto();
    const a = await nueva(p, "Pack", "6", true);
    const v = await version(a);
    const pedido = { productoId: p, presentacionId: a, versionEsperada: v, nombre: "Pack grande" };
    expect(codigoDe(await renombrarLaPresentacion(d, e.gerente, pedido))).toBe("OK");
    // Conserva la cantidad, el peso variable y el estado.
    expect(await fila(a)).toMatchObject({
      nombre: "Pack grande",
      cantidad: "6.0000",
      de_peso_variable: true,
      activa: true,
      version: v + 1,
    });
    expect(await auditorias(a, "PRESENTACION_EDITADA")).toBe(1);
    expect(codigoDe(await renombrarLaPresentacion(d, e.gerente, pedido))).toBe("OK");
    expect(await auditorias(a, "PRESENTACION_EDITADA")).toBe(1);
    expect(await version(a)).toBe(v + 1);
    expect(
      await renombrarLaPresentacion(d, e.gerente, { ...pedido, nombre: "Otro nombre" }),
    ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect((await fila(a))?.["nombre"]).toBe("Pack grande");
  });

  it("renombrar a un nombre que ya tiene otra presentación del mismo producto es el genérico y no escribe", async () => {
    const p = await producto();
    const a = await nueva(p, "Uno", "1");
    await nueva(p, "Dos", "2");
    const antes = await fila(a);
    expect(
      await renombrarLaPresentacion(d, e.gerente, {
        productoId: p,
        presentacionId: a,
        versionEsperada: await version(a),
        nombre: "DOS",
      }),
    ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await fila(a)).toEqual(antes);
  });

  it("una presentación que no es de ese producto, o de otra empresa, no se ve, no se renombra ni se desactiva", async () => {
    const otra = await c.escenario();
    const deOtra = await producto(otra);
    const ajena = await nueva2(otra, deOtra, "Ajena");
    const mio = await producto();
    const antes = await fila(ajena);
    for (const productoId of [mio, deOtra]) {
      expect(
        await renombrarLaPresentacion(d, e.gerente, {
          productoId,
          presentacionId: ajena,
          versionEsperada: 1,
          nombre: "Robada",
        }),
      ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
      expect(
        await cambiarElEstadoDeLaPresentacion(
          d,
          e.gerente,
          { productoId, presentacionId: ajena, versionEsperada: 1 },
          false,
        ),
      ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
      expect(await verLaPresentacion(d, e.gerente, productoId, ajena)).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
    }
    expect(await fila(ajena)).toEqual(antes);
    expect(await auditorias(ajena, "PRESENTACION_EDITADA")).toBe(0);
  });

  it("desactivar dos veces seguidas escribe y audita una sola vez; reactivar la devuelve a la lista de compras; la cantidad y el nombre quedan", async () => {
    const p = await producto();
    const a = await nueva(p, "Caja", "12");
    const v = await version(a);
    const apagar = { productoId: p, presentacionId: a, versionEsperada: v };
    expect(codigoDe(await cambiarElEstadoDeLaPresentacion(d, e.gerente, apagar, false))).toBe("OK");
    expect(codigoDe(await cambiarElEstadoDeLaPresentacion(d, e.gerente, apagar, false))).toBe("OK");
    expect(await auditorias(a, "PRESENTACION_EDITADA")).toBe(1);
    expect(await fila(a)).toMatchObject({
      activa: false,
      nombre: "Caja",
      cantidad: "12.0000",
      version: v + 1,
    });
    expect(
      codigoDe(
        await cambiarElEstadoDeLaPresentacion(
          d,
          e.gerente,
          { ...apagar, versionEsperada: v + 1 },
          true,
        ),
      ),
    ).toBe("OK");
    expect(await fila(a)).toMatchObject({ activa: true, version: v + 2 });
    expect(await auditorias(a, "PRESENTACION_EDITADA")).toBe(2);
  });

  it("dos desactivaciones A LA VEZ con la misma versión dejan una sola escritura", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const p = await producto();
      const a = await nueva(p, "Caja", "12");
      const v = await version(a);
      const pedido = { productoId: p, presentacionId: a, versionEsperada: v };
      const r = await Promise.all([
        cambiarElEstadoDeLaPresentacion(d, e.gerente, pedido, false),
        cambiarElEstadoDeLaPresentacion(d, e.administrador, pedido, false),
      ]);
      expect(r.map(codigoDe)).toEqual(["OK", "OK"]);
      expect(await version(a)).toBe(v + 1);
      expect(await auditorias(a, "PRESENTACION_EDITADA")).toBe(1);
    }
  });

  it("dos renombrados A LA VEZ con la misma versión: uno gana, el otro recibe el genérico, la versión sube una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const p = await producto();
      const a = await nueva(p, "Caja", "12");
      const v = await version(a);
      const r = await Promise.all(
        ["Uno", "Dos"].map((nombre) =>
          renombrarLaPresentacion(d, e.gerente, {
            productoId: p,
            presentacionId: a,
            versionEsperada: v,
            nombre,
          }),
        ),
      );
      expect(r.map(codigoDe).sort()).toEqual([GENERICO, "OK"]);
      expect(await version(a)).toBe(v + 1);
      expect(["Uno", "Dos"]).toContain((await fila(a))?.["nombre"]);
      expect(await auditorias(a, "PRESENTACION_EDITADA")).toBe(1);
    }
  });

  it("renombrar y desactivar A LA VEZ con la misma versión: uno gana, el otro recibe el genérico y no quedan mezclados", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const p = await producto();
      const a = await nueva(p, "Caja", "12");
      const v = await version(a);
      const r = await Promise.all([
        renombrarLaPresentacion(d, e.gerente, {
          productoId: p,
          presentacionId: a,
          versionEsperada: v,
          nombre: "Nueva",
        }),
        cambiarElEstadoDeLaPresentacion(
          d,
          e.gerente,
          { productoId: p, presentacionId: a, versionEsperada: v },
          false,
        ),
      ]);
      expect(r.map(codigoDe).sort()).toEqual([GENERICO, "OK"]);
      const f = await fila(a);
      // Una sola de las dos cosas: nunca el nombre nuevo y la presentación apagada a la vez.
      expect([f?.["nombre"] === "Nueva", f?.["activa"] === false].filter(Boolean)).toHaveLength(1);
      expect(f?.["version"]).toBe(v + 1);
    }
  });

  it("dos presentaciones renombradas A LA VEZ al mismo nombre: queda una sola con ese nombre", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const p = await producto();
      const a = await nueva(p, "Uno", "1");
      const b = await nueva(p, "Dos", "2");
      const r = await Promise.all(
        [a, b].map(async (id) =>
          renombrarLaPresentacion(d, e.gerente, {
            productoId: p,
            presentacionId: id,
            versionEsperada: await version(id),
            nombre: "Igual",
          }),
        ),
      );
      expect(r.filter((x) => x.ok)).toHaveLength(1);
      expect((await lista(p)).presentaciones.filter((x) => x.nombre === "Igual")).toHaveLength(1);
    }
  });

  /** Agrega una presentación con el gerente de otra empresa (la de `x`). */
  async function nueva2(
    x: EscenarioDeCatalogo,
    productoId: string,
    nombre: string,
  ): Promise<string> {
    const r = await agregar(productoId, nombre, "3", false, x);
    if (!r.ok) throw new Error(`se esperaba la presentación y vino ${r.error.codigo}`);
    return r.dato.presentacionId;
  }
});
