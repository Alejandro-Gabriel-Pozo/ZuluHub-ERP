import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { anularLineaEnTx, copiarLineaEnTx } from "../../src/modulos/ventas/publico";
import { personaId } from "../../src/primitivas/identificadores/marca";
import {
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * A2b T-D: el renglón de venta congela el CAMINO de clasificación comercial del producto al venderse (migración 0047). Lo que se prueba: sin clasificación el renglón queda sin
 * camino; con ella copia el departamento y la categoría con sus nombres de ese momento; mover, renombrar o desactivar un nodo, o reclasificar el producto, NO cambia el renglón ni
 * la venta ya hecha (y el renglón siguiente sí toma lo nuevo); un cambio programado rige recién desde su fecha; la copia de una línea conserva el camino de la original; y la
 * base impone la forma del camino y que no se edite. Regresión de cuentas, mostrador y comprobantes: las pruebas existentes de ventas, que corren con estas columnas.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("clasificación comercial en la venta (0047)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
    e = await m.escenario();
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** Un nodo de la clasificación de la empresa (armado por el dueño de la base: lo que se prueba es la venta, no el árbol). */
  const nodo = async (nombre: string, padre: string | null = null, empresa = e.empresa) => {
    const id = randomUUID();
    await m.dueno.query(
      "insert into nodo_de_clasificacion (id, empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, $3, $4, lower($4))",
      [id, empresa, padre, nombre],
    );
    return id;
  };
  /** Un producto vendible nuevo con el mismo precio y alícuota que el del escenario. */
  const producto = () => m.productoVendible(e.empresa, "1000");
  const vincular = (productoId: string, nodoId: string | null, desde: string) =>
    m.dueno.query(
      "insert into clasificacion_de_producto (empresa_id, producto_id, nodo_id, vigente_desde, cargado_por) values ($1, $2, $3, $4, $5)",
      [e.empresa, productoId, nodoId, desde, e.gerente.personaId],
    );
  // El reloj fijo del contexto de ventas es el 09/11/2026 15:00Z (12:00 en Argentina).
  const antes = "2026-11-01T00:00:00Z";
  const en = (contexto: ContextoOperativo, instante: string): ContextoOperativo => ({
    ...contexto,
    ahora: new Date(instante),
  });

  /** Agrega una línea del producto a una cuenta nueva y devuelve la fila sellada de `linea_cuenta`. */
  const vender = async (productoId: string, contexto = e.gerente) => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(contexto, { cuentaId: cuenta, sucursalId: e.sucursal }));
    const linea = nuevoId();
    valorDe(
      await m.casos.agregarLinea(contexto, {
        cuentaId: cuenta,
        lineaId: linea,
        productoId,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    return { cuenta, linea, fila: await filaDe(linea) };
  };
  const filaDe = async (linea: string): Promise<Fila> =>
    (
      await m.filas(
        "select departamento_id, camino_de_clasificacion from linea_cuenta where id = $1",
        [linea],
      )
    )[0] as Fila;

  it("un producto «Sin elegir» queda sin camino: las dos columnas nulas", async () => {
    const { fila } = await vender(e.producto);
    expect(fila).toEqual({ departamento_id: null, camino_de_clasificacion: null });
  });

  it("copia el departamento y la categoría con los nombres de ese momento", async () => {
    const dep = await nodo("Restaurante");
    const cat = await nodo("Bebidas", dep);
    const p = await producto();
    await vincular(p, cat, antes);
    const { fila } = await vender(p);
    expect(fila).toEqual({
      departamento_id: dep,
      camino_de_clasificacion: [
        { id: dep, nombre: "Restaurante" },
        { id: cat, nombre: "Bebidas" },
      ],
    });
    // Un producto clasificado en el departamento mismo copia un camino de un nodo.
    const p2 = await producto();
    await vincular(p2, dep, antes);
    expect((await vender(p2)).fila).toEqual({
      departamento_id: dep,
      camino_de_clasificacion: [{ id: dep, nombre: "Restaurante" }],
    });
  });

  it("renombrar, mover o desactivar un nodo y reclasificar el producto NO cambia lo ya vendido; la línea siguiente toma lo nuevo", async () => {
    const dep1 = await nodo("Hotel");
    const dep2 = await nodo("Spa");
    const cat = await nodo("Habitaciones", dep1);
    const p = await producto();
    await vincular(p, cat, antes);
    const vendida = await vender(p);
    const original = {
      departamento_id: dep1,
      camino_de_clasificacion: [
        { id: dep1, nombre: "Hotel" },
        { id: cat, nombre: "Habitaciones" },
      ],
    };
    expect(vendida.fila).toEqual(original);
    // El árbol cambia: se renombra la categoría, se mueve al otro departamento y se desactiva.
    await m.dueno.query(
      "update nodo_de_clasificacion set nombre = 'Cuartos', nombre_clave = 'cuartos' where id = $1",
      [cat],
    );
    await m.dueno.query("update nodo_de_clasificacion set padre_id = $2 where id = $1", [
      cat,
      dep2,
    ]);
    await m.dueno.query("update nodo_de_clasificacion set activo = false where id = $1", [cat]);
    // Y el producto se reclasifica con fecha anterior a ahora (la clasificación vigente pasa a ser la nueva).
    const otra = await nodo("Masajes", dep2);
    await vincular(p, otra, "2026-11-05T00:00:00Z");
    expect(await filaDe(vendida.linea)).toEqual(original);
    const nueva = await vender(p);
    expect(nueva.fila).toEqual({
      departamento_id: dep2,
      camino_de_clasificacion: [
        { id: dep2, nombre: "Spa" },
        { id: otra, nombre: "Masajes" },
      ],
    });
    expect(await filaDe(vendida.linea)).toEqual(original);
  });

  it("un cambio programado rige desde su fecha: antes se vende con lo vigente, después con lo programado", async () => {
    const dep = await nodo("Barra");
    const dep2 = await nodo("Salón");
    const p = await producto();
    await vincular(p, dep, antes);
    await vincular(p, dep2, "2026-11-20T03:00:00Z");
    expect((await vender(p)).fila["departamento_id"]).toBe(dep);
    expect((await vender(p, en(e.gerente, "2026-11-21T15:00:00Z"))).fila["departamento_id"]).toBe(
      dep2,
    );
    // Volver a «Sin elegir» también se programa: desde esa fecha el renglón queda sin camino.
    await vincular(p, null, "2026-11-25T03:00:00Z");
    expect((await vender(p, en(e.gerente, "2026-11-26T15:00:00Z"))).fila).toEqual({
      departamento_id: null,
      camino_de_clasificacion: null,
    });
  });

  it("la copia de una línea conserva el camino de la original aunque el producto se haya reclasificado", async () => {
    const dep1 = await nodo("Cocina");
    const dep2 = await nodo("Postres");
    const p = await producto();
    await vincular(p, dep1, antes);
    const { cuenta, linea } = await vender(p);
    const destino = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: destino, sucursalId: e.sucursal }));
    await vincular(p, dep2, "2026-11-08T00:00:00Z");
    const nueva = nuevoId();
    valorDe(
      await m.entorno.ejecutar({ contexto: e.gerente, reintentos: 20 }, async (tx) => {
        const persona = personaId(e.gerente.personaId as string);
        const an = await anularLineaEnTx(tx, e.gerente, persona, {
          cuentaId: cuenta,
          lineaId: linea,
          motivo: "TRASLADADA",
        });
        if (!an.ok) return an;
        return copiarLineaEnTx(tx, e.gerente, persona, {
          lineaOrigenId: linea,
          cuentaDestinoId: destino,
          lineaNuevaId: nueva,
          cantidad: "1",
          modo: "COMPLETA",
        });
      }),
    );
    expect(await filaDe(nueva)).toEqual({
      departamento_id: dep1,
      camino_de_clasificacion: [{ id: dep1, nombre: "Cocina" }],
    });
  });

  it("la empresa B vende sin ver la clasificación de la A: sus productos salen sin camino", async () => {
    const otro = await m.escenario();
    const dep = await nodo("Solo de A");
    const p = await producto();
    await vincular(p, dep, antes);
    const cuenta = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(otro.gerente, { cuentaId: cuenta, sucursalId: otro.sucursal }),
    );
    const linea = nuevoId();
    valorDe(
      await m.casos.agregarLinea(otro.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        productoId: otro.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    expect(await filaDe(linea)).toEqual({ departamento_id: null, camino_de_clasificacion: null });
    // Un producto de A vendido por B no existe para B (PRODUCTO_NO_ENCONTRADO): nada se sella.
    const r = await m.casos.agregarLinea(otro.gerente, {
      cuentaId: cuenta,
      lineaId: nuevoId(),
      productoId: p,
      opcionIds: [],
      cantidad: "1",
    });
    expect(r).toMatchObject({ ok: false });
  });

  describe("lo que impone la base", () => {
    const valido = async (camino: unknown, departamento: string | null): Promise<boolean> =>
      Boolean(
        (
          await m.dueno.query<{ ok: boolean }>(
            "select camino_de_clasificacion_valido($1::jsonb, $2::uuid) as ok",
            [JSON.stringify(camino), departamento],
          )
        ).rows[0]?.ok,
      );
    const U1 = "11111111-1111-4111-8111-111111111111";
    const U2 = "22222222-2222-4222-8222-222222222222";

    it("la forma del camino: de 1 a 4 nodos {id, nombre}, el primero es el departamento", async () => {
      expect(await valido([{ id: U1, nombre: "Restaurante" }], U1)).toBe(true);
      expect(
        await valido(
          [
            { id: U1, nombre: "A" },
            { id: U2, nombre: "B" },
          ],
          U1,
        ),
      ).toBe(true);
      const cuatro = [1, 2, 3, 4].map((n) => ({
        id: `${n}${n}111111-1111-4111-8111-111111111111`,
        nombre: `N${n}`,
      }));
      expect(await valido(cuatro, cuatro[0]?.id ?? null)).toBe(true);
      // No cumplen: vacío, de más, otro departamento, claves de más o de menos, tipos, id que no es uuid, nombre fuera de la lista, no es un arreglo.
      expect(await valido([], U1)).toBe(false);
      expect(await valido([...cuatro, { id: U2, nombre: "Cinco" }], cuatro[0]?.id ?? null)).toBe(
        false,
      );
      expect(await valido([{ id: U2, nombre: "A" }], U1)).toBe(false);
      expect(await valido([{ id: U1, nombre: "A", extra: 1 }], U1)).toBe(false);
      expect(await valido([{ id: U1 }], U1)).toBe(false);
      expect(await valido([{ id: 1, nombre: "A" }], U1)).toBe(false);
      expect(await valido([{ id: U1, nombre: 7 }], U1)).toBe(false);
      expect(
        await valido(
          [
            { id: U1, nombre: "A" },
            { id: "no-uuid", nombre: "B" },
          ],
          U1,
        ),
      ).toBe(false);
      expect(await valido([{ id: U1, nombre: "a<b" }], U1)).toBe(false);
      expect(await valido([{ id: U1, nombre: "" }], U1)).toBe(false);
      expect(await valido({ id: U1, nombre: "A" }, U1)).toBe(false);
      expect(await valido("texto", U1)).toBe(false);
      expect(await valido([{ id: U1, nombre: "A" }], null)).toBe(false);
      expect(await valido([1], U1)).toBe(false);
    });

    it("una línea no cambia su camino después: ni la aplicación (sin privilegio) ni el dueño (disparador de lo inmutable)", async () => {
      const dep = await nodo("Inmutable");
      const p = await producto();
      await vincular(p, dep, antes);
      const { linea } = await vender(p);
      const s = await m.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
        const { sql } = await import("kysely");
        try {
          await sql`update linea_cuenta set departamento_id = null, camino_de_clasificacion = null where id = ${linea}`.execute(
            tx.db,
          );
          return { ok: true as const, valor: "cambió" };
        } catch (error) {
          return { ok: false as const, error: (error as { code?: string }).code ?? "?" };
        }
      });
      expect(s).toMatchObject({ ok: false });
      await m.dueno.query("begin");
      await expect(
        m.dueno.query(
          "update linea_cuenta set camino_de_clasificacion = '[]'::jsonb where id = $1",
          [linea],
        ),
      ).rejects.toMatchObject({ code: "23514", constraint: "linea_inmutable" });
      await m.dueno.query("rollback");
      await m.dueno.query("begin");
      await expect(
        m.dueno.query("update linea_cuenta set departamento_id = null where id = $1", [linea]),
      ).rejects.toMatchObject({ code: "23514", constraint: "linea_inmutable" });
      await m.dueno.query("rollback");
    });

    it("el departamento es un nodo de la misma empresa y las dos columnas van juntas", async () => {
      const dep = await nodo("De A");
      const ajeno = await nodo("De otra", null, (await m.escenario()).empresa);
      const p = await producto();
      await vincular(p, dep, antes);
      const { cuenta } = await vender(p);
      const insertar = async (departamento: string | null, camino: unknown) => {
        await m.dueno.query("begin");
        try {
          await m.dueno.query(
            "update cuenta_consumo set ultima_posicion = ultima_posicion + 1 where id = $1",
            [cuenta],
          );
          const pos = Number(
            (
              await m.dueno.query<{ n: number }>(
                "select ultima_posicion as n from cuenta_consumo where id = $1",
                [cuenta],
              )
            ).rows[0]?.n,
          );
          await m.dueno.query(
            `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, origen_del_precio, precio_base, precio_unitario, cantidad,
                                       unidad_de_venta, paso_de_cantidad, alicuota, creada_por, creada_en, departamento_id, camino_de_clasificacion)
             values ($1, $2, $3, $4, $5, 'Prueba', 'ABIERTO', 10, 10, 1, 'UNIDAD', 1, '21', $6, now(), $7, $8::jsonb)`,
            [
              randomUUID(),
              e.empresa,
              cuenta,
              pos,
              p,
              e.gerente.personaId,
              departamento,
              camino === null ? null : JSON.stringify(camino),
            ],
          );
          return null;
        } catch (error) {
          const f = error as { code?: string; constraint?: string };
          return `${f.code ?? "?"}:${f.constraint ?? ""}`;
        } finally {
          await m.dueno.query("rollback");
        }
      };
      expect(await insertar(dep, [{ id: dep, nombre: "De A" }])).toBeNull();
      expect(await insertar(ajeno, [{ id: ajeno, nombre: "De otra" }])).toBe(
        "23503:linea_departamento_fkey",
      );
      expect(await insertar(dep, null)).toBe("23514:linea_clasificacion_ck");
      expect(await insertar(null, [{ id: dep, nombre: "De A" }])).toBe(
        "23514:linea_clasificacion_ck",
      );
      expect(await insertar(dep, [{ id: ajeno, nombre: "Otro" }])).toBe(
        "23514:linea_clasificacion_ck",
      );
    });
  });
  describe("reversión", () => {
    it("con renglones que tienen camino frena sin confirmación; con ella saca las columnas y deja la función de cambio como la de 0038; repetirla no cambia nada", async () => {
      const m2 = await montarVentas(base as never);
      try {
        const e2 = await m2.escenario();
        const dep = randomUUID();
        await m2.dueno.query(
          "insert into nodo_de_clasificacion (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'Rev', 'rev')",
          [dep, e2.empresa],
        );
        const p = await m2.productoVendible(e2.empresa, "1000");
        await m2.dueno.query(
          "insert into clasificacion_de_producto (empresa_id, producto_id, nodo_id, vigente_desde, cargado_por) values ($1, $2, $3, '2026-11-01T00:00:00Z', $4)",
          [e2.empresa, p, dep, e2.gerente.personaId],
        );
        const cuenta = nuevoId();
        valorDe(
          await m2.casos.abrirCuenta(e2.gerente, { cuentaId: cuenta, sucursalId: e2.sucursal }),
        );
        valorDe(
          await m2.casos.agregarLinea(e2.gerente, {
            cuentaId: cuenta,
            lineaId: nuevoId(),
            productoId: p,
            opcionIds: [],
            cantidad: "1",
          }),
        );
        const sql = await readFile(
          join(
            import.meta.dirname,
            "../../migraciones/reversiones/0047_revertir_camino_en_el_renglon.sql",
          ),
          "utf8",
        );
        const correr = async (confirmar = false) => {
          await m2.dueno.query("begin");
          try {
            if (confirmar) await m2.dueno.query("set local pedernal.confirmar_reversion = 'SI'");
            await m2.dueno.query(sql);
            await m2.dueno.query("commit");
          } catch (error) {
            await m2.dueno.query("rollback");
            throw error;
          }
        };
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect(
          (
            await m2.dueno.query(
              "select 1 from linea_cuenta where camino_de_clasificacion is not null",
            )
          ).rowCount,
        ).toBe(1);
        await correr(true);
        const columnas = await m2.dueno.query(
          "select column_name from information_schema.columns where table_name = 'linea_cuenta' and column_name in ('departamento_id', 'camino_de_clasificacion')",
        );
        expect(columnas.rowCount).toBe(0);
        const definicion = await m2.dueno.query<{ d: string }>(
          "select pg_get_functiondef('linea_validar_cambio()'::regprocedure) as d",
        );
        expect(definicion.rows[0]?.d).not.toContain("camino_de_clasificacion");
        expect(definicion.rows[0]?.d).toContain("importe_fijo");
        const funcion = await m2.dueno.query<{ f: string | null }>(
          "select to_regprocedure('camino_de_clasificacion_valido(jsonb, uuid)')::text as f",
        );
        expect(funcion.rows[0]?.f).toBeNull();
        await correr(); // repetirla no cambia nada
        expect(
          (
            await m2.dueno.query(
              "select 1 from migracion where nombre = '0047_camino_en_el_renglon.sql'",
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        await m2.cerrar();
      }
    });
  });
});
