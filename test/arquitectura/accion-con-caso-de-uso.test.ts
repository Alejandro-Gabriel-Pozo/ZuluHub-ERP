import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import {
  accionesUsadasEnCodigo,
  type EntradaDeLaRegla,
  evaluarAccionConCasoDeUso,
  leerAccionesUsadas,
} from "./accion-con-caso-de-uso-apoyo";

/**
 * Regla «acción → caso de uso» (tercera pata; diseño y límites en `accion-con-caso-de-uso-apoyo.ts`). Toda acción declarada en el catálogo de un
 * módulo disponible la usa un caso de uso o una consulta, o está en `arquitectura/pantallas/acciones-reservadas.json` con motivo, ola, referencia y
 * vencimiento; el total de reservadas solo baja (`tope-reservadas.json`).
 * Previene: permisos declarados «por las dudas» que nadie construye y se quedan para siempre en el catálogo, la matriz y las pruebas congeladas
 * (caso real, 21/11/2026: 12 permisos sin caso de uso, declarados el 13/10 y el 10/11 sin que nada los volviera a mirar). Cada caso inyectado
 * abajo rompe la regla: si se la debilita, esta prueba se pone roja.
 */

const RAIZ = join(import.meta.dirname, "../..");
/** El tope más alto que se aceptó jamás (estado inicial del 23/11/2026). Subirlo exige cambiar esta línea a propósito, a la vista del PR. */
const TOPE_MAXIMO = 3;

const leerJson = (ruta: string): unknown => JSON.parse(readFileSync(join(RAIZ, ruta), "utf8"));

/** La fecha de hoy en Argentina (UTC-3), formato AAAA-MM-DD. */
const hoyEnArgentina = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const OLAS = { "1": "2027-01-20", "2": "2027-03-20", "3": "2027-05-20" };
const reservada = (accion: string, cambios: Record<string, unknown> = {}) => ({
  accion,
  motivo: "Sin caso de uso todavía.",
  ola: 1,
  referencia: "decisiones-del-dueno-2026-11.md, fila del 21/11/2026",
  vence: "2027-01-20",
  ...cambios,
});

/** Un mundo sano: dos módulos disponibles y uno en desarrollo; `a.usada` tiene caso de uso, `a.reservada` está reservada. */
const SANO: EntradaDeLaRegla = {
  catalogo: {
    uno: { estado: "disponible", acciones: { "a.usada": {}, "a.reservada": {} } },
    dos: { estado: "disponible", acciones: { "b.usada": {} } },
    futuro: { estado: "en_desarrollo", acciones: { "c.pendiente": {} } },
  },
  usadas: new Set(["a.usada", "b.usada"]),
  noAnalizables: [],
  registro: { olas: OLAS, reservadas: [reservada("a.reservada")] },
  tope: { tope: 1 },
  topeMaximo: 1,
  hoy: "2026-11-23",
};
const con = (cambios: Partial<EntradaDeLaRegla>): EntradaDeLaRegla => ({ ...SANO, ...cambios });
const conReservadas = (reservadas: unknown[], tope = reservadas.length): EntradaDeLaRegla =>
  con({ registro: { olas: OLAS, reservadas }, tope: { tope }, topeMaximo: Math.max(tope, 1) });

