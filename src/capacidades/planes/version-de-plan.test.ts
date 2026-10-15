import { describe, expect, it } from "vitest";
import {
  MODULOS_DE_PRUEBA,
  PERILLAS_DE_PRUEBA,
  apagada,
  encendida,
  limite,
} from "../../../test/utilidades/planes";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "./perillas";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN,
  nombreDePlanValido,
  validarCodigoDePlan,
  validarVersionDePlan,
  type ContenidoDeVersionDePlan,
} from "./version-de-plan";

const valida = (extra: Partial<ContenidoDeVersionDePlan> = {}): ContenidoDeVersionDePlan => ({
  nombreComercial: "Básico",
  modulos: ["caja"],
  perillas: {},
  ...extra,
});
const validar = (contenido: ContenidoDeVersionDePlan) =>
  validarVersionDePlan(MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA, contenido);

describe("validarCodigoDePlan", () => {
  it.each(["basico", "plan-pro", "ab", "a1", "a-1-b", "a".repeat(40), "z9"])("acepta %s", (c) => {
    expect(validarCodigoDePlan(c)).toEqual({ ok: true, valor: c });
  });

  it.each([
    ["vacío", ""],
    ["una sola letra", "a"],
    ["41 caracteres", "a".repeat(41)],
    ["empieza con número", "1abc"],
    ["empieza con guion", "-abc"],
    ["mayúsculas", "Basico"],
    ["guion bajo", "plan_pro"],
    ["punto", "plan.pro"],
    ["espacio", "plan pro"],
    ["eñe", "ñandu"],
    ["con salto de línea al final", "abc\n"],
    ["con salto de línea al principio", "\nabc"],
    ["barra", "a/b"],
  ])("rechaza %s", (_nombre, codigo) => {
    expect(validarCodigoDePlan(codigo)).toEqual({ ok: false, error: "CODIGO_DE_PLAN_INVALIDO" });
  });
});

describe("nombreDePlanValido", () => {
  it("recorta y acepta de 1 a 60 caracteres", () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN).toBe(60);
    expect(nombreDePlanValido("  Básico  ")).toBe("Básico");
    expect(nombreDePlanValido("x")).toBe("x");
    expect(nombreDePlanValido("a".repeat(60))).toBe("a".repeat(60));
    expect(nombreDePlanValido("Plan con espacios y ñ")).toBe("Plan con espacios y ñ");
  });

  it("rechaza vacío, solo espacios y más de 60", () => {
    expect(nombreDePlanValido("")).toBeNull();
    expect(nombreDePlanValido("   ")).toBeNull();
    expect(nombreDePlanValido("a".repeat(61))).toBeNull();
  });

  it("cuenta caracteres, no unidades de texto: 60 emojis entran, 61 no", () => {
    expect(nombreDePlanValido("😀".repeat(60))).toBe("😀".repeat(60));
    expect(nombreDePlanValido("😀".repeat(61))).toBeNull();
  });

  it.each([
    ["salto de línea", "Plan\nuno"],
    ["tabulación", "Plan\tuno"],
    ["nulo", "Plan\u0000"],
    ["ancho cero", "Pl​an"],
    ["marca bidireccional", "Plan‮uno"],
    ["separador de línea", "Plan uno"],
    ["separador de párrafo", "Plan uno"],
  ])("rechaza %s", (_, nombre) => {
    expect(nombreDePlanValido(nombre)).toBeNull();
  });
});

