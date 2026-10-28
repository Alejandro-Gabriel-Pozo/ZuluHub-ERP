import { describe, expect, it } from "vitest";
import type {
  ColaDeTrabajos,
  ManejadorDeTrabajo,
  TrabajoTomado,
} from "../../puertos/cola-de-trabajos";
import { empresaId } from "../../primitivas/identificadores/marca";
import type { Transacciones } from "../../puertos/transacciones";
import { crearProcesadorDeTrabajos, type ProblemaDelProcesador, type TxDeCola } from "./procesador";
import type { PoliticaDeReintentos } from "./reintentos";

/**
 * El procesador contra una cola en memoria que imita lo que hace la de Postgres (la base real se
 * prueba en `test/integracion`). Acá se miran las decisiones: qué marca el procesador en cada caso.
 */
const T0 = new Date("2026-10-11T12:00:00.000Z");
const POLITICA: Partial<PoliticaDeReintentos> = {
  maximoDeIntentos: 3,
  esperaBaseEnMs: 1_000,
  esperaMaximaEnMs: 8_000,
  plazoDeTomaEnMs: 60_000,
};
const mas = (ms: number) => new Date(T0.getTime() + ms);

type Fila = {
  id: string;
  tipo: string;
  estado: string;
  intentos: number;
  proximoIntento: Date;
  tomadoHasta: Date | null;
  ultimoError: string | null;
};

function colaEnMemoria(
  filas: Fila[],
  opciones: {
    rechazarCierres?: boolean;
    porClaves?: ColaDeTrabajos["idsPorClaves"];
  } = {},
) {
  const cola: ColaDeTrabajos = {
    candidatos: (ahora, limite) =>
      Promise.resolve(
        filas
          .filter(
            (f) =>
              (f.estado === "PENDIENTE" && (f.proximoIntento <= ahora || f.intentos === 0)) ||
              (f.estado === "EN_CURSO" && f.tomadoHasta !== null && f.tomadoHasta <= ahora),
          )
          .slice(0, limite)
          .map((f) => f.id),
      ),
    tomar: (id, ahora, hasta) => {
      const f = filas.find((x) => x.id === id);
      const disponible =
        f !== undefined &&
        ((f.estado === "PENDIENTE" && (f.proximoIntento <= ahora || f.intentos === 0)) ||
          (f.estado === "EN_CURSO" && f.tomadoHasta !== null && f.tomadoHasta <= ahora));
      if (!disponible) return Promise.resolve(null);
      f.estado = "EN_CURSO";
      f.intentos += 1;
      f.tomadoHasta = hasta;
      const tomado: TrabajoTomado = {
        id: f.id,
        empresaId: null,
        tipo: f.tipo,
        datos: {},
        intentos: f.intentos,
      };
      return Promise.resolve(tomado);
    },
    marcarHecho: (id, intentos, nota) => {
      const f = filas.find((x) => x.id === id);
      if (
        opciones.rechazarCierres === true ||
        f?.estado !== "EN_CURSO" ||
        f.intentos !== intentos
      ) {
        return Promise.resolve(false);
      }
      Object.assign(f, { estado: "HECHO", tomadoHasta: null, ultimoError: nota });
      return Promise.resolve(true);
    },
    reprogramar: (id, intentos, proximo, error) => {
      const f = filas.find((x) => x.id === id);
      if (
        opciones.rechazarCierres === true ||
        f?.estado !== "EN_CURSO" ||
        f.intentos !== intentos
      ) {
        return Promise.resolve(false);
      }
      Object.assign(f, {
        estado: "PENDIENTE",
        proximoIntento: proximo,
        tomadoHasta: null,
        ultimoError: error,
      });
      return Promise.resolve(true);
    },
    marcarFallido: (id, intentos, error) => {
      const f = filas.find((x) => x.id === id);
      if (
        opciones.rechazarCierres === true ||
        f?.estado !== "EN_CURSO" ||
        f.intentos !== intentos
      ) {
        return Promise.resolve(false);
      }
      Object.assign(f, { estado: "FALLIDO", tomadoHasta: null, ultimoError: error });
      return Promise.resolve(true);
    },
    idsPorClaves: opciones.porClaves ?? (() => Promise.resolve([])),
    empresasConTrabajosDe: () => Promise.resolve([]),
  };
  const transacciones: Transacciones<TxDeCola> = {
    ejecutar: async (opcionesDeTx, trabajo) => {
      expect(opcionesDeTx.contexto.tipo).toBe("TRABAJOS");
      expect(opcionesDeTx.aislamiento).toBe("read committed");
      return await trabajo({ cola });
    },
  };
  return { transacciones };
}

