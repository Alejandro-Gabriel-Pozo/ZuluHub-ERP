import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearEscenario } from "./facturacion-apoyo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";

/**
 * La migración 0018 (D-92, «un pedido de certificado nuevo anula al pendiente anterior del mismo ambiente»): el índice único
 * parcial `certificado_pendiente_uk` deja a lo sumo un `PEDIDO_GENERADO` por emisor y ambiente. Se prueba: que es aditiva en el
 * esquema (solo un índice), que sobre una base con pedidos pendientes repetidos deja el más reciente y descarta a los demás (con su
 * auditoría y sin tocar nada más), la restricción en SQL, que exige 0009 y su reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const SUFIJO = "pedido_de_certificado_unico";
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

type Escenario = Awaited<ReturnType<typeof crearEscenario>>;
const altaSql = `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem,
                                               clave_cifrada, clave_nonce, clave_etiqueta, clave_kid, creado_por, creado_en)
                 values ($1, $2, $3, $4, 'abc123', $5, 'P', $6, $7, $8, 'k1', $9, $10)`;
/** Un pedido pendiente con su `creado_en` a mano (para fijar cuál es el más reciente). */
async function pedido(
  c: pg.Client,
  e: Escenario,
  creadoEn: string,
  ambiente = "HOMOLOGACION",
  id: string = randomUUID(),
): Promise<string> {
  await c.query(altaSql, [
    id,
    e.empresa,
    e.emisor,
    ambiente,
    e.cuit,
    randomBytes(8),
    randomBytes(12),
    randomBytes(16),
    e.persona,
    creadoEn,
  ]);
  return id;
}
const filasDe = async (c: pg.Client, empresa: string) =>
  (
    await c.query<{ id: string; estado: string; version: number; h: string }>(
      "select id, estado, version, md5((to_jsonb(x) - 'estado' - 'version' - 'actualizado_en')::text) as h from certificado_arca x where empresa_id = $1 order by id",
      [empresa],
    )
  ).rows;

