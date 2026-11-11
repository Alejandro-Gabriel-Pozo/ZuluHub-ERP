import { describe, expect, it } from "vitest";
import { entrada, forma, SENSIBLES } from "./decisiones-apoyo";

/**
 * La FORMA del registro de decisiones (`arquitectura/decisiones/forma.cjs`). Previene: decisiones de permisos, dinero o lo que ve un cliente
 * anotadas de cualquier manera (sin quién, sin qué cambia, con un tipo inventado) y por eso imposibles de resumir para el dueño. La validación
 * declara lo PERMITIDO (conjunto, largo, forma): cada caso de abajo es una entrada que no está en esa lista y tiene que fallar.
 */
const problemas = (cambios: Record<string, unknown>) =>
  forma.problemasDeUnaEntrada({ ...entrada(), ...cambios });

describe("una entrada válida", () => {
  it("no tiene problemas, de ningún tipo ni estado de la lista", () => {
    for (const tipo of forma.TIPOS.filter((t) => t !== "SIN_DECISION")) {
      expect(problemas({ tipo })).toEqual([]);
    }
    for (const estado of forma.ESTADOS) expect(problemas({ estado })).toEqual([]);
    for (const quien of forma.QUIENES) expect(problemas({ quien })).toEqual([]);
  });

  it("acepta los signos de una frase de negocio y los acentos", () => {
    const texto = "«Cuotas» de 1 a 36: ¿se paga el 10,5 % (a/b)? ¡Sí! — `costos.ver` ★";
    expect(problemas({ decision: texto })).toEqual([]);
  });

  it("SIN_DECISION exige su motivo y con él está bien", () => {
    const sinDecision = {
      tipo: "SIN_DECISION",
      motivo: "Cambio técnico: no cambia lo que ve el negocio.",
    };
    expect(problemas(sinDecision)).toEqual([]);
    expect(problemas({ tipo: "SIN_DECISION" }).join(" ")).toContain("faltan motivo");
  });
});

describe("una entrada fuera de lo permitido falla", () => {
  it.each([
    ["id sin la forma", { id: "dec-1" }, "id tiene la forma"],
    ["id con cinco dígitos", { id: "DEC-00001" }, "id tiene la forma"],
    ["fecha con otra forma", { fecha: "11/11/2026" }, "fecha es un día real"],
    ["fecha que no existe", { fecha: "2026-02-30" }, "fecha es un día real"],
    ["quien inventado", { quien: "el vecino" }, "quien es uno de"],
    ["tipo inventado", { tipo: "OTRO" }, "tipo es uno de"],
    ["tipo en minúscula", { tipo: "dinero" }, "tipo es uno de"],
    ["estado inventado", { estado: "APROBADA" }, "estado es uno de"],
    ["decision vacía", { decision: "" }, "decision tiene que tener entre"],
    ["decision de dos letras", { decision: "ok" }, "decision tiene que tener entre"],
    ["decision de más de 200", { decision: "a".repeat(201) }, "decision tiene que tener entre"],
    [
      "que_cambia de más de 300",
      { que_cambia: "a".repeat(301) },
      "que_cambia tiene que tener entre",
    ],
    [
      "decision con espacio al final",
      { decision: "El operador no ve costos. " },
      "decision admite",
    ],
    ["decision con dos espacios", { decision: "El operador  no ve costos." }, "decision admite"],
    ["decision con salto de línea", { decision: "El operador\nno ve costos." }, "decision admite"],
    [
      "decision con un carácter invisible",
      { decision: "El operador no ve​ costos." },
      "decision admite",
    ],
    [
      "decision con etiqueta HTML",
      { decision: "El operador <b>no</b> ve costos." },
      "decision admite",
    ],
    [
      "decision descompuesta (NFD)",
      { decision: "Opción del operador sin costo." },
      "decision admite",
    ],
    ["decision que no es texto", { decision: 5 }, "decision tiene que ser un texto"],
    ["donde vacío", { donde: "" }, "donde tiene que tener entre"],
  ])("%s", (_nombre, cambios, esperado) => {
    expect(problemas(cambios).join(" | ")).toContain(esperado);
  });

  it("una clave de más falla (lista cerrada de claves)", () => {
    expect(problemas({ extra: "x" }).join(" ")).toContain("claves que no existen: extra");
  });

  it("un motivo en una entrada que no es SIN_DECISION falla", () => {
    expect(problemas({ motivo: "Un motivo que no corresponde acá." }).join(" ")).toContain(
      "claves que no existen: motivo",
    );
  });

  it("un motivo fuera de lo permitido falla en SIN_DECISION", () => {
    const mala = { tipo: "SIN_DECISION", motivo: "" };
    expect(problemas(mala).join(" ")).toContain("motivo tiene que tener entre");
  });

  it("una entrada que no es un objeto falla", () => {
    for (const rara of [null, "texto", 5, [], undefined]) {
      expect(forma.problemasDeUnaEntrada(rara)).toEqual(["la entrada tiene que ser un objeto."]);
    }
  });
});

