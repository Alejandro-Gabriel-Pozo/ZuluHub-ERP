import { describe, expect, it } from "vitest";
import { domicilioLibreDesdeTexto } from "../domicilio/domicilio-libre";
import { descripcionDeCartaDesdeTexto } from "./descripcion-de-carta";
import {
  lugarDeCartaDesdeTexto,
  mensajeDePortadaDesdeTexto,
  nombreDeCartaDesdeTexto,
  rubroDeCartaDesdeTexto,
} from "./datos-de-carta-publica";
import { nombreDeCocinaDesdeTexto } from "./nombre-de-cocina";
import { nombreDeEleccionDesdeTexto } from "./nombre-de-eleccion";
import { nombreDeProductoDesdeTexto } from "./nombre-de-producto";
import { nombreODenominacionDesdeTexto } from "./nombre-o-razon-social";

/**
 * Qué dato usa qué lista (dueño, Q3 del 12/11/2026): los seis signos `¿ ¡ ? ! % $` valen SOLO para los datos del catálogo; razón social y domicilio (que
 * viajan a ARCA) siguen con la lista base. Si alguien le pasa la bandera a razón social o domicilio, o se la saca a un dato del catálogo, esto falla.
 */
const CON_SIGNOS = ["¿Querés papas?", "Combo 2x1 50% $500", "¡Promo!"];

describe("los seis signos valen solo donde el dueño los aprobó", () => {
  it.each([
    ["nombre de producto", nombreDeProductoDesdeTexto],
    ["nombre de sección, grupo y opción", nombreDeEleccionDesdeTexto],
    ["descripción en la carta", descripcionDeCartaDesdeTexto],
    ["nombre de la carta", nombreDeCartaDesdeTexto],
    ["rubro de la carta", rubroDeCartaDesdeTexto],
    ["lugar de la carta", lugarDeCartaDesdeTexto],
    ["mensaje de la portada", mensajeDePortadaDesdeTexto],
  ])("%s los admite", (_nombre, convertir) => {
    for (const texto of CON_SIGNOS)
      expect(convertir(texto), texto).toEqual({ ok: true, valor: texto });
  });

  it.each([
    ["razón social o nombre", nombreODenominacionDesdeTexto],
    ["domicilio libre", domicilioLibreDesdeTexto],
    ["nombre de cocina", nombreDeCocinaDesdeTexto],
  ])("%s NO los admite: ni «%%» ni «¿» ni ninguno de los seis", (_nombre, convertir) => {
    for (const texto of ["50% Off SRL", "¿Qué tal?", "Hotel $ Spa", "Hola!", "Hola?", "¡Hola"]) {
      expect(convertir(texto).ok, texto).toBe(false);
    }
  });
});
