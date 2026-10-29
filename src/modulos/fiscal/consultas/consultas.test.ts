import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  facturaArmada,
  fecha,
  renglon,
} from "../../../../test/utilidades/facturacion";
import { CUIT_B, EMPRESA, OTRA_EMPRESA } from "../../../../test/utilidades/fiscal";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { Transacciones } from "../../../puertos/transacciones";
import { modeloDeImpresion, type MarcaParaImprimir } from "../dominio/modelo-de-impresion";
import type { NotaParaAcreditar } from "../dominio/acreditacion";
import type {
  FiltroDeListado,
  NotaQueCita,
  PaginaDeFilas,
} from "../persistencia/lecturas-de-comprobantes";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import type { IntentoDeArca } from "../persistencia/repositorio-de-intentos";
import type { SerieGuardada } from "../persistencia/repositorios";
import { comprobanteId, intentoId, versionId, type ComprobanteId } from "../publico";
import { crearConsultasDeFacturacion } from "./consultas";
import type { TxDeConsultasDeFacturacion } from "./contrato";
import { claveDePagina } from "./criterios-de-listado";
import { paraImprimir } from "./modelo-de-impresion";

/**
 * Las consultas del facturador contra repositorios en memoria: qué piden (siempre con la empresa del contexto),
 * qué devuelven y qué no. El guard está en `guard-primero.test.ts`; la base real, en
 * `test/integracion/facturacion-consultas.test.ts`.
 */

const contexto = (empresaId: EmpresaId = EMPRESA): ContextoOperativo => ({
  tipo: "OPERATIVO",
  empresaId,
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
});

const REGLAS: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

const ID = comprobanteId("0192f3a4-5b6c-7d8e-9f01-23456789abcd");
const MARCA: MarcaParaImprimir = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: "/marcas/zulu/logo.png",
  colorPrincipal: "#8b4513",
};

/** Un comprobante `AUTORIZADO` completo, como lo lee el repositorio de comprobantes. */
function guardado(cambios: Partial<ComprobanteGuardado> = {}): ComprobanteGuardado {
  const c = facturaArmada(consumidorFinal, [
    renglon("1210.00", "1", "21", null, "Torta"),
    renglon("1050.00", "1", "10.5", null, "Medialunas"),
  ]);
  return {
    id: ID,
    empresaId: EMPRESA,
    emisorId: c.emisorId,
    puntoDeVentaId: c.puntoDeVentaId,
    ambiente: "HOMOLOGACION",
    origen: c.origen,
    clase: "FACTURA",
    tipo: "FACTURA_B",
    concepto: "PRODUCTOS",
    servicio: null,
    modoDePrecio: "IVA_INCLUIDO",
    importes: {
      total: c.total,
      neto: c.neto,
      iva: c.iva,
      exento: importeDesdeTexto(ARS, "0.00"),
      noGravado: importeDesdeTexto(ARS, "0.00"),
    },
    emisor: {
      cuit: CUIT_B,
      razonSocial: "Panadería Zulu SRL",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      domicilioFiscal: "Av. Corrientes 1234, CABA",
      inicioDeActividades: fecha("2019-03-01"),
      iibbNumero: "901-123456-7",
      iibbCondicion: "LOCAL",
      puntoDeVentaNumero: 3,
      domicilioDelPuntoDeVenta: "Calle Falsa 123, CABA",
      datosFiscalesId: versionId("v-1"),
    },
    receptor: consumidorFinal,
    asociado: null,
    motivo: null,
    renglones: c.renglones.map((r, i) => ({ ...r, posicion: i + 1 })),
    desglose: c.desglose,
    estado: "AUTORIZADO",
    envios: 1,
    numeroReservado: 11n,
    fechaEmision: fecha("2026-10-13"),
    numero: 11n,
    cae: "70417054367476",
    caeVence: fecha("2026-10-23"),
    autorizadoEn: new Date("2026-10-13T15:00:00.000Z"),
    resueltoPor: "RESPUESTA",
    motivoDeDescarte: null,
    huella: "huella-interna",
    versionDeRepresentacion: 1,
    creadoPor: personaId("p-1"),
    creadoEn: new Date("2026-10-13T14:59:00.000Z"),
    version: 4,
    ...cambios,
  };
}

const intento = (cambios: Partial<IntentoDeArca>): IntentoDeArca => ({
  id: intentoId("i-1"),
  empresaId: EMPRESA,
  comprobanteId: ID,
  operacion: "AUTORIZAR",
  numero: 11n,
  desenlace: "AUTORIZADO",
  mensajes: [{ clase: "OBSERVACION", codigo: 10237, texto: "Observación" }],
  respuesta: "<respuesta-cruda/>",
  huellaDelPedido: "huella-del-pedido",
  iniciadoEn: new Date("2026-10-13T15:00:00.000Z"),
  duracionEnMs: 300,
  ...cambios,
});

const nota = (cambios: Partial<NotaQueCita> = {}): NotaQueCita => ({
  id: comprobanteId("n-1"),
  tipo: "NOTA_CREDITO_B",
  puntoDeVentaNumero: 3,
  numero: 12n,
  fecha: fecha("2026-10-14"),
  total: importeDesdeTexto(ARS, "121.00"),
  estado: "AUTORIZADO",
  ...cambios,
});

const serie = (cambios: Record<string, unknown> = {}): SerieGuardada => ({
  empresaId: EMPRESA,
  puntoDeVentaId: guardado().puntoDeVentaId,
  emisorId: guardado().emisorId,
  tipo: "FACTURA_B",
  estado: "LIBRE",
  ultimoNumero: 11n,
  version: 7,
  ambiente: "HOMOLOGACION",
  ...cambios,
});

type Llamadas = {
  comprobante: unknown[][];
  notas: unknown[][];
  /** Una entrada por cada vez que el listado pidió las notas de su página. */
  notasDeLaPagina: unknown[][];
  intentos: unknown[][];
  series: unknown[][];
  puntosDeVenta: unknown[][];
  /** Una entrada por cada vez que se leyeron las sucursales de la empresa. */
  sucursales: unknown[][];
};

