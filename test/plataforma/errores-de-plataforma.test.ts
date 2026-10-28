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

describe("errorParaLaPantalla: submarca", () => {
  const SCRIPT = "<script>alert(1)</script>";
  const campo = (c: string, texto: string): ErrorParaLaPantalla =>
    ({ tipo: "CAMPO", campo: c, texto }) as ErrorParaLaPantalla;
  const general = (texto: string): ErrorParaLaPantalla => ({ tipo: "GENERAL", texto });

  it("nombre, motivo y vigencia van a su campo", () => {
    expect(errorParaLaPantalla("NOMBRE_DE_MARCA_INVALIDO")).toEqual(
      campo("nombreVisible", "El nombre tiene que tener entre 1 y 60 letras, sin símbolos raros."),
    );
    expect(errorParaLaPantalla("MOTIVO_OBLIGATORIO")).toEqual(
      campo("motivo", "Escribí el motivo del cambio."),
    );
    expect(errorParaLaPantalla("MOTIVO_DEMASIADO_LARGO")).toEqual(
      campo("motivo", "El motivo es demasiado largo."),
    );
    expect(errorParaLaPantalla("VIGENCIA_INVALIDA")).toEqual(
      campo("vigenteDesde", "Elegí una fecha válida."),
    );
    expect(errorParaLaPantalla("VIGENCIA_RETROACTIVA")).toEqual(
      campo("vigenteDesde", "La fecha tiene que ser posterior a hoy."),
    );
  });

  it.each([
    ["primary", "primary"],
    ["on-primary", "onPrimary"],
    ["secondary", "secondary"],
    ["accent", "accent"],
  ])("TEMA_INVALIDO con token %s va al campo %s", (token, c) => {
    expect(errorParaLaPantalla({ codigo: "TEMA_INVALIDO", token })).toEqual(
      campo(c, "Ese color no es válido. Usá el formato #rrggbb."),
    );
  });

  it("TEMA_INVALIDO y ASPECTO_INVALIDO con token desconocido no interpolan nada", () => {
    for (const codigo of ["TEMA_INVALIDO", "ASPECTO_INVALIDO"]) {
      for (const token of [SCRIPT, "constructor", 7]) {
        const e = errorParaLaPantalla({ codigo, token });
        expect(e.tipo).toBe("GENERAL");
        expect(textoDe(e)).not.toContain("<");
        expect(textoDe(e)).not.toContain("constructor");
      }
    }
  });

  it.each(["estilo", "superficie", "esquinas", "titulos", "ingreso"])(
    "ASPECTO_INVALIDO %s",
    (token) => {
      expect(errorParaLaPantalla({ codigo: "ASPECTO_INVALIDO", token })).toEqual(
        campo(token, "Esa opción no es válida."),
      );
    },
  );

  it.each([
    ["on-primary/primary", "onPrimary"],
    ["accent/fondo", "accent"],
    ["accent/superficie", "accent"],
  ])("CONTRASTE_INSUFICIENTE %s va a %s", (par, c) => {
    expect(errorParaLaPantalla({ codigo: "CONTRASTE_INSUFICIENTE", par })).toEqual(
      campo(c, "No se lee: elegí un color con más contraste sobre esa superficie."),
    );
  });

  it("DEFINICION_INCOMPLETA lista lo que falta y omite lo desconocido", () => {
    const e = errorParaLaPantalla({
      codigo: "DEFINICION_INCOMPLETA",
      faltan: ["nombre_visible", "tema.on-primary", SCRIPT, "logo", "plan_por_defecto"],
    });
    expect(e).toEqual(
      general(
        "Todavía falta completar: el nombre visible, el texto sobre el principal, el logo (todavía no se puede cargar desde la consola), el plan por defecto.",
      ),
    );
    for (const faltan of [undefined, "logo", [SCRIPT], [1, null]]) {
      const t = textoDe(errorParaLaPantalla({ codigo: "DEFINICION_INCOMPLETA", faltan }));
      expect(t).not.toContain("<");
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it("los módulos no se interpolan", () => {
    const esperado = general("Hay un módulo inicial que el plan por defecto no incluye.");
    expect(
      errorParaLaPantalla({ codigo: "MODULO_INICIAL_FUERA_DEL_PLAN", modulo: SCRIPT }),
    ).toEqual(esperado);
    expect(errorParaLaPantalla({ codigo: "MODULO_DESCONOCIDO", modulo: SCRIPT })).toEqual(esperado);
  });

  it("los códigos con texto del cliente no lo interpolan", () => {
    for (const codigo of ["MARCADORES_DISTINTOS", "TEXTO_INVALIDO", "CLAVE_DE_TEXTO_DESCONOCIDA"]) {
      const e = errorParaLaPantalla({ codigo, texto: SCRIPT, clave: SCRIPT });
      expect(e.tipo).toBe("GENERAL");
      expect(textoDe(e)).not.toContain("<");
    }
  });

  it("textos generales fijos", () => {
    expect(errorParaLaPantalla("SIN_BORRADOR")).toEqual(
      general("No hay un borrador para confirmar. Guardá primero los cambios."),
    );
    expect(errorParaLaPantalla("CAMBIO_PROGRAMADO_PENDIENTE")).toEqual(
      general(
        "Ya hay un cambio programado. Tildá «Reemplazar el cambio programado» para confirmar este.",
      ),
    );
    for (const c of [
      "LOGO_INVALIDO",
      "PLAN_NO_ENCONTRADO",
      "PLAN_POR_DEFECTO_RETIRADO",
      "VERSION_ESPERADA_INVALIDA",
    ]) {
      expect(errorParaLaPantalla(c).tipo).toBe("GENERAL");
    }
  });

  it("ConcurrenciaAgotada, como texto o como objeto", () => {
    const esperado = general("Se estaba guardando otro cambio a la vez. Probá de nuevo.");
    expect(errorParaLaPantalla({ tipo: "ConcurrenciaAgotada" })).toEqual(esperado);
    expect(errorParaLaPantalla("ConcurrenciaAgotada")).toEqual(esperado);
  });

  it("en el contexto de submarca, los códigos compartidos son pantalla vieja", () => {
    for (const c of ["MARCA_NO_ENCONTRADA", "ID_INVALIDO"]) {
      expect(errorParaLaPantalla(c, "SUBMARCA")).toEqual({
        tipo: "PANTALLA_VIEJA",
        texto: "La pantalla quedó vieja. Volvé a abrirla.",
      });
    }
    const v = errorParaLaPantalla("VERSION_DESACTUALIZADA", "SUBMARCA");
    expect(v.tipo).toBe("PANTALLA_VIEJA");
    expect(textoDe(v)).toContain("Alguien más cambió el borrador");
    expect(textoDe(v)).toContain("Recargá la pantalla");
  });

  it("sin contexto, el alta conserva su traducción", () => {
    expect(errorParaLaPantalla("MARCA_NO_ENCONTRADA").tipo).toBe("CAMPO");
    expect(errorParaLaPantalla("ID_INVALIDO").tipo).toBe("GENERAL");
  });
});
