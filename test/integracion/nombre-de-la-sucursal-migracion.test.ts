import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
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
  viaSesion,
  type Escenario,
} from "./facturacion-apoyo";
import { crearBaseAparte } from "./entorno";
import { acepta, conAppDe, crearPuntoDeVenta, denegado, filas } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";

/**
 * La migración 0020 (D-114: el NOMBRE de la sucursal, congelado en el comprobante al darse de alta; mismo patrón que el contacto de
 * 0019). Se prueba: que es ADITIVA (una columna nula, una función y un disparador; sobre una base con datos no cambia ni una fila),
 * que 0019 queda intacta, que la BASE copia el nombre vigente y los comprobantes anteriores quedan en nulo, que renombrar la sucursal
 * no toca lo emitido, que la aplicación no puede escribir la columna, la nota, el aislamiento por empresa, la espera entre renombrar y
 * emitir, un debilitamiento por pieza y la reversión (destructiva en el nombre: pide confirmación). Que el CHECK repite la regla del
 * nombre de sucursal lo prueba `nombre-de-la-sucursal-check.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "nombre_de_la_sucursal_en_el_comprobante";
const archivos = async () => (await readdir(CARPETA_DE_MIGRACIONES)).sort();
const unico = async (carpeta: string, patron: RegExp, que: string): Promise<string> => {
  const encontrados = (await readdir(carpeta)).filter((n) => patron.test(n));
  if (encontrados.length !== 1)
    throw new Error(`debería haber una ${que}, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const archivoDeLaMigracion = () =>
  unico(CARPETA_DE_MIGRACIONES, new RegExp(`^\\d{4}_${SUFIJO}\\.sql$`), "migración");
const archivoDeLaReversion = () =>
  unico(
    join(CARPETA_DE_MIGRACIONES, "reversiones"),
    new RegExp(`^\\d{4}_revertir_${SUFIJO}\\.sql$`),
    "reversión",
  );
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};
const textoDeLaMigracion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, await archivoDeLaMigracion()), "utf8");
const textoDeLaReversion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", await archivoDeLaReversion()), "utf8");

/** Renombra la sucursal (como el dueño de la base: evade RLS). */
const renombrar = (c: pg.Client, sucursal: string, nombre: string) =>
  c.query("update sucursal set nombre = $2 where id = $1", [sucursal, nombre]);
/** El nombre que el comprobante congeló. */
async function congelado(c: pg.Client, id: string): Promise<string | null> {
  const { rows } = await c.query<{ n: string | null }>(
    "select sucursal_nombre as n from comprobante where id = $1",
    [id],
  );
  return (rows[0] as { n: string | null }).n;
}
/** El nombre con que `crearEscenario` dio de alta la sucursal. */
async function nombreVigente(c: pg.Client, e: Escenario): Promise<string> {
  const { rows } = await c.query<{ nombre: string }>("select nombre from sucursal where id = $1", [
    e.sucursal,
  ]);
  return (rows[0] as { nombre: string }).nombre;
}

