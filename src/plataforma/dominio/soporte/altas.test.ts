import { describe, expect, it } from "vitest";
import {
  emailDesdeTexto,
  estadoDeInvitacion,
  type EstadoGuardado,
  type Invitacion,
} from "../../../modulos/identidad/publico";
import { empresaId, invitacionId, tenantId } from "../../../primitivas/identificadores/marca";
import { PLAZO_DE_ALTA_EN_MS, altaVencida, msRestantesDeAlta } from "../alta";
import { vistaDeAlta, type EmpresaEnAlta } from "./altas";

const HORA = 3_600_000;
const CREADA = new Date("2026-10-10T00:00:00Z");
const EMPRESA: EmpresaEnAlta = {
  id: empresaId("e-1"),
  tenantId: tenantId("t-1"),
  razonSocial: "Acme S.A.",
  creadoEn: CREADA,
};
const emailDeGerente = (() => {
  const r = emailDesdeTexto("gerente@acme.test");
  if (!r.ok) throw new Error("email de prueba inválido");
  return r.valor;
})();

const invitacion = (estado: EstadoGuardado, venceEn: Date): Invitacion => ({
  id: invitacionId("i-1"),
  tenantId: tenantId("t-1"),
  tipo: "ALTA_GERENTE",
  email: emailDeGerente,
  estado,
  emitidaEn: CREADA,
  venceEn,
  empresas: [{ empresaId: empresaId("e-1"), rol: "GERENTE", sucursales: [] }],
  aceptadaPor: null,
  reemplazadaPor: null,
  version: 1,
});

const en = (horas: number) => new Date(CREADA.getTime() + horas * HORA);
const VENCE = en(24);

describe("vistaDeAlta: la invitación del alta", () => {
  it("sin invitación: SIN_INVITACION y sin fecha de vencimiento", () => {
    const v = vistaDeAlta(EMPRESA, null, en(1));
    expect(v.estadoDeLaInvitacion).toBe("SIN_INVITACION");
    expect(v.invitacionVenceEn).toBeNull();
  });

  it("pendiente y no vencida: VIGENTE, con su vencimiento", () => {
    const v = vistaDeAlta(EMPRESA, invitacion("PENDIENTE", VENCE), en(23));
    expect(v.estadoDeLaInvitacion).toBe("VIGENTE");
    expect(v.invitacionVenceEn).toBe(VENCE);
  });

  it("pendiente en el instante exacto del vencimiento: VENCIDA (igual que la aceptación)", () => {
    expect(vistaDeAlta(EMPRESA, invitacion("PENDIENTE", VENCE), en(24)).estadoDeLaInvitacion).toBe(
      "VENCIDA",
    );
    expect(
      vistaDeAlta(EMPRESA, invitacion("PENDIENTE", VENCE), new Date(VENCE.getTime() - 1))
        .estadoDeLaInvitacion,
    ).toBe("VIGENTE");
  });

  it("aceptada y revocada se informan tal cual, aunque ya haya pasado el vencimiento", () => {
    expect(vistaDeAlta(EMPRESA, invitacion("ACEPTADA", VENCE), en(30)).estadoDeLaInvitacion).toBe(
      "ACEPTADA",
    );
    expect(vistaDeAlta(EMPRESA, invitacion("REVOCADA", VENCE), en(30)).estadoDeLaInvitacion).toBe(
      "REVOCADA",
    );
  });

  it("coincide con estadoDeInvitacion para todos los estados y momentos", () => {
    for (const estado of ["PENDIENTE", "ACEPTADA", "REVOCADA"] as const) {
      for (const horas of [0, 12, 23.9, 24, 24.1, 100]) {
        const i = invitacion(estado, VENCE);
        const real = estadoDeInvitacion(i, en(horas));
        const esperado = real === "PENDIENTE" ? "VIGENTE" : real;
        expect(vistaDeAlta(EMPRESA, i, en(horas)).estadoDeLaInvitacion, `${estado} ${horas}`).toBe(
          esperado,
        );
      }
    }
  });
});

describe("vistaDeAlta: el plazo del alta", () => {
  it("copia los datos de la empresa", () => {
    const v = vistaDeAlta(EMPRESA, null, en(1));
    expect(v.empresaId).toBe(EMPRESA.id);
    expect(v.tenantId).toBe(EMPRESA.tenantId);
    expect(v.razonSocial).toBe("Acme S.A.");
    expect(v.creadaEn).toBe(CREADA);
  });

  it("cuenta 72 h desde que se creó la empresa, no desde la invitación", () => {
    const tarde = { ...invitacion("PENDIENTE", en(90)), emitidaEn: en(66) };
    const v = vistaDeAlta(EMPRESA, tarde, en(10));
    expect(v.msRestantes).toBe(62 * HORA);
    expect(v.msRestantes).toBe(msRestantesDeAlta(CREADA, en(10)));
    expect(v.horasRestantes).toBe(62);
    expect(v.vencida).toBe(false);
  });

  it("las horas se redondean hacia arriba: 0 solo si el alta ya venció", () => {
    expect(vistaDeAlta(EMPRESA, null, en(0)).horasRestantes).toBe(72);
    expect(vistaDeAlta(EMPRESA, null, new Date(CREADA.getTime() + 1)).horasRestantes).toBe(72);
    expect(vistaDeAlta(EMPRESA, null, en(70.5)).horasRestantes).toBe(2);
    expect(vistaDeAlta(EMPRESA, null, en(71)).horasRestantes).toBe(1);
    expect(
      vistaDeAlta(EMPRESA, null, new Date(CREADA.getTime() + PLAZO_DE_ALTA_EN_MS - 1))
        .horasRestantes,
    ).toBe(1);
  });

  it("vence en el instante exacto de las 72 h, igual que el barrido", () => {
    const justo = new Date(CREADA.getTime() + PLAZO_DE_ALTA_EN_MS);
    const antes = new Date(justo.getTime() - 1);
    expect(vistaDeAlta(EMPRESA, null, antes)).toMatchObject({ vencida: false, msRestantes: 1 });
    expect(vistaDeAlta(EMPRESA, null, justo)).toMatchObject({
      vencida: true,
      msRestantes: 0,
      horasRestantes: 0,
    });
    expect(vistaDeAlta(EMPRESA, null, en(200))).toMatchObject({
      vencida: true,
      msRestantes: 0,
      horasRestantes: 0,
    });
    expect(altaVencida(CREADA, justo)).toBe(true);
  });
});
