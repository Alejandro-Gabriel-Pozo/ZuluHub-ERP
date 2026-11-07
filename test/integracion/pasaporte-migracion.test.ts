import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { numeroDeDocumentoDesdeTexto } from "../../src/primitivas/identificacion-fiscal/documento";
import {
  CARACTERES_PERMITIDOS_DE_PASAPORTE,
  LARGO_MAXIMO_DE_PASAPORTE,
  LARGO_MINIMO_DE_PASAPORTE,
} from "../../src/primitivas/identificacion-fiscal/pasaporte";
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
 * La migración 0024 (dueño, 2026-11-06, Q5): el pasaporte se guarda tal cual figura (letras y números, de 6 a 9). Se prueba: que es
 * ADITIVA sobre una base con datos (ni una fila cambia; del catálogo solo cambia el CHECK del documento), que lo que la base aceptaba
 * antes lo sigue aceptando y lo que rechazaba lo sigue rechazando, que el pasaporte con letras entra SOLO con el tipo PASAPORTE, que
 * la base y las primitivas (`pasaporte.ts`, `numero-de-documento-para-arca.ts`, `documento.ts`) no se desalinean, que exige 0009 y la
 * reversión (se niega si ya hay un pasaporte con letras; si no, deja el catálogo como antes y se puede repetir).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "pasaporte_con_letras";
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

/** Intenta guardar un comprobante con ese documento; devuelve el nombre de la restricción que lo rechaza, o `null` si entra. */
async function guardar(
  c: pg.Client,
  e: Escenario,
  tipo: string,
  numero: string | null,
): Promise<string | null> {
  try {
    await crearComprobante(c, e, {
      receptor_documento_tipo: tipo,
      receptor_documento_numero: numero,
      receptor_nombre: numero === null ? null : "Jane Doe",
    });
    return null;
  } catch (error) {
    const m = /comprobante_\w+_ck/.exec(String((error as Error).message));
    if (m === null) throw error;
    return m[0];
  }
}

