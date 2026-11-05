import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearComprobante, crearEscenario, type Escenario } from "./facturacion-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";

/**
 * La migración 0021 (D-115 y D-116: Ingresos Brutos del emisor es el número O «No contribuyente»). Se prueba: que es ADITIVA sobre una
 * base con datos (no cambia ni una fila de `datos_fiscales` ni de `comprobante`; del catálogo solo cambian los CHECK de condición y los
 * dos de elección), que los valores anteriores siguen leyéndose, que el comprobante congela «No contribuyente» y la base sigue
 * exigiendo que coincida con la versión de datos fiscales, que exige 0009 antes y la reversión (se niega si ya hay un
 * «No contribuyente», si no deja el catálogo como antes y se puede repetir). El rol que NO es superusuario la corre en
 * `migraciones-sin-superusuario.test.ts`, que aplica toda la carpeta como `neondb_owner`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "ingresos_brutos_no_contribuyente";
const archivoDe = async (carpeta: string, patron: RegExp): Promise<string> => {
  const encontrados = (await readdir(carpeta)).filter((n) => patron.test(n));
  if (encontrados.length !== 1) throw new Error(`debería haber uno, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const archivoDeLaMigracion = () =>
  archivoDe(CARPETA_DE_MIGRACIONES, new RegExp(`^\\d{4}_${SUFIJO}\\.sql$`));
const archivoDeLaReversion = () =>
  archivoDe(
    join(CARPETA_DE_MIGRACIONES, "reversiones"),
    new RegExp(`^\\d{4}_revertir_${SUFIJO}\\.sql$`),
  );
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await readdir(CARPETA_DE_MIGRACIONES))
    .sort()
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};
const texto = async (ruta: string[]) => readFile(join(CARPETA_DE_MIGRACIONES, ...ruta), "utf8");

/** Una versión CONFIRMADA de datos fiscales para el emisor del escenario, con el IIBB que se pida. */
async function versionDeDatosFiscales(
  c: pg.Client,
  e: Escenario,
  numero: number,
  iibbNumero: string | null,
  iibbCondicion: string | null,
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                                 inicio_actividades, iibb_numero, iibb_condicion, creado_por)
     values ($1, $2, $3, $4, $5, $6, '2020-01-01', $7, $8, $9)`,
    [
      id,
      e.empresa,
      e.emisor,
      e.razonSocial,
      e.condicionIva,
      e.domicilio,
      iibbNumero,
      iibbCondicion,
      e.persona,
    ],
  );
  await c.query(
    `update datos_fiscales set estado = 'CONFIRMADA', numero = $2, vigente_desde = now(), confirmada_en = now(),
            confirmada_por = $3, motivo = 'alta' where id = $1`,
    [id, numero, e.persona],
  );
  return id;
}

describe.skipIf(base === null)("Ingresos Brutos «No contribuyente»: la migración 0021", () => {
  const b = () => base as BaseDePruebas;

  it("la cabecera declara lo que es (aditiva, sin SECURITY DEFINER, reversión aparte) y el código solo reemplaza dos CHECK y suma dos", async () => {
    const sql = await texto([await archivoDeLaMigracion()]);
    const plano = sql.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/Es ADITIVA/);
    expect(plano).toMatch(/DEPENDE de 0009/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    const codigo = sql.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(
      /\b(TRUNCATE|CASCADE|DELETE|UPDATE\s|INSERT\s|SECURITY\s+DEFINER|DISABLE\s+TRIGGER|REVOKE|GRANT|OR\s+REPLACE|DROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER))\b/i,
    );
    // Los únicos DROP son los de los dos CHECK de condición que se reemplazan por otro más ancho.
    expect(codigo.match(/DROP\s+CONSTRAINT\s+(\w+)/gi)?.map((x) => x.split(/\s+/)[2])).toEqual([
      "datos_fiscales_iibb_condicion_ck",
      "comprobante_emisor_iibb_condicion_ck",
    ]);
  });

  it("sobre una base con datos no cambia ni una fila ni una `version`: lo de antes (incluida una condición anterior) sigue igual y legible; solo cambian los CHECK; y exige 0009 antes", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      // El escenario trae datos fiscales con número y la condición anterior LOCAL, y un comprobante que la congeló.
      const e = await crearEscenario(c);
      const viejo = await crearComprobante(c, e);
      const huella = async () =>
        (
          await c.query<{ t: string; id: string; h: string }>(
            `select 'datos_fiscales' as t, id::text, md5(to_jsonb(x)::text) as h from datos_fiscales x
             union all select 'comprobante', id::text, md5(to_jsonb(x)::text) from comprobante x order by 1, 2`,
          )
        ).rows;
      const [antes, catalogoAntes] = [await huella(), await huellaDeCatalogo(c)];

      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await huella()).toEqual(antes);
      expect(
        (
          await c.query(
            "select emisor_iibb_numero, emisor_iibb_condicion from comprobante where id = $1",
            [viejo],
          )
        ).rows,
      ).toEqual([{ emisor_iibb_numero: "901-123456-7", emisor_iibb_condicion: "LOCAL" }]);

      const despues = await huellaDeCatalogo(c);
      expect(
        Object.keys(despues).filter(
          (k) => JSON.stringify(despues[k]) !== JSON.stringify(catalogoAntes[k]),
        ),
      ).toEqual(["restricciones"]);
      const nuevas = (despues["restricciones"] ?? []).filter(
        (x) => !(catalogoAntes["restricciones"] ?? []).includes(x),
      );
      expect(nuevas.map((x) => x.split(":")[0]?.split(".")[1]).sort()).toEqual([
        "comprobante_emisor_iibb_condicion_ck",
        "comprobante_emisor_iibb_eleccion_ck",
        "datos_fiscales_iibb_condicion_ck",
        "datos_fiscales_iibb_eleccion_ck",
      ]);

      // Sin 0009 no corre.
      const sin0009 = (await migracionesPrevias()).filter((n) => n < "0009");
      const sin = await baseConMigraciones(b(), sin0009);
      const solaMia = await carpetaCon([...sin0009, await archivoDeLaMigracion()]);
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

  it("el comprobante congela «No contribuyente» sin número, y la base sigue exigiendo que coincida con la versión de datos fiscales", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      const e = await crearEscenario(c);
      const nc = await versionDeDatosFiscales(c, e, 2, null, "NO_CONTRIBUYENTE");
      const con = (cambios: Record<string, unknown>) => ({
        datos_fiscales_id: nc,
        emisor_iibb_numero: null,
        emisor_iibb_condicion: "NO_CONTRIBUYENTE",
        ...cambios,
      });
      const id = await crearComprobante(c, e, con({}));
      expect(
        (
          await c.query(
            "select emisor_iibb_numero, emisor_iibb_condicion from comprobante where id = $1",
            [id],
          )
        ).rows,
      ).toEqual([{ emisor_iibb_numero: null, emisor_iibb_condicion: "NO_CONTRIBUYENTE" }]);
      // Lo que no coincide con la versión (número en vez de «No contribuyente», o nada) lo rechaza el disparador de alta.
      for (const cambios of [
        { emisor_iibb_numero: "901-123456-7", emisor_iibb_condicion: null },
        { emisor_iibb_numero: null, emisor_iibb_condicion: null },
      ]) {
        await expect(crearComprobante(c, e, con(cambios))).rejects.toThrow(
          /comprobante_alta_invalida/,
        );
      }
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  it("la reversión se niega si ya hay un «No contribuyente» guardado; si no, deja el catálogo como antes, se puede repetir y la migración se vuelve a aplicar", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const antes = await huellaDeCatalogo(c);
      const reversion = await texto(["reversiones", await archivoDeLaReversion()]);
      const registro = async () =>
        (await c.query("select 1 from migracion where nombre = $1", [await archivoDeLaMigracion()]))
          .rows;

      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      const e = await crearEscenario(c);
      expect(await registro()).toHaveLength(1);

      // Con un «No contribuyente» guardado se niega y no toca nada.
      const nc = await versionDeDatosFiscales(c, e, 2, null, "NO_CONTRIBUYENTE");
      const despuesDeAplicar = await huellaDeCatalogo(c);
      await c.query("begin");
      await expect(c.query(reversion)).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/No contribuyente/) as string,
      });
      await c.query("rollback");
      expect(await huellaDeCatalogo(c)).toEqual(despuesDeAplicar);
      expect(await registro()).toHaveLength(1);
      expect(
        (await c.query("select iibb_condicion from datos_fiscales where id = $1", [nc])).rows,
      ).toEqual([{ iibb_condicion: "NO_CONTRIBUYENTE" }]);

      // Sin ninguno (se pasa a un escenario aparte: este caso quita el dato con el dueño, como lo haría una corrección manual).
      await c.query("alter table datos_fiscales disable trigger user");
      await c.query("delete from datos_fiscales where id = $1", [nc]);
      await c.query("alter table datos_fiscales enable trigger user");
      await c.query(`begin; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);
      expect(await registro()).toEqual([]);
      // Se puede repetir sin que cambie nada.
      await c.query(`begin; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);

      const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await registro()).toHaveLength(1);
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });
});
