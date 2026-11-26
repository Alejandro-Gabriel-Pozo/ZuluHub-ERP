import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { exigirAccion } from "../../src/capacidades/permisos/exigir";
import type { SalidaDeExplicar } from "../../src/plataforma/casos-de-uso/explicar-por-que";
import {
  empresaId,
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";
import { crearCasosDeSoporte, crearEntornoDeSoporte } from "./soporte-apoyo";
import { plataformaEn } from "./soporte-datos";

/**
 * H4b T5: «explicar por qué» dice lo MISMO que el guard real, también con roles propios. Contra una base real: dos empresas, cada una con el gerente, un administrador, un operador, una persona
 * con un rol propio que tiene acciones, una con un rol propio que no tiene la que se pregunta y una con un rol propio archivado, más una persona apagada y otra sin membresía. Para cada acción
 * del catálogo y cada persona se compara el rechazo (o el permiso) que da la explicación con el que da `exigirAccion` con el adaptador REAL de autorización (el conjunto sale de la base: plantilla
 * vigente o rol propio). También: un cambio de plantilla y el archivado de un rol propio se reflejan en la explicación siguiente, y lo de una empresa no se mezcla con lo de la otra.
 */
const base = inject("baseDePruebas");
const admin = plataformaEn(AHORA_DE_PRUEBA);

const CATALOGO = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
/** Lo que todo rol lleva sí o sí (piso `TODOS_LOS_ROLES`): la base rechaza una versión que no lo incluya. */
const PISO = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
];

