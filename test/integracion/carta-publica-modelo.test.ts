import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarVistaDeVidriera } from "../../src/capacidades/experiencia/vidriera/vista";
import { deLaMarca } from "../utilidades/alcance-del-host";
import { montarCatalogo, precioDeBase } from "./catalogo-apoyo";
import { cartaDeBase, empresaDeCarta } from "./carta-publica-apoyo";
import {
  MARCA_DEL_HOST,
  adaptadorReal,
  asignarVersion,
  darleLaCartaAlPlan,
  type Catalogo,
} from "./carta-publica-lectura-apoyo";
import type { BaseDePruebas } from "./global";
import { crearPlanPublicado } from "./marcas-apoyo";

/**
 * L1 del modelo Libro contra la base real y el rol público: qué modelo se DIBUJA lo decide la lectura de cada visita con lo que la carta eligió y las perillas del plan de la empresa. Con la perilla
 * `vidriera_modelo_libro` apagada (todas las empresas de hoy) la carta se ve EXACTAMENTE como Lista aunque guarde Libro; encendida, Libro; con `Save-Data: on`, Lista; una baja de plan la deja en Lista
 * y la carta sigue sirviéndose; y lo de una empresa no toca a otra. Nada de esto cambia lo que se pinta todavía (la plantilla dibuja Lista): es la decisión, probada aparte.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const despues = (): Date => new Date(Date.now() + 120_000);

describe.skipIf(base === null)("el modelo efectivo de la carta pública", () => {
  let c: Catalogo;
  let vidriera: ReturnType<typeof adaptadorReal>["vidriera"];
  let publicas: ReturnType<typeof adaptadorReal>["publicas"];
  beforeAll(async () => {
    c = await montarCatalogo(base as BaseDePruebas);
    ({ vidriera, publicas } = adaptadorReal(c, despues));
  });
  afterAll(async () => {
    await publicas.cerrar();
    await c.cerrar();
  });

  const empresaConCarta = async (modelo: string) => {
    const e = await empresaDeCarta(c.entorno, c.dueno);
    const seccion = randomUUID();
    await c.dueno.query(
      "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden, activa) values ($1, $2, 'Platos', 'platos', 0, true)",
      [seccion, e.empresa],
    );
    await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
      e.producto,
      seccion,
    ]);
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto: e.producto,
      precio: "1500",
      desde: "2026-10-01T00:00:00Z",
    });
    const carta = await cartaDeBase(c.dueno, e.empresa, e.s1, { nombre: "Parador" });
    await c.dueno.query("update carta_publica set modelo = $2 where id = $1", [carta.id, modelo]);
    const plan = await darleLaCartaAlPlan(c, e.empresa);
    return { ...e, carta, plan };
  };
  /** Cambia el plan del tenant (vigente desde la fecha dada): con o sin la perilla del Libro. */
  const cambiarElPlan = async (tenant: string, desde: string, conLibro: boolean): Promise<void> => {
    const { version } = await crearPlanPublicado(c.dueno, {
      modulos: ["catalogo", "vidriera"],
      perillas: {
        vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
        ...(conLibro ? { vidriera_modelo_libro: { tipo: "INTERRUPTOR", encendida: true } } : {}),
      },
    });
    await asignarVersion(c, tenant, version, desde);
  };
  const leer = async (codigo: string) => {
    const publicada = await vidriera.porCodigo(deLaMarca(MARCA_DEL_HOST), codigo);
    if (publicada === null) throw new Error("la carta tendría que servirse");
    return publicada;
  };
  const modeloDe = async (codigo: string, ahorroDeDatos = false) =>
    armarVistaDeVidriera(await leer(codigo), `/${codigo}`, ahorroDeDatos).modelo;

  it("con la perilla apagada, una carta que guardó Libro se dibuja como Lista (lo de hoy para todas las empresas)", async () => {
    const m = await empresaConCarta("LIBRO");
    const publicada = await leer(m.carta.codigo);
    expect(publicada.identidad.modelo).toBe("LIBRO");
    expect(publicada.perillasDeModelo).toEqual([]);
    expect(await modeloDe(m.carta.codigo)).toBe("LISTA");
  });

  it("con la perilla encendida se dibuja Libro; una carta que guardó Lista sigue en Lista", async () => {
    const m = await empresaConCarta("LIBRO");
    await cambiarElPlan(m.plan.tenant, "2026-10-02T00:00:00Z", true);
    expect((await leer(m.carta.codigo)).perillasDeModelo).toEqual(["vidriera_modelo_libro"]);
    expect(await modeloDe(m.carta.codigo)).toBe("LIBRO");
    await c.dueno.query("update carta_publica set modelo = 'LISTA' where id = $1", [m.carta.id]);
    expect(await modeloDe(m.carta.codigo)).toBe("LISTA");
  });

  it("con `Save-Data: on` se dibuja Lista aunque la perilla esté encendida", async () => {
    const m = await empresaConCarta("LIBRO");
    await cambiarElPlan(m.plan.tenant, "2026-10-02T00:00:00Z", true);
    expect(await modeloDe(m.carta.codigo, true)).toBe("LISTA");
    expect(await modeloDe(m.carta.codigo, false)).toBe("LIBRO");
  });

  it("una baja de plan (se apaga la perilla) deja la carta en Lista y la carta sigue sirviéndose", async () => {
    const m = await empresaConCarta("LIBRO");
    await cambiarElPlan(m.plan.tenant, "2026-10-02T00:00:00Z", true);
    expect(await modeloDe(m.carta.codigo)).toBe("LIBRO");
    await cambiarElPlan(m.plan.tenant, "2026-10-03T00:00:00Z", false);
    expect(await modeloDe(m.carta.codigo)).toBe("LISTA");
  });

  it("aislamiento: la perilla de una empresa no enciende el Libro de otra", async () => {
    const con = await empresaConCarta("LIBRO");
    const sin = await empresaConCarta("LIBRO");
    await cambiarElPlan(con.plan.tenant, "2026-10-02T00:00:00Z", true);
    expect(await modeloDe(con.carta.codigo)).toBe("LIBRO");
    expect(await modeloDe(sin.carta.codigo)).toBe("LISTA");
  });

  it("una carta que guardó un modelo cuya perilla todavía no está declarada (Cuadrícula) se lee sin romper y se dibuja como Lista", async () => {
    const m = await empresaConCarta("CUADRICULA");
    await cambiarElPlan(m.plan.tenant, "2026-10-02T00:00:00Z", true);
    expect((await leer(m.carta.codigo)).perillasDeModelo).toEqual(["vidriera_modelo_libro"]);
    expect(await modeloDe(m.carta.codigo)).toBe("LISTA");
  });
});
