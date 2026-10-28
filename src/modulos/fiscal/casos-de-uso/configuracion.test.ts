import { describe, expect, it } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  DOMICILIO_1,
  EMISOR_1,
  EMPRESA,
  GERENTE,
  SUCURSAL,
  emisor,
  puntoDeVenta,
} from "../../../../test/utilidades/fiscal";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { domicilioDesdeDatos } from "../../../primitivas/domicilio/domicilio";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { RegistroDeAuditoria } from "../../../puertos/auditoria";
import type { Transacciones } from "../../../puertos/transacciones";
import type { DatosFiscalesBorrador, DatosFiscalesConfirmados } from "../dominio/datos-fiscales";
import { domicilioId, puntoDeVentaId, versionId } from "../dominio/identificadores";
import type { PuntoDeVentaGuardado } from "../persistencia/repositorios";
import { cambiosParaAuditar, dejarListoElDomicilio } from "./comun-de-configuracion";
import { crearCasosDeUsoDeConfiguracionFiscal } from "./casos-de-uso-de-configuracion";
import type { TxDeConfiguracionFiscal } from "./contrato-de-configuracion";

/**
 * La configuración fiscal del gerente contra repositorios EN MEMORIA: lo que la base real no deja armar (un `guardar`
 * que pierde la versión, un alta que gana otro por el medio, un emisor que falta) y el borde de cada decisión. El resto
 * está en `test/integracion/fiscal-configuracion*.test.ts`.
 */

const AHORA = new Date("2026-10-12T12:00:00Z");
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: EMPRESA,
  personaId: GERENTE,
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: AHORA,
};
const ID = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60";
const ID_2 = "1c4b1d6f-9a8e-4d2c-8b3f-2e3d4c5b6a71";
const MANANA = new Date(AHORA.getTime() + 86_400_000);

const sinUso = (nombre: string) => () => {
  throw new Error(`no se esperaba usar ${nombre}`);
};

type Mundo = {
  auditoria: RegistroDeAuditoria[];
};

/** Una transacción en memoria: lo que la prueba no pisa, falla si se usa. */
function armar(pisar: Partial<TxDeConfiguracionFiscal> = {}) {
  const mundo: Mundo = { auditoria: [] };
  const tx: TxDeConfiguracionFiscal = {
    empresas: { obtener: () => Promise.resolve({ tenantId: "t" as never, estado: "ACTIVE" }) },
    tenants: { obtener: () => Promise.resolve({ estado: "ACTIVE" }) },
    emisores: { obtener: () => Promise.resolve(emisor({ id: EMISOR_1, esPrincipal: true })) },
    domicilios: { crear: sinUso("domicilios.crear"), obtener: sinUso("domicilios.obtener") },
    datosFiscales: {
      obtener: sinUso("datosFiscales.obtener"),
      obtenerBorrador: sinUso("datosFiscales.obtenerBorrador"),
      confirmadas: sinUso("datosFiscales.confirmadas"),
      crearBorrador: sinUso("datosFiscales.crearBorrador"),
      guardarBorrador: sinUso("datosFiscales.guardarBorrador"),
      confirmar: sinUso("datosFiscales.confirmar"),
    },
    reglasDeEmisor: {
      obtener: sinUso("reglas.obtener"),
      obtenerBorrador: sinUso("reglas.obtenerBorrador"),
      confirmadas: sinUso("reglas.confirmadas"),
      crearBorrador: sinUso("reglas.crearBorrador"),
      guardarBorrador: sinUso("reglas.guardarBorrador"),
      confirmar: sinUso("reglas.confirmar"),
    },
    puntosDeVenta: {
      obtener: sinUso("pv.obtener"),
      listarDelEmisor: sinUso("pv.listarDelEmisor"),
      crear: sinUso("pv.crear"),
      guardar: sinUso("pv.guardar"),
    },
    series: { hayNumerosUsadosDelPuntoDeVenta: () => Promise.resolve(false) },
    auditoria: {
      registrar: (r) => {
        mundo.auditoria.push(r);
        return Promise.resolve();
      },
    },
    autorizacion: {
      delActor: () =>
        Promise.resolve({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] }),
      sucursalesDelActor: () => Promise.resolve("TODAS"),
    },
    ...pisar,
  };
  const transacciones: Transacciones<TxDeConfiguracionFiscal> = {
    ejecutar: (_opciones, trabajo) => trabajo(tx),
  };
  return {
    mundo,
    casos: crearCasosDeUsoDeConfiguracionFiscal({ transacciones, reglas: REGLAS_DE_EMPRESA }),
  };
}