describe.skipIf(base === null)("Pasaporte con letras: la migración 0024", () => {
  const b = () => base as BaseDePruebas;

  it("la cabecera declara lo que es (aditiva, sin SECURITY DEFINER, reversión aparte) y el código solo reemplaza un CHECK", async () => {
    const sql = await texto([await archivoDeLaMigracion()]);
    const plano = sql.replace(/\n--\s*/g, " ");
    expect(plano).toMatch(/Es ADITIVA/);
    expect(plano).toMatch(/DEPENDE de 0009/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    const codigo = sql.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(
      /\b(TRUNCATE|CASCADE|DELETE|UPDATE\s|INSERT\s|SECURITY\s+DEFINER|DISABLE\s+TRIGGER|REVOKE|GRANT|OR\s+REPLACE|DROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER))\b/i,
    );
    expect(codigo.match(/DROP\s+CONSTRAINT\s+(\w+)/gi)?.map((x) => x.split(/\s+/)[2])).toEqual([
      "comprobante_receptor_documento_ck",
    ]);
    // Las constantes que la base copia son las de las primitivas (una sola fuente; si cambian, esta línea falla y obliga a migrar).
    expect(codigo).toContain(
      `'^[${CARACTERES_PERMITIDOS_DE_PASAPORTE}]{${LARGO_MINIMO_DE_PASAPORTE},${LARGO_MAXIMO_DE_PASAPORTE}}$'`,
    );
  });

  it("sobre una base con datos no cambia ni una fila; solo cambia el CHECK del documento; y exige 0009 antes", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const e = await crearEscenario(c);
      // Un pasaporte numérico de los de antes (incluso uno que hoy la primitiva ya no deja emitir) y un consumidor final.
      await crearComprobante(c, e, {
        receptor_documento_tipo: "PASAPORTE",
        receptor_documento_numero: "007",
        receptor_nombre: "Jane Doe",
      });
      await crearComprobante(c, e, {});
      const huella = async () =>
        (
          await c.query<{ id: string; h: string }>(
            "select id::text, md5(to_jsonb(x)::text) as h from comprobante x order by 1",
          )
        ).rows;
      const [antes, catalogoAntes] = [await huella(), await huellaDeCatalogo(c)];
      expect(await guardar(c, e, "PASAPORTE", "ABC123456")).toBe(
        "comprobante_receptor_documento_ck",
      );

      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await huella()).toEqual(antes);
      const despues = await huellaDeCatalogo(c);
      expect(
        Object.keys(despues).filter(
          (k) => JSON.stringify(despues[k]) !== JSON.stringify(catalogoAntes[k]),
        ),
      ).toEqual(["restricciones"]);
      const cambiadas = (despues["restricciones"] ?? []).filter(
        (x) => !(catalogoAntes["restricciones"] ?? []).includes(x),
      );
      expect(cambiadas.map((x) => x.split(":")[0]?.split(".")[1])).toEqual([
        "comprobante_receptor_documento_ck",
      ]);
      expect(await guardar(c, e, "PASAPORTE", "ABC123456")).toBeNull();

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

  it("lo que aceptaba la base antes lo sigue aceptando, lo que rechazaba lo sigue rechazando, y el pasaporte con letras entra solo con el tipo PASAPORTE", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const e = await crearEscenario(c);
      const aceptadasAntes: [string, string | null][] = [
        ["PASAPORTE", "1"],
        ["PASAPORTE", "0"],
        ["PASAPORTE", "12345"],
        ["PASAPORTE", "12345678901"],
        ["DNI", "30111222"],
        ["CUIT", "30712345671"],
        ["SIN_IDENTIFICAR", null],
      ];
      const rechazadasAntes: [string, string][] = [
        ["PASAPORTE", "123456789012"],
        ["PASAPORTE", "-1"],
        ["DNI", "30A11222"],
        ["CUIT", "20123456787"],
        ["CUIT", "3071234567a"],
      ];
      const antes = new Map<string, string | null>();
      for (const [t, n] of [...aceptadasAntes, ...rechazadasAntes]) {
        antes.set(`${t}|${n}`, await guardar(c, e, t, n));
      }
      expect(aceptadasAntes.filter(([t, n]) => antes.get(`${t}|${n}`) !== null)).toEqual([]);
      expect(
        rechazadasAntes.filter(
          ([t, n]) => antes.get(`${t}|${n}`) !== "comprobante_receptor_documento_ck",
        ),
      ).toEqual([]);

      await aplicarMigraciones(previa.aparte.base.dueno, conMia);

      for (const [t, n] of aceptadasAntes)
        expect(await guardar(c, e, t, n), `${t} ${n}`).toBeNull();
      for (const [t, n] of rechazadasAntes)
        expect(await guardar(c, e, t, n), `${t} ${n}`).toBe("comprobante_receptor_documento_ck");

      // Lo nuevo: pasaporte con letras o con mezcla, en los bordes de 6 y 9 caracteres.
      for (const n of ["ABC123456", "AAB000123", "A1B2C3D4", "ABCDE1", "ABCDEFGH1", "000001"]) {
        expect(await guardar(c, e, "PASAPORTE", n), n).toBeNull();
      }
      // Lo que sigue rechazando: 5 y 10 caracteres con letras, sin cifra, solo ceros, minúsculas, otros caracteres, otro tipo.
      for (const n of [
        "ABC12",
        "ABC1234567",
        "ABCDEF",
        "ABC000000",
        "abc123456",
        "ABC-12345",
        "ABC 12345",
        "ÑBC123456",
        "ABC12345 ",
        "ABC123456\n",
      ]) {
        expect(await guardar(c, e, "PASAPORTE", n), JSON.stringify(n)).toBe(
          "comprobante_receptor_documento_ck",
        );
      }
      for (const t of ["DNI", "CUIT", "CUIL", "CDI"]) {
        expect(await guardar(c, e, t, "ABC123456"), t).toBe("comprobante_receptor_documento_ck");
      }
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  it("la base y las primitivas no se desalinean: todo pasaporte que la primitiva acepta la base lo guarda, y la base es más ancha solo con los pasaportes numéricos de antes (P5)", async () => {
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
      const candidatos = [
        "ABC123456",
        "AAB000123",
        "A1B2C3D4",
        "123456",
        "123456789",
        "0001234",
        "ABCDEF",
        "ABC000000",
        "000000",
        "ABC12",
        "12345",
        "ABC1234567",
        "1234567890",
        "12345678901",
        "abc123456",
        "ABC-12345",
        "",
        "0",
        "007",
      ];
      for (const n of candidatos) {
        const primitiva = numeroDeDocumentoDesdeTexto("PASAPORTE", n);
        const enBase = await guardar(c, e, "PASAPORTE", primitiva.ok ? primitiva.valor : n);
        // Lo que la primitiva acepta (ya en mayúsculas), la base lo guarda.
        if (primitiva.ok) expect(enBase, `primitiva acepta ${n}`).toBeNull();
        // La base acepta algo que la primitiva rechaza SOLO si es un pasaporte numérico de los de antes (1 a 11 dígitos).
        if (!primitiva.ok && enBase === null)
          expect(n, `base acepta ${n}`).toMatch(/^[0-9]{1,11}$/);
      }
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  it("la reversión se niega si ya hay un pasaporte con letras; si no, deja el catálogo como antes, se puede repetir y la migración se vuelve a aplicar", async () => {
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
      const registro = async (): Promise<unknown[]> =>
        (
          await c.query<{ n: number }>("select 1 as n from migracion where nombre = $1", [
            await archivoDeLaMigracion(),
          ])
        ).rows;

      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      const e = await crearEscenario(c);
      expect(await registro()).toHaveLength(1);

      // Un pasaporte solo de dígitos no impide volver atrás; uno con letras sí, y no se toca nada.
      expect(await guardar(c, e, "PASAPORTE", "123456")).toBeNull();
      expect(await guardar(c, e, "PASAPORTE", "ABC123456")).toBeNull();
      const despuesDeAplicar = await huellaDeCatalogo(c);
      await c.query("begin");
      await expect(c.query(reversion)).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/pasaporte con letras/) as string,
      });
      await c.query("rollback");
      expect(await huellaDeCatalogo(c)).toEqual(despuesDeAplicar);
      expect(await registro()).toHaveLength(1);
      expect(
        (
          await c.query(
            "select count(*)::int as n from comprobante where receptor_documento_numero = 'ABC123456'",
          )
        ).rows,
      ).toEqual([{ n: 1 }]);

      // Sin ninguno (se quita con el dueño de la base, como lo haría una corrección manual) la reversión corre.
      await c.query("alter table comprobante disable trigger user");
      await c.query(
        "update comprobante set receptor_documento_numero = '123457' where receptor_documento_numero = 'ABC123456'",
      );
      await c.query("alter table comprobante enable trigger user");
      await c.query(`begin; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);
      expect(await registro()).toEqual([]);
      expect(await guardar(c, e, "PASAPORTE", "ABC123456")).toBe(
        "comprobante_receptor_documento_ck",
      );
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