describe("validarVersionDePlan: lo que se congela", () => {
  it("una versión sana pasa, con el nombre recortado, los módulos sin repetir y ordenados y las perillas tipadas", () => {
    const r = validar({
      nombreComercial: "  Completo ",
      modulos: ["ventas", "caja", "ventas", "nucleo"],
      perillas: { cajas_por_sucursal: limite(3), carta_por_qr: encendida },
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        nombreComercial: "Completo",
        modulos: ["caja", "nucleo", "ventas"],
        perillas: { cajas_por_sucursal: limite(3), carta_por_qr: encendida },
      },
    });
  });

  it("un plan sin módulos ni perillas es válido (todo vale la base)", () => {
    expect(validar(valida({ modulos: [] }))).toEqual({
      ok: true,
      valor: { nombreComercial: "Básico", modulos: [], perillas: {} },
    });
  });

  it("funciona con los catálogos reales", () => {
    expect(
      validarVersionDePlan(CATALOGO_DE_MODULOS, CATALOGO_DE_PERILLAS, {
        nombreComercial: "Grupo",
        modulos: ["administracion"],
        perillas: { empresas_por_tenant: limite("ILIMITADO") },
      }),
    ).toEqual({
      ok: true,
      valor: {
        nombreComercial: "Grupo",
        modulos: ["administracion"],
        perillas: { empresas_por_tenant: limite("ILIMITADO") },
      },
    });
  });

  it("no modifica lo que recibe", () => {
    const contenido = valida({
      modulos: ["ventas", "caja"],
      perillas: { carta_por_qr: encendida },
    });
    const copia = structuredClone(contenido);
    validar(contenido);
    expect(contenido).toEqual(copia);
  });
});

