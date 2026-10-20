import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { certificadoId } from "../../src/modulos/fiscal/publico";
import { emisorId, empresaId } from "../../src/primitivas/identificadores/marca";
import { Secreto } from "../../src/primitivas/secreto/secreto";
import type { TicketDeAcceso } from "../../src/puertos/almacen-de-tickets";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  RelojDeCertificados,
  almacenDe,
  casosDeCertificados,
  certificadoDeArca,
  credencialesDe,
  crearEntornoDeCertificados,
  crearServicios,
  escenarioDeCertificados,
  pedidoDeCertificado,
  type ServiciosDePrueba,
} from "./certificados-apoyo";

/**
 * H7 facturación, tramo F7: concurrencia REAL de los certificados (§D, «Concurrencia»). Con una barrera dentro de cada
 * transacción (en la primera lectura del certificado) se fuerza que todas las llamadas lean el mismo estado antes de
 * que cualquiera escriba. Después se mira la base: nunca dos vigentes, nunca una clave que no sea la del pedido que
 * se devolvió, y quien pierde la carrera recibe el MISMO resultado exitoso (la acción era la misma) o uno con nombre.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

/** Rondas de cada prueba; la estabilidad local y el CI pueden subirlas con la variable. */
const RONDAS = Number(process.env["PEDERNAL_RONDAS_CERTIFICADOS"] ?? "3");
const HORA = 3_600_000;

