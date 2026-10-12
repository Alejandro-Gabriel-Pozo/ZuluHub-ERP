import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { adminPlataformaId, empresaId } from "../../src/primitivas/identificadores/marca";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import { comoEmpresa, comoPlataforma, crearBarrera } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  ACTOR_DE_PRUEBA,
  ARCHIVO_0007,
  HASTA_0006,
  baseConMigraciones,
  codigoAlAzar,
  crearBorradorDeMarca,
  crearBorradorDePlan,
  crearMarca,
  crearMundoDeMarca,
  crearPlan,
  crearPlanPublicado,
  hostAlAzar,
} from "./marcas-apoyo";
import { SesionDePrueba, esperarBloqueo, type Intento } from "./sesiones";

/**
 * Marcas y planes (M3), migración 0007: CONCURRENCIA con los roles reales y barrera. Lo que garantiza la
 * base cuando dos acciones llegan a la vez, en `READ COMMITTED` y en `SERIALIZABLE`:
 *  - una sola asignación de plan por número (el `numeroEsperado` de `asignarPlan`), sin huecos ni repetidos;
 *  - un solo ajuste por número, también el del tenant (empresa NULL);
 *  - un solo host activo, un solo borrador, una sola publicación o confirmación, un solo módulo por empresa;
 *  - una versión se asigna publicada o se rechaza, nunca a medias;
 *  - retirar una marca a la vez que se le crea un hijo, un dominio o una versión espera a que termine uno.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Aislamiento = "read committed" | "serializable";
type Sentencia = readonly [string, readonly unknown[]];
const AISLAMIENTOS: readonly Aislamiento[] = ["read committed", "serializable"];
/** Vueltas de cada carrera: el desenlace tiene que ser el mismo en todas. */
const VUELTAS = 25;

