import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  domicilioId,
  reglaDeEmisorVigente,
  versionId,
  versionVigente,
} from "../../src/modulos/fiscal/publico";
import { emisorId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import type { Dato } from "../../src/puertos/sin-secretos";
import { cuitAlAzar, crearBaseAparte } from "./entorno";
import {
  casosDeConfiguracion,
  crearEntornoDeConfiguracion,
  crearEscenarioDeConfiguracion,
  datosDeDomicilio,
  domicilioNuevo,
  nuevoUuid,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";

/**
 * H7 T5: los casos de uso de datos fiscales (guardar el borrador, confirmar) y de la regla del emisor contra una
 * base real, con el rol limitado de la aplicación y el contexto firmado (el dueño de la base solo arma escenarios y
 * mira). Éxito, repetición, validaciones, versión desactualizada, atomicidad con la auditoría y vigencia. Los
 * permisos y el aislamiento están en `fiscal-configuracion-acceso.test.ts`; las carreras, en
 * `fiscal-configuracion-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = new Date("2026-10-11T12:00:00Z");
const DIA = 86_400_000;
const despues = (dias: number) => new Date(AHORA.getTime() + dias * DIA);

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("fiscal T5: datos fiscales y regla del emisor", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeConfiguracion>;
  /** Con un mensaje, la auditoría falla DESPUÉS de que los demás efectos ya se escribieron (atomicidad). */
  let fallaDeAuditoria: string | null = null;
  let casos: ReturnType<typeof casosDeConfiguracion>;

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
  const borradores = (emisor: string) =>
    filas<{
      id: string;
      estado: string;
      numero: number | null;
      version: number;
      razon_social: string | null;
      condicion_iva: string | null;
      domicilio_fiscal_id: string | null;
      inicio_actividades: string | null;
      iibb_numero: string | null;
      iibb_condicion: string | null;
      vigente_desde: Date | null;
      confirmada_en: Date | null;
      confirmada_por: string | null;
      motivo: string | null;
      creado_por: string;
    }>(
      `select id, estado, numero, version, razon_social, condicion_iva, domicilio_fiscal_id,
              to_char(inicio_actividades, 'YYYY-MM-DD') as inicio_actividades, iibb_numero, iibb_condicion,
              vigente_desde, confirmada_en, confirmada_por, motivo, creado_por
         from datos_fiscales where emisor_id = $1 order by creado_en, id`,
      [emisor],
    );
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

  const nuevo = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR" = "GERENTE") =>
    crearEscenarioDeConfiguracion(dueno, { rol });

  /** Los cambios de un borrador completo y válido. */
  const COMPLETOS = {
    razonSocial: "Coop Pampa SA",
    condicionIva: "RESPONSABLE_INSCRIPTO",
    inicioActividades: "2020-03-01",
  } as const;

  async function guardar(
    e: EscenarioDeConfiguracion,
    extra: Partial<Parameters<typeof casos.guardarBorradorDeDatosFiscales>[1]> = {},
  ) {
    return casos.guardarBorradorDeDatosFiscales(e.como(), {
      emisorId: emisorId(e.mundo.emisor),
      borradorId: nuevoUuid(),
      cambios: COMPLETOS,
      domicilio: domicilioNuevo(),
      ...extra,
    });
  }
  /** Guarda un borrador completo y falla la prueba si no se pudo. */
  async function borradorCompleto(e: EscenarioDeConfiguracion) {
    const borradorId = nuevoUuid();
    const r = await guardar(e, { borradorId });
    if (!r.ok) throw new Error(`no se guardó el borrador: ${JSON.stringify(r.error)}`);
    return { borradorId, version: r.valor.version };
  }
  const confirmar = (
    e: EscenarioDeConfiguracion,
    borradorId: string,
    version: number,
    extra: Partial<Parameters<typeof casos.confirmarDatosFiscales>[1]> = {},
  ) =>
    casos.confirmarDatosFiscales(e.como(), {
      emisorId: emisorId(e.mundo.emisor),
      borradorId,
      versionEsperada: version,
      vigenteDesde: despues(0),
      motivo: "Alta de la empresa",
      ...extra,
    });

  // ===============================================================================================
  describe("guardarBorradorDeDatosFiscales", () => {
    it("el gerente guarda un borrador con su domicilio nuevo: queda en BORRADOR, con el domicilio y una auditoría", async () => {
      const e = await nuevo();
      const borradorId = nuevoUuid();
      const domicilio = domicilioNuevo({ calle: "San Martín", numero: "S/N" });
      const r = await guardar(e, {
        borradorId,
        domicilio,
        cambios: { ...COMPLETOS, iibbNumero: "901-123456-7", iibbCondicion: "LOCAL" },
      });
      expect(r).toEqual(ok({ borradorId, version: 1, yaEstaba: false }));

      const [b, ...otros] = await borradores(e.mundo.emisor);
      expect(otros).toEqual([]);
      expect(b).toMatchObject({
        id: borradorId,
        estado: "BORRADOR",
        numero: null,
        version: 1,
        razon_social: "Coop Pampa SA",
        condicion_iva: "RESPONSABLE_INSCRIPTO",
        domicilio_fiscal_id: domicilio.id,
        inicio_actividades: "2020-03-01",
        iibb_numero: "901-123456-7",
        iibb_condicion: "LOCAL",
        confirmada_por: null,
        creado_por: e.persona,
      });
      expect(
        await filas("select calle, numero, localidad, provincia from domicilio where id = $1", [
          domicilio.id,
        ]),
      ).toEqual([{ calle: "San Martín", numero: "S/N", localidad: "Rosario", provincia: "AR-S" }]);
      const auditoria = await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor: e.persona, entidad_id: borradorId, antes: null });
      expect(auditoria[0]?.despues).toMatchObject({
        emisorId: e.mundo.emisor,
        razonSocial: "Coop Pampa SA",
        condicionIva: "RESPONSABLE_INSCRIPTO",
        domicilioFiscalId: domicilio.id,
        inicioActividades: "2020-03-01",
        iibbNumero: "901-123456-7",
        iibbCondicion: "LOCAL",
      });
    });

    it("un borrador puede quedar incompleto: solo se pide lo obligatorio al confirmar", async () => {
      const e = await nuevo();
      const r = await guardar(e, {
        cambios: { razonSocial: "  Coop Pampa SA  " },
        domicilio: undefined,
      });
      expect(r.ok).toBe(true);
      const [b] = await borradores(e.mundo.emisor);
      expect(b).toMatchObject({
        razon_social: "Coop Pampa SA",
        condicion_iva: null,
        domicilio_fiscal_id: null,
        inicio_actividades: null,
      });
    });

    it("repetir el guardado (el doble clic) no escribe ni audita otra vez: «ya estaba» con la misma versión", async () => {
      const e = await nuevo();
      const borradorId = nuevoUuid();
      const domicilio = domicilioNuevo();
      const primero = await guardar(e, { borradorId, domicilio });
      const segundo = await guardar(e, { borradorId, domicilio });
      expect(primero).toEqual(ok({ borradorId, version: 1, yaEstaba: false }));
      expect(segundo).toEqual(ok({ borradorId, version: 1, yaEstaba: true }));
      expect(await borradores(e.mundo.emisor)).toHaveLength(1);
      expect(await domicilios(e.mundo.empresa)).toBe(1);
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toHaveLength(1);
    });

    it("editar un borrador con la versión vigente sube la versión y audita solo lo que cambió", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      const r = await guardar(e, {
        borradorId,
        versionEsperada: version,
        cambios: { razonSocial: "Coop Pampa SRL", iibbNumero: "123" },
        domicilio: undefined,
      });
      expect(r).toEqual(ok({ borradorId, version: 2, yaEstaba: false }));
      const [b] = await borradores(e.mundo.emisor);
      expect(b).toMatchObject({ razon_social: "Coop Pampa SRL", iibb_numero: "123", version: 2 });
      // El resto del borrador no se tocó.
      expect(b).toMatchObject({
        condicion_iva: "RESPONSABLE_INSCRIPTO",
        inicio_actividades: "2020-03-01",
      });
      const auditoria = await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO");
      expect(auditoria).toHaveLength(2);
      expect(auditoria[1]?.antes).toEqual({
        emisorId: e.mundo.emisor,
        razonSocial: "Coop Pampa SA",
        iibbNumero: null,
      });
      expect(auditoria[1]?.despues).toEqual({
        emisorId: e.mundo.emisor,
        razonSocial: "Coop Pampa SRL",
        iibbNumero: "123",
      });
    });

    it("cambiar el domicilio crea otro domicilio (nada se edita) y el borrador pasa a apuntar al nuevo", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      const [antes] = await borradores(e.mundo.emisor);
      const nuevoDomicilio = domicilioNuevo({ calle: "Mitre", numero: "55" });
      const r = await guardar(e, {
        borradorId,
        versionEsperada: version,
        cambios: {},
        domicilio: nuevoDomicilio,
      });
      expect(r.ok).toBe(true);
      const [despuesDelCambio] = await borradores(e.mundo.emisor);
      expect(despuesDelCambio?.domicilio_fiscal_id).toBe(nuevoDomicilio.id);
      expect(await domicilios(e.mundo.empresa)).toBe(2);
      // El primero sigue igual.
      expect(
        (await filas("select calle from domicilio where id = $1", [antes?.domicilio_fiscal_id]))[0],
      ).toEqual({ calle: "Av. Corrientes" });
    });

    it("un domicilio existente de la empresa se puede reusar", async () => {
      const e = await nuevo();
      const primero = await borradorCompleto(e);
      const [b] = await borradores(e.mundo.emisor);
      const r = await guardar(e, {
        borradorId: primero.borradorId,
        versionEsperada: primero.version,
        cambios: { razonSocial: "Otra SA" },
        domicilio: { tipo: "EXISTENTE", id: domicilioId(b?.domicilio_fiscal_id ?? "") },
      });
      expect(r).toEqual(ok({ borradorId: primero.borradorId, version: 2, yaEstaba: false }));
      expect(await domicilios(e.mundo.empresa)).toBe(1);
    });

    it("editar con una versión vieja o sin versión es VERSION_DESACTUALIZADA y no cambia nada", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      await guardar(e, {
        borradorId,
        versionEsperada: version,
        cambios: { razonSocial: "Primera SRL" },
        domicilio: undefined,
      });
      for (const versionEsperada of [version, undefined]) {
        const r = await guardar(e, {
          borradorId,
          versionEsperada,
          cambios: { razonSocial: "Segunda SRL" },
          domicilio: undefined,
        });
        expect(r, `versión ${versionEsperada}`).toEqual(err("VERSION_DESACTUALIZADA"));
      }
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        razon_social: "Primera SRL",
        version: 2,
      });
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toHaveLength(2);
    });

    it("repetir una edición ya aplicada es un éxito aunque la versión esperada haya quedado vieja", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      const pedido = {
        borradorId,
        versionEsperada: version,
        cambios: { razonSocial: "Primera SRL" },
        domicilio: undefined,
      };
      expect(await guardar(e, pedido)).toEqual(ok({ borradorId, version: 2, yaEstaba: false }));
      expect(await guardar(e, pedido)).toEqual(ok({ borradorId, version: 2, yaEstaba: true }));
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toHaveLength(2);
    });

    it("otro borrador con otro id mientras hay uno abierto es YA_HAY_BORRADOR: no se pisa lo del otro, ni deja su domicilio", async () => {
      const e = await nuevo();
      const { borradorId } = await borradorCompleto(e);
      const r = await guardar(e, {
        borradorId: nuevoUuid(),
        cambios: { razonSocial: "Intrusa SA" },
      });
      expect(r).toEqual(err("YA_HAY_BORRADOR"));
      const filasDelEmisor = await borradores(e.mundo.emisor);
      expect(filasDelEmisor).toHaveLength(1);
      expect(filasDelEmisor[0]).toMatchObject({ id: borradorId, razon_social: "Coop Pampa SA" });
      expect(await domicilios(e.mundo.empresa)).toBe(1);
    });

    it("el id de una versión ya confirmada no se reusa: VERSION_CONFIRMADA_INMUTABLE", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      expect((await confirmar(e, borradorId, version)).ok).toBe(true);
      const r = await guardar(e, { borradorId, cambios: { razonSocial: "Cambiada SA" } });
      expect(r).toEqual(err("VERSION_CONFIRMADA_INMUTABLE"));
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        estado: "CONFIRMADA",
        razon_social: "Coop Pampa SA",
      });
    });

    it("después de confirmar se puede empezar un borrador nuevo (la versión siguiente) con otro id", async () => {
      const e = await nuevo();
      const primero = await borradorCompleto(e);
      expect((await confirmar(e, primero.borradorId, primero.version)).ok).toBe(true);
      const segundo = await borradorCompleto(e);
      expect(segundo.borradorId).not.toBe(primero.borradorId);
      expect((await borradores(e.mundo.emisor)).map((b) => b.estado)).toEqual([
        "CONFIRMADA",
        "BORRADOR",
      ]);
    });

    it("el id de un borrador de OTRO emisor de la empresa es ID_EN_USO, no una repetición", async () => {
      const e = await nuevo();
      const secundario = (
        await filas<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [e.mundo.empresa, cuitAlAzar()],
        )
      )[0]?.id as string;
      const { borradorId } = await borradorCompleto(e);
      const r = await casos.guardarBorradorDeDatosFiscales(e.como(), {
        emisorId: emisorId(secundario),
        borradorId,
        cambios: { razonSocial: "Del secundario SA" },
      });
      expect(r).toEqual(err("ID_EN_USO"));
      expect(await borradores(secundario)).toEqual([]);
      // Cada emisor tiene su propio borrador.
      const propio = await casos.guardarBorradorDeDatosFiscales(e.como(), {
        emisorId: emisorId(secundario),
        borradorId: nuevoUuid(),
        cambios: { razonSocial: "Del secundario SA" },
      });
      expect(propio.ok).toBe(true);
      expect(await borradores(secundario)).toHaveLength(1);
    });

    it.each([
      ["razón social vacía", { razonSocial: "   " }, "RAZON_SOCIAL_INVALIDA"],
      ["razón social de más de 200", { razonSocial: "x".repeat(201) }, "RAZON_SOCIAL_INVALIDA"],
      ["razón social con un salto de línea", { razonSocial: "a\nb" }, "RAZON_SOCIAL_INVALIDA"],
      ["condición de IVA desconocida", { condicionIva: "PEPE" }, "CONDICION_IVA_INVALIDA"],
      [
        "inicio de actividades inexistente",
        { inicioActividades: "2026-02-30" },
        "INICIO_DE_ACTIVIDADES_INVALIDO",
      ],
      [
        "inicio de actividades con otro formato",
        { inicioActividades: "01/03/2020" },
        "INICIO_DE_ACTIVIDADES_INVALIDO",
      ],
      ["número de IIBB de más de 30", { iibbNumero: "9".repeat(31) }, "IIBB_NUMERO_INVALIDO"],
      ["condición de IIBB desconocida", { iibbCondicion: "TODOS" }, "IIBB_CONDICION_INVALIDA"],
    ] as const)("%s: %s sin escribir nada", async (_nombre, cambios, error) => {
      const e = await nuevo();
      const r = await guardar(e, { cambios });
      expect(r).toEqual(err(error));
      expect(await borradores(e.mundo.emisor)).toEqual([]);
      expect(await domicilios(e.mundo.empresa)).toBe(0);
      expect(await todasLasAuditorias(e.mundo.empresa)).toBe(0);
    });

    it.each([
      ["calle vacía", { calle: " " }, "CALLE_INVALIDA"],
      ["número con letras", { numero: "12A" }, "NUMERO_INVALIDO"],
      ["piso de más de 20", { piso: "p".repeat(21) }, "PISO_INVALIDO"],
      ["departamento de más de 20", { departamento: "d".repeat(21) }, "DEPARTAMENTO_INVALIDO"],
      ["localidad vacía", { localidad: "" }, "LOCALIDAD_INVALIDA"],
      ["provincia fuera del catálogo", { provincia: "AR-Z9" }, "PROVINCIA_INVALIDA"],
      ["código postal con símbolos", { codigoPostal: "S-20" }, "CODIGO_POSTAL_INVALIDO"],
    ] as const)("domicilio con %s: %s sin escribir nada", async (_nombre, cambios, error) => {
      const e = await nuevo();
      const r = await guardar(e, { domicilio: domicilioNuevo(cambios) });
      expect(r).toEqual(err(error));
      expect(await borradores(e.mundo.emisor)).toEqual([]);
      expect(await domicilios(e.mundo.empresa)).toBe(0);
    });

    it("ids que no son uuid son ID_INVALIDO antes de tocar la base", async () => {
      const e = await nuevo();
      expect(await guardar(e, { borradorId: "no-es-uuid" })).toEqual(err("ID_INVALIDO"));
      expect(
        await guardar(e, {
          domicilio: { tipo: "NUEVO", id: domicilioId("x"), datos: datosDeDomicilio() },
        }),
      ).toEqual(err("ID_INVALIDO"));
      expect(await guardar(e, { domicilio: { tipo: "EXISTENTE", id: domicilioId("x") } })).toEqual(
        err("ID_INVALIDO"),
      );
      expect(await borradores(e.mundo.emisor)).toEqual([]);
    });

    it("un domicilio existente que no es de la empresa (o no existe) es DOMICILIO_NO_ENCONTRADO", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      const ajeno = (
        await filas<{ id: string }>(
          `insert into domicilio (empresa_id, calle, numero, localidad, provincia)
           values ($1, 'Ajena', '1', 'Rosario', 'AR-S') returning id`,
          [otra.mundo.empresa],
        )
      )[0]?.id as string;
      for (const id of [ajeno, nuevoUuid()]) {
        const r = await guardar(e, { domicilio: { tipo: "EXISTENTE", id: domicilioId(id) } });
        expect(r, id).toEqual(err("DOMICILIO_NO_ENCONTRADO"));
      }
      expect(await borradores(e.mundo.emisor)).toEqual([]);
    });

    it("el mismo id de domicilio con otro contenido es ID_EN_USO (un domicilio no se edita) y revierte el resto", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      const [b] = await borradores(e.mundo.emisor);
      const r = await guardar(e, {
        borradorId,
        versionEsperada: version,
        cambios: { razonSocial: "Otra SA" },
        domicilio: domicilioNuevo({ calle: "Otra calle" }, b?.domicilio_fiscal_id ?? ""),
      });
      expect(r).toEqual(err("ID_EN_USO"));
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        razon_social: "Coop Pampa SA",
        version: 1,
      });
    });

    it("un emisor que no existe, o es de otra empresa, es EMISOR_NO_ENCONTRADO", async () => {
      const e = await nuevo();
      const otra = await nuevo();
      for (const emisor of [nuevoUuid(), otra.mundo.emisor]) {
        const r = await casos.guardarBorradorDeDatosFiscales(e.como(), {
          emisorId: emisorId(emisor),
          borradorId: nuevoUuid(),
          cambios: COMPLETOS,
        });
        expect(r, emisor).toEqual(err("EMISOR_NO_ENCONTRADO"));
      }
      expect(await borradores(otra.mundo.emisor)).toEqual([]);
    });

    it("atomicidad: si la auditoría falla después de escribir, no queda ni el domicilio ni el borrador", async () => {
      const e = await nuevo();
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(guardar(e)).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect(await borradores(e.mundo.emisor)).toEqual([]);
      expect(await domicilios(e.mundo.empresa)).toBe(0);
      expect(await todasLasAuditorias(e.mundo.empresa)).toBe(0);
      // Y sin la falla, el mismo pedido entra.
      expect((await guardar(e)).ok).toBe(true);
    });

    it("atomicidad al editar: si la auditoría falla, el borrador y su domicilio nuevo quedan como estaban", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(
          guardar(e, {
            borradorId,
            versionEsperada: version,
            cambios: { razonSocial: "Cambiada SA" },
            domicilio: domicilioNuevo({ calle: "Nueva" }),
          }),
        ).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        razon_social: "Coop Pampa SA",
        version: 1,
      });
      expect(await domicilios(e.mundo.empresa)).toBe(1);
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toHaveLength(1);
    });
  });

  // ===============================================================================================
  describe("confirmarDatosFiscales", () => {
    it("confirma el borrador completo: queda CONFIRMADA e inmutable, con número 1, vigencia, quién y por qué, y una auditoría", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      const vigenteDesde = despues(2);
      const r = await confirmar(e, borradorId, version, {
        vigenteDesde,
        motivo: "  Alta de la empresa  ",
      });
      expect(r).toEqual(
        ok({ borradorId: versionId(borradorId), numero: 1, vigenteDesde, yaEstaba: false }),
      );
      const [c] = await borradores(e.mundo.emisor);
      expect(c).toMatchObject({
        id: borradorId,
        estado: "CONFIRMADA",
        numero: 1,
        razon_social: "Coop Pampa SA",
        confirmada_por: e.persona,
        motivo: "Alta de la empresa",
      });
      expect(c?.vigente_desde?.getTime()).toBe(vigenteDesde.getTime());
      expect(c?.confirmada_en?.getTime()).toBe(AHORA.getTime());
      const auditoria = await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor: e.persona, entidad_id: borradorId });
      expect(auditoria[0]?.antes).toEqual({ estado: "BORRADOR" });
      expect(auditoria[0]?.despues).toMatchObject({
        estado: "CONFIRMADA",
        emisorId: e.mundo.emisor,
        numero: 1,
        razonSocial: "Coop Pampa SA",
        condicionIva: "RESPONSABLE_INSCRIPTO",
        inicioActividades: "2020-03-01",
        vigenteDesde: vigenteDesde.toISOString(),
        motivo: "Alta de la empresa",
      });
    });

    it("confirmar dos veces es «ya estaba»: el mismo número y la misma vigencia, sin otra auditoría", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      const primero = await confirmar(e, borradorId, version, { vigenteDesde: despues(1) });
      // Aunque la repetición traiga otra vigencia u otro motivo, el id identifica lo ya confirmado.
      const segundo = await confirmar(e, borradorId, version, {
        vigenteDesde: despues(5),
        motivo: "Otro motivo",
      });
      expect(primero).toMatchObject({ ok: true, valor: { numero: 1, yaEstaba: false } });
      expect(segundo).toMatchObject({
        ok: true,
        valor: { numero: 1, vigenteDesde: despues(1), yaEstaba: true },
      });
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS")).toHaveLength(1);
      expect(await borradores(e.mundo.emisor)).toHaveLength(1);
    });

    it("versionar: la segunda confirmación es la número 2 y una vigencia futura no pisa la que rige hoy", async () => {
      const e = await nuevo();
      const primero = await borradorCompleto(e);
      await confirmar(e, primero.borradorId, primero.version, { vigenteDesde: despues(0) });
      const segundo = await guardar(e, {
        borradorId: nuevoUuid(),
        cambios: { ...COMPLETOS, razonSocial: "Coop Pampa SRL" },
      });
      if (!segundo.ok) throw new Error(JSON.stringify(segundo.error));
      const r = await confirmar(e, segundo.valor.borradorId, segundo.valor.version, {
        vigenteDesde: despues(30),
        motivo: "Cambio de forma societaria",
      });
      expect(r).toMatchObject({ ok: true, valor: { numero: 2 } });

      const confirmadas = await entorno.ejecutar({ contexto: e.como() }, async (tx) =>
        ok(await tx.datosFiscales.confirmadas(e.como().empresaId, emisorId(e.mundo.emisor))),
      );
      if (!confirmadas.ok) throw new Error("no se pudo leer");
      expect(confirmadas.valor.map((c) => [c.numero, c.razonSocial])).toEqual([
        [1, "Coop Pampa SA"],
        [2, "Coop Pampa SRL"],
      ]);
      // Hoy rige la 1; dentro de 30 días, la 2 (nada se pisa).
      expect(versionVigente(confirmadas.valor, despues(1))?.numero).toBe(1);
      expect(versionVigente(confirmadas.valor, despues(31))?.numero).toBe(2);
    });

    it("un borrador incompleto: DATOS_FISCALES_INCOMPLETOS con lo que falta, sin confirmar", async () => {
      const e = await nuevo();
      const borradorId = nuevoUuid();
      const guardado = await casos.guardarBorradorDeDatosFiscales(e.como(), {
        emisorId: emisorId(e.mundo.emisor),
        borradorId,
        cambios: { inicioActividades: "2020-03-01" },
      });
      if (!guardado.ok) throw new Error("no se guardó");
      const r = await confirmar(e, borradorId, guardado.valor.version);
      expect(r).toEqual(
        err({
          codigo: "DATOS_FISCALES_INCOMPLETOS",
          faltantes: ["razonSocial", "condicionIva", "domicilioFiscalId"],
        }),
      );
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        estado: "BORRADOR",
        numero: null,
      });
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS")).toEqual([]);
    });

    it("motivo vacío, vigencia retroactiva e instante inválido se rechazan y el borrador sigue abierto", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      expect(await confirmar(e, borradorId, version, { motivo: "   " })).toEqual(
        err("MOTIVO_OBLIGATORIO"),
      );
      expect(await confirmar(e, borradorId, version, { vigenteDesde: despues(-1) })).toEqual(
        err("VIGENCIA_RETROACTIVA"),
      );
      expect(
        await confirmar(e, borradorId, version, { vigenteDesde: new Date("no es una fecha") }),
      ).toEqual(err("INSTANTE_INVALIDO"));
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        estado: "BORRADOR",
        numero: null,
      });
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS")).toEqual([]);
    });

    it("un motivo con un salto de línea en el medio lo rechaza la base y llega como MOTIVO_OBLIGATORIO", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      const r = await confirmar(e, borradorId, version, { motivo: "primera línea\nsegunda" });
      expect(r).toEqual(err("MOTIVO_OBLIGATORIO"));
      expect((await borradores(e.mundo.emisor))[0]?.estado).toBe("BORRADOR");
    });

    it("se confirma lo que la persona vio: si el borrador cambió después, VERSION_DESACTUALIZADA", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      await guardar(e, {
        borradorId,
        versionEsperada: version,
        cambios: { razonSocial: "Cambiada por otro SA" },
        domicilio: undefined,
      });
      expect(await confirmar(e, borradorId, version)).toEqual(err("VERSION_DESACTUALIZADA"));
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        estado: "BORRADOR",
        version: 2,
      });
    });

    it("un borrador que no existe, o es de otro emisor, es DATOS_FISCALES_NO_ENCONTRADOS", async () => {
      const e = await nuevo();
      const secundario = (
        await filas<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [e.mundo.empresa, cuitAlAzar()],
        )
      )[0]?.id as string;
      const { borradorId, version } = await borradorCompleto(e);
      expect(await confirmar(e, nuevoUuid(), 1)).toEqual(err("DATOS_FISCALES_NO_ENCONTRADOS"));
      expect(await confirmar(e, borradorId, version, { emisorId: emisorId(secundario) })).toEqual(
        err("DATOS_FISCALES_NO_ENCONTRADOS"),
      );
      expect(await confirmar(e, "no-es-uuid", 1)).toEqual(err("ID_INVALIDO"));
      expect(await confirmar(e, borradorId, version, { emisorId: emisorId(nuevoUuid()) })).toEqual(
        err("EMISOR_NO_ENCONTRADO"),
      );
      expect((await borradores(e.mundo.emisor))[0]?.estado).toBe("BORRADOR");
    });

    it("atomicidad: si la auditoría falla después de confirmar, el borrador sigue abierto y se puede confirmar", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(confirmar(e, borradorId, version)).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect((await borradores(e.mundo.emisor))[0]).toMatchObject({
        estado: "BORRADOR",
        numero: null,
        confirmada_por: null,
        vigente_desde: null,
      });
      expect((await confirmar(e, borradorId, version)).ok).toBe(true);
    });

    it("una versión confirmada no se toca ni por la base: el dueño tampoco puede cambiarla", async () => {
      const e = await nuevo();
      const { borradorId, version } = await borradorCompleto(e);
      await confirmar(e, borradorId, version);
      await expect(
        dueno.query("update datos_fiscales set razon_social = 'X' where id = $1", [borradorId]),
      ).rejects.toThrow(/datos fiscales confirmados no se pueden modificar/);
    });
  });

  // ===============================================================================================
  describe("confirmarReglaDeEmisor", () => {
    const reglas = (empresa: string) =>
      filas<{
        id: string;
        estado: string;
        numero: number | null;
        permitir_eleccion_manual: boolean;
        vigente_desde: Date | null;
        confirmada_por: string | null;
        motivo: string | null;
        creado_por: string;
      }>(
        `select id, estado, numero, permitir_eleccion_manual, vigente_desde, confirmada_por, motivo, creado_por
           from regla_emisor where empresa_id = $1 order by numero nulls last, id`,
        [empresa],
      );
    const regla = (
      e: EscenarioDeConfiguracion,
      extra: Partial<Parameters<typeof casos.confirmarReglaDeEmisor>[1]> = {},
    ) =>
      casos.confirmarReglaDeEmisor(e.como(), {
        versionId: nuevoUuid(),
        permitirEleccionManual: false,
        vigenteDesde: despues(0),
        motivo: "Siempre se factura por el punto de venta",
        ...extra,
      });

    it("confirma la regla en un solo paso: nace CONFIRMADA con número 1, y la auditoría dice qué regía antes", async () => {
      const e = await nuevo();
      const versionIdNueva = nuevoUuid();
      const r = await regla(e, { versionId: versionIdNueva, vigenteDesde: despues(1) });
      expect(r).toEqual(
        ok({
          versionId: versionId(versionIdNueva),
          numero: 1,
          vigenteDesde: despues(1),
          yaEstaba: false,
        }),
      );
      expect(await reglas(e.mundo.empresa)).toEqual([
        {
          id: versionIdNueva,
          estado: "CONFIRMADA",
          numero: 1,
          permitir_eleccion_manual: false,
          vigente_desde: despues(1),
          confirmada_por: e.persona,
          motivo: "Siempre se factura por el punto de venta",
          creado_por: e.persona,
        },
      ]);
      const auditoria = await auditorias(e.mundo.empresa, "REGLA_DE_EMISOR_CONFIRMADA");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor: e.persona, entidad_id: versionIdNueva });
      // Sin versiones, regía la de por defecto: elección manual permitida.
      expect(auditoria[0]?.antes).toEqual({ permitirEleccionManual: true });
      expect(auditoria[0]?.despues).toMatchObject({
        numero: 1,
        permitirEleccionManual: false,
        motivo: "Siempre se factura por el punto de venta",
      });
    });

    it("repetir con el mismo id y lo mismo es «ya estaba» (sin otra fila ni auditoría); con otra decisión, ID_EN_USO", async () => {
      const e = await nuevo();
      const id = nuevoUuid();
      const pedido = { versionId: id, vigenteDesde: despues(1), motivo: "  Un motivo  " };
      expect(await regla(e, pedido)).toMatchObject({
        ok: true,
        valor: { numero: 1, yaEstaba: false },
      });
      expect(await regla(e, pedido)).toMatchObject({
        ok: true,
        valor: { numero: 1, yaEstaba: true },
      });
      for (const otra of [
        { permitirEleccionManual: true },
        { vigenteDesde: despues(2) },
        { motivo: "Otro" },
      ]) {
        expect(await regla(e, { ...pedido, ...otra }), JSON.stringify(otra)).toEqual(
          err("ID_EN_USO"),
        );
      }
      expect(await reglas(e.mundo.empresa)).toHaveLength(1);
      expect(await auditorias(e.mundo.empresa, "REGLA_DE_EMISOR_CONFIRMADA")).toHaveLength(1);
    });

    it("la versión siguiente es la 2 y una vigencia futura no pisa la que rige hoy; la auditoría ve la anterior", async () => {
      const e = await nuevo();
      await regla(e, { permitirEleccionManual: false, vigenteDesde: despues(0) });
      const segunda = await regla(e, { permitirEleccionManual: true, vigenteDesde: despues(10) });
      expect(segunda).toMatchObject({ ok: true, valor: { numero: 2 } });
      const confirmadas = await entorno.ejecutar({ contexto: e.como() }, async (tx) =>
        ok(await tx.reglasDeEmisor.confirmadas(e.como().empresaId)),
      );
      if (!confirmadas.ok) throw new Error("no se pudo leer");
      expect(reglaDeEmisorVigente(confirmadas.valor, despues(1))).toEqual({
        permitirEleccionManual: false,
      });
      expect(reglaDeEmisorVigente(confirmadas.valor, despues(11))).toEqual({
        permitirEleccionManual: true,
      });
      const auditoria = await auditorias(e.mundo.empresa, "REGLA_DE_EMISOR_CONFIRMADA");
      expect(auditoria[1]?.antes).toEqual({ permitirEleccionManual: false });
    });

    it("motivo vacío, vigencia retroactiva, instante inválido e id inválido se rechazan sin dejar ni un borrador", async () => {
      const e = await nuevo();
      expect(await regla(e, { motivo: " " })).toEqual(err("MOTIVO_OBLIGATORIO"));
      expect(await regla(e, { vigenteDesde: despues(-1) })).toEqual(err("VIGENCIA_RETROACTIVA"));
      expect(await regla(e, { vigenteDesde: new Date("x") })).toEqual(err("INSTANTE_INVALIDO"));
      expect(await regla(e, { versionId: "no-es-uuid" })).toEqual(err("ID_INVALIDO"));
      expect(await regla(e, { motivo: "con\nsalto" })).toEqual(err("MOTIVO_OBLIGATORIO"));
      expect(await reglas(e.mundo.empresa)).toEqual([]);
      expect(await todasLasAuditorias(e.mundo.empresa)).toBe(0);
    });

    it("atomicidad: si la auditoría falla, no queda la regla ni su borrador", async () => {
      const e = await nuevo();
      fallaDeAuditoria = "se cayó la auditoría";
      try {
        await expect(regla(e)).rejects.toThrow("se cayó la auditoría");
      } finally {
        fallaDeAuditoria = null;
      }
      expect(await reglas(e.mundo.empresa)).toEqual([]);
      expect((await regla(e)).ok).toBe(true);
    });

    it("cada empresa tiene sus propias versiones: confirmar en una no cambia ni numera la otra", async () => {
      const a = await nuevo();
      const b = await nuevo();
      await regla(a);
      await regla(a);
      await regla(b);
      expect((await reglas(a.mundo.empresa)).map((r) => r.numero)).toEqual([1, 2]);
      expect((await reglas(b.mundo.empresa)).map((r) => r.numero)).toEqual([1]);
    });
  });
});
