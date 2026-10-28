import { describe, expect, it } from "vitest";
import {
  errorParaLaPantalla,
  type ErrorParaLaPantalla,
} from "../../apps/plataforma/logica/errores-de-plataforma";

const VIEJA = "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.";

const textoDe = (e: ErrorParaLaPantalla): string => ("texto" in e ? e.texto : "");

describe("errorParaLaPantalla: puerta y pantalla vieja", () => {
  it("segundo_factor_reciente_requerido pide el segundo factor", () => {
    expect(errorParaLaPantalla("segundo_factor_reciente_requerido")).toEqual({
      tipo: "SEGUNDO_FACTOR",
    });
  });

  it("SIN_PERMISO oculta la acción", () => {
    expect(errorParaLaPantalla("SIN_PERMISO")).toEqual({ tipo: "OCULTAR_ACCION" });
  });

  it.each(["CLAVE_REUTILIZADA", "CLAVE_DE_IDEMPOTENCIA_INVALIDA", "VERSION_DESACTUALIZADA"])(
    "%s es pantalla vieja",
    (codigo) => {
      expect(errorParaLaPantalla(codigo)).toEqual({ tipo: "PANTALLA_VIEJA", texto: VIEJA });
    },
  );

  it("INSTALACION_SINGLE_YA_TIENE_TENANT y los desconocidos son inesperados", () => {
    expect(errorParaLaPantalla("INSTALACION_SINGLE_YA_TIENE_TENANT")).toEqual({
      tipo: "INESPERADO",
    });
    expect(errorParaLaPantalla("CODIGO_QUE_NO_EXISTE")).toEqual({ tipo: "INESPERADO" });
    expect(errorParaLaPantalla("constructor")).toEqual({ tipo: "INESPERADO" });
    expect(errorParaLaPantalla({ codigo: "OTRO_DESCONOCIDO", token: "x" })).toEqual({
      tipo: "INESPERADO",
    });
  });
});

describe("errorParaLaPantalla: campos del alta", () => {
  const casos: readonly (readonly [string, string])[] = [
    ["CUIT_FORMATO_INVALIDO", "cuit"],
    ["CUIT_DIGITO_VERIFICADOR_INVALIDO", "cuit"],
    ["CUIT_INVALIDO", "cuit"],
    ["CUIT_DUPLICADO", "cuit"],
    ["RAZON_SOCIAL_INVALIDA", "razonSocial"],
    ["NOMBRE_INVALIDO", "razonSocial"],
    ["EMAIL_INVALIDO", "emailGerente"],
    ["EMAIL_DE_ADMIN_PLATAFORMA", "emailGerente"],
    ["MARCA_INDEFINIDA", "marcaId"],
    ["MARCA_ID_INVALIDA", "marcaId"],
    ["MARCA_NO_ENCONTRADA", "marcaId"],
    ["MARCA_RETIRADA", "marcaId"],
    ["MARCA_SIN_DEFINICION", "marcaId"],
    ["MARCA_SIN_DOMINIO", "marcaId"],
    ["MARCA_SIN_PLAN_POR_DEFECTO", "versionDePlanId"],
    ["VERSION_DE_PLAN_ID_INVALIDA", "versionDePlanId"],
    ["VERSION_DE_PLAN_NO_ENCONTRADA", "versionDePlanId"],
    ["VERSION_DE_PLAN_NO_PUBLICADA", "versionDePlanId"],
    ["PLAN_RETIRADO", "versionDePlanId"],
    ["ZONA_HORARIA_INVALIDA", "zonaHoraria"],
  ];

  it.each(casos)("%s va al campo %s con un texto en castellano", (codigo, campo) => {
    const e = errorParaLaPantalla(codigo);
    expect(e.tipo).toBe("CAMPO");
    if (e.tipo === "CAMPO") {
      expect(e.campo).toBe(campo);
      expect(e.texto.length).toBeGreaterThan(5);
    }
  });

  it("CUIT_DUPLICADO dice exactamente lo decidido por el dueño", () => {
    expect(errorParaLaPantalla("CUIT_DUPLICADO")).toEqual({
      tipo: "CAMPO",
      campo: "cuit",
      texto: "Ya hay una empresa con ese CUIT.",
    });
  });

  it("EMAIL_DE_ADMIN_PLATAFORMA usa el texto genérico", () => {
    expect(errorParaLaPantalla("EMAIL_DE_ADMIN_PLATAFORMA")).toEqual({
      tipo: "CAMPO",
      campo: "emailGerente",
      texto: "Ese correo no se puede usar para el primer gerente.",
    });
  });
});

describe("errorParaLaPantalla: errores generales", () => {
  it("MONEDA_NO_SOPORTADA es general", () => {
    expect(errorParaLaPantalla("MONEDA_NO_SOPORTADA").tipo).toBe("GENERAL");
  });

  it.each([
    "TENANT_AMBIGUO",
    "TENANT_ID_INVALIDO",
    "TENANT_INDEFINIDO",
    "TENANT_NO_ENCONTRADO",
    "TENANT_NO_ACTIVO",
    "PLAN_SOLO_CON_TENANT_NUEVO",
    "MARCA_SOLO_CON_TENANT_NUEVO",
  ])("%s dice que no se pudo dar de alta", (codigo) => {
    expect(errorParaLaPantalla(codigo)).toEqual({
      tipo: "GENERAL",
      texto: "No se pudo dar de alta la empresa. Revisá los datos.",
    });
  });

  it.each([
    "LIMITE_INVALIDO",
    "CURSOR_INVALIDO",
    "ID_INVALIDO",
    "FILTRO_INVALIDO",
    "ESTADO_INVALIDO",
    "ESTADO_EFECTIVO_INVALIDO",
  ])("%s habla de los filtros", (codigo) => {
    expect(errorParaLaPantalla(codigo)).toEqual({
      tipo: "GENERAL",
      texto: "Los filtros no son válidos. Probá quitarlos.",
    });
  });
});

