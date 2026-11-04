import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { ENCABEZADO_DE_IP } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import { armarTrabajos } from "../../src/composicion/trabajos";
import { armarWeb } from "../../src/composicion/web";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { ProveedorDeEmision } from "../../src/modulos/fiscal/publico";
import {
  calcularLaEmision,
  clienteInicial,
  conDocumento,
  renglonVacio,
  type ClienteEscrito,
  type RenglonEscrito,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-emision";
import { armarElPedido } from "../../apps/web/ui/plantillas/facturacion/pedido-de-emision";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { ipUnica } from "./autenticacion-ingreso-apoyo";
import { crearEscenario } from "./facturacion-apoyo";
import { cargarCertificado } from "./facturacion-casos-apoyo";
import { crearPuntoDeVenta } from "./fiscal-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import { asignarPlan, crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";
import {
  HOST_A,
  armarMundoWeb,
  ingresarEn,
  personaVinculada,
  type Ingresado,
  type MundoWeb,
} from "./web-apoyo";

import type * as ModuloDeFacturacion from "../../apps/web/servidor/facturacion";
import type * as ModuloDeSesion from "../../apps/web/servidor/sesion";

/**
 * Emitir una factura (8B) contra el backend REAL: lo que la página lee y lo que la pantalla manda, con sesiones de verdad (ingreso real por
 * el proveedor local de Google), la composición real de fiscal (base real, roles limitados) y ARCA falso. Next se reemplaza por lo mínimo
 * (encabezados, cookies, `after()`); la acción es la del facturador (`emitirLaFactura`) y las dos lecturas son las de la página
 * (`discriminaIvaParaEmitir`, `puntosDeVentaParaEmitir`), sin tocar. Qué prueba:
 *  1. El pedido que arma la pantalla (`armarElPedido`) lo acepta el servidor tal cual, y lo que queda registrado (total, importe de cada
 *     renglón, receptor, estado «Pendiente de enviar») es lo que «Revisar» mostró: la pantalla no inventa cifras.
 *  2. La sucursal de Emitir es la del listado (la cookie que valida el servidor): sin haber pasado por el listado, con varias sucursales,
 *     el servidor pide elegir; elegida una, se ofrecen sus puntos de venta activos y nada más.
 *  3. Un punto de venta que se ofreció y ya no puede emitir se rechaza con su motivo (el servidor es quien decide); el reintento con la
 *     misma clave no duplica y con otros valores es otro pedido.
 *  4. Aislamiento: el punto de venta de otra empresa no existe; un `empresaId` del pedido no cuenta; el catálogo real (facturación en
 *     desarrollo) rechaza las lecturas y la emisión.
 */
vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  mundo: null as MundoWeb | null,
  fiscal: null as { web: unknown; trabajos: unknown } | null,
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
      if (m === null || superficie !== "APP" || host !== HOST_A) {
        return Promise.resolve({ ok: true, valor: null });
      }
      return Promise.resolve({ ok: true, valor: { marcaId: m.marcaA } });
    },
    leerMarca: () => Promise.resolve({ nombre: "Marca", tema: {}, hostDeApp: null }),
  },
}));

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const COOKIE_DE_EMPRESA = "__Host-pd_empresa";
const COOKIE_DE_SUCURSAL = "__Host-pd_sucursal";
// 30-71234567-1: un CUIT con su dígito verificador.
const CUIT_DEL_CLIENTE = "30-71234567-1";

const renglon = (cambios: Partial<RenglonEscrito>): RenglonEscrito => ({
  ...renglonVacio(1),
  descripcion: "Medialunas",
  cantidad: "1",
  precio: "121.00",
  alicuota: "21",
  ...cambios,
});
const cliente = (cambios: Partial<ClienteEscrito> = {}): ClienteEscrito => ({
  ...conDocumento(clienteInicial, "DNI"),
  numero: "27.345.678",
  nombre: "Juan Pérez",
  condicionIva: "CONSUMIDOR_FINAL",
  ...cambios,
});

