import { describe, expect, it } from "vitest";
import {
  CLAVES_DE_PERILLAS_DE_PRUEBA,
  MODULOS_DE_PRUEBA,
  PERILLAS_DE_PRUEBA,
  apagada,
  encendida,
  limite,
} from "../../../test/utilidades/planes";
import {
  empresaId,
  planId,
  sucursalId,
  tenantId,
  versionDePlanId,
} from "../../primitivas/identificadores/marca";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import {
  aplicarRequiere,
  derechosDeUso,
  exigirPerilla,
  modulosHabilitadosPor,
  valorDePerilla,
  valoresDelPlan,
  type AjusteDePerilla,
  type VersionDePlanVigente,
} from "./derechos";
import { CATALOGO_DE_PERILLAS, type DefinicionDePerilla } from "./perillas";
import type { ValorDePerilla, ValorEfectivo } from "./valores";

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const DIA = 86_400_000;
const ahora = new Date(BASE);
const T = tenantId("tenant-1");
const E1 = empresaId("empresa-1");
const E2 = empresaId("empresa-2");

const version = (
  modulos: readonly string[] = [],
  perillas: Record<string, ValorDePerilla> = {},
): VersionDePlanVigente => ({
  planId: planId("plan-1"),
  versionDePlanId: versionDePlanId("version-1"),
  numero: 3,
  modulos,
  perillas,
});

let contador = 0;
const ajuste = (
  perilla: string,
  valor: ValorDePerilla | "DEL_PLAN",
  extra: Partial<AjusteDePerilla> = {},
): AjusteDePerilla => ({
  perilla,
  empresaId: null,
  numero: ++contador,
  vigenteDesde: new Date(BASE - DIA),
  valor,
  ...extra,
});

const derechos = (
  extra: Partial<{
    versionDePlan: VersionDePlanVigente | null;
    ajustes: readonly AjusteDePerilla[];
    empresaId: typeof E1 | null;
  }> = {},
) =>
  derechosDeUso({
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
    tenantId: T,
    empresaId: E1,
    versionDePlan: null,
    ajustes: [],
    ahora,
    ...extra,
  });

const valor = (d: ReturnType<typeof derechos>, perilla: keyof typeof PERILLAS_DE_PRUEBA) =>
  valorDePerilla(d, perilla);

describe("derechosDeUso: módulos habilitados", () => {
  it("sin plan, solo los obligatorios", () => {
    expect([...derechos().modulosHabilitados]).toEqual(["nucleo"]);
  });

  it("con plan: obligatorios más los de la versión (el obligatorio no hace falta listarlo)", () => {
    const d = derechos({ versionDePlan: version(["caja", "ventas"]) });
    expect([...d.modulosHabilitados].sort()).toEqual(["caja", "nucleo", "ventas"]);
  });

  it("una clave desconocida del plan no habilita nada (falla cerrado) ni rompe", () => {
    const d = derechos({ versionDePlan: version(["caja", "fantasma", "constructor"]) });
    expect([...d.modulosHabilitados].sort()).toEqual(["caja", "nucleo"]);
  });

  it("modulosHabilitadosPor tolera repetidos, no toca la lista y sin versión da solo los obligatorios", () => {
    const lista = ["caja", "caja"];
    expect([...modulosHabilitadosPor(MODULOS_DE_PRUEBA, { modulos: lista })].sort()).toEqual([
      "caja",
      "nucleo",
    ]);
    expect(lista).toEqual(["caja", "caja"]);
    expect([...modulosHabilitadosPor(MODULOS_DE_PRUEBA, null)]).toEqual(["nucleo"]);
  });

  it("con el catálogo real, administración siempre", () => {
    const d = derechosDeUso({
      catalogoDeModulos: CATALOGO_DE_MODULOS,
      catalogoDePerillas: CATALOGO_DE_PERILLAS,
      tenantId: T,
      empresaId: null,
      versionDePlan: null,
      ajustes: [],
      ahora,
    });
    expect([...d.modulosHabilitados]).toEqual(["administracion"]);
    expect(valorDePerilla(d, "empresas_por_tenant")).toEqual({
      tipo: "LIMITE",
      limite: 1,
      origen: "BASE",
    });
  });
});