const borrador = (cambios: Partial<DatosFiscalesBorrador> = {}): DatosFiscalesBorrador => ({
  id: versionId(ID),
  empresaId: EMPRESA,
  emisorId: EMISOR_1,
  razonSocial: "Coop SA",
  condicionIva: "MONOTRIBUTO",
  domicilioFiscalId: DOMICILIO_1,
  inicioActividades: "2020-01-01",
  iibbNumero: null,
  iibbCondicion: null,
  creadoPor: GERENTE,
  version: 1,
  ...cambios,
});

const pvGuardado = (cambios: Partial<PuntoDeVentaGuardado> = {}): PuntoDeVentaGuardado => ({
  ...puntoDeVenta({ id: puntoDeVentaId(ID), emisorId: EMISOR_1 }),
  ambiente: "HOMOLOGACION",
  ...cambios,
});

describe("guardarBorradorDeDatosFiscales: lo que la base real no deja armar", () => {
  const entrada = {
    emisorId: EMISOR_1,
    borradorId: ID,
    cambios: { razonSocial: "Coop SA" },
  } as const;

  it("si otro guardado con el mismo id ganó entre la lectura y el alta, es la repetición cuando dejó lo mismo", async () => {
    const { casos, mundo } = armar({
      datosFiscales: {
        obtener: () => Promise.resolve(null),
        obtenerBorrador: () => Promise.resolve(null),
        crearBorrador: () =>
          Promise.resolve(
            ok({
              creado: false,
              valor: borrador({
                condicionIva: null,
                domicilioFiscalId: null,
                inicioActividades: null,
                version: 3,
              }),
            }),
          ),
      } as never,
    });
    expect(await casos.guardarBorradorDeDatosFiscales(contexto, entrada)).toEqual(
      ok({ borradorId: versionId(ID), version: 3, yaEstaba: true }),
    );
    expect(mundo.auditoria).toEqual([]);
  });

  it("si el que ganó dejó otra cosa, es VERSION_DESACTUALIZADA", async () => {
    const { casos } = armar({
      datosFiscales: {
        obtener: () => Promise.resolve(null),
        obtenerBorrador: () => Promise.resolve(null),
        crearBorrador: () =>
          Promise.resolve(ok({ creado: false, valor: borrador({ razonSocial: "Otra SA" }) })),
      } as never,
    });
    expect(await casos.guardarBorradorDeDatosFiscales(contexto, entrada)).toEqual(
      err("VERSION_DESACTUALIZADA"),
    );
  });

  it("un id tomado por algo que la empresa no ve es ID_EN_USO", async () => {
    const { casos } = armar({
      datosFiscales: {
        obtener: () => Promise.resolve(null),
        obtenerBorrador: () => Promise.resolve(null),
        crearBorrador: () => Promise.resolve(err("ID_EN_USO")),
      } as never,
    });
    expect(await casos.guardarBorradorDeDatosFiscales(contexto, entrada)).toEqual(err("ID_EN_USO"));
  });

  it("un id que es el borrador de otro emisor es ID_EN_USO aunque el alta diga que ya existía", async () => {
    const { casos } = armar({
      datosFiscales: {
        obtener: () => Promise.resolve(null),
        obtenerBorrador: () => Promise.resolve(null),
        crearBorrador: () =>
          Promise.resolve(
            ok({ creado: false, valor: borrador({ emisorId: "otro-emisor" as never }) }),
          ),
      } as never,
    });
    expect(await casos.guardarBorradorDeDatosFiscales(contexto, entrada)).toEqual(err("ID_EN_USO"));
  });

  it("si el `guardar` pierde la versión (otra transacción cambió antes), es VERSION_DESACTUALIZADA y no audita", async () => {
    const { casos, mundo } = armar({
      datosFiscales: {
        obtenerBorrador: () => Promise.resolve(borrador()),
        guardarBorrador: () => Promise.resolve(null),
      } as never,
    });
    expect(
      await casos.guardarBorradorDeDatosFiscales(contexto, {
        ...entrada,
        versionEsperada: 1,
        cambios: { razonSocial: "Cambiada SA" },
      }),
    ).toEqual(err("VERSION_DESACTUALIZADA"));
    expect(mundo.auditoria).toEqual([]);
  });
});