describe("errorParaLaPantalla: LIMITE_DEL_PLAN", () => {
  it("lleva los números", () => {
    const e = errorParaLaPantalla({
      codigo: "LIMITE_DEL_PLAN",
      perilla: "empresas_por_tenant",
      limite: 3,
      usoActual: 5,
    });
    expect(e).toEqual({ tipo: "GENERAL", texto: "El plan permite 3 empresas y ya tiene 5." });
  });

  it("si los números no son válidos, el texto no los lleva", () => {
    for (const datos of [
      { limite: "3", usoActual: 5 },
      { limite: Number.NaN, usoActual: 5 },
      { limite: 3, usoActual: Number.POSITIVE_INFINITY },
      { limite: 3 },
    ]) {
      const e = errorParaLaPantalla({
        codigo: "LIMITE_DEL_PLAN",
        perilla: "empresas_por_tenant",
        ...datos,
      });
      expect(e.tipo).toBe("GENERAL");
      expect(textoDe(e)).not.toMatch(/\d/);
    }
  });

  it("no interpola una perilla ajena", () => {
    const e = errorParaLaPantalla({
      codigo: "LIMITE_DEL_PLAN",
      perilla: "<script>",
      limite: 1,
      usoActual: 2,
    });
    expect(textoDe(e)).not.toContain("script");
  });
});

describe("errorParaLaPantalla: lo que nunca se muestra", () => {
  it("un error de persistencia es inesperado y no filtra nada", () => {
    const e = errorParaLaPantalla({
      tipo: "ErrorDePersistencia",
      restriccion: "x",
      sqlstate: "23505",
      mensaje: "duplicate key",
    });
    expect(e).toEqual({ tipo: "INESPERADO" });
    const texto = JSON.stringify(e);
    for (const palabra of [
      "duplicate",
      "23505",
      "restriccion",
      "sqlstate",
      "ErrorDePersistencia",
    ]) {
      expect(texto).not.toContain(palabra);
    }
  });

  it.each([null, undefined, 42, [], ["SIN_PERMISO"], true, {}, { codigo: 7 }])(
    "%j es inesperado",
    (valor) => {
      expect(errorParaLaPantalla(valor)).toEqual({ tipo: "INESPERADO" });
    },
  );

  it("ningún texto devuelto lleva un guion bajo ni un código en mayúsculas", () => {
    const codigos = [
      "SIN_PERMISO",
      "CLAVE_REUTILIZADA",
      "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      "VERSION_DESACTUALIZADA",
      "CUIT_FORMATO_INVALIDO",
      "CUIT_DIGITO_VERIFICADOR_INVALIDO",
      "CUIT_INVALIDO",
      "CUIT_DUPLICADO",
      "RAZON_SOCIAL_INVALIDA",
      "NOMBRE_INVALIDO",
      "EMAIL_INVALIDO",
      "EMAIL_DE_ADMIN_PLATAFORMA",
      "MARCA_INDEFINIDA",
      "MARCA_ID_INVALIDA",
      "MARCA_NO_ENCONTRADA",
      "MARCA_RETIRADA",
      "MARCA_SIN_DEFINICION",
      "MARCA_SIN_DOMINIO",
      "MARCA_SIN_PLAN_POR_DEFECTO",
      "VERSION_DE_PLAN_ID_INVALIDA",
      "VERSION_DE_PLAN_NO_ENCONTRADA",
      "VERSION_DE_PLAN_NO_PUBLICADA",
      "PLAN_RETIRADO",
      "ZONA_HORARIA_INVALIDA",
      "MONEDA_NO_SOPORTADA",
      "TENANT_AMBIGUO",
      "TENANT_ID_INVALIDO",
      "TENANT_INDEFINIDO",
      "TENANT_NO_ENCONTRADO",
      "TENANT_NO_ACTIVO",
      "PLAN_SOLO_CON_TENANT_NUEVO",
      "MARCA_SOLO_CON_TENANT_NUEVO",
      "LIMITE_INVALIDO",
      "CURSOR_INVALIDO",
      "ID_INVALIDO",
      "FILTRO_INVALIDO",
      "ESTADO_INVALIDO",
      "ESTADO_EFECTIVO_INVALIDO",
      "INSTALACION_SINGLE_YA_TIENE_TENANT",
      "FUNCION_NO_INCLUIDA",
      "CODIGO_DESCONOCIDO",
      { codigo: "LIMITE_DEL_PLAN", perilla: "empresas_por_tenant", limite: 3, usoActual: 5 },
      { codigo: "LIMITE_DEL_PLAN", perilla: "x" },
    ];
    for (const codigo of codigos) {
      const texto = textoDe(errorParaLaPantalla(codigo));
      expect(texto).not.toContain("_");
      expect(texto.replaceAll("CUIT", "")).not.toMatch(/[A-Z]{3,}/);
    }
  });
});
