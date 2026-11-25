import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El envío inmediato del mail de las invitaciones (`apps/web/servidor/usuarios.ts`): invitar, reenviar y reactivar piden `despacharElEnvioDeUnaInvitacion` DESPUÉS de que el caso de uso confirmó, con la
 * empresa de la SESIÓN y el id de la invitación que quedó; un rechazo no despacha nada. Previene: una invitación que espera al cron (de noche, hasta 2 horas) y un despacho con la empresa o la
 * invitación equivocadas. Chequeo: este archivo, con el despacho y la composición reemplazados; el despacho real está en `despacho.test.ts` y contra la base en `trabajos-envio-invitacion.test.ts`.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted((): { orden: string[]; despachos: unknown[][]; resultado: unknown } => ({
  orden: [],
  despachos: [],
  resultado: { ok: true, valor: { invitacionId: "inv-1", yaExistia: false } },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../../apps/web/servidor/despacho-inmediato", () => ({
  despacharElEnvioDeUnaInvitacion: (...args: unknown[]) => {
    mundo.orden.push("despacho");
    mundo.despachos.push(args);
  },
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeIdentidad: () => ({
      invitarUsuario: () => {
        mundo.orden.push("caso de uso");
        return Promise.resolve(mundo.resultado);
      },
      reenviarInvitacion: () => {
        mundo.orden.push("caso de uso");
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeIdentidad: () => ({
      listarMiembros: () =>
        Promise.resolve({
          ok: true,
          valor: [
            {
              personaId: "0b0b0b0b-1111-4222-8333-444444444441",
              email: "a@x.test",
              rol: "ADMINISTRADOR",
              activo: false,
            },
          ],
        }),
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => Promise<unknown>) =>
    hacer({ empresaId: "e-de-la-sesion", personaId: "p-de-la-sesion" }),
}));

import {
  invitarAUnUsuario,
  reactivarAUnUsuario,
  reenviarUnaInvitacion,
} from "../../apps/web/servidor/usuarios";

const ID = "0b0b0b0b-1111-4222-8333-444444444442";
const PERSONA = "0b0b0b0b-1111-4222-8333-444444444441";

function formulario(): FormData {
  const datos = new FormData();
  datos.set("email", "nuevo@x.test");
  datos.set("rol", "ADMINISTRADOR");
  return datos;
}

beforeEach(() => {
  mundo.orden.length = 0;
  mundo.despachos.length = 0;
  mundo.resultado = { ok: true, valor: { invitacionId: "inv-1", yaExistia: false } };
});

describe("el envío inmediato de las invitaciones", () => {
  it("invitar despacha DESPUÉS del caso de uso, con la empresa de la sesión y la invitación que quedó", async () => {
    expect(await invitarAUnUsuario(formulario())).toEqual({ estado: "HECHO" });
    expect(mundo.orden).toEqual(["caso de uso", "despacho"]);
    expect(mundo.despachos).toEqual([["e-de-la-sesion", "inv-1"]]);
  });

  it("un doble toque (ya había una invitación) despacha igual esa misma: es seguro y levanta un envío que no salió", async () => {
    mundo.resultado = { ok: true, valor: { invitacionId: "inv-0", yaExistia: true } };
    expect(await invitarAUnUsuario(formulario())).toEqual({ estado: "YA_HABIA" });
    expect(mundo.despachos).toEqual([["e-de-la-sesion", "inv-0"]]);
  });

  it("un rechazo del servidor no despacha nada", async () => {
    mundo.resultado = { ok: false, error: "SIN_PERMISO" };
    expect(await invitarAUnUsuario(formulario())).toMatchObject({ estado: "ERROR" });
    expect(mundo.despachos).toEqual([]);
  });

  it("un formulario inválido no llega al caso de uso ni despacha", async () => {
    expect(await invitarAUnUsuario(new FormData())).toMatchObject({ estado: "ERROR" });
    expect(mundo.orden).toEqual([]);
    expect(mundo.despachos).toEqual([]);
  });

  it("reenviar despacha la invitación NUEVA y devuelve la ruta de su ficha", async () => {
    mundo.resultado = { ok: true, valor: { invitacionId: "inv-nueva", yaEstabaReenviada: false } };
    expect(await reenviarUnaInvitacion(ID)).toMatchObject({ estado: "HECHO" });
    expect(mundo.orden).toEqual(["caso de uso", "despacho"]);
    expect(mundo.despachos).toEqual([["e-de-la-sesion", "inv-nueva"]]);
  });

  it("reenviar rechazado no despacha", async () => {
    mundo.resultado = { ok: false, error: "INVITACION_NO_PENDIENTE" };
    expect(await reenviarUnaInvitacion(ID)).toMatchObject({ estado: "ERROR" });
    expect(mundo.despachos).toEqual([]);
  });

  it("reactivar despacha la invitación nueva de la persona", async () => {
    expect(await reactivarAUnUsuario(PERSONA, new FormData())).toEqual({ estado: "HECHO" });
    expect(mundo.orden).toEqual(["caso de uso", "despacho"]);
    expect(mundo.despachos).toEqual([["e-de-la-sesion", "inv-1"]]);
  });
});