describe("confirmarDatosFiscales: lo que la base real no deja armar", () => {
  const entrada = {
    emisorId: EMISOR_1,
    borradorId: ID,
    versionEsperada: 1,
    vigenteDesde: MANANA,
    motivo: "Alta",
  } as const;

  it("si `confirmar` pierde la versión, es VERSION_DESACTUALIZADA y no audita", async () => {
    const { casos, mundo } = armar({
      datosFiscales: {
        obtener: () => Promise.resolve({ estado: "BORRADOR", borrador: borrador() }),
        confirmadas: () => Promise.resolve([]),
        confirmar: () => Promise.resolve(null),
      } as never,
    });
    expect(await casos.confirmarDatosFiscales(contexto, entrada)).toEqual(
      err("VERSION_DESACTUALIZADA"),
    );
    expect(mundo.auditoria).toEqual([]);
  });

  it("una versión ya confirmada responde «ya estaba» con SUS datos, sin pedir las demás ni escribir", async () => {
    const confirmada: DatosFiscalesConfirmados = {
      id: versionId(ID),
      empresaId: EMPRESA,
      emisorId: EMISOR_1,
      numero: 4,
      razonSocial: "Coop SA",
      condicionIva: "MONOTRIBUTO",
      domicilioFiscalId: DOMICILIO_1,
      inicioActividades: "2020-01-01",
      iibbNumero: null,
      iibbCondicion: null,
      vigenteDesde: AHORA,
      confirmadaEn: AHORA,
      confirmadaPor: GERENTE,
      motivo: "Alta",
      version: 2,
    };
    const { casos, mundo } = armar({
      datosFiscales: {
        obtener: () => Promise.resolve({ estado: "CONFIRMADA", confirmada }),
      } as never,
    });
    expect(await casos.confirmarDatosFiscales(contexto, entrada)).toEqual(
      ok({ borradorId: versionId(ID), numero: 4, vigenteDesde: AHORA, yaEstaba: true }),
    );
    expect(mundo.auditoria).toEqual([]);
  });
});

describe("puntos de venta: lo que la base real no deja armar", () => {
  const nuevoPv = {
    id: ID,
    emisorId: EMISOR_1,
    sucursalId: SUCURSAL,
    numero: 1,
  } as const;

  it("si otra alta del mismo id ganó entre la lectura y la escritura, es la repetición cuando pidió lo mismo", async () => {
    const { casos, mundo } = armar({
      puntosDeVenta: {
        obtener: () => Promise.resolve(null),
        listarDelEmisor: () => Promise.resolve([]),
        crear: () => Promise.resolve(ok({ creado: false, valor: pvGuardado({ version: 2 }) })),
      } as never,
    });
    expect(await casos.crearPuntoDeVenta(contexto, nuevoPv)).toEqual(
      ok({ puntoDeVentaId: puntoDeVentaId(ID), version: 2, yaExistia: true }),
    );
    expect(mundo.auditoria).toEqual([]);
  });

  it("si la que ganó pidió otra cosa, o el id es de una fila que no se ve, es ID_EN_USO", async () => {
    const { casos } = armar({
      puntosDeVenta: {
        obtener: () => Promise.resolve(null),
        listarDelEmisor: () => Promise.resolve([]),
        crear: () => Promise.resolve(ok({ creado: false, valor: pvGuardado({ numero: 9 }) })),
      } as never,
    });
    expect(await casos.crearPuntoDeVenta(contexto, nuevoPv)).toEqual(err("ID_EN_USO"));
    const { casos: otros } = armar({
      puntosDeVenta: {
        obtener: () => Promise.resolve(null),
        listarDelEmisor: () => Promise.resolve([]),
        crear: () => Promise.resolve(err("ID_EN_USO")),
      } as never,
    });
    expect(await otros.crearPuntoDeVenta(contexto, nuevoPv)).toEqual(err("ID_EN_USO"));
  });

  it("editar: si `guardar` pierde la versión es VERSION_DESACTUALIZADA y no audita", async () => {
    const { casos, mundo } = armar({
      puntosDeVenta: {
        obtener: () => Promise.resolve(pvGuardado()),
        listarDelEmisor: () => Promise.resolve([pvGuardado()]),
        guardar: () => Promise.resolve(null),
      } as never,
    });
    expect(
      await casos.editarPuntoDeVenta(contexto, {
        puntoDeVentaId: puntoDeVentaId(ID),
        versionEsperada: 1,
        numero: 2,
      }),
    ).toEqual(err("VERSION_DESACTUALIZADA"));
    expect(mundo.auditoria).toEqual([]);
  });

  it("activar y desactivar: si `guardar` no encuentra la fila, es PUNTO_DE_VENTA_NO_ENCONTRADO y no audita", async () => {
    const activar = armar({
      puntosDeVenta: {
        obtener: () => Promise.resolve(pvGuardado()),
        guardar: () => Promise.resolve(null),
      } as never,
    });
    expect(
      await activar.casos.activarPuntoDeVenta(contexto, { puntoDeVentaId: puntoDeVentaId(ID) }),
    ).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
    const desactivar = armar({
      puntosDeVenta: {
        obtener: () => Promise.resolve(pvGuardado({ estado: "ACTIVO" })),
        guardar: () => Promise.resolve(null),
      } as never,
    });
    expect(
      await desactivar.casos.desactivarPuntoDeVenta(contexto, {
        puntoDeVentaId: puntoDeVentaId(ID),
      }),
    ).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
    expect(activar.mundo.auditoria).toEqual([]);
    expect(desactivar.mundo.auditoria).toEqual([]);
  });

  it("activar con un emisor que falta es una configuración rota (la clave foránea lo impide): se lanza", async () => {
    const { casos } = armar({
      emisores: { obtener: () => Promise.resolve(null) },
      puntosDeVenta: { obtener: () => Promise.resolve(pvGuardado()) } as never,
    });
    await expect(
      casos.activarPuntoDeVenta(contexto, { puntoDeVentaId: puntoDeVentaId(ID) }),
    ).rejects.toThrow(/emisor/);
  });
});

