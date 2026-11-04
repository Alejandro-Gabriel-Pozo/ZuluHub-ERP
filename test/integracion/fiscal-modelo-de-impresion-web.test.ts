import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { qrDeFacturaComoSvg } from "../../src/adaptadores/qr/qr-de-factura";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { armarConexiones, type Conexiones, type TxDeApp } from "../../src/composicion/conexiones";
import {
  clavesDeLaValidacionInicial,
  emitirFactura,
  verComprobante,
  type DependenciasDeFacturacionWeb,
} from "../../src/composicion/facturacion-web";
import { verModeloDeImpresion } from "../../src/composicion/modelo-de-impresion-web";
import { armarTrabajos } from "../../src/composicion/trabajos";
import { armarWeb } from "../../src/composicion/web";
import {
  crearConsultasDeFacturacion,
  type MarcaParaImprimir,
  type ProveedorDeEmision,
} from "../../src/modulos/fiscal/publico";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearEscenarioDeCasos, type EscenarioDeCasos } from "./facturacion-casos-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import {
  asignarPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * El modelo de impresión que recibe la ruta de impresión, con la composición REAL (conexiones, web y trabajos sobre la base de verdad con
 * los roles limitados y ARCA falso). Lo que se prueba es el CABLEADO de `verModeloDeImpresion`, no el armado del modelo (eso es del
 * dominio y tiene sus golden):
 *  - sin sesión, sin permiso o con el módulo sin activar, no sale nada; otra empresa no lo ve (se dice como uno que no existe) y una
 *    sucursal que la persona no tiene tampoco (el alcance lo decide el servidor sobre el comprobante, no el navegador);
 *  - un comprobante que no está autorizado, una versión de representación que no se sabe dibujar o una entrada inválida salen por el
 *    camino común (error con referencia, sin código ni texto nuevo);
 *  - el éxito trae el modelo y el QR dibujado desde su url; repetir la lectura da lo mismo y no escribe nada;
 *  - ningún valor secreto (clave cifrada, pedido y certificado, cadenas de conexión, clave del contexto) sale en la respuesta.
 * La MARCA de impresión es hoy la VACÍA para toda empresa (D-112: sin logo, sin color y sin nombre de fantasía; `conexiones.ts`): lo que ofrece
 * la web (`dReal`) se prueba tal cual, y para contar cuántas veces se pide la marca (y ver que viaja en el modelo) otras pruebas le dan una a
 * la transacción de la consulta.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const MARCA: MarcaParaImprimir = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: null,
  colorPrincipal: null,
};

const facturaCruda = (e: Pick<EscenarioDeCasos, "pv">) => ({
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
  renglones: [
    {
      descripcion: "Medialunas",
      cantidad: "1",
      precioUnitario: "121",
      descuento: null,
      alicuota: "21",
    },
  ],
});

