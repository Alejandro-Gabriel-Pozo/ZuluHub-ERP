import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearVerificacionDeAutorizacion } from "../../src/adaptadores/certificados/verificacion-de-autorizacion";
import { certificadoId } from "../../src/modulos/fiscal/publico";
import { emisorId, empresaId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  casosDeCertificados,
  certificadoDeArca,
  crearEntornoDeCertificados,
  crearServicios,
  cuitConPrefijo,
  escenarioDeSociedad,
  pedidoDeCertificado,
  type ServiciosDePrueba,
} from "./certificados-apoyo";
import { crearBaseAparte } from "./entorno";
import { crearEntornoDeConsultas, type EntornoDeConsultas } from "./facturacion-consultas-apoyo";
import { crearMembresiaDeBase } from "./fixtures-identidad";

/**
 * D-42: la consulta de SOLO LECTURA del estado de los certificados de un emisor (falta cargar, pedido generado, vigente con
 * su vencimiento y si ARCA ya aceptó su autorización), contra una base real, con el rol limitado de la aplicación y el guard
 * primero. Nunca devuelve la clave, el pedido, el certificado ni la huella.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const DIA = 86_400_000;

describe.skipIf(base === null)("certificados D-42: consulta del estado de los certificados", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeCertificados>;
  let servicios: ServiciosDePrueba;
  let casos: ReturnType<typeof casosDeCertificados>;
  let entornoDeConsultas: EntornoDeConsultas;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeCertificados(propia.base, 8);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    servicios = await crearServicios();
    casos = casosDeCertificados(entorno, servicios);
    entornoDeConsultas = crearEntornoDeConsultas(propia.base);
  }, 120_000);
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoDeConsultas.transacciones.cerrar();
    await propia.destruir();
  });

  type Sociedad = Awaited<ReturnType<typeof escenarioDeSociedad>>;
  const ver = (e: Sociedad, ahora = new Date(), emisor: string = e.emisor) =>
    entornoDeConsultas
      .consultas()
      .estadoDeCertificados(e.como(ahora), { emisorId: emisorId(emisor) });
  type Situaciones = NonNullable<
    Awaited<ReturnType<typeof ver>> extends infer R
      ? R extends { ok: true; valor: infer V }
        ? V
        : never
      : never
  >;
  const situaciones = async (e: Sociedad, ahora = new Date()) => {
    const r = await ver(e, ahora);
    if (!r.ok) throw new Error(`consulta: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const de = (lista: Situaciones, ambiente: string) => lista.find((s) => s.ambiente === ambiente);

  async function pedir(e: Sociedad, cambios: Parameters<typeof pedidoDeCertificado>[1] = {}) {
    const entrada = pedidoDeCertificado(e, { cuitTitular: cuitConPrefijo("20"), ...cambios });
    const r = await casos.generarPedidoDeCertificado(e.como(new Date()), entrada);
    if (!r.ok) throw new Error(`pedido: ${JSON.stringify(r.error)}`);
    return { entrada, salida: r.valor };
  }
  async function cargar(
    e: Sociedad,
    p: Awaited<ReturnType<typeof pedir>>,
    opciones: Parameters<typeof certificadoDeArca>[3] = {},
  ) {
    const r = await casos.cargarCertificado(e.como(new Date()), {
      certificadoId: certificadoId(p.entrada.id),
      certificadoPem: await certificadoDeArca(
        servicios,
        p.entrada.ambiente,
        p.salida.pedidoPem,
        opciones,
      ),
    });
    if (!r.ok) throw new Error(`carga: ${JSON.stringify(r.error)}`);
  }

  it("sin pedido ni certificado: falta cargar, en los dos ambientes", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    expect(await situaciones(e)).toEqual([
      { ambiente: "HOMOLOGACION", situacion: "FALTA_CARGAR" },
      { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR" },
    ]);
  });

  it("con el pedido generado: pedido generado, con su id, alias y el titular declarado; el otro ambiente sigue sin nada", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const titular = cuitConPrefijo("20");
    const p = await pedir(e, { cuitTitular: titular });
    const lista = await situaciones(e);
    expect(de(lista, "HOMOLOGACION")).toMatchObject({
      ambiente: "HOMOLOGACION",
      situacion: "PEDIDO_GENERADO",
      certificadoId: p.entrada.id,
      alias: p.entrada.alias,
      cuitTitular: titular,
    });
    expect((de(lista, "HOMOLOGACION") as { creadoEn: unknown }).creadoEn).toBeInstanceOf(Date);
    expect(de(lista, "PRODUCCION")).toEqual({ ambiente: "PRODUCCION", situacion: "FALTA_CARGAR" });
  });

  it("con varios pedidos pendientes muestra el último", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    await pedir(e);
    const ultimo = await pedir(e);
    expect(de(await situaciones(e), "HOMOLOGACION")).toMatchObject({
      situacion: "PEDIDO_GENERADO",
      certificadoId: ultimo.entrada.id,
    });
  });

  it("con el certificado cargado: vigente, hasta cuándo vence y «autorización sin verificar»; no vencido", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const titular = cuitConPrefijo("20");
    const p = await pedir(e, { cuitTitular: titular });
    const noDespues = new Date(Date.now() + 400 * DIA);
    noDespues.setMilliseconds(0);
    await cargar(e, p, { noDespues });
    expect(de(await situaciones(e), "HOMOLOGACION")).toEqual({
      ambiente: "HOMOLOGACION",
      situacion: "VIGENTE",
      certificadoId: p.entrada.id,
      alias: p.entrada.alias,
      cuitTitular: titular,
      venceEn: noDespues,
      vencido: false,
      autorizacion: { estado: "SIN_VERIFICAR" },
    });
  });

  it("la primera llamada exitosa la deja «autorización verificada», con la hora; siguen siendo vigente y del mismo titular", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const p = await pedir(e);
    await cargar(e, p);
    const hora = new Date("2026-10-29T15:30:00.000Z");
    await crearVerificacionDeAutorizacion({
      transacciones: entorno,
      reloj: { ahora: () => hora },
    }).anotar(empresaId(e.empresa), p.entrada.id);
    expect(de(await situaciones(e), "HOMOLOGACION")).toMatchObject({
      situacion: "VIGENTE",
      autorizacion: { estado: "VERIFICADA", en: hora },
    });
  });

  it("vencido se calcula con la hora del contexto: en el instante del vencimiento ya venció; un milisegundo antes, no", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const p = await pedir(e);
    const noDespues = new Date(Date.now() + 100 * DIA);
    noDespues.setMilliseconds(0);
    await cargar(e, p, { noDespues });
    const vencido = async (ahora: Date) =>
      (de(await situaciones(e, ahora), "HOMOLOGACION") as { vencido?: boolean }).vencido;
    expect(await vencido(new Date(noDespues.getTime() - 1))).toBe(false);
    expect(await vencido(noDespues)).toBe(true);
    expect(await vencido(new Date(noDespues.getTime() + DIA))).toBe(true);
  });

  it("con un vigente y un pedido nuevo (renovación) sigue mostrando el vigente; cada ambiente tiene el suyo", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const vigente = await pedir(e);
    await cargar(e, vigente);
    await pedir(e);
    const prod = await pedir(e, { ambiente: "PRODUCCION" });
    const lista = await situaciones(e);
    expect(de(lista, "HOMOLOGACION")).toMatchObject({
      situacion: "VIGENTE",
      certificadoId: vigente.entrada.id,
    });
    expect(de(lista, "PRODUCCION")).toMatchObject({
      situacion: "PEDIDO_GENERADO",
      certificadoId: prod.entrada.id,
    });
  });

  it("un reemplazado o un descartado no cuentan: queda el que vale", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const primero = await pedir(e);
    await cargar(e, primero);
    const segundo = await pedir(e);
    await cargar(e, segundo);
    expect(de(await situaciones(e), "HOMOLOGACION")).toMatchObject({
      situacion: "VIGENTE",
      certificadoId: segundo.entrada.id,
    });
    const otra = await escenarioDeSociedad(dueno, propia.base);
    const descartado = await pedir(otra);
    await dueno.query("update certificado_arca set estado = 'DESCARTADO' where id = $1", [
      descartado.entrada.id,
    ]);
    expect(de(await situaciones(otra), "HOMOLOGACION")).toEqual({
      ambiente: "HOMOLOGACION",
      situacion: "FALTA_CARGAR",
    });
  });

  it("aislamiento: la empresa solo ve lo suyo; el emisor de otra empresa o inexistente es EMISOR_NO_ENCONTRADO", async () => {
    const a = await escenarioDeSociedad(dueno, propia.base);
    const b = await escenarioDeSociedad(dueno, propia.base);
    const p = await pedir(a);
    await cargar(a, p);
    expect(de(await situaciones(b), "HOMOLOGACION")).toEqual({
      ambiente: "HOMOLOGACION",
      situacion: "FALTA_CARGAR",
    });
    expect(await ver(b, new Date(), a.emisor)).toEqual({
      ok: false,
      error: "EMISOR_NO_ENCONTRADO",
    });
    expect(await ver(a, new Date(), randomUUID())).toEqual({
      ok: false,
      error: "EMISOR_NO_ENCONTRADO",
    });
  });

  it.each(["ADMINISTRADOR", "OPERADOR"] as const)(
    "un %s no puede mirarlo (SIN_PERMISO): es del gerente",
    async (rol) => {
      const e = await escenarioDeSociedad(dueno, propia.base);
      const persona = (
        await dueno.query<{ id: string }>("insert into persona (email) values ($1) returning id", [
          `${randomUUID().slice(0, 12)}@prueba.test`,
        ])
      ).rows[0]?.id;
      await crearMembresiaDeBase(dueno, e.empresa, persona ?? "", rol);
      const r = await entornoDeConsultas
        .consultas()
        .estadoDeCertificados(
          { ...e.como(new Date()), personaId: persona as never },
          { emisorId: emisorId(e.emisor) },
        );
      expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
    },
  );

  it("es de solo lectura y no muestra secretos: ni la clave, ni el pedido, ni el certificado, ni la huella; no deja auditoría ni cambia filas", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const p = await pedir(e);
    await cargar(e, p);
    const filaAntes = (
      await dueno.query("select * from certificado_arca where empresa_id = $1", [e.empresa])
    ).rows;
    const auditoriasAntes = (
      await dueno.query("select 1 from auditoria_empresa where empresa_id = $1", [e.empresa])
    ).rowCount;

    const r = await ver(e);
    expect(r.ok).toBe(true);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain("PRIVATE");
    expect(texto).not.toContain("BEGIN");
    expect(texto).not.toMatch(/clave|pem|huella|pedido|nonce|etiqueta|kid/i);
    for (const clave of servicios.clavesGeneradas) {
      expect(texto).not.toContain(clave.split("\n")[1] ?? "x".repeat(99));
    }
    expect(
      (await dueno.query("select * from certificado_arca where empresa_id = $1", [e.empresa])).rows,
    ).toEqual(filaAntes);
    expect(
      (await dueno.query("select 1 from auditoria_empresa where empresa_id = $1", [e.empresa]))
        .rowCount,
    ).toBe(auditoriasAntes);
  });

  // ===============================================================================================
  describe("las lecturas de certificados (`actualesDelEmisor`): por ambiente, sin clave y solo de su empresa", () => {
    const todos = (e: Sociedad, empresa: string = e.empresa, emisor: string = e.emisor) =>
      entornoDeConsultas.transacciones.ejecutar({ contexto: e.como(new Date()) }, async (tx) =>
        ok(await tx.lecturasDeCertificados.actualesDelEmisor(empresaId(empresa), emisorId(emisor))),
      );
    const actual = async (e: Sociedad, ambiente: string, empresa?: string, emisor?: string) => {
      const r = await todos(e, empresa, emisor);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      return r.valor.find((a) => a.ambiente === ambiente)?.certificado ?? null;
    };

    it("siempre los dos ambientes, en ese orden, aunque no haya nada", async () => {
      const e = await escenarioDeSociedad(dueno, propia.base);
      expect(await todos(e)).toEqual({
        ok: true,
        valor: [
          { ambiente: "HOMOLOGACION", certificado: null },
          { ambiente: "PRODUCCION", certificado: null },
        ],
      });
    });

    it("el vigente manda sobre un pedido posterior; sin vigente, el último pedido; un reemplazado o un descartado no cuentan", async () => {
      const e = await escenarioDeSociedad(dueno, propia.base);
      const viejo = await pedir(e);
      const nuevo = await pedir(e);
      // Sin vigente: el último pedido (el de creación más reciente).
      expect((await actual(e, "HOMOLOGACION"))?.id).toBe(nuevo.entrada.id);
      expect(await actual(e, "PRODUCCION")).toBeNull();

      await cargar(e, viejo);
      const conVigente = await actual(e, "HOMOLOGACION");
      expect(conVigente).toMatchObject({ id: viejo.entrada.id, estado: "VIGENTE" });
      // Nunca la clave: ni sus columnas ni sus bytes.
      expect(
        Object.keys(conVigente ?? {}).filter((k) => /clave|nonce|etiqueta|cifrad|kid/i.test(k)),
      ).toEqual([]);

      // Al cargar el otro, el viejo queda reemplazado y no cuenta.
      await cargar(e, nuevo);
      expect((await actual(e, "HOMOLOGACION"))?.id).toBe(nuevo.entrada.id);
      const descartable = await pedir(e, { ambiente: "PRODUCCION" });
      expect((await actual(e, "PRODUCCION"))?.id).toBe(descartable.entrada.id);
      await dueno.query("update certificado_arca set estado = 'DESCARTADO' where id = $1", [
        descartable.entrada.id,
      ]);
      expect(await actual(e, "PRODUCCION")).toBeNull();
    });

    it("aislamiento: otra empresa no ve a esta, ni nombrando su empresa o su emisor", async () => {
      const a = await escenarioDeSociedad(dueno, propia.base);
      const b = await escenarioDeSociedad(dueno, propia.base);
      await cargar(a, await pedir(a));
      // La empresa del contexto es B: pedir la de A devuelve nada.
      expect(await actual(b, "HOMOLOGACION", a.empresa, a.emisor)).toBeNull();
      expect(await actual(b, "HOMOLOGACION")).toBeNull();
    });
  });
});