describe.skipIf(base === null)(
  "soporte: explicar con roles propios es lo que decide el guard",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let soporteEnv: ReturnType<typeof crearEntornoDeSoporte>;
    let casos: ReturnType<typeof crearCasosDeSoporte>;
    let dueno: pg.Client;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 6);
      soporteEnv = crearEntornoDeSoporte(propia.base, 6);
      casos = crearCasosDeSoporte(soporteEnv);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      await dueno.end();
      await soporteEnv.cerrar();
      await entorno.cerrar();
      await propia.destruir();
    });

    type Persona = Readonly<{ nombre: string; id: PersonaId }>;
    type Equipo = Readonly<{ empresa: EmpresaId; personas: readonly Persona[]; rolDeA: string }>;

    const crearRol = async (empresa: EmpresaId, acciones: readonly string[], activo = true) => {
      const autor = (await crearPersonaDeBase(dueno)).id;
      const id = randomUUID();
      await dueno.query(
        "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave, activo) values ($1, $2, $3, $3, $4)",
        [id, empresa, `rol-${id}`, activo],
      );
      await dueno.query(
        "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, 1, $3::text[], $4, now())",
        [empresa, id, [...PISO, ...acciones], autor],
      );
      return id;
    };
    /** Un miembro con un rol propio (la asignación directa evade el disparador, como en las pruebas de 0097: lo que se prueba es la lectura). */
    const conRolPropio = async (empresa: EmpresaId, rolId: string) => {
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, empresa, p.id, "OPERADOR", true);
      await dueno.query("alter table membresia disable trigger membresia_cambio");
      await dueno.query(
        "update membresia set rol = 'PROPIO', rol_propio_id = $3 where empresa_id = $1 and persona_id = $2",
        [empresa, p.id, rolId],
      );
      await dueno.query("alter table membresia enable trigger membresia_cambio");
      return personaId(p.id);
    };

    const equipo = async (): Promise<Equipo> => {
      const empresa = (await crearEmpresaActiva(entorno)).empresa;
      const miembro = async (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR", activo = true) => {
        const p = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, empresa, p.id, rol, activo);
        return personaId(p.id);
      };
      const conAcciones = await crearRol(empresa, ["sucursales.crear", "sucursales.ver"]);
      const sinLaAccion = await crearRol(empresa, ["productos.ver"]);
      const archivado = await crearRol(empresa, ["sucursales.crear", "sucursales.ver"], false);
      const personas: Persona[] = [
        { nombre: "GERENTE", id: await miembro("GERENTE") },
        { nombre: "ADMINISTRADOR", id: await miembro("ADMINISTRADOR") },
        { nombre: "OPERADOR", id: await miembro("OPERADOR") },
        { nombre: "PROPIO_CON_ACCIONES", id: await conRolPropio(empresa, conAcciones) },
        { nombre: "PROPIO_SIN_LA_ACCION", id: await conRolPropio(empresa, sinLaAccion) },
        { nombre: "PROPIO_ARCHIVADO", id: await conRolPropio(empresa, archivado) },
        { nombre: "APAGADA", id: await miembro("ADMINISTRADOR", false) },
        { nombre: "SIN_MEMBRESIA", id: personaId((await crearPersonaDeBase(dueno)).id) },
      ];
      return { empresa, personas, rolDeA: conAcciones };
    };

    /** Lo que decide el guard REAL (adaptador de autorización sobre la base, con RLS) para esa persona y acción. */
    const guardReal = async (
      empresa: EmpresaId,
      persona: PersonaId,
      accion: string,
      ahora?: Date,
    ) => {
      const contexto = {
        ...comoEmpresa(empresa, persona),
        ...(ahora === undefined ? {} : { ahora }),
      };
      const r = await entorno.ejecutar({ contexto }, async (tx) =>
        ok(
          await exigirAccion(REGLAS_DE_EMPRESA, accion as never, () =>
            tx.autorizacion.delActor(contexto),
          ),
        ),
      );
      if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
      return r.valor;
    };
    const explicada = async (
      empresa: EmpresaId,
      persona: PersonaId,
      accion: string,
      contexto: typeof admin = admin,
    ) => {
      const r = await casos.explicarPorQue(contexto, {
        claveDeIdempotencia: claveAlAzar(),
        objetivo: {
          tipo: "ACCION",
          empresaId: empresa,
          persona: { por: "ID", personaId: persona },
          accion,
        },
      });
      if (!r.ok) throw new Error(`no esperaba ${JSON.stringify(r)}`);
      const salida: SalidaDeExplicar = r.valor;
      if (salida.tipo !== "ACCION") throw new Error("no era una acción");
      return salida.explicacion;
    };

    const compararTodo = async (e: Equipo, acciones: readonly string[]) => {
      const diferencias: string[] = [];
      for (const persona of e.personas) {
        for (const accion of acciones) {
          const real = await guardReal(e.empresa, persona.id, accion);
          const explicacion = await explicada(e.empresa, persona.id, accion);
          if (JSON.stringify(explicacion.guard) !== JSON.stringify(real)) {
            diferencias.push(
              `${persona.nombre} ${accion}: explicó ${JSON.stringify(explicacion.guard)} y el guard ${JSON.stringify(real)}`,
            );
          }
        }
      }
      expect(diferencias).toEqual([]);
    };

    it("cada acción del catálogo × cada persona (3 roles base, roles propios con y sin la acción, uno archivado, apagada y sin membresía): lo explicado es lo que decide el guard", async () => {
      const e = await equipo();
      await compararTodo(e, CATALOGO);
    }, 600_000);

    it("las razones de un rol propio: con acciones, sin la acción y archivado", async () => {
      const e = await equipo();
      const de = (nombre: string) => e.personas.find((p) => p.nombre === nombre)!.id;
      const con = await explicada(e.empresa, de("PROPIO_CON_ACCIONES"), "sucursales.crear");
      expect(con).toMatchObject({ rol: "PROPIO", razonDelRol: "CON_ROL_PROPIO" });
      const archivado = await explicada(e.empresa, de("PROPIO_ARCHIVADO"), "sucursales.crear");
      expect(archivado).toMatchObject({
        rol: "PROPIO",
        razonDelRol: "ROL_PROPIO_ARCHIVADO",
        guard: { ok: false, error: "SIN_PERMISO" },
      });
      const sin = await explicada(e.empresa, de("PROPIO_SIN_LA_ACCION"), "sucursales.crear");
      expect(sin).toMatchObject({
        razonDelRol: "CON_ROL_PROPIO",
        guard: { ok: false, error: "SIN_PERMISO" },
      });
    }, 120_000);

    it("el cambio de la plantilla de un rol base y la baja de una acción de un rol propio se ven en la explicación siguiente, igual que en el guard", async () => {
      const e = await equipo();
      const admin1 = e.personas.find((p) => p.nombre === "ADMINISTRADOR")!.id;
      const propio = e.personas.find((p) => p.nombre === "PROPIO_CON_ACCIONES")!.id;
      expect((await explicada(e.empresa, admin1, "sucursales.crear")).guard.ok).toBe(true);
      expect((await explicada(e.empresa, propio, "sucursales.crear")).guard.ok).toBe(true);

      // Una versión nueva de la plantilla sin la acción y una versión nueva del rol propio sin ella (el historial queda).
      const { rows } = await dueno.query<{ n: number }>(
        "select coalesce(max(numero), 0) + 1 as n from version_de_plantilla where clave = 'ADMINISTRADOR'",
      );
      const vigente = (
        await dueno.query<{ acciones: string[] }>(
          "select acciones from version_de_plantilla where clave = 'ADMINISTRADOR' order by numero desc limit 1",
        )
      ).rows[0]?.acciones;
      await dueno.query(
        "insert into version_de_plantilla (clave, numero, acciones, autor) values ('ADMINISTRADOR', $1, $2, 'prueba')",
        [rows[0]?.n, (vigente ?? []).filter((a) => a !== "sucursales.crear")],
      );
      await dueno.query(
        `insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en)
       select m.empresa_id, m.rol_propio_id, 2, $3::text[], (select id from persona limit 1), now()
         from membresia m where m.empresa_id = $1 and m.persona_id = $2`,
        [e.empresa, propio, PISO],
      );
      for (const persona of [admin1, propio]) {
        const real = await guardReal(e.empresa, persona, "sucursales.crear");
        const explicacion = await explicada(e.empresa, persona, "sucursales.crear");
        expect(real).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(explicacion.guard).toEqual(real);
      }
      // Restaurar la plantilla: otra empresa no la ve distinta, es global; la dejamos como estaba para no afectar a otras pruebas de este archivo.
      await dueno.query(
        "insert into version_de_plantilla (clave, numero, acciones, autor) values ('ADMINISTRADOR', $1, $2, 'prueba')",
        [(rows[0]?.n ?? 0) + 1, vigente],
      );
    }, 120_000);

    it("dos empresas: lo de un rol propio de una no se mezcla con lo de la otra (la misma acción, distinto resultado)", async () => {
      const a = await equipo();
      const b = await equipo();
      // En B el rol propio con acciones se archiva (nadie lo reasigna: se arma la escena con el dueño).
      const propioB = b.personas.find((p) => p.nombre === "PROPIO_CON_ACCIONES")!.id;
      await dueno
        .query("update rol_de_empresa set activo = false where id = $1", [b.rolDeA])
        .catch(async () => {
          // El archivado exige que nadie activo lo tenga: se la reasigna a un rol base y se archiva.
          await dueno.query("alter table membresia disable trigger membresia_cambio");
          await dueno.query(
            "update membresia set rol = 'OPERADOR', rol_propio_id = null where empresa_id = $1 and persona_id = $2",
            [b.empresa, propioB],
          );
          await dueno.query("alter table membresia enable trigger membresia_cambio");
          await dueno.query("update rol_de_empresa set activo = false where id = $1", [b.rolDeA]);
        });
      const propioA = a.personas.find((p) => p.nombre === "PROPIO_CON_ACCIONES")!.id;
      expect((await explicada(a.empresa, propioA, "sucursales.crear")).guard.ok).toBe(true);
      expect((await explicada(b.empresa, propioB, "sucursales.crear")).guard.ok).toBe(false);
      // Una persona de A preguntada en la empresa B no tiene membresía ahí.
      expect(await explicada(b.empresa, propioA, "sucursales.crear")).toMatchObject({
        rol: null,
        razonDelRol: "SIN_MEMBRESIA",
      });
      // Y para toda acción coinciden con el guard en ambas.
      await compararTodo(a, CATALOGO.filter((_, i) => i % 12 === 0).concat("sucursales.crear"));
      await compararTodo(b, CATALOGO.filter((_, i) => i % 12 === 0).concat("sucursales.crear"));
    }, 300_000);

    it("fuera del plan: un módulo activado que el plan ya no incluye (solo lectura), uno activado y en el plan, y uno sin activar: lo explicado es lo que decide el guard", async () => {
      // El plan se asigna «desde hace 30 s» según el reloj de la base: el pedido de soporte y el del guard usan el reloj real.
      const ahora = plataformaEn(new Date());
      const casosHoy = [
        { nombre: "activado y en el plan", plan: ["facturacion"], activar: true },
        { nombre: "activado y fuera del plan", plan: [] as string[], activar: true },
        { nombre: "en el plan y sin activar", plan: ["facturacion"], activar: false },
      ];
      for (const caso of casosHoy) {
        const e = await equipo();
        const tenant = (
          await dueno.query<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
            e.empresa,
          ])
        ).rows[0]?.tenant_id as string;
        const { version } = await crearPlanPublicado(dueno, { modulos: caso.plan });
        await asignarPlan(dueno, tenant, version, { desdeSegundos: -30 });
        if (caso.activar) {
          await dueno.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
            e.empresa,
            "facturacion",
          ]);
        }
        for (const persona of e.personas) {
          for (const accion of ["comprobantes.ver", "comprobantes.emitir", "sucursales.ver"]) {
            const real = await guardReal(e.empresa, persona.id, accion, ahora.ahora);
            const explicacion = await explicada(e.empresa, persona.id, accion, ahora);
            expect(explicacion.guard, `${caso.nombre} ${persona.nombre} ${accion}`).toEqual(real);
          }
        }
      }
    }, 300_000);

    it("repetir el mismo pedido (misma clave) no deja otra constancia ni cambia lo explicado", async () => {
      const e = await equipo();
      const persona = e.personas.find((p) => p.nombre === "PROPIO_CON_ACCIONES")!.id;
      const clave = claveAlAzar();
      const pedido = {
        claveDeIdempotencia: clave,
        objetivo: {
          tipo: "ACCION" as const,
          empresaId: e.empresa,
          persona: { por: "ID" as const, personaId: persona },
          accion: "sucursales.crear",
        },
      };
      const cuenta = async () =>
        Number(
          (
            await dueno.query(
              "select count(*)::int as n from auditoria_plataforma where entidad_id = $1 and accion = 'SOPORTE_EXPLICAR'",
              [e.empresa],
            )
          ).rows[0]?.n,
        );
      const primera = await casos.explicarPorQue(admin, pedido);
      const segunda = await casos.explicarPorQue(admin, pedido);
      expect(segunda).toEqual(primera);
      expect(await cuenta()).toBe(1);
    });
  },
);