describe("acción → caso de uso: cada caso inyectado falla", () => {
  it("control: el mundo sano cumple (y un módulo en desarrollo con acciones sin caso de uso no falla)", () => {
    expect(evaluarAccionConCasoDeUso(SANO)).toEqual([]);
  });

  it("1. acción declarada sin caso de uso y sin reserva", () => {
    const problemas = evaluarAccionConCasoDeUso(
      con({
        usadas: new Set(["b.usada"]),
        registro: { olas: OLAS, reservadas: [reservada("a.reservada")] },
      }),
    );
    expect(problemas.join("\n")).toContain(
      "a.usada (uno): declarada en el catálogo y ningún caso de uso la usa",
    );
  });

  it.each(["accion", "motivo", "referencia", "vence", "ola"])("2. reservada sin %s", (campo) => {
    const sin: Record<string, unknown> = reservada("a.reservada");
    delete sin[campo];
    const problemas = evaluarAccionConCasoDeUso(conReservadas([sin]));
    expect(problemas.join("\n")).toContain(`falta ${campo}`);
  });

  it("2. reservada con un campo vacío o con una clave de más", () => {
    expect(
      evaluarAccionConCasoDeUso(conReservadas([reservada("a.reservada", { motivo: "  " })])).join(
        "\n",
      ),
    ).toContain("falta motivo");
    expect(
      evaluarAccionConCasoDeUso(conReservadas([reservada("a.reservada", { extra: 1 })])).join("\n"),
    ).toContain("clave desconocida «extra»");
  });

  it("2. reservada con una ola que no tiene fecha", () => {
    const problemas = evaluarAccionConCasoDeUso(
      conReservadas([reservada("a.reservada", { ola: 9 })]),
    );
    expect(problemas.join("\n")).toContain("la ola 9 no tiene fecha");
  });

  it("3. reservada vencida (hoy es después de su vencimiento)", () => {
    const problemas = evaluarAccionConCasoDeUso(con({ hoy: "2027-01-21" }));
    expect(problemas.join("\n")).toContain("a.reservada: la reserva venció el 2027-01-20");
    // El mismo día de su vencimiento todavía vale.
    expect(evaluarAccionConCasoDeUso(con({ hoy: "2027-01-20" }))).toEqual([]);
  });

  it("4. reservada que vence después del cierre de su ola", () => {
    const problemas = evaluarAccionConCasoDeUso(
      conReservadas([reservada("a.reservada", { vence: "2027-01-21" })]),
    );
    expect(problemas.join("\n")).toContain("después del cierre de su ola (2027-01-20)");
  });

  it("5. reservada que ya tiene caso de uso (sobra)", () => {
    const problemas = evaluarAccionConCasoDeUso(
      con({ usadas: new Set(["a.usada", "b.usada", "a.reservada"]) }),
    );
    expect(problemas.join("\n")).toContain("a.reservada: ya tiene caso de uso");
  });

  it("6. el total de reservadas sube respecto del tope, o el tope sube por encima del máximo", () => {
    const dos = [reservada("a.reservada"), reservada("c.pendiente")];
    expect(
      evaluarAccionConCasoDeUso(con({ registro: { olas: OLAS, reservadas: dos } })).join("\n"),
    ).toContain("hay 2 reservadas y el tope es 1");
    expect(evaluarAccionConCasoDeUso(con({ tope: { tope: 2 } })).join("\n")).toContain(
      "el tope (2) sube por encima de 1",
    );
  });

  it("6. si el total baja, el tope también tiene que bajar", () => {
    const problemas = evaluarAccionConCasoDeUso(con({ tope: { tope: 2 }, topeMaximo: 2 }));
    expect(problemas.join("\n")).toContain("bajá el tope a 1");
  });

  it("7. entrada duplicada", () => {
    const problemas = evaluarAccionConCasoDeUso(
      conReservadas([reservada("a.reservada"), reservada("a.reservada")]),
    );
    expect(problemas.join("\n")).toContain("a.reservada: está repetida");
  });

  it("7. reservada de una acción que no existe en el catálogo", () => {
    const problemas = evaluarAccionConCasoDeUso(
      conReservadas([reservada("a.reservada"), reservada("z.inventada")]),
    );
    expect(problemas.join("\n")).toContain(
      "z.inventada: está reservada pero no existe en el catálogo",
    );
  });

  it("8. control negativo: reservar una acción de un módulo en desarrollo sobra y falla; dejarla sin reservar no falla", () => {
    expect(evaluarAccionConCasoDeUso(SANO)).toEqual([]);
    const problemas = evaluarAccionConCasoDeUso(
      conReservadas([reservada("a.reservada"), reservada("c.pendiente")]),
    );
    expect(problemas.join("\n")).toContain(
      "c.pendiente: está reservada pero su módulo (futuro) no está disponible",
    );
  });

  it("un uso que el análisis no pudo resolver falla (fail-closed)", () => {
    const problemas = evaluarAccionConCasoDeUso(
      con({ noAnalizables: ["x.ts:3 exigirAccion con una acción calculada"] }),
    );
    expect(problemas).toContain("no analizable: x.ts:3 exigirAccion con una acción calculada");
  });

  it("los registros rotos fallan en vez de pasar", () => {
    expect(evaluarAccionConCasoDeUso(con({ registro: [] })).join("\n")).toContain(
      "tiene que ser { olas, reservadas",
    );
    expect(evaluarAccionConCasoDeUso(con({ tope: { tope: "3" } })).join("\n")).toContain(
      "entero desde 0",
    );
    expect(
      evaluarAccionConCasoDeUso(con({ registro: { reservadas: [] }, tope: { tope: 0 } })).join(
        "\n",
      ),
    ).toContain("falta «olas»");
    expect(
      evaluarAccionConCasoDeUso(
        con({ registro: { olas: { "1": "2027-02-30" }, reservadas: [] } }),
      ).join("\n"),
    ).toContain("la ola 1 no tiene una fecha");
  });
});

