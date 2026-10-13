import { describe, expect, it } from "vitest";
import { TIEMPO_MINIMO_DE_LLENADO_EN_MS, VIGENCIA_DEL_FORMULARIO_EN_MS, pistaDeBot } from "./bot";

const AHORA = new Date("2026-10-13T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

describe("pistaDeBot", () => {
  it("el tiempo mínimo son 2 segundos y la página vale 24 horas", () => {
    expect(TIEMPO_MINIMO_DE_LLENADO_EN_MS).toBe(2000);
    expect(VIGENCIA_DEL_FORMULARIO_EN_MS).toBe(86_400_000);
  });

  it("un campo invisible vacío y un llenado normal es una persona", () => {
    expect(pistaDeBot("", hace(30_000), AHORA)).toBe("HUMANO");
    expect(pistaDeBot("", hace(3_600_000), AHORA)).toBe("HUMANO");
  });

  it("cualquier cosa en el campo invisible es un bot, hasta un solo espacio", () => {
    for (const valor of ["x", " ", "http://spam.example", "\n", "0"]) {
      expect(pistaDeBot(valor, hace(30_000), AHORA), JSON.stringify(valor)).toBe("BOT_HONEYPOT");
    }
  });

  it("menos de 2 segundos es un bot; con 2 segundos justos todavía vale", () => {
    expect(pistaDeBot("", hace(0), AHORA)).toBe("BOT_TIEMPO_MINIMO");
    expect(pistaDeBot("", hace(1), AHORA)).toBe("BOT_TIEMPO_MINIMO");
    expect(pistaDeBot("", hace(1999), AHORA)).toBe("BOT_TIEMPO_MINIMO");
    expect(pistaDeBot("", hace(2000), AHORA)).toBe("HUMANO");
    expect(pistaDeBot("", hace(2001), AHORA)).toBe("HUMANO");
  });

  it("un emitido del futuro no se puede haber llenado: es un bot", () => {
    expect(pistaDeBot("", hace(-1), AHORA)).toBe("BOT_TIEMPO_MINIMO");
    expect(pistaDeBot("", hace(-3_600_000), AHORA)).toBe("BOT_TIEMPO_MINIMO");
  });

  it("pasadas 24 horas es una página vencida; con 24 horas justas todavía vale", () => {
    expect(pistaDeBot("", hace(86_400_000 - 1), AHORA)).toBe("HUMANO");
    expect(pistaDeBot("", hace(86_400_000), AHORA)).toBe("HUMANO");
    expect(pistaDeBot("", hace(86_400_001), AHORA)).toBe("PAGINA_VENCIDA");
    expect(pistaDeBot("", hace(30 * 86_400_000), AHORA)).toBe("PAGINA_VENCIDA");
  });

  it("el campo invisible gana sobre el tiempo: un bot que lo llenó no se entera de que la página venció", () => {
    expect(pistaDeBot("x", hace(30 * 86_400_000), AHORA)).toBe("BOT_HONEYPOT");
    expect(pistaDeBot("x", hace(0), AHORA)).toBe("BOT_HONEYPOT");
  });
});
