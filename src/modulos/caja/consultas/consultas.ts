import type { DependenciasDeConsultasDeCaja } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { armarListarCajas } from "./listar-cajas";
import { armarListarCuentasDeCobro } from "./listar-cuentas-de-cobro";
import { armarListarMediosDePago } from "./listar-medios-de-pago";
import { armarListarSesiones } from "./listar-sesiones";
import { armarFichaDeSesion } from "./ficha-de-sesion";
import { armarMovimientosDeSesion } from "./movimientos-de-sesion";
import { armarOpcionesDeApertura } from "./opciones-de-apertura";
import { armarPrepararCierre } from "./preparar-cierre";
import { armarResumenDeSesion } from "./resumen-de-sesion";

/**
 * Las consultas por pantalla de caja (ADR-005). El `satisfies` exige que cada una tenga su declaración (qué acción exige): una consulta
 * sin declarar, o con una acción que no existe en el catálogo, no compila. La configuración y la operación de la caja (apertura, sesiones,
 * movimientos y cierre); lo del cobro lo suma el tramo siguiente.
 */
export function crearConsultasDeCaja(dependencias: DependenciasDeConsultasDeCaja) {
  return {
    listarCajas: armarListarCajas(dependencias),
    listarMediosDePago: armarListarMediosDePago(dependencias),
    listarCuentasDeCobro: armarListarCuentasDeCobro(dependencias),
    opcionesDeApertura: armarOpcionesDeApertura(dependencias),
    resumenDeSesion: armarResumenDeSesion(dependencias),
    movimientosDeSesion: armarMovimientosDeSesion(dependencias),
    prepararCierre: armarPrepararCierre(dependencias),
    listarSesiones: armarListarSesiones(dependencias),
    fichaDeSesion: armarFichaDeSesion(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeCaja = ReturnType<typeof crearConsultasDeCaja>;
