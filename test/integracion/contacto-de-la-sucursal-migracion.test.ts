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
 * La migración 0019 (D-98 y D-97: el contacto de la sucursal, congelado en el comprobante al darse de alta). Se prueba: que es
 * ADITIVA (columnas nulas, una función y un disparador; sobre una base con datos no cambia ni una fila ni una `version`), los CHECK de
 * la sucursal, que la BASE copia el contacto vigente y los comprobantes anteriores quedan sin contacto, que cambiar el contacto de la
 * sucursal no toca lo emitido, la nota, el aislamiento por empresa, la espera entre editar y emitir, un debilitamiento por pieza y la
 * reversión (destructiva en el contacto: pide confirmación).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "contacto_de_la_sucursal";
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

const TELEFONO = "+54 11 4321-0000";
const CORREO = "centro@hotel.com";
const WEB = "hotel.com/centro";
type Contacto = { telefono: string | null; correo: string | null; web: string | null };

/** Fija el contacto de la sucursal (como el dueño de la base: evade RLS). */
const fijarContacto = (
  c: pg.Client,
  sucursal: string,
  t: string | null,
  co: string | null,
  w: string | null,
) =>
  c.query("update sucursal set telefono = $2, correo = $3, web = $4 where id = $1", [
    sucursal,
    t,
    co,
    w,
  ]);
/** Lo que el comprobante congeló. */
async function congelado(c: pg.Client, id: string): Promise<Contacto> {
  const { rows } = await c.query<Contacto>(
    "select sucursal_telefono as telefono, sucursal_correo as correo, sucursal_web as web from comprobante where id = $1",
    [id],
  );
  return rows[0] as Contacto;
}
const SIN_CONTACTO: Contacto = { telefono: null, correo: null, web: null };
const CONTACTO: Contacto = { telefono: TELEFONO, correo: CORREO, web: WEB };