describe("el registro completo", () => {
  it("una lista vacía está bien y lo que no es una lista falla", () => {
    expect(forma.problemasDelRegistro([])).toEqual([]);
    expect(forma.problemasDelRegistro({})).toEqual([
      { id: "registro", problema: "tiene que ser una lista." },
    ]);
  });

  it("un id repetido falla y dice cuál", () => {
    const repetido = forma.problemasDelRegistro([entrada(), entrada()]);
    expect(repetido).toEqual([{ id: "DEC-0001", problema: "el id está repetido." }]);
  });

  it("el problema de una entrada dice su id (o su posición si no tiene)", () => {
    const sale = forma.problemasDelRegistro([entrada({ id: "DEC-0002", tipo: "OTRO" }), 7]);
    expect(sale.map((p) => p.id)).toContain("DEC-0002");
    expect(sale.map((p) => p.id)).toContain("#2");
  });

  it("la fecha tiene que ser un día real", () => {
    expect(forma.esFechaReal("2026-11-11")).toBe(true);
    expect(forma.esFechaReal("2026-13-01")).toBe(false);
    expect(forma.esFechaReal(20261111)).toBe(false);
  });
});

describe("la lista de archivos sensibles", () => {
  it("la que usa el repo en estas pruebas está bien", () => {
    expect(forma.problemasDeLosSensibles(SENSIBLES)).toEqual([]);
  });

  it.each([
    ["no es un objeto", [], "tiene que ser"],
    ["sin la clave sensibles", { otra: [] }, "tiene que ser"],
    [
      "con una clave de más",
      { sensibles: [{ ruta: "a/", que: "algo importante" }], otra: 1 },
      "tiene que ser",
    ],
    ["vacía", { sensibles: [] }, "no puede quedar vacío"],
    ["una fila sin que", { sensibles: [{ ruta: "a/" }] }, "lleva exactamente ruta y que"],
    [
      "una ruta absoluta",
      { sensibles: [{ ruta: "/etc/", que: "algo importante" }] },
      "ruta es un archivo o una carpeta",
    ],
    [
      "una ruta con ..",
      { sensibles: [{ ruta: "../a", que: "algo importante" }] },
      "ruta es un archivo o una carpeta",
    ],
    [
      "una ruta con comodín",
      { sensibles: [{ ruta: "src/**", que: "algo importante" }] },
      "ruta es un archivo o una carpeta",
    ],
    [
      "una ruta repetida",
      {
        sensibles: [
          { ruta: "a/", que: "algo importante" },
          { ruta: "a/", que: "otra cosa importante" },
        ],
      },
      "está repetida",
    ],
    [
      "un que fuera de lo permitido",
      { sensibles: [{ ruta: "a/", que: "<b>x</b>" }] },
      "sensibles[0].que admite",
    ],
  ])("%s falla", (_nombre, valor, esperado) => {
    expect(forma.problemasDeLosSensibles(valor).join(" | ")).toContain(esperado);
  });
});
