import { describe, expect, it } from "vitest";
import {
  arbolConRegistro,
  type Cuota,
  CUOTA,
  control,
  type Entrada,
  entrada,
  forma,
} from "./decisiones-apoyo";

/**
 * La cuota de decisiones por PR (`arquitectura/decisiones/cuota.cjs` y `cuota.json`): 5 de negocio y 10 técnicas como límite.
 * Previene: sesiones que acumulan decisiones sin consultar al dueño (caso real: 94 pendientes el 11/11/2026). Cada caso inyectado abajo
 * rompe el control; si se lo debilita, esta prueba se pone roja.
 */
const evaluar = (
  registro: Entrada[],
  base: Entrada[],
  laCuota: unknown = CUOTA,
  laBase?: unknown,
) =>
  control.evaluar({
    pr: arbolConRegistro(registro, {}, undefined, laCuota),
    base: arbolConRegistro(base, {}, undefined, laBase ?? laCuota),
  });
const numero = (n: number) => `DEC-${String(1000 + n).padStart(4, "0")}`;
/** `cuantas` entradas nuevas (ids propios) del tipo pedido; las SIN_DECISION llevan su motivo. */
const nuevas = (cuantas: number, tipo: string, desde = 0, cambios: Partial<Entrada> = {}) =>
  Array.from({ length: cuantas }, (_, n) =>
    entrada({
      id: numero(desde + n),
      tipo,
      ...(tipo === "SIN_DECISION" ? { motivo: "Cambio interno sin efecto en el negocio." } : {}),
      ...cambios,
    }),
  );
const BASE = [entrada()];
const mensajes = (r: ReturnType<typeof evaluar>) => r.fallas.map((f) => f.motivo);

describe("el tope de negocio (DINERO, PERMISOS, COMERCIAL)", () => {
  it("5 entran y 6 fallan, con cuántas son, cuál es el tope y qué hacer", () => {
    expect(evaluar([...BASE, ...nuevas(5, "DINERO")], BASE).fallas).toEqual([]);
    const motivo = mensajes(evaluar([...BASE, ...nuevas(6, "DINERO")], BASE)).join("\n");
    expect(motivo).toContain("agrega 6 decisiones de negocio");
    expect(motivo).toContain("DEC-1000, DEC-1001, DEC-1002, DEC-1003, DEC-1004, DEC-1005");
    expect(motivo).toContain("el tope es 5 por PR");
    expect(motivo).toContain("arquitectura/decisiones/cuota.json");
    expect(motivo).toContain("vigente desde 2026-11-01");
    expect(motivo).toContain("preguntale al dueño antes de construir");
    expect(motivo).toContain("reusá una decisión que ya exista");
    expect(motivo).toContain("excepción");
  });

  it.each(["DINERO", "PERMISOS", "COMERCIAL"])("%s cuenta como negocio", (tipo) => {
    expect(mensajes(evaluar([...BASE, ...nuevas(6, tipo)], BASE))).toHaveLength(1);
  });

  it("los tres tipos de negocio se suman en un solo tope", () => {
    const mezcla = [
      ...nuevas(2, "DINERO", 0),
      ...nuevas(2, "PERMISOS", 2),
      ...nuevas(2, "COMERCIAL", 4),
    ];
    expect(mensajes(evaluar([...BASE, ...mezcla], BASE))).toHaveLength(1);
  });
});

