import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  comoPlataforma,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import { SesionDePrueba } from "./sesiones";

/**
 * 0113 (la plataforma lee los roles propios, T5 de H4b) contra una base real, con el rol de la plataforma y su contexto firmado: con un actor vigente lee la columna del rol propio de la
 * membresía, el estado de cada rol propio y las acciones de sus versiones, y nada más (ni el nombre que le puso el gerente); sin actor vigente no ve ninguna fila; no escribe nada;
 * y la reversión quita lo agregado sin tocar datos.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const MIGRACION = join(
  import.meta.dirname,
  "../../migraciones/0113_soporte_lee_los_roles_propios.sql",
);
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0113_revertir_soporte_lee_los_roles_propios.sql",
);
const ACCIONES = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
  "ventas.ver",
];

describe.skipIf(base === null)(
  "migración 0113: la plataforma lee los roles propios (T5 de H4b)",
  () => {
    const entorno = crearEntornoDePrueba(base as BaseDePruebas, 2);
    let dueno: pg.Client;
    let empresa: string;
    let persona: string;
    let rol: string;

    beforeAll(async () => {
      dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
      await dueno.connect();
      empresa = (await crearEmpresaActiva(entorno)).empresa;
      persona = (await crearPersonaDeBase(dueno)).id;
      await crearMembresiaDeBase(dueno, empresa as never, persona, "OPERADOR", true);
      const autor = (await crearPersonaDeBase(dueno)).id;
      rol = randomUUID();
      await dueno.query(
        "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'Cajero', 'cajero')",
        [rol, empresa],
      );
      await dueno.query(
        "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, 1, $3::text[], $4, now())",
        [empresa, rol, ACCIONES, autor],
      );
      await dueno.query("alter table membresia disable trigger membresia_cambio");
      await dueno.query(
        "update membresia set rol = 'PROPIO', rol_propio_id = $3 where empresa_id = $1 and persona_id = $2",
        [empresa, persona, rol],
      );
      await dueno.query("alter table membresia enable trigger membresia_cambio");
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
    });

    const comoPlataformaConActor = () =>
      SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_plataforma", comoPlataforma());
    const comoPlataformaSinActor = () =>
      SesionDePrueba.abrir(
        base as BaseDePruebas,
        "pedernal_plataforma",
        comoPlataforma({ tipo: "ADMIN", id: randomUUID() as never }),
      );

    it("con un actor vigente lee el rol propio de la membresía, si el rol está activo y las acciones de su versión", async () => {
      const s = await comoPlataformaConActor();
      try {
        const m = await s.intentar(
          "select rol, rol_propio_id from membresia where empresa_id = $1 and persona_id = $2",
          [empresa, persona],
        );
        expect(m).toMatchObject({ ok: true, rows: [{ rol: "PROPIO", rol_propio_id: rol }] });
        const r = await s.intentar(
          "select id, empresa_id, activo from rol_de_empresa where id = $1",
          [rol],
        );
        expect(r).toMatchObject({
          ok: true,
          rows: [{ id: rol, empresa_id: empresa, activo: true }],
        });
        const v = await s.intentar(
          "select numero, acciones from version_de_rol where empresa_id = $1 and rol_id = $2",
          [empresa, rol],
        );
        expect(v).toMatchObject({ ok: true, rows: [{ numero: 1, acciones: ACCIONES }] });
      } finally {
        await s.deshacer();
      }
    });

    it("no ve nada del rol que no necesita (el nombre, quién lo creó, la versión de control) ni escribe", async () => {
      const s = await comoPlataformaConActor();
      try {
        for (const sql of [
          "select nombre from rol_de_empresa",
          "select nombre_clave from rol_de_empresa",
          "select version from rol_de_empresa",
          "select creado_por from version_de_rol",
          "select * from rol_de_empresa",
          "select * from version_de_rol",
        ]) {
          expect(await s.intentar(sql), sql).toMatchObject({ ok: false, codigo: "42501" });
        }
        for (const sql of [
          "update rol_de_empresa set activo = false",
          "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values (gen_random_uuid(), gen_random_uuid(), 'x', 'x')",
          "delete from rol_de_empresa",
          "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values (gen_random_uuid(), gen_random_uuid(), 1, '{}', gen_random_uuid(), now())",
          "delete from version_de_rol",
          "update membresia set rol_propio_id = null",
        ]) {
          expect(await s.intentar(sql), sql).toMatchObject({ ok: false, codigo: "42501" });
        }
      } finally {
        await s.deshacer();
      }
    });

    it("sin un actor de plataforma vigente no ve ninguna fila de las tres tablas", async () => {
      const s = await comoPlataformaSinActor();
      try {
        for (const sql of [
          "select rol_propio_id from membresia",
          "select id from rol_de_empresa",
          "select rol_id from version_de_rol",
        ]) {
          expect(await s.intentar(sql), sql).toMatchObject({ ok: true, filas: 0 });
        }
      } finally {
        await s.deshacer();
      }
    });

    it("la aplicación sigue viendo solo lo de su empresa (0113 no toca su aislamiento)", async () => {
      const { rows } = await dueno.query<{ grantee: string; tabla: string }>(
        "select grantee, table_name as tabla from information_schema.role_table_grants where table_name in ('rol_de_empresa', 'version_de_rol') and grantee = 'pedernal_plataforma'",
      );
      // Ningún privilegio de TABLA para la plataforma: solo columnas.
      expect(rows).toEqual([]);
    });

    it("la reversión quita lo agregado, no toca datos y se puede volver a aplicar", async () => {
      const aparte = await crearBaseAparte(base as BaseDePruebas);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      try {
        await cliente.connect();
        const privilegios = async () =>
          (
            await cliente.query<{ n: number }>(
              `select (
               (select count(*) from pg_policies where policyname like '%plataforma%' and tablename in ('rol_de_empresa', 'version_de_rol'))
               + (case when has_column_privilege('pedernal_plataforma', 'membresia', 'rol_propio_id', 'SELECT') then 1 else 0 end)
               + (case when has_column_privilege('pedernal_plataforma', 'rol_de_empresa', 'activo', 'SELECT') then 1 else 0 end)
               + (case when has_column_privilege('pedernal_plataforma', 'version_de_rol', 'acciones', 'SELECT') then 1 else 0 end)
             )::int as n`,
            )
          ).rows[0]?.n;
        expect(await privilegios()).toBe(7);
        const texto = await readFile(REVERSION, "utf8");
        await cliente.query("begin");
        await cliente.query(texto);
        await cliente.query("commit");
        expect(await privilegios()).toBe(0);
        // Segunda reversión: frena (ya no está aplicada), sin tocar nada.
        await cliente.query("begin");
        await expect(cliente.query(texto)).rejects.toMatchObject({ code: "55000" });
        await cliente.query("rollback");
        // Se vuelve a aplicar y queda igual que antes; aplicarla dos veces frena.
        const migracion = await readFile(MIGRACION, "utf8");
        await cliente.query("begin");
        await cliente.query(migracion);
        await cliente.query("commit");
        expect(await privilegios()).toBe(7);
        await cliente.query("begin");
        await expect(cliente.query(migracion)).rejects.toMatchObject({ code: "55000" });
        await cliente.query("rollback");
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });
  },
);
