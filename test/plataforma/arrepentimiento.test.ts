import { describe, expect, it } from "vitest";
import {
  entradaDeArrepentir,
  explicacionDeLaFechaMinima,
  faltaDeAnticipacion,
  queMostrarDelUltimoCambio,
  textosDeLaConfirmacion,
  type UltimoCambioVista,
} from "../../apps/plataforma/logica/arrepentimiento";
import { fechaMinimaDelCambio, validarCambio } from "../../apps/plataforma/logica/cambio-de-plan";
import { errorDelCambioDePlan } from "../../apps/plataforma/logica/errores-de-cambio-de-plan";
import {
  armarPlanDeEmpresa,
  type PlanDeEmpresa,
} from "../../apps/plataforma/logica/plan-de-empresa";

const CAMBIO: UltimoCambioVista = {
  numero: 2,
  sentido: "BAJA",
  arrepentimientoHasta: "2026-11-23",
  yaArrepentido: false,
  puedeDeshacerHoy: true,
  vuelveA: { nombreComercial: "Pro", versionNumero: 2 },
  deshizoElCambioDel: null,
};
const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const TENANT = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

describe("queMostrarDelUltimoCambio (lo recibe decidido: no calcula nada)", () => {
  it("sin cambio: nada", () => {
    expect(queMostrarDelUltimoCambio(null, true)).toEqual({ tipo: "NADA" });
  });

  it("dentro del plazo: el día límite, suba o baja y el botón solo para quien puede", () => {
    expect(queMostrarDelUltimoCambio(CAMBIO, true)).toEqual({
      tipo: "DESHACER",
      sentido: "Baja",
      puedeHasta: "Se puede deshacer hasta el 23/11/2026.",
      ofreceElBoton: true,
    });
    expect(queMostrarDelUltimoCambio(CAMBIO, false)).toMatchObject({
      tipo: "DESHACER",
      ofreceElBoton: false,
    });
    expect(queMostrarDelUltimoCambio({ ...CAMBIO, sentido: "SUBA" }, true)).toMatchObject({
      sentido: "Suba",
    });
  });

  it("si el servidor dice que hoy no se puede (vencido, alta, migración, plazo 0, sin condiciones), no se ofrece nada", () => {
    expect(queMostrarDelUltimoCambio({ ...CAMBIO, puedeDeshacerHoy: false }, true)).toEqual({
      tipo: "NADA",
    });
    expect(
      queMostrarDelUltimoCambio(
        { ...CAMBIO, sentido: null, arrepentimientoHasta: null, puedeDeshacerHoy: false },
        true,
      ),
    ).toEqual({ tipo: "NADA" });
  });

  it("aunque el servidor diga que se puede, sin día límite no hay nada que mostrar (cierra ante la duda)", () => {
    expect(queMostrarDelUltimoCambio({ ...CAMBIO, arrepentimientoHasta: null }, true)).toEqual({
      tipo: "NADA",
    });
  });

  it("sin sentido conocido igual se muestra el día límite, sin etiqueta", () => {
    expect(queMostrarDelUltimoCambio({ ...CAMBIO, sentido: null }, true)).toMatchObject({
      tipo: "DESHACER",
      sentido: null,
    });
  });

  it("el cambio que nació de un arrepentimiento lo dice, con el día del cambio deshecho", () => {
    expect(
      queMostrarDelUltimoCambio({ ...CAMBIO, deshizoElCambioDel: "2026-11-20" }, true),
    ).toEqual({
      tipo: "DESHECHO",
      etiqueta: "Deshecho por arrepentimiento",
      texto: "Arrepentimiento del cambio del 20/11/2026",
    });
  });

  it("un cambio ya deshecho se dice y no se ofrece de nuevo", () => {
    expect(queMostrarDelUltimoCambio({ ...CAMBIO, yaArrepentido: true }, true)).toEqual({
      tipo: "DESHECHO",
      etiqueta: "Deshecho por arrepentimiento",
      texto: "Este cambio ya se deshizo.",
    });
  });
});

