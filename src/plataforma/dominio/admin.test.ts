import { describe, expect, it } from "vitest";
import type { RolDePlataforma } from "../../capacidades/permisos/plataforma";
import type { Email } from "../../modulos/identidad/publico";
import {
  LIMITE_ABSOLUTO_DE_SESION_EN_MS,
  LIMITE_DE_INACTIVIDAD_EN_MS,
  TOLERANCIA_DE_RELOJ_EN_MS,
  decidirAltaDeAdmin,
  decidirBajaDeAdmin,
  decidirReseteoDeSegundoFactor,
  rolVigenteDeAdmin,
  sesionVigente,
} from "./admin";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const T0 = new Date("2026-10-12T09:00:00.000Z");
const mas = (fecha: Date, ms: number) => new Date(fecha.getTime() + ms);

describe("las constantes de la sesión de plataforma", () => {
  it("son 8 horas absolutas, 30 minutos de inactividad y un minuto de tolerancia de reloj", () => {
    expect(LIMITE_ABSOLUTO_DE_SESION_EN_MS).toBe(28_800_000);
    expect(LIMITE_DE_INACTIVIDAD_EN_MS).toBe(1_800_000);
    expect(TOLERANCIA_DE_RELOJ_EN_MS).toBe(60_000);
  });
});

describe("sesionVigente", () => {
  it("una sesión recién usada y recién iniciada vale", () => {
    expect(sesionVigente(T0, T0, T0)).toBe(true);
  });

  it("vale mientras no pasaron 30 minutos desde el último uso: el último milisegundo vale, el límite exacto no", () => {
    const ahora = mas(T0, 2 * HORA);
    const ultimoUso = (transcurrido: number) => mas(ahora, -transcurrido);
    expect(sesionVigente(T0, ultimoUso(0), ahora)).toBe(true);
    expect(sesionVigente(T0, ultimoUso(30 * MINUTO - 1), ahora)).toBe(true);
    expect(sesionVigente(T0, ultimoUso(30 * MINUTO), ahora)).toBe(false);
    expect(sesionVigente(T0, ultimoUso(30 * MINUTO + 1), ahora)).toBe(false);
    expect(sesionVigente(T0, ultimoUso(5 * HORA), ahora)).toBe(false);
  });

  it("vale mientras no pasaron 8 horas desde el inicio, aunque se la use sin parar: el límite exacto ya venció", () => {
    const ahoraDesde = (transcurrido: number) => mas(T0, transcurrido);
    // Usada hace un instante: solo importa el límite absoluto.
    const conUsoReciente = (ahora: Date) => sesionVigente(T0, mas(ahora, -1), ahora);
    expect(conUsoReciente(ahoraDesde(8 * HORA - 2))).toBe(true);
    expect(conUsoReciente(ahoraDesde(8 * HORA - 1))).toBe(true);
    expect(sesionVigente(T0, ahoraDesde(8 * HORA), ahoraDesde(8 * HORA))).toBe(false);
    expect(conUsoReciente(ahoraDesde(8 * HORA + 1))).toBe(false);
    expect(conUsoReciente(ahoraDesde(24 * HORA))).toBe(false);
  });

  it("las dos condiciones se exigen a la vez: vencida por cualquiera de las dos no vale", () => {
    const ahora = mas(T0, 3 * HORA);
    // Absoluta vigente, inactiva.
    expect(sesionVigente(T0, mas(ahora, -31 * MINUTO), ahora)).toBe(false);
    // Activa, pero absoluta vencida.
    expect(sesionVigente(mas(ahora, -9 * HORA), mas(ahora, -MINUTO), ahora)).toBe(false);
    // Las dos vigentes.
    expect(sesionVigente(mas(ahora, -3 * HORA), mas(ahora, -MINUTO), ahora)).toBe(true);
  });

  it("tolera un reloj apenas adelantado, pero no uno muy adelantado", () => {
    const ahora = T0;
    const tolerancia = TOLERANCIA_DE_RELOJ_EN_MS;
    // Inicio y último uso "en el futuro" por una diferencia de reloj chica.
    expect(sesionVigente(mas(ahora, tolerancia), ahora, ahora)).toBe(true);
    expect(sesionVigente(ahora, mas(ahora, tolerancia), ahora)).toBe(true);
    // Más que la tolerancia: dato inconsistente, no vale.
    expect(sesionVigente(mas(ahora, tolerancia + 1), ahora, ahora)).toBe(false);
    expect(sesionVigente(ahora, mas(ahora, tolerancia + 1), ahora)).toBe(false);
    expect(sesionVigente(mas(ahora, 365 * 24 * HORA), mas(ahora, 365 * 24 * HORA), ahora)).toBe(
      false,
    );
  });

  it("falla cerrado ante una fecha inválida", () => {
    const invalida = new Date("no es una fecha");
    expect(sesionVigente(invalida, T0, T0)).toBe(false);
    expect(sesionVigente(T0, invalida, T0)).toBe(false);
    expect(sesionVigente(T0, T0, invalida)).toBe(false);
  });

  it("no modifica las fechas recibidas", () => {
    const inicio = new Date(T0);
    const uso = new Date(T0);
    const ahora = mas(T0, 10 * MINUTO);
    sesionVigente(inicio, uso, ahora);
    expect([inicio.getTime(), uso.getTime(), ahora.getTime()]).toEqual([
      T0.getTime(),
      T0.getTime(),
      T0.getTime() + 10 * MINUTO,
    ]);
  });
});