describe("derechosDeUso: el valor de cada perilla y su origen", () => {
  it("sin plan ni ajustes, toda perilla vale su base, con origen BASE; el mapa es total", () => {
    const d = derechos();
    expect([...d.perillas.keys()]).toEqual(CLAVES_DE_PERILLAS_DE_PRUEBA);
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(1), origen: "BASE" });
    expect(valor(d, "vidriera_por_qr")).toEqual({ ...apagada, origen: "BASE" });
    expect(valor(d, "con_sello")).toEqual({ ...encendida, origen: "BASE" });
  });

  it("el plan reemplaza a la base (origen PLAN); lo que no fija sigue en BASE", () => {
    const d = derechos({
      versionDePlan: version([], { cajas_por_sucursal: limite(4), vidriera_por_qr: encendida }),
    });
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(4), origen: "PLAN" });
    expect(valor(d, "vidriera_por_qr")).toEqual({ ...encendida, origen: "PLAN" });
    expect(valor(d, "con_sello")).toEqual({ ...encendida, origen: "BASE" });
    expect(valor(d, "empresas_por_tenant")).toEqual({ ...limite(1), origen: "BASE" });
  });

  it("un valor del plan con el tipo equivocado se ignora: vale la base", () => {
    const d = derechos({ versionDePlan: version([], { cajas_por_sucursal: encendida }) });
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(1), origen: "BASE" });
  });

  it("un valor de plan para una perilla que no existe se ignora", () => {
    const d = derechos({ versionDePlan: version([], { inventada: encendida }) });
    expect([...d.perillas.keys()]).toEqual(CLAVES_DE_PERILLAS_DE_PRUEBA);
  });

  it("un ajuste del tenant reemplaza al plan (origen AJUSTE)", () => {
    const d = derechos({
      versionDePlan: version([], { cajas_por_sucursal: limite(4) }),
      ajustes: [ajuste("cajas_por_sucursal", limite(9))],
    });
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(9), origen: "AJUSTE" });
  });

  it("el ajuste de la empresa gana al del tenant, que gana al plan", () => {
    const ajustes = [
      ajuste("cajas_por_sucursal", limite(9)),
      ajuste("cajas_por_sucursal", limite(2), { empresaId: E1 }),
    ];
    const plan = version([], { cajas_por_sucursal: limite(4) });
    expect(valor(derechos({ versionDePlan: plan, ajustes }), "cajas_por_sucursal")).toMatchObject(
      limite(2),
    );
    // Para el tenant (sin empresa) solo vale el del tenant.
    expect(
      valor(derechos({ versionDePlan: plan, ajustes, empresaId: null }), "cajas_por_sucursal"),
    ).toMatchObject(limite(9));
  });

  it("el ajuste de otra empresa del tenant no se ve", () => {
    const ajustes = [ajuste("cajas_por_sucursal", limite(7), { empresaId: E2 })];
    const d = derechos({ ajustes });
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(1), origen: "BASE" });
  });

  it("DEL_PLAN en la empresa vuelve al plan, sin mirar el ajuste del tenant", () => {
    const ajustes = [
      ajuste("cajas_por_sucursal", limite(9)),
      ajuste("cajas_por_sucursal", "DEL_PLAN", { empresaId: E1 }),
    ];
    const d = derechos({ versionDePlan: version([], { cajas_por_sucursal: limite(4) }), ajustes });
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(4), origen: "PLAN" });
    // Sin plan, vuelve a la base.
    expect(valor(derechos({ ajustes }), "cajas_por_sucursal")).toEqual({
      ...limite(1),
      origen: "BASE",
    });
  });

  it("DEL_PLAN en el tenant vuelve al plan, también para la empresa sin ajuste propio", () => {
    const ajustes = [
      ajuste("cajas_por_sucursal", limite(9)),
      ajuste("cajas_por_sucursal", "DEL_PLAN"),
    ];
    const d = derechos({ versionDePlan: version([], { cajas_por_sucursal: limite(4) }), ajustes });
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(4), origen: "PLAN" });
  });

  it("la última decisión manda: el ajuste de mayor número entre los que ya empezaron", () => {
    const ajustes = [
      ajuste("cajas_por_sucursal", limite(5), { numero: 1 }),
      ajuste("cajas_por_sucursal", limite(6), { numero: 2 }),
      ajuste("cajas_por_sucursal", limite(8), { numero: 3, vigenteDesde: new Date(BASE + DIA) }),
    ];
    expect(valor(derechos({ ajustes }), "cajas_por_sucursal")).toMatchObject(limite(6));
    expect(
      valor(derechos({ ajustes: [...ajustes].reverse() }), "cajas_por_sucursal"),
    ).toMatchObject(limite(6));
  });

  it("un ajuste programado todavía no rige; uno que empieza justo ahora sí", () => {
    const futuro = ajuste("cajas_por_sucursal", limite(5), { vigenteDesde: new Date(BASE + 1) });
    expect(valor(derechos({ ajustes: [futuro] }), "cajas_por_sucursal")).toMatchObject({
      origen: "BASE",
    });
    const justo = ajuste("cajas_por_sucursal", limite(5), { vigenteDesde: ahora });
    expect(valor(derechos({ ajustes: [justo] }), "cajas_por_sucursal")).toMatchObject({
      origen: "AJUSTE",
    });
  });

  it("un ajuste de empresa programado no tapa al del tenant que ya rige", () => {
    const ajustes = [
      ajuste("cajas_por_sucursal", limite(9)),
      ajuste("cajas_por_sucursal", limite(2), {
        empresaId: E1,
        vigenteDesde: new Date(BASE + DIA),
      }),
    ];
    expect(valor(derechos({ ajustes }), "cajas_por_sucursal")).toMatchObject(limite(9));
  });

  it("los ajustes de una perilla no pisan a otra", () => {
    const d = derechos({ ajustes: [ajuste("cajas_por_sucursal", limite(9))] });
    expect(valor(d, "empresas_por_tenant")).toMatchObject({ origen: "BASE" });
  });

  it("un ajuste con el tipo equivocado se ignora: vuelve al plan", () => {
    const d = derechos({
      versionDePlan: version([], { cajas_por_sucursal: limite(4) }),
      ajustes: [ajuste("cajas_por_sucursal", encendida)],
    });
    expect(valor(d, "cajas_por_sucursal")).toEqual({ ...limite(4), origen: "PLAN" });
  });

  it("un ajuste de perilla desconocida no rompe ni agrega nada", () => {
    const d = derechos({ ajustes: [ajuste("inventada", encendida)] });
    expect(d.perillas.has("inventada" as never)).toBe(false);
  });

  it("una perilla de ámbito TENANT no se ajusta por empresa: el ajuste de empresa se ignora", () => {
    const ajustes = [
      ajuste("empresas_por_tenant", limite(5)),
      ajuste("empresas_por_tenant", limite(99), { empresaId: E1 }),
    ];
    expect(valor(derechos({ ajustes }), "empresas_por_tenant")).toMatchObject(limite(5));
  });

  it("ILIMITADO y 0 son valores como cualquier otro", () => {
    expect(
      valor(
        derechos({ ajustes: [ajuste("cajas_por_sucursal", limite("ILIMITADO"))] }),
        "cajas_por_sucursal",
      ),
    ).toEqual({ ...limite("ILIMITADO"), origen: "AJUSTE" });
    expect(
      valor(derechos({ ajustes: [ajuste("cajas_por_sucursal", limite(0))] }), "cajas_por_sucursal"),
    ).toEqual({ ...limite(0), origen: "AJUSTE" });
  });
});

