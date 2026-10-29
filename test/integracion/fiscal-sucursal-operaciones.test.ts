import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA } from "../../src/capacidades/permisos/roles";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  clavesDeLaValidacionInicial,
  descartarComprobante,
  emitirFactura,
  emitirNotaDeCredito,
  emitirNotaDeDebito,
  reintentarComprobante,
  resincronizarSerie,
  type DependenciasDeFacturacionWeb,
} from "../../src/composicion/facturacion-web";
import { armarTrabajos } from "../../src/composicion/trabajos";
import { armarWeb } from "../../src/composicion/web";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearConsultasDeFacturacion,
  type ProveedorDeEmision,
} from "../../src/modulos/fiscal/publico";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearEscenarioDeCasos, type EscenarioDeCasos } from "./facturacion-casos-apoyo";
import { crearPuntoDeVenta } from "./fiscal-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * Las demás operaciones fiscales respetan la sucursal (decisiones del dueño, `facturador-contratos-de-pantalla.md`), con la
 * composición REAL (conexiones, web y trabajos, base de verdad, roles limitados) y ARCA falso:
 *  - D-41: el operador emite solo desde puntos de venta de sus sucursales asignadas; gerente y administrador, desde cualquiera.
 *  - D-50: una sucursal CERRADA no emite (aunque su punto de venta siga activo); sus facturas viejas se siguen viendo.
 *  - D-51: una NOTA necesita las dos sucursales (la del punto de venta y la de la factura); gerente y administrador, cualquiera. Si la
 *    que falta es la de la FACTURA, la respuesta es «comprobante no encontrado» (como el Detalle, D-39; decisión del ingeniero); si es la
 *    del punto de venta, «sucursal fuera de su alcance».
 *  - D-39 extendido: descartar, reintentar y el modelo de impresión aplican el mismo alcance que el Detalle y responden
 *    «no encontrado» (idéntico a un comprobante que no existe) cuando no corresponde.
 *  - Repetir el mismo pedido de emisión no duplica ni cambia el resultado.
 *  - Carreras: emitir mientras otra transacción cierra la sucursal o mueve el punto de venta, en los dos órdenes (lo confirma
 *    `pg_stat_activity`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const renglonCrudo = (cambios: Record<string, unknown> = {}) => ({
  descripcion: "Medialunas",
  cantidad: "1",
  precioUnitario: "121",
  descuento: null,
  alicuota: "21",
  ...cambios,
});
const facturaCruda = (pv: string, cambios: Record<string, unknown> = {}) => ({
  clave: randomUUID(),
  puntoDeVentaId: pv,
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
const notaCruda = (
  factura: string,
  puntoDeVentaId: string | null,
  cambios: Record<string, unknown> = {},
) => ({
  clave: randomUUID(),
  comprobanteAsociadoId: factura,
  puntoDeVentaId,
  concepto: "PRODUCTOS",
  servicio: null,
  modoDePrecio: "IVA_INCLUIDO",
  renglones: [renglonCrudo({ precioUnitario: "10" })],
  motivo: "Devolución",
  ...cambios,
});

const ERROR = (codigo: string) => ({ ok: false, error: { codigo } });
const FUERA = ERROR("FISCAL_SUCURSAL_FUERA_DE_ALCANCE");
const CERRADA = ERROR("FISCAL_SUCURSAL_CERRADA");
const NO_ENCONTRADO = ERROR("FISCAL_COMPROBANTE_NO_ENCONTRADO");

type Clase = "FACTURA" | "NOTA_DE_CREDITO" | "NOTA_DE_DEBITO";

describe.skipIf(base === null)("las operaciones fiscales y la sucursal", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  const registrados: string[] = [];
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
  const ahora = (): Date => new Date();

  async function empresaConFacturacion(): Promise<EscenarioDeCasos> {
    const e = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
    const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
    await asignarPlan(dueno, e.tenant, version);
    await dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [e.empresa],
    );
    return e;
  }
  async function persona(
    e: EscenarioDeCasos,
    rol: RolDePrueba,
    asignadas: readonly string[] = [],
  ): Promise<ContextoOperativo> {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, rol);
    for (const s of asignadas) await crearAsignacionDeBase(dueno, e.empresa, p.id, s);
    return { ...comoEmpresa(empresaId(e.empresa), personaId(p.id)), ahora: new Date() };
  }
  async function sucursalNueva(
    e: EscenarioDeCasos,
    nombre = `Sucursal ${randomUUID().slice(0, 6)}`,
  ) {
    const r = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
      [e.empresa, nombre],
    );
    return r.rows[0]?.id as string;
  }
  const cerrar = (sucursal: string) =>
    dueno.query("update sucursal set activa = false where id = $1", [sucursal]);
  const puntoDeVentaEn = (e: EscenarioDeCasos, sucursal: string, numero: number) =>
    crearPuntoDeVenta(dueno, e, { numero, sucursal, activo: true });
  const comoGerente = (e: EscenarioDeCasos) => e.como(ahora());
  const cuantos = async (clave: string) =>
    (await filas("select 1 from comprobante where origen_id = $1", [clave])).length;
  const sucursalDe = async (id: string) =>
    (
      await filas<{ sucursal_id: string }>("select sucursal_id from comprobante where id = $1", [
        id,
      ])
    )[0]?.sucursal_id;

  const emitirComo = (
    clase: Clase,
    contexto: ContextoOperativo,
    crudo: ReturnType<typeof facturaCruda> | ReturnType<typeof notaCruda>,
  ) =>
    clase === "FACTURA"
      ? emitirFactura(d, contexto, crudo)
      : clase === "NOTA_DE_CREDITO"
        ? emitirNotaDeCredito(d, contexto, crudo)
        : emitirNotaDeDebito(d, contexto, crudo);

  /** Una factura AUTORIZADA (la emite el gerente y la valida el trabajo, con ARCA falso). */
  async function facturaAutorizada(e: EscenarioDeCasos, pv: string): Promise<string> {
    const emitido = await emitirFactura(d, comoGerente(e), facturaCruda(pv));
    if (!emitido.ok) throw new Error(`no se pudo emitir: ${JSON.stringify(emitido.error)}`);
    await trabajos
      .procesador()
      .despacharPorClaves(
        empresaId(e.empresa),
        clavesDeLaValidacionInicial(emitido.dato.comprobanteId),
        ahora(),
      );
    return emitido.dato.comprobanteId;
  }

  // ===============================================================================================
  // D-41 y D-50: emitir una factura (rol × sucursal del punto de venta)
  // ===============================================================================================
  describe("emitir una factura: rol × sucursal del punto de venta (D-41 y D-50)", () => {
    type Mundo = Awaited<ReturnType<typeof armarMundo>>;
    let m: Mundo;

    async function armarMundo() {
      const e = await empresaConFacturacion();
      const centro = e.sucursal;
      const norte = await sucursalNueva(e, "Norte");
      const sur = await sucursalNueva(e, "Sur");
      const pvCentro = e.pv;
      const pvNorte = await puntoDeVentaEn(e, norte, 2);
      // El punto de venta de «Sur» queda ACTIVO: lo que se cierra es la sucursal (hoy cerrarla no apaga sus puntos de venta).
      const pvSur = await puntoDeVentaEn(e, sur, 3);
      await cerrar(sur);
      return {
        e,
        centro,
        norte,
        sur,
        pvCentro,
        pvNorte,
        pvSur,
        gerente: comoGerente(e),
        administrador: await persona(e, "ADMINISTRADOR"),
        // «Martín»: operador de Centro.
        operador: await persona(e, "OPERADOR", [centro]),
        // Operador de Centro que además tenía asignada «Sur» (hoy cerrada).
        operadorConSur: await persona(e, "OPERADOR", [centro, sur]),
      };
    }
    beforeAll(async () => {
      if (base === null) return;
      m = await armarMundo();
    });

    type Esperado = "OK" | "FUERA" | "CERRADA";
    const casos: readonly Readonly<{
      nombre: string;
      pv: () => string;
      sucursal: () => string;
      porRol: Readonly<
        Record<"gerente" | "administrador" | "operador" | "operadorConSur", Esperado>
      >;
    }>[] = [
      {
        nombre: "punto de venta de una sucursal propia y abierta (Centro)",
        pv: () => m.pvCentro,
        sucursal: () => m.centro,
        porRol: { gerente: "OK", administrador: "OK", operador: "OK", operadorConSur: "OK" },
      },
      {
        nombre: "punto de venta de una sucursal ajena y abierta (Norte)",
        pv: () => m.pvNorte,
        sucursal: () => m.norte,
        porRol: { gerente: "OK", administrador: "OK", operador: "FUERA", operadorConSur: "FUERA" },
      },
      {
        nombre: "punto de venta de una sucursal CERRADA que el operador tenía asignada (Sur)",
        pv: () => m.pvSur,
        sucursal: () => m.sur,
        porRol: {
          gerente: "CERRADA",
          administrador: "CERRADA",
          operador: "FUERA",
          operadorConSur: "CERRADA",
        },
      },
    ];

    for (const caso of casos) {
      for (const rol of ["gerente", "administrador", "operador", "operadorConSur"] as const) {
        it(`${caso.nombre} × ${rol}`, async () => {
          const esperado = caso.porRol[rol];
          const pedido = facturaCruda(caso.pv());
          const r = await emitirFactura(d, m[rol], pedido);
          if (esperado === "OK") {
            expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
            if (!r.ok) return;
            expect(await sucursalDe(r.dato.comprobanteId)).toBe(caso.sucursal());
          } else {
            expect(r).toMatchObject({ FUERA, CERRADA }[esperado]);
            expect(await cuantos(pedido.clave), "no se escribió nada").toBe(0);
          }
        });
      }
    }

    it("aislamiento entre empresas: un punto de venta de otra empresa es «no encontrado» aun para el gerente, y no se escribe nada en ella", async () => {
      const otra = await empresaConFacturacion();
      const r = await emitirFactura(d, m.gerente, facturaCruda(otra.pv));
      expect(r).toMatchObject(ERROR("FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO"));
      expect(
        await filas("select 1 from comprobante where empresa_id = $1", [otra.empresa]),
      ).toEqual([]);
    });

    it("el error de alcance no trae el nombre ni el id de la sucursal ajena", async () => {
      const r = await emitirFactura(d, m.operador, facturaCruda(m.pvNorte));
      expect(r).toMatchObject(FUERA);
      expect(JSON.stringify(r)).not.toContain(m.norte);
      expect(JSON.stringify(r)).not.toContain("Norte");
    });

    it("las facturas viejas de una sucursal cerrada se siguen viendo (D-37 y D-39): cerrarla no las toca", async () => {
      const e = await empresaConFacturacion();
      const cerrando = await sucursalNueva(e, "Cerrando");
      const pv = await puntoDeVentaEn(e, cerrando, 5);
      const operador = await persona(e, "OPERADOR", [cerrando]);
      const emitida = await emitirFactura(d, operador, facturaCruda(pv));
      if (!emitida.ok) throw new Error("no emitió");
      await cerrar(cerrando);
      const detalle = await web.consultasDeFacturacion().verComprobante(operador, {
        comprobanteId: emitida.dato.comprobanteId,
      });
      expect(detalle.ok).toBe(true);
    });

    it("la aplicación rechaza la sucursal cerrada ANTES de escribir, sin ayuda del disparador de la base (con el disparador de alta apagado no se llega a insertar)", async () => {
      const e = await empresaConFacturacion();
      const cerrada = await sucursalNueva(e, "Cerrada");
      const pv = await puntoDeVentaEn(e, cerrada, 9);
      await cerrar(cerrada);
      await dueno.query("alter table comprobante disable trigger comprobante_alta");
      try {
        const pedido = facturaCruda(pv);
        expect(await emitirFactura(d, comoGerente(e), pedido)).toMatchObject(CERRADA);
        expect(await cuantos(pedido.clave)).toBe(0);
      } finally {
        await dueno.query("alter table comprobante enable trigger comprobante_alta");
      }
    });

    it("al reabrir la sucursal vuelve a emitir (D-50: «hay que reabrir la sucursal o usar un punto de venta de otra»)", async () => {
      const e = await empresaConFacturacion();
      const otra = await sucursalNueva(e, "Otra");
      const pv = await puntoDeVentaEn(e, otra, 6);
      await cerrar(otra);
      expect(await emitirFactura(d, comoGerente(e), facturaCruda(pv))).toMatchObject(CERRADA);
      await dueno.query("update sucursal set activa = true where id = $1", [otra]);
      expect((await emitirFactura(d, comoGerente(e), facturaCruda(pv))).ok).toBe(true);
    });
  });

  // ===============================================================================================
  // D-51 (y D-41, D-50): notas de crédito y de débito
  // ===============================================================================================
  describe("emitir una nota: las DOS sucursales (D-51)", () => {
    type Mundo = Awaited<ReturnType<typeof armarMundo>>;
    let m: Mundo;

    async function armarMundo() {
      const e = await empresaConFacturacion();
      const centro = e.sucursal;
      const norte = await sucursalNueva(e, "Norte");
      const sur = await sucursalNueva(e, "Sur");
      const pvCentro = e.pv;
      const pvNorte = await puntoDeVentaEn(e, norte, 2);
      const pvSur = await puntoDeVentaEn(e, sur, 3);
      const facturaCentro = await facturaAutorizada(e, pvCentro);
      const facturaNorte = await facturaAutorizada(e, pvNorte);
      const facturaSur = await facturaAutorizada(e, pvSur);
      await cerrar(sur);
      return {
        e,
        centro,
        norte,
        sur,
        pvCentro,
        pvNorte,
        pvSur,
        facturaCentro,
        facturaNorte,
        facturaSur,
        gerente: comoGerente(e),
        administrador: await persona(e, "ADMINISTRADOR"),
        operador: await persona(e, "OPERADOR", [centro]),
        operadorConSur: await persona(e, "OPERADOR", [centro, sur]),
        operadorDeNorte: await persona(e, "OPERADOR", [norte]),
      };
    }
    beforeAll(async () => {
      if (base === null) return;
      m = await armarMundo();
    });

    type Quien = "gerente" | "administrador" | "operador" | "operadorConSur" | "operadorDeNorte";
    type Esperado = "OK" | "FUERA" | "CERRADA" | "NO_ENCONTRADO";
    const todos: readonly Quien[] = [
      "gerente",
      "administrador",
      "operador",
      "operadorConSur",
      "operadorDeNorte",
    ];
    // pv / factura → qué pasa con cada uno. `null` de punto de venta: el de la factura.
    const casos: readonly Readonly<{
      nombre: string;
      pv: () => string | null;
      factura: () => string;
      sucursalDeLaNota: () => string;
      esperado: Readonly<Record<Quien, Esperado>>;
    }>[] = [
      {
        nombre: "Centro sobre una factura de Centro (sin elegir punto de venta: el de la factura)",
        pv: () => null,
        factura: () => m.facturaCentro,
        sucursalDeLaNota: () => m.centro,
        esperado: {
          gerente: "OK",
          administrador: "OK",
          operador: "OK",
          operadorConSur: "OK",
          operadorDeNorte: "FUERA",
        },
      },
      {
        nombre:
          "punto de venta de Centro sobre una factura de Norte (el ejemplo de D-51: Martín, de Centro)",
        pv: () => m.pvCentro,
        factura: () => m.facturaNorte,
        sucursalDeLaNota: () => m.norte,
        esperado: {
          gerente: "OK",
          administrador: "OK",
          operador: "NO_ENCONTRADO",
          operadorConSur: "NO_ENCONTRADO",
          operadorDeNorte: "FUERA",
        },
      },
      {
        nombre: "punto de venta de Norte sobre una factura de Centro",
        pv: () => m.pvNorte,
        factura: () => m.facturaCentro,
        sucursalDeLaNota: () => m.centro,
        esperado: {
          gerente: "OK",
          administrador: "OK",
          operador: "FUERA",
          operadorConSur: "FUERA",
          operadorDeNorte: "NO_ENCONTRADO",
        },
      },
      {
        nombre: "Norte sobre una factura de Norte",
        pv: () => m.pvNorte,
        factura: () => m.facturaNorte,
        sucursalDeLaNota: () => m.norte,
        esperado: {
          gerente: "OK",
          administrador: "OK",
          operador: "FUERA",
          operadorConSur: "FUERA",
          operadorDeNorte: "OK",
        },
      },
      {
        nombre:
          "punto de venta de Centro sobre una factura de «Sur», hoy CERRADA (SUPUESTO: alcanza con tenerla asignada)",
        pv: () => m.pvCentro,
        factura: () => m.facturaSur,
        sucursalDeLaNota: () => m.sur,
        esperado: {
          gerente: "OK",
          administrador: "OK",
          operador: "NO_ENCONTRADO",
          operadorConSur: "OK",
          operadorDeNorte: "FUERA",
        },
      },
      {
        nombre: "punto de venta de «Sur» (CERRADA) sobre una factura de Centro",
        pv: () => m.pvSur,
        factura: () => m.facturaCentro,
        sucursalDeLaNota: () => m.centro,
        esperado: {
          gerente: "CERRADA",
          administrador: "CERRADA",
          operador: "FUERA",
          operadorConSur: "CERRADA",
          operadorDeNorte: "FUERA",
        },
      },
    ];

    for (const clase of ["NOTA_DE_CREDITO", "NOTA_DE_DEBITO"] as const) {
      for (const caso of casos) {
        for (const quien of todos) {
          it(`${clase}: ${caso.nombre} × ${quien}`, async () => {
            const esperado = caso.esperado[quien];
            const pedido = notaCruda(caso.factura(), caso.pv());
            const r = await emitirComo(clase, m[quien], pedido);
            if (esperado === "OK") {
              expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
              if (!r.ok) return;
              // D-38 y D-40: la nota queda en la sucursal de la FACTURA.
              expect(await sucursalDe(r.dato.comprobanteId)).toBe(caso.sucursalDeLaNota());
            } else {
              expect(r).toMatchObject({ FUERA, CERRADA, NO_ENCONTRADO }[esperado]);
              expect(await cuantos(pedido.clave), "no se escribió nada").toBe(0);
            }
          });
        }
      }
    }

    it("una factura que no existe (o es de otra empresa) sigue siendo «comprobante no encontrado», para todos", async () => {
      const otra = await empresaConFacturacion();
      const ajena = await facturaAutorizada(otra, otra.pv);
      for (const quien of todos) {
        for (const factura of [randomUUID(), ajena]) {
          const r = await emitirNotaDeCredito(d, m[quien], notaCruda(factura, m.pvCentro));
          expect(r, `${quien} ${factura}`).toMatchObject(NO_ENCONTRADO);
        }
      }
    });
  });

  // ===============================================================================================
  // Repetir el mismo pedido
  // ===============================================================================================
  describe("repetir el mismo pedido de emisión no duplica ni cambia el resultado", () => {
    async function conteos(e: EscenarioDeCasos, id: string, clave: string) {
      return {
        comprobantes: await cuantos(clave),
        auditoria: (
          await filas(
            "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'COMPROBANTE_CREADO' and entidad_id = $2",
            [e.empresa, id],
          )
        ).length,
        trabajos: (
          await filas(
            "select 1 from trabajo where empresa_id = $1 and clave_idempotencia like $2",
            [e.empresa, `fiscal.validar:${id}:%`],
          )
        ).length,
      };
    }

    for (const clase of ["FACTURA", "NOTA_DE_CREDITO", "NOTA_DE_DEBITO"] as const) {
      it(`${clase}: dos, tres y cuatro veces el mismo pedido dan el mismo comprobante, una sola vez en la base, con una auditoría y un trabajo`, async () => {
        const e = await empresaConFacturacion();
        const factura = await facturaAutorizada(e, e.pv);
        const operador = await persona(e, "OPERADOR", [e.sucursal]);
        const pedido = clase === "FACTURA" ? facturaCruda(e.pv) : notaCruda(factura, null);
        const primera = await emitirComo(clase, operador, pedido);
        if (!primera.ok) throw new Error(`no emitió: ${JSON.stringify(primera.error)}`);
        expect(primera.dato.yaExistia).toBe(false);
        const id = primera.dato.comprobanteId;
        const antes = await conteos(e, id, pedido.clave);
        expect(antes).toEqual({ comprobantes: 1, auditoria: 1, trabajos: 1 });
        for (let i = 0; i < 3; i += 1) {
          const otra = (await emitirComo(clase, operador, pedido)) as {
            ok: boolean;
            dato: Record<string, unknown>;
          };
          expect(otra.ok).toBe(true);
          expect(otra.dato).toEqual({ ...primera.dato, yaExistia: true });
        }
        expect(await conteos(e, id, pedido.clave)).toEqual(antes);
      });
    }

    it("la repetición manda: aunque la sucursal se cierre entre medio, repetir devuelve lo mismo (como con un punto de venta desactivado), sin escribir", async () => {
      const e = await empresaConFacturacion();
      const sucursal = await sucursalNueva(e, "Oeste");
      const pv = await puntoDeVentaEn(e, sucursal, 4);
      const operador = await persona(e, "OPERADOR", [sucursal]);
      const pedido = facturaCruda(pv);
      const primera = await emitirFactura(d, operador, pedido);
      if (!primera.ok) throw new Error("no emitió");
      await cerrar(sucursal);
      const repetida = await emitirFactura(d, operador, pedido);
      expect(repetida).toEqual({ ok: true, dato: { ...primera.dato, yaExistia: true } });
      // Un pedido NUEVO en esa sucursal sí se rechaza.
      expect(await emitirFactura(d, operador, facturaCruda(pv))).toMatchObject(CERRADA);
      // Y la misma clave con OTRO pedido sigue siendo «clave reutilizada».
      expect(
        await emitirFactura(d, operador, {
          ...pedido,
          renglones: [renglonCrudo({ cantidad: "2" })],
        }),
      ).toMatchObject(ERROR("FISCAL_PEDIDO_REPETIDO"));
      expect(await cuantos(pedido.clave)).toBe(1);
    });

    it("quien perdió la sucursal no recibe el comprobante por repetir la clave: FUERA_DE_ALCANCE, nunca «ya existía»", async () => {
      const e = await empresaConFacturacion();
      const sucursal = await sucursalNueva(e, "Este");
      const pv = await puntoDeVentaEn(e, sucursal, 8);
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, p.id, "OPERADOR");
      await crearAsignacionDeBase(dueno, e.empresa, p.id, sucursal);
      const operador: ContextoOperativo = {
        ...comoEmpresa(empresaId(e.empresa), personaId(p.id)),
        ahora: new Date(),
      };
      const pedido = facturaCruda(pv);
      expect((await emitirFactura(d, operador, pedido)).ok).toBe(true);
      await dueno.query(
        "update asignacion_sucursal set activa = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, p.id],
      );
      expect(await emitirFactura(d, operador, pedido)).toMatchObject(FUERA);
      // Otro operador de otra sucursal, con la clave del primero, tampoco.
      const otroOperador = await persona(e, "OPERADOR", [e.sucursal]);
      expect(await emitirFactura(d, otroOperador, pedido)).toMatchObject(FUERA);
      expect(await cuantos(pedido.clave)).toBe(1);
    });
  });

  // ===============================================================================================
  // Carreras con el cierre de la sucursal y con la mudanza del punto de venta
  // ===============================================================================================
  describe("emitir mientras otra transacción cierra la sucursal o muda el punto de venta", () => {
    async function esperar(condicion: () => Promise<boolean>, que: string, ms = 15_000) {
      const hasta = Date.now() + ms;
      while (Date.now() < hasta) {
        if (await condicion()) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(`no pasó a tiempo: ${que}`);
    }
    /** ¿Hay una sentencia esperando un bloqueo cuyo texto coincide? (lo dice la propia base, no un reloj). */
    const esperandoBloqueo = async (patron: string) =>
      Number(
        (
          await filas<{ n: string }>(
            `select count(*) as n from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock' and query ~* $1`,
            [patron],
          )
        )[0]?.n,
      ) > 0;
    const unaConexion = async () => {
      const c = new pg.Client({ connectionString: propia.base.dueno });
      await c.connect();
      return c;
    };
    const terminado = (promesa: Promise<unknown>) => {
      const estado = { listo: false };
      void promesa.then(
        () => (estado.listo = true),
        () => (estado.listo = true),
      );
      return estado;
    };

    it("el cierre primero: la emisión ESPERA (lo confirma pg_stat_activity) y, cuando el cierre confirma, repite, ve la sucursal cerrada y no escribe nada", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const pv = await puntoDeVentaEn(e, norte, 2);
      const gerente = comoGerente(e);
      const operadorDeNorte = await persona(e, "OPERADOR", [norte]);
      const cierre = await unaConexion();
      try {
        for (const quien of [gerente, operadorDeNorte]) {
          const pedido = facturaCruda(pv);
          await cierre.query("begin");
          await cierre.query("update sucursal set activa = false where id = $1", [norte]);
          const emitiendo = emitirFactura(d, quien, pedido);
          const estado = terminado(emitiendo);
          await esperar(
            () => esperandoBloqueo('insert into "comprobante" '),
            "la emisión espera a la sucursal que se está cerrando",
          );
          expect(estado.listo).toBe(false);
          await cierre.query("commit");
          expect(await emitiendo).toMatchObject(CERRADA);
          expect(await cuantos(pedido.clave)).toBe(0);
          // Se vuelve a abrir para el siguiente actor.
          await dueno.query("update sucursal set activa = true where id = $1", [norte]);
        }
      } finally {
        await cierre.query("rollback").catch(() => undefined);
        await cierre.end();
      }
    });

    it("el cierre que se deshace: la emisión que esperaba sigue y sale", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const pv = await puntoDeVentaEn(e, norte, 2);
      const cierre = await unaConexion();
      try {
        await cierre.query("begin");
        await cierre.query("update sucursal set activa = false where id = $1", [norte]);
        const pedido = facturaCruda(pv);
        const emitiendo = emitirFactura(d, comoGerente(e), pedido);
        await esperar(
          () => esperandoBloqueo('insert into "comprobante" '),
          "la emisión espera a la sucursal",
        );
        await cierre.query("rollback");
        expect((await emitiendo).ok).toBe(true);
        expect(await cuantos(pedido.clave)).toBe(1);
      } finally {
        await cierre.query("rollback").catch(() => undefined);
        await cierre.end();
      }
    });

    it("la emisión primero: el cierre ESPERA (lo confirma pg_stat_activity), la emisión sale, y recién entonces la sucursal queda cerrada", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const pv = await puntoDeVentaEn(e, norte, 2);
      const retiene = await unaConexion();
      const cierre = await unaConexion();
      try {
        // Se retiene la cola: la emisión crea el comprobante (y toma sus bloqueos) y queda esperando para encolar, DENTRO de su
        // transacción. Que el cierre espere, más abajo, prueba que ya tiene la sucursal tomada.
        await retiene.query("begin");
        await retiene.query("lock table trabajo in access exclusive mode");
        const pedido = facturaCruda(pv);
        const emitiendo = emitirFactura(d, comoGerente(e), pedido);
        const emision = terminado(emitiendo);
        await esperar(
          () => esperandoBloqueo('from "trabajo"'),
          "la emisión espera a la cola con la sucursal ya tomada",
        );
        await cierre.query("begin");
        const cerrando = cierre.query("update sucursal set activa = false where id = $1", [norte]);
        const cierreListo = terminado(cerrando);
        await esperar(() => esperandoBloqueo("update sucursal"), "el cierre espera a la emisión");
        expect(emision.listo).toBe(false);
        expect(cierreListo.listo).toBe(false);
        await retiene.query("commit");
        const r = await emitiendo;
        if (!r.ok) throw new Error(`no emitió: ${JSON.stringify(r.error)}`);
        await cerrando;
        await cierre.query("commit");
        expect(await sucursalDe(r.dato.comprobanteId)).toBe(norte);
        expect(
          (
            await filas<{ activa: boolean }>("select activa from sucursal where id = $1", [norte])
          )[0]?.activa,
        ).toBe(false);
        // Y desde ahora esa sucursal no emite.
        expect(await emitirFactura(d, comoGerente(e), facturaCruda(pv))).toMatchObject(CERRADA);
      } finally {
        await retiene.query("rollback").catch(() => undefined);
        await cierre.query("rollback").catch(() => undefined);
        await retiene.end();
        await cierre.end();
      }
    });

    it("la mudanza primero: el operador de Centro, que emitía por ese punto de venta, queda esperando (pg_stat_activity) y al soltarse el punto de venta ya es de Norte: FUERA_DE_ALCANCE y nada escrito", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const operador = await persona(e, "OPERADOR", [e.sucursal]);
      const gerente = comoGerente(e);
      const mover = await unaConexion();
      try {
        await mover.query("begin");
        await mover.query("update punto_de_venta set sucursal_id = $2 where id = $1", [
          e.pv,
          norte,
        ]);
        const pedido = facturaCruda(e.pv);
        const emitiendo = emitirFactura(d, operador, pedido);
        const estado = terminado(emitiendo);
        await esperar(
          () => esperandoBloqueo('insert into "comprobante" '),
          "la emisión espera al punto de venta que se está mudando",
        );
        expect(estado.listo).toBe(false);
        await mover.query("commit");
        expect(await emitiendo).toMatchObject(FUERA);
        expect(await cuantos(pedido.clave)).toBe(0);
        // El gerente, en cambio, emite y el comprobante nace en Norte.
        const delGerente = await emitirFactura(d, gerente, facturaCruda(e.pv));
        if (!delGerente.ok) throw new Error("no emitió");
        expect(await sucursalDe(delGerente.dato.comprobanteId)).toBe(norte);
      } finally {
        await mover.query("rollback").catch(() => undefined);
        await mover.end();
      }
    });

    it("la emisión primero: el operador de Centro emite, la mudanza ESPERA (pg_stat_activity) y el comprobante queda en Centro", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const operador = await persona(e, "OPERADOR", [e.sucursal]);
      const retiene = await unaConexion();
      const mover = await unaConexion();
      try {
        await retiene.query("begin");
        await retiene.query("lock table trabajo in access exclusive mode");
        const emitiendo = emitirFactura(d, operador, facturaCruda(e.pv));
        const emision = terminado(emitiendo);
        await esperar(
          () => esperandoBloqueo('from "trabajo"'),
          "la emisión espera a la cola con el punto de venta ya tomado",
        );
        await mover.query("begin");
        const mudando = mover.query("update punto_de_venta set sucursal_id = $2 where id = $1", [
          e.pv,
          norte,
        ]);
        const movimiento = terminado(mudando);
        await esperar(() => esperandoBloqueo("update punto_de_venta"), "la mudanza espera");
        expect(emision.listo).toBe(false);
        expect(movimiento.listo).toBe(false);
        await retiene.query("commit");
        const r = await emitiendo;
        if (!r.ok) throw new Error(`no emitió: ${JSON.stringify(r.error)}`);
        await mudando;
        await mover.query("commit");
        expect(await sucursalDe(r.dato.comprobanteId)).toBe(e.sucursal);
        // Desde ahora el operador de Centro ya no emite por ese punto de venta.
        expect(await emitirFactura(d, operador, facturaCruda(e.pv))).toMatchObject(FUERA);
      } finally {
        await retiene.query("rollback").catch(() => undefined);
        await mover.query("rollback").catch(() => undefined);
        await retiene.end();
        await mover.end();
      }
    });
  });

  // ===============================================================================================
  // D-39 extendido: descartar, reintentar y el modelo de impresión
  // ===============================================================================================
  describe("descartar, reintentar y el modelo de impresión respetan la sucursal (D-39 extendido)", () => {
    type Mundo = Awaited<ReturnType<typeof armarMundo>>;
    let m: Mundo;

    async function armarMundo() {
      const e = await empresaConFacturacion();
      const centro = e.sucursal;
      const norte = await sucursalNueva(e, "Norte");
      const sur = await sucursalNueva(e, "Sur");
      const pvNorte = await puntoDeVentaEn(e, norte, 2);
      const pvSur = await puntoDeVentaEn(e, sur, 3);
      const gerente = comoGerente(e);
      const emitir = async (pv: string) => {
        const r = await emitirFactura(d, gerente, facturaCruda(pv));
        if (!r.ok) throw new Error("no emitió");
        return r.dato.comprobanteId;
      };
      // De «Norte»: uno PENDIENTE, uno DESCARTADO y uno AUTORIZADO.
      const pendiente = await emitir(pvNorte);
      const aDescartar = await emitir(pvNorte);
      const descartado = await descartarComprobante(d, gerente, {
        comprobanteId: aDescartar,
        motivo: "Error de carga",
        versionEsperada: 1,
      });
      if (!descartado.ok) throw new Error(`no descartó: ${JSON.stringify(descartado.error)}`);
      const autorizado = await facturaAutorizada(e, pvNorte);
      // De «Sur» (que se cerrará): uno PENDIENTE.
      const pendienteDeSur = await emitir(pvSur);
      await cerrar(sur);
      return {
        e,
        centro,
        norte,
        sur,
        pendiente,
        descartado: aDescartar,
        autorizado,
        pendienteDeSur,
        gerente,
        administrador: await persona(e, "ADMINISTRADOR"),
        operadorDeCentro: await persona(e, "OPERADOR", [centro]),
        operadorDeNorte: await persona(e, "OPERADOR", [norte]),
        operadorDeSur: await persona(e, "OPERADOR", [sur]),
      };
    }
    beforeAll(async () => {
      if (base === null) return;
      m = await armarMundo();
    });

    const estadoYVersion = async (id: string) =>
      (
        await filas<{ estado: string; version: number }>(
          "select estado, version from comprobante where id = $1",
          [id],
        )
      )[0];
    const auditorias = async (id: string) =>
      (await filas("select 1 from auditoria_empresa where entidad_id = $1", [id])).length;
    const trabajosDe = async (id: string) =>
      (
        await filas("select 1 from trabajo where clave_idempotencia like $1", [
          `fiscal.validar:${id}:%`,
        ])
      ).length;
    const descartar = (c: ContextoOperativo, id: string, version = 1) =>
      descartarComprobante(d, c, {
        comprobanteId: id,
        motivo: "Error de carga",
        versionEsperada: version,
      });
    const reintentar = (c: ContextoOperativo, id: string) =>
      reintentarComprobante(d, c, { comprobanteId: id });
    const imprimir = (c: ContextoOperativo, id: string) =>
      // La web todavía no ofrece el modelo de impresión (F9): se arma la consulta del módulo con las mismas conexiones.
      crearConsultasDeFacturacion({
        transacciones: conexiones.transaccionesDeApp(),
        reglas: REGLAS_CON_FACTURACION,
      }).modeloDeImpresion(c, { comprobanteId: id as never });

    it("descartar: lo ajeno responde IGUAL que lo que no existe, sea cual sea su estado o versión (nunca «ya estaba», versión ni estado)", async () => {
      const inexistente = await descartar(m.operadorDeCentro, randomUUID());
      expect(inexistente).toMatchObject(NO_ENCONTRADO);
      for (const [que, id, version] of [
        ["pendiente", m.pendiente, 1],
        ["pendiente con otra versión", m.pendiente, 99],
        ["ya descartado", m.descartado, 1],
        ["autorizado", m.autorizado, 1],
      ] as const) {
        const antes = { fila: await estadoYVersion(id), auditoria: await auditorias(id) };
        const r = await descartar(m.operadorDeCentro, id, version);
        expect(r, que).toEqual(inexistente);
        // Y no tocó nada.
        expect({ fila: await estadoYVersion(id), auditoria: await auditorias(id) }, que).toEqual(
          antes,
        );
      }
    });

    it("descartar: la persona que SÍ tiene la sucursal ve las respuestas verdaderas de cada estado", async () => {
      const c = m.operadorDeNorte;
      expect(await descartar(c, m.descartado)).toMatchObject({
        ok: true,
        dato: { yaEstaba: true },
      });
      expect(await descartar(c, m.autorizado)).toMatchObject(ERROR("FISCAL_ESTADO_NO_DESCARTABLE"));
      expect(await descartar(c, m.pendiente, 99)).toMatchObject(
        ERROR("FISCAL_VERSION_DESACTUALIZADA"),
      );
    });

    it("reintentar: lo ajeno responde IGUAL que lo que no existe, y no encola ni audita", async () => {
      const inexistente = await reintentar(m.operadorDeCentro, randomUUID());
      expect(inexistente).toMatchObject(NO_ENCONTRADO);
      for (const [que, id] of [
        ["pendiente (con trabajo vivo)", m.pendiente],
        ["descartado", m.descartado],
        ["autorizado", m.autorizado],
      ] as const) {
        const antes = {
          fila: await estadoYVersion(id),
          auditoria: await auditorias(id),
          trabajos: await trabajosDe(id),
        };
        const r = await reintentar(m.operadorDeCentro, id);
        expect(r, que).toEqual(inexistente);
        expect(
          {
            fila: await estadoYVersion(id),
            auditoria: await auditorias(id),
            trabajos: await trabajosDe(id),
          },
          que,
        ).toEqual(antes);
      }
    });

    it("reintentar: quien SÍ tiene la sucursal ve las respuestas verdaderas", async () => {
      const c = m.operadorDeNorte;
      expect(await reintentar(c, m.pendiente)).toMatchObject({
        ok: true,
        dato: { encolado: false },
      });
      expect(await reintentar(c, m.autorizado)).toMatchObject(
        ERROR("FISCAL_ESTADO_NO_REINTENTABLE"),
      );
      expect(await reintentar(c, m.descartado)).toMatchObject(
        ERROR("FISCAL_ESTADO_NO_REINTENTABLE"),
      );
    });

    it("modelo de impresión: lo ajeno es «no encontrado» aunque no esté autorizado; lo propio dice la verdad (no autorizado)", async () => {
      const inexistente = await imprimir(m.operadorDeCentro, randomUUID());
      expect(inexistente).toEqual({ ok: false, error: "COMPROBANTE_NO_ENCONTRADO" });
      for (const id of [m.pendiente, m.descartado, m.autorizado]) {
        expect(await imprimir(m.operadorDeCentro, id)).toEqual(inexistente);
      }
      expect(await imprimir(m.operadorDeNorte, m.pendiente)).toEqual({
        ok: false,
        error: "COMPROBANTE_NO_AUTORIZADO",
      });
    });

    it("gerente y administrador operan sobre cualquier sucursal, también cerrada; el operador de la cerrada que tenía asignada también", async () => {
      for (const c of [m.gerente, m.administrador]) {
        expect(await descartar(c, m.descartado)).toMatchObject({
          ok: true,
          dato: { yaEstaba: true },
        });
        expect(await reintentar(c, m.autorizado)).toMatchObject(
          ERROR("FISCAL_ESTADO_NO_REINTENTABLE"),
        );
        expect(await imprimir(c, m.pendienteDeSur)).toEqual({
          ok: false,
          error: "COMPROBANTE_NO_AUTORIZADO",
        });
      }
      expect(await imprimir(m.operadorDeSur, m.pendienteDeSur)).toEqual({
        ok: false,
        error: "COMPROBANTE_NO_AUTORIZADO",
      });
      expect(await reintentar(m.operadorDeSur, m.pendienteDeSur)).toMatchObject({
        ok: true,
        dato: { encolado: false },
      });
      // Sigue siendo de Sur aunque esté cerrada: un operador de Norte no la toca.
      expect(await reintentar(m.operadorDeNorte, m.pendienteDeSur)).toMatchObject(NO_ENCONTRADO);
    });

    it("aislamiento entre empresas: el comprobante de otra empresa es «no encontrado» aun para su gerente, igual que uno que no existe", async () => {
      const otra = await empresaConFacturacion();
      const ajeno = await facturaAutorizada(otra, otra.pv);
      for (const accion of [
        (id: string) => descartar(m.gerente, id),
        (id: string) => reintentar(m.gerente, id),
      ]) {
        expect(await accion(ajeno)).toEqual(await accion(randomUUID()));
        expect(await accion(ajeno)).toMatchObject(NO_ENCONTRADO);
      }
      expect(await imprimir(m.gerente, ajeno)).toEqual({
        ok: false,
        error: "COMPROBANTE_NO_ENCONTRADO",
      });
      expect((await estadoYVersion(ajeno))?.estado).toBe("AUTORIZADO");
    });

    it("un comprobante sin sucursal guardada (carga que apagó los disparadores) es «no encontrado» también para descartar y reintentar", async () => {
      const e = await empresaConFacturacion();
      const gerente = comoGerente(e);
      const r = await emitirFactura(d, gerente, facturaCruda(e.pv));
      if (!r.ok) throw new Error("no emitió");
      const id = r.dato.comprobanteId;
      await dueno.query("alter table comprobante disable trigger user");
      await dueno.query("update comprobante set sucursal_id = null where id = $1", [id]);
      await dueno.query("alter table comprobante enable trigger user");
      expect(await descartar(gerente, id)).toMatchObject(NO_ENCONTRADO);
      expect(await reintentar(gerente, id)).toMatchObject(NO_ENCONTRADO);
      expect(await imprimir(gerente, id)).toEqual({
        ok: false,
        error: "COMPROBANTE_NO_ENCONTRADO",
      });
    });
  });

  // ===============================================================================================
  // Resincronizar una serie: solo el gerente («todas»), el chequeo de sucursal no hace falta
  // ===============================================================================================
  describe("resincronizar una serie: no necesita chequeo de sucursal (queda documentado)", () => {
    it("todo rol que tiene `series.resincronizar` tiene alcance «todas» en el adaptador real, con o sin asignaciones y con o sin cerradas: si se la dieran a otro rol, esta prueba obliga a decidir su alcance", async () => {
      const e = await empresaConFacturacion();
      const roles = ROLES_DE_EMPRESA.filter((rol) =>
        (PERMISOS_DE_EMPRESA["series.resincronizar"] as readonly string[]).includes(rol),
      );
      expect(roles).toEqual(["GERENTE"]);
      for (const rol of roles) {
        const contexto = rol === "GERENTE" ? comoGerente(e) : await persona(e, rol);
        for (const incluirDesactivadas of [false, true]) {
          const alcance = await conexiones
            .transaccionesDeApp()
            .ejecutar({ contexto, soloLectura: true }, async (tx) => ({
              ok: true as const,
              valor: await tx.autorizacion.sucursalesDelActor(contexto, { incluirDesactivadas }),
            }));
          expect(alcance, `${rol} ${String(incluirDesactivadas)}`).toEqual({
            ok: true,
            valor: "TODAS",
          });
        }
      }
    });

    it("el gerente (sin ninguna sucursal asignada) llega hasta la serie de un punto de venta de una sucursal cerrada; los demás roles, aun con la sucursal asignada, son SIN_PERMISO", async () => {
      const e = await empresaConFacturacion();
      const sur = await sucursalNueva(e, "Sur");
      const pvSur = await puntoDeVentaEn(e, sur, 3);
      await cerrar(sur);
      const pedido = {
        puntoDeVentaId: pvSur,
        tipo: "FACTURA_B",
        ambiente: "HOMOLOGACION",
        ultimoVistoEnArca: "5",
        motivo: "Otro sistema usó el punto de venta",
      };
      expect(await resincronizarSerie(d, comoGerente(e), pedido)).toMatchObject(
        ERROR("FISCAL_SERIE_NO_ENCONTRADA"),
      );
      for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
        const contexto = await persona(e, rol, [sur]);
        expect(await resincronizarSerie(d, contexto, pedido), rol).toMatchObject({
          ok: false,
          error: { codigo: "SIN_PERMISO" },
        });
      }
    });
  });
});