type Datos = Readonly<{
  comprobante?: ComprobanteGuardado | null;
  notas?: readonly NotaQueCita[];
  /** Lo que citan a cada fila del listado (`notasQueCitanA`). */
  notasDeLaPagina?: ReadonlyMap<ComprobanteId, readonly NotaParaAcreditar[]>;
  intentos?: readonly IntentoDeArca[];
  serie?: SerieGuardada | null;
  pagina?: PaginaDeFilas;
  puntosDeVenta?: readonly Readonly<{ numero: number; activo: boolean }>[];
  alcance?: AlcanceDeSucursales;
  /** Las sucursales abiertas de la empresa; por defecto una sola (`SUCURSAL_UNICA`). */
  sucursalesActivas?: readonly SucursalId[];
  /** Las sucursales cerradas de la empresa (D-37); por defecto ninguna. */
  sucursalesCerradas?: readonly SucursalId[];
  /** A qué sucursal pertenece el comprobante que se pide (D-39); por defecto `SUCURSAL_UNICA`. */
  sucursalDelComprobante?: SucursalId | null;
}>;

/** La sucursal que tiene la empresa de prueba cuando el caso no dice otra cosa. */
const SUCURSAL_UNICA = sucursalId("s-unica");
/** El nombre que la empresa de prueba le pone a cada sucursal (se deriva del id para distinguirlas en las expectativas). */
const nombreDe = (id: SucursalId): string => `Sucursal ${id}`;

/** Las consultas sobre una transacción en memoria; devuelve además todo lo que se pidió. */
function armar(datos: Datos = {}) {
  const filtros: { empresa: EmpresaId; filtro: FiltroDeListado }[] = [];
  const llamadas: Llamadas = {
    comprobante: [],
    notas: [],
    notasDeLaPagina: [],
    intentos: [],
    series: [],
    puntosDeVenta: [],
    sucursales: [],
  };
  const marcasPedidas: EmpresaId[] = [];
  const tx: TxDeConsultasDeFacturacion = {
    comprobantes: {
      obtener: (...args) => {
        llamadas.comprobante.push(args);
        return Promise.resolve(datos.comprobante === undefined ? guardado() : datos.comprobante);
      },
    },
    lecturas: {
      listar: (empresa, filtro) => {
        filtros.push({ empresa, filtro });
        return Promise.resolve(datos.pagina ?? { filas: [], hayMas: false });
      },
      notasQueCitan: (...args) => {
        llamadas.notas.push(args);
        return Promise.resolve(datos.notas ?? []);
      },
      notasQueCitanA: (...args) => {
        llamadas.notasDeLaPagina.push(args);
        return Promise.resolve(datos.notasDeLaPagina ?? new Map());
      },
      sucursalDelComprobante: () =>
        Promise.resolve(
          datos.sucursalDelComprobante === undefined
            ? SUCURSAL_UNICA
            : datos.sucursalDelComprobante,
        ),
      puntosDeVentaDeLaSucursal: (...args) => {
        llamadas.puntosDeVenta.push(args);
        return Promise.resolve(datos.puntosDeVenta ?? []);
      },
    },
    // El estado de los certificados tiene sus pruebas en `estado-de-certificados.test.ts`: acá nadie lo toca.
    emisores: {
      obtener: () => Promise.reject(new Error("estas consultas no leen emisores")),
      delPrincipal: () => Promise.reject(new Error("estas consultas no leen emisores")),
    },
    // La configuración fiscal tiene sus pruebas en `configuracion-fiscal.test.ts`: acá nadie la toca.
    datosFiscales: {
      obtenerBorrador: () => Promise.reject(new Error("estas consultas no leen datos fiscales")),
      confirmadas: () => Promise.reject(new Error("estas consultas no leen datos fiscales")),
    },
    domicilios: {
      obtener: () => Promise.reject(new Error("estas consultas no leen domicilios")),
      obtenerVarios: () => Promise.reject(new Error("estas consultas no leen domicilios")),
    },
    puntosDeVenta: {
      listarDelEmisor: () => Promise.reject(new Error("estas consultas no leen puntos de venta")),
    },
    lecturasDeCertificados: {
      actualesDelEmisor: () => Promise.reject(new Error("estas consultas no leen certificados")),
    },
    intentos: {
      delComprobante: (...args) => {
        llamadas.intentos.push(args);
        return Promise.resolve([...(datos.intentos ?? [])]);
      },
    },
    series: {
      obtener: (...args) => {
        llamadas.series.push(args);
        return Promise.resolve(datos.serie === undefined ? serie() : datos.serie);
      },
      hayNumerosUsadosDelPuntoDeVenta: () =>
        Promise.reject(new Error("estas consultas no miran si se usaron números")),
    },
    sucursales: {
      listar: (...args) => {
        llamadas.sucursales.push(args);
        return Promise.resolve([
          ...(datos.sucursalesActivas ?? [SUCURSAL_UNICA]).map((id) => ({
            id,
            nombre: nombreDe(id),
            activa: true,
          })),
          ...(datos.sucursalesCerradas ?? []).map((id) => ({
            id,
            nombre: nombreDe(id),
            activa: false,
          })),
        ]);
      },
    },
    marca: {
      deLaEmpresa: (empresa) => {
        marcasPedidas.push(empresa);
        return Promise.resolve(MARCA);
      },
    },
    autorizacion: {
      delActor: () =>
        Promise.resolve({
          rol: "OPERADOR",
          modulosActivados: ["facturacion"],
          modulosHabilitados: ["facturacion"],
        }),
      sucursalesDelActor: () => Promise.resolve(datos.alcance ?? "TODAS"),
    },
  };
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (opciones, trabajo) => {
      expect(opciones.aislamiento).toBe("read committed");
      expect(opciones.soloLectura).toBe(true);
      return trabajo(tx);
    },
  };
  return {
    consultas: crearConsultasDeFacturacion({ transacciones, reglas: REGLAS }),
    filtros,
    llamadas,
    marcasPedidas,
  };
}

