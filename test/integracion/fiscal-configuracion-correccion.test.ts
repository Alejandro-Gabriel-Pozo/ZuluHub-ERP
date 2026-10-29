import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { domicilioId, puntoDeVentaId } from "../../src/modulos/fiscal/publico";
import { emisorId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  casosDeConfiguracion,
  crearEntornoDeConfiguracion,
  crearEscenarioDeConfiguracion,
  domicilioNuevo,
  nuevoUuid,
  otraPersona,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";

/**
 * D-62 («para corregir datos ya confirmados la pantalla precarga lo vigente y se confirma de nuevo = versión nueva»): el caso de uso
 * `empezarCorreccionDeDatosFiscales` contra una base real, y de paso los cruces entre empresas de los identificadores que genera
 * la pantalla (`borradorId` de una versión confirmada, `domicilio.id` nuevo o existente, `puntoDeVentaId`), que la revisión de #117 había
 * probado solo con una sonda. Cubre: lo que crea (y con qué datos), la repetición, el borrador que ya existe (del emisor, no de la
 * pestaña), el rol (solo el gerente), el aislamiento por empresa, la atomicidad y la concurrencia.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const RONDAS = 4;
const AHORA = new Date("2026-10-29T12:00:00Z");
const DIA = 86_400_000;
const MANANA = new Date(AHORA.getTime() + DIA);

type Fila = Record<string, unknown>;
type Cualquiera = Resultado<unknown, unknown>;

const codigoDe = (r: Cualquiera): string => {
  if (r.ok) return "ok";
  if (typeof r.error === "string") return r.error;
  const tipo = (r.error as { tipo?: unknown }).tipo;
  return typeof tipo === "string" ? tipo : "otro";
};
/** Quien perdió la carrera por quedarse sin reintentos: no es un defecto, pero no cuenta como éxito. */
const agotada = (r: Cualquiera) => codigoDe(r) === "ConcurrenciaAgotada";

const COMPLETOS = {
  razonSocial: "Coop Pampa SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  inicioActividades: "2020-03-01",
} as const;

describe.skipIf(base === null)(
  "fiscal D-62: empezar a corregir los datos fiscales confirmados",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeConfiguracion>;
    let casos: ReturnType<typeof casosDeConfiguracion>;
    /** Con un mensaje, la auditoría falla DESPUÉS de que los demás efectos ya se escribieron (atomicidad). */
    let fallaDeAuditoria: string | null = null;
    /** Mientras haya una barrera, toda transacción espera en ella al leer lo que decide, por primera vez. */
    let barrera: { donde: readonly string[]; esperar: () => Promise<void> } | null = null;
    const enBarrera = async (donde: string) => {
      if (barrera !== null && barrera.donde.includes(donde)) await barrera.esperar();
    };

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDeConfiguracion(propia.base, 16, (tx) => ({
        ...tx,
        auditoria: {
          registrar: async (registro) => {
            await tx.auditoria.registrar(registro);
            if (fallaDeAuditoria !== null) throw new Error(fallaDeAuditoria);
          },
        },
        datosFiscales: {
          ...tx.datosFiscales,
          obtenerBorrador: async (...args) => {
            const r = await tx.datosFiscales.obtenerBorrador(...args);
            await enBarrera("datos.obtenerBorrador");
            return r;
          },
          obtener: async (...args) => {
            const r = await tx.datosFiscales.obtener(...args);
            await enBarrera("datos.obtener");
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
    const cuenta = async (texto: string, parametros: unknown[] = []) =>
      Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
    const auditorias = (empresa: string, accion = "DATOS_FISCALES_BORRADOR_GUARDADO") =>
      cuenta("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
        empresa,
        accion,
      ]);
    const versiones = (emisor: string) =>
      filas<{
        id: string;
        estado: string;
        numero: number | null;
        razon_social: string | null;
        domicilio_fiscal_id: string | null;
        version: number;
      }>(
        `select id, estado, numero, razon_social, domicilio_fiscal_id, version from datos_fiscales
        where emisor_id = $1 order by numero nulls last`,
        [emisor],
      );
    const domicilios = (empresa: string) =>
      cuenta("select count(*) as n from domicilio where empresa_id = $1", [empresa]);
    /** Todo lo fiscal que una empresa tiene, en una foto para comparar antes y después. */
    async function foto(empresa: string) {
      return {
        datos: await filas(
          "select id, estado, version, razon_social, numero, domicilio_fiscal_id from datos_fiscales where empresa_id = $1 order by id",
          [empresa],
        ),
        domicilios: await filas("select id from domicilio where empresa_id = $1 order by id", [
          empresa,
        ]),
        puntos: await filas(
          "select id, version, numero, domicilio_id from punto_de_venta where empresa_id = $1 order by id",
          [empresa],
        ),
        auditoria: await filas(
          "select id from auditoria_empresa where empresa_id = $1 order by id",
          [empresa],
        ),
      };
    }

    const nuevo = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR" = "GERENTE") =>
      crearEscenarioDeConfiguracion(dueno, { rol });
    const guardar = (
      e: EscenarioDeConfiguracion,
      extra: Partial<Parameters<typeof casos.guardarBorradorDeDatosFiscales>[1]> = {},
    ) =>
      casos.guardarBorradorDeDatosFiscales(e.como(AHORA), {
        emisorId: emisorId(e.mundo.emisor),
        borradorId: nuevoUuid(),
        cambios: COMPLETOS,
        domicilio: domicilioNuevo(),
        ...extra,
      });
    const confirmar = (
      e: EscenarioDeConfiguracion,
      borradorId: string,
      versionEsperada: number,
      extra: Partial<Parameters<typeof casos.confirmarDatosFiscales>[1]> = {},
    ) =>
      casos.confirmarDatosFiscales(e.como(AHORA), {
        emisorId: emisorId(e.mundo.emisor),
        borradorId,
        versionEsperada,
        vigenteDesde: AHORA,
        motivo: "Alta",
        ...extra,
      });
    /** Una empresa con una versión confirmada y vigente (la 1). */
    async function conVigente(opciones: { rol?: "GERENTE" } = {}) {
      const e = await crearEscenarioDeConfiguracion(dueno, opciones);
      const id = nuevoUuid();
      const alta = await guardar(e, { borradorId: id });
      if (!alta.ok) throw new Error("no se guardó");
      const c = await confirmar(e, id, alta.valor.version);
      if (!c.ok) throw new Error("no se confirmó");
      return { e, idConfirmada: id };
    }
    const empezar = (
      e: EscenarioDeConfiguracion,
      extra: Partial<Parameters<typeof casos.empezarCorreccionDeDatosFiscales>[1]> = {},
      ahora = MANANA,
    ) =>
      casos.empezarCorreccionDeDatosFiscales(e.como(ahora), {
        emisorId: emisorId(e.mundo.emisor),
        borradorId: nuevoUuid(),
        ...extra,
      });
    /** `n` llamadas a la vez; con `donde`, todas leen lo que decide antes de que cualquiera escriba. */
    async function enParalelo<T>(
      donde: string | readonly string[] | null,
      n: number,
      llamada: (i: number) => Promise<T>,
    ): Promise<T[]> {
      barrera =
        donde === null
          ? null
          : { donde: typeof donde === "string" ? [donde] : donde, esperar: crearBarrera(n) };
      try {
        return await Promise.all(Array.from({ length: n }, (_, i) => llamada(i)));
      } finally {
        barrera = null;
      }
    }

    // ===============================================================================================
    describe("lo que crea", () => {
      it("un borrador con los datos de la versión vigente, el mismo domicilio (sin duplicarlo), versión 1 y UNA auditoría con su origen", async () => {
        const { e, idConfirmada } = await conVigente();
        const [vigente] = await versiones(e.mundo.emisor);
        expect(await domicilios(e.mundo.empresa)).toBe(1);
        const auditoriasAntes = await auditorias(e.mundo.empresa);

        const id = nuevoUuid();
        const r = await empezar(e, { borradorId: id });
        expect(r).toMatchObject({
          ok: true,
          valor: { borradorId: id, version: 1, yaEstaba: false },
        });

        const filasDeDatos = await versiones(e.mundo.emisor);
        expect(filasDeDatos).toHaveLength(2);
        expect(filasDeDatos[0]).toMatchObject({
          id: idConfirmada,
          estado: "CONFIRMADA",
          numero: 1,
        });
        expect(filasDeDatos[1]).toMatchObject({
          id,
          estado: "BORRADOR",
          razon_social: "Coop Pampa SA",
          domicilio_fiscal_id: vigente?.domicilio_fiscal_id,
          version: 1,
        });
        expect(await domicilios(e.mundo.empresa)).toBe(1);
        expect(await auditorias(e.mundo.empresa)).toBe(auditoriasAntes + 1);
        const [registro] = await filas<{ actor: string; despues: Record<string, unknown> }>(
          `select actor_persona_id as actor, despues from auditoria_empresa
          where empresa_id = $1 and entidad_id = $2`,
          [e.mundo.empresa, id],
        );
        expect(registro?.actor).toBe(e.persona);
        expect(registro?.despues).toMatchObject({
          razonSocial: "Coop Pampa SA",
          condicionIva: "RESPONSABLE_INSCRIPTO",
          inicioActividades: "2020-03-01",
          desdeNumero: 1,
        });
      });

      it("parte de la versión que RIGE hoy: no de una futura ni de una vieja", async () => {
        const { e } = await conVigente();
        // La 2 rige desde mañana: hoy sigue rigiendo la 1.
        const futura = nuevoUuid();
        const alta = await guardar(e, {
          borradorId: futura,
          cambios: { ...COMPLETOS, razonSocial: "Futura SA" },
        });
        if (!alta.ok) throw new Error("no se guardó");
        expect((await confirmar(e, futura, alta.valor.version, { vigenteDesde: MANANA })).ok).toBe(
          true,
        );
        const hoy = await empezar(e, {}, new Date(AHORA.getTime() + 1000));
        expect(hoy.ok).toBe(true);
        expect((await versiones(e.mundo.emisor)).at(-1)).toMatchObject({
          estado: "BORRADOR",
          razon_social: "Coop Pampa SA",
        });
      });

      it("corregir de punta a punta: se cambia lo que cambió, se confirma de nuevo y queda la versión 2 con la 1 intacta", async () => {
        const { e, idConfirmada } = await conVigente();
        const id = nuevoUuid();
        const creada = await empezar(e, { borradorId: id });
        if (!creada.ok) throw new Error("no empezó");
        const nuevoDomicilio = domicilioNuevo({ calle: "Mudanza 99" });
        const editado = await guardar(e, {
          borradorId: id,
          versionEsperada: creada.valor.version,
          cambios: {},
          domicilio: nuevoDomicilio,
        });
        expect(editado.ok).toBe(true);
        if (!editado.ok) return;
        const c = await confirmar(e, id, editado.valor.version, {
          vigenteDesde: MANANA,
          motivo: "Mudanza",
        });
        expect(c).toMatchObject({ ok: true, valor: { numero: 2, yaEstaba: false } });
        const [v1, v2] = await versiones(e.mundo.emisor);
        expect(v1).toMatchObject({ id: idConfirmada, numero: 1, razon_social: "Coop Pampa SA" });
        expect(v2).toMatchObject({
          id,
          numero: 2,
          estado: "CONFIRMADA",
          razon_social: "Coop Pampa SA",
          domicilio_fiscal_id: nuevoDomicilio.id,
        });
        expect(v1?.domicilio_fiscal_id).not.toBe(v2?.domicilio_fiscal_id);
      });
    });

    // ===============================================================================================
    describe("repetir y el borrador que ya existe", () => {
      it("repetir el mismo pedido: «ya estaba», el mismo borrador y NADA más (sin escribir ni auditar)", async () => {
        const { e } = await conVigente();
        const id = nuevoUuid();
        const primera = await empezar(e, { borradorId: id });
        if (!primera.ok) throw new Error("no empezó");
        const antes = await foto(e.mundo.empresa);
        const repetida = await empezar(e, { borradorId: id });
        expect(repetida).toMatchObject({
          ok: true,
          valor: { borradorId: id, version: primera.valor.version, yaEstaba: true },
        });
        expect(await foto(e.mundo.empresa)).toEqual(antes);
      });

      it("si YA hay un borrador del emisor (otra pestaña, con otra clave), devuelve ESE: no falla, no crea otro y no pisa lo editado", async () => {
        const { e } = await conVigente();
        const deLaPrimeraPestana = nuevoUuid();
        const alta = await empezar(e, { borradorId: deLaPrimeraPestana });
        if (!alta.ok) throw new Error("no empezó");
        const editado = await guardar(e, {
          borradorId: deLaPrimeraPestana,
          versionEsperada: alta.valor.version,
          cambios: { razonSocial: "Editada SA" },
          domicilio: undefined,
        });
        if (!editado.ok) throw new Error("no se editó");
        const antes = await foto(e.mundo.empresa);

        const deLaSegunda = await empezar(e, { borradorId: nuevoUuid() });
        expect(deLaSegunda).toMatchObject({
          ok: true,
          valor: { borradorId: deLaPrimeraPestana, version: editado.valor.version, yaEstaba: true },
        });
        expect(await foto(e.mundo.empresa)).toEqual(antes);
        expect(await versiones(e.mundo.emisor)).toHaveLength(2);
      });

      it("si el borrador existente es de una primera alta (sin versión vigente), lo devuelve igual", async () => {
        const e = await nuevo();
        const alta = await guardar(e, { borradorId: nuevoUuid() });
        if (!alta.ok) throw new Error("no se guardó");
        const r = await empezar(e);
        expect(r).toMatchObject({
          ok: true,
          valor: { borradorId: alta.valor.borradorId, yaEstaba: true },
        });
      });

      it("sin ninguna versión que rija (nada confirmado, o solo una que rige mañana): SIN_DATOS_FISCALES_VIGENTES y nada se escribe", async () => {
        const vacia = await nuevo();
        const antesVacia = await foto(vacia.mundo.empresa);
        expect(await empezar(vacia)).toEqual({ ok: false, error: "SIN_DATOS_FISCALES_VIGENTES" });
        expect(await foto(vacia.mundo.empresa)).toEqual(antesVacia);

        const futura = await nuevo();
        const id = nuevoUuid();
        const alta = await guardar(futura, { borradorId: id });
        if (!alta.ok) throw new Error("no se guardó");
        expect((await confirmar(futura, id, alta.valor.version, { vigenteDesde: MANANA })).ok).toBe(
          true,
        );
        const antes = await foto(futura.mundo.empresa);
        expect(await empezar(futura, {}, AHORA)).toEqual({
          ok: false,
          error: "SIN_DATOS_FISCALES_VIGENTES",
        });
        expect(await foto(futura.mundo.empresa)).toEqual(antes);
      });

      it("un id mal armado es ID_INVALIDO; el id de una versión ya confirmada de esta empresa es VERSION_CONFIRMADA_INMUTABLE; nada se escribe", async () => {
        const { e, idConfirmada } = await conVigente();
        const antes = await foto(e.mundo.empresa);
        expect(await empezar(e, { borradorId: "no-es-uuid" })).toEqual({
          ok: false,
          error: "ID_INVALIDO",
        });
        expect(await empezar(e, { borradorId: idConfirmada })).toEqual({
          ok: false,
          error: "VERSION_CONFIRMADA_INMUTABLE",
        });
        expect(await foto(e.mundo.empresa)).toEqual(antes);
      });
    });

    // ===============================================================================================
    describe("quién puede", () => {
      it.each(["ADMINISTRADOR", "OPERADOR"] as const)(
        "un %s no puede empezar una corrección: SIN_PERMISO y no cambia NADA (ni siquiera ve si hay borrador)",
        async (rol) => {
          const { e } = await conVigente();
          const otro = await otraPersona(dueno, e, rol);
          const antes = await foto(e.mundo.empresa);
          expect(await empezar(otro)).toEqual({ ok: false, error: "SIN_PERMISO" });
          // Con un borrador ya creado por el gerente, tampoco se lo devuelve.
          expect((await empezar(e)).ok).toBe(true);
          const conBorrador = await foto(e.mundo.empresa);
          expect(await empezar(otro)).toEqual({ ok: false, error: "SIN_PERMISO" });
          expect(await foto(e.mundo.empresa)).toEqual(conBorrador);
          expect(conBorrador).not.toEqual(antes);
        },
      );
    });

    // ===============================================================================================
    describe("aislamiento entre empresas", () => {
      it("el emisor de otra empresa no existe: EMISOR_NO_ENCONTRADO, y la otra no se toca", async () => {
        const a = await conVigente();
        const b = await conVigente();
        const antesA = await foto(a.e.mundo.empresa);
        const antesB = await foto(b.e.mundo.empresa);
        expect(
          await casos.empezarCorreccionDeDatosFiscales(b.e.como(MANANA), {
            emisorId: emisorId(a.e.mundo.emisor),
            borradorId: nuevoUuid(),
          }),
        ).toEqual({ ok: false, error: "EMISOR_NO_ENCONTRADO" });
        expect(await foto(a.e.mundo.empresa)).toEqual(antesA);
        expect(await foto(b.e.mundo.empresa)).toEqual(antesB);
      });

      it("el `borradorId` de OTRA empresa, sea de un borrador o de una versión confirmada, no se puede tomar: ID_EN_USO, y la ajena queda intacta", async () => {
        const a = await conVigente();
        // A tiene una versión confirmada (la 1) y además un borrador de corrección en curso.
        const borradorDeA = nuevoUuid();
        expect((await empezar(a.e, { borradorId: borradorDeA })).ok).toBe(true);
        const b = await conVigente();
        const antesA = await foto(a.e.mundo.empresa);
        const antesB = await foto(b.e.mundo.empresa);
        for (const ajeno of [a.idConfirmada, borradorDeA]) {
          expect(await empezar(b.e, { borradorId: ajeno }), ajeno).toEqual({
            ok: false,
            error: "ID_EN_USO",
          });
        }
        expect(await foto(a.e.mundo.empresa)).toEqual(antesA);
        expect(await foto(b.e.mundo.empresa)).toEqual(antesB);
        // Y sin el id ajeno, B sí puede.
        expect((await empezar(b.e)).ok).toBe(true);
      });

      it("el borrador de otra empresa no se le devuelve a quien no es de ella", async () => {
        const a = await conVigente();
        const borradorDeA = nuevoUuid();
        expect((await empezar(a.e, { borradorId: borradorDeA })).ok).toBe(true);
        const b = await conVigente();
        const deB = await empezar(b.e);
        expect(deB).toMatchObject({ ok: true, valor: { yaEstaba: false } });
        expect(deB.ok && deB.valor.borradorId).not.toBe(borradorDeA);
      });

      it("el `borradorId` de una versión CONFIRMADA ajena tampoco sirve para guardar ni para confirmar desde otra empresa", async () => {
        const a = await conVigente();
        const b = await conVigente();
        const antesA = await foto(a.e.mundo.empresa);
        const antesB = await foto(b.e.mundo.empresa);
        // Guardar con el id de la confirmada de A, estando B sin borrador: el id ya es de otra empresa.
        expect(
          await casos.guardarBorradorDeDatosFiscales(b.e.como(MANANA), {
            emisorId: emisorId(b.e.mundo.emisor),
            borradorId: a.idConfirmada,
            cambios: { razonSocial: "Robada SA" },
          }),
        ).toEqual({ ok: false, error: "ID_EN_USO" });
        // Confirmar con el id de la confirmada de A: para B no existe.
        expect(
          await casos.confirmarDatosFiscales(b.e.como(MANANA), {
            emisorId: emisorId(b.e.mundo.emisor),
            borradorId: a.idConfirmada,
            versionEsperada: 1,
            vigenteDesde: MANANA,
            motivo: "Robo",
          }),
        ).toEqual({ ok: false, error: "DATOS_FISCALES_NO_ENCONTRADOS" });
        // Y con el emisor de A (que B no ve): el emisor no existe.
        expect(
          await casos.confirmarDatosFiscales(b.e.como(MANANA), {
            emisorId: emisorId(a.e.mundo.emisor),
            borradorId: a.idConfirmada,
            versionEsperada: 1,
            vigenteDesde: MANANA,
            motivo: "Robo",
          }),
        ).toEqual({ ok: false, error: "EMISOR_NO_ENCONTRADO" });
        expect(await foto(a.e.mundo.empresa)).toEqual(antesA);
        expect(await foto(b.e.mundo.empresa)).toEqual(antesB);
      });

      it("el `domicilio.id` de otra empresa no se puede usar ni como existente ni como nuevo (datos fiscales y punto de venta), y no cambia nada", async () => {
        const a = await conVigente();
        const b = await nuevo();
        const [deA] = await versiones(a.e.mundo.emisor);
        const domicilioAjeno = deA?.domicilio_fiscal_id as string;
        // A tiene un punto de venta con domicilio propio, para probar también ese camino.
        const pvDeA = nuevoUuid();
        const domicilioPvDeA = domicilioNuevo();
        expect(
          (
            await casos.crearPuntoDeVenta(a.e.como(MANANA), {
              id: pvDeA,
              emisorId: emisorId(a.e.mundo.emisor),
              sucursalId: a.e.mundo.sucursal as never,
              numero: 7,
              domicilio: domicilioPvDeA,
            })
          ).ok,
        ).toBe(true);
        const antesA = await foto(a.e.mundo.empresa);
        const antesB = await foto(b.mundo.empresa);

        const guardarCon = (domicilio: NonNullable<Parameters<typeof guardar>[1]>["domicilio"]) =>
          guardar(b, { domicilio });
        // Existente de otra empresa: no existe para B.
        expect(await guardarCon({ tipo: "EXISTENTE", id: domicilioId(domicilioAjeno) })).toEqual({
          ok: false,
          error: "DOMICILIO_NO_ENCONTRADO",
        });
        // Nuevo con el id de uno ajeno: el id ya está tomado (aunque el contenido fuera el mismo, no es una repetición de B).
        for (const ajeno of [domicilioAjeno, domicilioPvDeA.id]) {
          expect(
            await guardarCon({ ...domicilioNuevo({}, ajeno) }),
            `nuevo con id ajeno ${ajeno}`,
          ).toEqual({ ok: false, error: "ID_EN_USO" });
        }
        // Lo mismo al crear un punto de venta de B.
        const sucursalDeB = b.mundo.sucursal as never;
        for (const domicilio of [
          { tipo: "EXISTENTE", id: domicilioId(domicilioAjeno) } as const,
          domicilioNuevo({}, domicilioAjeno),
        ]) {
          const r = await casos.crearPuntoDeVenta(b.como(MANANA), {
            id: nuevoUuid(),
            emisorId: emisorId(b.mundo.emisor),
            sucursalId: sucursalDeB,
            numero: 1,
            domicilio,
          });
          expect(r, domicilio.tipo).toEqual({
            ok: false,
            error: domicilio.tipo === "EXISTENTE" ? "DOMICILIO_NO_ENCONTRADO" : "ID_EN_USO",
          });
        }
        // El `puntoDeVentaId` de A, al crear desde B: ya es de otra empresa.
        expect(
          await casos.crearPuntoDeVenta(b.como(MANANA), {
            id: pvDeA,
            emisorId: emisorId(b.mundo.emisor),
            sucursalId: sucursalDeB,
            numero: 1,
          }),
        ).toEqual({ ok: false, error: "ID_EN_USO" });
        // Y editar el punto de venta de A desde B con un domicilio de A: el punto de venta no existe para B.
        expect(
          await casos.editarPuntoDeVenta(b.como(MANANA), {
            puntoDeVentaId: puntoDeVentaId(pvDeA),
            versionEsperada: 1,
            domicilio: { tipo: "EXISTENTE", id: domicilioId(domicilioAjeno) },
          }),
        ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_NO_ENCONTRADO" });

        expect(await foto(a.e.mundo.empresa)).toEqual(antesA);
        expect(await foto(b.mundo.empresa)).toEqual(antesB);
      });
    });

    // ===============================================================================================
    describe("atomicidad", () => {
      it("si la auditoría falla después de escribir, no queda el borrador; sin la falla, el mismo pedido entra", async () => {
        const { e } = await conVigente();
        const antes = await foto(e.mundo.empresa);
        const id = nuevoUuid();
        fallaDeAuditoria = "se cayó la auditoría";
        try {
          await expect(empezar(e, { borradorId: id })).rejects.toThrow("se cayó la auditoría");
        } finally {
          fallaDeAuditoria = null;
        }
        expect(await foto(e.mundo.empresa)).toEqual(antes);
        expect((await empezar(e, { borradorId: id })).ok).toBe(true);
      });
    });

    // ===============================================================================================
    describe("concurrencia", () => {
      it("varias pestañas empiezan a la vez con claves distintas: se crea UN borrador, todas reciben ESE y hay UNA auditoría", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const { e } = await conVigente();
          const auditoriasAntes = await auditorias(e.mundo.empresa);
          const rs = await enParalelo("datos.obtenerBorrador", 4, () => empezar(e));
          for (const r of rs)
            expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
          const borradores = (await versiones(e.mundo.emisor)).filter(
            (v) => v.estado === "BORRADOR",
          );
          expect(borradores, `ronda ${ronda}`).toHaveLength(1);
          const exitosas = rs.filter((r) => r.ok);
          expect(exitosas.length).toBeGreaterThan(0);
          for (const r of exitosas) {
            expect(r.ok && r.valor).toMatchObject({ borradorId: borradores[0]?.id, version: 1 });
          }
          expect(
            exitosas.filter((r) => r.ok && !r.valor.yaEstaba),
            `ronda ${ronda}`,
          ).toHaveLength(1);
          expect(await auditorias(e.mundo.empresa)).toBe(auditoriasAntes + 1);
        }
      });

      it("el doble clic (la misma clave varias veces a la vez): todas ok, UN borrador y UNA auditoría", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const { e } = await conVigente();
          const auditoriasAntes = await auditorias(e.mundo.empresa);
          const id = nuevoUuid();
          const rs = await enParalelo("datos.obtenerBorrador", 4, () =>
            empezar(e, { borradorId: id }),
          );
          for (const r of rs)
            expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
          expect(
            (await versiones(e.mundo.emisor)).filter((v) => v.estado === "BORRADOR"),
            `ronda ${ronda}`,
          ).toHaveLength(1);
          for (const r of rs) if (r.ok) expect(r.valor.borradorId).toBe(id);
          expect(await auditorias(e.mundo.empresa)).toBe(auditoriasAntes + 1);
        }
      });

      it("una confirma mientras otra edita el borrador de la corrección: o se confirma lo que la persona vio, o se edita; nunca las dos cosas", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const { e } = await conVigente();
          const id = nuevoUuid();
          const creada = await empezar(e, { borradorId: id });
          if (!creada.ok) throw new Error("no empezó");
          const [confirmacion, edicion] = (await enParalelo<Cualquiera>(
            ["datos.obtener", "datos.obtenerBorrador"],
            2,
            (i) =>
              i === 0
                ? confirmar(e, id, creada.valor.version, {
                    vigenteDesde: MANANA,
                    motivo: "Corrección",
                  })
                : guardar(e, {
                    borradorId: id,
                    versionEsperada: creada.valor.version,
                    cambios: { razonSocial: "Editada a la vez SA" },
                    domicilio: undefined,
                  }),
          )) as [Cualquiera, Cualquiera];
          const [fila] = await filas<{ estado: string; razon_social: string; version: number }>(
            "select estado, razon_social, version from datos_fiscales where id = $1",
            [id],
          );
          if (codigoDe(confirmacion) === "ok") {
            expect(fila?.estado, `ronda ${ronda}`).toBe("CONFIRMADA");
            expect(fila?.razon_social).toBe("Coop Pampa SA");
            expect(["VERSION_CONFIRMADA_INMUTABLE", "ConcurrenciaAgotada"]).toContain(
              codigoDe(edicion),
            );
          } else {
            expect(["VERSION_DESACTUALIZADA", "ConcurrenciaAgotada"]).toContain(
              codigoDe(confirmacion),
            );
            expect(fila?.estado, `ronda ${ronda}`).toBe("BORRADOR");
            if (codigoDe(edicion) === "ok") {
              expect(fila).toMatchObject({ razon_social: "Editada a la vez SA", version: 2 });
            }
          }
        }
      });

      it("empezar mientras otra pestaña confirma el borrador existente: o devuelve ese (aún borrador) o crea el siguiente desde la nueva vigente; nunca dos borradores", async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const { e } = await conVigente();
          const id = nuevoUuid();
          const creada = await empezar(e, { borradorId: id });
          if (!creada.ok) throw new Error("no empezó");
          const rs = await enParalelo<Cualquiera>(
            ["datos.obtener", "datos.obtenerBorrador"],
            2,
            (i) =>
              i === 0
                ? confirmar(e, id, creada.valor.version, {
                    vigenteDesde: MANANA,
                    motivo: "Corrección",
                  })
                : empezar(e, {}, new Date(MANANA.getTime() + 1000)),
          );
          for (const r of rs)
            expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
          const todas = await versiones(e.mundo.emisor);
          expect(
            todas.filter((v) => v.estado === "BORRADOR").length,
            `ronda ${ronda}`,
          ).toBeLessThanOrEqual(1);
          // Los números de las confirmadas no se repiten ni se saltean.
          const numeros = todas.filter((v) => v.estado === "CONFIRMADA").map((v) => v.numero);
          expect(numeros).toEqual(Array.from({ length: numeros.length }, (_, i) => i + 1));
        }
      });
    });
  },
);
