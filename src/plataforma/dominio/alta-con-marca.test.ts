import { describe, expect, it } from "vitest";
import type { DefinicionDeMarca, DatosDeMarcaParaElAlta } from "../../modulos/marcas/publico";
import type { Host } from "../../modulos/marcas/publico";
import type { ModuloParaActivar, VersionDePlanAsignable } from "../../modulos/planes/publico";
import { marcaComercialId, planId, versionDePlanId } from "../../primitivas/identificadores/marca";
import {
  decidirMarcaDelAlta,
  decidirModulosIniciales,
  decidirPlanElegido,
  decidirPlanPorDefecto,
} from "./alta-con-marca";

const error = <E>(e: E) => ({ ok: false, error: e });
const PLAN_A = planId("plan-a");
const PLAN_B = planId("plan-b");

const definicion = (cambios: Partial<DefinicionDeMarca> = {}): DefinicionDeMarca => ({
  nombreVisible: "Mi Calendario",
  tema: {},
  logo: null,
  vocabulario: {},
  modulosIniciales: ["turnos"],
  planPorDefectoId: PLAN_A,
  ...cambios,
});

const marca = (cambios: Partial<DatosDeMarcaParaElAlta> = {}): DatosDeMarcaParaElAlta => ({
  marcaId: marcaComercialId("m-1"),
  estado: "ACTIVA",
  esPrincipal: false,
  cadena: [definicion()],
  hostCanonico: "mi.calendario.test" as Host,
  ...cambios,
});

describe("decidirMarcaDelAlta", () => {
  it("una marca activa, con versión vigente y dominio: sus módulos iniciales y su plan por defecto", () => {
    expect(decidirMarcaDelAlta(marca())).toEqual({
      ok: true,
      valor: { modulosIniciales: ["turnos"], planPorDefectoId: PLAN_A },
    });
  });

  it("una marca que no existe es MARCA_NO_ENCONTRADA", () => {
    expect(decidirMarcaDelAlta(null)).toEqual(error("MARCA_NO_ENCONTRADA"));
  });

  it("una marca retirada es MARCA_RETIRADA, aunque lo demás esté completo", () => {
    expect(decidirMarcaDelAlta(marca({ estado: "RETIRADA" }))).toEqual(error("MARCA_RETIRADA"));
  });

  it("la propia marca sin versión vigente es MARCA_SIN_DEFINICION, aunque el padre sí tenga", () => {
    expect(decidirMarcaDelAlta(marca({ cadena: [null, definicion()] }))).toEqual(
      error("MARCA_SIN_DEFINICION"),
    );
    expect(decidirMarcaDelAlta(marca({ cadena: [null] }))).toEqual(error("MARCA_SIN_DEFINICION"));
    expect(decidirMarcaDelAlta(marca({ cadena: [] }))).toEqual(error("MARCA_SIN_DEFINICION"));
  });

  it("una versión sin nombre visible no define a la marca: MARCA_SIN_DEFINICION (un producto no hereda el nombre)", () => {
    expect(
      decidirMarcaDelAlta(marca({ cadena: [definicion({ nombreVisible: null }), definicion()] })),
    ).toEqual(error("MARCA_SIN_DEFINICION"));
  });

  it("una marca que no es la principal y no tiene dominio canónico es MARCA_SIN_DOMINIO", () => {
    expect(decidirMarcaDelAlta(marca({ hostCanonico: null }))).toEqual(error("MARCA_SIN_DOMINIO"));
  });

  it("la principal sin dominio canónico sí puede: el mail cae en el respaldo del entorno", () => {
    expect(decidirMarcaDelAlta(marca({ esPrincipal: true, hostCanonico: null })).ok).toBe(true);
  });

  it("precedencia: no encontrada, retirada, sin definición y sin dominio", () => {
    const peor = marca({ estado: "RETIRADA", cadena: [null], hostCanonico: null });
    expect(decidirMarcaDelAlta(peor)).toEqual(error("MARCA_RETIRADA"));
    expect(decidirMarcaDelAlta({ ...peor, estado: "ACTIVA" })).toEqual(
      error("MARCA_SIN_DEFINICION"),
    );
    expect(decidirMarcaDelAlta({ ...peor, estado: "ACTIVA", cadena: [definicion()] })).toEqual(
      error("MARCA_SIN_DOMINIO"),
    );
  });

  it("un producto hereda los módulos iniciales y el plan por defecto que no define (campo vacío = hereda)", () => {
    const producto = definicion({ modulosIniciales: null, planPorDefectoId: null });
    const principal = definicion({
      modulosIniciales: ["reservas", "caja"],
      planPorDefectoId: PLAN_B,
    });
    expect(decidirMarcaDelAlta(marca({ cadena: [producto, principal] }))).toEqual({
      ok: true,
      valor: { modulosIniciales: ["reservas", "caja"], planPorDefectoId: PLAN_B },
    });
  });

  it("lo que el producto define le gana al padre; una lista vacía NO es «sin definir» (solo administración)", () => {
    const producto = definicion({ modulosIniciales: [], planPorDefectoId: PLAN_A });
    const principal = definicion({ modulosIniciales: ["reservas"], planPorDefectoId: PLAN_B });
    expect(decidirMarcaDelAlta(marca({ cadena: [producto, principal] }))).toEqual({
      ok: true,
      valor: { modulosIniciales: [], planPorDefectoId: PLAN_A },
    });
  });

  it("ninguna versión de la cadena define los módulos ni el plan: sin módulos y sin plan por defecto", () => {
    const vacia = definicion({ modulosIniciales: null, planPorDefectoId: null });
    expect(decidirMarcaDelAlta(marca({ cadena: [vacia, vacia] }))).toEqual({
      ok: true,
      valor: { modulosIniciales: [], planPorDefectoId: null },
    });
  });
});

