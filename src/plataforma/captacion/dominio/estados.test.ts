import { describe, expect, it } from "vitest";
import {
  ESTADOS_DE_SOLICITUD,
  TRANSICIONES_DE_SOLICITUD,
  esTerminal,
  estaAbierta,
  transicionPermitida,
  type ActorDeSolicitud,
  type EstadoDeSolicitud,
} from "./estados";

const ACTORES: readonly ActorDeSolicitud[] = ["CAPTACION", "ADMIN", "SISTEMA"];

/** La tabla de §2.2 escrita aparte, como «desde > hasta : quién», para no repetir la del código. */
const ESPERADAS: readonly string[] = [
  "NUEVA>VERIFICADA:CAPTACION",
  "NUEVA>RECHAZADA:ADMIN",
  "NUEVA>RECHAZADA:SISTEMA",
  "NUEVA>SPAM:ADMIN",
  "VERIFICADA>APROBADA:ADMIN",
  "VERIFICADA>RECHAZADA:ADMIN",
  "VERIFICADA>SPAM:ADMIN",
  "APROBADA>ALTA_CREADA:ADMIN",
  "APROBADA>RECHAZADA:ADMIN",
];

describe("estados de la solicitud", () => {
  it("son seis, en este orden", () => {
    expect(ESTADOS_DE_SOLICITUD).toEqual([
      "NUEVA",
      "VERIFICADA",
      "APROBADA",
      "ALTA_CREADA",
      "RECHAZADA",
      "SPAM",
    ]);
  });

  it("las transiciones son exactamente las de §2.2 (sin mirar quién)", () => {
    expect(TRANSICIONES_DE_SOLICITUD).toEqual({
      NUEVA: ["VERIFICADA", "RECHAZADA", "SPAM"],
      VERIFICADA: ["APROBADA", "RECHAZADA", "SPAM"],
      APROBADA: ["ALTA_CREADA", "RECHAZADA"],
      ALTA_CREADA: [],
      RECHAZADA: [],
      SPAM: [],
    });
  });

  it("transicionPermitida: de los 108 triples (desde, hasta, quién) solo valen los de §2.2", () => {
    const permitidos: string[] = [];
    for (const desde of ESTADOS_DE_SOLICITUD) {
      for (const hasta of ESTADOS_DE_SOLICITUD) {
        for (const actor of ACTORES) {
          if (transicionPermitida(desde, hasta, actor))
            permitidos.push(`${desde}>${hasta}:${actor}`);
        }
      }
    }
    expect(permitidos.sort()).toEqual([...ESPERADAS].sort());
  });

  it("soporte no figura: nadie más que el administrador decide (el interesado solo verifica, el sistema solo vence)", () => {
    const porActor = (actor: ActorDeSolicitud) =>
      ESPERADAS.filter((e) => e.endsWith(`:${actor}`)).length;
    expect(porActor("CAPTACION")).toBe(1);
    expect(porActor("SISTEMA")).toBe(1);
    expect(porActor("ADMIN")).toBe(7);
  });

  it.each<[EstadoDeSolicitud, boolean]>([
    ["NUEVA", false],
    ["VERIFICADA", false],
    ["APROBADA", false],
    ["ALTA_CREADA", true],
    ["RECHAZADA", true],
    ["SPAM", true],
  ])("%s: terminal = %s, y abierta es lo contrario", (estado, terminal) => {
    expect(esTerminal(estado)).toBe(terminal);
    expect(estaAbierta(estado)).toBe(!terminal);
  });

  it("desde un estado terminal no se sale a ninguno, para nadie", () => {
    for (const desde of ESTADOS_DE_SOLICITUD.filter(esTerminal)) {
      for (const hasta of ESTADOS_DE_SOLICITUD) {
        for (const actor of ACTORES) expect(transicionPermitida(desde, hasta, actor)).toBe(false);
      }
    }
  });

  it("ningún estado terminal figura como origen de una transición (la tabla de destinos no puede dejarlos con salida)", () => {
    for (const desde of ESTADOS_DE_SOLICITUD.filter(esTerminal)) {
      expect(TRANSICIONES_DE_SOLICITUD[desde], desde).toEqual([]);
      for (const hasta of ESTADOS_DE_SOLICITUD) {
        expect(transicionPermitida(desde, hasta, "ADMIN"), `${desde} > ${hasta}`).toBe(false);
      }
    }
  });

  it("los estados abiertos son los del índice único parcial: NUEVA, VERIFICADA y APROBADA", () => {
    expect(ESTADOS_DE_SOLICITUD.filter(estaAbierta)).toEqual(["NUEVA", "VERIFICADA", "APROBADA"]);
  });
});
