import { describe, expect, it } from "vitest";
import type { MensajeDeCorreo } from "../../puertos/correo";
import { crearCorreoFalso } from "./correo-falso";

const MENSAJE: MensajeDeCorreo = { para: "ana@ejemplo.test", asunto: "Hola", texto: "Chau" };

describe("correo falso", () => {
  it("registra lo enviado", async () => {
    const correo = crearCorreoFalso();
    const r = await correo.enviar(MENSAJE, "clave-1");
    expect(r).toEqual({ tipo: "ENVIADO", idDelProveedor: "falso-1" });
    expect(correo.enviados()).toEqual([
      { id: "falso-1", claveDeIdempotencia: "clave-1", mensaje: MENSAJE },
    ]);
  });

  it("la misma clave con el mismo mensaje no envía otro, pero la llamada queda registrada", async () => {
    const correo = crearCorreoFalso();
    const a = await correo.enviar(MENSAJE, "clave-1");
    const b = await correo.enviar({ ...MENSAJE }, "clave-1");
    expect(b).toEqual(a);
    expect(correo.enviados()).toHaveLength(1);
    expect(correo.llamadas()).toHaveLength(2);
    expect(correo.llamadas().map((l) => l.claveDeIdempotencia)).toEqual(["clave-1", "clave-1"]);
  });

  it("dos llamadas simultáneas con la misma clave envían una sola vez", async () => {
    const correo = crearCorreoFalso();
    await Promise.all([correo.enviar(MENSAJE, "k"), correo.enviar(MENSAJE, "k")]);
    expect(correo.enviados()).toHaveLength(1);
  });

  it("claves distintas envían mensajes distintos", async () => {
    const correo = crearCorreoFalso();
    await correo.enviar(MENSAJE, "a");
    await correo.enviar(MENSAJE, "b");
    expect(correo.enviados().map((e) => e.id)).toEqual(["falso-1", "falso-2"]);
  });

  it.each([
    ["otro destinatario", { para: "otra@ejemplo.test" }],
    ["otro asunto", { asunto: "Otro" }],
    ["otro texto", { texto: "Otro" }],
  ])("la misma clave con %s se rechaza como definitivo", async (_nombre, cambio) => {
    const correo = crearCorreoFalso();
    await correo.enviar(MENSAJE, "k");
    const r = await correo.enviar({ ...MENSAJE, ...cambio }, "k");
    expect(r).toEqual({
      tipo: "FALLO",
      definitivo: true,
      motivo: "clave reutilizada con otro mensaje",
    });
    expect(correo.enviados()).toHaveLength(1);
  });

  it("una clave vacía lanza", async () => {
    const correo = crearCorreoFalso();
    await expect(correo.enviar(MENSAJE, "")).rejects.toBeInstanceOf(RangeError);
    await expect(correo.enviar(MENSAJE, "   ")).rejects.toBeInstanceOf(RangeError);
    expect(correo.llamadas()).toEqual([]);
  });

  it("puede programarse para fallar las próximas N llamadas, sin enviar nada", async () => {
    const correo = crearCorreoFalso();
    correo.fallarLasProximas(2);
    const fallo = { tipo: "FALLO", definitivo: false, motivo: "fallo programado" };
    expect(await correo.enviar(MENSAJE, "k")).toEqual(fallo);
    expect(await correo.enviar(MENSAJE, "k")).toEqual(fallo);
    expect(correo.enviados()).toEqual([]);
    expect((await correo.enviar(MENSAJE, "k")).tipo).toBe("ENVIADO");
    expect(correo.llamadas()).toHaveLength(3);
  });

  it("el fallo programado puede ser definitivo y con motivo propio", async () => {
    const correo = crearCorreoFalso();
    correo.fallarLasProximas(1, { definitivo: true, motivo: "dirección inválida" });
    expect(await correo.enviar(MENSAJE, "k")).toEqual({
      tipo: "FALLO",
      definitivo: true,
      motivo: "dirección inválida",
    });
  });
});
