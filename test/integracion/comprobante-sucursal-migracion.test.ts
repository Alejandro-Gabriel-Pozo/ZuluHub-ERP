import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  RENGLON_DE_121,
  asegurarSerie,
  cerrarSerie,
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  entrarEnValidacion,
  insertarComprobante,
  marcarAutorizado,
  reservarSerie,
  serieDe,
  viaDueno,
  viaDuenoDirecto,
  type Escenario,
} from "./facturacion-apoyo";
import { acepta, crearPuntoDeVenta } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";
import { comoEmpresa } from "./entorno";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";

/**
 * La migración 0016 (`comprobante.sucursal_id`): el comprobante guarda a qué sucursal pertenece, para siempre.
 * Se prueba sobre una base CON comprobantes (el relleno toma la sucursal del punto de venta, sin tocar ningún otro dato ni
 * disparar los disparadores del comprobante) y sobre una vacía, la columna inmutable, que nunca queda vacía al confirmar,
 * los privilegios, lo que promete el texto del archivo y su reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const SUFIJO = "comprobante_con_sucursal";
const archivos = async () => (await readdir(CARPETA_DE_MIGRACIONES)).sort();
const archivoDeLaMigracion = async (): Promise<string> => {
  const encontrados = (await archivos()).filter((n) =>
    new RegExp(`^\\d{4}_${SUFIJO}\\.sql$`).test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una migración, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const archivoDeLaReversion = async (): Promise<string> => {
  const encontrados = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
    new RegExp(`^\\d{4}_revertir_${SUFIJO}\\.sql$`).test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una reversión, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};
const textoDeLaMigracion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, await archivoDeLaMigracion()), "utf8");
const textoDeLaReversion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", await archivoDeLaReversion()), "utf8");

const codigoDe = (consulta: Promise<unknown>): Promise<string | null> =>
  consulta.then(
    () => null,
    (e: { code?: string }) => e.code ?? "?",
  );

type Sembrado = Readonly<{
  /** Cada comprobante y la sucursal que le tiene que tocar (la ACTUAL de su punto de venta; la de la factura, una nota de crédito). */
  esperadas: ReadonlyMap<string, string>;
  a: Escenario;
  b: Escenario;
  norte: string;
  /** Un punto de venta activo de «Norte». */
  pvNorte: string;
  /** Una factura AUTORIZADA de la sucursal de la empresa (punto de venta 1). */
  factura: string;
}>;

/** Una factura B AUTORIZADA, por el camino legal y confirmada (como la deja el trabajo de validación). */
async function facturaAutorizada(c: pg.Client, e: Escenario): Promise<string> {
  const ej = viaDueno(c);
  const serie = serieDe(e);
  const datos = datosDeComprobante(e);
  const id = datos["id"] as string;
  await c.query("begin");
  acepta(await insertarComprobante(ej, datos));
  acepta(await asegurarSerie(ej, serie));
  acepta(await reservarSerie(ej, serie, id));
  acepta(await entrarEnValidacion(ej, id, "1"));
  acepta(await marcarAutorizado(ej, id));
  acepta(await cerrarSerie(ej, serie, true));
  await c.query("commit");
  return id;
}

/** Lo que hay que cambiar de una factura B para que sea una nota (crédito o débito) sobre `factura`. */
const notaSobre = (factura: string, clase: "NOTA_CREDITO" | "NOTA_DEBITO") => ({
  clase,
  tipo_comprobante: `${clase}_B`,
  comprobante_asociado_id: factura,
  motivo: "devolución",
});

/**
 * Datos de ANTES de 0016: dos empresas, comprobantes en distintos puntos de venta y sucursales, un descartado y un punto de
 * venta que se mudó de sucursal después de emitir (el caso que motiva la columna: sin historia, el relleno toma la actual).
 */
