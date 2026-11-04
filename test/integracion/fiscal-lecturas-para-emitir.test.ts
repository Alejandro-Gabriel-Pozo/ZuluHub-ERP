import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import type { DependenciasDeFacturacionWeb } from "../../src/composicion/facturacion-web";
import {
  discriminaIvaAlEmitir,
  listarPuntosDeVentaParaEmitir,
} from "../../src/composicion/lecturas-para-emitir-web";
import { armarWeb } from "../../src/composicion/web";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { empresaId, personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearEscenarioDeCasos, type EscenarioDeCasos } from "./facturacion-casos-apoyo";
import { crearMundo, crearPuntoDeVenta } from "./fiscal-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * Las dos lecturas de la pantalla de Emitir (D-86) con la composición REAL (conexiones, web, base de verdad y roles limitados): si la
 * empresa discrimina IVA y los puntos de venta activos de la sucursal. Qué prueba:
 *  1. Aislamiento por empresa y por sucursal: cada empresa ve lo suyo; el operador de «Centro» no ve los puntos de venta de «Norte».
 *  2. Sucursal cerrada: no ofrece puntos de venta para emitir (D-50), aunque sigan activos (D-81).
 *  3. Permisos: la acción es la de emitir una factura; sin membresía, con la membresía apagada o sin persona, nada; con el catálogo
 *     real el módulo sigue en desarrollo.
 *  4. Solo lectura: con el módulo en solo lectura (baja de plan) el guard las rechaza, porque `comprobantes.emitir_manual` CREA_AMPLIA;
 *     y no escriben nada.
 *  5. No filtran de más: solo un sí o un no, y solo identificador, número y ambiente de cada punto de venta.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const FUERA = { ok: false, error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" } };
const NO_ELEGIDA = { ok: false, error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" } };

/**
 * Quien no es de la empresa no pasa el guard. Con la autorización real (sin rol no hay módulos), el guard mira el módulo antes que el
 * rol: sale `MODULO_NO_ACTIVO` y no `SIN_PERMISO`. Los dos son un rechazo sin dato alguno.
 */
const RECHAZADO = {
  ok: false,
  error: { codigo: expect.stringMatching(/^(SIN_PERMISO|MODULO_NO_ACTIVO)$/) as unknown },
};

describe.skipIf(base === null)("las lecturas de Emitir: discrimina IVA y puntos de venta", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let d: DependenciasDeFacturacionWeb;
  let dReales: DependenciasDeFacturacionWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.base.app,
      PEDERNAL_DB_TRABAJOS: propia.base.trabajos,
    };
    conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
    const respuesta = { registrar: (x: string) => registrados.push(x) };
    const web = armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION });
    d = {
      casosDeUso: web.casosDeUsoDeFacturacion,
      consultas: web.consultasDeFacturacion,
      respuesta,
    };
    // El catálogo REAL: la facturación es `disponible`, pero cada empresa tiene que activarla.
    const real = armarWeb(conexiones, { reglas: REGLAS_DE_EMPRESA });
    dReales = {
      casosDeUso: real.casosDeUsoDeFacturacion,
      consultas: real.consultasDeFacturacion,
      respuesta,
    };
  }, 120_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await conexiones.transaccionesDeTrabajos().cerrar();
    await dueno.end();
    await propia.destruir();
  });

  // `ahora` real: los datos fiscales del escenario rigen desde `now()` de la base.
  const ahora = (): Date => new Date(Date.now() + 1000);
  const comoGerente = (e: EscenarioDeCasos) => e.como(ahora());

  /** Una empresa con facturación activada de verdad (módulo activo y en el plan) y un gerente. */
  async function empresa(
    condicionIva?: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO",
    pvNumero?: number,
  ): Promise<EscenarioDeCasos> {
    const e = await crearEscenarioDeCasos(dueno, propia.base, {
      rol: "GERENTE",
      ...(condicionIva === undefined ? {} : { condicionIva }),
      ...(pvNumero === undefined ? {} : { pvNumero }),
    });
    const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
    await asignarPlan(dueno, e.tenant, version);
    await dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [e.empresa],
    );
    return e;
  }

  /** Una empresa con sus datos fiscales y un gerente, pero SIN activar la facturación ni plan que la incluya. */
  async function empresaSinActivar(): Promise<EscenarioDeCasos> {
    return crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
  }

  /** Otra persona de esa empresa con ese rol y esas sucursales asignadas (el operador las necesita). */
  async function persona(
    e: EscenarioDeCasos,
    rol: RolDePrueba,
    asignadas: readonly string[] = [],
  ): Promise<ContextoOperativo> {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, rol);
    for (const s of asignadas) await crearAsignacionDeBase(dueno, e.empresa, p.id, s);
    return { ...comoEmpresa(empresaId(e.empresa), personaId(p.id)), ahora: ahora() };
  }

  async function sucursalNueva(e: EscenarioDeCasos, nombre: string, abierta = true) {
    const id = (
      await dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa, nombre],
      )
    ).rows[0]?.id as string;
    if (!abierta) await dueno.query("update sucursal set activa = false where id = $1", [id]);
    return id;
  }
  const puntoActivoEn = (e: EscenarioDeCasos, sucursal: string, numero: number) =>
    crearPuntoDeVenta(dueno, e, { numero, sucursal, activo: true });
  const idDelPunto = async (e: EscenarioDeCasos, numero: number) =>
    (
      await dueno.query<{ id: string }>(
        "select id from punto_de_venta where empresa_id = $1 and numero = $2",
        [e.empresa, numero],
      )
    ).rows[0]?.id as string;

  const pvs = (
    e: EscenarioDeCasos,
    elegida: string | null,
    ctx: ContextoOperativo = comoGerente(e),
    deps = d,
  ) => listarPuntosDeVentaParaEmitir(deps, ctx, elegida === null ? null : sucursalId(elegida));
  const numeros = async (
    e: EscenarioDeCasos,
    elegida: string | null,
    ctx: ContextoOperativo = comoGerente(e),
  ) => {
    const r = await pvs(e, elegida, ctx);
    if (!r.ok) throw new Error(`no listó: ${JSON.stringify(r.error)}`);
    return r.dato.items.map((i) => i.numero);
  };

  // ===============================================================================================
  // ¿La empresa discrimina IVA?
  // ===============================================================================================
  describe("discrimina IVA", () => {
    it.each([
      ["RESPONSABLE_INSCRIPTO", true],
      ["MONOTRIBUTO", false],
      ["EXENTO", false],
    ] as const)(
      "un emisor %s: discrimina = %s, y la respuesta es solo ese sí o no",
      async (condicion, esperado) => {
        const e = await empresa(condicion);
        expect(await discriminaIvaAlEmitir(d, comoGerente(e))).toEqual({
          ok: true,
          dato: { discriminaIva: esperado },
        });
      },
    );

    it("no filtra datos fiscales: ni el CUIT, ni la razón social, ni el domicilio, ni Ingresos Brutos, ni la condición", async () => {
      const e = await empresa("RESPONSABLE_INSCRIPTO");
      const texto = JSON.stringify(await discriminaIvaAlEmitir(d, comoGerente(e)));
      for (const secreto of [e.cuit, e.razonSocial, "Corrientes", "901-123456-7", "INSCRIPTO"]) {
        expect(texto, secreto).not.toContain(secreto);
      }
    });

    it("aislamiento entre empresas (también del mismo tenant): cada una ve su condición, no la de la otra", async () => {
      const a = await empresa("RESPONSABLE_INSCRIPTO");
      const b = await empresa("MONOTRIBUTO");
      expect(await discriminaIvaAlEmitir(d, comoGerente(a))).toMatchObject({
        dato: { discriminaIva: true },
      });
      expect(await discriminaIvaAlEmitir(d, comoGerente(b))).toMatchObject({
        dato: { discriminaIva: false },
      });
      // El gerente de una no es nadie en la otra: no se entera de su condición.
      const deBenA = { ...comoGerente(b), empresaId: empresaId(a.empresa) };
      expect(await discriminaIvaAlEmitir(d, deBenA)).toMatchObject(RECHAZADO);
    });

    it("lo pueden pedir los tres roles (los que emiten); el operador no necesita datos_fiscales.editar", async () => {
      const e = await empresa("MONOTRIBUTO");
      // El escenario ya trae al gerente (la empresa tiene uno solo); los otros dos roles se suman.
      const contextos = {
        GERENTE: comoGerente(e),
        ADMINISTRADOR: await persona(e, "ADMINISTRADOR"),
        OPERADOR: await persona(e, "OPERADOR", [e.sucursal]),
      };
      for (const [rol, ctx] of Object.entries(contextos)) {
        expect(await discriminaIvaAlEmitir(d, ctx), rol).toEqual({
          ok: true,
          dato: { discriminaIva: false },
        });
      }
    });

    it("sin datos fiscales vigentes (empresa sin datos cargados) responde con el error de siempre de emitir, sin texto nuevo", async () => {
      const m = await crearMundo(dueno);
      await crearMembresiaDeBase(dueno, m.empresa, m.persona, "GERENTE");
      const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
      await asignarPlan(dueno, m.tenant, version);
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
        [m.empresa],
      );
      const ctx = { ...comoEmpresa(empresaId(m.empresa), personaId(m.persona)), ahora: ahora() };
      expect(await discriminaIvaAlEmitir(d, ctx)).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_SIN_DATOS_FISCALES" },
      });
    });

    it("sin membresía, con la membresía apagada o sin persona: rechazado; con el catálogo REAL, activa pasa y sin activar es MODULO_NO_ACTIVO", async () => {
      const e = await empresa();
      const sinMembresia = {
        ...comoEmpresa(empresaId(e.empresa), personaId((await crearPersonaDeBase(dueno)).id)),
        ahora: ahora(),
      };
      const apagada = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, apagada.id, "GERENTE", false);
      for (const ctx of [
        sinMembresia,
        { ...comoEmpresa(empresaId(e.empresa), personaId(apagada.id)), ahora: ahora() },
        { ...comoEmpresa(empresaId(e.empresa), null), ahora: ahora() },
      ]) {
        expect(await discriminaIvaAlEmitir(d, ctx)).toMatchObject(RECHAZADO);
      }
      expect((await discriminaIvaAlEmitir(dReales, comoGerente(e))).ok).toBe(true);
      expect(
        await discriminaIvaAlEmitir(dReales, comoGerente(await empresaSinActivar())),
      ).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_NO_ACTIVO" },
      });
    });

    it("con el módulo en solo lectura (baja de plan) el guard la rechaza: emitir CREA_AMPLIA y tampoco se puede emitir", async () => {
      const e = await empresa();
      // Un plan sin `facturacion`: lo activado queda en solo lectura.
      const { version } = await crearPlanPublicado(dueno, { modulos: [] });
      await asignarPlan(dueno, e.tenant, version);
      expect(await discriminaIvaAlEmitir(d, comoGerente(e))).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_SOLO_LECTURA" },
      });
    });

    it("solo lee: no deja ninguna escritura ni auditoría", async () => {
      const e = await empresa();
      const contar = async () =>
        (
          await dueno.query<{ n: string }>(
            "select (select count(*) from auditoria_empresa where empresa_id = $1) + (select count(*) from datos_fiscales where empresa_id = $1) as n",
            [e.empresa],
          )
        ).rows[0]?.n;
      const antes = await contar();
      await discriminaIvaAlEmitir(d, comoGerente(e));
      expect(await contar()).toBe(antes);
    });
  });

  // ===============================================================================================
  // Los puntos de venta activos de la sucursal
  // ===============================================================================================
  describe("puntos de venta para emitir", () => {
    it("trae los ACTIVOS de la sucursal pedida, de menor a mayor, con identificador, número y ambiente; sin los dados de baja ni los de otra sucursal", async () => {
      const e = await empresa();
      const norte = await sucursalNueva(e, "Norte");
      await puntoActivoEn(e, e.sucursal, 30);
      await puntoActivoEn(e, e.sucursal, 12);
      await crearPuntoDeVenta(dueno, e, { numero: 21, sucursal: e.sucursal, activo: false });
      await puntoActivoEn(e, norte, 40);
      await dueno.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [
        await idDelPunto(e, 30),
      ]);
      expect(await pvs(e, e.sucursal)).toEqual({
        ok: true,
        dato: {
          items: [
            { id: e.pv, numero: e.pvNumero, ambiente: "HOMOLOGACION" },
            { id: await idDelPunto(e, 12), numero: 12, ambiente: "HOMOLOGACION" },
            { id: await idDelPunto(e, 30), numero: 30, ambiente: "PRODUCCION" },
          ].sort((x, y) => x.numero - y.numero),
        },
      });
      expect(await numeros(e, norte)).toEqual([40]);
    });

    it("el identificador que devuelve es el que pide la emisión (el id del punto de venta)", async () => {
      const e = await empresa();
      const r = await pvs(e, e.sucursal);
      expect(r).toMatchObject({ ok: true, dato: { items: [{ id: e.pv }] } });
    });

    it("no filtra campos de más: ni el emisor, ni el domicilio, ni la versión, ni la sucursal, ni el estado", async () => {
      const e = await empresa();
      const r = await pvs(e, e.sucursal);
      expect(r.ok && r.dato.items.map((i) => Object.keys(i).sort())).toEqual([
        ["ambiente", "id", "numero"],
      ]);
      expect(r.ok && Object.keys(r.dato)).toEqual(["items"]);
      const texto = JSON.stringify(r);
      for (const dato of [e.emisor, e.domicilio, e.sucursal, "ACTIVO"]) {
        expect(texto, dato).not.toContain(dato);
      }
    });

    it("la sucursal se resuelve en el servidor con la regla del listado: sin elegir, una abierta se toma sola; con varias, hay que elegir", async () => {
      const e = await empresa();
      expect(await numeros(e, null)).toEqual([e.pvNumero]);
      // Las cerradas no cuentan para «una sola».
      await sucursalNueva(e, "Cerrada", false);
      expect(await numeros(e, null)).toEqual([e.pvNumero]);
      await sucursalNueva(e, "Otra");
      expect(await pvs(e, null)).toMatchObject(NO_ELEGIDA);
      expect(await numeros(e, e.sucursal)).toEqual([e.pvNumero]);
    });

    it("una sucursal CERRADA no ofrece puntos de venta aunque sigan activos (D-50, D-81): lista vacía, no un error; al reabrirla vuelven", async () => {
      const e = await empresa();
      const norte = await sucursalNueva(e, "Norte");
      await puntoActivoEn(e, norte, 77);
      expect(await numeros(e, norte)).toEqual([77]);
      await dueno.query("update sucursal set activa = false where id = $1", [norte]);
      expect(await pvs(e, norte)).toEqual({ ok: true, dato: { items: [] } });
      await dueno.query("update sucursal set activa = true where id = $1", [norte]);
      expect(await numeros(e, norte)).toEqual([77]);
    });

    it("el punto de venta que se muda de sucursal la sigue", async () => {
      const e = await empresa();
      const norte = await sucursalNueva(e, "Norte");
      await puntoActivoEn(e, e.sucursal, 5);
      await dueno.query("update punto_de_venta set sucursal_id = $2 where id = $1", [
        await idDelPunto(e, 5),
        norte,
      ]);
      expect(await numeros(e, norte)).toEqual([5]);
      expect(await numeros(e, e.sucursal)).toEqual([e.pvNumero]);
    });

    it("aislamiento entre sucursales: el operador de «Centro» ve los puntos de venta de Centro y no los de «Norte»", async () => {
      const e = await empresa();
      const norte = await sucursalNueva(e, "Norte reservada");
      await puntoActivoEn(e, norte, 77);
      const deCentro = await persona(e, "OPERADOR", [e.sucursal]);
      expect(await numeros(e, e.sucursal, deCentro)).toEqual([e.pvNumero]);
      expect(await numeros(e, null, deCentro)).toEqual([e.pvNumero]);
      const ajena = await pvs(e, norte, deCentro);
      expect(ajena).toMatchObject(FUERA);
      const texto = JSON.stringify(ajena);
      expect(texto).not.toContain("77");
      expect(texto).not.toContain(await idDelPunto(e, 77));
      // Sin ninguna sucursal asignada, ninguna.
      const sinAsignaciones = await persona(e, "OPERADOR");
      expect(await pvs(e, null, sinAsignaciones)).toMatchObject(FUERA);
      expect(await pvs(e, e.sucursal, sinAsignaciones)).toMatchObject(FUERA);
      // Con las dos asignadas ve las dos, y con una asignación apagada deja de ver esa.
      const conLasDos = await persona(e, "OPERADOR", [e.sucursal, norte]);
      expect(await numeros(e, norte, conLasDos)).toEqual([77]);
      await dueno.query(
        "update asignacion_sucursal set activa = false where empresa_id = $1 and sucursal_id = $2",
        [e.empresa, norte],
      );
      expect(await pvs(e, norte, conLasDos)).toMatchObject(FUERA);
    });

    it("el gerente y el administrador piden cualquiera de su empresa; una de otra empresa, inexistente o mal formada es FUERA DE ALCANCE", async () => {
      const a = await empresa();
      const b = await empresa(undefined, 2);
      await puntoActivoEn(b, b.sucursal, 88);
      const norte = await sucursalNueva(a, "Norte");
      await puntoActivoEn(a, norte, 55);
      const administrador = await persona(a, "ADMINISTRADOR");
      expect(await numeros(a, norte, administrador)).toEqual([55]);
      expect(await numeros(a, norte)).toEqual([55]);
      for (const ctx of [comoGerente(a), administrador]) {
        for (const elegida of [b.sucursal, randomUUID(), "no-es-un-uuid", "' or 1=1 --"]) {
          const r = await pvs(a, elegida, ctx);
          expect(r, elegida).toMatchObject(FUERA);
          expect(JSON.stringify(r), elegida).not.toContain("88");
        }
      }
    });

    it("aislamiento entre empresas: con el mismo número de punto de venta en dos empresas, cada una ve solo el suyo", async () => {
      const a = await empresa();
      const b = await empresa();
      expect(a.pvNumero).toBe(b.pvNumero);
      expect(await pvs(a, a.sucursal)).toMatchObject({ dato: { items: [{ id: a.pv }] } });
      expect(await pvs(b, b.sucursal)).toMatchObject({ dato: { items: [{ id: b.pv }] } });
      // El gerente de A con la sucursal de B: no existe para él.
      expect(await pvs(a, b.sucursal)).toMatchObject(FUERA);
    });

    it("sin membresía, con la membresía apagada o sin persona: rechazado antes de mirar la sucursal; con el catálogo REAL, activa pasa y sin activar es MODULO_NO_ACTIVO", async () => {
      const e = await empresa();
      const apagada = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, apagada.id, "OPERADOR", false);
      const sinMembresia = await crearPersonaDeBase(dueno);
      for (const ctx of [
        { ...comoEmpresa(empresaId(e.empresa), personaId(sinMembresia.id)), ahora: ahora() },
        { ...comoEmpresa(empresaId(e.empresa), personaId(apagada.id)), ahora: ahora() },
        { ...comoEmpresa(empresaId(e.empresa), null), ahora: ahora() },
      ]) {
        expect(await pvs(e, e.sucursal, ctx)).toMatchObject(RECHAZADO);
      }
      expect((await pvs(e, e.sucursal, comoGerente(e), dReales)).ok).toBe(true);
      const sinActivar = await empresaSinActivar();
      expect(
        await pvs(sinActivar, sinActivar.sucursal, comoGerente(sinActivar), dReales),
      ).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_NO_ACTIVO" },
      });
    });

    it("con el módulo en solo lectura (baja de plan) el guard la rechaza, como emitir", async () => {
      const e = await empresa();
      const { version } = await crearPlanPublicado(dueno, { modulos: [] });
      await asignarPlan(dueno, e.tenant, version);
      expect(await pvs(e, e.sucursal)).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_SOLO_LECTURA" },
      });
    });

    it("solo lee: no deja ninguna escritura ni auditoría", async () => {
      const e = await empresa();
      const contar = async () =>
        (
          await dueno.query<{ n: string }>(
            "select (select count(*) from auditoria_empresa where empresa_id = $1) + (select count(*) from punto_de_venta where empresa_id = $1 and version <> 1) as n",
            [e.empresa],
          )
        ).rows[0]?.n;
      const antes = await contar();
      await pvs(e, e.sucursal);
      expect(await contar()).toBe(antes);
    });
  });
});
