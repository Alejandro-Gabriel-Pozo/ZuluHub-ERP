import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../../primitivas/resultado/resultado";
import {
  CAPACIDAD_DE_LA_MEMORIA_DE_LOGOS,
  crearMemoriaDeLogos,
  RETENCION_DE_FALLOS_MS,
} from "./memoria-de-logos";

const bytes = (n: number): Uint8Array => new Uint8Array([n]);
const bueno = (n: number) => vi.fn(() => Promise.resolve(ok(bytes(n))));
const definitivo = () => vi.fn(() => Promise.resolve(err("DEFINITIVO" as const)));
const transitorio = () => vi.fn(() => Promise.resolve(err("TRANSITORIO" as const)));

describe("los valores de producción", () => {
  it("200 logos y 5 minutos de fallo", () => {
    expect(CAPACIDAD_DE_LA_MEMORIA_DE_LOGOS).toBe(200);
    expect(RETENCION_DE_FALLOS_MS).toBe(300_000);
  });
});

describe("lo bueno", () => {
  it("se guarda: el segundo pedido no vuelve a viajar", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    const traer = bueno(1);
    expect(await memoria.obtener("a", traer)).toEqual(bytes(1));
    expect(await memoria.obtener("a", traer)).toEqual(bytes(1));
    expect(traer).toHaveBeenCalledTimes(1);
  });

  it("cada clave tiene lo suyo", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    expect(await memoria.obtener("a", bueno(1))).toEqual(bytes(1));
    expect(await memoria.obtener("b", bueno(2))).toEqual(bytes(2));
    expect(await memoria.obtener("a", bueno(9))).toEqual(bytes(1));
  });

  it("con la capacidad llena sale el MENOS USADO, no el más viejo", async () => {
    const memoria = crearMemoriaDeLogos(() => 0, { capacidad: 2 });
    await memoria.obtener("a", bueno(1));
    await memoria.obtener("b", bueno(2));
    await memoria.obtener("a", bueno(9)); // a se usó: ahora el menos usado es b
    await memoria.obtener("c", bueno(3)); // entra c, sale b
    const deA = bueno(10);
    const deB = bueno(20);
    const deC = bueno(30);
    expect(await memoria.obtener("a", deA)).toEqual(bytes(1));
    expect(await memoria.obtener("c", deC)).toEqual(bytes(3));
    expect(await memoria.obtener("b", deB)).toEqual(bytes(20));
    expect(deA).not.toHaveBeenCalled();
    expect(deC).not.toHaveBeenCalled();
    expect(deB).toHaveBeenCalledTimes(1);
  });

  it("nunca guarda más que la capacidad (200 por omisión)", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    for (let i = 0; i < CAPACIDAD_DE_LA_MEMORIA_DE_LOGOS + 5; i += 1) {
      await memoria.obtener(`k${i}`, bueno(i % 250));
    }
    const primero = bueno(1);
    await memoria.obtener("k0", primero);
    expect(primero).toHaveBeenCalledTimes(1);
    const ultimo = bueno(1);
    await memoria.obtener(`k${CAPACIDAD_DE_LA_MEMORIA_DE_LOGOS + 4}`, ultimo);
    expect(ultimo).not.toHaveBeenCalled();
  });
});

describe("lo que falla de forma definitiva", () => {
  it("se recuerda 5 minutos: no se vuelve a pedir, ni siquiera con otro `traer` bueno", async () => {
    let t = 1_000;
    const memoria = crearMemoriaDeLogos(() => t);
    const roto = definitivo();
    expect(await memoria.obtener("a", roto)).toBeNull();
    t += RETENCION_DE_FALLOS_MS - 1;
    const bien = bueno(1);
    expect(await memoria.obtener("a", bien)).toBeNull();
    expect(bien).not.toHaveBeenCalled();
    expect(roto).toHaveBeenCalledTimes(1);
  });

  it("pasados los 5 minutos justos se vuelve a intentar", async () => {
    let t = 1_000;
    const memoria = crearMemoriaDeLogos(() => t);
    await memoria.obtener("a", definitivo());
    t += RETENCION_DE_FALLOS_MS;
    const bien = bueno(7);
    expect(await memoria.obtener("a", bien)).toEqual(bytes(7));
    expect(bien).toHaveBeenCalledTimes(1);
  });

  it("el fallo de una clave no toca a otra", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    await memoria.obtener("a", definitivo());
    expect(await memoria.obtener("b", bueno(2))).toEqual(bytes(2));
  });

  it("los fallos recordados también están acotados", async () => {
    const memoria = crearMemoriaDeLogos(() => 0, { capacidad: 2 });
    await memoria.obtener("a", definitivo());
    await memoria.obtener("b", definitivo());
    await memoria.obtener("c", definitivo()); // sale a
    const deA = bueno(1);
    expect(await memoria.obtener("a", deA)).toEqual(bytes(1));
    expect(deA).toHaveBeenCalledTimes(1);
    const deC = bueno(3);
    expect(await memoria.obtener("c", deC)).toBeNull();
    expect(deC).not.toHaveBeenCalled();
  });

  it("la retención se puede cambiar", async () => {
    let t = 0;
    const memoria = crearMemoriaDeLogos(() => t, { retencionDeFallosMs: 10 });
    await memoria.obtener("a", definitivo());
    t = 9;
    expect(await memoria.obtener("a", bueno(1))).toBeNull();
    t = 10;
    expect(await memoria.obtener("a", bueno(1))).toEqual(bytes(1));
  });
});

describe("lo transitorio", () => {
  it("no se recuerda: el pedido siguiente vuelve a intentar", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    const ocupado = transitorio();
    expect(await memoria.obtener("a", ocupado)).toBeNull();
    const bien = bueno(1);
    expect(await memoria.obtener("a", bien)).toEqual(bytes(1));
    expect(ocupado).toHaveBeenCalledTimes(1);
    expect(bien).toHaveBeenCalledTimes(1);
  });
});

describe("los pedidos a la vez", () => {
  it("100 pedidos iguales juntos hacen UN solo viaje y todos reciben lo mismo", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    let abrir: (() => void) | undefined;
    const traer = vi.fn(
      () =>
        new Promise<ReturnType<typeof ok<Uint8Array>>>((resolver) => {
          abrir = () => resolver(ok(bytes(5)));
        }),
    );
    const pedidos = Array.from({ length: 100 }, () => memoria.obtener("a", traer));
    abrir?.();
    const todos = await Promise.all(pedidos);
    expect(traer).toHaveBeenCalledTimes(1);
    expect(todos.every((r) => r !== null && r[0] === 5)).toBe(true);
  });

  it("claves distintas viajan por separado", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    const a = bueno(1);
    const b = bueno(2);
    await Promise.all([memoria.obtener("a", a), memoria.obtener("b", b)]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("un viaje que falla de forma definitiva da null a todos los que esperaban", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    const traer = vi.fn(() => Promise.resolve(err("DEFINITIVO" as const)));
    const todos = await Promise.all([memoria.obtener("a", traer), memoria.obtener("a", traer)]);
    expect(todos).toEqual([null, null]);
    expect(traer).toHaveBeenCalledTimes(1);
  });

  it("si `traer` lanza, el error llega y el lugar del viaje se libera", async () => {
    const memoria = crearMemoriaDeLogos(() => 0);
    await expect(memoria.obtener("a", () => Promise.reject(new Error("se cayó")))).rejects.toThrow(
      "se cayó",
    );
    const bien = bueno(1);
    expect(await memoria.obtener("a", bien)).toEqual(bytes(1));
    expect(bien).toHaveBeenCalledTimes(1);
  });
});