const fila = (id: string, cambios: Partial<Fila> = {}): Fila => ({
  id,
  tipo: "demo",
  estado: "PENDIENTE",
  intentos: 0,
  proximoIntento: T0,
  tomadoHasta: null,
  ultimoError: null,
  ...cambios,
});

function procesadorCon(
  filas: Fila[],
  manejador: ManejadorDeTrabajo | undefined,
  extras: {
    problemas?: ProblemaDelProcesador[];
    rechazarCierres?: boolean;
    tope?: number;
    porClaves?: ColaDeTrabajos["idsPorClaves"];
  } = {},
) {
  const { transacciones } = colaEnMemoria(filas, {
    ...(extras.rechazarCierres === undefined ? {} : { rechazarCierres: extras.rechazarCierres }),
    ...(extras.porClaves === undefined ? {} : { porClaves: extras.porClaves }),
  });
  return crearProcesadorDeTrabajos({
    transacciones,
    manejadores: new Map(manejador === undefined ? [] : [["demo", manejador]]),
    politica: POLITICA,
    alRegistrarProblema: (p) => extras.problemas?.push(p),
    ...(extras.tope === undefined ? {} : { topeDeEsperaDelDespachoEnMs: extras.tope }),
  });
}

const hecho: ManejadorDeTrabajo = () => Promise.resolve({ tipo: "HECHO" });

