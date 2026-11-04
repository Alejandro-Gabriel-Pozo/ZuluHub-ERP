import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import { crearBaseAparte } from "./entorno";
import {
  codigoAlAzar,
  crearPlan as crearPlanDeEscenario,
  crearPlanPublicado,
} from "./marcas-apoyo";
import {
  auditoriaDePlataformaDe,
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Los casos de uso de planes de plataforma contra Postgres real (M5): crear un plan, guardar el borrador de
 * una versión y publicarla. El ciclo completo, la auditoría exacta, la idempotencia y las reglas de negocio
 * de punta a punta. La asignación y los módulos están en sus propios archivos. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("planes de plataforma: casos de uso contra Postgres", () => {
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

  const crear = (extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["crearPlan"]>[1]> = {}) =>
    casos.crearPlan(comoAdminAhora(), {
      claveDeIdempotencia: clave(),
      codigo: codigoAlAzar("p"),
      ...extra,
    });
  const guardar = (
    planId: string,
    versionEsperada: number | null,
    extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["guardarBorradorDePlan"]>[1]> = {},
  ) =>
    casos.guardarBorradorDePlan(comoAdminAhora(), {
      claveDeIdempotencia: clave(),
      planId,
      versionEsperada,
      nombreComercial: "Básico",
      modulos: ["caja"],
      perillas: {},
      ...extra,
    });
  const publicar = (
    planId: string,
    extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["publicarVersionDePlan"]>[1]> = {},
  ) =>
    casos.publicarVersionDePlan(comoAdminAhora(), {
      claveDeIdempotencia: clave(),
      planId,
      motivo: "primera versión",
      ...extra,
    });
  const filaDeVersion = async (id: string) =>
    (await dueno.query("select * from version_de_plan where id = $1", [id])).rows[0] as Record<
      string,
      unknown
    >;

  describe("crearPlan", () => {
    it("crea el plan ACTIVO sin versiones, con su constancia y su clave", async () => {
      const codigo = codigoAlAzar("p");
      const antes = await huellaDeEscrituras(dueno);
      const r = exito(await crear({ codigo }));
      expect(r.yaExistia).toBe(false);
      expect(
        (await dueno.query("select codigo, estado, version from plan where id = $1", [r.planId]))
          .rows,
      ).toEqual([{ codigo, estado: "ACTIVO", version: 1 }]);
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        planes: antes.planes + 1,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        claves: antes.claves + 1,
      });
      const [constancia] = await auditoriaDePlataformaDe(dueno, "plan", r.planId);
      expect(constancia).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "PLAN_CREADO",
        antes: null,
        despues: { codigo, estado: "ACTIVO" },
      });
    });

    it("repetir con la misma clave, o crear el mismo código con otra, devuelve el mismo plan sin auditar de nuevo", async () => {
      const entrada = { claveDeIdempotencia: clave(), codigo: codigoAlAzar("p") };
      const primera = exito(await casos.crearPlan(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await casos.crearPlan(comoAdminAhora(), entrada))).toEqual({
        planId: primera.planId,
        yaExistia: true,
      });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(exito(await crear({ codigo: entrada.codigo }))).toEqual({
        planId: primera.planId,
        yaExistia: true,
      });
      expect(await auditoriaDePlataformaDe(dueno, "plan", primera.planId)).toHaveLength(1);
    });

    it("la misma clave con otro código es CLAVE_REUTILIZADA; un código mal formado, CODIGO_DE_PLAN_INVALIDO", async () => {
      const claveDeIdempotencia = clave();
      exito(await crear({ claveDeIdempotencia }));
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await crear({ claveDeIdempotencia }))).toBe("CLAVE_REUTILIZADA");
      for (const codigo of ["", "A", "Plan Pro", "1plan", "p".repeat(41)]) {
        expect(falla(await crear({ codigo })), codigo).toBe("CODIGO_DE_PLAN_INVALIDO");
      }
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });
  });

  describe("guardarBorradorDePlan", () => {
    const unPlan = async () => exito(await crear()).planId;

    it("abre el borrador con el contenido en forma canónica y deja su constancia (las perillas, como lista)", async () => {
      const plan = await unPlan();
      const r = exito(
        await guardar(plan, null, {
          nombreComercial: "  Plan Pro ",
          modulos: ["ventas", "caja", "ventas"],
          perillas: {
            cajas_por_sucursal: { tipo: "LIMITE", limite: 3 },
            vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
          },
        }),
      );
      expect(r.version).toBe(1);
      expect(await filaDeVersion(r.borradorId)).toMatchObject({
        plan_id: plan,
        estado: "BORRADOR",
        numero: null,
        nombre_comercial: "Plan Pro",
        modulos: ["caja", "ventas"],
        perillas: {
          cajas_por_sucursal: { tipo: "LIMITE", limite: 3 },
          vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
        },
      });
      const [constancia] = await auditoriaDePlataformaDe(dueno, "version_de_plan", r.borradorId);
      expect(constancia).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "PLAN_BORRADOR_GUARDADO",
        antes: null,
        despues: {
          planId: plan,
          esNuevo: true,
          version: 1,
          nombreComercial: "Plan Pro",
          modulos: ["caja", "ventas"],
          perillas: [
            { perilla: "cajas_por_sucursal", tipo: "LIMITE", encendida: null, limite: 3 },
            { perilla: "vidriera_por_qr", tipo: "INTERRUPTOR", encendida: true, limite: null },
          ],
        },
      });
    });

    it("edita el borrador reemplazando el contenido ENTERO, y audita el antes y el después", async () => {
      const plan = await unPlan();
      const primero = exito(
        await guardar(plan, null, {
          modulos: ["caja", "ventas"],
          perillas: { vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true } },
        }),
      );
      const segundo = exito(
        await guardar(plan, 1, { nombreComercial: "Nuevo", modulos: ["caja"] }),
      );
      expect(segundo).toEqual({ borradorId: primero.borradorId, version: 2 });
      expect(await filaDeVersion(segundo.borradorId)).toMatchObject({
        nombre_comercial: "Nuevo",
        modulos: ["caja"],
        perillas: {},
        version: 2,
      });
      const constancias = await auditoriaDePlataformaDe(
        dueno,
        "version_de_plan",
        segundo.borradorId,
      );
      expect(constancias).toHaveLength(2);
      expect(constancias[1]).toMatchObject({
        antes: { nombreComercial: "Básico", modulos: ["caja", "ventas"] },
        despues: {
          esNuevo: false,
          version: 2,
          nombreComercial: "Nuevo",
          modulos: ["caja"],
          perillas: [],
        },
      });
    });

    it("guardar el mismo contenido (aunque llegue en otro orden) es éxito sin escribir ni auditar", async () => {
      const plan = await unPlan();
      const primero = exito(
        await guardar(plan, null, {
          modulos: ["caja", "ventas"],
          perillas: {
            vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
            cajas_por_sucursal: { tipo: "LIMITE", limite: 2 },
          },
        }),
      );
      const antes = await huellaDeEscrituras(dueno);
      const otra = exito(
        await guardar(plan, 1, {
          modulos: ["ventas", "caja"],
          perillas: {
            cajas_por_sucursal: { tipo: "LIMITE", limite: 2 },
            vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
          },
        }),
      );
      expect(otra).toEqual(primero);
      expect(await huellaDeEscrituras(dueno)).toEqual({ ...antes, claves: antes.claves + 1 });
    });

    it("repetir con la misma clave devuelve lo mismo sin escribir; la misma clave con otro contenido es CLAVE_REUTILIZADA", async () => {
      const plan = await unPlan();
      const entrada = {
        claveDeIdempotencia: clave(),
        planId: plan,
        versionEsperada: null,
        nombreComercial: "Básico",
        modulos: ["caja"],
        perillas: {},
      };
      const primera = exito(await casos.guardarBorradorDePlan(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await casos.guardarBorradorDePlan(comoAdminAhora(), entrada))).toEqual(primera);
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(
        falla(
          await casos.guardarBorradorDePlan(comoAdminAhora(), {
            ...entrada,
            modulos: ["ventas", "caja"],
          }),
        ),
      ).toBe("CLAVE_REUTILIZADA");
    });

    it("VERSION_DESACTUALIZADA: esperar «sin borrador» cuando ya hay uno, o una versión que ya cambió", async () => {
      const plan = await unPlan();
      exito(await guardar(plan, null));
      expect(falla(await guardar(plan, null, { nombreComercial: "Otro" }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      exito(await guardar(plan, 1, { nombreComercial: "Otro" }));
      expect(falla(await guardar(plan, 1, { nombreComercial: "Tercero" }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      expect(falla(await guardar(await unPlan(), 3))).toBe("VERSION_DESACTUALIZADA");
    });

    it("rechaza cada problema del contenido con su motivo y sin escribir", async () => {
      const plan = await unPlan();
      const antes = await huellaDeEscrituras(dueno);
      const malos: Array<[string, Partial<Parameters<typeof guardar>[2]>, unknown]> = [
        ["nombre vacío", { nombreComercial: "  " }, "NOMBRE_DE_PLAN_INVALIDO"],
        [
          "módulo que no existe",
          { modulos: ["nada"] },
          { codigo: "MODULO_DESCONOCIDO", modulo: "nada" },
        ],
        [
          "módulo sin lo que requiere",
          { modulos: ["cuentas"] },
          { codigo: "REQUIERE_FALTANTE", modulo: "cuentas", requiere: "ventas" },
        ],
        [
          "perilla que no existe",
          { perillas: { inventada: { tipo: "LIMITE", limite: 1 } } },
          { codigo: "PERILLA_DESCONOCIDA", perilla: "inventada" },
        ],
        [
          "valor del tipo equivocado",
          { perillas: { vidriera_por_qr: { tipo: "LIMITE", limite: 1 } } },
          { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "vidriera_por_qr" },
        ],
        [
          "límite fuera de rango",
          { perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: -1 } } },
          { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "cajas_por_sucursal" },
        ],
        [
          "perilla encendida sin la que requiere",
          { perillas: { confirmacion_por_sena: { tipo: "INTERRUPTOR", encendida: true } } },
          {
            codigo: "PERILLA_REQUIERE_OTRA",
            perilla: "confirmacion_por_sena",
            requiere: "reserva_provisoria",
          },
        ],
      ];
      for (const [nombre, extra, esperado] of malos) {
        expect(falla(await guardar(plan, null, extra)), nombre).toEqual(esperado);
      }
      expect(falla(await guardar("no-es-un-uuid", null))).toBe("ID_INVALIDO");
      expect(falla(await guardar(plan, 0))).toBe("VERSION_ESPERADA_INVALIDA");
      expect(falla(await guardar("00000000-0000-4000-8000-00000000dead", null))).toBe(
        "PLAN_NO_ENCONTRADO",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("un plan retirado no admite borradores", async () => {
      const plan = await unPlan();
      await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [plan]);
      expect(falla(await guardar(plan, null))).toBe("PLAN_RETIRADO");
    });
  });

  describe("publicarVersionDePlan", () => {
    async function planConBorrador(extra: Partial<Parameters<typeof guardar>[2]> = {}) {
      const plan = exito(await crear()).planId;
      const borrador = exito(
        await guardar(plan, null, {
          modulos: ["caja", "ventas"],
          perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 2 } },
          ...extra,
        }),
      );
      return { plan, borrador };
    }

    it("publica el borrador: versión 1 congelada, quién la publicó y por qué, y la constancia", async () => {
      const { plan, borrador } = await planConBorrador();
      expect(exito(await publicar(plan, { motivo: "  lanzamiento " }))).toEqual({ numero: 1 });
      expect(await filaDeVersion(borrador.borradorId)).toMatchObject({
        estado: "PUBLICADA",
        numero: 1,
        motivo: "lanzamiento",
        publicada_por: ADMIN_DE_PRUEBA,
        modulos: ["caja", "ventas"],
      });
      const constancias = await auditoriaDePlataformaDe(
        dueno,
        "version_de_plan",
        borrador.borradorId,
      );
      expect(constancias.at(-1)).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "PLAN_VERSION_PUBLICADA",
        antes: null,
        despues: {
          planId: plan,
          numero: 1,
          motivo: "lanzamiento",
          nombreComercial: "Básico",
          modulos: ["caja", "ventas"],
          perillas: [{ perilla: "cajas_por_sucursal", tipo: "LIMITE", encendida: null, limite: 2 }],
        },
      });
      // Congelada: ni el dueño de la base la puede tocar.
      await expect(
        dueno.query("update version_de_plan set nombre_comercial = 'otro' where id = $1", [
          borrador.borradorId,
        ]),
      ).rejects.toMatchObject({ constraint: "version_de_plan_publicada_inmutable" });
      // El borrador se consumió: ya no hay nada que publicar.
      expect(falla(await publicar(plan))).toBe("SIN_BORRADOR");
    });

    it("la segunda versión lleva el número siguiente y la primera no cambia", async () => {
      const { plan, borrador } = await planConBorrador();
      exito(await publicar(plan));
      exito(await guardar(plan, null, { nombreComercial: "Mejorado", modulos: ["caja"] }));
      expect(exito(await publicar(plan, { motivo: "mejora" }))).toEqual({ numero: 2 });
      const { rows } = await dueno.query<{ numero: number; nombre_comercial: string }>(
        "select numero, nombre_comercial from version_de_plan where plan_id = $1 order by numero",
        [plan],
      );
      expect(rows).toEqual([
        { numero: 1, nombre_comercial: "Básico" },
        { numero: 2, nombre_comercial: "Mejorado" },
      ]);
      expect((await filaDeVersion(borrador.borradorId))["numero"]).toBe(1);
    });

    it("publicar NO mueve a nadie: un tenant con la versión 1 sigue con la 1 (N1)", async () => {
      const { plan, borrador } = await planConBorrador();
      exito(await publicar(plan));
      const tenant = (
        await dueno.query<{ id: string }>(
          "insert into tenant (nombre, marca_id) select 'n1', id from marca where es_principal returning id",
        )
      ).rows[0]?.id as string;
      await dueno.query(
        `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
         values ($1, 1, $2, now(), 'ALTA', 'alta', $3)`,
        [tenant, borrador.borradorId, ADMIN_DE_PRUEBA],
      );
      exito(await guardar(plan, null, { nombreComercial: "Mejorado" }));
      exito(await publicar(plan, { motivo: "mejora" }));
      const { rows } = await dueno.query<{ version_de_plan_id: string }>(
        "select version_de_plan_id from plan_de_tenant where tenant_id = $1",
        [tenant],
      );
      expect(rows).toEqual([{ version_de_plan_id: borrador.borradorId }]);
    });

    it("repetir con la misma clave devuelve el mismo número sin publicar otra versión ni auditar de nuevo", async () => {
      const { plan } = await planConBorrador();
      const entrada = { claveDeIdempotencia: clave(), planId: plan, motivo: "primera" };
      const primera = exito(await casos.publicarVersionDePlan(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await casos.publicarVersionDePlan(comoAdminAhora(), entrada))).toEqual(primera);
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(
        falla(await casos.publicarVersionDePlan(comoAdminAhora(), { ...entrada, motivo: "otra" })),
      ).toBe("CLAVE_REUTILIZADA");
    });

    it("rechaza lo que no se puede publicar, sin escribir nada", async () => {
      const vacio = exito(await crear()).planId;
      const { plan } = await planConBorrador();
      const retirado = await planConBorrador();
      await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [retirado.plan]);
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await publicar(vacio))).toBe("SIN_BORRADOR");
      expect(falla(await publicar(plan, { motivo: "   " }))).toBe("MOTIVO_OBLIGATORIO");
      expect(falla(await publicar(plan, { motivo: "m".repeat(501) }))).toBe(
        "MOTIVO_DEMASIADO_LARGO",
      );
      expect(falla(await publicar(retirado.plan))).toBe("PLAN_RETIRADO");
      expect(falla(await publicar("no-es-un-uuid"))).toBe("ID_INVALIDO");
      expect(falla(await publicar("00000000-0000-4000-8000-00000000dead"))).toBe(
        "PLAN_NO_ENCONTRADO",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("un borrador cuyo contenido el catálogo de ahora ya no admite no se publica", async () => {
      // El borrador se arma con el cliente del dueño con un módulo que el catálogo de pruebas no tiene.
      const plan = await crearPlanDeEscenario(dueno);
      await dueno.query(
        "insert into version_de_plan (plan_id, nombre_comercial, modulos) values ($1, 'Viejo', '{retirado_del_codigo}')",
        [plan],
      );
      expect(falla(await publicar(plan))).toEqual({
        codigo: "MODULO_DESCONOCIDO",
        modulo: "retirado_del_codigo",
      });
    });

    it("un plan publicado por el dueño se puede seguir editando por una versión nueva", async () => {
      const { plan } = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const r = exito(await guardar(plan, null, { nombreComercial: "Segunda" }));
      expect(r.version).toBe(1);
      expect(exito(await publicar(plan, { motivo: "segunda" }))).toEqual({ numero: 2 });
    });
  });
});
