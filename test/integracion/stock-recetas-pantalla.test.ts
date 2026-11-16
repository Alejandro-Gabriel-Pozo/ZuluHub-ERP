import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { productoDeBase } from "./catalogo-apoyo";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * Las consultas de la pantalla de Recetas (B1 a B5 de `recetas-pantalla.md` §8) contra una base real y los roles reales: la lista con y sin receta (con páginas por cursor), la receta con
 * su última versión (H6), los ingredientes que se ofrecen, la vista previa de lo que se arma y las versiones con su costo. Cubre aislamiento entre empresas, autorización en el servidor
 * (el operador no ve costos; el módulo apagado rechaza), entradas fuera de la lista de permitidos, lecturas que NO escriben, lecturas repetidas y simultáneas, y el dinero como texto
 * decimal con moneda (nunca cero).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;

describe.skipIf(base === null)("stock: consultas de la pantalla de Recetas (B1 a B5)", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let dep: string;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    dep = await c.deposito(e, { deVenta: true });
    c.encenderPerilla("subcomposiciones");
    c.encenderPerilla("composiciones_con_perdida");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const materia = (datos: Parameters<MontajeDeStock["articulo"]>[1] = {}, x = e) =>
    c.articulo(x, { clase: "MATERIA_PRIMA", ...kilos, ...datos });
  const producto = (
    clase: "VENDIBLE" | "ELABORADO" | "MATERIA_PRIMA" | "REVENTA" | "INSUMO",
    datos: Parameters<typeof productoDeBase>[2] = {},
    x = e,
  ) => productoDeBase(c.dueno, x.empresa, { clase, ...kilos, ...datos });
  const nombre = (prefijo: string) => `${prefijo} ${nuevoId().slice(0, 8)}`;
  const componente = (
    productoId: string,
    cantidad = "1",
    perdida?: string,
    unidadId = "KILOGRAMO",
  ) => ({
    productoId,
    cantidad,
    unidadId,
    ...(perdida === undefined ? {} : { perdida }),
  });
  const guardar = async (
    productoId: string,
    componentes: readonly Record<string, unknown>[],
    versionEsperada = 0,
    rinde = "1",
    x = e,
  ) =>
    valorDe(
      await c.casos.guardarComposicion(x.gerente, {
        productoId,
        versionEsperada,
        rinde,
        componentes: componentes as never,
      }),
    );
  /** Todo lo que una lectura nunca debe tocar: versiones, componentes, auditoría y movimientos de la empresa. */
  const escrituras = async (x = e) =>
    JSON.stringify([
      await c.contar("select count(*) as n from composicion where empresa_id = $1", [x.empresa]),
      await c.contar("select count(*) as n from componente_de_composicion where empresa_id = $1", [
        x.empresa,
      ]),
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        x.empresa,
      ]),
      await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
        x.empresa,
      ]),
    ]);
  const lista = async (
    entrada: Parameters<MontajeDeStock["consultas"]["listarRecetas"]>[1] = {},
    quien = e.gerente,
  ) => valorDe(await c.consultas.listarRecetas(quien, entrada));
  const ingredientes = async (
    entrada: Parameters<MontajeDeStock["consultas"]["ingredientesParaReceta"]>[1] = {},
    quien = e.gerente,
  ) => valorDe(await c.consultas.ingredientesParaReceta(quien, entrada));

  describe("B1 listarRecetas", () => {
    it("trae solo vendibles y elaborados, con su versión vigente o sin receta, ordenados por nombre", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const prefijo = nuevoId().slice(0, 6);
      const conReceta = await producto("VENDIBLE", { nombre: `${prefijo} b-pizza` }, x);
      const sinReceta = await producto("ELABORADO", { nombre: `${prefijo} a-masa` }, x);
      await producto("MATERIA_PRIMA", { nombre: `${prefijo} c-harina` }, x);
      await producto("INSUMO", { nombre: `${prefijo} d-servilleta` }, x);
      await producto("REVENTA", { nombre: `${prefijo} e-gaseosa` }, x);
      await guardar(conReceta, [componente(harina.producto)], 0, "1", x);

      const r = await lista({ texto: prefijo }, x.gerente);
      expect(r.recetas.map((f) => [f.nombre, f.claseDeUso, f.version])).toEqual([
        [`${prefijo} a-masa`, "ELABORADO", null],
        [`${prefijo} b-pizza`, "VENDIBLE", 1],
      ]);
      expect(r.siguiente).toBeNull();
      expect(r.recetas.every((f) => f.activo)).toBe(true);
      // Sin ids de otras tablas ni datos de más.
      expect(Object.keys(r.recetas[0] ?? {}).sort()).toEqual(
        [
          "activo",
          "claseDeUso",
          "costoPorUnidad",
          "moneda",
          "nombre",
          "productoId",
          "version",
        ].sort(),
      );
      expect(sinReceta).toBe(r.recetas[0]?.productoId);
    });

    it("el filtro conReceta separa las que tienen de las que no; una receta retirada cuenta como «sin receta»", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const a = await producto("VENDIBLE", { nombre: nombre("Con") }, x);
      const b = await producto("VENDIBLE", { nombre: nombre("Sin") }, x);
      const retirada = await producto("VENDIBLE", { nombre: nombre("Retirada") }, x);
      await guardar(a, [componente(harina.producto)], 0, "1", x);
      await guardar(retirada, [componente(harina.producto)], 0, "1", x);
      valorDe(
        await c.casos.retirarComposicion(x.gerente, { productoId: retirada, versionEsperada: 1 }),
      );

      const con = await lista({ conReceta: true }, x.gerente);
      const sin = await lista({ conReceta: false }, x.gerente);
      expect(con.recetas.map((f) => f.productoId)).toEqual([a]);
      expect(sin.recetas.map((f) => f.productoId).sort()).toEqual([b, retirada].sort());
      expect(sin.recetas.every((f) => f.version === null)).toBe(true);
      expect((await lista({}, x.gerente)).recetas).toHaveLength(3);
    });

    it("el filtro activo deja solo los activos o solo los desactivados", async () => {
      const x = await c.escenario();
      const activo = await producto("VENDIBLE", { nombre: nombre("Activo") }, x);
      const baja = await producto("VENDIBLE", { nombre: nombre("Baja"), activo: false }, x);
      expect((await lista({ activo: true }, x.gerente)).recetas.map((f) => f.productoId)).toEqual([
        activo,
      ]);
      expect((await lista({ activo: false }, x.gerente)).recetas.map((f) => f.productoId)).toEqual([
        baja,
      ]);
      expect((await lista({}, x.gerente)).recetas).toHaveLength(2);
    });

    it("páginas por cursor: 50 por página, sin repetir ni saltear, y la última sin siguiente", async () => {
      const x = await c.escenario();
      const ids: string[] = [];
      for (let i = 0; i < 52; i++) {
        ids.push(await producto("VENDIBLE", { nombre: `pagina ${String(i).padStart(3, "0")}` }, x));
      }
      const primera = await lista({}, x.gerente);
      expect(primera.recetas).toHaveLength(50);
      expect(primera.siguiente).not.toBeNull();
      const segunda = await lista({ despuesDe: primera.siguiente ?? undefined }, x.gerente);
      expect(segunda.recetas).toHaveLength(2);
      expect(segunda.siguiente).toBeNull();
      const todos = [...primera.recetas, ...segunda.recetas].map((f) => f.productoId);
      expect(new Set(todos).size).toBe(52);
      expect(todos).toEqual(ids);
    });

    it("exactamente 50 filas no inventan una página siguiente", async () => {
      const x = await c.escenario();
      for (let i = 0; i < 50; i++)
        await producto("ELABORADO", { nombre: `justo ${String(i).padStart(3, "0")}` }, x);
      const r = await lista({}, x.gerente);
      expect(r.recetas).toHaveLength(50);
      expect(r.siguiente).toBeNull();
    });

    it("la búsqueda es por prefijo del nombre, sin importar mayúsculas; `%`, `_` y `\\` no son comodines", async () => {
      const x = await c.escenario();
      await producto("VENDIBLE", { nombre: "Milanesa napolitana" }, x);
      await producto("VENDIBLE", { nombre: "Milkshake" }, x);
      await producto("VENDIBLE", { nombre: "Tarta" }, x);
      expect((await lista({ texto: "MIL" }, x.gerente)).recetas).toHaveLength(2);
      expect((await lista({ texto: "milk" }, x.gerente)).recetas.map((f) => f.nombre)).toEqual([
        "Milkshake",
      ]);
      for (const texto of ["%", "_", "\\", "m%", "'; drop table producto; --"]) {
        expect((await lista({ texto }, x.gerente)).recetas).toEqual([]);
      }
      expect(
        await c.contar("select count(*) as n from producto where empresa_id = $1", [x.empresa]),
      ).toBe(3);
    });

    it("una entrada fuera de la lista de permitidos es una página vacía, no un error ni «todo»", async () => {
      const x = await c.escenario();
      await producto("VENDIBLE", { nombre: nombre("Algo") }, x);
      const malas = [
        { texto: "uno\u0000dos" },
        { texto: "uno‮dos" },
        { texto: 5 as never },
        { conReceta: "si" as never },
        { activo: 1 as never },
        { despuesDe: { nombreClave: "a", id: "no-es-un-uuid" } },
        { despuesDe: { nombreClave: 7 as never, id: nuevoId() } },
        { despuesDe: "x" as never },
        { despuesDe: null as never },
      ];
      for (const entrada of malas) {
        const r = await lista(entrada, x.gerente);
        expect(r, JSON.stringify(entrada)).toEqual({ recetas: [], siguiente: null });
      }
    });

    it("aislamiento: no aparece nada de otra empresa, ni siquiera con el cursor de la otra", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const deA = await producto("VENDIBLE", { nombre: "Solo de A" }, a);
      await producto("VENDIBLE", { nombre: "Solo de B" }, b);
      expect((await lista({}, a.gerente)).recetas.map((f) => f.productoId)).toEqual([deA]);
      expect((await lista({}, b.gerente)).recetas.map((f) => f.nombre)).toEqual(["Solo de B"]);
      // Un cursor armado con un producto de A, usado en B, solo ordena: no revela ni salta nada de A.
      const desdeA = await lista({ despuesDe: { nombreClave: "solo de a", id: deA } }, b.gerente);
      expect(desdeA.recetas.map((f) => f.nombre)).toEqual(["Solo de B"]);
    });

    it("costos: solo con `costos.ver`, texto decimal con moneda; sin costo es null, nunca cero", async () => {
      const x = await c.escenario();
      const costeado = await materia({}, x);
      const sinCosto = await materia({}, x);
      const conCosto = await producto("VENDIBLE", { nombre: nombre("Costeada") }, x);
      const incompleta = await producto("VENDIBLE", { nombre: nombre("Incompleta") }, x);
      const sinReceta = await producto("VENDIBLE", { nombre: nombre("Sin receta") }, x);
      const dep2 = await c.deposito(x, { deVenta: true });
      valorDe(
        await c.casos.registrarEntrada(x.gerente, {
          clave: nuevoId(),
          depositoId: dep2,
          motivo: "COMPRA",
          renglones: [
            {
              productoId: costeado.producto,
              cantidad: "10",
              unidadId: "KILOGRAMO",
              costoUnitario: "100",
            },
          ],
        }),
      );
      await guardar(conCosto, [componente(costeado.producto, "2")], 0, "4", x);
      await guardar(
        incompleta,
        [componente(costeado.producto, "2"), componente(sinCosto.producto, "1")],
        0,
        "1",
        x,
      );

      const gerente = await lista({}, x.gerente);
      const por = new Map(gerente.recetas.map((f) => [f.productoId, f]));
      // 2 kg × 100 ÷ rinde 4 = 50 por unidad (6 decimales, texto).
      expect(por.get(conCosto)).toMatchObject({
        costoPorUnidad: "50.000000",
        moneda: "ARS",
        version: 1,
      });
      expect(por.get(incompleta)).toMatchObject({ costoPorUnidad: null, moneda: "ARS" });
      expect(por.get(sinReceta)).toMatchObject({
        costoPorUnidad: null,
        moneda: "ARS",
        version: null,
      });
      expect(typeof por.get(conCosto)?.costoPorUnidad).toBe("string");

      for (const quien of [x.operador]) {
        const sinPermiso = await lista({}, quien);
        for (const f of sinPermiso.recetas) {
          expect(Object.hasOwn(f, "costoPorUnidad")).toBe(false);
          expect(Object.hasOwn(f, "moneda")).toBe(false);
        }
        expect(sinPermiso.recetas).toHaveLength(3);
      }
    });

    it("el módulo apagado rechaza con el motivo del guard, sin dato alguno", async () => {
      c.apagarModulo("stock");
      try {
        const r = await c.consultas.listarRecetas(e.gerente, {});
        expect(r).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      } finally {
        c.encenderModulos();
      }
    });

    it("leer no escribe, repetir da lo mismo y cien lecturas a la vez coinciden", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const p = await producto("VENDIBLE", { nombre: nombre("Estable") }, x);
      await guardar(p, [componente(harina.producto)], 0, "1", x);
      const antes = await escrituras(x);
      const primera = await lista({}, x.gerente);
      const resultados = await Promise.all(Array.from({ length: 100 }, () => lista({}, x.gerente)));
      expect(resultados.every((r) => JSON.stringify(r) === JSON.stringify(primera))).toBe(true);
      expect(await escrituras(x)).toBe(antes);
    });
  });

  describe("B2 recetaDeProducto", () => {
    it("sin receta: el producto, última versión 0 y ficha null", async () => {
      const x = await c.escenario();
      const p = await producto("VENDIBLE", { nombre: "Sin nada" }, x);
      const r = valorDe(await c.consultas.recetaDeProducto(x.gerente, { productoId: p }));
      expect(r).toEqual({
        producto: { id: p, nombre: "Sin nada", claseDeUso: "VENDIBLE", activo: true },
        ultimaVersion: 0,
        ficha: null,
      });
    });

    it("con receta: la ficha de la vigente (o de una vieja, que ya no es la vigente) y la última versión", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const sal = await materia({}, x);
      const p = await producto("VENDIBLE", {}, x);
      await guardar(p, [componente(harina.producto, "1")], 0, "1", x);
      await guardar(
        p,
        [componente(harina.producto, "2", "10"), componente(sal.producto, "1")],
        1,
        "2",
        x,
      );

      const vigente = valorDe(await c.consultas.recetaDeProducto(x.gerente, { productoId: p }));
      expect(vigente?.ultimaVersion).toBe(2);
      expect(vigente?.ficha).toMatchObject({ version: 2, esLaVigente: true, rinde: "2.0000" });
      expect(
        vigente?.ficha?.componentes.find((l) => l.productoId === harina.producto),
      ).toMatchObject({
        bruto: "2.0000",
        merma: "10.0000",
        neto: "1.8000",
      });
      const vieja = valorDe(
        await c.consultas.recetaDeProducto(x.gerente, { productoId: p, version: 1 }),
      );
      expect(vieja?.ultimaVersion).toBe(2);
      expect(vieja?.ficha).toMatchObject({ version: 1, esLaVigente: false });
      const inexistente = valorDe(
        await c.consultas.recetaDeProducto(x.gerente, { productoId: p, version: 9 }),
      );
      expect(inexistente).toMatchObject({ ultimaVersion: 2, ficha: null });
      for (const version of [0, -1, 1.5, Number.NaN, "1" as never]) {
        const r = valorDe(
          await c.consultas.recetaDeProducto(x.gerente, { productoId: p, version }),
        );
        expect(r, String(version)).toMatchObject({ ultimaVersion: 2, ficha: null });
      }
    });

    it("H6: tras retirar la receta la última versión es la de la versión vacía y guardar con ella funciona", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const p = await producto("VENDIBLE", {}, x);
      await guardar(p, [componente(harina.producto)], 0, "1", x);
      valorDe(await c.casos.retirarComposicion(x.gerente, { productoId: p, versionEsperada: 1 }));
      const r = valorDe(await c.consultas.recetaDeProducto(x.gerente, { productoId: p }));
      expect(r?.ultimaVersion).toBe(2);
      expect(r?.ficha).toBeNull();
      // Con 0 (lo que se creería sin la última versión) se rechaza; con la última, nace la 3.
      expect(
        await c.casos.guardarComposicion(x.gerente, {
          productoId: p,
          versionEsperada: 0,
          rinde: "1",
          componentes: [componente(harina.producto)] as never,
        }),
      ).toEqual({ ok: false, error: "COMPOSICION_DESACTUALIZADA" });
      expect(
        await guardar(p, [componente(harina.producto)], r?.ultimaVersion, "1", x),
      ).toMatchObject({
        version: 3,
        yaExistia: false,
      });
      expect(
        valorDe(await c.consultas.recetaDeProducto(x.gerente, { productoId: p }))?.ficha?.version,
      ).toBe(3);
    });

    it("lo que no existe, es de otra empresa, no es un uuid o no lleva receta es null (indistinguibles)", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const deB = await producto("VENDIBLE", {}, b);
      const insumo = await producto("INSUMO", {}, a);
      const materiaPrima = await producto("MATERIA_PRIMA", {}, a);
      for (const productoId of [
        deB,
        nuevoId(),
        "no-es-un-uuid",
        "",
        insumo,
        materiaPrima,
        5 as never,
      ]) {
        expect(
          valorDe(await c.consultas.recetaDeProducto(a.gerente, { productoId })),
          String(productoId),
        ).toBeNull();
      }
    });

    it("un producto desactivado se ve, con su estado", async () => {
      const x = await c.escenario();
      const p = await producto("ELABORADO", { activo: false }, x);
      const r = valorDe(await c.consultas.recetaDeProducto(x.gerente, { productoId: p }));
      expect(r?.producto.activo).toBe(false);
    });

    it("costos de la ficha solo con `costos.ver`; el operador ve la ficha sin costos", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const p = await producto("VENDIBLE", {}, x);
      await guardar(p, [componente(harina.producto)], 0, "1", x);
      const gerente = valorDe(await c.consultas.recetaDeProducto(x.gerente, { productoId: p }));
      const operador = valorDe(await c.consultas.recetaDeProducto(x.operador, { productoId: p }));
      expect(gerente?.ficha?.costos).toMatchObject({ moneda: "ARS" });
      expect(operador?.ficha?.costos).toBeUndefined();
      expect(operador?.ficha?.componentes.every((l) => !Object.hasOwn(l, "costo"))).toBe(true);
    });

    it("leer no escribe y el módulo apagado rechaza", async () => {
      const x = await c.escenario();
      const p = await producto("VENDIBLE", {}, x);
      const antes = await escrituras(x);
      await c.consultas.recetaDeProducto(x.gerente, { productoId: p });
      expect(await escrituras(x)).toBe(antes);
      c.apagarModulo("stock");
      try {
        expect(await c.consultas.recetaDeProducto(x.gerente, { productoId: p })).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
      } finally {
        c.encenderModulos();
      }
    });
  });

  describe("B3 ingredientesParaReceta", () => {
    it("ofrece materia prima y reventa con artículo activo y elaborados activos; nunca insumos ni lo desactivado", async () => {
      const x = await c.escenario();
      const prefijo = nuevoId().slice(0, 6);
      const harina = await materia({}, x);
      // los nombres se fijan por SQL: el montaje los arma al azar
      const poner = (id: string, n: string) =>
        c.dueno.query("update producto set nombre = $2, nombre_clave = $3 where id = $1", [
          id,
          n,
          n.toLowerCase(),
        ]);
      await poner(harina.producto, `${prefijo} harina`);
      const gaseosa = await materia(
        { clase: "REVENTA", unidadBase: "UNIDAD", dimension: "CONTEO" },
        x,
      );
      await poner(gaseosa.producto, `${prefijo} gaseosa`);
      const masa = await producto("ELABORADO", { nombre: `${prefijo} masa` }, x);
      await producto("ELABORADO", { nombre: `${prefijo} masa baja`, activo: false }, x);
      const inactivo = await materia({ activo: false }, x);
      await poner(inactivo.producto, `${prefijo} articulo apagado`);
      const productoApagado = await materia({}, x);
      await poner(productoApagado.producto, `${prefijo} producto apagado`);
      await c.dueno.query("update producto set activo = false where id = $1", [
        productoApagado.producto,
      ]);
      await producto("MATERIA_PRIMA", { nombre: `${prefijo} sin articulo` }, x);
      const servilleta = await materia({ clase: "INSUMO" }, x);
      await poner(servilleta.producto, `${prefijo} servilleta`);
      await producto("VENDIBLE", { nombre: `${prefijo} pizza` }, x);

      const r = await ingredientes({ texto: prefijo }, x.gerente);
      expect(r.ingredientes.map((i) => [i.nombre, i.claseDeUso, i.unidadId])).toEqual([
        [`${prefijo} gaseosa`, "REVENTA", "UNIDAD"],
        [`${prefijo} harina`, "MATERIA_PRIMA", "KILOGRAMO"],
        [`${prefijo} masa`, "ELABORADO", "KILOGRAMO"],
      ]);
      expect(r.ingredientes.map((i) => i.productoId)).toEqual(
        expect.arrayContaining([harina.producto, gaseosa.producto, masa]),
      );
      expect(r.siguiente).toBeNull();
    });

    it("páginas por cursor y búsqueda por prefijo", async () => {
      const x = await c.escenario();
      for (let i = 0; i < 51; i++) {
        await producto("ELABORADO", { nombre: `ing ${String(i).padStart(3, "0")}` }, x);
      }
      const primera = await ingredientes({}, x.gerente);
      expect(primera.ingredientes).toHaveLength(50);
      const segunda = await ingredientes({ despuesDe: primera.siguiente ?? undefined }, x.gerente);
      expect(segunda.ingredientes).toHaveLength(1);
      expect(segunda.siguiente).toBeNull();
      expect((await ingredientes({ texto: "ING 050" }, x.gerente)).ingredientes).toHaveLength(1);
      for (const texto of ["%", "_", "uno\u0000", 3 as never]) {
        expect(await ingredientes({ texto }, x.gerente)).toEqual({
          ingredientes: [],
          siguiente: null,
        });
      }
      expect(await ingredientes({ despuesDe: { nombreClave: "x", id: "mal" } }, x.gerente)).toEqual(
        {
          ingredientes: [],
          siguiente: null,
        },
      );
    });

    it("aislamiento, módulo apagado y lectura sin escritura; el operador también la ve", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      await producto("ELABORADO", { nombre: "Salsa de A" }, a);
      await producto("ELABORADO", { nombre: "Salsa de B" }, b);
      const antes = await escrituras(a);
      expect((await ingredientes({}, a.gerente)).ingredientes.map((i) => i.nombre)).toEqual([
        "Salsa de A",
      ]);
      expect((await ingredientes({}, a.operador)).ingredientes.map((i) => i.nombre)).toEqual([
        "Salsa de A",
      ]);
      expect(await escrituras(a)).toBe(antes);
      c.apagarModulo("stock");
      try {
        expect(await c.consultas.ingredientesParaReceta(a.gerente, {})).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
      } finally {
        c.encenderModulos();
      }
    });

    it("todo lo que se ofrece se puede guardar (la lista y el guardado dicen lo mismo)", async () => {
      const x = await c.escenario();
      await materia({}, x);
      await materia({ clase: "REVENTA", unidadBase: "UNIDAD", dimension: "CONTEO" }, x);
      await producto("ELABORADO", {}, x);
      const ofrecidos = (await ingredientes({}, x.gerente)).ingredientes;
      expect(ofrecidos).toHaveLength(3);
      for (const i of ofrecidos) {
        const p = await producto("VENDIBLE", {}, x);
        const r = await c.casos.guardarComposicion(x.gerente, {
          productoId: p,
          versionEsperada: 0,
          rinde: "1",
          componentes: [componente(i.productoId, "1", undefined, i.unidadId)] as never,
        });
        expect(r, i.nombre).toMatchObject({ ok: true });
      }
    });
  });

  describe("B4 vistaPreviaDeReceta", () => {
    const previa = async (entrada: Record<string, unknown>, quien = e.gerente) =>
      valorDe(await c.consultas.vistaPreviaDeReceta(quien, entrada as never));

    it("el neto sale de la misma cuenta de la ficha y no se guarda nada", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const sal = await materia({}, x);
      const p = await producto("VENDIBLE", {}, x);
      const antes = await escrituras(x);
      const r = await previa(
        {
          productoId: p,
          rinde: "2",
          componentes: [
            componente(harina.producto, "0.3", "10"),
            componente(sal.producto, "100", undefined, "GRAMO"),
          ],
        },
        x.gerente,
      );
      expect(r?.componentes).toEqual([
        { productoId: harina.producto, neto: "0.2700" },
        { productoId: sal.producto, neto: "100.0000" },
      ]);
      expect(await escrituras(x)).toBe(antes);
      // Después de guardar, la ficha dice lo mismo que la vista previa (una sola fórmula).
      await guardar(
        p,
        [
          componente(harina.producto, "0.3", "10"),
          componente(sal.producto, "100", undefined, "GRAMO"),
        ],
        0,
        "2",
        x,
      );
      const ficha = valorDe(
        await c.consultas.recetaDeProducto(x.gerente, { productoId: p }),
      )?.ficha;
      expect(ficha?.componentes.map((l) => [l.productoId, l.neto])).toEqual(
        r?.componentes.map((l) => [l.productoId, l.neto]),
      );
    });

    it("costos solo con `costos.ver`, con el costo por unidad y su moneda; el operador no los ve", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const dep2 = await c.deposito(x, { deVenta: true });
      valorDe(
        await c.casos.registrarEntrada(x.gerente, {
          clave: nuevoId(),
          depositoId: dep2,
          motivo: "COMPRA",
          renglones: [
            {
              productoId: harina.producto,
              cantidad: "10",
              unidadId: "KILOGRAMO",
              costoUnitario: "80",
            },
          ],
        }),
      );
      const p = await producto("VENDIBLE", {}, x);
      const entrada = {
        productoId: p,
        rinde: "4",
        componentes: [componente(harina.producto, "2")],
      };
      const gerente = await previa(entrada, x.gerente);
      expect(gerente?.costos).toMatchObject({
        moneda: "ARS",
        total: "160.000000",
        porUnidad: "40.000000",
        incompleto: false,
      });
      const operador = await previa(entrada, x.operador);
      expect(operador?.costos).toBeUndefined();
      expect(operador?.componentes).toEqual(gerente?.componentes);
    });

    it("lo que no se puede calcular es null: insumo, merma de 100, producto ajeno o inexistente, unidades que no convierten, forma mala", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const harina = await materia({}, a);
      const insumo = await materia({ clase: "INSUMO" }, a);
      const ajena = await materia({}, b);
      const p = await producto("VENDIBLE", {}, a);
      const pDeB = await producto("VENDIBLE", {}, b);
      const buena = [componente(harina.producto)];
      const casos: Array<[string, Record<string, unknown>]> = [
        ["insumo", { productoId: p, rinde: "1", componentes: [componente(insumo.producto)] }],
        [
          "merma 100",
          { productoId: p, rinde: "1", componentes: [componente(harina.producto, "1", "100")] },
        ],
        [
          "merma 05",
          { productoId: p, rinde: "1", componentes: [componente(harina.producto, "1", "05")] },
        ],
        [
          "ingrediente de otra empresa",
          { productoId: p, rinde: "1", componentes: [componente(ajena.producto)] },
        ],
        ["producto de otra empresa", { productoId: pDeB, rinde: "1", componentes: buena }],
        ["producto inexistente", { productoId: nuevoId(), rinde: "1", componentes: buena }],
        ["producto no uuid", { productoId: "x", rinde: "1", componentes: buena }],
        [
          "producto que no lleva receta",
          { productoId: harina.producto, rinde: "1", componentes: buena },
        ],
        [
          "unidad de otra dimensión",
          {
            productoId: p,
            rinde: "1",
            componentes: [componente(harina.producto, "1", undefined, "UNIDAD")],
          },
        ],
        ["rinde 0", { productoId: p, rinde: "0", componentes: buena }],
        ["rinde no texto", { productoId: p, rinde: 1, componentes: buena }],
        ["sin ingredientes", { productoId: p, rinde: "1", componentes: [] }],
        ["componentes no es lista", { productoId: p, rinde: "1", componentes: "x" }],
        [
          "ingrediente repetido",
          {
            productoId: p,
            rinde: "1",
            componentes: [componente(harina.producto), componente(harina.producto)],
          },
        ],
        [
          "cantidad 0",
          { productoId: p, rinde: "1", componentes: [componente(harina.producto, "0")] },
        ],
      ];
      for (const [nombreDelCaso, entrada] of casos) {
        expect(await previa(entrada, a.gerente), nombreDelCaso).toBeNull();
      }
    });

    it("el módulo apagado rechaza y el operador puede calcular el neto", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const p = await producto("VENDIBLE", {}, x);
      const entrada = {
        productoId: p,
        rinde: "1",
        componentes: [componente(harina.producto, "1", "50")],
      };
      expect((await previa(entrada, x.operador))?.componentes[0]?.neto).toBe("0.5000");
      c.apagarModulo("stock");
      try {
        expect(await c.consultas.vistaPreviaDeReceta(x.gerente, entrada as never)).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
      } finally {
        c.encenderModulos();
      }
    });
  });

  describe("B5 versionesDeReceta con costo", () => {
    it("con `costos.ver` cada versión trae su costo por unidad con los precios de hoy; la retirada, null; sin permiso, nada", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const dep2 = await c.deposito(x, { deVenta: true });
      valorDe(
        await c.casos.registrarEntrada(x.gerente, {
          clave: nuevoId(),
          depositoId: dep2,
          motivo: "COMPRA",
          renglones: [
            {
              productoId: harina.producto,
              cantidad: "10",
              unidadId: "KILOGRAMO",
              costoUnitario: "10",
            },
          ],
        }),
      );
      const p = await producto("VENDIBLE", {}, x);
      await guardar(p, [componente(harina.producto, "1")], 0, "1", x);
      await guardar(p, [componente(harina.producto, "3")], 1, "2", x);
      valorDe(await c.casos.retirarComposicion(x.gerente, { productoId: p, versionEsperada: 2 }));

      const gerente = valorDe(await c.consultas.versionesDeReceta(x.gerente, { productoId: p }));
      expect(gerente.map((v) => [v.version, v.costoPorUnidad, v.moneda])).toEqual([
        [3, null, "ARS"],
        [2, "15.000000", "ARS"],
        [1, "10.000000", "ARS"],
      ]);
      const operador = valorDe(await c.consultas.versionesDeReceta(x.operador, { productoId: p }));
      expect(operador.map((v) => v.version)).toEqual([3, 2, 1]);
      for (const v of operador) {
        expect(Object.hasOwn(v, "costoPorUnidad")).toBe(false);
        expect(Object.hasOwn(v, "moneda")).toBe(false);
      }
      expect(valorDe(await c.consultas.versionesDeReceta(x.gerente, { productoId: "x" }))).toEqual(
        [],
      );
      const ajena = await c.escenario();
      expect(
        valorDe(await c.consultas.versionesDeReceta(ajena.gerente, { productoId: p })),
      ).toEqual([]);
    });
  });

  describe("entradas con la forma de una merma", () => {
    it("guardar con «05» o «100» se rechaza como PERDIDA_INVALIDA (no lanza una excepción)", async () => {
      const x = await c.escenario();
      const harina = await materia({}, x);
      const p = await producto("VENDIBLE", {}, x);
      for (const perdida of ["05", "100", "100.0000", "-1", "1e1", "10,5", " 5"]) {
        const r = await c.casos.guardarComposicion(x.gerente, {
          productoId: p,
          versionEsperada: 0,
          rinde: "1",
          componentes: [componente(harina.producto, "1", perdida)] as never,
        });
        expect(r, perdida).toEqual({ ok: false, error: "PERDIDA_INVALIDA" });
      }
      expect(
        await c.contar("select count(*) as n from composicion where producto_id = $1", [p]),
      ).toBe(0);
    });
  });
});