/** Un comprobante AUTORIZADO por el camino legal (como lo deja el trabajo de validación). */
async function autorizado(c: pg.Client, e: Escenario): Promise<string> {
  const ej = viaDueno(c);
  const datos = datosDeComprobante(e);
  const serie = serieDe(e, datos["tipo_comprobante"] as string);
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
const notaSobre = (factura: string, clase: "NOTA_CREDITO" | "NOTA_DEBITO") => ({
  clase,
  tipo_comprobante: `${clase}_B`,
  comprobante_asociado_id: factura,
  motivo: "devolución",
});
/** Una sucursal más de la empresa, con un punto de venta ACTIVO propio. */
async function sucursalConPuntoDeVenta(c: pg.Client, e: Escenario, nombre: string, numero: number) {
  const sucursal = (
    await c.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
      [e.empresa, nombre],
    )
  ).rows[0]?.id as string;
  const pv = await crearPuntoDeVenta(c, e, {
    numero,
    sucursal,
    domicilio: e.domicilio,
    activo: true,
  });
  return { sucursal, pv, numero, porEse: { punto_de_venta_id: pv, punto_de_venta_numero: numero } };
}
/** Inserta un comprobante con TODOS los disparadores apagados salvo los que se pidan (para probar una pieza sola). */
async function insertarConDisparadores(
  c: pg.Client,
  datos: Record<string, unknown>,
  encendidos: string[],
): Promise<void> {
  await c.query("alter table comprobante disable trigger all");
  for (const t of encendidos) await c.query(`alter table comprobante enable trigger ${t}`);
  const columnas = Object.keys(datos);
  await c.query(
    `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(datos),
  );
}

describe.skipIf(base === null)("nombre de la sucursal en el comprobante: la migración 0020", () => {
  const b = () => base as BaseDePruebas;

  it("la cabecera declara lo que es (aditiva, sin SECURITY DEFINER ni superusuario, 0019 intacta, reversión aparte) y el código solo agrega una columna con su CHECK, una función y un disparador", async () => {
    const texto = await textoDeLaMigracion();
    const plano = texto.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/Es ADITIVA/);
    expect(plano).toMatch(/DEPENDE de 0016/);
    expect(plano).toMatch(/0019 \(que queda INTACTA/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    expect(plano).toMatch(/SUPUESTO/);
    const codigo = texto.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(
      /\b(DROP|TRUNCATE|CASCADE|DELETE|UPDATE\s+public|SECURITY\s+DEFINER|DISABLE\s+TRIGGER|REVOKE|GRANT|OR\s+REPLACE)\b/i,
    );
    // Nada que pida superusuario ni toque roles o parámetros del servidor.
    expect(codigo).not.toMatch(
      /\b(CREATE\s+ROLE|ALTER\s+ROLE|ALTER\s+SYSTEM|SET\s+ROLE|SET\s+SESSION|CREATE\s+EXTENSION|COPY|LANGUAGE\s+(c|plpython\w*|untrusted))\b/i,
    );
    expect(codigo.match(/\bINSERT\s+INTO\b/gi)).toBeNull();
    expect(codigo.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(codigo.match(/CREATE TRIGGER/g)).toHaveLength(1);
    expect(codigo.match(/ADD COLUMN/g)).toHaveLength(1);
  });

  it("sobre una base con datos no cambia ni una fila: los comprobantes de antes quedan sin nombre, los nuevos lo congelan; 0019 queda intacta; exige 0016 antes y se niega ante un nombre que el CHECK rechazaría", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const e = await crearEscenario(c);
      const norte = await sucursalConPuntoDeVenta(c, e, "Norte", 2);
      const viejos = [
        await crearComprobante(c, e),
        await autorizado(c, e),
        await crearComprobante(c, e, norte.porEse),
      ];
      const huellaDeSucursales = async () =>
        (
          await c.query<{ id: string; h: string }>(
            "select id, md5(to_jsonb(x)::text) as h from sucursal x order by id",
          )
        ).rows;
      const huellaDeComprobantes = async () =>
        (
          await c.query<{ id: string; h: string }>(
            "select id, md5((to_jsonb(x) - 'sucursal_nombre')::text) as h from comprobante x order by id",
          )
        ).rows;
      const funcionDe0019 = async () =>
        (
          await c.query<{ def: string }>(
            "select pg_get_functiondef('comprobante_copiar_contacto'::regproc) as def",
          )
        ).rows[0]?.def;
      const [sAntes, cAntes, catalogoAntes, f0019Antes] = [
        await huellaDeSucursales(),
        await huellaDeComprobantes(),
        await huellaDeCatalogo(c),
        await funcionDe0019(),
      ];

      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await huellaDeSucursales()).toEqual(sAntes);
      expect(await huellaDeComprobantes()).toEqual(cAntes);
      for (const id of viejos) expect(await congelado(c, id)).toBeNull();
      expect(await funcionDe0019()).toBe(f0019Antes);

      // Del catálogo solo cambia lo que 0020 agrega: una columna, su CHECK, la función y el disparador; ningún privilegio.
      const despues = await huellaDeCatalogo(c);
      const distintos = Object.keys(despues).filter(
        (k) => JSON.stringify(despues[k]) !== JSON.stringify(catalogoAntes[k]),
      );
      expect(distintos.sort()).toEqual(
        ["columnas", "disparadores", "funciones", "restricciones"].sort(),
      );
      const nuevo = (k: string) =>
        (despues[k] ?? []).filter((x) => !(catalogoAntes[k] ?? []).includes(x));
      expect(nuevo("columnas")).toEqual([
        expect.stringMatching(/^comprobante\.sucursal_nombre:\d+:text:YES:/),
      ]);
      expect(nuevo("restricciones")).toEqual([
        expect.stringContaining("comprobante_sucursal_nombre_ck"),
      ]);
      expect(nuevo("disparadores")).toEqual([
        expect.stringContaining(
          "CREATE TRIGGER comprobante_alta_sucursal_nombre BEFORE INSERT ON public.comprobante",
        ),
      ]);

      // Desde ahora el comprobante nuevo congela el nombre vigente; los de antes siguen sin nada.
      const nuevoId = await crearComprobante(c, e);
      expect(await congelado(c, nuevoId)).toBe(await nombreVigente(c, e));
      for (const id of viejos) expect(await congelado(c, id)).toBeNull();

      // Sin 0016 no corre.
      const sin0016 = (await migracionesPrevias()).filter((n) => n < "0016");
      const sin = await baseConMigraciones(b(), sin0016);
      const solaMia = await carpetaCon([...sin0016, await archivoDeLaMigracion()]);
      try {
        await expect(aplicarMigraciones(sin.aparte.base.dueno, solaMia)).rejects.toThrow(
          /0016_comprobante_con_sucursal/,
        );
      } finally {
        await rm(solaMia, { recursive: true, force: true });
        await sin.cerrar();
      }
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  it("todo nombre que la sucursal acepta se puede copiar: el CHECK del comprobante nunca bloquea una emisión por el nombre (incluidos los que el dominio normalizaría)", async () => {
    const propia = await crearBaseAparte(b());
    const c = new pg.Client({ connectionString: propia.base.dueno });
    await c.connect();
    try {
      const e = await crearEscenario(c);
      const candidatos = [
        "Centro",
        "x",
        "x".repeat(100),
        "😀".repeat(100),
        "Ñandú — Güemes",
        "Cafe\u0301", // NFD: la base de la sucursal no exige NFC (el dominio la normaliza antes de guardar)
        "Sucursal  doble espacio",
        "a\u00a0b",
      ];
      let aceptados = 0;
      for (const nombre of candidatos) {
        const r = await c
          .query("update sucursal set nombre = $2 where id = $1", [e.sucursal, nombre])
          .then(
            () => true,
            () => false,
          );
        if (!r) continue; // la sucursal lo rechaza: nunca llega a un comprobante
        aceptados++;
        const id = await crearComprobante(c, e);
        expect(await congelado(c, id), JSON.stringify(nombre)).toBe(nombre);
      }
      // Los que sí tienen que pasar por la sucursal (para que la prueba no sea vacía).
      expect(aceptados).toBeGreaterThanOrEqual(6);
    } finally {
      await c.end();
      await propia.destruir();
    }
  });

  describe("en SQL, con todas las migraciones", () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let c: pg.Client;
    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(b());
      c = new pg.Client({ connectionString: propia.base.dueno });
      await c.connect();
    });
    afterAll(async () => {
      await c.end();
      await propia.destruir();
    });

    const codigoDe = (
      consulta: Promise<unknown>,
    ): Promise<{ code?: string; constraint?: string } | null> =>
      consulta.then(
        () => null,
        (error: { code?: string; constraint?: string }) => error,
      );

    it("el comprobante congela el nombre VIGENTE al nacer; renombrar la sucursal después no toca lo ya emitido (pendiente ni autorizado)", async () => {
      const e = await crearEscenario(c);
      const original = await nombreVigente(c, e);
      const pendiente = await crearComprobante(c, e);
      const emitido = await autorizado(c, e);
      expect(await congelado(c, pendiente)).toBe(original);
      expect(await congelado(c, emitido)).toBe(original);

      await renombrar(c, e.sucursal, "Hotel Centro");
      const trasElCambio = await crearComprobante(c, e);
      await renombrar(c, e.sucursal, "Sucursal Ñandú — Güemes");
      const trasOtroCambio = await crearComprobante(c, e);
      expect(await congelado(c, trasElCambio)).toBe("Hotel Centro");
      expect(await congelado(c, trasOtroCambio)).toBe("Sucursal Ñandú — Güemes");
      // Lo de antes sigue igual, también después de que el pendiente cambie de estado.
      await c.query(
        "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'x' where id = $1",
        [pendiente],
      );
      expect(await congelado(c, pendiente)).toBe(original);
      expect(await congelado(c, emitido)).toBe(original);
      expect(await congelado(c, trasElCambio)).toBe("Hotel Centro");
    });

    it("el nombre del comprobante es inmutable (ni el dueño de la base lo cambia o lo borra) y, si el dueño manda otro al insertar, la base lo pisa con el de la sucursal", async () => {
      const e = await crearEscenario(c);
      const id = await crearComprobante(c, e);
      for (const valor of ["Otro", null]) {
        expect(
          await codigoDe(
            c.query("update comprobante set sucursal_nombre = $2 where id = $1", [id, valor]),
          ),
        ).toMatchObject({ code: "23514", constraint: "comprobante_inmutable" });
      }
      const sembrado = await crearComprobante(c, e, { sucursal_nombre: "Ajeno" });
      expect(await congelado(c, sembrado)).toBe(await nombreVigente(c, e));
    });

    it("una nota lleva el nombre VIGENTE de la sucursal del comprobante que corrige: ni el que la factura congeló, ni el de la sucursal de su punto de venta", async () => {
      const e = await crearEscenario(c);
      const norte = await sucursalConPuntoDeVenta(c, e, "Norte", 2);
      await renombrar(c, e.sucursal, "Central");
      const factura = await autorizado(c, e);
      expect(await congelado(c, factura)).toBe("Central");
      await renombrar(c, e.sucursal, "Central renovada");
      for (const clase of ["NOTA_CREDITO", "NOTA_DEBITO"] as const) {
        const nota = await crearComprobante(c, e, {
          ...norte.porEse,
          ...notaSobre(factura, clase),
        });
        expect(await congelado(c, nota)).toBe("Central renovada");
      }
      expect(await congelado(c, factura)).toBe("Central");
    });

    it("aislamiento por empresa: cada comprobante lleva el nombre de la sucursal de SU empresa; con el alta y las claves apagadas, un sucursal_id ajeno no trae nada", async () => {
      const a = await crearEscenario(c);
      const z = await crearEscenario(c);
      await renombrar(c, a.sucursal, "Sucursal de A");
      await renombrar(c, z.sucursal, "Sucursal de Z");
      expect(await congelado(c, await crearComprobante(c, a))).toBe("Sucursal de A");
      expect(await congelado(c, await crearComprobante(c, z))).toBe("Sucursal de Z");
      // Mandando la sucursal de la otra empresa: la rechaza el alta (como siempre) y no queda ningún comprobante.
      await c.query("begin");
      const r = await insertarComprobante(
        viaDuenoDirecto(c),
        datosDeComprobante(a, { sucursal_id: z.sucursal }),
      );
      await c.query("rollback");
      expect(r.ok).toBe(false);
      // Defensa en profundidad: aun sin `comprobante_alta` ni claves foráneas, el disparador filtra por empresa.
      await c.query("begin");
      try {
        const id = randomUUID();
        await insertarConDisparadores(c, datosDeComprobante(a, { id, sucursal_id: z.sucursal }), [
          "comprobante_alta_sucursal_nombre",
        ]);
        expect(await congelado(c, id)).toBeNull();
      } finally {
        await c.query("rollback");
      }
    });

    it("con el rol de la APLICACIÓN (RLS y privilegios de columna): renombra su sucursal, el alta posterior congela el nombre, lo lee, y no puede mandarlo ni cambiarlo; tampoco toca la de otra empresa", async () => {
      const e = await crearEscenario(c);
      const otra = await crearEscenario(c);
      const deLaOtra = await nombreVigente(c, otra);
      await conAppDe(propia.base, e, async (s) => {
        const ej = viaSesion(s);
        const editado = await ej("update sucursal set nombre = $2 where id = $1", [
          e.sucursal,
          "Hotel Centro",
        ]);
        acepta(editado);
        filas(editado, 1);
        // La de otra empresa no se ve ni se cambia (la política la oculta: cero filas).
        filas(await ej("update sucursal set nombre = 'Ajena' where id = $1", [otra.sucursal]), 0);

        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(ej, datos));
        const leido = await ej("select sucursal_nombre as n from comprobante where id = $1", [
          datos["id"],
        ]);
        acepta(leido);
        expect(leido.ok && leido.rows).toEqual([{ n: "Hotel Centro" }]);

        // Mandar el nombre en el alta, o cambiarlo después: sin privilegio de columna.
        denegado(
          await ej("update comprobante set sucursal_nombre = 'Otro' where id = $1", [datos["id"]]),
        );
        denegado(
          await insertarComprobante(ej, datosDeComprobante(e, { sucursal_nombre: "Ajeno" })),
        );
      });
      expect(await nombreVigente(c, otra)).toBe(deLaOtra);
    });

    it("ningún rol pedernal_* puede escribir el nombre congelado (solo lo escribe el disparador); la aplicación sí lo lee", async () => {
      const { rows } = await c.query<{ rol: string; ins: boolean; upd: boolean }>(
        `select rolname as rol,
                has_column_privilege(rolname, 'public.comprobante', 'sucursal_nombre', 'INSERT') as ins,
                has_column_privilege(rolname, 'public.comprobante', 'sucursal_nombre', 'UPDATE') as upd
           from pg_roles where rolname like 'pedernal\\_%' order by rolname`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.filter((r) => r.ins || r.upd)).toEqual([]);
      const { rows: lee } = await c.query<{ ok: boolean }>(
        "select has_column_privilege('pedernal_app', 'public.comprobante', 'sucursal_nombre', 'SELECT') as ok",
      );
      expect(lee[0]?.ok).toBe(true);
    });

    it("la sonda del orden: `comprobante_alta_sucursal_nombre` dispara después de `comprobante_alta` (el alfabeto lo decide)", async () => {
      const { rows } = await c.query<{ tgname: string }>(
        `select tgname from pg_trigger
          where tgrelid = 'public.comprobante'::regclass and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 4) = 4
          order by tgname`,
      );
      const nombres = rows.map((f) => f.tgname);
      expect(nombres.indexOf("comprobante_alta")).toBeGreaterThanOrEqual(0);
      expect(nombres.indexOf("comprobante_alta_sucursal_nombre")).toBeGreaterThan(
        nombres.indexOf("comprobante_alta"),
      );
    });

    it("el contacto de 0019 y el nombre de 0020 se congelan juntos, del mismo estado de la sucursal", async () => {
      const e = await crearEscenario(c);
      await c.query(
        "update sucursal set nombre = 'Hotel Centro', telefono = '4321-0000' where id = $1",
        [e.sucursal],
      );
      const id = await crearComprobante(c, e);
      const { rows } = await c.query(
        "select sucursal_nombre as n, sucursal_telefono as t from comprobante where id = $1",
        [id],
      );
      expect(rows).toEqual([{ n: "Hotel Centro", t: "4321-0000" }]);
    });

    describe("renombrar y emitir a la vez (dos conexiones)", () => {
      const unaConexion = async () => {
        const nueva = new pg.Client({ connectionString: propia.base.dueno });
        await nueva.connect();
        return nueva;
      };
      async function esperar(condicion: () => Promise<boolean>, que: string, ms = 15_000) {
        const hasta = Date.now() + ms;
        while (Date.now() < hasta) {
          if (await condicion()) return;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`no pasó a tiempo: ${que}`);
      }
      const esperando = async (patron: string) =>
        Number(
          (
            await c.query<{ n: string }>(
              `select count(*) as n from pg_stat_activity
                where datname = current_database() and wait_event_type = 'Lock' and query ~* $1`,
              [patron],
            )
          ).rows[0]?.n,
        ) > 0;
      const terminado = (promesa: Promise<unknown>) => {
        const estado = { listo: false };
        void promesa.then(
          () => (estado.listo = true),
          () => (estado.listo = true),
        );
        return estado;
      };

      it("el alta primero: el renombre ESPERA hasta que el alta confirma y el comprobante congela el nombre de ANTES", async () => {
        const e = await crearEscenario(c);
        await renombrar(c, e.sucursal, "Antes");
        const alta = await unaConexion();
        const edicion = await unaConexion();
        try {
          await alta.query("begin");
          const datos = datosDeComprobante(e);
          expect((await insertarComprobante(viaDuenoDirecto(alta), datos)).ok).toBe(true);
          await edicion.query("begin");
          const editando = edicion.query("update sucursal set nombre = 'Despues' where id = $1", [
            e.sucursal,
          ]);
          const estado = terminado(editando);
          await esperar(() => esperando("update sucursal"), "el renombre espera al alta");
          expect(estado.listo).toBe(false);
          await alta.query("commit");
          await editando;
          await edicion.query("commit");
          expect(await congelado(c, datos["id"] as string)).toBe("Antes");
          expect(await nombreVigente(c, e)).toBe("Despues");
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await edicion.query("rollback").catch(() => undefined);
          await alta.end();
          await edicion.end();
        }
      });

      it("el renombre primero: el alta ESPERA y, confirmado el renombre, congela el nombre de DESPUÉS", async () => {
        const e = await crearEscenario(c);
        await renombrar(c, e.sucursal, "Antes");
        const alta = await unaConexion();
        const edicion = await unaConexion();
        try {
          await edicion.query("begin");
          await edicion.query("update sucursal set nombre = 'Despues' where id = $1", [e.sucursal]);
          await alta.query("begin");
          const datos = datosDeComprobante(e);
          const insertando = insertarComprobante(viaDuenoDirecto(alta), datos);
          const estado = terminado(insertando);
          await esperar(() => esperando("insert into comprobante"), "el alta espera al renombre");
          expect(estado.listo).toBe(false);
          await edicion.query("commit");
          expect((await insertando).ok).toBe(true);
          await alta.query("commit");
          expect(await congelado(c, datos["id"] as string)).toBe("Despues");
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await edicion.query("rollback").catch(() => undefined);
          await alta.end();
          await edicion.end();
        }
      });

      it("dos altas a la vez de la misma sucursal congelan el mismo nombre (el FOR SHARE no las serializa entre sí)", async () => {
        const e = await crearEscenario(c);
        await renombrar(c, e.sucursal, "Hotel Centro");
        const uno = await unaConexion();
        const dos = await unaConexion();
        try {
          await uno.query("begin");
          await dos.query("begin");
          const a = datosDeComprobante(e);
          const z = datosDeComprobante(e);
          const [ra, rz] = await Promise.all([
            insertarComprobante(viaDuenoDirecto(uno), a),
            insertarComprobante(viaDuenoDirecto(dos), z),
          ]);
          expect(ra.ok && rz.ok).toBe(true);
          await uno.query("commit");
          await dos.query("commit");
          expect(await congelado(c, a["id"] as string)).toBe("Hotel Centro");
          expect(await congelado(c, z["id"] as string)).toBe("Hotel Centro");
        } finally {
          await uno.query("rollback").catch(() => undefined);
          await dos.query("rollback").catch(() => undefined);
          await uno.end();
          await dos.end();
        }
      });
    });
  });

  // ===============================================================================================================
  // Debilitamientos: cada pieza de la regla tiene un chequeo que la detecta
  // ===============================================================================================================
  describe("debilitamientos (cada uno se deshace al terminar)", () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let c: pg.Client;
    let e: Escenario;
    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(b());
      c = new pg.Client({ connectionString: propia.base.dueno });
      await c.connect();
      e = await crearEscenario(c);
    });
    afterAll(async () => {
      await c.end();
      await propia.destruir();
    });

    /** El cuerpo de una función de la base, reescrito (un debilitamiento) dentro de la transacción de quien llama. */
    async function reescribir(funcion: string, de: string, a: string): Promise<void> {
      const { rows } = await c.query<{ def: string }>(
        "select pg_get_functiondef(oid) as def from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace",
        [funcion],
      );
      const def = rows[0]?.def ?? "";
      if (!def.includes(de)) throw new Error(`la función ${funcion} no contiene «${de}»`);
      await c.query(def.replace(de, a));
    }
    /** Corre `debilitar` y la sonda en una transacción que se deshace; devuelve lo que dice la sonda. */
    async function sondear(
      debilitar: () => Promise<void>,
      sonda: () => Promise<boolean>,
    ): Promise<boolean> {
      await c.query("begin");
      try {
        await debilitar();
        return await sonda();
      } finally {
        await c.query("rollback");
      }
    }
    const NOMBRE = "Hotel Centro";

    /** Sonda: un comprobante nuevo congela el nombre de la sucursal (sin confirmar nada). */
    const congelaElNombre = async (): Promise<boolean> => {
      await renombrar(c, e.sucursal, NOMBRE);
      const datos = datosDeComprobante(e);
      if (!(await insertarComprobante(viaDueno(c), datos)).ok) return false;
      return (await congelado(c, datos["id"] as string)) === NOMBRE;
    };
    /** Sonda: lo que el dueño manda al insertar se pisa con lo de la sucursal. */
    const pisaLoAjeno = async (): Promise<boolean> => {
      await renombrar(c, e.sucursal, NOMBRE);
      const datos = datosDeComprobante(e, { sucursal_nombre: "Ajeno" });
      if (!(await insertarComprobante(viaDueno(c), datos)).ok) return false;
      return (await congelado(c, datos["id"] as string)) === NOMBRE;
    };
    /** Sonda: el nombre de un comprobante ya creado no se puede cambiar. */
    const esInmutable = async (): Promise<boolean> => {
      await renombrar(c, e.sucursal, NOMBRE);
      const datos = datosDeComprobante(e);
      if (!(await insertarComprobante(viaDueno(c), datos)).ok) return false;
      const r = await viaDueno(c)("update comprobante set sucursal_nombre = 'Otro' where id = $1", [
        datos["id"],
      ]);
      return !r.ok && r.restriccion === "comprobante_inmutable";
    };
    /** Sonda: aun sin `comprobante_alta` ni claves foráneas, un `sucursal_id` de otra empresa no trae su nombre. */
    const noTraeLoAjeno = async (): Promise<boolean> => {
      const otra = await crearEscenario(c);
      await renombrar(c, otra.sucursal, "De otra empresa");
      const datos = datosDeComprobante(e, { sucursal_id: otra.sucursal });
      await insertarConDisparadores(c, datos, ["comprobante_alta_sucursal_nombre"]);
      return (await congelado(c, datos["id"] as string)) === null;
    };
    /** Sonda: la base rechaza un nombre que rompe la regla del nombre. */
    const rechazaElMalo = async (): Promise<boolean> => {
      const datos = datosDeComprobante(e, { sucursal_nombre: "Centro\nNorte" });
      try {
        await insertarConDisparadores(c, datos, []);
        return false;
      } catch (error) {
        return (error as { constraint?: string }).constraint === "comprobante_sucursal_nombre_ck";
      }
    };

    it("sana: las sondas cumplen", async () => {
      expect(await sondear(() => Promise.resolve(), congelaElNombre)).toBe(true);
      expect(await sondear(() => Promise.resolve(), pisaLoAjeno)).toBe(true);
      expect(await sondear(() => Promise.resolve(), esInmutable)).toBe(true);
      expect(await sondear(() => Promise.resolve(), noTraeLoAjeno)).toBe(true);
      expect(await sondear(() => Promise.resolve(), rechazaElMalo)).toBe(true);
    });

    it("sin el filtro por empresa, el disparador copiaría el nombre de otra empresa (lo detecta el aislamiento)", async () => {
      expect(
        await sondear(
          () =>
            reescribir(
              "comprobante_copiar_nombre_de_sucursal",
              " AND s.empresa_id = NEW.empresa_id",
              "",
            ),
          noTraeLoAjeno,
        ),
      ).toBe(false);
    });

    it("sin el disparador, el comprobante no congela nada (lo detecta la copia)", async () => {
      expect(
        await sondear(
          () =>
            c
              .query("drop trigger comprobante_alta_sucursal_nombre on comprobante")
              .then(() => undefined),
          congelaElNombre,
        ),
      ).toBe(false);
    });

    it("si el disparador corriera antes que `comprobante_alta`, no tendría la sucursal y no copiaría nada (lo detecta la copia)", async () => {
      expect(
        await sondear(
          () =>
            c
              .query(
                "alter trigger comprobante_alta_sucursal_nombre on comprobante rename to a_nombre",
              )
              .then(() => undefined),
          congelaElNombre,
        ),
      ).toBe(false);
    });

    it("sin asignar el nombre, no se congela (lo detecta la copia)", async () => {
      expect(
        await sondear(
          () =>
            reescribir(
              "comprobante_copiar_nombre_de_sucursal",
              "NEW.sucursal_nombre := v_nombre;",
              "NULL;",
            ),
          congelaElNombre,
        ),
      ).toBe(false);
    });

    it("si el disparador respetara lo que mande quien inserta, ya no pisaría lo ajeno (lo detecta el pisado)", async () => {
      expect(
        await sondear(
          () =>
            reescribir(
              "comprobante_copiar_nombre_de_sucursal",
              "NEW.sucursal_nombre := v_nombre;",
              "NEW.sucursal_nombre := coalesce(NEW.sucursal_nombre, v_nombre);",
            ),
          pisaLoAjeno,
        ),
      ).toBe(false);
    });

    it("si el nombre contara como columna de estado, el comprobante lo dejaría cambiar (lo detecta la inmutabilidad)", async () => {
      expect(
        await sondear(
          () =>
            reescribir(
              "comprobante_validar_cambio",
              "ARRAY['estado',",
              "ARRAY['sucursal_nombre', 'estado',",
            ),
          esInmutable,
        ),
      ).toBe(false);
    });

    it("sin el CHECK, el comprobante aceptaría un nombre mal formado (lo detecta el rechazo)", async () => {
      expect(
        await sondear(
          () =>
            c
              .query("alter table comprobante drop constraint comprobante_sucursal_nombre_ck")
              .then(() => undefined),
          rechazaElMalo,
        ),
      ).toBe(false);
    });

    describe("el FOR SHARE (necesita dos conexiones y una base por caso)", () => {
      /**
       * El renombre primero, sin confirmar, y llega una NOTA: ¿congela el nombre de DESPUÉS? Con FOR SHARE el alta espera al renombre y
       * relee; sin él leería el nombre de antes (el renombre aún no confirmó) y la clave foránea, que espera después, ya no lo
       * corregiría: la nota saldría con un nombre que la sucursal ya no tiene. La nota sale por el punto de venta de otra sucursal: el
       * único bloqueo que le toca a la sucursal de la factura es el de este disparador (una factura ya espera por el FOR SHARE de
       * `comprobante_validar_alta`, 0017, y el del contacto de 0019 se quita para aislar el de este).
       */
      async function congelaElDeDespues(
        debilitar: (c2: pg.Client) => Promise<void>,
      ): Promise<boolean> {
        const aparte = await crearBaseAparte(b());
        const admin = new pg.Client({ connectionString: aparte.base.dueno });
        await admin.connect();
        const alta = new pg.Client({ connectionString: aparte.base.dueno });
        const edicion = new pg.Client({ connectionString: aparte.base.dueno });
        await alta.connect();
        await edicion.connect();
        try {
          const x = await crearEscenario(admin);
          const norte = await sucursalConPuntoDeVenta(admin, x, "Norte", 2);
          const factura = await autorizado(admin, x);
          await renombrar(admin, x.sucursal, "Antes");
          await admin.query("drop trigger comprobante_alta_contacto on comprobante");
          await debilitar(admin);
          await edicion.query("begin");
          await edicion.query("update sucursal set nombre = 'Despues' where id = $1", [x.sucursal]);
          await alta.query("begin");
          const datos = datosDeComprobante(x, {
            ...norte.porEse,
            ...notaSobre(factura, "NOTA_CREDITO"),
          });
          const insertando = insertarComprobante(viaDuenoDirecto(alta), datos);
          // Sin FOR SHARE el alta no espera en el SELECT: se da un margen para que llegue a la espera de la clave foránea.
          await new Promise((r) => setTimeout(r, 400));
          await edicion.query("commit");
          if (!(await insertando).ok) throw new Error("no se pudo dar de alta la nota");
          await alta.query("commit");
          return (await congelado(admin, datos["id"] as string)) === "Despues";
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await edicion.query("rollback").catch(() => undefined);
          await alta.end();
          await edicion.end();
          await admin.end();
          await aparte.destruir();
        }
      }
      const sinBloqueo = async (c2: pg.Client) => {
        const { rows } = await c2.query<{ def: string }>(
          "select pg_get_functiondef(oid) as def from pg_proc where proname = 'comprobante_copiar_nombre_de_sucursal'",
        );
        const def = rows[0]?.def ?? "";
        if (!def.includes("FOR SHARE;")) throw new Error("la función no tiene FOR SHARE");
        await c2.query(def.replace("FOR SHARE;", ";"));
      };

      it("sana: la nota espera al renombre y congela el nombre de después", async () => {
        expect(await congelaElDeDespues(() => Promise.resolve())).toBe(true);
      });
      it("sin el FOR SHARE, la nota congelaría el nombre de antes aunque la sucursal ya cambió (lo detecta la espera)", async () => {
        expect(await congelaElDeDespues(sinBloqueo)).toBe(false);
      });
    });
  });

  // ===============================================================================================================
  // Reversión
  // ===============================================================================================================
  describe("la reversión (script aparte, DESTRUCTIVA en el nombre congelado)", () => {
    it("sin nombre congelado se aplica sola; con alguno exige confirmar y, confirmada, deja el catálogo como antes de 0020 (0019 intacta), se puede repetir y la migración se vuelve a aplicar", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
      const conMia = await carpetaCon([
        ...(await migracionesPrevias()),
        await archivoDeLaMigracion(),
      ]);
      try {
        const c = previa.cliente;
        const antes = await huellaDeCatalogo(c);
        const filaDeLaMigracion = async () =>
          (
            await c.query<{ n: number }>("select 1 as n from migracion where nombre = $1", [
              await archivoDeLaMigracion(),
            ])
          ).rows;
        const reversion = await textoDeLaReversion();

        // Sin ningún nombre congelado (solo comprobantes de antes de 0020): no pide nada.
        const e = await crearEscenario(c);
        const viejo = await crearComprobante(c, e);
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await filaDeLaMigracion()).toHaveLength(1);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await filaDeLaMigracion()).toEqual([]);

        // Con un nombre congelado: sin confirmar no borra nada.
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await renombrar(c, e.sucursal, "Hotel Centro");
        const congeladoEn = await crearComprobante(c, e);
        await c.query("begin");
        await expect(c.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/avisar al dueño/) as string,
        });
        await c.query("rollback");
        expect(await congelado(c, congeladoEn)).toBe("Hotel Centro");
        expect(await filaDeLaMigracion()).toHaveLength(1);

        // Confirmada: borra el nombre y deja el catálogo como antes; el resto de los datos sigue.
        await c.query(
          `begin; set local pedernal.confirmar_reversion = 'SI'; ${reversion}; commit;`,
        );
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await filaDeLaMigracion()).toEqual([]);
        expect(
          (await c.query("select 1 from comprobante where id = any($1)", [[viejo, congeladoEn]]))
            .rows,
        ).toHaveLength(2);
        // Se puede repetir sin que cambie nada.
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);

        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
        expect(await congelado(c, congeladoEn)).toBeNull();
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("la cabecera dice que es destructiva y no se recupera, que no la aplica el ejecutor y cómo se corre; el único DELETE es el de su fila del registro", async () => {
      const texto = await textoDeLaReversion();
      const plano = texto.replace(/\n--\s*/g, " ");
      expect(plano).toMatch(/DESTRUCTIVA/);
      expect(plano).toMatch(/NO SE\s+RECUPERA/);
      expect(plano).toMatch(/NO lo aplica el ejecutor de migraciones/);
      expect(texto).toMatch(/BEGIN;/);
      const codigo = texto.replace(/--.*$/gm, "");
      const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
      expect(borrados).toHaveLength(1);
      expect(borrados[0]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
      expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
    });
  });
});
