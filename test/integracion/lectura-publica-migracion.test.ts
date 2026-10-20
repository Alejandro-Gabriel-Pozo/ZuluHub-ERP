import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { campoConPosibleSecreto } from "../../src/puertos/sin-secretos";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  HASTA_0006,
  baseConMigraciones,
  carpetaCon,
  crearDominio,
  crearMarca,
  crearMundoDeMarca,
  crearVersionDeMarcaConfirmada,
  huellaDeCatalogo,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * Lectura pública de la marca (M4b): la migración 0011 (UNA concesión de `SELECT` por columna al rol público)
 * sobre una base CON DATOS: aditiva (no cambia ni un dato ni una línea del catálogo salvo esa concesión), sus
 * guardas, el catálogo EXACTO de lo que el rol público lee después, lo que el texto del archivo promete y su
 * reversión (un script aparte, sin pérdida de datos, que deja el catálogo como estaba).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const archivos = async () => (await readdir(CARPETA_DE_MIGRACIONES)).sort();
const archivoDeLaMigracion = async (): Promise<string> => {
  const encontrados = (await archivos()).filter((n) =>
    /^\d{4}_lectura_publica_de_marca\.sql$/.test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una migración, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const archivoDeLaReversion = async (): Promise<string> => {
  const encontrados = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
    /^\d{4}_revertir_lectura_publica_de_marca\.sql$/.test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una reversión, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
/** Todas las migraciones anteriores a la de esta rama, en orden. */
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};

/** Contenido de cada tabla de negocio: ni una fila puede cambiar. */
async function huellaDeDatos(c: pg.Client): Promise<Record<string, string>> {
  const { rows: tablas } = await c.query<{ t: string }>(
    `select c.relname as t from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'migracion' order by 1`,
  );
  const r: Record<string, string> = {};
  for (const { t } of tablas) {
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg((to_jsonb(x))::text, '|' order by (to_jsonb(x))::text)), '-') as h from ${t} x`,
    );
    r[t] = rows[0]?.h as string;
  }
  return r;
}

async function sembrar(c: pg.Client): Promise<void> {
  const principal = await marcaPrincipal(c);
  await crearVersionDeMarcaConfirmada(c, principal, { nombreVisible: "Principal" });
  await crearDominio(c, principal, { canonico: true });
  const hija = await crearMarca(c, { padre: principal });
  await crearVersionDeMarcaConfirmada(c, hija, { nombreVisible: "Hija" });
  await crearDominio(c, hija, { canonico: true });
  await crearDominio(c, hija, { estado: "PENDIENTE_VERIFICACION" });
  await crearMundoDeMarca(c, { marca: principal });
}

function diferencias(antes: Record<string, string[]>, despues: Record<string, string[]>) {
  const nuevas: Record<string, string[]> = {};
  const perdidas: Record<string, string[]> = {};
  for (const categoria of Object.keys(antes)) {
    const a = new Set(antes[categoria]);
    const d = new Set(despues[categoria]);
    nuevas[categoria] = [...d].filter((x) => !a.has(x));
    perdidas[categoria] = [...a].filter((x) => !d.has(x));
  }
  return { nuevas, perdidas };
}

/** Exactamente lo que el rol público lee, por columna (la vista y las tres tablas de 0007, más 0011). */
const COLUMNAS_DEL_ROL_PUBLICO = [
  "dominio.duenio_empresa_id",
  "dominio.duenio_marca_id",
  "dominio.es_canonico",
  "dominio.estado",
  "dominio.host",
  "dominio.marca_id",
  "dominio.superficie",
  "marca.codigo",
  "marca.es_principal",
  "marca.id",
  "marca.marca_padre_id",
  "marca.nivel",
  "resolucion_de_host.duenio_empresa_id",
  "resolucion_de_host.duenio_marca_id",
  "resolucion_de_host.host",
  "resolucion_de_host.marca_id",
  "resolucion_de_host.superficie",
  "version_de_marca.logo",
  "version_de_marca.marca_id",
  "version_de_marca.nombre_visible",
  "version_de_marca.numero",
  "version_de_marca.tema",
  "version_de_marca.vigente_desde",
  "version_de_marca.vocabulario",
];

describe.skipIf(base === null)(
  "lectura pública de la marca: la migración 0011 sobre datos reales, sus guardas y su reversión",
  () => {
    const b = () => base as BaseDePruebas;

    async function conPrevias<T>(
      trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, con: string) => Promise<T>,
    ): Promise<T> {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
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

    // ===========================================================================================================
    // Aditiva
    // ===========================================================================================================
    it("sobre una base con datos no cambia NI UN dato; en el catálogo solo agrega al rol público la lectura de es_canonico", async () => {
      await conPrevias(async (previa, conMia) => {
        await sembrar(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const catalogoAntes = await huellaDeCatalogo(previa.cliente);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);

        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
        const { nuevas, perdidas } = diferencias(
          catalogoAntes,
          await huellaDeCatalogo(previa.cliente),
        );
        // Ninguna categoría cambia, salvo los privilegios por columna...
        for (const categoria of Object.keys(nuevas)) {
          if (categoria === "privilegiosPorColumna") continue;
          expect(nuevas[categoria], `${categoria}: líneas nuevas`).toEqual([]);
          expect(perdidas[categoria], `${categoria}: líneas perdidas`).toEqual([]);
        }
        // ...donde cambia UNA línea: la ACL de `dominio.es_canonico`, que suma al rol público y conserva el resto.
        expect(nuevas["privilegiosPorColumna"]).toHaveLength(1);
        expect(perdidas["privilegiosPorColumna"]).toHaveLength(1);
        const [antes] = perdidas["privilegiosPorColumna"] as string[];
        const [despues] = nuevas["privilegiosPorColumna"] as string[];
        expect(antes).toMatch(/^dominio\.es_canonico:/);
        expect(despues).toMatch(/^dominio\.es_canonico:/);
        expect(antes).not.toContain("pedernal_publico");
        expect(despues).toMatch(/pedernal_publico=r\//);
        // Y lo que tenía antes (la aplicación y la plataforma, cada una con lo suyo) sigue igual.
        const sinPublico = (despues as string).replace(/pedernal_publico=r\/[^,}]+,?/, "");
        expect(sinPublico.replace(/,\}/, "}")).toBe(antes);
      });
    });

    it("correr las migraciones de nuevo no cambia nada", async () => {
      await conPrevias(async (previa, conMia) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const catalogo = await huellaDeCatalogo(previa.cliente);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otra).toEqual({
          aplicadas: [],
          yaAplicadas: [...(await migracionesPrevias()), await archivoDeLaMigracion()],
        });
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);
      });
    });

    // ===========================================================================================================
    // Guardas
    // ===========================================================================================================
    it("exige 0007: sin las marcas se frena con un mensaje claro y no deja nada registrado", async () => {
      const aparte = await baseConMigraciones(b(), HASTA_0006);
      const carpeta = await carpetaCon([...HASTA_0006, await archivoDeLaMigracion()]);
      try {
        await expect(aplicarMigraciones(aparte.aparte.base.dueno, carpeta)).rejects.toThrow(
          /0011 requiere 0007_marcas_y_planes aplicada antes/,
        );
        const { rows } = await aparte.cliente.query<{ nombre: string }>(
          "select nombre from migracion where nombre like '%lectura_publica_de_marca%'",
        );
        expect(rows).toEqual([]);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await aparte.cerrar();
      }
    });

    // ===========================================================================================================
    // El catálogo EXACTO del rol público (meta-test)
    // ===========================================================================================================
    it("después de migrar, el rol público lee EXACTAMENTE estas 24 columnas, solo con SELECT, y ninguna tiene nombre de secreto", async () => {
      await conPrevias(async (previa, conMia) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const { rows } = await previa.cliente.query<{
          t: string;
          c: string;
          p: string;
        }>(
          `select table_name as t, column_name as c, privilege_type as p
           from information_schema.column_privileges
           where grantee = 'pedernal_publico' and table_schema = 'public' order by 1, 2, 3`,
        );
        expect([...new Set(rows.map((f) => f.p))]).toEqual(["SELECT"]);
        expect(rows.map((f) => `${f.t}.${f.c}`)).toEqual(COLUMNAS_DEL_ROL_PUBLICO);
        expect(COLUMNAS_DEL_ROL_PUBLICO).toHaveLength(24);
        for (const f of rows) {
          expect(campoConPosibleSecreto({ [f.c]: "" }), `${f.t}.${f.c}`).toBeNull();
        }
        // Lo que sigue sin ver: el id, el titular, quién lo registró, cuándo se verificó, el motivo...
        const vistas = new Set(rows.map((f) => `${f.t}.${f.c}`));
        for (const privada of [
          "dominio.id",
          "dominio.titular",
          "dominio.registrado_por",
          "dominio.verificado_en",
          "dominio.motivo",
          "dominio.creado_en",
          "dominio.actualizado_en",
          "dominio.version",
          "marca.estado",
          "version_de_marca.modulos_iniciales",
          "version_de_marca.plan_por_defecto_id",
          "version_de_marca.motivo",
          "version_de_marca.confirmada_por",
          "version_de_marca.estado",
        ]) {
          expect(vistas.has(privada), privada).toBe(false);
        }
        // Nadie más gana nada: ni el público sobre otras tablas, ni otro privilegio.
        const { rows: otros } = await previa.cliente.query(
          `select 1 from information_schema.table_privileges
           where grantee = 'pedernal_publico' and table_schema = 'public' and privilege_type <> 'SELECT'`,
        );
        expect(otros).toEqual([]);
      });
    });

    it("con la concesión, el rol real ve es_canonico SOLO de dominios activos; el titular, el id y el motivo siguen vedados", async () => {
      await conPrevias(async (previa, conMia) => {
        await sembrar(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const publico = new pg.Client({ connectionString: previa.aparte.base.publico });
        await publico.connect();
        try {
          const canonicos = await publico.query<{ host: string }>(
            "select host from dominio where es_canonico order by host",
          );
          const { rows: esperados } = await previa.cliente.query<{ host: string }>(
            "select host from dominio where es_canonico and estado = 'ACTIVO' order by host",
          );
          expect(canonicos.rows).toEqual(esperados);
          expect(canonicos.rows).toHaveLength(2);
          // El pendiente (que no es canónico) y todo lo no activo ni se asoma.
          const { rows: todos } = await publico.query("select host from dominio");
          const { rows: activos } = await previa.cliente.query(
            "select host from dominio where estado = 'ACTIVO'",
          );
          expect(todos).toHaveLength(activos.length);
          for (const columna of [
            "id",
            "titular",
            "motivo",
            "registrado_por",
            "verificado_en",
            "version",
          ]) {
            await expect(
              publico.query(`select ${columna} from dominio`),
              columna,
            ).rejects.toMatchObject({
              code: "42501",
            });
          }
          await expect(publico.query("select * from dominio")).rejects.toMatchObject({
            code: "42501",
          });
          // Sigue sin poder escribir nada.
          await expect(
            publico.query("update dominio set es_canonico = false"),
          ).rejects.toMatchObject({
            code: "42501",
          });
        } finally {
          await publico.end();
        }
      });
    });

    // ===========================================================================================================
    // Lo que promete el texto
    // ===========================================================================================================
    describe("el texto de la migración promete lo que hace", () => {
      const leer = async () => {
        const completo = await readFile(
          join(CARPETA_DE_MIGRACIONES, await archivoDeLaMigracion()),
          "utf8",
        );
        // El código sin comentarios de línea: lo que promete la cabecera se comprueba sobre lo que se ejecuta.
        return { completo, codigo: completo.replace(/--.*$/gm, "") };
      };

      it("la cabecera declara lo que es: aditiva, sin SECURITY DEFINER nuevo, número provisorio, reversión que no pierde datos", async () => {
        const { completo } = await leer();
        expect(completo).toMatch(/ADITIVA/);
        expect(completo).toMatch(/PROVISORIO/);
        expect(completo.replace(/\n--\s*/g, " ")).toMatch(/NO pierde datos/);
        expect(completo).toContain(`reversiones/${await archivoDeLaReversion()}`);
        expect(completo).toMatch(/No agrega NINGUNA función SECURITY DEFINER/);
      });

      it("ejecuta UNA sola concesión: nada se crea, se modifica ni se borra, ni se da LOGIN o contraseña", async () => {
        const { codigo } = await leer();
        expect(codigo.match(/\bGRANT\b/gi)).toHaveLength(1);
        expect(codigo).toMatch(/GRANT SELECT \(es_canonico\) ON dominio TO pedernal_publico;/);
        expect(codigo).not.toMatch(/\b(REVOKE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
        expect(codigo).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
        expect(codigo).not.toMatch(/\bLOGIN\b/i);
        expect(codigo).not.toMatch(/\bPASSWORD\s+'/i);
        expect(codigo).not.toMatch(/postgres(ql)?:\/\//i);
      });
    });

    // ===========================================================================================================
    // Reversión
    // ===========================================================================================================
    describe("la reversión (script aparte, sin pérdida de datos)", () => {
      it("deja el catálogo EXACTAMENTE como estaba antes, no toca los datos, borra la fila del ejecutor y se puede repetir", async () => {
        await conPrevias(async (previa, conMia) => {
          await sembrar(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(catalogoAntes);
          const datosConLaMigracion = await huellaDeDatos(previa.cliente);

          const reversion = await readFile(
            join(CARPETA_DE_MIGRACIONES, "reversiones", await archivoDeLaReversion()),
            "utf8",
          );
          await previa.cliente.query("begin");
          await previa.cliente.query(reversion);
          await previa.cliente.query("commit");

          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          const { rows: ya } = await previa.cliente.query(
            "select 1 from migracion where nombre like '%lectura_publica_de_marca%'",
          );
          expect(ya).toEqual([]);
          // Los datos de la tabla `migracion` aparte, ningún dato de negocio cambió.
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosConLaMigracion);

          // Repetirla no falla ni cambia nada.
          await previa.cliente.query(reversion);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);

          // Revertida, el rol público vuelve a no poder leer la columna; y la migración se puede aplicar otra vez.
          const publico = new pg.Client({ connectionString: previa.aparte.base.publico });
          await publico.connect();
          try {
            await expect(publico.query("select es_canonico from dominio")).rejects.toMatchObject({
              code: "42501",
            });
          } finally {
            await publico.end();
          }
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
        });
      });

      it("la cabecera dice que no es destructiva, que no la aplica el ejecutor y cómo se corre", async () => {
        const texto = await readFile(
          join(CARPETA_DE_MIGRACIONES, "reversiones", await archivoDeLaReversion()),
          "utf8",
        );
        expect(texto).toMatch(/NO es destructiva/);
        expect(texto).toMatch(/NO lo aplica el ejecutor de migraciones/);
        expect(texto).toMatch(/BEGIN;/);
        expect(texto).not.toMatch(/\b(DROP|DELETE FROM public\.(?!migracion)|TRUNCATE|CASCADE)\b/i);
      });
    });
  },
);
