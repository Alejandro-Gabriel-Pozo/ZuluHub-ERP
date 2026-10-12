import { describe, expect, it } from "vitest";
import type { MensajeDeCorreo } from "../../puertos/correo";
import { ErrorDeConfiguracion } from "../postgres/errores";
import { crearCorreoResend } from "./correo-resend";

/** `fetch` inventado: estas pruebas no hacen ninguna llamada de red. */
const CLAVE_DE_API = "re_clave_inventada_para_pruebas";
const CONFIGURACION = {
  claveDeApi: CLAVE_DE_API,
  remitente: "ZuluHub <no-responder@ejemplo.test>",
};
const MENSAJE: MensajeDeCorreo = {
  para: "ana@ejemplo.test",
  asunto: "Te invitaron",
  texto: "Entrá a https://app.ejemplo.test/invitaciones/abc",
};

type Llamada = { url: string; init: RequestInit };

function fetchFalso(responder: (llamada: Llamada) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const falso = (async (url: string, init?: RequestInit) => {
    const llamada = { url, init: init ?? {} };
    llamadas.push(llamada);
    return await responder(llamada);
  }) as unknown as typeof fetch;
  return { fetch: falso, llamadas };
}

const json = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json" },
  });

describe("correo de Resend", () => {
  it("envía POST a /emails con la clave, el remitente, el destinatario y la clave de idempotencia", async () => {
    const { fetch, llamadas } = fetchFalso(() => json(200, { id: "abc-123" }));
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(
      MENSAJE,
      "invitacion:x:envio",
    );
    expect(r).toEqual({ tipo: "ENVIADO", idDelProveedor: "abc-123" });
    expect(llamadas).toHaveLength(1);
    const { url, init } = llamadas[0] as Llamada;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${CLAVE_DE_API}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "invitacion:x:envio",
      "User-Agent": "zuluhub-erp",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: "ZuluHub <no-responder@ejemplo.test>",
      to: ["ana@ejemplo.test"],
      subject: "Te invitaron",
      text: MENSAJE.texto,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("usa la URL de la API que se le indique", async () => {
    const { fetch, llamadas } = fetchFalso(() => json(200, { id: "1" }));
    await crearCorreoResend({
      configuracion: CONFIGURACION,
      fetch,
      urlDeLaApi: "https://api.prueba.test/emails",
    }).enviar(MENSAJE, "k");
    expect(llamadas[0]?.url).toBe("https://api.prueba.test/emails");
  });

  it("sin id en la respuesta, igual es un envío correcto", async () => {
    const { fetch } = fetchFalso(() => json(200, {}));
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(MENSAJE, "k");
    expect(r).toEqual({ tipo: "ENVIADO", idDelProveedor: null });
    const { fetch: f2 } = fetchFalso(() => new Response("no es json", { status: 200 }));
    expect(
      await crearCorreoResend({ configuracion: CONFIGURACION, fetch: f2 }).enviar(MENSAJE, "k"),
    ).toEqual({ tipo: "ENVIADO", idDelProveedor: null });
    const { fetch: f3 } = fetchFalso(() => json(200, { id: 5 }));
    expect(
      await crearCorreoResend({ configuracion: CONFIGURACION, fetch: f3 }).enviar(MENSAJE, "k"),
    ).toEqual({ tipo: "ENVIADO", idDelProveedor: null });
  });

  it.each([400, 404, 422])("un %s es un fallo definitivo", async (estado) => {
    const { fetch } = fetchFalso(() => json(estado, { name: "validation_error", message: "mal" }));
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(MENSAJE, "k");
    expect(r).toEqual({
      tipo: "FALLO",
      definitivo: true,
      motivo: `el proveedor respondió ${estado} (validation_error)`,
    });
  });

  it.each([401, 403, 408, 409, 429, 500, 502, 503])("un %s se puede reintentar", async (estado) => {
    const { fetch } = fetchFalso(() => json(estado, {}));
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(MENSAJE, "k");
    expect(r).toEqual({
      tipo: "FALLO",
      definitivo: false,
      motivo: `el proveedor respondió ${estado}`,
    });
  });

  it("un cuerpo de error que no es JSON o no tiene `name` solo informa el estado", async () => {
    const { fetch } = fetchFalso(() => new Response("<html>", { status: 502 }));
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(MENSAJE, "k");
    expect(r).toEqual({ tipo: "FALLO", definitivo: false, motivo: "el proveedor respondió 502" });
    const { fetch: f2 } = fetchFalso(() => json(500, ["x"]));
    expect(
      await crearCorreoResend({ configuracion: CONFIGURACION, fetch: f2 }).enviar(MENSAJE, "k"),
    ).toEqual({ tipo: "FALLO", definitivo: false, motivo: "el proveedor respondió 500" });
    const { fetch: f3 } = fetchFalso(() => json(500, { name: 7 }));
    expect(
      await crearCorreoResend({ configuracion: CONFIGURACION, fetch: f3 }).enviar(MENSAJE, "k"),
    ).toEqual({ tipo: "FALLO", definitivo: false, motivo: "el proveedor respondió 500" });
  });

  it("recorta el nombre del error que informa el proveedor", async () => {
    const { fetch } = fetchFalso(() => json(500, { name: "x".repeat(200) }));
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(MENSAJE, "k");
    expect(r).toEqual({
      tipo: "FALLO",
      definitivo: false,
      motivo: `el proveedor respondió 500 (${"x".repeat(60)})`,
    });
  });

  it("un fallo de red es reintentable y su motivo no repite la URL ni el mensaje del error", async () => {
    const { fetch } = fetchFalso(() => {
      throw new TypeError("fetch failed: https://api.resend.com/emails con Bearer secreto");
    });
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(MENSAJE, "k");
    expect(r).toEqual({
      tipo: "FALLO",
      definitivo: false,
      motivo: "no se pudo llamar al proveedor (TypeError)",
    });
  });

  it("algo lanzado que no es un Error igual se informa sin detalle", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justamente se prueba qué pasa con algo que no es un Error
    const { fetch } = fetchFalso(() => Promise.reject("texto suelto con secreto"));
    const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(MENSAJE, "k");
    expect(r).toEqual({
      tipo: "FALLO",
      definitivo: false,
      motivo: "no se pudo llamar al proveedor (desconocido)",
    });
  });

  it("ningún motivo de fallo incluye la clave de API, el cuerpo ni el enlace", async () => {
    const casos = [
      () => json(500, { name: "internal", message: `eco ${CLAVE_DE_API} ${MENSAJE.texto}` }),
      () => {
        throw new Error(`falló con ${CLAVE_DE_API}`);
      },
    ];
    for (const caso of casos) {
      const { fetch } = fetchFalso(caso);
      const r = await crearCorreoResend({ configuracion: CONFIGURACION, fetch }).enviar(
        MENSAJE,
        "k",
      );
      expect(JSON.stringify(r)).not.toContain(CLAVE_DE_API);
      expect(JSON.stringify(r)).not.toContain("invitaciones");
    }
  });

  it("una clave de idempotencia vacía lanza, sin llamar", async () => {
    const { fetch, llamadas } = fetchFalso(() => json(200, { id: "1" }));
    const correo = crearCorreoResend({ configuracion: CONFIGURACION, fetch });
    await expect(correo.enviar(MENSAJE, "")).rejects.toBeInstanceOf(RangeError);
    await expect(correo.enviar(MENSAJE, "  ")).rejects.toBeInstanceOf(RangeError);
    expect(llamadas).toEqual([]);
  });

  it("falla cerrado si falta la clave de API o el remitente", () => {
    expect(() =>
      crearCorreoResend({ configuracion: { claveDeApi: "", remitente: "a@b.test" } }),
    ).toThrow(ErrorDeConfiguracion);
    expect(() =>
      crearCorreoResend({ configuracion: { claveDeApi: CLAVE_DE_API, remitente: " " } }),
    ).toThrow(ErrorDeConfiguracion);
    expect(() =>
      crearCorreoResend({ configuracion: { claveDeApi: " ", remitente: "a@b.test" } }),
    ).toThrow(ErrorDeConfiguracion);
  });

  it("el tiempo máximo corta una llamada colgada y se informa como reintentable", async () => {
    const { fetch } = fetchFalso(
      ({ init }) =>
        new Promise<Response>((_resolver, rechazar) => {
          init.signal?.addEventListener("abort", () => {
            rechazar(init.signal?.reason as Error);
          });
        }),
    );
    const r = await crearCorreoResend({
      configuracion: CONFIGURACION,
      fetch,
      tiempoMaximoEnMs: 20,
    }).enviar(MENSAJE, "k");
    expect(r).toEqual({
      tipo: "FALLO",
      definitivo: false,
      motivo: "no se pudo llamar al proveedor (TimeoutError)",
    });
  });
});