describe("procesarUno", () => {
  it("un trabajo que sale bien queda HECHO, con un intento y sin plazo", async () => {
    const filas = [fila("a")];
    const r = await procesadorCon(filas, hecho).procesarUno("a", T0);
    expect(r).toBe("HECHO");
    expect(filas[0]).toMatchObject({ estado: "HECHO", intentos: 1, tomadoHasta: null });
  });

  it("toma con el plazo de la política y le pasa al manejador el trabajo y `ahora`", async () => {
    const filas = [fila("a")];
    let visto: { trabajo: TrabajoTomado; ahora: Date; plazo: Date | null } | null = null;
    await procesadorCon(filas, (trabajo, ahora) => {
      visto = { trabajo, ahora, plazo: filas[0]?.tomadoHasta ?? null };
      return Promise.resolve({ tipo: "HECHO" });
    }).procesarUno("a", T0);
    expect(visto).toMatchObject({ trabajo: { id: "a", tipo: "demo", intentos: 1 }, ahora: T0 });
    expect((visto as unknown as { plazo: Date }).plazo).toEqual(mas(60_000));
  });

  it("guarda la nota de un trabajo que terminó sin hacer nada", async () => {
    const filas = [fila("a")];
    await procesadorCon(filas, () =>
      Promise.resolve({ tipo: "HECHO", nota: "OMITIDO: REVOCADA" }),
    ).procesarUno("a", T0);
    expect(filas[0]).toMatchObject({ estado: "HECHO", ultimoError: "OMITIDO: REVOCADA" });
  });

  it("un error reintentable reprograma con espera creciente y guarda el error", async () => {
    const filas = [fila("a")];
    const falla: ManejadorDeTrabajo = () =>
      Promise.resolve({ tipo: "ERROR", error: "el proveedor respondió 500", definitivo: false });
    const p = procesadorCon(filas, falla);
    expect(await p.procesarUno("a", T0)).toBe("REPROGRAMADO");
    expect(filas[0]).toMatchObject({
      estado: "PENDIENTE",
      intentos: 1,
      proximoIntento: mas(1_000),
      tomadoHasta: null,
      ultimoError: "el proveedor respondió 500",
    });
    // Todavía no le toca.
    expect(await p.procesarUno("a", mas(999))).toBe("NO_TOMADO");
    expect(await p.procesarUno("a", mas(1_000))).toBe("REPROGRAMADO");
    expect(filas[0]).toMatchObject({ intentos: 2, proximoIntento: mas(1_000 + 2_000) });
  });

  it("al agotar los intentos queda FALLIDO y la fila no se borra", async () => {
    const filas = [fila("a")];
    const falla: ManejadorDeTrabajo = () =>
      Promise.resolve({ tipo: "ERROR", error: "sigue fallando", definitivo: false });
    const p = procesadorCon(filas, falla);
    const resultados = [];
    let ahora = T0;
    for (let i = 0; i < 3; i++) {
      resultados.push(await p.procesarUno("a", ahora));
      ahora = mas(1_000_000 * (i + 1));
    }
    expect(resultados).toEqual(["REPROGRAMADO", "REPROGRAMADO", "FALLIDO"]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      estado: "FALLIDO",
      intentos: 3,
      ultimoError: "sigue fallando",
    });
    // Un FALLIDO no se vuelve a tomar.
    expect(await p.procesarUno("a", mas(99_000_000))).toBe("NO_TOMADO");
  });

  it("un error definitivo deja FALLIDO de inmediato, sin reintentar", async () => {
    const filas = [fila("a")];
    const r = await procesadorCon(filas, () =>
      Promise.resolve({ tipo: "ERROR", error: "dirección inválida", definitivo: true }),
    ).procesarUno("a", T0);
    expect(r).toBe("FALLIDO");
    expect(filas[0]).toMatchObject({
      estado: "FALLIDO",
      intentos: 1,
      ultimoError: "dirección inválida",
    });
  });

  it("una excepción del manejador cuenta como error reintentable y no deja pasar secretos", async () => {
    const filas = [fila("a")];
    const token = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
    const r = await procesadorCon(filas, () => {
      throw new Error(`falló https://app.ejemplo.com/invitaciones/${token} con ${token}`);
    }).procesarUno("a", T0);
    expect(r).toBe("REPROGRAMADO");
    const guardado = filas[0]?.ultimoError ?? "";
    expect(guardado).toBe("Error: falló [enlace] con [oculto]");
    expect(guardado).not.toContain(token);
  });

  it("una excepción asíncrona del manejador también", async () => {
    const filas = [fila("a")];
    const r = await procesadorCon(filas, () => Promise.reject(new RangeError("mal"))).procesarUno(
      "a",
      T0,
    );
    expect(r).toBe("REPROGRAMADO");
    expect(filas[0]?.ultimoError).toBe("RangeError: mal");
  });

  it("el error que devuelve el manejador también pasa por el filtro de secretos", async () => {
    const filas = [fila("a")];
    await procesadorCon(filas, () =>
      Promise.resolve({ tipo: "ERROR", error: `clave ${"k".repeat(40)}`, definitivo: false }),
    ).procesarUno("a", T0);
    expect(filas[0]?.ultimoError).toBe("clave [oculto]");
  });

  it("la nota de un trabajo hecho también pasa por el filtro de secretos", async () => {
    const filas = [fila("a")];
    await procesadorCon(filas, () =>
      Promise.resolve({ tipo: "HECHO", nota: `https://x.test/${"k".repeat(40)}` }),
    ).procesarUno("a", T0);
    expect(filas[0]?.ultimoError).toBe("[enlace]");
  });

  it("un tipo sin manejador se reprograma (puede ser una versión vieja del código)", async () => {
    const filas = [fila("a", { tipo: "otro" })];
    const r = await procesadorCon(filas, hecho).procesarUno("a", T0);
    expect(r).toBe("REPROGRAMADO");
    expect(filas[0]).toMatchObject({
      estado: "PENDIENTE",
      ultimoError: "no hay manejador para el tipo 'otro'",
    });
  });

  it("un trabajo con más intentos que el tope (el proceso murió en cada uno) no se ejecuta: FALLIDO", async () => {
    // maximoDeIntentos = 3 y el trabajo ya llevaba 3: la toma cuenta el cuarto.
    const filas = [fila("a", { estado: "EN_CURSO", intentos: 3, tomadoHasta: T0 })];
    let ejecuciones = 0;
    const r = await procesadorCon(filas, () => {
      ejecuciones += 1;
      return Promise.resolve({ tipo: "HECHO" });
    }).procesarUno("a", T0);
    expect(r).toBe("FALLIDO");
    expect(ejecuciones).toBe(0);
    expect(filas[0]).toMatchObject({ estado: "FALLIDO", intentos: 4 });
    expect(filas[0]?.ultimoError).toMatch(/se agotaron los intentos/);
  });

  it("el último intento permitido sí se ejecuta (el tope es inclusivo)", async () => {
    const filas = [fila("a", { estado: "EN_CURSO", intentos: 2, tomadoHasta: T0 })];
    let ejecuciones = 0;
    const r = await procesadorCon(filas, () => {
      ejecuciones += 1;
      return Promise.resolve({ tipo: "HECHO" });
    }).procesarUno("a", T0);
    expect(r).toBe("HECHO");
    expect(ejecuciones).toBe(1);
  });

  it("plazo vencido: otro lo retoma; con el plazo vigente, no", async () => {
    const filas = [fila("a", { estado: "EN_CURSO", intentos: 1, tomadoHasta: mas(10_000) })];
    const p = procesadorCon(filas, hecho);
    expect(await p.procesarUno("a", mas(9_999))).toBe("NO_TOMADO");
    expect(await p.procesarUno("a", mas(10_000))).toBe("HECHO");
    expect(filas[0]).toMatchObject({ estado: "HECHO", intentos: 2 });
  });

  it("si otro retomó el trabajo mientras tanto, el cierre no se aplica", async () => {
    const filas = [fila("a")];
    const r = await procesadorCon(filas, hecho, { rechazarCierres: true }).procesarUno("a", T0);
    expect(r).toBe("PERDIDO");
    expect(filas[0]?.estado).toBe("EN_CURSO");
  });

  it("si la cola no responde al tomar, informa y devuelve ERROR_INTERNO sin lanzar", async () => {
    const problemas: ProblemaDelProcesador[] = [];
    const p = crearProcesadorDeTrabajos({
      transacciones: { ejecutar: () => Promise.reject(new Error("se cayó la base")) },
      manejadores: new Map([["demo", hecho]]),
      alRegistrarProblema: (x) => problemas.push(x),
    });
    expect(await p.procesarUno("a", T0)).toBe("ERROR_INTERNO");
    expect(problemas).toEqual([
      { trabajoId: "a", fase: "tomar", mensaje: "Error: se cayó la base" },
    ]);
  });

  it("un error de persistencia de la cola se informa con su tipo, no con el detalle", async () => {
    const problemas: ProblemaDelProcesador[] = [];
    const p = crearProcesadorDeTrabajos({
      transacciones: {
        ejecutar: () =>
          Promise.resolve({
            ok: false,
            error: { tipo: "Inesperado", sqlstate: "08006", mensaje: "detalle interno" },
          } as never),
      },
      manejadores: new Map(),
      alRegistrarProblema: (x) => problemas.push(x),
    });
    expect(await p.procesarUno("a", T0)).toBe("ERROR_INTERNO");
    expect(problemas[0]?.mensaje).toBe(
      "ErrorDeLaCola: la cola de trabajos falló: Inesperado 08006",
    );
    const p2 = crearProcesadorDeTrabajos({
      transacciones: {
        ejecutar: () => Promise.resolve({ ok: false, error: { tipo: "AccesoDenegado" } } as never),
      },
      manejadores: new Map(),
      alRegistrarProblema: (x) => problemas.push(x),
    });
    expect(await p2.procesarUno("a", T0)).toBe("ERROR_INTERNO");
    expect(problemas[1]?.mensaje).toBe("ErrorDeLaCola: la cola de trabajos falló: AccesoDenegado");
  });

  it("si se ejecutó pero no se pudo cerrar, informa en la fase 'cerrar'", async () => {
    const problemas: ProblemaDelProcesador[] = [];
    const filas = [fila("a")];
    const { transacciones } = colaEnMemoria(filas);
    let llamadas = 0;
    const p = crearProcesadorDeTrabajos({
      transacciones: {
        ejecutar: (o, t) => {
          llamadas += 1;
          // La primera transacción (tomar) anda; la segunda (cerrar) falla.
          return llamadas === 1
            ? transacciones.ejecutar(o, t)
            : Promise.reject(new Error("cortó la conexión"));
        },
      },
      manejadores: new Map([["demo", hecho]]),
      alRegistrarProblema: (x) => problemas.push(x),
    });
    expect(await p.procesarUno("a", T0)).toBe("ERROR_INTERNO");
    expect(problemas).toEqual([
      { trabajoId: "a", fase: "cerrar", mensaje: "Error: cortó la conexión" },
    ]);
    // Quedó EN_CURSO: vencido el plazo, otro lo retoma.
    expect(filas[0]?.estado).toBe("EN_CURSO");
  });

  it("un aviso que falla no cambia el resultado", async () => {
    const p = crearProcesadorDeTrabajos({
      transacciones: { ejecutar: () => Promise.reject(new Error("x")) },
      manejadores: new Map(),
      alRegistrarProblema: () => {
        throw new Error("el registro también falla");
      },
    });
    expect(await p.procesarUno("a", T0)).toBe("ERROR_INTERNO");
  });
});

