import { describe, expect, it } from "vitest";
import type { EstadoDeEmpresa } from "../../contexto/estados";
import type { Empresa } from "../../modulos/empresas/publico";
import type { Email } from "../../modulos/identidad/publico";
import type { Cuit } from "../../primitivas/identificacion-fiscal/cuit";
import { empresaId, tenantId } from "../../primitivas/identificadores/marca";
import {
  MOTIVO_DE_ALTA_VENCIDA,
  PLAZO_DE_ALTA_EN_MS,
  altaVencida,
  comprobarAlta,
  decidirCancelacionDeAlta,
  msRestantesDeAlta,
  validarAlta,
  type AltaValidada,
  type EntradaDeAlta,
  type HechosDeAlta,
} from "./alta";

const HORA = 3_600_000;
const T0 = new Date("2026-10-09T12:00:00.000Z");
const mas = (fecha: Date, ms: number) => new Date(fecha.getTime() + ms);
const error = <E>(e: E) => ({ ok: false, error: e });

describe("el plazo del alta (decisión 5)", () => {
  it("son 72 horas, en un solo lugar, y el motivo del barrido es ALTA_VENCIDA", () => {
    expect(PLAZO_DE_ALTA_EN_MS).toBe(72 * HORA);
    expect(PLAZO_DE_ALTA_EN_MS).toBe(259_200_000);
    expect(MOTIVO_DE_ALTA_VENCIDA).toBe("ALTA_VENCIDA");
  });

  it("altaVencida: hasta el último milisegundo de las 72 horas vale; en el instante exacto vence", () => {
    expect(altaVencida(T0, T0)).toBe(false);
    expect(altaVencida(T0, mas(T0, 24 * HORA))).toBe(false);
    expect(altaVencida(T0, mas(T0, 71 * HORA))).toBe(false);
    expect(altaVencida(T0, mas(T0, 72 * HORA - 1))).toBe(false);
    expect(altaVencida(T0, mas(T0, 72 * HORA))).toBe(true);
    expect(altaVencida(T0, mas(T0, 72 * HORA + 1))).toBe(true);
    expect(altaVencida(T0, mas(T0, 30 * 24 * HORA))).toBe(true);
  });

  it("altaVencida cuenta desde que se creó la empresa, no desde ningún otro momento: 24 h no alcanzan, 73 sí", () => {
    // Un alta reenviada a las 60 horas sigue venciendo a las 72 desde la creación.
    expect(altaVencida(T0, mas(T0, 73 * HORA))).toBe(true);
    expect(altaVencida(mas(T0, 60 * HORA), mas(T0, 73 * HORA))).toBe(false);
  });

  it("altaVencida con una fecha de creación posterior a ahora no está vencida", () => {
    expect(altaVencida(mas(T0, HORA), T0)).toBe(false);
  });

  it("msRestantesDeAlta: lo que falta para las 72 horas, y 0 (nunca negativo) cuando venció", () => {
    expect(msRestantesDeAlta(T0, T0)).toBe(72 * HORA);
    expect(msRestantesDeAlta(T0, mas(T0, 70 * HORA))).toBe(2 * HORA);
    expect(msRestantesDeAlta(T0, mas(T0, 72 * HORA - 1))).toBe(1);
    expect(msRestantesDeAlta(T0, mas(T0, 72 * HORA))).toBe(0);
    expect(msRestantesDeAlta(T0, mas(T0, 100 * HORA))).toBe(0);
  });

  it("msRestantesDeAlta y altaVencida dicen lo mismo en cada instante", () => {
    for (const desfase of [-HORA, 0, 1, 71 * HORA, 72 * HORA - 1, 72 * HORA, 72 * HORA + 1]) {
      const ahora = mas(T0, desfase);
      expect(altaVencida(T0, ahora), String(desfase)).toBe(msRestantesDeAlta(T0, ahora) === 0);
    }
  });
});