describe("el tope técnico (CLIENTE, DATOS, SIN_DECISION, INFRAESTRUCTURA)", () => {
  it("10 entran y 11 fallan", () => {
    expect(evaluar([...BASE, ...nuevas(10, "DATOS")], BASE).fallas).toEqual([]);
    const motivo = mensajes(evaluar([...BASE, ...nuevas(11, "DATOS")], BASE)).join("\n");
    expect(motivo).toContain("agrega 11 decisiones técnicas");
    expect(motivo).toContain("el tope es 10 por PR");
    expect(motivo).toContain("DEC-1000, DEC-1001");
    expect(motivo).toContain("con id, fecha y fuente del mensaje del dueño");
  });

  it.each(["CLIENTE", "DATOS", "SIN_DECISION", "INFRAESTRUCTURA"])(
    "%s cuenta como técnica",
    (tipo) => {
      expect(mensajes(evaluar([...BASE, ...nuevas(11, tipo)], BASE))).toHaveLength(1);
    },
  );

  it("los dos topes son independientes: 5 de negocio y 10 técnicas juntas entran", () => {
    const juntas = [...nuevas(5, "PERMISOS", 0), ...nuevas(10, "CLIENTE", 5)];
    expect(evaluar([...BASE, ...juntas], BASE).fallas).toEqual([]);
  });

  it("si se pasan los dos, salen dos mensajes", () => {
    const juntas = [...nuevas(6, "PERMISOS", 0), ...nuevas(11, "CLIENTE", 6)];
    expect(mensajes(evaluar([...BASE, ...juntas], BASE))).toHaveLength(2);
  });
});

describe("qué cuenta", () => {
  it("las decisiones que ya están en la base no cuentan, aunque sean muchas", () => {
    const viejas = nuevas(20, "DINERO");
    expect(evaluar([...viejas, ...nuevas(5, "DINERO", 50)], viejas).fallas).toEqual([]);
  });

  it("solo cuentan las PENDIENTE_DE_OK: una confirmada o corregida nueva no", () => {
    const resueltas = [
      ...nuevas(4, "DINERO", 0, { estado: "CONFIRMADA" }),
      ...nuevas(4, "DINERO", 10, { estado: "CORREGIDA" }),
    ];
    expect(evaluar([...BASE, ...resueltas, ...nuevas(5, "DINERO", 20)], BASE).fallas).toEqual([]);
  });

  it("antes de la fecha de vigencia no cuenta; el mismo día de la vigencia sí", () => {
    const rige: Cuota = { ...CUOTA, vigente_desde: "2026-11-14" };
    const antes = nuevas(6, "DINERO", 0, { fecha: "2026-11-13" });
    expect(evaluar([...BASE, ...antes], BASE, rige).fallas).toEqual([]);
    const ese = nuevas(6, "DINERO", 0, { fecha: "2026-11-14" });
    expect(mensajes(evaluar([...BASE, ...ese], BASE, rige))).toHaveLength(1);
    const despues = nuevas(6, "DINERO", 0, { fecha: "2026-12-01" });
    expect(mensajes(evaluar([...BASE, ...despues], BASE, rige))).toHaveLength(1);
  });

  it("una excepción del dueño saca a esa decisión de la cuenta; sin ella no se pasa", () => {
    const seis = nuevas(6, "DINERO");
    expect(mensajes(evaluar([...BASE, ...seis], BASE))).toHaveLength(1);
    const conExcepcion: Cuota = {
      ...CUOTA,
      excepciones: [
        { id: "DEC-1005", fecha: "2026-11-12", fuente: "Mensaje del dueño 12/11/2026" },
      ],
    };
    expect(evaluar([...BASE, ...seis], BASE, conExcepcion).fallas).toEqual([]);
    const otra: Cuota = {
      ...CUOTA,
      excepciones: [
        { id: "DEC-1999", fecha: "2026-11-12", fuente: "Mensaje del dueño 12/11/2026" },
      ],
    };
    expect(mensajes(evaluar([...BASE, ...seis], BASE, otra))).toHaveLength(1);
  });

  it("cambiar el tipo de una decisión que ya estaba en la base no la saca ni la mete sin que se vea: cuenta con su tipo nuevo", () => {
    const enLaBase = nuevas(6, "SIN_DECISION");
    const recalificadas = nuevas(6, "PERMISOS");
    expect(mensajes(evaluar(recalificadas, enLaBase))).toHaveLength(1);
    expect(evaluar(enLaBase, enLaBase).fallas).toEqual([]);
  });

  it("una decisión de la base que solo cambia de estado no cuenta", () => {
    const enLaBase = nuevas(6, "DINERO");
    const resuelta = enLaBase.map((e) => ({ ...e, estado: "CONFIRMADA" }));
    expect(evaluar(resuelta, enLaBase).fallas).toEqual([]);
  });
});