describe("procesarPendientes", () => {
  it("procesa hasta `limite` trabajos y cuenta cada resultado", async () => {
    const filas = [
      fila("a"),
      fila("b", { tipo: "falla" }),
      fila("c", { tipo: "definitivo" }),
      fila("d", { proximoIntento: mas(5_000), intentos: 1 }),
      fila("e"),
    ];
    const { transacciones } = colaEnMemoria(filas);
    const p = crearProcesadorDeTrabajos({
      transacciones,
      politica: POLITICA,
      manejadores: new Map<string, ManejadorDeTrabajo>([
        ["demo", hecho],
        ["falla", () => Promise.resolve({ tipo: "ERROR", error: "x", definitivo: false })],
        ["definitivo", () => Promise.resolve({ tipo: "ERROR", error: "y", definitivo: true })],
      ]),
    });
    const resumen = await p.procesarPendientes({ ahora: T0, limite: 3 });
    expect(resumen).toEqual({
      candidatos: 3,
      hechos: 1,
      reprogramados: 1,
      fallidos: 1,
      noTomados: 0,
      perdidos: 0,
      errores: 0,
    });
    // `d` no estaba vencido y `e` quedó fuera del límite.
    expect(filas.map((f) => f.estado)).toEqual([
      "HECHO",
      "PENDIENTE",
      "FALLIDO",
      "PENDIENTE",
      "PENDIENTE",
    ]);
    const segunda = await p.procesarPendientes({ ahora: T0, limite: 10 });
    expect(segunda.hechos).toBe(1);
    expect(segunda.candidatos).toBe(1);
  });

  it("sin nada para hacer devuelve ceros", async () => {
    const resumen = await procesadorCon([], hecho).procesarPendientes({ ahora: T0, limite: 5 });
    expect(resumen).toEqual({
      candidatos: 0,
      hechos: 0,
      reprogramados: 0,
      fallidos: 0,
      noTomados: 0,
      perdidos: 0,
      errores: 0,
    });
  });

  it("cuenta los errores internos y los perdidos sin cortar la corrida", async () => {
    const filas = [fila("a"), fila("b")];
    const resumen = await procesadorCon(filas, hecho, { rechazarCierres: true }).procesarPendientes(
      {
        ahora: T0,
        limite: 5,
      },
    );
    expect(resumen).toMatchObject({ candidatos: 2, perdidos: 2, hechos: 0 });
  });

  it("si no se pueden leer los candidatos, lanza (el cron tiene que enterarse)", async () => {
    const p = crearProcesadorDeTrabajos({
      transacciones: { ejecutar: () => Promise.reject(new Error("sin base")) },
      manejadores: new Map(),
    });
    await expect(p.procesarPendientes({ ahora: T0, limite: 5 })).rejects.toThrow("sin base");
  });

  it("rechaza un límite inválido", async () => {
    const p = procesadorCon([], hecho);
    for (const malo of [0, -1, 1.5, Number.NaN]) {
      await expect(p.procesarPendientes({ ahora: T0, limite: malo })).rejects.toBeInstanceOf(
        RangeError,
      );
    }
  });
});

