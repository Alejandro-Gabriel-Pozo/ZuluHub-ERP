import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  acepta,
  check,
  clave,
  denegado,
  intentoDelDueno,
  referencia,
  sinConfirmar,
} from "./fiscal-apoyo";
import {
  ARCHIVO_0007,
  HASTA_0006,
  ajustarPerilla,
  asignarPlan,
  baseConMigraciones,
  confirmarVersionDeMarca,
  crearBorradorDeMarca,
  crearBorradorDePlan,
  crearDominio,
  crearMarca,
  crearMundoDeMarca,
  crearPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
  publicarVersionDePlan,
} from "./marcas-apoyo";

/**
 * Marcas y planes (M3), migración 0007: las reglas que la base impone tabla por tabla, AUN contra el dueño
 * de la base (los disparadores y las restricciones no distinguen quién escribe). Los permisos por rol y el
 * aislamiento están en `marcas-aislamiento.test.ts`. Cada caso se deshace al terminar.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("marcas y planes: las reglas de la base", () => {
  let previa: Awaited<ReturnType<typeof baseConMigraciones>>;
  let dueno: pg.Client;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    previa = await baseConMigraciones(base, [...HASTA_0006, ARCHIVO_0007]);
    dueno = previa.cliente;
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await previa?.cerrar();
  });

  const q = (texto: string, parametros: unknown[] = []) =>
    intentoDelDueno(dueno, texto, parametros);
  const deshacer = <T>(trabajo: () => Promise<T>) => sinConfirmar(dueno, trabajo);
  const un = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows[0] as T;

  // ===========================================================================================
  // marca
  // ===========================================================================================
  describe("marca", () => {
    it("la migración deja UNA marca: la principal, `zuluhub`, de nivel 0, activa y sin padre", async () => {
      const { rows } = await dueno.query<{ es_principal: boolean }>(
        "select codigo, es_principal, marca_padre_id, nivel, estado, version from marca order by codigo",
      );
      expect(rows.filter((r) => r.es_principal)).toEqual([
        {
          codigo: "zuluhub",
          es_principal: true,
          marca_padre_id: null,
          nivel: 0,
          estado: "ACTIVA",
          version: 1,
        },
      ]);
    });

    it("no puede haber otra principal, ni una principal con padre", async () => {
      await deshacer(async () => {
        clave(
          await q("insert into marca (codigo, es_principal) values ('otra-principal', true)"),
          "marca_principal_uk",
        );
        check(
          await q(
            "insert into marca (codigo, es_principal, marca_padre_id) values ('con-padre', true, $1)",
            [principal],
          ),
          "marca_principal_ck",
        );
      });
    });

    it("el nivel se deriva del padre (0, 1, 2) y el que se mande se ignora; un tercer nivel lo rechaza la base", async () => {
      await deshacer(async () => {
        const raiz = await un<{ nivel: number }>(
          "insert into marca (codigo, nivel) values ('raiz-1', 2) returning nivel",
        );
        expect(raiz.nivel).toBe(0);
        const hija = await crearMarca(dueno, { padre: principal });
        expect(
          (await un<{ nivel: number }>("select nivel from marca where id = $1", [hija])).nivel,
        ).toBe(1);
        const nieta = await crearMarca(dueno, { padre: hija });
        expect(
          (await un<{ nivel: number }>("select nivel from marca where id = $1", [nieta])).nivel,
        ).toBe(2);
        check(
          await q("insert into marca (codigo, marca_padre_id) values ('bisnieta', $1)", [nieta]),
          "marca_nivel_ck",
        );
      });
    });

    it("el padre existe y está activo", async () => {
      await deshacer(async () => {
        referencia(
          await q("insert into marca (codigo, marca_padre_id) values ('sin-padre', $1)", [
            randomUUID(),
          ]),
          "marca_marca_padre_id_fkey",
        );
        const padre = await crearMarca(dueno);
        acepta(await q("update marca set estado = 'RETIRADA' where id = $1", [padre]));
        check(
          await q("insert into marca (codigo, marca_padre_id) values ('hija-de-retirada', $1)", [
            padre,
          ]),
          "marca_padre_retirada",
        );
      });
    });

    it("el código, «principal», el padre, el nivel y el id no cambian nunca (aun con los permisos del dueño)", async () => {
      await deshacer(async () => {
        const padre = await crearMarca(dueno);
        const hija = await crearMarca(dueno, { padre });
        for (const cambio of [
          "codigo = 'otro-codigo'",
          "es_principal = true",
          "marca_padre_id = null",
          `marca_padre_id = '${principal}'`,
          "nivel = 0",
          `id = '${randomUUID()}'`,
          "creado_en = now() - interval '1 day'",
        ]) {
          check(await q(`update marca set ${cambio} where id = $1`, [hija]), "marca_inmutable");
        }
        // y la principal tampoco deja de serlo
        check(
          await q("update marca set es_principal = false where es_principal"),
          "marca_inmutable",
        );
      });
    });

    it("el estado va de ACTIVA a RETIRADA y no vuelve; la principal no se retira", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        acepta(await q("update marca set estado = 'RETIRADA' where id = $1", [m]));
        check(
          await q("update marca set estado = 'ACTIVA' where id = $1", [m]),
          "marca_transicion_invalida",
        );
        check(
          await q("update marca set estado = 'RETIRADA' where es_principal"),
          "marca_principal_ck",
        );
        check(
          await q("update marca set estado = 'OTRO' where id = $1", [m]),
          "marca_transicion_invalida",
        );
        check(
          await q("insert into marca (codigo, estado) values ('estado-malo', 'OTRO')"),
          "marca_estado_ck",
        );
      });
    });

    it("el código tiene la forma de siempre y es único", async () => {
      await deshacer(async () => {
        for (const codigo of ["A", "a", "Ab", "1ab", "ab_c", "a".repeat(41), "", "ab\n"]) {
          check(await q("insert into marca (codigo) values ($1)", [codigo]), "marca_codigo_ck");
        }
        clave(await q("insert into marca (codigo) values ('zuluhub')"), "marca_codigo_uk");
        acepta(await q("insert into marca (codigo) values ('a-1')"));
        acepta(await q("insert into marca (codigo) values ($1)", ["a".repeat(40)]));
      });
    });

    it("cada cambio sube la versión y mueve actualizado_en", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const antes = await un<{ version: number }>("select version from marca where id = $1", [m]);
        await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [m]);
        const despues = await un<{ version: number }>("select version from marca where id = $1", [
          m,
        ]);
        expect(despues.version).toBe(antes.version + 1);
      });
    });

    it("no se borra ni se vacía (también para el dueño)", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        denegado(await q("delete from marca where id = $1", [m]));
        denegado(await q("truncate marca cascade"));
      });
    });
  });

  // ===========================================================================================
  // dominio_de_marca
  // ===========================================================================================
  describe("dominio_de_marca", () => {
    it("el host tiene que ser un host ya normalizado (la regla de normalizarHost, probada en marcas-sql)", async () => {
      await deshacer(async () => {
        for (const host of [
          "",
          "A.com",
          "a.com.",
          "a.com:80",
          "127.0.0.1",
          "a_b.com",
          "ñ.com",
          "a.com/ruta",
          "\u212alendar.com",
          "a.0x1",
        ]) {
          check(
            await q(
              "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, 'x')",
              [principal, host],
            ),
            "dominio_de_marca_host_ck",
          );
        }
        acepta(
          await q(
            "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, 'x')",
            [principal, "xn--cala-9qa.com"],
          ),
        );
      });
    });

    it("un host activo es único en toda la instalación; retirado, se puede registrar de nuevo (aun en otra marca)", async () => {
      await deshacer(async () => {
        const otra = await crearMarca(dueno);
        const host = hostAlAzar();
        const d = await crearDominio(dueno, principal, { host });
        clave(
          await q(
            "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, 'x')",
            [otra, host],
          ),
          "dominio_de_marca_host_uk",
        );
        acepta(
          await q("update dominio_de_marca set activo = false, motivo = 'se fue' where id = $1", [
            d.id,
          ]),
        );
        acepta(
          await q(
            "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, 'x')",
            [otra, host],
          ),
        );
      });
    });

    it("cada marca tiene un solo dominio canónico activo, y el canónico no se retira", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const canonico = await crearDominio(dueno, m, { canonico: true });
        clave(
          await q(
            "insert into dominio_de_marca (marca_id, host, es_canonico, creado_por) values ($1, $2, true, 'x')",
            [m, hostAlAzar()],
          ),
          "dominio_de_marca_canonico_uk",
        );
        const alias = await crearDominio(dueno, m);
        check(
          await q("update dominio_de_marca set activo = false, motivo = 'x' where id = $1", [
            canonico.id,
          ]),
          "dominio_de_marca_canonico_no_se_retira",
        );
        acepta(
          await q("update dominio_de_marca set activo = false, motivo = 'x' where id = $1", [
            alias.id,
          ]),
        );
      });
    });

    it("retirar exige motivo", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const d = await crearDominio(dueno, m);
        for (const motivo of ["", "   ", null]) {
          check(
            await q("update dominio_de_marca set activo = false, motivo = $2 where id = $1", [
              d.id,
              motivo,
            ]),
            "dominio_de_marca_retiro_ck",
          );
        }
      });
    });

    it("el host, la marca y el carácter canónico no cambian; un dominio retirado queda congelado", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const otra = await crearMarca(dueno);
        const d = await crearDominio(dueno, m);
        for (const cambio of [
          `host = '${hostAlAzar()}'`,
          `marca_id = '${otra}'`,
          "es_canonico = true",
          "creado_por = 'otro'",
          "creado_en = now() - interval '1 day'",
        ]) {
          check(
            await q(`update dominio_de_marca set ${cambio} where id = $1`, [d.id]),
            "dominio_de_marca_inmutable",
          );
        }
        acepta(
          await q("update dominio_de_marca set activo = false, motivo = 'x' where id = $1", [d.id]),
        );
        // retirado: ni reactivarlo ni cambiarle el motivo
        check(
          await q("update dominio_de_marca set activo = true where id = $1", [d.id]),
          "dominio_de_marca_retirado_inmutable",
        );
        check(
          await q("update dominio_de_marca set motivo = 'otro' where id = $1", [d.id]),
          "dominio_de_marca_retirado_inmutable",
        );
      });
    });

    it("una marca retirada no admite dominios nuevos; una marca inexistente, tampoco", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [m]);
        check(
          await q(
            "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, 'x')",
            [m, hostAlAzar()],
          ),
          "dominio_de_marca_marca_retirada",
        );
        referencia(
          await q(
            "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, 'x')",
            [randomUUID(), hostAlAzar()],
          ),
          "dominio_de_marca_marca_id_fkey",
        );
      });
    });

    it("quién lo creó no puede quedar vacío; no se borra ni se vacía", async () => {
      await deshacer(async () => {
        check(
          await q("insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, '')", [
            principal,
            hostAlAzar(),
          ]),
          "dominio_de_marca_creado_por_ck",
        );
        const d = await crearDominio(dueno, principal);
        denegado(await q("delete from dominio_de_marca where id = $1", [d.id]));
        denegado(await q("truncate dominio_de_marca"));
      });
    });
  });

  // ===========================================================================================
  // plan y version_de_plan
  // ===========================================================================================
  describe("plan y version_de_plan", () => {
    it("el código del plan tiene su forma y es único; no cambia; el estado va de ACTIVO a RETIRADO y no vuelve", async () => {
      await deshacer(async () => {
        for (const codigo of ["A", "1a", "a_b", "a", "", "a".repeat(41)]) {
          check(await q("insert into plan (codigo) values ($1)", [codigo]), "plan_codigo_ck");
        }
        const p = await crearPlan(dueno, "basico");
        clave(await q("insert into plan (codigo) values ('basico')"), "plan_codigo_uk");
        check(await q("update plan set codigo = 'otro' where id = $1", [p]), "plan_inmutable");
        acepta(await q("update plan set estado = 'RETIRADO' where id = $1", [p]));
        check(
          await q("update plan set estado = 'ACTIVO' where id = $1", [p]),
          "plan_transicion_invalida",
        );
        denegado(await q("delete from plan where id = $1", [p]));
        denegado(await q("truncate plan cascade"));
      });
    });

    it("una versión nace en borrador, de un plan activo, y hay un solo borrador por plan", async () => {
      await deshacer(async () => {
        const p = await crearPlan(dueno);
        check(
          await q(
            `insert into version_de_plan (plan_id, estado, numero, nombre_comercial, motivo, publicada_en, publicada_por)
             values ($1, 'PUBLICADA', 1, 'Nace publicada', 'x', now(), 'x')`,
            [p],
          ),
          "version_de_plan_transicion_invalida",
        );
        await crearBorradorDePlan(dueno, p);
        clave(
          await q(
            "insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'Otro borrador')",
            [p],
          ),
          "version_de_plan_borrador_uk",
        );
        const retirado = await crearPlan(dueno);
        await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [retirado]);
        check(
          await q("insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'x')", [
            retirado,
          ]),
          "version_de_plan_plan_retirado",
        );
        referencia(
          await q("insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'x')", [
            randomUUID(),
          ]),
          "version_de_plan_plan_id_fkey",
        );
      });
    });

    it("el contenido tiene que ser válido: nombre comercial, módulos y perillas", async () => {
      await deshacer(async () => {
        const plan = await crearPlan(dueno);
        const insertar = (nombre: string, modulos: string, perillas: string) =>
          q(
            `insert into version_de_plan (plan_id, nombre_comercial, modulos, perillas)
             values ($1, $2, $3::text[], $4::jsonb)`,
            [plan, nombre, modulos, perillas],
          );
        check(await insertar("", "{}", "{}"), "version_de_plan_nombre_ck");
        check(await insertar(" x", "{}", "{}"), "version_de_plan_nombre_ck");
        check(await insertar("x<y", "{}", "{}"), "version_de_plan_nombre_ck");
        check(await insertar("a".repeat(61), "{}", "{}"), "version_de_plan_nombre_ck");
        check(await insertar("ok", "{Mal}", "{}"), "version_de_plan_modulos_ck");
        check(await insertar("ok", "{a1,a1}", "{}"), "version_de_plan_modulos_ck");
        check(await insertar("ok", "{}", '{"a1":5}'), "version_de_plan_perillas_ck");
        check(await insertar("ok", "{}", '{"a1":"DEL_PLAN"}'), "version_de_plan_perillas_ck");
        acepta(
          await insertar(
            "ok",
            "{administracion,clientes}",
            '{"empresas_por_tenant":{"tipo":"LIMITE","limite":3}}',
          ),
        );
      });
    });

    it("el borrador se edita; al publicar lleva el número siguiente, el motivo y quién; el borrador no lleva nada de la publicación", async () => {
      await deshacer(async () => {
        const p = await crearPlan(dueno);
        const v = await crearBorradorDePlan(dueno, p);
        acepta(
          await q(
            `update version_de_plan set nombre_comercial = 'Editado', modulos = '{clientes}',
                    perillas = '{"x1":{"tipo":"INTERRUPTOR","encendida":true}}' where id = $1`,
            [v],
          ),
        );
        // el borrador no puede llevar datos de la publicación
        check(
          await q("update version_de_plan set motivo = 'x' where id = $1", [v]),
          "version_de_plan_publicada_ck",
        );
        check(
          await q("update version_de_plan set numero = 1 where id = $1", [v]),
          "version_de_plan_publicada_ck",
        );
        // publicar con un número que no es el siguiente
        check(
          await q(
            `update version_de_plan set estado = 'PUBLICADA', numero = 7, motivo = 'x', publicada_en = now(), publicada_por = 'a' where id = $1`,
            [v],
          ),
          "version_de_plan_numero_invalido",
        );
        // sin motivo, o sin quién, o sin cuándo
        for (const faltante of [
          "motivo = ''",
          "motivo = null",
          "publicada_por = null",
          "publicada_en = null",
        ]) {
          const sets = {
            motivo: "motivo = 'x'",
            publicada_por: "publicada_por = 'a'",
            publicada_en: "publicada_en = now()",
          };
          const campo = faltante.split(" ")[0] as keyof typeof sets;
          const otros = Object.entries(sets)
            .filter(([k]) => k !== campo)
            .map(([, v2]) => v2)
            .join(", ");
          check(
            await q(
              `update version_de_plan set estado = 'PUBLICADA', numero = 1, ${otros}, ${faltante} where id = $1`,
              [v],
            ),
            "version_de_plan_publicada_ck",
          );
        }
        expect(await publicarVersionDePlan(dueno, v)).toBe(1);
      });
    });

    it("los números de las versiones publicadas de un plan son 1, 2, 3; cada plan cuenta los suyos", async () => {
      await deshacer(async () => {
        const a = await crearPlan(dueno);
        const b = await crearPlan(dueno);
        const numeros: number[] = [];
        for (const plan of [a, a, b, a, b]) {
          numeros.push(await publicarVersionDePlan(dueno, await crearBorradorDePlan(dueno, plan)));
        }
        expect(numeros).toEqual([1, 2, 1, 3, 2]);
      });
    });

    it("una versión publicada queda congelada, también para el dueño de la base, y no se borra", async () => {
      await deshacer(async () => {
        const { version, plan } = await crearPlanPublicado(dueno);
        for (const cambio of [
          "nombre_comercial = 'Otro'",
          "modulos = '{clientes}'",
          "perillas = '{}'",
          "motivo = 'otro'",
          "estado = 'BORRADOR'",
          "numero = 9",
        ]) {
          check(
            await q(`update version_de_plan set ${cambio} where id = $1`, [version]),
            "version_de_plan_publicada_inmutable",
          );
        }
        check(
          await q("update version_de_plan set plan_id = $2 where id = $1", [
            version,
            await crearPlan(dueno),
          ]),
          "version_de_plan_inmutable",
        );
        denegado(await q("delete from version_de_plan where id = $1", [version]));
        denegado(await q("truncate version_de_plan cascade"));
        // un borrador, en cambio, lo puede borrar el dueño (nadie más tiene DELETE)
        const borrador = await crearBorradorDePlan(dueno, plan);
        acepta(await q("delete from version_de_plan where id = $1", [borrador]));
      });
    });
  });

  // ===========================================================================================
  // version_de_marca
  // ===========================================================================================
  describe("version_de_marca", () => {
    it("nace en borrador, de una marca activa, y hay un solo borrador por marca", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        check(
          await q(
            `insert into version_de_marca (marca_id, estado, numero, vigente_desde, motivo, confirmada_en, confirmada_por)
             values ($1, 'CONFIRMADA', 1, now(), 'x', now(), 'x')`,
            [m],
          ),
          "version_de_marca_transicion_invalida",
        );
        await crearBorradorDeMarca(dueno, m);
        clave(
          await q("insert into version_de_marca (marca_id) values ($1)", [m]),
          "version_de_marca_borrador_uk",
        );
        const retirada = await crearMarca(dueno);
        await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [retirada]);
        check(
          await q("insert into version_de_marca (marca_id) values ($1)", [retirada]),
          "version_de_marca_marca_retirada",
        );
        referencia(
          await q("insert into version_de_marca (marca_id) values ($1)", [randomUUID()]),
          "version_de_marca_marca_id_fkey",
        );
      });
    });

    it("el contenido tiene que ser válido: nombre, tema, logo, vocabulario y módulos iniciales; vacío hereda", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const probar = (columna: string, valor: unknown) =>
          q(`insert into version_de_marca (marca_id, ${columna}) values ($1, $2)`, [m, valor]);
        const rechazada = async (columna: string, valor: unknown, restriccion: string) => {
          check(await probar(columna, valor), restriccion);
        };
        await rechazada("nombre_visible", "", "version_de_marca_nombre_ck");
        await rechazada("nombre_visible", "a<b", "version_de_marca_nombre_ck");
        await rechazada("nombre_visible", "a".repeat(61), "version_de_marca_nombre_ck");
        await rechazada("tema", '{"primary":"red"}', "version_de_marca_tema_ck");
        await rechazada("tema", '{"fondo":"#aabbcc"}', "version_de_marca_tema_ck");
        await rechazada("logo", "https://x.com/logo.png", "version_de_marca_logo_ck");
        await rechazada("logo", "/marcas/a/b.svg", "version_de_marca_logo_ck");
        await rechazada("logo", "/marcas/a/b/c.png", "version_de_marca_logo_ck");
        await rechazada("logo", "/marcas/A/b.png", "version_de_marca_logo_ck");
        await rechazada("vocabulario", '{"Mal.clave":"x"}', "version_de_marca_vocabulario_ck");
        await rechazada("vocabulario", '{"a.b":"x<y"}', "version_de_marca_vocabulario_ck");
        await rechazada("vocabulario", '["x"]', "version_de_marca_vocabulario_ck");
        await rechazada("modulos_iniciales", "{Mal}", "version_de_marca_modulos_ck");
        // nombre y logo NULL: hereda. Tema y vocabulario `{}`: hereda. Módulos NULL: hereda; `{}`: solo administración.
        acepta(await q("insert into version_de_marca (marca_id) values ($1)", [m]));
        await dueno.query("delete from version_de_marca where marca_id = $1", [m]);
        acepta(
          await q(
            `insert into version_de_marca (marca_id, nombre_visible, tema, logo, vocabulario, modulos_iniciales)
             values ($1, 'Mi Marca', '{"primary":"#112233"}', '/marcas/mi-marca/logo.webp',
                     '{"modulo.administracion.nombre":"Gestión"}', '{}')`,
            [m],
          ),
        );
      });
    });

    it("el plan por defecto tiene que existir", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        referencia(
          await q("insert into version_de_marca (marca_id, plan_por_defecto_id) values ($1, $2)", [
            m,
            randomUUID(),
          ]),
          "version_de_marca_plan_por_defecto_id_fkey",
        );
        const { plan } = await crearPlanPublicado(dueno);
        acepta(
          await q("insert into version_de_marca (marca_id, plan_por_defecto_id) values ($1, $2)", [
            m,
            plan,
          ]),
        );
      });
    });

    it("al confirmar: número siguiente de la marca, vigencia, motivo, quién y cuándo; el borrador no lleva nada de eso", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const v = await crearBorradorDeMarca(dueno, m, { nombreVisible: "x" });
        check(
          await q("update version_de_marca set motivo = 'x' where id = $1", [v]),
          "version_de_marca_confirmada_ck",
        );
        check(
          await q("update version_de_marca set reemplaza_programada = true where id = $1", [v]),
          "version_de_marca_confirmada_ck",
        );
        check(
          await q("update version_de_marca set vigente_desde = now() where id = $1", [v]),
          "version_de_marca_confirmada_ck",
        );
        const confirmar = (sets: string) =>
          q(`update version_de_marca set estado = 'CONFIRMADA', ${sets} where id = $1`, [v]);
        const completo = {
          numero: "numero = 1",
          vigente: "vigente_desde = now()",
          motivo: "motivo = 'x'",
          en: "confirmada_en = now()",
          por: "confirmada_por = 'a'",
        };
        const sin = (k: keyof typeof completo) =>
          Object.entries(completo)
            .filter(([c]) => c !== k)
            .map(([, s]) => s)
            .join(", ");
        for (const k of Object.keys(completo) as (keyof typeof completo)[]) {
          // Sin número, el disparador (que mira el número antes que las restricciones) ya lo rechaza.
          check(
            await confirmar(sin(k)),
            k === "numero" ? "version_de_marca_numero_invalido" : "version_de_marca_confirmada_ck",
          );
        }
        check(
          await confirmar(Object.values(completo).join(", ").replace("numero = 1", "numero = 4")),
          "version_de_marca_numero_invalido",
        );
        check(
          await confirmar(
            Object.values(completo).join(", ").replace("motivo = 'x'", "motivo = '  '"),
          ),
          "version_de_marca_confirmada_ck",
        );
        expect(await confirmarVersionDeMarca(dueno, v)).toBe(1);
      });
    });

    it("la vigencia no es retroactiva: se tolera un minuto de reloj, no más; una futura vale", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const cambio = async (desdeSegundos: number) => {
          const v = await crearBorradorDeMarca(dueno, m);
          const numero = (
            await un<{ n: number }>(
              "select coalesce(max(numero), 0) + 1 as n from version_de_marca where marca_id = $1",
              [m],
            )
          ).n;
          return q(
            `update version_de_marca set estado = 'CONFIRMADA', numero = $2, motivo = 'x', confirmada_en = now(),
                    confirmada_por = 'a', vigente_desde = now() + make_interval(secs => $3::int) where id = $1`,
            [v, numero, desdeSegundos],
          );
        };
        check(await cambio(-61), "version_de_marca_vigencia_ck");
        await dueno.query(
          "delete from version_de_marca where marca_id = $1 and estado = 'BORRADOR'",
          [m],
        );
        acepta(await cambio(-59));
        acepta(await cambio(0));
        acepta(await cambio(86_400));
      });
    });

    it("los números de las versiones confirmadas de una marca son 1, 2, 3; cada marca cuenta los suyos", async () => {
      await deshacer(async () => {
        const a = await crearMarca(dueno);
        const b = await crearMarca(dueno);
        const numeros: number[] = [];
        for (const m of [a, a, b, a]) {
          numeros.push((await crearVersionDeMarcaConfirmada(dueno, m)).numero);
        }
        expect(numeros).toEqual([1, 2, 1, 3]);
      });
    });

    it("una versión confirmada queda congelada, también para el dueño de la base, y no se borra", async () => {
      await deshacer(async () => {
        const m = await crearMarca(dueno);
        const { id } = await crearVersionDeMarcaConfirmada(dueno, m, { nombreVisible: "Antes" });
        for (const cambio of [
          "nombre_visible = 'Después'",
          "tema = '{}'",
          "vocabulario = '{}'",
          "motivo = 'otro'",
          "vigente_desde = now()",
          "estado = 'BORRADOR'",
          "numero = 9",
        ]) {
          check(
            await q(`update version_de_marca set ${cambio} where id = $1`, [id]),
            "version_de_marca_confirmada_inmutable",
          );
        }
        check(
          await q("update version_de_marca set marca_id = $2 where id = $1", [
            id,
            await crearMarca(dueno),
          ]),
          "version_de_marca_inmutable",
        );
        denegado(await q("delete from version_de_marca where id = $1", [id]));
        denegado(await q("truncate version_de_marca"));
      });
    });
  });

  // ===========================================================================================
  // plan_de_tenant
  // ===========================================================================================
  describe("plan_de_tenant", () => {
    it("es de solo inserción: ni UPDATE, ni DELETE, ni TRUNCATE (tampoco con los permisos del dueño)", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const { version } = await crearPlanPublicado(dueno);
        await asignarPlan(dueno, mundo.tenant, version, { origen: "ALTA" });
        denegado(await q("update plan_de_tenant set motivo = 'otro'"));
        denegado(await q("delete from plan_de_tenant"));
        denegado(await q("truncate plan_de_tenant"));
      });
    });

    it("el número es exactamente el siguiente del tenant; cada tenant cuenta los suyos", async () => {
      await deshacer(async () => {
        const a = await crearMundoDeMarca(dueno);
        const b = await crearMundoDeMarca(dueno);
        const { version } = await crearPlanPublicado(dueno);
        const insertar = (tenant: string, numero: number) =>
          q(
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, $2, $3, now(), 'CAMBIO', 'x', 'a')`,
            [tenant, numero, version],
          );
        check(await insertar(a.tenant, 2), "plan_de_tenant_numero_invalido");
        check(await insertar(a.tenant, 0), "plan_de_tenant_numero_invalido");
        acepta(await insertar(a.tenant, 1));
        check(await insertar(a.tenant, 1), "plan_de_tenant_numero_invalido");
        check(await insertar(a.tenant, 3), "plan_de_tenant_numero_invalido");
        acepta(await insertar(a.tenant, 2));
        acepta(await insertar(b.tenant, 1));
      });
    });

    it("la única por tenant y número vale aunque el disparador no estuviera (la red de seguridad de la concurrencia)", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const { version } = await crearPlanPublicado(dueno);
        await dueno.query("alter table plan_de_tenant disable trigger plan_de_tenant_alta");
        const insertar = () =>
          q(
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 1, $2, now(), 'ALTA', 'x', 'a')`,
            [mundo.tenant, version],
          );
        acepta(await insertar());
        clave(await insertar(), "plan_de_tenant_numero_uk");
        // y el número positivo, que el disparador (apagado acá) revisa antes que la restricción
        check(
          await q(
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 0, $2, now(), 'ALTA', 'x', 'a')`,
            [mundo.tenant, version],
          ),
          "plan_de_tenant_numero_ck",
        );
      });
    });

    it("la versión asignada existe y está publicada (no un borrador)", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const plan = await crearPlan(dueno);
        const borrador = await crearBorradorDePlan(dueno, plan);
        const insertar = (version: string) =>
          q(
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 1, $2, now(), 'ALTA', 'x', 'a')`,
            [mundo.tenant, version],
          );
        check(await insertar(borrador), "plan_de_tenant_version_no_publicada");
        referencia(await insertar(randomUUID()), "plan_de_tenant_version_de_plan_id_fkey");
        await publicarVersionDePlan(dueno, borrador);
        acepta(await insertar(borrador));
      });
    });

    it("el origen, el motivo y quién asignó tienen su forma; la vigencia no es retroactiva (un minuto de tolerancia)", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const { version } = await crearPlanPublicado(dueno);
        const insertar = (origen: string, motivo: string, por: string, desde: string) =>
          q(
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 1, $2, ${desde}, $3, $4, $5)`,
            [mundo.tenant, version, origen, motivo, por],
          );
        check(await insertar("OTRO", "x", "a", "now()"), "plan_de_tenant_origen_ck");
        check(await insertar("ALTA", "", "a", "now()"), "plan_de_tenant_motivo_ck");
        check(await insertar("ALTA", "   ", "a", "now()"), "plan_de_tenant_motivo_ck");
        check(await insertar("ALTA", "x", "", "now()"), "plan_de_tenant_asignado_por_ck");
        check(
          await insertar("ALTA", "x", "a", "now() - interval '61 seconds'"),
          "plan_de_tenant_vigencia_ck",
        );
        acepta(await insertar("MIGRACION_DE_VERSION", "x", "a", "now() - interval '59 seconds'"));
      });
    });
  });

  // ===========================================================================================
  // ajuste_de_perilla
  // ===========================================================================================
  describe("ajuste_de_perilla", () => {
    it("es de solo inserción: ni UPDATE, ni DELETE, ni TRUNCATE", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", "2");
        denegado(await q("update ajuste_de_perilla set valor = '3'"));
        denegado(await q("delete from ajuste_de_perilla"));
        denegado(await q("truncate ajuste_de_perilla"));
      });
    });

    it("el valor es 0, un entero de hasta nueve cifras sin ceros a la izquierda, ILIMITADO o DEL_PLAN; la perilla tiene su forma", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const insertar = (perilla: string, valor: string) =>
          q(
            `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, $2, 1, $3, now(), 'x', 'a')`,
            [mundo.tenant, perilla, valor],
          );
        for (const valor of [
          "",
          "-1",
          "01",
          "1.5",
          "1000000000",
          "ilimitado",
          "SI",
          " 1",
          "1\n",
          "true",
        ]) {
          check(await insertar("empresas_por_tenant", valor), "ajuste_de_perilla_valor_ck");
        }
        for (const perilla of ["", "A1", "1a", "a", "a b", "a".repeat(65)]) {
          check(await insertar(perilla, "1"), "ajuste_de_perilla_perilla_ck");
        }
        for (const [i, valor] of ["0", "999999999", "ILIMITADO", "DEL_PLAN", "1"].entries()) {
          acepta(await insertar(`p${i}_`.padEnd(3, "x"), valor));
        }
      });
    });

    it("el número es el siguiente de (tenant, empresa, perilla): el del tenant y el de cada empresa se cuentan aparte", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const otra = await crearMundoDeMarca(dueno, { tenant: mundo.tenant });
        const numeros = [
          await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", "2"),
          await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", "3"),
          await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", "4", {
            empresa: mundo.empresa,
          }),
          await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", "5", {
            empresa: otra.empresa,
          }),
          await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", "6", {
            empresa: mundo.empresa,
          }),
          await ajustarPerilla(dueno, mundo.tenant, "otra_perilla", "1"),
        ];
        expect(numeros).toEqual([1, 2, 1, 1, 2, 1]);
        const insertar = (numero: number, empresa: string | null) =>
          q(
            `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, $2, 'empresas_por_tenant', $3, '1', now(), 'x', 'a')`,
            [mundo.tenant, empresa, numero],
          );
        check(await insertar(1, null), "ajuste_de_perilla_numero_invalido");
        check(await insertar(4, null), "ajuste_de_perilla_numero_invalido");
        check(await insertar(1, mundo.empresa), "ajuste_de_perilla_numero_invalido");
        check(await insertar(0, null), "ajuste_de_perilla_numero_invalido");
        acepta(await insertar(3, null));
      });
    });

    it("la única cuenta los nulos como iguales (NULLS NOT DISTINCT): dos ajustes del tenant con el mismo número chocan aunque la empresa sea NULL", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        await dueno.query("alter table ajuste_de_perilla disable trigger ajuste_de_perilla_alta");
        const insertar = (empresa: string | null) =>
          q(
            `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, $2, 'empresas_por_tenant', 1, '1', now(), 'x', 'a')`,
            [mundo.tenant, empresa],
          );
        acepta(await insertar(null));
        clave(await insertar(null), "ajuste_de_perilla_numero_uk");
        acepta(await insertar(mundo.empresa));
        clave(await insertar(mundo.empresa), "ajuste_de_perilla_numero_uk");
        check(
          await q(
            `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, 'empresas_por_tenant', 0, '1', now(), 'x', 'a')`,
            [mundo.tenant],
          ),
          "ajuste_de_perilla_numero_ck",
        );
      });
    });

    it("la empresa del ajuste es del tenant del ajuste", async () => {
      await deshacer(async () => {
        const a = await crearMundoDeMarca(dueno);
        const b = await crearMundoDeMarca(dueno);
        check(
          await q(
            `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, $2, 'empresas_por_tenant', 1, '1', now(), 'x', 'a')`,
            [a.tenant, b.empresa],
          ),
          "ajuste_de_perilla_empresa_de_otro_tenant",
        );
        referencia(
          await q(
            `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, $2, 'empresas_por_tenant', 1, '1', now(), 'x', 'a')`,
            [a.tenant, randomUUID()],
          ),
          "ajuste_de_perilla_empresa_id_fkey",
        );
      });
    });

    it("el motivo y quién asignó no pueden estar vacíos; la vigencia no es retroactiva", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const insertar = (motivo: string, por: string, desde: string) =>
          q(
            `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, 'empresas_por_tenant', 1, '1', ${desde}, $2, $3)`,
            [mundo.tenant, motivo, por],
          );
        check(await insertar("", "a", "now()"), "ajuste_de_perilla_motivo_ck");
        check(await insertar("x", "", "now()"), "ajuste_de_perilla_asignado_por_ck");
        check(
          await insertar("x", "a", "now() - interval '61 seconds'"),
          "ajuste_de_perilla_vigencia_ck",
        );
        acepta(await insertar("x", "a", "now() + interval '10 days'"));
      });
    });
  });

  // ===========================================================================================
  // modulo_de_empresa
  // ===========================================================================================
  describe("modulo_de_empresa", () => {
    it("una fila por (empresa, módulo): activar dos veces choca; el módulo tiene su forma; la empresa existe", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        acepta(
          await q("insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')", [
            mundo.empresa,
          ]),
        );
        clave(
          await q("insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')", [
            mundo.empresa,
          ]),
          "modulo_de_empresa_pkey",
        );
        for (const modulo of ["", "R", "a", "1a", "a-b", "a".repeat(41)]) {
          check(
            await q("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
              mundo.empresa,
              modulo,
            ]),
            "modulo_de_empresa_modulo_ck",
          );
        }
        referencia(
          await q("insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')", [
            randomUUID(),
          ]),
          "modulo_de_empresa_empresa_id_fkey",
        );
      });
    });

    it("desactivar y reactivar suben la versión y no borran nada; no se borra ni se vacía", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        await dueno.query(
          "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')",
          [mundo.empresa],
        );
        await dueno.query("update modulo_de_empresa set activo = false where empresa_id = $1", [
          mundo.empresa,
        ]);
        await dueno.query("update modulo_de_empresa set activo = true where empresa_id = $1", [
          mundo.empresa,
        ]);
        const fila = await un<{ activo: boolean; version: number }>(
          "select activo, version from modulo_de_empresa where empresa_id = $1",
          [mundo.empresa],
        );
        expect(fila).toEqual({ activo: true, version: 3 });
        denegado(await q("delete from modulo_de_empresa"));
        denegado(await q("truncate modulo_de_empresa"));
      });
    });
  });

  // ===========================================================================================
  // nivel_de_control
  // ===========================================================================================
  describe("nivel_de_control", () => {
    it("el control y el nivel tienen su forma; sin fila vale PERMITIR (no hay valor por defecto de nivel)", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const insertar = (control: string, nivel: string) =>
          q("insert into nivel_de_control (empresa_id, control, nivel) values ($1, $2, $3)", [
            mundo.empresa,
            control,
            nivel,
          ]);
        for (const control of [
          "",
          "stock",
          "stock.",
          ".x",
          "Stock.negativa",
          "stock.a.b",
          "stock.a1",
          "s-t.a",
        ]) {
          check(await insertar(control, "BLOQUEAR"), "nivel_de_control_control_ck");
        }
        for (const nivel of ["", "permitir", "NO", "BLOQUEAR "]) {
          check(await insertar("stock.existencia_negativa", nivel), "nivel_de_control_nivel_ck");
        }
        acepta(await insertar("stock.existencia_negativa", "AVISAR"));
      });
    });

    it("un control tiene un nivel por empresa y uno por sucursal; el de toda la empresa (NULL) cuenta como un valor", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const segunda = (
          await un<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
            [mundo.empresa],
          )
        ).id;
        const insertar = (sucursal: string | null, nivel = "AVISAR") =>
          q(
            "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, $2, 'caja.descuadre', $3)",
            [mundo.empresa, sucursal, nivel],
          );
        acepta(await insertar(null));
        clave(await insertar(null, "BLOQUEAR"), "nivel_de_control_uk");
        acepta(await insertar(mundo.sucursal, "BLOQUEAR"));
        clave(await insertar(mundo.sucursal), "nivel_de_control_uk");
        acepta(await insertar(segunda));
      });
    });

    it("la sucursal es de la misma empresa (clave foránea compuesta)", async () => {
      await deshacer(async () => {
        const a = await crearMundoDeMarca(dueno);
        const b = await crearMundoDeMarca(dueno);
        referencia(
          await q(
            "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, $2, 'caja.descuadre', 'AVISAR')",
            [a.empresa, b.sucursal],
          ),
          "nivel_de_control_sucursal_fkey",
        );
        referencia(
          await q(
            "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', 'AVISAR')",
            [randomUUID()],
          ),
          "nivel_de_control_empresa_id_fkey",
        );
      });
    });

    it("cambiar el nivel sube la versión; no se borra ni se vacía", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        await dueno.query(
          "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', 'AVISAR')",
          [mundo.empresa],
        );
        await dueno.query("update nivel_de_control set nivel = 'BLOQUEAR' where empresa_id = $1", [
          mundo.empresa,
        ]);
        const fila = await un<{ nivel: string; version: number }>(
          "select nivel, version from nivel_de_control where empresa_id = $1",
          [mundo.empresa],
        );
        expect(fila).toEqual({ nivel: "BLOQUEAR", version: 2 });
        denegado(await q("delete from nivel_de_control"));
        denegado(await q("truncate nivel_de_control"));
      });
    });
  });

  // ===========================================================================================
  // tenant.marca_id
  // ===========================================================================================
  describe("tenant.marca_id", () => {
    it("un tenant sin marca no se puede dar de alta, y la marca tiene que existir", async () => {
      await deshacer(async () => {
        const sinMarca = await q("insert into tenant (nombre) values ('sin marca')");
        expect(sinMarca.ok).toBe(false);
        if (!sinMarca.ok) expect(sinMarca.codigo).toBe("23502");
        referencia(
          await q("insert into tenant (nombre, marca_id) values ('marca fantasma', $1)", [
            randomUUID(),
          ]),
          "tenant_marca_id_fkey",
        );
        acepta(
          await q("insert into tenant (nombre, marca_id) values ('con marca', $1)", [principal]),
        );
      });
    });

    it("la marca de un tenant no cambia nunca, ni con los permisos del dueño; lo demás del tenant sí cambia", async () => {
      await deshacer(async () => {
        const otra = await crearMarca(dueno);
        const mundo = await crearMundoDeMarca(dueno);
        check(
          await q("update tenant set marca_id = $2 where id = $1", [mundo.tenant, otra]),
          "tenant_marca_inmutable",
        );
        // el mismo valor no es un cambio
        acepta(
          await q("update tenant set marca_id = $2 where id = $1", [mundo.tenant, mundo.marca]),
        );
        acepta(await q("update tenant set nombre = 'Otro nombre' where id = $1", [mundo.tenant]));
        const fila = await un<{ marca_id: string; version: number }>(
          "select marca_id, version from tenant where id = $1",
          [mundo.tenant],
        );
        expect(fila.marca_id).toBe(mundo.marca);
        expect(fila.version).toBeGreaterThan(1);
      });
    });
  });

  // ===========================================================================================
  // parte 0 del tramo previo común
  // ===========================================================================================
  describe("sucursal.hora_de_corte", () => {
    it("vale 00:00 por defecto y admite minutos enteros de 00:00 a 23:59", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const fila = await un<{ h: string }>(
          "select hora_de_corte::text as h from sucursal where id = $1",
          [mundo.sucursal],
        );
        expect(fila.h).toBe("00:00:00");
        for (const hora of ["04:30", "23:59", "00:01", "12:00"]) {
          acepta(
            await q("update sucursal set hora_de_corte = $2 where id = $1", [mundo.sucursal, hora]),
          );
        }
      });
    });

    it("rechaza segundos, fracciones de segundo y las 24:00", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        for (const hora of ["04:30:15", "04:30:00.5", "04:30:00.000001", "24:00", "24:00:00"]) {
          check(
            await q("update sucursal set hora_de_corte = $2 where id = $1", [mundo.sucursal, hora]),
            "sucursal_hora_de_corte_ck",
          );
        }
      });
    });
  });

  describe("referencia_de_error_referencia_uk", () => {
    it("la referencia no se repite: la segunda igual choca con la única", async () => {
      await deshacer(async () => {
        const referenciaNueva = `ZH-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
        const insertar = () =>
          q(
            "insert into referencia_de_error (referencia, accion, motivo) values ($1, 'a.b', 'X')",
            [referenciaNueva],
          );
        acepta(await insertar());
        clave(await insertar(), "referencia_de_error_referencia_uk");
      });
    });
  });

  describe("auditoria_acceso_grupo.resultado", () => {
    it("vale PERMITIDO por defecto y solo admite PERMITIDO o DENEGADO", async () => {
      await deshacer(async () => {
        const mundo = await crearMundoDeMarca(dueno);
        await dueno.query(
          "insert into auditoria_acceso_grupo (tenant_id, persona_id) values ($1, $2)",
          [mundo.tenant, mundo.persona],
        );
        const fila = await un<{ resultado: string }>(
          "select resultado from auditoria_acceso_grupo where tenant_id = $1",
          [mundo.tenant],
        );
        expect(fila.resultado).toBe("PERMITIDO");
        for (const resultado of ["", "permitido", "NO", "FALLIDO"]) {
          check(
            await q(
              "insert into auditoria_acceso_grupo (tenant_id, persona_id, resultado) values ($1, $2, $3)",
              [mundo.tenant, mundo.persona, resultado],
            ),
            "auditoria_acceso_grupo_resultado_ck",
          );
        }
        acepta(
          await q(
            "insert into auditoria_acceso_grupo (tenant_id, persona_id, resultado) values ($1, $2, 'DENEGADO')",
            [mundo.tenant, mundo.persona],
          ),
        );
        // sigue siendo de solo inserción
        denegado(await q("update auditoria_acceso_grupo set resultado = 'PERMITIDO'"));
      });
    });
  });
});