describe("derechosDeUso: requiere entre perillas", () => {
  it("una dependiente encendida con la requerida apagada vale apagada, conservando el origen", () => {
    const d = derechos({ versionDePlan: version([], { confirmacion_por_sena: encendida }) });
    expect(valor(d, "confirmacion_por_sena")).toEqual({ ...apagada, origen: "PLAN" });
    expect(valor(d, "reserva_provisoria")).toEqual({ ...apagada, origen: "BASE" });
  });

  it("con la requerida encendida, la dependiente vale lo que dice", () => {
    const d = derechos({
      versionDePlan: version([], {
        confirmacion_por_sena: encendida,
        reserva_provisoria: encendida,
      }),
    });
    expect(valor(d, "confirmacion_por_sena")).toEqual({ ...encendida, origen: "PLAN" });
  });

  it("un límite dependiente queda en 0 si la requerida está apagada", () => {
    const apagadaLaRequerida = derechos({
      versionDePlan: version([], { overbooking: limite(3) }),
    });
    expect(valor(apagadaLaRequerida, "overbooking")).toEqual({ ...limite(0), origen: "PLAN" });
    const encendidaLaRequerida = derechos({
      versionDePlan: version([], { overbooking: limite(3), asignacion_diferida: encendida }),
    });
    expect(valor(encendidaLaRequerida, "overbooking")).toEqual({ ...limite(3), origen: "PLAN" });
  });

  it("también se apaga un ajuste cuando la requerida está apagada (sale su origen)", () => {
    const d = derechos({ ajustes: [ajuste("overbooking", limite("ILIMITADO"))] });
    expect(valor(d, "overbooking")).toEqual({ ...limite(0), origen: "AJUSTE" });
  });

  it("la cadena se propaga: sobreventa_extra requiere overbooking, que requiere asignacion_diferida", () => {
    const sinNada = derechos({ versionDePlan: version([], { sobreventa_extra: limite(9) }) });
    expect(valor(sinNada, "sobreventa_extra")).toEqual({ ...limite(0), origen: "PLAN" });
    // overbooking encendido pero asignacion_diferida apagada: la cadena corta igual.
    const cortada = derechos({
      versionDePlan: version([], { sobreventa_extra: limite(9), overbooking: limite(2) }),
    });
    expect(valor(cortada, "sobreventa_extra")).toEqual({ ...limite(0), origen: "PLAN" });
    expect(valor(cortada, "overbooking")).toEqual({ ...limite(0), origen: "PLAN" });
    const completa = derechos({
      versionDePlan: version([], {
        sobreventa_extra: limite(9),
        overbooking: limite(2),
        asignacion_diferida: encendida,
      }),
    });
    expect(valor(completa, "sobreventa_extra")).toEqual({ ...limite(9), origen: "PLAN" });
  });

  it("apagar la requerida con un ajuste apaga a la dependiente", () => {
    const d = derechos({
      versionDePlan: version([], {
        confirmacion_por_sena: encendida,
        reserva_provisoria: encendida,
      }),
      ajustes: [ajuste("reserva_provisoria", apagada, { empresaId: E1 })],
    });
    expect(valor(d, "confirmacion_por_sena")).toMatchObject({ encendida: false, origen: "PLAN" });
  });
});

