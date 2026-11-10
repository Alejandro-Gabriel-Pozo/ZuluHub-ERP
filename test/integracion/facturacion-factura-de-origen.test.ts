import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  emitirFacturaDeOrigenEnTx,
  huellaDelPedido,
  puntoDeVentaId,
  type EntradaDeFacturaDeOrigen,
} from "../../src/modulos/fiscal/publico";
import { cantidadDesdeTexto } from "../../src/primitivas/cantidad/cantidad";
import { importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../src/primitivas/dinero/precio-unitario";
import { sucursalId } from "../../src/primitivas/identificadores/marca";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { consumidorFinal, renglon } from "../utilidades/facturacion";
import { crearBaseAparte } from "./entorno";
import {
  RelojDePrueba,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  crearEscenarioDeCasos,
  facturaManual,
  notaManual,
  type EscenarioDeCasos,
} from "./facturacion-casos-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";

/**
 * E1-T2: facturar un documento que armó otro módulo (`emitirFacturaDeOrigen` y su cuerpo `emitirFacturaDeOrigenEnTx`) contra una base real, con
 * el rol limitado de la aplicación y ARCA siempre falsa. Cubre P1 (fiscal: doble clic y reintentos, en secuencia y en paralelo), P8 (letra C),
 * P9 (la huella de los pedidos manuales ya guardados no cambia), la atomicidad de la puerta de transacción, la unidad del renglón y las
 * validaciones que no dejan escrituras (punto de venta de otra sucursal, total que no coincide, origen inválido, módulo sin activar).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("facturación E1-T2: facturar un documento de origen", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeFacturacion>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeFacturacion(propia.base, 16);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;

  /** Una empresa, su reloj y su ARCA falsa. */
  async function preparar(opciones: Parameters<typeof crearEscenarioDeCasos>[2] = {}) {
    const e = await crearEscenarioDeCasos(dueno, propia.base, opciones);
    const reloj = new RelojDePrueba(new Date());
    const falsa = new EmisionFalsa();
    const casos = casosDeFacturacion(
      entorno,
      { HOMOLOGACION: falsa, PRODUCCION: new EmisionFalsa() },
      reloj,
    );
    const como = () => e.como(reloj.ahora());
    return { e, reloj, falsa, casos, como };
  }

  /** 1,250 kg a 400,00 (500,00) y un pan de 121,00: 621,00 con IVA incluido. */
  const entradaDe = (
    e: EscenarioDeCasos,
    cambios: Partial<EntradaDeFacturaDeOrigen> = {},
  ): EntradaDeFacturaDeOrigen => ({
    origen: { tipo: "EJEMPLAR_DE_TICKET", id: randomUUID() },
    comprobanteId: randomUUID(),
    puntoDeVentaId: puntoDeVentaId(e.pv),
    sucursalEsperadaId: sucursalId(e.sucursal),
    receptor: consumidorFinal,
    renglones: [
      {
        descripcion: "Pan de campo · grande",
        cantidad: cantidadDesdeTexto("1.2500"),
        unidad: "kg",
        precioUnitario: precioUnitarioDesdeTexto("400.00"),
        alicuota: "21",
      },
      {
        descripcion: "Medialuna",
        cantidad: cantidadDesdeTexto("1"),
        unidad: null,
        precioUnitario: precioUnitarioDesdeTexto("121.00"),
        alicuota: "21",
      },
    ],
    totalEsperado: importeDesdeTexto(ARS, "621.00"),
    ...cambios,
  });

  const exito = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
    if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  /** Lo que hay escrito en la empresa: comprobantes, trabajos de validación y auditorías de alta. */
  const escrituras = async (e: EscenarioDeCasos) => ({
    comprobantes: Number(
      (
        await filas<{ n: string }>(
          "select count(*)::text as n from comprobante where empresa_id = $1",
          [e.empresa],
        )
      )[0]?.n,
    ),
    trabajos: Number(
      (
        await filas<{ n: string }>(
          "select count(*)::text as n from trabajo where empresa_id = $1 and starts_with(clave_idempotencia, 'fiscal.validar:')",
          [e.empresa],
        )
      )[0]?.n,
    ),
    auditorias: Number(
      (
        await filas<{ n: string }>(
          "select count(*)::text as n from auditoria_empresa where empresa_id = $1 and accion = 'COMPROBANTE_CREADO'",
          [e.empresa],
        )
      )[0]?.n,
    ),
  });
  const delOrigen = async (e: EscenarioDeCasos, tipo: string, id: string) =>
    await filas<{ id: string; estado: string; tipo: string }>(
      `select id, estado, tipo_comprobante as tipo from comprobante
        where empresa_id = $1 and origen_tipo = $2 and origen_id = $3 order by creado_en`,
      [e.empresa, tipo, id],
    );

  // ===============================================================================================
  describe("emitir", () => {
    it("nace PENDIENTE con su origen, su unidad impresa, su auditoría sin datos del receptor y su trabajo de validación", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      const salida = exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      expect(salida).toEqual({
        comprobanteId: entrada.comprobanteId,
        estado: "PENDIENTE",
        tipo: "FACTURA_B",
        total: "621.00",
        yaExistia: false,
      });
      expect(await delOrigen(p.e, "EJEMPLAR_DE_TICKET", entrada.origen.id)).toEqual([
        { id: entrada.comprobanteId, estado: "PENDIENTE", tipo: "FACTURA_B" },
      ]);
      expect(
        await filas(
          `select posicion, descripcion, cantidad::text as cantidad, unidad, importe::text as importe
             from comprobante_linea where comprobante_id = $1 order by posicion`,
          [entrada.comprobanteId],
        ),
      ).toEqual([
        {
          posicion: 1,
          descripcion: "Pan de campo · grande",
          cantidad: "1.2500",
          unidad: "kg",
          importe: "500.00",
        },
        {
          posicion: 2,
          descripcion: "Medialuna",
          cantidad: "1.0000",
          unidad: null,
          importe: "121.00",
        },
      ]);
      const auditoria = await filas<{
        accion: string;
        actor: string;
        despues: Record<string, unknown>;
      }>(
        "select accion, actor_persona_id as actor, despues from auditoria_empresa where empresa_id = $1 and entidad_id = $2",
        [p.e.empresa, entrada.comprobanteId],
      );
      expect(auditoria).toEqual([
        {
          accion: "COMPROBANTE_CREADO",
          actor: p.e.persona,
          despues: expect.objectContaining({
            clase: "FACTURA",
            total: "621.00",
            origen: "EJEMPLAR_DE_TICKET",
          }) as unknown,
        },
      ]);
      expect(JSON.stringify(auditoria)).not.toContain("Consumidor");
      expect(
        await filas(
          "select clave_idempotencia as clave, estado from trabajo where clave_idempotencia like $1",
          [`fiscal.validar:${entrada.comprobanteId}:%`],
        ),
      ).toEqual([{ clave: `fiscal.validar:${entrada.comprobanteId}:1`, estado: "PENDIENTE" }]);
    });

    it("el origen de reemisión también se acepta y queda guardado tal cual", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e, { origen: { tipo: "REEMISION_DE_TICKET", id: randomUUID() } });
      exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      expect(await delOrigen(p.e, "REEMISION_DE_TICKET", entrada.origen.id)).toHaveLength(1);
    });

    it("el mismo origen con el mismo pedido devuelve la misma factura (yaExistia) sin escribir ni encolar nada más", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      const primera = exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      const antes = await escrituras(p.e);
      const segunda = exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      expect(segunda).toEqual({ ...primera, yaExistia: true });
      expect(await escrituras(p.e)).toEqual(antes);
      // Un reintento con otro id de comprobante (el de la pantalla se perdió) da la misma factura: manda el origen.
      const otroId = exito(
        await p.casos.emitirFacturaDeOrigen(p.como(), { ...entrada, comprobanteId: randomUUID() }),
      );
      expect(otroId).toEqual({ ...primera, yaExistia: true });
      expect(await escrituras(p.e)).toEqual(antes);
    });

    it("el mismo origen con otro pedido da CLAVE_REUTILIZADA y no escribe nada", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      const antes = await escrituras(p.e);
      const otroRenglon = [
        { ...(entrada.renglones[0] as (typeof entrada.renglones)[number]), unidad: "g" },
        ...entrada.renglones.slice(1),
      ];
      expect(
        await p.casos.emitirFacturaDeOrigen(p.como(), { ...entrada, renglones: otroRenglon }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect(await escrituras(p.e)).toEqual(antes);
    });

    it("el mismo origen y el mismo pedido con otro tipo de origen son dos orígenes distintos", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      const reemision = exito(
        await p.casos.emitirFacturaDeOrigen(p.como(), {
          ...entrada,
          comprobanteId: randomUUID(),
          origen: { tipo: "REEMISION_DE_TICKET", id: entrada.origen.id },
        }),
      );
      expect(reemision.yaExistia).toBe(false);
      expect(reemision.comprobanteId).not.toBe(entrada.comprobanteId);
    });

    it("un id de comprobante ya usado por otro origen da CLAVE_REUTILIZADA y no escribe nada", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      const antes = await escrituras(p.e);
      expect(
        await p.casos.emitirFacturaDeOrigen(p.como(), {
          ...entradaDe(p.e),
          comprobanteId: entrada.comprobanteId,
        }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect(await escrituras(p.e)).toEqual(antes);
    });
  });

  // ===============================================================================================
  describe("lo que no deja escrituras", () => {
    it.each([
      [
        "un punto de venta que no es de la sucursal del documento",
        () => ({ sucursalEsperadaId: sucursalId(randomUUID()) }),
        "PUNTO_DE_VENTA_DE_OTRA_SUCURSAL",
      ],
      [
        "un total esperado un centavo menor que el calculado",
        () => ({ totalEsperado: importeDesdeTexto(ARS, "620.99") }),
        "TOTAL_NO_COINCIDE",
      ],
      [
        "un total esperado un centavo mayor que el calculado",
        () => ({ totalEsperado: importeDesdeTexto(ARS, "621.01") }),
        "TOTAL_NO_COINCIDE",
      ],
      [
        "un origen de otro tipo",
        () => ({ origen: { tipo: "MANUAL", id: randomUUID() } }),
        "ORIGEN_INVALIDO",
      ],
      [
        "un id de origen que no es un uuid",
        () => ({ origen: { tipo: "EJEMPLAR_DE_TICKET", id: "ticket-1" } }),
        "ORIGEN_INVALIDO",
      ],
      ["un id de comprobante que no es un uuid", () => ({ comprobanteId: "x" }), "CLAVE_INVALIDA"],
      [
        "un punto de venta que no existe",
        () => ({ puntoDeVentaId: puntoDeVentaId(randomUUID()) }),
        "PUNTO_DE_VENTA_NO_ENCONTRADO",
      ],
      [
        "una unidad con una forma que no se admite",
        () => ({
          renglones: [
            {
              descripcion: "Pan",
              cantidad: cantidadDesdeTexto("1"),
              unidad: "kilo gramo",
              precioUnitario: precioUnitarioDesdeTexto("621.00"),
              alicuota: "21" as const,
            },
          ],
        }),
        { codigo: "RENGLON_INVALIDO", posicion: 0, campo: "unidad" },
      ],
    ] as const)(
      "%s da su error y no deja ni comprobante, ni trabajo, ni auditoría",
      async (_nombre, cambio, error) => {
        const p = await preparar();
        const antes = await escrituras(p.e);
        const entrada = {
          ...entradaDe(p.e),
          ...(cambio as (e: EscenarioDeCasos) => Partial<EntradaDeFacturaDeOrigen>)(p.e),
        } as EntradaDeFacturaDeOrigen;
        expect(await p.casos.emitirFacturaDeOrigen(p.como(), entrada)).toEqual({
          ok: false,
          error,
        });
        expect(await escrituras(p.e)).toEqual(antes);
      },
    );

    it("el punto de venta de otra empresa no existe: no se ve ni se factura", async () => {
      const a = await preparar();
      const b = await preparar();
      const antes = await escrituras(a.e);
      expect(
        await a.casos.emitirFacturaDeOrigen(a.como(), {
          ...entradaDe(a.e),
          puntoDeVentaId: puntoDeVentaId(b.e.pv),
        }),
      ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_NO_ENCONTRADO" });
      expect(await escrituras(a.e)).toEqual(antes);
      expect(await escrituras(b.e)).toEqual({ comprobantes: 0, trabajos: 0, auditorias: 0 });
    });

    it("con el módulo sin activar en la empresa la puerta sigue cerrada: MODULO_NO_ACTIVO y sin escrituras", async () => {
      const e = await crearEscenarioDeCasos(dueno, propia.base);
      const reloj = new RelojDePrueba(new Date());
      // Autorización real, sin la activación que simula `conFacturacion`: la empresa no activó `facturacion`.
      const sinActivar = crearEntornoDeFacturacion(propia.base, 2, (tx) => ({
        ...tx,
        autorizacion: {
          ...tx.autorizacion,
          delActor: async (c) => ({
            ...(await tx.autorizacion.delActor(c)),
            modulosActivados: [],
            modulosHabilitados: [],
          }),
        },
      }));
      try {
        const casos = casosDeFacturacion(
          sinActivar,
          { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: new EmisionFalsa() },
          reloj,
        );
        expect(await casos.emitirFacturaDeOrigen(e.como(reloj.ahora()), entradaDe(e))).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
        expect(await escrituras(e)).toEqual({ comprobantes: 0, trabajos: 0, auditorias: 0 });
      } finally {
        await sinActivar.cerrar();
      }
    });
  });

  // ===============================================================================================
  describe("letra C (P8)", () => {
    it("un monotributista factura el documento con alícuotas y sale una Factura C sin alícuotas y con el mismo total", async () => {
      const p = await preparar({ condicionIva: "MONOTRIBUTO" });
      const entrada = entradaDe(p.e);
      const salida = exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      expect(salida).toMatchObject({ tipo: "FACTURA_C", total: "621.00", yaExistia: false });
      expect(
        await filas(
          "select posicion, alicuota, unidad, importe::text as importe from comprobante_linea where comprobante_id = $1 order by posicion",
          [entrada.comprobanteId],
        ),
      ).toEqual([
        { posicion: 1, alicuota: null, unidad: "kg", importe: "500.00" },
        { posicion: 2, alicuota: null, unidad: null, importe: "121.00" },
      ]);
      expect(
        await filas(
          "select count(*)::int as n from comprobante_alicuota where comprobante_id = $1",
          [entrada.comprobanteId],
        ),
      ).toEqual([{ n: 0 }]);
    });

    it("con letra A o B las alícuotas se conservan", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      expect(
        await filas("select distinct alicuota from comprobante_linea where comprobante_id = $1", [
          entrada.comprobanteId,
        ]),
      ).toEqual([{ alicuota: "21" }]);
    });

    it("la factura libre de un monotributista con alícuota en un renglón sigue rechazándose (la regla es solo de los documentos de origen)", async () => {
      const p = await preparar({ condicionIva: "MONOTRIBUTO" });
      expect(
        await p.casos.emitirComprobanteManual(
          p.como(),
          facturaManual(p.e, { renglones: [renglon("121.00", "1", "21")] }),
        ),
      ).toEqual({ ok: false, error: { codigo: "ALICUOTA_EN_LETRA_C", posicion: 0 } });
    });
  });

  // ===============================================================================================
  describe("repetición, en secuencia y en paralelo (P1)", () => {
    it("50 rondas de dos emisiones simultáneas del mismo origen: una sola factura, un solo trabajo, una sola auditoría", async () => {
      const p = await preparar();
      for (let ronda = 0; ronda < 50; ronda++) {
        const entrada = entradaDe(p.e);
        const [a, b] = await Promise.all([
          p.casos.emitirFacturaDeOrigen(p.como(), entrada),
          p.casos.emitirFacturaDeOrigen(p.como(), entrada),
        ]);
        const salidas = [exito(a), exito(b)];
        expect(
          salidas.filter((s) => !s.yaExistia),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(new Set(salidas.map((s) => s.comprobanteId)).size).toBe(1);
        expect(await delOrigen(p.e, "EJEMPLAR_DE_TICKET", entrada.origen.id)).toHaveLength(1);
        expect(
          await filas("select count(*)::int as n from trabajo where clave_idempotencia like $1", [
            `fiscal.validar:${entrada.comprobanteId}:%`,
          ]),
        ).toEqual([{ n: 1 }]);
      }
      const total = await escrituras(p.e);
      expect(total).toEqual({ comprobantes: 50, trabajos: 50, auditorias: 50 });
    });

    it("50 rondas con DOS ids de comprobante distintos para el mismo origen (los reintentos de dos pantallas): una sola factura y los dos reciben la misma", async () => {
      const p = await preparar();
      for (let ronda = 0; ronda < 50; ronda++) {
        const entrada = entradaDe(p.e);
        const [a, b] = await Promise.all([
          p.casos.emitirFacturaDeOrigen(p.como(), { ...entrada, comprobanteId: randomUUID() }),
          p.casos.emitirFacturaDeOrigen(p.como(), { ...entrada, comprobanteId: randomUUID() }),
        ]);
        const salidas = [exito(a), exito(b)];
        expect(new Set(salidas.map((s) => s.comprobanteId)).size, `ronda ${ronda}`).toBe(1);
        expect(salidas.filter((s) => !s.yaExistia)).toHaveLength(1);
        expect(await delOrigen(p.e, "EJEMPLAR_DE_TICKET", entrada.origen.id)).toHaveLength(1);
      }
      expect(await escrituras(p.e)).toEqual({ comprobantes: 50, trabajos: 50, auditorias: 50 });
    });

    it("dos orígenes distintos a la vez no se pisan: dos facturas, sin hueco de numeración", async () => {
      const p = await preparar();
      for (let ronda = 0; ronda < 10; ronda++) {
        const [a, b] = await Promise.all([
          p.casos.emitirFacturaDeOrigen(p.como(), entradaDe(p.e)),
          p.casos.emitirFacturaDeOrigen(p.como(), entradaDe(p.e)),
        ]);
        expect(exito(a).comprobanteId).not.toBe(exito(b).comprobanteId);
      }
      expect(await escrituras(p.e)).toEqual({ comprobantes: 20, trabajos: 20, auditorias: 20 });
    });
  });

  // ===============================================================================================
  describe("reemisión: una factura acreditada por completo sigue ocupando su origen", () => {
    it("el primer origen devuelve la acreditada; el de reemisión emite otra factura y su repetición no duplica", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      const primera = exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada));
      exito(
        await p.casos.validarComprobante(p.e.sistema(p.reloj.ahora()), {
          comprobanteId: primera.comprobanteId,
        }),
      );
      const nota = exito(
        await p.casos.emitirNotaDeCredito(
          p.como(),
          notaManual(primera.comprobanteId, {
            renglones: [renglon("621.00", "1", "21")],
          }),
        ),
      );
      exito(
        await p.casos.validarComprobante(p.e.sistema(p.reloj.ahora()), {
          comprobanteId: nota.comprobanteId,
        }),
      );
      // Con el mismo origen, la acreditada sigue siendo «la» factura de ese origen.
      expect(
        exito(
          await p.casos.emitirFacturaDeOrigen(p.como(), {
            ...entrada,
            comprobanteId: randomUUID(),
          }),
        ),
      ).toEqual({ ...primera, estado: "AUTORIZADO", yaExistia: true });
      const reemision = {
        ...entrada,
        comprobanteId: randomUUID(),
        origen: { tipo: "REEMISION_DE_TICKET" as const, id: randomUUID() },
      };
      const nueva = exito(await p.casos.emitirFacturaDeOrigen(p.como(), reemision));
      expect(nueva).toMatchObject({ estado: "PENDIENTE", total: "621.00", yaExistia: false });
      expect(nueva.comprobanteId).not.toBe(primera.comprobanteId);
      expect(exito(await p.casos.emitirFacturaDeOrigen(p.como(), reemision))).toEqual({
        ...nueva,
        yaExistia: true,
      });
    });
  });

  // ===============================================================================================
  describe("emitirFacturaDeOrigenEnTx dentro de la transacción de quien llama (atomicidad)", () => {
    it("si quien llama falla después, no queda comprobante, ni renglones, ni trabajo, ni auditoría", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      const contexto = p.como();
      await expect(
        entorno.ejecutar({ contexto }, async (tx) => {
          const r = await emitirFacturaDeOrigenEnTx(
            tx,
            {
              ...contexto,
              personaId: contexto.personaId as NonNullable<typeof contexto.personaId>,
            },
            entrada,
            REGLAS_CON_FACTURACION,
          );
          expect(r.ok).toBe(true);
          throw new Error("se cortó la luz después de facturar");
        }),
      ).rejects.toThrow("se cortó la luz");
      expect(await escrituras(p.e)).toEqual({ comprobantes: 0, trabajos: 0, auditorias: 0 });
      expect(
        await filas("select count(*)::int as n from comprobante_linea where empresa_id = $1", [
          p.e.empresa,
        ]),
      ).toEqual([{ n: 0 }]);
      // Y repetirlo después sí emite: nada quedó a medias.
      expect(exito(await p.casos.emitirFacturaDeOrigen(p.como(), entrada)).yaExistia).toBe(false);
    });

    it("comparte transacción: lo que quien llama escribe a continuación y la factura confirman juntos", async () => {
      const p = await preparar();
      const entrada = entradaDe(p.e);
      const contexto = p.como();
      const resultado = await entorno.ejecutar({ contexto }, async (tx) =>
        emitirFacturaDeOrigenEnTx(
          tx,
          { ...contexto, personaId: contexto.personaId as NonNullable<typeof contexto.personaId> },
          entrada,
          REGLAS_CON_FACTURACION,
        ),
      );
      expect(exito(resultado)).toMatchObject({
        comprobanteId: entrada.comprobanteId,
        yaExistia: false,
      });
      expect(await escrituras(p.e)).toEqual({ comprobantes: 1, trabajos: 1, auditorias: 1 });
    });
  });

  // ===============================================================================================
  describe("la huella de los pedidos manuales ya guardados no cambia (P9)", () => {
    /** La huella con la fórmula de ANTES de sumar la unidad: el pedido canónico sin esa clave. */
    const huellaDeAntes = (pedido: ReturnType<typeof facturaManual>): string => {
      const canonico = (v: unknown): string => {
        if (typeof v === "bigint") return JSON.stringify(`${v}n`);
        if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
        if (v !== null && typeof v === "object") {
          const pares = Object.entries(v as Record<string, unknown>)
            .filter(([, x]) => x !== undefined)
            .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
          return `{${pares.map(([k, x]) => `${JSON.stringify(k)}:${canonico(x)}`).join(",")}}`;
        }
        return JSON.stringify(v);
      };
      return createHash("sha256")
        .update(
          canonico({
            clase: "FACTURA",
            puntoDeVentaId: pedido.puntoDeVentaId,
            concepto: pedido.concepto,
            servicio: pedido.servicio,
            modoDePrecio: pedido.modoDePrecio,
            renglones: pedido.renglones.map((r) => ({
              descripcion: r.descripcion,
              cantidad: "1.0000",
              precioUnitario: "121.000000",
              descuento: null,
              alicuota: r.alicuota,
            })),
            receptor: pedido.receptor,
          }),
        )
        .digest("hex");
    };

    it("un pedido manual guardado con la fórmula anterior: repetirlo da yaExistia, no CLAVE_REUTILIZADA", async () => {
      const p = await preparar();
      const pedido = facturaManual(p.e);
      const primera = exito(await p.casos.emitirComprobanteManual(p.como(), pedido));
      const [guardada] = await filas<{ huella: string }>(
        "select huella from comprobante where id = $1",
        [primera.comprobanteId],
      );
      expect(guardada?.huella).toBe(huellaDeAntes(pedido));
      expect(huellaDelPedido({ clase: "FACTURA", entrada: pedido })).toBe(huellaDeAntes(pedido));
      expect(exito(await p.casos.emitirComprobanteManual(p.como(), pedido))).toEqual({
        ...primera,
        yaExistia: true,
      });
    });
  });
});
