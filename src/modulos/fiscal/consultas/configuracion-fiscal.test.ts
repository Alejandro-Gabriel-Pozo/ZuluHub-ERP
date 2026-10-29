import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { REGLAS_DE_EMPRESA } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { Transacciones } from "../../../puertos/transacciones";
import { domicilioId, emisorId, puntoDeVentaId, versionId } from "../publico";
import type { CertificadoGuardado } from "../persistencia/repositorio-de-certificados";
import type {
  PuntoDeVentaGuardado,
  RepositorioDeEmisores,
  VersionDeDatosFiscales,
} from "../persistencia/repositorios";
import { crearConsultasDeFacturacion } from "./consultas";
import type { TxDeConsultasDeFacturacion } from "./contrato";

/**
 * Las tres consultas de la pantalla de Configuración fiscal (D-43) sin base de datos: cómo arman lo que la pantalla necesita a
 * partir de lo que devuelven los repositorios, que no sacan nada secreto ni de Ingresos Brutos (D-45), y que un emisor de otra empresa
 * no existe para ellas. Que el guard va primero, en `guard-primero.test.ts`; contra una base real, en
 * `test/integracion/fiscal-configuracion-web.test.ts`.
 */

// Los tipos salen de la persistencia: las consultas (y sus pruebas) no importan el dominio (regla `consultas-sin-dominio`).
type Emisor = NonNullable<Awaited<ReturnType<RepositorioDeEmisores["obtener"]>>>;
type DatosFiscalesConfirmados = Extract<
  VersionDeDatosFiscales,
  { estado: "CONFIRMADA" }
>["confirmada"];
type DatosFiscalesBorrador = Extract<VersionDeDatosFiscales, { estado: "BORRADOR" }>["borrador"];

const AHORA = new Date("2026-10-29T12:00:00.000Z");
const DIA = 86_400_000;
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: AHORA,
};
const EMISOR = emisorId("emisor-1");
const SUCURSAL = sucursalId("s-1");

const emisor: Emisor = {
  id: EMISOR,
  empresaId: empresaId("e-1"),
  esPrincipal: true,
  cuit: "20123456786" as Cuit,
  activo: true,
  version: 1,
};

const domicilioGuardado = (id: string) => ({
  id: domicilioId(id),
  empresaId: empresaId("e-1"),
  domicilio: {
    calle: "Av. Corrientes",
    numero: "1234",
    piso: null,
    departamento: null,
    localidad: "Rosario",
    provincia: "AR-S" as never,
    codigoPostal: "S2000",
  },
});

const confirmada = (cambios: Partial<DatosFiscalesConfirmados> = {}): DatosFiscalesConfirmados => ({
  id: versionId("v-1"),
  empresaId: empresaId("e-1"),
  emisorId: EMISOR,
  numero: 1,
  razonSocial: "Panadería Zulu SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilioFiscalId: domicilioId("d-1"),
  inicioActividades: "2020-03-01",
  // Si algún día llegaran con Ingresos Brutos, la consulta no los puede dejar salir (D-45).
  iibbNumero: "902-123456-7",
  iibbCondicion: "LOCAL",
  vigenteDesde: new Date(AHORA.getTime() - DIA),
  confirmadaEn: new Date(AHORA.getTime() - DIA),
  confirmadaPor: personaId("p-1"),
  motivo: "alta",
  version: 1,
  ...cambios,
});

const borrador = (cambios: Partial<DatosFiscalesBorrador> = {}): DatosFiscalesBorrador => ({
  id: versionId("b-1"),
  empresaId: empresaId("e-1"),
  emisorId: EMISOR,
  razonSocial: null,
  condicionIva: null,
  domicilioFiscalId: null,
  inicioActividades: null,
  iibbNumero: "902-123456-7",
  iibbCondicion: "LOCAL",
  creadoPor: personaId("p-1"),
  version: 3,
  ...cambios,
});

const punto = (cambios: Partial<PuntoDeVentaGuardado> = {}): PuntoDeVentaGuardado => ({
  id: puntoDeVentaId("pv-1"),
  empresaId: empresaId("e-1"),
  emisorId: EMISOR,
  sucursalId: SUCURSAL,
  domicilioId: domicilioId("d-2"),
  numero: 1,
  estado: "ACTIVO",
  verificacionArca: "NO_VERIFICADO",
  version: 2,
  ambiente: "HOMOLOGACION",
  ...cambios,
});

