import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  type CasosDeUsoDeIdentidad,
  type ConsultasDeIdentidad,
} from "../../src/modulos/identidad/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { crearBaseAparte, crearEntornoDePrueba, comoEmpresa, type TxDePrueba } from "./entorno";
import { crearPersonaDeBase } from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";
import { ahoraDeLaCorrida } from "./reloj-de-la-corrida";
import { crearApoyoDeTraspaso, type Escenario } from "./traspaso-apoyo";

/**
 * H4b T4 (T4b-1): crear, editar, archivar y listar roles propios contra una base real, con el contexto firmado (nunca el dueño de la base, salvo para armar el escenario y para mirar).
 * Cubre autorización por rol, aislamiento entre empresas, idempotencia, atomicidad (todo o nada, con su auditoría), el plan (perilla y módulos) y la concurrencia de dos pedidos a la vez.
 */

const base = inject("baseDePruebas");
const LIMITE_EN_MS = 60_000;

/** Los cuatro pisos «todos los roles»: lo único que lleva un rol que nace de cero. */
const PISOS_DE_TODOS = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
];

describe.skipIf(base === null)(
  "roles propios: crear, editar, archivar y listar contra una base real",
  { timeout: LIMITE_EN_MS },
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let casos: CasosDeUsoDeIdentidad;
    let consultas: ConsultasDeIdentidad;
    let apoyo: ReturnType<typeof crearApoyoDeTraspaso>;

    const crearCasos = (transacciones: Transacciones<TxDePrueba>) =>
      crearCasosDeUsoDeIdentidad({
        transacciones,
        tokens: crearTokensHmac(randomBytes(32)),
        reglas: REGLAS_DE_EMPRESA,
      });

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 10);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      apoyo = crearApoyoDeTraspaso(entorno, dueno);
      casos = crearCasos(entorno);
      consultas = crearConsultasDeIdentidad({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
    }, LIMITE_EN_MS);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    }, LIMITE_EN_MS);

    const SIN_PERMISO = { ok: false, error: "SIN_PERMISO" };
    const nuevoId = () => randomUUID();

    /** Una empresa con su gerente y, si se pide, un plan con esos módulos y esas perillas. */
    const empresaConPlan = async (
      plan?: Readonly<{ modulos: string[]; perillas?: Record<string, unknown> }>,
    ): Promise<Escenario> => {
      const e = await apoyo.escenario();
      if (plan !== undefined) {
        const publicado = await crearPlanPublicado(dueno, plan);
        await asignarPlan(dueno, e.tenant, publicado.version);
      }
      // El plan rige desde hace un rato: el contexto necesita un `ahora` de esta corrida (el fijo de las pruebas es anterior a la asignación).
      return { ...e, ctx: { ...e.ctx, ahora: ahoraDeLaCorrida() } };
    };

    const rolesDe = (empresa: string) =>
      apoyo.filas<{ id: string; nombre: string; activo: boolean; version: number }>(
        "select id, nombre, activo, version from rol_de_empresa where empresa_id = $1 order by nombre",
        [empresa],
      );
    const versionesDe = (empresa: string, rol: string) =>
      apoyo.filas<{ numero: number; acciones: string[]; creado_por: string }>(
        "select numero, acciones, creado_por from version_de_rol where empresa_id = $1 and rol_id = $2 order by numero",
        [empresa, rol],
      );
    const auditoriaDeRol = (empresa: string, accion: string) =>
      apoyo.filas<{
        accion: string;
        actor_persona_id: string;
        entidad: string;
        antes: unknown;
        despues: unknown;
      }>(
        "select accion, actor_persona_id, entidad, antes, despues from auditoria_empresa where empresa_id = $1 and accion = $2 order by id",
        [empresa, accion],
      );
    const todaLaAuditoriaDeRoles = (empresa: string) =>
      apoyo.filas<{ accion: string }>(
        "select accion from auditoria_empresa where empresa_id = $1 and accion like 'ROL_%' order by id",
        [empresa],
      );
    /** Una persona con el rol propio puesto por el dueño de la base (la asignación por caso de uso llega en T4b-2). */
    const darRolPropio = async (empresa: string, rol: string) => {
      const p = await crearPersonaDeBase(dueno);
      await dueno.query(
        "insert into membresia (empresa_id, persona_id, rol, rol_propio_id) values ($1, $2, 'PROPIO', $3)",
        [empresa, p.id, rol],
      );
      return p.id;
    };
    const crear = async (e: Escenario, nombre: string, origen = { tipo: "VACIO" as const }) => {
      const r = await casos.crearRol(e.ctx, { rolId: nuevoId(), nombre, origen });
      if (!r.ok) throw new Error(`no se pudo crear el rol de prueba: ${JSON.stringify(r.error)}`);
      return r.valor.rolId;
    };

    // =============================================================================================
    describe("crearRol", () => {
      it("de cero: nace activo con su versión 1 (solo los pisos de todos los roles) y deja su auditoría", async () => {
        const e = await empresaConPlan();
        const rolId = nuevoId();

        const r = await casos.crearRol(e.ctx, {
          rolId,
          nombre: "  Cajero   de turno ",
          origen: { tipo: "VACIO" },
        });

        expect(r).toEqual({ ok: true, valor: { rolId, yaExistia: false } });
        expect(await rolesDe(e.empresa)).toEqual([
          { id: rolId, nombre: "Cajero de turno", activo: true, version: 1 },
        ]);
        const versiones = await versionesDe(e.empresa, rolId);
        expect(versiones).toEqual([{ numero: 1, acciones: PISOS_DE_TODOS, creado_por: e.gerente }]);
        const auditoria = await auditoriaDeRol(e.empresa, "ROL_CREADO");
        expect(auditoria).toHaveLength(1);
        expect(auditoria[0]).toMatchObject({
          actor_persona_id: e.gerente,
          entidad: "rol_de_empresa",
        });
      });

      it("crearRol: el mismo pedido dos veces (mismo id) devuelve el mismo rol y no escribe ni audita de nuevo", async () => {
        const e = await empresaConPlan();
        const rolId = nuevoId();
        const pedido = { rolId, nombre: "Repetido", origen: { tipo: "VACIO" } } as const;

        const primera = await casos.crearRol(e.ctx, pedido);
        const antes = await apoyo.foto([e.empresa]);
        const segunda = await casos.crearRol(e.ctx, pedido);

        expect(primera).toEqual({ ok: true, valor: { rolId, yaExistia: false } });
        expect(segunda).toEqual({ ok: true, valor: { rolId, yaExistia: true } });
        expect(await apoyo.foto([e.empresa])).toBe(antes);
        expect(await rolesDe(e.empresa)).toHaveLength(1);
        expect(await versionesDe(e.empresa, rolId)).toHaveLength(1);
        expect(await todaLaAuditoriaDeRoles(e.empresa)).toEqual([{ accion: "ROL_CREADO" }]);
      });

      it("el mismo nombre con otras mayúsculas y otro id es el mismo rol: devuelve el que ya estaba", async () => {
        const e = await empresaConPlan();
        const primero = await crear(e, "Encargado");

        const r = await casos.crearRol(e.ctx, {
          rolId: nuevoId(),
          nombre: "ENCARGADO",
          origen: { tipo: "VACIO" },
        });

        expect(r).toEqual({ ok: true, valor: { rolId: primero, yaExistia: true } });
        expect(await rolesDe(e.empresa)).toHaveLength(1);
      });

      it("un id que ya es de otro rol (otro nombre) es ID_DE_ROL_EN_USO y no escribe nada", async () => {
        const e = await empresaConPlan();
        const primero = await crear(e, "Uno");
        const antes = await apoyo.foto([e.empresa]);

        const r = await casos.crearRol(e.ctx, {
          rolId: primero,
          nombre: "Otro nombre",
          origen: { tipo: "VACIO" },
        });

        expect(r).toEqual({ ok: false, error: "ID_DE_ROL_EN_USO" });
        expect(await apoyo.foto([e.empresa])).toBe(antes);
      });

      it("el nombre de un rol archivado es ROL_INACTIVO_CON_ESE_NOMBRE: no se crea otro, se lo reactiva", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Viejo");
        expect(await casos.archivarRol(e.ctx, { rolId: rol })).toMatchObject({ ok: true });

        const r = await casos.crearRol(e.ctx, {
          rolId: nuevoId(),
          nombre: "viejo",
          origen: { tipo: "VACIO" },
        });

        expect(r).toEqual({ ok: false, error: "ROL_INACTIVO_CON_ESE_NOMBRE" });
        expect(await rolesDe(e.empresa)).toHaveLength(1);
      });

      it("un nombre inválido (vacío, con caracteres de control o de más de 80) es NOMBRE_DE_ROL_INVALIDO y no escribe", async () => {
        const e = await empresaConPlan();
        const antes = await apoyo.foto([e.empresa]);
        for (const nombre of ["", "   ", "con\u0000control", "x".repeat(81)]) {
          const r = await casos.crearRol(e.ctx, {
            rolId: nuevoId(),
            nombre,
            origen: { tipo: "VACIO" },
          });
          expect([nombre, r]).toEqual([nombre, { ok: false, error: "NOMBRE_DE_ROL_INVALIDO" }]);
        }
        expect(await apoyo.foto([e.empresa])).toBe(antes);
      });

      it("copiando una plantilla: lleva lo de la plantilla que el plan permite, sin lo reservado al gerente ni lo de módulos fuera del plan", async () => {
        const e = await empresaConPlan({ modulos: ["catalogo", "caja", "ventas"] });
        const rolId = nuevoId();

        const r = await casos.crearRol(e.ctx, {
          rolId,
          nombre: "Como operador",
          origen: { tipo: "PLANTILLA", clave: "OPERADOR" },
        });

        expect(r).toEqual({ ok: true, valor: { rolId, yaExistia: false } });
        const [version] = await versionesDe(e.empresa, rolId);
        const acciones = version?.acciones ?? [];
        expect(acciones).toEqual(expect.arrayContaining([...PISOS_DE_TODOS, "ventas.ver"]));
        expect(acciones.some((a) => a.startsWith("stock."))).toBe(false); // módulo fuera del plan
        expect(acciones).not.toContain("cajas.crear"); // solo del gerente
        expect([...acciones].sort()).toEqual(acciones);
        const [fila] = await apoyo.filas<{ plantilla_origen: string | null }>(
          "select plantilla_origen from rol_de_empresa where id = $1",
          [rolId],
        );
        expect(fila?.plantilla_origen).toBe("OPERADOR");
      });

      it("copiando otro rol de la empresa: lleva sus acciones; un rol de otra empresa no es un origen (ORIGEN_DE_ROL_NO_ENCONTRADO)", async () => {
        const e = await empresaConPlan({ modulos: ["catalogo", "caja", "ventas"] });
        const ajeno = await empresaConPlan();
        const modelo = await crear(e, "Modelo");
        expect(
          await casos.editarRol(e.ctx, {
            rolId: modelo,
            acciones: [...PISOS_DE_TODOS, "ventas.ver", "productos.ver"],
          }),
        ).toMatchObject({ ok: true });
        const deAjeno = await crear(ajeno, "Del otro");

        const copia = nuevoId();
        const r = await casos.crearRol(e.ctx, {
          rolId: copia,
          nombre: "Copia",
          origen: { tipo: "ROL", rolId: modelo },
        });
        const deOtraEmpresa = await casos.crearRol(e.ctx, {
          rolId: nuevoId(),
          nombre: "Robada",
          origen: { tipo: "ROL", rolId: deAjeno },
        });

        expect(r).toEqual({ ok: true, valor: { rolId: copia, yaExistia: false } });
        expect((await versionesDe(e.empresa, copia))[0]?.acciones).toEqual(
          [...PISOS_DE_TODOS, "ventas.ver", "productos.ver"].sort(),
        );
        expect(deOtraEmpresa).toEqual({ ok: false, error: "ORIGEN_DE_ROL_NO_ENCONTRADO" });
      });

      it("solo el gerente: el administrador y el operador son SIN_PERMISO y no escriben nada", async () => {
        const e = await empresaConPlan();
        const administrador = await apoyo.miembro(e, "ADMINISTRADOR");
        const operador = await apoyo.miembro(e, "OPERADOR");
        const antes = await apoyo.foto([e.empresa]);

        for (const ctx of [administrador.ctx, operador.ctx]) {
          const r = await casos.crearRol(ctx, {
            rolId: nuevoId(),
            nombre: "No debería",
            origen: { tipo: "VACIO" },
          });
          expect(r).toEqual(SIN_PERMISO);
        }
        expect(await apoyo.foto([e.empresa])).toBe(antes);
      });

      it("sin sesión de persona o de una empresa donde no es miembro: SIN_PERMISO", async () => {
        const e = await empresaConPlan();
        const otra = await empresaConPlan();
        const ajena = comoEmpresa(e.empresa, otra.gerente); // es gerente de OTRA empresa, no de esta

        const r = await casos.crearRol(ajena, {
          rolId: nuevoId(),
          nombre: "Intruso",
          origen: { tipo: "VACIO" },
        });

        expect(r).toEqual(SIN_PERMISO);
        expect(await rolesDe(e.empresa)).toEqual([]);
      });

      it("el mismo nombre en dos empresas distintas es válido: cada empresa tiene su propio espacio de nombres", async () => {
        const a = await empresaConPlan();
        const b = await empresaConPlan();

        const ra = await crear(a, "Cajero");
        const rb = await crear(b, "Cajero");

        expect(ra).not.toBe(rb);
        expect(await rolesDe(a.empresa)).toHaveLength(1);
        expect(await rolesDe(b.empresa)).toHaveLength(1);
      });

      it("la perilla del plan: con límite 1, el segundo rol activo es LIMITE_DEL_PLAN y no escribe; archivar uno libera el cupo", async () => {
        const e = await empresaConPlan({
          modulos: [],
          perillas: { roles_propios_por_empresa: { tipo: "LIMITE", limite: 1 } },
        });
        const primero = await crear(e, "Primero");
        const antes = await apoyo.foto([e.empresa]);

        const segundo = await casos.crearRol(e.ctx, {
          rolId: nuevoId(),
          nombre: "Segundo",
          origen: { tipo: "VACIO" },
        });

        expect(segundo).toEqual({
          ok: false,
          error: {
            codigo: "LIMITE_DEL_PLAN",
            perilla: "roles_propios_por_empresa",
            limite: 1,
            usoActual: 1,
          },
        });
        expect(await apoyo.foto([e.empresa])).toBe(antes);

        expect(await casos.archivarRol(e.ctx, { rolId: primero })).toMatchObject({ ok: true });
        expect(
          await casos.crearRol(e.ctx, {
            rolId: nuevoId(),
            nombre: "Segundo",
            origen: { tipo: "VACIO" },
          }),
        ).toMatchObject({ ok: true });
      });

      it("concurrencia: dos altas del mismo nombre a la vez dejan UN rol y las dos respuestas apuntan a él", async () => {
        const e = await empresaConPlan();

        const [a, b] = await Promise.all([
          casos.crearRol(e.ctx, { rolId: nuevoId(), nombre: "Doble", origen: { tipo: "VACIO" } }),
          casos.crearRol(e.ctx, { rolId: nuevoId(), nombre: "Doble", origen: { tipo: "VACIO" } }),
        ]);

        const filas = await rolesDe(e.empresa);
        expect(filas).toHaveLength(1);
        expect(a).toMatchObject({ ok: true, valor: { rolId: filas[0]?.id } });
        expect(b).toMatchObject({ ok: true, valor: { rolId: filas[0]?.id } });
        expect(await todaLaAuditoriaDeRoles(e.empresa)).toEqual([{ accion: "ROL_CREADO" }]);
      });

      it("concurrencia: con límite 1 en el plan, dos altas distintas a la vez: una entra y la otra es LIMITE_DEL_PLAN", async () => {
        const e = await empresaConPlan({
          modulos: [],
          perillas: { roles_propios_por_empresa: { tipo: "LIMITE", limite: 1 } },
        });

        const resultados = await Promise.all(
          ["Uno", "Dos"].map((nombre) =>
            casos.crearRol(e.ctx, { rolId: nuevoId(), nombre, origen: { tipo: "VACIO" } }),
          ),
        );

        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        expect(resultados.filter((r) => !r.ok)).toEqual([
          {
            ok: false,
            error: {
              codigo: "LIMITE_DEL_PLAN",
              perilla: "roles_propios_por_empresa",
              limite: 1,
              usoActual: 1,
            },
          },
        ]);
        expect(await rolesDe(e.empresa)).toHaveLength(1);
      });
    });

    // =============================================================================================
    describe("editarRol", () => {
      it("cambiar el nombre y las acciones: el nombre se cambia, las acciones son una versión nueva (la anterior queda) y se audita con lo agregado y lo quitado", async () => {
        const e = await empresaConPlan({ modulos: ["catalogo", "caja", "ventas"] });
        const rol = await crear(e, "Mostrador");

        const r = await casos.editarRol(e.ctx, {
          rolId: rol,
          nombre: "Mostrador y caja",
          acciones: [...PISOS_DE_TODOS, "ventas.ver", "productos.ver"],
        });

        expect(r).toEqual({ ok: true, valor: { cambio: true, numeroDeVersion: 2 } });
        expect((await rolesDe(e.empresa))[0]).toMatchObject({ nombre: "Mostrador y caja" });
        const versiones = await versionesDe(e.empresa, rol);
        expect(versiones.map((v) => v.numero)).toEqual([1, 2]);
        expect(versiones[0]?.acciones).toEqual(PISOS_DE_TODOS);
        expect(versiones[1]?.acciones).toEqual(
          [...PISOS_DE_TODOS, "productos.ver", "ventas.ver"].sort(),
        );
        expect(versiones[1]?.creado_por).toBe(e.gerente);
        const auditoria = await auditoriaDeRol(e.empresa, "ROL_EDITADO");
        expect(auditoria).toHaveLength(1);
        expect(auditoria[0]?.despues).toMatchObject({
          nombre: "Mostrador y caja",
          numeroDeVersion: 2,
          agregadas: ["productos.ver", "ventas.ver"],
          quitadas: [],
        });
      });

      it("editarRol: repetir la misma edición no escribe una versión nueva ni audita", async () => {
        const e = await empresaConPlan({ modulos: ["catalogo", "caja", "ventas"] });
        const rol = await crear(e, "Estable");
        const edicion = {
          rolId: rol,
          nombre: "Estable 2",
          acciones: [...PISOS_DE_TODOS, "ventas.ver"],
        };

        const primera = await casos.editarRol(e.ctx, edicion);
        const antes = await apoyo.foto([e.empresa]);
        const filasAntes = await rolesDe(e.empresa);
        const segunda = await casos.editarRol(e.ctx, edicion);

        expect(primera).toEqual({ ok: true, valor: { cambio: true, numeroDeVersion: 2 } });
        expect(segunda).toEqual({ ok: true, valor: { cambio: false, numeroDeVersion: 2 } });
        expect(await apoyo.foto([e.empresa])).toBe(antes);
        expect(await rolesDe(e.empresa)).toEqual(filasAntes);
        expect(await versionesDe(e.empresa, rol)).toHaveLength(2);
        expect(await auditoriaDeRol(e.empresa, "ROL_EDITADO")).toHaveLength(1);
      });

      it("un conjunto inválido trae TODOS los problemas juntos y no cambia nada: desconocida, fuera del plan, reservada al gerente y falta de un piso", async () => {
        const e = await empresaConPlan({ modulos: ["catalogo", "caja", "ventas"] });
        const rol = await crear(e, "Con errores");
        const antes = await apoyo.foto([e.empresa]);

        const r = await casos.editarRol(e.ctx, {
          rolId: rol,
          acciones: ["no.existe", "stock.ver", "cajas.crear", "ventas.ver"],
        });

        expect(r).toMatchObject({
          ok: false,
          error: { codigo: "CONJUNTO_DE_ACCIONES_INVALIDO" },
        });
        const problemas = r.ok
          ? []
          : ((r.error as { problemas?: { accion: string | null; motivo: string }[] }).problemas ??
            []);
        expect(problemas).toEqual(
          expect.arrayContaining([
            { accion: "no.existe", motivo: "ACCION_DESCONOCIDA" },
            { accion: "stock.ver", motivo: "MODULO_FUERA_DEL_PLAN" },
            { accion: "cajas.crear", motivo: "RESERVADA_AL_GERENTE" },
            { accion: "permisos.ver_propios", motivo: "FALTA_OBLIGATORIA" },
          ]),
        );
        expect(await apoyo.foto([e.empresa])).toBe(antes);
      });

      it("un rol archivado no se edita (ROL_ARCHIVADO); con `reactivar` vuelve a estar activo, se audita y se aplica la edición", async () => {
        const e = await empresaConPlan({ modulos: ["catalogo", "caja", "ventas"] });
        const rol = await crear(e, "Dormido");
        expect(await casos.archivarRol(e.ctx, { rolId: rol })).toMatchObject({ ok: true });

        const sinReactivar = await casos.editarRol(e.ctx, { rolId: rol, nombre: "Despierto" });
        const conReactivar = await casos.editarRol(e.ctx, {
          rolId: rol,
          nombre: "Despierto",
          acciones: [...PISOS_DE_TODOS, "ventas.ver"],
          reactivar: true,
        });

        expect(sinReactivar).toEqual({ ok: false, error: "ROL_ARCHIVADO" });
        expect(conReactivar).toEqual({ ok: true, valor: { cambio: true, numeroDeVersion: 2 } });
        expect((await rolesDe(e.empresa))[0]).toMatchObject({ nombre: "Despierto", activo: true });
        expect(await auditoriaDeRol(e.empresa, "ROL_REACTIVADO")).toHaveLength(1);
        expect(await auditoriaDeRol(e.empresa, "ROL_EDITADO")).toHaveLength(1);
      });

      it("reactivar un rol que ya está activo no hace nada: ni escribe ni audita", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Activo");
        const antes = await apoyo.foto([e.empresa]);

        const r = await casos.editarRol(e.ctx, { rolId: rol, reactivar: true });

        expect(r).toEqual({ ok: true, valor: { cambio: false, numeroDeVersion: 1 } });
        expect(await apoyo.foto([e.empresa])).toBe(antes);
      });

      it("reactivar cuenta contra la perilla del plan: sin cupo es LIMITE_DEL_PLAN y el rol sigue archivado", async () => {
        const e = await empresaConPlan({
          modulos: [],
          perillas: { roles_propios_por_empresa: { tipo: "LIMITE", limite: 1 } },
        });
        const viejo = await crear(e, "Viejo");
        expect(await casos.archivarRol(e.ctx, { rolId: viejo })).toMatchObject({ ok: true });
        await crear(e, "Nuevo");

        const r = await casos.editarRol(e.ctx, { rolId: viejo, reactivar: true });

        expect(r).toEqual({
          ok: false,
          error: {
            codigo: "LIMITE_DEL_PLAN",
            perilla: "roles_propios_por_empresa",
            limite: 1,
            usoActual: 1,
          },
        });
        expect((await rolesDe(e.empresa)).find((x) => x.id === viejo)?.activo).toBe(false);
      });

      it("el nombre de otro rol de la empresa es NOMBRE_DE_ROL_EN_USO", async () => {
        const e = await empresaConPlan();
        await crear(e, "Ocupado");
        const otro = await crear(e, "Libre");

        const r = await casos.editarRol(e.ctx, { rolId: otro, nombre: "ocupado" });

        expect(r).toEqual({ ok: false, error: "NOMBRE_DE_ROL_EN_USO" });
      });

      it("con la versión que vio quien edita desactualizada: EDICION_DESACTUALIZADA y no pisa lo de otro", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Compartido");
        const [{ version } = { version: 0 }] = await rolesDe(e.empresa);
        expect(await casos.editarRol(e.ctx, { rolId: rol, nombre: "Primero" })).toMatchObject({
          ok: true,
        });

        const r = await casos.editarRol(e.ctx, {
          rolId: rol,
          nombre: "Segundo",
          versionEsperada: version,
        });

        expect(r).toEqual({ ok: false, error: "EDICION_DESACTUALIZADA" });
        expect((await rolesDe(e.empresa))[0]?.nombre).toBe("Primero");
      });

      it("un rol inexistente o de otra empresa es ROL_NO_ENCONTRADO (aislamiento por empresa)", async () => {
        const e = await empresaConPlan();
        const ajena = await empresaConPlan();
        const deAjena = await crear(ajena, "Ajeno");

        expect(await casos.editarRol(e.ctx, { rolId: deAjena, nombre: "Mío ahora" })).toEqual({
          ok: false,
          error: "ROL_NO_ENCONTRADO",
        });
        expect(await casos.editarRol(e.ctx, { rolId: nuevoId(), nombre: "Nada" })).toEqual({
          ok: false,
          error: "ROL_NO_ENCONTRADO",
        });
        expect((await rolesDe(ajena.empresa))[0]?.nombre).toBe("Ajeno");
      });

      it("solo el gerente: el administrador es SIN_PERMISO", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Intocable");
        const administrador = await apoyo.miembro(e, "ADMINISTRADOR");

        expect(await casos.editarRol(administrador.ctx, { rolId: rol, nombre: "Mío" })).toEqual(
          SIN_PERMISO,
        );
        expect((await rolesDe(e.empresa))[0]?.nombre).toBe("Intocable");
      });

      it("concurrencia: dos ediciones del mismo rol a la vez no pierden ninguna: las versiones quedan seguidas y la vigente es de una de las dos", async () => {
        const e = await empresaConPlan({ modulos: ["catalogo", "caja", "ventas"] });
        const rol = await crear(e, "Disputado");
        const conVentas = [...PISOS_DE_TODOS, "ventas.ver"];
        const conProductos = [...PISOS_DE_TODOS, "productos.ver"];

        const resultados = await Promise.all([
          casos.editarRol(e.ctx, { rolId: rol, acciones: conVentas }),
          casos.editarRol(e.ctx, { rolId: rol, acciones: conProductos }),
        ]);

        // Cada una o se aplicó o pidió mirar de nuevo; nunca un estado a medias.
        for (const r of resultados) {
          expect(r.ok || r.error === "EDICION_DESACTUALIZADA").toBe(true);
        }
        const versiones = await versionesDe(e.empresa, rol);
        expect(versiones.map((v) => v.numero)).toEqual(
          Array.from({ length: versiones.length }, (_, i) => i + 1),
        );
        const aplicadas = resultados.filter((r) => r.ok).length;
        expect(versiones).toHaveLength(1 + aplicadas);
        expect(await auditoriaDeRol(e.empresa, "ROL_EDITADO")).toHaveLength(aplicadas);
        const vigente = versiones[versiones.length - 1]?.acciones;
        expect([[...conVentas].sort(), [...conProductos].sort()]).toContainEqual(vigente);
      });
    });

    // =============================================================================================
    describe("archivarRol", () => {
      it("archivar un rol sin personas: queda archivado (no se borra) y se audita", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Para archivar");

        const r = await casos.archivarRol(e.ctx, { rolId: rol });

        expect(r).toEqual({ ok: true, valor: { yaEstabaArchivado: false } });
        expect(await rolesDe(e.empresa)).toEqual([
          expect.objectContaining({ id: rol, activo: false }),
        ]);
        expect(await versionesDe(e.empresa, rol)).toHaveLength(1);
        expect(await auditoriaDeRol(e.empresa, "ROL_ARCHIVADO")).toHaveLength(1);
      });

      it("archivarRol: archivar dos veces es ok la segunda y no escribe ni audita de nuevo", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Dos veces");

        const primera = await casos.archivarRol(e.ctx, { rolId: rol });
        const antes = await apoyo.foto([e.empresa]);
        const segunda = await casos.archivarRol(e.ctx, { rolId: rol });

        expect(primera).toEqual({ ok: true, valor: { yaEstabaArchivado: false } });
        expect(segunda).toEqual({ ok: true, valor: { yaEstabaArchivado: true } });
        expect(await apoyo.foto([e.empresa])).toBe(antes);
        expect(await auditoriaDeRol(e.empresa, "ROL_ARCHIVADO")).toHaveLength(1);
      });

      it("con personas activas es ROL_CON_PERSONAS y no cambia nada; sin ellas (apagadas) se puede", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Con gente");
        const persona = await darRolPropio(e.empresa, rol);
        const antes = await apoyo.foto([e.empresa]);

        const r = await casos.archivarRol(e.ctx, { rolId: rol });

        expect(r).toEqual({ ok: false, error: "ROL_CON_PERSONAS" });
        expect(await apoyo.foto([e.empresa])).toBe(antes);

        // Una persona apagada ya no cuenta: el rol se puede archivar.
        await dueno.query("alter table membresia disable trigger membresia_cambio");
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa, persona],
        );
        await dueno.query("alter table membresia enable trigger membresia_cambio");
        expect(await casos.archivarRol(e.ctx, { rolId: rol })).toEqual({
          ok: true,
          valor: { yaEstabaArchivado: false },
        });
      });

      it("un rol archivado no da ninguna acción a quien todavía lo tuviera", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Sin efecto");
        const persona = await darRolPropio(e.empresa, rol);
        await dueno.query("alter table membresia disable trigger membresia_cambio");
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa, persona],
        );
        await dueno.query("alter table membresia enable trigger membresia_cambio");
        expect(await casos.archivarRol(e.ctx, { rolId: rol })).toMatchObject({ ok: true });
        // Con la membresía otra vez activa pero el rol archivado, el conjunto efectivo es vacío.
        await dueno.query("alter table membresia disable trigger membresia_cambio");
        await dueno.query(
          "update membresia set activo = true where empresa_id = $1 and persona_id = $2",
          [e.empresa, persona],
        );
        await dueno.query("alter table membresia enable trigger membresia_cambio");

        const r = await casos.crearRol(comoEmpresa(e.empresa, persona as never), {
          rolId: nuevoId(),
          nombre: "Intento",
          origen: { tipo: "VACIO" },
        });

        expect(r).toEqual(SIN_PERMISO);
      });

      it("un rol inexistente o de otra empresa es ROL_NO_ENCONTRADO", async () => {
        const e = await empresaConPlan();
        const ajena = await empresaConPlan();
        const deAjena = await crear(ajena, "Ajeno");

        expect(await casos.archivarRol(e.ctx, { rolId: deAjena })).toEqual({
          ok: false,
          error: "ROL_NO_ENCONTRADO",
        });
        expect((await rolesDe(ajena.empresa))[0]?.activo).toBe(true);
      });

      it("solo el gerente: el administrador es SIN_PERMISO", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Intocable");
        const administrador = await apoyo.miembro(e, "ADMINISTRADOR");

        expect(await casos.archivarRol(administrador.ctx, { rolId: rol })).toEqual(SIN_PERMISO);
        expect((await rolesDe(e.empresa))[0]?.activo).toBe(true);
      });

      it("concurrencia: dos archivados a la vez del mismo rol son ok los dos y se audita una sola vez", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Carrera");

        const resultados = await Promise.all([
          casos.archivarRol(e.ctx, { rolId: rol }),
          casos.archivarRol(e.ctx, { rolId: rol }),
        ]);

        expect(resultados.every((r) => r.ok)).toBe(true);
        expect((await rolesDe(e.empresa))[0]?.activo).toBe(false);
        expect(await auditoriaDeRol(e.empresa, "ROL_ARCHIVADO")).toHaveLength(1);
      });
    });

    // =============================================================================================
    describe("listarRoles y verRol", () => {
      it("el gerente ve los roles de su empresa (activos y archivados) con sus personas y sus acciones, y ninguno de otra", async () => {
        const e = await empresaConPlan();
        const ajena = await empresaConPlan();
        const uno = await crear(e, "Bravo");
        const dos = await crear(e, "Alfa");
        await darRolPropio(e.empresa, uno);
        expect(await casos.archivarRol(e.ctx, { rolId: dos })).toMatchObject({ ok: true });
        await crear(ajena, "De otra");

        const r = await consultas.listarRoles(e.ctx);

        expect(r).toMatchObject({ ok: true });
        const lista = r.ok ? r.valor : [];
        expect(lista.map((x) => [x.nombre, x.activo, x.personasActivas])).toEqual([
          ["Alfa", false, 0],
          ["Bravo", true, 1],
        ]);
        expect(lista[1]?.acciones).toEqual(PISOS_DE_TODOS);
        expect(lista.map((x) => x.rolId).sort()).toEqual([uno, dos].sort());
      });

      it("verRol devuelve un rol de la empresa o null (inexistente o de otra empresa)", async () => {
        const e = await empresaConPlan();
        const ajena = await empresaConPlan();
        const mio = await crear(e, "Mío");
        const deAjena = await crear(ajena, "Ajeno");

        const propio = await consultas.verRol(e.ctx, { rolId: mio });
        const otro = await consultas.verRol(e.ctx, { rolId: deAjena });
        const ninguno = await consultas.verRol(e.ctx, { rolId: nuevoId() });

        expect(propio).toMatchObject({ ok: true, valor: { rolId: mio, nombre: "Mío" } });
        expect(otro).toEqual({ ok: true, valor: null });
        expect(ninguno).toEqual({ ok: true, valor: null });
      });

      it("solo el gerente: el administrador y el operador son SIN_PERMISO en las dos consultas", async () => {
        const e = await empresaConPlan();
        const rol = await crear(e, "Reservado");
        const administrador = await apoyo.miembro(e, "ADMINISTRADOR");
        const operador = await apoyo.miembro(e, "OPERADOR");

        for (const ctx of [administrador.ctx, operador.ctx]) {
          expect(await consultas.listarRoles(ctx)).toEqual(SIN_PERMISO);
          expect(await consultas.verRol(ctx, { rolId: rol })).toEqual(SIN_PERMISO);
        }
      });
    });
  },
);