function exito<T, E>(r: { ok: true; valor: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe("listarComprobantes", () => {
  const fila = (n: number) => ({
    id: comprobanteId(`0192f3a4-5b6c-7d8e-9f01-2345678900${String(n).padStart(2, "0")}`),
    tipo: "FACTURA_B" as const,
    puntoDeVentaNumero: 3,
    numero: n % 2 === 0 ? BigInt(n) : null,
    fecha: fecha("2026-10-13"),
    receptorNombre: n === 1 ? null : `Cliente ${n}`,
    receptorDocumento:
      n === 1
        ? ({ tipo: "SIN_IDENTIFICAR" } as const)
        : ({ tipo: "DNI", numero: `3000000${n}` } as const),
    total: importeDesdeTexto(ARS, `${n}00.50`),
    estado: n % 2 === 0 ? ("AUTORIZADO" as const) : ("PENDIENTE" as const),
    ambiente: "PRODUCCION" as const,
    creadoEn: `2026-10-13T12:00:0${n}.123456Z`,
  });

  describe("la sucursal (D-18)", () => {
    const A = sucursalId("s-a");
    const B = sucursalId("s-b");
    const C = sucursalId("s-c");
    const listarCon = async (
      datos: Datos,
      sucursalElegida: SucursalId | null,
    ): Promise<{
      resultado: Awaited<ReturnType<ReturnType<typeof armar>["consultas"]["listarComprobantes"]>>;
      lecturas: number;
      filtro: FiltroDeListado | undefined;
    }> => {
      const { consultas, filtros } = armar(datos);
      const resultado = await consultas.listarComprobantes(contexto(), { sucursalElegida });
      return { resultado, lecturas: filtros.length, filtro: filtros[0]?.filtro };
    };

    it("con UNA sucursal a elegir y sin elección, la toma sola y filtra por ella", async () => {
      const r = await listarCon({ sucursalesActivas: [B] }, null);
      expect(r.resultado.ok).toBe(true);
      expect(r.filtro?.sucursalId).toBe(B);
    });

    it("la respuesta dice qué sucursal usó: id, nombre y si está abierta, sea la elegida o la única", async () => {
      const elegida = await listarCon({ sucursalesActivas: [A, B] }, B);
      expect(exito(elegida.resultado).sucursal).toEqual({
        id: B,
        nombre: nombreDe(B),
        activa: true,
      });
      const unica = await listarCon({ sucursalesActivas: [A], sucursalesCerradas: [C] }, null);
      expect(exito(unica.resultado).sucursal).toEqual({ id: A, nombre: nombreDe(A), activa: true });
    });

    it("el nombre y si está abierta salen de la MISMA lectura de sucursales que la verifica: una sola, sea cual sea la página", async () => {
      const { consultas, llamadas } = armar({
        sucursalesActivas: [A, B],
        pagina: { filas: [fila(1), fila(2), fila(3)], hayMas: false },
      });
      exito(await consultas.listarComprobantes(contexto(), { sucursalElegida: B }));
      expect(llamadas.sucursales).toEqual([[contexto().empresaId]]);
    });

    it("una sucursal CERRADA se informa como no activa, con su nombre (D-37)", async () => {
      const r = await listarCon({ sucursalesActivas: [A], sucursalesCerradas: [C] }, C);
      expect(exito(r.resultado).sucursal).toEqual({ id: C, nombre: nombreDe(C), activa: false });
    });

    it("con varias a elegir y sin elección, SUCURSAL_NO_ELEGIDA y no lee ningún comprobante", async () => {
      const r = await listarCon({ sucursalesActivas: [A, B] }, null);
      expect(r.resultado).toEqual({ ok: false, error: "SUCURSAL_NO_ELEGIDA" });
      expect(r.lecturas).toBe(0);
    });

    it("con varias a elegir y una elegida de ellas, filtra por esa y por ninguna otra", async () => {
      const r = await listarCon({ sucursalesActivas: [A, B, C] }, B);
      expect(r.resultado.ok).toBe(true);
      expect(r.filtro?.sucursalId).toBe(B);
    });

    it("con una sola a elegir y OTRA elegida (vieja, desactivada, ajena): fuera de alcance, no se reemplaza en silencio", async () => {
      const r = await listarCon({ sucursalesActivas: [A] }, C);
      expect(r.resultado).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      expect(r.lecturas).toBe(0);
    });

    it("una sucursal CERRADA se puede elegir para ver su historial (D-37): gerente y administrador, cualquiera", async () => {
      const r = await listarCon(
        { sucursalesActivas: [A, B], sucursalesCerradas: [C], alcance: "TODAS" },
        C,
      );
      expect(r.resultado.ok).toBe(true);
      expect(r.filtro?.sucursalId).toBe(C);
    });

    it("sin elegir, una sola ABIERTA se toma sola aunque haya cerradas; solo cerradas o varias abiertas obligan a elegir", async () => {
      expect(
        (await listarCon({ sucursalesActivas: [A], sucursalesCerradas: [B, C] }, null)).filtro
          ?.sucursalId,
      ).toBe(A);
      for (const datos of [
        { sucursalesActivas: [], sucursalesCerradas: [B] },
        { sucursalesActivas: [], sucursalesCerradas: [B, C] },
        { sucursalesActivas: [A, B], sucursalesCerradas: [C] },
      ] as const) {
        const r = await listarCon(
          { ...datos, sucursalesActivas: [...datos.sucursalesActivas] },
          null,
        );
        expect(r.resultado).toEqual({ ok: false, error: "SUCURSAL_NO_ELEGIDA" });
        expect(r.lecturas).toBe(0);
      }
    });

    it("una elegida que no es de la empresa sigue fuera de alcance, también si hay cerradas", async () => {
      const r = await listarCon(
        { sucursalesActivas: [A], sucursalesCerradas: [B], alcance: "TODAS" },
        C,
      );
      expect(r.resultado).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    });

    it("el operador elige las cerradas que tiene asignadas, no las demás", async () => {
      const datos = { sucursalesActivas: [A], sucursalesCerradas: [B, C], alcance: [A, B] };
      expect((await listarCon(datos, B)).filtro?.sucursalId).toBe(B);
      expect((await listarCon(datos, C)).resultado).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      // Con una abierta y una cerrada asignadas, sin elegir toma la abierta.
      expect((await listarCon(datos, null)).filtro?.sucursalId).toBe(A);
      // Con solo cerradas asignadas, hay que elegir.
      expect((await listarCon({ ...datos, alcance: [B] }, null)).resultado).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ELEGIDA",
      });
    });

    it("sin sucursales activas: fuera de alcance, con o sin elección, y no lee nada", async () => {
      for (const elegida of [null, A]) {
        const r = await listarCon({ sucursalesActivas: [] }, elegida);
        expect(r.resultado, String(elegida)).toEqual({
          ok: false,
          error: "SUCURSAL_FUERA_DE_ALCANCE",
        });
        expect(r.lecturas).toBe(0);
      }
    });

    it("un operador sin asignaciones no tiene nada para elegir: fuera de alcance, con o sin elección", async () => {
      for (const elegida of [null, A]) {
        const r = await listarCon({ sucursalesActivas: [A, B], alcance: [] }, elegida);
        expect(r.resultado, String(elegida)).toEqual({
          ok: false,
          error: "SUCURSAL_FUERA_DE_ALCANCE",
        });
        expect(r.lecturas).toBe(0);
      }
    });

    it("el alcance del operador manda: de las activas, solo puede elegir las asignadas", async () => {
      const datos = { sucursalesActivas: [A, B, C], alcance: [B] };
      // una sola asignada: la toma sola
      expect((await listarCon(datos, null)).filtro?.sucursalId).toBe(B);
      // pedir una activa pero no asignada: fuera de alcance
      expect((await listarCon(datos, A)).resultado).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      // dos asignadas y sin elegir: hay que elegir
      expect(
        (await listarCon({ sucursalesActivas: [A, B, C], alcance: [A, B] }, null)).resultado,
      ).toEqual({ ok: false, error: "SUCURSAL_NO_ELEGIDA" });
    });
  });

  it("pide la página de la empresa del contexto con los criterios del pedido", async () => {
    const { consultas, filtros } = armar();
    exito(
      await consultas.listarComprobantes(contexto(OTRA_EMPRESA), {
        sucursalElegida: null,
        estado: "AUTORIZADO",
        limite: 7,
        texto: "Ana",
      }),
    );
    expect(filtros).toHaveLength(1);
    expect(filtros[0]?.empresa).toBe(OTRA_EMPRESA);
    expect(filtros[0]?.filtro).toMatchObject({
      estado: "AUTORIZADO",
      limite: 7,
      texto: { nombre: "Ana", documento: null },
    });
  });

  it("devuelve cada fila con su número impreso, el total como texto y solo lo del spec", async () => {
    const { consultas } = armar({ pagina: { filas: [fila(1), fila(2)], hayMas: false } });
    const pagina = exito(await consultas.listarComprobantes(contexto(), { sucursalElegida: null }));
    expect(pagina.items).toEqual([
      {
        id: fila(1).id,
        tipo: "FACTURA_B",
        numero: null,
        puntoDeVentaNumero: 3,
        fecha: "2026-10-13",
        receptorNombre: null,
        receptorDocumento: { tipo: "SIN_IDENTIFICAR" },
        total: "100.50",
        estado: "PENDIENTE",
        ambiente: "PRODUCCION",
        acreditacion: "NINGUNA",
      },
      {
        id: fila(2).id,
        tipo: "FACTURA_B",
        numero: "00003-00000002",
        puntoDeVentaNumero: 3,
        fecha: "2026-10-13",
        receptorNombre: "Cliente 2",
        receptorDocumento: { tipo: "DNI", numero: "30000002" },
        total: "200.50",
        estado: "AUTORIZADO",
        ambiente: "PRODUCCION",
        acreditacion: "NINGUNA",
      },
    ]);
    expect(pagina.siguiente).toBeNull();
  });

  it("D-16: la etiqueta de cada fila sale de las notas que la citan, con una sola lectura para toda la página", async () => {
    const filas = [fila(1), fila(2), fila(3), fila(4)];
    const credito = (total: string, estado: NotaParaAcreditar["estado"] = "AUTORIZADO") => ({
      tipo: "NOTA_CREDITO_B" as const,
      estado,
      total: importeDesdeTexto(ARS, total),
    });
    const { consultas, llamadas } = armar({
      pagina: { filas, hayMas: false },
      notasDeLaPagina: new Map([
        [fila(1).id, [credito("50.00")]],
        [fila(2).id, [credito("200.50")]],
        [fila(3).id, [credito("300.50", "RECHAZADO")]],
      ]),
    });
    const pagina = exito(
      await consultas.listarComprobantes(contexto(OTRA_EMPRESA), { sucursalElegida: null }),
    );
    expect(pagina.items.map((i) => i.acreditacion)).toEqual([
      "PARCIAL",
      "TOTAL",
      "NINGUNA",
      "NINGUNA",
    ]);
    // Una sola lectura de notas, de la empresa del contexto y con los ids de la página: no una por fila.
    expect(llamadas.notasDeLaPagina).toEqual([[OTRA_EMPRESA, filas.map((f) => f.id)]]);
  });

  it("una nota de crédito en el listado no lleva etiqueta; una de débito sí", async () => {
    const nc = { ...fila(1), tipo: "NOTA_CREDITO_B" as const };
    const nd = { ...fila(2), tipo: "NOTA_DEBITO_B" as const };
    const { consultas } = armar({ pagina: { filas: [nc, nd], hayMas: false } });
    const pagina = exito(await consultas.listarComprobantes(contexto(), { sucursalElegida: null }));
    expect(pagina.items.map((i) => i.acreditacion)).toEqual([null, "NINGUNA"]);
  });

  it("`siguiente` es la clave de la última fila de la página, y solo si queda algo después", async () => {
    const filas = [fila(1), fila(2), fila(3)];
    const con = armar({ pagina: { filas, hayMas: true } });
    const pagina = exito(
      await con.consultas.listarComprobantes(contexto(), { sucursalElegida: null }),
    );
    expect(pagina.siguiente).toBe(claveDePagina({ creadoEn: fila(3).creadoEn, id: fila(3).id }));
    const sin = armar({ pagina: { filas, hayMas: false } });
    expect(
      exito(await sin.consultas.listarComprobantes(contexto(), { sucursalElegida: null }))
        .siguiente,
    ).toBeNull();
    const vacia = armar({ pagina: { filas: [], hayMas: true } });
    expect(
      exito(await vacia.consultas.listarComprobantes(contexto(), { sucursalElegida: null }))
        .siguiente,
    ).toBeNull();
  });

  it("la letra, el punto de venta y el origen llegan a la lectura de la empresa del contexto", async () => {
    const { consultas, filtros } = armar();
    exito(
      await consultas.listarComprobantes(contexto(OTRA_EMPRESA), {
        sucursalElegida: null,
        letra: "B",
        puntoDeVenta: 3,
        origenTipo: "EJEMPLAR_DE_TICKET",
        origenId: "ticket-9",
      }),
    );
    expect(filtros).toHaveLength(1);
    expect(filtros[0]?.empresa).toBe(OTRA_EMPRESA);
    expect(filtros[0]?.filtro).toMatchObject({
      letra: "B",
      puntoDeVentaNumero: 3,
      origenTipo: "EJEMPLAR_DE_TICKET",
      origenId: "ticket-9",
    });
  });

  it("un pedido inválido no llega a la base", async () => {
    const { consultas, filtros } = armar();
    expect(
      await consultas.listarComprobantes(contexto(), { sucursalElegida: null, limite: 51 }),
    ).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    for (const [pedido, error] of [
      [{ letra: "Z" }, "LETRA_INVALIDA"],
      [{ puntoDeVenta: 0 }, "PUNTO_DE_VENTA_INVALIDO"],
      [{ origenTipo: "VENTA" }, "ORIGEN_TIPO_INVALIDO"],
      [{ origenTipo: "MANUAL", origenId: " " }, "ORIGEN_ID_INVALIDO"],
      [{ origenId: "x" }, "ORIGEN_ID_SIN_TIPO"],
    ] as const) {
      expect(
        await consultas.listarComprobantes(contexto(), {
          sucursalElegida: null,
          ...pedido,
        } as never),
      ).toEqual({
        ok: false,
        error,
      });
    }
    expect(filtros).toEqual([]);
  });
});