describe("despacharAhora", () => {
  it("ejecuta los trabajos indicados", async () => {
    const filas = [fila("a"), fila("b")];
    await procesadorCon(filas, hecho).despacharAhora(["a", "b"], T0);
    expect(filas.map((f) => f.estado)).toEqual(["HECHO", "HECHO"]);
  });

  it("sin ids no hace nada", async () => {
    await expect(procesadorCon([], hecho).despacharAhora([], T0)).resolves.toBeUndefined();
  });

  it("si el manejador falla, no propaga: el trabajo queda PENDIENTE con el error", async () => {
    const filas = [fila("a")];
    await expect(
      procesadorCon(filas, () => {
        throw new Error("explotó");
      }).despacharAhora(["a"], T0),
    ).resolves.toBeUndefined();
    expect(filas[0]).toMatchObject({
      estado: "PENDIENTE",
      intentos: 1,
      ultimoError: "Error: explotó",
    });
  });

  it("si ni la cola responde, no propaga: informa", async () => {
    const problemas: ProblemaDelProcesador[] = [];
    const p = crearProcesadorDeTrabajos({
      transacciones: {
        ejecutar: () => {
          throw new Error("síncrono y fatal");
        },
      },
      manejadores: new Map(),
      alRegistrarProblema: (x) => problemas.push(x),
    });
    await expect(p.despacharAhora(["a", "b"], T0)).resolves.toBeUndefined();
    expect(problemas.map((x) => [x.trabajoId, x.fase])).toEqual([
      ["a", "tomar"],
      ["b", "tomar"],
    ]);
  });

  it("si algo falla fuera de un trabajo (ids que no se pueden recorrer), tampoco propaga: informa", async () => {
    const problemas: ProblemaDelProcesador[] = [];
    const p = procesadorCon([], hecho, { problemas });
    const roto = {
      length: 1,
      [Symbol.iterator]() {
        throw new Error("no se puede recorrer");
      },
    } as unknown as readonly string[];
    await expect(p.despacharAhora(roto, T0)).resolves.toBeUndefined();
    expect(problemas).toEqual([
      { trabajoId: null, fase: "despachar", mensaje: "Error: no se puede recorrer" },
    ]);
  });

  it("no demora más que el tope aunque el manejador no termine", async () => {
    const filas = [fila("a")];
    const colgado: ManejadorDeTrabajo = () => new Promise(() => undefined);
    const inicio = performance.now();
    await procesadorCon(filas, colgado, { tope: 30 }).despacharAhora(["a"], T0);
    const demora = performance.now() - inicio;
    expect(demora).toBeLessThan(1_000);
    // Quedó EN_CURSO con su plazo: el cron lo retoma cuando venza.
    expect(filas[0]).toMatchObject({ estado: "EN_CURSO", intentos: 1 });
  });

  it("con esperarHastaTerminar no corta a los 5 s: espera a un manejador más lento que el tope y el trabajo queda HECHO", async () => {
    const filas = [fila("a")];
    const lento: ManejadorDeTrabajo = async () => {
      await new Promise((resolver) => setTimeout(resolver, 120));
      return { tipo: "HECHO" };
    };
    // El tope (20 ms) vence mucho antes de que el manejador termine.
    await procesadorCon(filas, lento, { tope: 20 }).despacharAhora(["a"], T0, {
      esperarHastaTerminar: true,
    });
    expect(filas[0]).toMatchObject({ estado: "HECHO", intentos: 1 });
    // Sin la opción, el mismo caso devuelve el control a los 20 ms y el trabajo sigue EN_CURSO.
    const otras = [fila("b")];
    await procesadorCon(otras, lento, { tope: 20 }).despacharAhora(["b"], T0);
    expect(otras[0]).toMatchObject({ estado: "EN_CURSO" });
  });

  it("un trabajo que otro ya tomó no se ejecuta de nuevo", async () => {
    const filas = [fila("a")];
    let ejecuciones = 0;
    const contar: ManejadorDeTrabajo = () => {
      ejecuciones += 1;
      return Promise.resolve({ tipo: "HECHO" });
    };
    const p = procesadorCon(filas, contar);
    await Promise.all([p.despacharAhora(["a"], T0), p.despacharAhora(["a"], T0)]);
    expect(ejecuciones).toBe(1);
  });
});

