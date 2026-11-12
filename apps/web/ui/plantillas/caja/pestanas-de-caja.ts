import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RUTAS_DE_CAJA, type PestanaDeCaja } from "./lista-de-caja";

/** Las tres pestañas de la configuración de caja con sus textos (los títulos de cada pantalla) y la actual marcada. */
export function pestanasDeCaja(actual: keyof typeof RUTAS_DE_CAJA): readonly PestanaDeCaja[] {
  return [
    { clave: "medios", texto: texto({}, "caja.medios.titulo") },
    { clave: "cuentas", texto: texto({}, "caja.cuentas.titulo") },
    { clave: "cajas", texto: texto({}, "caja.cajas.titulo") },
  ].map((p) => ({
    href: RUTAS_DE_CAJA[p.clave as keyof typeof RUTAS_DE_CAJA],
    texto: p.texto,
    actual: p.clave === actual,
  }));
}