describe.skipIf(base === null)("el modelo de impresión en la web, con la composición real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let trabajos: ReturnType<typeof armarTrabajos>;
  const registrados: string[] = [];
  const marcasPedidas: string[] = [];
  const arca = { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: new EmisionFalsa() };
  const emision: ProveedorDeEmision = { para: (_empresa, _emisor, ambiente) => arca[ambiente] };
  /** Lo que ofrece la web hoy: con la marca SIN cablear. */
  let dReal: DependenciasDeFacturacionWeb;
  /** Lo mismo, pero la transacción de la consulta lleva una marca (para ver el éxito). */
  let dConMarca: DependenciasDeFacturacionWeb;
  /** Con marca y con el catálogo real de módulos. */
  let dConCatalogoReal: DependenciasDeFacturacionWeb;

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
    const web = armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION, emision });
    trabajos = armarTrabajos(conexiones, {
      emision,
      alRegistrarProblema: (p) => registrados.push(`${p.fase}: ${p.mensaje}`),
    });
    const respuesta = { registrar: (x: string) => registrados.push(x) };
    dReal = {
      casosDeUso: web.casosDeUsoDeFacturacion,
      consultas: web.consultasDeFacturacion,
      respuesta,
    };
    const transacciones = conexiones.transaccionesDeApp();
    /** Las transacciones de la aplicación con una marca que da la prueba (cuenta cada vez que se la pide). */
    const conMarca = (t: typeof transacciones) => ({
      ejecutar: <T, E>(
        opciones: Parameters<typeof t.ejecutar>[0],
        trabajo: (tx: TxDeApp) => Promise<Resultado<T, E>>,
      ) =>
        t.ejecutar(opciones, (tx: TxDeApp) =>
          trabajo({
            ...tx,
            marca: {
              deLaEmpresa: (empresa) => {
                marcasPedidas.push(empresa);
                return Promise.resolve(MARCA);
              },
            },
          }),
        ),
    });
    const consultasConMarca = crearConsultasDeFacturacion({
      reglas: REGLAS_CON_FACTURACION,
      transacciones: conMarca(transacciones),
    });
    dConMarca = { ...dReal, consultas: () => consultasConMarca };
    // El catálogo REAL (`facturacion` disponible, sin activar para nadie), también con marca para llegar a lo que sigue del guard.
    const consultasConCatalogoReal = crearConsultasDeFacturacion({
      reglas: REGLAS_DE_EMPRESA,
      transacciones: conMarca(transacciones),
    });
    dConCatalogoReal = { ...dReal, consultas: () => consultasConCatalogoReal };
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
  const comoPersonaDe = (e: EscenarioDeCasos) => e.como(ahora());

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

  /** Otra persona de esa empresa con ese rol y esas sucursales asignadas. */
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

  /** Emite y, con `validar`, corre el manejador de la cola: el comprobante queda AUTORIZADO (o PENDIENTE). */
  async function emitir(e: EscenarioDeCasos, validar = true) {
    const emitido = await emitirFactura(dReal, comoPersonaDe(e), facturaCruda(e));
    if (!emitido.ok) throw new Error(`no se pudo emitir: ${JSON.stringify(emitido.error)}`);
    if (validar) {
      await trabajos
        .procesador()
        .despacharPorClaves(
          empresaId(e.empresa),
          clavesDeLaValidacionInicial(emitido.dato.comprobanteId),
          ahora(),
        );
    }
    return emitido.dato.comprobanteId;
  }

  const conteos = async () =>
    (
      await filas<{ n: string }>(
        `select (select count(*) from comprobante) || '/' || (select count(*) from intento_arca) || '/' ||
                (select count(*) from trabajo) || '/' || (select count(*) from auditoria_empresa) as n`,
      )
    )[0]?.n;

  // ===============================================================================================
  describe("el éxito", () => {
    it("trae el modelo del comprobante autorizado y el QR dibujado desde su url", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e);
      const detalle = await verComprobante(dConMarca, comoPersonaDe(e), { comprobanteId: id });
      const r = await verModeloDeImpresion(dConMarca, comoPersonaDe(e), { comprobanteId: id });
      expect(r.ok).toBe(true);
      if (!r.ok || !detalle.ok) return;
      const { modelo, qrSvg } = r.dato;
      expect(Object.keys(r.dato).sort()).toEqual(["modelo", "qrSvg"]);
      // Lo que se imprime es lo que se guardó: número, CAE y total del detalle, la marca que dio la consulta.
      expect(modelo.fiscal.numero).toBe(detalle.dato.numero);
      expect(modelo.fiscal.cae).toBe(detalle.dato.cae);
      expect(modelo.fiscal).toMatchObject({ rotulo: "FACTURA", letra: "B" });
      expect(modelo.totales).toMatchObject({ letra: "B", total: "121.00" });
      expect(modelo.marca).toEqual(MARCA);
      expect(modelo.leyendas).toEqual(["HOMOLOGACIÓN — SIN VALIDEZ FISCAL"]);
      expect(qrSvg).toBe(qrDeFacturaComoSvg(modelo.qr.url));
      expect(qrSvg.startsWith("<svg ")).toBe(true);
      expect(marcasPedidas).toContain(e.empresa);
    });

    it("con la marca de la composición real (vacía, D-112): los tres campos en null, modelo y QR correctos, y nada de la marca del producto", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e);
      // La marca del producto (a la que pertenece el tenant) tiene una versión vigente con nombre, logo y color: no debe llegar a la hoja.
      const producto = await crearVersionDeMarcaConfirmada(dueno, await marcaPrincipal(dueno), {
        nombreVisible: "Marca-del-Producto-Canario",
        logo: "/marcas/canario/logo.png",
        tema: { primary: "#112233" },
      });
      expect(producto.numero).toBeGreaterThan(0);
      const detalle = await verComprobante(dReal, comoPersonaDe(e), { comprobanteId: id });
      const r = await verModeloDeImpresion(dReal, comoPersonaDe(e), { comprobanteId: id });
      expect(r.ok).toBe(true);
      if (!r.ok || !detalle.ok) return;
      expect(r.dato.modelo.marca).toEqual({
        nombreDeFantasia: null,
        logoUrl: null,
        colorPrincipal: null,
      });
      expect(r.dato.modelo.fiscal.numero).toBe(detalle.dato.numero);
      expect(r.dato.modelo.fiscal.cae).toBe(detalle.dato.cae);
      expect(r.dato.modelo.totales).toMatchObject({ letra: "B", total: "121.00" });
      expect(r.dato.qrSvg).toBe(qrDeFacturaComoSvg(r.dato.modelo.qr.url));
      const salida = JSON.stringify(r);
      for (const ajeno of [
        "Marca-del-Producto-Canario",
        "canario",
        "#112233",
        "Pedernal",
        "pedernal",
      ]) {
        expect(salida, ajeno).not.toContain(ajeno);
      }
    });

    it("repetir la lectura da lo mismo y no escribe nada (sin auditoría, sin trabajos, sin intentos)", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e);
      const antes = await conteos();
      const primera = await verModeloDeImpresion(dConMarca, comoPersonaDe(e), {
        comprobanteId: id,
      });
      const segunda = await verModeloDeImpresion(dConMarca, comoPersonaDe(e), {
        comprobanteId: id,
      });
      const tercera = await verModeloDeImpresion(dConMarca, comoPersonaDe(e), {
        comprobanteId: id,
      });
      expect(primera.ok).toBe(true);
      expect(segunda).toEqual(primera);
      expect(tercera).toEqual(primera);
      expect(await conteos()).toBe(antes);
    });

    it("la respuesta no lleva ningún valor secreto: ni la clave cifrada del certificado, ni el pedido, ni cadenas de conexión", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e);
      const salida = JSON.stringify(
        await verModeloDeImpresion(dConMarca, comoPersonaDe(e), { comprobanteId: id }),
      );
      // Sanidad de la prueba: lo que SÍ se imprime está, así que mirar el texto sirve.
      expect(salida).toContain("Medialunas");
      const certificados = await filas<{
        clave: string;
        nonce: string;
        etiqueta: string;
        pedido: string;
        pem: string | null;
      }>(
        `select encode(clave_cifrada, 'hex') as clave, encode(clave_nonce, 'hex') as nonce,
                encode(clave_etiqueta, 'hex') as etiqueta, pedido_pem as pedido, certificado_pem as pem
           from certificado_arca where empresa_id = $1`,
        [e.empresa],
      );
      expect(certificados.length).toBeGreaterThan(0);
      const secretos = [
        ...certificados.flatMap((c) => [c.clave, c.nonce, c.etiqueta, c.pedido, c.pem ?? ""]),
        propia.base.dueno,
        propia.base.app,
        propia.base.trabajos,
        propia.base.clave.secreto.toString("hex"),
        e.emisor,
        e.persona,
        e.empresa,
      ].filter((s) => s.length > 0);
      for (const secreto of secretos) expect(salida, secreto.slice(0, 12)).not.toContain(secreto);
    });
  });

  // ===============================================================================================
  describe("quién lo puede pedir", () => {
    it("alguien sin membresía en la empresa no recibe nada: el motivo sale del guard", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e);
      const extraño = await crearPersonaDeBase(dueno);
      const contexto: ContextoOperativo = {
        ...comoEmpresa(empresaId(e.empresa), personaId(extraño.id)),
        ahora: ahora(),
      };
      const antes = marcasPedidas.length;
      const r = await verModeloDeImpresion(dConMarca, contexto, { comprobanteId: id });
      expect(r).toMatchObject({ ok: false, error: { presentacion: "POR_QUE_NO_PUEDO" } });
      expect(JSON.stringify(r)).not.toContain("Medialunas");
      expect(marcasPedidas.length).toBe(antes);
    });

    it("con el catálogo REAL el módulo es disponible pero no nace activo: sin activarlo en la empresa, MODULO_NO_ACTIVO", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e);
      const sinActivar = await crearEscenarioDeCasos(dueno, propia.base, { rol: "OPERADOR" });
      const d = dConCatalogoReal;
      expect(
        await verModeloDeImpresion(d, comoPersonaDe(sinActivar), { comprobanteId: id }),
      ).toMatchObject({ ok: false, error: { codigo: "MODULO_NO_ACTIVO" } });
      // Activado en la empresa, pasa el guard del catálogo real.
      expect(await verModeloDeImpresion(d, comoPersonaDe(e), { comprobanteId: id })).toMatchObject({
        ok: true,
      });
    });

    it("otra empresa no lo ve: se dice igual que un comprobante que no existe, y no se lee su marca", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      const deA = await emitir(a);
      const antes = marcasPedidas.length;
      const ajeno = await verModeloDeImpresion(dConMarca, comoPersonaDe(b), { comprobanteId: deA });
      const noExiste = await verModeloDeImpresion(dConMarca, comoPersonaDe(b), {
        comprobanteId: "99999999-9999-4999-8999-999999999999",
      });
      expect(ajeno).toEqual(noExiste);
      expect(ajeno).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" },
      });
      expect(marcasPedidas.length).toBe(antes);
      // Un `empresaId` del pedido no cambia nada: la empresa sale del contexto.
      expect(
        await verModeloDeImpresion(dConMarca, comoPersonaDe(b), {
          comprobanteId: deA,
          empresaId: a.empresa,
        }),
      ).toEqual(noExiste);
    });

    it("el alcance de sucursal lo decide el servidor: quien no tiene asignada la del comprobante no lo ve (nunca se asume «todas»); el gerente y el asignado, sí", async () => {
      const e = await empresaConFacturacion("GERENTE");
      const id = await emitir(e);
      const otra = (
        await filas<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
          [e.empresa],
        )
      )[0]?.id as string;
      const sinAsignar = await persona(e, "OPERADOR");
      const deOtraSucursal = await persona(e, "OPERADOR", [otra]);
      const asignado = await persona(e, "OPERADOR", [e.sucursal]);
      const noExiste = await verModeloDeImpresion(dConMarca, sinAsignar, {
        comprobanteId: "99999999-9999-4999-8999-999999999999",
      });
      const antes = marcasPedidas.length;
      for (const contexto of [sinAsignar, deOtraSucursal]) {
        expect(await verModeloDeImpresion(dConMarca, contexto, { comprobanteId: id })).toEqual(
          noExiste,
        );
      }
      expect(marcasPedidas.length).toBe(antes);
      for (const contexto of [asignado, comoPersonaDe(e)]) {
        expect(
          await verModeloDeImpresion(dConMarca, contexto, { comprobanteId: id }),
        ).toMatchObject({
          ok: true,
        });
      }
    });
  });

  // ===============================================================================================
  describe("lo que no se puede imprimir sale por el camino común", () => {
    const inesperado = {
      ok: false,
      error: { codigo: "ERROR_INTERNO", referencia: expect.stringMatching(/^PD-/) as string },
    };

    it("un comprobante que todavía no está autorizado: error con referencia, sin el código en la respuesta, y sin leer la marca", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e, false);
      const antes = marcasPedidas.length;
      const registros = registrados.length;
      const r = await verModeloDeImpresion(dConMarca, comoPersonaDe(e), { comprobanteId: id });
      expect(r).toMatchObject(inesperado);
      expect(JSON.stringify(r)).not.toContain("NO_AUTORIZADO");
      expect(registrados.slice(registros).join("\n")).toContain("COMPROBANTE_NO_AUTORIZADO");
      expect(marcasPedidas.length).toBe(antes);
    });

    it("una versión de representación que este código no sabe dibujar: error con referencia, sin imprimir a medias", async () => {
      const e = await empresaConFacturacion();
      const id = await emitir(e);
      // El contenido de un comprobante no se puede modificar (disparador): se lo deja como lo dejaría una versión futura del código.
      await dueno.query("begin");
      try {
        await dueno.query("alter table comprobante disable trigger user");
        await dueno.query("update comprobante set version_de_representacion = 99 where id = $1", [
          id,
        ]);
        await dueno.query("alter table comprobante enable trigger user");
        await dueno.query("commit");
      } catch (error) {
        await dueno.query("rollback");
        throw error;
      }
      const registros = registrados.length;
      const r = await verModeloDeImpresion(dConMarca, comoPersonaDe(e), { comprobanteId: id });
      expect(r).toMatchObject(inesperado);
      expect(JSON.stringify(r)).not.toContain("VERSION_DE_REPRESENTACION");
      expect(registrados.slice(registros).join("\n")).toContain(
        "VERSION_DE_REPRESENTACION_DESCONOCIDA",
      );
    });

    it("una entrada inválida se rechaza antes de la base: FISCAL_DATOS_INVALIDOS y ninguna lectura", async () => {
      const antes = marcasPedidas.length;
      for (const crudo of [
        undefined,
        null,
        {},
        { comprobanteId: "no-es-un-id" },
        { comprobanteId: 7 },
      ]) {
        expect(
          await verModeloDeImpresion(
            dConMarca,
            comoPersonaDe(await empresaConFacturacion()),
            crudo,
          ),
        ).toMatchObject({ ok: false, error: { codigo: "FISCAL_DATOS_INVALIDOS" } });
      }
      expect(marcasPedidas.length).toBe(antes);
    });
  });
});