describe("despacharPorClaves", () => {
  const empresa = empresaId("11111111-1111-4111-8111-111111111111");

  it("busca los trabajos de ESA empresa con esas claves y despacha solo esos", async () => {
    const filas = [fila("a"), fila("b"), fila("c")];
    const pedidos: { empresa: string; claves: readonly string[] }[] = [];
    const p = procesadorCon(filas, hecho, {
      porClaves: (e, claves) => {
        pedidos.push({ empresa: e, claves });
        return Promise.resolve(["b"]);
      },
    });
    await p.despacharPorClaves(empresa, ["fiscal.validar:x:1"], T0);
    expect(pedidos).toEqual([{ empresa, claves: ["fiscal.validar:x:1"] }]);
    expect(filas.map((f) => f.estado)).toEqual(["PENDIENTE", "HECHO", "PENDIENTE"]);
  });

  it("con esperarHastaTerminar pasa la opción al despacho: espera a un manejador más lento que el tope", async () => {
    const filas = [fila("a")];
    const lento: ManejadorDeTrabajo = async () => {
      await new Promise((resolver) => setTimeout(resolver, 120));
      return { tipo: "HECHO" };
    };
    const p = procesadorCon(filas, lento, { tope: 20, porClaves: () => Promise.resolve(["a"]) });
    await p.despacharPorClaves(empresa, ["k"], T0, { esperarHastaTerminar: true });
    expect(filas[0]).toMatchObject({ estado: "HECHO" });
  });

  it("sin claves no consulta la cola ni ejecuta nada", async () => {
    const filas = [fila("a")];
    let consultas = 0;
    const p = procesadorCon(filas, hecho, {
      porClaves: () => {
        consultas += 1;
        return Promise.resolve(["a"]);
      },
    });
    await p.despacharPorClaves(empresa, [], T0);
    expect(consultas).toBe(0);
    expect(filas[0]?.estado).toBe("PENDIENTE");
  });

  it("una clave sin trabajo (otra empresa, o uno que ya no existe) no ejecuta nada", async () => {
    const filas = [fila("a")];
    await procesadorCon(filas, hecho, { porClaves: () => Promise.resolve([]) }).despacharPorClaves(
      empresa,
      ["fiscal.validar:x:1"],
      T0,
    );
    expect(filas[0]?.estado).toBe("PENDIENTE");
  });

  it("si la cola no responde al buscar, no lanza: lo informa y queda para el cron", async () => {
    const filas = [fila("a")];
    const problemas: ProblemaDelProcesador[] = [];
    const p = procesadorCon(filas, hecho, {
      problemas,
      porClaves: () => Promise.reject(new Error("falló postgres://usuario:clave@host/base")),
    });
    await expect(p.despacharPorClaves(empresa, ["k"], T0)).resolves.toBeUndefined();
    expect(filas[0]?.estado).toBe("PENDIENTE");
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatchObject({ trabajoId: null, fase: "despachar" });
    expect(problemas[0]?.mensaje).not.toContain("clave@");
  });
});
