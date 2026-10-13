import { describe, expect, it } from "vitest";
import { PROVINCIAS } from "../../../primitivas/domicilio/provincias";
import {
  CODIGOS_DE_PROVINCIA,
  FINALIDADES,
  FORMA_DE_VERSION,
  MOTIVOS_DE_RECHAZO,
  MOTIVOS_QUE_ELIGE_UN_ADMIN,
  MOTIVO_RESERVADO_AL_SISTEMA,
  RUBROS,
  VERSIONES_VIGENTES,
} from "./catalogos";

describe("catálogos de la solicitud", () => {
  it("los rubros son los de §4.4 y todos tienen la forma de solicitud_rubro_ck", () => {
    expect(RUBROS).toEqual([
      "cafeteria",
      "panaderia",
      "restaurante",
      "bar",
      "heladeria",
      "almacen_o_comercio",
      "hoteleria",
      "otro",
    ]);
    for (const rubro of RUBROS) expect(rubro).toMatch(/^[a-z][a-z_]{1,39}$/);
  });

  it("las provincias son las 24 del catálogo común, con la forma de solicitud_provincia_ck", () => {
    expect(CODIGOS_DE_PROVINCIA).toHaveLength(24);
    expect(CODIGOS_DE_PROVINCIA).toEqual(PROVINCIAS.map((p) => p.codigo));
    for (const codigo of CODIGOS_DE_PROVINCIA) expect(codigo).toMatch(/^AR-[A-Z]$/);
  });

  it("los motivos de rechazo son los cinco de solicitud_motivo_ck; NO_VERIFICADA es del sistema", () => {
    expect(MOTIVOS_DE_RECHAZO).toEqual([
      "NO_VERIFICADA",
      "FUERA_DE_ALCANCE",
      "DATOS_INCOMPLETOS",
      "NO_CONTACTABLE",
      "OTRO",
    ]);
    expect(MOTIVO_RESERVADO_AL_SISTEMA).toBe("NO_VERIFICADA");
    expect(MOTIVOS_QUE_ELIGE_UN_ADMIN).toEqual([
      "FUERA_DE_ALCANCE",
      "DATOS_INCOMPLETOS",
      "NO_CONTACTABLE",
      "OTRO",
    ]);
  });

  it("la única finalidad es evaluar el alta (no enviar publicidad)", () => {
    expect(FINALIDADES).toEqual(["EVALUAR_ALTA"]);
  });

  it("la forma de una versión es AAAA-MM-DD con un sufijo opcional de hasta tres dígitos", () => {
    for (const bien of ["2026-10-13", "2026-10-13.1", "2026-10-13.12", "2026-10-13.123"]) {
      expect(FORMA_DE_VERSION.test(bien), bien).toBe(true);
    }
    for (const mal of [
      "",
      "2026-10-1",
      "26-10-13",
      "2026-10-13.",
      "2026-10-13.1234",
      "2026-10-13.a",
      "2026-10-13 ",
      " 2026-10-13",
      "2026-10-13\n",
      "x2026-10-13",
      "2026/10/13",
    ]) {
      expect(FORMA_DE_VERSION.test(mal), JSON.stringify(mal)).toBe(false);
    }
  });

  it("hasta que el asesor entregue los textos (B3) no hay ninguna versión vigente: todo envío da PAGINA_VENCIDA", () => {
    expect(VERSIONES_VIGENTES).toEqual({ terminos: [], privacidad: [], avisoDeMedicion: [] });
    for (const lista of Object.values(VERSIONES_VIGENTES)) {
      for (const version of lista) expect(version).toMatch(FORMA_DE_VERSION);
    }
  });
});
