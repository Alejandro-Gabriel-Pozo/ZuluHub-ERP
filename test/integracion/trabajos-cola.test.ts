import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { crearColaDePostgres, type ColaDb } from "../../src/adaptadores/postgres/cola-de-trabajos";
import { crearTransacciones } from "../../src/adaptadores/postgres/transacciones";
import {
  crearProcesadorDeTrabajos,
  type ProblemaDelProcesador,
  type TxDeCola,
} from "../../src/adaptadores/trabajos/procesador";
import type { PoliticaDeReintentos } from "../../src/adaptadores/trabajos/reintentos";
import { ok } from "../../src/primitivas/resultado/resultado";
import type { ColaDeTrabajos, ManejadorDeTrabajo } from "../../src/puertos/cola-de-trabajos";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoTrabajos,
  crearBaseAparte,
  crearBarrera,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  nombreAlAzar,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";

/**
 * H5: el procesador de la cola contra una base real, con los roles limitados y el contexto firmado.
 * Cubre ADR-007: tomar es un UPDATE condicionado (dos procesadores a la vez: uno solo ejecuta),
 * plazo vencido, reintentos con tope, FALLIDO que no se borra, despacho inmediato que no propaga.
 * El envío de la invitación está en `trabajos-envio-invitacion.test.ts`.
 */

const base = inject("baseDePruebas");
const T0 = AHORA_DE_PRUEBA;
const mas = (ms: number) => new Date(T0.getTime() + ms);
const POLITICA: Partial<PoliticaDeReintentos> = {
  maximoDeIntentos: 3,
  esperaBaseEnMs: 1_000,
  esperaMaximaEnMs: 4_000,
  plazoDeTomaEnMs: 60_000,
};

type Fila = {
  estado: string;
  intentos: number;
  proximo_intento: Date;
  tomado_hasta: Date | null;
  ultimo_error: string | null;
};

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

