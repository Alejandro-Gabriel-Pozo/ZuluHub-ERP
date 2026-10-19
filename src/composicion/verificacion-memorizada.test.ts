import { describe, expect, it } from "vitest";
import { verificacionMemorizada } from "./verificacion-memorizada";

function armar(opciones: {
  respuestas: (boolean | Error)[];
  si?: number;
  no?: number;
  inicio?: number;
}) {
  let reloj = opciones.inicio ?? 1_000;
  const respuestas = [...opciones.respuestas];
  const estado = { consultas: 0 };
  const verificar = () => {
    estado.consultas += 1;
    const r = respuestas.shift();
    if (r === undefined) return Promise.reject(new Error("sin respuesta preparada"));
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  const preguntar = verificacionMemorizada({
    verificar,
    ahora: () => reloj,
    vigenciaDelSiEnMs: opciones.si ?? Infinity,
    vigenciaDelNoEnMs: opciones.no ?? 10_000,
  });
  return {
    preguntar,
    estado,
    avanzar: (ms: number) => {
      reloj += ms;
    },
  };
}

describe("verificacionMemorizada", () => {
  it("un «sí» con vigencia infinita se memoriza para siempre", async () => {
    const v = armar({ respuestas: [true] });
    expect(await v.preguntar()).toBe(true);
    v.avanzar(10 ** 12);
    expect(await v.preguntar()).toBe(true);
    expect(v.estado.consultas).toBe(1);
  });

  it("un «no» se memoriza durante la espera y se vuelve a preguntar justo al cumplirse", async () => {
    const v = armar({ respuestas: [false, false, true], no: 10_000 });
    expect(await v.preguntar()).toBe(false);
    v.avanzar(9_999);
    expect(await v.preguntar()).toBe(false);
    expect(v.estado.consultas).toBe(1);
    v.avanzar(1);
    expect(await v.preguntar()).toBe(false);
    expect(v.estado.consultas).toBe(2);
    v.avanzar(10_000);
    expect(await v.preguntar()).toBe(true);
    expect(v.estado.consultas).toBe(3);
  });

  it("un «sí» con vigencia finita también vence, justo al cumplirse", async () => {
    const v = armar({ respuestas: [true, true], si: 5_000 });
    expect(await v.preguntar()).toBe(true);
    v.avanzar(4_999);
    await v.preguntar();
    expect(v.estado.consultas).toBe(1);
    v.avanzar(1);
    await v.preguntar();
    expect(v.estado.consultas).toBe(2);
  });

  it("usa la vigencia del «sí» para un sí y la del «no» para un no (no al revés)", async () => {
    const conSi = armar({ respuestas: [true, true], si: 100, no: 100_000 });
    await conSi.preguntar();
    conSi.avanzar(100);
    await conSi.preguntar();
    expect(conSi.estado.consultas).toBe(2);
    const conNo = armar({ respuestas: [false, false], si: 100_000, no: 100 });
    await conNo.preguntar();
    conNo.avanzar(100);
    await conNo.preguntar();
    expect(conNo.estado.consultas).toBe(2);
  });

  it("si verificar lanza, es un «no» (falla cerrado) y se vuelve a intentar pasada la espera", async () => {
    const v = armar({ respuestas: [new Error("se cayó"), true] });
    expect(await v.preguntar()).toBe(false);
    expect(await v.preguntar()).toBe(false);
    expect(v.estado.consultas).toBe(1);
    v.avanzar(10_000);
    expect(await v.preguntar()).toBe(true);
  });

  it("los pedidos simultáneos comparten una sola consulta", async () => {
    const v = armar({ respuestas: [true] });
    const todos = await Promise.all([v.preguntar(), v.preguntar(), v.preguntar(), v.preguntar()]);
    expect(todos).toEqual([true, true, true, true]);
    expect(v.estado.consultas).toBe(1);
  });

  it("después de una consulta fallida en vuelo, la siguiente espera se cuenta desde que terminó", async () => {
    let reloj = 0;
    let liberar: (valor: boolean) => void = () => undefined;
    const preguntar = verificacionMemorizada({
      verificar: () =>
        new Promise<boolean>((resolver) => {
          liberar = resolver;
        }),
      ahora: () => reloj,
      vigenciaDelSiEnMs: Infinity,
      vigenciaDelNoEnMs: 1_000,
    });
    const pendiente = preguntar();
    reloj = 5_000;
    liberar(false);
    expect(await pendiente).toBe(false);
    // Vale hasta 5_000 + 1_000, no hasta 0 + 1_000.
    reloj = 5_999;
    expect(await preguntar()).toBe(false);
    reloj = 6_000;
    const otra = preguntar();
    liberar(true);
    expect(await otra).toBe(true);
  });

  it("cada instancia tiene su propia memoria", async () => {
    const a = armar({ respuestas: [true] });
    const b = armar({ respuestas: [false] });
    expect(await a.preguntar()).toBe(true);
    expect(await b.preguntar()).toBe(false);
  });
});
