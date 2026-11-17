import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  armarElFormularioDeImpresora,
  armarLaListaDeImpresoras,
  PAPELES,
  RUTA_DE_IMPRESORAS,
  USOS,
  type ImpresoraDeLaLista,
} from "../../apps/web/ui/plantillas/salon/modelo-de-impresoras";
import {
  armarLosTextosDeImprimir,
  hojaDePrueba,
} from "../../apps/web/ui/patrones/papel/textos-de-imprimir";
import {
  altoDeLaHojaEnMm,
  reglaDeLaHojaDelPapel,
  rotuloDelAncho,
  variablesDelPapel,
} from "../../apps/web/ui/patrones/papel/hoja-del-papel";
import { PAPELES_EN_MM, USOS_DE_IMPRESORA } from "../../src/modulos/comandas/dominio/impresion";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";

/**
 * El modelo de vista de «Impresoras» (`imprimir.html`, aprobada 09/11/2026) y los textos y medidas de la pieza de impresión: uso y papel repiten los valores del dominio (una prueba falla si difieren), la lista muestra
 * solo las activas, y todo lo que cambia algo cierra salvo con `true` exacto. Previene: un uso o un papel que el servidor no conoce, un botón ofrecido por duda y papel con el tamaño del navegador.
 */
const impresora = (extra: Partial<ImpresoraDeLaLista> = {}): ImpresoraDeLaLista => ({
  id: "i1",
  nombre: "Cocina",
  uso: "COMANDA",
  papelMm: 80,
  activa: true,
  version: 1,
  ...extra,
});

describe("modelo de «Impresoras»", () => {
  it("las listas cerradas son las del dominio", () => {
    expect([...USOS]).toEqual([...USOS_DE_IMPRESORA]);
    expect([...PAPELES]).toEqual([...PAPELES_EN_MM]);
  });

  it("una fila con sus textos aprobados; el nombre lleva a editar", () => {
    const lista = armarLaListaDeImpresoras([impresora()], true);
    expect(lista.filas[0]).toMatchObject({
      nombre: "Cocina",
      papel: "80 mm",
      uso: "Comanda de cocina",
      editar: "/salon/impresoras/i1",
      prueba: "Imprimir prueba",
      quitar: { texto: "Quitar", apagado: false },
    });
    expect(lista.nueva).toEqual({
      href: "/salon/impresoras/nueva",
      texto: "Agregar impresora",
    });
    expect(lista.sinPermiso).toBeNull();
    expect(
      armarLaListaDeImpresoras([impresora({ uso: "TICKET", papelMm: 58 })], true).filas[0],
    ).toMatchObject({
      papel: "58 mm",
      uso: "Ticket del cliente",
    });
  });

  it("«Quitar» saca a la impresora de la lista: solo se muestran las activas", () => {
    const lista = armarLaListaDeImpresoras(
      [impresora(), impresora({ id: "i2", nombre: "Vieja", activa: false })],
      true,
    );
    expect(lista.filas.map((f) => f.id)).toEqual(["i1"]);
  });

  it("la lista vacía no dice nada y no inventa texto", () => {
    const lista = armarLaListaDeImpresoras([], true);
    expect(lista.filas).toEqual([]);
  });

  it("sin permiso (o con duda) nada se ofrece: «Agregar impresora» ausente, nombre y «Quitar» apagados, mensaje genérico; «Imprimir prueba» sigue (no cambia datos)", () => {
    for (const puede of [false, undefined]) {
      const lista = armarLaListaDeImpresoras([impresora()], puede);
      expect(lista.nueva).toBeNull();
      expect(lista.sinPermiso).toBe("Esta acción no está permitida");
      expect(lista.filas[0]).toMatchObject({
        editar: null,
        prueba: "Imprimir prueba",
        quitar: { apagado: true },
      });
      expect(armarElFormularioDeImpresora(null, puede).puedeGuardar).toBe(false);
    }
    expect(armarElFormularioDeImpresora(null, true).puedeGuardar).toBe(true);
  });

  it("el formulario: alta con comanda y 80 mm, edición con los datos de la impresora; títulos aprobados", () => {
    const alta = armarElFormularioDeImpresora(null, true);
    expect(alta).toMatchObject({
      titulo: "Agregar impresora",
      nombre: { etiqueta: "Nombre", valorInicial: "" },
      uso: { etiqueta: "Para qué sirve", valorInicial: "COMANDA" },
      papel: { etiqueta: "Papel", valorInicial: "80" },
      guardar: "Guardar",
      cancelar: { href: RUTA_DE_IMPRESORAS },
      volver: { href: RUTA_DE_IMPRESORAS },
    });
    expect(alta.uso.opciones.map((o) => o.etiqueta)).toEqual([
      "Comanda de cocina",
      "Ticket del cliente",
    ]);
    expect(alta.papel.opciones).toEqual([
      { valor: "58", etiqueta: "58 mm" },
      { valor: "80", etiqueta: "80 mm" },
    ]);
    const edicion = armarElFormularioDeImpresora(impresora({ uso: "TICKET", papelMm: 58 }), true);
    expect(edicion).toMatchObject({
      titulo: "Impresoras",
      nombre: { valorInicial: "Cocina" },
      uso: { valorInicial: "TICKET" },
      papel: { valorInicial: "58" },
    });
  });

  it("la fila del menú apunta a la ruta de la pantalla, con el módulo comandas y la acción de ver", () => {
    expect(
      FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "impresoras"),
    ).toMatchObject({
      area: "ventas",
      grupo: "salon",
      modulo: "comandas",
      accion: "impresoras.ver",
      href: RUTA_DE_IMPRESORAS,
      etiqueta: "comandas.texto.imprimir_impresoras",
    });
  });
});

