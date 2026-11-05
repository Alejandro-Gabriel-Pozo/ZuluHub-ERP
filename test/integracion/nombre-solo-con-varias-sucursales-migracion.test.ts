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
import { acepta, conAppDe, crearPuntoDeVenta } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";

/**
 * La migración 0023 (decisión del dueño, 2026-11-05, opción B): el comprobante congela el nombre de la sucursal SOLO si la empresa tenía
 * MÁS DE UNA sucursal ABIERTA (`activa`) al darse de alta; con una sola, la columna queda nula. Se prueba: que solo reemplaza el cuerpo de
 * la función de 0022 (sin tocar filas), cada borde de la regla (una abierta, dos, tres, una abierta y una cerrada, ninguna abierta, una
 * nota), que dos empresas no se mezclan, el rol de la aplicación bajo RLS, la idempotencia, la concurrencia con abrir o cerrar otra
 * sucursal, la inmutabilidad, un debilitamiento por pieza y la reversión (no destructiva).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "nombre_solo_con_varias_sucursales_abiertas";
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

/** El nombre que el comprobante congeló (nulo: nada que imprimir). */
async function congelado(c: pg.Client, id: string): Promise<string | null> {
  const { rows } = await c.query<{ n: string | null }>(
    "select sucursal_nombre as n from comprobante where id = $1",
    [id],
  );
  return (rows[0] as { n: string | null }).n;
}
async function nombreDe(c: pg.Client, sucursal: string): Promise<string> {
  const { rows } = await c.query<{ nombre: string }>("select nombre from sucursal where id = $1", [
    sucursal,
  ]);
  return (rows[0] as { nombre: string }).nombre;
}
/** Abre una sucursal más de la empresa (nace abierta). */
async function abrirSucursal(c: pg.Client, e: Escenario, nombre: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
    [e.empresa, nombre],
  );
  return (rows[0] as { id: string }).id;
}
const cerrarSucursal = (c: pg.Client, id: string) =>
  c.query("update sucursal set activa = false where id = $1", [id]);
const abrirDeNuevo = (c: pg.Client, id: string) =>
  c.query("update sucursal set activa = true where id = $1", [id]);

