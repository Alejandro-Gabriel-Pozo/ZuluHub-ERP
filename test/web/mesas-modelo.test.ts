import { describe, expect, it } from "vitest";
import { medidasDelSalon } from "../../src/composicion/mesas-web";
import { FORMAS_DE_MESA, TAMANOS_DE_MESA } from "../../src/modulos/salon/dominio/mesa";
import {
  armarElFormularioDeMesa,
  armarLaListaDeMesas,
  FORMAS,
  TAMANOS,
  type MesaDeLaLista,
} from "../../apps/web/ui/plantillas/salon/modelo-de-mesas";

/**
 * El modelo de vista de «Mesas» (`mesas.html`, aprobada 09/11/2026): forma y tamaño repiten los valores del dominio (una prueba falla si difieren), la lista muestra activas y desactivadas, y todo lo
 * que cambia algo cierra salvo con `true` exacto. Previene: una forma que el servidor no conoce, o un botón ofrecido por duda.
 */
const medidas = medidasDelSalon();
const salon = { medidas, mesas: [] as readonly MesaDeLaLista[] };
const mesa = (extra: Partial<MesaDeLaLista> = {}): MesaDeLaLista => ({
  id: "m1",
  numero: 7,
  forma: "REDONDA",
  tamano: "CHICA",
  columna: 1,
  fila: 2,
  activa: true,
  version: 1,
  ...extra,
});

describe("modelo de «Mesas»", () => {
  it("las listas cerradas son las del dominio", () => {
    expect(FORMAS.map((f) => f.valor)).toEqual([...FORMAS_DE_MESA]);
    expect(TAMANOS.map((t) => t.valor)).toEqual([...TAMANOS_DE_MESA]);
  });

  it("una fila con sus textos aprobados; «Tamaño» y no «medida»", () => {
    const lista = armarLaListaDeMesas([mesa()], true, medidas);
    expect(lista.filas[0]).toMatchObject({
      titulo: "Mesa 7",
      marca: null,
      detalle: "Redonda · Chica · Columna 1 · Fila 2",
      editar: { texto: "Editar mesa", href: "/salon/mesas/m1" },
      estado: { texto: "Desactivar", reactivar: false, apagado: false },
    });
    expect(lista.nueva).toEqual({ href: "/salon/mesas/nueva", texto: "Agregar mesa" });
    const form = armarElFormularioDeMesa(null, true, salon);
    expect(form.tamano.etiqueta).toBe("Tamaño");
    expect(form.tamano.opciones.map((o) => o.etiqueta)).toEqual(["Chica", "Mediana", "Grande"]);
  });

  it("una desactivada lleva su marca, se reactiva y no se edita", () => {
    const f = armarLaListaDeMesas([mesa({ activa: false })], true, medidas).filas[0];
    expect(f).toMatchObject({
      marca: "Desactivada",
      estado: { texto: "Reactivar", reactivar: true },
      editar: { href: null },
    });
  });

  it("sin permiso (o con duda) nada se ofrece: «Agregar mesa» ausente, el resto apagado, «Guardar» sin permiso", () => {
    for (const puede of [false, undefined]) {
      const lista = armarLaListaDeMesas([mesa()], puede, medidas);
      expect(lista.nueva).toBeNull();
      expect(lista.filas[0]).toMatchObject({ estado: { apagado: true }, editar: { href: null } });
      expect(armarElFormularioDeMesa(null, puede, salon).puedeGuardar).toBe(false);
    }
    expect(armarElFormularioDeMesa(mesa(), true, salon).puedeGuardar).toBe(true);
  });

  it("editar abre con los datos de la mesa; una nueva, vacía con Redonda y Chica", () => {
    const e = armarElFormularioDeMesa(mesa(), true, salon);
    expect([
      e.numero.valorInicial,
      e.forma.valorInicial,
      e.tamano.valorInicial,
      e.columna.valorInicial,
      e.fila.valorInicial,
    ]).toEqual(["7", "REDONDA", "CHICA", "1", "2"]);
    const n = armarElFormularioDeMesa(null, true, salon);
    expect([
      n.numero.valorInicial,
      n.forma.valorInicial,
      n.tamano.valorInicial,
      n.columna.valorInicial,
      n.fila.valorInicial,
    ]).toEqual(["", "REDONDA", "CHICA", "", ""]);
  });
});