describe("confirmarReglaDeEmisor: lo que la base real no deja armar", () => {
  const entrada = {
    versionId: ID,
    permitirEleccionManual: false,
    vigenteDesde: MANANA,
    motivo: "Cambio",
  } as const;
  const base = {
    obtener: () => Promise.resolve(null),
    confirmadas: () => Promise.resolve([]),
  };

  it("un borrador que ya existía con ese id, o que no se pudo crear, es ID_EN_USO", async () => {
    const yaExistia = armar({
      reglasDeEmisor: {
        ...base,
        crearBorrador: () =>
          Promise.resolve(
            ok({
              creado: false,
              valor: {
                id: versionId(ID),
                empresaId: EMPRESA,
                permitirEleccionManual: false,
                creadoPor: GERENTE,
                version: 1,
              },
            }),
          ),
      } as never,
    });
    expect(await yaExistia.casos.confirmarReglaDeEmisor(contexto, entrada)).toEqual(
      err("ID_EN_USO"),
    );
    const noSePudo = armar({
      reglasDeEmisor: { ...base, crearBorrador: () => Promise.resolve(err("ID_EN_USO")) } as never,
    });
    expect(await noSePudo.casos.confirmarReglaDeEmisor(contexto, entrada)).toEqual(
      err("ID_EN_USO"),
    );
    expect(yaExistia.mundo.auditoria).toEqual([]);
  });

  it("si el borrador recién creado no se puede confirmar, es una invariante rota: se lanza", async () => {
    const { casos } = armar({
      reglasDeEmisor: {
        ...base,
        crearBorrador: () =>
          Promise.resolve(
            ok({
              creado: true,
              valor: {
                id: versionId(ID),
                empresaId: EMPRESA,
                permitirEleccionManual: false,
                creadoPor: GERENTE,
                version: 1,
              },
            }),
          ),
        confirmar: () => Promise.resolve(null),
      } as never,
    });
    await expect(casos.confirmarReglaDeEmisor(contexto, entrada)).rejects.toThrow(/invariante/);
  });

  it("una versión sin confirmar con ese id (un borrador que quedó) no es una repetición: ID_EN_USO", async () => {
    const { casos } = armar({
      reglasDeEmisor: {
        obtener: () =>
          Promise.resolve({
            estado: "BORRADOR",
            borrador: {
              id: versionId(ID),
              empresaId: EMPRESA,
              permitirEleccionManual: false,
              creadoPor: GERENTE,
              version: 1,
            },
          }),
      } as never,
    });
    expect(await casos.confirmarReglaDeEmisor(contexto, entrada)).toEqual(err("ID_EN_USO"));
  });
});

