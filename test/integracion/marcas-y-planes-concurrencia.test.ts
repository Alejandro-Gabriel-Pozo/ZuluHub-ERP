import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  asignarPlan,
  codigoAlAzar,
  crearBorradorDeMarca,
  crearBorradorDePlan,
  crearMarca,
  crearMundoDeMarca,
  crearPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
} from "./marcas-apoyo";
import {
  auditoriaDePlataformaDe,
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  desdeAhora,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Concurrencia de los casos de uso de plataforma sobre marcas, planes, ajustes y módulos de empresa (M5),
 * contra Postgres real y con barrera: todas las transacciones LEEN antes de que ninguna escriba, así que las
 * carreras ocurren de verdad (no por casualidad de tiempos). Cada prueba se repite varias veces con datos
 * nuevos. Base propia: SERIALIZABLE aborta por falsos positivos si otros archivos escriben las mismas tablas
 * en paralelo.
 */

const base = inject("baseDePruebas");
const VUELTAS = 6;

const valores = <T>(rs: ReadonlyArray<Resultado<T, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [r.valor] : []));
const errores = (rs: ReadonlyArray<Resultado<unknown, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [] : [r.error]));

describe.skipIf(base === null)("marcas y planes de plataforma: concurrencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  /** Envuelve los métodos de lectura de un repositorio para esperar en la barrera DESPUÉS de leer. */
  function despuesDeLeer<T extends object>(
    repo: T,
    metodos: readonly string[],
    barrera: () => Promise<void>,
  ): T {
    const envuelto = { ...repo } as Record<string, unknown>;
    for (const metodo of metodos) {
      const original = (repo as Record<string, (...a: unknown[]) => Promise<unknown>>)[metodo];
      envuelto[metodo] = async (...a: unknown[]) => {
        const r = await original?.call(repo, ...a);
        await barrera();
        return r;
      };
    }
    return envuelto as T;
  }

  /**
   * Un entorno cuyas transacciones esperan en una barrera DESPUÉS de leer lo que nombran y ANTES de escribir.
   * `participantes` es cuántas transacciones tienen que llegar para que se abra.
   */
  function conBarrera(
    participantes: number,
    lecturas: Readonly<{ marcas?: readonly string[]; planes?: readonly string[] }>,
  ) {
    const barrera = crearBarrera(participantes);
    let llegadas = 0;
    const llegar = async () => {
      llegadas += 1;
      await barrera();
    };
    const entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba> = crearEntornoDeMarcasYPlanes(
      propia.base,
      participantes + 2,
      (tx) => ({
        ...tx,
        marcas: despuesDeLeer(tx.marcas, lecturas.marcas ?? [], llegar),
        planes: despuesDeLeer(tx.planes, lecturas.planes ?? [], llegar),
      }),
    );
    /** Cierra el entorno y comprueba que la carrera fue de verdad: todas las transacciones llegaron a la barrera. */
    const cerrar = async () => {
      try {
        expect(llegadas).toBeGreaterThanOrEqual(participantes);
      } finally {
        await entorno.cerrar();
      }
    };
    return { cerrar, casos: crearCasosDeMarcasYPlanes(entorno) };
  }
  const sinBarrera = () => {
    const entorno = crearEntornoDeMarcasYPlanes(propia.base, 4);
    return { entorno, casos: crearCasosDeMarcasYPlanes(entorno) };
  };

  const TEMA = {
    primary: "#1d4ed8",
    "on-primary": "#ffffff",
    secondary: "#475569",
    accent: "#0f766e",
  };

  describe("marcas", () => {
    it("dos guardarBorrador desde la misma versión: uno gana y el otro es VERSION_DESACTUALIZADA, sin perder el trabajo del ganador", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["borradorDe"] });
        try {
          const marca = await crearMarca(dueno, { padre: principal });
          const borrador = await crearBorradorDeMarca(dueno, marca, { nombreVisible: "Inicial" });
          const rs = await Promise.all(
            ["A", "B"].map((nombre) =>
              casos.guardarBorradorDeMarca(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                marcaId: marca,
                versionEsperada: 1,
                nombreVisible: nombre,
              }),
            ),
          );
          expect(valores(rs)).toHaveLength(1);
          expect(errores(rs)).toEqual(["VERSION_DESACTUALIZADA"]);
          const fila = (
            await dueno.query<{ version: number; nombre_visible: string }>(
              "select version, nombre_visible from version_de_marca where id = $1",
              [borrador],
            )
          ).rows[0];
          expect(fila?.version).toBe(2);
          expect(["A", "B"]).toContain(fila?.nombre_visible);
          expect(await auditoriaDePlataformaDe(dueno, "version_de_marca", borrador)).toHaveLength(
            1,
          );
        } finally {
          await cerrar();
        }
      }
    });

    it("dos guardarBorrador que abren el primer borrador a la vez: uno solo lo abre", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["borradorDe"] });
        try {
          const marca = await crearMarca(dueno, { padre: principal });
          const rs = await Promise.all(
            ["A", "B"].map((nombre) =>
              casos.guardarBorradorDeMarca(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                marcaId: marca,
                versionEsperada: null,
                nombreVisible: nombre,
              }),
            ),
          );
          expect(valores(rs)).toHaveLength(1);
          expect(errores(rs)).toEqual(["VERSION_DESACTUALIZADA"]);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from version_de_marca where marca_id = $1",
              [marca],
            ),
          ).toBe(1);
        } finally {
          await cerrar();
        }
      }
    });

    it("dos guardarBorrador que abren el primer borrador desde la misma confirmada: uno gana, el otro es VERSION_DESACTUALIZADA, y el borrador conserva lo confirmado", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["borradorDe"] });
        try {
          const { marca } = await marcaConConfirmada();
          const rs = await Promise.all(
            ["#b91c1c", "#7c3aed"].map((accent) =>
              casos.guardarBorradorDeMarca(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                marcaId: marca,
                versionEsperada: null,
                tema: { ...TEMA, accent },
              }),
            ),
          );
          expect(valores(rs)).toHaveLength(1);
          expect(errores(rs)).toEqual(["VERSION_DESACTUALIZADA"]);
          const borradores = (
            await dueno.query<{ nombre_visible: string; logo: string; tema: { accent: string } }>(
              "select nombre_visible, logo, tema from version_de_marca where marca_id = $1 and estado = 'BORRADOR'",
              [marca],
            )
          ).rows;
          expect(borradores).toHaveLength(1);
          expect(borradores[0]).toMatchObject({
            nombre_visible: "Marca",
            logo: "/marcas/mc/logo.png",
          });
          expect(["#b91c1c", "#7c3aed"]).toContain(borradores[0]?.tema.accent);
        } finally {
          await cerrar();
        }
      }
    });

    it("dos confirmarVersion con la misma versionEsperada y claves distintas sobre una marca ya confirmada: una sola versión nueva, sin números repetidos", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["borradorDe"] });
        try {
          const { marca, plan } = await marcaConConfirmada();
          await crearBorradorDeMarca(dueno, marca, {
            nombreVisible: "Segunda",
            tema: TEMA,
            logo: "/marcas/mc/logo.png",
            modulosIniciales: ["caja"],
            planPorDefecto: plan,
          });
          const rs = await Promise.all(
            [0, 1].map(() =>
              casos.confirmarVersionDeMarca(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                marcaId: marca,
                versionEsperada: 1,
                vigenteDesde: desdeAhora(0),
                motivo: "segunda",
                reemplazaProgramada: false,
              }),
            ),
          );
          expect(valores(rs)).toEqual([{ numero: 2 }]);
          expect(errores(rs)).toEqual(["SIN_BORRADOR"]);
          const numeros = (
            await dueno.query<{ numero: number }>(
              "select numero from version_de_marca where marca_id = $1 and estado = 'CONFIRMADA' order by numero",
              [marca],
            )
          ).rows.map((f) => f.numero);
          expect(numeros).toEqual([1, 2]);
        } finally {
          await cerrar();
        }
      }
    });

    it("confirmar a la vez que otra persona guarda: nunca se publica un borrador que quien confirma no vio", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["borradorDe"] });
        try {
          const { marca } = await marcaConBorradorCompleto();
          const [confirmacion, guardado] = await Promise.all([
            casos.confirmarVersionDeMarca(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              marcaId: marca,
              versionEsperada: 1,
              vigenteDesde: desdeAhora(0),
              motivo: "alta",
              reemplazaProgramada: false,
            }),
            casos.guardarBorradorDeMarca(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              marcaId: marca,
              versionEsperada: 1,
              nombreVisible: "El de B",
            }),
          ]);
          // Una de las dos gana; la otra ve que lo que miraba ya no es lo que hay.
          expect([confirmacion.ok, guardado.ok].filter(Boolean)).toHaveLength(1);
          expect(errores([confirmacion, guardado])).toEqual(["VERSION_DESACTUALIZADA"]);
          const filas = (
            await dueno.query<{ estado: string; nombre_visible: string; version: number }>(
              "select estado, nombre_visible, version from version_de_marca where marca_id = $1",
              [marca],
            )
          ).rows;
          expect(filas).toHaveLength(1);
          if (confirmacion.ok) {
            // Confirmó lo que A vio.
            expect(filas[0]).toMatchObject({ estado: "CONFIRMADA", nombre_visible: "Marca" });
          } else {
            // B guardó primero: su borrador (versión 2) sigue ahí, intacto y sin publicar.
            expect(filas[0]).toMatchObject({
              estado: "BORRADOR",
              nombre_visible: "El de B",
              version: 2,
            });
          }
        } finally {
          await cerrar();
        }
      }
    });

    it("dos confirmarVersion del mismo borrador con claves distintas: una sola confirma y la otra ve que ya no hay borrador", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["borradorDe"] });
        try {
          const { marca } = await marcaConBorradorCompleto();
          const rs = await Promise.all(
            [0, 1].map(() =>
              casos.confirmarVersionDeMarca(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                marcaId: marca,
                versionEsperada: 1,
                vigenteDesde: desdeAhora(0),
                motivo: "alta",
                reemplazaProgramada: false,
              }),
            ),
          );
          expect(valores(rs)).toEqual([{ numero: 1 }]);
          expect(errores(rs)).toEqual(["SIN_BORRADOR"]);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from version_de_marca where marca_id = $1 and estado = 'CONFIRMADA'",
              [marca],
            ),
          ).toBe(1);
          const constancias = (await auditoriaDePlataformaDe(dueno, "marca", marca)).filter(
            (c) => c.accion === "MARCA_VERSION_CONFIRMADA",
          );
          expect(constancias).toHaveLength(1);
        } finally {
          await cerrar();
        }
      }
    });

    it("dos confirmarVersion con la MISMA clave a la vez: las dos devuelven lo mismo, una versión, una constancia", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["borradorDe"] });
        try {
          const { marca } = await marcaConBorradorCompleto();
          const entrada = {
            claveDeIdempotencia: clave(),
            marcaId: marca,
            versionEsperada: 1,
            vigenteDesde: desdeAhora(0),
            motivo: "alta",
            reemplazaProgramada: false,
          };
          const rs = await Promise.all([
            casos.confirmarVersionDeMarca(comoAdminAhora(), entrada),
            casos.confirmarVersionDeMarca(comoAdminAhora(), entrada),
          ]);
          expect(valores(rs)).toEqual([{ numero: 1 }, { numero: 1 }]);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from version_de_marca where marca_id = $1 and estado = 'CONFIRMADA'",
              [marca],
            ),
          ).toBe(1);
          expect(
            (await auditoriaDePlataformaDe(dueno, "marca", marca)).filter(
              (c) => c.accion === "MARCA_VERSION_CONFIRMADA",
            ),
          ).toHaveLength(1);
        } finally {
          await cerrar();
        }
      }
    });

    it("dos crearMarca del mismo código con claves distintas: una crea y la otra ve que ya existía", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { marcas: ["obtenerPorCodigo"] });
        try {
          const codigo = codigoAlAzar();
          const rs = await Promise.all(
            [0, 1].map(() =>
              casos.crearMarca(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                codigo,
                marcaPadreId: principal,
              }),
            ),
          );
          const vistos = valores(rs);
          expect(vistos).toHaveLength(2);
          expect(vistos.map((v) => v.yaExistia).sort()).toEqual([false, true]);
          expect(new Set(vistos.map((v) => v.marcaId)).size).toBe(1);
          expect(
            await cuenta(dueno, "select count(*)::int as n from marca where codigo = $1", [codigo]),
          ).toBe(1);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from auditoria_plataforma where accion = 'MARCA_CREADA' and despues ->> 'codigo' = $1",
              [codigo],
            ),
          ).toBe(1);
        } finally {
          await cerrar();
        }
      }
    });
  });

  /** Una marca sin padre con su borrador COMPLETO (nombre, colores, logo, módulos iniciales y plan por defecto). */
  /** Una marca con una versión confirmada COMPLETA (nombre «Marca», colores, logo, módulos iniciales y plan) y sin borrador. */
  async function marcaConConfirmada() {
    const marca = await crearMarca(dueno);
    const { plan } = await crearPlanPublicado(dueno, { modulos: ["caja"] });
    await crearVersionDeMarcaConfirmada(dueno, marca, {
      nombreVisible: "Marca",
      tema: TEMA,
      logo: "/marcas/mc/logo.png",
      modulosIniciales: ["caja"],
      planPorDefecto: plan,
    });
    return { marca, plan };
  }

  async function marcaConBorradorCompleto() {
    const marca = await crearMarca(dueno);
    const { plan } = await crearPlanPublicado(dueno, { modulos: ["caja"] });
    await crearBorradorDeMarca(dueno, marca, {
      nombreVisible: "Marca",
      tema: TEMA,
      logo: "/marcas/mc/logo.png",
      modulosIniciales: ["caja"],
      planPorDefecto: plan,
    });
    return { marca };
  }

  describe("planes", () => {
    it("dos publicarVersion del mismo borrador: una sola publica y la otra ve que ya no hay borrador", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["borradorDe"] });
        try {
          const plan = await crearPlan(dueno);
          await crearBorradorDePlan(dueno, plan, { modulos: ["caja"] });
          const rs = await Promise.all(
            [0, 1].map(() =>
              casos.publicarVersionDePlan(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                planId: plan,
                motivo: "primera",
              }),
            ),
          );
          expect(valores(rs)).toEqual([{ numero: 1 }]);
          expect(errores(rs)).toEqual(["SIN_BORRADOR"]);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from version_de_plan where plan_id = $1 and estado = 'PUBLICADA'",
              [plan],
            ),
          ).toBe(1);
        } finally {
          await cerrar();
        }
      }
    });

    it("dos guardarBorrador de plan desde la misma versión: uno gana y el otro es VERSION_DESACTUALIZADA", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["borradorDe"] });
        try {
          const plan = await crearPlan(dueno);
          await crearBorradorDePlan(dueno, plan, { modulos: ["caja"] });
          const rs = await Promise.all(
            ["A", "B"].map((nombre) =>
              casos.guardarBorradorDePlan(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                planId: plan,
                versionEsperada: 1,
                nombreComercial: nombre,
                modulos: ["caja"],
                perillas: {},
              }),
            ),
          );
          expect(valores(rs)).toHaveLength(1);
          expect(errores(rs)).toEqual(["VERSION_DESACTUALIZADA"]);
        } finally {
          await cerrar();
        }
      }
    });

    it("dos crearPlan del mismo código con claves distintas: uno crea y el otro ve que ya existía", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["obtenerPlanPorCodigo"] });
        try {
          const codigo = codigoAlAzar("p");
          const rs = await Promise.all(
            [0, 1].map(() =>
              casos.crearPlan(comoAdminAhora(), { claveDeIdempotencia: clave(), codigo }),
            ),
          );
          expect(
            valores(rs)
              .map((v) => v.yaExistia)
              .sort(),
          ).toEqual([false, true]);
          expect(
            await cuenta(dueno, "select count(*)::int as n from plan where codigo = $1", [codigo]),
          ).toBe(1);
        } finally {
          await cerrar();
        }
      }
    });
  });

  describe("asignarPlan", () => {
    async function tenantConPlan() {
      const m = await crearMundoDeMarca(dueno);
      const v1 = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const v2 = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas"] });
      const v3 = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas", "cuentas"] });
      await asignarPlan(dueno, m.tenant, v1.version, { desdeSegundos: -30 });
      return { ...m, v1: v1.version, v2: v2.version, v3: v3.version };
    }
    const numeros = async (tenant: string) =>
      (
        await dueno.query<{ numero: number }>(
          "select numero from plan_de_tenant where tenant_id = $1 order by numero",
          [tenant],
        )
      ).rows.map((f) => f.numero);
    const asignar = (
      casos: CasosDeUsoDeMarcasYPlanes,
      tenantId: string,
      versionDePlanId: string,
      extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["asignarPlan"]>[1]> = {},
    ) =>
      casos.asignarPlan(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        tenantId,
        versionDePlanId,
        vigenteDesde: desdeAhora(0),
        motivo: "cambio",
        numeroEsperado: 1,
        reemplazaProgramada: false,
        ...extra,
      });

    it("N asignarPlan desde el mismo numeroEsperado: uno gana, los demás son VERSION_DESACTUALIZADA; sin huecos ni números repetidos", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const participantes = 4;
        const { cerrar, casos } = conBarrera(participantes, { planes: ["asignacionesDelTenant"] });
        try {
          const t = await tenantConPlan();
          const rs = await Promise.all(
            [t.v2, t.v3, t.v2, t.v3].map((version) => asignar(casos, t.tenant, version)),
          );
          expect(valores(rs)).toHaveLength(1);
          expect(errores(rs)).toEqual(Array(participantes - 1).fill("VERSION_DESACTUALIZADA"));
          expect(await numeros(t.tenant)).toEqual([1, 2]);
          const constancias = await cuenta(
            dueno,
            "select count(*)::int as n from auditoria_plataforma where accion = 'PLAN_ASIGNADO' and despues ->> 'tenantId' = $1",
            [t.tenant],
          );
          expect(constancias).toBe(1);
        } finally {
          await cerrar();
        }
      }
    });

    it("la última decisión manda sin perder ninguna: el que perdió la carrera reintenta con el número nuevo y queda en el historial", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["asignacionesDelTenant"] });
        try {
          const t = await tenantConPlan();
          const [a, b] = await Promise.all([
            asignar(casos, t.tenant, t.v2),
            asignar(casos, t.tenant, t.v3),
          ]);
          const [ganadora, perdedora] = a.ok ? [a, b] : [b, a];
          expect(ganadora.ok).toBe(true);
          expect(perdedora).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
          const versionPerdedora = a.ok ? t.v3 : t.v2;
          const { casos: normales, entorno: entornoNormal } = sinBarrera();
          try {
            expect(
              await asignar(normales, t.tenant, versionPerdedora, { numeroEsperado: 2 }),
            ).toEqual({
              ok: true,
              valor: { numero: 3, yaExistia: false },
            });
          } finally {
            await entornoNormal.cerrar();
          }
          expect(await numeros(t.tenant)).toEqual([1, 2, 3]);
        } finally {
          await cerrar();
        }
      }
    });

    it("dos asignarPlan con la MISMA clave a la vez: las dos devuelven el mismo número, una fila, una constancia", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["asignacionesDelTenant"] });
        try {
          const t = await tenantConPlan();
          const entrada = {
            claveDeIdempotencia: clave(),
            tenantId: t.tenant,
            versionDePlanId: t.v2,
            vigenteDesde: desdeAhora(0),
            motivo: "cambio",
            numeroEsperado: 1,
            reemplazaProgramada: false,
          };
          const rs = await Promise.all([
            casos.asignarPlan(comoAdminAhora(), entrada),
            casos.asignarPlan(comoAdminAhora(), entrada),
          ]);
          expect(valores(rs).map((v) => v.numero)).toEqual([2, 2]);
          expect(await numeros(t.tenant)).toEqual([1, 2]);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from auditoria_plataforma where accion = 'PLAN_ASIGNADO' and despues ->> 'tenantId' = $1",
              [t.tenant],
            ),
          ).toBe(1);
        } finally {
          await cerrar();
        }
      }
    });

    it("migrar el MISMO lote (misma clave) dos veces a la vez: una asignación por tenant, una constancia por tenant", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["asignacionesDelTenant"] });
        try {
          const a = await tenantConPlan();
          const b = await tenantConPlan();
          const entrada = {
            claveDeLote: `lote-${clave().slice(6)}`,
            versionDePlanId: a.v2,
            vigenteDesde: desdeAhora(0),
            motivo: "migración",
            tenants: [a, b].map((t) => ({ tenantId: t.tenant, numeroEsperado: 1 })),
            reemplazaProgramada: false,
          };
          const rs = await Promise.all([
            casos.migrarTenantsDeVersion(comoAdminAhora(), entrada),
            casos.migrarTenantsDeVersion(comoAdminAhora(), entrada),
          ]);
          for (const r of valores(rs)) {
            expect(r.resultados.map((x) => x.resultado)).toEqual(["MIGRADO", "MIGRADO"]);
          }
          expect(await numeros(a.tenant)).toEqual([1, 2]);
          expect(await numeros(b.tenant)).toEqual([1, 2]);
          for (const t of [a, b]) {
            expect(
              await cuenta(
                dueno,
                "select count(*)::int as n from auditoria_plataforma where accion = 'PLAN_MIGRADO_POR_LOTE' and despues ->> 'tenantId' = $1",
                [t.tenant],
              ),
            ).toBe(1);
          }
        } finally {
          await cerrar();
        }
      }
    });

    it("asignar una versión mientras se la publica: o se asigna publicada o se rechaza, nunca una asignación a un borrador", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["versionPorId", "borradorDe"] });
        try {
          const m = await crearMundoDeMarca(dueno);
          const plan = await crearPlan(dueno);
          const borrador = await crearBorradorDePlan(dueno, plan, { modulos: ["caja"] });
          const [asignada, publicada] = await Promise.all([
            asignar(casos, m.tenant, borrador, { numeroEsperado: null }),
            casos.publicarVersionDePlan(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              planId: plan,
              motivo: "primera",
            }),
          ]);
          expect(publicada.ok).toBe(true);
          if (asignada.ok) {
            expect(
              await cuenta(
                dueno,
                "select count(*)::int as n from plan_de_tenant p join version_de_plan v on v.id = p.version_de_plan_id where p.tenant_id = $1 and v.estado = 'PUBLICADA'",
                [m.tenant],
              ),
            ).toBe(1);
          } else {
            expect(asignada.error).toBe("VERSION_DE_PLAN_NO_PUBLICADA");
            expect(await numeros(m.tenant)).toEqual([]);
          }
        } finally {
          await cerrar();
        }
      }
    });
  });

  describe("ajustarPerilla", () => {
    it("dos ajustes de la misma perilla desde el mismo numeroEsperado: uno gana y el otro es VERSION_DESACTUALIZADA; números consecutivos", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["serieDeAjustes"] });
        try {
          const m = await crearMundoDeMarca(dueno);
          const rs = await Promise.all(
            [3, 4].map((limite) =>
              casos.ajustarPerilla(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                tenantId: m.tenant,
                empresaId: null,
                perilla: "empresas_por_tenant",
                valor: { tipo: "LIMITE", limite },
                vigenteDesde: desdeAhora(0),
                motivo: "extra",
                numeroEsperado: null,
                reemplazaProgramada: false,
              }),
            ),
          );
          expect(valores(rs)).toEqual([{ numero: 1 }]);
          expect(errores(rs)).toEqual(["VERSION_DESACTUALIZADA"]);
          expect(
            (
              await dueno.query<{ numero: number }>(
                "select numero from ajuste_de_perilla where tenant_id = $1 order by numero",
                [m.tenant],
              )
            ).rows.map((f) => f.numero),
          ).toEqual([1]);
        } finally {
          await cerrar();
        }
      }
    });
  });

  describe("módulos de empresa", () => {
    async function empresaConPlan(modulos: string[]) {
      const m = await crearMundoDeMarca(dueno);
      const plan = await crearPlanPublicado(dueno, { modulos });
      await asignarPlan(dueno, m.tenant, plan.version, { desdeSegundos: -30 });
      return { ...m, version: plan.version };
    }
    const activar = (casos: CasosDeUsoDeMarcasYPlanes, empresaId: string, modulo: string) =>
      casos.activarModuloDeEmpresa(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        empresaId,
        modulo,
      });
    const desactivar = (casos: CasosDeUsoDeMarcasYPlanes, empresaId: string, modulo: string) =>
      casos.desactivarModuloDeEmpresa(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        empresaId,
        modulo,
      });

    it("activar un módulo a la vez que un cambio de plan lo quita: o se activó con el plan viejo o se rechazó; nunca un estado mezclado", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, {
          planes: ["modulosDeLasEmpresas", "asignacionesDelTenant"],
        });
        try {
          const e = await empresaConPlan(["caja", "ventas"]);
          const sinVentas = await crearPlanPublicado(dueno, { modulos: ["caja"] });
          await activar(sinBarreraCasos(), e.empresa, "caja");
          const [activacion, cambio] = await Promise.all([
            activar(casos, e.empresa, "ventas"),
            casos.asignarPlan(comoAdminAhora(), {
              claveDeIdempotencia: clave(),
              tenantId: e.tenant,
              versionDePlanId: sinVentas.version,
              vigenteDesde: desdeAhora(0),
              motivo: "baja de plan",
              numeroEsperado: 1,
              reemplazaProgramada: false,
            }),
          ]);
          // El cambio de plan siempre sale bien (una baja no se rechaza).
          expect(cambio.ok).toBe(true);
          const filas = (
            await dueno.query<{ modulo: string; activo: boolean }>(
              "select modulo, activo from modulo_de_empresa where empresa_id = $1 order by modulo",
              [e.empresa],
            )
          ).rows;
          if (activacion.ok) {
            // Se activó con el plan viejo y se confirmó antes: queda activada (y en solo lectura por la baja).
            expect(filas).toEqual([
              { modulo: "caja", activo: true },
              { modulo: "ventas", activo: true },
            ]);
          } else {
            expect(activacion.error).toBe("MODULO_FUERA_DEL_PLAN");
            expect(filas).toEqual([{ modulo: "caja", activo: true }]);
          }
        } finally {
          await cerrar();
        }
      }
    });

    it("activar un módulo a la vez que se desactiva el que requiere: uno se rechaza, nunca queda activo sin su requerido", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["modulosDeLasEmpresas"] });
        try {
          const e = await empresaConPlan(["caja", "ventas"]);
          await activar(sinBarreraCasos(), e.empresa, "caja");
          const [activacion, desactivacion] = await Promise.all([
            activar(casos, e.empresa, "ventas"),
            desactivar(casos, e.empresa, "caja"),
          ]);
          const filas = (
            await dueno.query<{ modulo: string; activo: boolean }>(
              "select modulo, activo from modulo_de_empresa where empresa_id = $1 order by modulo",
              [e.empresa],
            )
          ).rows;
          const activos = filas.filter((f) => f.activo).map((f) => f.modulo);
          // La invariante: `ventas` activo exige `caja` activo.
          if (activos.includes("ventas")) expect(activos).toContain("caja");
          // Exactamente uno de los dos ganó.
          expect([activacion.ok, desactivacion.ok].sort()).toEqual([false, true]);
          if (activacion.ok)
            expect(desactivacion).toEqual({
              ok: false,
              error: { codigo: "ES_REQUERIDO_POR", modulo: "ventas" },
            });
          else
            expect(activacion).toEqual({
              ok: false,
              error: { codigo: "REQUIERE_INACTIVO", modulo: "caja" },
            });
        } finally {
          await cerrar();
        }
      }
    });

    it("dos activar del mismo módulo a la vez: queda activado una vez, con una constancia; el otro es «ya estaba» o repite", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { cerrar, casos } = conBarrera(2, { planes: ["modulosDeLasEmpresas"] });
        try {
          const e = await empresaConPlan(["caja"]);
          const rs = await Promise.all([
            activar(casos, e.empresa, "caja"),
            activar(casos, e.empresa, "caja"),
          ]);
          const vistos = valores(rs);
          expect(vistos).toHaveLength(2);
          expect(vistos.map((v) => v.yaEstabaActivo).sort()).toEqual([false, true]);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from modulo_de_empresa where empresa_id = $1",
              [e.empresa],
            ),
          ).toBe(1);
          expect(
            await cuenta(
              dueno,
              "select count(*)::int as n from auditoria_plataforma where accion = 'MODULO_ACTIVADO' and despues ->> 'empresaId' = $1",
              [e.empresa],
            ),
          ).toBe(1);
        } finally {
          await cerrar();
        }
      }
    });
  });

  /** Casos sin barrera para preparar el escenario con los mismos casos de uso; el entorno se cierra con el de la prueba. */
  const abiertos: Array<{ cerrar: () => Promise<void> }> = [];
  function sinBarreraCasos(): CasosDeUsoDeMarcasYPlanes {
    const { entorno, casos } = sinBarrera();
    abiertos.push(entorno);
    return casos;
  }
  afterAll(async () => {
    await Promise.all(abiertos.map((e) => e.cerrar()));
  });
});