describe("textosDeLaConfirmacion", () => {
  it("de una baja: vuelve al plan desde hoy, la baja no se aplica y no se repite", () => {
    expect(textosDeLaConfirmacion(CAMBIO, "2026-11-20")).toEqual({
      vuelve: "La empresa vuelve al plan Pro desde el 20/11/2026.",
      consecuencia: "La baja no se aplica: la empresa sigue con el plan que tiene.",
      noSeRepite: "Un cambio deshecho no se puede deshacer de nuevo.",
    });
  });

  it("de una suba, la consecuencia es la de la suba (T-26, en su propia clave)", () => {
    expect(textosDeLaConfirmacion({ ...CAMBIO, sentido: "SUBA" }, "2026-11-20").consecuencia).toBe(
      "La suba no se aplica: la empresa vuelve al plan anterior y los módulos nuevos quedan en solo lectura con lo cargado.",
    );
  });

  it("sin plan al que volver o sin sentido, no inventa esas líneas", () => {
    expect(
      textosDeLaConfirmacion({ ...CAMBIO, vuelveA: null, sentido: null }, "2026-11-20"),
    ).toMatchObject({ vuelve: null, consecuencia: null });
  });
});

describe("la fecha mínima del cambio la dicta el servidor", () => {
  it("las explicaciones dicen los días que mandó el servidor (T-31 y T-32)", () => {
    expect(explicacionDeLaFechaMinima("SUBA", 3)).toBe(
      "Fecha mínima: hoy más 3 días de anticipación de suba.",
    );
    expect(explicacionDeLaFechaMinima("BAJA", 15)).toBe(
      "Fecha mínima: hoy más 15 días (el mayor entre la anticipación de baja y el plazo de arrepentimiento).",
    );
    expect(faltaDeAnticipacion("2026-12-05")).toBe(
      "Falta anticipación. La primera fecha posible es el 05/12/2026.",
    );
  });

  const plan = (condiciones: PlanDeEmpresa["condiciones"]): PlanDeEmpresa =>
    ({ condiciones }) as unknown as PlanDeEmpresa;
  const CON_OPCIONES = plan({
    hoy: "2026-11-20",
    ultimoCambio: null,
    opciones: [
      {
        versionDePlanId: V1,
        sentido: "SUBA",
        primeraFechaValida: "2026-11-23",
        diasDeAnticipacion: 3,
      },
      {
        versionDePlanId: V2,
        sentido: "BAJA",
        primeraFechaValida: "2026-12-05",
        diasDeAnticipacion: 15,
      },
    ],
  });
  const AHORA = new Date("2026-11-20T15:00:00Z");

  it("cada opción tiene su fecha mínima, su explicación y su falta", () => {
    expect(fechaMinimaDelCambio(CON_OPCIONES, V1, AHORA)).toEqual({
      fechaMinima: "2026-11-23",
      ayuda: "Fecha mínima: hoy más 3 días de anticipación de suba.",
      faltaDeAnticipacion: "Falta anticipación. La primera fecha posible es el 23/11/2026.",
    });
    expect(fechaMinimaDelCambio(CON_OPCIONES, V2, AHORA).fechaMinima).toBe("2026-12-05");
  });

  it("sin opción elegida, o sin lo que decide el servidor, queda «desde mañana» y el servidor valida igual", () => {
    const manana = {
      fechaMinima: "2026-11-21",
      ayuda: "Desde mañana (21/11/2026).",
      faltaDeAnticipacion: undefined,
    };
    expect(fechaMinimaDelCambio(CON_OPCIONES, "", AHORA)).toEqual(manana);
    expect(fechaMinimaDelCambio(plan(undefined), V1, AHORA)).toEqual(manana);
  });

  it("la falta local usa el texto del servidor (T-33) y, sin él, el de siempre", () => {
    const datos = {
      vigenteDesde: "2026-11-22",
      motivo: "x",
      hayProgramada: false,
      reemplaza: false,
      fechaMinima: "2026-11-23",
    };
    expect(validarCambio(datos).vigenteDesde).toBe(
      "La fecha tiene que ser desde mañana: 23/11/2026.",
    );
    expect(
      validarCambio({ ...datos, faltaDeAnticipacion: "Falta anticipación. X" }).vigenteDesde,
    ).toBe("Falta anticipación. X");
    expect(validarCambio({ ...datos, vigenteDesde: "2026-11-23" })).toEqual({});
  });
});