describe("rolVigenteDeAdmin", () => {
  it("un administrador activo decide con su rol, sea ADMIN o SOPORTE", () => {
    for (const rol of ["ADMIN", "SOPORTE"] as const satisfies readonly RolDePlataforma[]) {
      expect(rolVigenteDeAdmin({ rol, activo: true })).toBe(rol);
    }
  });

  it("uno dado de baja, o que no existe, no tiene rol (el guard responde SIN_PERMISO)", () => {
    expect(rolVigenteDeAdmin({ rol: "ADMIN", activo: false })).toBeNull();
    expect(rolVigenteDeAdmin({ rol: "SOPORTE", activo: false })).toBeNull();
    expect(rolVigenteDeAdmin(null)).toBeNull();
  });
});

describe("decidirAltaDeAdmin: un administrador de plataforma no puede tener ninguna membresía (F5)", () => {
  const limpio = { tieneMembresia: false, tieneInvitacionPendiente: false };

  it("sin membresías ni invitaciones, nace con el email normalizado y el rol pedido", () => {
    expect(decidirAltaDeAdmin("  Dueno@Pedernal.com ", "ADMIN", limpio)).toEqual({
      ok: true,
      valor: { email: "dueno@pedernal.com" as Email, rol: "ADMIN" },
    });
    expect(decidirAltaDeAdmin("soporte@pedernal.com", "SOPORTE", limpio)).toEqual({
      ok: true,
      valor: { email: "soporte@pedernal.com" as Email, rol: "SOPORTE" },
    });
  });

  it("un email inválido se rechaza", () => {
    for (const email of ["", "sin-arroba", "@x.com", "ana@", "a b@x.com"]) {
      expect(decidirAltaDeAdmin(email, "ADMIN", limpio), email).toEqual({
        ok: false,
        error: "EMAIL_INVALIDO",
      });
    }
  });

  it("con cualquier membresía, activa o apagada, de cualquier rol: ADMIN_CON_MEMBRESIA", () => {
    expect(decidirAltaDeAdmin("ana@x.com", "ADMIN", { ...limpio, tieneMembresia: true })).toEqual({
      ok: false,
      error: "ADMIN_CON_MEMBRESIA",
    });
  });

  it("con una invitación pendiente, que se la daría al aceptarla: ADMIN_CON_INVITACION_PENDIENTE", () => {
    expect(
      decidirAltaDeAdmin("ana@x.com", "SOPORTE", { ...limpio, tieneInvitacionPendiente: true }),
    ).toEqual({ ok: false, error: "ADMIN_CON_INVITACION_PENDIENTE" });
  });

  it("precedencia: email inválido, después la membresía, después la invitación", () => {
    const todo = { tieneMembresia: true, tieneInvitacionPendiente: true };
    expect(decidirAltaDeAdmin("ana", "ADMIN", todo)).toEqual({
      ok: false,
      error: "EMAIL_INVALIDO",
    });
    expect(decidirAltaDeAdmin("ana@x.com", "ADMIN", todo)).toEqual({
      ok: false,
      error: "ADMIN_CON_MEMBRESIA",
    });
  });
});

describe("decidirBajaDeAdmin (h5-p8 §2.5)", () => {
  const ADMIN_ACTIVO = { activo: true, rol: "ADMIN" } as const;
  const SOPORTE_ACTIVO = { activo: true, rol: "SOPORTE" } as const;
  const DE_BAJA = (rol: "ADMIN" | "SOPORTE") => ({ activo: false, rol }) as const;

  it("un ADMIN activo se da de baja si queda al menos otro ADMIN activo", () => {
    for (const otros of [1, 2, 10]) {
      expect(decidirBajaDeAdmin(ADMIN_ACTIVO, { otrosAdminsActivos: otros })).toEqual({
        ok: true,
        valor: { darDeBaja: true },
      });
    }
  });

  it("el ÚLTIMO ADMIN activo no se da de baja: ES_EL_ULTIMO_ADMIN", () => {
    expect(decidirBajaDeAdmin(ADMIN_ACTIVO, { otrosAdminsActivos: 0 })).toEqual({
      ok: false,
      error: "ES_EL_ULTIMO_ADMIN",
    });
  });

  it("un SOPORTE activo se da de baja siempre, aunque no haya ningún ADMIN", () => {
    for (const otros of [0, 1, 5]) {
      expect(decidirBajaDeAdmin(SOPORTE_ACTIVO, { otrosAdminsActivos: otros })).toEqual({
        ok: true,
        valor: { darDeBaja: true },
      });
    }
  });

  it("uno que ya está de baja NO es un error (idempotente), aunque no quede ningún ADMIN activo", () => {
    for (const rol of ["ADMIN", "SOPORTE"] as const) {
      for (const otros of [0, 1]) {
        expect(decidirBajaDeAdmin(DE_BAJA(rol), { otrosAdminsActivos: otros })).toEqual({
          ok: true,
          valor: { darDeBaja: false },
        });
      }
    }
  });

  it("un email que no es de ningún administrador es un error: no se inventa una baja", () => {
    for (const otros of [0, 1]) {
      expect(decidirBajaDeAdmin(null, { otrosAdminsActivos: otros })).toEqual({
        ok: false,
        error: "ADMIN_NO_ENCONTRADO",
      });
    }
  });
});

describe("decidirReseteoDeSegundoFactor (h5-p8 §2.4)", () => {
  it("un administrador activo puede resetear su segundo factor", () => {
    expect(decidirReseteoDeSegundoFactor({ activo: true })).toEqual({ ok: true, valor: null });
  });

  it("uno dado de baja o inexistente se rechaza, cada uno con su motivo", () => {
    expect(decidirReseteoDeSegundoFactor({ activo: false })).toEqual({
      ok: false,
      error: "ADMIN_DADO_DE_BAJA",
    });
    expect(decidirReseteoDeSegundoFactor(null)).toEqual({
      ok: false,
      error: "ADMIN_NO_ENCONTRADO",
    });
  });
});