/** Un comprobante AUTORIZADO por el camino legal (como lo deja el trabajo de validación). */
async function autorizado(
  c: pg.Client,
  e: Escenario,
  cambios: Record<string, unknown> = {},
  pv: { id: string; numero: number } = { id: e.pv, numero: e.pvNumero },
): Promise<string> {
  const ej = viaDueno(c);
  const datos = datosDeComprobante(e, {
    punto_de_venta_id: pv.id,
    punto_de_venta_numero: pv.numero,
    ...cambios,
  });
  const serie = { ...serieDe(e, datos["tipo_comprobante"] as string), pv: pv.id };
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

describe.skipIf(base === null)("contacto de la sucursal: la migración 0019", () => {
  const b = () => base as BaseDePruebas;

  it("la cabecera declara lo que es (aditiva, sin SECURITY DEFINER, reversión aparte) y el código solo agrega columnas, privilegios de columna, una función y un disparador", async () => {
    const texto = await textoDeLaMigracion();
    const plano = texto.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/Es ADITIVA/);
    expect(plano).toMatch(/DEPENDE de 0016/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    expect(plano).toMatch(/SUPUESTO/);
    const codigo = texto.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(
      /\b(DROP|TRUNCATE|CASCADE|DELETE|UPDATE\s+public|SECURITY\s+DEFINER|DISABLE\s+TRIGGER|REVOKE|OR\s+REPLACE)\b/i,
    );
    expect(codigo.match(/\bINSERT\s+INTO\b/gi)).toBeNull();
    expect(codigo.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(codigo.match(/CREATE TRIGGER/g)).toHaveLength(1);
    // Ningún privilegio sobre el contacto congelado del comprobante: la aplicación no lo escribe.
    expect(codigo.match(/GRANT[^;]*;/g)?.every((g) => /ON sucursal TO pedernal_app/.test(g))).toBe(
      true,
    );
  });

  it("sobre una base con datos no cambia ni una fila (ni `version`): los comprobantes de antes quedan sin contacto, los nuevos lo congelan; y exige 0016 antes", async () => {
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
            "select id, md5((to_jsonb(x) - 'telefono' - 'correo' - 'web')::text) as h from sucursal x order by id",
          )
        ).rows;
      const huellaDeComprobantes = async () =>
        (
          await c.query<{ id: string; h: string }>(
            `select id, md5((to_jsonb(x) - 'sucursal_telefono' - 'sucursal_correo' - 'sucursal_web')::text) as h
               from comprobante x order by id`,
          )
        ).rows;
      const [sAntes, cAntes, catalogoAntes] = [
        await huellaDeSucursales(),
        await huellaDeComprobantes(),
        await huellaDeCatalogo(c),
      ];

      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await huellaDeSucursales()).toEqual(sAntes);
      expect(await huellaDeComprobantes()).toEqual(cAntes);
      for (const id of viejos) expect(await congelado(c, id)).toEqual(SIN_CONTACTO);
      expect(
        (
          await c.query(
            "select 1 from sucursal where telefono is not null or correo is not null or web is not null",
          )
        ).rows,
      ).toEqual([]);

      // Del catálogo solo cambia lo que 0019 agrega: columnas, sus CHECK, la función, el disparador y los privilegios de columna.
      const despues = await huellaDeCatalogo(c);
      const distintos = Object.keys(despues).filter(
        (k) => JSON.stringify(despues[k]) !== JSON.stringify(catalogoAntes[k]),
      );
      expect(distintos.sort()).toEqual(
        ["columnas", "disparadores", "funciones", "privilegiosPorColumna", "restricciones"].sort(),
      );
      const nuevo = (k: string) =>
        (despues[k] ?? []).filter((x) => !(catalogoAntes[k] ?? []).includes(x));
      expect(nuevo("columnas").map((x) => x.split(":")[0])).toEqual(
        [
          "comprobante.sucursal_correo",
          "comprobante.sucursal_telefono",
          "comprobante.sucursal_web",
          "sucursal.correo",
          "sucursal.telefono",
          "sucursal.web",
        ].sort(),
      );
      expect(nuevo("columnas").every((x) => x.endsWith(":text:YES:"))).toBe(true);
      expect(nuevo("restricciones")).toHaveLength(3);
      expect(nuevo("disparadores")).toEqual([
        expect.stringContaining(
          "CREATE TRIGGER comprobante_alta_contacto BEFORE INSERT ON public.comprobante",
        ),
      ]);
      expect(nuevo("privilegiosPorColumna").map((x) => x.split(":")[0])).toEqual(
        ["sucursal.correo", "sucursal.telefono", "sucursal.web"].sort(),
      );

      // Desde ahora el comprobante nuevo congela lo vigente; los de antes siguen sin nada.
      await fijarContacto(c, e.sucursal, TELEFONO, CORREO, WEB);
      const nuevoId = await crearComprobante(c, e);
      expect(await congelado(c, nuevoId)).toEqual(CONTACTO);
      for (const id of viejos) expect(await congelado(c, id)).toEqual(SIN_CONTACTO);

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

    describe("los CHECK del contacto de la sucursal", () => {
      const CASOS: Record<string, { restriccion: string; buenos: string[]; malos: string[] }> = {
        telefono: {
          restriccion: "sucursal_telefono_ck",
          buenos: [TELEFONO, "4321-0000 int. 2", "x", "x".repeat(40)],
          malos: ["", " 4321", "4321 ", "x".repeat(41), "43\n21", "43\t21", "43\u009f21"],
        },
        correo: {
          restriccion: "sucursal_correo_ck",
          buenos: [CORREO, "a@b", `${"a".repeat(248)}@b.com`.slice(0, 254)],
          malos: [
            "",
            "Centro@hotel.com",
            " centro@hotel.com",
            "centro",
            "@hotel.com",
            "centro@",
            "cen tro@hotel.com",
            `${"a".repeat(250)}@b.com`.slice(0, 255),
            "centro@hotel\u0085.com",
          ],
        },
        web: {
          restriccion: "sucursal_web_ck",
          // La base guarda la forma CANÓNICA (sin esquema, host en minúsculas, sin barra si es solo el host): D-99.
          buenos: [
            WEB,
            "hotel.com",
            "www.hotel.com",
            "hotel.com:8080/x?y=Z#w",
            "hotel.com/centro/",
            "hotel.com/Ruta",
            `${"a".repeat(196)}.com`,
          ],
          malos: [
            "",
            "https://hotel.com",
            "http://hotel.com",
            "javascript:alert(1)",
            "ftp://hotel.com",
            "Hotel.com",
            "WWW.hotel.com",
            "hotel.com/",
            "hotel",
            "ho tel.com",
            "hotel.com/a b",
            "user@hotel.com",
            `${"a".repeat(197)}.com`,
            "hotel.com/\n",
          ],
        },
      };
      for (const [columna, caso] of Object.entries(CASOS)) {
        it(`${columna}: acepta lo bien formado (y nulo = sin dato) y rechaza el resto con 23514 ${caso.restriccion}`, async () => {
          const e = await crearEscenario(c);
          const poner = (valor: string | null) =>
            c.query(`update sucursal set ${columna} = $2 where id = $1`, [e.sucursal, valor]);
          expect(await codigoDe(poner(null))).toBeNull();
          for (const bueno of caso.buenos)
            expect(await codigoDe(poner(bueno)), JSON.stringify(bueno)).toBeNull();
          for (const malo of caso.malos) {
            expect(await codigoDe(poner(malo)), JSON.stringify(malo)).toMatchObject({
              code: "23514",
              constraint: caso.restriccion,
            });
          }
          // También al darse de alta.
          expect(
            await codigoDe(
              c.query(
                `insert into sucursal (empresa_id, nombre, ${columna}) values ($1, 'Otra', $2)`,
                [e.empresa, caso.malos[1]],
              ),
            ),
          ).toMatchObject({ code: "23514", constraint: caso.restriccion });
        });
      }
    });

    it("el comprobante congela el contacto VIGENTE al nacer; cambiarlo o borrarlo en la sucursal no toca lo ya emitido (pendiente ni autorizado)", async () => {
      const e = await crearEscenario(c);
      const sinContacto = await crearComprobante(c, e);
      expect(await congelado(c, sinContacto)).toEqual(SIN_CONTACTO);

      await fijarContacto(c, e.sucursal, TELEFONO, CORREO, WEB);
      const pendiente = await crearComprobante(c, e);
      const emitido = await autorizado(c, e);
      expect(await congelado(c, pendiente)).toEqual(CONTACTO);
      expect(await congelado(c, emitido)).toEqual(CONTACTO);

      const otro: Contacto = {
        telefono: "4000-1111",
        correo: "nuevo@hotel.com",
        web: "nuevo.com",
      };
      await fijarContacto(c, e.sucursal, otro.telefono, otro.correo, otro.web);
      const trasElCambio = await crearComprobante(c, e);
      await fijarContacto(c, e.sucursal, null, null, null);
      const trasBorrar = await crearComprobante(c, e);
      expect(await congelado(c, trasElCambio)).toEqual(otro);
      expect(await congelado(c, trasBorrar)).toEqual(SIN_CONTACTO);
      // Lo de antes sigue igual, también después de que el pendiente cambie de estado.
      await c.query(
        "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'x' where id = $1",
        [pendiente],
      );
      expect(await congelado(c, pendiente)).toEqual(CONTACTO);
      expect(await congelado(c, emitido)).toEqual(CONTACTO);
      expect(await congelado(c, sinContacto)).toEqual(SIN_CONTACTO);
    });

    it("el contacto del comprobante es inmutable (ni el dueño de la base lo cambia o lo borra) y, si el dueño manda otro al insertar, la base lo pisa con el de la sucursal", async () => {
      const e = await crearEscenario(c);
      await fijarContacto(c, e.sucursal, TELEFONO, CORREO, null);
      const id = await crearComprobante(c, e);
      // La web está vacía: ahí solo "cambia" ponerle un valor; en las otras dos, también borrarlo.
      const cambios: [string, (string | null)[]][] = [
        ["sucursal_telefono", ["otro", null]],
        ["sucursal_correo", ["otro@x.com", null]],
        ["sucursal_web", ["otro.com"]],
      ];
      for (const [columna, valores] of cambios) {
        for (const valor of valores) {
          expect(
            await codigoDe(
              c.query(`update comprobante set ${columna} = $2 where id = $1`, [id, valor]),
            ),
          ).toMatchObject({ code: "23514", constraint: "comprobante_inmutable" });
        }
      }
      const sembrado = await crearComprobante(c, e, {
        sucursal_telefono: "ajeno",
        sucursal_correo: "ajeno@x.com",
        sucursal_web: "ajeno.com",
      });
      expect(await congelado(c, sembrado)).toEqual({
        telefono: TELEFONO,
        correo: CORREO,
        web: null,
      });
    });

    it("una nota lleva el contacto VIGENTE de la sucursal del comprobante que corrige: ni el que la factura congeló, ni el de la sucursal de su punto de venta", async () => {
      const e = await crearEscenario(c);
      const norte = await sucursalConPuntoDeVenta(c, e, "Norte", 2);
      await fijarContacto(c, e.sucursal, "1111-1111", null, null);
      await fijarContacto(c, norte.sucursal, "9999-9999", null, null);
      const factura = await autorizado(c, e);
      expect(await congelado(c, factura)).toMatchObject({ telefono: "1111-1111" });
      await fijarContacto(c, e.sucursal, "2222-2222", CORREO, null);
      for (const clase of ["NOTA_CREDITO", "NOTA_DEBITO"] as const) {
        const nota = await crearComprobante(c, e, {
          ...norte.porEse,
          ...notaSobre(factura, clase),
        });
        expect(await congelado(c, nota)).toEqual({
          telefono: "2222-2222",
          correo: CORREO,
          web: null,
        });
      }
      expect(await congelado(c, factura)).toMatchObject({ telefono: "1111-1111", correo: null });
    });

    it("aislamiento por empresa: cada comprobante lleva el contacto de la sucursal de SU empresa; con el alta y las claves apagadas, un sucursal_id ajeno no trae nada", async () => {
      const a = await crearEscenario(c);
      const z = await crearEscenario(c);
      await fijarContacto(c, a.sucursal, "1111-1111", "a@a.com", "a.com");
      await fijarContacto(c, z.sucursal, "2222-2222", "z@z.com", "z.com");
      expect(await congelado(c, await crearComprobante(c, a))).toEqual({
        telefono: "1111-1111",
        correo: "a@a.com",
        web: "a.com",
      });
      expect(await congelado(c, await crearComprobante(c, z))).toEqual({
        telefono: "2222-2222",
        correo: "z@z.com",
        web: "z.com",
      });
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
        await c.query("alter table comprobante disable trigger all");
        await c.query("alter table comprobante enable trigger comprobante_alta_contacto");
        const id = randomUUID();
        const datos = datosDeComprobante(a, { id, sucursal_id: z.sucursal });
        const columnas = Object.keys(datos);
        await c.query(
          `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
          Object.values(datos),
        );
        expect(await congelado(c, id)).toEqual(SIN_CONTACTO);
      } finally {
        await c.query("rollback");
      }
    });

    it("con el rol de la APLICACIÓN (RLS y privilegios de columna): edita el contacto de su sucursal, el alta posterior lo congela y no puede mandarlo ni tocar el de otra empresa", async () => {
      const e = await crearEscenario(c);
      const otra = await crearEscenario(c);
      await fijarContacto(c, otra.sucursal, "7777-7777", null, null);
      await conAppDe(propia.base, e, async (s) => {
        const ej = viaSesion(s);
        const editado = await ej(
          "update sucursal set telefono = $2, correo = $3, web = $4 where id = $1",
          [e.sucursal, TELEFONO, CORREO, WEB],
        );
        acepta(editado);
        filas(editado, 1);
        // La de otra empresa no se ve ni se cambia (la política la oculta: cero filas).
        filas(await ej("update sucursal set telefono = 'ajeno' where id = $1", [otra.sucursal]), 0);

        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(ej, datos));
        const leido = await ej(
          "select sucursal_telefono as telefono, sucursal_correo as correo, sucursal_web as web from comprobante where id = $1",
          [datos["id"]],
        );
        acepta(leido);
        expect(leido.ok && leido.rows).toEqual([CONTACTO]);

        // Mandar el contacto en el alta, o cambiarlo después: sin privilegio de columna.
        denegado(
          await ej("update comprobante set sucursal_telefono = 'otro' where id = $1", [
            datos["id"],
          ]),
        );
        const conContacto = datosDeComprobante(e, { sucursal_telefono: "ajeno" });
        denegado(await insertarComprobante(ej, conContacto));
      });
      expect(
        (await c.query("select telefono from sucursal where id = $1", [otra.sucursal])).rows,
      ).toEqual([{ telefono: "7777-7777" }]);
    });

    it("la sonda del orden: `comprobante_alta_contacto` dispara después de `comprobante_alta` (el alfabeto lo decide)", async () => {
      const { rows } = await c.query<{ tgname: string }>(
        `select tgname from pg_trigger
          where tgrelid = 'public.comprobante'::regclass and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 4) = 4
          order by tgname`,
      );
      const nombres = rows.map((f) => f.tgname);
      expect(nombres.indexOf("comprobante_alta")).toBeGreaterThanOrEqual(0);
      expect(nombres.indexOf("comprobante_alta_contacto")).toBeGreaterThan(
        nombres.indexOf("comprobante_alta"),
      );
    });

    describe("editar el contacto y emitir a la vez (dos conexiones)", () => {
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

      for (const aislamiento of ["read committed", "serializable"] as const) {
        it(`${aislamiento}, el alta primero: la edición ESPERA hasta que el alta confirma y el comprobante congela el contacto de ANTES`, async () => {
          const e = await crearEscenario(c);
          await fijarContacto(c, e.sucursal, "1111-1111", null, null);
          const alta = await unaConexion();
          const edicion = await unaConexion();
          try {
            await alta.query(`begin isolation level ${aislamiento}`);
            const datos = datosDeComprobante(e);
            expect((await insertarComprobante(viaDuenoDirecto(alta), datos)).ok).toBe(true);
            await edicion.query("begin");
            const editando = edicion.query(
              "update sucursal set telefono = '2222-2222' where id = $1",
              [e.sucursal],
            );
            const estado = terminado(editando);
            await esperar(() => esperando("update sucursal"), "la edición espera al alta");
            expect(estado.listo).toBe(false);
            await alta.query("commit");
            await editando;
            await edicion.query("commit");
            expect(await congelado(c, datos["id"] as string)).toMatchObject({
              telefono: "1111-1111",
            });
            expect(
              (await c.query("select telefono from sucursal where id = $1", [e.sucursal])).rows,
            ).toEqual([{ telefono: "2222-2222" }]);
          } finally {
            await alta.query("rollback").catch(() => undefined);
            await edicion.query("rollback").catch(() => undefined);
            await alta.end();
            await edicion.end();
          }
        });
      }

      it("read committed, la edición primero: el alta ESPERA y, confirmada la edición, congela el contacto de DESPUÉS", async () => {
        const e = await crearEscenario(c);
        await fijarContacto(c, e.sucursal, "1111-1111", null, null);
        const alta = await unaConexion();
        const edicion = await unaConexion();
        try {
          await edicion.query("begin");
          await edicion.query("update sucursal set telefono = '2222-2222' where id = $1", [
            e.sucursal,
          ]);
          await alta.query("begin");
          const datos = datosDeComprobante(e);
          const insertando = insertarComprobante(viaDuenoDirecto(alta), datos);
          const estado = terminado(insertando);
          await esperar(() => esperando("insert into comprobante"), "el alta espera a la edición");
          expect(estado.listo).toBe(false);
          await edicion.query("commit");
          expect((await insertando).ok).toBe(true);
          await alta.query("commit");
          expect(await congelado(c, datos["id"] as string)).toMatchObject({
            telefono: "2222-2222",
          });
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await edicion.query("rollback").catch(() => undefined);
          await alta.end();
          await edicion.end();
        }
      });

      it("serializable, la edición primero: el alta ESPERA y, confirmada la edición, falla con 40001 (la aplicación repite y ve el contacto nuevo); no queda ningún comprobante", async () => {
        const e = await crearEscenario(c);
        await fijarContacto(c, e.sucursal, "1111-1111", null, null);
        const alta = await unaConexion();
        const edicion = await unaConexion();
        try {
          await alta.query("begin isolation level serializable");
          await alta.query("select 1");
          await edicion.query("begin");
          await edicion.query("update sucursal set telefono = '2222-2222' where id = $1", [
            e.sucursal,
          ]);
          const datos = datosDeComprobante(e);
          const insertando = insertarComprobante(viaDuenoDirecto(alta), datos);
          await esperar(() => esperando("insert into comprobante"), "el alta espera a la edición");
          await edicion.query("commit");
          const r = await insertando;
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.codigo).toBe("40001");
          await alta.query("rollback");
          expect(
            (await c.query("select 1 from comprobante where id = $1", [datos["id"]])).rows,
          ).toEqual([]);
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await edicion.query("rollback").catch(() => undefined);
          await alta.end();
          await edicion.end();
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

    /** Sonda: un comprobante nuevo congela los tres datos de la sucursal (sin confirmar nada). */
    const congelaTodo = async (): Promise<boolean> => {
      await fijarContacto(c, e.sucursal, TELEFONO, CORREO, WEB);
      const datos = datosDeComprobante(e);
      const r = await insertarComprobante(viaDueno(c), datos);
      if (!r.ok) return false;
      const f = await congelado(c, datos["id"] as string);
      return f.telefono === TELEFONO && f.correo === CORREO && f.web === WEB;
    };
    /** Sonda: lo que el dueño manda al insertar se pisa con lo de la sucursal. */
    const pisaLoAjeno = async (): Promise<boolean> => {
      await fijarContacto(c, e.sucursal, TELEFONO, CORREO, WEB);
      const datos = datosDeComprobante(e, {
        sucursal_telefono: "ajeno",
        sucursal_correo: "ajeno@x.com",
        sucursal_web: "ajeno.com",
      });
      const r = await insertarComprobante(viaDueno(c), datos);
      if (!r.ok) return false;
      const f = await congelado(c, datos["id"] as string);
      return f.telefono === TELEFONO && f.correo === CORREO && f.web === WEB;
    };
    /** Sonda: el contacto de un comprobante ya creado no se puede cambiar. */
    const esInmutable = async (): Promise<boolean> => {
      await fijarContacto(c, e.sucursal, TELEFONO, CORREO, WEB);
      const datos = datosDeComprobante(e);
      if (!(await insertarComprobante(viaDueno(c), datos)).ok) return false;
      const r = await viaDueno(c)(
        "update comprobante set sucursal_telefono = 'otro' where id = $1",
        [datos["id"]],
      );
      return !r.ok && r.restriccion === "comprobante_inmutable";
    };

    /** Sonda: aun sin `comprobante_alta` ni claves foráneas, un `sucursal_id` de otra empresa no trae su contacto. */
    const noTraeLoAjeno = async (): Promise<boolean> => {
      const otra = await crearEscenario(c);
      await fijarContacto(c, otra.sucursal, "7777-7777", "z@z.com", "z.com");
      await c.query("alter table comprobante disable trigger all");
      await c.query("alter table comprobante enable trigger comprobante_alta_contacto");
      const datos = datosDeComprobante(e, { sucursal_id: otra.sucursal });
      const columnas = Object.keys(datos);
      await c.query(
        `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(datos),
      );
      const f = await congelado(c, datos["id"] as string);
      return f.telefono === null && f.correo === null && f.web === null;
    };

    it("sin el filtro por empresa, el disparador copiaría el contacto de otra empresa (lo detecta el aislamiento)", async () => {
      expect(await sondear(() => Promise.resolve(), noTraeLoAjeno)).toBe(true);
      expect(
        await sondear(
          () => reescribir("comprobante_copiar_contacto", " AND s.empresa_id = NEW.empresa_id", ""),
          noTraeLoAjeno,
        ),
      ).toBe(false);
    });

    it("sana: las tres sondas cumplen", async () => {
      expect(await sondear(() => Promise.resolve(), congelaTodo)).toBe(true);
      expect(await sondear(() => Promise.resolve(), pisaLoAjeno)).toBe(true);
      expect(await sondear(() => Promise.resolve(), esInmutable)).toBe(true);
    });

    it("sin el disparador, el comprobante no congela nada (lo detecta la copia)", async () => {
      expect(
        await sondear(
          () =>
            c.query("drop trigger comprobante_alta_contacto on comprobante").then(() => undefined),
          congelaTodo,
        ),
      ).toBe(false);
    });

    it("si el disparador corriera antes que `comprobante_alta`, no tendría la sucursal y no copiaría nada (lo detecta la copia)", async () => {
      expect(
        await sondear(
          () =>
            c
              .query("alter trigger comprobante_alta_contacto on comprobante rename to a_contacto")
              .then(() => undefined),
          congelaTodo,
        ),
      ).toBe(false);
    });

    for (const [columna, asignacion] of [
      ["el teléfono", "NEW.sucursal_telefono := v_telefono;"],
      ["el correo", "NEW.sucursal_correo := v_correo;"],
      ["la web", "NEW.sucursal_web := v_web;"],
    ] as const) {
      it(`sin copiar ${columna}, ese dato no se congela (lo detecta la copia)`, async () => {
        expect(
          await sondear(
            () => reescribir("comprobante_copiar_contacto", asignacion, "NULL;"),
            congelaTodo,
          ),
        ).toBe(false);
      });
    }

    it("si el disparador respetara lo que mande quien inserta, ya no pisaría lo ajeno (lo detecta el pisado)", async () => {
      expect(
        await sondear(
          () =>
            reescribir(
              "comprobante_copiar_contacto",
              "NEW.sucursal_telefono := v_telefono;",
              "NEW.sucursal_telefono := coalesce(NEW.sucursal_telefono, v_telefono);",
            ),
          pisaLoAjeno,
        ),
      ).toBe(false);
    });

    it("si el contacto contara como columna de estado, el comprobante lo dejaría cambiar (lo detecta la inmutabilidad)", async () => {
      expect(
        await sondear(
          () =>
            reescribir(
              "comprobante_validar_cambio",
              "ARRAY['estado',",
              "ARRAY['sucursal_telefono', 'estado',",
            ),
          esInmutable,
        ),
      ).toBe(false);
    });

    for (const [columna, valorMalo] of [
      ["telefono", "43\n21"],
      ["correo", "sin-arroba"],
      ["web", "https://hotel.com"],
    ] as const) {
      it(`sin el CHECK de ${columna}, la sucursal acepta un valor mal formado (lo detecta el rechazo)`, async () => {
        const rechaza = async () =>
          (
            await viaDueno(c)(`update sucursal set ${columna} = $2 where id = $1`, [
              e.sucursal,
              valorMalo,
            ])
          ).ok === false;
        expect(await sondear(() => Promise.resolve(), rechaza)).toBe(true);
        expect(
          await sondear(
            () =>
              c
                .query(`alter table sucursal drop constraint sucursal_${columna}_ck`)
                .then(() => undefined),
            rechaza,
          ),
        ).toBe(false);
      });
    }

    describe("el FOR SHARE (necesita dos conexiones y una base por caso)", () => {
      /**
       * ¿Una edición concurrente del contacto de la sucursal de la FACTURA espera a una NOTA que ya copió el de antes? La nota sale por
       * el punto de venta de otra sucursal: el único bloqueo que le toca a la sucursal de la factura es el de este disparador (una
       * factura ya espera por el FOR SHARE de `comprobante_validar_alta`, 0017).
       */
      async function laEdicionEspera(
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
          // Desde 0020 el disparador del nombre también toma un FOR SHARE sobre esa sucursal y taparía esta sonda: se quita para probar solo
          // el del contacto.
          await admin.query("drop trigger comprobante_alta_sucursal_nombre on comprobante");
          await debilitar(admin);
          await alta.query("begin");
          const nota = await insertarComprobante(
            viaDuenoDirecto(alta),
            datosDeComprobante(x, { ...norte.porEse, ...notaSobre(factura, "NOTA_CREDITO") }),
          );
          if (!nota.ok) throw new Error(`no se pudo dar de alta la nota: ${nota.mensaje}`);
          await edicion.query("begin");
          await edicion.query("set local lock_timeout = '400ms'");
          try {
            await edicion.query("update sucursal set telefono = '2222-2222' where id = $1", [
              x.sucursal,
            ]);
            return false;
          } catch (error) {
            return (error as { code?: string }).code === "55P03";
          }
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
          "select pg_get_functiondef(oid) as def from pg_proc where proname = 'comprobante_copiar_contacto'",
        );
        const def = rows[0]?.def ?? "";
        if (!def.includes("FOR SHARE;")) throw new Error("la función no tiene FOR SHARE");
        await c2.query(def.replace("FOR SHARE;", ";"));
      };

      it("sana: la edición del contacto espera a la nota que está naciendo", async () => {
        expect(await laEdicionEspera(() => Promise.resolve())).toBe(true);
      });
      it("sin el FOR SHARE, la edición ya no espera a la nota (lo detecta la espera)", async () => {
        expect(await laEdicionEspera(sinBloqueo)).toBe(false);
      });
    });
  });

  // ===============================================================================================================
  // Reversión
  // ===============================================================================================================
  describe("la reversión (script aparte, DESTRUCTIVA en el contacto)", () => {
    it("sin contacto cargado ni congelado se aplica sola; con alguno exige confirmar y, confirmada, deja el catálogo como antes de 0019, se puede repetir y la migración se vuelve a aplicar", async () => {
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

        // Sin ningún contacto: no pide nada.
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const e = await crearEscenario(c);
        const viejo = await crearComprobante(c, e);
        expect(await filaDeLaMigracion()).toHaveLength(1);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await filaDeLaMigracion()).toEqual([]);

        // Con contacto en la sucursal (y congelado en un comprobante): sin confirmar no borra nada.
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await fijarContacto(c, e.sucursal, TELEFONO, CORREO, WEB);
        const congeladoEn = await crearComprobante(c, e);
        await c.query("begin");
        await expect(c.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/avisar al dueño/) as string,
        });
        await c.query("rollback");
        expect(await congelado(c, congeladoEn)).toEqual(CONTACTO);
        expect(
          (await c.query("select telefono from sucursal where id = $1", [e.sucursal])).rows,
        ).toEqual([{ telefono: TELEFONO }]);
        expect(await filaDeLaMigracion()).toHaveLength(1);

        // Confirmada: borra el contacto y deja el catálogo como antes; el resto de los datos sigue.
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
        expect(await filaDeLaMigracion()).toHaveLength(1);
        expect(await congelado(c, congeladoEn)).toEqual(SIN_CONTACTO);
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