describe("errorDelCambioDePlan", () => {
  it("la falta de anticipación dice la primera fecha que mandó el servidor (T-33)", () => {
    expect(
      errorDelCambioDePlan({
        codigo: "ANTICIPACION_INSUFICIENTE",
        primeraFechaValida: "2026-12-05",
      }),
    ).toEqual({
      tipo: "GENERAL",
      texto: "Falta anticipación. La primera fecha posible es el 05/12/2026.",
    });
    // Sin la fecha del servidor no se inventa una.
    expect(errorDelCambioDePlan({ codigo: "ANTICIPACION_INSUFICIENTE" })).toEqual({
      tipo: "INESPERADO",
    });
  });

  it.each([
    ["NO_ES_EL_ULTIMO_CAMBIO", "Hubo un cambio posterior: solo se puede deshacer el último."],
    ["CAMBIO_SIN_ARREPENTIMIENTO", "Este cambio no admite arrepentimiento."],
    ["SIN_PLAN_ANTERIOR", "Este cambio no admite arrepentimiento."],
    ["PLAZO_VENCIDO", "Venció el plazo para deshacer este cambio."],
    ["YA_ARREPENTIDO", "Este cambio ya se deshizo."],
  ])("%s sale con su texto aprobado, venga como texto o como objeto", (codigo, texto) => {
    expect(errorDelCambioDePlan(codigo)).toEqual({ tipo: "GENERAL", texto });
    expect(errorDelCambioDePlan({ codigo })).toEqual({ tipo: "GENERAL", texto });
  });

  it("un cambio que no existe o un número inválido es una pantalla vieja; la versión desactualizada, el texto que ya tenía (T-38)", () => {
    const vieja = {
      tipo: "PANTALLA_VIEJA",
      texto: "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.",
    };
    expect(errorDelCambioDePlan("CAMBIO_NO_ENCONTRADO")).toEqual(vieja);
    expect(errorDelCambioDePlan({ codigo: "NUMERO_INVALIDO" })).toEqual(vieja);
    expect(errorDelCambioDePlan("VERSION_DESACTUALIZADA")).toMatchObject({
      tipo: "PANTALLA_VIEJA",
    });
  });

  it("los códigos propios del cambio de plan se traducen con el contexto del plan", () => {
    // Solo el traductor «del plan» conoce este código; sin ese contexto sería «inesperado».
    expect(errorDelCambioDePlan("NUMERO_ESPERADO_INVALIDO")).toMatchObject({
      tipo: "PANTALLA_VIEJA",
    });
  });

  it("segundo factor, sin permiso y lo desconocido salen por el traductor de la consola", () => {
    expect(errorDelCambioDePlan("SIN_PERMISO")).toEqual({ tipo: "OCULTAR_ACCION" });
    expect(errorDelCambioDePlan("segundo_factor_reciente_requerido")).toEqual({
      tipo: "SEGUNDO_FACTOR",
    });
    expect(errorDelCambioDePlan("ALGO_QUE_NADIE_PENSO")).toEqual({ tipo: "INESPERADO" });
    expect(errorDelCambioDePlan(null)).toEqual({ tipo: "INESPERADO" });
    expect(errorDelCambioDePlan(7)).toEqual({ tipo: "INESPERADO" });
  });
});

describe("entradaDeArrepentir (forma de lo que manda el navegador)", () => {
  const BUENA = {
    claveDeIdempotencia: CLAVE,
    tenantId: TENANT,
    numero: 2,
    numeroEsperado: 2,
    motivo: "El cliente se arrepintió",
  };

  it("el primer cambio (número 1) es válido", () => {
    expect(entradaDeArrepentir({ ...BUENA, numero: 1, numeroEsperado: 1 }).ok).toBe(true);
  });

  it("deja pasar una entrada buena y descarta las claves que sobran", () => {
    expect(entradaDeArrepentir({ ...BUENA, rol: "ADMIN" })).toEqual({ ok: true, valor: BUENA });
    expect(entradaDeArrepentir({ ...BUENA, motivo: "a".repeat(2000) }).ok).toBe(true);
  });

  it.each([
    ["es nulo", null],
    ["es un número", 5],
    ["es una lista", [BUENA]],
    ["clave que no es UUID", { ...BUENA, claveDeIdempotencia: "abc" }],
    ["clave con algo antes", { ...BUENA, claveDeIdempotencia: `x${CLAVE}` }],
    ["cliente que no es UUID", { ...BUENA, tenantId: "no" }],
    ["cliente con algo después", { ...BUENA, tenantId: `${TENANT}x` }],
    ["cambio 0", { ...BUENA, numero: 0 }],
    ["cambio decimal", { ...BUENA, numero: 1.5 }],
    ["cambio como texto", { ...BUENA, numero: "2" }],
    ["último visto 0", { ...BUENA, numeroEsperado: 0 }],
    ["último visto como texto", { ...BUENA, numeroEsperado: "2" }],
    ["motivo que no es texto", { ...BUENA, motivo: 5 }],
    ["motivo absurdo", { ...BUENA, motivo: "a".repeat(2001) }],
  ])("rechaza: %s", (_nombre, entrada) => {
    expect(entradaDeArrepentir(entrada)).toEqual({ ok: false });
  });
});

