import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { EmisionFalsa } from "../../../../test/utilidades/emision-falsa";
import {
  CUIT_A,
  CUIT_B,
  EMISOR_1,
  EMPRESA,
  GERENTE,
  SUCURSAL,
  emisor,
  puntoDeVenta,
  serieEnCurso,
  serieLibre,
} from "../../../../test/utilidades/fiscal";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { RegistroDeAuditoria } from "../../../puertos/auditoria";
import type { Transacciones } from "../../../puertos/transacciones";
import type { PuntoDeVentaDeArca } from "../dominio/habilitacion-en-arca";
import { puntoDeVentaId } from "../dominio/identificadores";
import type { Serie } from "../dominio/numeracion";
import type { PuntoDeVentaGuardado } from "../persistencia/repositorios";
import {
  crearCasosDeUsoDeFacturacion,
  type CasosDeUsoDeFacturacion,
} from "./casos-de-uso-de-facturacion";
import type { TxDeFacturacion } from "./contrato-de-facturacion";
import type { ErrorDeEmision } from "./emision-electronica";

/**
 * Pasar un punto de venta a producción verifica contra ARCA (D-77, dueño, 2026-10-29), con repositorios y ARCA EN MEMORIA: el orden de
 * la llamada respecto de las transacciones, cada causa de rechazo (sin cambiar ni auditar nada), la repetición y lo que cambia mientras
 * se espera a ARCA. La carrera de dos pasajes contra una base real está en `test/integracion/facturacion-ambiente-arca.test.ts`.
 * ARCA es un falso: SIN VERIFICAR contra ARCA real (no hay grabación de `FEParamGetPtosVenta`).
 */

const AHORA = new Date("2026-11-03T12:00:00Z");
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: EMPRESA,
  personaId: GERENTE,
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: AHORA,
};
const PV = puntoDeVentaId("pv-1");
const HABILITADO: PuntoDeVentaDeArca = { numero: 1, bloqueado: false, dadoDeBaja: false };
const VENCE_MAS_ADELANTE = new Date(AHORA.getTime() + 86_400_000);

const CON_FACTURACION: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

type Mundo = {
  pv: PuntoDeVentaGuardado;
  cuitDelEmisor: Cuit;
  series: Serie[];
  certificado: Readonly<{ venceEn: Date | null }> | null;
  sucursalActiva: boolean;
  estadoDeEmpresa: "ACTIVE" | "SUSPENDED";
  rol: RolDeEmpresa | null;
  auditoria: RegistroDeAuditoria[];
  /** Lo que pasó, en orden: `tx` (abre), `/tx` (cierra), `arca`, `for-share`, `escribe`. */
  eventos: string[];
  /** Cuántas transacciones había abiertas cuando se llamó a ARCA. */
  abiertasAlLlamar: number[];
  abiertas: number;
  opcionesDeLasTransacciones: { soloLectura: boolean }[];
  paraArca: { ambiente: string; emisor: string }[];
};

const pvGuardado = (cambios: Partial<PuntoDeVentaGuardado> = {}): PuntoDeVentaGuardado => ({
  ...puntoDeVenta({ id: PV, emisorId: EMISOR_1, sucursalId: SUCURSAL, numero: 1, version: 7 }),
  ambiente: "HOMOLOGACION",
  ...cambios,
});

type Armado = Readonly<{
  casos: CasosDeUsoDeFacturacion;
  mundo: Mundo;
  falsa: EmisionFalsa;
}>;

/**
 * El servicio de emisión de la prueba: el falso de siempre, que anota las transacciones abiertas al llamarlo y deja a la prueba hacer algo
 * «mientras ARCA contesta» (`mientrasTanto`: lo que otro pedido o persona podría haber cambiado).
 */
class ArcaDePrueba extends EmisionFalsa {
  constructor(
    private readonly mundo: Mundo,
    private readonly mientrasTanto: () => Promise<void> | void,
    private readonly colgada: boolean,
    private readonly lanza: boolean,
  ) {
    super();
  }
  override async puntosDeVenta(
    cuit: Cuit,
  ): Promise<Resultado<readonly PuntoDeVentaDeArca[], ErrorDeEmision>> {
    this.mundo.eventos.push("arca");
    this.mundo.abiertasAlLlamar.push(this.mundo.abiertas);
    if (this.lanza) throw new Error("se cortó la conexión con postgres://usuario:clave@host/base");
    if (this.colgada) return new Promise(() => undefined);
    await this.mientrasTanto();
    return super.puntosDeVenta(cuit);
  }
}

