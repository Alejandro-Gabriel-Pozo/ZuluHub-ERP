import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de la hoja «Por porcentaje» del cobro de una mesa (SAL-E3; maqueta `salon.html`, aprobada el 09/11/2026, y E7 l.430-431: `salon.texto.dividir_*`), ya resueltos. Acá no se arma ningún texto nuevo: se eligen los aprobados.
 * «Importe», «Quitar» y «Volver al cobro» son los de la hoja de cobro (`TextosDeCobrar`). Chequeo: `test/web/ficha-de-la-mesa.test.ts` (cada clave declarada en la ficha con su uso y su fuente).
 */
export type TextosDeDividirEnElCobro = Readonly<{
  dividirLaCuenta: string;
  porPorcentaje: string;
  parte: string;
  resto: string;
  agregarParte: string;
  usarEnElCobro: string;
}>;

export function textosDeDividirEnElCobro(): TextosDeDividirEnElCobro {
  return {
    dividirLaCuenta: texto({}, "salon.texto.dividir_dividir_la_cuenta"),
    porPorcentaje: texto({}, "salon.texto.dividir_por_porcentaje"),
    parte: texto({}, "salon.texto.dividir_parte"),
    resto: texto({}, "salon.texto.dividir_resto"),
    agregarParte: texto({}, "salon.texto.dividir_agregar_parte"),
    usarEnElCobro: texto({}, "salon.texto.dividir_usar_en_el_cobro"),
  };
}
