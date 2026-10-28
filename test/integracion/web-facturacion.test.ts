import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { ENCABEZADO_DE_IP } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import { armarTrabajos } from "../../src/composicion/trabajos";
import { armarWeb } from "../../src/composicion/web";
import type { ProveedorDeEmision } from "../../src/modulos/fiscal/publico";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { ipUnica } from "./autenticacion-ingreso-apoyo";
import { cargarCertificado } from "./facturacion-casos-apoyo";
import { crearEscenario } from "./facturacion-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import { crearMembresiaDeBase, type RolDePrueba } from "./fixtures-identidad";
import { asignarPlan, crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";
import {
  HOST_A,
  HOST_B,
  armarMundoWeb,
  ingresarEn,
  personaVinculada,
  type Ingresado,
  type MundoWeb,
} from "./web-apoyo";

import type * as ModuloDeFacturacion from "../../apps/web/servidor/facturacion";

/**
 * Las acciones de servidor del facturador (`apps/web/servidor/facturacion.ts`) con sesiones de verdad: ingreso real por
 * el proveedor local de Google, la composición real de fiscal (base real, roles limitados) y ARCA falso. Next se
 * reemplaza por lo mínimo (encabezados, cookies, y `after()` que se corre a mano); todo lo demás es código real.
 *
 *  - P-7: un pedido de otro origen es `SIN_PERMISO` y no cambia NADA.
 *  - Sin sesión, `SESION_VENCIDA`. Sin empresa elegida, o con una que no es de la persona en esta marca, `SIN_PERMISO`.
 *  - La empresa sale de la sesión y la cookie validada: un `empresaId` en el pedido no cuenta.
 *  - Emitir pide el intento inmediato con `after()`: al correrlo, el comprobante llega a ARCA una sola vez.
 */
vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  mundo: null as MundoWeb | null,
  fiscal: null as {
    web: unknown;
    trabajos: unknown;
  } | null,
  encabezados: new Headers(),
  jar: new Map<string, string>(),
  programadas: [] as (() => Promise<void> | void)[],
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(estado.encabezados),
  cookies: () =>
    Promise.resolve({
      get: (nombre: string) => {
        const valor = estado.jar.get(nombre);
        return valor === undefined ? undefined : { name: nombre, value: valor };
      },
      set: (nombre: string, valor: string) => {
        estado.jar.set(nombre, valor);
      },
      delete: (nombre: string) => {
        estado.jar.delete(nombre);
      },
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
}));
vi.mock("next/server", () => ({
  after: (tarea: () => Promise<void> | void) => {
    estado.programadas.push(tarea);
  },
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    autenticacion: () => estado.mundo?.dependencias.autenticacion(),
    consultasDeSesion: () => estado.mundo?.dependencias.consultasDeSesion(),
    casosDeUsoDeIdentidad: () => estado.mundo?.dependencias.casosDeUsoDeIdentidad(),
    consultasDeEmpresas: () => estado.mundo?.dependencias.consultasDeEmpresas(),
    casosDeUsoDeFacturacion: () =>
      (estado.fiscal?.web as { casosDeUsoDeFacturacion: () => unknown }).casosDeUsoDeFacturacion(),
    consultasDeFacturacion: () =>
      (estado.fiscal?.web as { consultasDeFacturacion: () => unknown }).consultasDeFacturacion(),
  },
  trabajos: {
    procesador: () => (estado.fiscal?.trabajos as { procesador: () => unknown }).procesador(),
  },
}));
vi.mock("../../apps/web/servidor/fuente-de-puertas", () => ({
  fuenteDePuertas: {
    consultarHost: (host: string, superficie: string) => {
      const m = estado.mundo;
      if (m === null || superficie !== "APP") return Promise.resolve({ ok: true, valor: null });
      if (host === HOST_A) return Promise.resolve({ ok: true, valor: { marcaId: m.marcaA } });
      if (host === HOST_B) return Promise.resolve({ ok: true, valor: { marcaId: m.marcaB } });
      return Promise.resolve({ ok: true, valor: null });
    },
    leerMarca: () => Promise.resolve({ nombre: "Marca", tema: {}, hostDeApp: null }),
  },
}));

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const renglon = (cambios: Record<string, unknown> = {}) => ({
  descripcion: "Medialunas",
  cantidad: "1",
  precioUnitario: "121",
  descuento: null,
  alicuota: "21",
  ...cambios,
});
const factura = (puntoDeVentaId: string, cambios: Record<string, unknown> = {}) => ({
  clave: randomUUID(),
  puntoDeVentaId,
  concepto: "PRODUCTOS",
  servicio: null,
  modoDePrecio: "IVA_INCLUIDO",
  receptor: {
    nombre: null,
    documento: { tipo: "SIN_IDENTIFICAR" },
    condicionIva: "CONSUMIDOR_FINAL",
    domicilio: null,
  },
  renglones: [renglon()],
  ...cambios,
});