function armar(
  inicial: Partial<Mundo> = {},
  opciones: Readonly<{
    arca?: readonly PuntoDeVentaDeArca[];
    caida?: boolean;
    colgada?: boolean;
    lanza?: boolean;
    mientrasTanto?: (mundo: Mundo) => Promise<void> | void;
    limiteEnMs?: number;
  }> = {},
): Armado {
  const mundo: Mundo = {
    pv: pvGuardado(),
    cuitDelEmisor: CUIT_A,
    series: [serieLibre(0n)],
    certificado: { venceEn: VENCE_MAS_ADELANTE },
    sucursalActiva: true,
    estadoDeEmpresa: "ACTIVE",
    rol: "GERENTE",
    auditoria: [],
    eventos: [],
    abiertasAlLlamar: [],
    abiertas: 0,
    opcionesDeLasTransacciones: [],
    paraArca: [],
    ...inicial,
  };
  const falsa = new ArcaDePrueba(
    mundo,
    () => opciones.mientrasTanto?.(mundo),
    opciones.colgada ?? false,
    opciones.lanza ?? false,
  );
  falsa.declararPuntosDeVenta(CUIT_A, opciones.arca ?? [HABILITADO]);
  falsa.puntosDeVentaCaido = opciones.caida ?? false;

  const reales = {
    autorizacion: {
      delActor: () =>
        Promise.resolve({
          rol: mundo.rol,
          modulosActivados: ["facturacion"],
          modulosHabilitados: ["facturacion"],
        }),
      sucursalesDelActor: () => Promise.resolve("TODAS"),
    },
    empresas: {
      obtener: () =>
        Promise.resolve({
          tenantId: "t" as never,
          estado: mundo.estadoDeEmpresa,
          zonaHoraria: "America/Argentina/Buenos_Aires",
        }),
    },
    tenants: { obtener: () => Promise.resolve({ estado: "ACTIVE" }) },
    emisores: {
      obtener: () => Promise.resolve(emisor({ id: EMISOR_1, cuit: mundo.cuitDelEmisor })),
    },
    puntosDeVenta: {
      obtener: () => Promise.resolve(mundo.pv.id === PV ? { ...mundo.pv } : null),
      cambiarAmbiente: (
        _empresa: unknown,
        _id: unknown,
        ambiente: PuntoDeVentaGuardado["ambiente"],
        versionEsperada: number,
      ) => {
        if (mundo.pv.version !== versionEsperada) return Promise.resolve(null);
        mundo.eventos.push("escribe");
        mundo.pv = { ...mundo.pv, ambiente, version: mundo.pv.version + 1 };
        return Promise.resolve({ ...mundo.pv });
      },
    },
    series: { delPuntoDeVenta: () => Promise.resolve(mundo.series) },
    certificados: { vigente: () => Promise.resolve(mundo.certificado) },
    sucursalBloqueada: {
      obtenerBloqueandoElCierre: () => {
        mundo.eventos.push("for-share");
        return Promise.resolve({ activa: mundo.sucursalActiva });
      },
    },
    auditoria: {
      registrar: (r: RegistroDeAuditoria) => {
        mundo.auditoria.push(r);
        return Promise.resolve();
      },
    },
  };
  // Lo que el caso toque y la prueba no declaró corta: así se ve que solo usa lo que dice.
  const tx = new Proxy({} as TxDeFacturacion, {
    get(_objetivo, propiedad) {
      if (propiedad in reales) return reales[propiedad as keyof typeof reales];
      throw new Error(`la prueba no esperaba usar tx.${String(propiedad)}`);
    },
  });

  // Las escrituras se ordenan una detrás de otra, como la base serializable las deja (la que reintenta lee lo que dejó la otra).
  let cola: Promise<unknown> = Promise.resolve();
  const transacciones: Transacciones<TxDeFacturacion> = {
    ejecutar: (opcionesDeLaTx, trabajo) => {
      const correr = async () => {
        mundo.abiertas += 1;
        mundo.eventos.push("tx");
        mundo.opcionesDeLasTransacciones.push({ soloLectura: opcionesDeLaTx.soloLectura === true });
        try {
          return await trabajo(tx);
        } finally {
          mundo.abiertas -= 1;
          mundo.eventos.push("/tx");
        }
      };
      if (opcionesDeLaTx.soloLectura === true) return correr();
      const turno = cola.then(correr, correr);
      cola = turno.catch(() => undefined);
      return turno;
    },
  };
  const casos = crearCasosDeUsoDeFacturacion({
    transacciones,
    reglas: CON_FACTURACION,
    emision: {
      para: (_empresa, emisorId, ambiente) => {
        mundo.paraArca.push({ ambiente, emisor: emisorId });
        return falsa;
      },
    },
    reloj: { ahora: () => AHORA },
    opciones: {
      tiempos: {
        autorizarEnMs: 1_000,
        consultarEnMs: 1_000,
        ultimoAutorizadoEnMs: 1_000,
        puntosDeVentaEnMs: opciones.limiteEnMs ?? 1_000,
      },
    },
  });
  return { casos, mundo, falsa };
}