const version = (cambios: Partial<VersionDePlanAsignable> = {}): VersionDePlanAsignable => ({
  versionDePlanId: versionDePlanId("v-1"),
  planId: PLAN_A,
  publicada: true,
  planRetirado: false,
  ...cambios,
});

describe("decidirPlanElegido", () => {
  it("una versión publicada de un plan activo: su id", () => {
    expect(decidirPlanElegido(version())).toEqual({ ok: true, valor: versionDePlanId("v-1") });
  });

  it("no existe, es un borrador o su plan está retirado, en ese orden", () => {
    expect(decidirPlanElegido(null)).toEqual(error("VERSION_DE_PLAN_NO_ENCONTRADA"));
    expect(decidirPlanElegido(version({ publicada: false }))).toEqual(
      error("VERSION_DE_PLAN_NO_PUBLICADA"),
    );
    expect(decidirPlanElegido(version({ planRetirado: true }))).toEqual(error("PLAN_RETIRADO"));
    expect(decidirPlanElegido(version({ publicada: false, planRetirado: true }))).toEqual(
      error("VERSION_DE_PLAN_NO_PUBLICADA"),
    );
  });
});

describe("decidirPlanPorDefecto", () => {
  it("la última versión publicada de un plan activo: su id", () => {
    expect(decidirPlanPorDefecto(version())).toEqual({ ok: true, valor: versionDePlanId("v-1") });
  });

  it("sin versión que asignar, o con el plan retirado, la marca no tiene plan por defecto", () => {
    expect(decidirPlanPorDefecto(null)).toEqual(error("MARCA_SIN_PLAN_POR_DEFECTO"));
    expect(decidirPlanPorDefecto(version({ publicada: false }))).toEqual(
      error("MARCA_SIN_PLAN_POR_DEFECTO"),
    );
    expect(decidirPlanPorDefecto(version({ planRetirado: true }))).toEqual(
      error("MARCA_SIN_PLAN_POR_DEFECTO"),
    );
  });
});

