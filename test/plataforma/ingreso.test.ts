import { describe, expect, it } from "vitest";
import { CODIGOS_DE_PLATAFORMA } from "../../src/capacidades/autenticacion/codigos-de-plataforma";
import {
  destinoSinAcceso,
  esCodigoDeAplicacion,
  esCodigoDeRecuperacion,
  normalizarCodigo,
  resultadoDeVerificacion,
  textoDelErrorDeIngreso,
  TEXTO_NEUTRO_DE_INGRESO,
} from "../../apps/plataforma/logica/ingreso";

describe("textoDelErrorDeIngreso", () => {
  it("sin error no hay aviso", () => {
    expect(textoDelErrorDeIngreso(null)).toBeNull();
    expect(textoDelErrorDeIngreso("")).toBeNull();
  });

  it("cuenta no habilitada y código inválido dicen EXACTAMENTE lo mismo (sin oráculo)", () => {
    expect(textoDelErrorDeIngreso("no_habilitado")).toBe(TEXTO_NEUTRO_DE_INGRESO);
    expect(textoDelErrorDeIngreso("codigo_invalido")).toBe(TEXTO_NEUTRO_DE_INGRESO);
  });

  it("un código que no es de la lista se muestra neutro, nunca el código", () => {
    const texto = textoDelErrorDeIngreso("<script>alert(1)</script>");
    expect(texto).toBe(TEXTO_NEUTRO_DE_INGRESO);
  });

  it("el bloqueo y la sesión vencida tienen su propio texto; los pasos de segundo factor no son error", () => {
    expect(textoDelErrorDeIngreso("demasiados_intentos")).toMatch(/demasiados intentos/i);
    expect(textoDelErrorDeIngreso("sesion_vencida")).toMatch(/venci/i);
    expect(textoDelErrorDeIngreso("segundo_factor_requerido")).toBeNull();
    expect(textoDelErrorDeIngreso("segundo_factor_a_enrolar")).toBeNull();
    expect(textoDelErrorDeIngreso("segundo_factor_reciente_requerido")).toBeNull();
  });

  it("ningún texto muestra el código técnico", () => {
    for (const codigo of CODIGOS_DE_PLATAFORMA) {
      expect(textoDelErrorDeIngreso(codigo) ?? "").not.toContain("_");
    }
  });
});

describe("destinoSinAcceso", () => {
  it("el segundo factor lleva a verificar o a enrolar", () => {
    expect(destinoSinAcceso("segundo_factor_requerido")).toBe("/ingreso/codigo");
    expect(destinoSinAcceso("segundo_factor_a_enrolar")).toBe("/ingreso/alta");
  });

  it("los demás vuelven al ingreso con el motivo", () => {
    expect(destinoSinAcceso("sesion_vencida")).toBe("/ingreso?error=sesion_vencida");
    expect(destinoSinAcceso("no_habilitado")).toBe("/ingreso?error=no_habilitado");
  });

  it("todo código tiene un destino propio (el tipo lo exige) y ninguno sale de la consola", () => {
    for (const codigo of CODIGOS_DE_PLATAFORMA) {
      expect(destinoSinAcceso(codigo)).toMatch(/^\/ingreso/);
    }
  });
});

describe("códigos", () => {
  it("normaliza los espacios pero conserva mayúsculas y minúsculas", () => {
    expect(normalizarCodigo(" 123 456\n")).toBe("123456");
    expect(normalizarCodigo(" AbCdE-1a2B3\n")).toBe("AbCdE-1a2B3");
  });

  it("un código real mixto pasa por normalizarCodigo sin cambiar y sigue siendo válido", () => {
    const real = "aB3dE-Fg7Hi";
    expect(normalizarCodigo(real)).toBe(real);
    expect(esCodigoDeRecuperacion(normalizarCodigo(real))).toBe(true);
  });

  it("el código de la aplicación son seis dígitos exactos", () => {
    expect(esCodigoDeAplicacion("123456")).toBe(true);
    expect(esCodigoDeAplicacion("12345")).toBe(false);
    expect(esCodigoDeAplicacion("1234567")).toBe(false);
    expect(esCodigoDeAplicacion("12345a")).toBe(false);
    expect(esCodigoDeAplicacion("123456\n")).toBe(false);
  });

  it("el de recuperación son diez caracteres con guion", () => {
    expect(esCodigoDeRecuperacion("abcde-12345")).toBe(true);
    expect(esCodigoDeRecuperacion("ABCDE-12345")).toBe(true);
    expect(esCodigoDeRecuperacion("AbCdE-1a2B3")).toBe(true);
    expect(esCodigoDeRecuperacion("abcde12345")).toBe(false);
    expect(esCodigoDeRecuperacion("abcd-12345")).toBe(false);
    expect(esCodigoDeRecuperacion("abcde-12345x")).toBe(false);
    expect(esCodigoDeRecuperacion("abcd_-12345")).toBe(false);
  });
});

describe("resultadoDeVerificacion", () => {
  it("un 2xx es éxito", () => {
    expect(resultadoDeVerificacion(200, { verificado: true })).toEqual({ tipo: "ok" });
  });

  it("código inválido, forma mala y cualquier otro fallo dicen lo mismo", () => {
    const neutro = { tipo: "error", texto: TEXTO_NEUTRO_DE_INGRESO };
    expect(resultadoDeVerificacion(401, { codigo: "codigo_invalido" })).toEqual(neutro);
    expect(resultadoDeVerificacion(400, { codigo: "codigo_invalido" })).toEqual(neutro);
    expect(resultadoDeVerificacion(500, { codigo: "error_interno", referencia: "PD-1" })).toEqual(
      neutro,
    );
    expect(resultadoDeVerificacion(502, null)).toEqual(neutro);
    expect(resultadoDeVerificacion(400, "texto")).toEqual(neutro);
  });

  it("el bloqueo dice que hay que esperar", () => {
    const r = resultadoDeVerificacion(429, {
      codigo: "demasiados_intentos",
      reintentarEnMs: 900000,
    });
    expect(r.tipo).toBe("error");
    expect(r.tipo === "error" && r.texto).toMatch(/demasiados intentos/i);
  });

  it("sin segundo factor enrolado lleva al alta; sesión vencida o no habilitado, al ingreso", () => {
    expect(resultadoDeVerificacion(400, { codigo: "segundo_factor_a_enrolar" })).toEqual({
      tipo: "ir",
      destino: "/ingreso/alta",
    });
    expect(resultadoDeVerificacion(401, { codigo: "sesion_vencida" })).toEqual({
      tipo: "ir",
      destino: "/ingreso?error=sesion_vencida",
    });
    expect(resultadoDeVerificacion(403, { codigo: "no_habilitado" })).toEqual({
      tipo: "ir",
      destino: "/ingreso?error=no_habilitado",
    });
  });
});
