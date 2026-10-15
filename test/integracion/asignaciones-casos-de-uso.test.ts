import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import { crearBaseAparte } from "./entorno";
import {
  crearBorradorDePlan,
  crearMundoDeMarca,
  crearPlanPublicado,
  publicarVersionDePlan,
} from "./marcas-apoyo";
import {
  auditoriaDeEmpresaDe,
  auditoriaDePlataformaDe,
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  desdeAhora,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Asignar un plan, migrar un lote de tenants a otra versión y ajustar una perilla, contra Postgres real
 * (M5): el número consecutivo, «la última decisión manda», la auditoría de plataforma y la de cada empresa
 * afectada (actor nulo), la idempotencia y las reglas de negocio de punta a punta. Base propia.
 */

const base = inject("baseDePruebas");
const INEXISTENTE = "00000000-0000-4000-8000-00000000dead";

describe.skipIf(base === null)("asignaciones y ajustes: casos de uso contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let casos: CasosDeUsoDeMarcasYPlanes;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    casos = crearCasosDeMarcasYPlanes(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Un tenant con dos empresas. */
  async function tenantConDosEmpresas() {
    const primera = await crearMundoDeMarca(dueno);
    const segunda = await crearMundoDeMarca(dueno, { tenant: primera.tenant });
    return { tenant: primera.tenant, empresas: [primera.empresa, segunda.empresa] };
  }
  /** Un plan con dos versiones publicadas: la 1 con caja y la 2 con caja y ventas. */
  async function planConDosVersiones() {
    const primera = await crearPlanPublicado(dueno, {
      modulos: ["caja"],
      perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 2 } },
    });
    const borrador = await crearBorradorDePlan(dueno, primera.plan, {
      modulos: ["caja", "ventas"],
      perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 5 } },
    });
    await publicarVersionDePlan(dueno, borrador);
    return { plan: primera.plan, v1: primera.version, v2: borrador };
  }

  const asignar = (
    tenantId: string,
    versionDePlanId: string,
    extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["asignarPlan"]>[1]> = {},
  ) =>
    casos.asignarPlan(comoAdminAhora(), {
      claveDeIdempotencia: clave(),
      tenantId,
      versionDePlanId,
      vigenteDesde: desdeAhora(0),
      motivo: "cambio de plan",
      numeroEsperado: null,
      reemplazaProgramada: false,
      ...extra,
    });
  const asignaciones = async (tenant: string) =>
    (
      await dueno.query<{
        numero: number;
        version_de_plan_id: string;
        origen: string;
        motivo: string;
        asignado_por: string;
        reemplaza_programada: boolean;
      }>(
        "select numero, version_de_plan_id, origen, motivo, asignado_por, reemplaza_programada from plan_de_tenant where tenant_id = $1 order by numero",
        [tenant],
      )
    ).rows;

  describe("asignarPlan", () => {
    it("la primera asignación es la número 1: quién, por qué y con qué origen; una constancia de plataforma y una por empresa", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const { v1 } = await planConDosVersiones();
      const antes = await huellaDeEscrituras(dueno);
      const vigenteDesde = desdeAhora(0);
      const r = exito(await asignar(tenant, v1, { vigenteDesde, motivo: "  alta del cliente " }));
      expect(r).toEqual({ numero: 1, yaExistia: false });
      expect(await asignaciones(tenant)).toEqual([
        {
          numero: 1,
          version_de_plan_id: v1,
          origen: "CAMBIO",
          motivo: "alta del cliente",
          asignado_por: ADMIN_DE_PRUEBA,
          reemplaza_programada: false,
        },
      ]);
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        asignaciones: antes.asignaciones + 1,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        auditoriaDeEmpresa: antes.auditoriaDeEmpresa + 2,
        claves: antes.claves + 1,
      });
      const fila = (
        await dueno.query<{ id: string }>("select id from plan_de_tenant where tenant_id = $1", [
          tenant,
        ])
      ).rows[0]?.id as string;
      const [constancia] = await auditoriaDePlataformaDe(dueno, "plan_de_tenant", fila);
      expect(constancia).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "PLAN_ASIGNADO",
        antes: null,
        despues: {
          tenantId: tenant,
          numero: 1,
          versionDePlanId: v1,
          versionNumero: 1,
          nombreComercial: "Plan de prueba",
          origen: "CAMBIO",
          motivo: "alta del cliente",
          reemplazaProgramada: false,
          reemplazadas: [],
          lote: null,
        },
      });
      expect(constancia?.despues?.["vigenteDesde"]).toBe(vigenteDesde.toISOString());
      // Lo que afecta a una empresa deja su propia constancia en CADA empresa, sin persona (es la plataforma).
      for (const empresa of empresas) {
        const filas = await auditoriaDeEmpresaDe(dueno, empresa, "PLAN_ASIGNADO");
        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({
          actor_persona_id: null,
          entidad: "plan_de_tenant",
          entidad_id: fila,
          antes: null,
          despues: { tenantId: tenant, numero: 1, versionDePlanId: v1 },
        });
      }
    });

    it("el cambio siguiente lleva el número siguiente, audita contra la que regía y no toca la anterior", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const { v1, v2 } = await planConDosVersiones();
      exito(await asignar(tenant, v1, { vigenteDesde: desdeAhora(-30) }));
      expect(exito(await asignar(tenant, v2, { numeroEsperado: 1 }))).toEqual({
        numero: 2,
        yaExistia: false,
      });
      const filas = await asignaciones(tenant);
      expect(filas.map((f) => [f.numero, f.version_de_plan_id])).toEqual([
        [1, v1],
        [2, v2],
      ]);
      const ultima = (
        await dueno.query<{ id: string }>(
          "select id from plan_de_tenant where tenant_id = $1 and numero = 2",
          [tenant],
        )
      ).rows[0]?.id as string;
      const [constancia] = await auditoriaDePlataformaDe(dueno, "plan_de_tenant", ultima);
      expect(constancia).toMatchObject({
        antes: { numero: 1, versionDePlanId: v1, versionNumero: 1 },
        despues: { numero: 2, versionDePlanId: v2, versionNumero: 2 },
      });
    });

    it("pedir la versión que ya rige, sin nada programado, es éxito sin escribir ni auditar (yaExistia)", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const { v1 } = await planConDosVersiones();
      exito(await asignar(tenant, v1));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await asignar(tenant, v1, { numeroEsperado: 1 }))).toEqual({
        numero: 1,
        yaExistia: true,
      });
      expect(await huellaDeEscrituras(dueno)).toEqual({ ...antes, claves: antes.claves + 1 });
    });

    it("repetir con la misma clave devuelve lo mismo sin asignar otra vez ni auditar; con otra entrada, CLAVE_REUTILIZADA", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const { v1, v2 } = await planConDosVersiones();
      const entrada = {
        claveDeIdempotencia: clave(),
        tenantId: tenant,
        versionDePlanId: v1,
        vigenteDesde: desdeAhora(0),
        motivo: "alta",
        numeroEsperado: null,
        reemplazaProgramada: false,
      };
      expect(exito(await casos.asignarPlan(comoAdminAhora(), entrada))).toEqual({
        numero: 1,
        yaExistia: false,
      });
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await casos.asignarPlan(comoAdminAhora(), entrada))).toEqual({
        numero: 1,
        yaExistia: true,
      });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(
        falla(await casos.asignarPlan(comoAdminAhora(), { ...entrada, versionDePlanId: v2 })),
      ).toBe("CLAVE_REUTILIZADA");
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("VERSION_DESACTUALIZADA: la última decisión manda, sin perder ninguna", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const { v1, v2 } = await planConDosVersiones();
      exito(await asignar(tenant, v1));
      // Esperar «sin asignaciones» cuando ya hay una, o un número que no es el último.
      expect(falla(await asignar(tenant, v2, { numeroEsperado: null }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      expect(falla(await asignar(tenant, v2, { numeroEsperado: 7 }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      exito(await asignar(tenant, v2, { numeroEsperado: 1 }));
      expect(falla(await asignar(tenant, v1, { numeroEsperado: 1 }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      expect((await asignaciones(tenant)).map((f) => f.numero)).toEqual([1, 2]);
    });

    it("una asignación programada no rige todavía; reemplazarla exige decirlo, y la que reemplaza queda en el historial", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const { v1, v2 } = await planConDosVersiones();
      exito(await asignar(tenant, v1, { vigenteDesde: desdeAhora(-30) }));
      exito(await asignar(tenant, v2, { numeroEsperado: 1, vigenteDesde: desdeAhora(3600) }));
      // Con una programada pendiente, volver a la 1 sin decirlo es un error.
      expect(
        falla(await asignar(tenant, v1, { numeroEsperado: 2, vigenteDesde: desdeAhora(7200) })),
      ).toBe("CAMBIO_PROGRAMADO_PENDIENTE");
      // La nueva empieza antes que la programada: la deja sin efecto (la #2 nunca va a regir).
      const r = exito(
        await asignar(tenant, v1, {
          numeroEsperado: 2,
          vigenteDesde: desdeAhora(1800),
          reemplazaProgramada: true,
        }),
      );
      expect(r).toEqual({ numero: 3, yaExistia: false });
      const filas = await asignaciones(tenant);
      expect(filas).toHaveLength(3);
      expect(filas[2]).toMatchObject({ numero: 3, reemplaza_programada: true });
      const ultima = (
        await dueno.query<{ id: string }>(
          "select id from plan_de_tenant where tenant_id = $1 and numero = 3",
          [tenant],
        )
      ).rows[0]?.id as string;
      const [constancia] = await auditoriaDePlataformaDe(dueno, "plan_de_tenant", ultima);
      expect(constancia?.despues).toMatchObject({ reemplazaProgramada: true, reemplazadas: [2] });
    });

    it("una baja que quita módulos NO se rechaza: el módulo activado queda en solo lectura y nada se borra", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const { v1, v2 } = await planConDosVersiones();
      exito(await asignar(tenant, v2, { vigenteDesde: desdeAhora(-30) }));
      const empresa = empresas[0] as string;
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'ventas')",
        [empresa],
      );
      exito(await asignar(tenant, v1, { numeroEsperado: 1 }));
      expect(
        (await dueno.query("select activo from modulo_de_empresa where empresa_id = $1", [empresa]))
          .rows,
      ).toEqual([{ activo: true }]);
    });

    it("rechaza lo que no se puede asignar, con su motivo y sin escribir nada", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const { plan, v1, v2 } = await planConDosVersiones();
      const otro = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const retirado = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [retirado.plan]);
      const borrador = await crearBorradorDePlan(dueno, plan, { modulos: ["caja"] });
      exito(await asignar(tenant, v1));
      const antes = await huellaDeEscrituras(dueno);
      const malos: Array<[string, Parameters<typeof asignar>, unknown]> = [
        ["tenant inexistente", [INEXISTENTE, v1], "TENANT_NO_ENCONTRADO"],
        // La existencia se mira ANTES de decidir: no depende de que la clave foránea lo traduzca al insertar.
        [
          "tenant inexistente con un número esperado que de otro modo sería desactualizado",
          [INEXISTENTE, v1, { numeroEsperado: 3 }],
          "TENANT_NO_ENCONTRADO",
        ],
        [
          "versión inexistente",
          [tenant, INEXISTENTE, { numeroEsperado: 1 }],
          "VERSION_DE_PLAN_NO_ENCONTRADA",
        ],
        [
          "versión en borrador",
          [tenant, borrador, { numeroEsperado: 1 }],
          "VERSION_DE_PLAN_NO_PUBLICADA",
        ],
        [
          "a un plan retirado distinto del actual",
          [tenant, retirado.version, { numeroEsperado: 1 }],
          "PLAN_RETIRADO",
        ],
        ["motivo vacío", [tenant, v2, { numeroEsperado: 1, motivo: "  " }], "MOTIVO_OBLIGATORIO"],
        [
          "motivo larguísimo",
          [tenant, v2, { numeroEsperado: 1, motivo: "m".repeat(501) }],
          "MOTIVO_DEMASIADO_LARGO",
        ],
        [
          "vigencia retroactiva",
          [tenant, v2, { numeroEsperado: 1, vigenteDesde: desdeAhora(-3600) }],
          "VIGENCIA_RETROACTIVA",
        ],
        [
          "fecha inválida",
          [tenant, v2, { numeroEsperado: 1, vigenteDesde: new Date("x") }],
          "VIGENCIA_INVALIDA",
        ],
        [
          "número esperado inválido",
          [tenant, v2, { numeroEsperado: 0 }],
          "NUMERO_ESPERADO_INVALIDO",
        ],
        ["tenant que no es un id", ["no-es-un-uuid", v1], "ID_INVALIDO"],
        ["versión que no es un id", [tenant, "no-es-un-uuid"], "ID_INVALIDO"],
        [
          "clave corta",
          [tenant, v2, { numeroEsperado: 1, claveDeIdempotencia: "corta" }],
          "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
        ],
      ];
      for (const [nombre, argumentos, esperado] of malos) {
        expect(falla(await asignar(...argumentos)), nombre).toBe(esperado);
      }
      expect(otro.version).toBeTruthy();
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("moverse entre versiones de un plan retirado se permite (solo se frena el ingreso a un plan retirado)", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const { plan, v1, v2 } = await planConDosVersiones();
      exito(await asignar(tenant, v1));
      await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [plan]);
      expect(exito(await asignar(tenant, v2, { numeroEsperado: 1 }))).toEqual({
        numero: 2,
        yaExistia: false,
      });
    });
  });

  describe("migrarTenantsDeVersion", () => {
    const migrar = (
      claveDeLote: string,
      versionDePlanId: string,
      tenants: Array<{ tenantId: string; numeroEsperado: number | null }>,
      extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["migrarTenantsDeVersion"]>[1]> = {},
    ) =>
      casos.migrarTenantsDeVersion(comoAdminAhora(), {
        claveDeLote,
        versionDePlanId,
        vigenteDesde: desdeAhora(0),
        motivo: "migración a la versión 2",
        tenants,
        reemplazaProgramada: false,
        ...extra,
      });
    const loteAlAzar = () => `lote-${clave().slice(6)}`;

    it("migra tenant por tenant: lo que sale bien queda aunque otro falle, con su origen, su constancia con el lote y las de sus empresas", async () => {
      const { v1, v2 } = await planConDosVersiones();
      const a = await tenantConDosEmpresas();
      const b = await tenantConDosEmpresas();
      const c = await tenantConDosEmpresas();
      for (const t of [a, b, c])
        exito(await asignar(t.tenant, v1, { vigenteDesde: desdeAhora(-30) }));
      const lote = loteAlAzar();
      const antes = await huellaDeEscrituras(dueno);
      const r = exito(
        await migrar(lote, v2, [
          { tenantId: a.tenant, numeroEsperado: 1 },
          { tenantId: b.tenant, numeroEsperado: 9 }, // desactualizado
          { tenantId: c.tenant, numeroEsperado: 1 },
        ]),
      );
      expect(r.resultados).toEqual([
        { tenantId: a.tenant, resultado: "MIGRADO", numero: 2, repetido: false, error: null },
        {
          tenantId: b.tenant,
          resultado: "ERROR",
          numero: null,
          repetido: false,
          error: "VERSION_DESACTUALIZADA",
        },
        { tenantId: c.tenant, resultado: "MIGRADO", numero: 2, repetido: false, error: null },
      ]);
      expect((await asignaciones(a.tenant))[1]).toMatchObject({
        numero: 2,
        version_de_plan_id: v2,
        origen: "MIGRACION_DE_VERSION",
        motivo: "migración a la versión 2",
        asignado_por: ADMIN_DE_PRUEBA,
      });
      expect(await asignaciones(b.tenant)).toHaveLength(1);
      // Dos migrados: una constancia de plataforma cada uno y una por empresa; del que falló, nada.
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        asignaciones: antes.asignaciones + 2,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 2,
        auditoriaDeEmpresa: antes.auditoriaDeEmpresa + 4,
        claves: antes.claves + 2,
      });
      const { rows } = await dueno.query<{ entidad_id: string; despues: Record<string, unknown> }>(
        "select entidad_id, despues from auditoria_plataforma where accion = 'PLAN_MIGRADO_POR_LOTE' and despues ->> 'lote' = $1 order by id",
        [lote],
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((f) => f.despues["tenantId"])).toEqual([a.tenant, c.tenant]);
      expect(rows[0]?.despues).toMatchObject({ origen: "MIGRACION_DE_VERSION", numero: 2, lote });
      for (const empresa of [...a.empresas, ...c.empresas]) {
        expect(await auditoriaDeEmpresaDe(dueno, empresa, "PLAN_MIGRADO_POR_LOTE")).toHaveLength(1);
      }
      for (const empresa of b.empresas) {
        expect(await auditoriaDeEmpresaDe(dueno, empresa, "PLAN_MIGRADO_POR_LOTE")).toHaveLength(0);
      }
    });

    it("repetir el lote con la misma clave solo rehace lo que falló: no duplica filas ni auditorías", async () => {
      const { v1, v2 } = await planConDosVersiones();
      const a = await tenantConDosEmpresas();
      const b = await tenantConDosEmpresas();
      for (const t of [a, b]) exito(await asignar(t.tenant, v1, { vigenteDesde: desdeAhora(-30) }));
      const lote = loteAlAzar();
      // Reintentar un lote es mandar el MISMO pedido (la misma vigencia): lo demás sería otro pedido.
      const vigenteDesde = desdeAhora(0);
      const primera = exito(
        await migrar(
          lote,
          v2,
          [
            { tenantId: a.tenant, numeroEsperado: 1 },
            { tenantId: b.tenant, numeroEsperado: 5 },
          ],
          { vigenteDesde },
        ),
      );
      expect(primera.resultados.map((x) => x.resultado)).toEqual(["MIGRADO", "ERROR"]);
      const antes = await huellaDeEscrituras(dueno);
      // El mismo lote, con el número esperado de `b` corregido: `a` ya está hecho, `b` se rehace.
      const segunda = exito(
        await migrar(
          lote,
          v2,
          [
            { tenantId: a.tenant, numeroEsperado: 1 },
            { tenantId: b.tenant, numeroEsperado: 1 },
          ],
          { vigenteDesde },
        ),
      );
      expect(segunda.resultados).toEqual([
        { tenantId: a.tenant, resultado: "MIGRADO", numero: 2, repetido: true, error: null },
        { tenantId: b.tenant, resultado: "MIGRADO", numero: 2, repetido: false, error: null },
      ]);
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        asignaciones: antes.asignaciones + 1,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        auditoriaDeEmpresa: antes.auditoriaDeEmpresa + 2,
        claves: antes.claves + 1,
      });
      expect(await asignaciones(a.tenant)).toHaveLength(2);
      // Y una tercera vez, ya no hace nada.
      const tercera = exito(
        await migrar(
          lote,
          v2,
          [
            { tenantId: a.tenant, numeroEsperado: 1 },
            { tenantId: b.tenant, numeroEsperado: 1 },
          ],
          { vigenteDesde },
        ),
      );
      expect(tercera.resultados.map((x) => [x.resultado, x.repetido])).toEqual([
        ["MIGRADO", true],
        ["MIGRADO", true],
      ]);
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        asignaciones: antes.asignaciones + 1,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        auditoriaDeEmpresa: antes.auditoriaDeEmpresa + 2,
        claves: antes.claves + 1,
      });
    });

    it("el tenant que ya tiene la versión es YA_ESTABA; el que no existe, un error solo suyo", async () => {
      const { v1, v2 } = await planConDosVersiones();
      const ya = await tenantConDosEmpresas();
      exito(await asignar(ya.tenant, v2, { vigenteDesde: desdeAhora(-30) }));
      const sin = await tenantConDosEmpresas();
      exito(await asignar(sin.tenant, v1, { vigenteDesde: desdeAhora(-30) }));
      const r = exito(
        await migrar(loteAlAzar(), v2, [
          { tenantId: ya.tenant, numeroEsperado: 1 },
          { tenantId: INEXISTENTE, numeroEsperado: null },
          { tenantId: sin.tenant.toUpperCase(), numeroEsperado: 1 },
        ]),
      );
      expect(r.resultados).toEqual([
        { tenantId: ya.tenant, resultado: "YA_ESTABA", numero: 1, repetido: false, error: null },
        {
          tenantId: INEXISTENTE,
          resultado: "ERROR",
          numero: null,
          repetido: false,
          error: "TENANT_NO_ENCONTRADO",
        },
        { tenantId: sin.tenant, resultado: "MIGRADO", numero: 2, repetido: false, error: null },
      ]);
      expect(await asignaciones(ya.tenant)).toHaveLength(1);
    });

    it("rechaza un lote mal armado antes de tocar a nadie", async () => {
      const { v2 } = await planConDosVersiones();
      const a = await tenantConDosEmpresas();
      const antes = await huellaDeEscrituras(dueno);
      const uno = { tenantId: a.tenant, numeroEsperado: null };
      const muchos = Array.from({ length: 201 }, (_, i) => ({
        tenantId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        numeroEsperado: null,
      }));
      expect(falla(await migrar("lote_con_guion_bajo", v2, [uno]))).toBe("CLAVE_DE_LOTE_INVALIDA");
      expect(falla(await migrar(loteAlAzar(), v2, []))).toBe("LOTE_VACIO");
      expect(falla(await migrar(loteAlAzar(), v2, muchos))).toBe("LOTE_DEMASIADO_GRANDE");
      expect(falla(await migrar(loteAlAzar(), v2, [uno, uno]))).toBe("TENANT_REPETIDO_EN_EL_LOTE");
      expect(falla(await migrar(loteAlAzar(), v2, [{ tenantId: "x", numeroEsperado: null }]))).toBe(
        "ID_INVALIDO",
      );
      expect(falla(await migrar(loteAlAzar(), "no-es-un-uuid", [uno]))).toBe("ID_INVALIDO");
      expect(falla(await migrar(loteAlAzar(), v2, [uno], { vigenteDesde: new Date("x") }))).toBe(
        "VIGENCIA_INVALIDA",
      );
      expect(falla(await migrar(loteAlAzar(), v2, [uno], { motivo: "m".repeat(501) }))).toBe(
        "MOTIVO_DEMASIADO_LARGO",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("la clave de cada tenant entra en la tabla real aun con la clave de lote más larga (106 caracteres)", async () => {
      const { v1, v2 } = await planConDosVersiones();
      const a = await tenantConDosEmpresas();
      exito(await asignar(a.tenant, v1, { vigenteDesde: desdeAhora(-30) }));
      const lote = "L".repeat(64);
      const r = exito(await migrar(lote, v2, [{ tenantId: a.tenant, numeroEsperado: 1 }]));
      expect(r.resultados[0]?.resultado).toBe("MIGRADO");
      const claveCompleta = `lote_${lote}_${a.tenant}`;
      expect(claveCompleta).toHaveLength(106);
      expect(
        await cuenta(
          dueno,
          "select count(*)::int as n from idempotencia_plataforma where clave = $1",
          [claveCompleta],
        ),
      ).toBe(1);
    });
  });

  describe("ajustarPerilla", () => {
    const ajustar = (
      tenantId: string,
      perilla: string,
      valor: unknown,
      extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["ajustarPerilla"]>[1]> = {},
    ) =>
      casos.ajustarPerilla(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        tenantId,
        empresaId: null,
        perilla,
        valor,
        vigenteDesde: desdeAhora(0),
        motivo: "extra pagado",
        numeroEsperado: null,
        reemplazaProgramada: false,
        ...extra,
      });
    const ajustes = async (tenant: string) =>
      (
        await dueno.query<{
          empresa_id: string | null;
          perilla: string;
          numero: number;
          valor: string;
          motivo: string;
          asignado_por: string;
        }>(
          "select empresa_id, perilla, numero, valor, motivo, asignado_por from ajuste_de_perilla where tenant_id = $1 order by perilla, empresa_id nulls first, numero",
          [tenant],
        )
      ).rows;

    it("el ajuste de todo el tenant: número 1, quién y por qué, el valor efectivo de antes y una constancia en cada empresa", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const antes = await huellaDeEscrituras(dueno);
      const r = exito(await ajustar(tenant, "empresas_por_tenant", { tipo: "LIMITE", limite: 3 }));
      expect(r).toEqual({ numero: 1 });
      expect(await ajustes(tenant)).toEqual([
        {
          empresa_id: null,
          perilla: "empresas_por_tenant",
          numero: 1,
          valor: "3",
          motivo: "extra pagado",
          asignado_por: ADMIN_DE_PRUEBA,
        },
      ]);
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        ajustes: antes.ajustes + 1,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        auditoriaDeEmpresa: antes.auditoriaDeEmpresa + 2,
        claves: antes.claves + 1,
      });
      const fila = (
        await dueno.query<{ id: string }>("select id from ajuste_de_perilla where tenant_id = $1", [
          tenant,
        ])
      ).rows[0]?.id as string;
      const [constancia] = await auditoriaDePlataformaDe(dueno, "ajuste_de_perilla", fila);
      expect(constancia).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "PERILLA_AJUSTADA",
        // El valor efectivo de antes: la base de la perilla.
        antes: { perilla: "empresas_por_tenant", origen: "BASE", tipo: "LIMITE", limite: 1 },
        despues: {
          tenantId: tenant,
          empresaId: null,
          perilla: "empresas_por_tenant",
          numero: 1,
          delPlan: false,
          tipo: "LIMITE",
          limite: 3,
          motivo: "extra pagado",
          reemplazadas: [],
        },
      });
      for (const empresa of empresas) {
        expect(await auditoriaDeEmpresaDe(dueno, empresa, "PERILLA_AJUSTADA")).toHaveLength(1);
      }
    });

    it("el ajuste de UNA empresa deja la constancia solo en esa empresa; los valores se guardan como los lee la base", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const [primera, segunda] = empresas as [string, string];
      exito(
        await ajustar(
          tenant,
          "carta_por_qr",
          { tipo: "INTERRUPTOR", encendida: true },
          { empresaId: primera },
        ),
      );
      exito(
        await ajustar(
          tenant,
          "cajas_por_sucursal",
          { tipo: "LIMITE", limite: "ILIMITADO" },
          { empresaId: primera },
        ),
      );
      expect((await ajustes(tenant)).filter((a) => a.perilla === "carta_por_qr")).toMatchObject([
        { empresa_id: primera, valor: "1" },
      ]);
      expect(
        (await ajustes(tenant)).filter((a) => a.perilla === "cajas_por_sucursal"),
      ).toMatchObject([{ empresa_id: primera, valor: "ILIMITADO" }]);
      expect(await auditoriaDeEmpresaDe(dueno, primera, "PERILLA_AJUSTADA")).toHaveLength(2);
      expect(await auditoriaDeEmpresaDe(dueno, segunda, "PERILLA_AJUSTADA")).toHaveLength(0);
    });

    it("DEL_PLAN vuelve al valor del plan; el ajuste siguiente de la serie es el número 2 y audita el valor efectivo de antes", async () => {
      const { tenant } = await tenantConDosEmpresas();
      exito(
        await ajustar(
          tenant,
          "empresas_por_tenant",
          { tipo: "LIMITE", limite: 5 },
          { vigenteDesde: desdeAhora(-30) },
        ),
      );
      const r = exito(
        await ajustar(tenant, "empresas_por_tenant", "DEL_PLAN", { numeroEsperado: 1 }),
      );
      expect(r).toEqual({ numero: 2 });
      expect((await ajustes(tenant)).map((a) => [a.numero, a.valor])).toEqual([
        [1, "5"],
        [2, "DEL_PLAN"],
      ]);
      const fila = (
        await dueno.query<{ id: string }>(
          "select id from ajuste_de_perilla where tenant_id = $1 and numero = 2",
          [tenant],
        )
      ).rows[0]?.id as string;
      const [constancia] = await auditoriaDePlataformaDe(dueno, "ajuste_de_perilla", fila);
      expect(constancia).toMatchObject({
        antes: { origen: "AJUSTE", tipo: "LIMITE", limite: 5 },
        despues: { numero: 2, delPlan: true, tipo: null, limite: null },
      });
    });

    it("repetir con la misma clave devuelve el mismo número sin ajustar otra vez ni auditar; con otro valor, CLAVE_REUTILIZADA", async () => {
      const { tenant } = await tenantConDosEmpresas();
      const entrada = {
        claveDeIdempotencia: clave(),
        tenantId: tenant,
        empresaId: null,
        perilla: "empresas_por_tenant",
        valor: { tipo: "LIMITE", limite: 3 },
        vigenteDesde: desdeAhora(0),
        motivo: "extra",
        numeroEsperado: null,
        reemplazaProgramada: false,
      };
      const primera = exito(await casos.ajustarPerilla(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await casos.ajustarPerilla(comoAdminAhora(), entrada))).toEqual(primera);
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(
        falla(
          await casos.ajustarPerilla(comoAdminAhora(), {
            ...entrada,
            valor: { tipo: "LIMITE", limite: 4 },
          }),
        ),
      ).toBe("CLAVE_REUTILIZADA");
    });

    it("VERSION_DESACTUALIZADA se cuenta por perilla y alcance; programar exige reemplazaProgramada", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const empresa = empresas[0] as string;
      exito(await ajustar(tenant, "empresas_por_tenant", { tipo: "LIMITE", limite: 3 }));
      // Otra serie (otra perilla, u otro alcance) arranca de cero: esperar `null` está bien.
      exito(await ajustar(tenant, "cajas_por_sucursal", { tipo: "LIMITE", limite: 3 }));
      exito(
        await ajustar(
          tenant,
          "cajas_por_sucursal",
          { tipo: "LIMITE", limite: 4 },
          { empresaId: empresa },
        ),
      );
      expect(
        falla(await ajustar(tenant, "empresas_por_tenant", { tipo: "LIMITE", limite: 4 })),
      ).toBe("VERSION_DESACTUALIZADA");
      exito(
        await ajustar(
          tenant,
          "empresas_por_tenant",
          { tipo: "LIMITE", limite: 4 },
          { numeroEsperado: 1, vigenteDesde: desdeAhora(3600) },
        ),
      );
      expect(
        falla(
          await ajustar(
            tenant,
            "empresas_por_tenant",
            { tipo: "LIMITE", limite: 6 },
            { numeroEsperado: 2, vigenteDesde: desdeAhora(7200) },
          ),
        ),
      ).toBe("CAMBIO_PROGRAMADO_PENDIENTE");
      exito(
        await ajustar(
          tenant,
          "empresas_por_tenant",
          { tipo: "LIMITE", limite: 6 },
          { numeroEsperado: 2, vigenteDesde: desdeAhora(7200), reemplazaProgramada: true },
        ),
      );
    });

    it("rechaza lo que no se puede ajustar, con su motivo y sin escribir nada", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const ajena = await tenantConDosEmpresas();
      const antes = await huellaDeEscrituras(dueno);
      const malos: Array<[string, Parameters<typeof ajustar>, unknown]> = [
        [
          "perilla que no existe",
          [tenant, "inventada", { tipo: "LIMITE", limite: 1 }],
          "PERILLA_DESCONOCIDA",
        ],
        [
          "perilla de tenant ajustada por empresa",
          [
            tenant,
            "empresas_por_tenant",
            { tipo: "LIMITE", limite: 1 },
            { empresaId: empresas[0] as string },
          ],
          "AMBITO_NO_PERMITIDO",
        ],
        [
          "interruptor con valor de límite",
          [tenant, "carta_por_qr", { tipo: "LIMITE", limite: 1 }],
          { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "carta_por_qr" },
        ],
        [
          "límite negativo",
          [tenant, "cajas_por_sucursal", { tipo: "LIMITE", limite: -1 }],
          { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "cajas_por_sucursal" },
        ],
        [
          "valor que no es nada",
          [tenant, "cajas_por_sucursal", () => 1],
          { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "cajas_por_sucursal" },
        ],
        [
          "valor con una clase",
          [tenant, "cajas_por_sucursal", new Date()],
          { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "cajas_por_sucursal" },
        ],
        [
          "encender una perilla cuya requerida está apagada",
          [tenant, "confirmacion_por_sena", { tipo: "INTERRUPTOR", encendida: true }],
          {
            codigo: "PERILLA_REQUIERE_OTRA",
            perilla: "confirmacion_por_sena",
            requiere: "reserva_provisoria",
          },
        ],
        [
          "empresa de otro tenant",
          [
            tenant,
            "carta_por_qr",
            { tipo: "INTERRUPTOR", encendida: true },
            { empresaId: ajena.empresas[0] as string },
          ],
          "EMPRESA_DE_OTRO_TENANT",
        ],
        [
          "empresa inexistente",
          [
            tenant,
            "carta_por_qr",
            { tipo: "INTERRUPTOR", encendida: true },
            { empresaId: INEXISTENTE },
          ],
          "EMPRESA_NO_ENCONTRADA",
        ],
        [
          "tenant inexistente",
          [INEXISTENTE, "carta_por_qr", { tipo: "INTERRUPTOR", encendida: true }],
          "TENANT_NO_ENCONTRADO",
        ],
        [
          "tenant inexistente con un número esperado que de otro modo sería desactualizado",
          [
            INEXISTENTE,
            "carta_por_qr",
            { tipo: "INTERRUPTOR", encendida: true },
            { numeroEsperado: 3 },
          ],
          "TENANT_NO_ENCONTRADO",
        ],
        [
          "motivo vacío",
          [tenant, "carta_por_qr", { tipo: "INTERRUPTOR", encendida: true }, { motivo: " " }],
          "MOTIVO_OBLIGATORIO",
        ],
        [
          "vigencia retroactiva",
          [
            tenant,
            "carta_por_qr",
            { tipo: "INTERRUPTOR", encendida: true },
            { vigenteDesde: desdeAhora(-3600) },
          ],
          "VIGENCIA_RETROACTIVA",
        ],
        [
          "tenant que no es un id",
          ["x", "carta_por_qr", { tipo: "INTERRUPTOR", encendida: true }],
          "ID_INVALIDO",
        ],
        [
          "empresa que no es un id",
          [tenant, "carta_por_qr", { tipo: "INTERRUPTOR", encendida: true }, { empresaId: "x" }],
          "ID_INVALIDO",
        ],
      ];
      for (const [nombre, argumentos, esperado] of malos) {
        expect(falla(await ajustar(...argumentos)), nombre).toEqual(esperado);
      }
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("se puede encender una perilla cuya requerida ya está encendida (por el plan o por otro ajuste)", async () => {
      const { tenant } = await tenantConDosEmpresas();
      exito(
        await ajustar(
          tenant,
          "reserva_provisoria",
          { tipo: "INTERRUPTOR", encendida: true },
          { vigenteDesde: desdeAhora(-30) },
        ),
      );
      expect(
        exito(
          await ajustar(tenant, "confirmacion_por_sena", { tipo: "INTERRUPTOR", encendida: true }),
        ),
      ).toEqual({ numero: 1 });
    });
  });
});
