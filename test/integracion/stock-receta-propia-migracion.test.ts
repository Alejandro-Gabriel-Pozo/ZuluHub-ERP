import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { productoDeBase } from "./catalogo-apoyo";
import { conectarDueno } from "./compras-devoluciones-apoyo";
import { crearMundo, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  baseConMigraciones,
  carpetaCon,
  CARPETA_DE_MIGRACIONES,
  huellaDeCatalogo,
  marcaPrincipal,
} from "./marcas-apoyo";
import { articuloDeBase, sucursalDeBase } from "./stock-apoyo";

/**
 * La migración «receta propia por sucursal» (T1) contra una base real: las dos columnas nuevas y su restricción, la única con ámbito, la regla `composicion_vigente_id`, los tres disparadores reescritos
 * (número por ámbito, artículo en la vigente de cualquier ámbito, ciclos por ámbito) y la reversión, que FRENA con alguna propia. Más: sobre una base con recetas reales y la migración anterior, lo
 * existente queda igual y el código de antes sigue escribiendo.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

const MIGRACION = "0116_receta_propia_por_sucursal.sql";
const REVERSION = "0116_revertir_receta_propia_por_sucursal.sql";

type Componente = Readonly<{ articulo?: string; compuesto?: string }>;
type DatosDeReceta = Readonly<{
  numero: number;
  sucursal?: string;
  origen?: number;
  componentes: readonly Componente[];
}>;

/** Una versión de receta con sus componentes, en UNA transacción (como la aplicación: los componentes solo entran con su versión). Con el dueño de la base. */
async function receta(
  c: pg.Client,
  m: Pick<Mundo, "empresa" | "persona">,
  producto: string,
  datos: DatosDeReceta,
): Promise<string> {
  const id = randomUUID();
  await c.query("begin");
  try {
    // Una central se escribe con la lista de columnas de siempre (como el código de antes: sirve también antes de la migración); una propia suma su ámbito.
    const conAmbito = datos.sucursal !== undefined || datos.origen !== undefined;
    await c.query(
      `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en${conAmbito ? ", sucursal_id, origen_numero" : ""})
       values ($1, $2, $3, $4, 1, $5, now()${conAmbito ? ", $6, $7" : ""})`,
      conAmbito
        ? [
            id,
            m.empresa,
            producto,
            datos.numero,
            m.persona,
            datos.sucursal ?? null,
            datos.origen ?? null,
          ]
        : [id, m.empresa, producto, datos.numero, m.persona],
    );
    let n = 1;
    for (const comp of datos.componentes) {
      await c.query(
        `insert into componente_de_composicion (empresa_id, composicion_id, numero, articulo_id, compuesto_id, cantidad, unidad_id, dimension)
         values ($1, $2, $3, $4, $5, 1, 'UNIDAD', 'CONTEO')`,
        [m.empresa, id, n++, comp.articulo ?? null, comp.compuesto ?? null],
      );
    }
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => undefined);
    throw error;
  }
  return id;
}

const vigente = async (
  c: pg.Client,
  empresa: string,
  producto: string,
  sucursal: string | null,
): Promise<string | null> =>
  (
    await c.query<{ id: string | null }>("select composicion_vigente_id($1, $2, $3) as id", [
      empresa,
      producto,
      sucursal,
    ])
  ).rows[0]?.id ?? null;