describe("aplicarRequiere con catálogos defectuosos (falla cerrado)", () => {
  const def = (requiere?: string): DefinicionDePerilla => ({
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: true },
    modulo: "administracion",
    ...(requiere === undefined ? {} : { requiere }),
  });
  const valores = (...claves: string[]) =>
    new Map<string, ValorEfectivo>(claves.map((c) => [c, { ...encendida, origen: "PLAN" }]));
  const encendidas = (m: Map<string, ValorEfectivo>) =>
    [...m].filter(([, v]) => v.tipo === "INTERRUPTOR" && v.encendida).map(([c]) => c);

  it("una requerida que no existe en el catálogo apaga", () => {
    const m = aplicarRequiere({ a: def("fantasma") }, valores("a"));
    expect(encendidas(m)).toEqual([]);
  });

  it("una requerida sin valor en el mapa apaga", () => {
    const m = aplicarRequiere({ a: def("b"), b: def() }, valores("a"));
    expect(encendidas(m)).toEqual([]);
  });

  it("una perilla sin requerida queda como está", () => {
    expect(encendidas(aplicarRequiere({ a: def() }, valores("a")))).toEqual(["a"]);
  });

  it("un ciclo entre dos perillas apaga a las dos; una que se requiere a sí misma, también", () => {
    expect(encendidas(aplicarRequiere({ a: def("b"), b: def("a") }, valores("a", "b")))).toEqual(
      [],
    );
    expect(encendidas(aplicarRequiere({ a: def("a") }, valores("a")))).toEqual([]);
  });

  it("una cadena sana de tres queda encendida; si el eslabón del medio está apagado, corta", () => {
    const catalogo = { a: def("b"), b: def("c"), c: def() };
    expect(encendidas(aplicarRequiere(catalogo, valores("a", "b", "c"))).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    const m = valores("a", "c");
    m.set("b", { ...apagada, origen: "PLAN" });
    expect(encendidas(aplicarRequiere(catalogo, m))).toEqual(["c"]);
  });

  it("no modifica el mapa de entrada", () => {
    const m = valores("a");
    aplicarRequiere({ a: def("fantasma") }, m);
    expect(encendidas(m)).toEqual(["a"]);
  });
});

