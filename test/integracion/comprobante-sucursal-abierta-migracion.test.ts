import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  insertarComprobante,
  viaDueno,
  viaDuenoDirecto,
} from "./facturacion-apoyo";
import { crearPuntoDeVenta } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { crearBaseAparte } from "./entorno";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";

/**
 * La migración 0017 (D-50, «una sucursal cerrada no emite»): `comprobante_validar_alta` mira la sucursal de su punto de venta con
 * FOR SHARE y rechaza la cerrada. Se prueba: que es aditiva y no cambia ningún dato, el comportamiento en SQL, los DOS órdenes de la
 * carrera contra el cierre de la sucursal (con `pg_stat_activity`, en `read committed` y en `serializable`), que cada pieza de la
 * regla tiene su debilitamiento detectado, y su reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const SUFIJO = "comprobante_sucursal_abierta";
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

/** El cuerpo de la función de alta tal como lo guarda la base, para reescribirlo (un debilitamiento) dentro de la transacción. */
async function reescribirAlta(c: pg.Client, de: string, a: string): Promise<void> {
  const { rows } = await c.query<{ def: string }>(
    "select pg_get_functiondef(oid) as def from pg_proc where proname = 'comprobante_validar_alta' and pronamespace = 'public'::regnamespace",
  );
  const def = rows[0]?.def ?? "";
  if (!def.includes(de)) throw new Error(`la función no contiene «${de}»`);
  await c.query(def.replace(de, a));
}

/** Un escenario con una segunda sucursal que tiene un punto de venta ACTIVO (el 2). */
async function conSucursalDelSegundoPuntoDeVenta(c: pg.Client) {
  const e = await crearEscenario(c);
  const sur = (
    await c.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Sur') returning id",
      [e.empresa],
    )
  ).rows[0]?.id as string;
  const pvSur = await crearPuntoDeVenta(c, e, {
    numero: 2,
    sucursal: sur,
    domicilio: e.domicilio,
    activo: true,
  });
  const delSur = (cambios: Record<string, unknown> = {}) =>
    datosDeComprobante(e, { punto_de_venta_id: pvSur, punto_de_venta_numero: 2, ...cambios });
  return { e, sur, pvSur, delSur };
}