const certificado = (cambios: Partial<CertificadoGuardado> = {}): CertificadoGuardado => ({
  id: "cert-1" as CertificadoGuardado["id"],
  empresaId: empresaId("e-1"),
  emisorId: EMISOR,
  ambiente: "HOMOLOGACION",
  alias: "pedernal1",
  cuitTitular: "20123456786" as Cuit,
  estado: "VIGENTE",
  pedidoPem: "-----BEGIN CERTIFICATE REQUEST-----",
  certificadoPem: "-----BEGIN CERTIFICATE-----",
  huellaSha256: "a".repeat(64),
  venceEn: new Date(AHORA.getTime() + 100 * DIA),
  autorizacionVerificadaEn: null,
  creadoPor: personaId("p-1"),
  creadoEn: new Date(AHORA.getTime() - DIA),
  version: 1,
  ...cambios,
});

type Datos = Partial<{
  principal: Emisor | null;
  obtenerEmisor: Emisor | null;
  confirmadas: DatosFiscalesConfirmados[];
  borrador: DatosFiscalesBorrador | null;
  puntos: PuntoDeVentaGuardado[];
  usados: ReadonlySet<string>;
  certificados: readonly {
    ambiente: "HOMOLOGACION" | "PRODUCCION";
    vigente: CertificadoGuardado | null;
    pendiente: CertificadoGuardado | null;
  }[];
  sucursales: { id: typeof SUCURSAL; nombre: string; activa: boolean }[];
  domiciliosFaltantes: ReadonlySet<string>;
}>;

function consultasCon(datos: Datos = {}) {
  const aislamientos: Array<{ aislamiento?: string; soloLectura?: boolean }> = [];
  const lecturas: string[] = [];
  const tx = {
    autorizacion: {
      delActor: () =>
        Promise.resolve({ rol: "GERENTE" as const, modulosActivados: [], modulosHabilitados: [] }),
      sucursalesDelActor: () => Promise.resolve("TODAS" as const),
    },
    emisores: {
      obtener: () => {
        lecturas.push("emisores.obtener");
        return Promise.resolve(datos.obtenerEmisor === undefined ? emisor : datos.obtenerEmisor);
      },
      delPrincipal: () => {
        lecturas.push("emisores.delPrincipal");
        return Promise.resolve(datos.principal === undefined ? emisor : datos.principal);
      },
    },
    datosFiscales: {
      confirmadas: () => {
        lecturas.push("datosFiscales.confirmadas");
        return Promise.resolve(datos.confirmadas ?? []);
      },
      obtenerBorrador: () => {
        lecturas.push("datosFiscales.obtenerBorrador");
        return Promise.resolve(datos.borrador ?? null);
      },
    },
    domicilios: {
      obtener: (_empresa: unknown, id: string) =>
        Promise.resolve(datos.domiciliosFaltantes?.has(id) === true ? null : domicilioGuardado(id)),
    },
    puntosDeVenta: { listarDelEmisor: () => Promise.resolve(datos.puntos ?? []) },
    series: {
      hayNumerosUsadosDelPuntoDeVenta: (_empresa: unknown, id: string) =>
        Promise.resolve(datos.usados?.has(id) ?? false),
    },
    lecturasDeCertificados: {
      actualesDelEmisor: () =>
        Promise.resolve(
          datos.certificados ?? [
            { ambiente: "HOMOLOGACION", vigente: null, pendiente: null },
            { ambiente: "PRODUCCION", vigente: null, pendiente: null },
          ],
        ),
    },
    sucursales: {
      listar: () =>
        Promise.resolve(
          datos.sucursales ?? [{ id: SUCURSAL, nombre: "Casa central", activa: true }],
        ),
    },
  } as unknown as TxDeConsultasDeFacturacion;
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (opciones, trabajo) => {
      aislamientos.push(opciones);
      return trabajo(tx);
    },
  };
  return {
    consultas: crearConsultasDeFacturacion({ transacciones, reglas: REGLAS_DE_EMPRESA }),
    aislamientos,
    lecturas,
  };
}