describe("decidirModulosIniciales", () => {
  const modulo = (cambios: Partial<ModuloParaActivar> = {}): ModuloParaActivar => ({
    estado: "disponible",
    obligatorio: false,
    requiere: [],
    ...cambios,
  });
  const catalogo: Record<string, ModuloParaActivar> = {
    administracion: modulo({ obligatorio: true }),
    reservas: modulo({ requiere: ["administracion"] }),
    caja: modulo({ requiere: ["administracion"] }),
    ventas: modulo({ requiere: ["caja"] }),
    informes: modulo({ requiere: ["ventas", "reservas"] }),
    stock: modulo({ estado: "en_desarrollo" }),
  };
  const TECHO = ["administracion", "reservas", "caja", "ventas", "informes", "stock"];

  it("los iniciales que el plan incluye quedan activos, en el orden de la marca", () => {
    expect(decidirModulosIniciales(catalogo, ["reservas", "caja"], TECHO)).toEqual({
      activar: ["reservas", "caja"],
      omitidos: [],
    });
  });

  it("sin módulos iniciales no activa nada", () => {
    expect(decidirModulosIniciales(catalogo, [], TECHO)).toEqual({ activar: [], omitidos: [] });
  });

  it("lo que el plan no incluye se omite con su motivo, sin frenar el resto", () => {
    expect(
      decidirModulosIniciales(catalogo, ["reservas", "caja"], ["administracion", "caja"]),
    ).toEqual({
      activar: ["caja"],
      omitidos: [{ modulo: "reservas", motivo: "MODULO_FUERA_DEL_PLAN" }],
    });
  });

  it("un módulo que no existe, uno obligatorio y uno en desarrollo se omiten, cada uno con su motivo", () => {
    expect(
      decidirModulosIniciales(catalogo, ["fantasma", "administracion", "stock", "caja"], TECHO),
    ).toEqual({
      activar: ["caja"],
      omitidos: [
        { modulo: "fantasma", motivo: "MODULO_DESCONOCIDO" },
        { modulo: "administracion", motivo: "MODULO_OBLIGATORIO" },
        { modulo: "stock", motivo: "MODULO_EN_DESARROLLO" },
      ],
    });
  });

  it("un módulo cuyo requerido viene después en la lista se activa cuando el requerido ya está", () => {
    expect(decidirModulosIniciales(catalogo, ["ventas", "caja"], TECHO)).toEqual({
      activar: ["caja", "ventas"],
      omitidos: [],
    });
    // Una cadena de tres: informes necesita ventas (que necesita caja) y reservas.
    expect(
      decidirModulosIniciales(catalogo, ["informes", "ventas", "reservas", "caja"], TECHO),
    ).toEqual({ activar: ["reservas", "caja", "ventas", "informes"], omitidos: [] });
  });

  it("un módulo cuyo requerido no está en la lista (o quedó omitido) se omite: REQUIERE_INACTIVO", () => {
    expect(decidirModulosIniciales(catalogo, ["ventas"], TECHO)).toEqual({
      activar: [],
      omitidos: [{ modulo: "ventas", motivo: "REQUIERE_INACTIVO" }],
    });
    // `caja` queda fuera del techo: `ventas` no puede activarse sin ella.
    expect(
      decidirModulosIniciales(catalogo, ["caja", "ventas"], ["administracion", "ventas"]),
    ).toEqual({
      activar: [],
      omitidos: [
        { modulo: "caja", motivo: "MODULO_FUERA_DEL_PLAN" },
        { modulo: "ventas", motivo: "REQUIERE_INACTIVO" },
      ],
    });
  });

  it("los repetidos cuentan una vez", () => {
    expect(decidirModulosIniciales(catalogo, ["caja", "reservas", "caja"], TECHO)).toEqual({
      activar: ["caja", "reservas"],
      omitidos: [],
    });
  });

  it("no modifica sus entradas", () => {
    const iniciales = ["ventas", "caja"];
    const techo = [...TECHO];
    decidirModulosIniciales(catalogo, iniciales, techo);
    expect(iniciales).toEqual(["ventas", "caja"]);
    expect(techo).toEqual(TECHO);
  });
});
