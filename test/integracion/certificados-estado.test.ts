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
  const situaciones = async (e: Sociedad, ahora = new Date(), emisor: string = e.emisor) => {
    const r = await ver(e, ahora, emisor);
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
      pedidoPendiente: null,
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

  it("solo un vigente: sin pedido pendiente (pedidoPendiente es null)", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    await cargar(e, await pedir(e));
    expect(de(await situaciones(e), "HOMOLOGACION")).toMatchObject({
      situacion: "VIGENTE",
      pedidoPendiente: null,
    });
  });

  it("un vigente con una renovación en curso devuelve también el pedido pendiente, y con su id se completa la renovación", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const vigente = await pedir(e);
    await cargar(e, vigente);
    const titularNuevo = cuitConPrefijo("27");
    const renovacion = await pedir(e, { cuitTitular: titularNuevo, alias: "renovacion" });

    const lista = await situaciones(e);
    const homologacion = de(lista, "HOMOLOGACION") as { pedidoPendiente: Record<string, unknown> };
    expect(homologacion).toMatchObject({
      situacion: "VIGENTE",
      certificadoId: vigente.entrada.id,
      pedidoPendiente: {
        certificadoId: renovacion.entrada.id,
        alias: "renovacion",
        cuitTitular: titularNuevo,
      },
    });
    expect(homologacion.pedidoPendiente["creadoEn"]).toBeInstanceOf(Date);
    // Solo esos cuatro datos: nunca el pedido (CSR), la clave, el certificado ni la huella.
    expect(Object.keys(homologacion.pedidoPendiente).sort()).toEqual([
      "alias",
      "certificadoId",
      "creadoEn",
      "cuitTitular",
    ]);
    const texto = JSON.stringify(lista);
    expect(texto).not.toContain("BEGIN");
    expect(texto).not.toContain("PRIVATE");

    // Con ese id la pantalla carga el certificado de la renovación: pasa a vigente y ya no queda pendiente.
    await cargar(e, renovacion);
    expect(de(await situaciones(e), "HOMOLOGACION")).toMatchObject({
      situacion: "VIGENTE",
      certificadoId: renovacion.entrada.id,
      cuitTitular: titularNuevo,
      autorizacion: { estado: "SIN_VERIFICAR" },
      pedidoPendiente: null,
    });
  });

  it("de varios pedidos pendientes junto a un vigente muestra el último; los descartados no cuentan", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    await cargar(e, await pedir(e));
    const descartado = await pedir(e);
    await pedir(e);
    const ultimo = await pedir(e);
    await dueno.query("update certificado_arca set estado = 'DESCARTADO' where id = $1", [
      descartado.entrada.id,
    ]);
    expect(de(await situaciones(e), "HOMOLOGACION")).toMatchObject({
      pedidoPendiente: { certificadoId: ultimo.entrada.id },
    });
  });

  it("cada ambiente tiene lo suyo: un vigente con renovación en homologación y solo un pedido en producción", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const vigente = await pedir(e);
    await cargar(e, vigente);
    const renovacion = await pedir(e);
    const prod = await pedir(e, { ambiente: "PRODUCCION" });
    const lista = await situaciones(e);
    expect(de(lista, "HOMOLOGACION")).toMatchObject({
      situacion: "VIGENTE",
      certificadoId: vigente.entrada.id,
      pedidoPendiente: { certificadoId: renovacion.entrada.id },
    });
    expect(de(lista, "PRODUCCION")).toMatchObject({
      situacion: "PEDIDO_GENERADO",
      certificadoId: prod.entrada.id,
    });
  });

  it("cada emisor ve solo lo suyo (un pedido de un emisor no aparece en el otro de la misma empresa)", async () => {
    const e = await escenarioDeSociedad(dueno, propia.base);
    const otroEmisor = (
      await dueno.query<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [e.empresa, cuitConPrefijo("20")],
      )
    ).rows[0]?.id;
    if (otroEmisor === undefined) throw new Error("no se creó el emisor");
    const delPrincipal = await pedir(e);
    await cargar(e, delPrincipal);
    const entrada = pedidoDeCertificado(e, {
      emisorId: emisorId(otroEmisor),
      cuitTitular: cuitConPrefijo("20"),
    });
    const p = await casos.generarPedidoDeCertificado(e.como(new Date()), entrada);
    expect(p.ok).toBe(true);

    const delOtro = await situaciones(e, new Date(), otroEmisor);
    expect(delOtro).toMatchObject([
      { situacion: "PEDIDO_GENERADO", certificadoId: entrada.id },
      { situacion: "FALTA_CARGAR" },
    ]);
    expect(de(await situaciones(e), "HOMOLOGACION")).toMatchObject({
      certificadoId: delPrincipal.entrada.id,
      pedidoPendiente: null,
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
    expect(texto).not.toMatch(/clave|pem|huella|nonce|etiqueta|kid/i);
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
      return r.valor.find((a) => a.ambiente === ambiente) ?? null;
    };

    it("siempre los dos ambientes, en ese orden, aunque no haya nada", async () => {
      const e = await escenarioDeSociedad(dueno, propia.base);
      expect(await todos(e)).toEqual({
        ok: true,
        valor: [
          { ambiente: "HOMOLOGACION", vigente: null, pendiente: null },
          { ambiente: "PRODUCCION", vigente: null, pendiente: null },
        ],
      });
    });

    it("trae el vigente y el último pedido pendiente a la vez; un reemplazado o un descartado no cuentan", async () => {
      const e = await escenarioDeSociedad(dueno, propia.base);
      const viejo = await pedir(e);
      const nuevo = await pedir(e);
      // Sin vigente: el último pedido (el de creación más reciente).
      expect((await actual(e, "HOMOLOGACION"))?.pendiente?.id).toBe(nuevo.entrada.id);
      expect((await actual(e, "HOMOLOGACION"))?.vigente).toBeNull();
      expect(await actual(e, "PRODUCCION")).toMatchObject({ vigente: null, pendiente: null });

      await cargar(e, viejo);
      const conVigente = await actual(e, "HOMOLOGACION");
      expect(conVigente?.vigente).toMatchObject({ id: viejo.entrada.id, estado: "VIGENTE" });
      expect(conVigente?.pendiente?.id).toBe(nuevo.entrada.id);
      // Nunca la clave: ni sus columnas ni sus bytes.
      for (const c of [conVigente?.vigente, conVigente?.pendiente]) {
        expect(
          Object.keys(c ?? {}).filter((k) => /clave|nonce|etiqueta|cifrad|kid/i.test(k)),
        ).toEqual([]);
      }

      // Al cargar el otro, el viejo queda reemplazado y no cuenta; ya no hay pendiente.
      await cargar(e, nuevo);
      expect(await actual(e, "HOMOLOGACION")).toMatchObject({ pendiente: null });
      expect((await actual(e, "HOMOLOGACION"))?.vigente?.id).toBe(nuevo.entrada.id);
      const descartable = await pedir(e, { ambiente: "PRODUCCION" });
      expect((await actual(e, "PRODUCCION"))?.pendiente?.id).toBe(descartable.entrada.id);
      await dueno.query("update certificado_arca set estado = 'DESCARTADO' where id = $1", [
        descartable.entrada.id,
      ]);
      expect(await actual(e, "PRODUCCION")).toMatchObject({ vigente: null, pendiente: null });
    });

    it("aislamiento: otra empresa no ve a esta, ni nombrando su empresa o su emisor", async () => {
      const a = await escenarioDeSociedad(dueno, propia.base);
      const b = await escenarioDeSociedad(dueno, propia.base);
      await cargar(a, await pedir(a));
      await pedir(a);
      // La empresa del contexto es B: pedir la de A devuelve nada.
      expect(await actual(b, "HOMOLOGACION", a.empresa, a.emisor)).toMatchObject({
        vigente: null,
        pendiente: null,
      });
      expect(await actual(b, "HOMOLOGACION")).toMatchObject({ vigente: null, pendiente: null });
    });
  });
});
