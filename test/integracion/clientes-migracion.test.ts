import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  nombreCompletoDeParte,
  normalizarParaBusqueda,
  LETRAS_CON_ACENTO_DE_BUSQUEDA,
  LETRAS_SIN_ACENTO_DE_BUSQUEDA,
} from "../../src/modulos/clientes/dominio/busqueda";
import { documentoNormalizado } from "../../src/modulos/clientes/dominio/documento";
import {
  ESTADOS_DE_PARTE,
  TRANSICIONES_DE_PARTE,
} from "../../src/modulos/clientes/dominio/estados";
import { ROLES_DE_PARTE } from "../../src/modulos/clientes/dominio/roles";
import { REGLAS_DE_VINCULO, TIPOS_DE_VINCULO } from "../../src/modulos/clientes/dominio/vinculos";
import { acepta, check, clave, conAppDe, crearMundo, denegado, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { baseConMigraciones, CARPETA_DE_MIGRACIONES, huellaDeCatalogo } from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import type { SesionDePrueba } from "./sesiones";

/**
 * La migración 0034 (E9 directorio) contra una base real, con el rol de la aplicación y el dueño: RLS forzada y una política por comando, nada se
 * borra ni se vacía, el documento único por empresa (también entre desactivadas), las reglas de documento (CUIT con dígito verificador, pasaporte de 6 a 9,
 * una empresa solo CUIT o documento extranjero), el email y el teléfono, las columnas generadas iguales a las funciones del dominio, la tabla de
 * transiciones y las reglas de los vínculos iguales a las del dominio, el aislamiento entre empresas, la concurrencia sobre el documento y la reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = ["rol_de_parte", "tipo_de_vinculo", "parte", "parte_rol", "parte_vinculo"] as const;
const COMANDOS_POR_TABLA: Readonly<Record<(typeof TABLAS)[number], readonly string[]>> = {
  rol_de_parte: ["SELECT"],
  tipo_de_vinculo: ["SELECT"],
  parte: ["SELECT", "INSERT", "UPDATE"],
  parte_rol: ["SELECT", "INSERT", "UPDATE"],
  parte_vinculo: ["SELECT", "INSERT", "UPDATE"],
};
const ARCHIVO = "0034_clientes.sql";
const REVERSION = join(CARPETA_DE_MIGRACIONES, "reversiones", "0034_revertir_clientes.sql");
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

type Campos = Readonly<Record<string, unknown>>;
type Fila = { id: string; n: number };

/** El INSERT de una parte con los campos que se den (los demás, null); devuelve la sentencia y sus parámetros. */
function altaDeParte(empresa: string, persona: string, campos: Campos = {}) {
  const todos: Record<string, unknown> = {
    empresa_id: empresa,
    idempotencia_alta: randomUUID(),
    naturaleza: "HUMANA",
    nombre: "Juan",
    creado_por: persona,
    ...campos,
  };
  const columnas = Object.keys(todos);
  return {
    texto: `insert into parte (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    parametros: Object.values(todos),
  };
}

describe.skipIf(base === null)("0034 clientes: la migración contra una base real", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const enApp = <T>(
    m: Pick<Mundo, "empresa" | "persona">,
    trabajo: (s: SesionDePrueba) => Promise<T>,
  ): Promise<T> => conAppDe(b(), m, trabajo);
  const crear = async (s: SesionDePrueba, m: Mundo, campos: Campos = {}) => {
    const a = altaDeParte(m.empresa, m.persona, campos);
    const r = await s.intentar(a.texto, a.parametros);
    return r;
  };

  describe("el esquema", () => {
    it("crea las cinco tablas con RLS forzada, una política por comando y sin DELETE ni TRUNCATE para nadie", async () => {
      const tablas = (
        await dueno.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `select relname, relrowsecurity, relforcerowsecurity from pg_class
            where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)`,
          [[...TABLAS]],
        )
      ).rows;
      expect(tablas.map((t) => t.relname).sort()).toEqual([...TABLAS].sort());
      for (const t of tablas) {
        expect(t.relrowsecurity, t.relname).toBe(true);
        expect(t.relforcerowsecurity, t.relname).toBe(true);
      }
      const politicas = (
        await dueno.query<{ tablename: string; cmd: string }>(
          "select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)",
          [[...TABLAS]],
        )
      ).rows;
      for (const tabla of TABLAS) {
        expect(
          politicas
            .filter((p) => p.tablename === tabla)
            .map((p) => p.cmd)
            .sort(),
          tabla,
        ).toEqual([...COMANDOS_POR_TABLA[tabla]].sort());
      }
      const privilegios = (
        await dueno.query<{ table_name: string; privilege_type: string }>(
          `select table_name, privilege_type from information_schema.role_table_grants
            where table_schema = 'public' and table_name = any($1) and grantee = 'pedernal_app'`,
          [[...TABLAS]],
        )
      ).rows;
      expect(privilegios.filter((p) => ["DELETE", "TRUNCATE"].includes(p.privilege_type))).toEqual(
        [],
      );
    });

    it("siembra los dos vocabularios y son de solo inserción (ni el dueño los cambia ni los borra)", async () => {
      expect(
        (
          await dueno.query<{ codigo: string }>("select codigo from rol_de_parte order by codigo")
        ).rows.map((r) => r.codigo),
      ).toEqual([...ROLES_DE_PARTE].sort());
      expect(
        (
          await dueno.query<{ codigo: string }>(
            "select codigo from tipo_de_vinculo order by codigo",
          )
        ).rows.map((r) => r.codigo),
      ).toEqual([...TIPOS_DE_VINCULO].sort());
      await expect(
        dueno.query<Fila>("update rol_de_parte set descripcion = 'x'"),
      ).rejects.toThrow();
      await expect(dueno.query<Fila>("delete from tipo_de_vinculo")).rejects.toThrow();
      await expect(dueno.query<Fila>("truncate rol_de_parte")).rejects.toThrow();
    });

    it("el dueño tampoco borra ni vacía una parte, un rol ni un vínculo", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        acepta(await crear(s, m));
        acepta(await s.confirmar());
      });
      const otra = altaDeParte(m.empresa, m.persona);
      const id2 = String((await dueno.query<Fila>(otra.texto, otra.parametros)).rows[0]?.id);
      const id1 = String(
        (
          await dueno.query<Fila>("select id from parte where empresa_id = $1 and id <> $2", [
            m.empresa,
            id2,
          ])
        ).rows[0]?.id,
      );
      await dueno.query<Fila>(
        "insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, 'PROVEEDOR')",
        [m.empresa, id1],
      );
      await dueno.query<Fila>(
        "insert into parte_vinculo (empresa_id, parte_id, de_parte_id, tipo) values ($1, $2, $3, 'CONTACTO')",
        [m.empresa, id1, id2],
      );
      await expect(dueno.query<Fila>("delete from parte")).rejects.toThrow();
      await expect(dueno.query<Fila>("truncate parte")).rejects.toThrow();
      await expect(dueno.query<Fila>("delete from parte_rol")).rejects.toThrow();
      await expect(dueno.query<Fila>("truncate parte_rol")).rejects.toThrow();
      await expect(dueno.query<Fila>("delete from parte_vinculo")).rejects.toThrow();
      await expect(dueno.query<Fila>("truncate parte_vinculo")).rejects.toThrow();
    });

    it("las columnas de búsqueda y documento las calcula la base y la aplicación no las puede escribir", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        for (const campos of [
          { nombre_busqueda: "x" },
          { documento_normalizado: "x" },
          { telefono_digitos: "1" },
        ]) {
          const r = await crear(s, m, campos);
          expect(r.ok, JSON.stringify(campos)).toBe(false);
          // 428C9: «no se puede insertar un valor en una columna generada»; 42501: sin permiso sobre la columna.
          if (!r.ok) expect(["428C9", "42501"], r.mensaje).toContain(r.codigo);
        }
        denegado(await crear(s, m, { estado: "INACTIVA" }));
      });
    });
  });

  describe("las columnas generadas son las funciones del dominio", () => {
    it("documento_normalizado coincide con documentoNormalizado para cada tipo", async () => {
      const m = await crearMundo(dueno);
      const casos = [
        { tipo: "CUIT", pais: null, numero: "30712345671" },
        { tipo: "DNI", pais: null, numero: "12345678" },
        { tipo: "PASAPORTE", pais: "AR", numero: "ABC123456" },
        { tipo: "ID_EXTRANJERO", pais: "CL", numero: "RUT123" },
      ] as const;
      await enApp(m, async (s) => {
        for (const caso of casos) {
          const r = await crear(s, m, {
            documento_tipo: caso.tipo,
            documento_pais: caso.pais,
            documento_numero: caso.numero,
          });
          acepta(r);
          const leida = await s.intentar("select documento_normalizado from parte where id = $1", [
            r.ok ? r.rows[0]?.id : null,
          ]);
          expect(leida.ok && leida.rows[0]?.documento_normalizado, caso.tipo).toBe(
            documentoNormalizado(caso),
          );
        }
      });
    });

    it("el CUIT, el CUIL y el CDI con el mismo número son el mismo documento", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        acepta(await crear(s, m, { documento_tipo: "CUIT", documento_numero: "30712345671" }));
        clave(
          await crear(s, m, { documento_tipo: "CUIL", documento_numero: "30712345671" }),
          "parte_documento_uk",
        );
      });
    });

    it("nombre_busqueda coincide con normalizarParaBusqueda(nombreCompletoDeParte) y las listas de letras son las mismas", async () => {
      const m = await crearMundo(dueno);
      const { rows: sql } = await dueno.query<{ def: string }>(
        `select pg_get_expr(adbin, adrelid) as def from pg_attrdef
          where adrelid = 'parte'::regclass and adnum = (select attnum from pg_attribute where attrelid = 'parte'::regclass and attname = 'nombre_busqueda')`,
      );
      expect(sql[0]?.def).toContain(LETRAS_CON_ACENTO_DE_BUSQUEDA);
      expect(sql[0]?.def).toContain(LETRAS_SIN_ACENTO_DE_BUSQUEDA);
      const casos = [
        { apellido: "Pérez", nombre: "Juan", alias: "Juancho" },
        { apellido: null, nombre: "Ñandú & Çia SA", alias: null },
        { apellido: "Güemes", nombre: "Ángela", alias: null },
        { apellido: null, nombre: "Distribuidora Sur", alias: "El Sur" },
      ];
      await enApp(m, async (s) => {
        for (const c of casos) {
          const r = await crear(s, m, {
            naturaleza: c.apellido === null ? "JURIDICA" : "HUMANA",
            nombre: c.nombre,
            apellido: c.apellido,
            alias: c.alias,
          });
          acepta(r);
          const leida = await s.intentar("select nombre_busqueda from parte where id = $1", [
            r.ok ? r.rows[0]?.id : null,
          ]);
          expect(leida.ok && leida.rows[0]?.nombre_busqueda).toBe(
            normalizarParaBusqueda(nombreCompletoDeParte(c)),
          );
        }
      });
    });
  });

  describe("las reglas de cada dato (R11)", () => {
    it("documento: CUIT con dígito mal, pasaporte de 5 y de 10, una empresa con DNI, un DNI con cero, país faltante", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        check(
          await crear(s, m, { documento_tipo: "CUIT", documento_numero: "30712345672" }),
          "parte_documento_ck",
        );
        check(
          await crear(s, m, {
            documento_tipo: "PASAPORTE",
            documento_pais: "AR",
            documento_numero: "ABC12",
          }),
          "parte_documento_ck",
        );
        check(
          await crear(s, m, {
            documento_tipo: "PASAPORTE",
            documento_pais: "AR",
            documento_numero: "ABC1234567",
          }),
          "parte_documento_ck",
        );
        check(
          await crear(s, m, {
            naturaleza: "JURIDICA",
            documento_tipo: "DNI",
            documento_numero: "12345678",
          }),
          "parte_naturaleza_documento_ck",
        );
        check(
          await crear(s, m, { documento_tipo: "DNI", documento_numero: "012345678" }),
          "parte_documento_ck",
        );
        check(
          await crear(s, m, { documento_tipo: "ID_EXTRANJERO", documento_numero: "RUT123" }),
          "parte_documento_ck",
        );
        check(
          await crear(s, m, {
            documento_tipo: "DNI",
            documento_pais: "AR",
            documento_numero: "12345678",
          }),
          "parte_documento_ck",
        );
      });
    });

    it("acepta una empresa con CUIT o con documento extranjero, y un pasaporte de 6 a 9", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        acepta(
          await crear(s, m, {
            naturaleza: "JURIDICA",
            documento_tipo: "CUIT",
            documento_numero: "30712345671",
          }),
        );
        acepta(
          await crear(s, m, {
            naturaleza: "JURIDICA",
            documento_tipo: "ID_EXTRANJERO",
            documento_pais: "CL",
            documento_numero: "AB1",
          }),
        );
        for (const numero of ["ABC123", "ABC123456"]) {
          acepta(
            await crear(s, m, {
              documento_tipo: "PASAPORTE",
              documento_pais: "BR",
              documento_numero: numero,
            }),
          );
        }
      });
    });

    it("email repetido entra (se avisa, no se bloquea); email mal formado o con mayúsculas, no", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        acepta(await crear(s, m, { email: "a@b.com" }));
        acepta(await crear(s, m, { email: "a@b.com" }));
        check(await crear(s, m, { email: "A@b.com" }), "parte_email_ck");
        check(await crear(s, m, { email: "sin-arroba" }), "parte_email_ck");
        check(await crear(s, m, { email: "a b@c.com" }), "parte_email_ck");
      });
    });

    it("teléfono: una línea de 1 a 40, sin blancos en los extremos ni caracteres de control", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        acepta(await crear(s, m, { telefono: "+54 11 4321-0000 int. 2" }));
        acepta(await crear(s, m, { telefono: "x".repeat(40) }));
        check(await crear(s, m, { telefono: "x".repeat(41) }), "parte_telefono_ck");
        check(await crear(s, m, { telefono: " 4321" }), "parte_telefono_ck");
        check(await crear(s, m, { telefono: "43\n21" }), "parte_telefono_ck");
        check(await crear(s, m, { telefono: "" }), "parte_telefono_ck");
      });
    });

    it("una empresa no tiene apellido; el nombre es obligatorio salvo en una anonimizada", async () => {
      const m = await crearMundo(dueno);
      await enApp(m, async (s) => {
        check(
          await crear(s, m, { naturaleza: "JURIDICA", apellido: "Pérez" }),
          "parte_apellido_ck",
        );
        check(await crear(s, m, { nombre: null }), "parte_nombre_anonimizada_ck");
      });
    });

    it("el autor del alta tiene que ser la persona del contexto", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      await enApp(m, async (s) => {
        const r = await s.intentar(
          altaDeParte(m.empresa, otra.persona).texto,
          altaDeParte(m.empresa, otra.persona).parametros,
        );
        expect(r.ok).toBe(false);
      });
    });
  });

  describe("el documento es único por empresa, también entre desactivadas (C7, C9)", () => {
    it("un documento, una parte; la desactivada lo conserva; otra empresa puede tener el mismo", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      const doc = { documento_tipo: "DNI", documento_numero: "30111222" };
      const id = await enApp(m, async (s) => {
        const r = await crear(s, m, doc);
        acepta(r);
        clave(await crear(s, m, doc), "parte_documento_uk");
        const parte = r.ok ? String(r.rows[0]?.id) : "";
        acepta(await s.intentar("update parte set estado = 'INACTIVA' where id = $1", [parte]));
        clave(await crear(s, m, doc), "parte_documento_uk");
        return parte;
      });
      expect(id).not.toBe("");
      await enApp(otra, async (s) => {
        acepta(await crear(s, otra, doc));
      });
    });

    it("dos altas simultáneas del mismo documento: una entra y la otra choca con la única", async () => {
      const m = await crearMundo(dueno);
      const doc = { documento_tipo: "DNI", documento_numero: "30222333" };
      const [a, c] = await Promise.all([
        conAppDe(b(), m, async (s) => {
          const r = await crear(s, m, doc);
          const confirmacion = await s.confirmar();
          return r.ok ? confirmacion : r;
        }),
        conAppDe(b(), m, async (s) => {
          const r = await crear(s, m, doc);
          const confirmacion = await s.confirmar();
          return r.ok ? confirmacion : r;
        }),
      ]);
      expect([a.ok, c.ok].sort()).toEqual([false, true]);
      const perdedora = a.ok ? c : a;
      expect(perdedora.ok === false && perdedora.codigo).toBe("23505");
      expect(
        (
          await dueno.query<Fila>("select count(*)::int as n from parte where empresa_id = $1", [
            m.empresa,
          ])
        ).rows[0]?.n,
      ).toBe(1);
    });

    it("la misma clave de alta en una empresa es una sola parte; en dos empresas, dos partes", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      const idem = randomUUID();
      await enApp(m, async (s) => {
        acepta(await crear(s, m, { idempotencia_alta: idem }));
        clave(await crear(s, m, { idempotencia_alta: idem }), "parte_idempotencia_uk");
      });
      await enApp(otra, async (s) => {
        acepta(await crear(s, otra, { idempotencia_alta: idem }));
      });
    });
  });

  describe("aislamiento entre empresas (R6)", () => {
    it("una empresa no ve ni toca las partes de la otra, ni siquiera por id", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      const id = await enApp(m, async (s) => {
        const r = await crear(s, m, { nombre: "Solo de la A" });
        acepta(r);
        acepta(await s.confirmar());
        return String(r.ok ? r.rows[0]?.id : "");
      });
      await enApp(otra, async (s) => {
        const leida = await s.intentar("select id from parte where id = $1", [id]);
        expect(leida.ok && leida.filas).toBe(0);
        const cambio = await s.intentar("update parte set nota = 'x' where id = $1", [id]);
        expect(cambio.ok && cambio.filas).toBe(0);
        const ajeno = await crear(s, otra, { empresa_id: m.empresa });
        expect(ajeno.ok).toBe(false);
        // Un rol o un vínculo contra una parte de otra empresa: la clave foránea compuesta no lo deja.
        const rol = await s.intentar(
          "insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, 'PROVEEDOR')",
          [otra.empresa, id],
        );
        expect(rol.ok).toBe(false);
      });
    });
  });

  describe("estados y transiciones: las del dominio", () => {
    const anonimizar = `update parte set estado = 'ANONIMIZADA', nombre = null, apellido = null, alias = null, documento_tipo = null,
      documento_pais = null, documento_numero = null, condicion_iva = null, email = null, telefono = null, dom_pais = null, nota = null where id = $1`;

    it("recorre las nueve combinaciones y la base permite exactamente las de TRANSICIONES_DE_PARTE", async () => {
      for (const desde of ESTADOS_DE_PARTE) {
        for (const hacia of ESTADOS_DE_PARTE) {
          const m = await crearMundo(dueno);
          const id = String(
            (
              await dueno.query<Fila>(
                altaDeParte(m.empresa, m.persona).texto,
                altaDeParte(m.empresa, m.persona).parametros,
              )
            ).rows[0]?.id,
          );
          if (desde === "INACTIVA")
            await dueno.query<Fila>("update parte set estado = 'INACTIVA' where id = $1", [id]);
          if (desde === "ANONIMIZADA") await dueno.query<Fila>(anonimizar, [id]);
          const sentencia =
            hacia === "ANONIMIZADA" ? anonimizar : "update parte set estado = $2 where id = $1";
          const parametros = hacia === "ANONIMIZADA" ? [id] : [id, hacia];
          let rechazo: string | null = null;
          await dueno.query<Fila>("begin");
          try {
            await dueno.query<Fila>(sentencia, parametros);
            await dueno.query<Fila>("set constraints all immediate");
          } catch (error) {
            rechazo = (error as { constraint?: string }).constraint ?? "otro";
          } finally {
            await dueno.query<Fila>("rollback");
          }
          // Una parte anonimizada no cambia nunca más: ni siquiera «a sí misma».
          const permitida =
            desde === "ANONIMIZADA"
              ? false
              : desde === hacia || TRANSICIONES_DE_PARTE[desde].includes(hacia);
          expect(rechazo === null, `${desde} → ${hacia}: ${rechazo}`).toBe(permitida);
        }
      }
    });

    it("la identidad de una parte no cambia nunca (id, empresa, clave de alta, autor, atajo y fecha de alta)", async () => {
      const m = await crearMundo(dueno);
      const a = altaDeParte(m.empresa, m.persona);
      const id = String((await dueno.query<Fila>(a.texto, a.parametros)).rows[0]?.id);
      for (const cambio of [
        "idempotencia_alta = gen_random_uuid()",
        "es_atajo = true",
        "creado_en = now() - interval '1 day'",
        "creado_por = null",
      ]) {
        await expect(
          dueno.query<Fila>(`update parte set ${cambio} where id = $1`, [id]),
          cambio,
        ).rejects.toThrow(/identidad/);
      }
    });

    it("una parte con vínculos que exigen su naturaleza no la cambia", async () => {
      const m = await crearMundo(dueno);
      const empresa = String(
        (
          await dueno.query<Fila>(
            altaDeParte(m.empresa, m.persona, { naturaleza: "JURIDICA", nombre: "Sur SA" }).texto,
            altaDeParte(m.empresa, m.persona, { naturaleza: "JURIDICA", nombre: "Sur SA" })
              .parametros,
          )
        ).rows[0]?.id,
      );
      const persona = String(
        (
          await dueno.query<Fila>(
            altaDeParte(m.empresa, m.persona).texto,
            altaDeParte(m.empresa, m.persona).parametros,
          )
        ).rows[0]?.id,
      );
      await dueno.query<Fila>(
        "insert into parte_vinculo (empresa_id, parte_id, de_parte_id, tipo) values ($1, $2, $3, 'AGENTE_DE')",
        [m.empresa, persona, empresa],
      );
      await expect(
        dueno.query<Fila>(
          "update parte set naturaleza = 'JURIDICA', apellido = null where id = $1",
          [persona],
        ),
      ).rejects.toThrow(/vínculos/);
    });
  });

  describe("vínculos: las reglas del dominio", () => {
    it("cada tipo exige lo que dice REGLAS_DE_VINCULO; nadie es contacto de sí mismo", async () => {
      const m = await crearMundo(dueno);
      const nueva = async (campos: Campos) => {
        const a = altaDeParte(m.empresa, m.persona, campos);
        return String((await dueno.query<Fila>(a.texto, a.parametros)).rows[0]?.id);
      };
      const persona = await nueva({});
      const otraPersona = await nueva({ nombre: "Ana" });
      const empresa = await nueva({ naturaleza: "JURIDICA", nombre: "Sur SA" });
      const intento = async (tipo: string, parte: string, de: string) => {
        await dueno.query<Fila>("savepoint v");
        try {
          await dueno.query<Fila>(
            "insert into parte_vinculo (empresa_id, parte_id, de_parte_id, tipo) values ($1, $2, $3, $4)",
            [m.empresa, parte, de, tipo],
          );
          await dueno.query<Fila>("rollback to savepoint v");
          return "ok";
        } catch (error) {
          await dueno.query<Fila>("rollback to savepoint v");
          return (error as { constraint?: string }).constraint ?? "otro";
        }
      };
      await dueno.query<Fila>("begin");
      try {
        for (const tipo of TIPOS_DE_VINCULO) {
          const regla = REGLAS_DE_VINCULO[tipo];
          expect(await intento(tipo, persona, empresa), `${tipo} persona→empresa`).toBe("ok");
          expect(await intento(tipo, empresa, persona), `${tipo} empresa→persona`).toBe(
            regla.contactoHumana ? "parte_vinculo_contacto_humana" : "ok",
          );
          expect(await intento(tipo, persona, otraPersona), `${tipo} persona→persona`).toBe(
            regla.deParteJuridica ? "parte_vinculo_de_parte_juridica" : "ok",
          );
          // Con `AGENTE_DE` el disparador de la empresa responde antes que el CHECK de «consigo misma»: se prueba con `CONTACTO`.
          if (tipo === "CONTACTO") {
            expect(await intento(tipo, persona, persona), `${tipo} consigo misma`).toBe(
              "parte_vinculo_distintas_ck",
            );
          }
        }
      } finally {
        await dueno.query<Fila>("rollback");
      }
    });
  });

  describe("reversión", () => {
    async function conPrevias<T>(
      trabajo: (previa: Awaited<ReturnType<typeof baseConMigraciones>>) => Promise<T>,
    ): Promise<T> {
      const previas = (await readdir(CARPETA_DE_MIGRACIONES))
        .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < ARCHIVO)
        .sort();
      const previa = await baseConMigraciones(b(), previas);
      try {
        return await trabajo(previa);
      } finally {
        await previa.cerrar();
      }
    }
    async function revertir(c: pg.Client, confirmar = false): Promise<void> {
      const sql = await readFile(REVERSION, "utf8");
      await c.query("begin");
      try {
        if (confirmar) await c.query("set local pedernal.confirmar_reversion = 'SI'");
        await c.query(sql);
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    }

    it("sin datos deja la base como antes y la migración se puede aplicar de nuevo", async () => {
      await conPrevias(async (previa) => {
        const antes = await huellaDeCatalogo(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(antes);
        await revertir(previa.cliente);
        const sin = await huellaDeCatalogo(previa.cliente);
        // Las migraciones posteriores a la 0034 (si las hay en la carpeta) también se aplicaron: la reversión de esta solo vale con las tablas libres de dependientes.
        expect(Object.keys(sin)).toEqual(Object.keys(antes));
        await revertir(previa.cliente);
      });
    });

    it("con partes se NIEGA sin borrar nada, salvo confirmación expresa", async () => {
      await conPrevias(async (previa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const m = await crearMundo(previa.cliente);
        const a = altaDeParte(m.empresa, m.persona);
        await previa.cliente.query<Fila>(a.texto, a.parametros);
        await expect(revertir(previa.cliente)).rejects.toThrow(/confirmar_reversion/);
        expect(
          (await previa.cliente.query<Fila>("select count(*)::int as n from parte")).rows[0]?.n,
        ).toBe(1);
      });
    });

    it("necesita un rol que evada RLS: si no, rechaza", async () => {
      await conPrevias(async (previa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        const c = new pg.Client({ connectionString: previa.aparte.base.plataforma });
        await c.connect();
        try {
          await expect(c.query(await readFile(REVERSION, "utf8"))).rejects.toThrow(/evada RLS/);
        } finally {
          await c.end();
        }
      });
    });
  });
});