const valor = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`debió salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
};

describe("estadoDeLaConfiguracionFiscal: la lista de lo que falta", () => {
  const estado = async (datos: Datos = {}) =>
    valor(await consultasCon(datos).consultas.estadoDeLaConfiguracionFiscal(contexto));

  it("empresa recién creada: nada cargado, sin puntos de venta y sin certificados, en los dos ambientes", async () => {
    expect(await estado()).toEqual({
      emisorId: EMISOR,
      datosFiscales: { estado: "SIN_CARGAR" },
      puntosDeVenta: { estado: "SIN_PUNTOS", total: 0, activos: 0, ambientesEnUso: [] },
      certificados: [
        { ambiente: "HOMOLOGACION", situacion: "FALTA_CARGAR", venceEn: null, vencido: false },
        { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR", venceEn: null, vencido: false },
      ],
    });
  });

  it("es el emisor PRINCIPAL (D-47): sin principal, no hay lista", async () => {
    expect(
      await consultasCon({ principal: null }).consultas.estadoDeLaConfiguracionFiscal(contexto),
    ).toEqual({
      ok: false,
      error: "EMISOR_NO_ENCONTRADO",
    });
  });

  it("datos fiscales: un borrador sin confirmar es BORRADOR; una versión que rige hoy es VIGENTES; solo futuras, SOLO_FUTUROS", async () => {
    expect((await estado({ borrador: borrador() })).datosFiscales.estado).toBe("BORRADOR");
    expect((await estado({ confirmadas: [confirmada()] })).datosFiscales.estado).toBe("VIGENTES");
    // Lo que rige gana sobre un borrador que se está editando: emitir usa lo confirmado.
    expect(
      (await estado({ confirmadas: [confirmada()], borrador: borrador() })).datosFiscales.estado,
    ).toBe("VIGENTES");
    expect(
      (
        await estado({
          confirmadas: [confirmada({ vigenteDesde: new Date(AHORA.getTime() + DIA) })],
        })
      ).datosFiscales.estado,
    ).toBe("SOLO_FUTUROS");
    // Una futura con un borrador en curso: es el borrador lo que la persona tiene entre manos.
    expect(
      (
        await estado({
          confirmadas: [confirmada({ vigenteDesde: new Date(AHORA.getTime() + DIA) })],
          borrador: borrador(),
        })
      ).datosFiscales.estado,
    ).toBe("BORRADOR");
  });

  it("puntos de venta: sin ninguno, todos inactivos, o con activos (cuántos y en qué ambientes)", async () => {
    expect((await estado({ puntos: [] })).puntosDeVenta.estado).toBe("SIN_PUNTOS");
    const soloInactivos = await estado({ puntos: [punto({ estado: "INACTIVO" })] });
    expect(soloInactivos.puntosDeVenta).toEqual({
      estado: "SIN_ACTIVOS",
      total: 1,
      activos: 0,
      ambientesEnUso: [],
    });
    const mezcla = await estado({
      puntos: [
        punto({ id: puntoDeVentaId("a"), numero: 1, ambiente: "PRODUCCION" }),
        punto({ id: puntoDeVentaId("b"), numero: 2, ambiente: "HOMOLOGACION" }),
        punto({ id: puntoDeVentaId("c"), numero: 3, ambiente: "HOMOLOGACION" }),
        // Un inactivo no cuenta como «en uso» aunque esté en producción.
        punto({ id: puntoDeVentaId("d"), numero: 4, estado: "INACTIVO", ambiente: "PRODUCCION" }),
      ],
    });
    expect(mezcla.puntosDeVenta).toEqual({
      estado: "CON_ACTIVOS",
      total: 4,
      activos: 3,
      ambientesEnUso: ["HOMOLOGACION", "PRODUCCION"],
    });
  });

  it("certificados: pedido generado, vigente (con su vencimiento) y vigente ya vencido; nada secreto ni del pedido", async () => {
    const vence = new Date(AHORA.getTime() + 30 * DIA);
    const r = await estado({
      certificados: [
        {
          ambiente: "HOMOLOGACION",
          vigente: certificado({ venceEn: vence }),
          pendiente: certificado({
            id: "cert-2" as never,
            estado: "PEDIDO_GENERADO",
            certificadoPem: null,
            huellaSha256: null,
            venceEn: null,
          }),
        },
        {
          ambiente: "PRODUCCION",
          vigente: certificado({ ambiente: "PRODUCCION", venceEn: new Date(AHORA.getTime() - 1) }),
          pendiente: null,
        },
      ],
    });
    expect(r.certificados).toEqual([
      { ambiente: "HOMOLOGACION", situacion: "VIGENTE", venceEn: vence, vencido: false },
      {
        ambiente: "PRODUCCION",
        situacion: "VIGENTE",
        venceEn: new Date(AHORA.getTime() - 1),
        vencido: true,
      },
    ]);
    const pedido = await estado({
      certificados: [
        {
          ambiente: "HOMOLOGACION",
          vigente: null,
          pendiente: certificado({
            estado: "PEDIDO_GENERADO",
            certificadoPem: null,
            huellaSha256: null,
            venceEn: null,
          }),
        },
        { ambiente: "PRODUCCION", vigente: null, pendiente: null },
      ],
    });
    expect(pedido.certificados[0]).toEqual({
      ambiente: "HOMOLOGACION",
      situacion: "PEDIDO_GENERADO",
      venceEn: null,
      vencido: false,
    });
    // Ni el alias, ni el titular, ni la huella, ni el PEM, ni el pedido: ninguna clave de más.
    for (const c of [...r.certificados, ...pedido.certificados]) {
      expect(Object.keys(c).sort()).toEqual(["ambiente", "situacion", "venceEn", "vencido"]);
    }
    expect(JSON.stringify([r, pedido])).not.toMatch(/BEGIN|pedernal1|a{64}|902-123456/);
  });
});

describe("las tres son de solo lectura, en una transacción de lectura", () => {
  it.each([
    [
      "estadoDeLaConfiguracionFiscal",
      (c: ReturnType<typeof consultasCon>["consultas"]) =>
        c.estadoDeLaConfiguracionFiscal(contexto),
    ],
    [
      "datosFiscalesDelEmisor",
      (c: ReturnType<typeof consultasCon>["consultas"]) =>
        c.datosFiscalesDelEmisor(contexto, { emisorId: EMISOR }),
    ],
    [
      "puntosDeVentaDelEmisor",
      (c: ReturnType<typeof consultasCon>["consultas"]) =>
        c.puntosDeVentaDelEmisor(contexto, { emisorId: EMISOR }),
    ],
  ])("%s", async (_nombre, llamar) => {
    const { consultas, aislamientos } = consultasCon();
    await llamar(consultas);
    expect(aislamientos).toEqual([
      expect.objectContaining({ aislamiento: "read committed", soloLectura: true }),
    ]);
  });
});

describe("datosFiscalesDelEmisor: lo que la pantalla de Datos fiscales muestra y edita", () => {
  const datos = async (d: Datos = {}) =>
    valor(await consultasCon(d).consultas.datosFiscalesDelEmisor(contexto, { emisorId: EMISOR }));

  it("sin nada cargado: ni vigente ni borrador", async () => {
    expect(await datos()).toEqual({ emisorId: EMISOR, vigente: null, borrador: null });
  });

  it("la versión que rige, con su domicilio y sin Ingresos Brutos; las futuras no cuentan", async () => {
    const r = await datos({
      confirmadas: [
        confirmada(),
        confirmada({
          id: versionId("v-2"),
          numero: 2,
          vigenteDesde: new Date(AHORA.getTime() + DIA),
        }),
      ],
    });
    expect(r.vigente).toEqual({
      id: "v-1",
      numero: 1,
      vigenteDesde: new Date(AHORA.getTime() - DIA),
      razonSocial: "Panadería Zulu SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      domicilio: {
        id: "d-1",
        calle: "Av. Corrientes",
        numero: "1234",
        piso: null,
        departamento: null,
        localidad: "Rosario",
        provincia: "AR-S",
        codigoPostal: "S2000",
      },
      inicioActividades: "2020-03-01",
    });
    expect(JSON.stringify(r)).not.toMatch(
      /[iI]ibb|902-123456|"LOCAL"|confirmadaPor|creadoPor|empresaId/,
    );
  });

  it("el borrador dice su versión y lo que ya tiene cargado; lo que falta queda en nulo", async () => {
    const vacio = (await datos({ borrador: borrador() })).borrador;
    expect(vacio).toEqual({
      id: "b-1",
      version: 3,
      razonSocial: null,
      condicionIva: null,
      domicilio: null,
      inicioActividades: null,
    });
    const parcial = (
      await datos({
        borrador: borrador({
          razonSocial: "Zulu",
          condicionIva: "MONOTRIBUTO",
          domicilioFiscalId: domicilioId("d-9"),
        }),
      })
    ).borrador;
    expect(parcial).toMatchObject({
      razonSocial: "Zulu",
      condicionIva: "MONOTRIBUTO",
      domicilio: { id: "d-9", calle: "Av. Corrientes" },
    });
    const completo = (
      await datos({
        borrador: borrador({
          razonSocial: "Zulu",
          condicionIva: "EXENTO",
          domicilioFiscalId: domicilioId("d-9"),
          inicioActividades: "2021-01-01",
        }),
      })
    ).borrador;
    expect(completo).toMatchObject({ razonSocial: "Zulu", inicioActividades: "2021-01-01" });
    expect(JSON.stringify([vacio, parcial, completo])).not.toMatch(/[iI]ibb|902-123456|"LOCAL"/);
  });

  it("un emisor que la empresa no ve (otra empresa o inexistente) no existe: no lee nada más", async () => {
    const { consultas, lecturas } = consultasCon({ obtenerEmisor: null });
    expect(
      await consultas.datosFiscalesDelEmisor(contexto, { emisorId: emisorId("ajeno") }),
    ).toEqual({
      ok: false,
      error: "EMISOR_NO_ENCONTRADO",
    });
    expect(lecturas).toEqual(["emisores.obtener"]);
  });

  it("un domicilio que la base no tiene (no pasa: clave foránea) es un defecto, no un dato vacío", async () => {
    await expect(
      consultasCon({
        confirmadas: [confirmada()],
        domiciliosFaltantes: new Set(["d-1"]),
      }).consultas.datosFiscalesDelEmisor(contexto, { emisorId: EMISOR }),
    ).rejects.toThrow("un domicilio fiscal que no existe");
  });
});

describe("puntosDeVentaDelEmisor: lo que la pantalla de Puntos de venta muestra", () => {
  const puntos = async (d: Datos = {}) =>
    valor(await consultasCon(d).consultas.puntosDeVentaDelEmisor(contexto, { emisorId: EMISOR }));

  it("todos los del emisor, activos o no, con ambiente, sucursal, domicilio, si ya usó números y su versión", async () => {
    const r = await puntos({
      puntos: [
        punto({ id: puntoDeVentaId("a"), numero: 1, version: 5 }),
        punto({
          id: puntoDeVentaId("b"),
          numero: 2,
          estado: "INACTIVO",
          domicilioId: null,
          ambiente: "PRODUCCION",
        }),
      ],
      usados: new Set(["a"]),
      sucursales: [{ id: SUCURSAL, nombre: "Casa central", activa: false }],
    });
    expect(r).toEqual({
      emisorId: EMISOR,
      items: [
        {
          id: "a",
          numero: 1,
          activo: true,
          ambiente: "HOMOLOGACION",
          sucursal: { id: SUCURSAL, nombre: "Casa central", activa: false },
          tieneDomicilio: true,
          hayNumerosUsados: true,
          version: 5,
        },
        {
          id: "b",
          numero: 2,
          activo: false,
          ambiente: "PRODUCCION",
          sucursal: { id: SUCURSAL, nombre: "Casa central", activa: false },
          tieneDomicilio: false,
          hayNumerosUsados: false,
          version: 2,
        },
      ],
    });
  });

  it("sin puntos de venta: lista vacía", async () => {
    expect(await puntos()).toEqual({ emisorId: EMISOR, items: [] });
  });

  it("un emisor que la empresa no ve no existe: no lee puntos de venta", async () => {
    const { consultas, lecturas } = consultasCon({ obtenerEmisor: null, puntos: [punto()] });
    expect(
      await consultas.puntosDeVentaDelEmisor(contexto, { emisorId: emisorId("ajeno") }),
    ).toEqual({
      ok: false,
      error: "EMISOR_NO_ENCONTRADO",
    });
    expect(lecturas).toEqual(["emisores.obtener"]);
  });

  it("un punto de venta de una sucursal que no existe (no pasa: clave foránea) es un defecto", async () => {
    await expect(
      consultasCon({ puntos: [punto()], sucursales: [] }).consultas.puntosDeVentaDelEmisor(
        contexto,
        {
          emisorId: EMISOR,
        },
      ),
    ).rejects.toThrow("un punto de venta de una sucursal que no existe");
  });
});