describe("armarPlanDeEmpresa con lo que decidió el servidor", () => {
  const asignacion = (numero: number, dia: number) => ({
    numero,
    versionDePlanId: V1,
    planId: "p",
    planCodigo: "basico",
    versionNumero: 1,
    nombreComercial: "Básico",
    // 03:00 UTC es la medianoche argentina del día.
    vigenteDesde: new Date(Date.UTC(2026, 10, dia, 3)),
    origen: "CAMBIO",
    reemplazaProgramada: false,
    motivo: "m",
    asignadoPor: "x",
    creadoEn: new Date(0),
    estado: "ANTERIOR",
  });
  const base = {
    derechos: { empresaId: V1, tenantId: TENANT, versionDePlan: null, modulos: [], perillas: [] },
    plan: {
      tenantId: TENANT,
      asignaciones: [asignacion(1, 10), asignacion(2, 20), asignacion(3, 21)],
      ajustes: [],
      empresas: [],
    },
    planes: { planes: [] },
    razonSocial: "Acme",
    cliente: null,
  } as never;
  const condiciones = {
    hoy: "2026-11-21",
    politica: {
      version: 2,
      diasDeAnticipacionDeSuba: 1,
      diasDeAnticipacionDeBaja: 1,
      diasDeArrepentimiento: 3,
    },
    ultimoCambio: {
      numero: 3,
      origen: "CAMBIO",
      sentido: null,
      arrepentimientoHasta: null,
      yaArrepentido: false,
      puedeDeshacerHoy: false,
      motivoDeNoPoder: "CAMBIO_SIN_ARREPENTIMIENTO",
      vuelveA: null,
    },
    arrepentimientos: [{ numeroArrepentido: 2, numeroNuevo: 3 }],
    opciones: [
      {
        versionDePlanId: V2,
        sentido: "BAJA",
        primeraFechaValida: "2026-11-24",
        diasDeAnticipacion: 3,
      },
    ],
  } as never;

  it("sin la lectura nueva, la pantalla queda como antes (sin condiciones)", () => {
    const r = armarPlanDeEmpresa(base);
    expect("condiciones" in r).toBe(false);
    expect("puedeArrepentir" in r).toBe(false);
    expect(
      "condiciones" in armarPlanDeEmpresa({ ...(base as object), condiciones: null } as never),
    ).toBe(false);
  });

  it("pasa las opciones tal cual y el cambio que nació de un arrepentimiento trae el día argentino del cambio deshecho", () => {
    const r = armarPlanDeEmpresa({
      ...(base as object),
      condiciones,
      puedeArrepentir: true,
    } as never);
    expect(r.puedeArrepentir).toBe(true);
    expect(r.condiciones).toEqual({
      hoy: "2026-11-21",
      ultimoCambio: {
        numero: 3,
        sentido: null,
        arrepentimientoHasta: null,
        yaArrepentido: false,
        puedeDeshacerHoy: false,
        vuelveA: null,
        deshizoElCambioDel: "2026-11-20",
      },
      opciones: [
        {
          versionDePlanId: V2,
          sentido: "BAJA",
          primeraFechaValida: "2026-11-24",
          diasDeAnticipacion: 3,
        },
      ],
    });
  });

  it("un último cambio que no nació de un arrepentimiento no trae día de cambio deshecho; sin cambios, nulo", () => {
    const sinPar = { ...(condiciones as object), arrepentimientos: [] };
    const r = armarPlanDeEmpresa({ ...(base as object), condiciones: sinPar } as never);
    expect(r.condiciones?.ultimoCambio?.deshizoElCambioDel).toBeNull();
    const nulo = { ...(condiciones as object), ultimoCambio: null };
    expect(
      armarPlanDeEmpresa({ ...(base as object), condiciones: nulo } as never).condiciones
        ?.ultimoCambio,
    ).toBeNull();
  });
});
