import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  comprobanteId,
  crearLecturasDeComprobantes,
  type ComprobanteGuardado,
  type FiscalDb,
  type PedidoDeListado,
} from "../../src/modulos/fiscal/publico";
import { criteriosDeListado } from "../../src/modulos/fiscal/consultas/criterios-de-listado";
import { modeloDeImpresion } from "../../src/modulos/fiscal/dominio/modelo-de-impresion";
import { formatearDomicilio } from "../../src/primitivas/domicilio/domicilio";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { receptorInscripto } from "../utilidades/facturacion";
import { crearComprobante, crearEscenario, type Escenario } from "./facturacion-apoyo";
import {
  MARCA_DOS,
  MARCA_UNO,
  crearComprobanteCreadoEn,
  crearEntornoDeConsultas,
  crearPuntoDeVentaEnProduccion,
  type EntornoDeConsultas,
} from "./facturacion-consultas-apoyo";
import {
  CAE_DE_PRUEBA,
  altaDe,
  altaDeNota,
  autorizar,
  cerrarLaSerie,
  comoPersonaDe,
  crearEntornoFacturacion,
  diaDe,
  entrarEnValidacion,
  fechaCivil,
  intentoDe,
  type TxFacturacionDePrueba,
} from "./facturacion-persistencia-apoyo";
import { comoEmpresa } from "./entorno";
import { crearMundo } from "./fiscal-apoyo";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";