describe.skipIf(base === null)("web: las acciones de servidor del facturador", () => {
  let mundo: MundoWeb;
  let conexiones: Conexiones;
  let acciones: typeof ModuloDeFacturacion;
  const arca = { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: new EmisionFalsa() };

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("VERCEL_ENV", "preview");
    mundo = await armarMundoWeb(base);
    estado.mundo = mundo;
    const propia = mundo.propia.base;
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.clave.kid}:${propia.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.app,
      PEDERNAL_DB_TRABAJOS: propia.trabajos,
      PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
      PEDERNAL_RESEND_API_KEY: "relleno",
      PEDERNAL_CORREO_REMITENTE: "Prueba <prueba@ejemplo.test>",
      PEDERNAL_NOMBRE_DE_MARCA: "Marca de prueba",
      PEDERNAL_URL_BASE: "https://app.ejemplo.test",
    };
    conexiones = armarConexiones({ fuente: () => fuente });
    const emision: ProveedorDeEmision = { para: (_e, _em, ambiente) => arca[ambiente] };
    estado.fiscal = {
      web: armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION, emision }),
      trabajos: armarTrabajos(conexiones, { emision }),
    };
    acciones = await import("../../apps/web/servidor/facturacion");
  }, 120_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await conexiones.transaccionesDeTrabajos().cerrar();
    estado.mundo = null;
    estado.fiscal = null;
    await mundo.cerrar();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    estado.jar.clear();
    estado.programadas.length = 0;
  });

  /** Un pedido desde el navegador de `ingresado` en `host`, con su sesión, la cookie de empresa y un `Origin`. */
  function comoNavegador(
    ingresado: Ingresado | null,
    host: string,
    empresa: string | null,
    origen: string | null = `https://${host}`,
  ): void {
    estado.jar.clear();
    if (ingresado !== null) {
      for (const c of ingresado.navegador.cookiesDe(host)) {
        estado.jar.set(c.nombre, decodeURIComponent(c.valor));
      }
    }
    if (empresa !== null) estado.jar.set("__Host-pd_empresa", empresa);
    const cookies = [...estado.jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
    estado.encabezados = new Headers({
      host,
      [ENCABEZADO_DE_IP]: ipUnica(),
      ...(cookies === "" ? {} : { cookie: cookies }),
      ...(origen === null ? {} : { origin: origen }),
    });
  }

  /**
   * Una empresa de la marca A con facturación activa y el escenario fiscal completo (datos confirmados, punto de venta
   * y certificado), con la persona del ingreso como miembro.
   */
  async function empresaFacturadora(yo: Ingresado, persona: string, rol: RolDePrueba = "GERENTE") {
    const m = await crearMundoDeMarca(mundo.dueno, { marca: mundo.marcaA });
    await crearMembresiaDeBase(mundo.dueno, m.empresa, persona, rol);
    const { cuit } = (
      await mundo.dueno.query<{ cuit: string }>("select cuit from empresa where id = $1", [
        m.empresa,
      ])
    ).rows[0] as { cuit: string };
    const { id: emisor } = (
      await mundo.dueno.query<{ id: string }>(
        "select id from emisor where empresa_id = $1 and es_principal",
        [m.empresa],
      )
    ).rows[0] as { id: string };
    const e = await crearEscenario(mundo.dueno, {
      mundo: { tenant: m.tenant, empresa: m.empresa, cuit, sucursal: m.sucursal, persona, emisor },
    });
    await cargarCertificado(mundo.propia.base, e, "HOMOLOGACION");
    const { version } = await crearPlanPublicado(mundo.dueno, { modulos: ["facturacion"] });
    await asignarPlan(mundo.dueno, m.tenant, version);
    await mundo.dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [m.empresa],
    );
    void yo;
    return e;
  }

  const comprobantesDe = async (empresa: string) =>
    (
      await mundo.dueno.query<{ id: string; estado: string; empresa_id: string }>(
        "select id, estado, empresa_id from comprobante where empresa_id = $1",
        [empresa],
      )
    ).rows;

  it("sin sesión: SESION_VENCIDA, y no se escribe nada", async () => {
    comoNavegador(null, HOST_A, null);
    const r = await acciones.emitirLaFactura(factura(randomUUID()));
    expect(r).toMatchObject({ ok: false, error: { codigo: "SESION_VENCIDA" } });
    expect(estado.programadas).toEqual([]);
  });

  it.each([
    ["otro sitio", "https://sitio-malo.test"],
    ["el mismo nombre en http", `http://${HOST_A}`],
    ["el de la otra marca", `https://${HOST_B}`],
    ["null", "null"],
  ])("con Origin de %s: SIN_PERMISO en cada acción y no cambia NADA (P-7)", async (_n, origen) => {
    const yo = await ingresarEn(mundo, HOST_A);
    const persona = await personaVinculada(mundo, yo.sesion);
    const e = await empresaFacturadora(yo, persona);
    comoNavegador(yo, HOST_A, e.empresa, origen);
    const pedidos = [
      () => acciones.emitirLaFactura(factura(e.pv)),
      () => acciones.emitirLaNotaDeCredito({}),
      () => acciones.emitirLaNotaDeDebito({}),
      () => acciones.descartarElComprobante({}),
      () => acciones.reintentarElComprobante({}),
      () => acciones.resincronizarLaSerie({}),
      () => acciones.cambiarElAmbiente({}),
      () => acciones.listarLosComprobantes(),
      () => acciones.verElComprobante({}),
    ];
    for (const pedir of pedidos) {
      expect(await pedir()).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    }
    expect(await comprobantesDe(e.empresa)).toEqual([]);
    expect(estado.programadas).toEqual([]);
  });

  it("sin empresa elegida (con dos) o con una que no es suya: SIN_PERMISO, y no se escribe", async () => {
    const yo = await ingresarEn(mundo, HOST_A);
    const persona = await personaVinculada(mundo, yo.sesion);
    const a = await empresaFacturadora(yo, persona);
    const b = await empresaFacturadora(yo, persona);
    // Dos empresas y ninguna elegida: no hay dónde actuar.
    comoNavegador(yo, HOST_A, null);
    expect(await acciones.emitirLaFactura(factura(a.pv))).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    // Una empresa que no es de la persona (de otra persona y otra marca) tampoco.
    const otro = await ingresarEn(mundo, HOST_B);
    const personaB = await personaVinculada(mundo, otro.sesion);
    const mB = await crearMundoDeMarca(mundo.dueno, { marca: mundo.marcaB });
    await crearMembresiaDeBase(mundo.dueno, mB.empresa, personaB, "GERENTE");
    for (const ajena of [mB.empresa, "inventada"]) {
      comoNavegador(yo, HOST_A, ajena);
      expect(await acciones.listarLosComprobantes(), ajena).toMatchObject({
        ok: false,
        error: { codigo: "SIN_PERMISO" },
      });
    }
    expect(await comprobantesDe(a.empresa)).toEqual([]);
    expect(await comprobantesDe(b.empresa)).toEqual([]);
  });

  it("emitir: crea el comprobante en LA empresa de la sesión y pide el intento inmediato, que lo lleva a ARCA una sola vez", async () => {
    const yo = await ingresarEn(mundo, HOST_A);
    const persona = await personaVinculada(mundo, yo.sesion);
    const a = await empresaFacturadora(yo, persona);
    const b = await empresaFacturadora(yo, persona);
    comoNavegador(yo, HOST_A, a.empresa);
    const antes = arca.HOMOLOGACION.pedidos.length;

    // Un `empresaId` (y un emisor) de la OTRA empresa de la misma persona en el pedido no cuentan.
    const r = await acciones.emitirLaFactura({
      ...factura(a.pv),
      empresaId: b.empresa,
      emisorId: b.emisor,
    });
    expect(r).toMatchObject({ ok: true, dato: { estado: "PENDIENTE", yaExistia: false } });
    if (!r.ok) return;
    expect(await comprobantesDe(a.empresa)).toEqual([
      { id: r.dato.comprobanteId, estado: "PENDIENTE", empresa_id: a.empresa },
    ]);
    expect(await comprobantesDe(b.empresa)).toEqual([]);

    // Se programó UN intento inmediato y nada salió a ARCA todavía (corre después de responder).
    expect(estado.programadas).toHaveLength(1);
    expect(arca.HOMOLOGACION.pedidos.length).toBe(antes);
    await estado.programadas[0]?.();
    expect(arca.HOMOLOGACION.pedidos.length).toBe(antes + 1);
    expect((await comprobantesDe(a.empresa))[0]?.estado).toBe("AUTORIZADO");

    // Repetir el mismo pedido (otro clic, un reintento de red): el mismo comprobante, sin duplicar ni emitir de nuevo.
    estado.programadas.length = 0;
    comoNavegador(yo, HOST_A, a.empresa);
    const repetido = await acciones.emitirLaFactura({
      ...factura(a.pv),
      clave: r.dato.comprobanteId,
    });
    expect(repetido).toMatchObject({ ok: true, dato: { comprobanteId: r.dato.comprobanteId } });
    for (const tarea of estado.programadas) await tarea();
    expect(arca.HOMOLOGACION.pedidos.length).toBe(antes + 1);
    expect(await comprobantesDe(a.empresa)).toHaveLength(1);

    // Y se ve en el listado y el detalle, de esa empresa.
    const lista = await acciones.listarLosComprobantes();
    expect(lista).toMatchObject({ ok: true, dato: { items: [{ id: r.dato.comprobanteId }] } });
    const detalle = await acciones.verElComprobante({ comprobanteId: r.dato.comprobanteId });
    expect(detalle).toMatchObject({ ok: true, dato: { estado: "AUTORIZADO" } });
  });

  it("los errores salen traducidos: de negocio con su código y su campo, sin detalle interno ni nada de ARCA", async () => {
    const yo = await ingresarEn(mundo, HOST_A);
    const persona = await personaVinculada(mundo, yo.sesion);
    const e = await empresaFacturadora(yo, persona);
    comoNavegador(yo, HOST_A, e.empresa);
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(
        await acciones.emitirLaFactura(
          factura(e.pv, { renglones: [renglon({ cantidad: "1,5" })] }),
        ),
      ).toMatchObject({
        ok: false,
        error: {
          codigo: "FISCAL_DATOS_INVALIDOS",
          campo: "renglon1.cantidad",
          presentacion: "AVISO",
        },
      });
      expect(await acciones.emitirLaFactura(factura(randomUUID()))).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO" },
      });
      expect(await acciones.reintentarElComprobante({ comprobanteId: randomUUID() })).toMatchObject(
        { ok: false, error: { codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" } },
      );
      // Nada de eso es un defecto: no hay registro ni referencia.
      expect(consola).not.toHaveBeenCalled();
    } finally {
      consola.mockRestore();
    }
  });

  it("cada acción exige su permiso en el servidor: el operador no resincroniza ni cambia el ambiente", async () => {
    const yo = await ingresarEn(mundo, HOST_A);
    const persona = await personaVinculada(mundo, yo.sesion);
    const e = await empresaFacturadora(yo, persona, "OPERADOR");
    comoNavegador(yo, HOST_A, e.empresa);
    expect(
      await acciones.resincronizarLaSerie({
        puntoDeVentaId: e.pv,
        tipo: "FACTURA_B",
        ambiente: "HOMOLOGACION",
        ultimoVistoEnArca: "5",
        motivo: "Otro sistema",
      }),
    ).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO", presentacion: "POR_QUE_NO_PUEDO" },
    });
    expect(
      await acciones.cambiarElAmbiente({
        puntoDeVentaId: e.pv,
        ambiente: "PRODUCCION",
        versionEsperada: 1,
      }),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    // Pero sí emite y ve.
    expect((await acciones.emitirLaFactura(factura(e.pv))).ok).toBe(true);
    expect((await acciones.listarLosComprobantes()).ok).toBe(true);
  });
});
