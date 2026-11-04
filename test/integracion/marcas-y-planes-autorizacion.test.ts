import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { personaId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import {
  asignarPlan,
  crearBorradorDeMarca,
  crearBorradorDePlan,
  crearMarca,
  crearMundoDeMarca,
  crearPlan,
  crearPlanPublicado,
  marcaPrincipal,
} from "./marcas-apoyo";
import { adminInexistente, crearAdminDeBase } from "./plataforma-apoyo";
import {
  clave,
  comoAdminAhora,
  comoAdministradorAhora,
  comoElSistemaAhora,
  comoSoporteAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  desdeAhora,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * La autorización de TODOS los casos de uso de plataforma sobre marcas, planes, ajustes y módulos de empresa,
 * y su atomicidad (M5), contra Postgres real:
 *  - cada caso rechaza a quien no es administrador de plataforma (SOPORTE, un administrador dado de baja o
 *    inexistente, el sistema) con `SIN_PERMISO` sin dejar nada, y el contexto de una empresa lanza antes de
 *    abrir ninguna transacción;
 *  - una falla en cualquier paso (la escritura, la constancia de plataforma, la de empresa, la clave) no
 *    deja nada, y repetir el pedido después sale bien (no quedó una clave consumida).
 * Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("marcas y planes de plataforma: autorización y atomicidad", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let casos: CasosDeUsoDeMarcasYPlanes;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    casos = crearCasosDeMarcasYPlanes(entorno);
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Un mundo con todo lo que los casos necesitan para tener éxito (y nada más). */
  async function mundo() {
    const m = await crearMundoDeMarca(dueno);
    const otraEmpresa = await crearMundoDeMarca(dueno, { tenant: m.tenant });
    const plan = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas"] });
    const otraVersion = await crearPlanPublicado(dueno, { modulos: ["caja"] });
    const sinVersion = await crearPlan(dueno);
    const conBorradorDePlan = await crearPlan(dueno);
    await crearBorradorDePlan(dueno, conBorradorDePlan, { modulos: ["caja"] });
    const marca = await crearMarca(dueno);
    const marcaConBorrador = await crearMarca(dueno);
    await crearBorradorDeMarca(dueno, marcaConBorrador, {
      nombreVisible: "Marca",
      tema: {
        primary: "#1d4ed8",
        "on-primary": "#ffffff",
        secondary: "#475569",
        accent: "#0f766e",
      },
      logo: "/marcas/mc/logo.png",
      modulosIniciales: ["caja"],
      planPorDefecto: plan.plan,
    });
    const conAsignacion = await crearMundoDeMarca(dueno);
    await asignarPlan(dueno, conAsignacion.tenant, plan.version);
    return {
      tenant: m.tenant,
      empresa: m.empresa,
      otraEmpresa: otraEmpresa.empresa,
      versionDePlan: plan.version,
      otraVersion: otraVersion.version,
      sinVersion,
      conBorradorDePlan,
      marca,
      marcaConBorrador,
      tenantConAsignacion: conAsignacion.tenant,
      empresaConAsignacion: conAsignacion.empresa,
    };
  }
  type Mundo = Awaited<ReturnType<typeof mundo>>;

  type Llamada = (
    c: CasosDeUsoDeMarcasYPlanes,
    contexto: ContextoDePlataforma,
  ) => Promise<Resultado<unknown, unknown>>;
  /** Cada caso, con una entrada que sale bien en `mundo()`: quien llama puede cambiar la clave de idempotencia. */
  const LLAMADAS = (m: Mundo, claveFija?: string): Array<[string, Llamada]> => [
    [
      "crearMarca",
      (c, x) =>
        c.crearMarca(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          codigo: `m-${clave().slice(6, 14)}`,
          marcaPadreId: principal,
        }),
    ],
    [
      "guardarBorradorDeMarca",
      (c, x) =>
        c.guardarBorradorDeMarca(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          marcaId: m.marca,
          versionEsperada: null,
          nombreVisible: "Nueva",
        }),
    ],
    [
      "confirmarVersionDeMarca",
      (c, x) =>
        c.confirmarVersionDeMarca(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          marcaId: m.marcaConBorrador,
          versionEsperada: 1,
          vigenteDesde: desdeAhora(0),
          motivo: "alta",
          reemplazaProgramada: false,
        }),
    ],
    [
      "crearPlan",
      (c, x) =>
        c.crearPlan(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          codigo: `p-${clave().slice(6, 14)}`,
        }),
    ],
    [
      "guardarBorradorDePlan",
      (c, x) =>
        c.guardarBorradorDePlan(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          planId: m.sinVersion,
          versionEsperada: null,
          nombreComercial: "Plan",
          modulos: ["caja"],
          perillas: {},
        }),
    ],
    [
      "publicarVersionDePlan",
      (c, x) =>
        c.publicarVersionDePlan(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          planId: m.conBorradorDePlan,
          motivo: "alta",
        }),
    ],
    [
      "asignarPlan",
      (c, x) =>
        c.asignarPlan(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          tenantId: m.tenant,
          versionDePlanId: m.versionDePlan,
          vigenteDesde: desdeAhora(0),
          motivo: "alta",
          numeroEsperado: null,
          reemplazaProgramada: false,
        }),
    ],
    [
      "migrarTenantsDeVersion",
      (c, x) =>
        c.migrarTenantsDeVersion(x, {
          claveDeLote: (claveFija ?? clave()).slice(6),
          versionDePlanId: m.otraVersion,
          vigenteDesde: desdeAhora(0),
          motivo: "migración",
          tenants: [{ tenantId: m.tenantConAsignacion, numeroEsperado: 1 }],
          reemplazaProgramada: false,
        }),
    ],
    [
      "ajustarPerilla",
      (c, x) =>
        c.ajustarPerilla(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          tenantId: m.tenant,
          empresaId: null,
          perilla: "empresas_por_tenant",
          valor: { tipo: "LIMITE", limite: 3 },
          vigenteDesde: desdeAhora(0),
          motivo: "extra",
          numeroEsperado: null,
          reemplazaProgramada: false,
        }),
    ],
    [
      "activarModuloDeEmpresa",
      (c, x) =>
        c.activarModuloDeEmpresa(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          empresaId: m.empresaConAsignacion,
          modulo: "caja",
        }),
    ],
    [
      "desactivarModuloDeEmpresa",
      (c, x) =>
        c.desactivarModuloDeEmpresa(x, {
          claveDeIdempotencia: claveFija ?? clave(),
          empresaId: m.empresaConAsignacion,
          modulo: "caja",
        }),
    ],
  ];

  describe("autorización", () => {
    it("los once casos salen bien con el ADMIN (control: el escenario es el correcto)", async () => {
      const m = await mundo();
      for (const [nombre, llamar] of LLAMADAS(m)) {
        const r = await llamar(casos, comoAdminAhora());
        expect(r.ok, `${nombre}: ${JSON.stringify(r)}`).toBe(true);
      }
    });

    it("SOPORTE, un administrador de baja, uno inexistente y el sistema reciben SIN_PERMISO en cada caso y no dejan nada", async () => {
      const m = await mundo();
      const deBaja = await crearAdminDeBase(dueno, { rol: "ADMIN", activo: false });
      const actores: Array<[string, ContextoDePlataforma]> = [
        ["SOPORTE", comoSoporteAhora()],
        ["ADMIN de baja", comoAdministradorAhora(deBaja.id)],
        ["administrador inexistente", comoAdministradorAhora(adminInexistente())],
        ["sistema", comoElSistemaAhora()],
      ];
      for (const [actor, contexto] of actores) {
        for (const [caso, llamar] of LLAMADAS(m)) {
          const antes = await huellaDeEscrituras(dueno);
          expect(falla(await llamar(casos, contexto)), `${actor} ${caso}`).toBe("SIN_PERMISO");
          expect(await huellaDeEscrituras(dueno), `${actor} ${caso}`).toEqual(antes);
        }
      }
    });

    it("el guard gana sobre una entrada mal formada: quien no puede, no se entera de si el pedido estaba bien armado", async () => {
      const antes = await huellaDeEscrituras(dueno);
      const malos = [
        casos.crearMarca(comoSoporteAhora(), {
          claveDeIdempotencia: "x",
          codigo: "!",
          marcaPadreId: "x",
        }),
        casos.crearPlan(comoSoporteAhora(), { claveDeIdempotencia: "x", codigo: "!" }),
        casos.migrarTenantsDeVersion(comoSoporteAhora(), {
          claveDeLote: "_",
          versionDePlanId: "x",
          vigenteDesde: new Date("x"),
          motivo: "",
          tenants: [],
          reemplazaProgramada: false,
        }),
        casos.ajustarPerilla(comoSoporteAhora(), {
          claveDeIdempotencia: "x",
          tenantId: "x",
          empresaId: null,
          perilla: "x",
          valor: 1,
          vigenteDesde: new Date("x"),
          motivo: "",
          numeroEsperado: 0,
          reemplazaProgramada: false,
        }),
      ];
      for (const r of await Promise.all(malos)) {
        expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
      }
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("dar de baja a un administrador, o bajarlo a SOPORTE, corta su acceso en la operación siguiente (nada en caché)", async () => {
      const m = await mundo();
      const temporal = await crearAdminDeBase(dueno, { rol: "ADMIN" });
      const contexto = comoAdministradorAhora(temporal.id);
      const [, crear] = LLAMADAS(m)[3] as [string, Llamada];
      expect((await crear(casos, contexto)).ok).toBe(true);
      await dueno.query("update admin_plataforma set rol = 'SOPORTE' where id = $1", [temporal.id]);
      expect(falla(await crear(casos, contexto))).toBe("SIN_PERMISO");
      await dueno.query("update admin_plataforma set rol = 'ADMIN', activo = false where id = $1", [
        temporal.id,
      ]);
      expect(falla(await crear(casos, contexto))).toBe("SIN_PERMISO");
    });

    it("un actor de empresa nunca llega: el contexto de empresa lanza antes de abrir ninguna transacción y no deja nada", async () => {
      const m = await mundo();
      const mundoDeEmpresa = await crearMundoDeMarca(dueno);
      // Solo se llega acá saltándose el tipo (una llamada sin tipar): por eso el cast.
      const empresa = comoEmpresa(
        mundoDeEmpresa.empresa as never,
        personaId(mundoDeEmpresa.persona),
      ) as unknown as ContextoDePlataforma;
      for (const [caso, llamar] of LLAMADAS(m)) {
        const antes = await huellaDeEscrituras(dueno);
        await expect(llamar(casos, empresa), caso).rejects.toThrow(/no es de plataforma/);
        expect(await huellaDeEscrituras(dueno), caso).toEqual(antes);
      }
    });
  });

  describe("atomicidad: una falla en cualquier paso no deja nada", () => {
    type Paso = "escritura" | "auditoriaDePlataforma" | "auditoriaDeEmpresa" | "idempotencia";

    /** Envuelve los métodos de `repo` que están en `metodos` para que lancen justo DESPUÉS de hacer su escritura. */
    function lanzarDespues<T extends object>(
      repo: T,
      metodos: readonly string[],
      activo: boolean,
      paso: Paso,
    ): T {
      if (!activo) return repo;
      const envuelto = { ...repo } as Record<string, unknown>;
      for (const metodo of metodos) {
        const original = (repo as Record<string, (...a: unknown[]) => Promise<unknown>>)[metodo];
        envuelto[metodo] = async (...a: unknown[]) => {
          await original?.call(repo, ...a);
          throw new Error(`falla provocada después de ${paso}`);
        };
      }
      return envuelto as T;
    }

    /** Un entorno cuya transacción lanza justo DESPUÉS de ese paso (el cambio ya se hizo dentro de ella). */
    function conFallaDespuesDe(paso: Paso) {
      const propio = crearEntornoDeMarcasYPlanes(propia.base, 2, (tx) => ({
        ...tx,
        marcas: lanzarDespues(
          tx.marcas,
          ["crear", "crearBorrador", "actualizarBorrador", "confirmar"],
          paso === "escritura",
          paso,
        ),
        planes: lanzarDespues(
          tx.planes,
          [
            "crearPlan",
            "crearBorrador",
            "actualizarBorrador",
            "publicar",
            "asignar",
            "ajustar",
            "activarModulo",
            "desactivarModulo",
          ],
          paso === "escritura",
          paso,
        ),
        auditoriaDeEmpresa: lanzarDespues(
          tx.auditoriaDeEmpresa,
          ["registrar"],
          paso === "auditoriaDeEmpresa",
          paso,
        ),
        auditoriaDePlataforma: lanzarDespues(
          tx.auditoriaDePlataforma,
          ["registrar"],
          paso === "auditoriaDePlataforma",
          paso,
        ),
        idempotencia: lanzarDespues(tx.idempotencia, ["registrar"], paso === "idempotencia", paso),
      }));
      return { propio, casosConFalla: crearCasosDeMarcasYPlanes(propio) };
    }

    // Qué pasos tiene cada caso: todos escriben, auditan en plataforma y registran la clave; los que tocan
    // empresas auditan además en cada una. `desactivar` escribe solo si hay algo activado: se prepara.
    const PASOS_DE_TODOS: Paso[] = ["escritura", "auditoriaDePlataforma", "idempotencia"];
    const CON_EMPRESAS = new Set([
      "asignarPlan",
      "migrarTenantsDeVersion",
      "ajustarPerilla",
      "activarModuloDeEmpresa",
      "desactivarModuloDeEmpresa",
    ]);

    for (const caso of [
      "crearMarca",
      "guardarBorradorDeMarca",
      "confirmarVersionDeMarca",
      "crearPlan",
      "guardarBorradorDePlan",
      "publicarVersionDePlan",
      "asignarPlan",
      "migrarTenantsDeVersion",
      "ajustarPerilla",
      "activarModuloDeEmpresa",
      "desactivarModuloDeEmpresa",
    ]) {
      const pasos: Paso[] = CON_EMPRESAS.has(caso)
        ? [...PASOS_DE_TODOS, "auditoriaDeEmpresa"]
        : PASOS_DE_TODOS;
      it.each(pasos)(
        `${caso}: una falla después de «%s» no deja nada, y repetir el pedido después sale bien`,
        async (paso) => {
          const m = await mundo();
          // `desactivar` necesita algo activado para que haya qué desactivar.
          if (caso === "desactivarModuloDeEmpresa") {
            exito(
              await casos.activarModuloDeEmpresa(comoAdminAhora(), {
                claveDeIdempotencia: clave(),
                empresaId: m.empresaConAsignacion,
                modulo: "caja",
              }),
            );
          }
          const claveDeIdempotencia = clave();
          const llamada = LLAMADAS(m, claveDeIdempotencia).find(
            ([nombre]) => nombre === caso,
          )?.[1] as Llamada;
          const { propio, casosConFalla } = conFallaDespuesDe(paso);
          try {
            const antes = await huellaDeEscrituras(dueno);
            await expect(llamada(casosConFalla, comoAdminAhora())).rejects.toThrow(
              /falla provocada/,
            );
            expect(await huellaDeEscrituras(dueno)).toEqual(antes);
            // Nada quedó a medias: el mismo pedido, con la misma clave, sale bien y escribe una sola vez.
            exito(await llamada(casos, comoAdminAhora()));
            expect(await huellaDeEscrituras(dueno)).not.toEqual(antes);
          } finally {
            await propio.cerrar();
          }
        },
      );
    }

    it("una falla inesperada a mitad de un lote deja migrados los tenants anteriores (cada uno en su transacción) y nada del que falló; repetir el lote termina el trabajo", async () => {
      const a = await crearMundoDeMarca(dueno);
      const b = await crearMundoDeMarca(dueno);
      const c = await crearMundoDeMarca(dueno);
      const v1 = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const v2 = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas"] });
      for (const t of [a, b, c]) await asignarPlan(dueno, t.tenant, v1.version);
      const lote = `lote-${clave().slice(6)}`;
      const vigenteDesde = desdeAhora(0);
      const entrada = {
        claveDeLote: lote,
        versionDePlanId: v2.version,
        vigenteDesde,
        motivo: "migración",
        tenants: [a, b, c].map((t) => ({ tenantId: t.tenant, numeroEsperado: 1 })),
        reemplazaProgramada: false,
      };
      // El segundo tenant en escribir lanza: el primero ya se había confirmado en su propia transacción.
      let escritas = 0;
      const propio = crearEntornoDeMarcasYPlanes(propia.base, 2, (tx) => ({
        ...tx,
        planes: {
          ...tx.planes,
          asignar: async (...args) => {
            const r = await tx.planes.asignar(...args);
            escritas += 1;
            if (escritas === 2) throw new Error("falla provocada en el segundo tenant");
            return r;
          },
        },
      }));
      try {
        await expect(
          crearCasosDeMarcasYPlanes(propio).migrarTenantsDeVersion(comoAdminAhora(), entrada),
        ).rejects.toThrow(/falla provocada/);
      } finally {
        await propio.cerrar();
      }
      const numeros = async (tenant: string) =>
        (
          await dueno.query<{ numero: number }>(
            "select numero from plan_de_tenant where tenant_id = $1 order by numero",
            [tenant],
          )
        ).rows.map((f) => f.numero);
      expect(await numeros(a.tenant)).toEqual([1, 2]);
      expect(await numeros(b.tenant)).toEqual([1]);
      expect(await numeros(c.tenant)).toEqual([1]);
      const r = exito(await casos.migrarTenantsDeVersion(comoAdminAhora(), entrada));
      expect(r.resultados.map((x) => [x.resultado, x.repetido])).toEqual([
        ["MIGRADO", true],
        ["MIGRADO", false],
        ["MIGRADO", false],
      ]);
      expect(await numeros(a.tenant)).toEqual([1, 2]);
      expect(await numeros(b.tenant)).toEqual([1, 2]);
      expect(await numeros(c.tenant)).toEqual([1, 2]);
    });
  });
});