describe("un PR no afloja su propia cuota", () => {
  const floja: Cuota = { ...CUOTA, negocio: 99, tecnicas: 99 };
  it("si la base ya trae la cuota, mandan los topes y la vigencia de la base", () => {
    const seis = [...BASE, ...nuevas(6, "DINERO")];
    expect(mensajes(evaluar(seis, BASE, floja, CUOTA))).toHaveLength(1);
    const lejana: Cuota = { ...CUOTA, vigente_desde: "2099-01-01" };
    expect(mensajes(evaluar(seis, BASE, lejana, CUOTA))).toHaveLength(1);
  });

  it("la primera vez, cuando la base todavía no trae cuota.json, rige la del cambio", () => {
    const sinCuota = control.evaluar({
      pr: arbolConRegistro([...BASE, ...nuevas(6, "DINERO")], {}, undefined, CUOTA),
      base: {
        rutas: arbolConRegistro(BASE).rutas,
        leer: (ruta: string) =>
          ruta === control.ARCHIVO_DE_LA_CUOTA ? null : arbolConRegistro(BASE).leer(ruta),
      },
    });
    expect(mensajes(sinCuota)).toHaveLength(1);
  });

  it("una cuota rota en la base falla con prefijo de la base", () => {
    const rota = { ...CUOTA, negocio: -1 };
    const r = evaluar(BASE, BASE, CUOTA, rota);
    expect(mensajes(r).join("\n")).toContain("Base: negocio es un entero entre 0 y 100.");
  });

  it("un cuota.json que no se puede leer, en el cambio o en la base, falla con su motivo y prefijo", () => {
    const roto = (arbol: ReturnType<typeof arbolConRegistro>) => ({
      rutas: arbol.rutas,
      leer: (ruta: string) =>
        ruta === control.ARCHIVO_DE_LA_CUOTA ? Buffer.from("{roto") : arbol.leer(ruta),
    });
    const sano = arbolConRegistro(BASE);
    const delCambio = control.evaluar({ pr: roto(sano) });
    expect(delCambio.fallas).toHaveLength(1);
    expect(delCambio.fallas[0]?.archivo).toBe(control.ARCHIVO_DE_LA_CUOTA);
    expect(delCambio.fallas[0]?.motivo).toMatch(
      /^arquitectura\/decisiones\/cuota\.json: no se puede leer \(/,
    );
    const deLaBase = control.evaluar({ pr: sano, base: roto(sano) });
    expect(deLaBase.fallas).toHaveLength(1);
    expect(deLaBase.fallas[0]?.motivo).toMatch(
      /^Base: arquitectura\/decisiones\/cuota\.json: no se puede leer \(/,
    );
  });

  it("sin cuota.json el cambio falla («no existe.») y la base puede no tenerlo", () => {
    const sin = (arbol: ReturnType<typeof arbolConRegistro>) => ({
      rutas: arbol.rutas.filter((ruta) => ruta !== control.ARCHIVO_DE_LA_CUOTA),
      leer: (ruta: string) => (ruta === control.ARCHIVO_DE_LA_CUOTA ? null : arbol.leer(ruta)),
    });
    const sano = arbolConRegistro(BASE);
    expect(control.evaluar({ pr: sin(sano) }).fallas).toEqual([
      { archivo: control.ARCHIVO_DE_LA_CUOTA, linea: 1, motivo: "no existe." },
    ]);
    expect(control.evaluar({ pr: sano, base: sin(sano) }).fallas).toEqual([]);
  });

  it("sin base solo se mira la forma: no hay con qué comparar", () => {
    const pr = arbolConRegistro([...BASE, ...nuevas(50, "DINERO")]);
    expect(control.evaluar({ pr }).fallas).toEqual([]);
  });
});

describe("la forma de cuota.json (todo nace cerrado)", () => {
  const valida = { vigente_desde: "2026-11-14", negocio: 5, tecnicas: 10, excepciones: [] };
  const excepcion = { id: "DEC-0001", fecha: "2026-11-12", fuente: "Mensaje del dueño 12/11/2026" };
  it("la cuota válida, con y sin excepciones, no tiene problemas", () => {
    expect(forma.problemasDeLaCuota(valida)).toEqual([]);
    expect(forma.problemasDeLaCuota({ ...valida, excepciones: [excepcion] })).toEqual([]);
    expect(forma.problemasDeLaCuota({ ...valida, negocio: 0, tecnicas: 100 })).toEqual([]);
  });

  it.each([
    [
      "no es un objeto",
      null,
      "cuota.json lleva exactamente: vigente_desde, negocio, tecnicas, excepciones.",
    ],
    ["es una lista", [], "lleva exactamente"],
    [
      "falta una clave",
      { vigente_desde: "2026-11-14", negocio: 5, tecnicas: 10 },
      "lleva exactamente",
    ],
    ["sobra una clave", { ...valida, otra: 1 }, "lleva exactamente"],
    ["fecha imposible", { ...valida, vigente_desde: "2026-02-31" }, "vigente_desde es un día real"],
    [
      "fecha que no es texto",
      { ...valida, vigente_desde: 20261114 },
      "vigente_desde es un día real",
    ],
    ["tope negativo", { ...valida, negocio: -1 }, "negocio es un entero entre 0 y 100"],
    ["tope con decimales", { ...valida, tecnicas: 2.5 }, "tecnicas es un entero entre 0 y 100"],
    ["tope pasado del máximo", { ...valida, negocio: 101 }, "negocio es un entero entre 0 y 100"],
    ["tope en texto", { ...valida, negocio: "5" }, "negocio es un entero entre 0 y 100"],
    [
      "excepciones que no es lista",
      { ...valida, excepciones: {} },
      "excepciones tiene que ser una lista",
    ],
    [
      "excepción que no es objeto",
      { ...valida, excepciones: ["DEC-0001"] },
      "excepciones[0]: lleva exactamente id, fecha y fuente",
    ],
    [
      "excepción sin fuente",
      { ...valida, excepciones: [{ id: "DEC-0001", fecha: "2026-11-12" }] },
      "excepciones[0]: lleva exactamente id, fecha y fuente",
    ],
    [
      "excepción con id inválido",
      { ...valida, excepciones: [{ ...excepcion, id: "DEC-1" }] },
      "excepciones[0]: id tiene la forma DEC-0001",
    ],
    [
      "excepción con id que no es texto",
      { ...valida, excepciones: [{ ...excepcion, id: ["DEC-0001"] }] },
      "excepciones[0]: id tiene la forma",
    ],
    [
      "excepción con fecha imposible",
      { ...valida, excepciones: [{ ...excepcion, fecha: "2026-13-01" }] },
      "excepciones[0]: fecha es un día real",
    ],
    [
      "excepción con fuente vacía",
      { ...valida, excepciones: [{ ...excepcion, fuente: "" }] },
      "excepciones[0].fuente tiene que tener entre",
    ],
    [
      "excepción con fuente con etiqueta",
      { ...valida, excepciones: [{ ...excepcion, fuente: "dijo <b>ok</b>" }] },
      "excepciones[0].fuente admite",
    ],
    [
      "excepción repetida",
      { ...valida, excepciones: [excepcion, excepcion] },
      "excepciones[1]: el id DEC-0001 está repetido",
    ],
  ])("%s", (_nombre, valor, esperado) => {
    expect(forma.problemasDeLaCuota(valor).join(" | ")).toContain(esperado);
  });

  it("una cuota inválida en el cambio sale como falla del archivo, con su problema", () => {
    const r = control.evaluar({
      pr: arbolConRegistro(BASE, {}, undefined, { ...valida, negocio: 500 }),
    });
    expect(r.fallas).toEqual([
      {
        archivo: control.ARCHIVO_DE_LA_CUOTA,
        linea: 1,
        motivo: "negocio es un entero entre 0 y 100.",
      },
    ]);
  });
});