/**
 * Facturación F6: las consultas del facturador contra una base real, con los roles reales y su contexto firmado
 * (el mismo camino que usarán las pantallas). Qué prueba:
 *  1. Aislamiento: una empresa lista y ve solo lo suyo (también del mismo tenant), y lo de otra empresa es
 *     indistinguible de lo que no existe.
 *  2. Permisos: los tres roles miran; quien no tiene membresía en la empresa (también si es de otra), una
 *     membresía apagada y el sistema sin persona no; y con el catálogo real el módulo sigue en desarrollo.
 *  3. Solo lectura: la transacción de la consulta se abre `read committed` y de solo lectura.
 *  4. El listado: filtros, búsqueda de texto sin comodines, fechas en Argentina y paginación por clave
 *     `(creado_en, id)` sin repetir ni saltear filas (microsegundos, empates y altas entre página y página).
 *  5. El detalle (con las notas que lo citan, el último intento y su serie) y el modelo de impresión, sin
 *     ninguna columna de certificados ni de tickets.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = new Date("2026-10-12T12:00:00.000Z");

function exito<T, E>(r: Resultado<T, E>): T {
  if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)("facturación F6: las consultas del facturador", () => {
  let dueno: pg.Client;
  let escritura: ReturnType<typeof crearEntornoFacturacion>;
  let entorno: EntornoDeConsultas;
  let consultas: ReturnType<EntornoDeConsultas["consultas"]>;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    escritura = crearEntornoFacturacion(base);
    entorno = crearEntornoDeConsultas(base);
    consultas = entorno.consultas();
  });
  afterAll(async () => {
    await escritura.cerrar();
    await entorno.transacciones.cerrar();
    await dueno.end();
  });

  /** Una empresa con una persona de cada rol, una sin membresía y una con la membresía apagada. */
  type Empresa = Readonly<{
    x: Escenario;
    persona: Record<RolDePrueba | "SIN_MEMBRESIA" | "APAGADA", string>;
  }>;
  async function crearEmpresa(tenant?: string): Promise<Empresa> {
    const x = await crearEscenario(
      dueno,
      tenant === undefined ? {} : { mundo: await crearMundo(dueno, { tenant }) },
    );
    const persona = {} as Record<RolDePrueba | "SIN_MEMBRESIA" | "APAGADA", string>;
    for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
      persona[rol] = (await crearPersonaDeBase(dueno)).id;
      await crearMembresiaDeBase(dueno, x.empresa, persona[rol], rol);
    }
    persona.SIN_MEMBRESIA = (await crearPersonaDeBase(dueno)).id;
    persona.APAGADA = (await crearPersonaDeBase(dueno)).id;
    await crearMembresiaDeBase(dueno, x.empresa, persona.APAGADA, "GERENTE", false);
    return { x, persona };
  }
  /** Quien mira: un gerente de la empresa (los permisos se prueban aparte). */
  const mira = (e: Empresa): ContextoOperativo =>
    comoEmpresa(empresaId(e.x.empresa), personaId(e.persona.GERENTE));

  /** Corre una escritura de prueba con el contexto de la persona que creó la empresa. */
  async function escribir<T>(
    e: Escenario,
    trabajo: (tx: TxFacturacionDePrueba) => Promise<T>,
  ): Promise<T> {
    const r = await escritura.ejecutar({ contexto: comoPersonaDe(e) }, async (tx) =>
      ok(await trabajo(tx)),
    );
    if (!r.ok) throw new Error(`falló la escritura: ${JSON.stringify(r.error)}`);
    return r.valor;
  }
  const crearPendiente = (e: Escenario, opciones: Parameters<typeof altaDe>[1] = {}) =>
    escribir(e, async (tx) => exito(await tx.comprobantes.crear(altaDe(e, opciones))).valor);
  const crearAutorizado = (e: Escenario, opciones: Parameters<typeof altaDe>[1] = {}) =>
    escribir(e, async (tx) => {
      const c = exito(await tx.comprobantes.crear(altaDe(e, opciones))).valor;
      return autorizar(tx, c.id, e.empresa, AHORA);
    });
  const crearNotaAutorizada = (e: Escenario, original: ComprobanteGuardado) =>
    escribir(e, async (tx) => {
      const c = exito(await tx.comprobantes.crear(altaDeNota(e, original))).valor;
      return autorizar(tx, c.id, e.empresa, AHORA);
    });
  const descartar = (e: Escenario, c: ComprobanteGuardado) =>
    escribir(e, async (tx) => {
      const d = await tx.comprobantes.transicionar(c.empresaId, c.id, c.version, {
        a: "DESCARTADO",
        motivo: "se cargó dos veces",
      });
      if (d === null) throw new Error("el comprobante cambió");
      return d;
    });
  const rechazar = (e: Escenario, c: ComprobanteGuardado) =>
    escribir(e, async (tx) => {
      const enValidacion = await entrarEnValidacion(tx, c.id, e.empresa, AHORA);
      await cerrarLaSerie(tx, enValidacion, "RECHAZADO");
      const r = await tx.comprobantes.transicionar(c.empresaId, c.id, enValidacion.version, {
        a: "RECHAZADO",
      });
      if (r === null) throw new Error("el comprobante cambió");
      return r;
    });

  const listar = async (e: Empresa, pedido: PedidoDeListado = {}) =>
    exito(await consultas.listarComprobantes(mira(e), pedido));
  const idsDe = async (e: Empresa, pedido: PedidoDeListado = {}) =>
    (await listar(e, pedido)).items.map((i) => i.id);
  const ordenados = (ids: readonly string[]) => [...ids].sort();

  // ===============================================================================================
  // 1. Aislamiento entre empresas
  // ===============================================================================================
  describe("aislamiento", () => {
    it("cada empresa lista y ve solo lo suyo, también la del mismo tenant", async () => {
      const a = await crearEmpresa();
      const b = await crearEmpresa(a.x.tenant); // mismo tenant
      const c = await crearEmpresa(); // otro tenant
      const deA = [await crearPendiente(a.x), await crearAutorizado(a.x)];
      const deB = [await crearPendiente(b.x), await crearAutorizado(b.x)];
      const deC = [await crearPendiente(c.x)];
      expect(ordenados(await idsDe(a))).toEqual(ordenados(deA.map((x) => x.id)));
      expect(ordenados(await idsDe(b))).toEqual(ordenados(deB.map((x) => x.id)));
      expect(ordenados(await idsDe(c))).toEqual(ordenados(deC.map((x) => x.id)));
    });

    it("el comprobante de otra empresa es indistinguible de uno que no existe (ver y modelo)", async () => {
      const a = await crearEmpresa();
      const b = await crearEmpresa(a.x.tenant);
      const c = await crearEmpresa();
      const deA = await crearAutorizado(a.x);
      for (const quien of [b, c]) {
        expect(await consultas.verComprobante(mira(quien), { comprobanteId: deA.id })).toEqual({
          ok: false,
          error: "COMPROBANTE_NO_ENCONTRADO",
        });
        expect(await consultas.modeloDeImpresion(mira(quien), { comprobanteId: deA.id })).toEqual({
          ok: false,
          error: "COMPROBANTE_NO_ENCONTRADO",
        });
      }
      expect(await consultas.verComprobante(mira(a), { comprobanteId: deA.id })).toMatchObject({
        ok: true,
      });
      const inexistente = comprobanteId(randomUUID());
      expect(await consultas.verComprobante(mira(a), { comprobanteId: inexistente })).toEqual({
        ok: false,
        error: "COMPROBANTE_NO_ENCONTRADO",
      });
    });

    it("sin RLS (el dueño de la base la evade) las lecturas siguen filtrando por empresa", async () => {
      const a = await crearEmpresa();
      const b = await crearEmpresa(a.x.tenant);
      const original = await crearAutorizado(a.x);
      const nota = await crearNotaAutorizada(a.x, original);
      const deB = await crearPendiente(b.x);
      const pool = new pg.Pool({ connectionString: base?.dueno ?? "", max: 2 });
      const sinRls = new Kysely<FiscalDb>({ dialect: new PostgresDialect({ pool }) });
      try {
        const lecturas = crearLecturasDeComprobantes(sinRls);
        const filtro = exito(criteriosDeListado({ limite: 50 }));
        const ids = async (e: Empresa) =>
          (await lecturas.listar(empresaId(e.x.empresa), filtro)).filas.map((f) => f.id);
        expect(ordenados(await ids(a))).toEqual(ordenados([original.id, nota.id]));
        expect(await ids(b)).toEqual([deB.id]);
        // control: la base sin RLS ve las dos empresas; solo el filtro de las lecturas las separa
        const todo = await sinRls.selectFrom("comprobante").select("id").execute();
        expect(todo.map((f) => f.id)).toEqual(expect.arrayContaining([original.id, deB.id]));
        expect(await lecturas.notasQueCitan(empresaId(a.x.empresa), original.id)).toHaveLength(1);
        expect(await lecturas.notasQueCitan(empresaId(b.x.empresa), original.id)).toEqual([]);
      } finally {
        await sinRls.destroy();
      }
    });

    it("las notas que citan a un comprobante son las de su empresa", async () => {
      const a = await crearEmpresa();
      const original = await crearAutorizado(a.x);
      const nota = await crearNotaAutorizada(a.x, original);
      const d = exito(await consultas.verComprobante(mira(a), { comprobanteId: original.id }));
      expect(d.notasQueLoCitan.map((n) => n.id)).toEqual([nota.id]);
    });
  });

  // ===============================================================================================
  // 2. Permisos
  // ===============================================================================================
  describe("permisos", () => {
    it("los tres roles miran: listar, ver y el modelo de impresión", async () => {
      const a = await crearEmpresa();
      const c = await crearAutorizado(a.x);
      for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
        const contexto = comoEmpresa(empresaId(a.x.empresa), personaId(a.persona[rol]));
        expect((await consultas.listarComprobantes(contexto, {})).ok, rol).toBe(true);
        expect((await consultas.verComprobante(contexto, { comprobanteId: c.id })).ok, rol).toBe(
          true,
        );
        expect((await consultas.modeloDeImpresion(contexto, { comprobanteId: c.id })).ok, rol).toBe(
          true,
        );
      }
    });

    it("sin membresía en la empresa (aun siendo de otra), con la membresía apagada o sin persona: SIN_PERMISO", async () => {
      const a = await crearEmpresa();
      const b = await crearEmpresa();
      const c = await crearAutorizado(a.x);
      const intrusos: [string, ContextoOperativo][] = [
        ["sin membresía", comoEmpresa(empresaId(a.x.empresa), personaId(a.persona.SIN_MEMBRESIA))],
        [
          "gerente de otra empresa",
          comoEmpresa(empresaId(a.x.empresa), personaId(b.persona.GERENTE)),
        ],
        ["membresía apagada", comoEmpresa(empresaId(a.x.empresa), personaId(a.persona.APAGADA))],
        ["el sistema, sin persona", comoEmpresa(empresaId(a.x.empresa), null)],
      ];
      for (const [quien, contexto] of intrusos) {
        const esperado = { ok: false, error: "SIN_PERMISO" };
        expect(await consultas.listarComprobantes(contexto, {}), quien).toEqual(esperado);
        expect(await consultas.verComprobante(contexto, { comprobanteId: c.id }), quien).toEqual(
          esperado,
        );
        expect(await consultas.modeloDeImpresion(contexto, { comprobanteId: c.id }), quien).toEqual(
          esperado,
        );
      }
    });

    it("con el catálogo REAL la facturación sigue en desarrollo: nadie mira todavía", async () => {
      const a = await crearEmpresa();
      const c = await crearAutorizado(a.x);
      const reales = entorno.consultas(REGLAS_DE_EMPRESA);
      const esperado = { ok: false, error: "MODULO_EN_DESARROLLO" };
      expect(await reales.listarComprobantes(mira(a), {})).toEqual(esperado);
      expect(await reales.verComprobante(mira(a), { comprobanteId: c.id })).toEqual(esperado);
      expect(await reales.modeloDeImpresion(mira(a), { comprobanteId: c.id })).toEqual(esperado);
    });
  });

  // ===============================================================================================
  // 3. Solo lectura
  // ===============================================================================================
  describe("solo lectura", () => {
    it("la consulta abre una transacción read committed y de solo lectura", async () => {
      const a = await crearEmpresa();
      const c = await crearAutorizado(a.x);
      exito(await consultas.modeloDeImpresion(mira(a), { comprobanteId: c.id }));
      expect(entorno.ultimoEstadoVisto()).toEqual({
        soloLectura: "on",
        aislamiento: "read committed",
      });
    });
  });

  // ===============================================================================================
  // 4. El listado
  // ===============================================================================================
  describe("listado", () => {
    it("por defecto oculta los descartados; con estado DESCARTADO trae solo esos", async () => {
      const a = await crearEmpresa();
      const pendiente = await crearPendiente(a.x);
      const descartado = await descartar(a.x, await crearPendiente(a.x));
      const rechazado = await rechazar(a.x, await crearPendiente(a.x));
      const autorizado = await crearAutorizado(a.x);
      expect(ordenados(await idsDe(a))).toEqual(
        ordenados([pendiente.id, rechazado.id, autorizado.id]),
      );
      expect(await idsDe(a, { estado: "DESCARTADO" })).toEqual([descartado.id]);
      expect(await idsDe(a, { estado: "RECHAZADO" })).toEqual([rechazado.id]);
      expect(await idsDe(a, { estado: "AUTORIZADO" })).toEqual([autorizado.id]);
      expect(await idsDe(a, { estado: "PENDIENTE" })).toEqual([pendiente.id]);
      expect(await idsDe(a, { estado: "INCIERTO" })).toEqual([]);
    });

    it("cada fila trae lo del spec: número impreso solo si está autorizado, total como texto", async () => {
      const a = await crearEmpresa();
      const pendiente = await crearPendiente(a.x);
      const autorizado = await crearAutorizado(a.x, { receptor: receptorInscripto });
      const items = (await listar(a)).items;
      const deLaLista = (id: string) => items.find((i) => i.id === id);
      expect(deLaLista(pendiente.id)).toEqual({
        id: pendiente.id,
        tipo: "FACTURA_B",
        numero: null,
        // todavía sin numerar: el día de creación en Argentina
        fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
        receptorNombre: null,
        total: "121.00",
        estado: "PENDIENTE",
        ambiente: "HOMOLOGACION",
      });
      expect(deLaLista(autorizado.id)).toEqual({
        id: autorizado.id,
        tipo: "FACTURA_A",
        numero: `${String(a.x.pvNumero).padStart(5, "0")}-00000001`,
        // la fecha de emisión gana sobre la de creación
        fecha: diaDe(AHORA),
        receptorNombre: "Distribuidora Sur SA",
        total: "121.00",
        estado: "AUTORIZADO",
        ambiente: "HOMOLOGACION",
      });
      expect(Object.keys(deLaLista(autorizado.id) ?? {}).sort()).toEqual(
        ["ambiente", "estado", "fecha", "id", "numero", "receptorNombre", "tipo", "total"].sort(),
      );
    });

    it("filtra por tipo y por ambiente", async () => {
      const a = await crearEmpresa();
      const factura = await crearAutorizado(a.x);
      const nota = await crearNotaAutorizada(a.x, factura);
      const enProduccion = await crearComprobante(
        dueno,
        await crearPuntoDeVentaEnProduccion(dueno, a.x),
        { ambiente: "PRODUCCION" },
      );
      expect(await idsDe(a, { tipo: "NOTA_CREDITO_B" })).toEqual([nota.id]);
      expect(await idsDe(a, { tipo: "FACTURA_B" })).toContain(factura.id);
      expect(await idsDe(a, { tipo: "FACTURA_B" })).not.toContain(nota.id);
      expect(await idsDe(a, { ambiente: "PRODUCCION" })).toEqual([enProduccion]);
      expect(ordenados(await idsDe(a, { ambiente: "HOMOLOGACION" }))).toEqual(
        ordenados([factura.id, nota.id]),
      );
      expect(await idsDe(a, { tipo: "NOTA_CREDITO_B", ambiente: "PRODUCCION" })).toEqual([]);
    });

    it("las fechas son las de Argentina: 02:30Z es el día anterior; 03:00Z, el mismo día", async () => {
      const a = await crearEmpresa();
      const tardeDelNueve = await crearComprobanteCreadoEn(
        dueno,
        a.x,
        "2026-10-10T02:30:00.000000Z",
      );
      const comienzoDelDiez = await crearComprobanteCreadoEn(
        dueno,
        a.x,
        "2026-10-10T03:00:00.000000Z",
      );
      const finDelDiez = await crearComprobanteCreadoEn(dueno, a.x, "2026-10-11T02:59:59.999999Z");
      const comienzoDelOnce = await crearComprobanteCreadoEn(
        dueno,
        a.x,
        "2026-10-11T03:00:00.000000Z",
      );
      const dia = (d: string) => ({ desde: fechaCivil(d), hasta: fechaCivil(d) });
      expect(await idsDe(a, dia("2026-10-09"))).toEqual([tardeDelNueve]);
      expect(ordenados(await idsDe(a, dia("2026-10-10")))).toEqual(
        ordenados([comienzoDelDiez, finDelDiez]),
      );
      expect(await idsDe(a, dia("2026-10-11"))).toEqual([comienzoDelOnce]);
      expect(await idsDe(a, { desde: fechaCivil("2026-10-11") })).toEqual([comienzoDelOnce]);
      expect(await idsDe(a, { hasta: fechaCivil("2026-10-09") })).toEqual([tardeDelNueve]);
      expect(
        await idsDe(a, { desde: fechaCivil("2026-10-12"), hasta: fechaCivil("2026-10-30") }),
      ).toEqual([]);
    });

    it("la fecha de emisión gana a la de creación en el filtro de fechas", async () => {
      const a = await crearEmpresa();
      const autorizado = await crearAutorizado(a.x); // emitido el día de AHORA, creado hoy de verdad
      const dia = diaDe(AHORA);
      expect(await idsDe(a, { desde: dia, hasta: dia })).toEqual([autorizado.id]);
    });

    it("el texto busca en el nombre (sin distinguir mayúsculas) o en el documento (por prefijo)", async () => {
      const a = await crearEmpresa();
      const distribuidora = await crearAutorizado(a.x, { receptor: receptorInscripto });
      const anonimo = await crearPendiente(a.x);
      expect(await idsDe(a, { texto: "distribuidora" })).toEqual([distribuidora.id]);
      expect(await idsDe(a, { texto: "SUR sa" })).toEqual([distribuidora.id]);
      expect(await idsDe(a, { texto: "  Sur  " })).toEqual([distribuidora.id]);
      // CUIT_C = 30-71234567-1
      expect(await idsDe(a, { texto: "30-71234567-1" })).toEqual([distribuidora.id]);
      expect(await idsDe(a, { texto: "3071" })).toEqual([distribuidora.id]);
      expect(await idsDe(a, { texto: "71234" })).toEqual([]); // prefijo, no cualquier parte
      expect(await idsDe(a, { texto: "pepito" })).toEqual([]);
      expect(await idsDe(a, { texto: "" })).toHaveLength(2);
      expect(await idsDe(a, { texto: "Sur", estado: "PENDIENTE" })).toEqual([]);
      expect(anonimo.receptor.nombre).toBeNull();
    });

    it("`%`, `_` y `\\` del texto son letras comunes, no comodines", async () => {
      const a = await crearEmpresa();
      const conSimbolos = await crearComprobante(dueno, a.x, {
        receptor_nombre: "50% Descuento_Pan\\Sur",
      });
      const otro = await crearComprobante(dueno, a.x, { receptor_nombre: "500 Descuentos Pan" });
      expect(await idsDe(a, { texto: "50%" })).toEqual([conSimbolos]);
      expect(await idsDe(a, { texto: "5%" })).toEqual([]);
      expect(await idsDe(a, { texto: "Descuento_Pan" })).toEqual([conSimbolos]);
      expect(await idsDe(a, { texto: "Descuento Pan" })).toEqual([]);
      expect(await idsDe(a, { texto: "Pan\\Sur" })).toEqual([conSimbolos]);
      expect(await idsDe(a, { texto: "%" })).toEqual([conSimbolos]);
      expect(await idsDe(a, { texto: "_" })).toEqual([conSimbolos]);
      expect(await idsDe(a, { texto: "Descuento" })).toHaveLength(2);
      expect(otro).toBeTruthy();
    });

    it("un pedido inválido es un error de negocio, no un fallo de la base", async () => {
      const a = await crearEmpresa();
      const errores = async (pedido: PedidoDeListado) =>
        (await consultas.listarComprobantes(mira(a), pedido)) as { error?: string };
      expect((await errores({ limite: 51 })).error).toBe("LIMITE_INVALIDO");
      expect((await errores({ limite: 0 })).error).toBe("LIMITE_INVALIDO");
      expect((await errores({ despuesDe: "' or 1=1 --|x" })).error).toBe(
        "CLAVE_DE_PAGINA_INVALIDA",
      );
      expect(
        (await errores({ despuesDe: "2026-02-30T00:00:00.000000Z|" + randomUUID() })).error,
      ).toBe("CLAVE_DE_PAGINA_INVALIDA");
      expect((await errores({ texto: "a".repeat(81) })).error).toBe("TEXTO_DEMASIADO_LARGO");
      expect(
        (await errores({ desde: fechaCivil("2026-10-02"), hasta: fechaCivil("2026-10-01") })).error,
      ).toBe("FECHAS_INVERTIDAS");
    });

    it("pagina por clave (creado_en, id): sin repetir ni saltear, con microsegundos y empates", async () => {
      const e = await crearEmpresa();
      // tres instantes que difieren en un microsegundo (un `Date` de JS los vería iguales) y, en el último,
      // cuatro comprobantes con el mismo `creado_en`: el desempate es el id.
      const instantes = [
        "2026-10-10T12:00:00.000001Z",
        "2026-10-10T12:00:00.000002Z",
        "2026-10-10T12:00:00.000003Z",
        "2026-10-10T12:00:00.000003Z",
        "2026-10-10T12:00:00.000003Z",
        "2026-10-10T12:00:00.000003Z",
        "2026-10-10T11:59:59.999999Z",
      ];
      const creados: { id: string; creadoEn: string }[] = [];
      for (const creadoEn of instantes) {
        creados.push({
          id: await crearComprobanteCreadoEn(dueno, e.x, creadoEn),
          creadoEn,
        });
      }
      // el orden del listado: creado_en descendente, id ascendente
      const esperado = [...creados]
        .sort((x, y) =>
          x.creadoEn === y.creadoEn ? (x.id < y.id ? -1 : 1) : x.creadoEn < y.creadoEn ? 1 : -1,
        )
        .map((c) => c.id);
      for (const limite of [1, 2, 3, 7, 50]) {
        const vistos: string[] = [];
        let despuesDe: string | undefined;
        let paginas = 0;
        do {
          const pagina = await listar(e, {
            limite,
            ...(despuesDe === undefined ? {} : { despuesDe }),
          });
          paginas += 1;
          expect(pagina.items.length, `página ${paginas} de ${limite}`).toBeLessThanOrEqual(limite);
          vistos.push(...pagina.items.map((i) => i.id));
          despuesDe = pagina.siguiente ?? undefined;
          if (despuesDe !== undefined) expect(pagina.items).toHaveLength(limite);
        } while (despuesDe !== undefined);
        expect(vistos, `limite ${limite}`).toEqual(esperado);
        expect(paginas).toBe(Math.ceil(esperado.length / limite));
      }
    });

    it("un comprobante nuevo entre dos páginas no corre las filas ya vistas ni repite ninguna", async () => {
      const e = await crearEmpresa();
      const viejos: string[] = [];
      for (const minuto of ["00", "01", "02", "03", "04"]) {
        viejos.push(await crearComprobanteCreadoEn(dueno, e.x, `2026-10-10T10:${minuto}:00Z`));
      }
      const primera = await listar(e, { limite: 2 });
      expect(primera.items.map((i) => i.id)).toEqual([viejos[4], viejos[3]]);
      // llega uno más nuevo (y uno más viejo) mientras la pantalla mira la primera página
      const nuevo = await crearComprobanteCreadoEn(dueno, e.x, "2026-10-10T11:00:00Z");
      const masViejo = await crearComprobanteCreadoEn(dueno, e.x, "2026-10-10T09:00:00Z");
      const segunda = await listar(e, { limite: 2, despuesDe: primera.siguiente ?? "" });
      expect(segunda.items.map((i) => i.id)).toEqual([viejos[2], viejos[1]]);
      const tercera = await listar(e, { limite: 2, despuesDe: segunda.siguiente ?? "" });
      expect(tercera.items.map((i) => i.id)).toEqual([viejos[0], masViejo]);
      expect(tercera.siguiente).toBeNull();
      expect((await idsDe(e))[0]).toBe(nuevo);
    });

    it("sin límite pide 20 y la última página no tiene siguiente", async () => {
      const e = await crearEmpresa();
      for (let i = 0; i < 21; i++) await crearComprobante(dueno, e.x);
      const primera = await listar(e);
      expect(primera.items).toHaveLength(20);
      expect(primera.siguiente).not.toBeNull();
      const segunda = await listar(e, { despuesDe: primera.siguiente ?? "" });
      expect(segunda.items).toHaveLength(1);
      expect(segunda.siguiente).toBeNull();
      const justo = await listar(e, { limite: 21 });
      expect(justo.items).toHaveLength(21);
      expect(justo.siguiente).toBeNull();
    });

    it("la clave es solo una posición en el orden: la misma clave en otra empresa no trae nada ajeno", async () => {
      const a = await crearEmpresa();
      const b = await crearEmpresa();
      const a10 = await crearComprobanteCreadoEn(dueno, a.x, "2026-10-10T10:00:00Z");
      const a09 = await crearComprobanteCreadoEn(dueno, a.x, "2026-10-10T09:00:00Z");
      const b10 = await crearComprobanteCreadoEn(dueno, b.x, "2026-10-10T10:00:00Z");
      const clave = "2026-10-10T10:00:00.000000Z|00000000-0000-0000-0000-000000000000";
      expect(await idsDe(a, { despuesDe: clave })).toEqual([a10, a09]);
      expect(await idsDe(b, { despuesDe: clave })).toEqual([b10]);
    });
  });

  // ===============================================================================================
  // 5. El detalle y el modelo de impresión
  // ===============================================================================================
  describe("detalle y modelo de impresión", () => {
    it("el detalle trae las notas que lo citan (sin las descartadas), el último intento con sus códigos y la serie", async () => {
      const a = await crearEmpresa();
      const original = await crearAutorizado(a.x);
      const descartada = await descartar(
        a.x,
        await escribir(
          a.x,
          async (tx) => exito(await tx.comprobantes.crear(altaDeNota(a.x, original))).valor,
        ),
      );
      const nota = await crearNotaAutorizada(a.x, original);
      await escribir(a.x, async (tx) => {
        exito(
          await tx.intentos.registrar(
            intentoDe(a.x, original.id, {
              desenlace: "INCIERTO",
              mensajes: [],
              iniciadoEn: new Date("2026-10-12T11:00:00.000Z"),
            }),
          ),
        );
        exito(
          await tx.intentos.registrar(
            intentoDe(a.x, original.id, { iniciadoEn: new Date("2026-10-12T11:30:00.000Z") }),
          ),
        );
      });
      const d = exito(await consultas.verComprobante(mira(a), { comprobanteId: original.id }));
      expect(d.notasQueLoCitan.map((n) => n.id)).toEqual([nota.id]);
      expect(d.notasQueLoCitan.map((n) => n.id)).not.toContain(descartada.id);
      expect(d.notasQueLoCitan[0]).toMatchObject({
        tipo: "NOTA_CREDITO_B",
        estado: "AUTORIZADO",
        total: "121.00",
      });
      expect(d.ultimoIntento).toEqual({
        operacion: "AUTORIZAR",
        desenlace: "AUTORIZADO",
        mensajes: [
          {
            clase: "OBSERVACION",
            codigo: 10237,
            texto: "Importe de la nota mayor al de la factura",
          },
        ],
        iniciadoEn: "2026-10-12T11:30:00.000Z",
      });
      expect(d.serie).toEqual({ estado: "LIBRE", ultimoNumero: "1", motivoDeBloqueo: null });
      expect(d).toMatchObject({
        estado: "AUTORIZADO",
        cae: CAE_DE_PRUEBA,
        numero: `${String(a.x.pvNumero).padStart(5, "0")}-00000001`,
        fechaEmision: diaDe(AHORA),
        importes: {
          total: "121.00",
          neto: "100.00",
          iva: "21.00",
          exento: "0.00",
          noGravado: "0.00",
        },
        asociado: null,
      });
      expect(d.renglones).toHaveLength(1);
      expect(d.alicuotas).toEqual([
        { alicuota: "21", total: "121.00", neto: "100.00", iva: "21.00" },
      ]);
      // la nota apunta a su original
      const dNota = exito(await consultas.verComprobante(mira(a), { comprobanteId: nota.id }));
      expect(dNota.asociado).toMatchObject({
        id: original.id,
        tipo: "FACTURA_B",
        numero: d.numero,
        fecha: diaDe(AHORA),
      });
      expect(dNota.motivo).toBe("Devolución");
    });

    it("el detalle de uno en validación muestra su serie en curso y sin número todavía", async () => {
      const a = await crearEmpresa();
      const c = await crearPendiente(a.x);
      await escribir(a.x, (tx) => entrarEnValidacion(tx, c.id, a.x.empresa, AHORA));
      const d = exito(await consultas.verComprobante(mira(a), { comprobanteId: c.id }));
      expect(d).toMatchObject({ estado: "EN_VALIDACION", numero: null, cae: null, envios: 1 });
      expect(d.serie).toEqual({ estado: "EN_CURSO", ultimoNumero: "0", motivoDeBloqueo: null });
      expect(d.ultimoIntento).toBeNull();
    });

    it("un comprobante sin serie todavía muestra serie null", async () => {
      const a = await crearEmpresa();
      const c = await crearPendiente(a.x);
      expect(
        exito(await consultas.verComprobante(mira(a), { comprobanteId: c.id })).serie,
      ).toBeNull();
    });

    it("el detalle nunca trae lo de los certificados ni los tickets de acceso, aunque la empresa los tenga", async () => {
      const a = await crearEmpresa();
      const c = await crearAutorizado(a.x);
      const certificado = randomUUID();
      await dueno.query(
        `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada,
                                       clave_nonce, clave_etiqueta, clave_kid, creado_por)
         values ($1, $2, $3, 'HOMOLOGACION', 'secretoalias', $4, 'PEDIDO-SECRETO', $5, $6, $7, 'KID-SECRETO', $8)`,
        [
          certificado,
          a.x.empresa,
          a.x.emisor,
          a.x.cuit,
          Buffer.from("CLAVE-SECRETA"),
          Buffer.alloc(12),
          Buffer.alloc(16),
          a.x.persona,
        ],
      );
      await dueno.query(
        `insert into acceso_arca (empresa_id, certificado_id, servicio, credencial_cifrada, credencial_nonce,
                                  credencial_etiqueta, credencial_kid, generado_en, expira_en)
         values ($1, $2, 'wsfe', $3, $4, $5, 'KID-TICKET', now(), now() + interval '1 hour')`,
        [
          a.x.empresa,
          certificado,
          Buffer.from("TICKET-SECRETO"),
          Buffer.alloc(12),
          Buffer.alloc(16),
        ],
      );
      const lecturas = [
        exito(await consultas.verComprobante(mira(a), { comprobanteId: c.id })),
        exito(await consultas.modeloDeImpresion(mira(a), { comprobanteId: c.id })),
        await listar(a),
      ];
      for (const lectura of lecturas) {
        expect(JSON.stringify(lectura)).not.toMatch(
          /SECRET|certificad|credencial|ticket|alias|pem|clave_|huella/i,
        );
      }
    });

    it("el modelo de impresión sale de lo guardado: es el mismo que el del dominio puro sobre el contenido emitido", async () => {
      const a = await crearEmpresa();
      const alta = altaDe(a.x, { receptor: receptorInscripto });
      const autorizado = await escribir(a.x, async (tx) => {
        const c = exito(await tx.comprobantes.crear(alta)).valor;
        return autorizar(tx, c.id, a.x.empresa, AHORA);
      });
      entorno.usarMarca(MARCA_UNO);
      const m = exito(await consultas.modeloDeImpresion(mira(a), { comprobanteId: autorizado.id }));
      const c = alta.contenido;
      const pura = modeloDeImpresion(
        {
          ambiente: c.ambiente,
          tipo: c.tipo,
          emisor: {
            cuit: c.emisor.cuit,
            razonSocial: c.emisor.razonSocial,
            condicionIva: c.emisor.condicionIva,
            domicilioFiscal: formatearDomicilio(c.emisor.domicilioFiscal),
            inicioDeActividades: alta.datosFiscales.inicioDeActividades,
            iibbNumero: alta.datosFiscales.iibbNumero,
            iibbCondicion: alta.datosFiscales.iibbCondicion,
            puntoDeVentaNumero: c.emisor.puntoDeVentaNumero,
            domicilioDelPuntoDeVenta: formatearDomicilio(c.emisor.domicilioDelPuntoDeVenta),
          },
          receptor: c.receptor,
          renglones: c.renglones,
          total: c.total,
          desglose: c.desglose,
          asociado: null,
          numero: 1n,
          fechaEmision: diaDe(AHORA),
          cae: CAE_DE_PRUEBA,
          caeVence: diaDe(new Date(AHORA.getTime() + 10 * 86_400_000)),
          versionDeRepresentacion: 1,
        },
        MARCA_UNO,
      );
      expect(m).toEqual(exito(pura));
      expect(m.fiscal).toMatchObject({
        rotulo: "FACTURA",
        letra: "A",
        codigoDelTipo: "001",
        cae: CAE_DE_PRUEBA,
      });
      expect(m.leyendas).toEqual(["HOMOLOGACIÓN — SIN VALIDEZ FISCAL"]);
      expect(m.qr.url).toMatch(/^https:\/\/.+\/fe\/qr\/\?p=/);
    });

    it("la nota de crédito se imprime con el número impreso de la factura que corrige", async () => {
      const a = await crearEmpresa();
      const original = await crearAutorizado(a.x);
      const nota = await crearNotaAutorizada(a.x, original);
      const m = exito(await consultas.modeloDeImpresion(mira(a), { comprobanteId: nota.id }));
      expect(m.fiscal).toMatchObject({
        rotulo: "NOTA DE CRÉDITO",
        letra: "B",
        codigoDelTipo: "008",
      });
      expect(m.asociado).toEqual({
        rotulo: "FACTURA",
        letra: "B",
        numero: `${String(a.x.pvNumero).padStart(5, "0")}-00000001`,
        fecha: diaDe(AHORA),
      });
    });

    it("dos marcas distintas dan el mismo bloque fiscal y reimprimir da lo mismo", async () => {
      const a = await crearEmpresa();
      const c = await crearAutorizado(a.x);
      entorno.usarMarca(MARCA_UNO);
      const uno = exito(await consultas.modeloDeImpresion(mira(a), { comprobanteId: c.id }));
      const otraVez = exito(await consultas.modeloDeImpresion(mira(a), { comprobanteId: c.id }));
      entorno.usarMarca(MARCA_DOS);
      const dos = exito(await consultas.modeloDeImpresion(mira(a), { comprobanteId: c.id }));
      entorno.usarMarca(MARCA_UNO);
      expect(JSON.stringify(otraVez)).toBe(JSON.stringify(uno));
      expect(dos.marca).toEqual(MARCA_DOS);
      expect(dos.fiscal).toEqual(uno.fiscal);
      expect({ ...dos, marca: uno.marca }).toEqual(uno);
    });

    it("solo se imprime un autorizado: pendiente, en validación, rechazado y descartado no", async () => {
      const a = await crearEmpresa();
      const pendiente = await crearPendiente(a.x);
      // el rechazado y el que sigue en validación comparten la serie: se rechaza primero, después se valida el otro
      const rechazado = await rechazar(a.x, await crearPendiente(a.x));
      const descartado = await descartar(a.x, await crearPendiente(a.x));
      const enValidacion = await crearPendiente(a.x);
      await escribir(a.x, (tx) => entrarEnValidacion(tx, enValidacion.id, a.x.empresa, AHORA));
      for (const c of [pendiente, enValidacion, rechazado, descartado]) {
        expect(await consultas.modeloDeImpresion(mira(a), { comprobanteId: c.id }), c.id).toEqual({
          ok: false,
          error: "COMPROBANTE_NO_AUTORIZADO",
        });
      }
    });
  });
});