const pasar = (casos: CasosDeUsoDeFacturacion, versionEsperada = 7) =>
  casos.cambiarAmbienteDePuntoDeVenta(contexto, {
    puntoDeVentaId: PV,
    ambiente: "PRODUCCION",
    versionEsperada,
  });

/** Nada cambió: el punto de venta sigue como estaba, no se escribió ni se auditó. */
function sinCambios(mundo: Mundo) {
  expect(mundo.pv).toEqual(pvGuardado());
  expect(mundo.eventos).not.toContain("escribe");
  expect(mundo.auditoria).toEqual([]);
}

describe("pasar a producción: el punto de venta existe en ARCA y está habilitado", () => {
  it("pasa, cambia el ambiente una sola vez y audita en la misma transacción", async () => {
    const { casos, mundo } = armar();
    expect(await pasar(casos)).toEqual({ ok: true, valor: { yaEstaba: false } });
    expect(mundo.pv).toMatchObject({ ambiente: "PRODUCCION", version: 8 });
    expect(mundo.auditoria).toEqual([
      {
        empresaId: EMPRESA,
        actorPersonaId: GERENTE,
        accion: "PUNTO_DE_VENTA_AMBIENTE_CAMBIADO",
        entidad: "punto_de_venta",
        entidadId: PV,
        antes: { ambiente: "HOMOLOGACION" },
        despues: { ambiente: "PRODUCCION", verificadoEnArca: true },
      },
    ]);
    // La auditoría y el cambio están dentro de la misma transacción: ninguna se cerró entre `escribe` y la auditoría.
    expect(mundo.eventos.slice(mundo.eventos.indexOf("escribe"))).toEqual(["escribe", "/tx"]);
  });

  it("le pregunta a ARCA con la CUIT del emisor y el servicio de PRODUCCIÓN de ese emisor, y busca el número del punto de venta", async () => {
    const { casos, mundo, falsa } = armar({ cuitDelEmisor: CUIT_A });
    await pasar(casos);
    expect(falsa.consultasDePuntosDeVenta).toEqual([CUIT_A]);
    expect(mundo.paraArca).toEqual([{ ambiente: "PRODUCCION", emisor: EMISOR_1 }]);
  });

  it("la CUIT con la que pregunta es la de ESE emisor: ARCA que solo tiene el número para otra CUIT no lo habilita", async () => {
    const { casos, mundo } = armar({ cuitDelEmisor: CUIT_B });
    expect(await pasar(casos)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA",
    });
    sinCambios(mundo);
  });

  it("ARCA se llama FUERA de toda transacción: una de lectura antes, una de escritura después", async () => {
    const { casos, mundo } = armar();
    await pasar(casos);
    expect(mundo.abiertasAlLlamar).toEqual([0]);
    expect(mundo.eventos).toEqual(["tx", "/tx", "arca", "tx", "for-share", "escribe", "/tx"]);
    expect(mundo.opcionesDeLasTransacciones).toEqual([
      { soloLectura: true },
      { soloLectura: false },
    ]);
  });

  it("la sucursal se lee con FOR SHARE antes de escribir", async () => {
    const { casos, mundo } = armar();
    await pasar(casos);
    expect(mundo.eventos.indexOf("for-share")).toBeLessThan(mundo.eventos.indexOf("escribe"));
  });
});

