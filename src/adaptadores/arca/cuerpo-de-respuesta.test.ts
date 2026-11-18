import { describe, expect, it } from "vitest";
import { causaDeTransporte } from "./cuerpo-de-respuesta";
import type { RespuestaDeTransporte } from "./tipos";

const noSalio = (motivo: string): RespuestaDeTransporte => ({ tipo: "NO_SALIO", motivo });
const sinRespuesta = (motivo: string): RespuestaDeTransporte => ({ tipo: "SIN_RESPUESTA", motivo });

describe("causaDeTransporte: lo que es del sistema y no de la cuenta de ARCA", () => {
  it.each(["EPROTO", "EPROTO_DH_KEY_TOO_SMALL", "ERR_TLS_CERT_ALTNAME_INVALID"])(
    "no salió por %s: problema del sistema",
    (motivo) => {
      expect(causaDeTransporte(noSalio(motivo))).toBe("PROBLEMA_DEL_SISTEMA");
    },
  );

  it("una respuesta demasiado grande es un problema del sistema", () => {
    expect(causaDeTransporte(sinRespuesta("RESPUESTA_DEMASIADO_GRANDE"))).toBe(
      "PROBLEMA_DEL_SISTEMA",
    );
  });

  it.each([
    "EPROTOX",
    "XEPROTO_A",
    "eproto",
    "EPROTO_",
    "ECONNREFUSED",
    "ENOTFOUND",
    "TIEMPO_AGOTADO",
    "CONEXION_CORTADA",
    "ERR_TLS_CERT_ALTNAME_INVALIDX",
    "RESPUESTA_DEMASIADO_GRANDE",
    "",
  ])("no salió por «%s»: sin causa", (motivo) => {
    expect(causaDeTransporte(noSalio(motivo))).toBeNull();
  });

  it.each([
    "EPROTO",
    "EPROTO_X",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "TIEMPO_AGOTADO",
    "CONEXION_CORTADA",
    "RESPUESTA_DEMASIADO_GRANDEX",
  ])("sin respuesta por «%s»: sin causa", (motivo) => {
    expect(causaDeTransporte(sinRespuesta(motivo))).toBeNull();
  });

  it("una respuesta con cualquier estado HTTP no tiene causa de transporte", () => {
    for (const estadoHttp of [200, 400, 403, 500, 503]) {
      expect(causaDeTransporte({ tipo: "RESPUESTA", estadoHttp, cuerpo: "" })).toBeNull();
    }
  });
});
