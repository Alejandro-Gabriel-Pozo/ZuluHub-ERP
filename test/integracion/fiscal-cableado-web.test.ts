import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  cambiarAmbienteDePuntoDeVenta,
  clavesDeLaValidacionInicial,
  descartarComprobante,
  emitirFactura,
  emitirNotaDeCredito,
  listarComprobantes,
  reintentarComprobante,
  resincronizarSerie,
  verComprobante,
  type DependenciasDeFacturacionWeb,
} from "../../src/composicion/facturacion-web";
import { atenderCron } from "../../src/composicion/rutas-de-sistema";
import { armarTrabajos, claveDeReconciliacion } from "../../src/composicion/trabajos";
import { armarWeb } from "../../src/composicion/web";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { ProveedorDeEmision } from "../../src/modulos/fiscal/publico";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeCasos, type EscenarioDeCasos } from "./facturacion-casos-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";
import { comoEmpresa } from "./entorno";

/**
 * Cableado fiscal: la composición REAL (conexiones, web y trabajos, con la base de verdad y los roles limitados) con el
 * servicio de ARCA falso. Lo que se prueba es el CABLEADO, no los casos de uso (esos ya tienen sus pruebas):
 *  - lo que la web ofrece de facturación funciona de punta a punta: emitir, llevar el comprobante a ARCA con el manejador
 *    de la cola, y verlo en el listado y el detalle;
 *  - dos clics, dos trabajos o el mismo trabajo repetido NO emiten dos veces ni duplican un número;
 *  - cada acción exige SU permiso en el servidor, la empresa sale del contexto y nunca del pedido, y ninguna empresa ve
 *    ni toca lo de otra;
 *  - ningún error de persistencia, texto de ARCA ni cadena de conexión llega a la respuesta.
 * El catálogo real tiene `facturacion` EN DESARROLLO: acá se usa uno con el módulo disponible (como las pruebas de
 * los casos de uso) y una prueba aparte verifica que con el real emitir da `MODULO_EN_DESARROLLO`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const aleatorio = (): string => randomBytes(32).toString("hex");

/** Lo que manda el navegador: JSON sin tipos de dominio. Dinero y cantidades, como texto. */
const renglonCrudo = (cambios: Record<string, unknown> = {}) => ({
  descripcion: "Medialunas",
  cantidad: "1",
  precioUnitario: "121",
  descuento: null,
  alicuota: "21",
  ...cambios,
});
const facturaCruda = (e: Pick<EscenarioDeCasos, "pv">, cambios: Record<string, unknown> = {}) => ({
  clave: randomUUID(),
  puntoDeVentaId: e.pv,
  concepto: "PRODUCTOS",
  servicio: null,
  modoDePrecio: "IVA_INCLUIDO",
  receptor: {
    nombre: null,
    documento: { tipo: "SIN_IDENTIFICAR" },
    condicionIva: "CONSUMIDOR_FINAL",
    domicilio: null,
  },
  renglones: [renglonCrudo()],
  ...cambios,
});