describe("pasar a producción: ARCA no lo tiene habilitado, no cambia nada", () => {
  const rechazado = { ok: false, error: "PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA" } as const;

  it("el número no existe en ARCA (la lista no lo trae)", async () => {
    const { casos, mundo } = armar({}, { arca: [{ ...HABILITADO, numero: 2 }] });
    expect(await pasar(casos)).toEqual(rechazado);
    sinCambios(mundo);
  });

  it("ARCA no tiene ningún punto de venta para la CUIT (lista vacía)", async () => {
    const { casos, mundo } = armar({}, { arca: [] });
    expect(await pasar(casos)).toEqual(rechazado);
    sinCambios(mundo);
  });

  it("existe pero está bloqueado", async () => {
    const { casos, mundo } = armar({}, { arca: [{ ...HABILITADO, bloqueado: true }] });
    expect(await pasar(casos)).toEqual(rechazado);
    sinCambios(mundo);
  });

  it("existe pero está dado de baja", async () => {
    const { casos, mundo } = armar({}, { arca: [{ ...HABILITADO, dadoDeBaja: true }] });
    expect(await pasar(casos)).toEqual(rechazado);
    sinCambios(mundo);
  });

  it("figura dos veces: no se sabe cuál vale", async () => {
    const { casos, mundo } = armar({}, { arca: [HABILITADO, { ...HABILITADO, bloqueado: true }] });
    expect(await pasar(casos)).toEqual(rechazado);
    sinCambios(mundo);
  });

  it("después del rechazo, cuando ARCA lo da de alta, el mismo pedido pasa (nada quedó a medias)", async () => {
    const { casos, mundo, falsa } = armar({}, { arca: [] });
    expect(await pasar(casos)).toEqual(rechazado);
    falsa.declararPuntosDeVenta(CUIT_A, [HABILITADO]);
    expect(await pasar(casos)).toEqual({ ok: true, valor: { yaEstaba: false } });
    expect(mundo.pv.ambiente).toBe("PRODUCCION");
    expect(mundo.auditoria).toHaveLength(1);
  });
});

describe("pasar a producción: fail closed si no se puede saber", () => {
  it("ARCA caída: servicio no disponible, sin cambiar nada", async () => {
    const { casos, mundo } = armar({}, { caida: true });
    expect(await pasar(casos)).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "servicio caído (falso)" },
    });
    sinCambios(mundo);
  });

  it("ARCA que no contesta: el tiempo límite propio corta la espera, sin cambiar nada", async () => {
    const { casos, mundo } = armar({}, { colgada: true, limiteEnMs: 30 });
    const inicio = Date.now();
    const r = await pasar(casos);
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "puntos de venta: sin respuesta en 30 ms",
      },
    });
    sinCambios(mundo);
  });

  it("un servicio que lanza una excepción: servicio no disponible, y el texto de la excepción no sale", async () => {
    const { casos, mundo } = armar({}, { lanza: true });
    const r = await pasar(casos);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "puntos de venta: el adaptador falló sin respuesta",
      },
    });
    expect(JSON.stringify(r)).not.toContain("postgres://");
    sinCambios(mundo);
  });

  it("sin certificado de producción cargado: SIN_CERTIFICADO_VIGENTE, y ni se le pregunta a ARCA", async () => {
    const { casos, mundo, falsa } = armar({ certificado: null });
    expect(await pasar(casos)).toEqual({ ok: false, error: "SIN_CERTIFICADO_VIGENTE" });
    expect(falsa.consultasDePuntosDeVenta).toEqual([]);
    sinCambios(mundo);
  });

  it("con el certificado vencido (o sin vencimiento conocido): lo mismo", async () => {
    for (const venceEn of [new Date(AHORA.getTime() - 1), AHORA, null]) {
      const { casos, mundo, falsa } = armar({ certificado: { venceEn } });
      expect(await pasar(casos)).toEqual({ ok: false, error: "SIN_CERTIFICADO_VIGENTE" });
      expect(falsa.consultasDePuntosDeVenta).toEqual([]);
      sinCambios(mundo);
    }
  });
});