describe("validarAlta", () => {
  const entrada = (cambios: Partial<EntradaDeAlta> = {}): EntradaDeAlta => ({
    nombreDeTenant: "  Panadería López  ",
    cuit: "30-70308853-4",
    razonSocial: "  López Hnos. S.R.L.  ",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ARS",
    emailGerente: "  Gerente@Lopez.COM ",
    ...cambios,
  });

  it("con un tenant nuevo: normaliza el nombre, el CUIT, la razón social y el email", () => {
    expect(validarAlta(entrada())).toEqual({
      ok: true,
      valor: {
        tenant: { tipo: "NUEVO", nombre: "Panadería López" },
        cuit: "30703088534" as Cuit,
        razonSocial: "López Hnos. S.R.L.",
        zonaHoraria: "America/Argentina/Buenos_Aires",
        moneda: "ARS",
        emailGerente: "gerente@lopez.com" as Email,
      },
    });
  });

  it("con un tenant existente: lleva su identificador", () => {
    const resultado = validarAlta(entrada({ nombreDeTenant: undefined, tenantId: "t-1" }));
    expect(resultado.ok && resultado.valor.tenant).toEqual({
      tipo: "EXISTENTE",
      tenantId: tenantId("t-1"),
    });
  });

  it("la zona horaria pasa tal cual: la valida la base (A.4 #6)", () => {
    const resultado = validarAlta(entrada({ zonaHoraria: " Marte/Olympus " }));
    expect(resultado.ok && resultado.valor.zonaHoraria).toBe(" Marte/Olympus ");
  });

  it("tenant: ninguno es TENANT_INDEFINIDO; los dos, TENANT_AMBIGUO (aunque alguno venga vacío)", () => {
    expect(validarAlta(entrada({ nombreDeTenant: undefined }))).toEqual(error("TENANT_INDEFINIDO"));
    expect(validarAlta(entrada({ tenantId: "t-1" }))).toEqual(error("TENANT_AMBIGUO"));
    expect(validarAlta(entrada({ tenantId: "" }))).toEqual(error("TENANT_AMBIGUO"));
    expect(validarAlta(entrada({ nombreDeTenant: "", tenantId: "t-1" }))).toEqual(
      error("TENANT_AMBIGUO"),
    );
  });

  it("un identificador de tenant vacío o con espacios en los extremos es TENANT_ID_INVALIDO", () => {
    for (const id of ["", " t-1", "t-1 ", "   "]) {
      expect(validarAlta(entrada({ nombreDeTenant: undefined, tenantId: id })), id).toEqual(
        error("TENANT_ID_INVALIDO"),
      );
    }
  });

  it("un nombre de tenant en blanco es NOMBRE_INVALIDO", () => {
    for (const nombre of ["", "   ", "\n\t"]) {
      expect(validarAlta(entrada({ nombreDeTenant: nombre })), nombre).toEqual(
        error("NOMBRE_INVALIDO"),
      );
    }
  });

  it("CUIT: formato y dígito verificador, los dos errores de la primitiva", () => {
    expect(validarAlta(entrada({ cuit: "123" }))).toEqual(error("CUIT_FORMATO_INVALIDO"));
    expect(validarAlta(entrada({ cuit: "" }))).toEqual(error("CUIT_FORMATO_INVALIDO"));
    expect(validarAlta(entrada({ cuit: "30-70308853-5" }))).toEqual(
      error("CUIT_DIGITO_VERIFICADOR_INVALIDO"),
    );
    // La forma canónica, sin guiones, también vale.
    expect(validarAlta(entrada({ cuit: "30703088534" })).ok).toBe(true);
  });

  it("razón social en blanco: RAZON_SOCIAL_INVALIDA", () => {
    for (const razon of ["", "  ", "\t"]) {
      expect(validarAlta(entrada({ razonSocial: razon })), razon).toEqual(
        error("RAZON_SOCIAL_INVALIDA"),
      );
    }
  });

  it("moneda: solo ARS; cualquier otra se convierte en MONEDA_NO_SOPORTADA (la primitiva lanza)", () => {
    for (const moneda of ["USD", "ars", "", "ARS ", "constructor"]) {
      expect(validarAlta(entrada({ moneda })), moneda).toEqual(error("MONEDA_NO_SOPORTADA"));
    }
  });

  it("una moneda que ni siquiera es texto es un defecto del llamador: la falla se propaga", () => {
    expect(() => validarAlta(entrada({ moneda: undefined as unknown as string }))).toThrow(
      TypeError,
    );
  });

  it("email del gerente inválido: EMAIL_INVALIDO", () => {
    for (const email of ["", "sin-arroba", "@x.com", "ana@", "a b@x.com"]) {
      expect(validarAlta(entrada({ emailGerente: email })), email).toEqual(error("EMAIL_INVALIDO"));
    }
  });

  it("precedencia: tenant, CUIT, razón social, moneda y email", () => {
    const todoMal = entrada({
      nombreDeTenant: " ",
      cuit: "x",
      razonSocial: " ",
      moneda: "USD",
      emailGerente: "x",
    });
    expect(validarAlta(todoMal)).toEqual(error("NOMBRE_INVALIDO"));
    expect(validarAlta({ ...todoMal, nombreDeTenant: "Ok" })).toEqual(
      error("CUIT_FORMATO_INVALIDO"),
    );
    expect(validarAlta({ ...todoMal, nombreDeTenant: "Ok", cuit: "30703088534" })).toEqual(
      error("RAZON_SOCIAL_INVALIDA"),
    );
    expect(
      validarAlta({ ...todoMal, nombreDeTenant: "Ok", cuit: "30703088534", razonSocial: "SA" }),
    ).toEqual(error("MONEDA_NO_SOPORTADA"));
    expect(
      validarAlta({
        ...todoMal,
        nombreDeTenant: "Ok",
        cuit: "30703088534",
        razonSocial: "SA",
        moneda: "ARS",
      }),
    ).toEqual(error("EMAIL_INVALIDO"));
  });

  it("no modifica la entrada", () => {
    const e = entrada();
    const antes = JSON.stringify(e);
    validarAlta(e);
    expect(JSON.stringify(e)).toBe(antes);
  });
});