describe.skipIf(base === null)("pedido de certificado único: la migración 0018", () => {
  const b = () => base as BaseDePruebas;

  it("la cabecera declara lo que es: aditiva en el esquema, defensiva con los datos, sin DELETE ni SECURITY DEFINER, reversión aparte; el código es una limpieza y un índice", async () => {
    const texto = await textoDeLaMigracion();
    const plano = texto.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/Es ADITIVA en el esquema/);
    expect(plano).toMatch(/defensiva, no destructiva/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    expect(plano).toMatch(/DEPENDE de 0009/);
    const codigo = texto.replace(/--.*$/gm, "");
    expect(codigo.match(/CREATE UNIQUE INDEX/g)).toHaveLength(1);
    expect(codigo).toMatch(
      /CREATE UNIQUE INDEX certificado_pendiente_uk ON public\.certificado_arca \(empresa_id, emisor_id, ambiente\)\s+WHERE estado = 'PEDIDO_GENERADO'/,
    );
    // Los datos: una sola escritura de la tabla (pasar a DESCARTADO por la vía del disparador) y la auditoría de ese descarte.
    expect(codigo.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(codigo).toMatch(/UPDATE public\.certificado_arca c\s+SET estado = 'DESCARTADO'/);
    expect(codigo.match(/\bINSERT INTO\b/g)).toHaveLength(1);
    expect(codigo).toMatch(/INSERT INTO public\.auditoria_empresa/);
    expect(codigo).not.toMatch(
      /\b(DROP|TRUNCATE|CASCADE|DELETE|GRANT|REVOKE|ALTER|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|TABLE|POLICY)|DISABLE\s+TRIGGER|SECURITY\s+DEFINER)\b/i,
    );
  });

  it("sobre una base limpia solo agrega el índice; exige 0009 antes", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const antes = await huellaDeCatalogo(previa.cliente);
      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
      const despues = await huellaDeCatalogo(previa.cliente);
      const distintos = Object.keys(despues).filter(
        (k) => JSON.stringify(despues[k]) !== JSON.stringify(antes[k]),
      );
      expect(distintos).toEqual(["indices"]);
      expect(despues["indices"]?.filter((i) => !(antes["indices"] ?? []).includes(i))).toEqual([
        expect.stringMatching(
          /CREATE UNIQUE INDEX certificado_pendiente_uk ON public\.certificado_arca USING btree \(empresa_id, emisor_id, ambiente\) WHERE \(estado = 'PEDIDO_GENERADO'::text\)/,
        ) as string,
      ]);

      // Sin 0009 no corre.
      const previasSin0009 = (await migracionesPrevias()).filter((n) => n < "0009");
      const sin = await baseConMigraciones(b(), previasSin0009);
      const solaMia = await carpetaCon([...previasSin0009, await archivoDeLaMigracion()]);
      try {
        await expect(aplicarMigraciones(sin.aparte.base.dueno, solaMia)).rejects.toThrow(
          /0009_facturacion/,
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

  it("con pedidos pendientes repetidos de antes: deja el más reciente por emisor y ambiente, descarta a los demás con su auditoría y no toca nada más", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const e = await crearEscenario(c);
      const otra = await crearEscenario(c);
      // Homologación de E: tres pendientes, el más reciente NO es el último insertado; y a igual instante manda el id mayor.
      const viejo = await pedido(c, e, "2026-01-01T10:00:00Z");
      const reciente = await pedido(c, e, "2026-03-01T10:00:00Z");
      const medio = await pedido(c, e, "2026-02-01T10:00:00Z");
      // Producción de E: uno solo. Otra empresa: dos con el mismo instante (gana el id mayor).
      const deProduccion = await pedido(c, e, "2026-01-01T10:00:00Z", "PRODUCCION");
      const [menor, mayor] = [randomUUID(), randomUUID()].sort() as [string, string];
      await pedido(c, otra, "2026-04-01T10:00:00Z", "HOMOLOGACION", mayor);
      await pedido(c, otra, "2026-04-01T10:00:00Z", "HOMOLOGACION", menor);
      // Un VIGENTE de E en producción con un pendiente al lado: no se tocan entre sí.
      await c.query(
        `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'C', huella_sha256 = encode(sha256('v'::bytea), 'hex'),
                vence_en = now() + interval '1 year' where id = $1`,
        [deProduccion],
      );
      const pendienteDeProduccion = await pedido(c, e, "2026-05-01T10:00:00Z", "PRODUCCION");

      const antesE = await filasDe(c, e.empresa);
      const antesOtra = await filasDe(c, otra.empresa);
      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      const despuesE = await filasDe(c, e.empresa);
      const despuesOtra = await filasDe(c, otra.empresa);

      // Ninguna fila se borró y ningún contenido cambió (la clave cifrada, el pedido, el titular...: `h` excluye solo lo que se mueve).
      expect(despuesE.map((f) => f.id)).toEqual(antesE.map((f) => f.id));
      expect(despuesE.map((f) => f.h)).toEqual(antesE.map((f) => f.h));
      expect(despuesOtra.map((f) => f.h)).toEqual(antesOtra.map((f) => f.h));
      const estado = (filas: typeof despuesE, id: string) => filas.find((f) => f.id === id);
      expect(estado(despuesE, reciente)).toMatchObject({ estado: "PEDIDO_GENERADO", version: 1 });
      for (const id of [viejo, medio]) {
        expect(estado(despuesE, id)).toMatchObject({ estado: "DESCARTADO", version: 2 });
      }
      expect(estado(despuesE, deProduccion)).toMatchObject({ estado: "VIGENTE", version: 2 });
      expect(estado(despuesE, pendienteDeProduccion)).toMatchObject({
        estado: "PEDIDO_GENERADO",
        version: 1,
      });
      expect(estado(despuesOtra, mayor)).toMatchObject({ estado: "PEDIDO_GENERADO", version: 1 });
      expect(estado(despuesOtra, menor)).toMatchObject({ estado: "DESCARTADO", version: 2 });

      // Auditoría: una por descarte, de sistema (sin actor), con el pedido que lo reemplaza.
      const auditorias = (
        await c.query<{
          empresa_id: string;
          entidad_id: string;
          actor: string | null;
          antes: unknown;
          despues: unknown;
        }>(
          `select empresa_id, entidad_id, actor_persona_id as actor, antes, despues from auditoria_empresa
            where accion = 'CERTIFICADO_PEDIDO_DESCARTADO' order by entidad_id`,
        )
      ).rows;
      expect(auditorias.map((a) => a.entidad_id).sort()).toEqual([viejo, medio, menor].sort());
      for (const a of auditorias) {
        expect(a.actor).toBeNull();
        expect(a.antes).toEqual({ estado: "PEDIDO_GENERADO" });
        const reemplazo = a.entidad_id === menor ? mayor : reciente;
        expect(a.despues).toEqual({ estado: "DESCARTADO", reemplazadoPor: reemplazo });
      }
      expect(JSON.stringify(auditorias)).not.toMatch(/clave|PRIVATE/i);

      // El índice quedó puesto: otro pendiente del mismo emisor y ambiente ya no entra; otro ambiente sí.
      await expect(pedido(c, e, "2026-06-01T10:00:00Z")).rejects.toMatchObject({
        code: "23505",
        constraint: "certificado_pendiente_uk",
      });
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  describe("la restricción en SQL, con todas las migraciones", () => {
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

    it("un solo pendiente por emisor y ambiente; conviven otro ambiente, otra empresa, un vigente y un pedido nuevo cuando el anterior se descartó", async () => {
      const e = await crearEscenario(c);
      const otra = await crearEscenario(c);
      const ahora = new Date().toISOString();
      const primero = await pedido(c, e, ahora);
      await expect(pedido(c, e, ahora)).rejects.toMatchObject({
        code: "23505",
        constraint: "certificado_pendiente_uk",
      });
      await pedido(c, e, ahora, "PRODUCCION");
      await pedido(c, otra, ahora);
      // Con el anterior descartado (la transición que ya permite el disparador) entra el nuevo.
      await c.query("update certificado_arca set estado = 'DESCARTADO' where id = $1", [primero]);
      await pedido(c, e, ahora);
      // Un vigente no cuenta como pendiente: puede haber un vigente y un pendiente del mismo ambiente.
      const nuevo = (
        await c.query<{ id: string }>(
          "select id from certificado_arca where empresa_id = $1 and ambiente = 'HOMOLOGACION' and estado = 'PEDIDO_GENERADO'",
          [e.empresa],
        )
      ).rows[0]?.id as string;
      await c.query(
        `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'C', huella_sha256 = encode(sha256('w'::bytea), 'hex'),
                vence_en = now() + interval '1 year' where id = $1`,
        [nuevo],
      );
      await pedido(c, e, ahora);
      await expect(pedido(c, e, ahora)).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("la reversión (script aparte, no destructiva)", () => {
    it("borra el índice, deja el catálogo como antes de 0018, se puede repetir, no deshace el descarte de la limpieza y la migración se vuelve a aplicar", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
      const conMia = await carpetaCon([
        ...(await migracionesPrevias()),
        await archivoDeLaMigracion(),
      ]);
      try {
        const c = previa.cliente;
        const antes = await huellaDeCatalogo(c);
        const e = await crearEscenario(c);
        const viejo = await pedido(c, e, "2026-01-01T10:00:00Z");
        await pedido(c, e, "2026-02-01T10:00:00Z");
        const filaDeLaMigracion = async () =>
          (
            await c.query<{ n: number }>("select 1 as n from migracion where nombre = $1", [
              await archivoDeLaMigracion(),
            ])
          ).rows;
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await filaDeLaMigracion()).toHaveLength(1);

        const reversion = await textoDeLaReversion();
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await filaDeLaMigracion()).toEqual([]);
        // Sin el índice vuelven a poder convivir dos pendientes; el descartado de la limpieza sigue descartado.
        await pedido(c, e, "2026-03-01T10:00:00Z");
        await pedido(c, e, "2026-04-01T10:00:00Z");
        expect(
          (
            await c.query<{ estado: string }>("select estado from certificado_arca where id = $1", [
              viejo,
            ])
          ).rows[0]?.estado,
        ).toBe("DESCARTADO");
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        // Con dos pendientes de nuevo, volver a aplicar limpia y vuelve a poner el índice.
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
        expect(await filaDeLaMigracion()).toHaveLength(1);
        expect(
          (
            await c.query(
              "select 1 from certificado_arca where empresa_id = $1 and estado = 'PEDIDO_GENERADO'",
              [e.empresa],
            )
          ).rowCount,
        ).toBe(1);
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
      expect(codigo).toMatch(/DROP INDEX IF EXISTS public\.certificado_pendiente_uk;/);
      // El único DELETE es el de su propia fila del registro de migraciones; ningún dato de negocio se borra.
      const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
      expect(borrados).toHaveLength(1);
      expect(borrados[0]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
      expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
    });
  });
});