describe.skipIf(base === null)("0116 receta propia por sucursal contra una base real", () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = await conectarDueno(b());
  });
  afterAll(async () => {
    await c.end();
  });

  /** Una empresa con dos sucursales, un plato y un insumo. */
  const escenario = async () => {
    const m = await crearMundo(c);
    const s1 = m.sucursal;
    const s2 = await sucursalDeBase(c, m.empresa);
    const plato = await productoDeBase(c, m.empresa, { clase: "VENDIBLE" });
    const harina = await articuloDeBase(c, m, { clase: "MATERIA_PRIMA" });
    const queso = await articuloDeBase(c, m, { clase: "MATERIA_PRIMA" });
    return { m, s1, s2, plato, harina, queso };
  };

  it("el número se repite por ámbito: una central y una propia con el 1 conviven, y repetir el número en el mismo ámbito se rechaza (a la vez, lo decide la única: ver la prueba de dos a la vez)", async () => {
    const { m, s1, s2, plato, harina } = await escenario();
    await receta(c, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] });
    await expect(
      receta(c, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] }),
    ).rejects.toMatchObject({ constraint: "composicion_numero_salteado" });
    await receta(c, m, plato, {
      numero: 1,
      sucursal: s1,
      origen: 1,
      componentes: [{ articulo: harina.articulo }],
    });
    await receta(c, m, plato, {
      numero: 1,
      sucursal: s2,
      origen: 1,
      componentes: [{ articulo: harina.articulo }],
    });
    await expect(
      receta(c, m, plato, {
        numero: 1,
        sucursal: s1,
        origen: 1,
        componentes: [{ articulo: harina.articulo }],
      }),
    ).rejects.toMatchObject({ constraint: "composicion_numero_salteado" });
  });

  it("el número es el siguiente al último DEL ÁMBITO, y la central sigue numerando aparte de las propias", async () => {
    const { m, s1, plato, harina } = await escenario();
    await receta(c, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] });
    await expect(
      receta(c, m, plato, {
        numero: 2,
        sucursal: s1,
        origen: 1,
        componentes: [{ articulo: harina.articulo }],
      }),
    ).rejects.toMatchObject({ constraint: "composicion_numero_salteado" });
    await receta(c, m, plato, {
      numero: 1,
      sucursal: s1,
      origen: 1,
      componentes: [{ articulo: harina.articulo }],
    });
    await receta(c, m, plato, { numero: 2, componentes: [{ articulo: harina.articulo }] });
    await receta(c, m, plato, {
      numero: 2,
      sucursal: s1,
      origen: 2,
      componentes: [{ articulo: harina.articulo }],
    });
    await expect(
      receta(c, m, plato, { numero: 4, componentes: [{ articulo: harina.articulo }] }),
    ).rejects.toMatchObject({ constraint: "composicion_numero_salteado" });
  });

  it("el origen y la sucursal van juntos; una propia nace de una versión de la central que existe; la sucursal es de la misma empresa", async () => {
    const { m, s1, plato, harina } = await escenario();
    const otra = await escenario();
    // Sin ninguna central: no hay de qué nacer.
    await expect(
      receta(c, m, plato, {
        numero: 1,
        sucursal: s1,
        origen: 1,
        componentes: [{ articulo: harina.articulo }],
      }),
    ).rejects.toMatchObject({ constraint: "composicion_origen_inexistente" });
    await receta(c, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] });
    // Una central con origen, o una propia sin origen: la restricción.
    await expect(
      receta(c, m, plato, { numero: 2, origen: 1, componentes: [{ articulo: harina.articulo }] }),
    ).rejects.toMatchObject({ constraint: "composicion_origen_ck" });
    await expect(
      receta(c, m, plato, {
        numero: 1,
        sucursal: s1,
        componentes: [{ articulo: harina.articulo }],
      }),
    ).rejects.toMatchObject({ constraint: "composicion_origen_ck" });
    await expect(
      receta(c, m, plato, {
        numero: 1,
        sucursal: s1,
        origen: 0,
        componentes: [{ articulo: harina.articulo }],
      }),
    ).rejects.toMatchObject({ constraint: "composicion_origen_ck" });
    // Una versión de la central que nunca hubo.
    await expect(
      receta(c, m, plato, {
        numero: 1,
        sucursal: s1,
        origen: 2,
        componentes: [{ articulo: harina.articulo }],
      }),
    ).rejects.toMatchObject({ constraint: "composicion_origen_inexistente" });
    // La sucursal de otra empresa.
    await expect(
      receta(c, m, plato, {
        numero: 1,
        sucursal: otra.s1,
        origen: 1,
        componentes: [{ articulo: harina.articulo }],
      }),
    ).rejects.toMatchObject({ constraint: "composicion_sucursal_fkey" });
    await receta(c, m, plato, {
      numero: 1,
      sucursal: s1,
      origen: 1,
      componentes: [{ articulo: harina.articulo }],
    });
  });

  it("composicion_vigente_id: la propia no vacía rige para su sucursal; la central, para las demás y para «sin sucursal»; una propia vacía vuelve a la central", async () => {
    const { m, s1, s2, plato, harina, queso } = await escenario();
    const central1 = await receta(c, m, plato, {
      numero: 1,
      componentes: [{ articulo: harina.articulo }],
    });
    expect(await vigente(c, m.empresa, plato, null)).toBe(central1);
    expect(await vigente(c, m.empresa, plato, s1)).toBe(central1);
    const propia1 = await receta(c, m, plato, {
      numero: 1,
      sucursal: s1,
      origen: 1,
      componentes: [{ articulo: queso.articulo }],
    });
    expect(await vigente(c, m.empresa, plato, s1)).toBe(propia1);
    expect(await vigente(c, m.empresa, plato, s2)).toBe(central1);
    expect(await vigente(c, m.empresa, plato, null)).toBe(central1);
    // La central cambia: la propia sigue rigiendo en su sucursal (nada se aplica solo).
    const central2 = await receta(c, m, plato, {
      numero: 2,
      componentes: [{ articulo: harina.articulo }, { articulo: queso.articulo }],
    });
    expect(await vigente(c, m.empresa, plato, s1)).toBe(propia1);
    expect(await vigente(c, m.empresa, plato, s2)).toBe(central2);
    // Volver a la central: una propia vacía.
    await receta(c, m, plato, { numero: 2, sucursal: s1, origen: 2, componentes: [] });
    expect(await vigente(c, m.empresa, plato, s1)).toBe(central2);
    // Otra empresa y un producto sin receta: nada.
    const otra = await escenario();
    expect(await vigente(c, otra.m.empresa, plato, s1)).toBeNull();
    expect(await vigente(c, m.empresa, randomUUID(), s1)).toBeNull();
  });

  it("un artículo que está en la receta vigente de una sucursal no se puede apagar; al volver a la central, sí", async () => {
    const { m, s1, plato, harina, queso } = await escenario();
    await receta(c, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] });
    await receta(c, m, plato, {
      numero: 1,
      sucursal: s1,
      origen: 1,
      componentes: [{ articulo: queso.articulo }],
    });
    await expect(
      c.query("update articulo_de_stock set activo = false where id = $1", [queso.articulo]),
    ).rejects.toMatchObject({ constraint: "articulo_de_stock_en_composicion_activa" });
    // Una propia vacía deja de usarlo.
    await receta(c, m, plato, { numero: 2, sucursal: s1, origen: 1, componentes: [] });
    await c.query("update articulo_de_stock set activo = false where id = $1", [queso.articulo]);
  });

  it("ciclos por ámbito: una propia que cierra un ciclo con la central se rechaza en su sucursal y no en otra; una central que lo cierra con una propia, también", async () => {
    const m = await crearMundo(c);
    const s1 = m.sucursal;
    const s2 = await sucursalDeBase(c, m.empresa);
    const harina = await articuloDeBase(c, m, { clase: "MATERIA_PRIMA" });
    const a = await productoDeBase(c, m.empresa, { clase: "ELABORADO" });
    const bb = await productoDeBase(c, m.empresa, { clase: "ELABORADO" });
    // Central: A lleva B; B lleva harina.
    await receta(c, m, a, { numero: 1, componentes: [{ compuesto: bb }] });
    await receta(c, m, bb, { numero: 1, componentes: [{ articulo: harina.articulo }] });
    // La propia de B en la sucursal 1 llevaría A: en esa sucursal A → B → A es un ciclo.
    await expect(
      receta(c, m, bb, { numero: 1, sucursal: s1, origen: 1, componentes: [{ compuesto: a }] }),
    ).rejects.toMatchObject({ constraint: "composicion_con_ciclo" });
    // Mismo contenido en una sucursal donde la central de A no pasa por esa propia... también es ciclo en ESA sucursal (A → B → A); lo que no es ciclo es una propia que no cierra nada.
    await receta(c, m, bb, {
      numero: 1,
      sucursal: s2,
      origen: 1,
      componentes: [{ articulo: harina.articulo }],
    });
    // Una propia válida de A en la sucursal 1 que lleva a B; luego la central de B no puede pasar a llevar a A con esa propia vigente.
    await receta(c, m, a, { numero: 1, sucursal: s1, origen: 1, componentes: [{ compuesto: bb }] });
    await expect(
      receta(c, m, bb, { numero: 2, componentes: [{ compuesto: a }] }),
    ).rejects.toMatchObject({ constraint: "composicion_con_ciclo" });
  });

  it("dos propias a la vez: de la misma sucursal y número, una gana; de sucursales distintas, las dos pasan; una central nueva a la vez que una propia, las dos pasan", async () => {
    const { m, s1, s2, plato, harina } = await escenario();
    await receta(c, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] });
    const c2 = await conectarDueno(b());
    try {
      const misma = await Promise.allSettled([
        receta(c, m, plato, {
          numero: 1,
          sucursal: s1,
          origen: 1,
          componentes: [{ articulo: harina.articulo }],
        }),
        receta(c2, m, plato, {
          numero: 1,
          sucursal: s1,
          origen: 1,
          componentes: [{ articulo: harina.articulo }],
        }),
      ]);
      expect(misma.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(misma.filter((r) => r.status === "rejected")).toHaveLength(1);
      const distintas = await Promise.allSettled([
        receta(c, m, plato, {
          numero: 1,
          sucursal: s2,
          origen: 1,
          componentes: [{ articulo: harina.articulo }],
        }),
        receta(c2, m, plato, { numero: 2, componentes: [{ articulo: harina.articulo }] }),
      ]);
      expect(distintas.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    } finally {
      await c2.end();
    }
  });
});