/** Un comprobante AUTORIZADO por el camino legal, por el punto de venta del escenario o por el que se indique. */
async function autorizado(
  c: pg.Client,
  e: Escenario,
  pv: { id: string; numero: number } = { id: e.pv, numero: e.pvNumero },
): Promise<string> {
  const ej = viaDueno(c);
  const datos = datosDeComprobante(e, {
    punto_de_venta_id: pv.id,
    punto_de_venta_numero: pv.numero,
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
const notaSobre = (factura: string) => ({
  clase: "NOTA_CREDITO",
  tipo_comprobante: "NOTA_CREDITO_B",
  comprobante_asociado_id: factura,
  motivo: "devolución",
});

describe.skipIf(base === null)(
  "nombre solo con varias sucursales abiertas: la migración 0023",
  () => {
    const b = () => base as BaseDePruebas;

    it("la cabecera declara lo que es (solo reemplaza el cuerpo de la función de 0022, sin SECURITY DEFINER ni superusuario, reversión aparte) y cita la fuente de «abierta»", async () => {
      const texto = await textoDeLaMigracion();
      const plano = texto.replace(/\n--\s*/g, " ");
      expect(plano).toMatch(/ADITIVA en el esquema/);
      expect(plano).toMatch(/DEPENDE de 0022/);
      expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
      // La fuente de «abierta» queda citada junto a la regla.
      expect(plano).toMatch(/`sucursal\.activa = true`/);
      expect(plano).toMatch(/resolverSucursal/);
      expect(plano).toMatch(/0017/);
      const codigo = texto.replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(
        /\b(DROP|TRUNCATE|CASCADE|DELETE|UPDATE\s+public|SECURITY\s+DEFINER|DISABLE\s+TRIGGER|REVOKE|GRANT|ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+TRIGGER|ADD\s+COLUMN)\b/i,
      );
      expect(codigo).not.toMatch(
        /\b(CREATE\s+ROLE|ALTER\s+ROLE|ALTER\s+SYSTEM|SET\s+ROLE|SET\s+SESSION|CREATE\s+EXTENSION|COPY|LANGUAGE\s+(c|plpython\w*|untrusted))\b/i,
      );
      expect(codigo.match(/\bINSERT\s+INTO\b/gi)).toBeNull();
      expect(codigo.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
      expect(codigo).toMatch(/s\.activa/);
      expect(codigo).toMatch(/s\.empresa_id = NEW\.empresa_id AND s\.activa/);
    });

    it("sobre una base con 0022 y datos no cambia ni una fila: solo cambia el cuerpo de la función; lo ya emitido conserva lo congelado; exige 0022 antes", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
      const conMia = await carpetaCon([
        ...(await migracionesPrevias()),
        await archivoDeLaMigracion(),
      ]);
      try {
        const c = previa.cliente;
        const e = await crearEscenario(c);
        const segunda = await abrirSucursal(c, e, "Segunda");
        const viejo = await crearComprobante(c, e);
        const emitido = await autorizado(c, e);
        expect(await congelado(c, viejo)).toBe(await nombreDe(c, e.sucursal));
        const huellaDeFilas = async () =>
          (
            await c.query<{ t: string; h: string }>(
              `select 'sucursal' as t, md5(string_agg(to_jsonb(x)::text, '|' order by id)) as h from sucursal x
             union all select 'comprobante', md5(string_agg(to_jsonb(x)::text, '|' order by id)) from comprobante x`,
            )
          ).rows;
        const [filasAntes, catalogoAntes] = [await huellaDeFilas(), await huellaDeCatalogo(c)];

        const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
        expect(await huellaDeFilas()).toEqual(filasAntes);
        expect(await congelado(c, viejo)).toBe("Casa central");
        expect(await congelado(c, emitido)).toBe("Casa central");

        // Del catálogo solo cambia la función: ninguna columna, restricción, disparador ni privilegio nuevo.
        const despues = await huellaDeCatalogo(c);
        const distintos = Object.keys(despues).filter(
          (k) => JSON.stringify(despues[k]) !== JSON.stringify(catalogoAntes[k]),
        );
        expect(distintos).toEqual(["funciones"]);

        // Desde ahora rige la regla: con dos abiertas congela; al cerrar una, no.
        expect(await congelado(c, await crearComprobante(c, e))).toBe("Casa central");
        await cerrarSucursal(c, segunda);
        expect(await congelado(c, await crearComprobante(c, e))).toBeNull();

        // Sin 0022 no corre.
        const sin0022 = (await migracionesPrevias()).filter((n) => n < "0022");
        const sin = await baseConMigraciones(b(), sin0022);
        const solaMia = await carpetaCon([...sin0022, await archivoDeLaMigracion()]);
        try {
          await expect(aplicarMigraciones(sin.aparte.base.dueno, solaMia)).rejects.toThrow(
            /0022_nombre_de_la_sucursal_en_el_comprobante/,
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

      it("una sola sucursal abierta: el nombre queda NULO (solo razón social)", async () => {
        const e = await crearEscenario(c);
        expect(await congelado(c, await crearComprobante(c, e))).toBeNull();
        expect(await congelado(c, await autorizado(c, e))).toBeNull();
      });

      it("dos sucursales abiertas: congela el nombre de la sucursal del comprobante (no el de la otra); con tres, también", async () => {
        const e = await crearEscenario(c);
        await abrirSucursal(c, e, "Playa");
        expect(await congelado(c, await crearComprobante(c, e))).toBe("Casa central");
        await abrirSucursal(c, e, "Centro");
        expect(await congelado(c, await crearComprobante(c, e))).toBe("Casa central");
        expect(await congelado(c, await autorizado(c, e))).toBe("Casa central");
      });

      it("una abierta y una cerrada: NULO; cerrar una de dos pasa a NULO; reabrirla vuelve a congelar; ninguna abierta de las demás cuenta como una sola", async () => {
        const e = await crearEscenario(c);
        const playa = await abrirSucursal(c, e, "Playa");
        await cerrarSucursal(c, playa);
        expect(await congelado(c, await crearComprobante(c, e))).toBeNull();
        await abrirDeNuevo(c, playa);
        expect(await congelado(c, await crearComprobante(c, e))).toBe("Casa central");
        await cerrarSucursal(c, playa);
        expect(await congelado(c, await crearComprobante(c, e))).toBeNull();
      });

      it("lo ya congelado no cambia cuando la empresa abre o cierra sucursales después, y el comprobante sigue inmutable (ni el dueño de la base lo toca)", async () => {
        const e = await crearEscenario(c);
        const solo = await crearComprobante(c, e);
        const playa = await abrirSucursal(c, e, "Playa");
        const dos = await crearComprobante(c, e);
        await cerrarSucursal(c, playa);
        expect(await congelado(c, solo)).toBeNull();
        expect(await congelado(c, dos)).toBe("Casa central");
        for (const [id, valor] of [
          [solo, "Casa central"],
          [dos, null],
          [dos, "Otro"],
        ] as const) {
          expect(
            await codigoDe(
              c.query("update comprobante set sucursal_nombre = $2 where id = $1", [id, valor]),
            ),
          ).toMatchObject({ code: "23514", constraint: "comprobante_inmutable" });
        }
        expect(await congelado(c, solo)).toBeNull();
        expect(await congelado(c, dos)).toBe("Casa central");
      });

      it("una nota toma el nombre de la sucursal de la factura que corrige, y la regla cuenta las abiertas de HOY: con dos, nombre; con una sola, NULO", async () => {
        const e = await crearEscenario(c);
        const norte = await abrirSucursal(c, e, "Norte");
        const pvNorte = await crearPuntoDeVenta(c, e, {
          numero: 2,
          sucursal: norte,
          domicilio: e.domicilio,
          activo: true,
        });
        const factura = await autorizado(c, e);
        expect(await congelado(c, factura)).toBe("Casa central");
        const porNorte = { punto_de_venta_id: pvNorte, punto_de_venta_numero: 2 };
        const conDos = await crearComprobante(c, e, { ...porNorte, ...notaSobre(factura) });
        expect(await congelado(c, conDos)).toBe("Casa central");
        await cerrarSucursal(c, norte);
        // Cerrada la otra, queda una sola abierta (la de la factura): la nota ya no lleva nombre. La factura conserva el suyo.
        const sola = await crearComprobante(c, e, notaSobre(factura));
        expect(await congelado(c, sola)).toBeNull();
        expect(await congelado(c, factura)).toBe("Casa central");
      });

      it("una nota sobre la factura de una sucursal que después se cerró, con otras dos abiertas, lleva el nombre de la sucursal de ESA factura", async () => {
        const e = await crearEscenario(c);
        const norte = await abrirSucursal(c, e, "Norte");
        const pvNorte = {
          id: await crearPuntoDeVenta(c, e, {
            numero: 2,
            sucursal: norte,
            domicilio: e.domicilio,
            activo: true,
          }),
          numero: 2,
        };
        const facturaDeNorte = await autorizado(c, e, pvNorte);
        expect(await congelado(c, facturaDeNorte)).toBe("Norte");
        await cerrarSucursal(c, norte);
        // Quedan abiertas "Casa central" sola: la nota (por el punto de venta de la casa central) NO congela nada.
        const sola = await crearComprobante(c, e, notaSobre(facturaDeNorte));
        expect(await congelado(c, sola)).toBeNull();
        // Con otra abierta más, congela el nombre de la sucursal de la factura corregida (Norte, cerrada), no el de la casa central.
        await abrirSucursal(c, e, "Sur");
        const conDos = await crearComprobante(c, e, notaSobre(facturaDeNorte));
        expect(await congelado(c, conDos)).toBe("Norte");
        expect(await congelado(c, facturaDeNorte)).toBe("Norte");
      });

      it("dos empresas no se mezclan: A con dos abiertas congela, B con una no; y al revés si A cierra una", async () => {
        const a = await crearEscenario(c);
        const z = await crearEscenario(c);
        const aPlaya = await abrirSucursal(c, a, "Playa de A");
        expect(await congelado(c, await crearComprobante(c, a))).toBe("Casa central");
        expect(await congelado(c, await crearComprobante(c, z))).toBeNull();
        // Las abiertas de A no cuentan para B, ni las de B para A.
        await abrirSucursal(c, z, "Playa de Z");
        await cerrarSucursal(c, aPlaya);
        expect(await congelado(c, await crearComprobante(c, a))).toBeNull();
        expect(await congelado(c, await crearComprobante(c, z))).toBe("Casa central");
      });

      it("con el rol de la APLICACIÓN (RLS): ve todas las sucursales de su empresa, cuenta las abiertas y congela solo con más de una; no cuenta las de otra empresa", async () => {
        const e = await crearEscenario(c);
        const otra = await crearEscenario(c);
        await abrirSucursal(c, otra, "Playa de la otra");
        await abrirSucursal(c, otra, "Norte de la otra");
        await conAppDe(propia.base, e, async (s) => {
          const ej = viaSesion(s);
          const leer = async (id: string) => {
            const r = await ej("select sucursal_nombre as n from comprobante where id = $1", [id]);
            acepta(r);
            return r.ok ? r.rows : [];
          };
          // Una sola abierta en su empresa (las dos de la otra no cuentan): nulo.
          const datos1 = datosDeComprobante(e);
          acepta(await insertarComprobante(ej, datos1));
          expect(await leer(datos1["id"] as string)).toEqual([{ n: null }]);
          // Abre la segunda con el rol de la aplicación: ahora congela.
          acepta(
            await ej("insert into sucursal (empresa_id, nombre) values ($1, 'Playa')", [e.empresa]),
          );
          const datos2 = datosDeComprobante(e);
          acepta(await insertarComprobante(ej, datos2));
          expect(await leer(datos2["id"] as string)).toEqual([{ n: "Casa central" }]);
        });
      });

      it("idempotencia: repetir el alta con el mismo origen no crea otro ni cambia lo congelado, aunque entre medio se abra otra sucursal", async () => {
        const e = await crearEscenario(c);
        const origen = { origen_id: "00000000-0000-4000-8000-0000000000aa" };
        const primero = await crearComprobante(c, e, origen);
        expect(await congelado(c, primero)).toBeNull();
        await abrirSucursal(c, e, "Playa");
        const repetido = await crearComprobante(c, e, origen).catch((error: Error) => error);
        expect(repetido).toBeInstanceOf(Error);
        expect((repetido as Error).message).toMatch(/23505|comprobante_manual_uk|duplic/i);
        const { rows } = await c.query(
          "select 1 from comprobante where empresa_id = $1 and origen_id = $2",
          [e.empresa, origen.origen_id],
        );
        expect(rows).toHaveLength(1);
        expect(await congelado(c, primero)).toBeNull();
      });

      describe("abrir o cerrar otra sucursal mientras se emite (dos conexiones)", () => {
        const unaConexion = async () => {
          const nueva = new pg.Client({ connectionString: propia.base.dueno });
          await nueva.connect();
          return nueva;
        };

        it("la apertura sin confirmar no cuenta: el alta no espera y congela NULO; confirmada la apertura, lo emitido sigue NULO e inmutable, y el siguiente congela", async () => {
          const e = await crearEscenario(c);
          const alta = await unaConexion();
          const apertura = await unaConexion();
          try {
            await apertura.query("begin");
            await apertura.query("insert into sucursal (empresa_id, nombre) values ($1, 'Playa')", [
              e.empresa,
            ]);
            await alta.query("begin");
            const datos = datosDeComprobante(e);
            expect((await insertarComprobante(viaDuenoDirecto(alta), datos)).ok).toBe(true);
            await apertura.query("commit");
            await alta.query("commit");
            const id = datos["id"] as string;
            expect(await congelado(c, id)).toBeNull();
            expect(
              await codigoDe(
                c.query("update comprobante set sucursal_nombre = 'x' where id = $1", [id]),
              ),
            ).toMatchObject({ code: "23514", constraint: "comprobante_inmutable" });
            expect(await congelado(c, await crearComprobante(c, e))).toBe("Casa central");
            expect(await congelado(c, id)).toBeNull();
          } finally {
            await alta.query("rollback").catch(() => undefined);
            await apertura.query("rollback").catch(() => undefined);
            await alta.end();
            await apertura.end();
          }
        });

        it("la apertura confirmada antes del alta cuenta: el alta congela el nombre", async () => {
          const e = await crearEscenario(c);
          const alta = await unaConexion();
          try {
            await abrirSucursal(c, e, "Playa");
            await alta.query("begin");
            const datos = datosDeComprobante(e);
            expect((await insertarComprobante(viaDuenoDirecto(alta), datos)).ok).toBe(true);
            await alta.query("commit");
            expect(await congelado(c, datos["id"] as string)).toBe("Casa central");
          } finally {
            await alta.query("rollback").catch(() => undefined);
            await alta.end();
          }
        });

        for (const aislamiento of ["read committed", "serializable"] as const) {
          it(`${aislamiento}, a la vez y varias veces: cada comprobante queda o sin nombre o con el de su sucursal, nunca otra cosa, y no se rompe la inmutabilidad`, async () => {
            for (let vuelta = 0; vuelta < 6; vuelta++) {
              const e = await crearEscenario(c);
              const alta = await unaConexion();
              const apertura = await unaConexion();
              try {
                const datos = datosDeComprobante(e);
                await alta.query(`begin isolation level ${aislamiento}`);
                const [rAlta, rApertura] = await Promise.all([
                  insertarComprobante(viaDuenoDirecto(alta), datos),
                  apertura.query("insert into sucursal (empresa_id, nombre) values ($1, 'Playa')", [
                    e.empresa,
                  ]),
                ]);
                expect(rApertura.rowCount).toBe(1);
                if (rAlta.ok) {
                  const confirmo = await alta.query("commit").then(
                    () => true,
                    (error: { code?: string }) => {
                      // Bajo SERIALIZABLE la base puede abortar con 40001 (la aplicación repite): no queda nada a medias.
                      expect(error.code).toBe("40001");
                      return false;
                    },
                  );
                  const nombre = confirmo ? await congelado(c, datos["id"] as string) : null;
                  expect([null, "Casa central"]).toContain(nombre);
                  if (!confirmo) {
                    expect(
                      (await c.query("select 1 from comprobante where id = $1", [datos["id"]]))
                        .rows,
                    ).toEqual([]);
                  }
                } else {
                  expect(aislamiento).toBe("serializable");
                  expect(rAlta.codigo).toBe("40001");
                  await alta.query("rollback");
                }
              } finally {
                await alta.query("rollback").catch(() => undefined);
                await apertura.end();
                await alta.end();
              }
            }
          });
        }
      });
    });

    // ===============================================================================================================
    // Debilitamientos: cada pieza de la regla tiene un chequeo que la detecta
    // ===============================================================================================================
    describe("debilitamientos (cada uno se deshace al terminar)", () => {
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

      async function reescribir(de: string, a: string): Promise<void> {
        const { rows } = await c.query<{ def: string }>(
          "select pg_get_functiondef(oid) as def from pg_proc where proname = 'comprobante_copiar_nombre_de_sucursal' and pronamespace = 'public'::regnamespace",
        );
        const def = rows[0]?.def ?? "";
        if (!def.includes(de)) throw new Error(`la función no contiene «${de}»`);
        await c.query(def.replace(de, a));
      }
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
      const nuevoComprobante = async (e: Escenario): Promise<string | null> => {
        const datos = datosDeComprobante(e);
        if (!(await insertarComprobante(viaDueno(c), datos)).ok) throw new Error("alta rechazada");
        return congelado(c, datos["id"] as string);
      };

      /** Sonda: una sola abierta no congela. */
      const unaSolaNoCongela = async () =>
        (await nuevoComprobante(await crearEscenario(c))) === null;
      /** Sonda: dos abiertas congelan el nombre. */
      const dosCongelan = async () => {
        const e = await crearEscenario(c);
        await abrirSucursal(c, e, "Playa");
        return (await nuevoComprobante(e)) === "Casa central";
      };
      /** Sonda: una abierta y una cerrada no congelan. */
      const cerradaNoCuenta = async () => {
        const e = await crearEscenario(c);
        await cerrarSucursal(c, await abrirSucursal(c, e, "Playa"));
        return (await nuevoComprobante(e)) === null;
      };
      /** Sonda: las abiertas de otra empresa no cuentan. */
      const otraEmpresaNoCuenta = async () => {
        const e = await crearEscenario(c);
        const otra = await crearEscenario(c);
        await abrirSucursal(c, otra, "Playa de la otra");
        return (await nuevoComprobante(e)) === null;
      };

      it("sana: las sondas cumplen", async () => {
        expect(await sondear(() => Promise.resolve(), unaSolaNoCongela)).toBe(true);
        expect(await sondear(() => Promise.resolve(), dosCongelan)).toBe(true);
        expect(await sondear(() => Promise.resolve(), cerradaNoCuenta)).toBe(true);
        expect(await sondear(() => Promise.resolve(), otraEmpresaNoCuenta)).toBe(true);
      });

      it("sin la condición «más de una», con una sola abierta congelaría el nombre (lo detecta «una sola no congela»)", async () => {
        expect(
          await sondear(
            () => reescribir("IF v_abiertas > 1 THEN", "IF true THEN"),
            unaSolaNoCongela,
          ),
        ).toBe(false);
      });

      it("exigir más de dos, o al menos una, rompe la regla (lo detectan «dos congelan» y «una sola no congela»)", async () => {
        expect(
          await sondear(
            () => reescribir("IF v_abiertas > 1 THEN", "IF v_abiertas > 2 THEN"),
            dosCongelan,
          ),
        ).toBe(false);
        expect(
          await sondear(
            () => reescribir("IF v_abiertas > 1 THEN", "IF v_abiertas >= 1 THEN"),
            unaSolaNoCongela,
          ),
        ).toBe(false);
      });

      it("si las cerradas contaran, una abierta y una cerrada congelarían (lo detecta «la cerrada no cuenta»)", async () => {
        expect(
          await sondear(() => reescribir(" AND s.activa LIMIT 2", " LIMIT 2"), cerradaNoCuenta),
        ).toBe(false);
      });

      it("sin el filtro por empresa en el conteo, las abiertas de otra empresa contarían (lo detecta el aislamiento)", async () => {
        expect(
          await sondear(
            () => reescribir("WHERE s.empresa_id = NEW.empresa_id AND s.activa", "WHERE s.activa"),
            otraEmpresaNoCuenta,
          ),
        ).toBe(false);
      });

      it("si el conteo se cortara en 1 en vez de 2, nunca habría 'más de una' (lo detecta «dos congelan»)", async () => {
        expect(await sondear(() => reescribir("LIMIT 2", "LIMIT 1"), dosCongelan)).toBe(false);
      });
    });

    // ===============================================================================================================
    // Reversión
    // ===============================================================================================================
    describe("la reversión (script aparte, no destructiva)", () => {
      it("restaura la función de 0022 (deja el catálogo como antes de 0023), no toca ninguna fila, se puede repetir y la migración se vuelve a aplicar", async () => {
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

          await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          const e = await crearEscenario(c);
          const sola = await crearComprobante(c, e); // una sola abierta: nulo
          await abrirSucursal(c, e, "Playa");
          const dos = await crearComprobante(c, e);
          expect(await congelado(c, sola)).toBeNull();
          expect(await congelado(c, dos)).toBe("Casa central");
          expect(await filaDeLaMigracion()).toHaveLength(1);

          await c.query(`begin; ${reversion}; commit;`);
          expect(await huellaDeCatalogo(c)).toEqual(antes);
          expect(await filaDeLaMigracion()).toEqual([]);
          // No toca filas: lo congelado sigue igual (el nulo no se recupera).
          expect(await congelado(c, sola)).toBeNull();
          expect(await congelado(c, dos)).toBe("Casa central");
          // Y vuelve a congelar siempre, como en 0022.
          const otra = await crearEscenario(c);
          expect(await congelado(c, await crearComprobante(c, otra))).toBe("Casa central");
          // Se puede repetir sin que cambie nada.
          await c.query(`begin; ${reversion}; commit;`);
          expect(await huellaDeCatalogo(c)).toEqual(antes);

          const reaplicada = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          expect(reaplicada.aplicadas).toEqual([await archivoDeLaMigracion()]);
          expect(await filaDeLaMigracion()).toHaveLength(1);
        } finally {
          await rm(conMia, { recursive: true, force: true });
          await previa.cerrar();
        }
      });

      it("la cabecera dice que NO es destructiva y no se recupera el nulo, que no la aplica el ejecutor y cómo se corre; el único DELETE es el de su fila del registro", async () => {
        const texto = await textoDeLaReversion();
        const plano = texto.replace(/\n--\s*/g, " ");
        expect(plano).toMatch(/NO es destructiva/);
        expect(plano).toMatch(/no se recupera/);
        expect(plano).toMatch(/NO lo aplica el ejecutor de migraciones/);
        expect(texto).toMatch(/BEGIN;/);
        const codigo = texto.replace(/--.*$/gm, "");
        const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
        expect(borrados).toHaveLength(1);
        expect(borrados[0]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
        expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE|DROP)\b/i);
      });
    });
  },
);
