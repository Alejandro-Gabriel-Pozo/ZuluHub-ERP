import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { HASTA_0007, archivoDeCaptacion } from "./captacion-apoyo";
import { crearComprobante, crearEscenario } from "./facturacion-apoyo";
import { crearMundo, crearPuntoDeVenta } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";

/**
 * Facturación F2: la migración 0009 sobre una base CON DATOS (aditiva sobre los datos: no cambia ni una fila
 * existente), sus guardas (exige 0006 y 0007), su atomicidad, lo que el texto del archivo promete y su reversión
 * (un script aparte, destructivo, que deja el catálogo como estaba antes). El número del archivo no importa: se
 * lo encuentra por su nombre, así que el orquestador puede renumerarlo al integrar.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

/** Las tablas que existían antes y 0009 no toca: ni una fila suya puede cambiar. */
const TABLAS_INTACTAS = [
  "tenant",
  "empresa",
  "sucursal",
  "persona",
  "membresia_tenant",
  "membresia",
  "trabajo",
  "auditoria_empresa",
  "auditoria_plataforma",
  "emisor",
  "domicilio",
  "datos_fiscales",
  "regla_emisor",
  "marca",
  "modulo_de_empresa",
] as const;
const TABLAS_NUEVAS = [
  "acceso_arca",
  "certificado_arca",
  "comprobante",
  "comprobante_alicuota",
  "comprobante_linea",
  "intento_arca",
] as const;

async function archivoDeFacturacion(): Promise<string> {
  const archivos = (await readdir(CARPETA_DE_MIGRACIONES)).filter((n) =>
    /^\d{4}_facturacion\.sql$/.test(n),
  );
  if (archivos.length !== 1)
    throw new Error(`tenía que haber una migración de facturación y hay ${archivos.length}`);
  return archivos[0] as string;
}
async function archivoDeReversion(): Promise<string> {
  const archivos = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
    /^\d{4}_revertir_facturacion\.sql$/.test(n),
  );
  if (archivos.length !== 1)
    throw new Error(`tenía que haber una reversión de facturación y hay ${archivos.length}`);
  return join(CARPETA_DE_MIGRACIONES, "reversiones", archivos[0] as string);
}
/** Todo lo anterior a facturación: de 0001 a captación. */
async function hasta0008(): Promise<string[]> {
  return [...HASTA_0007, await archivoDeCaptacion()];
}

async function huellaDeDatos(c: pg.Client): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const tabla of TABLAS_INTACTAS) {
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text)), '-') as h from ${tabla} t`,
    );
    r[tabla] = rows[0]?.h as string;
  }
  // El punto de venta y la serie ganan la columna `ambiente`: sin ella, nada cambió (ni la versión).
  for (const tabla of ["punto_de_venta", "serie_comprobante"]) {
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg((to_jsonb(t) - 'ambiente')::text, '|' order by (to_jsonb(t) - 'ambiente')::text)), '-') as h from ${tabla} t`,
    );
    r[tabla] = rows[0]?.h as string;
  }
  return r;
}

/**
 * Datos de 0001 a 0008 de todo tipo, con lo fiscal de 0006: empresas en varios estados, emisores, datos fiscales
 * confirmados, puntos de venta activos e inactivos y series usadas, en reserva y bloqueadas.
 */