async function sembrar(c: pg.Client): Promise<Sembrado> {
  const a = await crearEscenario(c);
  const b = await crearEscenario(c);
  const norte = (
    await c.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
      [a.empresa],
    )
  ).rows[0]?.id as string;
  const pvNorte = await crearPuntoDeVenta(c, a, { numero: 2, sucursal: norte, activo: true });
  const pvMudado = await crearPuntoDeVenta(c, a, { numero: 3, activo: true });
  const esperadas = new Map<string, string>();
  esperadas.set(await crearComprobante(c, a), a.sucursal);
  esperadas.set(
    await crearComprobante(c, a, { punto_de_venta_id: pvNorte, punto_de_venta_numero: 2 }),
    norte,
  );
  const delMudado = await crearComprobante(c, a, {
    punto_de_venta_id: pvMudado,
    punto_de_venta_numero: 3,
  });
  await c.query("update punto_de_venta set sucursal_id = $2 where id = $1", [pvMudado, norte]);
  esperadas.set(delMudado, norte);
  const descartado = await crearComprobante(c, a);
  await c.query(
    "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'se cargó dos veces' where id = $1",
    [descartado],
  );
  esperadas.set(descartado, a.sucursal);
  esperadas.set(await crearComprobante(c, b), b.sucursal);
  // D-38: una nota de crédito emitida por el punto de venta de «Norte» sobre una factura de «Casa central» lleva la sucursal de la
  // FACTURA. Una de débito, la de su punto de venta.
  const factura = await facturaAutorizada(c, a);
  esperadas.set(factura, a.sucursal);
  esperadas.set(
    await crearComprobante(c, a, {
      punto_de_venta_id: pvNorte,
      punto_de_venta_numero: 2,
      ...notaSobre(factura, "NOTA_CREDITO"),
    }),
    a.sucursal,
  );
  esperadas.set(
    await crearComprobante(c, a, {
      punto_de_venta_id: pvNorte,
      punto_de_venta_numero: 2,
      ...notaSobre(factura, "NOTA_DEBITO"),
    }),
    norte,
  );
  return { esperadas, a, b, norte, pvNorte, factura };
}

/** El contenido de cada comprobante SIN la columna nueva: el relleno no puede cambiar ni un valor de lo que ya estaba. */
async function huellaDeComprobantes(c: pg.Client): Promise<Record<string, string>> {
  const { rows } = await c.query<{ id: string; h: string }>(
    `select id, md5((to_jsonb(x) - 'sucursal_id')::text) as h from comprobante x order by id`,
  );
  return Object.fromEntries(rows.map((f) => [f.id, f.h]));
}