describe("valoresDelPlan", () => {
  it("completa con la base y no aplica requiere", () => {
    const m = valoresDelPlan(PERILLAS_DE_PRUEBA, { confirmacion_por_sena: encendida });
    expect(m.get("confirmacion_por_sena")).toEqual({ ...encendida, origen: "PLAN" });
    expect(m.get("reserva_provisoria")).toEqual({ ...apagada, origen: "BASE" });
  });

  it("sin versión, todo es la base", () => {
    const m = valoresDelPlan(PERILLAS_DE_PRUEBA, null);
    expect([...m.values()].every((v) => v.origen === "BASE")).toBe(true);
  });

  it("los nombres que hereda todo objeto no son valores del plan", () => {
    const catalogo = { constructor: PERILLAS_DE_PRUEBA.con_sello };
    expect(valoresDelPlan(catalogo, {}).get("constructor")).toEqual({
      ...encendida,
      origen: "BASE",
    });
  });
});

describe("derechosDeUso: el resto del contrato", () => {
  it("lleva la empresa, el tenant, el instante y la versión del plan", () => {
    const d = derechos({ versionDePlan: version(["caja"]) });
    expect(d.empresaId).toBe(E1);
    expect(d.tenantId).toBe(T);
    expect(d.leidoEn).toBe(ahora);
    expect(d.versionDePlan).toEqual({
      planId: planId("plan-1"),
      versionDePlanId: versionDePlanId("version-1"),
      numero: 3,
    });
    expect(derechos().versionDePlan).toBeNull();
    expect(derechos({ empresaId: null }).empresaId).toBeNull();
  });

  it("no modifica sus entradas", () => {
    const plan = version(["caja"], { vidriera_por_qr: encendida });
    const ajustes = [ajuste("cajas_por_sucursal", limite(9))];
    const copia = structuredClone({ plan, ajustes });
    derechos({ versionDePlan: plan, ajustes });
    expect({ plan, ajustes }).toEqual(copia);
  });

  it("es determinista: dos veces con lo mismo da lo mismo", () => {
    const ajustes = [ajuste("cajas_por_sucursal", limite(9))];
    expect(derechos({ ajustes })).toEqual(derechos({ ajustes }));
  });
});

describe("valorDePerilla", () => {
  it("es total sobre los derechos calculados", () => {
    const d = derechos();
    for (const perilla of CLAVES_DE_PERILLAS_DE_PRUEBA) {
      expect(valorDePerilla(d, perilla).tipo).toMatch(/INTERRUPTOR|LIMITE/);
    }
  });

  it("falta una perilla en derechos armados a mano: es un defecto y se lanza", () => {
    const incompleto = { perillas: new Map<string, ValorEfectivo>() };
    expect(() => valorDePerilla(incompleto, "vidriera_por_qr")).toThrow(RangeError);
    expect(() => valorDePerilla(incompleto, "vidriera_por_qr")).toThrow(/vidriera_por_qr/);
  });
});