describe.skipIf(base === null)("cola de trabajos: el procesador contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let empresa: EmpresaDePrueba;
  const aCerrar: { cerrar(): Promise<void> }[] = [];

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    empresa = await crearEmpresaActiva(entorno);
  });
  // Cada prueba parte de una cola sin pendientes de las anteriores: el cron procesa TODO lo que hay.
  beforeEach(async () => {
    if (base === null) return;
    await dueno.query(
      "update trabajo set estado = 'EN_CURSO', tomado_hasta = now() where estado = 'PENDIENTE'",
    );
    await dueno.query(
      "update trabajo set estado = 'HECHO', tomado_hasta = null where estado = 'EN_CURSO'",
    );
  });
  afterAll(async () => {
    await dueno.end();
    await Promise.all(aCerrar.map((e) => e.cerrar()));
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Encola un trabajo con el puerto real y devuelve su id. */
  const encolar = async (tipo = "demo", datos: Record<string, string> = {}): Promise<string> => {
    const clave = nombreAlAzar("clave");
    const r = await entorno.ejecutar({ contexto: comoEmpresa(empresa.empresa) }, async (tx) =>
      ok(
        await tx.trabajos.encolar({
          empresaId: empresa.empresa,
          tipo,
          datos,
          claveDeIdempotencia: clave,
        }),
      ),
    );
    expect(r).toEqual({ ok: true, valor: "ENCOLADO" });
    const { rows } = await dueno.query<{ id: string }>(
      "select id from trabajo where empresa_id = $1 and clave_idempotencia = $2",
      [empresa.empresa, clave],
    );
    return rows[0]!.id;
  };

  const fila = async (id: string): Promise<Fila> =>
    (
      await dueno.query<Fila>(
        `select estado, intentos, proximo_intento, tomado_hasta, ultimo_error
         from trabajo where id = $1`,
        [id],
      )
    ).rows[0]!;

  /** Deja el trabajo `EN_CURSO` como si un procesador lo hubiera tomado (y se hubiera muerto). */
  const dejarEnCurso = async (id: string, intentos: number, tomadoHasta: Date) => {
    await dueno.query(
      "update trabajo set estado = 'EN_CURSO', intentos = $2, tomado_hasta = $3 where id = $1",
      [id, intentos, tomadoHasta],
    );
  };

  /** Pasa por EN_CURSO, como lo exige la máquina de estados de la base. */
  const forzar = async (id: string, estado: "HECHO" | "FALLIDO", intentos = 1) => {
    await dejarEnCurso(id, intentos, mas(0));
    await dueno.query("update trabajo set estado = $2, tomado_hasta = null where id = $1", [
      id,
      estado,
    ]);
  };

  const enLaCola = async <T>(operar: (cola: ColaDeTrabajos) => Promise<T>): Promise<T> => {
    const r = await entorno.ejecutar(
      { contexto: comoTrabajos(), aislamiento: "read committed" },
      async ({ cola }) => ok(await operar(cola)),
    );
    if (!r.ok) throw new Error(`la cola falló: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  /** Un procesador sobre `transacciones`, cuyo manejador `demo` cuenta las ejecuciones por id. */
  const procesador = (
    manejador: ManejadorDeTrabajo,
    opciones: {
      transacciones?: ReturnType<typeof crearEntornoDePrueba>;
      problemas?: ProblemaDelProcesador[];
      tope?: number;
    } = {},
  ) =>
    crearProcesadorDeTrabajos({
      transacciones: opciones.transacciones ?? entorno,
      manejadores: new Map([["demo", manejador]]),
      politica: POLITICA,
      alRegistrarProblema: (p) => opciones.problemas?.push(p),
      ...(opciones.tope === undefined ? {} : { topeDeEsperaDelDespachoEnMs: opciones.tope }),
    });

  const contador = () => {
    const ejecuciones: string[] = [];
    const manejador: ManejadorDeTrabajo = async (t) => {
      ejecuciones.push(t.id);
      await pausa(30);
      return { tipo: "HECHO" };
    };
    return { ejecuciones, manejador };
  };

  /** Un entorno propio cuya toma espera en una barrera: así dos procesadores llegan juntos al UPDATE. */
  const conBarreraEnLaToma = (alcanza: (id: string) => boolean, barrera: () => Promise<void>) => {
    const nuevo = crearEntornoDePrueba(propia.base, 10, (tx: TxDePrueba) => ({
      ...tx,
      cola: {
        ...tx.cola,
        tomar: async (id, ahora, hasta) => {
          if (alcanza(id)) await barrera();
          return tx.cola.tomar(id, ahora, hasta);
        },
      },
    }));
    aCerrar.push(nuevo);
    return nuevo;
  };

  describe("tomar", () => {
    it("toma un trabajo pendiente: EN_CURSO, un intento, con su plazo, y devuelve sus datos", async () => {
      const id = await encolar("demo", { invitacionId: "x" });
      const tomado = await enLaCola((c) => c.tomar(id, T0, mas(60_000)));
      expect(tomado).toEqual({
        id,
        empresaId: empresa.empresa,
        tipo: "demo",
        datos: { invitacionId: "x" },
        intentos: 1,
      });
      expect(await fila(id)).toMatchObject({
        estado: "EN_CURSO",
        intentos: 1,
        tomado_hasta: mas(60_000),
      });
    });

    it("un trabajo recién encolado se toma aunque el reloj de quien lo toma vaya atrasado", async () => {
      const id = await encolar();
      const muyAntes = new Date("2000-01-01T00:00:00Z");
      expect(await enLaCola((c) => c.tomar(id, muyAntes, mas(60_000)))).not.toBeNull();
    });

    it("no toma lo que ya está tomado con plazo vigente, ni lo hecho, ni lo fallido", async () => {
      const vigente = await encolar();
      await dejarEnCurso(vigente, 1, mas(10_000));
      const hecho = await encolar();
      await forzar(hecho, "HECHO");
      const fallido = await encolar();
      await forzar(fallido, "FALLIDO");
      for (const id of [vigente, hecho, fallido]) {
        expect(await enLaCola((c) => c.tomar(id, mas(9_999), mas(70_000)))).toBeNull();
      }
      expect(await fila(vigente)).toMatchObject({ estado: "EN_CURSO", intentos: 1 });
      expect(await fila(hecho)).toMatchObject({ estado: "HECHO", intentos: 1 });
      expect(await fila(fallido)).toMatchObject({ estado: "FALLIDO", intentos: 1 });
    });

    it("no toma un pendiente reprogramado hacia el futuro, y sí cuando le toca", async () => {
      const id = await encolar();
      await dejarEnCurso(id, 1, mas(0));
      await dueno.query(
        "update trabajo set estado = 'PENDIENTE', tomado_hasta = null, proximo_intento = $2 where id = $1",
        [id, mas(5_000)],
      );
      expect(await enLaCola((c) => c.tomar(id, mas(4_999), mas(70_000)))).toBeNull();
      expect(await enLaCola((c) => c.tomar(id, mas(5_000), mas(70_000)))).toMatchObject({
        id,
        intentos: 2,
      });
    });

    it("retoma uno cuyo plazo venció: cuenta otro intento y fija un plazo nuevo", async () => {
      const id = await encolar();
      await dejarEnCurso(id, 1, mas(10_000));
      expect(await enLaCola((c) => c.tomar(id, mas(10_000), mas(80_000)))).toMatchObject({
        id,
        intentos: 2,
      });
      expect(await fila(id)).toMatchObject({ estado: "EN_CURSO", tomado_hasta: mas(80_000) });
    });

    it("los candidatos son los disponibles, los más atrasados primero, hasta el límite", async () => {
      const propio = await crearBaseAparte(base!);
      const e = crearEntornoDePrueba(propio.base, 5);
      const c = new pg.Client({ connectionString: propio.base.dueno });
      await c.connect();
      try {
        const emp = await crearEmpresaActiva(e);
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) {
          const clave = nombreAlAzar("c");
          await e.ejecutar({ contexto: comoEmpresa(emp.empresa) }, async (tx) =>
            ok(
              await tx.trabajos.encolar({
                empresaId: emp.empresa,
                tipo: "demo",
                datos: {},
                claveDeIdempotencia: clave,
              }),
            ),
          );
          const { rows } = await c.query<{ id: string }>(
            "select id from trabajo where clave_idempotencia = $1",
            [clave],
          );
          ids.push(rows[0]!.id);
        }
        // 0: vencido hace mucho; 1: pendiente en el futuro con intentos; 2: EN_CURSO vigente; 3: nuevo.
        await c.query("update trabajo set proximo_intento = $2 where id = $1", [
          ids[0],
          new Date("2020-01-01T00:00:00Z"),
        ]);
        await c.query(
          "update trabajo set estado = 'EN_CURSO', intentos = 1, tomado_hasta = $2 where id = $1",
          [ids[1], mas(0)],
        );
        await c.query(
          "update trabajo set estado = 'PENDIENTE', tomado_hasta = null, proximo_intento = $2 where id = $1",
          [ids[1], mas(9_999_999)],
        );
        await c.query(
          "update trabajo set estado = 'EN_CURSO', intentos = 1, tomado_hasta = $2 where id = $1",
          [ids[2], mas(9_999_999)],
        );
        const cola = async (limite: number) => {
          const r = await e.ejecutar(
            { contexto: comoTrabajos(), aislamiento: "read committed" },
            async (tx) => ok(await tx.cola.candidatos(T0, limite)),
          );
          return r.ok ? r.valor : [];
        };
        const todos = await cola(10);
        expect(todos).toHaveLength(2);
        expect(todos[0]).toBe(ids[0]);
        expect(todos).toContain(ids[3]);
        expect(await cola(1)).toEqual([ids[0]]);
      } finally {
        await c.end();
        await e.cerrar();
        await propio.destruir();
      }
    });

    it("encuentra los ids de los trabajos de la empresa por clave de idempotencia", async () => {
      const clave = nombreAlAzar("busqueda");
      await entorno.ejecutar({ contexto: comoEmpresa(empresa.empresa) }, async (tx) =>
        ok(
          await tx.trabajos.encolar({
            empresaId: empresa.empresa,
            tipo: "demo",
            datos: {},
            claveDeIdempotencia: clave,
          }),
        ),
      );
      const { rows } = await dueno.query<{ id: string }>(
        "select id from trabajo where clave_idempotencia = $1",
        [clave],
      );
      expect(await enLaCola((c) => c.idsPorClaves(empresa.empresa, [clave, "no-existe"]))).toEqual([
        rows[0]!.id,
      ]);
      expect(await enLaCola((c) => c.idsPorClaves(empresa.empresa, []))).toEqual([]);
      const otra = await crearEmpresaActiva(entorno);
      expect(await enLaCola((c) => c.idsPorClaves(otra.empresa, [clave]))).toEqual([]);
    });
  });

  describe("empresas con trabajos de un tipo (el cron sabe a quién barrerle lo que quedó en vuelo)", () => {
    const tipo = () => `tipo-${nombreAlAzar("empresas")}`;
    const encolarCon = async (e: EmpresaDePrueba, t: string, clave: string, creadoEn?: string) => {
      await entorno.ejecutar({ contexto: comoEmpresa(e.empresa) }, async (tx) =>
        ok(
          await tx.trabajos.encolar({
            empresaId: e.empresa,
            tipo: t,
            datos: {},
            claveDeIdempotencia: clave,
          }),
        ),
      );
      if (creadoEn !== undefined) {
        await dueno.query("update trabajo set creado_en = $2 where clave_idempotencia = $1", [
          clave,
          creadoEn,
        ]);
      }
    };
    const empresasDe = (t: string, desde: Date, limite = 50) =>
      enLaCola((c) => c.empresasConTrabajosDe(t, desde, limite));

    it("devuelve cada empresa una vez, solo las de ese tipo y solo desde esa fecha, en orden estable", async () => {
      const t = tipo();
      const a = await crearEmpresaActiva(entorno);
      const b = await crearEmpresaActiva(entorno);
      const c = await crearEmpresaActiva(entorno);
      await encolarCon(a, t, nombreAlAzar("k"));
      await encolarCon(a, t, nombreAlAzar("k"));
      await encolarCon(b, t, nombreAlAzar("k"));
      // Otro tipo: no cuenta. Uno viejo: no cuenta.
      await encolarCon(c, "otro-tipo", nombreAlAzar("k"));
      await encolarCon(c, t, nombreAlAzar("k"), "2020-01-01T00:00:00Z");
      const hallada = await empresasDe(t, new Date("2025-01-01T00:00:00Z"));
      expect([...hallada].sort()).toEqual([a.empresa, b.empresa].sort());
      expect(hallada).toEqual([...hallada].sort());
      // Con la fecha vieja entra también la empresa del trabajo antiguo.
      expect(await empresasDe(t, new Date("2019-01-01T00:00:00Z"))).toHaveLength(3);
    });

    it("respeta el límite (las primeras en orden) y rechaza uno que no sirve", async () => {
      const t = tipo();
      const e1 = await crearEmpresaActiva(entorno);
      const e2 = await crearEmpresaActiva(entorno);
      await encolarCon(e1, t, nombreAlAzar("k"));
      await encolarCon(e2, t, nombreAlAzar("k"));
      const todas = await empresasDe(t, new Date(0));
      expect(await empresasDe(t, new Date(0), 1)).toEqual([todas[0]]);
      for (const limite of [0, -1, 1.5]) {
        await expect(empresasDe(t, new Date(0), limite)).rejects.toThrow(RangeError);
      }
    });

    it("con `postergadasEn`, primero las que hace más que no encolan ese otro tipo (y las que nunca, antes que todas)", async () => {
      const t = tipo();
      const otro = tipo();
      const a = await crearEmpresaActiva(entorno);
      const b = await crearEmpresaActiva(entorno);
      const c = await crearEmpresaActiva(entorno);
      for (const e of [a, b, c]) await encolarCon(e, t, nombreAlAzar("k"));
      // `a` encoló el otro tipo hace poco, `b` hace mucho y `c` nunca: el orden es c, b, a, sin importar los ids.
      await encolarCon(a, otro, nombreAlAzar("k"), "2026-03-02T00:00:00Z");
      await encolarCon(b, otro, nombreAlAzar("k"), "2026-03-01T00:00:00Z");
      const desde = new Date(0);
      expect(await enLaCola((q) => q.empresasConTrabajosDe(t, desde, 50, otro))).toEqual([
        c.empresa,
        b.empresa,
        a.empresa,
      ]);
      // Con tope, la más atrasada primero; y una empresa sin trabajos del primer tipo no aparece aunque tenga del otro.
      expect(await enLaCola((q) => q.empresasConTrabajosDe(t, desde, 1, otro))).toEqual([
        c.empresa,
      ]);
      const d = await crearEmpresaActiva(entorno);
      await encolarCon(d, otro, nombreAlAzar("k"));
      expect(await enLaCola((q) => q.empresasConTrabajosDe(t, desde, 50, otro))).not.toContain(
        d.empresa,
      );
    });

    it("con más empresas que el límite (205 y tope 200), pasadas sucesivas las cubren a todas", async () => {
      const t = tipo();
      const otro = tipo();
      const todas: string[] = [];
      for (let i = 0; i < 205; i++) {
        const e = await crearEmpresaActiva(entorno);
        await encolarCon(e, t, nombreAlAzar("k"));
        todas.push(e.empresa);
      }
      const desde = new Date(0);
      const cubiertas = new Set<string>();
      for (let pasada = 1; pasada <= 2; pasada++) {
        const elegidas = await enLaCola((q) => q.empresasConTrabajosDe(t, desde, 200, otro));
        expect(elegidas).toHaveLength(200);
        // Lo que la pasada «encola»: lo que sigue es lo que la composición hace con cada empresa elegida.
        for (const empresa of elegidas) {
          await dueno.query(
            "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, $2, $3)",
            [empresa, otro, nombreAlAzar("k")],
          );
          cubiertas.add(empresa);
        }
      }
      // Sin rotación, la 201 en adelante no se atendía nunca; con ella, dos pasadas ya las cubren a todas.
      expect([...cubiertas].sort()).toEqual([...todas].sort());
    }, 120_000);

    it("no incluye los trabajos de plataforma (sin empresa)", async () => {
      const t = tipo();
      await dueno.query(
        "insert into trabajo (empresa_id, tipo, clave_idempotencia) values (null, $1, $2)",
        [t, nombreAlAzar("k")],
      );
      expect(await empresasDe(t, new Date(0))).toEqual([]);
    });
  });

  describe("concurrencia", () => {
    it("dos procesadores toman el mismo trabajo a la vez: lo ejecuta uno solo", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) ids.push(await encolar());
      const objetivos = new Set(ids);
      // Cada trabajo tiene dos contendientes; todas las tomas esperan en la misma barrera.
      const barrera = crearBarrera(ids.length * 2);
      const { ejecuciones, manejador } = contador();
      // Dos procesadores, cada uno con su propio pool de conexiones.
      const a = procesador(manejador, {
        transacciones: conBarreraEnLaToma((id) => objetivos.has(id), barrera),
      });
      const b = procesador(manejador, {
        transacciones: conBarreraEnLaToma((id) => objetivos.has(id), barrera),
      });
      const resultados = await Promise.all(
        ids.flatMap((id) => [a.procesarUno(id, T0), b.procesarUno(id, T0)]),
      );
      expect(resultados.filter((r) => r === "HECHO")).toHaveLength(ids.length);
      expect(resultados.filter((r) => r === "NO_TOMADO")).toHaveLength(ids.length);
      for (const id of ids) {
        expect(ejecuciones.filter((e) => e === id)).toHaveLength(1);
        expect(await fila(id)).toMatchObject({ estado: "HECHO", intentos: 1 });
      }
    });

    it("el intento inmediato y el cron a la vez sobre el mismo trabajo: lo ejecuta uno solo", async () => {
      const id = await encolar();
      const barrera = crearBarrera(2);
      const { ejecuciones, manejador } = contador();
      const inmediato = procesador(manejador, {
        transacciones: conBarreraEnLaToma((x) => x === id, barrera),
      });
      const cron = procesador(manejador, {
        transacciones: conBarreraEnLaToma((x) => x === id, barrera),
      });
      const [, resumen] = await Promise.all([
        inmediato.despacharAhora([id], T0),
        cron.procesarPendientes({ ahora: T0, limite: 50 }),
      ]);
      expect(ejecuciones.filter((e) => e === id)).toHaveLength(1);
      expect(resumen.noTomados + resumen.hechos).toBeGreaterThanOrEqual(1);
      expect(await fila(id)).toMatchObject({ estado: "HECHO", intentos: 1 });
    });

    it("mientras un procesador ejecuta con su plazo vigente, otro no lo retoma", async () => {
      const id = await encolar();
      let liberar: () => void = () => undefined;
      const espera = new Promise<void>((resolver) => {
        liberar = resolver;
      });
      const lento: ManejadorDeTrabajo = async () => {
        await espera;
        return { tipo: "HECHO" };
      };
      const primero = procesador(lento).procesarUno(id, T0);
      await pausa(200);
      const { ejecuciones, manejador } = contador();
      expect(await procesador(manejador).procesarUno(id, mas(59_999))).toBe("NO_TOMADO");
      liberar();
      expect(await primero).toBe("HECHO");
      expect(ejecuciones).toEqual([]);
    });
  });

  describe("plazo vencido", () => {
    it("otro procesador retoma un trabajo cuyo plazo venció y lo termina", async () => {
      const id = await encolar();
      await dejarEnCurso(id, 1, mas(10_000));
      const { ejecuciones, manejador } = contador();
      const p = procesador(manejador);
      const vigente = await p.procesarPendientes({ ahora: mas(9_999), limite: 100 });
      expect(vigente.hechos).toBe(0);
      expect(ejecuciones).toEqual([]);
      const vencido = await p.procesarPendientes({ ahora: mas(10_000), limite: 100 });
      expect(vencido.hechos).toBeGreaterThanOrEqual(1);
      expect(ejecuciones.filter((e) => e === id)).toHaveLength(1);
      expect(await fila(id)).toMatchObject({ estado: "HECHO", intentos: 2, tomado_hasta: null });
    });

    it("si el primero termina después de que otro lo retomó, su cierre no pisa nada", async () => {
      const id = await encolar();
      let liberar: () => void = () => undefined;
      const espera = new Promise<void>((resolver) => {
        liberar = resolver;
      });
      const lento: ManejadorDeTrabajo = async () => {
        await espera;
        return { tipo: "HECHO", nota: "lo cerró el lento" };
      };
      const primero = procesador(lento).procesarUno(id, T0);
      await pausa(200);
      expect(await fila(id)).toMatchObject({ estado: "EN_CURSO", intentos: 1 });
      // Vence el plazo del primero: entra el segundo, que lo ejecuta y lo cierra.
      const { ejecuciones, manejador } = contador();
      expect(await procesador(manejador).procesarUno(id, mas(60_000))).toBe("HECHO");
      expect(ejecuciones).toEqual([id]);
      liberar();
      expect(await primero).toBe("PERDIDO");
      expect(await fila(id)).toMatchObject({ estado: "HECHO", intentos: 2, ultimo_error: null });
    });

    it("un trabajo cuyo proceso se cortó en cada intento no se ejecuta otra vez: FALLIDO", async () => {
      const id = await encolar();
      await dejarEnCurso(id, 3, mas(1_000));
      const { ejecuciones, manejador } = contador();
      await procesador(manejador).procesarPendientes({ ahora: mas(1_000), limite: 100 });
      expect(ejecuciones.filter((e) => e === id)).toEqual([]);
      const f = await fila(id);
      expect(f).toMatchObject({ estado: "FALLIDO", intentos: 4 });
      expect(f.ultimo_error).toMatch(/se agotaron los intentos/);
    });
  });

  describe("reintentos", () => {
    it("falla, espera cada vez más, y al agotar los intentos queda FALLIDO sin perder la fila", async () => {
      const id = await encolar();
      let llamadas = 0;
      const p = procesador(() => {
        llamadas += 1;
        return Promise.resolve({
          tipo: "ERROR",
          error: "el proveedor respondió 500",
          definitivo: false,
        });
      });

      expect(await p.procesarUno(id, T0)).toBe("REPROGRAMADO");
      expect(await fila(id)).toMatchObject({
        estado: "PENDIENTE",
        intentos: 1,
        proximo_intento: mas(1_000),
        tomado_hasta: null,
        ultimo_error: "el proveedor respondió 500",
      });
      expect(await p.procesarUno(id, mas(999))).toBe("NO_TOMADO");

      expect(await p.procesarUno(id, mas(1_000))).toBe("REPROGRAMADO");
      expect(await fila(id)).toMatchObject({ intentos: 2, proximo_intento: mas(1_000 + 2_000) });

      expect(await p.procesarUno(id, mas(3_000))).toBe("FALLIDO");
      expect(await fila(id)).toMatchObject({
        estado: "FALLIDO",
        intentos: 3,
        tomado_hasta: null,
        ultimo_error: "el proveedor respondió 500",
      });
      expect(llamadas).toBe(3);

      // El cron no vuelve a tocarlo (sí procesa otros pendientes de la base) y la fila sigue ahí.
      await p.procesarPendientes({ ahora: mas(99_000_000), limite: 100 });
      expect(await fila(id)).toMatchObject({ estado: "FALLIDO", intentos: 3 });
    });

    it("un error definitivo deja FALLIDO en el primer intento", async () => {
      const id = await encolar();
      const r = await procesador(() =>
        Promise.resolve({ tipo: "ERROR", error: "dirección inválida", definitivo: true }),
      ).procesarUno(id, T0);
      expect(r).toBe("FALLIDO");
      expect(await fila(id)).toMatchObject({ estado: "FALLIDO", intentos: 1 });
    });

    it("una excepción cuenta como error reintentable y no deja pasar un token ni un enlace", async () => {
      const id = await encolar();
      const token = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
      const enlace = `https://app.ejemplo.test/invitaciones/${token}`;
      const r = await procesador(() => {
        throw new Error(`no pude mandar ${enlace}`);
      }).procesarUno(id, T0);
      expect(r).toBe("REPROGRAMADO");
      const f = await fila(id);
      expect(f.ultimo_error).toBe("Error: no pude mandar [enlace]");
      expect(JSON.stringify(f)).not.toContain(token);
    });

    it("un trabajo cuyo tipo no tiene manejador se reintenta (puede ser una versión vieja)", async () => {
      const id = await encolar("tipo-desconocido");
      expect(await procesador(contador().manejador).procesarUno(id, T0)).toBe("REPROGRAMADO");
      expect((await fila(id)).ultimo_error).toBe(
        "no hay manejador para el tipo 'tipo-desconocido'",
      );
    });

    it("un trabajo hecho tras un fallo limpia el error anterior", async () => {
      const id = await encolar();
      let intento = 0;
      const p = procesador(() => {
        intento += 1;
        return Promise.resolve(
          intento === 1
            ? { tipo: "ERROR", error: "falla pasajera", definitivo: false }
            : { tipo: "HECHO" },
        );
      });
      await p.procesarUno(id, T0);
      await p.procesarUno(id, mas(1_000));
      expect(await fila(id)).toMatchObject({ estado: "HECHO", intentos: 2, ultimo_error: null });
    });
  });

  describe("despacho inmediato", () => {
    it("ejecuta el trabajo apenas se llama", async () => {
      const id = await encolar();
      const { ejecuciones, manejador } = contador();
      await procesador(manejador).despacharAhora([id], T0);
      expect(ejecuciones).toEqual([id]);
      expect(await fila(id)).toMatchObject({ estado: "HECHO", intentos: 1 });
    });

    it("si el manejador falla, no propaga: queda PENDIENTE con el error y el cron lo completa", async () => {
      const id = await encolar();
      let roto = true;
      const p = procesador(() => {
        if (roto) throw new Error("explotó el despacho");
        return Promise.resolve({ tipo: "HECHO" });
      });
      await expect(p.despacharAhora([id], T0)).resolves.toBeUndefined();
      expect(await fila(id)).toMatchObject({
        estado: "PENDIENTE",
        intentos: 1,
        ultimo_error: "Error: explotó el despacho",
      });
      // El cron lo completa cuando le toca.
      roto = false;
      await p.procesarPendientes({ ahora: mas(1_000), limite: 100 });
      expect(await fila(id)).toMatchObject({ estado: "HECHO", intentos: 2 });
    });

    it("si la base no responde, tampoco propaga: lo informa y el trabajo queda para el cron", async () => {
      const id = await encolar();
      const problemas: ProblemaDelProcesador[] = [];
      const sinBase = crearTransacciones<TxDeCola>({
        // Un puerto donde no escucha nadie: la conexión se rechaza.
        urls: { TRABAJOS: "postgres://nadie@127.0.0.1:1/nada" },
        armar: (db) => ({ cola: crearColaDePostgres(db.withTables<ColaDb>()) }),
        clave: propia.base.clave,
      });
      aCerrar.push(sinBase);
      const p = crearProcesadorDeTrabajos({
        transacciones: sinBase,
        manejadores: new Map([["demo", contador().manejador]]),
        alRegistrarProblema: (x) => problemas.push(x),
      });
      await expect(p.despacharAhora([id], T0)).resolves.toBeUndefined();
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toMatchObject({ trabajoId: id, fase: "tomar" });
      expect(await fila(id)).toMatchObject({ estado: "PENDIENTE", intentos: 0 });
    });

    it("no demora más que el tope aunque el manejador no termine", async () => {
      const id = await encolar();
      const colgado: ManejadorDeTrabajo = () => new Promise(() => undefined);
      const inicio = performance.now();
      await procesador(colgado, { tope: 200 }).despacharAhora([id], T0);
      expect(performance.now() - inicio).toBeLessThan(3_000);
      // Queda tomado con su plazo: si el proceso muere, el cron lo retoma al vencer.
      expect(await fila(id)).toMatchObject({ estado: "EN_CURSO", intentos: 1 });
      const { ejecuciones, manejador } = contador();
      await procesador(manejador).procesarPendientes({ ahora: mas(60_000), limite: 100 });
      expect(ejecuciones).toContain(id);
    });
  });

  describe("el rol de trabajos", () => {
    it("solo avanza la cola: no ve ninguna tabla de negocio ni invitaciones", async () => {
      for (const tabla of [
        "empresa",
        "tenant",
        "sucursal",
        "persona",
        "auditoria_empresa",
        "invitacion",
        "invitacion_empresa",
        "invitacion_sucursal",
        "membresia",
        "asignacion_sucursal",
        "contexto_clave",
      ]) {
        const r = await entorno.ejecutar({ contexto: comoTrabajos() }, async ({ db }) => {
          await sql.raw(`select * from ${tabla}`).execute(db);
          return ok(null);
        });
        expect(r, tabla).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      }
    });
  });
});