async function sembrarDatosPrevios(c: pg.Client): Promise<void> {
  for (const estado of ["ACTIVE", "SUSPENDED"] as const) {
    const m = await crearMundo(c, { estado });
    const domicilio = (
      await c.query<{ id: string }>(
        `insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, 'Av. Siempreviva', '742', 'Rosario', 'AR-S') returning id`,
        [m.empresa],
      )
    ).rows[0]?.id as string;
    const datos = (
      await c.query<{ id: string }>(
        `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id, inicio_actividades, creado_por)
         values ($1, $2, 'Previa SA', 'RESPONSABLE_INSCRIPTO', $3, '2020-01-01', $4) returning id`,
        [m.empresa, m.emisor, domicilio, m.persona],
      )
    ).rows[0]?.id as string;
    await c.query(
      `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), confirmada_en = now(),
              confirmada_por = $2, motivo = 'alta' where id = $1`,
      [datos, m.persona],
    );
    const pv1 = await crearPuntoDeVenta(c, m, { numero: 1, domicilio, activo: true });
    const pv2 = await crearPuntoDeVenta(c, m, { numero: 2 });
    // Series de 0006, sin ambiente: LIBRE usada, EN_CURSO y BLOQUEADA.
    for (const [pv, tipo] of [
      [pv1, "FACTURA_A"],
      [pv1, "FACTURA_B"],
      [pv2, "FACTURA_C"],
    ] as const) {
      await c.query(
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero) values ($1, $2, $3, $4, 7)`,
        [m.empresa, pv, m.emisor, tipo],
      );
    }
    await c.query(
      `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = 8, solicitud_en_curso = gen_random_uuid(),
              en_curso_hasta = now() + interval '5 minutes' where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`,
      [pv1],
    );
    await c.query(
      `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = 8, solicitud_en_curso = gen_random_uuid(),
              en_curso_hasta = now() + interval '5 minutes' where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_C'`,
      [pv2],
    );
    await c.query(
      `update serie_comprobante set estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null,
              motivo_bloqueo = 'desfase' where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_C'`,
      [pv2],
    );
    await c.query(
      "insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'PRUEBA', 'x', 'y')",
      [m.empresa],
    );
  }
}

/** Las líneas de cada categoría del catálogo que hay en `despues` y no en `antes`, y al revés. */
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

