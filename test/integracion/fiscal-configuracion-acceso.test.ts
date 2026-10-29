import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { domicilioId, puntoDeVentaId } from "../../src/modulos/fiscal/publico";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { emisorId, empresaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { err } from "../../src/primitivas/resultado/resultado";
import { crearBaseAparte } from "./entorno";
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
 * H7 T5: quién puede configurar lo fiscal y sobre qué. Con el catálogo REAL (la facturación sigue en desarrollo): solo
 * el gerente; el administrador, el operador y quien no es de la empresa reciben `SIN_PERMISO` y NADA cambia en la
 * base; una empresa que no opera (en alta, suspendida, cancelada, tenant suspendido) no configura; y una empresa no ve
 * ni toca lo fiscal de otra, sea del mismo tenant o de otro.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = new Date("2026-10-11T12:00:00Z");
const DIA = 86_400_000;

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("fiscal T5: permisos, estado de la empresa y aislamiento", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeConfiguracion>;
  let casos: ReturnType<typeof casosDeConfiguracion>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeConfiguracion(propia.base, 8);
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

  /** Todo lo fiscal que una empresa tiene, en una sola foto para comparar antes y después. */
  async function foto(empresa: string) {
    return {
      datos: await filas(
        `select id, estado, version, razon_social, numero from datos_fiscales where empresa_id = $1 order by id`,
        [empresa],
      ),
      reglas: await filas(
        `select id, estado, version, numero from regla_emisor where empresa_id = $1 order by id`,
        [empresa],
      ),
      puntos: await filas(
        `select id, estado, version, numero, sucursal_id, domicilio_id from punto_de_venta
          where empresa_id = $1 order by id`,
        [empresa],
      ),
      domicilios: await filas("select id from domicilio where empresa_id = $1 order by id", [
        empresa,
      ]),
      auditoria: await filas("select id from auditoria_empresa where empresa_id = $1 order by id", [
        empresa,
      ]),
    };
  }

  /** Una empresa con un borrador de datos fiscales y un punto de venta, armados por su gerente. */
  async function conConfiguracion(
    opciones: Parameters<typeof crearEscenarioDeConfiguracion>[1] = {},
  ) {
    const e = await crearEscenarioDeConfiguracion(dueno, opciones);
    const borradorId = nuevoUuid();
    const borrador = await casos.guardarBorradorDeDatosFiscales(e.como(), {
      emisorId: emisorId(e.mundo.emisor),
      borradorId,
      cambios: {
        razonSocial: "Coop Pampa SA",
        condicionIva: "RESPONSABLE_INSCRIPTO",
        inicioActividades: "2020-03-01",
      },
      domicilio: domicilioNuevo(),
    });
    const pv = nuevoUuid();
    const punto = await casos.crearPuntoDeVenta(e.como(), {
      id: pv,
      emisorId: emisorId(e.mundo.emisor),
      sucursalId: sucursalId(e.mundo.sucursal),
      numero: 1,
      domicilio: domicilioNuevo(),
    });
    if (!borrador.ok || !punto.ok) throw new Error("no se armó la configuración del escenario");
    return {
      e,
      borradorId,
      versionDelBorrador: borrador.valor.version,
      pv,
      versionDelPv: punto.valor.version,
    };
  }

  /** Los ocho casos de uso, cada uno con un pedido que SERÍA válido para el gerente de `c`. */
  function llamadasSobre(
    c: Awaited<ReturnType<typeof conConfiguracion>>,
    quien: EscenarioDeConfiguracion,
  ) {
    const contexto = quien.como();
    const emisor = emisorId(c.e.mundo.emisor);
    return {
      guardarBorradorDeDatosFiscales: () =>
        casos.guardarBorradorDeDatosFiscales(contexto, {
          emisorId: emisor,
          borradorId: c.borradorId,
          versionEsperada: c.versionDelBorrador,
          cambios: { razonSocial: "Cambiada SA" },
        }),
      empezarCorreccionDeDatosFiscales: () =>
        casos.empezarCorreccionDeDatosFiscales(contexto, {
          emisorId: emisor,
          borradorId: nuevoUuid(),
        }),
      confirmarDatosFiscales: () =>
        casos.confirmarDatosFiscales(contexto, {
          emisorId: emisor,
          borradorId: c.borradorId,
          versionEsperada: c.versionDelBorrador,
          vigenteDesde: new Date(AHORA.getTime() + DIA),
          motivo: "Alta",
        }),
      crearPuntoDeVenta: () =>
        casos.crearPuntoDeVenta(contexto, {
          id: nuevoUuid(),
          emisorId: emisor,
          sucursalId: sucursalId(c.e.mundo.sucursal),
          numero: 2,
        }),
      editarPuntoDeVenta: () =>
        casos.editarPuntoDeVenta(contexto, {
          puntoDeVentaId: puntoDeVentaId(c.pv),
          versionEsperada: c.versionDelPv,
          numero: 3,
        }),
      activarPuntoDeVenta: () =>
        casos.activarPuntoDeVenta(contexto, { puntoDeVentaId: puntoDeVentaId(c.pv) }),
      desactivarPuntoDeVenta: () =>
        casos.desactivarPuntoDeVenta(contexto, { puntoDeVentaId: puntoDeVentaId(c.pv) }),
      confirmarReglaDeEmisor: () =>
        casos.confirmarReglaDeEmisor(contexto, {
          versionId: nuevoUuid(),
          permitirEleccionManual: false,
          vigenteDesde: new Date(AHORA.getTime() + DIA),
          motivo: "Cambio",
        }),
    };
  }
  const NOMBRES = [
    "guardarBorradorDeDatosFiscales",
    "empezarCorreccionDeDatosFiscales",
    "confirmarDatosFiscales",
    "crearPuntoDeVenta",
    "editarPuntoDeVenta",
    "activarPuntoDeVenta",
    "desactivarPuntoDeVenta",
    "confirmarReglaDeEmisor",
  ] as const;

  describe("permisos", () => {
    it("la facturación sigue en desarrollo y aun así el gerente configura: las ocho acciones son de administracion", async () => {
      expect(REGLAS_DE_EMPRESA.catalogo.facturacion.estado).toBe("en_desarrollo");
      const c = await conConfiguracion();
      const llamadas = llamadasSobre(c, c.e);
      expect((await llamadas.empezarCorreccionDeDatosFiscales()).ok).toBe(true);
      expect((await llamadas.confirmarDatosFiscales()).ok).toBe(true);
      expect((await llamadas.activarPuntoDeVenta()).ok).toBe(true);
      expect((await llamadas.confirmarReglaDeEmisor()).ok).toBe(true);
    });

    it.each(["ADMINISTRADOR", "OPERADOR"] as const)(
      "un %s no puede ninguno de los ocho: SIN_PERMISO y no cambia NADA en la base",
      async (rol) => {
        const c = await conConfiguracion();
        const otro = await otraPersona(dueno, c.e, rol);
        const llamadas = llamadasSobre(c, otro);
        const antes = await foto(c.e.mundo.empresa);
        for (const nombre of NOMBRES) {
          expect(await llamadas[nombre](), `${rol} ${nombre}`).toEqual(err("SIN_PERMISO"));
        }
        expect(await foto(c.e.mundo.empresa)).toEqual(antes);
      },
    );

    it("quien no tiene membresía en la empresa, o la tiene apagada, no puede ninguno", async () => {
      const c = await conConfiguracion();
      const ajena = await crearEscenarioDeConfiguracion(dueno);
      const apagada = await otraPersona(dueno, c.e, "ADMINISTRADOR");
      await dueno.query("update membresia set activo = false where persona_id = $1", [
        apagada.persona,
      ]);
      const antes = await foto(c.e.mundo.empresa);
      // El gerente de OTRA empresa, con el contexto de esta (no es de ella), y el gerente apagado.
      const sinMembresia: EscenarioDeConfiguracion = {
        mundo: c.e.mundo,
        persona: ajena.persona,
        como: (ahora) => ({
          ...c.e.como(ahora),
          personaId: ajena.como().personaId,
        }),
      };
      for (const quien of [sinMembresia, apagada]) {
        const llamadas = llamadasSobre(c, quien);
        for (const nombre of NOMBRES) {
          expect(await llamadas[nombre](), nombre).toEqual(err("SIN_PERMISO"));
        }
      }
      expect(await foto(c.e.mundo.empresa)).toEqual(antes);
    });
  });

  describe("estado de la empresa", () => {
    it.each([
      ["PROVISIONING", "EMPRESA_EN_ALTA"],
      ["SUSPENDED", "EMPRESA_SUSPENDIDA"],
      ["CANCELLED", "EMPRESA_CANCELADA"],
      ["DELETING", "EMPRESA_EN_BAJA"],
    ] as const)(
      "una empresa %s no configura nada: EMPRESA_NO_OPERA (%s) y no cambia la base",
      async (estado, motivo) => {
        // Una empresa suspendida pasó por ACTIVE y tiene su configuración; las que nacen en otro estado (en alta,
        // cancelada, en baja) no pueden haber pasado por ACTIVE desde la base, así que nacen así y las llamadas
        // usan ids que no existen: el estado se mira antes que cualquier otra cosa.
        const c =
          estado === "SUSPENDED"
            ? await conConfiguracion()
            : {
                e: await crearEscenarioDeConfiguracion(dueno, { estado }),
                borradorId: nuevoUuid(),
                versionDelBorrador: 1,
                pv: nuevoUuid(),
                versionDelPv: 1,
              };
        if (estado === "SUSPENDED") {
          await dueno.query(
            "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [c.e.mundo.empresa],
          );
        }
        const antes = await foto(c.e.mundo.empresa);
        const llamadas = llamadasSobre(c, c.e);
        for (const nombre of NOMBRES) {
          expect(await llamadas[nombre](), nombre).toEqual(
            err({ codigo: "EMPRESA_NO_OPERA", empresaId: empresaId(c.e.mundo.empresa), motivo }),
          );
        }
        expect(await foto(c.e.mundo.empresa)).toEqual(antes);
      },
    );

    it("con el tenant suspendido la empresa tampoco configura (TENANT_SUSPENDIDO)", async () => {
      const c = await conConfiguracion();
      await dueno.query(
        "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [c.e.mundo.tenant],
      );
      try {
        const antes = await foto(c.e.mundo.empresa);
        const llamadas = llamadasSobre(c, c.e);
        for (const nombre of NOMBRES) {
          expect(await llamadas[nombre](), nombre).toEqual(
            err({
              codigo: "EMPRESA_NO_OPERA",
              empresaId: empresaId(c.e.mundo.empresa),
              motivo: "TENANT_SUSPENDIDO",
            }),
          );
        }
        expect(await foto(c.e.mundo.empresa)).toEqual(antes);
      } finally {
        await dueno.query(
          "update tenant set estado = 'ACTIVE', motivo_estado = null where id = $1",
          [c.e.mundo.tenant],
        );
      }
    });
  });

  describe("aislamiento entre empresas", () => {
    /** B es otra empresa con su propio gerente; `mismoTenant` la pone en el tenant de A. */
    it.each([
      ["del mismo tenant", true],
      ["de otro tenant", false],
    ] as const)(
      "el gerente de una empresa %s no ve ni toca lo fiscal de la otra",
      async (_nombre, mismoTenant) => {
        const a = await conConfiguracion();
        const b = await crearEscenarioDeConfiguracion(
          dueno,
          mismoTenant ? { tenant: a.e.mundo.tenant } : {},
        );
        const antesA = await foto(a.e.mundo.empresa);
        const antesB = await foto(b.mundo.empresa);

        // El contexto de B con los ids de A.
        const llamadas = llamadasSobre(a, b);
        expect(await llamadas.guardarBorradorDeDatosFiscales()).toEqual(
          err("EMISOR_NO_ENCONTRADO"),
        );
        expect(await llamadas.empezarCorreccionDeDatosFiscales()).toEqual(
          err("EMISOR_NO_ENCONTRADO"),
        );
        expect(await llamadas.confirmarDatosFiscales()).toEqual(err("EMISOR_NO_ENCONTRADO"));
        expect(await llamadas.crearPuntoDeVenta()).toEqual(err("EMISOR_NO_ENCONTRADO"));
        expect(await llamadas.editarPuntoDeVenta()).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
        expect(await llamadas.activarPuntoDeVenta()).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
        expect(await llamadas.desactivarPuntoDeVenta()).toEqual(
          err("PUNTO_DE_VENTA_NO_ENCONTRADO"),
        );

        // El borrador de A, con el emisor de B: tampoco existe para B.
        const conMiEmisor = await casos.confirmarDatosFiscales(b.como(), {
          emisorId: emisorId(b.mundo.emisor),
          borradorId: a.borradorId,
          versionEsperada: a.versionDelBorrador,
          vigenteDesde: new Date(AHORA.getTime() + DIA),
          motivo: "Alta",
        });
        expect(conMiEmisor).toEqual(err("DATOS_FISCALES_NO_ENCONTRADOS"));

        // Un domicilio de A no es de B, y una sucursal de A tampoco.
        const domicilioDeA = (
          await filas<{ id: string }>("select id from domicilio where empresa_id = $1 limit 1", [
            a.e.mundo.empresa,
          ])
        )[0]?.id as string;
        expect(
          await casos.guardarBorradorDeDatosFiscales(b.como(), {
            emisorId: emisorId(b.mundo.emisor),
            borradorId: nuevoUuid(),
            cambios: {},
            domicilio: { tipo: "EXISTENTE", id: domicilioId(domicilioDeA) },
          }),
        ).toEqual(err("DOMICILIO_NO_ENCONTRADO"));
        expect(
          await casos.crearPuntoDeVenta(b.como(), {
            id: nuevoUuid(),
            emisorId: emisorId(b.mundo.emisor),
            sucursalId: sucursalId(a.e.mundo.sucursal),
            numero: 1,
          }),
        ).toEqual(err("SUCURSAL_DE_OTRA_EMPRESA"));
        // El id de un borrador o de un punto de venta de A no se puede tomar desde B.
        expect(
          await casos.guardarBorradorDeDatosFiscales(b.como(), {
            emisorId: emisorId(b.mundo.emisor),
            borradorId: a.borradorId,
            cambios: {},
          }),
        ).toEqual(err("ID_EN_USO"));
        expect(
          await casos.crearPuntoDeVenta(b.como(), {
            id: a.pv,
            emisorId: emisorId(b.mundo.emisor),
            sucursalId: sucursalId(b.mundo.sucursal),
            numero: 1,
          }),
        ).toEqual(err("ID_EN_USO"));

        expect(await foto(a.e.mundo.empresa)).toEqual(antesA);
        expect(await foto(b.mundo.empresa)).toEqual(antesB);
      },
    );

    it("la regla del emisor es de la empresa: confirmar la de una no numera ni cambia la otra", async () => {
      const a = await crearEscenarioDeConfiguracion(dueno);
      const b = await crearEscenarioDeConfiguracion(dueno);
      const pedido = (id: string) => ({
        versionId: id,
        permitirEleccionManual: false,
        vigenteDesde: new Date(AHORA.getTime() + DIA),
        motivo: "Cambio",
      });
      const id = nuevoUuid();
      expect((await casos.confirmarReglaDeEmisor(a.como(), pedido(id))).ok).toBe(true);
      // El mismo id desde B no es una repetición de A: el id ya existe en otra empresa.
      expect(await casos.confirmarReglaDeEmisor(b.como(), pedido(id))).toEqual(err("ID_EN_USO"));
      expect(
        await filas("select count(*)::int as n from regla_emisor where empresa_id = $1", [
          b.mundo.empresa,
        ]),
      ).toEqual([{ n: 0 }]);
      expect(await casos.confirmarReglaDeEmisor(b.como(), pedido(nuevoUuid()))).toMatchObject({
        ok: true,
        valor: { numero: 1, yaEstaba: false },
      });
    });
  });
});
