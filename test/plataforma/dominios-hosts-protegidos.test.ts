import { describe, expect, it } from "vitest";
import type { Host } from "../../src/modulos/marcas/publico";
import { comoAdministrador } from "./apoyo-de-soporte";
import {
  CLAVE_DE_DOMINIOS,
  MARCA_DE_PRUEBA,
  armarDominios,
  dominioDePrueba,
} from "./apoyo-de-dominios";

/**
 * Los hosts de la propia plataforma (`PEDERNAL_HOSTS_PROTEGIDOS`) no se registran, verifican ni activan como dominio de un cliente; sacar uno del aire (desactivar, retirar) sí se puede.
 * Falla que previene: servir a un cliente en el nombre de la plataforma (o quitarle la consola o la app al dueño). Sin base de datos; la composición (sin la variable no se arma) está en
 * `src/composicion/plataforma.test.ts` y la lista en `src/modulos/marcas/dominio/hosts-protegidos.test.ts`.
 */

const PROTEGIDOS = new Set(["consola.plataforma.test"]);
const HOST_PROTEGIDO = "consola.plataforma.test" as Host;
const protegido = () => dominioDePrueba({ host: HOST_PROTEGIDO });
const ID = protegido().id;
const base = { claveDeIdempotencia: CLAVE_DE_DOMINIOS, dominioId: ID };

describe("hosts protegidos", () => {
  it("agregar un host protegido (escrito como sea) se rechaza sin escribir, sin constancia y sin dejar la clave", async () => {
    for (const host of [HOST_PROTEGIDO, "CONSOLA.Plataforma.test", "consola.plataforma.test."]) {
      const { casos, dominios, auditoria, idempotencia } = armarDominios([], "ADMIN", PROTEGIDOS);
      const r = await casos.agregarDominio(comoAdministrador, {
        claveDeIdempotencia: CLAVE_DE_DOMINIOS,
        host,
        superficie: "APP",
        titular: "OPERADOR",
        esCanonico: false,
        duenio: { tipo: "MARCA", marcaId: MARCA_DE_PRUEBA },
      });
      expect(r, host).toEqual({ ok: false, error: "HOST_PROTEGIDO" });
      expect(dominios.llamadas, host).not.toContain("crear");
      expect(auditoria.registros, host).toEqual([]);
      expect(idempotencia.guardadas.size, host).toBe(0);
    }
  });

  it("un host que no está en la lista se agrega con normalidad", async () => {
    const { casos } = armarDominios([], "ADMIN", PROTEGIDOS);
    const r = await casos.agregarDominio(comoAdministrador, {
      claveDeIdempotencia: CLAVE_DE_DOMINIOS,
      host: "carta.cliente.test",
      superficie: "CARTA",
      titular: "CLIENTE",
      esCanonico: false,
      duenio: { tipo: "MARCA", marcaId: MARCA_DE_PRUEBA },
    });
    expect(r.ok).toBe(true);
  });

  it("verificar y activar un host protegido ya existente se rechazan sin escribir", async () => {
    const verificado = dominioDePrueba({ host: HOST_PROTEGIDO, estado: "VERIFICADO" });
    for (const [accion, filas] of [
      ["verificar", [protegido()]],
      ["activar", [verificado]],
    ] as const) {
      const { casos, dominios, auditoria } = armarDominios([...filas], "ADMIN", PROTEGIDOS);
      const r =
        accion === "verificar"
          ? await casos.verificarDominio(comoAdministrador, {
              ...base,
              verificadoEn: new Date("2026-10-11T11:00:00Z"),
            })
          : await casos.activarDominio(comoAdministrador, base);
      expect(r, accion).toEqual({ ok: false, error: "HOST_PROTEGIDO" });
      expect(
        dominios.llamadas.filter((l) => l.startsWith("cambiarEstado")),
        accion,
      ).toEqual([]);
      expect(auditoria.registros, accion).toEqual([]);
    }
  });

  it("desactivar y retirar un host protegido que ya existía SÍ se pueden (sacan del aire, nunca ponen)", async () => {
    const activo = dominioDePrueba({ host: HOST_PROTEGIDO, estado: "ACTIVO" });
    const a = armarDominios([activo], "ADMIN", PROTEGIDOS);
    expect((await a.casos.desactivarDominio(comoAdministrador, base)).ok).toBe(true);
    const b = armarDominios([activo], "ADMIN", PROTEGIDOS);
    expect(
      (await b.casos.retirarDominio(comoAdministrador, { ...base, motivo: "era de la plataforma" }))
        .ok,
    ).toBe(true);
  });
});
