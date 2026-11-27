import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { altaDeCliente } from "../../scripts/ejecutar-alta-de-cliente";
import { reemitirInvitacionDeCliente } from "../../scripts/ejecutar-reemitir-invitacion-de-cliente";
import { leerEstadoDelAlta } from "../../src/adaptadores/postgres/estado-del-alta";
import { TRABAJO_ENVIAR_INVITACION } from "../../src/modulos/identidad/publico";
import { armarCasosDeLaLista } from "../../scripts/ejecutar-caso-desde-archivo";
import { ejecutarCreacionDelPrimerAdmin } from "../../scripts/ejecutar-crear-primer-admin";
import { ejecutorDeCasos } from "../../scripts/ejecutar-preparar-empresa-de-pruebas";
import { armarPlataforma } from "../../src/composicion/plataforma";
import { crearBaseAparte, cuitUnico } from "./entorno";

/**
 * El alta de un cliente de punta a punta contra Postgres REAL y los casos de plataforma REALES (no casos falsos): lo que solo el caso real rechaza (caso real, 27/11/2026: un módulo obligatorio como
 * módulo inicial de la marca paró el alta en el paso 6) se ve acá. Con el archivo real de hdn y dominios de prueba; la espera a que la marca rija adelanta la vigencia en la base (el reloj no se puede adelantar).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 240_000 });

const ADMIN = "admin.alta@ejemplo.test";
const GERENTE = "gerente.alta@ejemplo.test";
const HEX = "ab12".repeat(16);

describe.skipIf(base === null)("alta de un cliente de punta a punta", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base, { sinMarcaDePrueba: true });
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  it("deja el administrador, el plan, la marca, los dominios, la empresa con su invitación y los módulos; repetirlo no duplica nada", async () => {
    if (base === null) return;
    const clave = `${String(propia.base.clave.kid)}:${propia.base.clave.secreto.toString("hex")}`;
    const host = new URL(propia.base.dueno).hostname;
    const entorno = {
      PEDERNAL_DB_MIGRACIONES: propia.base.dueno,
      PEDERNAL_DB_PLATAFORMA: propia.base.plataforma,
      PEDERNAL_CLAVE_CONTEXTO: clave,
      PEDERNAL_SECRETO_INVITACIONES: HEX,
      PEDERNAL_HOSTS_PROTEGIDOS: "consola.e2e.test,web.e2e.test",
      PEDERNAL_HOST_DE_LA_BASE: host,
      PEDERNAL_ALTA_DE_CLIENTE: JSON.stringify({
        adminEmail: ADMIN,
        emailGerente: GERENTE,
        cuit: cuitUnico(),
        razonSocial: "Hotel de Prueba SA",
        nombreDeTenant: "hotel-de-prueba",
      }),
    };
    const archivoReal = (
      await import("../../scripts/clientes/hdn.json", { with: { type: "json" } })
    ).default as { dominios: Array<{ host: string }> };
    // Dominios de prueba (el archivo real trae los del hotel: acá se cambian solo los hosts).
    const archivo = {
      ...archivoReal,
      dominios: archivoReal.dominios.map((d, i) => ({
        ...d,
        host: `${i === 0 ? "app" : "carta"}.e2e-alta.test`,
      })),
    };

    const salida: string[] = [];
    const correr = async () => {
      const plataforma = armarPlataforma({ fuente: () => entorno });
      try {
        return await altaDeCliente({
          ambiente: "cliente-hdn",
          entorno,
          leerDatosDelCliente: () => archivo,
          sembrarAdmin: (email, s) =>
            ejecutarCreacionDelPrimerAdmin({
              argumentos: [email],
              entorno,
              info: s.info,
              error: s.error,
            }),
          ejecutarCaso: ejecutorDeCasos({
            entorno,
            ahora: () => new Date(),
            buscarAdmin: plataforma.buscarAdmin,
            casos: armarCasosDeLaLista(plataforma),
          }),
          info: (l) => salida.push(l),
          error: (l) => salida.push(`ERR ${l}`),
          comando: () => undefined,
          // El reloj no se adelanta: la marca "ya rige" cuando se espera.
          esperar: async () => {
            await dueno.query("set session_replication_role = replica");
            await dueno.query(
              "update version_de_marca set vigente_desde = confirmada_en - interval '30 seconds' where estado = 'CONFIRMADA' and vigente_desde > now()",
            );
            await dueno.query("set session_replication_role = origin");
          },
        });
      } finally {
        await plataforma.cerrar();
      }
    };

    const codigo = await correr();
    expect(codigo, salida.join("\n")).toBe(0);
    const n = async (tabla: string) =>
      Number(
        ((await dueno.query(`select count(*) as n from ${tabla}`)).rows[0] as { n: string }).n,
      );
    expect(await n("admin_plataforma")).toBeGreaterThanOrEqual(1);
    expect(await n("empresa")).toBe(1);
    const dominios = (await dueno.query("select host, estado from dominio order by host"))
      .rows as Array<{ host: string; estado: string }>;
    expect(dominios).toEqual([
      { host: "app.e2e-alta.test", estado: "ACTIVO" },
      { host: "carta.e2e-alta.test", estado: "ACTIVO" },
    ]);
    const empresasAntes = await n("empresa");
    const modulosAntes = await n("modulo_de_empresa");
    expect(modulosAntes).toBeGreaterThan(0);

    // Repetirlo (otra corrida: otro instante) no duplica nada.
    const otra = await correr();
    expect(otra, salida.join("\n")).toBe(0);
    expect(await n("empresa")).toBe(empresasAntes);
    expect(await n("modulo_de_empresa")).toBe(modulosAntes);
  });

  it("reemitir la invitación del gerente con el mail ya enviado (trabajo HECHO): revoca la vieja y emite otra; con el mismo estado no duplica; otra corrida reemite a propósito", async () => {
    if (base === null) return;
    const clave = `${String(propia.base.clave.kid)}:${propia.base.clave.secreto.toString("hex")}`;
    const entorno = {
      PEDERNAL_DB_MIGRACIONES: propia.base.dueno,
      PEDERNAL_DB_PLATAFORMA: propia.base.plataforma,
      PEDERNAL_CLAVE_CONTEXTO: clave,
      PEDERNAL_SECRETO_INVITACIONES: HEX,
      PEDERNAL_HOST_DE_LA_BASE: new URL(propia.base.dueno).hostname,
    };
    const pendientes = async () =>
      (
        await dueno.query<{ id: string }>("select id from invitacion where estado = 'PENDIENTE'")
      ).rows.map((r) => r.id);
    const total = async () =>
      Number(
        ((await dueno.query("select count(*) as n from invitacion")).rows[0] as { n: string }).n,
      );
    const trabajos = async () =>
      (
        await dueno.query<{ estado: string }>(
          "select estado from trabajo where tipo = $1 order by creado_en",
          [TRABAJO_ENVIAR_INVITACION],
        )
      ).rows.map((r) => r.estado);

    // El estado de partida: el alta ya hecha (el test anterior) y el trabajo de envío de la invitación vieja ya HECHO (el cron lo procesó con el secreto viejo).
    const [vieja] = await pendientes();
    expect(vieja).toBeDefined();
    for (const estado of ["EN_CURSO", "HECHO"]) {
      await dueno.query("update trabajo set estado = $2 where tipo = $1", [
        TRABAJO_ENVIAR_INVITACION,
        estado,
      ]);
    }
    const estadoViejo = await leerEstadoDelAlta(propia.base.dueno);

    const salida: string[] = [];
    const reemitir = async (leerEstado: typeof leerEstadoDelAlta) => {
      const plataforma = armarPlataforma({ fuente: () => entorno });
      try {
        return await reemitirInvitacionDeCliente({
          ambiente: "cliente-hdn",
          entorno,
          leerEstado,
          ejecutarCaso: ejecutorDeCasos({
            entorno,
            ahora: () => new Date(),
            buscarAdmin: plataforma.buscarAdmin,
            casos: armarCasosDeLaLista(plataforma),
          }),
          info: (l) => salida.push(l),
          error: (l) => salida.push(`ERR ${l}`),
          comando: () => undefined,
        });
      } finally {
        await plataforma.cerrar();
      }
    };

    const antes = await total();
    expect(await reemitir(leerEstadoDelAlta), salida.join("\n")).toBe(0);
    const [nueva, ...resto] = await pendientes();
    expect(resto).toEqual([]);
    expect(nueva).not.toBe(vieja);
    expect(await total()).toBe(antes + 1);
    expect(
      (await dueno.query("select estado from invitacion where id = $1", [vieja])).rows[0],
    ).toEqual({ estado: "REVOCADA" });
    // El trabajo de la vieja sigue HECHO y hay uno nuevo pendiente para la invitación nueva.
    expect(await trabajos()).toEqual(["HECHO", "PENDIENTE"]);

    // Repetir con el MISMO estado (un reintento antes de ver el cambio): misma clave, no emite otra ni encola otro mail.
    expect(await reemitir(() => Promise.resolve(estadoViejo)), salida.join("\n")).toBe(0);
    expect(await total()).toBe(antes + 1);
    expect(await pendientes()).toEqual([nueva]);
    expect(await trabajos()).toEqual(["HECHO", "PENDIENTE"]);

    // Otra corrida, con el estado real (la pendiente es la nueva): reemite a propósito, siempre con UNA sola pendiente.
    expect(await reemitir(leerEstadoDelAlta), salida.join("\n")).toBe(0);
    expect(await total()).toBe(antes + 2);
    expect(await pendientes()).toHaveLength(1);
    expect(await pendientes()).not.toEqual([nueva]);
  });
});