describe("listarPuntosDeVentaDeLaSucursal", () => {
  const SUCURSAL = sucursalId("s-1");

  it("pide los puntos de venta de ESA sucursal, de la empresa del contexto, y los devuelve por número, cada uno con su estado (D-58)", async () => {
    const { consultas, llamadas } = armar({
      puntosDeVenta: [
        { numero: 1, activo: true },
        { numero: 3, activo: false },
        { numero: 12, activo: true },
      ],
      sucursalesActivas: [SUCURSAL],
    });
    const r = exito(
      await consultas.listarPuntosDeVentaDeLaSucursal(contexto(OTRA_EMPRESA), {
        sucursalElegida: SUCURSAL,
      }),
    );
    expect(r).toEqual({
      items: [
        { numero: 1, activo: true },
        { numero: 3, activo: false },
        { numero: 12, activo: true },
      ],
    });
    expect(llamadas.puntosDeVenta).toEqual([[OTRA_EMPRESA, SUCURSAL]]);
  });

  it("una sucursal sin ningún punto de venta da una lista vacía, no un error", async () => {
    const { consultas } = armar({ sucursalesActivas: [SUCURSAL] });
    expect(
      exito(
        await consultas.listarPuntosDeVentaDeLaSucursal(contexto(), { sucursalElegida: SUCURSAL }),
      ),
    ).toEqual({ items: [] });
  });

  it("una sucursal CERRADA se pide para ver su historial: devuelve sus puntos de venta dados de baja (D-58 y D-37)", async () => {
    const cerrada = sucursalId("s-vieja");
    const { consultas } = armar({
      sucursalesActivas: [SUCURSAL],
      sucursalesCerradas: [cerrada],
      puntosDeVenta: [{ numero: 3, activo: false }],
    });
    expect(
      exito(
        await consultas.listarPuntosDeVentaDeLaSucursal(contexto(), { sucursalElegida: cerrada }),
      ),
    ).toEqual({ items: [{ numero: 3, activo: false }] });
  });

  it("un operador pide solo una sucursal de su alcance; fuera de él no se lee nada", async () => {
    const dentro = armar({
      alcance: [SUCURSAL],
      puntosDeVenta: [{ numero: 2, activo: true }],
      sucursalesActivas: [SUCURSAL, sucursalId("s-2")],
    });
    expect(
      exito(
        await dentro.consultas.listarPuntosDeVentaDeLaSucursal(contexto(), {
          sucursalElegida: SUCURSAL,
        }),
      ).items,
    ).toEqual([{ numero: 2, activo: true }]);
    const fuera = armar({
      alcance: [sucursalId("s-2")],
      puntosDeVenta: [{ numero: 2, activo: true }],
      sucursalesActivas: [SUCURSAL, sucursalId("s-2")],
    });
    expect(
      await fuera.consultas.listarPuntosDeVentaDeLaSucursal(contexto(), {
        sucursalElegida: SUCURSAL,
      }),
    ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(fuera.llamadas.puntosDeVenta).toEqual([]);
    const sinAsignaciones = armar({ alcance: [], sucursalesActivas: [SUCURSAL] });
    expect(
      await sinAsignaciones.consultas.listarPuntosDeVentaDeLaSucursal(contexto(), {
        sucursalElegida: SUCURSAL,
      }),
    ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
  });
});

describe("verComprobante", () => {
  it("pide todo con la empresa del contexto, y la serie de su punto de venta, tipo y ambiente", async () => {
    const c = guardado({ ambiente: "PRODUCCION" });
    const { consultas, llamadas } = armar({ comprobante: c });
    exito(await consultas.verComprobante(contexto(OTRA_EMPRESA), { comprobanteId: ID }));
    expect(llamadas.comprobante).toEqual([[OTRA_EMPRESA, ID]]);
    expect(llamadas.notas).toEqual([[OTRA_EMPRESA, ID]]);
    expect(llamadas.intentos).toEqual([[OTRA_EMPRESA, ID]]);
    expect(llamadas.series).toEqual([[OTRA_EMPRESA, c.puntoDeVentaId, "FACTURA_B", "PRODUCCION"]]);
  });

  describe("la sucursal del comprobante (D-39)", () => {
    const A = sucursalId("s-a");
    const B = sucursalId("s-b");
    const NO_ENCONTRADO = { ok: false, error: "COMPROBANTE_NO_ENCONTRADO" };
    const ver = async (datos: Datos) => {
      const { consultas, llamadas } = armar({ comprobante: guardado(), ...datos });
      const r = await consultas.verComprobante(contexto(), { comprobanteId: ID });
      return {
        r,
        // Cuántas lecturas del comprobante y de lo que lo rodea hizo (el comprobante mismo, las notas, los intentos y la serie).
        leyoElComprobante: llamadas.comprobante.length,
        leyoElResto: llamadas.notas.length + llamadas.intentos.length + llamadas.series.length,
      };
    };

    it("gerente y administrador (todas) abren el de cualquier sucursal, también de una cerrada", async () => {
      expect((await ver({ alcance: "TODAS", sucursalDelComprobante: A })).r.ok).toBe(true);
      expect(
        (await ver({ alcance: "TODAS", sucursalDelComprobante: B, sucursalesCerradas: [B] })).r.ok,
      ).toBe(true);
    });

    it("el operador abre el de las sucursales que tiene asignadas, también si está cerrada", async () => {
      expect((await ver({ alcance: [A], sucursalDelComprobante: A })).r.ok).toBe(true);
      expect(
        (await ver({ alcance: [B], sucursalDelComprobante: B, sucursalesCerradas: [B] })).r.ok,
      ).toBe(true);
    });

    it("el operador NO abre el de una sucursal que no tiene asignada: lo mismo que si no existiera, y no lee nada más", async () => {
      const ajeno = await ver({ alcance: [A], sucursalDelComprobante: B });
      expect(ajeno.r).toEqual(NO_ENCONTRADO);
      // Hizo el trabajo mínimo: ni siquiera leyó el comprobante (`obtener`), igual que si no existiera.
      expect(ajeno.leyoElComprobante).toBe(0);
      expect(ajeno.leyoElResto).toBe(0);
      const sinAsignaciones = await ver({ alcance: [], sucursalDelComprobante: A });
      expect(sinAsignaciones.r).toEqual(NO_ENCONTRADO);
      expect(sinAsignaciones.leyoElComprobante).toBe(0);
      // Idéntico al de un comprobante que no existe.
      const { consultas } = armar({ comprobante: null });
      expect(await consultas.verComprobante(contexto(), { comprobanteId: ID })).toEqual(ajeno.r);
    });

    it("un comprobante sin sucursal legible (otra empresa, borrado) también es COMPROBANTE_NO_ENCONTRADO", async () => {
      const sinSucursal = await ver({ alcance: "TODAS", sucursalDelComprobante: null });
      expect(sinSucursal.r).toEqual(NO_ENCONTRADO);
      expect(sinSucursal.leyoElComprobante).toBe(0);
      expect(sinSucursal.leyoElResto).toBe(0);
    });

    it("si corresponde, lee el comprobante una vez; y si desapareció entre la sucursal y la lectura, sigue siendo no encontrado", async () => {
      const abre = await ver({ alcance: [A], sucursalDelComprobante: A });
      expect(abre.r.ok).toBe(true);
      expect(abre.leyoElComprobante).toBe(1);
      const { consultas } = armar({ comprobante: null, alcance: "TODAS" });
      expect(await consultas.verComprobante(contexto(), { comprobanteId: ID })).toEqual(
        NO_ENCONTRADO,
      );
    });
  });

  it("un comprobante que no está (o es de otra empresa) es COMPROBANTE_NO_ENCONTRADO", async () => {
    const { consultas, llamadas } = armar({ comprobante: null });
    expect(await consultas.verComprobante(contexto(), { comprobanteId: ID })).toEqual({
      ok: false,
      error: "COMPROBANTE_NO_ENCONTRADO",
    });
    expect(llamadas.notas).toEqual([]);
    expect(llamadas.intentos).toEqual([]);
    expect(llamadas.series).toEqual([]);
  });

  it("el detalle de un autorizado: número, CAE, importes, renglones y alícuotas como texto", async () => {
    const { consultas } = armar({
      notas: [nota()],
      intentos: [intento({ id: intentoId("i-1") })],
    });
    const d = exito(await consultas.verComprobante(contexto(), { comprobanteId: ID }));
    expect(d).toMatchObject({
      id: ID,
      ambiente: "HOMOLOGACION",
      clase: "FACTURA",
      tipo: "FACTURA_B",
      concepto: "PRODUCTOS",
      servicio: null,
      modoDePrecio: "IVA_INCLUIDO",
      estado: "AUTORIZADO",
      envios: 1,
      numero: "00003-00000011",
      fechaEmision: "2026-10-13",
      cae: "70417054367476",
      caeVence: "2026-10-23",
      autorizadoEn: "2026-10-13T15:00:00.000Z",
      resueltoPor: "RESPUESTA",
      importes: {
        total: "2260.00",
        neto: "1950.23",
        iva: "309.77",
        exento: "0.00",
        noGravado: "0.00",
      },
      asociado: null,
      motivo: null,
      motivoDeDescarte: null,
      versionDeRepresentacion: 1,
      creadoEn: "2026-10-13T14:59:00.000Z",
      version: 4,
    });
    expect(d.renglones).toEqual([
      {
        posicion: 1,
        descripcion: "Torta",
        cantidad: "1.0000",
        precioUnitario: "1210.000000",
        descuento: null,
        alicuota: "21",
        importe: "1210.00",
      },
      {
        posicion: 2,
        descripcion: "Medialunas",
        cantidad: "1.0000",
        precioUnitario: "1050.000000",
        descuento: null,
        alicuota: "10.5",
        importe: "1050.00",
      },
    ]);
    expect(d.alicuotas).toEqual(
      guardado().desglose.map((a) => ({
        alicuota: a.alicuota,
        total: expect.stringMatching(/^\d+\.\d{2}$/) as unknown,
        neto: expect.stringMatching(/^\d+\.\d{2}$/) as unknown,
        iva: expect.stringMatching(/^\d+\.\d{2}$/) as unknown,
      })),
    );
    expect(d.emisor).toEqual({
      cuit: "30708533935",
      razonSocial: "Panadería Zulu SRL",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      domicilioFiscal: "Av. Corrientes 1234, CABA",
      inicioDeActividades: "2019-03-01",
      iibbNumero: "901-123456-7",
      iibbCondicion: "LOCAL",
      puntoDeVentaNumero: 3,
      domicilioDelPuntoDeVenta: "Calle Falsa 123, CABA",
    });
    expect(d.receptor).toEqual(consumidorFinal);
  });

  it("un comprobante sin autorizar no tiene número, fecha, CAE ni autorización", async () => {
    const pendiente = guardado({
      estado: "PENDIENTE",
      numeroReservado: null,
      fechaEmision: null,
      numero: null,
      cae: null,
      caeVence: null,
      autorizadoEn: null,
      resueltoPor: null,
    });
    const d = exito(
      await armar({ comprobante: pendiente }).consultas.verComprobante(contexto(), {
        comprobanteId: ID,
      }),
    );
    expect(d).toMatchObject({
      estado: "PENDIENTE",
      numero: null,
      fechaEmision: null,
      cae: null,
      caeVence: null,
      autorizadoEn: null,
      resueltoPor: null,
    });
  });

  it("una nota trae el comprobante que corrige, con su número impreso", async () => {
    const asociado = {
      id: comprobanteId("a-1"),
      tipo: "FACTURA_A" as const,
      puntoDeVenta: 7,
      numero: 94n,
      cuit: CUIT_B,
      fecha: fecha("2026-10-01"),
    };
    const d = exito(
      await armar({
        comprobante: guardado({
          clase: "NOTA_CREDITO",
          tipo: "NOTA_CREDITO_A",
          asociado,
          motivo: "Devolución",
        }),
      }).consultas.verComprobante(contexto(), { comprobanteId: ID }),
    );
    expect(d.asociado).toEqual({
      id: comprobanteId("a-1"),
      tipo: "FACTURA_A",
      numero: "00007-00000094",
      fecha: "2026-10-01",
    });
    expect(d.motivo).toBe("Devolución");
  });

  it("las notas que lo citan, con su número y su total", async () => {
    const d = exito(
      await armar({
        notas: [nota(), nota({ id: comprobanteId("n-2"), numero: null, estado: "PENDIENTE" })],
      }).consultas.verComprobante(contexto(), { comprobanteId: ID }),
    );
    expect(d.notasQueLoCitan).toEqual([
      {
        id: "n-1",
        tipo: "NOTA_CREDITO_B",
        numero: "00003-00000012",
        fecha: "2026-10-14",
        total: "121.00",
        estado: "AUTORIZADO",
      },
      {
        id: "n-2",
        tipo: "NOTA_CREDITO_B",
        numero: null,
        fecha: "2026-10-14",
        total: "121.00",
        estado: "PENDIENTE",
      },
    ]);
  });

  describe("lo ya acreditado (D-16)", () => {
    const verCon = async (notas: readonly NotaQueCita[], comprobante?: ComprobanteGuardado) =>
      exito(
        await armar({
          notas,
          ...(comprobante === undefined ? {} : { comprobante }),
        }).consultas.verComprobante(contexto(), { comprobanteId: ID }),
      );
    // El total de la factura de prueba es 2260.00.

    it("sin notas: 0.00 y NINGUNA", async () => {
      const d = await verCon([]);
      expect(d).toMatchObject({ acreditado: "0.00", acreditacion: "NINGUNA" });
    });

    it("suma las autorizadas y las pendientes, no las rechazadas, y marca PARCIAL", async () => {
      const d = await verCon([
        nota({ total: importeDesdeTexto(ARS, "1000.00") }),
        nota({
          id: comprobanteId("n-2"),
          total: importeDesdeTexto(ARS, "260.25"),
          estado: "EN_VALIDACION",
        }),
        nota({
          id: comprobanteId("n-3"),
          total: importeDesdeTexto(ARS, "700.00"),
          estado: "INCIERTO",
        }),
        nota({
          id: comprobanteId("n-4"),
          total: importeDesdeTexto(ARS, "999.00"),
          estado: "RECHAZADO",
        }),
      ]);
      expect(d).toMatchObject({ acreditado: "1960.25", acreditacion: "PARCIAL" });
    });

    it("el total exacto es TOTAL, y pasarse también (sin tope ni aviso)", async () => {
      const exacto = await verCon([nota({ total: importeDesdeTexto(ARS, "2260.00") })]);
      expect(exacto).toMatchObject({ acreditado: "2260.00", acreditacion: "TOTAL" });
      const pasado = await verCon([
        nota({ total: importeDesdeTexto(ARS, "2260.00") }),
        nota({ id: comprobanteId("n-2"), total: importeDesdeTexto(ARS, "0.01") }),
      ]);
      expect(pasado).toMatchObject({ acreditado: "2260.01", acreditacion: "TOTAL" });
    });

    it("una nota de crédito en sí no tiene cifra ni etiqueta", async () => {
      const d = await verCon(
        [],
        guardado({ clase: "NOTA_CREDITO", tipo: "NOTA_CREDITO_B", asociado: null }),
      );
      expect(d).toMatchObject({ acreditado: null, acreditacion: null });
    });
  });

  it("el último intento, solo con sus códigos; sin intentos, null", async () => {
    const primero = intento({
      id: intentoId("i-1"),
      desenlace: "INCIERTO",
      mensajes: [],
      iniciadoEn: new Date("2026-10-13T14:00:00.000Z"),
    });
    const ultimo = intento({ id: intentoId("i-2") });
    const d = exito(
      await armar({ intentos: [primero, ultimo] }).consultas.verComprobante(contexto(), {
        comprobanteId: ID,
      }),
    );
    expect(d.ultimoIntento).toEqual({
      operacion: "AUTORIZAR",
      desenlace: "AUTORIZADO",
      mensajes: [{ clase: "OBSERVACION", codigo: 10237, texto: "Observación" }],
      iniciadoEn: "2026-10-13T15:00:00.000Z",
    });
    const sin = exito(
      await armar({ intentos: [] }).consultas.verComprobante(contexto(), { comprobanteId: ID }),
    );
    expect(sin.ultimoIntento).toBeNull();
  });

  it("el estado de su serie: libre, bloqueada con su motivo, o sin serie todavía", async () => {
    const ver = async (s: SerieGuardada | null) =>
      exito(await armar({ serie: s }).consultas.verComprobante(contexto(), { comprobanteId: ID }))
        .serie;
    expect(await ver(serie())).toEqual({
      estado: "LIBRE",
      ultimoNumero: "11",
      motivoDeBloqueo: null,
    });
    expect(
      await ver(
        serie({ estado: "BLOQUEADA", ultimoNumero: 5n, motivoBloqueo: "Desfase con ARCA" }),
      ),
    ).toEqual({ estado: "BLOQUEADA", ultimoNumero: "5", motivoDeBloqueo: "Desfase con ARCA" });
    expect(await ver(null)).toBeNull();
  });

  it("nunca trae certificados, claves, tickets, credenciales, la huella ni la respuesta cruda de ARCA", async () => {
    const d = exito(
      await armar({ notas: [nota()], intentos: [intento({})] }).consultas.verComprobante(
        contexto(),
        { comprobanteId: ID },
      ),
    );
    const claves: string[] = [];
    const recorrer = (valor: unknown): void => {
      if (Array.isArray(valor)) valor.forEach(recorrer);
      else if (typeof valor === "object" && valor !== null) {
        for (const [k, v] of Object.entries(valor)) {
          claves.push(k);
          recorrer(v);
        }
      }
    };
    recorrer(d);
    expect(
      claves.filter((k) =>
        /certificad|clave|ticket|credencial|token|sign|pem|huella|respuesta|cifrad/i.test(k),
      ),
    ).toEqual([]);
    expect(JSON.stringify(d)).not.toMatch(/huella-interna|huella-del-pedido|respuesta-cruda/);
    expect(d).not.toHaveProperty("datosFiscalesId");
    expect(d.emisor).not.toHaveProperty("datosFiscalesId");
  });
});

describe("modeloDeImpresion (la consulta)", () => {
  it("un comprobante que no está es COMPROBANTE_NO_ENCONTRADO y no lee la marca", async () => {
    const { consultas, marcasPedidas } = armar({ comprobante: null });
    expect(await consultas.modeloDeImpresion(contexto(), { comprobanteId: ID })).toEqual({
      ok: false,
      error: "COMPROBANTE_NO_ENCONTRADO",
    });
    expect(marcasPedidas).toEqual([]);
  });

  it("solo se imprime un AUTORIZADO: cualquier otro estado es COMPROBANTE_NO_AUTORIZADO", async () => {
    for (const estado of [
      "PENDIENTE",
      "EN_VALIDACION",
      "RECHAZADO",
      "INCIERTO",
      "CONFLICTO",
      "DESCARTADO",
    ] as const) {
      const { consultas, marcasPedidas } = armar({ comprobante: guardado({ estado }) });
      expect(await consultas.modeloDeImpresion(contexto(), { comprobanteId: ID }), estado).toEqual({
        ok: false,
        error: "COMPROBANTE_NO_AUTORIZADO",
      });
      expect(marcasPedidas).toEqual([]);
    }
  });

  describe("la sucursal del comprobante (D-39 extendido)", () => {
    const A = sucursalId("s-a");
    const B = sucursalId("s-b");
    const NO_ENCONTRADO = { ok: false, error: "COMPROBANTE_NO_ENCONTRADO" };
    const pedir = async (datos: Datos) => {
      const { consultas, llamadas, marcasPedidas } = armar(datos);
      const r = await consultas.modeloDeImpresion(contexto(), { comprobanteId: ID });
      return { r, leidos: llamadas.comprobante.length, marcasPedidas };
    };

    it("gerente y administrador (todas) lo piden de cualquier sucursal, también cerrada; el operador, de las suyas, también cerradas", async () => {
      expect((await pedir({ alcance: "TODAS", sucursalDelComprobante: B })).r.ok).toBe(true);
      expect(
        (await pedir({ alcance: "TODAS", sucursalDelComprobante: B, sucursalesCerradas: [B] })).r
          .ok,
      ).toBe(true);
      expect((await pedir({ alcance: [A], sucursalDelComprobante: A })).r.ok).toBe(true);
      expect(
        (await pedir({ alcance: [B], sucursalDelComprobante: B, sucursalesCerradas: [B] })).r.ok,
      ).toBe(true);
    });

    it("el operador NO lo pide de una sucursal que no tiene: lo mismo que si no existiera, sin leer el comprobante ni la marca", async () => {
      for (const alcance of [[A], []] as const) {
        const ajeno = await pedir({ alcance, sucursalDelComprobante: B });
        expect(ajeno.r).toEqual(NO_ENCONTRADO);
        expect(ajeno.leidos).toBe(0);
        expect(ajeno.marcasPedidas).toEqual([]);
      }
      const inexistente = await pedir({
        comprobante: null,
        alcance: [A],
        sucursalDelComprobante: B,
      });
      expect(inexistente.r).toEqual(NO_ENCONTRADO);
    });

    it("de una sucursal ajena responde NO_ENCONTRADO aunque el estado sea otro: no delata que existe (nada de COMPROBANTE_NO_AUTORIZADO)", async () => {
      const ajeno = await pedir({
        comprobante: guardado({ estado: "PENDIENTE" }),
        alcance: [A],
        sucursalDelComprobante: B,
      });
      expect(ajeno.r).toEqual(NO_ENCONTRADO);
      const propio = await pedir({
        comprobante: guardado({ estado: "PENDIENTE" }),
        alcance: [A],
        sucursalDelComprobante: A,
      });
      expect(propio.r).toEqual({ ok: false, error: "COMPROBANTE_NO_AUTORIZADO" });
    });

    it("sin sucursal legible (otra empresa, columna vacía) también es NO_ENCONTRADO", async () => {
      const r = await pedir({ alcance: "TODAS", sucursalDelComprobante: null });
      expect(r.r).toEqual(NO_ENCONTRADO);
      expect(r.leidos).toBe(0);
    });
  });

  it("pide la comprobante y la marca de la empresa del contexto", async () => {
    const { consultas, llamadas, marcasPedidas } = armar();
    exito(await consultas.modeloDeImpresion(contexto(OTRA_EMPRESA), { comprobanteId: ID }));
    expect(llamadas.comprobante).toEqual([[OTRA_EMPRESA, ID]]);
    expect(marcasPedidas).toEqual([OTRA_EMPRESA]);
  });

  it("arma el modelo con lo guardado: sin recalcular y con los domicilios congelados", async () => {
    const m = exito(await armar().consultas.modeloDeImpresion(contexto(), { comprobanteId: ID }));
    expect(m).toEqual(exito(modeloDeImpresion(paraImprimir(guardado()), MARCA)));
    expect(m.marca).toEqual(MARCA);
    expect(m.fiscal).toMatchObject({
      rotulo: "FACTURA",
      letra: "B",
      codigoDelTipo: "006",
      numero: "00003-00000011",
      fecha: "2026-10-13",
      cae: "70417054367476",
      caeVence: "2026-10-23",
    });
    expect(m.fiscal.emisor.domicilioFiscal).toBe("Av. Corrientes 1234, CABA");
    expect(m.totales).toMatchObject({ letra: "B", total: "2260.00" });
  });

  it("el mismo comprobante y la misma marca dan el mismo modelo, una y otra vez", async () => {
    const consultas = armar().consultas;
    const a = exito(await consultas.modeloDeImpresion(contexto(), { comprobanteId: ID }));
    const b = exito(await consultas.modeloDeImpresion(contexto(), { comprobanteId: ID }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("una versión de representación que no se sabe dibujar sale como error del modelo", async () => {
    const { consultas } = armar({ comprobante: guardado({ versionDeRepresentacion: 2 }) });
    expect(await consultas.modeloDeImpresion(contexto(), { comprobanteId: ID })).toEqual({
      ok: false,
      error: "VERSION_DE_REPRESENTACION_DESCONOCIDA",
    });
  });

  it("un CAE que no es de 14 dígitos sale como CAE_INVALIDO", async () => {
    const { consultas } = armar({ comprobante: guardado({ cae: "123" }) });
    expect(await consultas.modeloDeImpresion(contexto(), { comprobanteId: ID })).toEqual({
      ok: false,
      error: "CAE_INVALIDO",
    });
  });
});

describe("paraImprimir", () => {
  it("un AUTORIZADO al que le falta número, fecha, CAE o vencimiento es una base rota: lanza", () => {
    for (const cambios of [
      { numero: null },
      { fechaEmision: null },
      { cae: null },
      { caeVence: null },
    ] satisfies Partial<ComprobanteGuardado>[]) {
      expect(() => paraImprimir(guardado(cambios)), JSON.stringify(cambios)).toThrow(RangeError);
    }
  });

  it("toma el total de los importes guardados y el resto tal cual", () => {
    const c = guardado();
    const p = paraImprimir(c);
    expect(p.total).toBe(c.importes.total);
    expect(p.numero).toBe(11n);
    expect(p.emisor).toBe(c.emisor);
    expect(p.desglose).toBe(c.desglose);
    expect(p.renglones).toBe(c.renglones);
  });
});