describe.skipIf(base === null)("Emitir (8B): la página y la acción contra el backend real", () => {
  let mundo: MundoWeb;
  let conexiones: Conexiones;
  let acciones: typeof ModuloDeFacturacion;
  let sesion: typeof ModuloDeSesion;
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
    };
    conexiones = armarConexiones({ fuente: () => fuente });
    const emision: ProveedorDeEmision = { para: (_e, _em, ambiente) => arca[ambiente] };
    estado.fiscal = {
      web: armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION, emision }),
      trabajos: armarTrabajos(conexiones, { emision }),
    };
    acciones = await import("../../apps/web/servidor/facturacion");
    sesion = await import("../../apps/web/servidor/sesion");
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

  /** Un pedido desde el navegador de `ingresado`, con su sesión, la cookie de empresa y, si hay, la de sucursal. */
  function comoNavegador(ingresado: Ingresado, empresa: string, sucursal: string | null = null) {
    estado.jar.clear();
    for (const c of ingresado.navegador.cookiesDe(HOST_A)) {
      estado.jar.set(c.nombre, decodeURIComponent(c.valor));
    }
    estado.jar.set(COOKIE_DE_EMPRESA, empresa);
    if (sucursal !== null) estado.jar.set(COOKIE_DE_SUCURSAL, sucursal);
    const cookies = [...estado.jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
    estado.encabezados = new Headers({
      host: HOST_A,
      [ENCABEZADO_DE_IP]: ipUnica(),
      cookie: cookies,
      origin: `https://${HOST_A}`,
    });
  }

  /** El contexto de la empresa que resuelve el servidor para este pedido: lo que recibe la página. */
  async function contextoDeLaPagina(): Promise<ContextoOperativo> {
    const { entrada } = await sesion.empresaDelPedido();
    if (!entrada.ok || entrada.dato.tipo !== "ENTRA") throw new Error("la página no tiene empresa");
    return entrada.dato.contexto;
  }

  async function empresaFacturadora(
    persona: string,
    opciones: { rol?: RolDePrueba; condicionIva?: "MONOTRIBUTO"; sinCertificado?: boolean } = {},
  ) {
    const m = await crearMundoDeMarca(mundo.dueno, { marca: mundo.marcaA });
    await crearMembresiaDeBase(mundo.dueno, m.empresa, persona, opciones.rol ?? "GERENTE");
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
      ...(opciones.condicionIva === undefined ? {} : { condicionIva: opciones.condicionIva }),
    });
    if (opciones.sinCertificado !== true)
      await cargarCertificado(mundo.propia.base, e, "HOMOLOGACION");
    const { version } = await crearPlanPublicado(mundo.dueno, { modulos: ["facturacion"] });
    await asignarPlan(mundo.dueno, m.tenant, version);
    await mundo.dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [m.empresa],
    );
    return e;
  }

  const comprobantesDe = async (empresa: string) =>
    (
      await mundo.dueno.query<{ id: string }>("select id from comprobante where empresa_id = $1", [
        empresa,
      ])
    ).rows;

  async function nuevaPersona() {
    const yo = await ingresarEn(mundo, HOST_A);
    return { yo, persona: await personaVinculada(mundo, yo.sesion) };
  }

  it("la página lee lo que necesita y lo que la pantalla manda se registra con las cifras de «Revisar»", async () => {
    const { yo, persona } = await nuevaPersona();
    const e = await empresaFacturadora(persona);
    comoNavegador(yo, e.empresa);
    const contexto = await contextoDeLaPagina();

    // Lo que lee la página: RI discrimina IVA, y un único punto de venta activo (la sucursal se toma sola: una sola abierta).
    expect(await acciones.discriminaIvaParaEmitir(contexto)).toEqual({
      ok: true,
      dato: { discriminaIva: true },
    });
    const puntos = await acciones.puntosDeVentaParaEmitir(contexto);
    expect(puntos).toEqual({
      ok: true,
      dato: { items: [{ id: e.pv, numero: e.pvNumero, ambiente: "HOMOLOGACION" }] },
    });

    // Lo que escribe la persona en la pantalla: un cliente con DNI y dos renglones con distinta alícuota, una cantidad con coma.
    const renglones = [
      renglon({ id: 1, descripcion: "Hospedaje · 3 noches", cantidad: "1", precio: "75000.00" }),
      renglon({
        id: 2,
        descripcion: "Desayuno",
        cantidad: "1,5",
        precio: "3333.33",
        alicuota: "10.5",
      }),
    ];
    const calculo = calcularLaEmision(renglones);
    expect(calculo).not.toBeNull();
    const pedido = { ...armarElPedido(cliente(), renglones, e.pv, true), clave: randomUUID() };
    const r = await acciones.emitirLaFactura(pedido);
    expect(r).toMatchObject({
      ok: true,
      dato: { estado: "PENDIENTE", yaExistia: false, total: calculo?.total },
    });
    if (!r.ok) return;
    // Pasa a ARCA después de responder (intento inmediato), sin que la persona espere.
    expect(estado.programadas).toHaveLength(1);

    // El Detalle (adonde va la pantalla al terminar) trae lo mismo que mostró «Revisar».
    const detalle = await acciones.verElComprobante({ comprobanteId: r.dato.comprobanteId });
    expect(detalle).toMatchObject({
      ok: true,
      dato: {
        estado: "PENDIENTE",
        tipo: "FACTURA_B",
        importes: { total: calculo?.total },
        receptor: { nombre: "Juan Pérez", documento: { tipo: "DNI", numero: "27345678" } },
      },
    });
    if (!detalle.ok) return;
    expect(detalle.dato.renglones.map((x) => x.importe)).toEqual(calculo?.importes);
    expect(detalle.dato.renglones.map((x) => x.descripcion)).toEqual([
      "Hospedaje · 3 noches",
      "Desayuno",
    ]);
    expect(typeof r.dato.total).toBe("string");
  });

  it("un consumidor final sin identificar, un receptor con CUIT (letra A) y una empresa que no discrimina IVA (letra C)", async () => {
    const { yo, persona } = await nuevaPersona();
    const ri = await empresaFacturadora(persona);
    comoNavegador(yo, ri.empresa);
    const final = await acciones.emitirLaFactura({
      ...armarElPedido(clienteInicial, [renglon({})], ri.pv, true),
      clave: randomUUID(),
    });
    expect(final).toMatchObject({ ok: true, dato: { tipo: "FACTURA_B", total: "121.00" } });
    const conCuit = await acciones.emitirLaFactura({
      ...armarElPedido(
        cliente({
          documento: "CUIT",
          numero: CUIT_DEL_CLIENTE,
          nombre: "Distribuidora Sur SA",
          condicionIva: "RESPONSABLE_INSCRIPTO",
        }),
        [renglon({})],
        ri.pv,
        true,
      ),
      clave: randomUUID(),
    });
    expect(conCuit).toMatchObject({ ok: true, dato: { tipo: "FACTURA_A" } });

    const mono = await empresaFacturadora(persona, { condicionIva: "MONOTRIBUTO" });
    comoNavegador(yo, mono.empresa);
    expect(await acciones.discriminaIvaParaEmitir(await contextoDeLaPagina())).toEqual({
      ok: true,
      dato: { discriminaIva: false },
    });
    // Sin IVA la pantalla no manda alícuota: el servidor lo acepta como letra C.
    const c = await acciones.emitirLaFactura({
      ...armarElPedido(clienteInicial, [renglon({ alicuota: "21" })], mono.pv, false),
      clave: randomUUID(),
    });
    expect(c).toMatchObject({ ok: true, dato: { tipo: "FACTURA_C", total: "121.00" } });
    // Y si la pantalla mandara la alícuota donde no corresponde, el servidor la rechaza.
    expect(
      await acciones.emitirLaFactura({
        ...armarElPedido(clienteInicial, [renglon({})], mono.pv, true),
        clave: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { codigo: "FISCAL_ALICUOTA_EN_LETRA_C" } });
  });

  it("la sucursal de Emitir es la del listado: sin elegir con varias, el servidor pide elegir; elegida una, ofrece sus puntos de venta", async () => {
    const { yo, persona } = await nuevaPersona();
    const e = await empresaFacturadora(persona);
    const norte = (
      await mundo.dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
        [e.empresa],
      )
    ).rows[0]?.id as string;
    const pvNorte = await crearPuntoDeVenta(mundo.dueno, e, {
      numero: 7,
      sucursal: norte,
      activo: true,
    });
    comoNavegador(yo, e.empresa);
    // No pasó por el listado y hay dos sucursales abiertas: no se asume ninguna ni «todas».
    expect(await acciones.puntosDeVentaParaEmitir(await contextoDeLaPagina())).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" },
    });
    // Eligió «Norte» en el listado: ve el punto de venta de Norte y no el de la otra sucursal.
    comoNavegador(yo, e.empresa, norte);
    expect(await acciones.puntosDeVentaParaEmitir(await contextoDeLaPagina())).toEqual({
      ok: true,
      dato: { items: [{ id: pvNorte, numero: 7, ambiente: "HOMOLOGACION" }] },
    });
    // Una cookie con una sucursal que no es de la persona (inventada, o de otra empresa) no vale: como no haber elegido.
    const deOtraEmpresa = (
      await mundo.dueno.query<{ id: string }>(
        "select id from sucursal where empresa_id <> $1 limit 1",
        [e.empresa],
      )
    ).rows[0]?.id;
    for (const ajena of [randomUUID(), deOtraEmpresa ?? randomUUID()]) {
      comoNavegador(yo, e.empresa, ajena);
      expect(await acciones.puntosDeVentaParaEmitir(await contextoDeLaPagina())).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" },
      });
    }
  });

  it("un punto de venta que se ofreció y ya no puede emitir se rechaza con su motivo; no se escribe nada", async () => {
    const { yo, persona } = await nuevaPersona();
    const e = await empresaFacturadora(persona);
    comoNavegador(yo, e.empresa);
    const ofrecido = await acciones.puntosDeVentaParaEmitir(await contextoDeLaPagina());
    expect(ofrecido).toMatchObject({ ok: true, dato: { items: [{ id: e.pv }] } });
    const pedido = (cambios: Partial<RenglonEscrito> = {}, c = clienteInicial) => ({
      ...armarElPedido(c, [renglon(cambios)], e.pv, true),
      clave: randomUUID(),
    });
    // Mientras la persona revisaba, desactivaron el punto de venta.
    await mundo.dueno.query("update punto_de_venta set estado = 'INACTIVO' where id = $1", [e.pv]);
    expect(await acciones.emitirLaFactura(pedido())).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_PUNTO_DE_VENTA_INACTIVO", presentacion: "AVISO" },
    });
    await mundo.dueno.query("update punto_de_venta set estado = 'ACTIVO' where id = $1", [e.pv]);
    // Lo que la pantalla deja pasar y el servidor valida: cantidad cero, receptor sin nombre, alícuota sin elegir.
    expect(await acciones.emitirLaFactura(pedido({ cantidad: "0" }))).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_RENGLON_INVALIDO" },
    });
    expect(await acciones.emitirLaFactura(pedido({}, cliente({ nombre: "  " })))).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_RECEPTOR_INVALIDO" },
    });
    expect(await acciones.emitirLaFactura(pedido({ alicuota: "" }))).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_FALTA_ALICUOTA" },
    });
    expect(await comprobantesDe(e.empresa)).toEqual([]);
  });

  it("sin certificado vigente el punto de venta se ofrece igual y el servidor lo rechaza con su motivo", async () => {
    const { yo, persona } = await nuevaPersona();
    const e = await empresaFacturadora(persona, { sinCertificado: true });
    comoNavegador(yo, e.empresa);
    expect(await acciones.puntosDeVentaParaEmitir(await contextoDeLaPagina())).toMatchObject({
      ok: true,
      dato: { items: [{ id: e.pv }] },
    });
    expect(
      await acciones.emitirLaFactura({
        ...armarElPedido(clienteInicial, [renglon({})], e.pv, true),
        clave: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { codigo: "FISCAL_SIN_CERTIFICADO" } });
    expect(await comprobantesDe(e.empresa)).toEqual([]);
  });

  it("reintento: la misma clave con el mismo pedido es el mismo comprobante; con otros valores, un pedido repetido", async () => {
    const { yo, persona } = await nuevaPersona();
    const e = await empresaFacturadora(persona);
    comoNavegador(yo, e.empresa);
    const clave = randomUUID();
    const pedido = { ...armarElPedido(clienteInicial, [renglon({})], e.pv, true), clave };
    const primera = await acciones.emitirLaFactura(pedido);
    expect(primera).toMatchObject({ ok: true, dato: { comprobanteId: clave, yaExistia: false } });
    expect(await acciones.emitirLaFactura(pedido)).toMatchObject({
      ok: true,
      dato: { comprobanteId: clave, yaExistia: true },
    });
    expect(
      await acciones.emitirLaFactura({
        ...armarElPedido(clienteInicial, [renglon({ precio: "242.00" })], e.pv, true),
        clave,
      }),
    ).toMatchObject({ ok: false, error: { codigo: "FISCAL_PEDIDO_REPETIDO" } });
    expect(await comprobantesDe(e.empresa)).toHaveLength(1);
  });

  it("con el catálogo REAL la facturación sigue en desarrollo: ni las lecturas de la página ni emitir pasan", async () => {
    const { yo, persona } = await nuevaPersona();
    const e = await empresaFacturadora(persona);
    comoNavegador(yo, e.empresa);
    const contexto = await contextoDeLaPagina();
    const conCatalogoSimulado = estado.fiscal;
    const emision: ProveedorDeEmision = { para: (_e, _em, ambiente) => arca[ambiente] };
    estado.fiscal = {
      web: armarWeb(conexiones, { reglas: REGLAS_DE_EMPRESA, emision }),
      trabajos: conCatalogoSimulado?.trabajos,
    };
    try {
      const enDesarrollo = { ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } };
      expect(await acciones.discriminaIvaParaEmitir(contexto)).toMatchObject(enDesarrollo);
      expect(await acciones.puntosDeVentaParaEmitir(contexto)).toMatchObject(enDesarrollo);
      expect(
        await acciones.emitirLaFactura({
          ...armarElPedido(clienteInicial, [renglon({})], e.pv, true),
          clave: randomUUID(),
        }),
      ).toMatchObject(enDesarrollo);
      expect(await comprobantesDe(e.empresa)).toEqual([]);
    } finally {
      estado.fiscal = conCatalogoSimulado;
    }
  });

  it("empresa ajena y permisos: el punto de venta de otra empresa no existe, un `empresaId` del pedido no cuenta y el operador de otra sucursal no emite", async () => {
    const { yo, persona } = await nuevaPersona();
    const a = await empresaFacturadora(persona);
    const b = await empresaFacturadora(persona);
    comoNavegador(yo, a.empresa);
    expect(
      await acciones.emitirLaFactura({
        ...armarElPedido(clienteInicial, [renglon({})], b.pv, true),
        clave: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { codigo: "FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO" } });
    const propio = await acciones.emitirLaFactura({
      ...armarElPedido(clienteInicial, [renglon({})], a.pv, true),
      empresaId: b.empresa,
      emisorId: b.emisor,
      clave: randomUUID(),
    });
    expect(propio.ok).toBe(true);
    expect(await comprobantesDe(a.empresa)).toHaveLength(1);
    expect(await comprobantesDe(b.empresa)).toEqual([]);

    // Un operador asignado a otra sucursal ve y emite solo desde las suyas (D-41).
    const { yo: otro, persona: operador } = await nuevaPersona();
    await crearMembresiaDeBase(mundo.dueno, a.empresa, operador, "OPERADOR");
    const sur = (
      await mundo.dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Sur') returning id",
        [a.empresa],
      )
    ).rows[0]?.id as string;
    await crearAsignacionDeBase(mundo.dueno, a.empresa, operador, sur);
    comoNavegador(otro, a.empresa, sur);
    expect(await acciones.puntosDeVentaParaEmitir(await contextoDeLaPagina())).toEqual({
      ok: true,
      dato: { items: [] },
    });
    const rechazo = await acciones.emitirLaFactura({
      ...armarElPedido(clienteInicial, [renglon({})], a.pv, true),
      clave: randomUUID(),
    });
    expect(rechazo).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" },
    });
    expect(await comprobantesDe(a.empresa)).toHaveLength(1);
  });
});
