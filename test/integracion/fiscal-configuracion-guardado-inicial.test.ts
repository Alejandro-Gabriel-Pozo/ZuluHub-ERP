import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { emisorId } from "../../src/primitivas/identificadores/marca";
import { err, type Resultado } from "../../src/primitivas/resultado/resultado";
import { codigoDe, correrEnParalelo, perdedorAceptable } from "./concurrencia-apoyo";
import { crearBaseAparte } from "./entorno";
import {
  casosDeConfiguracion,
  crearEntornoDeConfiguracion,
  crearEscenarioDeConfiguracion,
  domicilioNuevo,
  nuevoUuid,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";

/**
 * H7 T5: el primer guardado de un emisor que no tiene borrador. Si ya rigen datos fiscales, el borrador parte de
 * ellos (como `empezarCorreccionDeDatosFiscales`), así lo que la pantalla no edita, Ingresos Brutos (D-45), no se
 * pierde al confirmar. Sin datos vigentes, el borrador sigue empezando vacío. Contra una base real, con el rol
 * limitado de la aplicación.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = new Date("2026-10-11T12:00:00Z");
const DESPUES = new Date(AHORA.getTime() + 86_400_000);
type Fila = Record<string, unknown>;
type Cualquiera = Resultado<unknown, unknown>;

describe.skipIf(base === null)("fiscal T5: primer guardado con datos vigentes", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeConfiguracion>;
  let casos: ReturnType<typeof casosDeConfiguracion>;
  /** Mientras haya una barrera, toda transacción espera en ella tras leer el borrador del emisor. */
  let barrera: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeConfiguracion(propia.base, 16, (tx) => ({
      ...tx,
      datosFiscales: {
        ...tx.datosFiscales,
        obtenerBorrador: async (...args) => {
          const r = await tx.datosFiscales.obtenerBorrador(...args);
          if (barrera !== null) await barrera();
          return r;
        },
      },
    }));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    casos = casosDeConfiguracion(entorno);
  }, 120_000);
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const porId = async (id: string) =>
    (
      await filas<{
        estado: string;
        numero: number | null;
        razon_social: string | null;
        condicion_iva: string | null;
        domicilio_fiscal_id: string | null;
        inicio_actividades: string | null;
        iibb_numero: string | null;
        iibb_condicion: string | null;
      }>(
        `select estado, numero, razon_social, condicion_iva, domicilio_fiscal_id,
                to_char(inicio_actividades, 'YYYY-MM-DD') as inicio_actividades, iibb_numero, iibb_condicion
           from datos_fiscales where id = $1`,
        [id],
      )
    )[0];
  const cuantas = async (emisor: string) =>
    (
      await filas<{ n: number }>(
        "select count(*)::int as n from datos_fiscales where emisor_id = $1",
        [emisor],
      )
    )[0]?.n;

  const COMPLETOS = {
    razonSocial: "Coop Pampa SA",
    condicionIva: "RESPONSABLE_INSCRIPTO",
    inicioActividades: "2020-03-01",
  } as const;

  const nuevo = () => crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE" });
  type PedidoDeGuardar = Parameters<typeof casos.guardarBorradorDeDatosFiscales>[1];
  const guardar = (
    e: EscenarioDeConfiguracion,
    pedido: Omit<PedidoDeGuardar, "emisorId">,
    ahora = AHORA,
  ) =>
    casos.guardarBorradorDeDatosFiscales(e.como(ahora), {
      emisorId: emisorId(e.mundo.emisor),
      ...pedido,
    });
  const confirmar = (
    e: EscenarioDeConfiguracion,
    borradorId: string,
    versionEsperada: number,
    ahora = AHORA,
  ) =>
    casos.confirmarDatosFiscales(e.como(ahora), {
      emisorId: emisorId(e.mundo.emisor),
      borradorId,
      versionEsperada,
      vigenteDesde: ahora,
      motivo: "Cambio de datos",
    });

  /** Una empresa con una versión confirmada y vigente que lleva Ingresos Brutos (cargados por otra vía que la pantalla). */
  async function conVigenteConIibb() {
    const e = await nuevo();
    const domicilio = domicilioNuevo();
    const borradorId = nuevoUuid();
    const guardado = await guardar(e, {
      borradorId,
      cambios: { ...COMPLETOS, iibbNumero: "901-123456-7", iibbCondicion: "LOCAL" },
      domicilio,
    });
    if (!guardado.ok) throw new Error("no se guardó el borrador de partida");
    const confirmado = await confirmar(e, borradorId, guardado.valor.version);
    if (!confirmado.ok) throw new Error("no se confirmó la versión de partida");
    return { e, vigenteId: borradorId, domicilioId: domicilio.id };
  }

  it("con una vigente que tiene Ingresos Brutos, el primer guardado sin borrador los conserva, y también lo que el pedido no manda; confirmar los lleva a la versión nueva", async () => {
    const { e, domicilioId } = await conVigenteConIibb();
    const borradorId = nuevoUuid();
    // Lo que manda la pantalla: sin Ingresos Brutos y sin domicilio (no lo cambió).
    const r = await guardar(e, { borradorId, cambios: { razonSocial: "Coop Pampa SRL" } }, DESPUES);
    if (!r.ok) throw new Error(`no se guardó: ${JSON.stringify(r.error)}`);
    expect(await porId(borradorId)).toMatchObject({
      estado: "BORRADOR",
      razon_social: "Coop Pampa SRL",
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      domicilio_fiscal_id: domicilioId,
      inicio_actividades: "2020-03-01",
      iibb_numero: "901-123456-7",
      iibb_condicion: "LOCAL",
    });
    const auditoria = await filas<{ despues: Record<string, unknown> }>(
      "select despues from auditoria_empresa where entidad_id = $1 and accion = 'DATOS_FISCALES_BORRADOR_GUARDADO'",
      [borradorId],
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]?.despues).toMatchObject({ iibbNumero: "901-123456-7" });

    const confirmado = await confirmar(e, borradorId, r.valor.version, DESPUES);
    expect(confirmado.ok && confirmado.valor).toMatchObject({ numero: 2, yaEstaba: false });
    expect(await porId(borradorId)).toMatchObject({
      estado: "CONFIRMADA",
      numero: 2,
      razon_social: "Coop Pampa SRL",
      iibb_numero: "901-123456-7",
      iibb_condicion: "LOCAL",
    });
  });

  it("lo que el pedido sí manda gana sobre lo vigente, y repetir el primer guardado no escribe ni audita de nuevo", async () => {
    const { e } = await conVigenteConIibb();
    const borradorId = nuevoUuid();
    const pedido = { borradorId, cambios: { ...COMPLETOS, iibbNumero: "555" } };
    const primero = await guardar(e, pedido, DESPUES);
    const segundo = await guardar(e, pedido, DESPUES);
    expect(primero.ok && primero.valor.yaEstaba).toBe(false);
    expect(segundo.ok && segundo.valor.yaEstaba).toBe(true);
    expect(await porId(borradorId)).toMatchObject({ iibb_numero: "555", iibb_condicion: "LOCAL" });
    expect(
      await filas("select id from auditoria_empresa where entidad_id = $1", [borradorId]),
    ).toHaveLength(1);
  });

  it("sin datos vigentes, el primer guardado sigue empezando vacío: solo queda lo que el pedido manda", async () => {
    const e = await nuevo();
    const borradorId = nuevoUuid();
    const r = await guardar(e, { borradorId, cambios: { razonSocial: "Coop Pampa SA" } });
    expect(r.ok).toBe(true);
    expect(await porId(borradorId)).toMatchObject({
      estado: "BORRADOR",
      razon_social: "Coop Pampa SA",
      condicion_iva: null,
      domicilio_fiscal_id: null,
      inicio_actividades: null,
      iibb_numero: null,
      iibb_condicion: null,
    });
  });

  it("dos primeros guardados a la vez, con el mismo id: uno crea y el otro es «ya estaba»; los dos conservan Ingresos Brutos", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const { e } = await conVigenteConIibb();
      const borradorId = nuevoUuid();
      const rs: Cualquiera[] = await correrEnParalelo(
        2,
        () => guardar(e, { borradorId, cambios: { razonSocial: "Coop Pampa SRL" } }, DESPUES),
        (esperar) => {
          barrera = esperar;
        },
      );
      perdedorAceptable(rs, { esperados: [], contexto: `ronda ${ronda}` });
      const creados = rs.filter(
        (r) => r.ok && (r.valor as { yaEstaba: boolean }).yaEstaba === false,
      );
      expect(creados.length, `ronda ${ronda}`).toBeLessThanOrEqual(1);
      expect(await porId(borradorId), `ronda ${ronda}`).toMatchObject({
        estado: "BORRADOR",
        iibb_numero: "901-123456-7",
        iibb_condicion: "LOCAL",
      });
      expect(await cuantas(e.mundo.emisor)).toBe(2);
    }
  });

  it("dos primeros guardados a la vez con ids distintos: uno crea, el otro es YA_HAY_BORRADOR; hay un solo borrador y conserva Ingresos Brutos", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const { e } = await conVigenteConIibb();
      const ids = [nuevoUuid(), nuevoUuid()];
      const rs: Cualquiera[] = await correrEnParalelo(
        2,
        (i) =>
          guardar(
            e,
            { borradorId: ids[i] as string, cambios: { razonSocial: "Coop Pampa SRL" } },
            DESPUES,
          ),
        (esperar) => {
          barrera = esperar;
        },
      );
      expect(rs.filter((r) => r.ok).length, `ronda ${ronda}`).toBeLessThanOrEqual(1);
      perdedorAceptable(rs, { esperados: ["YA_HAY_BORRADOR"], contexto: `ronda ${ronda}` });
      const borradores = await filas<{ id: string; iibb_numero: string | null }>(
        "select id, iibb_numero from datos_fiscales where emisor_id = $1 and estado = 'BORRADOR'",
        [e.mundo.emisor],
      );
      expect(borradores.length, `ronda ${ronda}`).toBeLessThanOrEqual(1);
      for (const b of borradores) expect(b.iibb_numero).toBe("901-123456-7");
      if (rs.some((r) => codigoDe(r) === "YA_HAY_BORRADOR")) {
        expect(rs.filter((r) => !r.ok)).toContainEqual(err("YA_HAY_BORRADOR"));
      }
    }
  });
});