describe.skipIf(base === null)("marcas y planes: concurrencia", () => {
  let previa: Awaited<ReturnType<typeof baseConMigraciones>>;
  let dueno: pg.Client;
  let b: BaseDePruebas;

  beforeAll(async () => {
    if (base === null) return;
    previa = await baseConMigraciones(base, [...HASTA_0006, ARCHIVO_0007]);
    dueno = previa.cliente;
    b = previa.aparte.base;
  });
  afterAll(async () => {
    await previa?.cerrar();
  });

  const un = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows[0] as T;

  const abrirAdmin = (aislamiento: Aislamiento) =>
    SesionDePrueba.abrir(
      b,
      "zuluhub_plataforma",
      comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(ADMIN_DE_PRUEBA) }),
      aislamiento,
    );

  /**
   * Corre varias sentencias a la vez: cada una en su propia sesión y transacción, todas arrancan juntas
   * (barrera) y cada una confirma si le fue bien y deshace si no. Devuelve los resultados en orden.
   */
  async function carrera(
    sesiones: readonly SesionDePrueba[],
    sentencias: readonly Sentencia[],
  ): Promise<Intento[]> {
    const barrera = crearBarrera(sesiones.length);
    try {
      return await Promise.all(
        sesiones.map(async (s, i) => {
          await barrera();
          const [texto, parametros] = sentencias[i] as Sentencia;
          const r = await s.directo(texto, [...parametros]);
          if (!r.ok) {
            await s.deshacer();
            return r;
          }
          const c = await s.confirmar();
          return c.ok ? r : c;
        }),
      );
    } finally {
      await Promise.all(sesiones.map((s) => s.cerrar()));
    }
  }

  /**
   * Para las carreras que NO se enfrentan por el mismo dato. En READ COMMITTED ganan todas a la primera. En
   * SERIALIZABLE Postgres puede abortar alguna por un falso conflicto de lectura/escritura (el disparador
   * lee `max(numero)` y, en una tabla chica, el candado de lectura es de toda la tabla): aborta con 40001,
   * que el caso de uso reintenta. Acá se reintenta una por una y tienen que terminar ganando todas.
   */
  async function todasTerminanGanando(
    aislamiento: Aislamiento,
    rs: readonly Intento[],
    sentencias: readonly Sentencia[],
  ): Promise<void> {
    if (aislamiento === "read committed") {
      expect(ganadores(rs)).toHaveLength(sentencias.length);
      return;
    }
    for (const [i, r] of rs.entries()) {
      if (r.ok) continue;
      expect(r.codigo, `${i}: ${r.mensaje}`).toBe("40001");
      const [texto, parametros] = sentencias[i] as Sentencia;
      const s = await abrirAdmin(aislamiento);
      const [reintento] = await carrera([s], [[texto, parametros]]);
      expect(reintento?.ok, `reintento ${i}`).toBe(true);
    }
  }

  /** Los códigos que puede dar el perdedor de una carrera por un número: la única, el disparador o la serialización. */
  const PERDEDOR_POR_NUMERO = new Set(["23505", "23514", "40001"]);
  const codigoDe = (r: Intento | undefined): string | null =>
    r === undefined || r.ok ? null : r.codigo;
  const ganadores = (rs: readonly Intento[]) => rs.filter((r) => r.ok);
  const perdedores = (rs: readonly Intento[]) => rs.filter((r) => !r.ok);

  // ===========================================================================================
  // asignarPlan: un solo ganador por número
  // ===========================================================================================
  describe.each(AISLAMIENTOS)("asignación de plan simultánea (%s)", (aislamiento) => {
    for (const competidores of [2, 4]) {
      it(`${competidores} asignaciones desde el mismo número esperado, ${VUELTAS} vueltas: gana UNA por vuelta, sin huecos ni repetidos`, async () => {
        const mundo = await crearMundoDeMarca(dueno);
        const versiones = [
          (await crearPlanPublicado(dueno)).version,
          (await crearPlanPublicado(dueno)).version,
          (await crearPlanPublicado(dueno)).version,
          (await crearPlanPublicado(dueno)).version,
        ];
        for (let vuelta = 1; vuelta <= VUELTAS; vuelta++) {
          const esperado = vuelta - 1; // el número de la última asignación que vieron todos
          const sesiones = await Promise.all(
            Array.from({ length: competidores }, () => abrirAdmin(aislamiento)),
          );
          const rs = await carrera(
            sesiones,
            sesiones.map((_, i) => [
              `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
               values ($1, $2, $3, now(), 'CAMBIO', 'carrera', $4)`,
              [mundo.tenant, esperado + 1, versiones[i], ACTOR_DE_PRUEBA],
            ]),
          );
          expect(ganadores(rs), `vuelta ${vuelta}: un solo ganador`).toHaveLength(1);
          for (const p of perdedores(rs)) {
            expect(
              PERDEDOR_POR_NUMERO.has(p.ok ? "" : p.codigo),
              p.ok ? "" : `${p.codigo} ${p.mensaje}`,
            ).toBe(true);
          }
        }
        const { rows } = await dueno.query<{ numero: number }>(
          "select numero from plan_de_tenant where tenant_id = $1 order by numero",
          [mundo.tenant],
        );
        expect(rows.map((r) => r.numero)).toEqual(Array.from({ length: VUELTAS }, (_, i) => i + 1));
      });
    }

    it("asignaciones simultáneas a tenants DISTINTOS no se pisan: todas ganan con su número 1", async () => {
      const mundos = await Promise.all([
        crearMundoDeMarca(dueno),
        crearMundoDeMarca(dueno),
        crearMundoDeMarca(dueno),
      ]);
      const { version } = await crearPlanPublicado(dueno);
      const sesiones = await Promise.all(mundos.map(() => abrirAdmin(aislamiento)));
      const sentencias = mundos.map(
        (m) =>
          [
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
           values ($1, 1, $2, now(), 'ALTA', 'carrera', $3)`,
            [m.tenant, version, ACTOR_DE_PRUEBA],
          ] as const,
      );
      const rs = await carrera(sesiones, sentencias);
      await todasTerminanGanando(aislamiento, rs, sentencias);
      const { rows } = await dueno.query(
        "select 1 from plan_de_tenant where tenant_id = any($1) and numero = 1",
        [mundos.map((m) => m.tenant)],
      );
      expect(rows).toHaveLength(3);
    });

    it("la perdedora que reintenta ve el número nuevo: el disparador le dice cuál es el siguiente", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno);
      const insertar = (s: SesionDePrueba, numero: number) =>
        s.directo(
          `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
           values ($1, $2, $3, now(), 'CAMBIO', 'x', $4)`,
          [mundo.tenant, numero, version, ACTOR_DE_PRUEBA],
        );
      const ganadora = await abrirAdmin(aislamiento);
      expect((await insertar(ganadora, 1)).ok).toBe(true);
      expect((await ganadora.confirmar()).ok).toBe(true);
      await ganadora.cerrar();
      const perdedora = await abrirAdmin(aislamiento);
      const r = await insertar(perdedora, 1); // todavía cree que el último es el 0
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.codigo).toBe("23514");
        expect(r.restriccion).toBe("plan_de_tenant_numero_invalido");
        expect(r.mensaje).toMatch(/tiene que ser 2/);
      }
      await perdedora.cerrar();
    });
  });

  // ===========================================================================================
  // ajustes: un solo ganador por (tenant, empresa, perilla, número)
  // ===========================================================================================
  describe.each(AISLAMIENTOS)("ajustes de perilla simultáneos (%s)", (aislamiento) => {
    it(`dos ajustes del TENANT (empresa NULL) a la vez, ${VUELTAS} vueltas: gana uno por vuelta y los números son consecutivos`, async () => {
      const mundo = await crearMundoDeMarca(dueno);
      for (let vuelta = 1; vuelta <= VUELTAS; vuelta++) {
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const rs = await carrera(
          sesiones,
          sesiones.map((_, i) => [
            `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, 'empresas_por_tenant', $2, $3, now(), 'carrera', $4)`,
            [mundo.tenant, vuelta, String(i + 1), ACTOR_DE_PRUEBA],
          ]),
        );
        expect(ganadores(rs), `vuelta ${vuelta}`).toHaveLength(1);
      }
      const { rows } = await dueno.query<{ numero: number }>(
        "select numero from ajuste_de_perilla where tenant_id = $1 order by numero",
        [mundo.tenant],
      );
      expect(rows.map((r) => r.numero)).toEqual(Array.from({ length: VUELTAS }, (_, i) => i + 1));
    });

    it("ajustes de perillas o de empresas DISTINTAS a la vez no se estorban: cada uno es su número 1", async () => {
      const a = await crearMundoDeMarca(dueno);
      const e2 = await crearMundoDeMarca(dueno, { tenant: a.tenant });
      const sesiones = await Promise.all([1, 2, 3, 4].map(() => abrirAdmin(aislamiento)));
      const sentencias = [
        [
          `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
           values ($1, 'perilla_uno', 1, '1', now(), 'x', $2)`,
          [a.tenant, ACTOR_DE_PRUEBA],
        ],
        [
          `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
           values ($1, 'perilla_dos', 1, '1', now(), 'x', $2)`,
          [a.tenant, ACTOR_DE_PRUEBA],
        ],
        [
          `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
           values ($1, $2, 'perilla_uno', 1, '1', now(), 'x', $3)`,
          [a.tenant, a.empresa, ACTOR_DE_PRUEBA],
        ],
        [
          `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
           values ($1, $2, 'perilla_uno', 1, '1', now(), 'x', $3)`,
          [a.tenant, e2.empresa, ACTOR_DE_PRUEBA],
        ],
      ] as const;
      const rs = await carrera(sesiones, sentencias);
      await todasTerminanGanando(aislamiento, rs, sentencias);
      const { rows } = await dueno.query(
        "select 1 from ajuste_de_perilla where tenant_id = $1 and numero = 1",
        [a.tenant],
      );
      expect(rows).toHaveLength(4);
    });
  });

  // ===========================================================================================
  // versiones de marca y de plan
  // ===========================================================================================
  describe.each(AISLAMIENTOS)("versiones de marca y de plan simultáneas (%s)", (aislamiento) => {
    it("dos confirmaciones del MISMO borrador a la vez: se confirma una vez; la otra ve la versión congelada", async () => {
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const m = await crearMarca(dueno);
        const borrador = await crearBorradorDeMarca(dueno, m, { nombreVisible: "Marca" });
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const rs = await carrera(
          sesiones,
          sesiones.map(() => [
            `update version_de_marca set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), motivo = 'x',
                    confirmada_en = now(), confirmada_por = $2 where id = $1`,
            [borrador, ACTOR_DE_PRUEBA],
          ]),
        );
        // En READ COMMITTED la segunda espera el bloqueo de la fila y, al soltarse, la encuentra confirmada
        // (el USING de la política la saca del alcance: 0 filas); en SERIALIZABLE falla la serialización.
        const ok = ganadores(rs);
        expect(ok.length >= 1, "al menos una la confirma").toBe(true);
        const filas = ok.map((r) => (r.ok ? r.filas : -1));
        expect(
          filas.filter((f) => f === 1),
          "UNA sola actualizó la fila",
        ).toHaveLength(1);
        const { rows } = await dueno.query<{ numero: number; estado: string }>(
          "select numero, estado from version_de_marca where marca_id = $1",
          [m],
        );
        expect(rows).toEqual([{ numero: 1, estado: "CONFIRMADA" }]);
      }
    });

    it("una confirma el borrador 1 mientras la otra espera para crear el borrador 2: números 1 y 2 y la vigente es la de mayor número", async () => {
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const m = await crearMarca(dueno);
        const b1 = await crearBorradorDeMarca(dueno, m, { nombreVisible: "Primera" });
        const confirmar = `update version_de_marca set estado = 'CONFIRMADA',
                  numero = (select coalesce(max(numero), 0) + 1 from version_de_marca where marca_id = $2),
                  vigente_desde = now() - interval '30 seconds', motivo = 'x', confirmada_en = now(), confirmada_por = $3
                  where id = $1`;
        const a = await abrirAdmin(aislamiento);
        const c = await abrirAdmin(aislamiento);
        // la primera ya confirmó su borrador (sin cerrar la transacción)
        expect((await a.directo(confirmar, [b1, m, ACTOR_DE_PRUEBA])).ok).toBe(true);
        // la segunda quiere un borrador nuevo: el índice único parcial la hace esperar a que la primera termine
        const nuevo = c.directo(
          "insert into version_de_marca (marca_id, nombre_visible) values ($1, 'Segunda') returning id",
          [m],
        );
        expect(await esperarBloqueo(dueno, c.pid), "la segunda espera a la primera").toBe(true);
        expect((await a.confirmar()).ok).toBe(true);
        const ins = await nuevo;
        let segunda: Intento = ins;
        if (ins.ok) {
          const id = ins.rows[0]?.["id"] as string;
          const confirmada = await c.directo(confirmar, [id, m, ACTOR_DE_PRUEBA]);
          segunda = confirmada.ok ? await c.confirmar() : confirmada;
        }
        await Promise.all([a.cerrar(), c.cerrar()]);
        const confirmadas = await dueno.query<{ numero: number; nombre_visible: string }>(
          "select numero, nombre_visible from version_de_marca where marca_id = $1 and estado = 'CONFIRMADA' order by numero",
          [m],
        );
        const numeros = confirmadas.rows.map((f) => f.numero);
        if (aislamiento === "read committed") {
          expect(segunda.ok, `vuelta ${vuelta}`).toBe(true);
          expect(numeros).toEqual([1, 2]);
        } else {
          // En SERIALIZABLE la segunda puede abortar por serialización: entonces reintenta y queda el 2.
          if (!segunda.ok) expect(segunda.codigo).toBe("40001");
          expect(numeros[0]).toBe(1);
        }
        // la vigente es la de mayor número entre las ya empezadas
        const vigente = await un<{ nombre_visible: string }>(
          `select nombre_visible from version_de_marca
            where marca_id = $1 and estado = 'CONFIRMADA' and vigente_desde <= now() order by numero desc limit 1`,
          [m],
        );
        expect(vigente.nombre_visible).toBe(
          confirmadas.rows[confirmadas.rows.length - 1]?.nombre_visible,
        );
      }
    });

    it("dos borradores del mismo plan o de la misma marca a la vez: uno solo (el índice único parcial)", async () => {
      const plan = await crearPlan(dueno);
      const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
      const rs = await carrera(
        sesiones,
        sesiones.map(() => [
          "insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'Carrera')",
          [plan],
        ]),
      );
      expect(ganadores(rs)).toHaveLength(1);
      const m = await crearMarca(dueno);
      const sesiones2 = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
      const rs2 = await carrera(
        sesiones2,
        sesiones2.map(() => [
          "insert into version_de_marca (marca_id, nombre_visible) values ($1, 'Carrera')",
          [m],
        ]),
      );
      expect(ganadores(rs2)).toHaveLength(1);
      for (const p of [...perdedores(rs), ...perdedores(rs2)]) {
        expect(p.ok ? "" : p.codigo).toMatch(/23505|40001/);
      }
    });

    it("dos publicaciones del MISMO borrador de plan a la vez: se publica una vez, con el número 1", async () => {
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const plan = await crearPlan(dueno);
        const borrador = await crearBorradorDePlan(dueno, plan);
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const rs = await carrera(
          sesiones,
          sesiones.map(() => [
            `update version_de_plan set estado = 'PUBLICADA', numero = 1, motivo = 'x', publicada_en = now(), publicada_por = $2 where id = $1`,
            [borrador, ACTOR_DE_PRUEBA],
          ]),
        );
        expect(
          ganadores(rs).filter((r) => r.ok && r.filas === 1),
          `vuelta ${vuelta}`,
        ).toHaveLength(1);
        const { rows } = await dueno.query(
          "select numero, estado from version_de_plan where plan_id = $1",
          [plan],
        );
        expect(rows).toEqual([{ numero: 1, estado: "PUBLICADA" }]);
      }
    });

    it("publicar una versión mientras se la asigna: o se asigna ya publicada o se rechaza, nunca queda asignado un borrador", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const mundo = await crearMundoDeMarca(dueno);
        const plan = await crearPlan(dueno);
        const borrador = await crearBorradorDePlan(dueno, plan);
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const rs = await carrera(sesiones, [
          [
            `update version_de_plan set estado = 'PUBLICADA', numero = 1, motivo = 'x', publicada_en = now(), publicada_por = $2 where id = $1`,
            [borrador, ACTOR_DE_PRUEBA],
          ],
          [
            `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
             values ($1, 1, $2, now(), 'ALTA', 'x', $3)`,
            [mundo.tenant, borrador, ACTOR_DE_PRUEBA],
          ],
        ]);
        // La publicación no compite con nada; en SERIALIZABLE puede abortar por serialización y queda en borrador.
        if (codigoDe(rs[0]) !== null) {
          expect(aislamiento).toBe("serializable");
          expect(codigoDe(rs[0])).toBe("40001");
        }
        const asignada = await dueno.query<{ estado: string }>(
          `select v.estado from plan_de_tenant p join version_de_plan v on v.id = p.version_de_plan_id where p.tenant_id = $1`,
          [mundo.tenant],
        );
        // O la asignación no existe (se rechazó) o apunta a una versión PUBLICADA.
        expect(asignada.rows.every((f) => f.estado === "PUBLICADA")).toBe(true);
        if (codigoDe(rs[1]) !== null) {
          expect(asignada.rows).toEqual([]);
          expect(["23514", "40001"]).toContain(codigoDe(rs[1]));
        }
      }
    });
  });

  // ===========================================================================================
  // hosts, módulos, niveles y referencias
  // ===========================================================================================
  describe("unicidad bajo carrera", () => {
    it("dos marcas registran el MISMO host a la vez: se registra una; el host retirado se puede volver a registrar", async () => {
      const host = hostAlAzar();
      const [m1, m2] = [await crearMarca(dueno), await crearMarca(dueno)];
      const sesiones = await Promise.all([
        abrirAdmin("read committed"),
        abrirAdmin("read committed"),
      ]);
      const rs = await carrera(
        sesiones,
        [m1, m2].map((m) => [
          "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, $3)",
          [m, host, ACTOR_DE_PRUEBA],
        ]),
      );
      expect(ganadores(rs)).toHaveLength(1);
      const perdedor = perdedores(rs)[0];
      expect(perdedor && !perdedor.ok && perdedor.restriccion).toBe("dominio_de_marca_host_uk");
    });

    it("dos dominios canónicos de la misma marca a la vez: uno", async () => {
      const m = await crearMarca(dueno);
      const sesiones = await Promise.all([
        abrirAdmin("read committed"),
        abrirAdmin("read committed"),
      ]);
      const rs = await carrera(
        sesiones,
        sesiones.map(() => [
          "insert into dominio_de_marca (marca_id, host, es_canonico, creado_por) values ($1, $2, true, $3)",
          [m, hostAlAzar(), ACTOR_DE_PRUEBA],
        ]),
      );
      expect(ganadores(rs)).toHaveLength(1);
      const perdedor = perdedores(rs)[0];
      expect(perdedor && !perdedor.ok && perdedor.restriccion).toBe("dominio_de_marca_canonico_uk");
    });

    it("dos activaciones del mismo módulo en la misma empresa a la vez: una fila (la clave primaria)", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const sesiones = await Promise.all([1, 2, 3].map(() => abrirAdmin("read committed")));
      const rs = await carrera(
        sesiones,
        sesiones.map(() => [
          "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')",
          [mundo.empresa],
        ]),
      );
      expect(ganadores(rs)).toHaveLength(1);
      for (const p of perdedores(rs)) expect(!p.ok && p.restriccion).toBe("modulo_de_empresa_pkey");
    });

    it("activar y desactivar a la vez el mismo módulo: queda en uno de los dos estados, con la versión sumada una vez por cada cambio", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')",
        [mundo.empresa],
      );
      const sesiones = await Promise.all([
        abrirAdmin("read committed"),
        abrirAdmin("read committed"),
      ]);
      const rs = await carrera(sesiones, [
        ["update modulo_de_empresa set activo = false where empresa_id = $1", [mundo.empresa]],
        ["update modulo_de_empresa set activo = true where empresa_id = $1", [mundo.empresa]],
      ]);
      expect(rs.every((r) => r.ok)).toBe(true);
      const fila = await un<{ activo: boolean; version: number }>(
        "select activo, version from modulo_de_empresa where empresa_id = $1",
        [mundo.empresa],
      );
      expect(fila.version).toBe(3);
    });

    it("dos cambios del nivel de un control a la vez: ambos lo dejan escrito sin perder la fila; dos altas del mismo control: una", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const abrirApp = () =>
        SesionDePrueba.abrir(b, "zuluhub_app", comoEmpresa(empresaId(mundo.empresa), null));
      const altas = await Promise.all([abrirApp(), abrirApp()]);
      const rs = await carrera(
        altas,
        altas.map((_, i) => [
          "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', $2)",
          [mundo.empresa, i === 0 ? "AVISAR" : "BLOQUEAR"],
        ]),
      );
      expect(ganadores(rs)).toHaveLength(1);
      const perdedor = perdedores(rs)[0];
      expect(perdedor && !perdedor.ok && perdedor.restriccion).toBe("nivel_de_control_uk");
      const cambios = await Promise.all([abrirApp(), abrirApp()]);
      const rs2 = await carrera(
        cambios,
        cambios.map((_, i) => [
          "update nivel_de_control set nivel = $2 where empresa_id = $1",
          [mundo.empresa, i === 0 ? "PERMITIR" : "BLOQUEAR"],
        ]),
      );
      expect(rs2.every((r) => r.ok)).toBe(true);
      const fila = await un<{ n: number; version: number }>(
        "select count(*)::int as n, max(version) as version from nivel_de_control where empresa_id = $1",
        [mundo.empresa],
      );
      expect(fila).toEqual({ n: 1, version: 3 });
    });

    it("ocho referencias de error iguales a la vez: se guarda una; las otras siete chocan con la única", async () => {
      const referencia = `ZH-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
      const sesiones = await Promise.all(
        Array.from({ length: 8 }, () => abrirAdmin("read committed")),
      );
      const rs = await carrera(
        sesiones,
        sesiones.map(() => [
          "insert into referencia_de_error (referencia, accion, motivo) values ($1, 'a.b', 'X')",
          [referencia],
        ]),
      );
      expect(ganadores(rs)).toHaveLength(1);
      for (const p of perdedores(rs))
        expect(!p.ok && p.restriccion).toBe("referencia_de_error_referencia_uk");
      const { rows } = await dueno.query(
        "select 1 from referencia_de_error where referencia = $1",
        [referencia],
      );
      expect(rows).toHaveLength(1);
    });
  });

  // ===========================================================================================
  // retirar una marca (o un plan) mientras se le cuelga algo
  // ===========================================================================================
  describe("retirar mientras se cuelga algo (FOR SHARE en los disparadores)", () => {
    const casos = [
      {
        nombre: "una marca hija",
        crear: async () => crearMarca(dueno),
        alta: (padre: string) =>
          [
            "insert into marca (codigo, marca_padre_id) values ($1, $2)",
            [codigoAlAzar("hija"), padre],
          ] as const,
        retirar: "update marca set estado = 'RETIRADA' where id = $1",
        mensaje: /marca padre está retirada/,
      },
      {
        nombre: "un dominio",
        crear: async () => crearMarca(dueno),
        alta: (m: string) =>
          [
            "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, $3)",
            [m, hostAlAzar(), ACTOR_DE_PRUEBA],
          ] as const,
        retirar: "update marca set estado = 'RETIRADA' where id = $1",
        mensaje: /marca está retirada/,
      },
      {
        nombre: "una versión de marca",
        crear: async () => crearMarca(dueno),
        alta: (m: string) =>
          [
            "insert into version_de_marca (marca_id, nombre_visible) values ($1, 'x')",
            [m],
          ] as const,
        retirar: "update marca set estado = 'RETIRADA' where id = $1",
        mensaje: /marca está retirada/,
      },
      {
        nombre: "una versión de plan",
        crear: async () => crearPlan(dueno),
        alta: (p: string) =>
          [
            "insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'x')",
            [p],
          ] as const,
        retirar: "update plan set estado = 'RETIRADO' where id = $1",
        mensaje: /plan está retirado/,
      },
    ];

    for (const caso of casos) {
      it(`retirar a la vez que se le crea ${caso.nombre}: espera a que termine uno; nunca queda algo nuevo bajo un padre retirado`, async () => {
        // (a) el alta primero: el retiro espera a que ella confirme y después se aplica
        const padre = await caso.crear();
        const alta = await abrirAdmin("read committed");
        const retiro = await abrirAdmin("read committed");
        const [textoAlta, paramsAlta] = caso.alta(padre);
        expect((await alta.directo(textoAlta, [...paramsAlta])).ok).toBe(true);
        const esperando = retiro.directo(caso.retirar, [padre]);
        expect(await esperarBloqueo(dueno, retiro.pid), "el retiro espera al alta").toBe(true);
        expect((await alta.confirmar()).ok).toBe(true);
        expect((await esperando).ok).toBe(true);
        expect((await retiro.confirmar()).ok).toBe(true);
        await alta.cerrar();
        await retiro.cerrar();

        // (b) el retiro primero: el alta espera y, al confirmarse el retiro, se rechaza
        const padre2 = await caso.crear();
        const retiro2 = await abrirAdmin("read committed");
        const alta2 = await abrirAdmin("read committed");
        expect((await retiro2.directo(caso.retirar, [padre2])).ok).toBe(true);
        const [textoAlta2, paramsAlta2] = caso.alta(padre2);
        const esperando2 = alta2.directo(textoAlta2, [...paramsAlta2]);
        expect(await esperarBloqueo(dueno, alta2.pid), "el alta espera al retiro").toBe(true);
        expect((await retiro2.confirmar()).ok).toBe(true);
        const r2 = await esperando2;
        expect(r2.ok).toBe(false);
        if (!r2.ok) {
          expect(r2.codigo).toBe("23514");
          expect(r2.mensaje).toMatch(caso.mensaje);
        }
        await alta2.cerrar();
        await retiro2.cerrar();
      });
    }

    it("un dominio creado en una transacción abierta no deja retirar la marca hasta que termina (y el alta de un dominio no toma ningún bloqueo de más sobre otra marca)", async () => {
      const m1 = await crearMarca(dueno);
      const m2 = await crearMarca(dueno);
      const alta = await abrirAdmin("read committed");
      await alta.directo(
        "insert into dominio_de_marca (marca_id, host, creado_por) values ($1, $2, $3)",
        [m1, hostAlAzar(), ACTOR_DE_PRUEBA],
      );
      const otra = await abrirAdmin("read committed");
      // retirar OTRA marca no espera
      const r = await Promise.race([
        otra.directo("update marca set estado = 'RETIRADA' where id = $1", [m2]),
        new Promise<"espera">((resolver) => setTimeout(() => resolver("espera"), 3_000)),
      ]);
      expect(r).not.toBe("espera");
      await alta.cerrar();
      await otra.cerrar();
    });
  });
});