describe.skipIf(base === null)("certificados F7: concurrencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeCertificados>;
  let servicios: ServiciosDePrueba;
  let casos: ReturnType<typeof casosDeCertificados>;
  /** Mientras haya una barrera, toda transacción espera en ella al leer un certificado. */
  let barrera: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeCertificados(propia.base, 16, (tx) => ({
      ...tx,
      certificados: {
        ...tx.certificados,
        obtener: async (...args) => {
          const c = await tx.certificados.obtener(...args);
          if (barrera !== null) await barrera();
          return c;
        },
      },
    }));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    servicios = await crearServicios();
    casos = casosDeCertificados(entorno, servicios);
  }, 120_000);
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows;

  async function juntas<T>(n: number, llamada: (i: number) => Promise<T>): Promise<T[]> {
    barrera = crearBarrera(n);
    try {
      return await Promise.all(Array.from({ length: n }, (_, i) => llamada(i)));
    } finally {
      barrera = null;
    }
  }

  const vigentesDe = async (e: { empresa: string; emisor: string }, ambiente = "HOMOLOGACION") =>
    await filas<{ id: string; estado: string }>(
      `select id, estado from certificado_arca where empresa_id = $1 and emisor_id = $2 and ambiente = $3 and estado = 'VIGENTE'`,
      [e.empresa, e.emisor, ambiente],
    );
  const auditoriasDe = async (empresa: string, accion: string) =>
    (
      await filas("select 1 from auditoria_empresa where empresa_id = $1 and accion = $2", [
        empresa,
        accion,
      ])
    ).length;

  /** Un pedido ya generado (sin concurrencia) y el certificado que ARCA devolvería. */
  async function pedirYEmitir(
    e: Awaited<ReturnType<typeof escenarioDeCertificados>>,
    alias?: string,
  ) {
    const entrada = pedidoDeCertificado(e, alias === undefined ? {} : { alias });
    const r = await casos.generarPedidoDeCertificado(e.como(new Date()), entrada);
    if (!r.ok) throw new Error(`pedido: ${JSON.stringify(r.error)}`);
    return {
      id: entrada.id,
      pem: await certificadoDeArca(servicios, "HOMOLOGACION", r.valor.pedidoPem),
    };
  }

  const cargar = (
    e: Awaited<ReturnType<typeof escenarioDeCertificados>>,
    id: string,
    pem: string,
  ) =>
    casos.cargarCertificado(e.como(new Date()), {
      certificadoId: certificadoId(id),
      certificadoPem: pem,
    });

  // ===============================================================================================
  it("el mismo pedido a la vez N veces: una sola clave guardada, todos reciben el mismo pedido y solo uno lo creó", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await escenarioDeCertificados(dueno, propia.base);
      const entrada = pedidoDeCertificado(e);
      const antes = servicios.clavesGeneradas.length;
      const rs = await juntas(4, () =>
        casos.generarPedidoDeCertificado(e.como(new Date()), entrada),
      );

      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);
      const salidas = rs.flatMap((r) => (r.ok ? [r.valor] : []));
      expect(salidas.filter((s) => !s.yaExistia)).toHaveLength(1);
      expect(new Set(salidas.map((s) => s.pedidoPem)).size).toBe(1);
      expect(
        await filas("select 1 from certificado_arca where id = $1", [entrada.id]),
      ).toHaveLength(1);
      expect(await auditoriasDe(e.empresa, "CERTIFICADO_PEDIDO_GENERADO")).toBe(1);

      // Se pudieron generar varias claves, pero se guardó UNA y es la del pedido que todos recibieron: el certificado que
      // ARCA emite para ese pedido corresponde a la clave guardada (no a la de un perdedor descartado).
      expect(servicios.clavesGeneradas.length).toBeGreaterThanOrEqual(antes + 1);
      const pem = await certificadoDeArca(servicios, "HOMOLOGACION", salidas[0]?.pedidoPem ?? "");
      const carga = await cargar(e, entrada.id, pem);
      expect(carga, "el certificado del pedido devuelto carga con la clave guardada").toMatchObject(
        { ok: true },
      );
    }
  });

  it("dos pedidos con el mismo alias y distinto id son dos pedidos independientes: cada clave con el suyo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await escenarioDeCertificados(dueno, propia.base);
      const a = pedidoDeCertificado(e, { alias: "mismoalias" });
      const b = pedidoDeCertificado(e, { alias: "mismoalias" });
      const rs = await juntas(2, (i) =>
        casos.generarPedidoDeCertificado(e.como(new Date()), i === 0 ? a : b),
      );
      expect(
        rs.every((r) => r.ok && !r.valor.yaExistia),
        JSON.stringify(rs),
      ).toBe(true);
      const filasDelAlias = await filas<{ id: string; kid: string }>(
        "select id, clave_kid as kid, encode(clave_cifrada, 'hex') as c from certificado_arca where empresa_id = $1 and alias = 'mismoalias'",
        [e.empresa],
      );
      expect(filasDelAlias).toHaveLength(2);
      expect(new Set(filasDelAlias.map((f) => (f as unknown as { c: string }).c)).size).toBe(2);
      // El certificado de cada pedido solo sirve con su propia clave.
      const pa = rs[0]?.ok ? rs[0].valor.pedidoPem : "";
      const pb = rs[1]?.ok ? rs[1].valor.pedidoPem : "";
      const deA = await certificadoDeArca(servicios, "HOMOLOGACION", pa);
      const deB = await certificadoDeArca(servicios, "HOMOLOGACION", pb);
      expect(await cargar(e, b.id, deA)).toEqual({ ok: false, error: "NO_CORRESPONDE_A_LA_CLAVE" });
      expect(await cargar(e, a.id, deB)).toEqual({ ok: false, error: "NO_CORRESPONDE_A_LA_CLAVE" });
      const carga1 = await cargar(e, a.id, deA);
      expect(carga1.ok, JSON.stringify(carga1)).toBe(true);
      expect(await cargar(e, b.id, deB)).toMatchObject({ ok: true, valor: { reemplazoA: a.id } });
    }
  });

  it("el mismo certificado cargado a la vez N veces: todos ok, uno solo lo cargó, un solo vigente, una sola auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await escenarioDeCertificados(dueno, propia.base);
      const { id, pem } = await pedirYEmitir(e);
      const rs = await juntas(4, () => cargar(e, id, pem));
      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);
      const salidas = rs.flatMap((r) => (r.ok ? [r.valor] : []));
      expect(salidas.filter((s) => !s.yaEstaba)).toHaveLength(1);
      expect(new Set(salidas.map((s) => s.vence.getTime())).size).toBe(1);
      expect((await vigentesDe(e)).map((v) => v.id)).toEqual([id]);
      expect(await auditoriasDe(e.empresa, "CERTIFICADO_CARGADO")).toBe(1);
      expect(await auditoriasDe(e.empresa, "CERTIFICADO_REEMPLAZADO")).toBe(0);
    }
  });

  it("certificados distintos cargados a la vez para el mismo emisor y ambiente: todos ok, uno solo queda vigente y los demás reemplazados", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await escenarioDeCertificados(dueno, propia.base);
      const pedidos = await Promise.all([0, 1, 2, 3].map(() => pedirYEmitir(e)));
      const rs = await juntas(pedidos.length, (i) =>
        cargar(e, pedidos[i]?.id ?? "", pedidos[i]?.pem ?? ""),
      );
      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);

      const estados = await filas<{ id: string; estado: string }>(
        "select id, estado from certificado_arca where empresa_id = $1 order by id",
        [e.empresa],
      );
      expect(estados.filter((s) => s.estado === "VIGENTE")).toHaveLength(1);
      expect(estados.filter((s) => s.estado === "REEMPLAZADO")).toHaveLength(3);
      // Cada carga que reemplazó a uno lo dice, y cada reemplazado figura una sola vez.
      const reemplazados = rs.flatMap((r) =>
        r.ok && r.valor.reemplazoA !== null ? [r.valor.reemplazoA] : [],
      );
      expect(new Set(reemplazados).size).toBe(reemplazados.length);
      expect(reemplazados).toHaveLength(3);
      expect(await auditoriasDe(e.empresa, "CERTIFICADO_CARGADO")).toBe(4);
      expect(await auditoriasDe(e.empresa, "CERTIFICADO_REEMPLAZADO")).toBe(3);
    }
  });

  it("el reemplazo contra consultas de credenciales y de ticket: nunca un hueco, nunca una clave que no sea la de su certificado", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await escenarioDeCertificados(dueno, propia.base);
      const primero = await pedirYEmitir(e);
      const carga2 = await cargar(e, primero.id, primero.pem);
      expect(carga2.ok, JSON.stringify(carga2)).toBe(true);
      const segundo = await pedirYEmitir(e);
      const reloj = new RelojDeCertificados(new Date());
      const credenciales = credencialesDe(entorno, servicios, reloj);
      const almacen = almacenDe(entorno, servicios, reloj);
      const empresa = empresaId(e.empresa);
      const emisor = emisorId(e.emisor);

      const [carga, ...lecturas] = await Promise.all([
        cargar(e, segundo.id, segundo.pem),
        ...Array.from({ length: 8 }, () => credenciales.obtener(empresa, emisor, "HOMOLOGACION")),
        ...Array.from({ length: 4 }, () => almacen.leer(empresa, emisor, "HOMOLOGACION", "wsfe")),
      ]);
      expect(carga).toMatchObject({ ok: true, valor: { reemplazoA: primero.id } });
      for (const lectura of lecturas.slice(0, 8)) {
        const l = lectura as Awaited<ReturnType<typeof credenciales.obtener>>;
        expect(l.ok, JSON.stringify(l)).toBe(true);
        if (!l.ok) continue;
        expect([primero.id, segundo.id]).toContain(l.valor.certificadoId);
        expect(
          servicios.lector.correspondeALaClave(l.valor.certificadoPem, l.valor.clavePrivada),
        ).toBe(true);
      }
      for (const lectura of lecturas.slice(8)) expect(lectura).toEqual({ ok: true, valor: null });
      const despues = await credenciales.obtener(empresa, emisor, "HOMOLOGACION");
      expect(despues.ok && despues.valor.certificadoId).toBe(segundo.id);
    }
  });

  it("guardar tickets a la vez: gana el más nuevo y los repetidos auditan una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await escenarioDeCertificados(dueno, propia.base);
      const cert = await pedirYEmitir(e);
      const carga3 = await cargar(e, cert.id, cert.pem);
      expect(carga3.ok, JSON.stringify(carga3)).toBe(true);
      const reloj = new RelojDeCertificados(new Date());
      const almacen = almacenDe(entorno, servicios, reloj);
      const empresa = empresaId(e.empresa);
      const emisor = emisorId(e.emisor);
      const desde = reloj.ahora();
      const ticket = (token: string, minutos: number): TicketDeAcceso => ({
        certificadoId: cert.id,
        token: new Secreto(token),
        firma: new Secreto(`firma-${token}`),
        generadoEn: new Date(desde.getTime() + minutos * 60_000),
        venceEn: new Date(desde.getTime() + minutos * 60_000 + 12 * HORA),
      });
      const tickets = [
        ticket("T0", 0),
        ticket("T1", 1),
        ticket("T2", 2),
        ticket("T2", 2),
        ticket("T1", 1),
      ];
      const rs = await Promise.all(
        tickets.map((t) => almacen.guardar(empresa, emisor, "HOMOLOGACION", "wsfe", t)),
      );
      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);
      const leido = await almacen.leer(empresa, emisor, "HOMOLOGACION", "wsfe");
      expect(leido.ok && leido.valor?.token.revelar()).toBe("T2");
      expect(leido.ok && leido.valor?.firma.revelar()).toBe("firma-T2");
      expect(
        await filas("select 1 from acceso_arca where empresa_id = $1", [e.empresa]),
      ).toHaveLength(1);
      // Cada ticket distinto que llegó a ser el guardado dejó su auditoría; nunca más de una por ticket.
      const n = await auditoriasDe(e.empresa, "ACCESO_ARCA_RENOVADO");
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it("la clave de una empresa nunca se mezcla con la de otra aunque se pidan a la vez con el mismo alias", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const a = await escenarioDeCertificados(dueno, propia.base);
      const b = await escenarioDeCertificados(dueno, propia.base);
      const ida = randomUUID();
      const idb = randomUUID();
      const [ra, rb] = await juntas(2, (i) =>
        casos.generarPedidoDeCertificado(
          (i === 0 ? a : b).como(new Date()),
          pedidoDeCertificado(i === 0 ? a : b, { id: i === 0 ? ida : idb, alias: "igual" }),
        ),
      );
      expect(ra).toMatchObject({ ok: true });
      expect(rb).toMatchObject({ ok: true });
      const pemDeA = ra?.ok ? ra.valor.pedidoPem : "";
      const certDeA = await certificadoDeArca(servicios, "HOMOLOGACION", pemDeA);
      expect(await cargar(b, idb, certDeA)).toEqual({
        ok: false,
        error: "NO_CORRESPONDE_A_LA_CLAVE",
      });
      expect(await cargar(b, ida, certDeA)).toEqual({
        ok: false,
        error: "CERTIFICADO_NO_ENCONTRADO",
      });
      const carga4 = await cargar(a, ida, certDeA);
      expect(carga4.ok, JSON.stringify(carga4)).toBe(true);
    }
  });
});