describe("validarVersionDePlan: los errores, en su orden", () => {
  it("nombre inválido", () => {
    expect(validar(valida({ nombreComercial: " " }))).toEqual({
      ok: false,
      error: { codigo: "NOMBRE_DE_PLAN_INVALIDO" },
    });
  });

  it("módulo desconocido: el primero en el orden dado; un nombre heredado de Object tampoco existe", () => {
    expect(validar(valida({ modulos: ["caja", "fantasma", "otro"] }))).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "fantasma" },
    });
    expect(validar(valida({ modulos: ["constructor"] }))).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "constructor" },
    });
  });

  it("requiere faltante: ventas sin caja; cuentas sin ventas (el primero, en orden de módulo)", () => {
    expect(validar(valida({ modulos: ["ventas"] }))).toEqual({
      ok: false,
      error: { codigo: "REQUIERE_FALTANTE", modulo: "ventas", requiere: "caja" },
    });
    expect(validar(valida({ modulos: ["cuentas", "caja"] }))).toEqual({
      ok: false,
      error: { codigo: "REQUIERE_FALTANTE", modulo: "cuentas", requiere: "ventas" },
    });
  });

  it("la clausura completa pasa; un requerido obligatorio no hace falta listarlo", () => {
    expect(validar(valida({ modulos: ["cuentas", "ventas", "caja"] })).ok).toBe(true);
    expect(validar(valida({ modulos: ["reservas"] })).ok).toBe(true);
  });

  it("un requerido que no está en el catálogo cuenta como faltante", () => {
    const catalogo = { a: { obligatorio: false, requiere: ["no_existe"] } };
    expect(validarVersionDePlan(catalogo, PERILLAS_DE_PRUEBA, valida({ modulos: ["a"] }))).toEqual({
      ok: false,
      error: { codigo: "REQUIERE_FALTANTE", modulo: "a", requiere: "no_existe" },
    });
  });

  it("perilla desconocida, en orden alfabético; Object.prototype no cuenta", () => {
    expect(validar(valida({ perillas: { zeta: encendida, alfa: encendida } }))).toEqual({
      ok: false,
      error: { codigo: "PERILLA_DESCONOCIDA", perilla: "alfa" },
    });
    expect(validar(valida({ perillas: { constructor: encendida } }))).toEqual({
      ok: false,
      error: { codigo: "PERILLA_DESCONOCIDA", perilla: "constructor" },
    });
  });

  it.each([
    ["tipo equivocado", { carta_por_qr: limite(1) }, "carta_por_qr"],
    ["límite fuera de rango", { cajas_por_sucursal: limite(-1) }, "cajas_por_sucursal"],
    ["límite decimal", { cajas_por_sucursal: limite(1.5) }, "cajas_por_sucursal"],
    ["sin etiqueta", { carta_por_qr: { encendida: true } }, "carta_por_qr"],
    ["nulo", { carta_por_qr: null }, "carta_por_qr"],
    ["texto", { cajas_por_sucursal: "3" }, "cajas_por_sucursal"],
  ])("valor de perilla inválido: %s", (_, perillas, perilla) => {
    expect(validar(valida({ perillas }))).toEqual({
      ok: false,
      error: { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla },
    });
  });

  it("perilla encendida cuya requerida está apagada: PERILLA_REQUIERE_OTRA", () => {
    expect(validar(valida({ perillas: { confirmacion_por_sena: encendida } }))).toEqual({
      ok: false,
      error: {
        codigo: "PERILLA_REQUIERE_OTRA",
        perilla: "confirmacion_por_sena",
        requiere: "reserva_provisoria",
      },
    });
    expect(
      validar(
        valida({ perillas: { confirmacion_por_sena: encendida, reserva_provisoria: apagada } }),
      ).ok,
    ).toBe(false);
  });

  it("con la requerida encendida en el plan, pasa", () => {
    expect(
      validar(
        valida({ perillas: { confirmacion_por_sena: encendida, reserva_provisoria: encendida } }),
      ).ok,
    ).toBe(true);
  });

  it("una perilla apagada no exige a su requerida; tampoco una que el plan no menciona", () => {
    expect(validar(valida({ perillas: { confirmacion_por_sena: apagada } })).ok).toBe(true);
    expect(validar(valida({ perillas: {} })).ok).toBe(true);
  });

  it("un límite en 0 está apagado; en 1 o ILIMITADO, encendido: overbooking exige asignacion_diferida", () => {
    expect(validar(valida({ perillas: { overbooking: limite(0) } })).ok).toBe(true);
    for (const l of [1, "ILIMITADO"] as const) {
      expect(validar(valida({ perillas: { overbooking: limite(l) } }))).toEqual({
        ok: false,
        error: {
          codigo: "PERILLA_REQUIERE_OTRA",
          perilla: "overbooking",
          requiere: "asignacion_diferida",
        },
      });
    }
    expect(
      validar(valida({ perillas: { overbooking: limite(2), asignacion_diferida: encendida } })).ok,
    ).toBe(true);
  });

  it("la requerida que el plan no fija vale su base: una base encendida alcanza", () => {
    const catalogo = {
      ...PERILLAS_DE_PRUEBA,
      dependiente: { ...PERILLAS_DE_PRUEBA.con_sello, requiere: "con_sello" },
    };
    expect(
      validarVersionDePlan(
        MODULOS_DE_PRUEBA,
        catalogo,
        valida({ perillas: { dependiente: encendida } }),
      ).ok,
    ).toBe(true);
    // ...y apagarla en el plan la deja sin base que valga.
    expect(
      validarVersionDePlan(
        MODULOS_DE_PRUEBA,
        catalogo,
        valida({ perillas: { dependiente: encendida, con_sello: apagada } }),
      ),
    ).toEqual({
      ok: false,
      error: { codigo: "PERILLA_REQUIERE_OTRA", perilla: "dependiente", requiere: "con_sello" },
    });
  });

  it("una requerida que no existe en el catálogo nunca está encendida", () => {
    const catalogo = {
      rota: { ...PERILLAS_DE_PRUEBA.con_sello, requiere: "no_existe" },
    };
    expect(
      validarVersionDePlan(MODULOS_DE_PRUEBA, catalogo, valida({ perillas: { rota: encendida } })),
    ).toEqual({
      ok: false,
      error: { codigo: "PERILLA_REQUIERE_OTRA", perilla: "rota", requiere: "no_existe" },
    });
  });

  it("orden: nombre, módulos, clausura, perillas desconocidas, valores, requiere", () => {
    const todoMal = {
      nombreComercial: "",
      modulos: ["fantasma"],
      perillas: { zeta: 1 },
    };
    expect(validar(todoMal)).toMatchObject({ error: { codigo: "NOMBRE_DE_PLAN_INVALIDO" } });
    expect(validar({ ...todoMal, nombreComercial: "x" })).toMatchObject({
      error: { codigo: "MODULO_DESCONOCIDO" },
    });
    expect(validar({ ...todoMal, nombreComercial: "x", modulos: ["ventas"] })).toMatchObject({
      error: { codigo: "REQUIERE_FALTANTE" },
    });
    expect(validar({ ...todoMal, nombreComercial: "x", modulos: [] })).toMatchObject({
      error: { codigo: "PERILLA_DESCONOCIDA" },
    });
    expect(
      validar({
        nombreComercial: "x",
        modulos: [],
        perillas: { carta_por_qr: 1, confirmacion_por_sena: encendida },
      }),
    ).toMatchObject({ error: { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "carta_por_qr" } });
  });
});