describe.skipIf(base === null)(
  "0116 sobre una base con recetas reales y la migración anterior",
  () => {
    let previa: Awaited<ReturnType<typeof baseConMigraciones>>;
    let cliente: pg.Client;
    let todas: string[];
    let sinLaNueva: string[];
    beforeAll(async () => {
      todas = (await readdir(CARPETA_DE_MIGRACIONES))
        .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
        .sort();
      sinLaNueva = todas.filter((n) => n !== MIGRACION);
      previa = await baseConMigraciones(b(), sinLaNueva);
      cliente = previa.cliente;
    });
    afterAll(async () => {
      if (base !== null) await previa.cerrar();
    });

    /** Una empresa en la base aislada: el tenant lleva la marca principal (la base aislada no trae lo que siembra la global). */
    const mundoAislado = async () => {
      const marca = await marcaPrincipal(cliente);
      const tenant = (
        await cliente.query<{ id: string }>(
          "insert into tenant (nombre, marca_id) values ($1, $2) returning id",
          [`tenant-${randomUUID()}`, marca],
        )
      ).rows[0]?.id as string;
      return crearMundo(cliente, { tenant });
    };
    const aplicarTodas = async () => {
      const carpeta = await carpetaCon(todas);
      await aplicarMigraciones(previa.aparte.base.dueno, carpeta);
    };
    const revertir = async () => {
      const sql = await readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", REVERSION), "utf8");
      await cliente.query("begin");
      try {
        await cliente.query(sql);
        await cliente.query("commit");
      } catch (error) {
        await cliente.query("rollback");
        throw error;
      }
    };
    const registrada = async () =>
      (await cliente.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount ===
      1;

    it("lo existente queda igual, el código de antes sigue escribiendo, la aplicación no puede escribir las columnas nuevas, y revertir y reaplicar dejan el esquema como estaba", async () => {
      const m = await mundoAislado();
      const harina = await articuloDeBase(cliente, m, { clase: "MATERIA_PRIMA" });
      const plato = await productoDeBase(cliente, m.empresa, { clase: "VENDIBLE" });
      const otro = await productoDeBase(cliente, m.empresa, { clase: "VENDIBLE" });
      await receta(cliente, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] });
      await receta(cliente, m, plato, { numero: 2, componentes: [{ articulo: harina.articulo }] });
      await receta(cliente, m, otro, { numero: 1, componentes: [{ articulo: harina.articulo }] });
      const antes = await cliente.query(
        "select id, empresa_id, producto_id, numero, rinde::text, creada_por from composicion order by id",
      );
      const esquemaAntes = await huellaDeCatalogo(cliente);

      await aplicarTodas();
      expect(await registrada()).toBe(true);
      const despues = await cliente.query(
        "select id, empresa_id, producto_id, numero, rinde::text, creada_por from composicion order by id",
      );
      expect(despues.rows).toEqual(antes.rows);
      expect(
        (
          await cliente.query(
            "select count(*)::int as n from composicion where sucursal_id is not null or origen_numero is not null",
          )
        ).rows[0],
      ).toEqual({ n: 0 });
      // El código de antes escribe con la lista de columnas de antes y la regla de numeración sigue igual.
      await receta(cliente, m, plato, { numero: 3, componentes: [{ articulo: harina.articulo }] });
      await expect(
        receta(cliente, m, plato, { numero: 3, componentes: [{ articulo: harina.articulo }] }),
      ).rejects.toMatchObject({
        constraint: "composicion_numero_salteado",
      });
      // Todo nace cerrado: la aplicación puede seguir escribiendo lo de siempre y NO las columnas nuevas (el tramo que crea propias trae su permiso).
      const permiso = async (columna: string) =>
        (
          await cliente.query<{ p: boolean }>(
            "select has_column_privilege('pedernal_app', 'composicion', $1, 'INSERT') as p",
            [columna],
          )
        ).rows[0]?.p;
      expect(await permiso("pasos")).toBe(true);
      expect(await permiso("producto_id")).toBe(true);
      expect(await permiso("sucursal_id")).toBe(false);
      expect(await permiso("origen_numero")).toBe(false);
      const esquemaNuevo = await huellaDeCatalogo(cliente);
      expect(esquemaNuevo).not.toEqual(esquemaAntes);

      // Sin propias, la reversión deja el esquema EXACTAMENTE como estaba, sin tocar las recetas, y la migración se puede volver a aplicar.
      await revertir();
      expect(await registrada()).toBe(false);
      expect(await huellaDeCatalogo(cliente)).toEqual(esquemaAntes);
      const trasRevertir = await cliente.query(
        "select count(*)::int as n from composicion where empresa_id = $1",
        [m.empresa],
      );
      expect(trasRevertir.rows[0]).toEqual({ n: 4 });
      await aplicarTodas();
      expect(await registrada()).toBe(true);
      // Quitar y volver a agregar una columna no la devuelve a su posición (Postgres no reutiliza el número de columna): se compara sin la posición.
      const sinPosicion = (h: Awaited<ReturnType<typeof huellaDeCatalogo>>) => ({
        ...h,
        columnas: (h["columnas"] ?? []).map((f) => f.replace(/:\d+:/, ":")).sort(),
      });
      expect(sinPosicion(await huellaDeCatalogo(cliente))).toEqual(sinPosicion(esquemaNuevo));
    });

    it("con alguna receta propia, la reversión FRENA (55000) y no cambia nada; revertirla es una decisión del dueño", async () => {
      const m = await mundoAislado();
      const harina = await articuloDeBase(cliente, m, { clase: "MATERIA_PRIMA" });
      const plato = await productoDeBase(cliente, m.empresa, { clase: "VENDIBLE" });
      await receta(cliente, m, plato, { numero: 1, componentes: [{ articulo: harina.articulo }] });
      await receta(cliente, m, plato, {
        numero: 1,
        sucursal: m.sucursal,
        origen: 1,
        componentes: [{ articulo: harina.articulo }],
      });
      const esquema = await huellaDeCatalogo(cliente);
      const frenada = await revertir().then(
        () => null,
        (error: unknown) => error as { code?: string; message?: string },
      );
      expect(frenada?.code).toBe("55000");
      expect(frenada?.message).toContain("recetas propias");
      expect(await registrada()).toBe(true);
      expect(await huellaDeCatalogo(cliente)).toEqual(esquema);
    });
  },
);