describe("exigirPerilla", () => {
  const con = (perilla: string, valor: ValorDePerilla, empresa: typeof E1 | null = E1) => ({
    empresaId: empresa,
    perillas: new Map<string, ValorEfectivo>([[perilla, { ...valor, origen: "PLAN" }]]),
  });

  it("un interruptor apagado da FUNCION_NO_INCLUIDA nombrando la perilla; encendido pasa", () => {
    expect(exigirPerilla(con("carta", apagada), "carta", {})).toEqual({
      ok: false,
      error: { codigo: "FUNCION_NO_INCLUIDA", perilla: "carta" },
    });
    expect(exigirPerilla(con("carta", encendida), "carta", {})).toEqual({ ok: true, valor: null });
  });

  it("un interruptor ignora el uso actual", () => {
    expect(exigirPerilla(con("carta", encendida), "carta", {}, 1000).ok).toBe(true);
    expect(exigirPerilla(con("carta", apagada), "carta", {}, 0).ok).toBe(false);
  });

  it("un límite: con el uso igual al límite falla; con uno menos, pasa", () => {
    const d = con("cajas", limite(3));
    expect(exigirPerilla(d, "cajas", {}, 2)).toEqual({ ok: true, valor: null });
    expect(exigirPerilla(d, "cajas", {}, 3)).toEqual({
      ok: false,
      error: { codigo: "LIMITE_DEL_PLAN", perilla: "cajas", limite: 3, usoActual: 3 },
    });
    expect(exigirPerilla(d, "cajas", {}, 4)).toEqual({
      ok: false,
      error: { codigo: "LIMITE_DEL_PLAN", perilla: "cajas", limite: 3, usoActual: 4 },
    });
    expect(exigirPerilla(d, "cajas", {}, 0).ok).toBe(true);
  });

  it("ILIMITADO nunca falla", () => {
    expect(exigirPerilla(con("cajas", limite("ILIMITADO")), "cajas", {}, 999_999_999).ok).toBe(
      true,
    );
    expect(exigirPerilla(con("cajas", limite("ILIMITADO")), "cajas", {}).ok).toBe(true);
  });

  it("sin uso actual, un límite se trata como «¿es mayor que 0?»", () => {
    expect(exigirPerilla(con("cajas", limite(1)), "cajas", {}).ok).toBe(true);
    expect(exigirPerilla(con("cajas", limite(0)), "cajas", {})).toEqual({
      ok: false,
      error: { codigo: "LIMITE_DEL_PLAN", perilla: "cajas", limite: 0, usoActual: 0 },
    });
  });

  it("un límite en 0 falla incluso con uso 0", () => {
    expect(exigirPerilla(con("cajas", limite(0)), "cajas", {}, 0).ok).toBe(false);
  });

  it("el alcance de la empresa tiene que ser el de los derechos; la sucursal es solo informativa", () => {
    const d = con("cajas", limite(3));
    expect(exigirPerilla(d, "cajas", { empresaId: E1 }, 0).ok).toBe(true);
    expect(exigirPerilla(d, "cajas", { sucursalId: sucursalId("s1") }, 0).ok).toBe(true);
    expect(() => exigirPerilla(d, "cajas", { empresaId: E2 }, 0)).toThrow(RangeError);
    expect(() => exigirPerilla(d, "cajas", { empresaId: E2 }, 0)).toThrow(/otra empresa/);
    // Derechos del tenant (sin empresa) no sirven para una pregunta de una empresa.
    expect(() => exigirPerilla(con("cajas", limite(3), null), "cajas", { empresaId: E1 })).toThrow(
      RangeError,
    );
    expect(exigirPerilla(con("cajas", limite(3), null), "cajas", {}, 0).ok).toBe(true);
  });

  it.each([[-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "un uso actual inválido (%s) es un defecto: se lanza, no se deja pasar",
    (uso) => {
      expect(() => exigirPerilla(con("cajas", limite(3)), "cajas", {}, uso)).toThrow(RangeError);
      expect(() => exigirPerilla(con("cajas", limite(3)), "cajas", {}, uso)).toThrow(/usoActual/);
      expect(() => exigirPerilla(con("carta", encendida), "carta", {}, uso)).toThrow(RangeError);
    },
  );

  it("una perilla que los derechos no traen es un defecto", () => {
    expect(() => exigirPerilla(con("cajas", limite(3)), "otra", {})).toThrow(RangeError);
  });

  it("de punta a punta con derechos calculados: el plan baja el límite, el uso lo alcanza", () => {
    const d = derechos({ versionDePlan: version([], { cajas_por_sucursal: limite(2) }) });
    expect(
      exigirPerilla(d, "cajas_por_sucursal", { sucursalId: sucursalId("s"), empresaId: E1 }, 1).ok,
    ).toBe(true);
    expect(exigirPerilla(d, "cajas_por_sucursal", {}, 2)).toMatchObject({
      ok: false,
      error: { codigo: "LIMITE_DEL_PLAN", limite: 2 },
    });
    const dependiente = derechos({
      versionDePlan: version([], { confirmacion_por_sena: encendida }),
    });
    expect(exigirPerilla(dependiente, "confirmacion_por_sena", {})).toEqual({
      ok: false,
      error: { codigo: "FUNCION_NO_INCLUIDA", perilla: "confirmacion_por_sena" },
    });
  });
});
