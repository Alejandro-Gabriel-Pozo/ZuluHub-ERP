import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearManejadorDeReconciliar,
  crearManejadorDeValidarComprobante,
  numeroDeDocumentoParaArca,
  puntoDeVentaId,
  type ComprobanteId,
  type DependenciasDeFacturacion,
  type EmisionElectronica,
  type SalidaDeEmitir,
} from "../../src/modulos/fiscal/publico";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import type { TrabajoTomado } from "../../src/puertos/cola-de-trabajos";
import { caeDelFalso, EmisionFalsa } from "../utilidades/emision-falsa";
import { receptorInscripto, renglon } from "../utilidades/facturacion";
import { crearBaseAparte } from "./entorno";
import {
  RelojDePrueba,
  cargarCertificado,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  darDeAltaEnArca,
  crearEscenarioDeCasos,
  facturaManual,
  idDe,
  notaManual,
  type EscenarioDeCasos,
  type TxDeFacturacionDePrueba,
} from "./facturacion-casos-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import { crearMundo } from "./fiscal-apoyo";

/**
 * H7 facturación, tramo F5: los casos de uso de facturación contra una base real, con el rol limitado de la
 * aplicación y el contexto firmado (el dueño de la base solo arma escenarios y mira), y ARCA SIEMPRE falso.
 * Cubre emitir (factura, NC, ND), la idempotencia de la clave, el trabajo de validación con cada desenlace, los
 * cortes a mitad de camino (cierre fallido, proceso muerto, sin respuesta), la reconciliación por consulta, el
 * conflicto con resincronización, descartar, reintentar, el ambiente y el aislamiento. La concurrencia está en
 * `facturacion-casos-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("facturación F5: casos de uso contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeFacturacion>;
  /** Lo que se le agrega a la transacción de cada caso de uso (una falla inyectada). */
  let ajuste: (tx: TxDeFacturacionDePrueba) => TxDeFacturacionDePrueba = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeFacturacion(propia.base, 8, (tx) => ajuste(tx));
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

  const comprobante = async (id: string) =>
    (
      await filas(
        `select estado, envios, numero_reservado::text as reservado, numero::text as numero, cae, resuelto_por,
                to_char(fecha_emision, 'YYYY-MM-DD') as fecha, version, tipo_comprobante as tipo, motivo_descarte
           from comprobante where id = $1`,
        [id],
      )
    )[0];
  const serie = async (e: EscenarioDeCasos, tipo = "FACTURA_B", ambiente = "HOMOLOGACION") =>
    (
      await filas(
        `select estado, ultimo_numero::text as ultimo, numero_en_curso::text as en_curso
           from serie_comprobante where punto_de_venta_id = $1 and tipo_comprobante = $2 and ambiente = $3`,
        [e.pv, tipo, ambiente],
      )
    )[0];
  const trabajos = async (id: string) =>
    await filas<{ clave: string; estado: string; tipo: string }>(
      `select clave_idempotencia as clave, estado, tipo from trabajo
        where starts_with(clave_idempotencia, 'fiscal.validar:' || $1 || ':') order by clave_idempotencia`,
      [id],
    );
  const auditorias = async (e: EscenarioDeCasos, entidad: string) =>
    await filas<{ accion: string; actor: string | null; despues: Record<string, unknown> }>(
      `select accion, actor_persona_id as actor, despues from auditoria_empresa
        where empresa_id = $1 and entidad_id = $2 order by id`,
      [e.empresa, entidad],
    );
  /** Lo que haría el procesador: los trabajos de validación vivos del comprobante terminan en `estado`. */
  const terminarTrabajos = async (id: string, estado: "HECHO" | "FALLIDO" = "HECHO") => {
    const vivos = "starts_with(clave_idempotencia, $1) and estado in ('PENDIENTE', 'EN_CURSO')";
    await dueno.query(
      `update trabajo set estado = 'EN_CURSO' where ${vivos} and estado = 'PENDIENTE'`,
      [`fiscal.validar:${id}:`],
    );
    await dueno.query(`update trabajo set estado = $2 where ${vivos}`, [
      `fiscal.validar:${id}:`,
      estado,
    ]);
  };
  const intentos = async (id: string) =>
    await filas(
      `select operacion, desenlace, numero::text as numero, mensajes from intento_arca
        where comprobante_id = $1 order by iniciado_en, id`,
      [id],
    );

  /** Un escenario, un reloj desde ahora y ARCA falsa por ambiente. */
  async function preparar(
    opciones: Parameters<typeof crearEscenarioDeCasos>[2] = {},
    arca: { HOMOLOGACION: EmisionElectronica; PRODUCCION: EmisionElectronica } = {
      HOMOLOGACION: new EmisionFalsa(),
      PRODUCCION: new EmisionFalsa(),
    },
  ) {
    const e = await crearEscenarioDeCasos(dueno, propia.base, opciones);
    const reloj = new RelojDePrueba(new Date());
    const casos = casosDeFacturacion(entorno, arca, reloj, {
      tiempos: {
        autorizarEnMs: 2_000,
        consultarEnMs: 2_000,
        ultimoAutorizadoEnMs: 2_000,
        puntosDeVentaEnMs: 2_000,
      },
    });
    const dependencias: DependenciasDeFacturacion = {
      transacciones: entorno,
      reglas: REGLAS_CON_FACTURACION,
      emision: { para: (_e, _x, ambiente) => arca[ambiente] },
      reloj,
    };
    return {
      e,
      reloj,
      casos,
      dependencias,
      falsa: arca.HOMOLOGACION as EmisionFalsa,
      como: () => e.como(reloj.ahora()),
      sistema: () => e.sistema(reloj.ahora()),
      /** Emite una factura y devuelve su salida (falla la prueba si no se pudo). */
      emitir: async (
        cambios: Parameters<typeof facturaManual>[1] = {},
      ): Promise<SalidaDeEmitir> => {
        const r = await casos.emitirComprobanteManual(
          e.como(reloj.ahora()),
          facturaManual(e, cambios),
        );
        if (!r.ok) throw new Error(`no se emitió: ${JSON.stringify(r.error)}`);
        return r.valor;
      },
      validar: (id: ComprobanteId) =>
        casos.validarComprobante(e.sistema(reloj.ahora()), { comprobanteId: id }),
      reconciliar: () => casos.reconciliarComprobantes(e.sistema(reloj.ahora())),
    };
  }

  const tomado = (e: EscenarioDeCasos, datos: TrabajoTomado["datos"]): TrabajoTomado => ({
    id: randomUUID(),
    empresaId: empresaId(e.empresa),
    tipo: "fiscal.validar_comprobante",
    datos,
    intentos: 1,
  });

  // ===============================================================================================
  describe("emitir a mano", () => {
    it("una factura B a consumidor final nace PENDIENTE, con su auditoría sin datos del receptor y su trabajo de validación", async () => {
      const p = await preparar();
      const salida = await p.emitir();
      expect(salida).toEqual({
        comprobanteId: salida.comprobanteId,
        estado: "PENDIENTE",
        tipo: "FACTURA_B",
        total: "121.00",
        yaExistia: false,
      });
      expect(await comprobante(salida.comprobanteId)).toMatchObject({
        estado: "PENDIENTE",
        envios: 0,
        reservado: null,
      });
      expect(await trabajos(salida.comprobanteId)).toEqual([
        {
          clave: `fiscal.validar:${salida.comprobanteId}:1`,
          estado: "PENDIENTE",
          tipo: "fiscal.validar_comprobante",
        },
      ]);
      const aud = await auditorias(p.e, salida.comprobanteId);
      expect(aud.map((a) => a.accion)).toEqual(["COMPROBANTE_CREADO"]);
      expect(aud[0]?.actor).toBe(p.e.persona);
      expect(aud[0]?.despues).toEqual({
        clase: "FACTURA",
        tipo: "FACTURA_B",
        total: "121.00",
        puntoDeVenta: 1,
        ambiente: "HOMOLOGACION",
        origen: "MANUAL",
        asociado: null,
      });
      // Nada se pidió a ARCA adentro de la transacción (ADR-007).
      expect(p.falsa.pedidos).toHaveLength(0);
    });

    it("una factura A a un responsable inscripto con IVA discriminado (la letra la decide el dominio)", async () => {
      const p = await preparar();
      const r = await p.emitir({
        receptor: receptorInscripto,
        modoDePrecio: "IVA_DISCRIMINADO",
        renglones: [renglon("100.00", "1", "21")],
      });
      expect(r).toMatchObject({ tipo: "FACTURA_A", total: "121.00" });
    });

    it("la misma clave con el mismo pedido devuelve el mismo comprobante (yaExistia) sin escribir nada más", async () => {
      const p = await preparar();
      const pedido = facturaManual(p.e);
      const primero = await p.casos.emitirComprobanteManual(p.como(), pedido);
      const segundo = await p.casos.emitirComprobanteManual(p.como(), {
        ...pedido,
        // Mismo pedido con los campos en otro orden: misma huella.
        renglones: [...pedido.renglones],
      });
      expect(primero.ok && segundo.ok).toBe(true);
      if (!primero.ok || !segundo.ok) return;
      expect(segundo.valor).toEqual({ ...primero.valor, yaExistia: true });
      expect(await auditorias(p.e, primero.valor.comprobanteId)).toHaveLength(1);
      expect(await trabajos(primero.valor.comprobanteId)).toHaveLength(1);
    });

    it("la misma clave con OTRO pedido es CLAVE_REUTILIZADA (también como nota de crédito)", async () => {
      const p = await preparar();
      const pedido = facturaManual(p.e);
      await p.casos.emitirComprobanteManual(p.como(), pedido);
      expect(
        await p.casos.emitirComprobanteManual(p.como(), {
          ...pedido,
          renglones: [renglon("242.00", "1", "21")],
        }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect(
        await p.casos.emitirNotaDeCredito(
          p.como(),
          notaManual(idDe(pedido.clave), { clave: pedido.clave }),
        ),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    });

    describe("pasaporte con letras (Q5, dueño, 2026-11-06)", () => {
      const turista = (numero: string) =>
        ({
          nombre: "Jane Doe",
          documento: { tipo: "PASAPORTE", numero },
          condicionIva: "CONSUMIDOR_FINAL",
          domicilio: "5th Avenue 1",
        }) as const;
      const documentoGuardado = async (id: string) =>
        (
          await filas(
            "select receptor_documento_tipo as tipo, receptor_documento_numero as numero from comprobante where id = $1",
            [id],
          )
        )[0];

      it("se guarda tal cual figura (minúsculas en mayúsculas), a ARCA va solo la parte numérica y el comprobante conserva el pasaporte completo", async () => {
        const p = await preparar();
        const entero = await p.emitir({ receptor: turista("ABC123456") });
        const minusculas = await p.emitir({ receptor: turista("aab000123") });
        expect(await documentoGuardado(entero.comprobanteId)).toEqual({
          tipo: "PASAPORTE",
          numero: "ABC123456",
        });
        expect(await documentoGuardado(minusculas.comprobanteId)).toEqual({
          tipo: "PASAPORTE",
          numero: "AAB000123",
        });
        await p.validar(entero.comprobanteId);
        await p.validar(minusculas.comprobanteId);
        const enviados = p.falsa.pedidos.map((x) => x.receptor.documento);
        expect(enviados).toEqual([
          { tipo: "PASAPORTE", numero: "ABC123456" },
          { tipo: "PASAPORTE", numero: "AAB000123" },
        ]);
        expect(enviados.map((d) => numeroDeDocumentoParaArca(d))).toEqual([123456n, 123n]);
        // Sigue guardado completo después de autorizar.
        expect(await documentoGuardado(entero.comprobanteId)).toEqual({
          tipo: "PASAPORTE",
          numero: "ABC123456",
        });
      });

      it("el mismo pedido con la misma clave, dos veces seguidas o a la vez, es un solo comprobante", async () => {
        const p = await preparar();
        const pedido = facturaManual(p.e, { receptor: turista("ABC123456") });
        const [a, b] = await Promise.all([
          p.casos.emitirComprobanteManual(p.como(), pedido),
          p.casos.emitirComprobanteManual(p.como(), pedido),
        ]);
        const c = await p.casos.emitirComprobanteManual(p.como(), pedido);
        expect(a.ok && b.ok && c.ok).toBe(true);
        if (!a.ok || !b.ok || !c.ok) return;
        expect(
          new Set([a.valor.comprobanteId, b.valor.comprobanteId, c.valor.comprobanteId]).size,
        ).toBe(1);
        expect(c.valor.yaExistia).toBe(true);
        expect(
          await filas("select 1 from comprobante where empresa_id = $1", [p.e.empresa]),
        ).toHaveLength(1);
        expect(await auditorias(p.e, a.valor.comprobanteId)).toHaveLength(1);
        expect(await trabajos(a.valor.comprobanteId)).toHaveLength(1);
      });

      it("sin cifra, con ceros, de 5 o de 10 caracteres o con otro carácter: RECEPTOR_INVALIDO marcando el documento y nada se escribe", async () => {
        const p = await preparar();
        for (const numero of [
          "ABCDEF",
          "ABC000000",
          "ABC12",
          "ABC1234567",
          "ABC-12345",
          "ABC 12345",
        ]) {
          expect(
            await p.casos.emitirComprobanteManual(
              p.como(),
              facturaManual(p.e, { receptor: turista(numero) }),
            ),
            numero,
          ).toEqual({ ok: false, error: { codigo: "RECEPTOR_INVALIDO", campo: "documento" } });
        }
        expect(
          await filas("select 1 from comprobante where empresa_id = $1", [p.e.empresa]),
        ).toHaveLength(0);
      });

      it("dos empresas con el mismo pasaporte: cada una ve solo el suyo", async () => {
        const a = await preparar();
        const b = await preparar();
        const ra = await a.emitir({ receptor: turista("ABC123456") });
        const rb = await b.emitir({ receptor: turista("ABC123456") });
        expect(ra.comprobanteId).not.toBe(rb.comprobanteId);
        const dueños = await filas<{ id: string; empresa_id: string }>(
          "select id, empresa_id from comprobante where id = any($1) order by empresa_id",
          [[ra.comprobanteId, rb.comprobanteId]],
        );
        expect(dueños.map((x) => x.empresa_id).sort()).toEqual([a.e.empresa, b.e.empresa].sort());
        expect(
          await b.casos.validarComprobante(b.sistema(), { comprobanteId: ra.comprobanteId }),
        ).toEqual({ ok: false, error: "COMPROBANTE_NO_ENCONTRADO" });
      });
    });

    it("sin certificado vigente del emisor en el ambiente del punto de venta: SIN_CERTIFICADO_VIGENTE", async () => {
      const p = await preparar({ sinCertificado: true });
      expect(await p.casos.emitirComprobanteManual(p.como(), facturaManual(p.e))).toEqual({
        ok: false,
        error: "SIN_CERTIFICADO_VIGENTE",
      });
      // Uno de producción no sirve para un punto de venta de homologación.
      await cargarCertificado(propia.base, p.e, "PRODUCCION");
      expect(await p.casos.emitirComprobanteManual(p.como(), facturaManual(p.e))).toEqual({
        ok: false,
        error: "SIN_CERTIFICADO_VIGENTE",
      });
    });

    it("D-115: la versión vigente sin número de IIBB ni «No contribuyente» no emite (también con solo una condición anterior), y no escribe nada", async () => {
      for (const iibb of [
        { numero: null, condicion: null },
        { numero: null, condicion: "LOCAL" },
        { numero: null, condicion: "CONVENIO_MULTILATERAL" },
        { numero: null, condicion: "EXENTO" },
      ]) {
        const p = await preparar({ iibb });
        expect(await p.casos.emitirComprobanteManual(p.como(), facturaManual(p.e))).toEqual({
          ok: false,
          error: "INGRESOS_BRUTOS_SIN_DECLARAR",
        });
        expect(
          await filas("select id from comprobante where empresa_id = $1", [p.e.empresa]),
        ).toEqual([]);
        expect(
          await filas(
            "select id from auditoria_empresa where empresa_id = $1 and accion = 'COMPROBANTE_CREADO'",
            [p.e.empresa],
          ),
        ).toEqual([]);
      }
    });

    it("D-115/D-116: con «No contribuyente» (sin número) o con el número emite, y el comprobante congela exactamente eso", async () => {
      for (const [iibb, esperado] of [
        [
          { numero: null, condicion: "NO_CONTRIBUYENTE" },
          { emisor_iibb_numero: null, emisor_iibb_condicion: "NO_CONTRIBUYENTE" },
        ],
        [
          { numero: "901-123456-7", condicion: null },
          { emisor_iibb_numero: "901-123456-7", emisor_iibb_condicion: null },
        ],
      ] as const) {
        const p = await preparar({ iibb });
        const salida = await p.emitir();
        expect(
          await filas(
            "select emisor_iibb_numero, emisor_iibb_condicion from comprobante where id = $1",
            [salida.comprobanteId],
          ),
        ).toEqual([esperado]);
      }
    });

    it("D-115: repetir el pedido rechazado devuelve lo mismo y la misma clave sigue libre (nada quedó a medias)", async () => {
      const p = await preparar({ iibb: { numero: null, condicion: null } });
      const pedido = facturaManual(p.e);
      const rs = await Promise.all([
        p.casos.emitirComprobanteManual(p.como(), pedido),
        p.casos.emitirComprobanteManual(p.como(), pedido),
      ]);
      for (const r of rs) expect(r).toEqual({ ok: false, error: "INGRESOS_BRUTOS_SIN_DECLARAR" });
      expect(
        await filas("select id from comprobante where empresa_id = $1", [p.e.empresa]),
      ).toEqual([]);
    });

    it("punto de venta inexistente, inactivo o de otra empresa; errores del dominio; nada se escribe", async () => {
      const p = await preparar();
      const otra = await preparar();
      expect(
        await p.casos.emitirComprobanteManual(
          p.como(),
          facturaManual(p.e, { puntoDeVentaId: puntoDeVentaId(otra.e.pv) }),
        ),
      ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_NO_ENCONTRADO" });
      expect(
        await p.casos.emitirComprobanteManual(p.como(), facturaManual(p.e, { renglones: [] })),
      ).toEqual({ ok: false, error: { codigo: "SIN_RENGLONES" } });
      await dueno.query("update punto_de_venta set estado = 'INACTIVO' where id = $1", [p.e.pv]);
      expect(await p.casos.emitirComprobanteManual(p.como(), facturaManual(p.e))).toEqual({
        ok: false,
        error: "PUNTO_DE_VENTA_INACTIVO",
      });
      expect(
        await filas("select 1 from comprobante where empresa_id = $1", [p.e.empresa]),
      ).toHaveLength(0);
    });
  });

  // ===============================================================================================
  describe("el trabajo de validación", () => {
    it("autoriza: número 1, CAE, serie avanzada, intento guardado y auditorías; repetirlo no reenvía", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      expect(await p.validar(id)).toEqual({
        ok: true,
        valor: { tipo: "ENVIADO", numero: 1n, desenlace: "AUTORIZADO", cerrado: true },
      });
      const pv = { cuit: p.e.cuit, numero: 1 } as Parameters<typeof caeDelFalso>[0];
      expect(await comprobante(id)).toMatchObject({
        estado: "AUTORIZADO",
        envios: 1,
        reservado: "1",
        numero: "1",
        cae: caeDelFalso(pv, 1n),
        resuelto_por: "RESPUESTA",
      });
      expect(await serie(p.e)).toEqual({ estado: "LIBRE", ultimo: "1", en_curso: null });
      expect(await intentos(id)).toEqual([
        { operacion: "AUTORIZAR", desenlace: "AUTORIZADO", numero: "1", mensajes: [] },
      ]);
      expect((await auditorias(p.e, id)).map((a) => a.accion)).toEqual([
        "COMPROBANTE_CREADO",
        "COMPROBANTE_EN_VALIDACION",
        "COMPROBANTE_AUTORIZADO",
      ]);
      expect(await p.validar(id)).toEqual({
        ok: true,
        valor: { tipo: "NADA_QUE_VALIDAR", estado: "AUTORIZADO" },
      });
      expect(p.falsa.pedidos).toHaveLength(1);
      // El pedido a ARCA lleva la fecha civil de la empresa y el receptor sin identificar.
      expect(p.falsa.pedidos[0]).toMatchObject({
        tipo: "FACTURA_B",
        numero: 1n,
        receptor: { documento: { tipo: "SIN_IDENTIFICAR" }, condicionIva: "CONSUMIDOR_FINAL" },
      });
    });

    it("repetir la validación de un comprobante ya enviado no hace nada: NADA_QUE_VALIDAR, sin reenviar a ARCA ni escribir ni auditar de nuevo", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      const validar = () => p.casos.validarComprobante(p.sistema(), { comprobanteId: id });
      expect(await validar()).toEqual({
        ok: true,
        valor: { tipo: "ENVIADO", numero: 1n, desenlace: "AUTORIZADO", cerrado: true },
      });
      const foto = async () => ({
        comprobante: await comprobante(id),
        serie: await serie(p.e),
        intentos: await intentos(id),
        auditorias: await auditorias(p.e, id),
        trabajos: await trabajos(id),
        pedidos: p.falsa.pedidos.length,
      });
      const despuesDeLaPrimera = await foto();
      for (let repeticion = 0; repeticion < 2; repeticion += 1) {
        expect(await validar()).toEqual({
          ok: true,
          valor: { tipo: "NADA_QUE_VALIDAR", estado: "AUTORIZADO" },
        });
        expect(await foto()).toEqual(despuesDeLaPrimera);
      }
      expect(despuesDeLaPrimera.pedidos).toBe(1);
    });

    it("rechaza: RECHAZADO con los códigos en el intento, la serie libre sin avanzar; la misma clave sigue dando ese", async () => {
      const p = await preparar();
      p.falsa.programar({ guion: "RECHAZA", errores: [{ codigo: 10015, texto: "doc" }] });
      const pedido = facturaManual(p.e);
      const r = await p.casos.emitirComprobanteManual(p.como(), pedido);
      if (!r.ok) throw new Error("no emitió");
      const id = r.valor.comprobanteId;
      expect(await p.validar(id)).toMatchObject({ ok: true, valor: { desenlace: "RECHAZADO" } });
      expect(await comprobante(id)).toMatchObject({
        estado: "RECHAZADO",
        reservado: "1",
        numero: null,
      });
      expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      expect(await intentos(id)).toEqual([
        {
          operacion: "AUTORIZAR",
          desenlace: "RECHAZADO",
          numero: "1",
          mensajes: [{ clase: "ERROR", codigo: 10015, texto: "doc" }],
        },
      ]);
      const aud = await auditorias(p.e, id);
      expect(aud.at(-1)).toMatchObject({
        accion: "COMPROBANTE_RECHAZADO",
        despues: { estado: "RECHAZADO", errores: [10015], observaciones: [] },
      });
      expect(await p.casos.emitirComprobanteManual(p.como(), pedido)).toMatchObject({
        ok: true,
        valor: { comprobanteId: id, estado: "RECHAZADO", yaExistia: true },
      });
    });

    it("no enviado: vuelve a PENDIENTE con la serie libre; el trabajo se reintenta y sale con el MISMO número", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("NO_ENVIADO");
      const manejador = crearManejadorDeValidarComprobante(p.dependencias);
      expect(await manejador(tomado(p.e, { comprobanteId: id }), p.reloj.ahora())).toEqual({
        tipo: "ERROR",
        error: "NO_ENVIADO: el pedido no salió",
        definitivo: false,
      });
      expect(await comprobante(id)).toMatchObject({
        estado: "PENDIENTE",
        envios: 1,
        reservado: null,
      });
      expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      expect(await manejador(tomado(p.e, { comprobanteId: id }), p.reloj.ahora())).toEqual({
        tipo: "HECHO",
      });
      expect(await comprobante(id)).toMatchObject({ estado: "AUTORIZADO", envios: 2, numero: "1" });
    });

    it("el manejador: datos inválidos o sin empresa es definitivo; un comprobante ya resuelto termina HECHO con nota", async () => {
      const p = await preparar();
      const manejador = crearManejadorDeValidarComprobante(p.dependencias);
      expect(await manejador(tomado(p.e, { comprobanteId: "x" }), p.reloj.ahora())).toMatchObject({
        tipo: "ERROR",
        definitivo: true,
      });
      expect(
        await manejador(
          { ...tomado(p.e, { comprobanteId: randomUUID() }), empresaId: null },
          p.reloj.ahora(),
        ),
      ).toMatchObject({ tipo: "ERROR", definitivo: true });
      expect(
        await manejador(tomado(p.e, { comprobanteId: randomUUID() }), p.reloj.ahora()),
      ).toEqual({ tipo: "ERROR", error: "COMPROBANTE_NO_ENCONTRADO", definitivo: true });
      const { comprobanteId: id } = await p.emitir();
      await p.validar(id);
      expect(await manejador(tomado(p.e, { comprobanteId: id }), p.reloj.ahora())).toEqual({
        tipo: "HECHO",
        nota: "NADA_QUE_VALIDAR: AUTORIZADO",
      });
    });

    it("la serie de un punto de venta nuevo nace con el último que informa ARCA (afuera de la transacción)", async () => {
      const p = await preparar();
      p.falsa.fijarUltimo({ cuit: p.e.cuit, numero: 1 } as never, "FACTURA_B", 41n);
      const { comprobanteId: id } = await p.emitir();
      expect(await p.validar(id)).toMatchObject({ ok: true, valor: { numero: 42n } });
      expect(await serie(p.e)).toMatchObject({ ultimo: "42" });
    });

    it("una empresa no ve el comprobante de otra: el trabajo de B no encuentra el de A", async () => {
      const a = await preparar();
      const b = await preparar();
      const { comprobanteId: id } = await a.emitir();
      expect(await b.casos.validarComprobante(b.sistema(), { comprobanteId: id })).toEqual({
        ok: false,
        error: "COMPROBANTE_NO_ENCONTRADO",
      });
      expect(
        await b.casos.descartarComprobante(b.como(), {
          comprobanteId: id,
          motivo: "x",
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "COMPROBANTE_NO_ENCONTRADO" });
      expect(await comprobante(id)).toMatchObject({ estado: "PENDIENTE" });
    });
  });

  // ===============================================================================================
  describe("cortes a mitad de camino y reconciliación por consulta", () => {
    it("ARCA autorizó y el cierre falló: queda EN_VALIDACION con el CAE en el intento; la reconciliación lo autoriza con ese CAE", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      ajuste = (tx) => ({
        ...tx,
        comprobantes: {
          ...tx.comprobantes,
          transicionar: (empresa, cid, version, cambio) => {
            if (cambio.a === "AUTORIZADO") throw new Error("falla inyectada en el cierre");
            return tx.comprobantes.transicionar(empresa, cid, version, cambio);
          },
        },
      });
      try {
        await expect(p.validar(id)).rejects.toThrow("falla inyectada");
      } finally {
        ajuste = (tx) => tx;
      }
      expect(await comprobante(id)).toMatchObject({ estado: "EN_VALIDACION", reservado: "1" });
      expect(await intentos(id)).toMatchObject([{ desenlace: "AUTORIZADO" }]);
      // Antes de que venza la reserva no se toca.
      expect(await p.reconciliar()).toEqual({
        ok: true,
        valor: { comprobantes: [], reencolados: 0 },
      });
      p.reloj.avanzar(6);
      expect(await p.reconciliar()).toEqual({
        ok: true,
        valor: {
          comprobantes: [
            { comprobanteId: id, resultado: { ok: true, valor: "AUTORIZADO_POR_CONSULTA" } },
          ],
          reencolados: 0,
        },
      });
      expect(await comprobante(id)).toMatchObject({
        estado: "AUTORIZADO",
        numero: "1",
        cae: caeDelFalso({ cuit: p.e.cuit, numero: 1 } as never, 1n),
        resuelto_por: "RECONCILIACION",
      });
      expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
      expect(p.falsa.pedidos).toHaveLength(1);
      expect((await intentos(id)).map((i) => i.operacion)).toEqual(["AUTORIZAR", "CONSULTAR"]);
    });

    it("autorizó y se cayó (incierto): nunca se reenvía; la consulta lo autoriza", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("AUTORIZA_Y_SE_CAE");
      expect(await p.validar(id)).toMatchObject({ ok: true, valor: { desenlace: "INCIERTO" } });
      expect(await comprobante(id)).toMatchObject({ estado: "INCIERTO" });
      expect(await serie(p.e)).toMatchObject({ estado: "EN_CURSO", en_curso: "1" });
      // Un reintento del trabajo no reenvía.
      expect(await p.validar(id)).toMatchObject({ ok: true, valor: { tipo: "NADA_QUE_VALIDAR" } });
      p.reloj.avanzar(6);
      await p.reconciliar();
      expect(await comprobante(id)).toMatchObject({
        estado: "AUTORIZADO",
        resuelto_por: "RECONCILIACION",
      });
      expect(p.falsa.pedidos).toHaveLength(1);
    });

    it("repetir la reconciliación de un comprobante que ya se resolvió no encuentra nada en vuelo: sin consultar a ARCA, escribir ni auditar de nuevo", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("AUTORIZA_Y_SE_CAE");
      await p.validar(id);
      p.reloj.avanzar(6);
      expect(await p.casos.reconciliarComprobantes(p.sistema())).toMatchObject({
        ok: true,
        valor: {
          comprobantes: [
            { comprobanteId: id, resultado: { ok: true, valor: "AUTORIZADO_POR_CONSULTA" } },
          ],
        },
      });
      const foto = async () => ({
        comprobante: await comprobante(id),
        serie: await serie(p.e),
        intentos: await intentos(id),
        auditorias: await auditorias(p.e, id),
        trabajos: await trabajos(id),
        pedidos: p.falsa.pedidos.length,
      });
      const despuesDeLaPrimera = await foto();
      for (let repeticion = 0; repeticion < 2; repeticion += 1) {
        expect(await p.casos.reconciliarComprobantes(p.sistema())).toEqual({
          ok: true,
          valor: { comprobantes: [], reencolados: 0 },
        });
        expect(await foto()).toEqual(despuesDeLaPrimera);
      }
    });

    it("incierto que nunca llegó: la consulta da «no existe», la serie se libera y sale con el MISMO número", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("INCIERTO");
      await p.validar(id);
      p.reloj.avanzar(6);
      const r = await p.reconciliar();
      expect(r).toMatchObject({
        ok: true,
        valor: { comprobantes: [{ resultado: { ok: true, valor: "LIBERADO_POR_CONSULTA" } }] },
      });
      expect(await comprobante(id)).toMatchObject({ estado: "PENDIENTE", reservado: null });
      expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      // El trabajo original terminó (aquí no hay procesador): se reencoló con la clave siguiente.
      await terminarTrabajos(id);
      expect((await trabajos(id)).map((t) => t.clave)).toEqual([`fiscal.validar:${id}:1`]);
      p.reloj.avanzar(6);
      await p.reconciliar();
      expect((await trabajos(id)).map((t) => [t.clave, t.estado])).toEqual([
        [`fiscal.validar:${id}:1`, "HECHO"],
        [`fiscal.validar:${id}:2`, "PENDIENTE"],
      ]);
      expect(await p.validar(id)).toMatchObject({
        ok: true,
        valor: { numero: 1n, desenlace: "AUTORIZADO" },
      });
      expect((await auditorias(p.e, id)).map((a) => a.accion)).toContain(
        "COMPROBANTE_LIBERADO_POR_CONSULTA",
      );
    });

    it("otro sistema usó el número: CONFLICTO y serie BLOQUEADA; resincronizar y reintentar lo emite con el siguiente", async () => {
      const p = await preparar({ rol: "GERENTE" });
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("AUTORIZA_CON_OTROS_DATOS");
      await p.validar(id);
      p.reloj.avanzar(6);
      await p.reconciliar();
      expect(await comprobante(id)).toMatchObject({ estado: "CONFLICTO", reservado: "1" });
      expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA", ultimo: "0" });
      expect(await p.casos.reintentarComprobante(p.como(), { comprobanteId: id })).toEqual({
        ok: false,
        error: "SERIE_BLOQUEADA",
      });
      const resincronizar = {
        puntoDeVentaId: puntoDeVentaId(p.e.pv),
        tipo: "FACTURA_B" as const,
        ambiente: "HOMOLOGACION" as const,
        motivo: "otro sistema usó el punto de venta",
      };
      // La persona vio 0, pero ARCA dice 1: cambió mientras miraba.
      expect(
        await p.casos.resincronizarSerie(p.como(), { ...resincronizar, ultimoVistoEnArca: 0n }),
      ).toEqual({ ok: false, error: "ULTIMO_DISTINTO_DEL_DE_ARCA" });
      expect(
        await p.casos.resincronizarSerie(p.como(), { ...resincronizar, ultimoVistoEnArca: 1n }),
      ).toEqual({ ok: true, valor: { ultimoNumero: 1n, reencolados: 0 } });
      expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
      // Repetirla: la serie ya está LIBRE, se rechaza con su nombre y no escribe ni audita de nuevo.
      const resincronizaciones = () =>
        filas(
          "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'SERIE_RESINCRONIZADA'",
          [p.e.empresa],
        );
      const antesDeRepetir = { serie: await serie(p.e), auditorias: await resincronizaciones() };
      expect(
        await p.casos.resincronizarSerie(p.como(), { ...resincronizar, ultimoVistoEnArca: 1n }),
      ).toEqual({ ok: false, error: "SERIE_NO_BLOQUEADA" });
      expect({ serie: await serie(p.e), auditorias: await resincronizaciones() }).toEqual(
        antesDeRepetir,
      );
      expect(antesDeRepetir.auditorias).toHaveLength(1);
      await terminarTrabajos(id);
      expect(await p.casos.reintentarComprobante(p.como(), { comprobanteId: id })).toEqual({
        ok: true,
        valor: { encolado: true },
      });
      expect(await comprobante(id)).toMatchObject({ estado: "PENDIENTE", reservado: null });
      expect(await p.validar(id)).toMatchObject({
        ok: true,
        valor: { numero: 2n, desenlace: "AUTORIZADO" },
      });
      const acciones = (await auditorias(p.e, id)).map((a) => a.accion);
      expect(acciones).toEqual([
        "COMPROBANTE_CREADO",
        "COMPROBANTE_EN_VALIDACION",
        "COMPROBANTE_INCIERTO",
        "COMPROBANTE_EN_CONFLICTO",
        "COMPROBANTE_REINTENTADO",
        "COMPROBANTE_EN_VALIDACION",
        "COMPROBANTE_AUTORIZADO",
      ]);
    });

    it("desfase: ARCA no tiene el número pero va adelante; serie BLOQUEADA, comprobante PENDIENTE; resincronizar lo reencola", async () => {
      const p = await preparar({ rol: "GERENTE" });
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("INCIERTO");
      await p.validar(id);
      // Para ARCA el 1 no existe, pero su último autorizado es 5 (otro sistema emitió 1 a 5... y el nuestro no).
      const adelante: EmisionElectronica = {
        ultimoAutorizado: () => Promise.resolve({ ok: true, valor: 5n }),
        autorizar: (s) => p.falsa.autorizar(s),
        consultar: () => Promise.resolve({ tipo: "NO_ENCONTRADO" }),
        puntosDeVenta: (cuit) => p.falsa.puntosDeVenta(cuit),
      };
      const conArcaAdelante = casosDeFacturacion(
        entorno,
        { HOMOLOGACION: adelante, PRODUCCION: new EmisionFalsa() },
        p.reloj,
      );
      p.reloj.avanzar(6);
      expect(await conArcaAdelante.reconciliarComprobantes(p.sistema())).toMatchObject({
        ok: true,
        valor: { comprobantes: [{ resultado: { ok: true, valor: "DESFASE" } }] },
      });
      expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA", ultimo: "0" });
      expect(await comprobante(id)).toMatchObject({ estado: "PENDIENTE" });
      // Validar con la serie bloqueada: no envía y espera.
      expect(await p.validar(id)).toEqual({ ok: true, valor: { tipo: "SERIE_BLOQUEADA" } });
      await terminarTrabajos(id);
      expect(
        await conArcaAdelante.resincronizarSerie(p.como(), {
          puntoDeVentaId: puntoDeVentaId(p.e.pv),
          tipo: "FACTURA_B",
          ambiente: "HOMOLOGACION",
          ultimoVistoEnArca: 5n,
          motivo: "desfase con ARCA",
        }),
      ).toEqual({ ok: true, valor: { ultimoNumero: 5n, reencolados: 1 } });
      expect((await trabajos(id)).filter((t) => t.estado === "PENDIENTE")).toHaveLength(1);
      expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "5" });
    });

    it("proceso muerto entre la reserva y la llamada: la consulta no lo encuentra y lo libera; no hay doble autorización", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      const muerta = casosDeFacturacion(
        entorno,
        {
          HOMOLOGACION: {
            ultimoAutorizado: (pv, tipo) => p.falsa.ultimoAutorizado(pv, tipo),
            autorizar: () => {
              throw new Error("el proceso murió antes de llamar");
            },
            consultar: (pv, tipo, n) => p.falsa.consultar(pv, tipo, n),
            puntosDeVenta: (cuit) => p.falsa.puntosDeVenta(cuit),
          },
          PRODUCCION: new EmisionFalsa(),
        },
        p.reloj,
      );
      await expect(muerta.validarComprobante(p.sistema(), { comprobanteId: id })).rejects.toThrow(
        "murió",
      );
      expect(await comprobante(id)).toMatchObject({ estado: "EN_VALIDACION" });
      p.reloj.avanzar(6);
      await p.reconciliar();
      expect(await comprobante(id)).toMatchObject({ estado: "PENDIENTE" });
      await p.validar(id);
      expect(await comprobante(id)).toMatchObject({ estado: "AUTORIZADO", numero: "1" });
      expect(p.falsa.pedidos).toHaveLength(1);
    });

    it("ARCA no responde: tiempo límite propio, INCIERTO dentro del plazo, y no se reenvía", async () => {
      const colgada = new EmisionFalsa();
      const nunca: EmisionElectronica = {
        ultimoAutorizado: (pv, tipo) => colgada.ultimoAutorizado(pv, tipo),
        autorizar: () => new Promise(() => undefined),
        consultar: (pv, tipo, n) => colgada.consultar(pv, tipo, n),
        puntosDeVenta: (cuit) => colgada.puntosDeVenta(cuit),
      };
      const p = await preparar({}, { HOMOLOGACION: nunca, PRODUCCION: colgada });
      const { comprobanteId: id } = await p.emitir();
      const inicio = Date.now();
      expect(await p.validar(id)).toMatchObject({ ok: true, valor: { desenlace: "INCIERTO" } });
      expect(Date.now() - inicio).toBeLessThan(10_000);
      expect(await comprobante(id)).toMatchObject({ estado: "INCIERTO" });
      expect(await intentos(id)).toMatchObject([{ desenlace: "INCIERTO" }]);
    });

    it("una consulta caída no cambia nada; el manejador de reconciliar resume la corrida", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("INCIERTO");
      await p.validar(id);
      p.reloj.avanzar(6);
      p.falsa.consultaCaida = true;
      const manejador = crearManejadorDeReconciliar(p.dependencias);
      expect(
        await manejador({ ...tomado(p.e, {}), tipo: "fiscal.reconciliar" }, p.reloj.ahora()),
      ).toEqual({ tipo: "HECHO", nota: "SIN_CAMBIOS=1 REENCOLADOS=0" });
      expect(await comprobante(id)).toMatchObject({ estado: "INCIERTO" });
      expect(await intentos(id)).toMatchObject([
        { operacion: "AUTORIZAR" },
        { operacion: "CONSULTAR", desenlace: "CONSULTA_FALLIDA" },
      ]);
    });

    it("reencola los PENDIENTE huérfanos de más de 10 minutos (su trabajo agotó los intentos)", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      await terminarTrabajos(id, "FALLIDO");
      expect(await p.reconciliar()).toMatchObject({ ok: true, valor: { reencolados: 0 } });
      p.reloj.avanzar(11);
      expect(await p.reconciliar()).toMatchObject({ ok: true, valor: { reencolados: 1 } });
      expect(await p.reconciliar()).toMatchObject({ ok: true, valor: { reencolados: 0 } });
      expect((await trabajos(id)).map((t) => [t.clave, t.estado])).toEqual([
        [`fiscal.validar:${id}:1`, "FALLIDO"],
        [`fiscal.validar:${id}:2`, "PENDIENTE"],
      ]);
    });
  });

  // ===============================================================================================
  describe("descartar y reintentar", () => {
    it("descartar un PENDIENTE con motivo; dos veces «ya estaba»; el trabajo después no envía", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      const pedido = {
        comprobanteId: id,
        motivo: "  me equivoqué de importe ",
        versionEsperada: 1,
      };
      expect(
        await p.casos.descartarComprobante(p.como(), { ...pedido, versionEsperada: 7 }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(await p.casos.descartarComprobante(p.como(), { ...pedido, motivo: "  " })).toEqual({
        ok: false,
        error: "MOTIVO_DE_DESCARTE_INVALIDO",
      });
      expect(await p.casos.descartarComprobante(p.como(), pedido)).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      expect(await comprobante(id)).toMatchObject({
        estado: "DESCARTADO",
        motivo_descarte: "me equivoqué de importe",
      });
      expect(await p.casos.descartarComprobante(p.como(), pedido)).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect(await p.validar(id)).toEqual({
        ok: true,
        valor: { tipo: "NADA_QUE_VALIDAR", estado: "DESCARTADO" },
      });
      expect((await auditorias(p.e, id)).map((a) => a.accion)).toEqual([
        "COMPROBANTE_CREADO",
        "COMPROBANTE_DESCARTADO",
      ]);
      expect(p.falsa.pedidos).toHaveLength(0);
    });

    it("no se descarta lo que ya salió a ARCA ni lo autorizado", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("INCIERTO");
      await p.validar(id);
      const version = Number((await comprobante(id))?.["version"]);
      expect(
        await p.casos.descartarComprobante(p.como(), {
          comprobanteId: id,
          motivo: "x",
          versionEsperada: version,
        }),
      ).toEqual({ ok: false, error: "COMPROBANTE_YA_ENVIADO" });
      // Con la serie ocupada por el incierto, otro comprobante espera (SERIE_OCUPADA, sin escribir).
      const otro = await p.emitir();
      expect(await p.validar(otro.comprobanteId)).toEqual({
        ok: true,
        valor: { tipo: "SERIE_OCUPADA" },
      });
      const q = await preparar();
      const autorizado = await q.emitir();
      await q.validar(autorizado.comprobanteId);
      expect(
        await q.casos.descartarComprobante(q.como(), {
          comprobanteId: autorizado.comprobanteId,
          motivo: "x",
          versionEsperada: 3,
        }),
      ).toEqual({ ok: false, error: "ESTADO_NO_DESCARTABLE" });
    });

    it("reintentar un PENDIENTE con trabajo vivo no encola otro; con el trabajo FALLIDO encola el siguiente", async () => {
      const p = await preparar();
      const { comprobanteId: id } = await p.emitir();
      expect(await p.casos.reintentarComprobante(p.como(), { comprobanteId: id })).toEqual({
        ok: true,
        valor: { encolado: false },
      });
      await terminarTrabajos(id, "FALLIDO");
      expect(await p.casos.reintentarComprobante(p.como(), { comprobanteId: id })).toEqual({
        ok: true,
        valor: { encolado: true },
      });
      expect(await p.casos.reintentarComprobante(p.como(), { comprobanteId: id })).toEqual({
        ok: true,
        valor: { encolado: false },
      });
      expect((await trabajos(id)).map((t) => t.clave)).toEqual([
        `fiscal.validar:${id}:1`,
        `fiscal.validar:${id}:2`,
      ]);
      await p.validar(id);
      expect(await p.casos.reintentarComprobante(p.como(), { comprobanteId: id })).toEqual({
        ok: false,
        error: "ESTADO_NO_REINTENTABLE",
      });
    });
  });

  // ===============================================================================================
  describe("notas de crédito y de débito", () => {
    it("una NC sobre una factura autorizada: misma letra, receptor copiado, el asociado viaja a ARCA", async () => {
      const p = await preparar();
      const { comprobanteId: factura } = await p.emitir();
      await p.validar(factura);
      const r = await p.casos.emitirNotaDeCredito(p.como(), notaManual(factura));
      expect(r).toMatchObject({ ok: true, valor: { tipo: "NOTA_CREDITO_B", total: "121.00" } });
      if (!r.ok) return;
      expect(await p.validar(r.valor.comprobanteId)).toMatchObject({
        ok: true,
        valor: { numero: 1n, desenlace: "AUTORIZADO" },
      });
      expect(p.falsa.pedidos.at(-1)).toMatchObject({
        tipo: "NOTA_CREDITO_B",
        asociado: { tipo: "FACTURA_B", puntoDeVenta: 1, numero: 1n },
      });
      expect(await serie(p.e, "NOTA_CREDITO_B")).toMatchObject({ ultimo: "1" });
    });

    it("una ND sobre una factura autorizada; sobre una no autorizada o inexistente, error con nombre", async () => {
      const p = await preparar();
      const { comprobanteId: pendiente } = await p.emitir();
      expect(await p.casos.emitirNotaDeDebito(p.como(), notaManual(pendiente))).toEqual({
        ok: false,
        error: { codigo: "ASOCIADO_NO_AUTORIZADO" },
      });
      expect(await p.casos.emitirNotaDeCredito(p.como(), notaManual(idDe(randomUUID())))).toEqual({
        ok: false,
        error: "COMPROBANTE_ASOCIADO_NO_ENCONTRADO",
      });
      await p.validar(pendiente);
      expect(await p.casos.emitirNotaDeDebito(p.como(), notaManual(pendiente))).toMatchObject({
        ok: true,
        valor: { tipo: "NOTA_DEBITO_B" },
      });
    });
  });

  // ===============================================================================================
  describe("el ambiente", () => {
    it("emitir en homologación no toca la serie de producción del mismo punto de venta", async () => {
      const p = await preparar({ rol: "GERENTE" });
      const { comprobanteId: id } = await p.emitir();
      await p.validar(id);
      expect(await serie(p.e, "FACTURA_B", "PRODUCCION")).toBeUndefined();
      expect(await serie(p.e, "FACTURA_B", "HOMOLOGACION")).toMatchObject({ ultimo: "1" });
    });

    it("cambiar a producción exige un certificado de producción, no con una serie en curso; «ya estaba»; y no se vuelve (QF2)", async () => {
      const arca = { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: new EmisionFalsa() };
      const p = await preparar({ rol: "GERENTE" }, arca);
      // D-77: ARCA de producción tiene dado de alta el punto de venta (sin eso no pasa; está en `facturacion-ambiente-arca.test.ts`).
      darDeAltaEnArca(arca.PRODUCCION, p.e);
      const version = async () =>
        Number(
          (await filas("select version from punto_de_venta where id = $1", [p.e.pv]))[0]?.[
            "version"
          ],
        );
      const pv = puntoDeVentaId(p.e.pv);
      expect(
        await p.casos.cambiarAmbienteDePuntoDeVenta(p.como(), {
          puntoDeVentaId: pv,
          ambiente: "PRODUCCION",
          versionEsperada: await version(),
        }),
      ).toEqual({ ok: false, error: "SIN_CERTIFICADO_VIGENTE" });
      await cargarCertificado(propia.base, p.e, "PRODUCCION");
      const { comprobanteId: id } = await p.emitir();
      p.falsa.programar("INCIERTO");
      await p.validar(id);
      expect(
        await p.casos.cambiarAmbienteDePuntoDeVenta(p.como(), {
          puntoDeVentaId: pv,
          ambiente: "PRODUCCION",
          versionEsperada: await version(),
        }),
      ).toEqual({ ok: false, error: "SERIE_EN_CURSO" });
      p.reloj.avanzar(6);
      await p.reconciliar();
      expect(
        await p.casos.cambiarAmbienteDePuntoDeVenta(p.como(), {
          puntoDeVentaId: pv,
          ambiente: "PRODUCCION",
          versionEsperada: (await version()) + 5,
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(
        await p.casos.cambiarAmbienteDePuntoDeVenta(p.como(), {
          puntoDeVentaId: pv,
          ambiente: "PRODUCCION",
          versionEsperada: await version(),
        }),
      ).toEqual({ ok: true, valor: { yaEstaba: false } });
      expect(
        await p.casos.cambiarAmbienteDePuntoDeVenta(p.como(), {
          puntoDeVentaId: pv,
          ambiente: "PRODUCCION",
          versionEsperada: 0,
        }),
      ).toEqual({ ok: true, valor: { yaEstaba: true } });
      expect((await auditorias(p.e, p.e.pv)).map((a) => a.accion)).toEqual([
        "PUNTO_DE_VENTA_AMBIENTE_CAMBIADO",
      ]);
      // El comprobante de homologación pendiente ya no sale: su ambiente no es el del punto de venta.
      const manejador = crearManejadorDeValidarComprobante(p.dependencias);
      expect(await manejador(tomado(p.e, { comprobanteId: id }), p.reloj.ahora())).toEqual({
        tipo: "ERROR",
        error: "AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA",
        definitivo: true,
      });
      // Emite en producción y no puede volver.
      const prod = await p.emitir();
      await p.validar(prod.comprobanteId);
      expect(await serie(p.e, "FACTURA_B", "PRODUCCION")).toMatchObject({ ultimo: "1" });
      expect(
        await p.casos.cambiarAmbienteDePuntoDeVenta(p.como(), {
          puntoDeVentaId: pv,
          ambiente: "HOMOLOGACION",
          versionEsperada: await version(),
        }),
      ).toEqual({ ok: false, error: "AMBIENTE_NO_VUELVE" });
    });
  });

  // ===============================================================================================
  describe("empresa que no opera", () => {
    it("una empresa suspendida no emite", async () => {
      const mundo = await crearMundo(dueno);
      const p = await preparar({ mundo });
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [mundo.empresa],
      );
      expect(await p.casos.emitirComprobanteManual(p.como(), facturaManual(p.e))).toMatchObject({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA" },
      });
    });
  });
});