describe.skipIf(base === null)("comprobante en sucursal abierta: la migración 0017", () => {
  const b = () => base as BaseDePruebas;

  // =============================================================================================================
  // Aditiva
  // =============================================================================================================
  it("la cabecera declara lo que es: aditiva, no destructiva, sin SECURITY DEFINER ni privilegios, reversión aparte; y el código solo reemplaza la función", async () => {
    const texto = await textoDeLaMigracion();
    const plano = texto.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/Es ADITIVA/);
    expect(plano).toMatch(/NO es destructiva/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    expect(plano).toMatch(/DEPENDE de 0016/);
    const codigo = texto.replace(/--.*$/gm, "");
    expect(codigo.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(codigo).not.toMatch(/\bSECURITY DEFINER\b/i);
    expect(codigo).not.toMatch(
      /\b(DROP|TRUNCATE|CASCADE|DELETE|GRANT|REVOKE|ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+TRIGGER|UPDATE\s+\w+\s+SET|INSERT\s+INTO)\b/i,
    );
  });

  it("sobre una base con comprobantes aplica sin cambiar ni un dato ni nada del catálogo salvo el cuerpo de la función; y exige 0016 antes", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const { e, sur, delSur } = await conSucursalDelSegundoPuntoDeVenta(c);
      await crearComprobante(c, e);
      await crearComprobante(c, e, delSur());
      // Una sucursal cerrada con un comprobante viejo adentro: la migración no lo revalida.
      await c.query("update sucursal set activa = false where id = $1", [sur]);
      const datos = async () =>
        (
          await c.query<{ id: string; h: string }>(
            "select id, md5(to_jsonb(x)::text) as h from comprobante x order by id",
          )
        ).rows;
      const antesDatos = await datos();
      const antesCatalogo = await huellaDeCatalogo(c);
      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await datos()).toEqual(antesDatos);
      const despues = await huellaDeCatalogo(c);
      const distintos = Object.keys(despues).filter(
        (k) => JSON.stringify(despues[k]) !== JSON.stringify(antesCatalogo[k]),
      );
      expect(distintos).toEqual(["funciones"]);

      // Sin 0016 no corre.
      const sin0016 = await baseConMigraciones(
        b(),
        (await migracionesPrevias()).filter((n) => !n.startsWith("0016")),
      );
      const solaMia = await carpetaCon([
        ...(await migracionesPrevias()).filter((n) => !n.startsWith("0016")),
        await archivoDeLaMigracion(),
      ]);
      try {
        await expect(aplicarMigraciones(sin0016.aparte.base.dueno, solaMia)).rejects.toThrow(
          /0016_comprobante_con_sucursal/,
        );
      } finally {
        await rm(solaMia, { recursive: true, force: true });
        await sin0016.cerrar();
      }
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  // =============================================================================================================
  // Comportamiento y carrera, en una base con todas las migraciones
  // =============================================================================================================
  describe("en SQL, con dos conexiones", () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let admin: pg.Client;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(b());
      admin = new pg.Client({ connectionString: propia.base.dueno });
      await admin.connect();
    });
    afterAll(async () => {
      await admin.end();
      await propia.destruir();
    });

    const unaConexion = async () => {
      const c = new pg.Client({ connectionString: propia.base.dueno });
      await c.connect();
      return c;
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
          await admin.query<{ n: string }>(
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

    it("una sucursal abierta emite; una CERRADA no, aunque su punto de venta siga activo: 23514 `comprobante_sucursal_cerrada`", async () => {
      const { e, sur, pvSur, delSur } = await conSucursalDelSegundoPuntoDeVenta(admin);
      expect(
        (await admin.query("select estado from punto_de_venta where id = $1", [pvSur])).rows,
      ).toEqual([{ estado: "ACTIVO" }]);
      await crearComprobante(admin, e, delSur());
      await admin.query("update sucursal set activa = false where id = $1", [sur]);
      await admin.query("begin");
      const r = await insertarComprobante(viaDueno(admin), delSur());
      await admin.query("rollback");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.codigo).toBe("23514");
        expect(r.restriccion).toBe("comprobante_sucursal_cerrada");
      }
      // La otra sucursal de la misma empresa sigue emitiendo, y al reabrir la cerrada también.
      await crearComprobante(admin, e);
      await admin.query("update sucursal set activa = true where id = $1", [sur]);
      await crearComprobante(admin, e, delSur());
    });

    it("si el punto de venta ya estaba mal (inactivo), manda el error de siempre y no el de la sucursal", async () => {
      const { sur, pvSur, delSur } = await conSucursalDelSegundoPuntoDeVenta(admin);
      await admin.query("update punto_de_venta set estado = 'INACTIVO' where id = $1", [pvSur]);
      await admin.query("update sucursal set activa = false where id = $1", [sur]);
      await admin.query("begin");
      const r = await insertarComprobante(viaDueno(admin), delSur());
      await admin.query("rollback");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.restriccion).toBe("comprobante_alta_invalida");
    });

    for (const aislamiento of ["read committed", "serializable"] as const) {
      it(`${aislamiento}, el alta primero: el cierre ESPERA (pg_stat_activity) hasta que el alta confirma, y el comprobante queda`, async () => {
        const { sur, delSur } = await conSucursalDelSegundoPuntoDeVenta(admin);
        const alta = await unaConexion();
        const cierre = await unaConexion();
        try {
          await alta.query(`begin isolation level ${aislamiento}`);
          const datos = delSur();
          expect((await insertarComprobante(viaDuenoDirecto(alta), datos)).ok).toBe(true);
          await cierre.query("begin");
          const cerrando = cierre.query("update sucursal set activa = false where id = $1", [sur]);
          const estado = terminado(cerrando);
          await esperar(() => esperando("update sucursal"), "el cierre espera al alta");
          expect(estado.listo).toBe(false);
          await alta.query("commit");
          await cerrando;
          await cierre.query("commit");
          const { rows } = await admin.query("select sucursal_id from comprobante where id = $1", [
            datos["id"],
          ]);
          expect(rows).toEqual([{ sucursal_id: sur }]);
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await cierre.query("rollback").catch(() => undefined);
          await alta.end();
          await cierre.end();
        }
      });

      it(`${aislamiento}, el cierre primero: el alta ESPERA (pg_stat_activity) y, confirmado el cierre, no queda ningún comprobante (${
        aislamiento === "serializable" ? "40001: la aplicación repite y lo ve cerrado" : "23514"
      })`, async () => {
        const { sur, delSur } = await conSucursalDelSegundoPuntoDeVenta(admin);
        const alta = await unaConexion();
        const cierre = await unaConexion();
        try {
          await alta.query(`begin isolation level ${aislamiento}`);
          // La instantánea de la alta es anterior al cierre (la primera sentencia la fija).
          await alta.query("select 1");
          await cierre.query("begin");
          await cierre.query("update sucursal set activa = false where id = $1", [sur]);
          const datos = delSur();
          const insertando = insertarComprobante(viaDuenoDirecto(alta), datos);
          const estado = terminado(insertando);
          await esperar(() => esperando("insert into comprobante"), "el alta espera al cierre");
          expect(estado.listo).toBe(false);
          await cierre.query("commit");
          const r = await insertando;
          expect(r.ok).toBe(false);
          if (!r.ok) {
            if (aislamiento === "serializable") {
              expect(r.codigo).toBe("40001");
            } else {
              expect(r.codigo).toBe("23514");
              expect(r.restriccion).toBe("comprobante_sucursal_cerrada");
            }
          }
          await alta.query("rollback");
          expect(
            (await admin.query("select 1 from comprobante where id = $1", [datos["id"]])).rows,
          ).toEqual([]);
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await cierre.query("rollback").catch(() => undefined);
          await alta.end();
          await cierre.end();
        }
      });
    }

    it("el cierre primero que se deshace: el alta que esperaba sigue y confirma", async () => {
      const { sur, delSur } = await conSucursalDelSegundoPuntoDeVenta(admin);
      const alta = await unaConexion();
      const cierre = await unaConexion();
      try {
        await cierre.query("begin");
        await cierre.query("update sucursal set activa = false where id = $1", [sur]);
        await alta.query("begin");
        const datos = delSur();
        const insertando = insertarComprobante(viaDuenoDirecto(alta), datos);
        await esperar(() => esperando("insert into comprobante"), "el alta espera al cierre");
        await cierre.query("rollback");
        expect((await insertando).ok).toBe(true);
        await alta.query("commit");
        expect(
          (await admin.query("select 1 from comprobante where id = $1", [datos["id"]])).rows,
        ).toHaveLength(1);
      } finally {
        await alta.query("rollback").catch(() => undefined);
        await cierre.query("rollback").catch(() => undefined);
        await alta.end();
        await cierre.end();
      }
    });
  });

  // =============================================================================================================
  // Debilitamientos: cada pieza de la regla tiene un chequeo que la detecta
  // =============================================================================================================
  describe("debilitamientos (una base por caso)", () => {
    async function conBaseNueva<T>(
      trabajo: (
        c: pg.Client,
        x: Awaited<ReturnType<typeof conSucursalDelSegundoPuntoDeVenta>>,
      ) => Promise<T>,
    ): Promise<T> {
      const aparte = await crearBaseAparte(b());
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        return await trabajo(c, await conSucursalDelSegundoPuntoDeVenta(c));
      } finally {
        await c.end();
        await aparte.destruir();
      }
    }

    const EXIGE_ABIERTA = "IF FOUND AND NOT v_sucursal_abierta THEN";
    const BLOQUEA =
      "WHERE s.id = v_pv.sucursal_id AND s.empresa_id = NEW.empresa_id\n       FOR SHARE;";

    /** ¿La sucursal cerrada rechaza el alta? */
    const rechazaLaCerrada = async (
      c: pg.Client,
      x: { sur: string; delSur: () => Record<string, unknown> },
    ) => {
      await c.query("update sucursal set activa = false where id = $1", [x.sur]);
      await c.query("begin");
      const r = await insertarComprobante(viaDueno(c), x.delSur());
      await c.query("rollback");
      return !r.ok && r.restriccion === "comprobante_sucursal_cerrada";
    };

    /** ¿Un cierre concurrente espera al alta que ya miró la sucursal? */
    const elCierreEspera = async (
      b2: BaseDePruebas,
      c: pg.Client,
      x: { sur: string; delSur: () => Record<string, unknown> },
    ) => {
      const alta = new pg.Client({ connectionString: b2.dueno });
      const cierre = new pg.Client({ connectionString: b2.dueno });
      await alta.connect();
      await cierre.connect();
      try {
        await alta.query("begin");
        await insertarComprobante(viaDuenoDirecto(alta), x.delSur());
        await cierre.query("begin");
        await cierre.query("set local lock_timeout = '400ms'");
        try {
          await cierre.query("update sucursal set activa = false where id = $1", [x.sur]);
          return false;
        } catch (error) {
          return (error as { code?: string }).code === "55P03";
        }
      } finally {
        await alta.query("rollback").catch(() => undefined);
        await cierre.query("rollback").catch(() => undefined);
        await alta.end();
        await cierre.end();
      }
    };

    it("sana: rechaza la sucursal cerrada y el cierre espera al alta", async () => {
      const aparte = await crearBaseAparte(b());
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const x = await conSucursalDelSegundoPuntoDeVenta(c);
        expect(await elCierreEspera(aparte.base, c, x)).toBe(true);
        expect(await rechazaLaCerrada(c, x)).toBe(true);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });

    it("sin mirar si la sucursal está abierta, la cerrada emite (lo detecta el rechazo)", async () => {
      await conBaseNueva(async (c, x) => {
        await reescribirAlta(c, EXIGE_ABIERTA, "IF false THEN");
        expect(await rechazaLaCerrada(c, x)).toBe(false);
      });
    });

    it("sin el FOR SHARE de la sucursal, un cierre concurrente ya no espera al alta (lo detecta la espera)", async () => {
      const aparte = await crearBaseAparte(b());
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const x = await conSucursalDelSegundoPuntoDeVenta(c);
        await reescribirAlta(
          c,
          BLOQUEA,
          "WHERE s.id = v_pv.sucursal_id AND s.empresa_id = NEW.empresa_id;",
        );
        expect(await elCierreEspera(aparte.base, c, x)).toBe(false);
        // Sigue rechazando a la cerrada: lo que se perdió es solo el bloqueo.
        expect(await rechazaLaCerrada(c, x)).toBe(true);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });

  // =============================================================================================================
  // Reversión
  // =============================================================================================================
  describe("la reversión (script aparte, no destructiva)", () => {
    it("devuelve la función de 0016: la sucursal cerrada vuelve a poder emitir, el catálogo queda como antes de 0017, se puede repetir y la migración se vuelve a aplicar", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
      const conMia = await carpetaCon([
        ...(await migracionesPrevias()),
        await archivoDeLaMigracion(),
      ]);
      try {
        const c = previa.cliente;
        const antes = await huellaDeCatalogo(c);
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const x = await conSucursalDelSegundoPuntoDeVenta(c);
        await c.query("update sucursal set activa = false where id = $1", [x.sur]);
        await c.query("begin");
        const rechazada = await insertarComprobante(viaDueno(c), x.delSur());
        await c.query("rollback");
        expect(rechazada.ok).toBe(false);

        const reversion = await textoDeLaReversion();
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        await crearComprobante(c, x.e, x.delSur());
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        // Se marca como no aplicada para volver a correrla.
        await c.query("delete from migracion where nombre = $1", [await archivoDeLaMigracion()]);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("la cabecera dice que no es destructiva, que no la aplica el ejecutor y cómo se corre", async () => {
      const texto = await textoDeLaReversion();
      expect(texto).toMatch(/NO ES DESTRUCTIVA/);
      expect(texto).toMatch(/NO lo aplica el ejecutor de migraciones/);
      expect(texto).toMatch(/BEGIN;/);
      const codigo = texto.replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(/\b(DROP|TRUNCATE|CASCADE|DELETE)\b/i);
    });
  });
});
