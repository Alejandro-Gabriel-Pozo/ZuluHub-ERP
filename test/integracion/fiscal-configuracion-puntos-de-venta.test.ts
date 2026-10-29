import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { domicilioId, puntoDeVentaId } from "../../src/modulos/fiscal/publico";
import { emisorId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import type { Dato } from "../../src/puertos/sin-secretos";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { crearBaseAparte, cuitAlAzar } from "./entorno";
import {
  casosDeConfiguracion,
  crearEntornoDeConfiguracion,
  crearEscenarioDeConfiguracion,
  domicilioNuevo,
  nuevoUuid,
  otraPersona,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";
import { crearDomicilio, crearPuntoDeVenta, crearSerie } from "./fiscal-apoyo";
import { casosDeNumeracion, crearEntornoDeNumeracion, entradaDe } from "./fiscal-numeracion-apoyo";

/**
 * H7 T5: los casos de uso de puntos de venta (crear, editar, activar, desactivar) contra una base real, con el rol
 * limitado de la aplicación y el contexto firmado. Éxito, repetición («ya estaba»), validaciones del dominio y de la
 * base, versión desactualizada, número inmutable con series usadas, atomicidad con la auditoría y el recorrido
 * hasta reservar un número. Los permisos y el aislamiento están en `fiscal-configuracion-acceso.test.ts`; las
 * carreras, en `fiscal-configuracion-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("fiscal T5: puntos de venta del gerente", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeConfiguracion>;
  let casos: ReturnType<typeof casosDeConfiguracion>;
  /** Con un mensaje, la auditoría falla DESPUÉS de que los demás efectos ya se escribieron (atomicidad). */
  let fallaDeAuditoria: string | null = null;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeConfiguracion(propia.base, 8, (tx) => ({
      ...tx,
      auditoria: {
        registrar: async (registro) => {
          await tx.auditoria.registrar(registro);
          if (fallaDeAuditoria !== null) throw new Error(fallaDeAuditoria);
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
  const puntosDeVenta = (empresa: string) =>
    filas<{
      id: string;
      emisor_id: string;
      sucursal_id: string;
      domicilio_id: string | null;
      numero: number;
      estado: string;
      ambiente: string;
      verificacion_arca: string;
      version: number;
    }>(
      `select id, emisor_id, sucursal_id, domicilio_id, numero, estado, ambiente, verificacion_arca, version
         from punto_de_venta where empresa_id = $1 order by numero, id`,
      [empresa],
    );
  const unPuntoDeVenta = async (id: string) =>
    (
      await filas<{
        numero: number;
        estado: string;
        version: number;
        sucursal_id: string;
        domicilio_id: string | null;
      }>(
        "select numero, estado, version, sucursal_id, domicilio_id from punto_de_venta where id = $1",
        [id],
      )
    )[0];
  const domicilios = async (empresa: string) =>
    (
      await filas<{ n: number }>("select count(*)::int as n from domicilio where empresa_id = $1", [
        empresa,
      ])
    )[0]?.n;
  const auditorias = (empresa: string, accion: string) =>
    filas<{ actor: string | null; entidad_id: string; antes: Dato; despues: Dato }>(
      `select actor_persona_id as actor, entidad_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and accion = $2 order by id`,
      [empresa, accion],
    );
  const todasLasAuditorias = async (empresa: string) =>
    (
      await filas<{ n: number }>(
        "select count(*)::int as n from auditoria_empresa where empresa_id = $1",
        [empresa],
      )
    )[0]?.n;
  const otraSucursal = async (empresa: string, nombre = "Sucursal norte") =>
    (
      await filas<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [empresa, nombre],
      )
    )[0]?.id as string;
  const secundario = async (empresa: string) =>
    (
      await filas<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [empresa, cuitAlAzar()],
      )
    )[0]?.id as string;

  const nuevo = () => crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE" });

  async function crear(
    e: EscenarioDeConfiguracion,
    extra: Partial<Parameters<typeof casos.crearPuntoDeVenta>[1]> = {},
  ) {
    return casos.crearPuntoDeVenta(e.como(), {
      id: nuevoUuid(),
      emisorId: emisorId(e.mundo.emisor),
      sucursalId: sucursalId(e.mundo.sucursal),
      numero: 1,
      domicilio: domicilioNuevo(),
      ...extra,
    });
  }
  /** Crea un punto de venta con el caso de uso y falla la prueba si no se pudo. */
  async function creado(
    e: EscenarioDeConfiguracion,
    extra: Partial<Parameters<typeof casos.crearPuntoDeVenta>[1]> = {},
  ) {
    const id = nuevoUuid();
    const r = await crear(e, { id, ...extra });
    if (!r.ok) throw new Error(`no se creó el punto de venta: ${JSON.stringify(r.error)}`);
    return { id: puntoDeVentaId(id), version: r.valor.version };
  }
  const editar = (
    e: EscenarioDeConfiguracion,
    p: { id: string; version: number },
    cambios: Partial<Parameters<typeof casos.editarPuntoDeVenta>[1]> = {},
  ) =>
    casos.editarPuntoDeVenta(e.como(), {
      puntoDeVentaId: puntoDeVentaId(p.id),
      versionEsperada: p.version,
      ...cambios,
    });
  const activar = (e: EscenarioDeConfiguracion, id: string) =>
    casos.activarPuntoDeVenta(e.como(), { puntoDeVentaId: puntoDeVentaId(id) });
  const desactivar = (e: EscenarioDeConfiguracion, id: string) =>
    casos.desactivarPuntoDeVenta(e.como(), { puntoDeVentaId: puntoDeVentaId(id) });

  // ===============================================================================================
  describe("crearPuntoDeVenta", () => {
    it("el gerente da de alta un punto de venta: nace INACTIVO, en homologación, sin verificar, con su domicilio y una auditoría", async () => {
      const e = await nuevo();
      const id = nuevoUuid();
      const domicilio = domicilioNuevo({ calle: "Mitre", numero: "900" });
      const r = await crear(e, { id, numero: 7, domicilio });
      expect(r).toEqual(ok({ puntoDeVentaId: id, version: 1, yaExistia: false }));
      expect(await puntosDeVenta(e.mundo.empresa)).toEqual([
        {
          id,
          emisor_id: e.mundo.emisor,
          sucursal_id: e.mundo.sucursal,
          domicilio_id: domicilio.id,
          numero: 7,
          estado: "INACTIVO",
          ambiente: "HOMOLOGACION",
          verificacion_arca: "NO_VERIFICADO",
          version: 1,
        },
      ]);
      expect(await domicilios(e.mundo.empresa)).toBe(1);
      const auditoria = await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor: e.persona, entidad_id: id, antes: null });
      expect(auditoria[0]?.despues).toEqual({
        emisorId: e.mundo.emisor,
        sucursalId: e.mundo.sucursal,
        numero: 7,
        domicilioId: domicilio.id,
        estado: "INACTIVO",
      });
    });

    it("se puede dar de alta sin domicilio (queda sin domicilio y no se podrá activar)", async () => {
      const e = await nuevo();
      const r = await crear(e, { domicilio: undefined });
      expect(r.ok).toBe(true);
      expect((await puntosDeVenta(e.mundo.empresa))[0]).toMatchObject({
        domicilio_id: null,
        estado: "INACTIVO",
      });
      expect(await domicilios(e.mundo.empresa)).toBe(0);
    });

    it("un domicilio existente de la empresa se puede reusar", async () => {
      const e = await nuevo();
      const existente = await crearDomicilio(dueno, e.mundo.empresa);
      const r = await crear(e, {
        domicilio: { tipo: "EXISTENTE", id: domicilioId(existente) },
      });
      expect(r.ok).toBe(true);
      expect((await puntosDeVenta(e.mundo.empresa))[0]?.domicilio_id).toBe(existente);
      expect(await domicilios(e.mundo.empresa)).toBe(1);
    });

    it("repetir el alta (el doble clic) no duplica nada: «ya existía» con la misma versión y una sola auditoría", async () => {
      const e = await nuevo();
      const id = nuevoUuid();
      const domicilio = domicilioNuevo();
      const primero = await crear(e, { id, domicilio });
      const segundo = await crear(e, { id, domicilio });
      expect(primero).toEqual(ok({ puntoDeVentaId: id, version: 1, yaExistia: false }));
      expect(segundo).toEqual(ok({ puntoDeVentaId: id, version: 1, yaExistia: true }));
      expect(await puntosDeVenta(e.mundo.empresa)).toHaveLength(1);
      expect(await domicilios(e.mundo.empresa)).toBe(1);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO")).toHaveLength(1);
    });

    it("el mismo id con otro número, otra sucursal u otro emisor es ID_EN_USO: un id no se reusa para otra cosa", async () => {
      const e = await nuevo();
      const sucursal2 = await otraSucursal(e.mundo.empresa);
      const sec = await secundario(e.mundo.empresa);
      const id = nuevoUuid();
      await crear(e, { id, numero: 3 });
      for (const otro of [
        { numero: 4 },
        { sucursalId: sucursalId(sucursal2) },
        { emisorId: emisorId(sec) },
      ]) {
        expect(await crear(e, { id, numero: 3, ...otro }), JSON.stringify(otro)).toEqual(
          err("ID_EN_USO"),
        );
      }
      expect(await puntosDeVenta(e.mundo.empresa)).toHaveLength(1);
    });

    it("el número es único por emisor: repetido en el mismo emisor es PUNTO_DE_VENTA_DUPLICADO; en otro emisor de la empresa entra", async () => {
      const e = await nuevo();
      await creado(e, { numero: 1 });
      const duplicado = await crear(e, { numero: 1, domicilio: undefined });
      expect(duplicado).toEqual(err("PUNTO_DE_VENTA_DUPLICADO"));
      const sec = await secundario(e.mundo.empresa);
      const enOtroEmisor = await crear(e, { numero: 1, emisorId: emisorId(sec) });
      expect(enOtroEmisor.ok).toBe(true);
      expect(await puntosDeVenta(e.mundo.empresa)).toHaveLength(2);
    });

    it.each([0, -1, 100_000, 1.5, Number.NaN])(
      "el número %s es PUNTO_DE_VENTA_NUMERO_INVALIDO",
      async (numero) => {
        const e = await nuevo();
        const r = await crear(e, { numero });
        expect(r).toEqual(err("PUNTO_DE_VENTA_NUMERO_INVALIDO"));
        expect(await puntosDeVenta(e.mundo.empresa)).toEqual([]);
        expect(await domicilios(e.mundo.empresa)).toBe(0);
      },
    );

    it.each([1, 99_999])("el número %s, en los extremos del rango, entra", async (numero) => {
      const e = await nuevo();
      expect((await crear(e, { numero })).ok).toBe(true);
    });

    it("una sucursal de otra empresa, o que no existe, es SUCURSAL_DE_OTRA_EMPRESA y no deja nada", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      for (const sucursal of [otra.mundo.sucursal, nuevoUuid()]) {
        const r = await crear(e, { sucursalId: sucursalId(sucursal) });
        expect(r, sucursal).toEqual(err("SUCURSAL_DE_OTRA_EMPRESA"));
      }
      expect(await puntosDeVenta(e.mundo.empresa)).toEqual([]);
      expect(await domicilios(e.mundo.empresa)).toBe(0);
    });

    it("un emisor que no existe, o es de otra empresa, es EMISOR_NO_ENCONTRADO", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      for (const emisor of [nuevoUuid(), otra.mundo.emisor]) {
        expect(await crear(e, { emisorId: emisorId(emisor) }), emisor).toEqual(
          err("EMISOR_NO_ENCONTRADO"),
        );
      }
      expect(await puntosDeVenta(otra.mundo.empresa)).toEqual([]);
    });

    it("un id que no es uuid, o un domicilio inválido, se rechazan sin escribir nada", async () => {
      const e = await nuevo();
      expect(await crear(e, { id: "no-es-uuid" })).toEqual(err("ID_INVALIDO"));
      expect(await crear(e, { domicilio: domicilioNuevo({ calle: "" }) })).toEqual(
        err("CALLE_INVALIDA"),
      );
      expect(await crear(e, { domicilio: domicilioNuevo({ provincia: "AR-Z9" }) })).toEqual(
        err("PROVINCIA_INVALIDA"),
      );
      expect(await puntosDeVenta(e.mundo.empresa)).toEqual([]);
      expect(await domicilios(e.mundo.empresa)).toBe(0);
      expect(await todasLasAuditorias(e.mundo.empresa)).toBe(0);
    });

    it("el id de un punto de venta de otra empresa (que esta no ve) es ID_EN_USO y no lo toca", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      const ajeno = await crearPuntoDeVenta(dueno, otra.mundo, { numero: 9 });
      expect(await crear(e, { id: ajeno })).toEqual(err("ID_EN_USO"));
      expect(await puntosDeVenta(e.mundo.empresa)).toEqual([]);
      expect((await puntosDeVenta(otra.mundo.empresa))[0]).toMatchObject({ id: ajeno, numero: 9 });
    });

    it("atomicidad: si la auditoría falla después de escribir, no queda ni el punto de venta ni su domicilio", async () => {
      const e = await nuevo();
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(crear(e)).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect(await puntosDeVenta(e.mundo.empresa)).toEqual([]);
      expect(await domicilios(e.mundo.empresa)).toBe(0);
      expect((await crear(e)).ok).toBe(true);
    });
  });

  // ===============================================================================================
  // Un punto de venta solo se da de alta en una sucursal ABIERTA. Decisión del dueño, 2026-10-29 (cuestionario respondido a las
  // 21:08:28Z): «¿Se puede crear un punto de venta en una sucursal que está cerrada?» → «No: solo en sucursales abiertas». El servidor
  // lo valida (la pantalla ya filtra la lista, pero un pedido armado a mano llega igual). Las carreras con el cierre están en
  // `fiscal-configuracion-concurrencia.test.ts`.
  // ===============================================================================================
  describe("crearPuntoDeVenta en una sucursal cerrada", () => {
    const cerrar = (sucursal: string) =>
      dueno.query("update sucursal set activa = false where id = $1", [sucursal]);
    const abrir = (sucursal: string) =>
      dueno.query("update sucursal set activa = true where id = $1", [sucursal]);
    /** Una empresa con una segunda sucursal (la primera sigue abierta: la empresa nunca queda sin una activa). */
    async function conSucursalCerrada() {
      const e = await nuevo();
      const cerrada = await otraSucursal(e.mundo.empresa, "Sucursal cerrada");
      await cerrar(cerrada);
      return { e, cerrada };
    }
    const nada = async (empresa: string) => ({
      puntos: await puntosDeVenta(empresa),
      domicilios: await domicilios(empresa),
      auditorias: await todasLasAuditorias(empresa),
    });

    it("una sucursal abierta (la de siempre u otra) entra", async () => {
      const e = await nuevo();
      const otra = await otraSucursal(e.mundo.empresa, "Sucursal norte");
      expect((await crear(e, { numero: 1 })).ok).toBe(true);
      expect((await crear(e, { numero: 2, sucursalId: sucursalId(otra) })).ok).toBe(true);
      expect((await puntosDeVenta(e.mundo.empresa)).map((p) => p.sucursal_id)).toEqual([
        e.mundo.sucursal,
        otra,
      ]);
    });

    it("una sucursal cerrada es SUCURSAL_CERRADA y no escribe NADA: ni el punto de venta, ni el domicilio nuevo, ni la auditoría", async () => {
      const { e, cerrada } = await conSucursalCerrada();
      const antes = await nada(e.mundo.empresa);
      const id = nuevoUuid();
      const domicilio = domicilioNuevo();
      const r = await crear(e, { id, sucursalId: sucursalId(cerrada), domicilio });
      expect(r).toEqual(err("SUCURSAL_CERRADA"));
      expect(await nada(e.mundo.empresa)).toEqual(antes);
      expect(antes).toEqual({ puntos: [], domicilios: 0, auditorias: 0 });
      // Reabierta, el MISMO pedido (mismo id y mismo domicilio) entra: no quedó ni el uno ni el otro tomado.
      await abrir(cerrada);
      expect(await crear(e, { id, sucursalId: sucursalId(cerrada), domicilio })).toEqual(
        ok({ puntoDeVentaId: id, version: 1, yaExistia: false }),
      );
      expect(await domicilios(e.mundo.empresa)).toBe(1);
    });

    it("se rechaza también sin domicilio, y no importa el emisor ni el número libre", async () => {
      const { e, cerrada } = await conSucursalCerrada();
      for (const numero of [1, 2, 99_999]) {
        const r = await crear(e, { numero, sucursalId: sucursalId(cerrada), domicilio: undefined });
        expect(r, `número ${numero}`).toEqual(err("SUCURSAL_CERRADA"));
      }
      expect(await puntosDeVenta(e.mundo.empresa)).toEqual([]);
    });

    it("el permiso va primero: un administrador o un operador reciben SIN_PERMISO, nunca «sucursal cerrada», y no se escribe nada", async () => {
      const { e, cerrada } = await conSucursalCerrada();
      for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
        const otro = await otraPersona(dueno, e, rol);
        const r = await casos.crearPuntoDeVenta(otro.como(), {
          id: nuevoUuid(),
          emisorId: emisorId(e.mundo.emisor),
          sucursalId: sucursalId(cerrada),
          numero: 1,
          domicilio: domicilioNuevo(),
        });
        expect(r, rol).toEqual(err("SIN_PERMISO"));
      }
      expect(await nada(e.mundo.empresa)).toEqual({ puntos: [], domicilios: 0, auditorias: 0 });
    });

    it("la repetición manda: si ya existía con ese contenido es «ya existía» aunque la sucursal se haya cerrado después, sin escribir ni auditar de nuevo", async () => {
      const e = await nuevo();
      const sucursal = await otraSucursal(e.mundo.empresa, "Sucursal norte");
      const id = nuevoUuid();
      const pedido = {
        id,
        numero: 4,
        sucursalId: sucursalId(sucursal),
        domicilio: domicilioNuevo(),
      };
      expect(await crear(e, pedido)).toEqual(
        ok({ puntoDeVentaId: id, version: 1, yaExistia: false }),
      );
      await cerrar(sucursal);
      const antes = await nada(e.mundo.empresa);
      expect(await crear(e, pedido)).toEqual(
        ok({ puntoDeVentaId: id, version: 1, yaExistia: true }),
      );
      expect(await nada(e.mundo.empresa)).toEqual(antes);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO")).toHaveLength(1);
    });

    it("la idempotencia va antes que la sucursal cerrada: el mismo id con OTRO contenido es ID_EN_USO, no «sucursal cerrada»", async () => {
      const e = await nuevo();
      const sucursal = await otraSucursal(e.mundo.empresa, "Sucursal norte");
      const id = nuevoUuid();
      await crear(e, { id, numero: 4, sucursalId: sucursalId(sucursal) });
      await cerrar(sucursal);
      // Otro número, en la misma sucursal ya cerrada; y la misma sucursal cerrada pero el id de un punto de venta de otra.
      expect(await crear(e, { id, numero: 5, sucursalId: sucursalId(sucursal) })).toEqual(
        err("ID_EN_USO"),
      );
      const otroId = await creado(e, { numero: 6 });
      expect(
        await crear(e, { id: otroId.id, numero: 6, sucursalId: sucursalId(sucursal) }),
      ).toEqual(err("ID_EN_USO"));
      expect(await puntosDeVenta(e.mundo.empresa)).toHaveLength(2);
    });

    it("la sucursal de otra empresa va antes que la cerrada: una cerrada AJENA (o inexistente) es SUCURSAL_DE_OTRA_EMPRESA, sin decir que existe ni que está cerrada", async () => {
      const e = await nuevo();
      const { e: otra, cerrada } = await conSucursalCerrada();
      const antes = await nada(e.mundo.empresa);
      for (const sucursal of [cerrada, otra.mundo.sucursal, nuevoUuid()]) {
        const r = await crear(e, { sucursalId: sucursalId(sucursal) });
        expect(r, sucursal).toEqual(err("SUCURSAL_DE_OTRA_EMPRESA"));
      }
      expect(await nada(e.mundo.empresa)).toEqual(antes);
      expect(await nada(otra.mundo.empresa)).toEqual({ puntos: [], domicilios: 0, auditorias: 0 });
    });

    it("cerrar una sucursal no frena el alta en las demás de la empresa, ni en la misma de otra empresa", async () => {
      const { e, cerrada } = await conSucursalCerrada();
      const otra = await nuevo();
      expect((await crear(e, { numero: 1 })).ok).toBe(true);
      expect((await crear(otra, { numero: 1 })).ok).toBe(true);
      expect(await crear(e, { numero: 2, sucursalId: sucursalId(cerrada) })).toEqual(
        err("SUCURSAL_CERRADA"),
      );
    });
  });

  // ===============================================================================================
  // LO QUE HACEN HOY editar y activar con una sucursal cerrada. NO es una decisión del dueño: no dijo qué pasa al MOVER un punto de
  // venta a una sucursal cerrada ni al ACTIVAR uno de una sucursal cerrada (pregunta pendiente en el PR). Estas pruebas solo lo dejan
  // documentado; si el dueño decide otra cosa, se cambian junto con el código.
  // ===============================================================================================
  describe("HOY: editar y activar con una sucursal cerrada no la miran (sin decisión del dueño)", () => {
    const cerrar = (sucursal: string) =>
      dueno.query("update sucursal set activa = false where id = $1", [sucursal]);

    it("editar: mover un punto de venta a una sucursal cerrada se acepta (sube la versión y se audita)", async () => {
      const e = await nuevo();
      const cerrada = await otraSucursal(e.mundo.empresa, "Sucursal cerrada");
      await cerrar(cerrada);
      const p = await creado(e, { numero: 1 });
      const r = await editar(e, p, { sucursalId: sucursalId(cerrada) });
      expect(r).toEqual(ok({ version: 2, sinCambios: false }));
      expect((await unPuntoDeVenta(p.id))?.sucursal_id).toBe(cerrada);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toHaveLength(1);
    });

    it("activar: activar un punto de venta cuya sucursal se cerró se acepta (queda ACTIVO en la sucursal cerrada)", async () => {
      const e = await nuevo();
      const sucursal = await otraSucursal(e.mundo.empresa, "Sucursal norte");
      const p = await creado(e, { numero: 1, sucursalId: sucursalId(sucursal) });
      await cerrar(sucursal);
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      expect((await unPuntoDeVenta(p.id))?.estado).toBe("ACTIVO");
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO")).toHaveLength(1);
    });
  });

  // ===============================================================================================
  describe("editarPuntoDeVenta", () => {
    it("cambia el número, la sucursal y el domicilio: sube la versión y audita el antes y el después de lo que cambió", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      const [antes] = await puntosDeVenta(e.mundo.empresa);
      const sucursal2 = await otraSucursal(e.mundo.empresa);
      const domicilio = domicilioNuevo({ calle: "Nueva" });
      const r = await editar(e, p, {
        numero: 5,
        sucursalId: sucursalId(sucursal2),
        domicilio,
      });
      expect(r).toEqual(ok({ version: 2, sinCambios: false }));
      expect((await puntosDeVenta(e.mundo.empresa))[0]).toMatchObject({
        id: p.id,
        numero: 5,
        sucursal_id: sucursal2,
        domicilio_id: domicilio.id,
        version: 2,
        // El emisor nunca cambia.
        emisor_id: e.mundo.emisor,
        estado: "INACTIVO",
      });
      const auditoria = await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor: e.persona, entidad_id: p.id });
      expect(auditoria[0]?.antes).toEqual({
        emisorId: e.mundo.emisor,
        numero: 1,
        sucursalId: e.mundo.sucursal,
        domicilioId: antes?.domicilio_id,
      });
      expect(auditoria[0]?.despues).toEqual({
        emisorId: e.mundo.emisor,
        numero: 5,
        sucursalId: sucursal2,
        domicilioId: domicilio.id,
      });
    });

    it("solo audita lo que cambia", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      await editar(e, p, { numero: 2 });
      const [fila] = await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO");
      expect(fila?.antes).toEqual({ emisorId: e.mundo.emisor, numero: 1 });
      expect(fila?.despues).toEqual({ emisorId: e.mundo.emisor, numero: 2 });
    });

    it("pedir lo que ya tiene es un éxito sin escribir ni auditar, aunque la versión esperada esté vieja", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 4 });
      await editar(e, p, { numero: 5 });
      const mismo = await editar(e, { id: p.id, version: 1 }, { numero: 5 });
      const nada = await editar(e, { id: p.id, version: 99 }, {});
      expect(mismo).toEqual(ok({ version: 2, sinCambios: true }));
      expect(nada).toEqual(ok({ version: 2, sinCambios: true }));
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toHaveLength(1);
    });

    it("con una versión vieja es VERSION_DESACTUALIZADA y no cambia nada", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      await editar(e, p, { numero: 2 });
      const r = await editar(e, p, { numero: 3 });
      expect(r).toEqual(err("VERSION_DESACTUALIZADA"));
      expect(await unPuntoDeVenta(p.id)).toMatchObject({ numero: 2, version: 2 });
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toHaveLength(1);
    });

    it("con números usados el número no cambia (PUNTO_DE_VENTA_NUMERO_INMUTABLE) pero la sucursal y el domicilio sí", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      await crearSerie(dueno, e.mundo.empresa, p.id, e.mundo.emisor, "FACTURA_B", 5);
      expect(await editar(e, p, { numero: 2 })).toEqual(err("PUNTO_DE_VENTA_NUMERO_INMUTABLE"));
      expect((await unPuntoDeVenta(p.id))?.numero).toBe(1);
      const sucursal2 = await otraSucursal(e.mundo.empresa);
      const r = await editar(e, p, {
        sucursalId: sucursalId(sucursal2),
        domicilio: domicilioNuevo({ calle: "Otra" }),
      });
      expect(r.ok).toBe(true);
      expect((await unPuntoDeVenta(p.id))?.sucursal_id).toBe(sucursal2);
    });

    it("una serie sin usar (LIBRE, último número 0) no frena el cambio de número", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      await crearSerie(dueno, e.mundo.empresa, p.id, e.mundo.emisor, "FACTURA_B", 0);
      expect((await editar(e, p, { numero: 2 })).ok).toBe(true);
    });

    it("el número de otro punto de venta del emisor es PUNTO_DE_VENTA_DUPLICADO; fuera de rango, PUNTO_DE_VENTA_NUMERO_INVALIDO", async () => {
      const e = await nuevo();
      await creado(e, { numero: 1 });
      const p = await creado(e, { numero: 2, domicilio: undefined });
      expect(await editar(e, p, { numero: 1 })).toEqual(err("PUNTO_DE_VENTA_DUPLICADO"));
      expect(await editar(e, p, { numero: 0 })).toEqual(err("PUNTO_DE_VENTA_NUMERO_INVALIDO"));
      expect(await editar(e, p, { numero: 100_000 })).toEqual(
        err("PUNTO_DE_VENTA_NUMERO_INVALIDO"),
      );
      expect((await unPuntoDeVenta(p.id))?.numero).toBe(2);
    });

    it("una sucursal de otra empresa es SUCURSAL_DE_OTRA_EMPRESA", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      const p = await creado(e, { numero: 1 });
      const r = await editar(e, p, { sucursalId: sucursalId(otra.mundo.sucursal) });
      expect(r).toEqual(err("SUCURSAL_DE_OTRA_EMPRESA"));
      expect((await unPuntoDeVenta(p.id))?.sucursal_id).toBe(e.mundo.sucursal);
    });

    it("un punto de venta que no existe, o es de otra empresa, es PUNTO_DE_VENTA_NO_ENCONTRADO", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      const ajeno = await creado(otra, { numero: 3 });
      expect(await editar(e, { id: nuevoUuid(), version: 1 }, { numero: 2 })).toEqual(
        err("PUNTO_DE_VENTA_NO_ENCONTRADO"),
      );
      expect(await editar(e, ajeno, { numero: 2 })).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
      expect((await unPuntoDeVenta(ajeno.id))?.numero).toBe(3);
    });

    it("un domicilio inválido o ajeno se rechaza y no cambia nada", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      const domiciliosAntes = await domicilios(e.mundo.empresa);
      expect(await editar(e, p, { domicilio: domicilioNuevo({ localidad: "" }) })).toEqual(
        err("LOCALIDAD_INVALIDA"),
      );
      expect(
        await editar(e, p, { domicilio: { tipo: "EXISTENTE", id: domicilioId(nuevoUuid()) } }),
      ).toEqual(err("DOMICILIO_NO_ENCONTRADO"));
      expect(await domicilios(e.mundo.empresa)).toBe(domiciliosAntes);
      expect((await unPuntoDeVenta(p.id))?.version).toBe(1);
    });

    it("atomicidad: si la auditoría falla, el punto de venta y su domicilio nuevo quedan como estaban", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      const domiciliosAntes = await domicilios(e.mundo.empresa);
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(
          editar(e, p, { numero: 2, domicilio: domicilioNuevo({ calle: "Nueva" }) }),
        ).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect(await unPuntoDeVenta(p.id)).toMatchObject({ numero: 1, version: 1 });
      expect(await domicilios(e.mundo.empresa)).toBe(domiciliosAntes);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toEqual([]);
    });

    it("un punto de venta ACTIVO también se edita", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      await activar(e, p.id);
      const [activo] = await puntosDeVenta(e.mundo.empresa);
      const r = await editar(e, { id: p.id, version: activo?.version ?? 0 }, { numero: 2 });
      expect(r.ok).toBe(true);
      expect(await unPuntoDeVenta(p.id)).toMatchObject({ numero: 2, estado: "ACTIVO" });
    });
  });

  // ===============================================================================================
  describe("activar y desactivar", () => {
    it("activar exige domicilio: sin él es PUNTO_DE_VENTA_SIN_DOMICILIO y sigue INACTIVO", async () => {
      const e = await nuevo();
      const p = await creado(e, { domicilio: undefined });
      expect(await activar(e, p.id)).toEqual(err("PUNTO_DE_VENTA_SIN_DOMICILIO"));
      expect((await unPuntoDeVenta(p.id))?.estado).toBe("INACTIVO");
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO")).toEqual([]);
      // Con el domicilio cargado después, se activa.
      await editar(e, p, { domicilio: domicilioNuevo() });
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: false }));
    });

    it("el gerente activa un punto de venta con domicilio: queda ACTIVO y una auditoría", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 3 });
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      expect(await unPuntoDeVenta(p.id)).toMatchObject({ estado: "ACTIVO", version: 2 });
      const auditoria = await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor: e.persona, entidad_id: p.id });
      expect(auditoria[0]?.antes).toEqual({ estado: "INACTIVO" });
      expect(auditoria[0]?.despues).toEqual({
        estado: "ACTIVO",
        emisorId: e.mundo.emisor,
        numero: 3,
      });
    });

    it("activar dos veces (el doble clic) es «ya estaba»: sin escribir y con una sola auditoría", async () => {
      const e = await nuevo();
      const p = await creado(e);
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: true }));
      expect((await unPuntoDeVenta(p.id))?.version).toBe(2);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO")).toHaveLength(1);
    });

    it("con el emisor inactivo no se activa (EMISOR_INACTIVO)", async () => {
      const e = await nuevo();
      const sec = await secundario(e.mundo.empresa);
      const domicilio = await crearDomicilio(dueno, e.mundo.empresa);
      const id = await crearPuntoDeVenta(dueno, e.mundo, { emisor: sec, domicilio, numero: 1 });
      await dueno.query("update emisor set activo = false where id = $1", [sec]);
      expect(await activar(e, id)).toEqual(err("EMISOR_INACTIVO"));
      expect((await unPuntoDeVenta(id))?.estado).toBe("INACTIVO");
    });

    it("desactivar un punto de venta ACTIVO lo deja INACTIVO, con auditoría, y conserva su número, su domicilio y sus series", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 2 });
      await activar(e, p.id);
      await crearSerie(dueno, e.mundo.empresa, p.id, e.mundo.emisor, "FACTURA_B", 4);
      expect(await desactivar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      expect(await unPuntoDeVenta(p.id)).toMatchObject({
        estado: "INACTIVO",
        numero: 2,
        version: 3,
      });
      expect((await unPuntoDeVenta(p.id))?.domicilio_id).not.toBeNull();
      expect(
        await filas(
          "select ultimo_numero::text as ultimo from serie_comprobante where punto_de_venta_id = $1",
          [p.id],
        ),
      ).toEqual([{ ultimo: "4" }]);
      const auditoria = await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_DESACTIVADO");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor: e.persona, entidad_id: p.id });
      expect(auditoria[0]?.antes).toEqual({ estado: "ACTIVO" });
      expect(auditoria[0]?.despues).toEqual({
        estado: "INACTIVO",
        emisorId: e.mundo.emisor,
        numero: 2,
      });
    });

    it("desactivar uno que ya está INACTIVO es «ya estaba», sin escribir ni auditar; y se puede reactivar", async () => {
      const e = await nuevo();
      const p = await creado(e);
      expect(await desactivar(e, p.id)).toEqual(ok({ yaEstaba: true }));
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_DESACTIVADO")).toEqual([]);
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      expect(await desactivar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      expect(await desactivar(e, p.id)).toEqual(ok({ yaEstaba: true }));
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO")).toHaveLength(2);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_DESACTIVADO")).toHaveLength(1);
    });

    it("un punto de venta que no existe, o es de otra empresa, es PUNTO_DE_VENTA_NO_ENCONTRADO", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      const ajeno = await creado(otra);
      for (const id of [nuevoUuid(), ajeno.id]) {
        expect(await activar(e, id), id).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
        expect(await desactivar(e, id), id).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
      }
      expect((await unPuntoDeVenta(ajeno.id))?.estado).toBe("INACTIVO");
    });

    it("atomicidad: si la auditoría falla, el estado no cambia", async () => {
      const e = await nuevo();
      const p = await creado(e);
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(activar(e, p.id)).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect(await unPuntoDeVenta(p.id)).toMatchObject({ estado: "INACTIVO", version: 1 });
      expect(await activar(e, p.id)).toEqual(ok({ yaEstaba: false }));
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(desactivar(e, p.id)).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect((await unPuntoDeVenta(p.id))?.estado).toBe("ACTIVO");
    });
  });

  // ===============================================================================================
  describe("el recorrido completo", () => {
    it("con lo que configura el gerente (punto de venta creado y activado) ya se puede reservar el primer número", async () => {
      const e = await nuevo();
      const p = await creado(e, { numero: 1 });
      await activar(e, p.id);
      const numeracion = crearEntornoDeNumeracion(propia.base, 4);
      try {
        const r = await casosDeNumeracion(
          numeracion,
          new EmisionFalsa(),
        ).reservarNumeroDeComprobante(e.como(), entradaDe({ puntoDeVenta: p.id }));
        expect(r).toMatchObject({ ok: true, valor: { numero: 1n } });
      } finally {
        await numeracion.cerrar();
      }
    });
  });
});