describe("comprobarAlta", () => {
  const base = (cambios: Partial<AltaValidada> = {}): AltaValidada => ({
    tenant: { tipo: "NUEVO", nombre: "ACME" },
    cuit: "30703088534" as Cuit,
    razonSocial: "ACME SA",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ARS",
    emailGerente: "g@acme.com" as Email,
    ...cambios,
  });
  const existente = base({ tenant: { tipo: "EXISTENTE", tenantId: tenantId("t-1") } });
  const hechos = (cambios: Partial<HechosDeAlta> = {}): HechosDeAlta => ({
    emailEsDeAdminDePlataforma: false,
    tenant: { estado: "ACTIVE" },
    ...cambios,
  });
  const OK = { ok: true, valor: null };

  it("con un tenant nuevo no mira el tenant: se crea", () => {
    expect(comprobarAlta(base(), hechos({ tenant: null }))).toEqual(OK);
    expect(comprobarAlta(base(), hechos({ tenant: { estado: "SUSPENDED" } }))).toEqual(OK);
  });

  it("con un tenant existente y activo: ok", () => {
    expect(comprobarAlta(existente, hechos())).toEqual(OK);
  });

  it("un tenant existente que no se encuentra: TENANT_NO_ENCONTRADO", () => {
    expect(comprobarAlta(existente, hechos({ tenant: null }))).toEqual(
      error("TENANT_NO_ENCONTRADO"),
    );
  });

  it("un tenant suspendido no recibe altas: TENANT_NO_ACTIVO", () => {
    expect(comprobarAlta(existente, hechos({ tenant: { estado: "SUSPENDED" } }))).toEqual(
      error("TENANT_NO_ACTIVO"),
    );
  });

  it("el email de un administrador de plataforma no puede ser gerente, con tenant nuevo o existente", () => {
    expect(comprobarAlta(base(), hechos({ emailEsDeAdminDePlataforma: true }))).toEqual(
      error("EMAIL_DE_ADMIN_PLATAFORMA"),
    );
    expect(comprobarAlta(existente, hechos({ emailEsDeAdminDePlataforma: true }))).toEqual(
      error("EMAIL_DE_ADMIN_PLATAFORMA"),
    );
  });

  it("precedencia: el email de admin gana sobre los errores del tenant", () => {
    expect(
      comprobarAlta(existente, hechos({ emailEsDeAdminDePlataforma: true, tenant: null })),
    ).toEqual(error("EMAIL_DE_ADMIN_PLATAFORMA"));
    expect(
      comprobarAlta(
        existente,
        hechos({ emailEsDeAdminDePlataforma: true, tenant: { estado: "SUSPENDED" } }),
      ),
    ).toEqual(error("EMAIL_DE_ADMIN_PLATAFORMA"));
  });
});

describe("decidirCancelacionDeAlta", () => {
  const empresa = (estado: EstadoDeEmpresa): Empresa => ({
    id: empresaId("e-1"),
    tenantId: tenantId("t-1"),
    cuit: "30703088534" as Cuit,
    razonSocial: "ACME SA",
    estado,
    motivoEstado: null,
    zonaHoraria: "America/Argentina/Buenos_Aires",
    version: 1,
  });

  it("una empresa en alta pasa a CANCELLED con el motivo recortado", () => {
    expect(decidirCancelacionDeAlta(empresa("PROVISIONING"), "  se arrepintió ")).toEqual({
      ok: true,
      valor: { estado: "CANCELLED", motivoEstado: "se arrepintió" },
    });
    expect(decidirCancelacionDeAlta(empresa("PROVISIONING"), MOTIVO_DE_ALTA_VENCIDA)).toEqual({
      ok: true,
      valor: { estado: "CANCELLED", motivoEstado: "ALTA_VENCIDA" },
    });
  });

  it("sin motivo: MOTIVO_OBLIGATORIO", () => {
    for (const motivo of ["", "   ", "\n"]) {
      expect(decidirCancelacionDeAlta(empresa("PROVISIONING"), motivo), motivo).toEqual(
        error("MOTIVO_OBLIGATORIO"),
      );
    }
  });

  it("una empresa que ya no está en alta: ALTA_NO_PENDIENTE, en cualquiera de los otros cuatro estados", () => {
    const otros: EstadoDeEmpresa[] = ["ACTIVE", "SUSPENDED", "CANCELLED", "DELETING"];
    for (const estado of otros) {
      expect(decidirCancelacionDeAlta(empresa(estado), "motivo"), estado).toEqual(
        error("ALTA_NO_PENDIENTE"),
      );
    }
  });

  it("precedencia: ALTA_NO_PENDIENTE gana sobre el motivo vacío", () => {
    expect(decidirCancelacionDeAlta(empresa("ACTIVE"), "")).toEqual(error("ALTA_NO_PENDIENTE"));
    expect(decidirCancelacionDeAlta(empresa("CANCELLED"), " ")).toEqual(error("ALTA_NO_PENDIENTE"));
  });
});