describe.skipIf(base === null)("cableado fiscal: la web y la cola con la composición real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  const registrados: string[] = [];
  /** Un ARCA falso por ambiente (cada ambiente es otro ARCA). */
  const arca = { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: new EmisionFalsa() };
  const emision: ProveedorDeEmision = { para: (_empresa, _emisor, ambiente) => arca[ambiente] };
  let d: DependenciasDeFacturacionWeb;
  let trabajos: ReturnType<typeof armarTrabajos>;
  let web: ReturnType<typeof armarWeb>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.base.app,
      PEDERNAL_DB_TRABAJOS: propia.base.trabajos,
      // Lo que pide armar el procesador completo (los manejadores de invitaciones); nunca se usa acá.
      PEDERNAL_SECRETO_INVITACIONES: aleatorio(),
      PEDERNAL_RESEND_API_KEY: "relleno",
      PEDERNAL_CORREO_REMITENTE: "Prueba <prueba@ejemplo.test>",
      PEDERNAL_NOMBRE_DE_MARCA: "Marca de prueba",
      PEDERNAL_URL_BASE: "https://app.ejemplo.test",
    };
    conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
    web = armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION, emision });
    trabajos = armarTrabajos(conexiones, {
      emision,
      alRegistrarProblema: (p) => registrados.push(`${p.fase}: ${p.mensaje}`),
    });
    d = {
      casosDeUso: web.casosDeUsoDeFacturacion,
      consultas: web.consultasDeFacturacion,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  }, 120_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await conexiones.transaccionesDeTrabajos().cerrar();
    await dueno.end();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows;

  /**
   * Una empresa con facturación activada de verdad (módulo activado y plan que lo incluye, como lo lee la autorización
   * real), su emisor, un punto de venta, datos fiscales y un certificado vigente; y un miembro con ese rol.
   */
  async function empresaConFacturacion(rol: RolDePrueba = "OPERADOR"): Promise<EscenarioDeCasos> {
    const e = await crearEscenarioDeCasos(dueno, propia.base, { rol });
    const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
    await asignarPlan(dueno, e.tenant, version);
    await dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [e.empresa],
    );
    return e;
  }

  /** Lo mismo que `e.como`, con otra persona de esa empresa (otro rol). */
  async function comoOtroRol(e: EscenarioDeCasos, rol: RolDePrueba): Promise<ContextoOperativo> {
    const persona = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, persona.id, rol);
    return {
      ...comoEmpresa(empresaId(e.empresa), personaId(persona.id)),
      ahora: new Date(),
    };
  }

  const ahora = (): Date => new Date();
  const estadoDe = async (id: string) =>
    (await filas<{ estado: string }>("select estado from comprobante where id = $1", [id]))[0]
      ?.estado;
  const trabajosDe = (id: string) =>
    filas<{ clave_idempotencia: string; estado: string }>(
      "select clave_idempotencia, estado from trabajo where clave_idempotencia like $1 order by 1",
      [`fiscal.validar:${id}:%`],
    );
  const comoPersonaDe = (e: EscenarioDeCasos) => e.como(ahora());

  /** Emite y corre el manejador de la cola, como lo haría el despacho inmediato. */
  async function emitirYValidar(e: EscenarioDeCasos, entrada = facturaCruda(e)) {
    const emitido = await emitirFactura(d, comoPersonaDe(e), entrada);
    if (!emitido.ok) throw new Error(`no se pudo emitir: ${JSON.stringify(emitido.error)}`);
    await trabajos
      .procesador()
      .despacharPorClaves(
        empresaId(e.empresa),
        clavesDeLaValidacionInicial(emitido.dato.comprobanteId),
        ahora(),
      );
    return emitido.dato;
  }

  // ===============================================================================================
  describe("de punta a punta", () => {
    it("emitir, llevar el comprobante a ARCA con el manejador de la cola, y verlo en el listado y el detalle", async () => {
      const e = await empresaConFacturacion();
      const antes = arca.HOMOLOGACION.pedidos.length;
      const emitido = await emitirFactura(d, comoPersonaDe(e), facturaCruda(e));
      expect(emitido).toMatchObject({
        ok: true,
        dato: { estado: "PENDIENTE", tipo: "FACTURA_B", total: "121.00", yaExistia: false },
      });
      if (!emitido.ok) return;
      const id = emitido.dato.comprobanteId;
      // Nada salió a ARCA al emitir: lo lleva el trabajo, afuera de la transacción de la persona.
      expect(arca.HOMOLOGACION.pedidos.length).toBe(antes);
      expect(await trabajosDe(id)).toEqual([
        { clave_idempotencia: `fiscal.validar:${id}:1`, estado: "PENDIENTE" },
      ]);

      await trabajos
        .procesador()
        .despacharPorClaves(empresaId(e.empresa), clavesDeLaValidacionInicial(id), ahora());
      expect(await estadoDe(id)).toBe("AUTORIZADO");
      expect(arca.HOMOLOGACION.pedidos.length).toBe(antes + 1);
      expect((await trabajosDe(id))[0]?.estado).toBe("HECHO");

      const detalle = await verComprobante(d, comoPersonaDe(e), { comprobanteId: id });
      expect(detalle).toMatchObject({
        ok: true,
        dato: {
          id,
          estado: "AUTORIZADO",
          tipo: "FACTURA_B",
          ambiente: "HOMOLOGACION",
          origenTipo: "MANUAL",
          importes: { total: "121.00" },
          ultimoIntento: { operacion: "AUTORIZAR", desenlace: "AUTORIZADO" },
        },
      });
      expect(detalle.ok && detalle.dato.numero).toMatch(/^\d{5}-\d{8}$/);
      expect(detalle.ok && detalle.dato.cae).toMatch(/^\d{14}$/);
      // Lo que la pantalla NO necesita no sale: ni el emisor, ni quién lo creó, ni el id del origen.
      const salida = JSON.stringify(detalle);
      expect(salida).not.toContain(e.emisor);
      expect(salida).not.toContain(e.persona);
      expect(Object.keys(detalle.ok ? detalle.dato : {})).not.toEqual(
        expect.arrayContaining(["emisorId", "creadoPor", "origen", "huella"]),
      );

      const lista = await listarComprobantes(d, comoPersonaDe(e), undefined);
      expect(lista).toMatchObject({
        ok: true,
        dato: { items: [{ id, estado: "AUTORIZADO", total: "121.00" }], siguiente: null },
      });
    });

    it("una nota de crédito sobre el comprobante autorizado también sale por la cola", async () => {
      const e = await empresaConFacturacion();
      const factura = await emitirYValidar(e);
      const nota = await emitirNotaDeCredito(d, comoPersonaDe(e), {
        clave: "33333333-3333-4333-8333-333333333333",
        comprobanteAsociadoId: factura.comprobanteId,
        puntoDeVentaId: null,
        concepto: "PRODUCTOS",
        servicio: null,
        modoDePrecio: "IVA_INCLUIDO",
        renglones: [
          {
            descripcion: "Devolución",
            cantidad: "1",
            precioUnitario: "121",
            descuento: null,
            alicuota: "21",
          },
        ],
        motivo: "Devolución",
      });
      expect(nota).toMatchObject({ ok: true, dato: { tipo: "NOTA_CREDITO_B", yaExistia: false } });
      if (!nota.ok) return;
      await trabajos
        .procesador()
        .despacharPorClaves(
          empresaId(e.empresa),
          clavesDeLaValidacionInicial(nota.dato.comprobanteId),
          ahora(),
        );
      expect(await estadoDe(nota.dato.comprobanteId)).toBe("AUTORIZADO");
    });

    it("lo que ARCA rechaza se ve traducido: el texto crudo de ARCA no llega a la pantalla", async () => {
      const e = await empresaConFacturacion();
      const crudo = "Texto crudo de ARCA: CUIT 20111111112 en /ws/internos";
      arca.HOMOLOGACION.programar({
        guion: "RECHAZA",
        errores: [{ codigo: 10013, texto: crudo }],
        observaciones: [{ codigo: 10237, texto: crudo }],
      });
      const emitido = await emitirYValidar(e);
      expect(await estadoDe(emitido.comprobanteId)).toBe("RECHAZADO");
      const detalle = await verComprobante(d, comoPersonaDe(e), {
        comprobanteId: emitido.comprobanteId,
      });
      expect(detalle.ok && detalle.dato.ultimoIntento?.mensajes).toEqual(
        expect.arrayContaining([
          { clase: "ERROR", codigo: 10013, clave: "fiscal.arca.receptor_para_a" },
          {
            clase: "OBSERVACION",
            codigo: 10237,
            clave: "fiscal.arca.nota_mayor_que_el_comprobante",
          },
        ]),
      );
      expect(JSON.stringify(detalle)).not.toContain("crudo");
      expect(JSON.stringify(detalle)).not.toContain("/ws/internos");
    });
  });

  // ===============================================================================================
  describe("concurrencia e idempotencia: nunca dos emisiones ni un número duplicado", () => {
    it("diez clics a la vez con la misma clave dejan UN comprobante, UN trabajo y UNA autorización", async () => {
      const e = await empresaConFacturacion();
      const entrada = facturaCruda(e);
      const antes = arca.HOMOLOGACION.pedidos.length;
      const respuestas = await Promise.all(
        Array.from({ length: 10 }, () => emitirFactura(d, comoPersonaDe(e), entrada)),
      );
      expect(respuestas.every((r) => r.ok)).toBe(true);
      const ids = new Set(respuestas.map((r) => (r.ok ? r.dato.comprobanteId : "")));
      expect(ids.size).toBe(1);
      // Uno creó; los otros nueve devolvieron el mismo (sin escribir).
      expect(respuestas.filter((r) => r.ok && !r.dato.yaExistia)).toHaveLength(1);
      const [id] = [...ids];
      expect(
        (await filas("select 1 from comprobante where empresa_id = $1", [e.empresa])).length,
      ).toBe(1);
      expect(await trabajosDe(id ?? "")).toHaveLength(1);

      // Diez despachos a la vez del mismo trabajo: lo toma uno solo.
      await Promise.all(
        Array.from({ length: 10 }, () =>
          trabajos
            .procesador()
            .despacharPorClaves(empresaId(e.empresa), [`fiscal.validar:${id}:1`], ahora()),
        ),
      );
      expect(arca.HOMOLOGACION.pedidos.length).toBe(antes + 1);
      expect(await estadoDe(id ?? "")).toBe("AUTORIZADO");
      const series = await filas<{ ultimo_numero: string }>(
        "select ultimo_numero from serie_comprobante where empresa_id = $1",
        [e.empresa],
      );
      expect(series.map((s) => s.ultimo_numero)).toEqual(["1"]);
    });

    it("el mismo trabajo ejecutado dos veces a la vez, y otra vez después, da el mismo resultado sin efecto doble", async () => {
      const e = await empresaConFacturacion();
      const emitido = await emitirFactura(d, comoPersonaDe(e), facturaCruda(e));
      if (!emitido.ok) throw new Error("no se pudo emitir");
      const id = emitido.dato.comprobanteId;
      const [trabajo] = await filas<{ id: string }>(
        "select id from trabajo where clave_idempotencia = $1",
        [`fiscal.validar:${id}:1`],
      );
      const procesador = trabajos.procesador();
      const antes = arca.HOMOLOGACION.pedidos.length;
      const resultados = await Promise.all([
        procesador.procesarUno(trabajo?.id ?? "", ahora()),
        procesador.procesarUno(trabajo?.id ?? "", ahora()),
      ]);
      expect(resultados.sort()).toEqual(["HECHO", "NO_TOMADO"]);
      expect(arca.HOMOLOGACION.pedidos.length).toBe(antes + 1);
      const estado = await estadoDe(id);
      const numero = await filas("select numero, cae from comprobante where id = $1", [id]);
      // Una vez terminado, repetirlo no hace nada.
      expect(await procesador.procesarUno(trabajo?.id ?? "", ahora())).toBe("NO_TOMADO");
      expect(arca.HOMOLOGACION.pedidos.length).toBe(antes + 1);
      expect(await estadoDe(id)).toBe(estado);
      expect(await filas("select numero, cae from comprobante where id = $1", [id])).toEqual(
        numero,
      );
    });

    it("tres trabajos DISTINTOS para el mismo comprobante, a la vez (un reencolado, una resincronización), emiten una sola vez", async () => {
      const e = await empresaConFacturacion();
      const emitido = await emitirFactura(d, comoPersonaDe(e), facturaCruda(e));
      if (!emitido.ok) throw new Error("no se pudo emitir");
      const id = emitido.dato.comprobanteId;
      // Dos trabajos más con otra clave (`:2`, `:3`), como los que deja `reintentar` o `resincronizar`.
      for (const n of [2, 3]) {
        await dueno.query(
          `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
           values ($1, 'fiscal.validar_comprobante', $2::jsonb, $3)`,
          [e.empresa, JSON.stringify({ comprobanteId: id }), `fiscal.validar:${id}:${n}`],
        );
      }
      const antes = arca.HOMOLOGACION.pedidos.length;
      await trabajos.procesador().despacharPorClaves(
        empresaId(e.empresa),
        [1, 2, 3].map((n) => `fiscal.validar:${id}:${n}`),
        ahora(),
      );
      expect(arca.HOMOLOGACION.pedidos.length).toBe(antes + 1);
      expect(await estadoDe(id)).toBe("AUTORIZADO");
      expect((await trabajosDe(id)).map((t) => t.estado)).toEqual(["HECHO", "HECHO", "HECHO"]);
      const numeros = await filas<{ numero: string }>(
        "select numero from comprobante where empresa_id = $1",
        [e.empresa],
      );
      expect(numeros).toEqual([{ numero: "1" }]);
    });

    it("dos comprobantes distintos a la vez reciben números distintos y seguidos", async () => {
      const e = await empresaConFacturacion();
      const emitidos = await Promise.all(
        [1, 2, 3, 4].map(() => emitirFactura(d, comoPersonaDe(e), facturaCruda(e))),
      );
      const claves = emitidos.flatMap((r) =>
        r.ok ? clavesDeLaValidacionInicial(r.dato.comprobanteId) : [],
      );
      expect(claves).toHaveLength(4);
      await trabajos.procesador().despacharPorClaves(empresaId(e.empresa), claves, ahora());
      const numeros = await filas<{ numero: string }>(
        "select numero from comprobante where empresa_id = $1 and estado = 'AUTORIZADO' order by numero::int",
        [e.empresa],
      );
      expect(numeros.map((n) => n.numero)).toEqual(["1", "2", "3", "4"]);
    });
  });

  // ===============================================================================================
  describe("autorización en el servidor y aislamiento entre empresas", () => {
    it("con el catálogo REAL el módulo sigue en desarrollo: emitir y ver dan MODULO_EN_DESARROLLO", async () => {
      const e = await empresaConFacturacion();
      const real = armarWeb(conexiones, { emision });
      const dReal: DependenciasDeFacturacionWeb = {
        ...d,
        casosDeUso: real.casosDeUsoDeFacturacion,
        consultas: real.consultasDeFacturacion,
      };
      expect(REGLAS_DE_EMPRESA.catalogo.facturacion.estado).toBe("en_desarrollo");
      const emitido = await emitirFactura(dReal, comoPersonaDe(e), facturaCruda(e));
      expect(emitido).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      const lista = await listarComprobantes(dReal, comoPersonaDe(e), undefined);
      expect(lista).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(
        (await filas("select 1 from comprobante where empresa_id = $1", [e.empresa])).length,
      ).toBe(0);
    });

    it("cada acción exige SU permiso: el operador no resincroniza ni cambia el ambiente; el gerente sí puede intentarlo", async () => {
      const e = await empresaConFacturacion("OPERADOR");
      const operador = comoPersonaDe(e);
      const administrador = await comoOtroRol(e, "ADMINISTRADOR");
      const gerente = await comoOtroRol(e, "GERENTE");
      const resincronizar = {
        puntoDeVentaId: e.pv,
        tipo: "FACTURA_B",
        ambiente: "HOMOLOGACION",
        ultimoVistoEnArca: "5",
        motivo: "Otro sistema usó el punto de venta",
      };
      const cambiar = { puntoDeVentaId: e.pv, ambiente: "HOMOLOGACION", versionEsperada: 1 };
      for (const contexto of [operador, administrador]) {
        expect(await resincronizarSerie(d, contexto, resincronizar)).toMatchObject({
          ok: false,
          error: { codigo: "SIN_PERMISO", presentacion: "POR_QUE_NO_PUEDO" },
        });
        expect(await cambiarAmbienteDePuntoDeVenta(d, contexto, cambiar)).toMatchObject({
          ok: false,
          error: { codigo: "SIN_PERMISO" },
        });
      }
      // El gerente pasa el permiso: lo que sigue ya es de negocio (no hay serie que resincronizar todavía).
      expect(await resincronizarSerie(d, gerente, resincronizar)).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_SERIE_NO_ENCONTRADA" },
      });
      // Los tres roles emiten, ven, descartan y reintentan.
      for (const contexto of [operador, administrador, gerente]) {
        const emitido = await emitirFactura(d, contexto, facturaCruda(e));
        expect(emitido.ok).toBe(true);
        expect((await listarComprobantes(d, contexto, undefined)).ok).toBe(true);
      }
    });

    it("alguien sin membresía en la empresa no puede nada: el guard lo rechaza (sin rol no hay módulos) y no se escribe", async () => {
      const e = await empresaConFacturacion();
      const extraño = await crearPersonaDeBase(dueno);
      const contexto: ContextoOperativo = {
        ...comoEmpresa(empresaId(e.empresa), personaId(extraño.id)),
        ahora: ahora(),
      };
      const antes = await filas("select 1 from comprobante");
      // Sin membresía no hay rol y la autorización no trae módulos: el motivo sale del guard, nunca un dato de la empresa.
      for (const r of [
        await emitirFactura(d, contexto, facturaCruda(e)),
        await listarComprobantes(d, contexto, undefined),
        await verComprobante(d, contexto, { comprobanteId: randomUUID() }),
      ]) {
        expect(r).toMatchObject({ ok: false, error: { presentacion: "POR_QUE_NO_PUEDO" } });
      }
      expect(await filas("select 1 from comprobante")).toHaveLength(antes.length);
    });

    it("la empresa sale del contexto: un `empresaId` o un `emisorId` en el pedido se ignoran", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      const emitido = await emitirFactura(d, comoPersonaDe(a), {
        ...facturaCruda(a),
        empresaId: b.empresa,
        emisorId: b.emisor,
        ambiente: "PRODUCCION",
      });
      expect(emitido.ok).toBe(true);
      if (!emitido.ok) return;
      const [fila] = await filas<{ empresa_id: string; emisor_id: string; ambiente: string }>(
        "select empresa_id, emisor_id, ambiente from comprobante where id = $1",
        [emitido.dato.comprobanteId],
      );
      expect(fila).toEqual({
        empresa_id: a.empresa,
        emisor_id: a.emisor,
        ambiente: "HOMOLOGACION",
      });
      expect(
        (await filas("select 1 from comprobante where empresa_id = $1", [b.empresa])).length,
      ).toBe(0);
    });

    it("una empresa no ve, ni toca, lo de otra: el comprobante ajeno «no existe» y el punto de venta ajeno tampoco", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      const deA = await emitirYValidar(a);

      // B no lo ve (ni en el detalle ni en el listado), igual que uno inexistente.
      const inexistente = await verComprobante(d, comoPersonaDe(b), {
        comprobanteId: "99999999-9999-4999-8999-999999999999",
      });
      const ajeno = await verComprobante(d, comoPersonaDe(b), { comprobanteId: deA.comprobanteId });
      expect(ajeno).toEqual(inexistente);
      expect(ajeno).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" },
      });
      expect(await listarComprobantes(d, comoPersonaDe(b), undefined)).toMatchObject({
        ok: true,
        dato: { items: [] },
      });
      // B no lo descarta, ni lo reintenta, ni le emite una nota.
      expect(
        await descartarComprobante(d, comoPersonaDe(b), {
          comprobanteId: deA.comprobanteId,
          motivo: "x",
          versionEsperada: 1,
        }),
      ).toMatchObject({ ok: false, error: { codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" } });
      expect(
        await reintentarComprobante(d, comoPersonaDe(b), { comprobanteId: deA.comprobanteId }),
      ).toMatchObject({ ok: false, error: { codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" } });
      // B no emite con el punto de venta de A.
      expect(await emitirFactura(d, comoPersonaDe(b), facturaCruda(a))).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO" },
      });
      expect(await estadoDe(deA.comprobanteId)).toBe("AUTORIZADO");
    });
  });

  // ===============================================================================================
  describe("errores de negocio y errores que no deben salir", () => {
    it("sin certificado vigente: FISCAL_SIN_CERTIFICADO, y el pedido inválido, FISCAL_DATOS_INVALIDOS con su campo", async () => {
      const sin = await crearEscenarioDeCasos(dueno, propia.base, {
        rol: "OPERADOR",
        sinCertificado: true,
      });
      const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
      await asignarPlan(dueno, sin.tenant, version);
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
        [sin.empresa],
      );
      expect(await emitirFactura(d, sin.como(ahora()), facturaCruda(sin))).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_SIN_CERTIFICADO", presentacion: "AVISO" },
      });
      const e = await empresaConFacturacion();
      expect(
        await emitirFactura(d, comoPersonaDe(e), {
          ...facturaCruda(e),
          renglones: [
            {
              descripcion: "x",
              cantidad: "uno",
              precioUnitario: "1",
              descuento: null,
              alicuota: "21",
            },
          ],
        }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_DATOS_INVALIDOS", campo: "renglon1.cantidad" },
      });
    });

    it("la misma clave con otros datos: FISCAL_PEDIDO_REPETIDO, y no se crea otro comprobante", async () => {
      const e = await empresaConFacturacion();
      const entrada = facturaCruda(e);
      expect((await emitirFactura(d, comoPersonaDe(e), entrada)).ok).toBe(true);
      const otro = {
        ...entrada,
        renglones: [
          {
            descripcion: "otra",
            cantidad: "1",
            precioUnitario: "50",
            descuento: null,
            alicuota: "21",
          },
        ],
      };
      expect(await emitirFactura(d, comoPersonaDe(e), otro)).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_PEDIDO_REPETIDO" },
      });
      expect(
        (await filas("select 1 from comprobante where empresa_id = $1", [e.empresa])).length,
      ).toBe(1);
    });

    it("descartar y reintentar se repiten sin duplicar; descartado, el trabajo ya no llama a ARCA", async () => {
      const e = await empresaConFacturacion();
      const emitido = await emitirFactura(d, comoPersonaDe(e), facturaCruda(e));
      if (!emitido.ok) throw new Error("no se pudo emitir");
      const id = emitido.dato.comprobanteId;
      const [antes] = await filas<{ version: number }>(
        "select version from comprobante where id = $1",
        [id],
      );
      const pedido = {
        comprobanteId: id,
        motivo: "Error de carga",
        versionEsperada: antes?.version ?? 1,
      };
      expect(await descartarComprobante(d, comoPersonaDe(e), pedido)).toMatchObject({
        ok: true,
        dato: { yaEstaba: false },
      });
      // Repetirlo (doble clic): con la versión que vio la pantalla da «ya estaba» o `VERSION_DESACTUALIZADA`, nunca un segundo descarte.
      const repetido = await descartarComprobante(d, comoPersonaDe(e), pedido);
      expect(repetido.ok ? repetido.dato.yaEstaba : repetido.error.codigo).toSatisfy(
        (r: unknown) => r === true || r === "FISCAL_VERSION_DESACTUALIZADA",
      );
      expect(await estadoDe(id)).toBe("DESCARTADO");
      expect(
        (
          await filas(
            "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'COMPROBANTE_DESCARTADO'",
            [e.empresa],
          )
        ).length,
      ).toBe(1);
      const antes2 = arca.HOMOLOGACION.pedidos.length;
      await trabajos
        .procesador()
        .despacharPorClaves(empresaId(e.empresa), clavesDeLaValidacionInicial(id), ahora());
      expect(arca.HOMOLOGACION.pedidos.length).toBe(antes2);
      expect(await estadoDe(id)).toBe("DESCARTADO");
      expect(await reintentarComprobante(d, comoPersonaDe(e), { comprobanteId: id })).toMatchObject(
        { ok: false, error: { codigo: "FISCAL_ESTADO_NO_REINTENTABLE" } },
      );
    });

    it("la base caída no deja pasar la cadena de conexión: error inesperado con referencia, el detalle solo en el registro", async () => {
      const e = await empresaConFacturacion();
      const roto = armarConexiones({
        fuente: () => ({
          PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
          PEDERNAL_DB_APP: "postgres://usuario:secreta@127.0.0.1:1/base",
        }),
        registrar: (x) => registrados.push(x),
      });
      try {
        const webRoto = armarWeb(roto, { reglas: REGLAS_CON_FACTURACION, emision });
        const antes = registrados.length;
        const r = await emitirFactura(
          {
            casosDeUso: webRoto.casosDeUsoDeFacturacion,
            consultas: webRoto.consultasDeFacturacion,
            respuesta: { registrar: (x) => registrados.push(x) },
          },
          comoPersonaDe(e),
          facturaCruda(e),
        );
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(["ERROR_INTERNO", "NO_DISPONIBLE"]).toContain(r.error.codigo);
        expect(r.error.referencia).toMatch(/^PD-/);
        const salida = JSON.stringify(r);
        for (const interno of ["secreta", "127.0.0.1", "postgres://", "ECONNREFUSED"]) {
          expect(salida).not.toContain(interno);
        }
        expect(registrados.slice(antes).join("\n")).toContain(r.error.referencia ?? "?");
      } finally {
        await roto.transaccionesDeApp().cerrar();
      }
    });
  });

  // ===============================================================================================
  describe("la reconciliación: quién la encola", () => {
    const reconciliacionesDe = (empresa: string) =>
      filas<{ clave_idempotencia: string; estado: string }>(
        "select clave_idempotencia, estado from trabajo where empresa_id = $1 and tipo = 'fiscal.reconciliar' order by 1",
        [empresa],
      );
    const unaHoraDespues = (desde: Date, horas = 1) =>
      new Date(desde.getTime() + horas * 3_600_000);

    it("el cron encola UNA por empresa que facturó y por hora (repetir no duplica); una empresa sin facturación no", async () => {
      const con = await empresaConFacturacion();
      await emitirYValidar(con);
      const sin = await empresaConFacturacion();
      const momento = new Date("2031-03-05T10:20:00Z");
      // Las validaciones de arriba son «de hoy»: se mira desde un momento cercano a hoy.
      const hoy = ahora();

      const primera = await trabajos.encolarReconciliaciones(hoy);
      expect(primera.encoladas).toBeGreaterThanOrEqual(1);
      expect(await reconciliacionesDe(con.empresa)).toEqual([
        {
          clave_idempotencia: claveDeReconciliacion(empresaId(con.empresa), hoy),
          estado: "PENDIENTE",
        },
      ]);
      expect(await reconciliacionesDe(sin.empresa)).toEqual([]);

      // La misma hora: ya estaba; no hay una segunda fila.
      const repetida = await trabajos.encolarReconciliaciones(new Date(hoy.getTime() + 1_000));
      expect(repetida.encoladas).toBe(0);
      expect(repetida.yaEncoladas).toBeGreaterThanOrEqual(1);
      expect(await reconciliacionesDe(con.empresa)).toHaveLength(1);

      // Otra hora: otra reconciliación.
      await trabajos.encolarReconciliaciones(unaHoraDespues(hoy));
      expect(await reconciliacionesDe(con.empresa)).toHaveLength(2);
      expect(claveDeReconciliacion(empresaId(con.empresa), momento)).toBe(
        `fiscal.reconciliar:${con.empresa}:2031-03-05T10`,
      );
    });

    it("una empresa cuya última validación es de hace más de 30 días ya no entra", async () => {
      const vieja = await empresaConFacturacion();
      await dueno.query(
        `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia, creado_en)
         values ($1, 'fiscal.validar_comprobante', $2::jsonb, $3, now() - interval '40 days')`,
        [
          vieja.empresa,
          JSON.stringify({ comprobanteId: randomUUID() }),
          `fiscal.validar:${randomUUID()}:1`,
        ],
      );
      await trabajos.encolarReconciliaciones(ahora());
      expect(await reconciliacionesDe(vieja.empresa)).toEqual([]);
      // Con una validación de hoy, sí entra.
      await dueno.query(
        `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
         values ($1, 'fiscal.validar_comprobante', $2::jsonb, $3)`,
        [
          vieja.empresa,
          JSON.stringify({ comprobanteId: randomUUID() }),
          `fiscal.validar:${randomUUID()}:1`,
        ],
      );
      await trabajos.encolarReconciliaciones(ahora());
      expect(await reconciliacionesDe(vieja.empresa)).toHaveLength(1);
    });

    it("un comprobante INCIERTO se resuelve solo: el cron encola la reconciliación y el despacho de la misma pasada la ejecuta, consultando (nunca reenviando)", async () => {
      const e = await empresaConFacturacion();
      // «Autorizó y se cayó»: ARCA lo tiene y nosotros no lo sabemos.
      arca.HOMOLOGACION.programar("AUTORIZA_Y_SE_CAE");
      const emitido = await emitirYValidar(e);
      expect(await estadoDe(emitido.comprobanteId)).toBe("INCIERTO");
      // Se cuenta solo lo de ESTE comprobante: el cron también despacha lo pendiente de las demás pruebas.
      const deEste = <T extends { puntoDeVenta: { cuit: string } }>(lista: readonly T[]) =>
        lista.filter((x) => x.puntoDeVenta.cuit === e.cuit).length;
      const autorizaciones = deEste(arca.HOMOLOGACION.pedidos);
      const consultas = deEste(arca.HOMOLOGACION.consultas);
      expect(autorizaciones).toBe(1);

      // Pasó la reserva (5 minutos): una pasada del cron, tal cual la arma la web, con un reloj que ya avanzó una hora
      // (también el de los casos de uso: la reserva se compara con él).
      const despues = unaHoraDespues(ahora());
      const trabajosDeDespues = armarTrabajos(conexiones, {
        emision,
        reloj: { ahora: () => despues },
      });
      const respuesta = await atenderCron(
        new Request("https://pedernal-erp.vercel.app/api/trabajos/cron", {
          headers: { authorization: "Bearer el-secreto-largo-del-cron-de-prueba" },
        }),
        {
          secreto: () => "el-secreto-largo-del-cron-de-prueba",
          procesador: trabajosDeDespues.procesador,
          barrido: () => ({
            barrerVencidos: () =>
              Promise.resolve({ sesiones: 0, verificaciones: 0, limitesDePedidos: 0 }),
          }),
          reconciliaciones: (momento) => trabajosDeDespues.encolarReconciliaciones(momento),
          ahora: () => despues,
          registrar: (x) => registrados.push(x),
        },
      );
      expect(respuesta.status).toBe(200);
      expect(await estadoDe(emitido.comprobanteId)).toBe("AUTORIZADO");
      expect(deEste(arca.HOMOLOGACION.pedidos)).toBe(autorizaciones);
      expect(deEste(arca.HOMOLOGACION.consultas)).toBeGreaterThan(consultas);
      const [fila] = await filas<{ resuelto_por: string }>(
        "select resuelto_por from comprobante where id = $1",
        [emitido.comprobanteId],
      );
      expect(fila?.resuelto_por).toBe("RECONCILIACION");
      expect((await reconciliacionesDe(e.empresa))[0]?.estado).toBe("HECHO");
    });
  });

  // ===============================================================================================
  describe("la cola", () => {
    it("`fiscal.reconciliar` tiene su manejador: una empresa sin nada en vuelo termina HECHO", async () => {
      const e = await empresaConFacturacion();
      const [{ id }] = (await filas<{ id: string }>(
        `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
         values ($1, 'fiscal.reconciliar', '{}'::jsonb, $2) returning id`,
        [e.empresa, `fiscal.reconciliar:${e.empresa}:prueba`],
      )) as [{ id: string }];
      expect(await trabajos.procesador().procesarUno(id, ahora())).toBe("HECHO");
      const [fila] = await filas<{ estado: string }>("select estado from trabajo where id = $1", [
        id,
      ]);
      expect(fila?.estado).toBe("HECHO");
    });

    it("un tipo de trabajo SIN manejador no se pierde ni se da por hecho: se reprograma con su error", async () => {
      const e = await empresaConFacturacion();
      const [{ id }] = (await filas<{ id: string }>(
        `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
         values ($1, 'clientes.parte_anonimizada', '{}'::jsonb, $2) returning id`,
        [e.empresa, `sin-manejador:${e.empresa}`],
      )) as [{ id: string }];
      expect(await trabajos.procesador().procesarUno(id, ahora())).toBe("REPROGRAMADO");
      const [fila] = await filas<{ estado: string; ultimo_error: string }>(
        "select estado, ultimo_error from trabajo where id = $1",
        [id],
      );
      expect(fila).toMatchObject({ estado: "PENDIENTE" });
      expect(fila?.ultimo_error).toContain("no hay manejador");
    });
  });
});