describe("cambiosParaAuditar", () => {
  it("devuelve solo lo que cambió, con el antes y el después de cada campo", () => {
    expect(cambiosParaAuditar({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: "nuevo" })).toEqual({
      antes: { b: "x", c: null },
      despues: { b: "y", c: "nuevo" },
    });
  });

  it("sin cambios los dos vienen vacíos", () => {
    expect(cambiosParaAuditar({ a: 1 }, { a: 1 })).toEqual({ antes: {}, despues: {} });
  });

  it("un campo que no estaba antes cuenta como nulo antes; y uno que pasa a nulo, como cambio", () => {
    expect(cambiosParaAuditar({}, { a: "x" })).toEqual({ antes: { a: null }, despues: { a: "x" } });
    expect(cambiosParaAuditar({ a: "x" }, { a: null })).toEqual({
      antes: { a: "x" },
      despues: { a: null },
    });
    expect(cambiosParaAuditar({}, { a: null })).toEqual({ antes: {}, despues: {} });
  });
});

describe("dejarListoElDomicilio", () => {
  const datos = { calle: "Mitre", numero: "10", localidad: "Rosario", provincia: "AR-S" };
  const domicilio = domicilioDesdeDatos(datos);
  if (!domicilio.ok) throw new Error("domicilio de prueba inválido");

  it("un domicilio nuevo se crea con el id de la pantalla y devuelve ese id", async () => {
    const creados: string[] = [];
    const r = await dejarListoElDomicilio(
      {
        domicilios: {
          crear: (_e, id) => {
            creados.push(id);
            return Promise.resolve(ok({ creado: true, valor: {} as never }));
          },
          obtener: sinUso("obtener"),
        },
      },
      EMPRESA,
      { tipo: "NUEVO", id: domicilioId(ID), datos },
    );
    expect(r).toEqual(ok(ID));
    expect(creados).toEqual([ID]);
  });

  it("un id que no es uuid se rechaza sin tocar nada, nuevo o existente", async () => {
    const tx = { domicilios: { crear: sinUso("crear"), obtener: sinUso("obtener") } };
    expect(
      await dejarListoElDomicilio(tx, EMPRESA, { tipo: "NUEVO", id: domicilioId("x"), datos }),
    ).toEqual(err("ID_INVALIDO"));
    expect(
      await dejarListoElDomicilio(tx, EMPRESA, { tipo: "EXISTENTE", id: domicilioId("x") }),
    ).toEqual(err("ID_INVALIDO"));
  });

  it("uno existente que no se encuentra es DOMICILIO_NO_ENCONTRADO; uno que está, devuelve su id", async () => {
    const buscar = (hallado: boolean) => ({
      domicilios: {
        crear: sinUso("crear"),
        obtener: () => Promise.resolve(hallado ? ({} as never) : null),
      },
    });
    const existente = { tipo: "EXISTENTE", id: domicilioId(ID_2) } as const;
    expect(await dejarListoElDomicilio(buscar(false), EMPRESA, existente)).toEqual(
      err("DOMICILIO_NO_ENCONTRADO"),
    );
    expect(await dejarListoElDomicilio(buscar(true), EMPRESA, existente)).toEqual(ok(ID_2));
  });

  it("los errores del dominio y de la alta pasan tal cual, y un domicilio inválido no escribe", async () => {
    const tx = { domicilios: { crear: sinUso("crear"), obtener: sinUso("obtener") } };
    expect(
      await dejarListoElDomicilio(tx, EMPRESA, {
        tipo: "NUEVO",
        id: domicilioId(ID),
        datos: { ...datos, calle: "" },
      }),
    ).toEqual(err("CALLE_INVALIDA"));
    expect(
      await dejarListoElDomicilio(
        {
          domicilios: {
            crear: () => Promise.resolve(err("ID_EN_USO")),
            obtener: sinUso("obtener"),
          },
        },
        EMPRESA,
        { tipo: "NUEVO", id: domicilioId(ID), datos },
      ),
    ).toEqual(err("ID_EN_USO"));
  });
});
