import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearConexionDeAutenticacion } from "../../src/adaptadores/postgres/conexion-de-autenticacion";
import { crearLecturasDeSistema } from "../../src/adaptadores/postgres/lecturas-de-sistema";
import { crearProcesadorDeTrabajos } from "../../src/adaptadores/trabajos/procesador";
import { armarConexiones } from "../../src/composicion/conexiones";
import { MIGRACION_REQUERIDA } from "../../src/composicion/guarda-de-migracion";
import { atenderCron, atenderSalud } from "../../src/composicion/rutas-de-sistema";
import { armarSistema } from "../../src/composicion/sistema";
import { ok } from "../../src/primitivas/resultado/resultado";
import type { ManejadorDeTrabajo } from "../../src/puertos/cola-de-trabajos";
import {
  comoEmpresa,
  crearBaseAparte,
  crearBarrera,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  nombreAlAzar,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";

/**
 * W6 contra una base real, con los roles limitados y el contexto firmado:
 *  - El cron: sin el secreto, 401 y NADA se toca (ni la cola ni las sesiones); con él, despacha y barre;
 *    dos llamadas a la vez ejecutan UN solo despacho por trabajo y no barren de más (idempotente).
 *  - La salud: `SELECT 1` con el rol de la aplicación; con la clave mal puesta, falla cerrado y sin detalle.
 *  - P-15, la guarda de migración: base al día → sigue; con una migración menos → «no al día»; apenas se
 *    migra, vuelve sola; sin permiso de lectura sobre `migracion` → falla cerrado (ver el informe: hace falta
 *    un `GRANT SELECT ON migracion TO zuluhub_app` que hoy ninguna migración da).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRETO = "el-secreto-largo-del-cron-de-prueba";
const AHORA = new Date("2026-10-14T06:17:00.000Z");
const CARPETA_REAL = join(import.meta.dirname, "../../migraciones");
const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

const pedidoDeCron = (autorizacion?: string) =>
  new Request("https://zuluhub-erp.vercel.app/api/trabajos/cron", {
    headers: autorizacion === undefined ? {} : { authorization: autorizacion },
  });

describe.skipIf(base === null)("rutas de sistema contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let empresa: EmpresaDePrueba;
  let autenticacion: ReturnType<typeof crearConexionDeAutenticacion>;
  let usuario: string;
  const aCerrar: { cerrar(): Promise<void> }[] = [];

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    empresa = await crearEmpresaActiva(entorno);
    autenticacion = crearConexionDeAutenticacion({ url: propia.base.autenticacion });
    usuario = (
      await dueno.query<{ id: string }>(
        `insert into autenticacion."user" (name, email, "emailVerified") values ('Cron', $1, true) returning id`,
        [`cron-${randomUUID().slice(0, 8)}@ejemplo.test`],
      )
    ).rows[0]?.id as string;
  });
  beforeEach(async () => {
    if (base === null) return;
    // Cada prueba parte sin pendientes ni sesiones de las anteriores: el cron procesa TODO lo que hay.
    await dueno.query(
      "update trabajo set estado = 'EN_CURSO', tomado_hasta = now() where estado = 'PENDIENTE'",
    );
    await dueno.query(
      "update trabajo set estado = 'HECHO', tomado_hasta = null where estado = 'EN_CURSO'",
    );
    await dueno.query(
      `truncate autenticacion.session, autenticacion.verification, autenticacion."rateLimit"`,
    );
  });
  afterAll(async () => {
    await autenticacion.cerrar();
    await dueno.end();
    await Promise.all(aCerrar.map((e) => e.cerrar()));
    await entorno.cerrar();
    await propia.destruir();
  });

  const encolar = async (): Promise<string> => {
    const clave = nombreAlAzar("clave");
    const r = await entorno.ejecutar({ contexto: comoEmpresa(empresa.empresa) }, async (tx) =>
      ok(
        await tx.trabajos.encolar({
          empresaId: empresa.empresa,
          tipo: "demo",
          datos: {},
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
  const estadoDe = async (id: string) =>
    (
      await dueno.query<{ estado: string; intentos: number }>(
        "select estado, intentos from trabajo where id = $1",
        [id],
      )
    ).rows[0]!;
  /** Una sesión vencida hace rato (para que el barrido la borre). */
  const sesionVencida = async (): Promise<string> => {
    const id = randomUUID();
    const hace = new Date(AHORA.getTime() - 48 * 3_600_000);
    await dueno.query(
      `insert into autenticacion.session (id, token, "userId", host, "createdAt", "updatedAt", "expiresAt")
       values ($1, $2, $3, 'app.marca-a.test', $4, $4, $4)`,
      [id, randomUUID(), usuario, hace],
    );
    return id;
  };
  const sesiones = async (): Promise<number> =>
    Number(
      (await dueno.query<{ n: string }>("select count(*) as n from autenticacion.session")).rows[0]
        ?.n,
    );

  /** Las dependencias reales del cron sobre esta base, con un manejador `demo` que cuenta ejecuciones. */
  const dependencias = (
    ejecuciones: string[],
    transacciones: ReturnType<typeof crearEntornoDePrueba> = entorno,
  ) => {
    const manejador: ManejadorDeTrabajo = async (t) => {
      ejecuciones.push(t.id);
      await pausa(30);
      return { tipo: "HECHO" };
    };
    const registrados: string[] = [];
    return {
      registrados,
      dependencias: {
        secreto: () => SECRETO,
        procesador: () =>
          crearProcesadorDeTrabajos({ transacciones, manejadores: new Map([["demo", manejador]]) }),
        barrido: () => autenticacion.barrido,
        ahora: () => AHORA,
        registrar: (d: string) => registrados.push(d),
      },
    };
  };

  describe("el cron", () => {
    it("sin el secreto (o con otro): 401 sin cuerpo y NO toca la cola ni las sesiones", async () => {
      const id = await encolar();
      await sesionVencida();
      const { dependencias: d, registrados } = dependencias([]);
      const ejecuciones: string[] = [];
      for (const autorizacion of [
        undefined,
        "",
        "Bearer ",
        "Bearer otro-secreto-que-no-es-el-del-cron",
        SECRETO,
        `Basic ${SECRETO}`,
      ]) {
        const r = await atenderCron(pedidoDeCron(autorizacion), d);
        expect(r.status).toBe(401);
        expect(await r.text()).toBe("");
        expect(r.headers.get("set-cookie")).toBeNull();
      }
      expect(ejecuciones).toEqual([]);
      expect(await estadoDe(id)).toEqual({ estado: "PENDIENTE", intentos: 0 });
      expect(await sesiones()).toBe(1);
      expect(registrados).toEqual([]);
    });

    it("con el secreto: despacha lo pendiente y barre lo vencido", async () => {
      const id = await encolar();
      await sesionVencida();
      await sesionVencida();
      const ejecuciones: string[] = [];
      const { dependencias: d } = dependencias(ejecuciones);
      const r = await atenderCron(pedidoDeCron(`Bearer ${SECRETO}`), d);
      expect(r.status).toBe(200);
      const cuerpo = (await r.json()) as {
        ok: boolean;
        despacho: { hechos: number };
        barrido: { sesiones: number };
      };
      expect(cuerpo.ok).toBe(true);
      expect(cuerpo.despacho.hechos).toBe(1);
      expect(cuerpo.barrido.sesiones).toBe(2);
      expect(ejecuciones).toEqual([id]);
      expect(await estadoDe(id)).toEqual({ estado: "HECHO", intentos: 1 });
      expect(await sesiones()).toBe(0);
    });

    it("es idempotente: repetirlo no ejecuta ni borra nada de más", async () => {
      await encolar();
      await sesionVencida();
      const ejecuciones: string[] = [];
      const { dependencias: d } = dependencias(ejecuciones);
      await atenderCron(pedidoDeCron(`Bearer ${SECRETO}`), d);
      const segunda = await atenderCron(pedidoDeCron(`Bearer ${SECRETO}`), d);
      expect(segunda.status).toBe(200);
      expect(await segunda.json()).toMatchObject({
        despacho: { candidatos: 0, hechos: 0 },
        barrido: { sesiones: 0, verificaciones: 0, limitesDePedidos: 0 },
      });
      expect(ejecuciones).toHaveLength(1);
    });

    it("dos llamadas A LA VEZ sobre el mismo trabajo: se despacha UNO solo (ADR-007)", async () => {
      const id = await encolar();
      for (let i = 0; i < 4; i += 1) await sesionVencida();
      const barrera = crearBarrera(2);
      const conBarrera = () => {
        const nuevo = crearEntornoDePrueba(propia.base, 10, (tx: TxDePrueba) => ({
          ...tx,
          cola: {
            ...tx.cola,
            tomar: async (x, ahora, hasta) => {
              if (x === id) await barrera();
              return tx.cola.tomar(x, ahora, hasta);
            },
          },
        }));
        aCerrar.push(nuevo);
        return nuevo;
      };
      const ejecuciones: string[] = [];
      const a = dependencias(ejecuciones, conBarrera());
      const b = dependencias(ejecuciones, conBarrera());
      const [ra, rb] = await Promise.all([
        atenderCron(pedidoDeCron(`Bearer ${SECRETO}`), a.dependencias),
        atenderCron(pedidoDeCron(`Bearer ${SECRETO}`), b.dependencias),
      ]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      expect(ejecuciones).toEqual([id]);
      expect(await estadoDe(id)).toEqual({ estado: "HECHO", intentos: 1 });
      const [ca, cb] = (await Promise.all([ra.json(), rb.json()])) as {
        despacho: { hechos: number; noTomados: number };
        barrido: { sesiones: number };
      }[];
      // Uno lo hizo y el otro no lo tomó; entre los dos, ni un despacho de más.
      expect(ca!.despacho.hechos + cb!.despacho.hechos).toBe(1);
      expect(ca!.despacho.noTomados + cb!.despacho.noTomados).toBe(1);
      // Y el barrido: las cuatro sesiones se borraron una sola vez entre los dos.
      expect(ca!.barrido.sesiones + cb!.barrido.sesiones).toBe(4);
      expect(await sesiones()).toBe(0);
    });

    it("varias llamadas simultáneas y varios trabajos: cada trabajo se ejecuta exactamente una vez", async () => {
      const ids = [await encolar(), await encolar(), await encolar()];
      const ejecuciones: string[] = [];
      const llamadas = await Promise.all(
        Array.from({ length: 4 }, () =>
          atenderCron(pedidoDeCron(`Bearer ${SECRETO}`), dependencias(ejecuciones).dependencias),
        ),
      );
      expect(llamadas.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect([...ejecuciones].sort()).toEqual([...ids].sort());
      for (const id of ids) expect(await estadoDe(id)).toEqual({ estado: "HECHO", intentos: 1 });
    });

    it("si el manejador falla, el trabajo se reprograma (reintento) y el cron igual responde 200", async () => {
      const id = await encolar();
      const { dependencias: d } = dependencias([]);
      const falla: ManejadorDeTrabajo = () =>
        Promise.resolve({ tipo: "ERROR", error: "no se pudo", definitivo: false });
      const r = await atenderCron(pedidoDeCron(`Bearer ${SECRETO}`), {
        ...d,
        procesador: () =>
          crearProcesadorDeTrabajos({
            transacciones: entorno,
            manejadores: new Map([["demo", falla]]),
          }),
      });
      expect(r.status).toBe(200);
      expect(await estadoDe(id)).toEqual({ estado: "PENDIENTE", intentos: 1 });
    });
  });

  describe("la salud", () => {
    const sistemaCon = (url: string, registrar: (d: string) => void) => {
      const conexiones = armarConexiones({
        fuente: () => ({ ZULUHUB_DB_APP: url }),
        registrar,
      });
      aCerrar.push({ cerrar: () => conexiones.lecturasDeSistema().cerrar() });
      return armarSistema(conexiones, { registrar, ahora: () => Date.now() });
    };

    it("con la base arriba: 200 {ok:true}, con el rol limitado de la aplicación y sin tocar datos", async () => {
      const registrados: string[] = [];
      const sistema = sistemaCon(propia.base.app, (d) => registrados.push(d));
      const r = await atenderSalud({ baseResponde: () => sistema.baseResponde()() });
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('{"ok":true}');
      expect(registrados).toEqual([]);
    });

    it("con un rol que no existe: 503 {ok:false} sin ningún detalle; el tipo de la falla va solo al registro", async () => {
      // Un rol inexistente (y no una clave equivocada): el CI acepta cualquier clave (autenticación `trust`).
      const mala = new URL(propia.base.app);
      mala.username = "zuluhub_rol_que_no_existe";
      const registrados: string[] = [];
      const sistema = sistemaCon(mala.toString(), (d) => registrados.push(d));
      const r = await atenderSalud({ baseResponde: () => sistema.baseResponde()() });
      expect(r.status).toBe(503);
      expect(await r.text()).toBe('{"ok":false}');
      expect(registrados).toHaveLength(1);
      expect(registrados[0]).toMatch(/^\[salud\] la base no respondió: \w+( [0-9A-Z]{5})?$/);
      expect(registrados[0]).not.toContain("zuluhub_rol_que_no_existe");
      expect(registrados[0]).not.toContain(new URL(propia.base.app).hostname);
    });

    it("con un host que no existe o no contesta: 503 dentro del plazo, no cuelga el pedido", async () => {
      const lecturas = crearLecturasDeSistema({
        url: "postgres://u:c@127.0.0.1:1/base",
        plazoEnMs: 1_500,
      });
      aCerrar.push(lecturas);
      const t0 = Date.now();
      const r = await atenderSalud({
        baseResponde: () =>
          lecturas.ping().then(
            () => true,
            () => false,
          ),
      });
      expect(r.status).toBe(503);
      expect(Date.now() - t0).toBeLessThan(10_000);
    });

    it("el rol de la aplicación no ve datos de nadie con esta conexión (solo SELECT 1)", async () => {
      const lecturas = crearLecturasDeSistema({ url: propia.base.app });
      aCerrar.push(lecturas);
      await expect(lecturas.ping()).resolves.toBeUndefined();
    });
  });

  describe("P-15: la guarda de migración", () => {
    let carpetaSinLaUltima: string;
    let anteultima: string;
    const conGuarda = (url: string, reloj: { valor: number }, registrados: string[]) => {
      const conexiones = armarConexiones({
        fuente: () => ({ ZULUHUB_DB_APP: url }),
        registrar: (d) => registrados.push(d),
      });
      aCerrar.push({ cerrar: () => conexiones.lecturasDeSistema().cerrar() });
      return armarSistema(conexiones, {
        registrar: (d) => registrados.push(d),
        ahora: () => reloj.valor,
      }).guardaDeMigracion()();
    };

    beforeAll(async () => {
      carpetaSinLaUltima = await mkdtemp(join(tmpdir(), "zuluhub-migraciones-"));
      const archivos = (await readdir(CARPETA_REAL))
        .filter((n) => /^\d{4}_.+\.sql$/.test(n))
        .sort();
      expect(archivos.at(-1)?.slice(0, 4)).toBe(MIGRACION_REQUERIDA);
      anteultima = archivos.at(-2) ?? "";
      for (const archivo of archivos.slice(0, -1)) {
        await copyFile(join(CARPETA_REAL, archivo), join(carpetaSinLaUltima, archivo));
      }
    });
    afterAll(async () => {
      await rm(carpetaSinLaUltima, { recursive: true, force: true });
    });

    it("base al día: sigue (y no vuelve a preguntar)", async () => {
      // La base de esta prueba está migrada por completo: el permiso de lectura de `migracion.nombre` lo da la 0013,
      // sin ninguna concesión extra acá (así la prueba mide lo que la migración entrega de verdad).
      const registrados: string[] = [];
      expect(await conGuarda(propia.base.app, { valor: 0 }, registrados)).toBe(true);
      expect(registrados).toEqual([]);
    });

    it("sin permiso de lectura sobre la tabla de migraciones: falla cerrado (mantenimiento) y lo dice en el registro", async () => {
      const aparte = await crearBaseAparte(base!);
      try {
        // La 0013 le da la lectura de `nombre`: se la quitamos para simular una base sin ese permiso.
        const cliente = new pg.Client({ connectionString: aparte.base.dueno });
        await cliente.connect();
        try {
          await cliente.query("REVOKE SELECT (nombre) ON migracion FROM zuluhub_app");
        } finally {
          await cliente.end();
        }
        const registrados: string[] = [];
        const ok = await conGuarda(aparte.base.app, { valor: 0 }, registrados);
        expect(ok).toBe(false);
        expect(registrados).toEqual([
          "[migración] no se pudo leer la última migración aplicada: error 42501",
        ]);
      } finally {
        await aparte.destruir();
      }
    });

    it("con UNA migración menos que MIGRACION_REQUERIDA → mantenimiento; apenas se migra, la app vuelve sola", async () => {
      const aparte = await crearBaseAparte(base!, { migrar: false });
      try {
        await aplicarMigraciones(aparte.base.dueno, carpetaSinLaUltima);
        const cliente = new pg.Client({ connectionString: aparte.base.dueno });
        await cliente.connect();
        try {
          await cliente.query("GRANT SELECT ON migracion TO zuluhub_app");
          const registrados: string[] = [];
          const reloj = { valor: 0 };
          const conexiones = armarConexiones({
            fuente: () => ({ ZULUHUB_DB_APP: aparte.base.app }),
            registrar: (d) => registrados.push(d),
          });
          aCerrar.push({ cerrar: () => conexiones.lecturasDeSistema().cerrar() });
          const guarda = armarSistema(conexiones, {
            registrar: (d) => registrados.push(d),
            ahora: () => reloj.valor,
          }).guardaDeMigracion();

          expect(await guarda()).toBe(false);
          expect(registrados).toHaveLength(1);
          expect(registrados[0]).toMatch(
            new RegExp(
              `^\\[migración\\] la base está en ${anteultima.replace(".", "\\.")} y el código necesita la ${MIGRACION_REQUERIDA}$`,
            ),
          );
          // Dentro de la espera no se vuelve a preguntar a la base.
          reloj.valor = 9_999;
          expect(await guarda()).toBe(false);
          expect(registrados).toHaveLength(1);

          // El dueño migra (el workflow `migrar.yml`): pasada la espera, la app vuelve sola.
          await aplicarMigraciones(aparte.base.dueno, CARPETA_REAL);
          reloj.valor = 10_000;
          expect(await guarda()).toBe(true);
          // Y un «sí» ya no se vuelve a preguntar, ni mucho tiempo después.
          reloj.valor = 10 ** 12;
          expect(await guarda()).toBe(true);
        } finally {
          await cliente.end();
        }
      } finally {
        await aparte.destruir();
      }
    });

    it("una base sin ninguna migración (ni la tabla de control): falla cerrado", async () => {
      const aparte = await crearBaseAparte(base!, { migrar: false });
      try {
        const registrados: string[] = [];
        const ok = await conGuarda(aparte.base.app, { valor: 0 }, registrados);
        expect(ok).toBe(false);
        expect(registrados).toHaveLength(1);
        expect(registrados[0]).toContain(
          "[migración] no se pudo leer la última migración aplicada",
        );
      } finally {
        await aparte.destruir();
      }
    });
  });
});
