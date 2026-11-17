import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { SEGUNDOS_ENTRE_ESCRITURAS_DE_USO } from "../../src/capacidades/autenticacion/vigencia-de-sesion";
import { crearBaseAparte } from "./entorno";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";

/**
 * El uso de la sesión de empresa se escribe en la base como máximo una vez por minuto (decisión del dueño, 2026-11-07), sin tocar
 * ninguna otra regla de la sesión: la revocación sigue siendo inmediata, el tope de 8 horas se respeta, el «Seguir» escribe siempre y la
 * tolerancia cae del lado seguro (la sesión se da por vencida antes, nunca después). Previene: una escritura a la base por cada pantalla
 * (un viaje más por pedido) y, al revés, que ahorrarla deje una sesión viva más allá de lo decidido.
 */

const base = inject("baseDePruebas");
const HOST = "app.marca-uso.test";
const MINUTO = 60_000;

describe.skipIf(base === null)("sesión: el uso se escribe como máximo una vez por minuto", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let proveedor: ProveedorLocal;
  let a: AutenticacionDePrueba;
  let dueno: pg.Client;

  type Fila = { id: string; createdAt: Date; updatedAt: Date; expiresAt: Date };

  async function ingresado(): Promise<Navegador> {
    const n = new Navegador();
    const r = await n.ingresarConGoogle(a.autenticacion, HOST, proveedor, perfilAlAzar());
    expect(r.estado).toBe(302);
    return n;
  }
  async function filaDe(n: Navegador): Promise<Fila> {
    const cookie = n.cookiesDe(HOST).find((c) => c.nombre.endsWith("session_token"));
    const token = decodeURIComponent(cookie?.valor ?? "").split(".")[0];
    const { rows } = await dueno.query<Fila>(
      `select id, "createdAt", "updatedAt", "expiresAt" from autenticacion.session where token = $1`,
      [token],
    );
    const fila = rows[0];
    if (fila === undefined) throw new Error("la sesión no está en la base");
    return fila;
  }
  /** Deja la sesión como si su último uso escrito fuera de hace `hace` ms (vence 15 minutos después de ese uso). */
  async function ultimoUsoEscritoHace(n: Navegador, hace: number, creadaHace?: number) {
    const f = await filaDe(n);
    const seg = (ms: number) => `${ms / 1000} seconds`;
    await dueno.query(
      `update autenticacion.session
          set "updatedAt" = now() - interval '${seg(hace)}',
              "expiresAt" = now() - interval '${seg(hace)}' + interval '${seg(15 * MINUTO)}'
              ${creadaHace === undefined ? "" : `, "createdAt" = now() - interval '${seg(creadaHace)}'`}
        where id = $1`,
      [f.id],
    );
  }
  const vista = (n: Navegador) => a.autenticacion.sesionDe(n.pedidoDe(HOST), HOST);
  const seguir = (n: Navegador) =>
    a.autenticacion.sesionDe(n.pedidoDe(HOST), HOST, { renovarYa: true });

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("NODE_ENV", "production");
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    proveedor = await levantarProveedorLocal();
    a = armarAutenticacionDePrueba(propia.base, proveedor);
  });
  afterAll(async () => {
    await a.cerrar();
    await dueno.end();
    await proveedor.cerrar();
    await propia.destruir();
    vi.unstubAllEnvs();
  });

  it("la tolerancia aprobada es de 1 minuto", () => {
    expect(SEGUNDOS_ENTRE_ESCRITURAS_DE_USO).toBe(60);
  });

  it("varias vistas seguidas NO escriben en la base: la fila queda igual y no hay cookie nueva", async () => {
    const n = await ingresado();
    const antes = await filaDe(n);
    for (let i = 0; i < 5; i++) {
      const s = await vista(n);
      expect(s).not.toBeNull();
      expect(s?.cookiesDeRespuesta).toEqual([]);
    }
    const despues = await filaDe(n);
    expect(despues.updatedAt).toEqual(antes.updatedAt);
    expect(despues.expiresAt).toEqual(antes.expiresAt);
  });

  it("pasado el minuto desde el último uso escrito, la vista siguiente escribe y renueva la cookie", async () => {
    const n = await ingresado();
    await ultimoUsoEscritoHace(n, 61_000);
    const antes = await filaDe(n);
    const s = await vista(n);
    expect(s).not.toBeNull();
    expect(s?.cookiesDeRespuesta.length).toBeGreaterThan(0);
    const despues = await filaDe(n);
    expect(despues.updatedAt.getTime()).toBeGreaterThan(antes.updatedAt.getTime() + 55_000);
    // Y vence 15 minutos después de ahora, no del uso anterior.
    expect(despues.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * MINUTO);
  });

  it("el «Seguir» (renovarYa) escribe SIEMPRE, aunque el uso se haya anotado recién, y trae la cookie", async () => {
    const n = await ingresado();
    await ultimoUsoEscritoHace(n, 10_000);
    const antes = await filaDe(n);
    const s = await seguir(n);
    expect(s).not.toBeNull();
    expect(s?.cookiesDeRespuesta.join("\n")).toContain("session_token=");
    const despues = await filaDe(n);
    expect(despues.updatedAt.getTime()).toBeGreaterThan(antes.updatedAt.getTime() + 5_000);
  });

  it("la revocación sigue siendo inmediata: borrada la sesión, la vista siguiente ya no la ve (sin esperar al minuto)", async () => {
    const n = await ingresado();
    expect(await vista(n)).not.toBeNull();
    await dueno.query(`delete from autenticacion.session where id = $1`, [(await filaDe(n)).id]);
    expect(await vista(n)).toBeNull();
    expect(await seguir(n)).toBeNull();
  });

  it("la tolerancia cae del lado seguro: sin uso escrito en 15 minutos está vencida, y a los 14:59 sigue viva", async () => {
    const viva = await ingresado();
    await ultimoUsoEscritoHace(viva, 15 * MINUTO - 1_000);
    expect(await vista(viva)).not.toBeNull();
    const vencida = await ingresado();
    await ultimoUsoEscritoHace(vencida, 15 * MINUTO + 1_000);
    expect(await vista(vencida)).toBeNull();
    expect(await seguir(vencida)).toBeNull();
  });

  it("el tope de 8 horas desde el ingreso se respeta con el uso espaciado y con el «Seguir»", async () => {
    const n = await ingresado();
    await ultimoUsoEscritoHace(n, 2 * MINUTO, 8 * 3_600_000 - 5 * MINUTO);
    const antes = await filaDe(n);
    expect(await vista(n)).not.toBeNull();
    const despues = await filaDe(n);
    // Se renovó, pero sin pasar de las 8 horas de creada.
    expect(despues.expiresAt.getTime()).toBeLessThanOrEqual(
      antes.createdAt.getTime() + 8 * 3_600_000,
    );
    await ultimoUsoEscritoHace(n, 2 * MINUTO, 8 * 3_600_000 + MINUTO);
    expect(await vista(n)).toBeNull();
    expect(await seguir(n)).toBeNull();
  });
});