describe("pieza de impresión: textos, hoja de prueba y medidas", () => {
  it("los textos del botón son los aprobados", () => {
    expect(armarLosTextosDeImprimir()).toEqual({
      imprimir: "Imprimir",
      imprimiendo: "Imprimiendo",
      impresa: "Impresa",
      noSePudo: "No se pudo imprimir",
      reintentar: "Reintentar",
      verEnPantalla: "Ver en pantalla",
      sinImpresora: "No hay impresora para la comanda de cocina",
    });
  });

  it("la hoja de prueba lleva solo el nombre de la impresora y su ancho, sin palabras nuevas", () => {
    expect(hojaDePrueba("Cocina", 58)).toEqual({
      ancho: 58,
      lineas: [
        { texto: "Cocina", estilo: "NEGRITA" },
        { texto: "58 mm", estilo: "NORMAL" },
      ],
    });
    expect(rotuloDelAncho(80)).toBe("80 mm");
  });

  it("la regla de página lleva el ancho de la impresora y el alto medido, y deja solo la hoja", () => {
    const regla = reglaDeLaHojaDelPapel(58, 120);
    expect(regla.startsWith("@page{size:58mm 120mm;margin:0}")).toBe(true);
    expect(regla).toContain("@media print");
    expect(regla).toContain("data-zona-de-impresion");
    expect(altoDeLaHojaEnMm(96)).toBeGreaterThan(25.4);
    expect(variablesDelPapel(80)).toEqual({ "--papel-ancho": "80mm" });
  });

  it("ni la pieza ni la pantalla escriben estilos en línea (la CSP los bloquea)", () => {
    for (const archivo of [
      "apps/web/ui/patrones/papel/PapelImpreso.cliente.tsx",
      "apps/web/ui/patrones/papel/BotonDeImprimir.cliente.tsx",
      "apps/web/ui/patrones/papel/useImpresionDelPapel.cliente.tsx",
      "apps/web/ui/plantillas/salon/BotonDePruebaDeImpresora.cliente.tsx",
      "apps/web/ui/plantillas/salon/PantallaDeListaDeImpresoras.tsx",
      "apps/web/ui/plantillas/salon/FormularioDeImpresora.cliente.tsx",
    ]) {
      const codigo = readFileSync(archivo, "utf8");
      expect(codigo, archivo).not.toMatch(/\bstyle\s*=/);
      expect(codigo, archivo).not.toMatch(/<style[\s>]/);
    }
  });
});