describe("acción → caso de uso: qué cuenta como uso en el código", () => {
  const conocidas = new Set(["a.uno", "a.dos", "a.tres", "a.cuatro"]);
  const leer = (codigo: string, archivo = "src/modulos/x/casos-de-uso/declaraciones.ts") =>
    accionesUsadasEnCodigo(archivo, codigo, conocidas);

  it("cuentan `accion:`, `tambien:` y un literal pasado a una llamada (también dentro de un arreglo o un condicional)", () => {
    const { usadas, noAnalizables } = leer(`
      export const D = { caso: { accion: "a.uno", tambien: ["a.dos"] } };
      async function f(pedir, exigirAccion, reglas, ok) {
        await exigirAccion(reglas, "a.tres", () => 1);
        await pedir(ok ? ["a.cuatro"] : []);
      }
    `);
    expect([...usadas].sort()).toEqual(["a.cuatro", "a.dos", "a.tres", "a.uno"]);
    expect(noAnalizables).toEqual([]);
  });

  it("no cuentan los comentarios ni un literal suelto que nadie pasa a una llamada", () => {
    const { usadas } = leer(`
      // a.uno y a.dos están en este comentario
      /** a.tres */
      const TABLA = { x: "a.cuatro" };
    `);
    expect([...usadas]).toEqual([]);
  });

  it("`exigirAccion` con `DECLARACIONES.x.accion` o con un nombre es analizable; con una plantilla, una llamada o sin acción, no", () => {
    expect(leer("exigirAccion(reglas, DECLARACIONES.caso.accion, f);").noAnalizables).toEqual([]);
    expect(leer("exigirAccion(reglas, accion, f);").noAnalizables).toEqual([]);
    expect(leer("exigirAccion(reglas, `a.${x}`, f);").noAnalizables).toHaveLength(1);
    expect(leer("exigirAccion(reglas, armar(x), f);").noAnalizables).toHaveLength(1);
    expect(leer("exigirAccion(reglas, x ? 'a.uno' : 'a.dos', f);").noAnalizables).toHaveLength(1);
    expect(leer("exigirAccion(reglas);").noAnalizables).toHaveLength(1);
  });

  it("una declaración con `accion:` o `tambien:` que no son literales es no analizable", () => {
    expect(leer("export const D = { caso: { accion: ACCION } };").noAnalizables).toHaveLength(1);
    expect(
      leer('export const D = { caso: { accion: "a.uno", tambien: OTRAS } };').noAnalizables,
    ).toHaveLength(1);
    expect(
      leer('export const D = { caso: { accion: "a.uno", tambien: [X] } };').noAnalizables,
    ).toHaveLength(1);
  });

  it("un literal que no es del catálogo no cuenta", () => {
    expect([...leer('f("otra.cosa"); const D = { accion: "otra.cosa" };').usadas]).toEqual([]);
  });
});

describe("acción → caso de uso: el repositorio real", () => {
  it("toda acción declarada y disponible tiene caso de uso o una reserva vigente, y el total de reservadas no sube", () => {
    const conocidas = new Set(
      Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)),
    );
    const { usadas, noAnalizables } = leerAccionesUsadas(RAIZ, conocidas);
    const problemas = evaluarAccionConCasoDeUso({
      catalogo: CATALOGO_DE_MODULOS,
      usadas,
      noAnalizables,
      registro: leerJson("arquitectura/pantallas/acciones-reservadas.json"),
      tope: leerJson("arquitectura/pantallas/tope-reservadas.json"),
      topeMaximo: TOPE_MAXIMO,
      hoy: hoyEnArgentina(),
    });
    expect(problemas).toEqual([]);
  });
});