describe("pasar a producción: lo que ya se decidía antes sigue igual y no llama a ARCA", () => {
  it("repetir un pedido ya aplicado es «ya estaba»: sin llamar a ARCA (aunque esté caída), sin escribir ni auditar", async () => {
    const { casos, mundo, falsa } = armar(
      { pv: pvGuardado({ ambiente: "PRODUCCION" }) },
      { caida: true },
    );
    expect(await pasar(casos, 0)).toEqual({ ok: true, valor: { yaEstaba: true } });
    expect(falsa.consultasDePuntosDeVenta).toEqual([]);
    expect(mundo.eventos).toEqual(["tx", "/tx"]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("aplicarlo y repetirlo: la segunda vez es «ya estaba», con una sola auditoría y una sola consulta a ARCA", async () => {
    const { casos, mundo, falsa } = armar();
    expect(await pasar(casos)).toEqual({ ok: true, valor: { yaEstaba: false } });
    expect(await pasar(casos)).toEqual({ ok: true, valor: { yaEstaba: true } });
    expect(mundo.auditoria).toHaveLength(1);
    expect(falsa.consultasDePuntosDeVenta).toHaveLength(1);
  });

  it("de pruebas a pruebas es «ya estaba»; de producción a pruebas no se vuelve (QF2). Ninguno llama a ARCA", async () => {
    const pruebas = armar();
    expect(
      await pruebas.casos.cambiarAmbienteDePuntoDeVenta(contexto, {
        puntoDeVentaId: PV,
        ambiente: "HOMOLOGACION",
        versionEsperada: 0,
      }),
    ).toEqual({ ok: true, valor: { yaEstaba: true } });
    const produccion = armar({ pv: pvGuardado({ ambiente: "PRODUCCION" }) });
    expect(
      await produccion.casos.cambiarAmbienteDePuntoDeVenta(contexto, {
        puntoDeVentaId: PV,
        ambiente: "HOMOLOGACION",
        versionEsperada: 7,
      }),
    ).toEqual({ ok: false, error: "AMBIENTE_NO_VUELVE" });
    expect(pruebas.falsa.consultasDePuntosDeVenta).toEqual([]);
    expect(produccion.falsa.consultasDePuntosDeVenta).toEqual([]);
  });

  it("un punto de venta que no existe, una versión vieja o una serie en curso: su error de siempre, sin llamar a ARCA", async () => {
    const noExiste = armar({ pv: pvGuardado({ id: puntoDeVentaId("otro") }) });
    expect(await pasar(noExiste.casos)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NO_ENCONTRADO",
    });
    const vieja = armar();
    expect(await pasar(vieja.casos, 3)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    const enCurso = armar({ series: [serieEnCurso(0n, new Date(AHORA.getTime() + 60_000))] });
    expect(await pasar(enCurso.casos)).toEqual({ ok: false, error: "SERIE_EN_CURSO" });
    for (const m of [noExiste, vieja, enCurso]) {
      expect(m.falsa.consultasDePuntosDeVenta).toEqual([]);
      expect(m.mundo.eventos).not.toContain("escribe");
    }
  });

  it("sin permiso (el operador no cambia el ambiente) o con la empresa suspendida: se rechaza antes de todo, sin llamar a ARCA", async () => {
    const operador = armar({ rol: "OPERADOR" });
    expect(await pasar(operador.casos)).toEqual({ ok: false, error: "SIN_PERMISO" });
    const suspendida = armar({ estadoDeEmpresa: "SUSPENDED" });
    expect(await pasar(suspendida.casos)).toMatchObject({
      ok: false,
      error: { codigo: "EMPRESA_NO_OPERA" },
    });
    for (const m of [operador, suspendida]) {
      expect(m.falsa.consultasDePuntosDeVenta).toEqual([]);
      sinCambios(m.mundo);
    }
  });
});

describe("pasar a producción: sucursal cerrada (SUPUESTO (DEC-0069): el criterio de D-79 y D-80)", () => {
  it("con la sucursal del punto de venta cerrada no pasa: SUCURSAL_CERRADA, sin cambiar nada", async () => {
    const { casos, mundo } = armar({ sucursalActiva: false });
    expect(await pasar(casos)).toEqual({ ok: false, error: "SUCURSAL_CERRADA" });
    expect(mundo.eventos).toContain("for-share");
    sinCambios(mundo);
  });

  it("«ya estaba» va antes y no mira la sucursal: la repetición da lo mismo aunque se haya cerrado después", async () => {
    const { casos, mundo } = armar({
      pv: pvGuardado({ ambiente: "PRODUCCION" }),
      sucursalActiva: false,
    });
    expect(await pasar(casos, 0)).toEqual({ ok: true, valor: { yaEstaba: true } });
    expect(mundo.eventos).not.toContain("for-share");
  });
});

describe("pasar a producción: lo que cambia mientras se espera a ARCA", () => {
  it("el punto de venta se editó (su versión cambió): VERSION_DESACTUALIZADA, no se cambia lo que no se verificó", async () => {
    const { casos, mundo } = armar(
      {},
      { mientrasTanto: (m) => void (m.pv = { ...m.pv, numero: 2, version: 8 }) },
    );
    expect(await pasar(casos)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    expect(mundo.pv.ambiente).toBe("HOMOLOGACION");
    expect(mundo.eventos).not.toContain("escribe");
    expect(mundo.auditoria).toEqual([]);
  });

  it("la CUIT del emisor se corrigió: lo verificado no es lo que se cambiaría, VERSION_DESACTUALIZADA", async () => {
    const { casos, mundo } = armar({}, { mientrasTanto: (m) => void (m.cuitDelEmisor = CUIT_B) });
    expect(await pasar(casos)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    sinCambios(mundo);
  });

  it("la sucursal se cerró: SUCURSAL_CERRADA", async () => {
    const { casos, mundo } = armar({}, { mientrasTanto: (m) => void (m.sucursalActiva = false) });
    expect(await pasar(casos)).toEqual({ ok: false, error: "SUCURSAL_CERRADA" });
    sinCambios(mundo);
  });

  it("el certificado de producción se perdió: SIN_CERTIFICADO_VIGENTE", async () => {
    const { casos, mundo } = armar({}, { mientrasTanto: (m) => void (m.certificado = null) });
    expect(await pasar(casos)).toEqual({ ok: false, error: "SIN_CERTIFICADO_VIGENTE" });
    sinCambios(mundo);
  });

  it("aparece una serie en curso: SERIE_EN_CURSO", async () => {
    const { casos, mundo } = armar(
      {},
      {
        mientrasTanto: (m) =>
          void (m.series = [serieEnCurso(0n, new Date(AHORA.getTime() + 60_000))]),
      },
    );
    expect(await pasar(casos)).toEqual({ ok: false, error: "SERIE_EN_CURSO" });
    sinCambios(mundo);
  });

  it("otro pedido ya lo pasó a producción: «ya estaba», sin segundo cambio ni segunda auditoría", async () => {
    const { casos, mundo } = armar(
      {},
      { mientrasTanto: (m) => void (m.pv = { ...m.pv, ambiente: "PRODUCCION", version: 8 }) },
    );
    expect(await pasar(casos)).toEqual({ ok: true, valor: { yaEstaba: true } });
    expect(mundo.eventos).not.toContain("escribe");
    expect(mundo.auditoria).toEqual([]);
  });
});

describe("dos pasajes simultáneos del mismo punto de venta", () => {
  it("los dos le preguntan a ARCA, uno cambia y el otro ve «ya estaba»: un solo cambio y una sola auditoría", async () => {
    const { casos, mundo, falsa } = armar();
    const [a, b] = await Promise.all([pasar(casos), pasar(casos)]);
    expect([a, b].filter((r) => r.ok && !r.valor.yaEstaba)).toHaveLength(1);
    expect([a, b].filter((r) => r.ok && r.valor.yaEstaba)).toHaveLength(1);
    expect(falsa.consultasDePuntosDeVenta).toHaveLength(2);
    expect(mundo.pv).toMatchObject({ ambiente: "PRODUCCION", version: 8 });
    expect(mundo.eventos.filter((e) => e === "escribe")).toHaveLength(1);
    expect(mundo.auditoria).toHaveLength(1);
  });
});