describe.skipIf(base === null)(
  "facturación: la migración sobre datos reales, sus guardas y su reversión",
  () => {
    const b = () => base as BaseDePruebas;

    async function conPrevias<T>(
      trabajo: (
        x: Awaited<ReturnType<typeof baseConMigraciones>>,
        conFacturacion: string,
      ) => Promise<T>,
    ): Promise<T> {
      const anteriores = await hasta0008();
      const previa = await baseConMigraciones(b(), anteriores);
      // Los mundos de prueba crean tenants sin nombrar la marca: la base lleva la principal de prueba por defecto.
      await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
      const completa = await carpetaCon([...anteriores, await archivoDeFacturacion()]);
      try {
        return await trabajo(previa, completa);
      } finally {
        await rm(completa, { recursive: true, force: true });
        await previa.cerrar();
      }
    }

    // ===========================================================================================================
    // Aditiva sobre los datos
    // ===========================================================================================================
    it("sobre una base con datos no cambia NI UNA fila existente: los puntos de venta y las series reciben el ambiente de homologación; las tablas nuevas nacen vacías", async () => {
      await conPrevias(async (previa, completa) => {
        await sembrarDatosPrevios(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const catalogoAntes = await huellaDeCatalogo(previa.cliente);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, completa);
        expect(r.aplicadas).toEqual([await archivoDeFacturacion()]);

        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
        for (const tabla of ["punto_de_venta", "serie_comprobante"]) {
          const { rows } = await previa.cliente.query<{ n: number; homologacion: number }>(
            `select count(*)::int as n, count(*) filter (where ambiente = 'HOMOLOGACION')::int as homologacion from ${tabla}`,
          );
          expect(rows[0]?.n, tabla).toBeGreaterThan(0);
          expect(rows[0]?.homologacion, tabla).toBe(rows[0]?.n);
        }
        for (const tabla of TABLAS_NUEVAS) {
          expect((await previa.cliente.query(`select 1 from ${tabla}`)).rows, tabla).toEqual([]);
        }

        const { nuevas, perdidas } = diferencias(
          catalogoAntes,
          await huellaDeCatalogo(previa.cliente),
        );
        // Lo único «perdido» es lo que 0009 reemplaza: la clave de la serie (con el ambiente) y su función de validación.
        const esReemplazo = (linea: string) =>
          /serie_pkey/.test(linea) || /^serie_comprobante_validar_cambio\(/.test(linea);
        for (const [categoria, lineas] of Object.entries(perdidas)) {
          for (const linea of lineas)
            expect(esReemplazo(linea), `${categoria}: ${linea}`).toBe(true);
        }
        // Todo lo nuevo es de facturación, o es el ambiente / la clave que 0009 agrega a lo anterior.
        const esDeFacturacion = (linea: string) =>
          /comprobante|certificado_arca|acceso_arca|intento_arca|texto_fiscal_valido|ambiente|serie_pkey|serie_comprobante_validar|serie_comprobante_alta|serie_comprobante_con_reserva|datos_fiscales_id_empresa_emisor_uk/.test(
            linea,
          );
        for (const [categoria, lineas] of Object.entries(nuevas)) {
          for (const linea of lineas)
            expect(esDeFacturacion(linea), `${categoria}: ${linea}`).toBe(true);
        }
        for (const tabla of TABLAS_NUEVAS) {
          expect(
            nuevas["tablas"]?.some((t) => t.startsWith(`${tabla}:`)),
            tabla,
          ).toBe(true);
        }
      });
    });

    it("después de migrar, lo que ya había sigue funcionando: se factura sobre un punto de venta y unos datos fiscales anteriores a 0009", async () => {
      await conPrevias(async (previa, completa) => {
        await sembrarDatosPrevios(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const m = await crearMundo(previa.cliente);
        const e = await crearEscenario(previa.cliente, { mundo: m });
        await crearComprobante(previa.cliente, e);
        expect(
          (await previa.cliente.query("select count(*)::int as n from comprobante")).rows[0],
        ).toEqual({ n: 1 });
      });
    });

    it("correr las migraciones de nuevo no cambia nada", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const catalogo = await huellaDeCatalogo(previa.cliente);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, completa);
        expect(otra).toEqual({
          aplicadas: [],
          yaAplicadas: [...(await hasta0008()), await archivoDeFacturacion()],
        });
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);
      });
    });

    // ===========================================================================================================
    // Guardas y atomicidad
    // ===========================================================================================================
    it("exige 0006: sin los datos fiscales ni el punto de venta se frena con un mensaje claro y no deja nada", async () => {
      // 0001 a 0005 y 0007 (que no depende de 0006): falta la fiscal base.
      const sinFiscal = [
        "0001_base.sql",
        "0002_identidad.sql",
        "0003_trabajos.sql",
        "0004_plataforma.sql",
        "0005_administracion.sql",
        "0007_marcas_y_planes.sql",
      ];
      const previa = await baseConMigraciones(b(), sinFiscal);
      const carpeta = await carpetaCon(sinFiscal);
      try {
        const archivo = await archivoDeFacturacion();
        await writeFile(
          join(carpeta, archivo),
          await readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8"),
        );
        await expect(aplicarMigraciones(previa.aparte.base.dueno, carpeta)).rejects.toThrow(
          /facturación requiere 0006_fiscal aplicada antes/,
        );
        const { rows } = await previa.cliente.query<{ nombre: string }>(
          "select nombre from migracion order by nombre",
        );
        expect(rows.map((r) => r.nombre)).toEqual(sinFiscal);
        expect(
          (await previa.cliente.query("select to_regclass('public.comprobante') as t")).rows,
        ).toEqual([{ t: null }]);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("exige 0007 (sin_borrado): sin las marcas se frena con un mensaje claro y no deja nada", async () => {
      const hasta0006 = (await hasta0008()).slice(0, 6);
      const previa = await baseConMigraciones(b(), hasta0006);
      const carpeta = await carpetaCon(hasta0006);
      try {
        const archivo = await archivoDeFacturacion();
        await writeFile(
          join(carpeta, archivo),
          await readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8"),
        );
        await expect(aplicarMigraciones(previa.aparte.base.dueno, carpeta)).rejects.toThrow(
          /facturación requiere 0007_marcas_y_planes aplicada antes/,
        );
        expect(
          (await previa.cliente.query("select to_regclass('public.comprobante') as t")).rows,
        ).toEqual([{ t: null }]);
        // Y no quedó ni la columna del ambiente: la verificación frena antes de tocar nada.
        expect(
          (
            await previa.cliente.query(
              "select 1 from information_schema.columns where table_name = 'punto_de_venta' and column_name = 'ambiente'",
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("es atómica: si algo falla al final, no queda ninguna tabla, función, columna ni concesión, y los datos siguen iguales", async () => {
      await conPrevias(async (previa) => {
        await sembrarDatosPrevios(previa.cliente);
        const antes = await huellaDeCatalogo(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const rota = await carpetaCon(await hasta0008());
        try {
          const archivo = await archivoDeFacturacion();
          const sql = await readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");
          await writeFile(join(rota, archivo), `${sql}\nSELECT 1 / 0;\n`);
          await expect(aplicarMigraciones(previa.aparte.base.dueno, rota)).rejects.toThrow(
            /division by zero/,
          );
        } finally {
          await rm(rota, { recursive: true, force: true });
        }
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
      });
    });

    // ===========================================================================================================
    // Lo que el texto del archivo promete
    // ===========================================================================================================
    describe("el texto de la migración", () => {
      const leer = async () => {
        const sql = await readFile(
          join(CARPETA_DE_MIGRACIONES, await archivoDeFacturacion()),
          "utf8",
        );
        return { sql, codigo: sql.replace(/--.*$/gm, "") };
      };

      it("es aditiva sobre los datos: no borra ni reescribe filas; los únicos DROP son el valor por defecto y la clave de la serie, que se recrea en la misma sentencia", async () => {
        const { sql, codigo } = await leer();
        // El «BEFORE TRUNCATE» y el «BEFORE DELETE» de los disparadores frenan el vaciado y el borrado: no son uno.
        const sinPermitidos = codigo
          .replace(/BEFORE\s+TRUNCATE/gi, "")
          .replace(/BEFORE\s+DELETE/gi, "")
          .replace(/BEFORE\s+UPDATE\s+OR\s+DELETE/gi, "");
        expect(sinPermitidos).not.toMatch(/\b(TRUNCATE|DELETE\s+FROM)\b/i);
        expect(
          [...sinPermitidos.matchAll(/\bDROP\s+\w+(\s+\w+)?/gi)]
            .map((m) => m[0].replace(/\s+/g, " "))
            .sort(),
        ).toEqual(["DROP CONSTRAINT serie_pkey", "DROP DEFAULT"]);
        expect(codigo).toMatch(
          /DROP CONSTRAINT serie_pkey,\s+ADD CONSTRAINT serie_pkey PRIMARY KEY \(empresa_id, punto_de_venta_id, tipo_comprobante, ambiente\)/,
        );
        // Ninguna fila se inserta ni se actualiza: los privilegios `GRANT INSERT/UPDATE` no son sentencias de datos.
        expect(codigo).not.toMatch(/\bINSERT\s+INTO\b/i);
        expect(codigo).not.toMatch(/\bUPDATE\s+(?!OF\b|ON\b)\w+\s+SET\b/i);
        expect(sql).toMatch(/facturación requiere 0006_fiscal/);
        expect(sql).toMatch(/facturación requiere 0007_marcas_y_planes/);
      });

      it("no agrega SECURITY DEFINER ni roles ni contraseñas, y no hay ninguna política `FOR ALL` ni restrictiva", async () => {
        const { codigo } = await leer();
        expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
        expect(codigo).not.toMatch(/CREATE\s+ROLE|ALTER\s+ROLE|(?<!NO)LOGIN|PASSWORD/i);
        expect(codigo).not.toMatch(/CREATE\s+POLICY[^;]*\bFOR\s+ALL\b/i);
        expect(codigo).not.toMatch(/AS\s+RESTRICTIVE/i);
        expect(codigo).not.toMatch(/\b(ALTER|DROP)\s+POLICY\b/i);
      });

      it("solo crea las seis tablas esperadas, con RLS activa y forzada, y a las anteriores solo les agrega el ambiente y una única", async () => {
        const { codigo } = await leer();
        const tablasNuevas = (codigo.match(/CREATE\s+TABLE\s+\w+/gi) ?? []).map(
          (t) => t.split(/\s+/)[2] as string,
        );
        expect(tablasNuevas.sort()).toEqual([...TABLAS_NUEVAS]);
        for (const nombre of tablasNuevas) {
          expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} ENABLE ROW LEVEL SECURITY`));
          expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} FORCE ROW LEVEL SECURITY`));
        }
        const alteraciones = (
          codigo.match(/\bALTER\s+TABLE\s+(?:public\.)?\w+\s+\w+(\s+\w+)?/gi) ?? []
        )
          .map((a) => a.replace(/\s+/g, " "))
          .filter((a) => !/ENABLE ROW|FORCE ROW/.test(a));
        expect(alteraciones.sort()).toEqual([
          "ALTER TABLE datos_fiscales ADD CONSTRAINT",
          "ALTER TABLE punto_de_venta ADD COLUMN",
          "ALTER TABLE serie_comprobante ADD COLUMN",
          "ALTER TABLE serie_comprobante ALTER COLUMN",
          "ALTER TABLE serie_comprobante DROP CONSTRAINT",
        ]);
      });

      it("toda función nueva fija el search_path (con pg_temp al final) y califica sus tablas con `public.`; son diez nuevas y una reemplazada", async () => {
        const { codigo } = await leer();
        const funciones =
          codigo.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?\$\$;/gi) ?? [];
        expect(funciones).toHaveLength(12);
        expect(codigo.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)/gi)).toEqual([
          "CREATE OR REPLACE FUNCTION serie_comprobante_validar_cambio",
        ]);
        for (const funcion of funciones) {
          expect(funcion).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/);
          expect(funcion).not.toMatch(
            /(?<!DISTINCT\s)\b(FROM|JOIN)\s+(?!public\.)(?!pg_)\w+\b(?!\s*\()/i,
          );
        }
      });

      it("las concesiones: nadie recibe DELETE, TRUNCATE, REFERENCES, TRIGGER ni ALL; EXECUTE solo la validación de textos y solo a la aplicación; todo es para la aplicación", async () => {
        const { codigo } = await leer();
        const concesiones = codigo.match(/\bGRANT\b[^;]*;/gi) ?? [];
        expect(concesiones.length).toBeGreaterThan(10);
        for (const concesion of concesiones) {
          expect(concesion, concesion).not.toMatch(/\b(DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b/i);
          expect(concesion, concesion).toMatch(/\bTO\s+pedernal_app;$/);
          if (/\bEXECUTE\b/i.test(concesion))
            expect(concesion).toMatch(/texto_fiscal_valido\(text, integer\)/);
        }
      });
    });

    // ===========================================================================================================
    // La reversión
    // ===========================================================================================================
    describe("reversión", () => {
      const revertir = async (c: pg.Client, confirmar: boolean) => {
        const sql = await readFile(await archivoDeReversion(), "utf8");
        await c.query("begin");
        try {
          if (confirmar) await c.query("set local pedernal.confirmar_reversion = 'SI'");
          await c.query(sql);
          await c.query("commit");
        } catch (error) {
          await c.query("rollback");
          throw error;
        }
      };

      it("vive fuera de la carpeta que aplica el ejecutor (nunca se corre sola), es destructiva y lo dice, sin CASCADE ni contraseñas", async () => {
        const aplicables = (await readdir(CARPETA_DE_MIGRACIONES)).filter((n) =>
          /^\d{4}_[a-z0-9_]+\.sql$/.test(n),
        );
        expect(aplicables).toContain(await archivoDeFacturacion());
        expect(aplicables.filter((n) => n.includes("revertir"))).toEqual([]);
        const reversion = await readFile(await archivoDeReversion(), "utf8");
        expect(reversion).toMatch(/DESTRUCTIVA/);
        expect(reversion).toMatch(/AVISAR AL DUEÑO/);
        expect(reversion).not.toMatch(/PASSWORD\s+'/i);
        expect(reversion.replace(/--.*$/gm, "")).not.toMatch(/\bCASCADE\b/i);
      });

      it("sin datos de facturación no pide confirmación; deja el catálogo y los datos como antes, y la migración se puede aplicar de nuevo con el mismo resultado", async () => {
        await conPrevias(async (previa, completa) => {
          await sembrarDatosPrevios(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          const datosAntes = await huellaDeDatos(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const catalogoConFacturacion = await huellaDeCatalogo(previa.cliente);
          expect(catalogoConFacturacion).not.toEqual(catalogoAntes);

          await revertir(previa.cliente, false);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
          expect(
            (
              await previa.cliente.query(
                "select nombre from migracion where nombre like '%\\_facturacion.sql'",
              )
            ).rows,
          ).toEqual([]);

          // Vuelve a aplicarse y deja lo mismo que la primera vez.
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, completa);
          expect(otra.aplicadas).toEqual([await archivoDeFacturacion()]);
          // Una columna borrada deja su hueco en la numeración interna: al volver, `ambiente` es la 13ª y no la 12ª.
          // Lo demás (incluido que sigue siendo la última) es idéntico.
          const sinPosicion = (h: Record<string, string[]>) => ({
            ...h,
            columnas: (h["columnas"] ?? []).map((l) =>
              l.replace(/^((?:punto_de_venta|serie_comprobante)\.ambiente):\d+:/, "$1:N:"),
            ),
          });
          expect(sinPosicion(await huellaDeCatalogo(previa.cliente))).toEqual(
            sinPosicion(catalogoConFacturacion),
          );
        });
      });

      it("con comprobantes pide confirmación expresa (y no toca nada si falta); confirmada, revierte: el catálogo es el de antes y los puntos de venta y las series conservan sus datos", async () => {
        await conPrevias(async (previa, completa) => {
          await sembrarDatosPrevios(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const e = await crearEscenario(previa.cliente);
          await crearComprobante(previa.cliente, e);
          const datosConFacturacion = await huellaDeDatos(previa.cliente);
          await expect(revertir(previa.cliente, false)).rejects.toThrow(
            /pedernal\.confirmar_reversion/,
          );
          // El rechazo no deshizo ni tocó nada.
          expect(
            (await previa.cliente.query("select count(*)::int as n from comprobante")).rows,
          ).toEqual([{ n: 1 }]);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosConFacturacion);
          await revertir(previa.cliente, true);
          for (const tabla of TABLAS_NUEVAS) {
            expect(
              (await previa.cliente.query("select to_regclass($1) as t", [`public.${tabla}`])).rows,
              tabla,
            ).toEqual([{ t: null }]);
          }
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          // Las filas de lo anterior siguen (más las del escenario nuevo, que son de 0006).
          const { rows } = await previa.cliente.query<{ n: number }>(
            "select count(*)::int as n from serie_comprobante",
          );
          expect(rows[0]?.n).toBeGreaterThan(0);
        });
      });

      it("con puntos de venta o series en producción también pide confirmación (se perdería el ambiente)", async () => {
        await conPrevias(async (previa, completa) => {
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const e = await crearEscenario(previa.cliente);
          await previa.cliente.query(
            "update punto_de_venta set ambiente = 'PRODUCCION' where id = $1",
            [e.pv],
          );
          await expect(revertir(previa.cliente, false)).rejects.toThrow(
            /pedernal\.confirmar_reversion/,
          );
          await revertir(previa.cliente, true);
        });
      });

      it("si un punto de venta tiene series de los dos ambientes para el mismo tipo, se frena aun con la confirmación y no toca nada", async () => {
        await conPrevias(async (previa, completa) => {
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const e = await crearEscenario(previa.cliente);
          const insertar = (ambiente: string) =>
            previa.cliente.query(
              `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_B', 1, $4)`,
              [e.empresa, e.pv, e.emisor, ambiente],
            );
          await insertar("HOMOLOGACION");
          await previa.cliente.query(
            "update punto_de_venta set ambiente = 'PRODUCCION' where id = $1",
            [e.pv],
          );
          await insertar("PRODUCCION");
          const antes = await huellaDeCatalogo(previa.cliente);
          await expect(revertir(previa.cliente, true)).rejects.toThrow(
            /series de los dos ambientes/,
          );
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
          expect(
            (
              await previa.cliente.query(
                "select count(*)::int as n from serie_comprobante where punto_de_venta_id = $1",
                [e.pv],
              )
            ).rows,
          ).toEqual([{ n: 2 }]);
        });
      });

      it("necesita un rol que evada RLS: si no, rechaza (así no cuenta cero filas en silencio)", async () => {
        await conPrevias(async (previa, completa) => {
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const sql = await readFile(await archivoDeReversion(), "utf8");
          const c = new pg.Client({ connectionString: previa.aparte.base.plataforma });
          await c.connect();
          try {
            await expect(c.query(sql)).rejects.toThrow(/evada RLS/);
          } finally {
            await c.end();
          }
        });
      });

      it("no usa CASCADE: si otra tabla depende de las nuevas, la reversión falla entera y no borra nada", async () => {
        await conPrevias(async (previa, completa) => {
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          await previa.cliente.query(
            `create table dependiente (id uuid primary key, certificado_id uuid, empresa_id uuid,
                  foreign key (certificado_id, empresa_id) references certificado_arca (id, empresa_id))`,
          );
          await expect(revertir(previa.cliente, false)).rejects.toThrow(/depend/);
          expect(
            (await previa.cliente.query("select to_regclass('public.certificado_arca') as t"))
              .rows[0],
          ).not.toEqual({ t: null });
          expect(
            (
              await previa.cliente.query(
                "select nombre from migracion where nombre like '%\\_facturacion.sql'",
              )
            ).rowCount,
          ).toBe(1);
        });
      });
    });
  },
);