describe.skipIf(base === null)("comprobante con sucursal: la migración 0016 y su reversión", () => {
  const b = () => base as BaseDePruebas;

  async function conPrevias<T>(
    trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, con: string) => Promise<T>,
  ): Promise<T> {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      return await trabajo(previa, conMia);
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  }

  async function conTodas<T>(
    trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, s: Sembrado) => Promise<T>,
  ): Promise<T> {
    return conPrevias(async (previa, conMia) => {
      const sembrado = await sembrar(previa.cliente);
      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      return trabajo(previa, sembrado);
    });
  }

  // =============================================================================================================
  // Aditiva y rellena
  // =============================================================================================================
  it("sobre una base con comprobantes: cada uno toma la sucursal de su punto de venta y no cambia NADA más (ni `version` ni `actualizado_en`)", async () => {
    await conPrevias(async (previa, conMia) => {
      const sembrado = await sembrar(previa.cliente);
      const antes = await huellaDeComprobantes(previa.cliente);
      expect(Object.keys(antes)).toHaveLength(sembrado.esperadas.size);
      // Sin la columna todavía.
      expect(await codigoDe(previa.cliente.query("select sucursal_id from comprobante"))).toBe(
        "42703",
      );

      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);

      const { rows } = await previa.cliente.query<{ id: string; sucursal_id: string | null }>(
        "select id, sucursal_id from comprobante",
      );
      expect(new Map(rows.map((f) => [f.id, f.sucursal_id]))).toEqual(sembrado.esperadas);
      // Ni una columna de lo que ya estaba, versión y fecha de actualización incluidas.
      expect(await huellaDeComprobantes(previa.cliente)).toEqual(antes);
    });
  });

  it("deja prendidos TODOS los disparadores del comprobante (apagarlos fue solo durante el relleno) y la tabla sigue con RLS forzada", async () => {
    await conTodas(async (previa) => {
      const { rows } = await previa.cliente.query<{ n: string; e: string }>(
        `select t.tgname as n, t.tgenabled as e from pg_trigger t
          where t.tgrelid = 'comprobante'::regclass and not t.tgisinternal order by 1`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(8);
      expect(rows.filter((f) => f.e !== "O")).toEqual([]);
      expect(rows.map((f) => f.n)).toContain("comprobante_con_sucursal");
      const { rows: rls } = await previa.cliente.query<{ a: boolean; f: boolean }>(
        "select relrowsecurity as a, relforcerowsecurity as f from pg_class where oid = 'comprobante'::regclass",
      );
      expect(rls).toEqual([{ a: true, f: true }]);
    });
  });

  it("sobre una base vacía corre limpia y deja la columna, su clave foránea compuesta, el índice, el disparador diferido y la función de alta nueva", async () => {
    const vacia = await baseConMigraciones(
      b(),
      await archivos().then((a) => a.filter((n) => /^\d{4}_.*\.sql$/.test(n))),
    );
    try {
      const c = vacia.cliente;
      const { rows: col } = await c.query<{ t: string; n: string }>(
        `select data_type as t, is_nullable as n from information_schema.columns
          where table_name = 'comprobante' and column_name = 'sucursal_id'`,
      );
      expect(col).toEqual([{ t: "uuid", n: "YES" }]);
      const { rows: fk } = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'comprobante_sucursal_fkey'`,
      );
      expect(fk).toEqual([
        { def: "FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal(id, empresa_id)" },
      ]);
      const { rows: ix } = await c.query<{ def: string }>(
        `select indexdef as def from pg_indexes where indexname = 'comprobante_sucursal_listado_ix'`,
      );
      expect(ix[0]?.def).toMatch(/\(empresa_id, sucursal_id, creado_en DESC, id\)/);
      const { rows: tg } = await c.query<{ def: string }>(
        `select pg_get_triggerdef(oid) as def from pg_trigger where tgname = 'comprobante_con_sucursal'`,
      );
      expect(tg[0]?.def).toMatch(
        /CONSTRAINT TRIGGER .*AFTER INSERT ON .*comprobante DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN \(\(new\.sucursal_id IS NULL\)\)/i,
      );
      const { rows: fn } = await c.query<{ src: string }>(
        "select prosrc as src from pg_proc where proname = 'comprobante_validar_alta'",
      );
      expect(fn[0]?.src).toContain("NEW.sucursal_id := v_sucursal");
      expect(fn[0]?.src).toContain("NEW.clase = 'NOTA_CREDITO'");
      expect(fn[0]?.src).toContain("FOR SHARE");
    } finally {
      await vacia.cerrar();
    }
  });

  // =============================================================================================================
  // Inmutable, nunca vacía, privilegios
  // =============================================================================================================
  it("la sucursal de un comprobante no cambia nunca: ni el dueño de la base la modifica, ni la aplicación tiene cómo", async () => {
    await conTodas(async (previa, s) => {
      const [id] = [...s.esperadas.keys()];
      const otra = s.norte;
      expect(
        await codigoDe(
          previa.cliente.query("update comprobante set sucursal_id = $2 where id = $1", [id, otra]),
        ),
      ).toBe("23514");
      expect(
        await codigoDe(
          previa.cliente.query("update comprobante set sucursal_id = null where id = $1", [id]),
        ),
      ).toBe("23514");

      // La aplicación: sin UPDATE ni INSERT sobre la columna (la copia la base).
      const sesion = await SesionDePrueba.abrir(
        previa.aparte.base,
        "pedernal_app",
        comoEmpresa(empresaId(s.a.empresa), personaId(s.a.persona)),
        "read committed",
      );
      try {
        const intento = await sesion.intentar(
          "update comprobante set sucursal_id = $2 where id = $1",
          [id, otra],
        );
        expect(intento.ok).toBe(false);
        if (!intento.ok) expect(intento.codigo).toBe("42501");
        const alta = await sesion.intentar(
          "insert into comprobante (id, sucursal_id) values ($1, $2)",
          [randomUUID(), otra],
        );
        expect(alta.ok).toBe(false);
        if (!alta.ok) expect(alta.codigo).toBe("42501");
      } finally {
        await sesion.cerrar();
      }
    });
  });

  it("el alta copia la sucursal del punto de venta; una distinta se rechaza; y un comprobante sin sucursal posible no se confirma", async () => {
    await conTodas(async (previa, s) => {
      const c = previa.cliente;
      // Sin mandarla: la copia el disparador.
      const id = await crearComprobante(c, s.a);
      const { rows } = await c.query<{ sucursal_id: string }>(
        "select sucursal_id from comprobante where id = $1",
        [id],
      );
      expect(rows[0]?.sucursal_id).toBe(s.a.sucursal);

      // Mandando OTRA sucursal que la del punto de venta: rechazada por el disparador de alta.
      await c.query("begin");
      const otra = await insertarComprobante(
        viaDuenoDirecto(c),
        datosDeComprobante(s.a, { sucursal_id: s.norte }),
      );
      await c.query("rollback");
      expect(otra.ok).toBe(false);
      if (!otra.ok) {
        expect(otra.codigo).toBe("23514");
        expect(otra.restriccion).toBe("comprobante_alta_invalida");
      }

      // Con el disparador de alta apagado nadie copia nada: al confirmar, el comprobante sin sucursal no pasa.
      await c.query("begin");
      await c.query("alter table comprobante disable trigger comprobante_alta");
      const sin = await insertarComprobante(viaDuenoDirecto(c), datosDeComprobante(s.a), [
        RENGLON_DE_121,
      ]);
      expect(sin.ok).toBe(true);
      await expect(c.query("commit")).rejects.toMatchObject({
        code: "23514",
        constraint: "comprobante_sin_sucursal",
      });
      await c.query("rollback").catch(() => undefined);
    });
  });

  it("D-38: una nota de crédito lleva la sucursal de la FACTURA que corrige aunque salga por un punto de venta de otra sucursal; una de débito, la de su punto de venta; una distinta se rechaza", async () => {
    await conTodas(async (previa, s) => {
      const c = previa.cliente;
      const sucursalDe = async (id: string) =>
        (
          await c.query<{ sucursal_id: string }>(
            "select sucursal_id from comprobante where id = $1",
            [id],
          )
        ).rows[0]?.sucursal_id;
      const porNorte = { punto_de_venta_id: s.pvNorte, punto_de_venta_numero: 2 };

      const credito = await crearComprobante(c, s.a, {
        ...porNorte,
        ...notaSobre(s.factura, "NOTA_CREDITO"),
      });
      expect(await sucursalDe(credito)).toBe(s.a.sucursal);
      const debito = await crearComprobante(c, s.a, {
        ...porNorte,
        ...notaSobre(s.factura, "NOTA_DEBITO"),
      });
      expect(await sucursalDe(debito)).toBe(s.norte);

      // Mandando la sucursal del punto de venta en vez de la de la factura: rechazada.
      await c.query("begin");
      const mal = await insertarComprobante(
        viaDuenoDirecto(c),
        datosDeComprobante(s.a, {
          ...porNorte,
          ...notaSobre(s.factura, "NOTA_CREDITO"),
          sucursal_id: s.norte,
        }),
      );
      await c.query("rollback");
      expect(mal.ok).toBe(false);
      if (!mal.ok) expect(mal.restriccion).toBe("comprobante_alta_invalida");
      // Y mandando la de la factura, se acepta (es la que le corresponde).
      await c.query("begin");
      const bien = await insertarComprobante(
        viaDuenoDirecto(c),
        datosDeComprobante(s.a, {
          ...porNorte,
          ...notaSobre(s.factura, "NOTA_CREDITO"),
          sucursal_id: s.a.sucursal,
        }),
      );
      await c.query("rollback");
      expect(bien.ok).toBe(true);

      // Si el punto de venta de la factura se muda después, la nota nueva sigue a la FACTURA (que no cambió).
      await c.query("update punto_de_venta set sucursal_id = $2 where id = $1", [s.a.pv, s.norte]);
      const otra = await crearComprobante(c, s.a, {
        ...porNorte,
        ...notaSobre(s.factura, "NOTA_CREDITO"),
      });
      expect(await sucursalDe(otra)).toBe(s.a.sucursal);
      expect(await sucursalDe(s.factura)).toBe(s.a.sucursal);
    });
  });

  it("la sucursal es de la misma empresa: una sucursal ajena no existe para el comprobante (clave foránea compuesta)", async () => {
    await conTodas(async (previa, s) => {
      const c = previa.cliente;
      const id = await crearComprobante(c, s.a);
      // El dueño no puede cambiarla (inmutable); se prueba la clave con el disparador de cambios apagado y vuelto a prender.
      await c.query("begin");
      await c.query("alter table comprobante disable trigger comprobante_cambio");
      await c.query("alter table comprobante disable trigger comprobante_version");
      await expect(
        c.query("update comprobante set sucursal_id = $2 where id = $1", [id, s.b.sucursal]),
      ).rejects.toMatchObject({ code: "23503", constraint: "comprobante_sucursal_fkey" });
      await c.query("rollback");
    });
  });

  // =============================================================================================================
  // Lo que promete el texto
  // =============================================================================================================
  it("la cabecera declara lo que es: aditiva, sin función SECURITY DEFINER, reversión destructiva aparte, y no usa lo prohibido", async () => {
    const texto = await textoDeLaMigracion();
    const plano = texto.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/Es ADITIVA sobre los datos/);
    expect(plano).toMatch(/No agrega ninguna función SECURITY DEFINER/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    expect(plano).toMatch(/DESTRUCTIVO/);
    const codigo = texto.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/\bSECURITY DEFINER\b/i);
    expect(codigo).not.toMatch(/\b(DROP\s+(TABLE|SCHEMA|ROLE|POLICY|COLUMN)|TRUNCATE|CASCADE)\b/i);
    expect(codigo).not.toMatch(/\bDELETE\b/i);
    expect(codigo).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
  });

  // =============================================================================================================
  // Reversión
  // =============================================================================================================
  describe("la reversión (script aparte, destructiva solo de la columna que agregó)", () => {
    const conConfirmacion = (texto: string) =>
      `begin; set local pedernal.confirmar_reversion = 'SI'; ${texto}; commit;`;

    it("con comprobantes se NIEGA sin la confirmación explícita (no cambia nada); con ella deja el catálogo como antes de 0016, los demás datos igual, y la migración se puede volver a aplicar", async () => {
      await conPrevias(async (previa, conMia) => {
        const sembrado = await sembrar(previa.cliente);
        void sembrado;
        const catalogoAntes = await huellaDeCatalogo(previa.cliente);
        const datosAntes = await huellaDeComprobantes(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const conLaMigracion = await huellaDeCatalogo(previa.cliente);
        expect(conLaMigracion).not.toEqual(catalogoAntes);
        const reversion = await textoDeLaReversion();

        await previa.cliente.query("begin");
        await expect(previa.cliente.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(
            /comprobantes cuya sucursal esta reversión borraría/,
          ) as unknown,
        });
        await previa.cliente.query("rollback");
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(conLaMigracion);

        await previa.cliente.query(conConfirmacion(reversion));
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
        expect(await huellaDeComprobantes(previa.cliente)).toEqual(datosAntes);
        const { rows: ya } = await previa.cliente.query(
          `select 1 from migracion where nombre like '%${SUFIJO}%'`,
        );
        expect(ya).toEqual([]);

        // Repetirla no falla ni cambia nada; y la migración se aplica otra vez.
        await previa.cliente.query(conConfirmacion(reversion));
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
        expect(await huellaDeComprobantes(previa.cliente)).toEqual(datosAntes);
      });
    });

    it("sin comprobantes no pide confirmación", async () => {
      await conPrevias(async (previa, conMia) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await previa.cliente.query(`begin; ${await textoDeLaReversion()}; commit;`);
        expect(await codigoDe(previa.cliente.query("select sucursal_id from comprobante"))).toBe(
          "42703",
        );
      });
    });

    it("la cabecera dice que es destructiva, que no la aplica el ejecutor, cómo se corre y que avisa al dueño", async () => {
      const texto = await textoDeLaReversion();
      const plano = texto.replace(/\n--\s*/g, " ");
      expect(texto).toMatch(/DESTRUCTIVA en lo único que agregó 0016/);
      expect(plano).toMatch(/AVISAR AL DUEÑO/);
      expect(texto).toMatch(/NO lo aplica el ejecutor de migraciones/);
      expect(texto).toMatch(/BEGIN;/);
      expect(texto).toMatch(/pedernal\.confirmar_reversion/);
      const codigo = texto.replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
    });
  });
});
